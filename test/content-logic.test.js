'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  advanceSilenceState,
  calculateTimeSaved,
  decideSpeedEnforcement,
  pickActiveCandidate,
  summarizeFrameCandidates,
  visibleArea
} = require('../content/logic.js');

test('visible area clips media rectangles to the viewport', () => {
  assert.equal(visibleArea({ left: -50, top: 10, right: 150, bottom: 110 }, 100, 100), 9000);
  assert.equal(visibleArea({ left: 200, top: 200, right: 300, bottom: 300 }, 100, 100), 0);
});

test('active media ranking prefers play, interaction, area, then first attachment', () => {
  const candidates = [
    { id: 'large-paused', playing: false, lastInteractionAt: 9, area: 1000, attachedAt: 1 },
    { id: 'old-playing', playing: true, lastInteractionAt: 3, area: 500, attachedAt: 2 },
    { id: 'new-playing', playing: true, lastInteractionAt: 7, area: 100, attachedAt: 3 }
  ];
  assert.equal(pickActiveCandidate(candidates).id, 'new-playing');
  assert.equal(pickActiveCandidate([
    { id: 'first', playing: false, lastInteractionAt: 0, area: 50, attachedAt: 1 },
    { id: 'second', playing: false, lastInteractionAt: 0, area: 50, attachedAt: 2 }
  ]).id, 'first');
});

test('frame summary uses the largest playing area before paused media', () => {
  assert.deepEqual(summarizeFrameCandidates([
    { playing: false, area: 2000 },
    { playing: true, area: 100 },
    { playing: true, area: 500 }
  ]), { playing: true, area: 500 });
});

test('time-saved accrual is zero at normal speed and linear above it', () => {
  assert.equal(calculateTimeSaved(30, 1), 0);
  assert.equal(calculateTimeSaved(30, 1.5), 15);
  assert.equal(calculateTimeSaved(-10, 4), 0);
});

test('silence state accelerates only after a complete quiet window and restores on sound', () => {
  const started = advanceSilenceState({ silent: true, now: 100, startedAt: null, accelerated: false, minimumMs: 500 });
  assert.deepEqual(started, { startedAt: 100, accelerated: false, action: 'none' });
  const accelerated = advanceSilenceState({ silent: true, now: 600, ...started, minimumMs: 500 });
  assert.deepEqual(accelerated, { startedAt: 100, accelerated: true, action: 'accelerate' });
  assert.equal(advanceSilenceState({ silent: false, now: 700, ...accelerated, minimumMs: 500 }).action, 'restore');
});

test('speed enforcement applies, backs off, and respects manual-rate windows', () => {
  const limits = { epsilon: 0.001, correctionWindowMs: 1000, correctionLimit: 2, cooldownMs: 5000 };
  const base = {
    desired: 2,
    current: 1,
    silenceActive: false,
    forceSpeed: false,
    now: 100,
    reassertUntil: 1000,
    cooldownUntil: 0,
    correctionStart: 0,
    correctionCount: 0
  };
  assert.equal(decideSpeedEnforcement(base, limits).action, 'apply');
  assert.equal(decideSpeedEnforcement({ ...base, correctionCount: 2 }, limits).action, 'cooldown');
  assert.equal(decideSpeedEnforcement({ ...base, now: 1001 }, limits).action, 'none');
  assert.equal(decideSpeedEnforcement({ ...base, now: 1001, forceSpeed: true }, limits).action, 'apply');
});
