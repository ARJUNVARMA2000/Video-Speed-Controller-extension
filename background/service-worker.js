// Service Worker for Video Speed Controller Pro Extension

// Batched storage writes for better performance
let pendingWrites = {};
let writeTimer = null;
const WRITE_BATCH_DELAY = 300; // ms

let pendingLocalWrites = {};
let localWriteTimer = null;
const LOCAL_WRITE_BATCH_DELAY = 500; // ms

let timeSavedCache = null;

function batchedStorageSet(updates) {
  Object.assign(pendingWrites, updates);
  clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    if (Object.keys(pendingWrites).length > 0) {
      await chrome.storage.sync.set(pendingWrites);
      pendingWrites = {};
    }
  }, WRITE_BATCH_DELAY);
}

function batchedLocalSet(updates) {
  Object.assign(pendingLocalWrites, updates);
  clearTimeout(localWriteTimer);
  localWriteTimer = setTimeout(async () => {
    if (Object.keys(pendingLocalWrites).length > 0) {
      await chrome.storage.local.set(pendingLocalWrites);
      pendingLocalWrites = {};
    }
  }, LOCAL_WRITE_BATCH_DELAY);
}

async function getTimeSavedValue() {
  if (timeSavedCache === null) {
    const data = await chrome.storage.local.get(['timeSaved']);
    timeSavedCache = typeof data.timeSaved === 'number' ? data.timeSaved : 0;
  }
  return timeSavedCache;
}

function setTimeSavedValue(value) {
  timeSavedCache = value;
  batchedLocalSet({ timeSaved: value });
  return value;
}

// Immediate write for critical settings (bypass batching)
async function immediateStorageSet(updates) {
  // Flush any pending writes first
  if (Object.keys(pendingWrites).length > 0) {
    clearTimeout(writeTimer);
    Object.assign(pendingWrites, updates);
    await chrome.storage.sync.set(pendingWrites);
    pendingWrites = {};
  } else {
    await chrome.storage.sync.set(updates);
  }
}

const DEFAULT_SETTINGS = {
  enabled: true,
  hideByDefault: false,
  rememberSpeed: true,
  forceSpeed: false,
  workOnAudio: false,
  preservePitch: true,
  opacity: 0.8,
  autoHideDelay: 0,
  controllerMode: 'minimal',
  showPipIndicator: true,
  // Site access control
  siteAccessMode: 'blacklist', // 'all' | 'blacklist' | 'whitelist'
  whitelist: [],
  shortcuts: [
    { action: 'show-controller', key: 'V', modifiers: [], enabled: true },
    { action: 'decrease-speed', key: 'S', modifiers: [], value: 0.1, enabled: true },
    { action: 'increase-speed', key: 'D', modifiers: [], value: 0.1, enabled: true },
    { action: 'rewind', key: 'Z', modifiers: [], value: 10, enabled: true },
    { action: 'advance', key: 'X', modifiers: [], value: 10, enabled: true },
    { action: 'reset-speed', key: 'R', modifiers: [], value: 1.0, enabled: true },
    { action: 'preferred-speed', key: 'G', modifiers: [], value: 3.0, enabled: true },
    { action: 'frame-forward', key: '.', modifiers: [], enabled: true },
    { action: 'frame-backward', key: ',', modifiers: [], enabled: true },
    { action: 'screenshot', key: 'P', modifiers: [], enabled: true },
    { action: 'set-loop-a', key: '[', modifiers: [], enabled: true },
    { action: 'set-loop-b', key: ']', modifiers: [], enabled: true },
    { action: 'clear-loop', key: '\\', modifiers: [], enabled: true }
  ],
  blacklist: [],
  savedSpeeds: {},
  // Per-site pinned speed (takes priority over savedSpeeds)
  sitePresetSpeeds: {},
  urlRules: [],
  lastSyncTime: null,
  // Intro/Outro Skip settings
  introOutroEnabled: false,
  defaultIntroSkip: 0,
  defaultOutroSkip: 0,
  autoSkipIntro: false,
  skipIntroKey: 'I',
  skipOutroKey: 'O',
  introOutroSiteRules: [],
  // Video Filters
  rememberFilters: false,
  savedFilters: {},
  // Volume Boost
  rememberVolumeBoost: false,
  savedVolumeBoost: {}
};

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    await chrome.storage.local.set({ timeSaved: 0 });
    timeSavedCache = 0;
    console.log('Video Speed Pro: Default settings initialized');
  } else if (details.reason === 'update') {
    // Merge new default settings with existing ones
    const existing = await chrome.storage.sync.get(null);
    const existingTimeSaved = typeof existing.timeSaved === 'number' ? existing.timeSaved : null;
    const merged = { ...DEFAULT_SETTINGS, ...existing };
    delete merged.timeSaved;
    await chrome.storage.sync.set(merged);
    await chrome.storage.sync.remove('timeSaved');
    if (existingTimeSaved !== null) {
      await chrome.storage.local.set({ timeSaved: existingTimeSaved });
      timeSavedCache = existingTimeSaved;
    } else {
      await chrome.storage.local.set({ timeSaved: 0 });
      timeSavedCache = 0;
    }
    console.log('Video Speed Pro: Settings migrated');
  }
});

