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
let syncWriteQueue = Promise.resolve();
let timeSavedWriteQueue = Promise.resolve();
let timeSavedCache = null;

const SYNC_COLLECTIONS = new Set([
  'blacklist',
  'whitelist',
  'savedSpeeds',
  'sitePresetSpeeds',
  'urlRules',
  'introOutroSiteRules',
  'savedFilters',
  'savedVolumeBoost'
]);
const ARRAY_COLLECTIONS = new Set(['blacklist', 'whitelist', 'urlRules', 'introOutroSiteRules']);
const COLLECTION_INDEX_KEY = '__vscCollectionIndex';
const COLLECTION_CHUNK_PREFIX = '__vscChunk:';
const SYNC_ITEM_BUDGET_BYTES = 7600;
const SYNC_TOTAL_BUDGET_BYTES = 95000;

function utf8ByteLength(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function collectionChunkKey(collection, index) {
  return `${COLLECTION_CHUNK_PREFIX}${collection}:${index}`;
}

function splitCollection(collection, value) {
  const isArray = ARRAY_COLLECTIONS.has(collection);
  const entries = isArray ? [...(Array.isArray(value) ? value : [])] : Object.entries(value || {});
  const chunks = [];
  let chunk = isArray ? [] : {};

  for (const entry of entries) {
    const candidate = isArray ? [...chunk, entry] : { ...chunk, [entry[0]]: entry[1] };
    if (utf8ByteLength(candidate) > SYNC_ITEM_BUDGET_BYTES) {
      if ((isArray ? chunk.length : Object.keys(chunk).length) === 0) {
        throw new Error(`${collection} contains an entry too large to sync`);
      }
      chunks.push(chunk);
      chunk = isArray ? [entry] : { [entry[0]]: entry[1] };
      if (utf8ByteLength(chunk) > SYNC_ITEM_BUDGET_BYTES) {
        throw new Error(`${collection} contains an entry too large to sync`);
      }
    } else {
      chunk = candidate;
    }
  }

  if ((isArray ? chunk.length : Object.keys(chunk).length) > 0) chunks.push(chunk);
  return { type: isArray ? 'array' : 'object', chunks };
}

function decodeSyncSnapshot(raw) {
  const result = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (key === COLLECTION_INDEX_KEY || key.startsWith(COLLECTION_CHUNK_PREFIX)) continue;
    result[key] = value;
  }

  const index = raw?.[COLLECTION_INDEX_KEY] || {};
  for (const collection of SYNC_COLLECTIONS) {
    const metadata = index[collection];
    if (!metadata) continue;
    const chunks = [];
    for (let chunkIndex = 0; chunkIndex < metadata.count; chunkIndex += 1) {
      const chunk = raw[collectionChunkKey(collection, chunkIndex)];
      if (chunk !== undefined) chunks.push(chunk);
    }
    result[collection] = metadata.type === 'array'
      ? chunks.flat()
      : Object.assign({}, ...chunks);
  }
  return result;
}

async function readSyncSettings(keys = null) {
  const decoded = decodeSyncSnapshot(await chrome.storage.sync.get(null));
  if (keys == null) return decoded;
  const requested = typeof keys === 'string' ? [keys] : keys;
  return Object.fromEntries(requested
    .filter(key => Object.prototype.hasOwnProperty.call(decoded, key))
    .map(key => [key, decoded[key]]));
}

function buildSyncPayload(snapshot) {
  const payload = {};
  const collectionIndex = {};
  for (const [key, value] of Object.entries(snapshot || {})) {
    if (!SYNC_COLLECTIONS.has(key) && key !== COLLECTION_INDEX_KEY && !key.startsWith(COLLECTION_CHUNK_PREFIX)) {
      payload[key] = value;
    }
  }

  for (const collection of SYNC_COLLECTIONS) {
    const { type, chunks } = splitCollection(collection, snapshot?.[collection]);
    collectionIndex[collection] = { type, count: chunks.length };
    chunks.forEach((chunk, index) => {
      payload[collectionChunkKey(collection, index)] = chunk;
    });
  }
  payload[COLLECTION_INDEX_KEY] = collectionIndex;

  let totalBytes = 0;
  for (const [key, value] of Object.entries(payload)) {
    const itemBytes = utf8ByteLength(key) + utf8ByteLength(value);
    if (itemBytes > 8192) throw new Error(`Sync item ${key} exceeds Chrome's 8 KB quota`);
    totalBytes += itemBytes;
  }
  if (totalBytes > SYNC_TOTAL_BUDGET_BYTES) {
    throw new Error('Settings exceed the safe Chrome Sync budget; remove some site or URL rules');
  }
  return payload;
}

