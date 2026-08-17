'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const english = JSON.parse(fs.readFileSync(path.join(projectRoot, '_locales/en/messages.json'), 'utf8'));
const locales = {
  es: 'es',
  pt_BR: 'pt',
  fr: 'fr',
  de: 'de',
  ja: 'ja'
};
const concurrency = 6;

async function translate(text, language) {
  if (!text || /^[\d\s.%×+\-–—:()[\]\/]+$/.test(text)) return text;
  const params = new URLSearchParams({ client: 'gtx', sl: 'en', tl: language, dt: 't', q: text });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`);
    if (response.ok) {
      const body = await response.json();
      return body[0].map(part => part[0]).join('');
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error(`Could not translate: ${text}`);
}

async function buildLocale(directory, language) {
  const entries = Object.entries(english);
  const translated = {};
  let cursor = 0;

  async function worker() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      const [key, value] = entries[index];
      const message = key === 'appName' ? value.message : await translate(value.message, language);
      translated[key] = value.description ? { message, description: value.description } : { message };
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  const ordered = Object.fromEntries(entries.map(([key]) => [key, translated[key]]));
  const outputDirectory = path.join(projectRoot, '_locales', directory);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'messages.json'), `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(`${directory}: ${entries.length} messages`);
}

(async () => {
  for (const [directory, language] of Object.entries(locales)) {
    await buildLocale(directory, language);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