// Handle commands from keyboard shortcuts defined in manifest
chrome.commands.onCommand.addListener(async (command) => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'command', command });
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'getSettings': {
      const [syncSettings, localSettings] = await Promise.all([
        chrome.storage.sync.get(null),
        chrome.storage.local.get(['timeSaved'])
      ]);
      const timeSaved = typeof localSettings.timeSaved === 'number' ? localSettings.timeSaved : 0;
      timeSavedCache = timeSaved;
      return { ...syncSettings, timeSaved };
    }

    case 'saveSettings': {
      const { timeSaved, ...syncSettings } = message.settings || {};
      await chrome.storage.sync.set(syncSettings);
      // Notify all tabs about settings update
      const tabs = await chrome.tabs.query({});
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'settingsUpdated', settings: message.settings }).catch(() => {});
      });
      return { success: true };
    }

    case 'getSavedSpeed': {
      const settings = await chrome.storage.sync.get(['savedSpeeds', 'rememberSpeed']);
      if (settings.rememberSpeed && settings.savedSpeeds) {
        return { speed: settings.savedSpeeds[message.hostname] || null };
      }
      return { speed: null };
    }

    case 'saveSpeed': {
      const current = await chrome.storage.sync.get(['savedSpeeds']);
      const savedSpeeds = current.savedSpeeds || {};
      savedSpeeds[message.hostname] = message.speed;
      // Use batched write for frequent speed saves
      batchedStorageSet({ savedSpeeds });
      return { success: true };
    }

    case 'setSitePresetSpeed': {
      const data = await chrome.storage.sync.get(['sitePresetSpeeds']);
      const sitePresetSpeeds = data.sitePresetSpeeds || {};
      if (message.speed == null) {
        delete sitePresetSpeeds[message.hostname];
      } else {
        sitePresetSpeeds[message.hostname] = message.speed;
      }
      await chrome.storage.sync.set({ sitePresetSpeeds });
      return { success: true };
    }

    case 'getSitePresetSpeed': {
      const data = await chrome.storage.sync.get(['sitePresetSpeeds']);
      const sitePresetSpeeds = data.sitePresetSpeeds || {};
      return { speed: sitePresetSpeeds[message.hostname] ?? null };
    }

    case 'setPreservePitch': {
      const existing = await chrome.storage.sync.get(null);
      const updated = { ...existing, preservePitch: !!message.preservePitch };
      await chrome.storage.sync.set({ preservePitch: updated.preservePitch });
      const tabs = await chrome.tabs.query({});
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'settingsUpdated', settings: updated }).catch(() => {});
      });
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
        ...exportSync,
        timeSaved: typeof exportLocal.timeSaved === 'number' ? exportLocal.timeSaved : 0
      };
    }

    case 'importSettings': {
      const { timeSaved: importedTimeSaved, ...importSync } = message.settings || {};
      await chrome.storage.sync.set(importSync);
      if (typeof importedTimeSaved === 'number') {
        await chrome.storage.local.set({ timeSaved: importedTimeSaved });
        timeSavedCache = importedTimeSaved;
      }
      return { success: true };
    }

    case 'resetSettings': {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(DEFAULT_SETTINGS);
      await chrome.storage.local.set({ timeSaved: 0 });
      timeSavedCache = 0;
      return { success: true, settings: DEFAULT_SETTINGS };
    }

    case 'addTimeSaved': {
      const currentTimeSaved = await getTimeSavedValue();
      const newTimeSaved = currentTimeSaved + message.seconds;
      // Use batched local write for frequent time tracking updates
      setTimeSavedValue(newTimeSaved);
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
      const urlRules = ruleSettings.urlRules || [];
      const url = message.url;

      // Find matching rule (first match wins)
      for (const rule of urlRules) {
        try {
          // Try as regex first
          const regex = new RegExp(rule.pattern, 'i');
          if (regex.test(url)) {
            return { speed: rule.speed, matched: true, pattern: rule.pattern };
          }
        } catch {
          // Fall back to simple string match
          if (url.includes(rule.pattern)) {
            return { speed: rule.speed, matched: true, pattern: rule.pattern };
          }
        }
      }
      return { speed: null, matched: false };
    }

    case 'getIntroOutroSettings': {
      const introOutroData = await chrome.storage.sync.get([
        'introOutroEnabled',
        'defaultIntroSkip',
        'defaultOutroSkip',
        'autoSkipIntro',
        'skipIntroKey',
        'skipOutroKey',
        'introOutroSiteRules'
      ]);

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
      const filterData = await chrome.storage.sync.get(['savedFilters']);
      const savedFilters = filterData.savedFilters || {};
      savedFilters[message.hostname] = message.filters;
      // Use batched write for frequent filter adjustments
      batchedStorageSet({ savedFilters });
      return { success: true };
    }

    case 'getSavedFilters': {
      const filterData = await chrome.storage.sync.get(['savedFilters', 'rememberFilters']);
      if (filterData.rememberFilters && filterData.savedFilters) {
        return { filters: filterData.savedFilters[message.hostname] || null };
      }
      return { filters: null };
    }

    // Volume Boost
    case 'saveVolumeBoost': {
      const volumeData = await chrome.storage.sync.get(['savedVolumeBoost']);
      const savedVolumeBoost = volumeData.savedVolumeBoost || {};
      savedVolumeBoost[message.hostname] = message.level;
      // Use batched write for frequent volume adjustments
      batchedStorageSet({ savedVolumeBoost });
      return { success: true };
    }

    case 'getSavedVolumeBoost': {
      const volumeData = await chrome.storage.sync.get(['savedVolumeBoost', 'rememberVolumeBoost']);
      if (volumeData.rememberVolumeBoost && volumeData.savedVolumeBoost) {
        return { level: volumeData.savedVolumeBoost[message.hostname] || null };
      }
      return { level: null };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

function matchPattern(url, pattern) {
  if (!pattern) return false;
  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(url);
  } catch {
    return url.toLowerCase().includes(String(pattern).toLowerCase());
  }
}

