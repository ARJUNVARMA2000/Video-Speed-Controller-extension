# Video Speed Controller

A browser extension to control video and audio playback speed with customizable keyboard shortcuts and an elegant dark UI.

![Chrome](https://img.shields.io/badge/Chrome-Supported-green?logo=googlechrome)
![Firefox](https://img.shields.io/badge/Firefox-Supported-orange?logo=firefox)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)

## ✨ Features

- **Universal Support** — Works on any website with HTML5 video (YouTube, Netflix, Vimeo, etc.)
- **Keyboard Shortcuts** — Control playback speed without touching your mouse
- **Two Display Modes** — Minimal badge or full control panel
- **Remember Speed** — Saves your preferred speed per website
- **Site Blacklist** — Disable the extension on specific sites
- **Draggable Controller** — Position the overlay anywhere on the video
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
The speed badge appears in the top-left corner of videos, showing the current playback rate.

### Full Mode (Panel)
A complete control panel with:
- Speed display
- Increase/Decrease buttons
- Preset speed buttons (0.5x, 1x, 1.5x, 2x, 3x)
- Seek controls (-10s, +10s)

### Popup Settings
Configure all settings through an elegant dark-themed popup interface.

## ⚙️ Settings

| Setting | Description |
|---------|-------------|
| **Controller Mode** | Choose between minimal badge or full panel |
| **Opacity** | Adjust controller transparency (10% - 100%) |
| **Hide by Default** | Start with controller hidden, press `V` to show |
| **Remember Speed** | Save playback speed per website |
| **Force Saved Speed** | Override player's default speed |
| **Work on Audio** | Also control `<audio>` elements |

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

This extension stores your preferences (playback speed, settings) locally in your browser. No data is collected, transmitted, or shared with any third parties.

## 📄 License

MIT License — feel free to use, modify, and distribute.

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

## 📝 Changelog

### v1.0.0
- Initial release
- Video speed control with keyboard shortcuts
- Two display modes (minimal/full)
- Per-site speed memory
- Site blacklist
- Settings export/import
- Dark theme UI
