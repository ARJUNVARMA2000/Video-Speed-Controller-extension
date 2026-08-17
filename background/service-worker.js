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
let frameStateHydration = null;
let frameStateMutationQueue = Promise.resolve();
let syncSettingsCache = null;
let syncSettingsReadPromise = null;
let syncSettingsCacheGeneration = 0;
let syncCollectionIndexCache = null;
let syncLegacyCollectionKeysCache = null;

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

async function getCachedSyncSettings() {
  while (!syncSettingsCache) {
    if (!syncSettingsReadPromise) {
      const generation = syncSettingsCacheGeneration;
      syncSettingsReadPromise = chrome.storage.sync.get(null)
        .then(raw => ({
          generation,
          decoded: decodeSyncSnapshot(raw),
          collectionIndex: raw?.[COLLECTION_INDEX_KEY] || {},
          legacyCollectionKeys: new Set([...SYNC_COLLECTIONS]
            .filter(key => Object.prototype.hasOwnProperty.call(raw || {}, key)))
        }))
        .finally(() => { syncSettingsReadPromise = null; });
    }
    const { generation, decoded, collectionIndex, legacyCollectionKeys } = await syncSettingsReadPromise;
    // A storage change that landed during get(null) invalidated this snapshot.
    // Loop and fetch again instead of installing stale settings.
    if (generation === syncSettingsCacheGeneration) {
      syncSettingsCache = decoded;
      syncCollectionIndexCache = collectionIndex;
      syncLegacyCollectionKeysCache = legacyCollectionKeys;
    }
  }
  return syncSettingsCache;
}

function replaceSyncSettingsCache(snapshot, {
  collectionIndex = syncCollectionIndexCache,
  legacyCollectionKeys = syncLegacyCollectionKeysCache
} = {}) {
  syncSettingsCacheGeneration += 1;
  syncSettingsCache = snapshot;
  syncCollectionIndexCache = collectionIndex;
  syncLegacyCollectionKeysCache = legacyCollectionKeys;
}

function invalidateSyncSettingsCache() {
  syncSettingsCacheGeneration += 1;
  syncSettingsCache = null;
  syncCollectionIndexCache = null;
  syncLegacyCollectionKeysCache = null;
}

