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
  sanitizeSettingsPatch,
  VOLUME_BOOST_MAX
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
  // Pinned to the exported ceiling rather than a literal, so raising the cap
  // does not silently need the test edited to match.
  assert.deepEqual(settings.savedVolumeBoost, { 'example.com': VOLUME_BOOST_MAX });
  assert.equal(settings.shortcuts.length, 13);
  assert.deepEqual(settings.speedPresets, [0.5, 0.75, 1, 1.25, 1.5, 2, 3]);
  assert.equal(settings.speedStep, 0.1);
  assert.equal(settings.silenceSkipEnabled, false);
});

test('custom presets, speed step, shortcut chords, and silence settings are bounded', () => {
  const settings = normalizeSettings({
    speedPresets: [3, 1, 1, 99, '0.25'],
    speedStep: 9,
    silenceSkipEnabled: true,
    silenceThreshold: 0,
    silenceMinDuration: 99,
    silenceSkipSpeed: 99,
    shortcuts: [{
      action: 'increase-speed',
      key: 'k',
      modifiers: ['Meta', 'Shift', 'Control', 'Shift'],
      value: 0.25,
      enabled: true
    }]
  });

  assert.deepEqual(settings.speedPresets, [0.25, 1, 3, 16]);
  assert.equal(settings.speedStep, 2);
  assert.equal(settings.silenceSkipEnabled, true);
  assert.equal(settings.silenceThreshold, 0.001);
  assert.equal(settings.silenceMinDuration, 10);
  assert.equal(settings.silenceSkipSpeed, 16);
  assert.deepEqual(settings.shortcuts.find(item => item.action === 'increase-speed').modifiers, ['Control', 'Shift', 'Meta']);
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
