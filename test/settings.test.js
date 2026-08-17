'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkSiteAccess,
  diffSettings,
  findUrlRule,
  matchPattern,
  normalizeSettings,
  normalizeSpeed,
  sanitizeSettingsPatch
} = require('../shared/settings.js');

test('normalizeSpeed clamps and rounds playback rates', () => {
  assert.equal(normalizeSpeed(0), 0.1);
  assert.equal(normalizeSpeed(20), 16);
  assert.equal(normalizeSpeed(1.236), 1.24);
  assert.equal(normalizeSpeed('2.5'), 2.5);
});

test('normalizeSettings supplies defaults and rejects malformed values', () => {
  const settings = normalizeSettings({
    enabled: 'yes',
    opacity: 99,
    controllerMode: 'giant',
    colorAccent: 'red',
    savedSpeeds: { 'example.com': 40, invalid: 'fast' },
    savedVolumeBoost: { 'example.com': 900 }
  });

  assert.equal(settings.enabled, false);
  assert.equal(settings.opacity, 1);
  assert.equal(settings.controllerMode, 'minimal');
  assert.equal(settings.colorAccent, '#e94560');
  assert.deepEqual(settings.savedSpeeds, { 'example.com': 16 });
  assert.deepEqual(settings.savedVolumeBoost, { 'example.com': 400 });
  assert.equal(settings.shortcuts.length, 13);
});

test('sanitizeSettingsPatch only returns recognized keys', () => {
  assert.deepEqual(sanitizeSettingsPatch({ enabled: true, injected: 'nope' }), { enabled: true });
});

test('diffSettings does not resend unchanged map data', () => {
  const previous = normalizeSettings({ savedSpeeds: { 'example.com': 2 }, enabled: true });
  const next = { ...previous, enabled: false };
  assert.deepEqual(diffSettings(previous, next), { enabled: false });
});

test('patterns support literals, wildcards, and explicit regular expressions', () => {
  const url = 'https://courses.example.com/watch/123';
  assert.equal(matchPattern(url, 'example.com'), true);
  assert.equal(matchPattern(url, '*.example.com/watch/*'), true);
  assert.equal(matchPattern(url, '/courses\\.example\\.com\\/watch\\/\\d+/'), true);
  assert.equal(matchPattern(url, 'other.example'), false);
});

test('site access handles allowlists and blocklists', () => {
  assert.deepEqual(checkSiteAccess('https://video.example.com', {
    enabled: true,
    siteAccessMode: 'blacklist',
    blacklist: ['example.com']
  }), { blocked: true, reason: 'blacklisted' });

  assert.deepEqual(checkSiteAccess('https://video.example.com', {
    enabled: true,
    siteAccessMode: 'whitelist',
    whitelist: ['school.example']
  }), { blocked: true, reason: 'not_whitelisted' });
});

test('URL rules use first-match precedence and sanitized speed values', () => {
  assert.deepEqual(findUrlRule('https://example.com/shorts/1', [
    { pattern: '/shorts/', speed: 1.25 },
    { pattern: 'example.com', speed: 2 }
  ]), { speed: 1.25, matched: true, pattern: '/shorts/' });
});