async function commitSyncSnapshot(snapshot) {
  const payload = buildSyncPayload(snapshot);
  const existing = await chrome.storage.sync.get(null);
  const staleKeys = Object.keys(existing).filter(key => !Object.prototype.hasOwnProperty.call(payload, key));
  // Removing obsolete chunks after the write can temporarily exceed Chrome's
  // total Sync quota even though the final snapshot is within budget. Remove
  // them first and restore them if the atomic set fails, so migrations and
  // shrinking collections are both quota-safe and recoverable.
  const staleEntries = Object.fromEntries(staleKeys.map(key => [key, existing[key]]));
  if (staleKeys.length > 0) await chrome.storage.sync.remove(staleKeys);
  try {
    await chrome.storage.sync.set(payload);
  } catch (error) {
    if (staleKeys.length > 0) await chrome.storage.sync.set(staleEntries).catch(() => {});
    throw error;
  }
  return snapshot;
}

function mutateSyncSettings(mutator) {
  const operation = syncWriteQueue.then(async () => {
    const current = await readSyncSettings();
    const next = await mutator(current);
    return await commitSyncSnapshot(next);
  });
  syncWriteQueue = operation.catch(() => {});
  return operation;
}

function writeSyncSettings(updates) {
  return mutateSyncSettings(current => ({ ...current, ...updates }));
}

function replaceSyncSettings(settings) {
  return mutateSyncSettings(() => settings);
}

// Per-tab media frame registry. Content scripts run in every frame, so commands
// have to be routed to one elected frame instead of broadcast to all of them.
const FRAME_STATE_TTL = 5 * 60 * 1000;
const ACTIVE_FRAME_RELAY_TYPES = new Set(['getActiveState', 'setSpeed', 'togglePlayback']);
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

