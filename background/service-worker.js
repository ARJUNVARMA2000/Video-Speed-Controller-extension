// Service Worker for Video Speed Controller Pro Extension

importScripts('../shared/settings.js');

const {
  checkSiteAccess: resolveSiteAccess,
  createDefaultSettings,
  findUrlRule,
  normalizeSettings,
  normalizeSpeed,
  sanitizeSettingsPatch
} = VSCSettings;

const COLLECTION_WRITE_DELAY = 300;
let pendingCollectionWrites = new Map();
let collectionWriteTimer = null;
let collectionWriteQueue = Promise.resolve();
let timeSavedWriteQueue = Promise.resolve();
let timeSavedCache = null;

// Per-tab media frame registry. Content scripts run in every frame, so commands
// have to be routed to one elected frame instead of broadcast to all of them.
const FRAME_STATE_TTL = 5 * 60 * 1000;
const ACTIVE_FRAME_RELAY_TYPES = new Set(['getActiveState', 'setSpeed']);
const frameMediaStates = new Map(); // Map<tabId, Map<frameId, { state, updatedAt }>>

function recordFrameMediaState(sender, state) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') return;
  const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;

  let frames = frameMediaStates.get(tabId);
  if (!frames) {
    frames = new Map();
    frameMediaStates.set(tabId, frames);
  }

  if (state?.hasMedia) frames.set(frameId, { state, updatedAt: Date.now() });
  else frames.delete(frameId);

  if (frames.size === 0) frameMediaStates.delete(tabId);
}

function scoreFrame({ state, updatedAt }) {
  if (Date.now() - updatedAt > FRAME_STATE_TTL) return -1;
  if (!state?.hasMedia) return -1;
  // Playing media outranks paused media, then the largest visible player wins.
  // The top frame breaks exact ties so an ad iframe never wins by default.
  let score = Math.max(0, Number(state.area) || 0);
  if (state.playing) score += 1e12;
  if (state.isTop) score += 1;
  return score;
}

function pickActiveFrame(tabId) {
  const frames = frameMediaStates.get(tabId);
  if (!frames) return null;

  let bestFrameId = null;
  let bestScore = -1;
  for (const [frameId, entry] of frames) {
    const score = scoreFrame(entry);
    if (score > bestScore) {
      bestScore = score;
      bestFrameId = frameId;
    }
  }
  return bestFrameId;
}

async function sendToActiveFrame(tabId, message) {
  const frameId = pickActiveFrame(tabId);
  if (frameId !== null) {
    try {
      return await chrome.tabs.sendMessage(tabId, message, { frameId });
    } catch {
      // The frame went away between reporting and dispatch. Drop it and fall
      // back to a tab-wide send so the command still lands.
      frameMediaStates.get(tabId)?.delete(frameId);
    }
  }
  return await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
}

chrome.tabs.onRemoved.addListener(tabId => frameMediaStates.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // A new navigation invalidates every frame the old document reported.
  if (changeInfo.status === 'loading') frameMediaStates.delete(tabId);
});

