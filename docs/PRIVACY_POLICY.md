# Privacy Policy for Video Speed Controller Pro

**Last updated:** August 17, 2026

Video Speed Controller Pro does not collect analytics, create user profiles, sell data, or send
your activity to developer-operated servers. Its runtime behavior is local to the browser, apart
from Chrome's optional built-in settings sync described below.

## Data the extension processes

The extension reads the current page URL and HTML media-element state in memory so it can apply
site/URL rules, choose the active player, change playback speed, and calculate remaining time. It
does not store a browsing history or a list of watched videos.

If silence skipping is enabled, the browser's Web Audio API calculates short-lived amplitude
samples in memory. Audio is not recorded, retained, uploaded, or exposed outside the page's local
extension context. Unsupported, protected, or clearly cross-origin media is not analysed.

## Data stored by Chrome

The following user-created settings may be stored with `chrome.storage.sync`:

- playback speed, custom presets, and speed-step preferences;
- shortcut chords and controller appearance;
- site access lists, URL rules, and intro/outro rules;
- saved per-site speed, filter, and volume-boost preferences; and
- silence-skip preferences.

Chrome may sync those settings through the Google account connected to the browser. That service
is operated by the browser provider; the extension developer cannot access the synced contents.
Disable Chrome Sync to keep these settings only in the local browser profile.

The aggregate time-saved counter is stored in `chrome.storage.local` and is not placed in the
extension's Sync data.

## Permissions and site access

- `storage` saves and syncs the preferences listed above.
- `activeTab` lets the popup identify and control the current tab.
- A Manifest V3 content script runs on web pages so the extension can discover HTML5 video/audio
  and react when media is added dynamically or inside reachable frames and open shadow roots.

The extension does not request browsing-history, cookies, identity, location, microphone, camera,
downloads, or native-application permissions.

## Network activity and sharing

The shipped extension contains no analytics SDK, advertising SDK, telemetry endpoint, or
developer backend. It does not share or sell personal data. Loading a video and Chrome Sync may
involve the page's provider and Google respectively, but the extension does not add tracking
requests to those services.

The development-only locale generator is not part of the packaged extension and is not executed
in users' browsers.

## Deletion

Use **Reset settings** in the options page to clear extension preferences and the local time-saved
counter, or uninstall the extension to remove its browser-managed storage. Synced settings may
also be managed through Chrome's Sync controls.

## Changes and contact

Material changes will update the date at the top of this policy. Questions can be filed through
[GitHub Issues](https://github.com/ARJUNVARMA2000/Video-Speed-Controller-extension/issues).