async function checkSiteAccess(url) {
  const config = await chrome.storage.sync.get(['enabled', 'siteAccessMode', 'blacklist', 'whitelist']);
  
  // If 'enabled' is undefined (settings not initialized), treat as enabled
  // This handles fresh installs or cases where onInstalled didn't complete
  if (config.enabled === false) {
    return { blocked: true, reason: 'disabled' };
  }

  const mode = config.siteAccessMode || 'blacklist';
  if (mode === 'all') {
    return { blocked: false, reason: null };
  }

  const blacklist = config.blacklist || [];
  const whitelist = config.whitelist || [];

  if (mode === 'whitelist') {
    // If whitelist is empty, don't block (avoids accidentally blocking everything)
    if (whitelist.length === 0) {
      return { blocked: false, reason: null };
    }
    const allowed = whitelist.some(p => matchPattern(url, p));
    return { blocked: !allowed, reason: allowed ? null : 'not_whitelisted' };
  }

  // blacklist mode (default)
  const blocked = blacklist.some(p => matchPattern(url, p));
  return { blocked, reason: blocked ? 'blacklisted' : null };
}

// Listen for tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Content script is auto-injected via manifest, but we can send initial settings
    chrome.tabs.sendMessage(tabId, { type: 'tabReady' }).catch(() => {});
  }
});
