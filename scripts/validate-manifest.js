'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
const packageMetadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

assert.equal(manifest.manifest_version, 3, 'manifest_version must be 3');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'version must use x.y.z format');
assert.equal(manifest.version, packageMetadata.version, 'manifest and package versions must match');

const referencedFiles = [
  manifest.action?.default_popup,
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

  for (const value of Object.values(manifest)) {
    if (typeof value !== 'string') continue;
    const token = value.match(/^__MSG_(.+)__$/);
    if (token) assert.ok(catalog[token[1]], `manifest references missing message: ${token[1]}`);
  }

  const popup = fs.readFileSync(path.join(projectRoot, manifest.action.default_popup), 'utf8');
  const referenced = [...popup.matchAll(/data-i18n(?:-aria|-placeholder|-title)?="([^"]+)"/g)].map(match => match[1]);
  const missing = [...new Set(referenced)].filter(key => !catalog[key]);
  assert.deepEqual(missing, [], `popup references messages absent from the catalogue: ${missing.join(', ')}`);

  const unused = Object.keys(catalog).filter(key => !referenced.includes(key) && !key.startsWith('app'));
  locales.push(`${manifest.default_locale}: ${Object.keys(catalog).length} messages, ${referenced.length} references, ${unused.length} unused`);
}

console.log(`Manifest ${manifest.version} validated (${referencedFiles.length} referenced assets).`);
for (const line of locales) console.log(`Locale ${line}`);