async function readSyncSettings(keys = null) {
  const decoded = await getCachedSyncSettings();
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

async function commitSyncPatch(current, next, changedKeys) {
  const nextPayload = buildSyncPayload(next);
  const nextFullIndex = nextPayload[COLLECTION_INDEX_KEY];
  const nextIndex = { ...(syncCollectionIndexCache || {}) };
  const legacyKeys = new Set(syncLegacyCollectionKeysCache || []);
  const updates = {};
  const staleKeys = new Set();
  const staleEntries = {};
  let touchesCollection = false;
  let currentPayload = null;

  for (const key of changedKeys) {
    if (!SYNC_COLLECTIONS.has(key)) {
      if (Object.prototype.hasOwnProperty.call(next, key)) updates[key] = next[key];
      else {
        staleKeys.add(key);
        if (Object.prototype.hasOwnProperty.call(current, key)) staleEntries[key] = current[key];
      }
      continue;
    }

    touchesCollection = true;
    const nextMetadata = nextFullIndex[key];
    const previousMetadata = syncCollectionIndexCache?.[key];
    nextIndex[key] = nextMetadata;
    for (let index = 0; index < nextMetadata.count; index += 1) {
      const chunkKey = collectionChunkKey(key, index);
      updates[chunkKey] = nextPayload[chunkKey];
    }
    for (let index = nextMetadata.count; index < (previousMetadata?.count || 0); index += 1) {
      const chunkKey = collectionChunkKey(key, index);
      staleKeys.add(chunkKey);
      currentPayload ||= buildSyncPayload(current);
      if (Object.prototype.hasOwnProperty.call(currentPayload, chunkKey)) staleEntries[chunkKey] = currentPayload[chunkKey];
    }
    if (legacyKeys.has(key)) {
      staleKeys.add(key);
      staleEntries[key] = current[key];
      legacyKeys.delete(key);
    }
  }

  if (touchesCollection) updates[COLLECTION_INDEX_KEY] = nextIndex;
  if (staleKeys.size > 0) await chrome.storage.sync.remove([...staleKeys]);
  try {
    if (Object.keys(updates).length > 0) await chrome.storage.sync.set(updates);
  } catch (error) {
    if (Object.keys(staleEntries).length > 0) await chrome.storage.sync.set(staleEntries).catch(() => {});
    throw error;
  }
  return { snapshot: next, collectionIndex: nextIndex, legacyCollectionKeys: legacyKeys };
}

function mutateSyncSettings(mutator, { changedKeys = null } = {}) {
  const operation = syncWriteQueue.then(async () => {
    const current = await readSyncSettings();
    const next = await mutator(current);
    if (changedKeys) {
      const patched = await commitSyncPatch(current, next, changedKeys);
      replaceSyncSettingsCache(patched.snapshot, patched);
      return next;
    }
    const committed = await commitSyncSnapshot(next);
    replaceSyncSettingsCache(committed, {
      collectionIndex: buildSyncPayload(committed)[COLLECTION_INDEX_KEY],
      legacyCollectionKeys: new Set()
    });
    return committed;
  });
  syncWriteQueue = operation.catch(() => {});
  return operation;
}

function writeSyncSettings(updates) {
  const operation = syncWriteQueue.then(async () => {
    const current = await readSyncSettings();
    const next = { ...current, ...updates };

    // Validate against the full quota while committing only changed scalars or
    // collection chunks.
    const committed = await commitSyncPatch(current, next, Object.keys(updates));
    replaceSyncSettingsCache(committed.snapshot, committed);
    return next;
  });
  syncWriteQueue = operation.catch(() => {});
  return operation;
}

function replaceSyncSettings(settings) {
  return mutateSyncSettings(() => settings);
}

// Keep the worker cache coherent with settings changed by Sync, another
// extension context, or this worker's own writes. Scalar changes can be patched
// in place; chunk/index changes require a fresh decode of the complete payload.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  const keys = Object.keys(changes);
  const touchesEncodedCollection = keys.some(key =>
    key === COLLECTION_INDEX_KEY || key.startsWith(COLLECTION_CHUNK_PREFIX) || SYNC_COLLECTIONS.has(key));
  if (touchesEncodedCollection || !syncSettingsCache) {
    invalidateSyncSettingsCache();
    return;
  }

  const next = { ...syncSettingsCache };
  for (const [key, change] of Object.entries(changes)) {
    if (change.newValue === undefined) delete next[key];
    else next[key] = change.newValue;
  }
  replaceSyncSettingsCache(next);
});

// Per-tab media frame registry. Content scripts run in every frame, so commands
// have to be routed to one elected frame instead of broadcast to all of them.
// Session storage survives normal Manifest V3 worker suspension without leaking
// this ephemeral state across browser restarts.
const ACTIVE_FRAME_RELAY_TYPES = new Set(['getActiveState', 'setSpeed', 'togglePlayback']);
const FRAME_STATE_SESSION_PREFIX = '__vscFrameMediaStates:';
const frameMediaStates = new Map(); // Map<tabId, Map<frameId, { state }>>

function frameStateSessionKey(tabId) {
  return `${FRAME_STATE_SESSION_PREFIX}${tabId}`;
}

async function hydrateFrameMediaStates() {
  if (frameStateHydration) return await frameStateHydration;
  frameStateHydration = (async () => {
    const stored = await chrome.storage.session.get(null);
    for (const [key, rawFrames] of Object.entries(stored)) {
      if (!key.startsWith(FRAME_STATE_SESSION_PREFIX) || !rawFrames || typeof rawFrames !== 'object') continue;
      const tabId = Number(key.slice(FRAME_STATE_SESSION_PREFIX.length));
      if (!Number.isInteger(tabId)) continue;

      const frames = new Map();
      for (const [rawFrameId, state] of Object.entries(rawFrames)) {
        const frameId = Number(rawFrameId);
        if (Number.isInteger(frameId) && state?.hasMedia) frames.set(frameId, { state });
      }
      if (frames.size > 0) frameMediaStates.set(tabId, frames);
    }
  })();
  return await frameStateHydration;
}