function normalizeEntryKey(value, label = 'hostname') {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`);
  const key = value.trim().slice(0, 512);
  if (!key) throw new Error(`Invalid ${label}`);
  return key;
}

function queueCollectionWrite(collection, entryKey, value) {
  return new Promise((resolve, reject) => {
    const pending = pendingCollectionWrites.get(collection) || { entries: new Map(), waiters: [] };
    pending.entries.set(entryKey, value);
    pending.waiters.push({ resolve, reject });
    pendingCollectionWrites.set(collection, pending);

    if (!collectionWriteTimer) {
      collectionWriteTimer = setTimeout(flushCollectionWrites, COLLECTION_WRITE_DELAY);
    }
  });
}

function flushCollectionWrites() {
  if (collectionWriteTimer) clearTimeout(collectionWriteTimer);
  collectionWriteTimer = null;

  if (pendingCollectionWrites.size === 0) return collectionWriteQueue;

  const batch = pendingCollectionWrites;
  pendingCollectionWrites = new Map();

  const operation = collectionWriteQueue.then(async () => {
    const collections = [...batch.keys()];
    const current = await chrome.storage.sync.get(collections);
    const updates = {};

    for (const [collection, pending] of batch) {
      const next = { ...(current[collection] || {}) };
      for (const [entryKey, value] of pending.entries) {
        if (value === null || value === undefined) delete next[entryKey];
        else next[entryKey] = value;
      }
      updates[collection] = sanitizeSettingsPatch({ [collection]: next })[collection] || {};
    }

    await chrome.storage.sync.set(updates);
    for (const pending of batch.values()) pending.waiters.forEach(waiter => waiter.resolve(updates));
    return updates;
  }).catch(error => {
    for (const pending of batch.values()) pending.waiters.forEach(waiter => waiter.reject(error));
    throw error;
  });

  collectionWriteQueue = operation.catch(() => {});
  return operation;
}

async function getTimeSavedValue() {
  if (timeSavedCache === null) {
    const data = await chrome.storage.local.get(['timeSaved']);
    timeSavedCache = typeof data.timeSaved === 'number' ? data.timeSaved : 0;
  }
  return timeSavedCache;
}

function addTimeSaved(seconds) {
  const safeSeconds = Math.min(3600, Math.max(0, Number(seconds) || 0));
  const operation = timeSavedWriteQueue.then(async () => {
    const currentValue = await getTimeSavedValue();
    const nextValue = currentValue + safeSeconds;
    await chrome.storage.local.set({ timeSaved: nextValue });
    timeSavedCache = nextValue;
    return nextValue;
  });
  timeSavedWriteQueue = operation.catch(() => {});
  return operation;
}

async function notifyTabs(settings) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab =>
    chrome.tabs.sendMessage(tab.id, { type: 'settingsUpdated', settings })
  ));
}

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.sync.set(createDefaultSettings());
    await chrome.storage.local.set({ timeSaved: 0 });
    timeSavedCache = 0;
    console.log('Video Speed Pro: Default settings initialized');
  } else if (details.reason === 'update') {
    // Merge new default settings with existing ones
    const [existing, existingLocal] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get(['timeSaved'])
    ]);
    const existingTimeSaved = typeof existing.timeSaved === 'number' ? existing.timeSaved : null;
    const localTimeSaved = typeof existingLocal.timeSaved === 'number' ? existingLocal.timeSaved : null;
    const migratedTimeSaved = existingTimeSaved ?? localTimeSaved ?? 0;
    const merged = normalizeSettings(existing);
    await chrome.storage.sync.set(merged);
    await chrome.storage.sync.remove('timeSaved');
    await chrome.storage.local.set({ timeSaved: migratedTimeSaved });
    timeSavedCache = migratedTimeSaved;
    console.log('Video Speed Pro: Settings migrated');
  }
});

// Handle commands from keyboard shortcuts defined in manifest
chrome.commands.onCommand.addListener(async (command) => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    await sendToActiveFrame(tabs[0].id, { type: 'command', command });
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => {
      console.error('Video Speed Pro: Message failed', message?.type, error);
      sendResponse({ success: false, error: error?.message || 'Unexpected extension error' });
    });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'reportMediaState': {
      recordFrameMediaState(sender, message.state);
      return { success: true };
    }

    case 'sendToActiveFrame': {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) throw new Error('Invalid tab id');
      const relayed = message.message;
      if (!ACTIVE_FRAME_RELAY_TYPES.has(relayed?.type)) throw new Error('Unsupported relay message');
      const response = await sendToActiveFrame(tabId, relayed);
      if (response === undefined) return { success: false, error: 'No content script responded' };
      return { success: true, response };
    }

    case 'getSettings': {
      const [syncSettings, localSettings] = await Promise.all([
        chrome.storage.sync.get(null),
        chrome.storage.local.get(['timeSaved'])
      ]);
      const timeSaved = typeof localSettings.timeSaved === 'number' ? localSettings.timeSaved : 0;
      timeSavedCache = timeSaved;
      return { ...normalizeSettings(syncSettings), timeSaved };
    }

    case 'saveSettings':
    case 'updateSettings': {
      const requested = message.type === 'updateSettings' ? message.updates : message.settings;
      const updates = sanitizeSettingsPatch(requested);
      delete updates.timeSaved;
      const lastSyncTime = Date.now();
      await chrome.storage.sync.set({ ...updates, lastSyncTime });
      const current = normalizeSettings(await chrome.storage.sync.get(null));
      await notifyTabs(current);
      return { success: true, settings: current, lastSyncTime };
    }

    case 'getSavedSpeed': {
      const settings = await chrome.storage.sync.get(['savedSpeeds', 'rememberSpeed']);
      const savedSpeeds = sanitizeSettingsPatch({ savedSpeeds: settings.savedSpeeds }).savedSpeeds || {};
      if (settings.rememberSpeed && savedSpeeds) {
        return { speed: savedSpeeds[message.hostname] ?? null };
      }
      return { speed: null };
    }

    case 'saveSpeed': {
      const hostname = normalizeEntryKey(message.hostname);
      const speed = normalizeSpeed(message.speed);
      await queueCollectionWrite('savedSpeeds', hostname, speed);
      return { success: true };
    }

    case 'setSitePresetSpeed': {
      const hostname = normalizeEntryKey(message.hostname);
      const speed = message.speed == null ? null : normalizeSpeed(message.speed);
      await queueCollectionWrite('sitePresetSpeeds', hostname, speed);
      return { success: true };
    }

    case 'getSitePresetSpeed': {
      const data = await chrome.storage.sync.get(['sitePresetSpeeds']);
      const sitePresetSpeeds = sanitizeSettingsPatch({ sitePresetSpeeds: data.sitePresetSpeeds }).sitePresetSpeeds || {};
      return { speed: sitePresetSpeeds[message.hostname] ?? null };
    }

    case 'setPreservePitch': {
      await chrome.storage.sync.set({ preservePitch: message.preservePitch === true });
      const updated = normalizeSettings(await chrome.storage.sync.get(null));
      await notifyTabs(updated);
      return { success: true };
    }

    case 'checkBlacklist':
      // Back-compat alias for checkSiteAccess
      return await checkSiteAccess(message.url);

    case 'checkSiteAccess':
      return await checkSiteAccess(message.url);

    case 'exportSettings': {
      const [exportSync, exportLocal] = await Promise.all([
        chrome.storage.sync.get(null),
        chrome.storage.local.get(['timeSaved'])
      ]);
      return {
        ...normalizeSettings(exportSync),
        timeSaved: typeof exportLocal.timeSaved === 'number' ? exportLocal.timeSaved : 0
      };
    }

    case 'importSettings': {
      await flushCollectionWrites();
      const rawTimeSaved = Number(message.settings?.timeSaved);
      const importedTimeSaved = Number.isFinite(rawTimeSaved)
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, rawTimeSaved))
        : 0;
      const importSync = normalizeSettings(message.settings);
      importSync.lastSyncTime = Date.now();
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(importSync);
      await chrome.storage.local.set({ timeSaved: importedTimeSaved });
      timeSavedCache = importedTimeSaved;
      await notifyTabs(importSync);
      return { success: true, settings: { ...importSync, timeSaved: importedTimeSaved } };
    }

    case 'resetSettings': {
      await flushCollectionWrites();
      const defaults = createDefaultSettings();
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(defaults);
      await chrome.storage.local.set({ timeSaved: 0 });
      timeSavedCache = 0;
      await notifyTabs(defaults);
      return { success: true, settings: { ...defaults, timeSaved: 0 } };
    }

    case 'addTimeSaved': {
      const newTimeSaved = await addTimeSaved(message.seconds);
      return { success: true, timeSaved: newTimeSaved };
    }

    case 'updateSyncTime': {
      const syncTime = Date.now();
      await chrome.storage.sync.set({ lastSyncTime: syncTime });
      return { success: true, lastSyncTime: syncTime };
    }

    case 'getSyncStatus': {
      const syncData = await chrome.storage.sync.get(['lastSyncTime']);
      return { lastSyncTime: syncData.lastSyncTime || null };
    }

    case 'getUrlRuleSpeed': {
      const ruleSettings = await chrome.storage.sync.get(['urlRules']);
      return findUrlRule(message.url, ruleSettings.urlRules || []);
    }

    case 'getIntroOutroSettings': {
      const introOutroData = normalizeSettings(await chrome.storage.sync.get([
        'introOutroEnabled',
        'defaultIntroSkip',
        'defaultOutroSkip',
        'autoSkipIntro',
        'skipIntroKey',
        'skipOutroKey',
        'introOutroSiteRules'
      ]));

      // Check if feature is enabled
      if (!introOutroData.introOutroEnabled) {
        return { enabled: false };
      }

      // Find site-specific rule
      const hostname = message.hostname;
      const siteRules = introOutroData.introOutroSiteRules || [];
      const siteRule = siteRules.find(r => 
        hostname.toLowerCase().includes(r.site.toLowerCase()) ||
        r.site.toLowerCase().includes(hostname.toLowerCase())
      );

      if (siteRule) {
        return {
          enabled: true,
          introSkip: siteRule.intro,
          outroSkip: siteRule.outro,
          autoSkipIntro: introOutroData.autoSkipIntro || false,
          skipIntroKey: introOutroData.skipIntroKey || 'I',
          skipOutroKey: introOutroData.skipOutroKey || 'O',
          siteSpecific: true
        };
      }

      // Return default settings
      return {
        enabled: true,
        introSkip: introOutroData.defaultIntroSkip || 0,
        outroSkip: introOutroData.defaultOutroSkip || 0,
        autoSkipIntro: introOutroData.autoSkipIntro || false,
        skipIntroKey: introOutroData.skipIntroKey || 'I',
        skipOutroKey: introOutroData.skipOutroKey || 'O',
        siteSpecific: false
      };
    }

    // Video Filters
    case 'saveFilters': {
      const hostname = normalizeEntryKey(message.hostname);
      const safeFilters = sanitizeSettingsPatch({ savedFilters: { [hostname]: message.filters } }).savedFilters;
      if (!safeFilters?.[hostname]) throw new Error('Invalid filters');
      await queueCollectionWrite('savedFilters', hostname, safeFilters[hostname]);
      return { success: true };
    }

    case 'getSavedFilters': {
      const filterData = await chrome.storage.sync.get(['savedFilters', 'rememberFilters']);
      const savedFilters = sanitizeSettingsPatch({ savedFilters: filterData.savedFilters }).savedFilters || {};
      if (filterData.rememberFilters && savedFilters) {
        return { filters: savedFilters[message.hostname] || null };
      }
      return { filters: null };
    }

    // Volume Boost
    case 'saveVolumeBoost': {
      const hostname = normalizeEntryKey(message.hostname);
      const safeLevels = sanitizeSettingsPatch({ savedVolumeBoost: { [hostname]: message.level } }).savedVolumeBoost;
      if (!safeLevels?.[hostname]) throw new Error('Invalid volume boost');
      await queueCollectionWrite('savedVolumeBoost', hostname, safeLevels[hostname]);
      return { success: true };
    }

    case 'getSavedVolumeBoost': {
      const volumeData = await chrome.storage.sync.get(['savedVolumeBoost', 'rememberVolumeBoost']);
      const savedVolumeBoost = sanitizeSettingsPatch({ savedVolumeBoost: volumeData.savedVolumeBoost }).savedVolumeBoost || {};
      if (volumeData.rememberVolumeBoost && savedVolumeBoost) {
        return { level: savedVolumeBoost[message.hostname] || null };
      }
      return { level: null };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

async function checkSiteAccess(url) {
  const config = await chrome.storage.sync.get(['enabled', 'siteAccessMode', 'blacklist', 'whitelist']);
  return resolveSiteAccess(url, config);
}