function rankActiveFrames(tabId) {
  const frames = frameMediaStates.get(tabId);
  if (!frames) return [];
  return [...frames.entries()]
    .map(([frameId, entry]) => ({ frameId, score: scoreFrame(entry) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.frameId);
}

function pickActiveFrame(tabId) {
  return rankActiveFrames(tabId)[0] ?? null;
}

async function sendToActiveFrame(tabId, message) {
  const candidates = rankActiveFrames(tabId);
  for (const frameId of candidates) {
    try {
      return await chrome.tabs.sendMessage(tabId, message, { frameId });
    } catch {
      // The frame went away between reporting and dispatch. Drop it and retry
      // the next ranked reporter. Never omit frameId: doing so broadcasts the
      // command to every content script in the tab.
      frameMediaStates.get(tabId)?.delete(frameId);
    }
  }

  // A newly navigated tab may not have reported yet. The top frame is the only
  // safe fallback; an explicit frameId guarantees at-most-once dispatch.
  if (!candidates.includes(0)) {
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => undefined);
  }
  return undefined;
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
    const updates = {};
    await mutateSyncSettings(current => {
      for (const [collection, pending] of batch) {
        const next = { ...(current[collection] || {}) };
        for (const [entryKey, value] of pending.entries) {
          if (value === null || value === undefined) delete next[entryKey];
          else next[entryKey] = value;
        }
        updates[collection] = sanitizeSettingsPatch({ [collection]: next })[collection] || {};
      }
      return { ...current, ...updates };
    });
    // Every live frame owns one normalized snapshot. Keep collection changes
    // coherent without resending unrelated settings or asking each frame to
    // reread storage.
    await notifyTabs(updates);
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

async function notifyTabs(settings, { replace = false } = {}) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab =>
    chrome.tabs.sendMessage(tab.id, replace
      ? { type: 'settingsUpdated', settings, replace: true }
      : { type: 'settingsUpdated', patch: settings })
  ));
}

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await replaceSyncSettings(createDefaultSettings());
    await chrome.storage.local.set({ timeSaved: 0 });
    timeSavedCache = 0;
    console.log('Video Speed Pro: Default settings initialized');
  } else if (details.reason === 'update') {
    // Merge new default settings with existing ones
    const [existing, existingLocal] = await Promise.all([
      readSyncSettings(),
      chrome.storage.local.get(['timeSaved'])
    ]);
    const existingTimeSaved = typeof existing.timeSaved === 'number' ? existing.timeSaved : null;
    const localTimeSaved = typeof existingLocal.timeSaved === 'number' ? existingLocal.timeSaved : null;
    const migratedTimeSaved = existingTimeSaved ?? localTimeSaved ?? 0;
    const merged = normalizeSettings(existing);
    await replaceSyncSettings(merged);
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
        readSyncSettings(),
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
      const current = normalizeSettings(await writeSyncSettings({ ...updates, lastSyncTime }));
      await notifyTabs({ ...updates, lastSyncTime });
      return { success: true, settings: current, lastSyncTime };
    }

    case 'getSavedSpeed': {
      const settings = await readSyncSettings(['savedSpeeds', 'rememberSpeed']);
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
      const data = await readSyncSettings(['sitePresetSpeeds']);
      const sitePresetSpeeds = sanitizeSettingsPatch({ sitePresetSpeeds: data.sitePresetSpeeds }).sitePresetSpeeds || {};
      return { speed: sitePresetSpeeds[message.hostname] ?? null };
    }

    case 'setPreservePitch': {
      await writeSyncSettings({ preservePitch: message.preservePitch === true });
      await notifyTabs({ preservePitch: message.preservePitch === true });
      return { success: true };
    }

    case 'checkBlacklist':
      // Back-compat alias for checkSiteAccess
      return await checkSiteAccess(message.url);

    case 'checkSiteAccess':
      return await checkSiteAccess(message.url);

    case 'exportSettings': {
      const [exportSync, exportLocal] = await Promise.all([
        readSyncSettings(),
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
      await replaceSyncSettings(importSync);
      await chrome.storage.local.set({ timeSaved: importedTimeSaved });
      timeSavedCache = importedTimeSaved;
      await notifyTabs(importSync, { replace: true });
      return { success: true, settings: { ...importSync, timeSaved: importedTimeSaved } };
    }

    case 'resetSettings': {
      await flushCollectionWrites();
      const defaults = createDefaultSettings();
      await replaceSyncSettings(defaults);
      await chrome.storage.local.set({ timeSaved: 0 });
      timeSavedCache = 0;
      await notifyTabs(defaults, { replace: true });
      return { success: true, settings: { ...defaults, timeSaved: 0 } };
    }

    case 'addTimeSaved': {
      const newTimeSaved = await addTimeSaved(message.seconds);
      return { success: true, timeSaved: newTimeSaved };
    }

    case 'updateSyncTime': {
      const syncTime = Date.now();
      await writeSyncSettings({ lastSyncTime: syncTime });
      return { success: true, lastSyncTime: syncTime };
    }

    case 'getSyncStatus': {
      const syncData = await readSyncSettings(['lastSyncTime']);
      return { lastSyncTime: syncData.lastSyncTime || null };
    }

    case 'getUrlRuleSpeed': {
      const ruleSettings = await readSyncSettings(['urlRules']);
      return findUrlRule(message.url, ruleSettings.urlRules || []);
    }

    case 'getIntroOutroSettings': {
      const introOutroData = normalizeSettings(await readSyncSettings([
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
      const filterData = await readSyncSettings(['savedFilters', 'rememberFilters']);
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
      const volumeData = await readSyncSettings(['savedVolumeBoost', 'rememberVolumeBoost']);
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
  const config = await readSyncSettings(['enabled', 'siteAccessMode', 'blacklist', 'whitelist']);
  return resolveSiteAccess(url, config);
}
