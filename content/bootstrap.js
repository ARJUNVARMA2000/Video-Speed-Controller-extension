// Lightweight media detector. The feature runtime is imported only after a
// document contains media worth inspecting, keeping ordinary pages cheap.
(function bootstrapVideoSpeedController() {
  'use strict';

  if (window.vscBootstrapInitialized) return;
  window.vscBootstrapInitialized = true;

  const MEDIA_SELECTOR = 'video, audio';
  const MIN_FRAME_DIMENSION = 150;
  const WALK_BATCH_SIZE = 250;
  const WALK_TIMEOUT_MS = 500;
  const FALLBACK_BUDGET_MS = 8;
  const FALLBACK_DELAY_MS = 100;

  let discoveryObserver = null;
  let bodyObserver = null;
  let frameGrowthListener = null;
  let walkHandle = null;
  let walker = null;
  let walkQueue = [];
  let runtimePromise = null;
  let discoveryStopped = false;
  const observedRoots = new WeakSet();

  function isNegligibleFrame() {
    if (window === window.top) return false;
    const { innerWidth: width, innerHeight: height } = window;
    return width > 0 && height > 0 && (width < MIN_FRAME_DIMENSION || height < MIN_FRAME_DIMENSION);
  }

  function scheduleIdle(callback) {
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(callback, { timeout: WALK_TIMEOUT_MS });
      return { cancel: () => cancelIdleCallback(id) };
    }
    const id = setTimeout(() => {
      const startedAt = performance.now();
      callback({ timeRemaining: () => Math.max(0, FALLBACK_BUDGET_MS - (performance.now() - startedAt)) });
    }, FALLBACK_DELAY_MS);
    return { cancel: () => clearTimeout(id) };
  }

  function stopDiscovery() {
    if (discoveryStopped) return;
    discoveryStopped = true;
    discoveryObserver?.disconnect();
    discoveryObserver = null;
    bodyObserver?.disconnect();
    bodyObserver = null;
    walkHandle?.cancel();
    walkHandle = null;
    walker = null;
    walkQueue = [];
    if (frameGrowthListener) window.removeEventListener('resize', frameGrowthListener);
    frameGrowthListener = null;
  }

  function ensureRuntime() {
    if (runtimePromise) return runtimePromise;
    const logicPromise = import(chrome.runtime.getURL('content/logic.js'));
    window.vscContentLogicReady = logicPromise.then(() => window.VSCContentLogic);
    runtimePromise = Promise.all([
      logicPromise,
      import(chrome.runtime.getURL('content/content.js'))
    ])
      .then(() => window.vscRuntimeReady)
      .then(() => {
        stopDiscovery();
        // Hand listener ownership to the runtime in one task. Registering the
        // runtime listener earlier would let both listeners see messages during
        // asynchronous settings initialization and could dispatch a command
        // twice.
        chrome.runtime.onMessage.removeListener(handleBootstrapMessage);
        window.vscBindRuntimeMessageListener?.();
      })
      .catch(error => {
        runtimePromise = null;
        console.error('Video Speed Pro: Could not load the media runtime', error);
        throw error;
      });
    return runtimePromise;
  }

  function containsMedia(root) {
    if (!root) return false;
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(MEDIA_SELECTOR)) return true;
    return Boolean(root.querySelector?.(MEDIA_SELECTOR));
  }

  function observeRoot(root) {
    if (!root || observedRoots.has(root)) return;
    observedRoots.add(root);
    discoveryObserver?.observe(root, { childList: true, subtree: true });
  }

  function inspectShadowHost(node) {
    const root = node?.shadowRoot;
    if (!root || observedRoots.has(root)) return;
    observeRoot(root);
    if (containsMedia(root)) {
      ensureRuntime();
      return;
    }
    walkQueue.push(root);
  }

  function startWalkPump() {
    if (walkHandle || discoveryStopped || runtimePromise) return;
    if (!walker && walkQueue.length === 0) return;
    walkHandle = scheduleIdle(pumpWalkQueue);
  }

  function queueShadowSearch(root) {
    if (!root || discoveryStopped || runtimePromise) return;
    walkQueue.push(root);
    startWalkPump();
  }

  function pumpWalkQueue(deadline) {
    walkHandle = null;
    let remainingBeforeCheck = WALK_BATCH_SIZE;

    while (!runtimePromise && (walker || walkQueue.length > 0)) {
      if (!walker) {
        const root = walkQueue.shift();
        if (!root || (root.nodeType === Node.ELEMENT_NODE && !root.isConnected)) continue;
        if (root.nodeType === Node.ELEMENT_NODE) inspectShadowHost(root);
        walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      }

      let node = walker.nextNode();
      while (node && !runtimePromise) {
        inspectShadowHost(node);
        remainingBeforeCheck -= 1;
        if (remainingBeforeCheck === 0) {
          remainingBeforeCheck = WALK_BATCH_SIZE;
          if (deadline.timeRemaining() <= 0) {
            startWalkPump();
            return;
          }
        }
        node = walker.nextNode();
      }
      walker = null;
    }
  }

  function inspectAddedNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE || runtimePromise) return;
    if (containsMedia(node)) {
      ensureRuntime();
      return;
    }
    queueShadowSearch(node);
  }

  function mutationCallback(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) inspectAddedNode(node);
      if (runtimePromise) return;
    }
  }

  function beginDiscovery() {
    if (discoveryStopped || runtimePromise) return;
    if (isNegligibleFrame()) {
      if (frameGrowthListener) return;
      frameGrowthListener = () => {
        if (isNegligibleFrame()) return;
        window.removeEventListener('resize', frameGrowthListener);
        frameGrowthListener = null;
        beginDiscovery();
      };
      window.addEventListener('resize', frameGrowthListener, { passive: true });
      return;
    }

    discoveryObserver = new MutationObserver(mutationCallback);
    if (document.body) {
      observeRoot(document.body);
    } else {
      bodyObserver = new MutationObserver(() => {
        if (!document.body) return;
        bodyObserver.disconnect();
        bodyObserver = null;
        observeRoot(document.body);
        inspectDocument();
      });
      bodyObserver.observe(document.documentElement, { childList: true });
    }
    inspectDocument();
  }

  function inspectDocument() {
    if (containsMedia(document)) {
      ensureRuntime();
      return;
    }
    queueShadowSearch(document);
  }

  function handleBootstrapMessage(message, sender, sendResponse) {
    if (runtimePromise) {
      runtimePromise
        .then(() => {
          let responded = false;
          const bridgeResponse = value => {
            responded = true;
            sendResponse?.(value);
          };
          window.vscRuntimeDispatchMessage?.(message, sender, bridgeResponse);
          // Settings updates and commands intentionally have no response in the
          // full runtime. Close the bootstrap-held channel after dispatch.
          if (!responded) sendResponse?.();
        })
        .catch(() => sendResponse?.({ success: false, error: 'Media runtime failed to load' }));
      return true;
    }

    if (message?.type === 'getActiveState') {
      sendResponse?.({ found: false });
    } else if (message?.type === 'setSpeed' || message?.type === 'togglePlayback') {
      sendResponse?.({ success: false, error: 'No active media found' });
    }
    // Ignore settings patches until media exists. The runtime reads the latest
    // normalized snapshot when it eventually starts.
    return false;
  }

  chrome.runtime.onMessage.addListener(handleBootstrapMessage);
  beginDiscovery();
})();
