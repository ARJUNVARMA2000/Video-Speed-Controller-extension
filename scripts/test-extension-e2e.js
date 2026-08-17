'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const extensionPath = path.resolve(__dirname, '..');
const fixtureRoot = path.resolve(__dirname, '../test/manual');
const host = '127.0.0.1';
let activePhase = 'startup';

function phase(name) {
  activePhase = name;
}

function startServer() {
  const server = http.createServer((request, response) => {
    const requestedPath = new URL(request.url, `http://${host}`).pathname;
    const pathname = requestedPath === '/' ? '/media.html' : requestedPath;
    const filePath = path.resolve(fixtureRoot, `.${pathname}`);
    if (!filePath.startsWith(`${fixtureRoot}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
        return;
      }
      const types = { '.html': 'text/html; charset=utf-8', '.webm': 'video/webm' };
      response.writeHead(200, {
        'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      response.end(content);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve({ server, port: server.address().port }));
  });
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function waitForController(page, expected = 1) {
  await page.waitForFunction(count =>
    document.querySelectorAll('.vsc-host-controller').length === count, expected);
}

async function runYouTubeSmoke(context) {
  const page = await context.newPage();
  try {
    await page.goto('https://www.youtube.com/watch?v=M7lc1UVf-VE', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    const video = page.locator('video.html5-main-video');
    await video.waitFor({ state: 'visible', timeout: 30000 });
    await waitForController(page);
    await video.evaluate(media => {
      media.muted = true;
      media.playbackRate = 1;
      media.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    await page.keyboard.press('d');
    await page.waitForFunction(() => Math.abs(document.querySelector('video.html5-main-video').playbackRate - 1.1) < 0.001);
    console.log('Real-site smoke passed: YouTube HTML5 player and keyboard control.');
  } finally {
    await page.close();
  }
}

async function run() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsc-e2e-'));
  const { server, port } = await startServer();
  let context;
  const startedAt = Date.now();

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    assert.match(extensionId, /^[a-p]{32}$/);

    const page = context.pages()[0] || await context.newPage();
    const debugSession = await context.newCDPSession(page);
    const parsedExtensionScripts = [];
    debugSession.on('Debugger.scriptParsed', event => {
      if (event.url.startsWith('chrome-extension://')) parsedExtensionScripts.push(event.url);
    });
    await debugSession.send('Debugger.enable');

    phase('lazy bootstrap and pre-activation settings');
    // A page without media should pay only for the byte-budgeted bootstrap: the
    // 100+ KB feature runtime must remain unparsed until media actually exists.
    await page.goto(`http://${host}:${port}/empty.html`);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.vsc-shadow-host').count(), 0);
    assert.ok(parsedExtensionScripts.some(url => url.endsWith('/content/bootstrap.js')),
      `bootstrap was not observed in parsed scripts: ${parsedExtensionScripts.join(', ')}`);
    assert.equal(parsedExtensionScripts.some(url => url.endsWith('/content/logic.js')), false,
      'content logic loaded on a no-media page');
    assert.equal(parsedExtensionScripts.some(url => url.endsWith('/content/content.js')), false,
      'full content runtime loaded on a no-media page');

    // A settings broadcast before activation is intentionally ignored by the
    // bootstrap; once media arrives the runtime must read the newest snapshot.
    // Insert two players in the import window to prove its final scan loses none.
    const setupPage = await context.newPage();
    await setupPage.goto(`chrome-extension://${extensionId}/popup/compact.html`);
    const disabled = await setupPage.evaluate(() => chrome.runtime.sendMessage({
      type: 'updateSettings', updates: { enabled: false }
    }));
    assert.equal(disabled.success, true);
    await page.bringToFront();
    await page.evaluate(() => {
      for (const id of ['lazy-first', 'lazy-second']) {
        const video = document.createElement('video');
        video.id = id;
        video.style.cssText = 'width:640px;height:360px';
        document.body.append(video);
      }
    });
    await page.waitForTimeout(400);
    assert.ok(parsedExtensionScripts.some(url => url.endsWith('/content/content.js')),
      'media did not trigger the lazy runtime');
    assert.ok(parsedExtensionScripts.some(url => url.endsWith('/content/logic.js')),
      'media did not trigger the testable content logic module');
    assert.equal(await page.locator('.vsc-host-controller').count(), 0,
      'runtime ignored the disabled setting read during activation');

    const enabled = await setupPage.evaluate(() => chrome.runtime.sendMessage({
      type: 'updateSettings', updates: { enabled: true }
    }));
    assert.equal(enabled.success, true);
    await waitForController(page);
    await page.locator('#lazy-second').evaluate(video =>
      video.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await page.keyboard.press('d');
    await page.waitForFunction(() => document.querySelector('#lazy-second').playbackRate === 1.1);
    assert.equal(await page.locator('#lazy-first').evaluate(video => video.playbackRate), 1);
    await page.locator('#lazy-first, #lazy-second').evaluateAll(videos => videos.forEach(video => video.remove()));
    await waitForController(page, 0);
    await setupPage.close();

    phase('core media controls');
    await page.goto(`http://${host}:${port}/media.html`);
    await waitForController(page);
    assert.ok(parsedExtensionScripts.some(url => url.endsWith('/content/content.js')),
      `content runtime did not load after media appeared: ${parsedExtensionScripts.join(', ')}`);
    assert.equal(await page.locator('.vsc-wrapper').count(), 0, 'media must never be reparented into wrappers');
    assert.equal(await page.locator('#primary-video').evaluate(video => video.parentElement.className), 'media-card');

    // Duplicate scroll events with unchanged geometry must be absorbed in the
    // content frame instead of rewriting restart-safe session routing state.
    await page.waitForTimeout(350);
    const sessionWriteProbe = await worker.evaluate(() => {
      const originalSet = chrome.storage.session.set.bind(chrome.storage.session);
      globalThis.__vscSessionSetCalls = 0;
      const wrappedSet = (...args) => {
        globalThis.__vscSessionSetCalls += 1;
        return originalSet(...args);
      };
      chrome.storage.session.set = wrappedSet;
      return chrome.storage.session.set === wrappedSet;
    });
    assert.equal(sessionWriteProbe, true);
    await page.evaluate(() => {
      for (let index = 0; index < 50; index += 1) window.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(350);
    assert.equal(await worker.evaluate(() => globalThis.__vscSessionSetCalls), 0);

    // A dynamically played video becomes active; the configured keyboard step
    // must affect it and not the older playing video.
    await page.locator('#toggle-play').click();
    await page.locator('#add-video').click();
    await page.waitForSelector('#dynamic-video');
    await page.waitForFunction(() => !document.querySelector('#dynamic-video').paused);
    await page.keyboard.press('d');
    await page.waitForTimeout(250);
    const activeRates = await page.locator('video').evaluateAll(videos => videos.map(video => video.playbackRate));
    assert.ok(Math.abs(activeRates[1] - 1.1) < 0.001, `unexpected active-media rates: ${activeRates.join(', ')}`);
    assert.equal(activeRates[0], 1);

    // A site-side rate reset inside the bounded enforcement window is repaired.
    await page.locator('#dynamic-video').evaluate(video => { video.playbackRate = 1; });
    await page.waitForFunction(() => Math.abs(document.querySelector('#dynamic-video').playbackRate - 1.1) < 0.001);

    phase('shortcut routing and popup relay');
    // Full modifier chords survive settings normalization and execute only on
    // the elected media. Capture the media tab before opening an extension tab.
    await page.bringToFront();
    const tabId = await worker.evaluate(async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
    assert.equal(typeof tabId, 'number');
    const extensionPage = await context.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup/compact.html`);
    await extensionPage.waitForSelector('#presets button');
    assert.equal(await extensionPage.locator('#presets button').count(), 7);
    const chordSettings = await extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'getSettings' }));
    chordSettings.shortcuts = chordSettings.shortcuts.map(shortcut => shortcut.action === 'increase-speed'
      ? { ...shortcut, key: 'K', modifiers: ['Control', 'Shift'], value: 0.25 }
      : shortcut);
    const chordUpdate = await extensionPage.evaluate(shortcuts => chrome.runtime.sendMessage({
      type: 'updateSettings', updates: { shortcuts }
    }), chordSettings.shortcuts);
    assert.equal(chordUpdate.success, true);
    await page.waitForTimeout(200);
    await extensionPage.evaluate(tab => chrome.runtime.sendMessage({
      type: 'sendToActiveFrame', tabId: tab, message: { type: 'setSpeed', speed: 1 }
    }), tabId);
    await page.bringToFront();
    await page.locator('#dynamic-video').evaluate(video =>
      video.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await page.keyboard.press('Control+Shift+K');
    await page.waitForFunction(() => Math.abs(document.querySelector('#dynamic-video').playbackRate - 1.25) < 0.001);

    phase('silence acceleration override');
    // Silence acceleration must yield cleanly to an explicit user speed. The
    // fixture intentionally has no audio track, so it is deterministic silence
    // without microphone, network, or codec timing dependencies.
    const silenceUpdate = await extensionPage.evaluate(() => chrome.runtime.sendMessage({
      type: 'updateSettings',
      updates: {
        silenceSkipEnabled: true,
        silenceThreshold: 0.2,
        silenceMinDuration: 1,
        silenceSkipSpeed: 4
      }
    }));
    assert.equal(silenceUpdate.success, true);
    await page.waitForFunction(() => Math.abs(document.querySelector('#dynamic-video').playbackRate - 4) < 0.001, null, {
      timeout: 3000
    });
    const manualSpeed = await extensionPage.evaluate(tab => chrome.runtime.sendMessage({
      type: 'sendToActiveFrame', tabId: tab, message: { type: 'setSpeed', speed: 1.5 }
    }), tabId);
    assert.equal(manualSpeed.success, true);
    await page.locator('#dynamic-video').evaluate(video => { video.playbackRate = 1; });
    await page.waitForFunction(() => Math.abs(document.querySelector('#dynamic-video').playbackRate - 1.5) < 0.001, null, {
      timeout: 500
    });
    await page.waitForTimeout(250);
    assert.ok(Math.abs(await page.locator('#dynamic-video').evaluate(video => video.playbackRate) - 1.5) < 0.001,
      'silence skipping overrode an explicit user speed before a fresh quiet window elapsed');
    await extensionPage.evaluate(() => chrome.runtime.sendMessage({
      type: 'updateSettings', updates: { silenceSkipEnabled: false }
    }));

    phase('deferred thumbnail growth');
    // Thumbnail-sized media is deferred without polling, then becomes
    // controllable as soon as the same element expands into a real player.
    await page.locator('video').evaluateAll(videos => videos.forEach(video => video.pause()));
    await page.evaluate(() => {
      const video = document.createElement('video');
      video.id = 'deferred-video';
      video.src = 'sample.webm';
      video.muted = true;
      video.loop = true;
      video.playbackRate = 0.8;
      video.style.width = '50px';
      video.style.height = '50px';
      document.body.append(video);
    });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#deferred-video').evaluate(video => video.playbackRate), 0.8);
    await page.locator('#deferred-video').evaluate(video => {
      video.style.width = '640px';
      video.style.height = '360px';
      return video.play();
    });
    let deferredAttached = false;
    for (let attempt = 0; attempt < 20 && !deferredAttached; attempt += 1) {
      await page.waitForTimeout(100);
      await extensionPage.evaluate(tab => chrome.runtime.sendMessage({
        type: 'sendToActiveFrame', tabId: tab, message: { type: 'setSpeed', speed: 1 }
      }), tabId);
      deferredAttached = Math.abs(await page.locator('#deferred-video').evaluate(video => video.playbackRate) - 1) < 0.001;
    }
    assert.equal(deferredAttached, true, 'expanded thumbnail media was never attached and elected');
    await page.keyboard.press('Control+Shift+K');
    await page.waitForFunction(() => Math.abs(document.querySelector('#deferred-video').playbackRate - 1.25) < 0.001, null, {
      timeout: 1000
    });
    await page.locator('#deferred-video').evaluate(video => video.remove());

    phase('open shadow media');
    // Media in an open shadow root is discovered and controls the same portal.
    await page.locator('video').evaluateAll(videos => videos.forEach(video => video.pause()));
    await page.locator('#add-shadow-host').click();
    const shadowHost = page.locator('[data-shadow-case="host"]');
    await shadowHost.waitFor();
    await shadowHost.evaluate(hostElement => hostElement.shadowRoot.querySelector('video').play());
    await page.waitForTimeout(350);
    const shadowRateBefore = await shadowHost.evaluate(hostElement => hostElement.shadowRoot.querySelector('video').playbackRate);
    await page.keyboard.press('Control+Shift+K');
    const shadowRate = await shadowHost.evaluate(hostElement => hostElement.shadowRoot.querySelector('video').playbackRate);
    assert.ok(Math.abs(shadowRate - shadowRateBefore - 0.25) < 0.001, `open-shadow media rate was ${shadowRate}`);
    assert.equal(await page.locator('.vsc-host-controller').count(), 1);
    await page.locator('#remove-shadow').click();

    phase('hostile CSS and bulk media');
    // Hostile author CSS must not move or suppress the fixed shadow portal.
    await page.locator('#hostile-css').click();
    const hostStyle = await page.locator('.vsc-host-controller').evaluate(hostElement => {
      const style = getComputedStyle(hostElement);
      return { position: style.position, display: style.display, zIndex: style.zIndex };
    });
    assert.deepEqual(hostStyle, { position: 'fixed', display: 'block', zIndex: '2147483647' });

    // Feed stress: 42 reachable media elements still produce one lightweight
    // controller portal and preserve the page's own DOM ownership.
    const frameDelayMs = await page.evaluate(async () => {
      const start = performance.now();
      document.querySelector('#add-stress-videos').click();
      await new Promise(requestAnimationFrame);
      return performance.now() - start;
    });
    await page.waitForSelector('.stress-video:nth-of-type(40)');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('video').count(), 42);
    assert.equal(await page.locator('.vsc-host-controller').count(), 1);
    assert.equal(await page.locator('.vsc-wrapper').count(), 0);
    assert.ok(frameDelayMs < 100, `40-video insertion blocked a frame for ${frameDelayMs.toFixed(1)}ms`);

    // A burst of real play/pause events must still settle on one arbitration
    // winner and one controller rather than rebuilding once per event.
    const burstVideos = page.locator('.stress-video');
    const burstRatesBefore = await burstVideos.evaluateAll(videos =>
      videos.slice(0, 8).map(video => video.playbackRate));
    await burstVideos.evaluateAll(async videos => {
      const active = videos.slice(0, 8);
      for (const video of active) {
        video.src = 'sample.webm';
        video.muted = true;
      }
      await Promise.all(active.map(video => video.play()));
      active.slice(0, -1).forEach(video => video.pause());
      active.at(-1).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    await page.keyboard.press('Control+Shift+K');
    await page.waitForFunction(expected =>
      Math.abs(document.querySelectorAll('.stress-video')[7].playbackRate - expected) < 0.001,
    burstRatesBefore[7] + 0.25);
    const burstRates = await page.locator('.stress-video').evaluateAll(videos =>
      videos.slice(0, 8).map(video => video.playbackRate));
    assert.deepEqual(burstRates, burstRatesBefore.map((rate, index) => index === 7 ? rate + 0.25 : rate));
    assert.equal(await page.locator('.vsc-host-controller').count(), 1);
    await page.locator('.stress-video').evaluateAll(videos => videos.forEach(video => video.pause()));

    phase('frame lifecycle and routing');
    // Frame lifecycle: tiny players defer initialization until they become
    // large enough; a real playing iframe wins background relay arbitration.
    await page.locator('video').evaluateAll(videos => videos.forEach(video => video.pause()));
    await page.waitForTimeout(350);
    await page.locator('#add-frames').click();
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 2);
    const tinyFrame = page.frames().find(frame => frame.url().includes('case=tiny'));
    const realFrame = page.frames().find(frame => frame.url().includes('case=real'));
    assert.ok(tinyFrame && realFrame);
    await realFrame.waitForSelector('#frame-video');
    await realFrame.locator('#frame-video').evaluate(video => video.play());
    await waitForController(realFrame);
    await realFrame.waitForTimeout(350);
    await tinyFrame.waitForTimeout(400);
    assert.equal(await tinyFrame.locator('.vsc-host-controller').count(), 0);

    await page.locator('#grow-frame').click();
    await waitForController(tinyFrame);

    phase('storage migration and popup presets');
    // Import through the real worker, verify collection chunking, and verify
    // custom presets in the compact UI after a reload.
    const savedSpeeds = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`site-${index}.example`, 1.5]));
    const imported = await extensionPage.evaluate(settings => chrome.runtime.sendMessage({
      type: 'importSettings', settings
    }), { savedSpeeds, speedPresets: [0.6, 1.4, 2.8], timeSaved: 0 });
    assert.equal(imported.success, true, imported.error);
    const rawSync = await worker.evaluate(() => chrome.storage.sync.get(null));
    assert.equal(rawSync.savedSpeeds, undefined);
    assert.ok(Object.keys(rawSync).some(key => key.startsWith('__vscChunk:savedSpeeds:')));
    const roundTripped = await extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'getSettings' }));
    assert.equal(Object.keys(roundTripped.savedSpeeds).length, 100);
    await extensionPage.reload();
    await extensionPage.waitForSelector('#presets button');
    assert.equal(await extensionPage.locator('#presets button').count(), 3);

    const relay = await extensionPage.evaluate(tab => chrome.runtime.sendMessage({
      type: 'sendToActiveFrame',
      tabId: tab,
      message: { type: 'setSpeed', speed: 2 }
    }), tabId);
    assert.equal(relay.success, true, relay.error);
    await realFrame.waitForFunction(() => document.querySelector('#frame-video').playbackRate === 2);

    phase('event-based time-saved accounting');
    // Time-saved accounting remains local during playback and flushes its
    // partial 30-second batch as soon as playback pauses.
    await realFrame.waitForTimeout(1300);
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('timeSaved')).timeSaved), 0);
    await realFrame.locator('#frame-video').evaluate(video => video.pause());
    await realFrame.waitForTimeout(350);
    const flushedTimeSaved = await worker.evaluate(async () => (await chrome.storage.local.get('timeSaved')).timeSaved);
    assert.ok(flushedTimeSaved > 0, `expected a flushed time-saved batch, got ${flushedTimeSaved}`);
    await extensionPage.close();

    phase('media cleanup');
    // Removing every media owner cleans up the top-frame portal. Child portals
    // disappear with their iframe documents.
    await page.bringToFront();
    await page.locator('#remove-stress-videos').click();
    await page.locator('#remove-video').click();
    await page.locator('#primary-video').evaluate(video => video.remove());
    await page.locator('#frame-slot').evaluate(frameSlot => frameSlot.remove());
    await waitForController(page, 0);

    phase('audio-only activation and blocked sites');
    const diagnosticsPage = await context.newPage();
    await diagnosticsPage.goto(`chrome-extension://${extensionId}/popup/compact.html`);
    const audioEnabled = await diagnosticsPage.evaluate(() => chrome.runtime.sendMessage({
      type: 'updateSettings', updates: { workOnAudio: true }
    }));
    assert.equal(audioEnabled.success, true);
    await page.bringToFront();
    await page.goto(`http://${host}:${port}/empty.html?audio=1`);
    await page.evaluate(() => {
      const audio = document.createElement('audio');
      audio.id = 'audio-only';
      audio.controls = true;
      document.body.append(audio);
    });
    await waitForController(page);
    await page.locator('#audio-only').evaluate(audio =>
      audio.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await page.keyboard.press('d');
    await page.waitForFunction(() => document.querySelector('#audio-only').playbackRate === 1.1);

    const audioDisabled = await diagnosticsPage.evaluate(() => chrome.runtime.sendMessage({
      type: 'updateSettings', updates: { workOnAudio: false }
    }));
    assert.equal(audioDisabled.success, true);
    await waitForController(page, 0);

    const blocked = await diagnosticsPage.evaluate(() => chrome.runtime.sendMessage({
      type: 'updateSettings', updates: { blacklist: ['127.0.0.1'], siteAccessMode: 'blacklist' }
    }));
    assert.equal(blocked.success, true);
    await page.goto(`http://${host}:${port}/media.html?blocked=1`);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.vsc-host-controller').count(), 0);
    const unblocked = await diagnosticsPage.evaluate(() => chrome.runtime.sendMessage({
      type: 'updateSettings', updates: { blacklist: [] }
    }));
    assert.equal(unblocked.success, true);
    await waitForController(page);
    await diagnosticsPage.close();

    if (process.env.VSC_REAL_SITE_SMOKE === '1') await runYouTubeSmoke(context);

    // Reloading an unpacked extension invalidates its old content context. A
    // later interaction must remove extension-owned DOM instead of throwing or
    // leaving a dead controller over the page.
    phase('extension-context invalidation cleanup');
    await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await page.waitForTimeout(500);
    await page.keyboard.press('d');
    await waitForController(page, 0);

    console.log(`E2E passed: extension ${extensionId}, one portal for 42 media, ` +
      `40-video frame delay ${frameDelayMs.toFixed(1)}ms, batched ${flushedTimeSaved.toFixed(2)}s saved, ` +
      `${Date.now() - startedAt}ms total.`);
  } finally {
    await context?.close();
    await closeServer(server);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(`E2E failed during phase: ${activePhase}`);
  console.error(error);
  process.exitCode = 1;
});
