(function() {
  'use strict';

  const elements = {
    enabled: document.getElementById('enabled'),
    site: document.getElementById('site-name'),
    speed: document.getElementById('current-speed'),
    remaining: document.getElementById('remaining-time'),
    playPause: document.getElementById('play-pause'),
    decrease: document.getElementById('decrease'),
    increase: document.getElementById('increase'),
    presets: document.getElementById('presets'),
    status: document.getElementById('status'),
    timeSaved: document.getElementById('time-saved'),
    options: document.getElementById('open-options')
  };

  let settings = VSCSettings.normalizeSettings({});
  let tabId = null;
  let stateTimer = null;

  function t(key, fallback) {
    return chrome.i18n?.getMessage?.(key) || fallback;
  }

  function translatePage() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
      const value = chrome.i18n?.getMessage?.(element.dataset.i18n);
      if (value) element.textContent = value;
    });
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return t('ui_live_or_unknown_duration', 'Live or unknown duration');
    const rounded = Math.ceil(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainder = rounded % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')} ${t('ui_remaining', 'remaining')}`
      : `${minutes}:${String(remainder).padStart(2, '0')} ${t('ui_remaining', 'remaining')}`;
  }

  function formatSaved(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m` : `${Math.floor(safe)}s`;
  }

  async function relay(message) {
    if (!Number.isInteger(tabId)) throw new Error(t('notice_no_supported_tab', 'No supported active tab'));
    const result = await chrome.runtime.sendMessage({ type: 'sendToActiveFrame', tabId, message });
    if (!result?.success) throw new Error(result?.error || t('ui_no_active_media', 'No active media'));
    return result.response;
  }

  function setControlsEnabled(enabled) {
    [elements.playPause, elements.decrease, elements.increase].forEach(button => { button.disabled = !enabled; });
    elements.presets.querySelectorAll('button').forEach(button => { button.disabled = !enabled; });
  }

  function renderPresets() {
    elements.presets.innerHTML = (settings.speedPresets || []).map(speed =>
      `<button type="button" data-speed="${speed}" aria-label="${t('ui_set_speed_to', 'Set speed to')} ${speed}x">${speed}x</button>`
    ).join('');
  }

  function renderState(state) {
    if (!state?.found) {
      elements.speed.textContent = '—';
      elements.remaining.textContent = t('ui_no_active_media', 'No active media');
      elements.status.textContent = t('ui_open_video_page', 'Open a page with an HTML5 video.');
      setControlsEnabled(false);
      return;
    }
    const speed = VSCSettings.normalizeSpeed(state.speed);
    elements.speed.textContent = `${speed.toFixed(2)}x`;
    elements.playPause.textContent = state.paused ? '▶' : 'Ⅱ';
    elements.playPause.setAttribute('aria-label', state.paused ? t('ui_play', 'Play') : t('ui_pause', 'Pause'));
    const wallClockRemaining = Number.isFinite(state.duration)
      ? Math.max(0, state.duration - (Number(state.currentTime) || 0)) / speed
      : null;
    elements.remaining.textContent = formatDuration(wallClockRemaining);
    elements.status.textContent = state.paused ? t('ui_video_ready', 'Video ready') : t('ui_controlling_active_video', 'Controlling active video');
    elements.status.classList.remove('error');
    elements.presets.querySelectorAll('button').forEach(button => {
      button.classList.toggle('active', Number(button.dataset.speed) === speed);
    });
    setControlsEnabled(true);
  }

  async function refreshState() {
    try {
      renderState(await relay({ type: 'getActiveState' }));
    } catch (error) {
      renderState(null);
      elements.status.textContent = error.message;
      elements.status.classList.add('error');
    }
  }

  async function setSpeed(speed) {
    try {
      const response = await relay({ type: 'setSpeed', speed });
      await refreshState();
      return response;
    } catch (error) {
      elements.status.textContent = error.message;
      elements.status.classList.add('error');
    }
  }

  async function initialize() {
    translatePage();
    const stored = await chrome.runtime.sendMessage({ type: 'getSettings' });
    settings = VSCSettings.normalizeSettings(stored);
    elements.enabled.checked = settings.enabled !== false;
    elements.timeSaved.textContent = formatSaved(stored.timeSaved);
    renderPresets();

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.url) {
      try {
        const url = new URL(activeTab.url);
        if (['http:', 'https:'].includes(url.protocol)) {
          tabId = activeTab.id;
          elements.site.textContent = url.hostname;
        }
      } catch {}
    }
    await refreshState();
    stateTimer = setInterval(refreshState, 1000);
  }

  elements.enabled.addEventListener('change', async () => {
    settings.enabled = elements.enabled.checked;
    await chrome.runtime.sendMessage({ type: 'updateSettings', updates: { enabled: settings.enabled } });
  });
  elements.presets.addEventListener('click', event => {
    const button = event.target.closest('[data-speed]');
    if (button) setSpeed(Number(button.dataset.speed));
  });
  elements.decrease.addEventListener('click', () => {
    const current = Number.parseFloat(elements.speed.textContent) || 1;
    setSpeed(current - settings.speedStep);
  });
  elements.increase.addEventListener('click', () => {
    const current = Number.parseFloat(elements.speed.textContent) || 1;
    setSpeed(current + settings.speedStep);
  });
  elements.playPause.addEventListener('click', async () => {
    try {
      renderState(await relay({ type: 'togglePlayback' }));
    } catch (error) {
      elements.status.textContent = error.message;
    }
  });
  elements.options.addEventListener('click', () => chrome.runtime.openOptionsPage());
  window.addEventListener('unload', () => clearInterval(stateTimer));

  initialize().catch(error => {
    elements.status.textContent = error.message;
    elements.status.classList.add('error');
    setControlsEnabled(false);
  });
})();
