# Video Speed Controller Pro

A powerful browser extension to control video and audio playback speed with customizable keyboard shortcuts, screenshot capture, A-B loop, video filters, volume boost, intro/outro skip, and an elegant dark UI.

![Version](https://img.shields.io/badge/Version-1.3.0-purple)
![Chrome](https://img.shields.io/badge/Chrome-Supported-green?logo=googlechrome)
![Firefox](https://img.shields.io/badge/Firefox-Supported-orange?logo=firefox)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-brightgreen?logo=shield)

## ✨ Features

### Core Features
- **🔒 100% Privacy Focused** — All data stored locally on your device. No external servers, no tracking, no data collection
- **Universal Support** — Works on any website with HTML5 video (YouTube, Netflix, Vimeo, etc.)
- **Keyboard Shortcuts** — Control playback speed without touching your mouse
- **Two Display Modes** — Minimal badge or full control panel
- **Frame-by-Frame Navigation** — Step through videos one frame at a time (`,` and `.` keys)
- **Picture-in-Picture Control** — Floating speed controller when using PiP mode
- **Pitch Correction Toggle** — Turn pitch correction ON/OFF (disable for chipmunk effect)
- **Mouse Wheel Control** — Scroll on the controller to quickly adjust speed
- **Right-Click Context Menu** — Quick speed selection via right-click on any video
- **Long-Press Speed Boost** — Hold `G` to temporarily boost speed, release to restore

### 📸 Screenshot Capture (NEW)
- **Capture Video Frame** — Save the current video frame as a PNG image
- **Keyboard Shortcut** — Press `P` to take a screenshot instantly
- **Auto-Named Files** — Screenshots are automatically named with timestamps

### 🔁 A-B Loop (NEW)
- **Loop Any Section** — Set point A and point B to loop a specific segment
- **Visual Indicator** — Shows current loop range in the controller
- **Toggle On/Off** — Pause and resume the loop without clearing points
- **Keyboard Shortcuts** — Quick access via `[`, `]`, and `\` keys

### 🎨 Video Filters (NEW)
- **Brightness Control** — Adjust video brightness (0% - 200%)
- **Contrast Control** — Adjust video contrast (0% - 200%)
- **Saturation Control** — Adjust color saturation (0% - 200%)
- **One-Click Reset** — Quickly reset all filters to defaults
- **Remember Per Site** — Optionally save filter settings for each website

### 🔊 Volume Boost (NEW)
- **Amplify Audio** — Boost volume up to 400% beyond the browser's limit
- **Web Audio API** — Uses native audio processing for clean amplification
- **Slider Control** — Easy adjustment with visual feedback
- **Remember Per Site** — Optionally save volume boost for each website

### ⏭️ Intro/Outro Skip (NEW)
- **Auto-Skip Intros** — Automatically skip to your specified timestamp when videos start
- **Outro Detection** — Skip outros when videos approach the end
- **Per-Site Rules** — Set custom intro/outro times for different websites
- **Keyboard Shortcuts** — Press `I` to skip intro, `O` to skip outro
- **Visual Feedback** — Shows skip notification with time jumped

### Automation & Rules
- **URL Speed Rules** — Set automatic speeds for specific URL patterns (e.g., `/shorts` → 1x)
- **Site Presets** — Set default speeds for specific websites
- **Auto-Hide Controller** — Controller fades out after configurable delay
- **Time Saved Tracking** — See how much time you've saved watching at faster speeds

### Customization
- **Remember Speed** — Saves your preferred speed per website
- **Cloud Sync** — Settings sync across devices via Chrome/Firefox account
- **Site Blacklist/Whitelist** — Enable or disable the extension on specific sites
- **Draggable Controller** — Position the overlay anywhere on the video
- **Customizable Colors** — Change background and accent colors of the controller
- **Export/Import Settings** — Backup and restore your configuration
- **Dark Theme** — Beautiful, modern dark UI

## 🎮 Default Keyboard Shortcuts

### Speed Control
| Key | Action |
|-----|--------|
| `V` | Show/Hide controller |
| `S` | Decrease speed (-0.1x) |
| `D` | Increase speed (+0.1x) |
| `R` | Reset to 1.0x |
| `G` | Jump to preferred speed (hold for temporary boost) |

### Navigation
| Key | Action |
|-----|--------|
| `Z` | Rewind 10 seconds |
| `X` | Fast forward 10 seconds |
| `,` | Previous frame (pauses video) |
| `.` | Next frame (pauses video) |

### A-B Loop
| Key | Action |
|-----|--------|
| `[` | Set loop point A (start) |
| `]` | Set loop point B (end) |
| `\` | Clear A-B loop |

### Other Features
| Key | Action |
|-----|--------|
| `P` | Capture screenshot |
| `I` | Skip intro |
| `O` | Skip outro |

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
- Speed display with increase/decrease buttons
- Preset speed buttons (0.5x, 1x, 1.5x, 2x, 3x)
- Seek controls (-10s, +10s)
- Frame-by-frame controls (|◀ and ▶|)
- Pitch correction toggle (ON/OFF)
- **A-B Loop controls** — Set A, Set B, Clear buttons with time display
- **Volume Boost slider** — Amplify audio up to 400%
- **Video Filters** — Brightness, Contrast, Saturation sliders
- **Screenshot button** — Capture current frame as PNG

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

### General Settings
| Setting | Description |
|---------|-------------|
| **Controller Mode** | Choose between minimal badge or full panel |
| **Opacity** | Adjust controller transparency (10% - 100%) |
| **Hide by Default** | Start with controller hidden, press `V` to show |
| **Auto-Hide Delay** | Automatically hide controller after X seconds |
| **Badge Colors** | Customize background and accent colors |
| **PiP Speed Indicator** | Show floating controller in Picture-in-Picture mode |

### Speed Memory
| Setting | Description |
|---------|-------------|
| **Remember Speed** | Save playback speed per website |
| **Force Saved Speed** | Override player's default speed |
| **Work on Audio** | Also control `<audio>` elements |
| **URL Speed Rules** | Set automatic speeds for URL patterns |

### Video Filters & Volume
| Setting | Description |
|---------|-------------|
| **Remember Filters** | Save brightness/contrast/saturation per website |
| **Remember Volume Boost** | Save volume boost level per website |

### Intro/Outro Skip
| Setting | Description |
|---------|-------------|
| **Enable Intro/Outro Skip** | Turn on/off the intro/outro skip feature |
| **Default Intro Skip** | Seconds to skip at the start of videos |
| **Default Outro Skip** | Seconds before end to trigger outro skip |
| **Auto-Skip Intro** | Automatically skip intro when video starts |
| **Skip Intro Key** | Keyboard shortcut for manual intro skip |
| **Skip Outro Key** | Keyboard shortcut for manual outro skip |
| **Site Rules** | Set custom intro/outro times per website |

### Site Access
| Setting | Description |
|---------|-------------|
| **Site Access Mode** | Choose blacklist or whitelist mode |
| **Site Blacklist** | Disable extension on specific domains |
| **Site Whitelist** | Only enable extension on specific domains |

## 🏗️ Project Structure

```
Video Speed Controller Pro/
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

## 🔒 Privacy — Your Data Stays Yours

**This extension is 100% privacy-focused. We do NOT collect, store, or transmit any of your data to external servers.**

### What This Means For You

| ✅ What We Do | ❌ What We DON'T Do |
|--------------|-------------------|
| Store all settings locally in your browser | Send data to any external server |
| Use Chrome/Firefox built-in sync (optional) | Track your browsing or video watching habits |
| Keep your preferences on YOUR device | Collect analytics or usage statistics |
| Work completely offline after installation | Require any account or registration |

### Technical Details

- All data is stored using `chrome.storage.sync` — a secure, browser-native storage API
- The "sync" feature uses your browser's built-in sync (Google/Firefox account) — **not** our servers
- The extension only requests minimal permissions: `storage` and `activeTab`
- **Zero network calls** to external servers — you can verify this in the source code
- Works entirely offline after installation

### What Gets Stored Locally

- Your playback speed preferences per website
- Keyboard shortcut configurations
- Custom presets and URL rules
- Blacklist/whitelist settings
- UI preferences (colors, opacity, controller mode)
- Time saved statistics
- Video filter settings per website (brightness, contrast, saturation)
- Volume boost levels per website
- Intro/outro skip settings and per-site rules

**Your data never leaves your browser. Period.**

## 📄 License

MIT License — feel free to use, modify, and distribute.

## 🔒 Privacy Policy

This extension is 100% privacy-focused. We do NOT collect, store, or transmit any of your data to external servers.

**📋 [View Full Privacy Policy](PRIVACY_POLICY.md)**

All data is stored locally on your device. No tracking, no analytics, no data collection.

## 💬 Support

Need help or have questions?

- **🐛 Report Issues:** Open an issue on [GitHub](https://github.com/yourusername/video-speed-controller-pro) (replace with your repo URL)
- **💡 Feature Requests:** Submit via GitHub Issues
- **📧 Contact:** [Your Support Email] (replace with your email)

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

## 📝 Changelog

### v1.3.0
- **A-B Loop** — Loop any section of a video with Set A, Set B, and Clear controls
- **Screenshot Capture** — Save current video frame as PNG with `P` key
- **Video Filters** — Adjust brightness, contrast, and saturation with sliders
- **Volume Boost** — Amplify audio up to 400% using Web Audio API
- **Intro/Outro Skip** — Auto-skip intros and outros with per-site rules
- **Remember Filters** — Option to save video filter settings per website
- **Remember Volume Boost** — Option to save volume boost level per website
- **New keyboard shortcuts** — `[` and `]` for A-B loop, `P` for screenshot, `I` and `O` for intro/outro skip
- Expanded full controller panel with new sections
- Improved site access with whitelist mode option

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
