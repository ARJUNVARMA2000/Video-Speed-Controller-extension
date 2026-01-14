// Service Worker for Video Speed Controller Extension

const DEFAULT_SETTINGS = {
  enabled: true,
  hideByDefault: false,
  rememberSpeed: true,
  forceSpeed: false,
  workOnAudio: false,
  opacity: 0.8,
  autoHideDelay: 0,
  controllerMode: 'minimal',
  showPipIndicator: true,
  shortcuts: [
    { action: 'show-controller', key: 'V', modifiers: [], enabled: true },
    { action: 'decrease-speed', key: 'S', modifiers: [], value: 0.1, enabled: true },
    { action: 'increase-speed', key: 'D', modifiers: [], value: 0.1, enabled: true },
    { action: 'rewind', key: 'Z', modifiers: [], value: 10, enabled: true },
    { action: 'advance', key: 'X', modifiers: [], value: 10, enabled: true },
    { action: 'reset-speed', key: 'R', modifiers: [], value: 1.0, enabled: true },
    { action: 'preferred-speed', key: 'G', modifiers: [], value: 3.0, enabled: true },
    { action: 'frame-forward', key: '.', modifiers: [], enabled: true },
    { action: 'frame-backward', key: ',', modifiers: [], enabled: true }
  ],
  blacklist: [],
  savedSpeeds: {},
  timeSaved: 0,
  urlRules: [],
  lastSyncTime: null
};

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    console.log('Video Speed Controller: Default settings initialized');
  } else if (details.reason === 'update') {
    // Merge new default settings with existing ones
    const existing = await chrome.storage.sync.get(null);
    const merged = { ...DEFAULT_SETTINGS, ...existing };
    await chrome.storage.sync.set(merged);
    console.log('Video Speed Controller: Settings migrated');
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
    case 'getSettings':
      return await chrome.storage.sync.get(null);

    case 'saveSettings':
      await chrome.storage.sync.set(message.settings);
      // Notify all tabs about settings update
      const tabs = await chrome.tabs.query({});
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'settingsUpdated', settings: message.settings }).catch(() => {});
      });
      return { success: true };

    case 'getSavedSpeed':
      const settings = await chrome.storage.sync.get(['savedSpeeds', 'rememberSpeed']);
      if (settings.rememberSpeed && settings.savedSpeeds) {
        return { speed: settings.savedSpeeds[message.hostname] || null };
      }
      return { speed: null };

    case 'saveSpeed':
      const current = await chrome.storage.sync.get(['savedSpeeds']);
      const savedSpeeds = current.savedSpeeds || {};
      savedSpeeds[message.hostname] = message.speed;
      await chrome.storage.sync.set({ savedSpeeds });
      return { success: true };

    case 'checkBlacklist':
      const config = await chrome.storage.sync.get(['blacklist', 'enabled']);
      if (!config.enabled) {
        return { blocked: true, reason: 'disabled' };
      }
      const blacklist = config.blacklist || [];
      const isBlocked = blacklist.some(pattern => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(message.url);
        } catch {
          return message.url.includes(pattern);
        }
      });
      return { blocked: isBlocked, reason: isBlocked ? 'blacklisted' : null };

    case 'exportSettings':
      return await chrome.storage.sync.get(null);

    case 'importSettings':
      await chrome.storage.sync.set(message.settings);
      return { success: true };

    case 'resetSettings':
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(DEFAULT_SETTINGS);
      return { success: true, settings: DEFAULT_SETTINGS };

    case 'addTimeSaved':
      const timeData = await chrome.storage.sync.get(['timeSaved']);
      const newTimeSaved = (timeData.timeSaved || 0) + message.seconds;
      await chrome.storage.sync.set({ timeSaved: newTimeSaved });
      return { success: true, timeSaved: newTimeSaved };

    case 'updateSyncTime':
      const syncTime = Date.now();
      await chrome.storage.sync.set({ lastSyncTime: syncTime });
      return { success: true, lastSyncTime: syncTime };

    case 'getSyncStatus':
      const syncData = await chrome.storage.sync.get(['lastSyncTime']);
      return { lastSyncTime: syncData.lastSyncTime || null };

    case 'getUrlRuleSpeed':
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

    default:
      return { error: 'Unknown message type' };
  }
}

// Listen for tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Content script is auto-injected via manifest, but we can send initial settings
    chrome.tabs.sendMessage(tabId, { type: 'tabReady' }).catch(() => {});
  }
});
