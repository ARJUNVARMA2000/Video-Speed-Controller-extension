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
  let isBlocked = false;
  let contextInvalidated = false;

  // Long-press state
  let longPressActive = false;
  let longPressOriginalSpeed = 1.0;

  // Picture-in-Picture state
  let pipIndicator = null;
  let pipMediaElement = null;

  // Auto-hide timers
  let autoHideTimers = new Map(); // Map<controller, timeoutId>

  // Time tracking
  let timeTrackingInterval = null;
  let lastTrackTime = Date.now();

  // URL tracking for SPAs
  let lastUrl = window.location.href;

  // Intro/Outro skip state
  let introOutroSettings = null;
  let introSkippedVideos = new WeakSet(); // Track which videos have had intro skipped
  let outroSkippedVideos = new WeakSet(); // Track which videos have had outro action triggered

  // Check if extension context is still valid
  function isContextValid() {
    try {
      // This will throw if context is invalidated
      return chrome.runtime && chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  // Handle invalidated context - clean up gracefully
  function handleContextInvalidated() {
    if (contextInvalidated) return;
    contextInvalidated = true;

    console.log('Video Speed Controller: Extension context invalidated, cleaning up');

    // Stop time tracking
    if (timeTrackingInterval) {
      clearInterval(timeTrackingInterval);
      timeTrackingInterval = null;
    }

    // Clear auto-hide timers
    autoHideTimers.forEach(timer => clearTimeout(timer));
    autoHideTimers.clear();

    // Remove all controllers from the page
    mediaElements.forEach((controller, media) => {
      if (controller && controller.parentNode) {
        controller.remove();
      }
    });
    mediaElements.clear();

    // Reset state
    activeElement = null;
    window.vscInitialized = false;
  }

  // Initialize
  async function init() {
    // Check if extension context is valid
    if (!isContextValid()) {
      console.log('Video Speed Controller: Extension context not available');
      return;
    }

    // Check if site is blocked
    const blockCheck = await sendMessage({ type: 'checkSiteAccess', url: window.location.href });
    if (blockCheck.blocked) {
      isBlocked = true;
      console.log('Video Speed Controller: Disabled on this site');
      return;
    }

    // Load settings
    settings = await sendMessage({ type: 'getSettings' });
    if (settings.preservePitch === undefined) {
      settings.preservePitch = true;
    }
    if (!settings.enabled) {
      isBlocked = true;
      return;
    }

    // Load intro/outro settings
    introOutroSettings = await sendMessage({
      type: 'getIntroOutroSettings',
      hostname: window.location.hostname
    });

    // Find existing media elements
    findMediaElements();

    // Set up mutation observer for dynamic content
    setupObserver();

    // Set up keyboard listener
    setupKeyboardListener();

    // Set up context menu
    setupContextMenu();

    // Start time tracking
    startTimeTracking();

    // Start URL change detection for SPAs
    startUrlChangeDetection();

    // Listen for messages from background/popup
    try {
      chrome.runtime.onMessage.addListener(handleMessage);
    } catch (e) {
      if (e.message?.includes('Extension context invalidated')) {
        handleContextInvalidated();
        return;
      }
    }

    console.log('Video Speed Controller: Initialized');
  }

  // Send message to background script
  function sendMessage(message) {
    return new Promise((resolve) => {
      // Check if context is still valid
      if (!isContextValid()) {
        handleContextInvalidated();
        resolve({});
        return;
      }

      try {
        chrome.runtime.sendMessage(message, (response) => {
          // Check for runtime.lastError (includes context invalidated)
          if (chrome.runtime.lastError) {
            if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
              handleContextInvalidated();
            }
            resolve({});
            return;
          }
          resolve(response || {});
        });
      } catch (e) {
        // Context was invalidated between the check and the call
        if (e.message?.includes('Extension context invalidated')) {
          handleContextInvalidated();
        }
        resolve({});
      }
    });
  }

  // Handle messages from background/popup
  function handleMessage(message, sender, sendResponse) {
    // Skip if context is invalidated
    if (contextInvalidated) return;

    switch (message.type) {
      case 'settingsUpdated':
        settings = message.settings;
        updateAllControllers();
        // Reload intro/outro settings
        reloadIntroOutroSettings();
        break;
      case 'command':
        handleCommand(message.command);
        break;
      case 'setSpeed':
        // Set speed from popup presets
        if (!activeElement) activeElement = findActiveMedia();
        if (activeElement) {
          setSpeed(activeElement, message.speed);
        }
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

    // Apply pitch preference before UI is created
    applyPreservePitchSetting(media);

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
      updatePipIndicator();
    });

    // Set up Picture-in-Picture support
    if (media.tagName === 'VIDEO') {
      setupPipSupport(media);
    }

    // Set up intro/outro skip
    setupIntroOutroSkip(media);

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

    // Apply custom colors
    const bgColor = settings.colorBackground || '#1a1a2e';
    const accentColor = settings.colorAccent || '#e94560';
    controller.style.setProperty('--vsc-bg-color', bgColor);
    controller.style.setProperty('--vsc-accent-color', accentColor);

    if (settings.controllerMode === 'minimal') {
      controller.innerHTML = createMinimalUI(media.playbackRate);
    } else {
      controller.innerHTML = createFullUI(media);
    }

    // Make controller draggable
    makeDraggable(controller);

    // Attach event listeners
    attachControllerEvents(controller, media);

    // Position controller on video
    positionController(media, controller);

    return controller;
  }

  // Create minimal mode UI (badge with +/- controls)
  function createMinimalUI(speed) {
    return `
      <div class="vsc-badge-wrapper">
        <button class="vsc-mini-btn vsc-mini-decrease" data-action="decrease">−</button>
        <div class="vsc-badge">${speed.toFixed(2)}x</div>
        <button class="vsc-mini-btn vsc-mini-increase" data-action="increase">+</button>
      </div>
    `;
  }

  // Create full mode UI (panel with controls)
  function createFullUI(media) {
    const speed = media.playbackRate;
    const pitchState = getPitchState(media);
    const pitchLabel = pitchState.supported ? (pitchState.preserved ? 'ON' : 'OFF') : 'N/A';
    const pitchClasses = ['vsc-pitch-toggle'];
    if (pitchState.supported && !pitchState.preserved) pitchClasses.push('vsc-pitch-off');
    if (!pitchState.supported) pitchClasses.push('vsc-pitch-disabled');
    const pitchAttrs = pitchState.supported
      ? 'title="When ON, keeps original pitch. When OFF, pitch changes with speed (chipmunk effect)."'
      : 'title="Pitch correction not supported for this media." disabled aria-disabled="true"';

    return `
      <div class="vsc-panel">
        <div class="vsc-panel-header">
          <span class="vsc-panel-title">Speed</span>
          <span class="vsc-speed-display">${speed.toFixed(2)}x</span>
        </div>
        <div class="vsc-controls">
          <button class="vsc-btn vsc-btn-decrease" data-action="decrease">−</button>
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
          <button class="vsc-seek-btn" data-seek="-10">−10s</button>
          <button class="vsc-seek-btn" data-seek="10">+10s</button>
        </div>
        <div class="vsc-frame-controls">
          <button class="vsc-frame-btn" data-frame="backward" title="Previous frame (,)">|◀</button>
          <span class="vsc-frame-label">Frame</span>
          <button class="vsc-frame-btn" data-frame="forward" title="Next frame (.)">▶|</button>
        </div>
        <div class="vsc-pitch-control">
          <span class="vsc-pitch-label">Pitch Correction</span>
          <button class="${pitchClasses.join(' ')}" data-action="toggle-pitch" ${pitchAttrs}>${pitchLabel}</button>
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
      // Always stop propagation to prevent video play/pause
      e.stopPropagation();
      e.preventDefault();
      
      const target = e.target;

      if (target.dataset.action === 'increase') {
        changeSpeed(media, 0.1);
      } else if (target.dataset.action === 'decrease') {
        changeSpeed(media, -0.1);
      } else if (target.dataset.action === 'reset') {
        setSpeed(media, 1.0);
      } else if (target.dataset.action === 'toggle-pitch') {
        togglePitchCorrection(media, target);
      } else if (target.dataset.speed) {
        setSpeed(media, parseFloat(target.dataset.speed));
      } else if (target.dataset.seek) {
        seekMedia(media, parseInt(target.dataset.seek));
      } else if (target.dataset.frame) {
        stepFrame(media, target.dataset.frame === 'forward');
      }

      // Reset auto-hide on interaction
      resetAutoHide(controller);
    });

    // Mouse wheel to change speed
    controller.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      changeSpeed(media, delta);
      resetAutoHide(controller);
    });

    // Reset auto-hide on mouse enter
    controller.addEventListener('mouseenter', () => {
      resetAutoHide(controller);
    });

    // Prevent all mouse events from reaching video
    controller.addEventListener('mousedown', e => e.stopPropagation());
    controller.addEventListener('mouseup', e => e.stopPropagation());
    controller.addEventListener('dblclick', e => { e.stopPropagation(); e.preventDefault(); });
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

    updateControllerDisplay(media);
    highlightController(media);

    // Save speed for site (skip if context invalidated)
    if (settings.rememberSpeed && !contextInvalidated) {
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
  }

  // Frame-by-frame navigation
  function stepFrame(media, forward = true) {
    // Pause the video first for frame stepping
    if (!media.paused) {
      media.pause();
    }

    // Estimate frame duration based on common frame rates
    // Most videos are 24, 25, 30, or 60 fps
    // Default to 30fps (0.033s per frame)
    const frameDuration = 1 / 30;
    
    if (forward) {
      media.currentTime = Math.min(media.duration, media.currentTime + frameDuration);
    } else {
      media.currentTime = Math.max(0, media.currentTime - frameDuration);
    }

    // Show brief feedback
    showFrameStepFeedback(media, forward);
  }

  // Show visual feedback for frame stepping
  function showFrameStepFeedback(media, forward) {
    const controller = mediaElements.get(media);
    if (!controller) return;

    // Create or update frame step indicator
    let indicator = controller.querySelector('.vsc-frame-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'vsc-frame-indicator';
      controller.appendChild(indicator);
    }

    indicator.textContent = forward ? '▶|' : '|◀';
    indicator.classList.add('vsc-show');

    setTimeout(() => {
      indicator.classList.remove('vsc-show');
    }, 300);
  }

  // Set up intro/outro skip for a media element
  function setupIntroOutroSkip(media) {
    if (!introOutroSettings || !introOutroSettings.enabled) return;

    // Auto-skip intro when video starts playing
    if (introOutroSettings.autoSkipIntro && introOutroSettings.introSkip > 0) {
      media.addEventListener('play', () => {
        // Only skip if we haven't already skipped for this video session
        // and we're at the beginning of the video
        if (!introSkippedVideos.has(media) && media.currentTime < 2) {
          skipIntro(media);
        }
      });

      // Also handle loadedmetadata for autoplay videos
      media.addEventListener('loadedmetadata', () => {
        if (introOutroSettings.autoSkipIntro && !introSkippedVideos.has(media) && !media.paused && media.currentTime < 2) {
          skipIntro(media);
        }
      });
    }

    // Set up outro detection using timeupdate
    if (introOutroSettings.outroSkip > 0) {
      media.addEventListener('timeupdate', () => {
        checkOutroSkip(media);
      });
    }
  }

  // Skip intro on a media element
  function skipIntro(media) {
    if (!introOutroSettings || !introOutroSettings.enabled) return;
    if (introOutroSettings.introSkip <= 0) return;

    const skipTo = introOutroSettings.introSkip;
    
    // Don't skip if video is shorter than skip time
    if (media.duration && skipTo >= media.duration) return;

    // Mark as skipped for this video session
    introSkippedVideos.add(media);

    // Skip to the specified time
    media.currentTime = skipTo;
    showSkipFeedback(media, 'Intro Skipped', skipTo);
    console.log(`Video Speed Controller: Skipped intro to ${skipTo}s`);
  }

  // Skip to outro (end of video minus outro time)
  function skipOutro(media) {
    if (!introOutroSettings || !introOutroSettings.enabled) return;
    if (introOutroSettings.outroSkip <= 0) return;
    if (!media.duration || isNaN(media.duration)) return;

    const skipTo = media.duration - 1; // Skip to 1 second before end
    
    // Don't skip if we're already past the skip point
    if (media.currentTime >= skipTo) return;

    // Skip to near the end
    media.currentTime = skipTo;
    showSkipFeedback(media, 'Outro Skipped', -introOutroSettings.outroSkip);
    console.log(`Video Speed Controller: Skipped outro to ${skipTo.toFixed(1)}s`);
  }

  // Check if we should trigger outro skip (for auto-skip)
  function checkOutroSkip(media) {
    if (!introOutroSettings || !introOutroSettings.enabled) return;
    if (introOutroSettings.outroSkip <= 0) return;
    if (!media.duration || isNaN(media.duration)) return;
    if (outroSkippedVideos.has(media)) return;

    const timeRemaining = media.duration - media.currentTime;
    
    // When we reach the outro skip point, trigger the skip
    if (timeRemaining <= introOutroSettings.outroSkip && timeRemaining > 0.5) {
      outroSkippedVideos.add(media);
      
      // Option 1: Skip to end (lets browser handle what happens next)
      media.currentTime = media.duration - 0.5;
      showSkipFeedback(media, 'Outro Skipped', -introOutroSettings.outroSkip);
      console.log(`Video Speed Controller: Auto-skipped outro at ${introOutroSettings.outroSkip}s remaining`);
    }
  }

  // Show visual feedback for skip action
  function showSkipFeedback(media, message, seconds) {
    // Create floating feedback element
    const feedback = document.createElement('div');
    feedback.className = 'vsc-skip-feedback';
    feedback.innerHTML = `
      <span class="vsc-skip-message">${message}</span>
      <span class="vsc-skip-time">${seconds > 0 ? '+' : ''}${seconds}s</span>
    `;

    // Apply custom colors
    const bgColor = settings.colorBackground || '#1a1a2e';
    const accentColor = settings.colorAccent || '#e94560';
    feedback.style.setProperty('--vsc-bg-color', bgColor);
    feedback.style.setProperty('--vsc-accent-color', accentColor);

    // Position near the video
    const controller = mediaElements.get(media);
    if (controller && controller.parentNode) {
      controller.parentNode.appendChild(feedback);
    } else {
      document.body.appendChild(feedback);
      feedback.style.position = 'fixed';
      feedback.style.top = '50%';
      feedback.style.left = '50%';
      feedback.style.transform = 'translate(-50%, -50%)';
    }

    // Animate and remove
    requestAnimationFrame(() => {
      feedback.classList.add('vsc-show');
    });

    setTimeout(() => {
      feedback.classList.remove('vsc-show');
      setTimeout(() => feedback.remove(), 300);
    }, 1500);
  }

  // Manual skip intro (triggered by hotkey)
  function manualSkipIntro() {
    if (!activeElement) {
      activeElement = findActiveMedia();
    }
    if (!activeElement) return;

    // Reset the skipped flag to allow manual skip even if auto-skipped
    introSkippedVideos.delete(activeElement);
    skipIntro(activeElement);
  }

  // Manual skip outro (triggered by hotkey)
  function manualSkipOutro() {
    if (!activeElement) {
      activeElement = findActiveMedia();
    }
    if (!activeElement) return;

    // Reset the skipped flag to allow manual skip
    outroSkippedVideos.delete(activeElement);
    skipOutro(activeElement);
  }

  // Reset intro/outro skip state for a video (e.g., when URL changes)
  function resetIntroOutroState(media) {
    introSkippedVideos.delete(media);
    outroSkippedVideos.delete(media);
  }

  // Reload intro/outro settings (called when settings change)
  async function reloadIntroOutroSettings() {
    if (contextInvalidated) return;
    
    introOutroSettings = await sendMessage({
      type: 'getIntroOutroSettings',
      hostname: window.location.hostname
    });
    
    console.log('Video Speed Controller: Intro/Outro settings reloaded', introOutroSettings);
  }

  // Pitch correction helpers
  function isPitchSupported(media) {
    return ('preservesPitch' in media) || ('mozPreservesPitch' in media) || ('webkitPreservesPitch' in media);
  }

  function getPreservePitchValue(media) {
    if ('preservesPitch' in media) return media.preservesPitch !== false;
    if ('mozPreservesPitch' in media) return media.mozPreservesPitch !== false;
    if ('webkitPreservesPitch' in media) return media.webkitPreservesPitch !== false;
    return null;
  }

  function setPreservePitchValue(media, value) {
    if ('preservesPitch' in media) media.preservesPitch = value;
    if ('mozPreservesPitch' in media) media.mozPreservesPitch = value;
    if ('webkitPreservesPitch' in media) media.webkitPreservesPitch = value;
  }

  function getPitchState(media) {
    const supported = isPitchSupported(media);
    return {
      supported,
      preserved: supported ? getPreservePitchValue(media) !== false : false
    };
  }

  function applyPreservePitchSetting(media) {
    if (!isPitchSupported(media)) return;
    const preserve = settings?.preservePitch !== false;
    setPreservePitchValue(media, preserve);
  }

  function updatePitchToggle(media) {
    const controller = mediaElements.get(media);
    if (!controller) return;
    const button = controller.querySelector('.vsc-pitch-toggle');
    if (!button) return;

    const supported = isPitchSupported(media);
    if (!supported) {
      button.textContent = 'N/A';
      button.classList.add('vsc-pitch-disabled');
      button.classList.remove('vsc-pitch-off');
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.title = 'Pitch correction not supported for this media.';
      return;
    }

    const preserved = getPreservePitchValue(media) !== false;
    button.disabled = false;
    button.removeAttribute('aria-disabled');
    button.classList.remove('vsc-pitch-disabled');
    button.textContent = preserved ? 'ON' : 'OFF';
    button.classList.toggle('vsc-pitch-off', !preserved);
    button.title = 'When ON, keeps original pitch. When OFF, pitch changes with speed (chipmunk effect).';
  }

  // Toggle pitch correction (preservesPitch)
  function togglePitchCorrection(media, button) {
    if (!isPitchSupported(media)) {
      updatePitchToggle(media);
      return;
    }

    const currentlyPreserved = getPreservePitchValue(media) !== false;
    const newValue = !currentlyPreserved;
    settings.preservePitch = newValue;
    setPreservePitchValue(media, newValue);

    // Apply to all media elements to keep behavior consistent
    mediaElements.forEach((_controller, mediaEl) => {
      applyPreservePitchSetting(mediaEl);
      updatePitchToggle(mediaEl);
    });

    sendMessage({ type: 'setPreservePitch', preservePitch: newValue });

    if (button) {
      updatePitchToggle(media);
    }
  }

  // Briefly highlight controller to show feedback
  function highlightController(media) {
    const controller = mediaElements.get(media);
    if (!controller) return;

    controller.classList.add('vsc-highlight');
    setTimeout(() => {
      controller.classList.remove('vsc-highlight');
    }, 200);
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

    updatePitchToggle(media);
  }

  // Update all controllers (after settings change)
  function updateAllControllers() {
    mediaElements.forEach((controller, media) => {
      controller.style.opacity = settings.opacity;

      // Update custom colors
      const bgColor = settings.colorBackground || '#1a1a2e';
      const accentColor = settings.colorAccent || '#e94560';
      controller.style.setProperty('--vsc-bg-color', bgColor);
      controller.style.setProperty('--vsc-accent-color', accentColor);

      if (settings.hideByDefault) {
        controller.classList.add('vsc-hidden');
      } else {
        controller.classList.remove('vsc-hidden');
      }

      applyPreservePitchSetting(media);

      // Rebuild UI if mode changed
      const isMinimal = controller.querySelector('.vsc-badge') !== null;
      if ((settings.controllerMode === 'minimal') !== isMinimal) {
        if (settings.controllerMode === 'minimal') {
          controller.innerHTML = createMinimalUI(media.playbackRate);
        } else {
          controller.innerHTML = createFullUI(media);
        }
        attachControllerEvents(controller, media);
      }

      updatePitchToggle(media);
    });
  }

  // Toggle controller visibility
  function toggleController(media) {
    const controller = mediaElements.get(media);
    if (controller) {
      controller.classList.toggle('vsc-hidden');
    }
  }

  // Apply initial speed from saved settings or URL rules
  async function applyInitialSpeed(media) {
    // Skip if context is invalidated
    if (contextInvalidated) return;

    // Check URL rules first (highest priority)
    const urlRuleResponse = await sendMessage({
      type: 'getUrlRuleSpeed',
      url: window.location.href
    });

    if (urlRuleResponse.matched && urlRuleResponse.speed) {
      // Wait a bit for video to initialize
      setTimeout(() => {
        media.playbackRate = urlRuleResponse.speed;
        updateControllerDisplay(media);
        console.log(`Video Speed Controller: Applied URL rule "${urlRuleResponse.pattern}" -> ${urlRuleResponse.speed}x`);
      }, 100);
      return;
    }

    // Check per-site preset speed next
    const sitePresetResponse = await sendMessage({
      type: 'getSitePresetSpeed',
      hostname: window.location.hostname
    });

    if (sitePresetResponse.speed) {
      setTimeout(() => {
        media.playbackRate = sitePresetResponse.speed;
        updateControllerDisplay(media);
      }, 100);
      return;
    }

    // Fall back to remembered speed per site
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

      // Check for intro/outro skip hotkeys first
      if (introOutroSettings && introOutroSettings.enabled) {
        const key = e.key.toUpperCase();
        
        if (key === (introOutroSettings.skipIntroKey || 'I').toUpperCase()) {
          e.preventDefault();
          e.stopPropagation();
          manualSkipIntro();
          return;
        }
        
        if (key === (introOutroSettings.skipOutroKey || 'O').toUpperCase()) {
          e.preventDefault();
          e.stopPropagation();
          manualSkipOutro();
          return;
        }
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
          // Long-press: hold to boost, release to restore
          if (!longPressActive) {
            longPressActive = true;
            longPressOriginalSpeed = activeElement.playbackRate;
            setSpeed(activeElement, shortcut.value || 2.0);
          }
          break;
        case 'frame-forward':
          stepFrame(activeElement, true);
          break;
        case 'frame-backward':
          stepFrame(activeElement, false);
          break;
      }
    }, true);

    // Key up for long-press release
    document.addEventListener('keyup', (e) => {
      if (e.target.matches('input, textarea, [contenteditable="true"]')) {
        return;
      }

      const shortcut = settings.shortcuts?.find(s => {
        if (!s.enabled) return false;
        if (s.key.toUpperCase() !== e.key.toUpperCase()) return false;
        return s.action === 'preferred-speed';
      });

      if (shortcut && longPressActive && activeElement) {
        longPressActive = false;
        setSpeed(activeElement, longPressOriginalSpeed);
      }
    }, true);
  }

  // Auto-hide functions
  function resetAutoHide(controller) {
    // Clear existing timer
    const existingTimer = autoHideTimers.get(controller);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Show controller
    controller.classList.remove('vsc-hidden');

    // Start new timer if enabled
    const delay = settings.autoHideDelay || 0;
    if (delay > 0) {
      const timer = setTimeout(() => {
        controller.classList.add('vsc-hidden');
      }, delay * 1000);
      autoHideTimers.set(controller, timer);
    }
  }

  // Context menu for quick speed access
  function setupContextMenu() {
    document.addEventListener('contextmenu', (e) => {
      // Only show on video elements or controller
      const video = e.target.closest('video');
      const controller = e.target.closest('.vsc-controller');

      if (!video && !controller) return;

      // Remove existing menu
      const existingMenu = document.querySelector('.vsc-context-menu');
      if (existingMenu) existingMenu.remove();

      e.preventDefault();

      const media = video || findActiveMedia();
      if (!media) return;

      // Create context menu
      const menu = document.createElement('div');
      menu.className = 'vsc-context-menu';
      
      // Apply custom colors to context menu
      const bgColor = settings.colorBackground || '#1a1a2e';
      const accentColor = settings.colorAccent || '#e94560';
      menu.style.setProperty('--vsc-bg-color', bgColor);
      menu.style.setProperty('--vsc-accent-color', accentColor);
      
      menu.innerHTML = `
        <div class="vsc-menu-title">Speed Controller</div>
        <div class="vsc-menu-item" data-speed="0.5">0.5x</div>
        <div class="vsc-menu-item" data-speed="0.75">0.75x</div>
        <div class="vsc-menu-item" data-speed="1">1x (Normal)</div>
        <div class="vsc-menu-item" data-speed="1.25">1.25x</div>
        <div class="vsc-menu-item" data-speed="1.5">1.5x</div>
        <div class="vsc-menu-item" data-speed="2">2x</div>
        <div class="vsc-menu-item" data-speed="3">3x</div>
      `;

      // Position menu
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';

      document.body.appendChild(menu);

      // Handle menu clicks
      menu.addEventListener('click', (ev) => {
        const item = ev.target.closest('.vsc-menu-item');
        if (item && item.dataset.speed) {
          setSpeed(media, parseFloat(item.dataset.speed));
        }
        menu.remove();
      });

      // Close menu on outside click
      setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }, { once: true });
      }, 10);
    });
  }

  // Picture-in-Picture support
  function setupPipSupport(media) {
    // Listen for PiP events
    media.addEventListener('enterpictureinpicture', (e) => {
      pipMediaElement = media;
      if (settings.showPipIndicator !== false) {
        createPipIndicator(media);
      }
      console.log('Video Speed Controller: Entered Picture-in-Picture mode');
    });

    media.addEventListener('leavepictureinpicture', () => {
      pipMediaElement = null;
      removePipIndicator();
      console.log('Video Speed Controller: Left Picture-in-Picture mode');
    });
  }

  // Create floating PiP speed indicator
  function createPipIndicator(media) {
    removePipIndicator(); // Remove any existing indicator

    pipIndicator = document.createElement('div');
    pipIndicator.className = 'vsc-pip-indicator';
    
    const bgColor = settings.colorBackground || '#1a1a2e';
    const accentColor = settings.colorAccent || '#e94560';
    pipIndicator.style.setProperty('--vsc-bg-color', bgColor);
    pipIndicator.style.setProperty('--vsc-accent-color', accentColor);

    pipIndicator.innerHTML = `
      <div class="vsc-pip-header">
        <span class="vsc-pip-label">PiP Speed</span>
        <span class="vsc-pip-speed">${media.playbackRate.toFixed(2)}x</span>
      </div>
      <div class="vsc-pip-controls">
        <button class="vsc-pip-btn" data-action="decrease">−</button>
        <button class="vsc-pip-btn vsc-pip-reset" data-action="reset">1x</button>
        <button class="vsc-pip-btn" data-action="increase">+</button>
      </div>
    `;

    document.body.appendChild(pipIndicator);

    // Make it draggable
    makeDraggable(pipIndicator);

    // Handle button clicks
    pipIndicator.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (!action || !pipMediaElement) return;

      if (action === 'increase') {
        changeSpeed(pipMediaElement, 0.1);
      } else if (action === 'decrease') {
        changeSpeed(pipMediaElement, -0.1);
      } else if (action === 'reset') {
        setSpeed(pipMediaElement, 1.0);
      }
      updatePipIndicator();
    });

    // Handle scroll wheel
    pipIndicator.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!pipMediaElement) return;
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      changeSpeed(pipMediaElement, delta);
      updatePipIndicator();
    });
  }

  // Update PiP indicator display
  function updatePipIndicator() {
    if (!pipIndicator || !pipMediaElement) return;
    const speedDisplay = pipIndicator.querySelector('.vsc-pip-speed');
    if (speedDisplay) {
      speedDisplay.textContent = `${pipMediaElement.playbackRate.toFixed(2)}x`;
    }
  }

  // Remove PiP indicator
  function removePipIndicator() {
    if (pipIndicator) {
      pipIndicator.remove();
      pipIndicator = null;
    }
  }

  // Time saved tracking
  function startTimeTracking() {
    timeTrackingInterval = setInterval(() => {
      // Skip if context is invalidated
      if (contextInvalidated) {
        clearInterval(timeTrackingInterval);
        return;
      }

      const now = Date.now();
      const elapsed = (now - lastTrackTime) / 1000; // seconds
      lastTrackTime = now;

      // Find playing media at >1x speed
      for (const [media] of mediaElements) {
        if (!media.paused && media.playbackRate > 1) {
          // Time saved = actual time * (speed - 1)
          // e.g., 10 seconds at 2x saves 10 * (2-1) = 10 seconds
          const timeSaved = elapsed * (media.playbackRate - 1);
          updateTimeSaved(timeSaved);
        }
      }
    }, 1000);
  }

  function updateTimeSaved(seconds) {
    // Skip if context is invalidated
    if (contextInvalidated) return;

    sendMessage({
      type: 'addTimeSaved',
      seconds: seconds
    });
  }

  // Detect URL changes for SPAs (e.g., YouTube navigation)
  function startUrlChangeDetection() {
    // Check for URL changes periodically
    const urlCheckInterval = setInterval(async () => {
      // Skip if context is invalidated
      if (contextInvalidated) {
        clearInterval(urlCheckInterval);
        return;
      }

      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('Video Speed Controller: URL changed, checking rules');

        // Reload intro/outro settings for new URL
        introOutroSettings = await sendMessage({
          type: 'getIntroOutroSettings',
          hostname: window.location.hostname
        });

        // Re-apply speed and reset intro/outro state for new URL
        for (const [media] of mediaElements) {
          await applyInitialSpeed(media);
          resetIntroOutroState(media);
        }
      }
    }, 500);

    // Also listen for popstate (back/forward navigation)
    window.addEventListener('popstate', async () => {
      // Skip if context is invalidated
      if (contextInvalidated) return;

      lastUrl = window.location.href;

      // Reload intro/outro settings
      introOutroSettings = await sendMessage({
        type: 'getIntroOutroSettings',
        hostname: window.location.hostname
      });

      for (const [media] of mediaElements) {
        await applyInitialSpeed(media);
        resetIntroOutroState(media);
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
