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
  const sync = createStorageArea(syncInitial);
  const local = createStorageArea(localInitial);
  const chrome = {
    storage: { sync, local },
    runtime: {
      onInstalled: { addListener(listener) { installedListener = listener; } },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    commands: { onCommand: { addListener() {} } },
    tabs: {
      async query() { return []; },
      async sendMessage() {}
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
    install(details) {
      return installedListener(details);
    },
    send(message) {
      return new Promise(resolve => {
        const keepAlive = messageListener(message, {}, resolve);
        assert.equal(keepAlive, true);
      });
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
