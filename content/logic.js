(function initializeContentLogic(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VSCContentLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createContentLogic() {
  'use strict';

  function visibleArea(rect, viewportWidth, viewportHeight) {
    if (!rect) return 0;
    const width = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function compareMediaCandidates(left, right) {
    if (left.playing !== right.playing) return Number(left.playing) - Number(right.playing);
    if (left.lastInteractionAt !== right.lastInteractionAt) return left.lastInteractionAt - right.lastInteractionAt;
    if (left.area !== right.area) return left.area - right.area;
    // Earlier attachment wins the final tie for deterministic behavior.
    return right.attachedAt - left.attachedAt;
  }

  function pickActiveCandidate(candidates) {
    let best = null;
    for (const candidate of candidates || []) {
      if (!best || compareMediaCandidates(candidate, best) > 0) best = candidate;
    }
    return best;
  }

  function summarizeFrameCandidates(candidates) {
    let playing = false;
    let playingArea = 0;
    let idleArea = 0;
    for (const candidate of candidates || []) {
      if (candidate.playing) {
        playing = true;
        playingArea = Math.max(playingArea, candidate.area || 0);
      } else {
        idleArea = Math.max(idleArea, candidate.area || 0);
      }
    }
    return { playing, area: playing ? playingArea : idleArea };
  }

  function calculateTimeSaved(elapsedSeconds, playbackRate) {
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    const rate = Math.max(0, Number(playbackRate) || 0);
    return rate > 1 ? elapsed * (rate - 1) : 0;
  }

  function advanceSilenceState({ silent, now, startedAt, accelerated, minimumMs }) {
    if (!silent) {
      return {
        startedAt: null,
        accelerated: false,
        action: accelerated ? 'restore' : 'none'
      };
    }
    const nextStartedAt = startedAt === null ? now : startedAt;
    const shouldAccelerate = !accelerated && now - nextStartedAt >= minimumMs;
    return {
      startedAt: nextStartedAt,
      accelerated: accelerated || shouldAccelerate,
      action: shouldAccelerate ? 'accelerate' : 'none'
    };
  }

  function decideSpeedEnforcement(state, limits) {
    const {
      desired,
      current,
      silenceActive,
      forceSpeed,
      now,
      reassertUntil = 0,
      cooldownUntil = 0,
      correctionStart = 0,
      correctionCount = 0
    } = state;
    const {
      epsilon,
      correctionWindowMs,
      correctionLimit,
      cooldownMs
    } = limits;

    if (!Number.isFinite(desired) || silenceActive || Math.abs(current - desired) < epsilon) {
      return { action: 'none', correctionStart, correctionCount, cooldownUntil };
    }
    if ((!forceSpeed && now >= reassertUntil) || now < cooldownUntil) {
      return { action: 'none', correctionStart, correctionCount, cooldownUntil };
    }

    const windowExpired = now - correctionStart > correctionWindowMs;
    const nextStart = windowExpired ? now : correctionStart;
    const nextCount = (windowExpired ? 0 : correctionCount) + 1;
    if (nextCount > correctionLimit) {
      return {
        action: 'cooldown',
        correctionStart: nextStart,
        correctionCount: nextCount,
        cooldownUntil: now + cooldownMs
      };
    }
    return {
      action: 'apply',
      correctionStart: nextStart,
      correctionCount: nextCount,
      cooldownUntil
    };
  }

  return {
    advanceSilenceState,
    calculateTimeSaved,
    decideSpeedEnforcement,
    pickActiveCandidate,
    summarizeFrameCandidates,
    visibleArea
  };
});
