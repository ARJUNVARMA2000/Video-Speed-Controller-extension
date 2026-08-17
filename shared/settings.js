(function initializeSettings(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.VSCSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSettingsApi() {
  'use strict';

  const SPEED_MIN = 0.1;
  const SPEED_MAX = 16;
  const MAX_LIST_ITEMS = 100;
  const MAX_PATTERN_LENGTH = 512;
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  const DEFAULT_SHORTCUTS = [
    { action: 'show-controller', key: 'V', modifiers: [], enabled: true },
    { action: 'decrease-speed', key: 'S', modifiers: [], value: 0.1, enabled: true },
    { action: 'increase-speed', key: 'D', modifiers: [], value: 0.1, enabled: true },
    { action: 'rewind', key: 'Z', modifiers: [], value: 10, enabled: true },
    { action: 'advance', key: 'X', modifiers: [], value: 10, enabled: true },
    { action: 'reset-speed', key: 'R', modifiers: [], value: 1, enabled: true },
    { action: 'preferred-speed', key: 'G', modifiers: [], value: 3, enabled: true },
    { action: 'frame-forward', key: '.', modifiers: [], enabled: true },
    { action: 'frame-backward', key: ',', modifiers: [], enabled: true },
    { action: 'screenshot', key: 'P', modifiers: [], enabled: true },
    { action: 'set-loop-a', key: '[', modifiers: [], enabled: true },
    { action: 'set-loop-b', key: ']', modifiers: [], enabled: true },
    { action: 'clear-loop', key: '\\', modifiers: [], enabled: true }
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    hideByDefault: false,
    rememberSpeed: true,
    forceSpeed: false,
    workOnAudio: false,
    preservePitch: true,
    opacity: 0.8,
    autoHideDelay: 0,
    controllerMode: 'minimal',
    colorBackground: '#1a1a2e',
    colorAccent: '#e94560',
    showPipIndicator: true,
    siteAccessMode: 'blacklist',
    whitelist: [],
    blacklist: [],
    shortcuts: DEFAULT_SHORTCUTS,
    savedSpeeds: {},
    sitePresetSpeeds: {},
    urlRules: [],
    lastSyncTime: null,
    introOutroEnabled: false,
    defaultIntroSkip: 0,
    defaultOutroSkip: 0,
    autoSkipIntro: false,
    skipIntroKey: 'I',
    skipOutroKey: 'O',
    introOutroSiteRules: [],
    rememberFilters: false,
    savedFilters: {},
    rememberVolumeBoost: false,
    savedVolumeBoost: {}
  };

  const BOOLEAN_KEYS = [
    'enabled',
    'hideByDefault',
    'rememberSpeed',
    'forceSpeed',
    'workOnAudio',
    'preservePitch',
    'showPipIndicator',
    'introOutroEnabled',
    'autoSkipIntro',
    'rememberFilters',
    'rememberVolumeBoost'
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createDefaultSettings() {
    return clone(DEFAULT_SETTINGS);
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function normalizeSpeed(value, fallback = 1) {
    return Math.round(clampNumber(value, SPEED_MIN, SPEED_MAX, fallback) * 100) / 100;
  }

  function sanitizeKey(value, fallback) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 24) return fallback;
    return value.length === 1 ? value.toUpperCase() : value;
  }

  function sanitizePattern(value) {
    if (typeof value !== 'string') return null;
    const pattern = value.trim().slice(0, MAX_PATTERN_LENGTH);
    return pattern || null;
  }

  function sanitizePatternList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(sanitizePattern).filter(Boolean))].slice(0, MAX_LIST_ITEMS);
  }

  function sanitizeShortcuts(value) {
    if (!Array.isArray(value)) return clone(DEFAULT_SHORTCUTS);

    const defaultsByAction = new Map(DEFAULT_SHORTCUTS.map(shortcut => [shortcut.action, shortcut]));
    const seenActions = new Set();
    const shortcuts = [];

    for (const candidate of value.slice(0, DEFAULT_SHORTCUTS.length)) {
      if (!candidate || typeof candidate !== 'object') continue;
      const fallback = defaultsByAction.get(candidate.action);
      if (!fallback || seenActions.has(candidate.action)) continue;

      const shortcut = {
        action: candidate.action,
        key: sanitizeKey(candidate.key, fallback.key),
        modifiers: Array.isArray(candidate.modifiers)
          ? candidate.modifiers.filter(modifier => ['Alt', 'Control', 'Meta', 'Shift'].includes(modifier))
          : [],
        enabled: candidate.enabled !== false
      };

      if (hasOwn(fallback, 'value')) {
        const max = ['rewind', 'advance'].includes(candidate.action) ? 3600 : SPEED_MAX;
        shortcut.value = clampNumber(candidate.value, SPEED_MIN, max, fallback.value);
      }

      seenActions.add(candidate.action);
      shortcuts.push(shortcut);
    }

    for (const fallback of DEFAULT_SHORTCUTS) {
      if (!seenActions.has(fallback.action)) shortcuts.push(clone(fallback));
    }

    return shortcuts;
  }

  function sanitizeSpeedMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const entries = Object.entries(value).slice(-MAX_LIST_ITEMS);
    return Object.fromEntries(entries.flatMap(([hostname, speed]) => {
      const safeHostname = sanitizePattern(hostname);
      if (!safeHostname || !Number.isFinite(Number(speed))) return [];
      return [[safeHostname, normalizeSpeed(speed)]];
    }));
  }

  function sanitizeFiltersMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    for (const [hostname, filters] of Object.entries(value).slice(-MAX_LIST_ITEMS)) {
      const safeHostname = sanitizePattern(hostname);
      if (!safeHostname || !filters || typeof filters !== 'object') continue;
      result[safeHostname] = {
        brightness: Math.round(clampNumber(filters.brightness, 0, 200, 100)),
        contrast: Math.round(clampNumber(filters.contrast, 0, 200, 100)),
        saturation: Math.round(clampNumber(filters.saturation, 0, 200, 100))
      };
    }
    return result;
  }

  function sanitizeVolumeMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    for (const [hostname, level] of Object.entries(value).slice(-MAX_LIST_ITEMS)) {
      const safeHostname = sanitizePattern(hostname);
      if (!safeHostname || !Number.isFinite(Number(level))) continue;
      result[safeHostname] = Math.round(clampNumber(level, 100, 400, 100));
    }
    return result;
  }

  function sanitizeUrlRules(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_LIST_ITEMS).flatMap(rule => {
      if (!rule || typeof rule !== 'object') return [];
      const pattern = sanitizePattern(rule.pattern);
      if (!pattern || !Number.isFinite(Number(rule.speed))) return [];
      return [{ pattern, speed: normalizeSpeed(rule.speed) }];
    });
  }

  function sanitizeIntroOutroRules(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, MAX_LIST_ITEMS).flatMap(rule => {
      if (!rule || typeof rule !== 'object') return [];
      const site = sanitizePattern(rule.site);
      if (!site) return [];
      return [{
        site,
        intro: Math.round(clampNumber(rule.intro, 0, 300, 0)),
        outro: Math.round(clampNumber(rule.outro, 0, 300, 0))
      }];
    });
  }

  function sanitizeColor(value, fallback) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  }

  function sanitizeSettings(input, options = {}) {
    const partial = options.partial === true;
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const result = partial ? {} : createDefaultSettings();
    const has = key => hasOwn(source, key);

    for (const key of BOOLEAN_KEYS) {
      if (has(key)) result[key] = source[key] === true;
    }

    if (has('opacity')) result.opacity = clampNumber(source.opacity, 0.1, 1, DEFAULT_SETTINGS.opacity);
    if (has('autoHideDelay')) result.autoHideDelay = Math.round(clampNumber(source.autoHideDelay, 0, 10, 0));
    if (has('defaultIntroSkip')) result.defaultIntroSkip = Math.round(clampNumber(source.defaultIntroSkip, 0, 300, 0));
    if (has('defaultOutroSkip')) result.defaultOutroSkip = Math.round(clampNumber(source.defaultOutroSkip, 0, 300, 0));

    if (has('controllerMode')) {
      result.controllerMode = ['minimal', 'full'].includes(source.controllerMode)
        ? source.controllerMode
        : DEFAULT_SETTINGS.controllerMode;
    }
    if (has('siteAccessMode')) {
      result.siteAccessMode = ['all', 'blacklist', 'whitelist'].includes(source.siteAccessMode)
        ? source.siteAccessMode
        : DEFAULT_SETTINGS.siteAccessMode;
    }

    if (has('colorBackground')) result.colorBackground = sanitizeColor(source.colorBackground, DEFAULT_SETTINGS.colorBackground);
    if (has('colorAccent')) result.colorAccent = sanitizeColor(source.colorAccent, DEFAULT_SETTINGS.colorAccent);
    if (has('skipIntroKey')) result.skipIntroKey = sanitizeKey(source.skipIntroKey, DEFAULT_SETTINGS.skipIntroKey);
    if (has('skipOutroKey')) result.skipOutroKey = sanitizeKey(source.skipOutroKey, DEFAULT_SETTINGS.skipOutroKey);
    if (has('blacklist')) result.blacklist = sanitizePatternList(source.blacklist);
    if (has('whitelist')) result.whitelist = sanitizePatternList(source.whitelist);
    if (has('shortcuts')) result.shortcuts = sanitizeShortcuts(source.shortcuts);
    if (has('savedSpeeds')) result.savedSpeeds = sanitizeSpeedMap(source.savedSpeeds);
    if (has('sitePresetSpeeds')) result.sitePresetSpeeds = sanitizeSpeedMap(source.sitePresetSpeeds);
    if (has('urlRules')) result.urlRules = sanitizeUrlRules(source.urlRules);
    if (has('introOutroSiteRules')) result.introOutroSiteRules = sanitizeIntroOutroRules(source.introOutroSiteRules);
    if (has('savedFilters')) result.savedFilters = sanitizeFiltersMap(source.savedFilters);
    if (has('savedVolumeBoost')) result.savedVolumeBoost = sanitizeVolumeMap(source.savedVolumeBoost);
    if (has('lastSyncTime')) {
      result.lastSyncTime = source.lastSyncTime === null
        ? null
        : Math.round(clampNumber(source.lastSyncTime, 0, Number.MAX_SAFE_INTEGER, Date.now()));
    }

    return result;
  }

  function normalizeSettings(input) {
    return sanitizeSettings(input);
  }

  function sanitizeSettingsPatch(input) {
    return sanitizeSettings(input, { partial: true });
  }

  function valuesEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;

    return leftKeys.every(key => hasOwn(right, key) && valuesEqual(left[key], right[key]));
  }

  function diffSettings(previous, next) {
    const safeNext = sanitizeSettingsPatch(next);
    const result = {};
    for (const [key, value] of Object.entries(safeNext)) {
      if (!valuesEqual(previous?.[key], value)) result[key] = value;
    }
    return result;
  }

  function parseRegexPattern(pattern) {
    if (!pattern.startsWith('/')) return null;
    const lastSlash = pattern.lastIndexOf('/');
    if (lastSlash <= 0) return null;
    const source = pattern.slice(1, lastSlash);
    const flags = pattern.slice(lastSlash + 1);
    if (!/^[imsu]*$/.test(flags)) return null;
    try {
      return new RegExp(source, flags.includes('i') ? flags : `${flags}i`);
    } catch {
      return null;
    }
  }

  function matchPattern(url, rawPattern) {
    const pattern = sanitizePattern(rawPattern);
    if (!pattern || typeof url !== 'string') return false;

    const explicitRegex = parseRegexPattern(pattern);
    if (explicitRegex) return explicitRegex.test(url);

    if (pattern.includes('*')) {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
      try {
        return new RegExp(escaped, 'i').test(url);
      } catch {
        return false;
      }
    }

    return url.toLowerCase().includes(pattern.toLowerCase());
  }

  function checkSiteAccess(url, settings) {
    if (settings?.enabled === false) return { blocked: true, reason: 'disabled' };
    const mode = settings?.siteAccessMode || 'blacklist';
    if (mode === 'all') return { blocked: false, reason: null };

    if (mode === 'whitelist') {
      const whitelist = sanitizePatternList(settings?.whitelist);
      if (whitelist.length === 0) return { blocked: false, reason: null };
      const allowed = whitelist.some(pattern => matchPattern(url, pattern));
      return { blocked: !allowed, reason: allowed ? null : 'not_whitelisted' };
    }

    const blocked = sanitizePatternList(settings?.blacklist).some(pattern => matchPattern(url, pattern));
    return { blocked, reason: blocked ? 'blacklisted' : null };
  }

  function findUrlRule(url, rules) {
    for (const rule of sanitizeUrlRules(rules)) {
      if (matchPattern(url, rule.pattern)) return { speed: rule.speed, matched: true, pattern: rule.pattern };
    }
    return { speed: null, matched: false };
  }

  return {
    DEFAULT_SETTINGS: createDefaultSettings(),
    SPEED_MIN,
    SPEED_MAX,
    checkSiteAccess,
    createDefaultSettings,
    diffSettings,
    findUrlRule,
    matchPattern,
    normalizeSettings,
    normalizeSpeed,
    sanitizeSettingsPatch
  };
});
