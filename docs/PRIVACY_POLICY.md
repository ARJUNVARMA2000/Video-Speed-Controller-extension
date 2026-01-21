# Privacy Policy for Video Speed Controller Pro

**Last Updated:** January 2025

## Overview

Video Speed Controller Pro ("we", "our", or "the extension") is committed to protecting your privacy. This privacy policy explains how we handle your data when you use our browser extension.

## Our Privacy Commitment

**We do NOT collect, store, or transmit any of your personal data to external servers.**

This extension operates entirely locally on your device. All data remains on your computer and is never sent to us or any third party.

## Data Collection

### What We DON'T Collect

- ❌ **No browsing history** — We don't track which websites you visit
- ❌ **No video viewing habits** — We don't monitor what videos you watch
- ❌ **No personal information** — We don't collect names, emails, or any identifying data
- ❌ **No analytics or telemetry** — We don't track how you use the extension
- ❌ **No network requests** — The extension makes zero calls to external servers
- ❌ **No third-party services** — We don't use any analytics, tracking, or data collection services

### What We Store Locally

All data is stored **exclusively on your device** using your browser's built-in storage APIs:

- **Playback speed preferences** — Your preferred video speeds per website
- **Keyboard shortcut configurations** — Your custom keyboard shortcuts
- **UI preferences** — Controller appearance settings (colors, opacity, mode)
- **Site access rules** — Your blacklist/whitelist settings
- **URL speed rules** — Custom speed rules for specific URL patterns
- **Video filter settings** — Brightness, contrast, and saturation preferences per site
- **Volume boost levels** — Your volume boost preferences per site
- **Intro/outro skip settings** — Your skip preferences and per-site rules
- **Time saved statistics** — Local counter of time saved (optional feature)

## Data Storage

### Browser Storage APIs

We use two browser storage APIs:

1. **`chrome.storage.sync`** — For settings that can sync across your devices
   - This uses your browser's built-in sync service (Google Account for Chrome, Firefox Account for Firefox)
   - **We do NOT have access to this data** — it's managed entirely by your browser
   - If you disable browser sync, data remains local only

2. **`chrome.storage.local`** — For data that should not sync (e.g., time saved statistics)
   - This data never leaves your device
   - It's stored in your browser's local storage

### Data Location

All data is stored in your browser's profile directory:
- **Chrome/Edge/Brave:** `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Local Extension Settings\[Extension ID]`
- **Firefox:** `%APPDATA%\Mozilla\Firefox\Profiles\[Profile]\storage\default\[Extension ID]`

## Permissions Explained

Our extension requests minimal permissions:

- **`storage`** — Required to save your preferences locally
- **`activeTab`** — Required to interact with videos on the current tab only

We do NOT request:
- ❌ Access to all websites (we use `activeTab` which only works on the current tab)
- ❌ Background access to browsing data
- ❌ Network access to external servers
- ❌ Any other sensitive permissions

## Data Sharing

**We do NOT share your data with anyone.**

- No data is sent to external servers
- No data is shared with third parties
- No data is used for advertising or marketing
- No data is sold or monetized

## Browser Sync

If you have browser sync enabled (Chrome Sync or Firefox Sync), your settings may sync across your devices. This is handled entirely by your browser's sync service, not by us. You can disable sync in your browser settings if you prefer.

## Data Deletion

You can delete all extension data at any time:

1. **Via Extension Settings:** Click the "Reset" button in the extension popup
2. **Via Browser:** Uninstall the extension (this removes all stored data)
3. **Via Browser Storage:** Manually clear extension storage in browser developer tools

## Children's Privacy

Our extension does not knowingly collect any information from children. Since we don't collect any data, this is not applicable, but we want to be clear: **we don't collect data from anyone, including children.**

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last Updated" date at the top of this document. We encourage you to review this policy periodically.

## Contact Us

If you have questions about this privacy policy or our data practices, please contact us:

- **GitHub Issues:** [REPLACE: Your GitHub Repository Issues URL, e.g., https://github.com/yourusername/video-speed-controller-pro/issues]
- **Email:** [REPLACE: Your Support Email, e.g., support@yourdomain.com or your-email@gmail.com]

## Compliance

This extension complies with:
- **GDPR (General Data Protection Regulation)** — No data collection means no GDPR concerns
- **CCPA (California Consumer Privacy Act)** — No data collection means no CCPA concerns
- **Browser Extension Store Policies** — Complies with Chrome Web Store and Firefox Add-ons policies

## Verification

You can verify our privacy claims by:
1. **Inspecting the source code** — All code is available in the extension package
2. **Using browser developer tools** — Check the Network tab to confirm no external requests
3. **Reviewing permissions** — We only request minimal, necessary permissions

## Summary

**In simple terms:** This extension works entirely on your device. We don't collect, store, or transmit any of your data. Your privacy is protected by design.

---

*This privacy policy is effective as of the date listed above and applies to all versions of Video Speed Controller Pro.*
