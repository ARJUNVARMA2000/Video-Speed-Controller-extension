'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
const packageMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

function collectStrings(value, strings = []) {
  if (typeof value === 'string') strings.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, strings));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectStrings(item, strings));
  return strings;
}

assert.equal(manifest.manifest_version, 3, 'manifest_version must be 3');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'version must use x.y.z format');
assert.equal(manifest.version, packageMetadata.version, 'manifest and package versions must match');

const referencedFiles = [
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  manifest.background?.service_worker,
  ...Object.values(manifest.icons || {}),
  ...(manifest.content_scripts || []).flatMap(script => [...(script.js || []), ...(script.css || [])]),
  // Overlay styles are fetched at runtime rather than injected, so they are only
  // reachable through web_accessible_resources.
  ...(manifest.web_accessible_resources || []).flatMap(entry => entry.resources || [])
].filter(Boolean);

for (const relativePath of referencedFiles) {
  assert.ok(fs.existsSync(path.join(projectRoot, relativePath)), `missing manifest asset: ${relativePath}`);
}

// Localization. A missing catalogue or a typo in a key shows up as blank UI at
// runtime and nowhere else, so both are checked here.
const locales = [];
if (manifest.default_locale) {
  const catalogPath = path.join(projectRoot, '_locales', manifest.default_locale, 'messages.json');
  assert.ok(fs.existsSync(catalogPath), `missing default locale catalogue: ${catalogPath}`);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

  const manifestMessages = [];
  for (const value of collectStrings(manifest)) {
    const token = value.match(/^__MSG_(.+)__$/);
    if (token) {
      manifestMessages.push(token[1]);
      assert.ok(catalog[token[1]], `manifest references missing message: ${token[1]}`);
    }
  }

  const localizedSources = [
    manifest.action.default_popup,
    manifest.options_ui?.page,
    'popup/compact.js',
    'popup/popup.js',
    'content/content.js'
  ].filter(Boolean).map(relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
  const referenced = localizedSources.flatMap(source => [
    ...[...source.matchAll(/data-i18n(?:-aria|-placeholder|-title)?="([^"]+)"/g)].map(match => match[1]),
    ...[...source.matchAll(/\bt\(['"]([^'"]+)['"]/g)].map(match => match[1])
  ]);
  referenced.push(...manifestMessages);
  // Shortcut message keys are derived from action IDs at runtime, so the
  // literal t(...) scanner cannot see them.
  referenced.push(...[
    'show_controller', 'decrease_speed', 'increase_speed', 'rewind', 'advance',
    'reset_speed', 'preferred_speed', 'frame_forward', 'frame_backward',
    'screenshot', 'set_loop_a', 'set_loop_b', 'clear_loop', 'toggle_loop'
  ].map(action => `shortcut_${action}`));
  const missing = [...new Set(referenced)].filter(key => !catalog[key]);
  assert.deepEqual(missing, [], `popup references messages absent from the catalogue: ${missing.join(', ')}`);

  const localeRoot = path.join(projectRoot, '_locales');
  const defaultKeys = Object.keys(catalog).sort();
  for (const locale of fs.readdirSync(localeRoot)) {
    const localePath = path.join(localeRoot, locale, 'messages.json');
    assert.ok(fs.existsSync(localePath), `locale ${locale} is missing messages.json`);
    const localeCatalog = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    assert.deepEqual(Object.keys(localeCatalog).sort(), defaultKeys, `locale ${locale} is incomplete`);
    for (const [key, entry] of Object.entries(localeCatalog)) {
      assert.ok(typeof entry.message === 'string' && entry.message.length > 0, `locale ${locale} has an empty ${key}`);
    }
  }

  const unused = Object.keys(catalog).filter(key => !referenced.includes(key) && !key.startsWith('app'));
  locales.push(`${manifest.default_locale}: ${Object.keys(catalog).length} messages, ${referenced.length} references, ${unused.length} unused`);
}

console.log(`Manifest ${manifest.version} validated (${referencedFiles.length} referenced assets).`);
for (const line of locales) console.log(`Locale ${line}`);
