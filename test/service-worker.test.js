'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const VSCSettings = require('../shared/settings.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStorageArea(initial = {}) {
  const data = clone(initial);
  return {
    data,
    async get(keys) {
      if (keys == null) return clone(data);
      if (typeof keys === 'string') return { [keys]: clone(data[keys]) };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, clone(data[key])]));
      }
      return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [
        key,
        Object.hasOwn(data, key) ? clone(data[key]) : fallback
      ]));
    },
    async set(updates) {
      Object.assign(data, clone(updates));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    async clear() {
      for (const key of Object.keys(data)) delete data[key];
    }
  };
}

function createHarness(syncInitial = {}, localInitial = {}) {
  let messageListener;
  let installedListener;
  let commandListener;
  let tabRemovedListener;
  let tabUpdatedListener;
  const sync = createStorageArea(syncInitial);
  const local = createStorageArea(localInitial);
  const sentMessages = [];
  // Tests set this to control which frames answer and with what.
  let frameResponder = () => undefined;
  let activeTabs = [];
  const chrome = {
    storage: { sync, local },
    runtime: {
      onInstalled: { addListener(listener) { installedListener = listener; } },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    commands: { onCommand: { addListener(listener) { commandListener = listener; } } },
    tabs: {
      async query() { return activeTabs; },
      async sendMessage(tabId, message, options) {
        sentMessages.push({ tabId, message, frameId: options?.frameId ?? null });
        return frameResponder(tabId, message, options?.frameId ?? null);
      },
      onRemoved: { addListener(listener) { tabRemovedListener = listener; } },
      onUpdated: { addListener(listener) { tabUpdatedListener = listener; } }
    }
  };

  const context = vm.createContext({
    chrome,
    clearTimeout,
    console: { error() {}, log() {}, warn() {} },
    Date,
    importScripts() {},
    Map,
    Promise,
    setTimeout,
    VSCSettings
  });
  const workerPath = path.resolve(__dirname, '../background/service-worker.js');
  vm.runInContext(fs.readFileSync(workerPath, 'utf8'), context, { filename: workerPath });

  return {
    local,
    sync,
    sentMessages,
    install(details) {
      return installedListener(details);
    },
    send(message, sender = {}) {
      return new Promise(resolve => {
        const keepAlive = messageListener(message, sender, resolve);
        assert.equal(keepAlive, true);
      });
    },
    setActiveTabs(tabs) { activeTabs = tabs; },
    setFrameResponder(responder) { frameResponder = responder; },
    runCommand(command) { return commandListener(command); },
    removeTab(tabId) { return tabRemovedListener(tabId); },
    updateTab(tabId, changeInfo) { return tabUpdatedListener(tabId, changeInfo); },
    // Convenience: register a frame's media state the way a content script would.
    report(tabId, frameId, state) {
      return this.send({ type: 'reportMediaState', state }, { tab: { id: tabId }, frameId });
    }
  };
}

test('message handler merges concurrent collection writes without dropping entries', async () => {
  const harness = createHarness({ savedSpeeds: { 'existing.example': 1.5 } });

  const responses = await Promise.all([
    harness.send({ type: 'saveSpeed', hostname: 'one.example', speed: 2 }),
    harness.send({ type: 'saveSpeed', hostname: 'two.example', speed: 3 })
  ]);

  assert.deepEqual(responses.map(response => response.success), [true, true]);
  assert.deepEqual(harness.sync.data.savedSpeeds, {
    'existing.example': 1.5,
    'one.example': 2,
    'two.example': 3
  });
});

test('targeted settings updates preserve independently changing collections', async () => {
  const harness = createHarness({ enabled: true, savedSpeeds: { 'example.com': 2 } });
  const response = await harness.send({ type: 'updateSettings', updates: { enabled: false, unknown: 'ignored' } });

  assert.equal(response.success, true);
  assert.equal(harness.sync.data.enabled, false);
  assert.deepEqual(harness.sync.data.savedSpeeds, { 'example.com': 2 });
  assert.equal(harness.sync.data.unknown, undefined);
  assert.equal(typeof harness.sync.data.lastSyncTime, 'number');
});

test('import normalizes unsafe values and keeps time saved in local storage', async () => {
  const harness = createHarness();
  const response = await harness.send({
    type: 'importSettings',
    settings: {
      enabled: true,
      opacity: 50,
      controllerMode: 'oversized',
      savedSpeeds: { 'example.com': 100 },
      timeSaved: -20,
      unknown: 'ignored'
    }
  });

  assert.equal(response.success, true);
  assert.equal(harness.sync.data.opacity, 1);
  assert.equal(harness.sync.data.controllerMode, 'minimal');
  assert.deepEqual(harness.sync.data.savedSpeeds, { 'example.com': 16 });
  assert.equal(harness.sync.data.unknown, undefined);
  assert.equal(harness.local.data.timeSaved, 0);
});

test('extension update preserves an existing local time-saved counter', async () => {
  const harness = createHarness({ enabled: true }, { timeSaved: 1234 });
  await harness.install({ reason: 'update' });

  assert.equal(harness.local.data.timeSaved, 1234);
  assert.equal(harness.sync.data.enabled, true);
  assert.equal(harness.sync.data.timeSaved, undefined);
});

test('commands go to the playing frame instead of every frame in the tab', async () => {
  const harness = createHarness();
  harness.setActiveTabs([{ id: 7 }]);
  harness.setFrameResponder(() => ({ ok: true }));

  // A large paused player in the top frame, and a small playing video ad.
  await harness.report(7, 0, { hasMedia: true, playing: false, area: 640 * 360, isTop: true });
  await harness.report(7, 3, { hasMedia: true, playing: true, area: 300 * 250, isTop: false });

  await harness.runCommand('increase-speed');

  assert.equal(harness.sentMessages.length, 1);
  const [dispatched] = harness.sentMessages;
  assert.equal(dispatched.tabId, 7);
  assert.equal(dispatched.frameId, 3);
  assert.equal(dispatched.message.type, 'command');
  assert.equal(dispatched.message.command, 'increase-speed');
});

test('largest player wins when no frame is playing, with the top frame breaking ties', async () => {
  const harness = createHarness();
  harness.setActiveTabs([{ id: 1 }]);
  harness.setFrameResponder(() => ({ ok: true }));

  await harness.report(1, 0, { hasMedia: true, playing: false, area: 300 * 250, isTop: true });
  await harness.report(1, 2, { hasMedia: true, playing: false, area: 1280 * 720, isTop: false });
  await harness.runCommand('reset-speed');
  assert.equal(harness.sentMessages.at(-1).frameId, 2);

  // Equal areas fall back to the top frame rather than an embed.
  await harness.report(1, 2, { hasMedia: true, playing: false, area: 300 * 250, isTop: false });
  await harness.runCommand('reset-speed');
  assert.equal(harness.sentMessages.at(-1).frameId, 0);
});

test('frames that lose their media stop receiving commands', async () => {
  const harness = createHarness();
  harness.setActiveTabs([{ id: 4 }]);
  harness.setFrameResponder(() => ({ ok: true }));

  await harness.report(4, 5, { hasMedia: true, playing: true, area: 640 * 360, isTop: false });
  await harness.runCommand('increase-speed');
  assert.equal(harness.sentMessages.at(-1).frameId, 5);

  // Media removed: the registry empties and dispatch falls back to a tab-wide send.
  await harness.report(4, 5, { hasMedia: false, playing: false, area: 0, isTop: false });
  await harness.runCommand('increase-speed');
  assert.equal(harness.sentMessages.at(-1).frameId, null);
});

test('a dead frame falls back to a tab-wide send instead of dropping the command', async () => {
  const harness = createHarness();
  harness.setActiveTabs([{ id: 9 }]);
  harness.setFrameResponder((tabId, message, frameId) => {
    if (frameId === 6) throw new Error('Frame not found');
    return { ok: true };
  });

  await harness.report(9, 6, { hasMedia: true, playing: true, area: 640 * 360, isTop: false });
  await harness.runCommand('decrease-speed');

  assert.deepEqual(harness.sentMessages.map(entry => entry.frameId), [6, null]);

  // The dead frame is forgotten, so the next command does not retry it.
  await harness.runCommand('decrease-speed');
  assert.equal(harness.sentMessages.at(-1).frameId, null);
  assert.equal(harness.sentMessages.length, 3);
});

test('navigation and tab close clear the frame registry', async () => {
  const harness = createHarness();
  harness.setActiveTabs([{ id: 2 }]);
  harness.setFrameResponder(() => ({ ok: true }));

  await harness.report(2, 4, { hasMedia: true, playing: true, area: 640 * 360, isTop: false });
  harness.updateTab(2, { status: 'loading' });
  await harness.runCommand('reset-speed');
  assert.equal(harness.sentMessages.at(-1).frameId, null);

  await harness.report(2, 4, { hasMedia: true, playing: true, area: 640 * 360, isTop: false });
  harness.removeTab(2);
  await harness.runCommand('reset-speed');
  assert.equal(harness.sentMessages.at(-1).frameId, null);
});

test('popup relay reaches the elected frame and rejects unsupported message types', async () => {
  const harness = createHarness();
  harness.setFrameResponder(() => ({ success: true, speed: 2 }));
  await harness.report(3, 8, { hasMedia: true, playing: true, area: 640 * 360, isTop: false });

  const relayed = await harness.send({
    type: 'sendToActiveFrame',
    tabId: 3,
    message: { type: 'setSpeed', speed: 2 }
  });
  assert.equal(relayed.success, true);
  assert.equal(relayed.response.success, true);
  assert.equal(relayed.response.speed, 2);
  assert.equal(harness.sentMessages.at(-1).frameId, 8);

  const rejected = await harness.send({
    type: 'sendToActiveFrame',
    tabId: 3,
    message: { type: 'importSettings', settings: {} }
  });
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /Unsupported relay message/);
});

test('relay reports failure when no content script answers', async () => {
  const harness = createHarness();
  harness.setFrameResponder(() => undefined);

  const result = await harness.send({
    type: 'sendToActiveFrame',
    tabId: 5,
    message: { type: 'getActiveState' }
  });
  assert.equal(result.success, false);
});
