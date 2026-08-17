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
  ...(manifest.content_scripts || []).flatMap(script => [...(script.js || []), ...(script.css || [])])
].filter(Boolean);

for (const relativePath of referencedFiles) {
  assert.ok(fs.existsSync(path.join(projectRoot, relativePath)), `missing manifest asset: ${relativePath}`);
}

console.log(`Manifest ${manifest.version} validated (${referencedFiles.length} referenced assets).`);
