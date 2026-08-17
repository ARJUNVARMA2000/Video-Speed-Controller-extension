// Video Speed Controller Pro - Content Script

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
  let extensionActive = false;
  let domObserver = null;
  let interactionListenersBound = false;
  let contextMenuBound = false;
  let messageListenerBound = false;
  let frameGrowthWatched = false;
  const MIN_FRAME_DIMENSION = 150;
  let urlTrackingStarted = false;
  let urlCheckInterval = null;
  let urlPollBound = false;
  let urlPollIntervalMs = null;
  const URL_POLL_VISIBLE_MS = 1000;
  const URL_POLL_HIDDEN_MS = 5000;

  const DEBUG = false;
  function debug(...args) {
    if (DEBUG) console.debug(...args);
  }

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

  // A-B Loop state
  let abLoopState = new Map(); // Map<media, { pointA: number, pointB: number, active: boolean }>

  // Video Filters state
  let videoFilters = {
    brightness: 100,
    contrast: 100,
    saturation: 100
  };

  // Volume Boost state
  let audioContextMap = new Map(); // Map<media, { audioContext, gainNode, sourceNode }>
  let volumeBoostLevel = 100; // 100 = normal, up to VOLUME_BOOST_MAX
  const VOLUME_BOOST_MAX = 600;

  // Drag state (shared global handlers)
  let dragState = null;
  let dragListenersBound = false;

  // Speed enforcement. Sites like YouTube and Netflix reset playbackRate on their
  // own (new video, quality switch, ad break), so the rate we set has to be
  // defended after the fact rather than written once.
  const SPEED_EPSILON = 0.001;
  const SPEED_REASSERT_WINDOW_MS = 1500;
  const SPEED_CORRECTION_WINDOW_MS = 1000;
  const SPEED_CORRECTION_LIMIT = 8;
  const SPEED_CORRECTION_COOLDOWN_MS = 5000;

  // Active-frame reporting
  const FRAME_REPORT_DELAY_MS = 250;
  let frameReportTimer = null;

  // Shadow DOM tracking. Shadow roots are separate trees that the document
  // observer cannot see into, so each one is observed individually. Finding
  // them means visiting every element, so the search is budgeted across idle
  // slices rather than blocking on a whole document at once.
  const SHADOW_SCAN_BATCH = 250;
  const IDLE_TIMEOUT_MS = 500;
  const IDLE_BUDGET_MS = 8;
  const IDLE_FALLBACK_DELAY_MS = 100;
  let observedShadowRoots = new WeakSet();
  let shadowWalkQueue = [];
  let shadowWalker = null;
  let shadowScanHandle = null;


  // Overlay styles, parsed once and shared by every shadow root in this frame.
  let controllerStyleSheet = null;
  let controllerStyleHref = null;

  // The context menu lives in a shadow root, so it cannot be found by querying
  // the document.
  let contextMenu = null;

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

    debug('Video Speed Pro: Extension context invalidated, cleaning up');

    stopTimeTracking();
    if (domObserver) domObserver.disconnect();
    stopUrlPoll();

    // Clear auto-hide timers
    autoHideTimers.forEach(timer => clearTimeout(timer));
    autoHideTimers.clear();

    // Remove all controllers and media-bound listeners from the page.
    [...mediaElements.keys()].forEach(detachController);
    audioContextMap.clear();
    if (dragListenersBound) {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      dragListenersBound = false;
    }

    // Reset state
    activeElement = null;
    extensionActive = false;
    window.vscInitialized = false;
  }

  // Initialize
  // Ad and tracking iframes make up most of the frames on a busy page and never
  // hold media worth controlling. Skipping them avoids two message round-trips,
  // a stylesheet fetch, and an observer per frame. Zero dimensions mean "not
  // laid out yet" rather than "small", so only frames actually measured as small
  // are skipped -- the same distinction attachController draws for tiny videos.
  function isNegligibleFrame() {
    if (window === window.top) return false;
    const { innerWidth: width, innerHeight: height } = window;
    if (!width || !height) return false;
    return width < MIN_FRAME_DIMENSION || height < MIN_FRAME_DIMENSION;
  }

  // A skipped frame can still be resized into a real player (expanding embeds,
  // lightboxes), so watch for that instead of opting out permanently.
  function waitForFrameToGrow() {
    if (frameGrowthWatched) return;
    frameGrowthWatched = true;

    const onResize = () => {
      if (isNegligibleFrame()) return;
      window.removeEventListener('resize', onResize);
      frameGrowthWatched = false;
      debug('Video Speed Pro: Frame grew, initializing');
      init();
    };
    window.addEventListener('resize', onResize, { passive: true });
  }

  async function init() {
    debug('Video Speed Pro: Starting initialization...');

    // Check if extension context is valid
    if (!isContextValid()) {
      debug('Video Speed Pro: Extension context not available');
      return;
    }

    if (isNegligibleFrame()) {
      debug('Video Speed Pro: Skipping negligible frame', window.innerWidth, 'x', window.innerHeight);
      waitForFrameToGrow();
      return;
    }

    try {
      if (!messageListenerBound) {
        chrome.runtime.onMessage.addListener(handleMessage);
        messageListenerBound = true;
      }
    } catch (e) {
      if (e.message?.includes('Extension context invalidated')) handleContextInvalidated();
      return;
    }

    settings = await sendMessage({ type: 'getSettings' });
    if (!settings || Object.keys(settings).length === 0) {
      console.warn('Video Speed Pro: Failed to load settings, using safe defaults');
      settings = {
        enabled: true,
        hideByDefault: false,
        rememberSpeed: true,
        workOnAudio: false,
        preservePitch: true,
        opacity: 0.8,
        autoHideDelay: 0,
        controllerMode: 'minimal',
        shortcuts: []
      };
    }

    setupKeyboardListener();
    setupContextMenu();
    startUrlChangeDetection();

    // Check if site is blocked
    const blockCheck = await sendMessage({ type: 'checkSiteAccess', url: window.location.href });
    if (settings.enabled === false || blockCheck?.blocked) {
      isBlocked = true;
      debug('Video Speed Pro: Disabled on this site -', blockCheck?.reason || 'disabled');
      return;
    }

    await activateExtension();
    debug('Video Speed Pro: Initialized');
  }

  async function activateExtension() {
    if (extensionActive || contextInvalidated) return;
    extensionActive = true;
    isBlocked = false;

    // Load intro/outro settings
    introOutroSettings = await sendMessage({
      type: 'getIntroOutroSettings',
      hostname: window.location.hostname
    });

    // Load saved filters
    await loadSavedFilters();

    // Load saved volume boost
    await loadSavedVolumeBoost();

    // Styles first: overlays adopt the sheet at creation time, so having it
    // ready before any controller exists avoids a flash of unstyled overlay.
    await loadControllerStyles();

    // Observer next: it has to exist before the scan so shadow roots found
    // during the scan can be registered against it, and so media added while
    // the scan runs is not missed.
    setupObserver();

    // Find existing media elements
    findMediaElements();

    reportMediaState();
  }

  function deactivateExtension() {
    if (!extensionActive) return;
    extensionActive = false;
    isBlocked = true;
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }
    observedShadowRoots = new WeakSet();
    cancelShadowScans();
    [...mediaElements.keys()].forEach(detachController);
    stopTimeTracking();
    removePipIndicator();
    closeContextMenu();
    reportMediaState();
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
        handleSettingsUpdated(message.settings).catch(error => {
          console.error('Video Speed Pro: Could not apply updated settings', error);
        });
        break;
      case 'command':
        handleCommand(message.command);
        break;
      case 'setSpeed':
        // Set speed from popup presets
        if (!activeElement) activeElement = findActiveMedia();
        if (activeElement) {
          setSpeed(activeElement, message.speed);
          sendResponse?.({ success: true, speed: activeElement.playbackRate });
        } else {
          sendResponse?.({ success: false, error: 'No active media found' });
        }
        break;
      case 'getActiveState': {
        if (!activeElement) activeElement = findActiveMedia();
        sendResponse?.(activeElement && !isBlocked ? {
          found: true,
          speed: activeElement.playbackRate,
          paused: activeElement.paused
        } : { found: false });
        break;
      }
    }
  }

  async function handleSettingsUpdated(nextSettings) {
    settings = nextSettings || settings;
    const access = await sendMessage({ type: 'checkSiteAccess', url: window.location.href });
    if (settings.enabled === false || access?.blocked) {
      deactivateExtension();
      return;
    }

    if (!extensionActive) {
      await activateExtension();
      return;
    }

    if (!settings.workOnAudio) {
      [...mediaElements.keys()]
        .filter(media => media.tagName === 'AUDIO')
        .forEach(detachController);
    }
    findMediaElements();
    updateAllControllers();
    reloadIntroOutroSettings();
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

  // Find all media elements on page (including shadow DOM)
  function findMediaElements() {
    // Media is found immediately; hunting for shadow hosts is deferred, because
    // it is the part that scales with total page size rather than media count.
    scanMedia(document);
    queueShadowWalk(document);
  }

  // Attach to media directly inside a tree. Cheap: one selector query, no
  // element-by-element walk, so this is safe to run on every mutation.
  function scanMedia(root) {
    if (!root) return;
    const selector = settings.workOnAudio ? 'video, audio' : 'video';

    if (root.nodeType === Node.ELEMENT_NODE && isMediaElement(root)) attachController(root);

    const media = root.querySelectorAll?.(selector);
    if (media?.length) {
      debug(`Video Speed Pro: Found ${media.length} media element(s)`);
      media.forEach(el => attachController(el));
    }
  }

  // Watch a shadow root. Each shadow root is its own tree, so an observer on
  // document.body never sees inside one; every root needs its own observe()
  // call. MutationObserver supports many targets per instance, and disconnect()
  // clears them all together.
  function registerShadowRoot(root) {
    if (!root || observedShadowRoots.has(root)) return false;
    observedShadowRoots.add(root);
    domObserver?.observe(root, { childList: true, subtree: true });
    debug('Video Speed Pro: Observing shadow root');
    return true;
  }

  function scheduleIdle(callback) {
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
      return { cancel: () => cancelIdleCallback(id) };
    }
    // Hand the fallback the same deadline shape so callers need only one path.
    const id = setTimeout(() => {
      const started = Date.now();
      callback({ timeRemaining: () => Math.max(0, IDLE_BUDGET_MS - (Date.now() - started)) });
    }, IDLE_FALLBACK_DELAY_MS);
    return { cancel: () => clearTimeout(id) };
  }

  // Queue a tree to be searched for shadow hosts. Finding a host means visiting
  // every element, since no selector crosses a shadow boundary, so the search
  // runs in idle slices instead of blocking on a whole document at once.
  function queueShadowWalk(root) {
    if (!root || contextInvalidated) return;
    shadowWalkQueue.push(root);
    startShadowScanPump();
  }

  function startShadowScanPump() {
    if (shadowScanHandle || contextInvalidated) return;
    if (!shadowWalker && shadowWalkQueue.length === 0) return;
    shadowScanHandle = scheduleIdle(pumpShadowScan);
  }

  // Register a host's shadow root and queue that root for its own walk, so
  // nesting is handled by this pump rather than by unbounded recursion.
  function collectShadowRoot(node) {
    const shadow = node.shadowRoot;
    if (!shadow || !registerShadowRoot(shadow)) return;
    scanMedia(shadow);
    shadowWalkQueue.push(shadow);
  }

  function pumpShadowScan(deadline) {
    shadowScanHandle = null;
    if (contextInvalidated || !extensionActive) return;

    let untilDeadlineCheck = SHADOW_SCAN_BATCH;

    while (shadowWalker || shadowWalkQueue.length > 0) {
      if (!shadowWalker) {
        const root = shadowWalkQueue.shift();
        if (!root) continue;
        if (root.nodeType === Node.ELEMENT_NODE && !root.isConnected) continue;
        // createTreeWalker never yields its own root, so test it directly.
        if (root.nodeType === Node.ELEMENT_NODE) collectShadowRoot(root);
        shadowWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      }

      let node = shadowWalker.nextNode();
      while (node) {
        collectShadowRoot(node);

        if (--untilDeadlineCheck <= 0) {
          untilDeadlineCheck = SHADOW_SCAN_BATCH;
          if (deadline.timeRemaining() <= 0) {
            // Out of budget. The walker holds our position, so the next slice
            // resumes exactly here instead of restarting the tree.
            startShadowScanPump();
            return;
          }
        }
        node = shadowWalker.nextNode();
      }

      shadowWalker = null;
    }
  }

  function cancelShadowScans() {
    shadowScanHandle?.cancel();
    shadowScanHandle = null;
    shadowWalkQueue = [];
    shadowWalker = null;
  }

  // Drop controllers for media that left the document. One sweep per mutation
  // batch: mediaElements is small, and unlike walking the removed subtree this
  // also catches media removed from inside a shadow root.
  function detachDisconnectedMedia() {
    for (const media of [...mediaElements.keys()]) {
      if (!media.isConnected) detachController(media);
    }
  }

  // Set up mutation observer for dynamic content
  function setupObserver() {
    const observerCallback = (mutations) => {
      let sawRemoval = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          scanMedia(node);
          queueShadowWalk(node);
        }
        if (mutation.removedNodes.length > 0) sawRemoval = true;
      }

      // A DOM move emits both a removal and an addition, and the callback runs
      // after both are applied, so isConnected already tells moves apart from
      // real removals.
      if (sawRemoval) detachDisconnectedMedia();
    };

    if (domObserver) domObserver.disconnect();
    // disconnect() drops every target, shadow roots included, so they have to be
    // rediscovered and re-observed against the new instance.
    observedShadowRoots = new WeakSet();
    cancelShadowScans();
    domObserver = new MutationObserver(observerCallback);

    // Observe document.body if available, otherwise wait for it
    if (document.body) {
      domObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
      debug('Video Speed Pro: MutationObserver started');
    } else {
      // Wait for body to be available
      const bodyObserver = new MutationObserver(() => {
        if (document.body) {
          bodyObserver.disconnect();
          domObserver.observe(document.body, {
            childList: true,
            subtree: true
          });
          debug('Video Speed Pro: MutationObserver started (delayed)');
          // Also search for any videos that appeared before observer was set up
          findMediaElements();
        }
      });
      bodyObserver.observe(document.documentElement, { childList: true });
    }
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

    // Skip if media is not connected to the DOM
    if (!media.isConnected) {
      debug('Video Speed Pro: Skipping disconnected media element');
      return;
    }

    // Skip tiny videos (likely ads or tracking pixels)
    // But only if the video has actually loaded and we know its size
    if (media.tagName === 'VIDEO') {
      const width = media.offsetWidth || media.clientWidth || media.videoWidth;
      const height = media.offsetHeight || media.clientHeight || media.videoHeight;
      
      // Only skip if video is loaded (has dimensions) AND is tiny
      if (width > 0 && height > 0 && width < 100 && height < 100) {
        debug('Video Speed Pro: Skipping tiny video', width, 'x', height);
        return;
      }
      
      // If video has zero dimensions, it might not be loaded yet
      // Wait for loadedmetadata event to try again
      if (width === 0 && height === 0 && !media._vscWaitingForLoad) {
        media._vscWaitingForLoad = true;
        debug('Video Speed Pro: Video has no dimensions, waiting for load...');
        media.addEventListener('loadedmetadata', () => {
          media._vscWaitingForLoad = false;
          attachController(media);
        }, { once: true });
        // Also try after a short delay in case loadedmetadata already fired
        setTimeout(() => {
          if (!mediaElements.has(media)) {
            media._vscWaitingForLoad = false;
            attachController(media);
          }
        }, 500);
        return;
      }
    }

    // Apply pitch preference before UI is created
    applyPreservePitchSetting(media);

    let controller;
    try {
      controller = createController(media);
    } catch (e) {
      console.error('Video Speed Pro: Failed to create controller', e);
      return;
    }
    
    if (!controller) {
      console.warn('Video Speed Pro: Controller creation returned null');
      return;
    }
    
    mediaElements.set(media, controller);

    // Set initial speed if remembered
    applyInitialSpeed(media);

    // Track active element on play
    const handlePlay = () => {
      activeElement = media;
      startTimeTracking();
      reportMediaState();
    };
    const handlePause = () => {
      if (![...mediaElements.keys()].some(element => !element.paused && !element.ended)) stopTimeTracking();
      reportMediaState();
    };

    // Update controller when speed changes externally, and take the speed back
    // if the site reset it out from under us.
    const handleRateChange = () => {
      enforceDesiredSpeed(media);
      updateControllerDisplay(media);
      updatePipIndicator();
    };
    media.addEventListener('play', handlePlay);
    media.addEventListener('pause', handlePause);
    media.addEventListener('ended', handlePause);
    media.addEventListener('ratechange', handleRateChange);
    media._vscCoreListeners = { handlePlay, handlePause, handleRateChange };
    if (!media.paused && !media.ended) startTimeTracking();

    // Update controller position when video resizes
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        updateControllerPosition(media);
      });
      resizeObserver.observe(media);
      // Store reference for cleanup
      media._vscResizeObserver = resizeObserver;
    }

    // Set up Picture-in-Picture support
    if (media.tagName === 'VIDEO') {
      setupPipSupport(media);
    }

    // Set up intro/outro skip
    setupIntroOutroSkip(media);

    // Apply video filters if saved
    if (media.tagName === 'VIDEO') {
      applyVideoFilters(media);
    }

    // Apply volume boost if saved
    if (volumeBoostLevel > 100) {
      applyVolumeBoostToMedia(media);
      updateVolumeBoostDisplay(media);
    }

    // Initialize auto-hide timer if enabled and controller is visible
    if (settings.autoHideDelay > 0 && !settings.hideByDefault) {
      resetAutoHide(controller);
    }

    reportMediaState();
    debug('Video Speed Pro: Attached to', media.tagName);
  }

  // Detach controller from media element
  function detachController(media) {
    const controller = mediaElements.get(media);
    if (controller) {
      const timer = autoHideTimers.get(controller);
      if (timer) clearTimeout(timer);
      autoHideTimers.delete(controller);
      removeOverlay(controller);
      mediaElements.delete(media);
    }
    if (activeElement === media) {
      activeElement = null;
    }
    // Clean up resize observer
    if (media._vscResizeObserver) {
      media._vscResizeObserver.disconnect();
      delete media._vscResizeObserver;
    }
    if (media._vscCoreListeners) {
      const { handlePlay, handlePause, handleRateChange } = media._vscCoreListeners;
      media.removeEventListener('play', handlePlay);
      media.removeEventListener('pause', handlePause);
      media.removeEventListener('ended', handlePause);
      media.removeEventListener('ratechange', handleRateChange);
      delete media._vscCoreListeners;
    }
    cleanupIntroOutroListeners(media);
    cleanupPipListeners(media);
    if (media._abLoopHandler) {
      media.removeEventListener('timeupdate', media._abLoopHandler);
      delete media._abLoopHandler;
    }
    abLoopState.delete(media);
    cleanupVolumeBoostForMedia(media);
    delete media._vscDesiredSpeed;
    delete media._vscReassertUntil;
    delete media._vscCorrectionStart;
    delete media._vscCorrectionCount;
    delete media._vscEnforceCooldownUntil;
    if (mediaElements.size === 0) stopTimeTracking();
    reportMediaState();
  }

  // Load the overlay stylesheet once per frame and share the parsed sheet across
  // every shadow root. Awaited before the first scan, so no overlay is ever
  // rendered unstyled.
  async function loadControllerStyles() {
    if (controllerStyleSheet !== null || controllerStyleHref) return;
    const href = chrome.runtime.getURL('content/controller.css');
    try {
      const response = await fetch(href);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(await response.text());
      controllerStyleSheet = sheet;
    } catch (e) {
      // A strict page CSP can block the fetch. A <link> per root still works
      // because the browser, not the page, resolves it.
      debug('Video Speed Pro: Falling back to linked styles', e);
      controllerStyleHref = href;
    }
  }

  // Build a page-DOM host with a closed shadow root holding our styles. The host
  // is a transparent full-bleed layer, so overlays inside it position themselves
  // exactly as they did when these styles were injected into the document.
  function createShadowHost({ fixed = false, role = null } = {}) {
    const host = document.createElement('div');
    // The role class is the only thing about an overlay visible from the page
    // DOM once its contents are behind a closed root; it keeps the overlays
    // identifiable for debugging and for the manual test page's counter.
    host.className = ['vsc-shadow-host', fixed && 'vsc-host-fixed', role && `vsc-host-${role}`]
      .filter(Boolean).join(' ');
    // These must survive hostile page CSS. A plain inline declaration is not
    // enough: an author rule marked !important outranks it, and pages really do
    // ship things like `div { position: static !important }`. Inline !important
    // is the only tier above that, and :host rules lose to page rules outright.
    host.style.setProperty('position', fixed ? 'fixed' : 'absolute', 'important');
    host.style.setProperty('inset', '0', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');
    host.style.setProperty('display', 'block', 'important');

    const root = host.attachShadow({ mode: 'closed' });
    if (controllerStyleSheet) {
      root.adoptedStyleSheets = [controllerStyleSheet];
    } else if (controllerStyleHref) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = controllerStyleHref;
      root.append(link);
    }

    host._vscRoot = root;
    return { host, root };
  }

  // Overlays are stored as their inner element, so every existing query against
  // them keeps working; the host is reachable for positioning and removal.
  function hostOf(element) {
    return element?._vscHost || null;
  }

  function removeOverlay(element) {
    (hostOf(element) || element)?.remove();
  }

  // Create controller UI
  function createController(media) {
    const { host, root } = createShadowHost({ role: 'controller' });
    const controller = document.createElement('div');
    controller.className = 'vsc-controller';
    controller._vscHost = host;
    host._vscController = controller;
    root.append(controller);

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
    positionController(media, host, controller);

    return controller;
  }

  // Create minimal mode UI (badge with +/- controls)
  function createMinimalUI(speed) {
    return `
      <div class="vsc-badge-wrapper">
        <button type="button" class="vsc-mini-btn vsc-mini-decrease" data-action="decrease" aria-label="Decrease playback speed">−</button>
        <div class="vsc-badge" aria-live="polite">${speed.toFixed(2)}x</div>
        <button type="button" class="vsc-mini-btn vsc-mini-increase" data-action="increase" aria-label="Increase playback speed">+</button>
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

    const loopState = abLoopState.get(media);
    const loopText = loopState && loopState.active 
      ? `${formatTime(loopState.pointA)} → ${formatTime(loopState.pointB)}`
      : 'Not set';
    const loopActive = loopState && loopState.active ? 'active' : '';

    return `
      <div class="vsc-panel">
        <div class="vsc-panel-header">
          <span class="vsc-panel-title">Speed</span>
          <span class="vsc-speed-display">${speed.toFixed(2)}x</span>
        </div>
        <div class="vsc-controls">
          <button type="button" class="vsc-btn vsc-btn-decrease" data-action="decrease" aria-label="Decrease playback speed">−</button>
          <button type="button" class="vsc-btn vsc-btn-reset" data-action="reset" aria-label="Reset playback speed">1x</button>
          <button type="button" class="vsc-btn vsc-btn-increase" data-action="increase" aria-label="Increase playback speed">+</button>
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
        
        <!-- A-B Loop Controls -->
        <div class="vsc-loop-section">
          <div class="vsc-section-header">
            <span class="vsc-section-title">A-B Loop</span>
            <span class="vsc-loop-indicator ${loopActive}">${loopText}</span>
          </div>
          <div class="vsc-loop-controls">
            <button class="vsc-loop-btn ${loopState?.pointA !== null ? 'set' : ''}" data-action="set-loop-a" title="Set loop start (A)">A</button>
            <button class="vsc-loop-btn ${loopState?.pointB !== null ? 'set' : ''}" data-action="set-loop-b" title="Set loop end (B)">B</button>
            <button class="vsc-loop-btn vsc-loop-clear" data-action="clear-loop" title="Clear loop">✕</button>
          </div>
        </div>

        <!-- Volume Boost -->
        <div class="vsc-volume-section">
          <div class="vsc-section-header">
            <span class="vsc-section-title">Volume Boost</span>
            <span class="vsc-volume-value ${volumeBoostLevel > 100 ? 'boosted' : ''}">${volumeBoostLevel}%</span>
          </div>
          <div class="vsc-volume-slider-container">
            <input type="range" class="vsc-slider vsc-volume-slider" data-action="volume-boost" aria-label="Volume boost" min="100" max="${VOLUME_BOOST_MAX}" step="10" value="${volumeBoostLevel}">
          </div>
        </div>

        <!-- Video Filters -->
        <div class="vsc-filters-section">
          <div class="vsc-section-header">
            <span class="vsc-section-title">Filters</span>
            <button class="vsc-filter-reset" data-action="reset-filters" title="Reset filters">⟲</button>
          </div>
          <div class="vsc-filter-row">
            <span class="vsc-filter-label">☀</span>
            <input type="range" class="vsc-slider vsc-filter-slider" data-filter="brightness" aria-label="Video brightness" min="0" max="200" value="${videoFilters.brightness}">
            <span class="vsc-filter-value vsc-brightness-value">${videoFilters.brightness}%</span>
          </div>
          <div class="vsc-filter-row">
            <span class="vsc-filter-label">◐</span>
            <input type="range" class="vsc-slider vsc-filter-slider" data-filter="contrast" aria-label="Video contrast" min="0" max="200" value="${videoFilters.contrast}">
            <span class="vsc-filter-value vsc-contrast-value">${videoFilters.contrast}%</span>
          </div>
          <div class="vsc-filter-row">
            <span class="vsc-filter-label">🎨</span>
            <input type="range" class="vsc-slider vsc-filter-slider" data-filter="saturation" aria-label="Video saturation" min="0" max="200" value="${videoFilters.saturation}">
            <span class="vsc-filter-value vsc-saturation-value">${videoFilters.saturation}%</span>
          </div>
        </div>

        <!-- Screenshot -->
        <div class="vsc-screenshot-section">
          <button class="vsc-screenshot-btn" data-action="screenshot" title="Capture screenshot (P)">
            <span class="vsc-screenshot-icon">📷</span>
            <span>Screenshot</span>
          </button>
        </div>
      </div>
    `;
  }

  // Position controller relative to video
  function positionController(media, host, controller) {
    // If media has no parent (not in DOM), we can't position the controller
    if (!media.parentElement) {
      console.warn('Video Speed Pro: Media element has no parent, cannot attach controller');
      return;
    }

    // Check if we already have a wrapper for this video
    if (media.parentElement.classList.contains('vsc-wrapper')) {
      media.parentElement.appendChild(host);
      debug('Video Speed Pro: Controller attached to existing wrapper');
      return;
    }

    // Special handling for YouTube - find the movie_player container
    if (isYouTube()) {
      const ytContainer = media.closest('#movie_player') || 
                          media.closest('.html5-video-player') ||
                          media.closest('ytd-player');
      if (ytContainer) {
        // Ensure the container is positioned
        const style = window.getComputedStyle(ytContainer);
        if (style.position === 'static') {
          ytContainer.style.position = 'relative';
        }
        ytContainer.appendChild(host);
        debug('Video Speed Pro: Controller attached to YouTube player');
        return;
      }
    }
    
    // Strategy: Find the best container for the controller
    // 1. Look for a positioned container that tightly wraps the video
    // 2. If found and it's close to the video's size, use it
    // 3. Otherwise, create a minimal wrapper
    
    const videoRect = media.getBoundingClientRect();
    let container = media.parentElement;
    let bestContainer = null;
    
    // Walk up the tree looking for a positioned parent that's a good fit
    while (container && container !== document.body) {
      const style = window.getComputedStyle(container);
      if (style.position !== 'static') {
        const containerRect = container.getBoundingClientRect();
        // Check if this container is close to the video's size (within 50px)
        // This helps find the actual video wrapper vs a page-wide container
        const widthDiff = Math.abs(containerRect.width - videoRect.width);
        const heightDiff = Math.abs(containerRect.height - videoRect.height);
        
        if (widthDiff < 100 && heightDiff < 100) {
          bestContainer = container;
          break;
        }
        
        // Keep looking for a better fit, but remember the first positioned parent
        if (!bestContainer) {
          bestContainer = container;
        }
      }
      container = container.parentElement;
    }
    
    // If we found a good positioned container, use it
    if (bestContainer) {
      const containerRect = bestContainer.getBoundingClientRect();
      const widthDiff = Math.abs(containerRect.width - videoRect.width);
      const heightDiff = Math.abs(containerRect.height - videoRect.height);
      
      // If container is close to video size, just append the controller
      if (widthDiff < 100 && heightDiff < 100) {
        bestContainer.appendChild(host);
        debug('Video Speed Pro: Controller attached to positioned container');
        return;
      }
      
      // Container is larger than video - need to position controller relative to video
      // Calculate video's position within the container
      const videoTop = videoRect.top - containerRect.top;
      const videoRight = containerRect.right - videoRect.right;
      
      controller.style.top = (videoTop + 10) + 'px';
      controller.style.right = (videoRight + 10) + 'px';
      bestContainer.appendChild(host);
      debug('Video Speed Pro: Controller attached with offset positioning');
      return;
    }
    
    // No suitable positioned container found - create a minimal wrapper
    // Use a wrapper that doesn't affect layout
    const wrapper = document.createElement('div');
    wrapper.className = 'vsc-wrapper';

    // 'display: contents' makes the wrapper invisible to layout
    // But we need position:relative for the controller, so use a fallback
    // Check if display:contents is supported
    const supportsContents = CSS.supports('display', 'contents');
    let wrapperDisplay = 'contents';

    if (!supportsContents) {
      // Fallback: match the video's display
      const display = window.getComputedStyle(media).display;
      wrapperDisplay = (display === 'inline' || display === 'inline-block') ? 'inline-block' : 'block';
    }

    // The wrapper stays in the page DOM, so it is the one part of the overlay a
    // page can still restyle. It is also what the host positions against, so
    // pin it the same way the host pins itself.
    wrapper.style.setProperty('position', 'relative', 'important');
    wrapper.style.setProperty('display', wrapperDisplay, 'important');
    
    // Check if parent still exists before modifying DOM
    if (media.parentElement) {
      media.parentElement.insertBefore(wrapper, media);
      wrapper.appendChild(media);
      wrapper.appendChild(host);
      debug('Video Speed Pro: Controller wrapped and attached');
    } else {
      console.warn('Video Speed Pro: Media parent disappeared during positioning');
    }
  }
  
  // Update controller position when video moves/resizes
  function updateControllerPosition(media) {
    const controller = mediaElements.get(media);
    const host = hostOf(controller);
    if (!host || !host.parentElement) return;

    // Skip if controller is in a wrapper (position is already correct)
    if (host.parentElement.classList.contains('vsc-wrapper')) return;

    const container = host.parentElement;
    const containerRect = container.getBoundingClientRect();
    const videoRect = media.getBoundingClientRect();
    
    // Recalculate position
    const videoTop = videoRect.top - containerRect.top;
    const videoRight = containerRect.right - videoRect.right;
    
    controller.style.top = (videoTop + 10) + 'px';
    controller.style.right = (videoRight + 10) + 'px';
  }

  // Make element draggable
  function ensureGlobalDragListeners() {
    if (dragListenersBound) return;
    dragListenersBound = true;
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }

  function handleDragMove(e) {
    if (!dragState) return;

    const { element, startX, startY, initialX, initialY } = dragState;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    element.style.position = 'fixed';
    element.style.left = (initialX + deltaX) + 'px';
    element.style.top = (initialY + deltaY) + 'px';
  }

  function handleDragEnd() {
    if (!dragState) return;
    dragState.element.style.cursor = 'grab';
    dragState = null;
  }

  function makeDraggable(element) {
    element.style.cursor = 'grab';
    element.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      ensureGlobalDragListeners();

      const rect = element.getBoundingClientRect();
      dragState = {
        element,
        startX: e.clientX,
        startY: e.clientY,
        initialX: rect.left,
        initialY: rect.top
      };

      element.style.cursor = 'grabbing';
      e.preventDefault();
    });
  }

  // Attach event listeners to controller buttons
  function attachControllerEvents(controller, media) {
    if (controller._vscEventsBound) return;
    controller._vscEventsBound = true;

    controller.addEventListener('click', (e) => {
      // Always stop propagation to prevent video play/pause
      e.stopPropagation();
      e.preventDefault();
      
      const target = e.target;
      const action = target.dataset.action || target.closest('[data-action]')?.dataset.action;

      if (action === 'increase') {
        changeSpeed(media, 0.1);
      } else if (action === 'decrease') {
        changeSpeed(media, -0.1);
      } else if (action === 'reset') {
        setSpeed(media, 1.0);
      } else if (action === 'toggle-pitch') {
        togglePitchCorrection(media, target);
      } else if (target.dataset.speed) {
        setSpeed(media, parseFloat(target.dataset.speed));
      } else if (target.dataset.seek) {
        seekMedia(media, parseInt(target.dataset.seek));
      } else if (target.dataset.frame) {
        stepFrame(media, target.dataset.frame === 'forward');
      }
      // A-B Loop actions
      else if (action === 'set-loop-a') {
        setPointA(media);
      } else if (action === 'set-loop-b') {
        setPointB(media);
      } else if (action === 'clear-loop') {
        clearABLoop(media);
      }
      // Filter actions
      else if (action === 'reset-filters') {
        resetFilters(media);
      }
      // Screenshot action
      else if (action === 'screenshot') {
        captureScreenshot(media);
      }

      // Reset auto-hide on interaction
      resetAutoHide(controller);
    });

    // Filter sliders input
    controller.addEventListener('input', (e) => {
      e.stopPropagation();
      const target = e.target;
      
      // Volume boost slider
      if (target.dataset.action === 'volume-boost') {
        setVolumeBoost(media, parseInt(target.value));
      }
      // Filter sliders
      else if (target.dataset.filter === 'brightness') {
        setBrightness(media, parseInt(target.value));
      } else if (target.dataset.filter === 'contrast') {
        setContrast(media, parseInt(target.value));
      } else if (target.dataset.filter === 'saturation') {
        setSaturation(media, parseInt(target.value));
      }

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

  // Write a rate without recording it as the user's intent.
  function applyPlaybackRate(media, speed) {
    try {
      media.playbackRate = speed;
      return true;
    } catch (e) {
      debug('Video Speed Pro: Media rejected playback rate', speed, e);
      return false;
    }
  }

  // Record the speed the user asked for. The write below fires ratechange, which
  // enforceDesiredSpeed uses to notice when the site overwrites us afterwards.
  function setDesiredSpeed(media, speed) {
    const now = Date.now();
    media._vscDesiredSpeed = speed;
    media._vscReassertUntil = now + SPEED_REASSERT_WINDOW_MS;
    media._vscCorrectionStart = now;
    media._vscCorrectionCount = 0;
    media._vscEnforceCooldownUntil = 0;
  }

  // Re-apply the user's speed when something else changed it. Re-entry is safe:
  // a successful correction leaves playbackRate at the desired value, so the
  // ratechange it triggers exits at the equality check below.
  function enforceDesiredSpeed(media) {
    const desired = media._vscDesiredSpeed;
    if (typeof desired !== 'number') return;
    if (Math.abs(media.playbackRate - desired) < SPEED_EPSILON) return;

    const now = Date.now();
    // Force mode defends the speed indefinitely. Otherwise only defend the rate
    // we just set, so the site's own speed menu keeps working.
    if (!settings?.forceSpeed && now >= (media._vscReassertUntil || 0)) return;
    if (now < (media._vscEnforceCooldownUntil || 0)) return;

    if (now - (media._vscCorrectionStart || 0) > SPEED_CORRECTION_WINDOW_MS) {
      media._vscCorrectionStart = now;
      media._vscCorrectionCount = 0;
    }

    media._vscCorrectionCount = (media._vscCorrectionCount || 0) + 1;
    if (media._vscCorrectionCount > SPEED_CORRECTION_LIMIT) {
      // Either the page rewrites the rate faster than we can correct it, or the
      // media clamps our value and never reaches it. Back off instead of
      // spinning on ratechange.
      media._vscEnforceCooldownUntil = now + SPEED_CORRECTION_COOLDOWN_MS;
      debug('Video Speed Pro: Backing off speed enforcement at', desired);
      return;
    }

    applyPlaybackRate(media, desired);
  }

  // Set playback speed
  function setSpeed(media, speed) {
    speed = Number(speed);
    if (!Number.isFinite(speed)) return;
    speed = Math.round(Math.max(0.1, Math.min(16, speed)) * 100) / 100;

    // Record intent before writing so the resulting ratechange is not mistaken
    // for the site fighting us.
    setDesiredSpeed(media, speed);
    applyPlaybackRate(media, speed);

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
  
  // Check if current site is YouTube
  function isYouTube() {
    return window.location.hostname.includes('youtube.com') || 
           window.location.hostname.includes('youtu.be');
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
    cleanupIntroOutroListeners(media);
    if (!introOutroSettings || !introOutroSettings.enabled) return;

    const listeners = {};

    // Auto-skip intro when video starts playing
    if (introOutroSettings.autoSkipIntro && introOutroSettings.introSkip > 0) {
      listeners.play = () => {
        // Only skip if we haven't already skipped for this video session
        // and we're at the beginning of the video
        if (!introSkippedVideos.has(media) && media.currentTime < 2) {
          skipIntro(media);
        }
      };
      media.addEventListener('play', listeners.play);

      // Also handle loadedmetadata for autoplay videos
      listeners.loadedmetadata = () => {
        if (introOutroSettings.autoSkipIntro && !introSkippedVideos.has(media) && !media.paused && media.currentTime < 2) {
          skipIntro(media);
        }
      };
      media.addEventListener('loadedmetadata', listeners.loadedmetadata);
    }

    // Set up outro detection using timeupdate
    if (introOutroSettings.outroSkip > 0) {
      listeners.timeupdate = () => {
        checkOutroSkip(media);
      };
      media.addEventListener('timeupdate', listeners.timeupdate);
    }
    media._vscIntroOutroListeners = listeners;
  }

  function cleanupIntroOutroListeners(media) {
    const listeners = media._vscIntroOutroListeners;
    if (!listeners) return;
    if (listeners.play) media.removeEventListener('play', listeners.play);
    if (listeners.loadedmetadata) media.removeEventListener('loadedmetadata', listeners.loadedmetadata);
    if (listeners.timeupdate) media.removeEventListener('timeupdate', listeners.timeupdate);
    delete media._vscIntroOutroListeners;
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
    debug(`Video Speed Pro: Skipped intro to ${skipTo}s`);
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
    debug(`Video Speed Pro: Skipped outro to ${skipTo.toFixed(1)}s`);
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
      debug(`Video Speed Pro: Auto-skipped outro at ${introOutroSettings.outroSkip}s remaining`);
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
    const anchor = hostOf(mediaElements.get(media));
    const { host, root } = createShadowHost({ fixed: !anchor?.parentNode, role: 'feedback' });
    root.append(feedback);
    feedback._vscHost = host;
    (anchor?.parentNode || document.body).appendChild(host);

    // Animate and remove
    requestAnimationFrame(() => {
      feedback.classList.add('vsc-show');
    });

    setTimeout(() => {
      feedback.classList.remove('vsc-show');
      setTimeout(() => removeOverlay(feedback), 300);
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
    mediaElements.forEach((_controller, media) => setupIntroOutroSkip(media));
    debug('Video Speed Pro: Intro/Outro settings reloaded', introOutroSettings);
  }

  // ==========================================
  // SCREENSHOT CAPTURE
  // ==========================================

  // Capture screenshot of current video frame
  function captureScreenshot(media) {
    if (!media || media.tagName !== 'VIDEO') {
      showFeedback(media, 'Screenshot', 'Video only');
      return;
    }

    if (media.readyState < 2) {
      showFeedback(media, 'Screenshot', 'Video not ready');
      return;
    }

    try {
      // Create canvas with video dimensions
      const canvas = document.createElement('canvas');
      canvas.width = media.videoWidth || media.clientWidth;
      canvas.height = media.videoHeight || media.clientHeight;

      // Draw current frame to canvas
      const ctx = canvas.getContext('2d');
      ctx.drawImage(media, 0, 0, canvas.width, canvas.height);

      // Convert to blob and download
      canvas.toBlob((blob) => {
        if (!blob) {
          showFeedback(media, 'Screenshot', 'Failed');
          return;
        }

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `screenshot-${timestamp}.png`;

        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showFeedback(media, 'Screenshot', 'Saved!');
        debug('Video Speed Pro: Screenshot captured', filename);
      }, 'image/png', 1.0);
    } catch (e) {
      console.error('Video Speed Pro: Screenshot failed', e);
      showFeedback(media, 'Screenshot', 'Error');
    }
  }

  // ==========================================
  // A-B LOOP
  // ==========================================

  // Set point A (loop start)
  function setPointA(media) {
    if (!media) return;

    const state = abLoopState.get(media) || { pointA: null, pointB: null, active: false };
    state.pointA = media.currentTime;
    abLoopState.set(media, state);

    showFeedback(media, 'Loop A', formatTime(state.pointA));
    updateControllerLoopDisplay(media);
    debug('Video Speed Pro: Set loop point A at', state.pointA);

    // If both points are set, activate the loop
    if (state.pointA !== null && state.pointB !== null && state.pointA < state.pointB) {
      state.active = true;
      startABLoop(media);
    }
  }

  // Set point B (loop end)
  function setPointB(media) {
    if (!media) return;

    const state = abLoopState.get(media) || { pointA: null, pointB: null, active: false };
    state.pointB = media.currentTime;
    abLoopState.set(media, state);

    showFeedback(media, 'Loop B', formatTime(state.pointB));
    updateControllerLoopDisplay(media);
    debug('Video Speed Pro: Set loop point B at', state.pointB);

    // If both points are set and A < B, activate the loop
    if (state.pointA !== null && state.pointB !== null && state.pointA < state.pointB) {
      state.active = true;
      startABLoop(media);
    }
  }

  // Start A-B loop monitoring
  function startABLoop(media) {
    const handler = () => {
      const state = abLoopState.get(media);
      if (!state || !state.active) return;

      if (media.currentTime >= state.pointB) {
        media.currentTime = state.pointA;
      }
    };

    // Remove existing handler if any
    if (media._abLoopHandler) {
      media.removeEventListener('timeupdate', media._abLoopHandler);
    }
    media._abLoopHandler = handler;
    media.addEventListener('timeupdate', handler);
    showFeedback(media, 'A-B Loop', 'Active');
  }

  // Clear A-B loop
  function clearABLoop(media) {
    if (!media) return;

    const state = abLoopState.get(media);
    if (state) {
      state.active = false;
      state.pointA = null;
      state.pointB = null;
    }

    if (media._abLoopHandler) {
      media.removeEventListener('timeupdate', media._abLoopHandler);
      media._abLoopHandler = null;
    }

    abLoopState.delete(media);
    showFeedback(media, 'A-B Loop', 'Cleared');
    updateControllerLoopDisplay(media);
    debug('Video Speed Pro: A-B loop cleared');
  }

  // Toggle A-B loop on/off (without clearing points)
  function toggleABLoop(media) {
    if (!media) return;

    const state = abLoopState.get(media);
    if (!state || state.pointA === null || state.pointB === null) {
      showFeedback(media, 'A-B Loop', 'Set A & B first');
      return;
    }

    state.active = !state.active;

    if (state.active) {
      startABLoop(media);
    } else {
      showFeedback(media, 'A-B Loop', 'Paused');
    }

    updateControllerLoopDisplay(media);
  }

  // Update loop display in controller
  function updateControllerLoopDisplay(media) {
    const controller = mediaElements.get(media);
    if (!controller) return;

    const state = abLoopState.get(media);
    const loopIndicator = controller.querySelector('.vsc-loop-indicator');
    const loopBtnA = controller.querySelector('[data-action="set-loop-a"]');
    const loopBtnB = controller.querySelector('[data-action="set-loop-b"]');

    if (loopIndicator) {
      if (state && state.active) {
        loopIndicator.textContent = `${formatTime(state.pointA)} → ${formatTime(state.pointB)}`;
        loopIndicator.classList.add('active');
      } else if (state && (state.pointA !== null || state.pointB !== null)) {
        const aStr = state.pointA !== null ? formatTime(state.pointA) : '--:--';
        const bStr = state.pointB !== null ? formatTime(state.pointB) : '--:--';
        loopIndicator.textContent = `${aStr} → ${bStr}`;
        loopIndicator.classList.remove('active');
      } else {
        loopIndicator.textContent = 'Not set';
        loopIndicator.classList.remove('active');
      }
    }

    if (loopBtnA && state?.pointA !== null) {
      loopBtnA.classList.add('set');
    } else if (loopBtnA) {
      loopBtnA.classList.remove('set');
    }

    if (loopBtnB && state?.pointB !== null) {
      loopBtnB.classList.add('set');
    } else if (loopBtnB) {
      loopBtnB.classList.remove('set');
    }
  }

  // Format time as MM:SS
  function formatTime(seconds) {
    if (seconds === null || isNaN(seconds)) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // ==========================================
  // VIDEO FILTERS
  // ==========================================

  // Apply video filters (brightness, contrast, saturation)
  function applyVideoFilters(media) {
    if (!media || media.tagName !== 'VIDEO') return;

    const filterString = `brightness(${videoFilters.brightness}%) contrast(${videoFilters.contrast}%) saturate(${videoFilters.saturation}%)`;
    media.style.filter = filterString;
  }

  // Set brightness
  function setBrightness(media, value) {
    videoFilters.brightness = Math.max(0, Math.min(200, value));
    applyVideoFilters(media);
    updateFilterDisplay(media);
    saveFiltersIfEnabled();
  }

  // Set contrast
  function setContrast(media, value) {
    videoFilters.contrast = Math.max(0, Math.min(200, value));
    applyVideoFilters(media);
    updateFilterDisplay(media);
    saveFiltersIfEnabled();
  }

  // Set saturation
  function setSaturation(media, value) {
    videoFilters.saturation = Math.max(0, Math.min(200, value));
    applyVideoFilters(media);
    updateFilterDisplay(media);
    saveFiltersIfEnabled();
  }

  // Reset all filters to defaults
  function resetFilters(media) {
    videoFilters.brightness = 100;
    videoFilters.contrast = 100;
    videoFilters.saturation = 100;
    applyVideoFilters(media);
    updateFilterDisplay(media);
    showFeedback(media, 'Filters', 'Reset');
    saveFiltersIfEnabled();
  }

  // Update filter display in controller
  function updateFilterDisplay(media) {
    const controller = mediaElements.get(media);
    if (!controller) return;

    const brightnessSlider = controller.querySelector('[data-filter="brightness"]');
    const contrastSlider = controller.querySelector('[data-filter="contrast"]');
    const saturationSlider = controller.querySelector('[data-filter="saturation"]');
    const brightnessValue = controller.querySelector('.vsc-brightness-value');
    const contrastValue = controller.querySelector('.vsc-contrast-value');
    const saturationValue = controller.querySelector('.vsc-saturation-value');

    if (brightnessSlider) brightnessSlider.value = videoFilters.brightness;
    if (contrastSlider) contrastSlider.value = videoFilters.contrast;
    if (saturationSlider) saturationSlider.value = videoFilters.saturation;
    if (brightnessValue) brightnessValue.textContent = `${videoFilters.brightness}%`;
    if (contrastValue) contrastValue.textContent = `${videoFilters.contrast}%`;
    if (saturationValue) saturationValue.textContent = `${videoFilters.saturation}%`;
  }

  // Save filters if remember is enabled
  function saveFiltersIfEnabled() {
    if (contextInvalidated) return;
    if (settings.rememberFilters) {
      sendMessage({
        type: 'saveFilters',
        hostname: window.location.hostname,
        filters: videoFilters
      });
    }
  }

  // Load saved filters
  async function loadSavedFilters() {
    if (contextInvalidated) return;
    const response = await sendMessage({
      type: 'getSavedFilters',
      hostname: window.location.hostname
    });
    if (response.filters) {
      videoFilters = { ...videoFilters, ...response.filters };
    }
  }

  // ==========================================
  // VOLUME BOOST
  // ==========================================

  // Initialize volume boost for a media element
  function initVolumeBoost(media) {
    if (audioContextMap.has(media)) return audioContextMap.get(media);

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const gainNode = audioContext.createGain();
      const sourceNode = audioContext.createMediaElementSource(media);

      // Boosting straight into the destination clips: at 6x gain anything above
      // -15.5 dBFS distorts, which is most material. A limiter after the gain
      // trades a little loudness for not shredding the audio. Threshold sits
      // just under 0 dBFS so it is close to inert until the signal would clip.
      const limiterNode = audioContext.createDynamicsCompressor();
      limiterNode.threshold.value = -1;
      limiterNode.knee.value = 0;
      limiterNode.ratio.value = 20;
      limiterNode.attack.value = 0.003;
      limiterNode.release.value = 0.25;

      sourceNode.connect(gainNode);
      gainNode.connect(limiterNode);
      limiterNode.connect(audioContext.destination);

      const nodes = { audioContext, gainNode, limiterNode, sourceNode };
      audioContextMap.set(media, nodes);

      return nodes;
    } catch (e) {
      console.error('Video Speed Pro: Volume boost init failed', e);
      return null;
    }
  }

  function applyVolumeBoostToMedia(media) {
    if (!media) return;

    let nodes = audioContextMap.get(media);
    if (!nodes && volumeBoostLevel > 100) {
      nodes = initVolumeBoost(media);
    }

    if (nodes) {
      // Resume audio context if suspended
      if (nodes.audioContext.state === 'suspended') {
        nodes.audioContext.resume();
      }
      // Gain of 1.0 = 100%, 2.0 = 200%, etc.
      nodes.gainNode.gain.value = volumeBoostLevel / 100;
    }
  }

  function cleanupVolumeBoostForMedia(media) {
    const nodes = audioContextMap.get(media);
    if (!nodes) return;

    try {
      nodes.sourceNode.disconnect();
    } catch {}
    try {
      nodes.gainNode.disconnect();
    } catch {}
    try {
      nodes.limiterNode?.disconnect();
    } catch {}
    try {
      if (nodes.audioContext.state !== 'closed') {
        nodes.audioContext.close();
      }
    } catch {}

    audioContextMap.delete(media);
  }

  function updateAllVolumeBoostDisplays() {
    mediaElements.forEach((_controller, mediaEl) => updateVolumeBoostDisplay(mediaEl));
  }

  // Set volume boost level (100 = normal, up to VOLUME_BOOST_MAX)
  function setVolumeBoost(media, level, options = {}) {
    volumeBoostLevel = Math.max(100, Math.min(VOLUME_BOOST_MAX, level));
    const { showFeedback: shouldShowFeedback = true } = options;

    mediaElements.forEach((_controller, mediaEl) => {
      applyVolumeBoostToMedia(mediaEl);
    });

    updateAllVolumeBoostDisplays();
    if (shouldShowFeedback) {
      showFeedback(media, 'Volume', `${volumeBoostLevel}%`);
    }
    saveVolumeBoostIfEnabled();
  }

  // Update volume boost display in controller
  function updateVolumeBoostDisplay(media) {
    const controller = mediaElements.get(media);
    if (!controller) return;

    const volumeSlider = controller.querySelector('[data-action="volume-boost"]');
    const volumeValue = controller.querySelector('.vsc-volume-value');

    if (volumeSlider) volumeSlider.value = volumeBoostLevel;
    if (volumeValue) {
      volumeValue.textContent = `${volumeBoostLevel}%`;
      volumeValue.classList.toggle('boosted', volumeBoostLevel > 100);
    }
  }

  // Save volume boost if enabled
  function saveVolumeBoostIfEnabled() {
    if (contextInvalidated) return;
    if (settings.rememberVolumeBoost) {
      sendMessage({
        type: 'saveVolumeBoost',
        hostname: window.location.hostname,
        level: volumeBoostLevel
      });
    }
  }

  // Load saved volume boost
  async function loadSavedVolumeBoost() {
    if (contextInvalidated) return;
    const response = await sendMessage({
      type: 'getSavedVolumeBoost',
      hostname: window.location.hostname
    });
    if (typeof response.level === 'number') {
      volumeBoostLevel = Math.max(100, Math.min(VOLUME_BOOST_MAX, response.level));
    }
  }

  // ==========================================
  // SHARED FEEDBACK HELPER
  // ==========================================

  // Show generic feedback overlay
  function showFeedback(media, title, value) {
    const feedback = document.createElement('div');
    feedback.className = 'vsc-skip-feedback';
    feedback.innerHTML = `
      <span class="vsc-skip-message">${title}</span>
      <span class="vsc-skip-time">${value}</span>
    `;

    const bgColor = settings.colorBackground || '#1a1a2e';
    const accentColor = settings.colorAccent || '#e94560';
    feedback.style.setProperty('--vsc-bg-color', bgColor);
    feedback.style.setProperty('--vsc-accent-color', accentColor);

    const anchor = hostOf(mediaElements.get(media));
    const { host, root } = createShadowHost({ fixed: !anchor?.parentNode, role: 'feedback' });
    root.append(feedback);
    feedback._vscHost = host;
    (anchor?.parentNode || document.body).appendChild(host);

    requestAnimationFrame(() => {
      feedback.classList.add('vsc-show');
    });

    setTimeout(() => {
      feedback.classList.remove('vsc-show');
      setTimeout(() => removeOverlay(feedback), 300);
    }, 1200);
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
        // Clear any existing auto-hide timer when hidden by default
        const existingTimer = autoHideTimers.get(controller);
        if (existingTimer) {
          clearTimeout(existingTimer);
          autoHideTimers.delete(controller);
        }
      } else {
        controller.classList.remove('vsc-hidden');
        // Restart auto-hide timer if enabled
        if (settings.autoHideDelay > 0) {
          resetAutoHide(controller);
        }
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
        setDesiredSpeed(media, urlRuleResponse.speed);
        applyPlaybackRate(media, urlRuleResponse.speed);
        updateControllerDisplay(media);
        debug(`Video Speed Pro: Applied URL rule "${urlRuleResponse.pattern}" -> ${urlRuleResponse.speed}x`);
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
        setDesiredSpeed(media, sitePresetResponse.speed);
        applyPlaybackRate(media, sitePresetResponse.speed);
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
          setDesiredSpeed(media, response.speed);
          applyPlaybackRate(media, response.speed);
          updateControllerDisplay(media);
        }
      }, 100);
    }
  }

  // Describe this frame's media so the background can elect one frame per tab.
  // Without this every frame receives every command, so a single keypress can
  // hit the real video and a video ad in an iframe at the same time.
  function computeFrameMediaState() {
    let playing = false;
    let playingArea = 0;
    let idleArea = 0;

    for (const [media] of mediaElements) {
      if (!media.isConnected) continue;
      const rect = media.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      if (!media.paused && !media.ended) {
        playing = true;
        playingArea = Math.max(playingArea, area);
      } else {
        idleArea = Math.max(idleArea, area);
      }
    }

    return {
      hasMedia: extensionActive && !isBlocked && mediaElements.size > 0,
      playing,
      area: playing ? playingArea : idleArea,
      isTop: window.top === window
    };
  }

  function reportMediaState() {
    if (contextInvalidated || frameReportTimer) return;
    // Coalesce bursts: attaching ten videos should send one report, not ten.
    frameReportTimer = setTimeout(() => {
      frameReportTimer = null;
      if (contextInvalidated) return;
      sendMessage({ type: 'reportMediaState', state: computeFrameMediaState() });
    }, FRAME_REPORT_DELAY_MS);
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
    if (interactionListenersBound) return;
    interactionListenersBound = true;

    document.addEventListener('keydown', (e) => {
      if (isBlocked || !extensionActive) return;
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
        const modifiers = (s.modifiers || []).map(modifier => modifier.toLowerCase());
        const ctrlMatch = (modifiers.includes('ctrl') || modifiers.includes('control') || modifiers.includes('meta')) === (e.ctrlKey || e.metaKey);
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
        case 'screenshot':
          captureScreenshot(activeElement);
          break;
        case 'set-loop-a':
          setPointA(activeElement);
          break;
        case 'set-loop-b':
          setPointB(activeElement);
          break;
        case 'clear-loop':
          clearABLoop(activeElement);
          break;
        case 'toggle-loop':
          toggleABLoop(activeElement);
          break;
      }
    }, true);

    // Key up for long-press release
    document.addEventListener('keyup', (e) => {
      if (isBlocked || !extensionActive) return;
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
  function closeContextMenu() {
    if (!contextMenu) return;
    removeOverlay(contextMenu);
    contextMenu = null;
  }

  function setupContextMenu() {
    if (contextMenuBound) return;
    contextMenuBound = true;

    document.addEventListener('contextmenu', (e) => {
      if (isBlocked || !extensionActive) return;
      // Only show on video elements or controller. Events from inside a closed
      // shadow root are retargeted to the host, so match the host, not the
      // controller class, which is no longer visible from the document.
      const video = e.target.closest('video');
      const overlay = e.target.closest('.vsc-shadow-host');

      if (!video && !overlay) return;

      closeContextMenu();

      e.preventDefault();

      const media = video || findActiveMedia();
      if (!media) return;

      // Create context menu
      const menu = document.createElement('div');
      menu.className = 'vsc-context-menu';
      menu.setAttribute('role', 'menu');
      
      // Apply custom colors to context menu
      const bgColor = settings.colorBackground || '#1a1a2e';
      const accentColor = settings.colorAccent || '#e94560';
      menu.style.setProperty('--vsc-bg-color', bgColor);
      menu.style.setProperty('--vsc-accent-color', accentColor);
      
      menu.innerHTML = `
        <div class="vsc-menu-title">Speed Controller</div>
        <button type="button" role="menuitem" class="vsc-menu-item" data-speed="0.5">0.5x</button>
        <button type="button" role="menuitem" class="vsc-menu-item" data-speed="0.75">0.75x</button>
        <button type="button" role="menuitem" class="vsc-menu-item" data-speed="1">1x (Normal)</button>
        <button type="button" role="menuitem" class="vsc-menu-item" data-speed="1.25">1.25x</button>
        <button type="button" role="menuitem" class="vsc-menu-item" data-speed="1.5">1.5x</button>
        <button type="button" role="menuitem" class="vsc-menu-item" data-speed="2">2x</button>
        <button type="button" role="menuitem" class="vsc-menu-item" data-speed="3">3x</button>
      `;

      // Position menu
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';

      const { host, root } = createShadowHost({ fixed: true, role: 'menu' });
      root.append(menu);
      menu._vscHost = host;
      contextMenu = menu;
      document.body.appendChild(host);

      // Handle menu clicks
      menu.addEventListener('click', (ev) => {
        const item = ev.target.closest('.vsc-menu-item');
        if (item && item.dataset.speed) {
          setSpeed(media, parseFloat(item.dataset.speed));
        }
        closeContextMenu();
      });

      // Close menu on outside click
      setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
          closeContextMenu();
          document.removeEventListener('click', closeMenu);
        }, { once: true });
      }, 10);
    });
  }

  // Picture-in-Picture support
  function setupPipSupport(media) {
    cleanupPipListeners(media);
    // Listen for PiP events
    const enter = () => {
      pipMediaElement = media;
      if (settings.showPipIndicator !== false) {
        createPipIndicator(media);
      }
      debug('Video Speed Pro: Entered Picture-in-Picture mode');
    };

    const leave = () => {
      pipMediaElement = null;
      removePipIndicator();
      debug('Video Speed Pro: Left Picture-in-Picture mode');
    };
    media.addEventListener('enterpictureinpicture', enter);
    media.addEventListener('leavepictureinpicture', leave);
    media._vscPipListeners = { enter, leave };
  }

  function cleanupPipListeners(media) {
    const listeners = media._vscPipListeners;
    if (!listeners) return;
    media.removeEventListener('enterpictureinpicture', listeners.enter);
    media.removeEventListener('leavepictureinpicture', listeners.leave);
    delete media._vscPipListeners;
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
        <span class="vsc-pip-speed" aria-live="polite">${media.playbackRate.toFixed(2)}x</span>
      </div>
      <div class="vsc-pip-controls">
        <button type="button" class="vsc-pip-btn" data-action="decrease" aria-label="Decrease picture-in-picture speed">−</button>
        <button type="button" class="vsc-pip-btn vsc-pip-reset" data-action="reset" aria-label="Reset picture-in-picture speed">1x</button>
        <button type="button" class="vsc-pip-btn" data-action="increase" aria-label="Increase picture-in-picture speed">+</button>
      </div>
    `;

    const { host, root } = createShadowHost({ fixed: true, role: 'pip' });
    root.append(pipIndicator);
    pipIndicator._vscHost = host;
    document.body.appendChild(host);

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
      removeOverlay(pipIndicator);
      pipIndicator = null;
    }
  }

  // Track once per second only while media is playing.
  function startTimeTracking() {
    if (timeTrackingInterval || contextInvalidated || mediaElements.size === 0) return;
    lastTrackTime = Date.now();
    timeTrackingInterval = setInterval(trackTimeSaved, 1000);
  }

  function stopTimeTracking() {
    if (!timeTrackingInterval) return;
    clearInterval(timeTrackingInterval);
    timeTrackingInterval = null;
  }

  function trackTimeSaved() {
    if (contextInvalidated || !extensionActive) {
      stopTimeTracking();
      return;
    }

    const now = Date.now();
    const elapsed = Math.min(2, Math.max(0, (now - lastTrackTime) / 1000));
    lastTrackTime = now;
    if (document.hidden) return;

    let totalTimeSaved = 0;
    let hasPlayingMedia = false;
    for (const [media] of mediaElements) {
      if (!media.paused && !media.ended) {
        hasPlayingMedia = true;
        if (media.playbackRate > 1) totalTimeSaved += elapsed * (media.playbackRate - 1);
      }
    }

    if (!hasPlayingMedia) {
      stopTimeTracking();
      return;
    }
    if (totalTimeSaved > 0) updateTimeSaved(totalTimeSaved);
  }

  function updateTimeSaved(seconds) {
    // Skip if context is invalidated
    if (contextInvalidated) return;

    sendMessage({
      type: 'addTimeSaved',
      seconds: seconds
    });
  }

  // Handle URL change - shared logic for all detection methods
  async function handleUrlChange() {
    // Skip if context is invalidated
    if (contextInvalidated) return;

    const currentUrl = window.location.href;
    if (currentUrl === lastUrl) return;

    lastUrl = currentUrl;
    debug('Video Speed Pro: URL changed, checking rules');

    const access = await sendMessage({ type: 'checkSiteAccess', url: currentUrl });
    if (settings.enabled === false || access?.blocked) {
      deactivateExtension();
      return;
    }
    if (!extensionActive) {
      await activateExtension();
      return;
    }

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

  // Detect URL changes for SPAs (e.g., YouTube navigation)
  // Uses Navigation API when available (Chrome 102+) for instant detection,
  // falls back to polling for older browsers
  function startUrlChangeDetection() {
    if (urlTrackingStarted) return;
    urlTrackingStarted = true;

    // Try to use the modern Navigation API (Chrome 102+, no Firefox/Safari yet)
    if ('navigation' in window) {
      try {
        window.navigation.addEventListener('navigatesuccess', handleUrlChange);
        debug('Video Speed Pro: Using Navigation API for URL detection');
      } catch (e) {
        // Navigation API not fully supported, fall back to polling
        startPollingUrlDetection();
      }
    } else {
      // Fall back to polling for older browsers
      startPollingUrlDetection();
    }

    // Also listen for popstate (back/forward navigation) as backup
    window.addEventListener('popstate', handleUrlChange);
  }

  // Fallback: Poll for URL changes (for browsers without Navigation API)
  function startPollingUrlDetection() {
    debug('Video Speed Pro: Using polling for URL detection');
    if (urlPollBound) return;
    urlPollBound = true;

    // Only the fallback path pays for this listener. Browsers with the
    // Navigation API never start a poll, so they never reach here.
    document.addEventListener('visibilitychange', syncUrlPollToVisibility);
    syncUrlPollToVisibility();
  }

  // Back the poll off in a hidden tab rather than stopping it. A background tab
  // can still navigate itself -- an SPA advancing to the next track or video --
  // and dropping the poll entirely would leave speed rules unapplied until the
  // tab was looked at again.
  function syncUrlPollToVisibility() {
    if (contextInvalidated) {
      stopUrlPoll();
      return;
    }

    const hidden = document.visibilityState === 'hidden';
    const interval = hidden ? URL_POLL_HIDDEN_MS : URL_POLL_VISIBLE_MS;
    if (urlCheckInterval && urlPollIntervalMs === interval) return;

    stopUrlPoll();
    urlPollIntervalMs = interval;
    urlCheckInterval = setInterval(() => {
      if (contextInvalidated) {
        stopUrlPoll();
        return;
      }
      handleUrlChange();
    }, interval);

    // Becoming visible re-checks straight away, so a navigation that happened
    // while hidden is not left waiting for the next tick.
    if (!hidden) handleUrlChange();
  }

  function stopUrlPoll() {
    if (!urlCheckInterval) return;
    clearInterval(urlCheckInterval);
    urlCheckInterval = null;
    urlPollIntervalMs = null;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
