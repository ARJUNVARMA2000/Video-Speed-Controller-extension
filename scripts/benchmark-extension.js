'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const projectRoot = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const runs = Math.max(3, Math.min(20, Number(process.env.VSC_BENCH_RUNS) || 7));

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${host}`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/frame-farm') {
      const frames = Array.from({ length: 20 }, (_, index) =>
        `<iframe src="/empty?frame=${index}" style="width:320px;height:180px"></iframe>`).join('');
      response.end(html(frames));
      return;
    }
    response.end(html('<main id="root"></main>'));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve({ server, port: server.address().port }));
  });
}

function metricMap(metrics) {
  return Object.fromEntries(metrics.map(metric => [metric.name, metric.value]));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function summarize(samples) {
  return {
    taskMs: median(samples.map(sample => sample.taskMs)),
    scriptMs: median(samples.map(sample => sample.scriptMs)),
    heapKiB: median(samples.map(sample => sample.heapKiB))
  };
}

async function samplePage(context, url, inspectScripts = false) {
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const parsedScripts = [];
  if (inspectScripts) {
    session.on('Debugger.scriptParsed', event => {
      if (event.url.startsWith('chrome-extension://')) parsedScripts.push(event.url);
    });
    await session.send('Debugger.enable');
  }
  await session.send('Performance.enable');
  const before = metricMap((await session.send('Performance.getMetrics')).metrics);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(350);
  const after = metricMap((await session.send('Performance.getMetrics')).metrics);
  await page.close();
  return {
    taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
    scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
    heapKiB: (after.JSHeapUsedSize - before.JSHeapUsedSize) / 1024,
    bootstrapLoaded: parsedScripts.some(urlValue => urlValue.endsWith('/content/bootstrap.js')),
    logicLoaded: parsedScripts.some(urlValue => urlValue.endsWith('/content/logic.js')),
    runtimeLoaded: parsedScripts.some(urlValue => urlValue.endsWith('/content/content.js'))
  };
}

async function measureActivation(context, url) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(350);
  const duration = await page.evaluate(() => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.vsc-host-controller')) return;
      observer.disconnect();
      resolve(performance.now() - startedAt);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const media = document.createElement('video');
    media.style.cssText = 'width:640px;height:360px';
    document.body.append(media);
    setTimeout(() => reject(new Error('controller activation timed out')), 3000);
  }));
  await page.close();
  return duration;
}

async function measureBulkInsertion(context, url, withExtension) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => {
    const seed = document.createElement('video');
    seed.style.cssText = 'width:640px;height:360px';
    document.body.append(seed);
  });
  if (withExtension) {
    await page.waitForFunction(() => document.querySelector('.vsc-host-controller'));
  } else {
    await page.waitForTimeout(50);
  }
  const duration = await page.evaluate(async () => {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 40; index += 1) {
      const media = document.createElement('video');
      media.style.cssText = 'width:320px;height:180px';
      fragment.append(media);
    }
    const startedAt = performance.now();
    document.body.append(fragment);
    await new Promise(requestAnimationFrame);
    return performance.now() - startedAt;
  });
  await page.close();
  return duration;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function run() {
  const { server, port } = await startServer();
  const baseUrl = `http://${host}:${port}`;
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vsc-benchmark-'));
  let extensionContext;
  let plainBrowser;

  try {
    extensionContext = await chromium.launchPersistentContext(userDataDirectory, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${projectRoot}`,
        `--load-extension=${projectRoot}`
      ]
    });
    plainBrowser = await chromium.launch({ channel: 'chromium', headless: true });
    const plainContext = await plainBrowser.newContext();

    // Warm process startup and disk caches; measured runs still use fresh pages.
    await samplePage(extensionContext, `${baseUrl}/empty?warm=1`);
    await samplePage(plainContext, `${baseUrl}/empty?warm=1`);

    const rows = [];
    for (const [name, route] of [['empty', '/empty'], ['20 empty frames', '/frame-farm']]) {
      const extensionSamples = [];
      const plainSamples = [];
      for (let index = 0; index < runs; index += 1) {
        extensionSamples.push(await samplePage(extensionContext, `${baseUrl}${route}?run=${index}`, index === 0));
        plainSamples.push(await samplePage(plainContext, `${baseUrl}${route}?run=${index}`));
      }
      const extension = summarize(extensionSamples);
      const plain = summarize(plainSamples);
      rows.push({
        scenario: name,
        extensionTaskMs: extension.taskMs.toFixed(2),
        plainTaskMs: plain.taskMs.toFixed(2),
        overheadTaskMs: (extension.taskMs - plain.taskMs).toFixed(2),
        extensionHeapKiB: extension.heapKiB.toFixed(0),
        plainHeapKiB: plain.heapKiB.toFixed(0),
        overheadHeapKiB: (extension.heapKiB - plain.heapKiB).toFixed(0)
      });
      if (name === 'empty') {
        const inspected = extensionSamples[0];
        if (!inspected.bootstrapLoaded || inspected.logicLoaded || inspected.runtimeLoaded) {
          throw new Error(`lazy-load invariant failed: ${JSON.stringify(inspected)}`);
        }
      }
    }

    const activationSamples = [];
    const extensionBulkSamples = [];
    const plainBulkSamples = [];
    for (let index = 0; index < runs; index += 1) {
      activationSamples.push(await measureActivation(extensionContext, `${baseUrl}/empty?activation=${index}`));
      extensionBulkSamples.push(await measureBulkInsertion(
        extensionContext, `${baseUrl}/empty?bulk-extension=${index}`, true));
      plainBulkSamples.push(await measureBulkInsertion(
        plainContext, `${baseUrl}/empty?bulk-plain=${index}`, false));
    }

    console.table(rows);
    console.log(`First-media controller: ${median(activationSamples).toFixed(2)}ms median ` +
      `(${activationSamples.map(value => value.toFixed(2)).join(', ')}), ${runs} runs.`);
    console.log(`40-media next frame: ${median(extensionBulkSamples).toFixed(2)}ms extension, ` +
      `${median(plainBulkSamples).toFixed(2)}ms plain, ` +
      `${(median(extensionBulkSamples) - median(plainBulkSamples)).toFixed(2)}ms overhead.`);
    await plainContext.close();
  } finally {
    await extensionContext?.close();
    await plainBrowser?.close();
    await closeServer(server);
    fs.rmSync(userDataDirectory, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