async function persistTabFrameStates(tabId) {
  const key = frameStateSessionKey(tabId);
  const frames = frameMediaStates.get(tabId);
  if (!frames?.size) {
    await chrome.storage.session.remove(key);
    return;
  }
  await chrome.storage.session.set({
    [key]: Object.fromEntries([...frames].map(([frameId, entry]) => [frameId, entry.state]))
  });
}

function mutateTabFrameStates(tabId, mutator) {
  const operation = frameStateMutationQueue.then(async () => {
    await hydrateFrameMediaStates();
    const changed = mutator();
    if (changed === false) return false;
    await persistTabFrameStates(tabId);
    return true;
  });
  frameStateMutationQueue = operation.catch(() => {});
  return operation;
}

function recordFrameMediaState(sender, state) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') return Promise.resolve();
  const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;

  return mutateTabFrameStates(tabId, () => {
    let frames = frameMediaStates.get(tabId);
    if (!frames && !state?.hasMedia) return false;
    if (!frames) {
      frames = new Map();
      frameMediaStates.set(tabId, frames);
    }

    const previous = frames.get(frameId)?.state;
    if (state?.hasMedia) {
      if (previous && previous.hasMedia === true &&
          previous.playing === state.playing &&
          previous.area === state.area &&
          previous.isTop === state.isTop) return false;
      frames.set(frameId, { state });
    } else {
      if (!frames.has(frameId)) return false;
      frames.delete(frameId);
    }

    if (frames.size === 0) frameMediaStates.delete(tabId);
    return true;
  });
}

function clearTabFrameMediaStates(tabId) {
  return mutateTabFrameStates(tabId, () => frameMediaStates.delete(tabId));
}

function forgetFrameMediaState(tabId, frameId) {
  return mutateTabFrameStates(tabId, () => {
    const frames = frameMediaStates.get(tabId);
    if (!frames?.has(frameId)) return false;
    frames?.delete(frameId);
    if (frames?.size === 0) frameMediaStates.delete(tabId);
    return true;
  });
}

function scoreFrame({ state }) {
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
  await frameStateMutationQueue;
  await hydrateFrameMediaStates();
  const candidates = rankActiveFrames(tabId);
  for (const frameId of candidates) {
    try {
      return await chrome.tabs.sendMessage(tabId, message, { frameId });
    } catch {
      // The frame went away between reporting and dispatch. Drop it and retry
      // the next ranked reporter. Never omit frameId: doing so broadcasts the
      // command to every content script in the tab.
      await forgetFrameMediaState(tabId, frameId);
    }
  }

  // A newly navigated tab may not have reported yet. The top frame is the only
  // safe fallback; an explicit frameId guarantees at-most-once dispatch.
  if (!candidates.includes(0)) {
    return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => undefined);
  }
  return undefined;
}

chrome.tabs.onRemoved.addListener(tabId => {
  clearTabFrameMediaStates(tabId).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // A new navigation invalidates every frame the old document reported.
  if (changeInfo.status === 'loading') clearTabFrameMediaStates(tabId).catch(() => {});
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
    }, { changedKeys: [...batch.keys()] });
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
      await recordFrameMediaState(sender, message.state);
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
      const [syncSettings, timeSaved] = await Promise.all([
        readSyncSettings(),
        getTimeSavedValue()
      ]);
      return { ...normalizeSettings(syncSettings), timeSaved };
    }

    case 'getContentSettings':
      // Content frames do not display the local aggregate statistic. Keeping it
      // out of their startup path avoids a second storage-area read per frame.
      return normalizeSettings(await readSyncSettings());

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
      const [exportSync, exportTimeSaved] = await Promise.all([
        readSyncSettings(),
        getTimeSavedValue()
      ]);
      return {
        ...normalizeSettings(exportSync),
        timeSaved: exportTimeSaved
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
