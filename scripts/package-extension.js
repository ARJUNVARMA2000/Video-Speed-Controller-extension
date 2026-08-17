'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
const outputDirectory = path.join(projectRoot, 'dist');
const outputName = `video-speed-controller-v${manifest.version}.zip`;
const outputPath = path.join(outputDirectory, outputName);
const releaseFiles = [
  'manifest.json',
  'LICENSE',
  'PRIVACY_POLICY.md',
  'browser-polyfill.min.js',
  'background',
  'content',
  'icons',
  'popup',
  'shared'
];

fs.mkdirSync(outputDirectory, { recursive: true });
fs.rmSync(outputPath, { force: true });
execFileSync('zip', ['-q', '-r', outputPath, ...releaseFiles], { cwd: projectRoot, stdio: 'inherit' });

const stats = fs.statSync(outputPath);
console.log(`Created ${path.relative(projectRoot, outputPath)} (${Math.ceil(stats.size / 1024)} KB).`);
