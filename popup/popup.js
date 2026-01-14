// Video Speed Controller - Popup Settings

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
    'preferred-speed': 'Preferred Speed'
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

  // DOM Elements
  const elements = {
    enabled: document.getElementById('enabled'),
    hideByDefault: document.getElementById('hideByDefault'),
    rememberSpeed: document.getElementById('rememberSpeed'),
    forceSpeed: document.getElementById('forceSpeed'),
    workOnAudio: document.getElementById('workOnAudio'),
    opacity: document.getElementById('opacity'),
    opacityValue: document.getElementById('opacity-value'),
    controllerMode: document.getElementById('controllerMode'),
    shortcutsList: document.getElementById('shortcuts-list'),
    blacklistInput: document.getElementById('blacklist-input'),
    blacklistAdd: document.getElementById('blacklist-add'),
    blacklistList: document.getElementById('blacklist-list'),
    btnExport: document.getElementById('btn-export'),
    btnImport: document.getElementById('btn-import'),
    btnReset: document.getElementById('btn-reset'),
    importInput: document.getElementById('import-input'),
    notification: document.getElementById('notification')
  };

  // Initialize popup
  async function init() {
    // Load settings
    settings = await chrome.runtime.sendMessage({ type: 'getSettings' });

    // Apply settings to UI
    applySettingsToUI();

    // Set up event listeners
    setupEventListeners();
  }

  // Apply settings to UI elements
  function applySettingsToUI() {
    elements.enabled.checked = settings.enabled !== false;
    elements.hideByDefault.checked = settings.hideByDefault === true;
    elements.rememberSpeed.checked = settings.rememberSpeed === true;
    elements.forceSpeed.checked = settings.forceSpeed === true;
    elements.workOnAudio.checked = settings.workOnAudio === true;
    elements.opacity.value = settings.opacity || 0.8;
    elements.opacityValue.textContent = Math.round((settings.opacity || 0.8) * 100) + '%';
    elements.controllerMode.value = settings.controllerMode || 'minimal';

    renderShortcuts();
    renderBlacklist();
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

  // Setup event listeners
  function setupEventListeners() {
    // Main toggle
    elements.enabled.addEventListener('change', () => {
      settings.enabled = elements.enabled.checked;
      saveSettings();
    });

    // Simple toggles
    ['hideByDefault', 'rememberSpeed', 'forceSpeed', 'workOnAudio'].forEach(id => {
      elements[id].addEventListener('change', () => {
        settings[id] = elements[id].checked;
        saveSettings();
      });
    });

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

    // Footer buttons
    elements.btnExport.addEventListener('click', exportSettings);
    elements.btnImport.addEventListener('click', () => elements.importInput.click());
    elements.importInput.addEventListener('change', importSettings);
    elements.btnReset.addEventListener('click', resetSettings);

    // Global key listener for recording shortcuts
    document.addEventListener('keydown', handleGlobalKeydown);
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

      await chrome.runtime.sendMessage({ type: 'importSettings', settings: data });
      settings = data;
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
    applySettingsToUI();
    showNotification('Settings reset to defaults', 'success');
  }

  // Save settings to storage
  async function saveSettings() {
    await chrome.runtime.sendMessage({ type: 'saveSettings', settings });
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

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
