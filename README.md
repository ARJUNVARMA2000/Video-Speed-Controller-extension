# Video Speed Controller

A browser extension to control video and audio playback speed with customizable keyboard shortcuts and an elegant dark UI.

![Chrome](https://img.shields.io/badge/Chrome-Supported-green?logo=googlechrome)
![Firefox](https://img.shields.io/badge/Firefox-Supported-orange?logo=firefox)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)

## ✨ Features

- **Universal Support** — Works on any website with HTML5 video (YouTube, Netflix, Vimeo, etc.)
- **Keyboard Shortcuts** — Control playback speed without touching your mouse
- **Two Display Modes** — Minimal badge or full control panel
- **Frame-by-Frame Navigation** — Step through videos one frame at a time (`,` and `.` keys)
- **Picture-in-Picture Control** — Floating speed controller when using PiP mode
- **Pitch Correction Toggle** — Turn pitch correction ON/OFF (disable for chipmunk effect)
- **Mouse Wheel Control** — Scroll on the controller to quickly adjust speed
- **Right-Click Context Menu** — Quick speed selection via right-click on any video
- **Long-Press Speed Boost** — Hold `G` to temporarily boost speed, release to restore
- **URL Speed Rules** — Set automatic speeds for specific URL patterns (e.g., `/shorts` → 1x)
- **Auto-Hide Controller** — Controller fades out after configurable delay
- **Time Saved Tracking** — See how much time you've saved watching at faster speeds
- **Remember Speed** — Saves your preferred speed per website
- **Cloud Sync** — Settings sync across devices via Chrome/Firefox account
- **Site Blacklist** — Disable the extension on specific sites
- **Draggable Controller** — Position the overlay anywhere on the video
- **Customizable Colors** — Change background and accent colors of the controller
- **Export/Import Settings** — Backup and restore your configuration
- **Dark Theme** — Beautiful, modern dark UI

## 🎮 Default Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Show/Hide controller |
| `S` | Decrease speed (-0.1x) |
| `D` | Increase speed (+0.1x) |
| `R` | Reset to 1.0x |
| `G` | Jump to preferred speed (3.0x) |
| `Z` | Rewind 10 seconds |
| `X` | Fast forward 10 seconds |
| `,` | Previous frame (pauses video) |
| `.` | Next frame (pauses video) |

All shortcuts are customizable in the extension popup.

## 📦 Installation

### Chrome / Edge / Brave (Manual)

1. Download or clone this repository
2. Open your browser and navigate to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked**
5. Select the extension folder

### Firefox (Manual)

1. Download or clone this repository
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select the `manifest.json` file from the extension folder

## 🖼️ Screenshots

### Minimal Mode (Badge)
The speed badge appears in the top-right corner of videos, showing the current playback rate. Hover over the badge to reveal +/- buttons for quick speed adjustment.

### Full Mode (Panel)
A complete control panel with:
- Speed display
- Increase/Decrease buttons
- Preset speed buttons (0.5x, 1x, 1.5x, 2x, 3x)
- Seek controls (-10s, +10s)
- Frame-by-frame controls (|◀ and ▶|)
- Pitch correction toggle (ON/OFF)

### Picture-in-Picture Mode
When you enter PiP mode, a floating speed controller appears with:
- Current speed display
- Quick +/- speed buttons
- Reset to 1x button
- Draggable position
- Scroll wheel support

### Popup Settings
Configure all settings through an elegant dark-themed popup interface.

## ⚙️ Settings

| Setting | Description |
|---------|-------------|
| **Controller Mode** | Choose between minimal badge or full panel |
| **Opacity** | Adjust controller transparency (10% - 100%) |
| **Hide by Default** | Start with controller hidden, press `V` to show |
| **Auto-Hide Delay** | Automatically hide controller after X seconds |
| **Badge Colors** | Customize background and accent colors |
| **Remember Speed** | Save playback speed per website |
| **Force Saved Speed** | Override player's default speed |
| **Work on Audio** | Also control `<audio>` elements |
| **PiP Speed Indicator** | Show floating controller in Picture-in-Picture mode |
| **URL Speed Rules** | Set automatic speeds for URL patterns |
| **Site Blacklist** | Disable extension on specific domains |

## 🏗️ Project Structure

```
Video Speed Controller/
├── manifest.json           # Extension manifest (V3)
├── browser-polyfill.min.js # Cross-browser compatibility
├── background/
│   └── service-worker.js   # Background script for storage & messaging
├── content/
│   ├── content.js          # Main content script
│   └── controller.css      # Controller overlay styles
├── popup/
│   ├── popup.html          # Settings popup UI
│   ├── popup.js            # Popup logic
│   └── popup.css           # Popup styles (dark theme)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 🛠️ Development

### Prerequisites
- A Chromium-based browser (Chrome, Edge, Brave) or Firefox
- No build step required — pure HTML/CSS/JavaScript

### Making Changes
1. Edit the source files
2. Go to your browser's extensions page
3. Click the refresh icon on the extension card
4. Reload any pages where you want to test changes

### Testing
- Open any page with a video (e.g., YouTube)
- The speed controller should appear on the video
- Use keyboard shortcuts or click the extension icon to access settings

## 🔒 Privacy Policy

This extension stores your preferences (playback speed, settings) using your browser's sync storage. If you're signed into your browser account, settings will sync across your devices. No data is collected, transmitted, or shared with any third parties beyond the built-in browser sync.

## 📄 License

MIT License — feel free to use, modify, and distribute.

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

## 📝 Changelog

### v1.2.0
- Added frame-by-frame navigation (`,` and `.` keys)
- Added Picture-in-Picture speed control with floating indicator
- Added hover-to-reveal +/- buttons in minimal badge mode
- Added cloud sync status indicator
- Added URL speed rules for automatic speed per URL pattern
- Added customizable badge colors (background & accent)
- Added PiP indicator toggle setting
- Improved sync across devices visualization
- Improved click handling to prevent video play/pause interference

### v1.1.0
- Added pitch correction toggle (ON/OFF for chipmunk effect)
- Added mouse wheel speed control on controller
- Added right-click context menu for quick speed selection
- Added long-press speed boost (hold to boost, release to restore)
- Added auto-hide controller with configurable delay
- Added time saved tracking
- Moved controller to top-right corner by default

### v1.0.0
- Initial release
- Video speed control with keyboard shortcuts
- Two display modes (minimal/full)
- Per-site speed memory
- Site blacklist
- Settings export/import
- Dark theme UI
