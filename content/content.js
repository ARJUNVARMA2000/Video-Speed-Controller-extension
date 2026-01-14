// Video Speed Controller - Content Script

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.vscInitialized) return;
  window.vscInitialized = true;

  // State
  let settings = null;
  let mediaElements = new Map(); // Map<element, controller>
  let activeElement = null;
  let toastElement = null;
  let toastTimeout = null;
  let isBlocked = false;

  // Initialize
  async function init() {
    // Check if site is blocked
    const blockCheck = await sendMessage({ type: 'checkBlacklist', url: window.location.href });
    if (blockCheck.blocked) {
      isBlocked = true;
      console.log('Video Speed Controller: Disabled on this site');
      return;
    }

    // Load settings
    settings = await sendMessage({ type: 'getSettings' });
    if (!settings.enabled) {
      isBlocked = true;
      return;
    }

    // Create toast element
    createToast();

    // Find existing media elements
    findMediaElements();

    // Set up mutation observer for dynamic content
    setupObserver();

    // Set up keyboard listener
    setupKeyboardListener();

    // Listen for messages from background/popup
    chrome.runtime.onMessage.addListener(handleMessage);

    console.log('Video Speed Controller: Initialized');
  }

  // Send message to background script
  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response || {});
      });
    });
  }

  // Handle messages from background/popup
  function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'settingsUpdated':
        settings = message.settings;
        updateAllControllers();
        break;
      case 'command':
        handleCommand(message.command);
        break;
      case 'tabReady':
        // Tab is ready, can send initial state if needed
        break;
    }
  }

  // Handle keyboard commands from manifest
  function handleCommand(command) {
    if (!activeElement) {
      activeElement = findActiveMedia();
    }
    if (!activeElement) return;

    switch (command) {
      case 'toggle-controller':
        toggleController(activeElement);
        break;
      case 'increase-speed':
        changeSpeed(activeElement, 0.1);
        break;
      case 'decrease-speed':
        changeSpeed(activeElement, -0.1);
        break;
      case 'reset-speed':
        setSpeed(activeElement, 1.0);
        break;
    }
  }

  // Create toast notification element
  function createToast() {
    toastElement = document.createElement('div');
    toastElement.className = 'vsc-toast';
    document.body.appendChild(toastElement);
  }

  // Show toast notification
  function showToast(text, type = 'speed') {
    if (!toastElement) return;

    toastElement.innerHTML = `<span class="vsc-toast-${type}">${text}</span>`;
    toastElement.classList.add('vsc-visible');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastElement.classList.remove('vsc-visible');
    }, 800);
  }

  // Find all media elements on page
  function findMediaElements() {
    const selector = settings.workOnAudio ? 'video, audio' : 'video';
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => attachController(el));
  }

  // Set up mutation observer for dynamic content
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          // Check if the node itself is a media element
          if (isMediaElement(node)) {
            attachController(node);
          }

          // Check children
          const selector = settings.workOnAudio ? 'video, audio' : 'video';
          const mediaInside = node.querySelectorAll?.(selector);
          if (mediaInside) {
            mediaInside.forEach(el => attachController(el));
          }
        }

        // Handle removed nodes
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (isMediaElement(node)) {
            detachController(node);
          }
          const selector = settings.workOnAudio ? 'video, audio' : 'video';
          const mediaInside = node.querySelectorAll?.(selector);
          if (mediaInside) {
            mediaInside.forEach(el => detachController(el));
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Check if element is a media element
  function isMediaElement(el) {
    if (el.tagName === 'VIDEO') return true;
    if (el.tagName === 'AUDIO' && settings.workOnAudio) return true;
    return false;
  }

  // Attach controller to media element
  function attachController(media) {
    if (mediaElements.has(media)) return;

    // Skip tiny videos (likely ads or tracking pixels)
    if (media.tagName === 'VIDEO' && media.offsetWidth < 100 && media.offsetHeight < 100) {
      return;
    }

    const controller = createController(media);
    mediaElements.set(media, controller);

    // Set initial speed if remembered
    applyInitialSpeed(media);

    // Track active element on play
    media.addEventListener('play', () => {
      activeElement = media;
    });

    // Update controller when speed changes externally
    media.addEventListener('ratechange', () => {
      updateControllerDisplay(media);
    });

    console.log('Video Speed Controller: Attached to', media.tagName);
  }

  // Detach controller from media element
  function detachController(media) {
    const controller = mediaElements.get(media);
    if (controller) {
      controller.remove();
      mediaElements.delete(media);
    }
    if (activeElement === media) {
      activeElement = null;
    }
  }

  // Create controller UI
  function createController(media) {
    const controller = document.createElement('div');
    controller.className = 'vsc-controller';

    if (settings.hideByDefault) {
      controller.classList.add('vsc-hidden');
    }

    controller.style.opacity = settings.opacity;

    if (settings.controllerMode === 'minimal') {
      controller.innerHTML = createMinimalUI(media.playbackRate);
    } else {
      controller.innerHTML = createFullUI(media.playbackRate);
    }

    // Make controller draggable
    makeDraggable(controller);

    // Attach event listeners
    attachControllerEvents(controller, media);

    // Position controller on video
    positionController(media, controller);

    return controller;
  }

  // Create minimal mode UI (badge only)
  function createMinimalUI(speed) {
    return `<div class="vsc-badge">${speed.toFixed(2)}x</div>`;
  }

  // Create full mode UI (panel with controls)
  function createFullUI(speed) {
    return `
      <div class="vsc-panel">
        <div class="vsc-panel-header">
          <span class="vsc-panel-title">Speed</span>
          <span class="vsc-speed-display">${speed.toFixed(2)}x</span>
        </div>
        <div class="vsc-controls">
          <button class="vsc-btn vsc-btn-decrease" data-action="decrease">-</button>
          <button class="vsc-btn vsc-btn-reset" data-action="reset">1x</button>
          <button class="vsc-btn vsc-btn-increase" data-action="increase">+</button>
        </div>
        <div class="vsc-presets">
          <button class="vsc-preset" data-speed="0.5">0.5x</button>
          <button class="vsc-preset" data-speed="1">1x</button>
          <button class="vsc-preset" data-speed="1.5">1.5x</button>
          <button class="vsc-preset" data-speed="2">2x</button>
          <button class="vsc-preset" data-speed="3">3x</button>
        </div>
        <div class="vsc-seek-controls">
          <button class="vsc-seek-btn" data-seek="-10">-10s</button>
          <button class="vsc-seek-btn" data-seek="10">+10s</button>
        </div>
      </div>
    `;
  }

  // Position controller relative to video
  function positionController(media, controller) {
    // Try to position within video's parent
    let container = media.parentElement;

    // Find a suitable positioned parent
    while (container && container !== document.body) {
      const style = window.getComputedStyle(container);
      if (style.position !== 'static') break;
      container = container.parentElement;
    }

    if (!container || container === document.body) {
      // Wrap video in positioned container
      const wrapper = document.createElement('div');
      wrapper.className = 'vsc-wrapper';
      wrapper.style.cssText = 'position: relative; display: inline-block; width: 100%; height: 100%;';
      media.parentElement.insertBefore(wrapper, media);
      wrapper.appendChild(media);
      wrapper.appendChild(controller);
    } else {
      container.appendChild(controller);
    }
  }

  // Make element draggable
  function makeDraggable(element) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    element.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = element.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      element.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      element.style.position = 'fixed';
      element.style.left = (initialX + deltaX) + 'px';
      element.style.top = (initialY + deltaY) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        element.style.cursor = 'grab';
      }
    });
  }

  // Attach event listeners to controller buttons
  function attachControllerEvents(controller, media) {
    controller.addEventListener('click', (e) => {
      const target = e.target;

      if (target.dataset.action === 'increase') {
        changeSpeed(media, 0.1);
      } else if (target.dataset.action === 'decrease') {
        changeSpeed(media, -0.1);
      } else if (target.dataset.action === 'reset') {
        setSpeed(media, 1.0);
      } else if (target.dataset.speed) {
        setSpeed(media, parseFloat(target.dataset.speed));
      } else if (target.dataset.seek) {
        seekMedia(media, parseInt(target.dataset.seek));
      }
    });

    // Prevent clicks from reaching video
    controller.addEventListener('click', e => e.stopPropagation());
    controller.addEventListener('dblclick', e => e.stopPropagation());
  }

  // Change playback speed
  function changeSpeed(media, delta) {
    const newSpeed = Math.max(0.1, Math.min(16, media.playbackRate + delta));
    setSpeed(media, newSpeed);
  }

  // Set playback speed
  function setSpeed(media, speed) {
    speed = Math.round(speed * 100) / 100; // Round to 2 decimals
    media.playbackRate = speed;

    showToast(`${speed.toFixed(2)}x`, 'speed');
    updateControllerDisplay(media);

    // Save speed for site
    if (settings.rememberSpeed) {
      sendMessage({
        type: 'saveSpeed',
        hostname: window.location.hostname,
        speed: speed
      });
    }
  }

  // Seek media forward/backward
  function seekMedia(media, seconds) {
    media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + seconds));
    const prefix = seconds > 0 ? '+' : '';
    showToast(`${prefix}${seconds}s`, 'seek');
  }

  // Update controller display
  function updateControllerDisplay(media) {
    const controller = mediaElements.get(media);
    if (!controller) return;

    const speed = media.playbackRate;

    // Update badge or display
    const badge = controller.querySelector('.vsc-badge');
    if (badge) {
      badge.textContent = `${speed.toFixed(2)}x`;
    }

    const display = controller.querySelector('.vsc-speed-display');
    if (display) {
      display.textContent = `${speed.toFixed(2)}x`;
    }

    // Update preset active states
    const presets = controller.querySelectorAll('.vsc-preset');
    presets.forEach(preset => {
      preset.classList.toggle('active', parseFloat(preset.dataset.speed) === speed);
    });
  }

  // Update all controllers (after settings change)
  function updateAllControllers() {
    mediaElements.forEach((controller, media) => {
      controller.style.opacity = settings.opacity;

      if (settings.hideByDefault) {
        controller.classList.add('vsc-hidden');
      } else {
        controller.classList.remove('vsc-hidden');
      }

      // Rebuild UI if mode changed
      const isMinimal = controller.querySelector('.vsc-badge') !== null;
      if ((settings.controllerMode === 'minimal') !== isMinimal) {
        if (settings.controllerMode === 'minimal') {
          controller.innerHTML = createMinimalUI(media.playbackRate);
        } else {
          controller.innerHTML = createFullUI(media.playbackRate);
        }
        attachControllerEvents(controller, media);
      }
    });
  }

  // Toggle controller visibility
  function toggleController(media) {
    const controller = mediaElements.get(media);
    if (controller) {
      controller.classList.toggle('vsc-hidden');
    }
  }

  // Apply initial speed from saved settings
  async function applyInitialSpeed(media) {
    if (!settings.rememberSpeed && !settings.forceSpeed) return;

    const response = await sendMessage({
      type: 'getSavedSpeed',
      hostname: window.location.hostname
    });

    if (response.speed) {
      // Wait a bit for video to initialize
      setTimeout(() => {
        if (settings.forceSpeed || media.playbackRate === 1.0) {
          media.playbackRate = response.speed;
          updateControllerDisplay(media);
        }
      }, 100);
    }
  }

  // Find currently active/playing media
  function findActiveMedia() {
    // Return actively playing media first
    for (const [media] of mediaElements) {
      if (!media.paused) return media;
    }
    // Return first media element
    const first = mediaElements.keys().next().value;
    return first || null;
  }

  // Set up keyboard listener for shortcuts
  function setupKeyboardListener() {
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input fields
      if (e.target.matches('input, textarea, [contenteditable="true"]')) {
        return;
      }

      // Find matching shortcut
      const shortcut = settings.shortcuts?.find(s => {
        if (!s.enabled) return false;
        if (s.key.toUpperCase() !== e.key.toUpperCase()) return false;

        // Check modifiers
        const modifiers = s.modifiers || [];
        const ctrlMatch = modifiers.includes('ctrl') === (e.ctrlKey || e.metaKey);
        const altMatch = modifiers.includes('alt') === e.altKey;
        const shiftMatch = modifiers.includes('shift') === e.shiftKey;

        return ctrlMatch && altMatch && shiftMatch;
      });

      if (!shortcut) return;

      // Get active media
      if (!activeElement) {
        activeElement = findActiveMedia();
      }
      if (!activeElement) return;

      e.preventDefault();
      e.stopPropagation();

      // Execute action
      switch (shortcut.action) {
        case 'show-controller':
          toggleController(activeElement);
          break;
        case 'increase-speed':
          changeSpeed(activeElement, shortcut.value || 0.1);
          break;
        case 'decrease-speed':
          changeSpeed(activeElement, -(shortcut.value || 0.1));
          break;
        case 'rewind':
          seekMedia(activeElement, -(shortcut.value || 10));
          break;
        case 'advance':
          seekMedia(activeElement, shortcut.value || 10);
          break;
        case 'reset-speed':
          setSpeed(activeElement, shortcut.value || 1.0);
          break;
        case 'preferred-speed':
          setSpeed(activeElement, shortcut.value || 2.0);
          break;
      }
    }, true);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
