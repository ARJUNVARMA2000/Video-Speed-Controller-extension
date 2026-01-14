// Video Speed Controller Pro - Popup Settings

(function() {
  'use strict';

  // Shortcut action labels
  const ACTION_LABELS = {
    'show-controller': 'Show/Hide Controller',
    'decrease-speed': 'Decrease Speed',
    'increase-speed': 'Increase Speed',
    'rewind': 'Rewind',
    'advance': 'Advance',
    'reset-speed': 'Reset Speed',
    'preferred-speed': 'Preferred Speed',
    'frame-forward': 'Next Frame',
    'frame-backward': 'Previous Frame',
    'screenshot': 'Screenshot',
    'set-loop-a': 'Set Loop A',
    'set-loop-b': 'Set Loop B',
    'clear-loop': 'Clear Loop',
    'toggle-loop': 'Toggle Loop'
  };

  // Value units for display
  const VALUE_UNITS = {
    'decrease-speed': 'x',
    'increase-speed': 'x',
    'rewind': 's',
    'advance': 's',
    'reset-speed': 'x',
    'preferred-speed': 'x'
  };

  // State
  let settings = {};
  let recordingInput = null;
  let currentHostname = null;

  // DOM Elements
  const elements = {
    enabled: document.getElementById('enabled'),
    hideByDefault: document.getElementById('hideByDefault'),
    rememberSpeed: document.getElementById('rememberSpeed'),
    forceSpeed: document.getElementById('forceSpeed'),
    workOnAudio: document.getElementById('workOnAudio'),
    preservePitch: document.getElementById('preservePitch'),
    opacity: document.getElementById('opacity'),
    opacityValue: document.getElementById('opacity-value'),
    autoHideDelay: document.getElementById('autoHideDelay'),
    autoHideDelayValue: document.getElementById('autoHideDelay-value'),
    controllerMode: document.getElementById('controllerMode'),
    shortcutsList: document.getElementById('shortcuts-list'),
    siteAccessMode: document.getElementById('siteAccessMode'),
    blacklistInput: document.getElementById('blacklist-input'),
    blacklistAdd: document.getElementById('blacklist-add'),
    blacklistList: document.getElementById('blacklist-list'),
    blacklistContainer: document.getElementById('blacklist-container'),
    whitelistInput: document.getElementById('whitelist-input'),
    whitelistAdd: document.getElementById('whitelist-add'),
    whitelistList: document.getElementById('whitelist-list'),
    whitelistContainer: document.getElementById('whitelist-container'),
    btnExport: document.getElementById('btn-export'),
    btnImport: document.getElementById('btn-import'),
    btnReset: document.getElementById('btn-reset'),
    importInput: document.getElementById('import-input'),
    notification: document.getElementById('notification'),
    speedPresetsBar: document.querySelector('.speed-presets-bar'),
    timeSaved: document.getElementById('time-saved'),
    urlRulePattern: document.getElementById('url-rule-pattern'),
    urlRuleSpeed: document.getElementById('url-rule-speed'),
    urlRuleAdd: document.getElementById('url-rule-add'),
    urlRulesList: document.getElementById('url-rules-list'),
    colorBackground: document.getElementById('colorBackground'),
    colorAccent: document.getElementById('colorAccent'),
    showPipIndicator: document.getElementById('showPipIndicator'),
    syncStatus: document.getElementById('sync-status'),
    syncTime: document.getElementById('sync-time'),
    // Intro/Outro Skip elements
    introOutroEnabled: document.getElementById('introOutroEnabled'),
    defaultIntroSkip: document.getElementById('defaultIntroSkip'),
    defaultOutroSkip: document.getElementById('defaultOutroSkip'),
    autoSkipIntro: document.getElementById('autoSkipIntro'),
    skipIntroKey: document.getElementById('skipIntroKey'),
    skipOutroKey: document.getElementById('skipOutroKey'),
    introOutroSite: document.getElementById('intro-outro-site'),
    introOutroIntro: document.getElementById('intro-outro-intro'),
    introOutroOutro: document.getElementById('intro-outro-outro'),
    introOutroRuleAdd: document.getElementById('intro-outro-rule-add'),
    introOutroRulesList: document.getElementById('intro-outro-rules-list'),
    // New feature settings
    rememberFilters: document.getElementById('rememberFilters'),
    rememberVolumeBoost: document.getElementById('rememberVolumeBoost'),
    // Feedback modal elements
    btnFeedback: document.getElementById('btn-feedback'),
    feedbackModal: document.getElementById('feedback-modal'),
    modalClose: document.getElementById('modal-close'),
    feedbackDescription: document.getElementById('feedback-description'),
    includeUrl: document.getElementById('include-url'),
    infoVersion: document.getElementById('info-version'),
    infoBrowser: document.getElementById('info-browser'),
    infoPlatform: document.getElementById('info-platform'),
    infoUrl: document.getElementById('info-url'),
    btnCopyReport: document.getElementById('btn-copy-report'),
    btnOpenGithub: document.getElementById('btn-open-github')
  };

  // Initialize popup
  async function init() {
    // Load settings
    settings = await chrome.runtime.sendMessage({ type: 'getSettings' });

    await loadActiveSite();

    // Apply settings to UI
    applySettingsToUI();

    // Set up event listeners
    setupEventListeners();
  }

  async function loadActiveSite() {
    currentHostname = null;

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tabs[0]?.url;
      if (!url) return;

      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return;

      currentHostname = parsed.hostname;
    } catch (e) {
      // Ignore invalid URLs (chrome://, about:blank, etc.)
    }
  }

  // Apply settings to UI elements
  function applySettingsToUI() {
    elements.enabled.checked = settings.enabled !== false;
    elements.hideByDefault.checked = settings.hideByDefault === true;
    elements.rememberSpeed.checked = settings.rememberSpeed === true;
    elements.forceSpeed.checked = settings.forceSpeed === true;
    elements.workOnAudio.checked = settings.workOnAudio === true;
    if (elements.preservePitch) {
      elements.preservePitch.checked = settings.preservePitch !== false;
    }
    elements.opacity.value = settings.opacity || 0.8;
    elements.opacityValue.textContent = Math.round((settings.opacity || 0.8) * 100) + '%';
    elements.controllerMode.value = settings.controllerMode || 'minimal';
    if (elements.siteAccessMode) {
      elements.siteAccessMode.value = settings.siteAccessMode || 'blacklist';
    }

    // Auto-hide delay
    const autoHide = settings.autoHideDelay || 0;
    elements.autoHideDelay.value = autoHide;
    elements.autoHideDelayValue.textContent = autoHide === 0 ? 'Off' : autoHide + 's';

    // Color pickers
    elements.colorBackground.value = settings.colorBackground || '#1a1a2e';
    elements.colorAccent.value = settings.colorAccent || '#e94560';

    // PiP indicator setting
    if (elements.showPipIndicator) {
      elements.showPipIndicator.checked = settings.showPipIndicator !== false;
    }

    // Time saved display
    updateTimeSavedDisplay();

    // Sync status
    updateSyncStatus();

    // Intro/Outro Skip settings
    if (elements.introOutroEnabled) {
      elements.introOutroEnabled.checked = settings.introOutroEnabled === true;
    }
    if (elements.defaultIntroSkip) {
      elements.defaultIntroSkip.value = settings.defaultIntroSkip || 0;
    }
    if (elements.defaultOutroSkip) {
      elements.defaultOutroSkip.value = settings.defaultOutroSkip || 0;
    }
    if (elements.autoSkipIntro) {
      elements.autoSkipIntro.checked = settings.autoSkipIntro === true;
    }
    if (elements.skipIntroKey) {
      elements.skipIntroKey.value = settings.skipIntroKey || 'I';
    }
    if (elements.skipOutroKey) {
      elements.skipOutroKey.value = settings.skipOutroKey || 'O';
    }

    // New feature settings
    if (elements.rememberFilters) {
      elements.rememberFilters.checked = settings.rememberFilters === true;
    }
    if (elements.rememberVolumeBoost) {
      elements.rememberVolumeBoost.checked = settings.rememberVolumeBoost === true;
    }


    renderShortcuts();
    renderBlacklist();
    renderWhitelist();
    updateSiteAccessVisibility();
    renderUrlRules();
    renderIntroOutroRules();
  }

  // Update sync status display
  async function updateSyncStatus() {
    if (!elements.syncStatus || !elements.syncTime) return;

    const response = await chrome.runtime.sendMessage({ type: 'getSyncStatus' });
    
    if (response.lastSyncTime) {
      const date = new Date(response.lastSyncTime);
      const timeAgo = getTimeAgo(date);
      elements.syncTime.textContent = timeAgo;
      elements.syncStatus.classList.add('synced');
    } else {
      elements.syncTime.textContent = 'Not synced';
    }
  }

  // Get human-readable time ago string
  function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return date.toLocaleDateString();
  }

  // Format and display time saved
  function updateTimeSavedDisplay() {
    const totalSeconds = settings.timeSaved || 0;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    let display = '';
    if (hours > 0) {
      display = `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      display = `${minutes}m ${seconds}s`;
    } else {
      display = `${seconds}s`;
    }
    elements.timeSaved.textContent = display;
  }

  // Render shortcuts list
  function renderShortcuts() {
    const shortcuts = settings.shortcuts || [];
    elements.shortcutsList.innerHTML = shortcuts.map((shortcut, index) => `
      <div class="shortcut-item" data-index="${index}">
        <span class="shortcut-action">${ACTION_LABELS[shortcut.action] || shortcut.action}</span>
        <div class="shortcut-key">
          <input type="text" class="key-input" data-field="key" value="${shortcut.key}" readonly>
        </div>
        ${VALUE_UNITS[shortcut.action] ? `
          <div class="shortcut-value">
            <input type="number" class="value-input" data-field="value" value="${shortcut.value || ''}" step="0.1" min="0.1">
          </div>
        ` : '<div class="shortcut-value"></div>'}
        <label class="toggle-switch shortcut-toggle">
          <input type="checkbox" data-field="enabled" ${shortcut.enabled !== false ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    `).join('');
  }

  // Render blacklist
  function renderBlacklist() {
    const blacklist = settings.blacklist || [];
    elements.blacklistList.innerHTML = blacklist.map((pattern, index) => `
      <div class="blacklist-item" data-index="${index}">
        <span>${escapeHtml(pattern)}</span>
        <button class="blacklist-remove" data-index="${index}">&times;</button>
      </div>
    `).join('');
  }

  // Render whitelist
  function renderWhitelist() {
    if (!elements.whitelistList) return;
    const whitelist = settings.whitelist || [];
    elements.whitelistList.innerHTML = whitelist.map((pattern, index) => `
      <div class="blacklist-item" data-index="${index}">
        <span>${escapeHtml(pattern)}</span>
        <button class="blacklist-remove" data-index="${index}">&times;</button>
      </div>
    `).join('');
  }


  function updateSiteAccessVisibility() {
    if (!elements.siteAccessMode) return;
    const mode = settings.siteAccessMode || 'blacklist';
    if (elements.blacklistContainer) {
      elements.blacklistContainer.classList.toggle('hidden', mode !== 'blacklist');
    }
    if (elements.whitelistContainer) {
      elements.whitelistContainer.classList.toggle('hidden', mode !== 'whitelist');
    }
  }


  // Render URL rules
  function renderUrlRules() {
    const urlRules = settings.urlRules || [];
    elements.urlRulesList.innerHTML = urlRules.map((rule, index) => `
      <div class="url-rule-item" data-index="${index}">
        <div class="url-rule-info">
          <span class="url-rule-item-pattern">${escapeHtml(rule.pattern)}</span>
          <span class="url-rule-item-speed">${rule.speed}x</span>
        </div>
        <button class="url-rule-remove" data-index="${index}">&times;</button>
      </div>
    `).join('');
  }

  // Render Intro/Outro site rules
  function renderIntroOutroRules() {
    const introOutroSiteRules = settings.introOutroSiteRules || [];
    if (!elements.introOutroRulesList) return;
    
    elements.introOutroRulesList.innerHTML = introOutroSiteRules.map((rule, index) => `
      <div class="intro-outro-rule-item" data-index="${index}">
        <div class="intro-outro-rule-info">
          <span class="intro-outro-rule-site">${escapeHtml(rule.site)}</span>
          <div class="intro-outro-rule-times">
            <span class="intro-outro-rule-intro">${rule.intro}s</span>
            <span class="intro-outro-rule-outro">${rule.outro}s</span>
          </div>
        </div>
        <button class="intro-outro-rule-remove" data-index="${index}">&times;</button>
      </div>
    `).join('');
  }

  // Setup event listeners
  function setupEventListeners() {
    // Main toggle
    elements.enabled.addEventListener('change', () => {
      settings.enabled = elements.enabled.checked;
      saveSettings();
    });

    // Simple toggles
    ['hideByDefault', 'rememberSpeed', 'forceSpeed', 'workOnAudio', 'preservePitch', 'rememberFilters', 'rememberVolumeBoost'].forEach(id => {
      if (!elements[id]) return;
      elements[id].addEventListener('change', () => {
        settings[id] = elements[id].checked;
        saveSettings();
      });
    });

    // PiP indicator toggle
    if (elements.showPipIndicator) {
      elements.showPipIndicator.addEventListener('change', () => {
        settings.showPipIndicator = elements.showPipIndicator.checked;
        saveSettings();
      });
    }

    // Opacity slider
    elements.opacity.addEventListener('input', () => {
      const value = parseFloat(elements.opacity.value);
      elements.opacityValue.textContent = Math.round(value * 100) + '%';
      settings.opacity = value;
      saveSettings();
    });

    // Controller mode
    elements.controllerMode.addEventListener('change', () => {
      settings.controllerMode = elements.controllerMode.value;
      saveSettings();
    });

    // Site access mode
    if (elements.siteAccessMode) {
      elements.siteAccessMode.addEventListener('change', () => {
        settings.siteAccessMode = elements.siteAccessMode.value;
        updateSiteAccessVisibility();
        saveSettings();
      });
    }

    // Auto-hide delay
    elements.autoHideDelay.addEventListener('input', () => {
      const value = parseInt(elements.autoHideDelay.value);
      elements.autoHideDelayValue.textContent = value === 0 ? 'Off' : value + 's';
      settings.autoHideDelay = value;
      saveSettings();
    });

    // Color pickers
    elements.colorBackground.addEventListener('input', () => {
      settings.colorBackground = elements.colorBackground.value;
      saveSettings();
    });

    elements.colorAccent.addEventListener('input', () => {
      settings.colorAccent = elements.colorAccent.value;
      saveSettings();
    });

    // Speed presets bar click
    elements.speedPresetsBar.addEventListener('click', async (e) => {
      const btn = e.target.closest('.speed-preset-btn');
      if (!btn) return;

      const speed = parseFloat(btn.dataset.speed);

      // Send speed to active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'setSpeed', speed });
      }

      // Update button states
      elements.speedPresetsBar.querySelectorAll('.speed-preset-btn').forEach(b => {
        b.classList.toggle('active', parseFloat(b.dataset.speed) === speed);
      });
    });

    // Shortcuts list events (delegated)
    elements.shortcutsList.addEventListener('click', handleShortcutClick);
    elements.shortcutsList.addEventListener('change', handleShortcutChange);
    elements.shortcutsList.addEventListener('keydown', handleShortcutKeydown);

    // Blacklist
    elements.blacklistAdd.addEventListener('click', addBlacklistItem);
    elements.blacklistInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addBlacklistItem();
    });
    elements.blacklistList.addEventListener('click', handleBlacklistClick);

    // Whitelist
    if (elements.whitelistAdd && elements.whitelistInput && elements.whitelistList) {
      elements.whitelistAdd.addEventListener('click', addWhitelistItem);
      elements.whitelistInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addWhitelistItem();
      });
      elements.whitelistList.addEventListener('click', handleWhitelistClick);
    }


    // URL Rules
    elements.urlRuleAdd.addEventListener('click', addUrlRule);
    elements.urlRulePattern.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addUrlRule();
    });
    elements.urlRulesList.addEventListener('click', handleUrlRuleClick);

    // Footer buttons
    elements.btnExport.addEventListener('click', exportSettings);
    elements.btnImport.addEventListener('click', () => elements.importInput.click());
    elements.importInput.addEventListener('change', importSettings);
    elements.btnReset.addEventListener('click', resetSettings);

    // Intro/Outro Skip settings
    if (elements.introOutroEnabled) {
      elements.introOutroEnabled.addEventListener('change', () => {
        settings.introOutroEnabled = elements.introOutroEnabled.checked;
        saveSettings();
      });
    }

    if (elements.defaultIntroSkip) {
      elements.defaultIntroSkip.addEventListener('change', () => {
        settings.defaultIntroSkip = parseInt(elements.defaultIntroSkip.value) || 0;
        saveSettings();
      });
    }

    if (elements.defaultOutroSkip) {
      elements.defaultOutroSkip.addEventListener('change', () => {
        settings.defaultOutroSkip = parseInt(elements.defaultOutroSkip.value) || 0;
        saveSettings();
      });
    }

    if (elements.autoSkipIntro) {
      elements.autoSkipIntro.addEventListener('change', () => {
        settings.autoSkipIntro = elements.autoSkipIntro.checked;
        saveSettings();
      });
    }

    // Intro/Outro key inputs (click to record)
    if (elements.skipIntroKey) {
      elements.skipIntroKey.addEventListener('click', () => {
        startKeyRecording(elements.skipIntroKey, 'skipIntroKey');
      });
    }

    if (elements.skipOutroKey) {
      elements.skipOutroKey.addEventListener('click', () => {
        startKeyRecording(elements.skipOutroKey, 'skipOutroKey');
      });
    }

    // Intro/Outro site rules
    if (elements.introOutroRuleAdd) {
      elements.introOutroRuleAdd.addEventListener('click', addIntroOutroRule);
    }
    if (elements.introOutroSite) {
      elements.introOutroSite.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addIntroOutroRule();
      });
    }
    if (elements.introOutroRulesList) {
      elements.introOutroRulesList.addEventListener('click', handleIntroOutroRuleClick);
    }

    // Global key listener for recording shortcuts
    document.addEventListener('keydown', handleGlobalKeydown);

    // Feedback modal events
    if (elements.btnFeedback) {
      elements.btnFeedback.addEventListener('click', openFeedbackModal);
    }
    if (elements.modalClose) {
      elements.modalClose.addEventListener('click', closeFeedbackModal);
    }
    if (elements.feedbackModal) {
      elements.feedbackModal.addEventListener('click', (e) => {
        if (e.target === elements.feedbackModal) closeFeedbackModal();
      });
    }
    if (elements.btnCopyReport) {
      elements.btnCopyReport.addEventListener('click', copyReportToClipboard);
    }
    if (elements.btnOpenGithub) {
      elements.btnOpenGithub.addEventListener('click', openGitHubIssue);
    }
    if (elements.includeUrl) {
      elements.includeUrl.addEventListener('change', () => {
        elements.infoUrl.style.display = elements.includeUrl.checked ? 'block' : 'none';
      });
    }
  }

  // Track which key input we're recording for
  let recordingKeyInput = null;
  let recordingKeyField = null;

  // Start recording a key for intro/outro hotkeys
  function startKeyRecording(input, field) {
    // Clear any existing recording
    if (recordingKeyInput) {
      recordingKeyInput.classList.remove('recording');
    }
    if (recordingInput) {
      recordingInput.classList.remove('recording');
    }

    recordingKeyInput = input;
    recordingKeyField = field;
    input.classList.add('recording');
    input.value = 'Press key...';
  }

  // Add intro/outro site rule
  function addIntroOutroRule() {
    const site = elements.introOutroSite.value.trim();
    const intro = parseInt(elements.introOutroIntro.value) || 0;
    const outro = parseInt(elements.introOutroOutro.value) || 0;

    if (!site) {
      showNotification('Please enter a site', 'error');
      return;
    }

    if (intro === 0 && outro === 0) {
      showNotification('Please enter intro or outro time', 'error');
      return;
    }

    // Check for duplicates
    settings.introOutroSiteRules = settings.introOutroSiteRules || [];
    const exists = settings.introOutroSiteRules.some(r => r.site.toLowerCase() === site.toLowerCase());
    if (exists) {
      showNotification('Rule for this site already exists', 'error');
      return;
    }

    settings.introOutroSiteRules.push({ site, intro, outro });
    elements.introOutroSite.value = '';
    elements.introOutroIntro.value = '';
    elements.introOutroOutro.value = '';
    renderIntroOutroRules();
    saveSettings();
    showNotification('Site rule added', 'success');
  }

  // Handle intro/outro rule click (remove)
  function handleIntroOutroRuleClick(e) {
    const removeBtn = e.target.closest('.intro-outro-rule-remove');
    if (!removeBtn) return;

    const index = parseInt(removeBtn.dataset.index);
    settings.introOutroSiteRules.splice(index, 1);
    renderIntroOutroRules();
    saveSettings();
  }

  // Handle shortcut item click
  function handleShortcutClick(e) {
    const keyInput = e.target.closest('.key-input');
    if (keyInput) {
      // Start recording
      if (recordingInput) {
        recordingInput.classList.remove('recording');
      }
      recordingInput = keyInput;
      keyInput.classList.add('recording');
      keyInput.value = 'Press key...';
    }
  }

  // Handle global keydown for recording
  function handleGlobalKeydown(e) {
    // Handle intro/outro key recording
    if (recordingKeyInput) {
      e.preventDefault();
      e.stopPropagation();

      // Ignore modifier-only keys
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;

      // Update the setting
      settings[recordingKeyField] = key;
      recordingKeyInput.classList.remove('recording');
      recordingKeyInput.value = key;
      recordingKeyInput = null;
      recordingKeyField = null;
      saveSettings();
      return;
    }

    // Handle shortcut recording
    if (!recordingInput) return;

    e.preventDefault();
    e.stopPropagation();

    // Ignore modifier-only keys
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    const index = parseInt(recordingInput.closest('.shortcut-item').dataset.index);
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;

    // Check for conflicts
    const conflict = settings.shortcuts.find((s, i) =>
      i !== index && s.enabled && s.key.toUpperCase() === key.toUpperCase()
    );

    if (conflict) {
      showNotification('Key already in use by another shortcut', 'error');
      recordingInput.classList.remove('recording');
      recordingInput.value = settings.shortcuts[index].key;
      recordingInput = null;
      return;
    }

    // Update shortcut
    settings.shortcuts[index].key = key;
    recordingInput.classList.remove('recording');
    recordingInput.value = key;
    recordingInput = null;
    saveSettings();
  }

  // Handle shortcut change (toggle, value)
  function handleShortcutChange(e) {
    const item = e.target.closest('.shortcut-item');
    if (!item) return;

    const index = parseInt(item.dataset.index);
    const field = e.target.dataset.field;

    if (field === 'enabled') {
      settings.shortcuts[index].enabled = e.target.checked;
    } else if (field === 'value') {
      settings.shortcuts[index].value = parseFloat(e.target.value);
    }

    saveSettings();
  }

  // Handle shortcut keydown (prevent recording when clicking input)
  function handleShortcutKeydown(e) {
    const valueInput = e.target.closest('.value-input');
    if (valueInput) {
      e.stopPropagation();
    }
  }

  // Add blacklist item
  function addBlacklistItem() {
    const pattern = elements.blacklistInput.value.trim();
    if (!pattern) return;

    // Validate regex
    if (pattern.startsWith('/') || pattern.includes('*')) {
      try {
        new RegExp(pattern.replace(/^\/?(.+)\/?$/, '$1'));
      } catch (e) {
        showNotification('Invalid regex pattern', 'error');
        return;
      }
    }

    // Check for duplicates
    if (settings.blacklist?.includes(pattern)) {
      showNotification('Pattern already exists', 'error');
      return;
    }

    settings.blacklist = settings.blacklist || [];
    settings.blacklist.push(pattern);
    elements.blacklistInput.value = '';
    renderBlacklist();
    saveSettings();
    showNotification('Site added to blacklist', 'success');
  }

  // Handle blacklist item click (remove)
  function handleBlacklistClick(e) {
    const removeBtn = e.target.closest('.blacklist-remove');
    if (!removeBtn) return;

    const index = parseInt(removeBtn.dataset.index);
    settings.blacklist.splice(index, 1);
    renderBlacklist();
    saveSettings();
  }

  // Add whitelist item
  function addWhitelistItem() {
    const pattern = elements.whitelistInput.value.trim();
    if (!pattern) return;

    // Validate regex
    if (pattern.startsWith('/') || pattern.includes('*')) {
      try {
        new RegExp(pattern.replace(/^\/?(.+)\/?$/, '$1'));
      } catch (e) {
        showNotification('Invalid regex pattern', 'error');
        return;
      }
    }

    // Check for duplicates
    if (settings.whitelist?.includes(pattern)) {
      showNotification('Pattern already exists', 'error');
      return;
    }

    settings.whitelist = settings.whitelist || [];
    settings.whitelist.push(pattern);
    elements.whitelistInput.value = '';
    renderWhitelist();
    saveSettings();
    showNotification('Site added to allowlist', 'success');
  }

  // Handle whitelist item click (remove)
  function handleWhitelistClick(e) {
    const removeBtn = e.target.closest('.blacklist-remove');
    if (!removeBtn) return;

    const index = parseInt(removeBtn.dataset.index);
    settings.whitelist.splice(index, 1);
    renderWhitelist();
    saveSettings();
  }


  // Add URL rule
  function addUrlRule() {
    const pattern = elements.urlRulePattern.value.trim();
    const speed = parseFloat(elements.urlRuleSpeed.value);

    if (!pattern) {
      showNotification('Please enter a URL pattern', 'error');
      return;
    }

    if (isNaN(speed) || speed < 0.1 || speed > 16) {
      showNotification('Speed must be between 0.1 and 16', 'error');
      return;
    }

    // Check for duplicates
    settings.urlRules = settings.urlRules || [];
    const exists = settings.urlRules.some(r => r.pattern === pattern);
    if (exists) {
      showNotification('Rule for this pattern already exists', 'error');
      return;
    }

    settings.urlRules.push({ pattern, speed });
    elements.urlRulePattern.value = '';
    elements.urlRuleSpeed.value = '1';
    renderUrlRules();
    saveSettings();
    showNotification('URL rule added', 'success');
  }

  // Handle URL rule click (remove)
  function handleUrlRuleClick(e) {
    const removeBtn = e.target.closest('.url-rule-remove');
    if (!removeBtn) return;

    const index = parseInt(removeBtn.dataset.index);
    settings.urlRules.splice(index, 1);
    renderUrlRules();
    saveSettings();
  }

  // Export settings
  async function exportSettings() {
    const data = await chrome.runtime.sendMessage({ type: 'exportSettings' });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'video-speed-controller-settings.json';
    a.click();

    URL.revokeObjectURL(url);
    showNotification('Settings exported', 'success');
  }

  // Import settings
  async function importSettings(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate imported data
      if (typeof data !== 'object' || !data.shortcuts) {
        throw new Error('Invalid settings file');
      }

      const merged = { ...settings, ...data };
      await chrome.runtime.sendMessage({ type: 'importSettings', settings: merged });
      settings = merged;
      await loadActiveSite();
      applySettingsToUI();
      showNotification('Settings imported', 'success');
    } catch (error) {
      showNotification('Failed to import settings', 'error');
    }

    // Reset input
    e.target.value = '';
  }

  // Reset settings
  async function resetSettings() {
    if (!confirm('Reset all settings to defaults?')) return;

    const response = await chrome.runtime.sendMessage({ type: 'resetSettings' });
    settings = response.settings;
    await loadActiveSite();
    applySettingsToUI();
    showNotification('Settings reset to defaults', 'success');
  }

  // Save settings to storage
  async function saveSettings() {
    await chrome.runtime.sendMessage({ type: 'saveSettings', settings });
    // Update sync time
    await chrome.runtime.sendMessage({ type: 'updateSyncTime' });
    updateSyncStatus();
  }

  // Show notification
  function showNotification(message, type = 'success') {
    elements.notification.textContent = message;
    elements.notification.className = `notification ${type} show`;

    setTimeout(() => {
      elements.notification.classList.remove('show');
    }, 2000);
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ========== Feedback/Bug Report Functions ==========

  // Store current page URL for feedback
  let currentPageUrl = '';

  // Open feedback modal
  async function openFeedbackModal() {
    if (!elements.feedbackModal) return;

    // Get system info
    const manifest = chrome.runtime.getManifest();
    const browserInfo = getBrowserInfo();
    
    // Get current tab URL
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      currentPageUrl = tabs[0]?.url || 'Unknown';
    } catch (e) {
      currentPageUrl = 'Unable to retrieve';
    }

    // Populate system info
    elements.infoVersion.textContent = `v${manifest.version}`;
    elements.infoBrowser.textContent = browserInfo.browser;
    elements.infoPlatform.textContent = browserInfo.platform;
    elements.infoUrl.textContent = currentPageUrl;
    elements.infoUrl.style.display = elements.includeUrl.checked ? 'block' : 'none';

    // Show/hide GitHub button based on repo configuration
    const githubRepo = getGitHubRepoUrl();
    if (elements.btnOpenGithub) {
      elements.btnOpenGithub.style.display = githubRepo ? 'flex' : 'none';
    }

    // Clear previous description
    elements.feedbackDescription.value = '';

    // Show modal
    elements.feedbackModal.classList.remove('hidden');
    elements.feedbackDescription.focus();
  }

  // Close feedback modal
  function closeFeedbackModal() {
    if (!elements.feedbackModal) return;
    elements.feedbackModal.classList.add('hidden');
  }

  // Get browser info
  function getBrowserInfo() {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    let platform = navigator.platform || 'Unknown';

    // Detect browser
    if (ua.includes('Firefox/')) {
      const match = ua.match(/Firefox\/(\d+\.\d+)/);
      browser = `Firefox ${match ? match[1] : ''}`;
    } else if (ua.includes('Edg/')) {
      const match = ua.match(/Edg\/(\d+\.\d+)/);
      browser = `Edge ${match ? match[1] : ''}`;
    } else if (ua.includes('Chrome/')) {
      const match = ua.match(/Chrome\/(\d+\.\d+)/);
      browser = `Chrome ${match ? match[1] : ''}`;
    } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
      const match = ua.match(/Version\/(\d+\.\d+)/);
      browser = `Safari ${match ? match[1] : ''}`;
    }

    // Simplify platform
    if (platform.includes('Win')) {
      platform = 'Windows';
    } else if (platform.includes('Mac')) {
      platform = 'macOS';
    } else if (platform.includes('Linux')) {
      platform = 'Linux';
    }

    return { browser, platform };
  }

  // Generate bug report text
  function generateReport() {
    const manifest = chrome.runtime.getManifest();
    const browserInfo = getBrowserInfo();
    const description = elements.feedbackDescription.value.trim();
    const includeUrl = elements.includeUrl.checked;

    let report = `=== Video Speed Controller Pro - Bug Report ===\n\n`;
    report += `DESCRIPTION:\n${description || '(No description provided)'}\n\n`;
    report += `SYSTEM INFORMATION:\n`;
    report += `- Extension Version: v${manifest.version}\n`;
    report += `- Browser: ${browserInfo.browser}\n`;
    report += `- Platform: ${browserInfo.platform}\n`;
    
    if (includeUrl && currentPageUrl) {
      report += `- Page URL: ${currentPageUrl}\n`;
    }

    report += `\n--- End of Report ---`;
    
    return report;
  }

  // Copy report to clipboard
  async function copyReportToClipboard() {
    const report = generateReport();
    
    try {
      await navigator.clipboard.writeText(report);
      showNotification('Report copied to clipboard!', 'success');
      closeFeedbackModal();
    } catch (e) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = report;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showNotification('Report copied to clipboard!', 'success');
      closeFeedbackModal();
    }
  }

  // Open GitHub issue
  function openGitHubIssue() {
    const manifest = chrome.runtime.getManifest();
    const description = elements.feedbackDescription.value.trim();
    
    if (!description) {
      showNotification('Please describe the issue', 'error');
      elements.feedbackDescription.focus();
      return;
    }

    const report = generateReport();
    const browserInfo = getBrowserInfo();
    
    // GitHub issue template
    const title = encodeURIComponent(`[Bug Report] Issue in v${manifest.version}`);
    const body = encodeURIComponent(
      `## Description\n${description || '(No description provided)'}\n\n` +
      `## System Information\n` +
      `- Extension Version: v${manifest.version}\n` +
      `- Browser: ${browserInfo.browser}\n` +
      `- Platform: ${browserInfo.platform}\n` +
      (elements.includeUrl.checked && currentPageUrl ? `- Page URL: ${currentPageUrl}\n` : '') +
      `\n## Full Report\n\`\`\`\n${report}\n\`\`\``
    );
    
    const githubRepo = getGitHubRepoUrl();
    
    if (githubRepo) {
      const issueUrl = `${githubRepo}/issues/new?title=${title}&body=${body}`;
      window.open(issueUrl, '_blank');
      showNotification('Opening GitHub issue...', 'success');
      closeFeedbackModal();
    } else {
      showNotification('GitHub repository not configured', 'error');
    }
  }

  function getGitHubRepoUrl() {
    const manifest = chrome.runtime.getManifest();
    if (manifest.homepage_url) {
      return manifest.homepage_url.replace(/\/$/, '');
    }
    return null;
  }

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
