# Video Speed Controller Pro - Test Plan

## Overview
This document outlines testing procedures for the Video Speed Controller Pro extension on popular video websites.

## Test Environment Setup

### Prerequisites
1. Extension installed in browser (Chrome/Edge/Brave/Firefox)
2. Extension enabled in browser settings
3. Browser console open (F12) to check for errors

### Installation Steps
1. Open browser extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Firefox: `about:debugging#/runtime/this-firefox`
2. Enable Developer Mode
3. Click "Load unpacked" (Chrome/Edge) or "Load Temporary Add-on" (Firefox)
4. Select the extension folder

## Test Checklist

### ✅ Core Functionality Tests

#### 1. YouTube (youtube.com)
- [ ] Navigate to any YouTube video
- [ ] Verify controller appears (minimal badge or full panel)
- [ ] Test speed increase/decrease buttons
- [ ] Test keyboard shortcuts (V, S, D, R)
- [ ] Test speed presets (0.5x, 1x, 1.5x, 2x, 3x)
- [ ] Test frame-by-frame navigation (`,` and `.`)
- [ ] Test screenshot capture (P key)
- [ ] Test A-B loop functionality
- [ ] Test volume boost slider
- [ ] Test video filters (brightness, contrast, saturation)
- [ ] Test intro/outro skip (if configured)
- [ ] Verify controller is draggable
- [ ] Test Picture-in-Picture mode with floating controller
- [ ] Navigate to different videos (SPA navigation)
- [ ] Test on YouTube Shorts
- [ ] Test on embedded YouTube videos (iframe)

#### 2. Vimeo (vimeo.com)
- [ ] Navigate to any Vimeo video
- [ ] Verify controller appears
- [ ] Test all speed controls
- [ ] Test keyboard shortcuts
- [ ] Test on embedded Vimeo videos

#### 3. Netflix (netflix.com)
- [ ] Navigate to Netflix and play a video
- [ ] Verify controller appears
- [ ] Test speed controls
- [ ] Note: Netflix may have DRM restrictions

#### 4. Dailymotion (dailymotion.com)
- [ ] Navigate to any Dailymotion video
- [ ] Verify controller appears
- [ ] Test speed controls

#### 5. Twitch (twitch.tv)
- [ ] Navigate to any Twitch stream
- [ ] Verify controller appears (if video element is accessible)
- [ ] Test speed controls

#### 6. Facebook Video (facebook.com)
- [ ] Navigate to Facebook and play a video
- [ ] Verify controller appears
- [ ] Test speed controls

#### 7. Twitter/X Video (twitter.com / x.com)
- [ ] Navigate to Twitter/X and play a video
- [ ] Verify controller appears
- [ ] Test speed controls

#### 8. Instagram Video (instagram.com)
- [ ] Navigate to Instagram and play a video
- [ ] Verify controller appears
- [ ] Test speed controls

#### 9. TikTok (tiktok.com)
- [ ] Navigate to TikTok and play a video
- [ ] Verify controller appears
- [ ] Test speed controls

#### 10. Generic HTML5 Video Sites
- [ ] Test on any site with standard HTML5 `<video>` element
- [ ] Verify controller appears
- [ ] Test all features

### ✅ Feature-Specific Tests

#### Keyboard Shortcuts
- [ ] `V` - Toggle controller visibility
- [ ] `S` - Decrease speed
- [ ] `D` - Increase speed
- [ ] `R` - Reset to 1x
- [ ] `G` - Preferred speed (long-press)
- [ ] `Z` - Rewind 10s
- [ ] `X` - Fast forward 10s
- [ ] `,` - Previous frame
- [ ] `.` - Next frame
- [ ] `[` - Set loop point A
- [ ] `]` - Set loop point B
- [ ] `\` - Clear A-B loop
- [ ] `P` - Screenshot
- [ ] `I` - Skip intro
- [ ] `O` - Skip outro

#### Controller Modes
- [ ] Minimal mode (badge) displays correctly
- [ ] Full mode (panel) displays correctly
- [ ] Switch between modes in settings
- [ ] Controller opacity adjustment
- [ ] Auto-hide functionality

#### Advanced Features
- [ ] A-B Loop: Set A, Set B, Clear, Toggle
- [ ] Screenshot: Capture and download PNG
- [ ] Volume Boost: Slider 100%-400%
- [ ] Video Filters: Brightness, Contrast, Saturation
- [ ] Intro/Outro Skip: Auto-skip and manual skip
- [ ] Pitch Correction: Toggle ON/OFF

#### Settings & Persistence
- [ ] Remember speed per site
- [ ] URL speed rules
- [ ] Site blacklist/whitelist
- [ ] Export/Import settings
- [ ] Custom colors
- [ ] Cloud sync (if enabled)

### ✅ Edge Cases & Compatibility

#### Dynamic Content (SPAs)
- [ ] YouTube navigation (video to video)
- [ ] Netflix navigation (episode to episode)
- [ ] Vimeo navigation
- [ ] Controller persists after page navigation

#### Iframe Embeds
- [ ] YouTube embed in external site
- [ ] Vimeo embed in external site
- [ ] Controller works inside iframe

#### Multiple Videos
- [ ] Page with multiple videos
- [ ] Controller appears on active video
- [ ] Switching between videos works

#### Picture-in-Picture
- [ ] Enter PiP mode
- [ ] Floating controller appears
- [ ] Speed control works in PiP
- [ ] Exit PiP mode

#### Browser Compatibility
- [ ] Chrome/Edge/Brave
- [ ] Firefox
- [ ] Safari (if applicable)

### ✅ Error Handling

#### Console Checks
- [ ] No JavaScript errors in console
- [ ] No extension context invalidated errors
- [ ] No permission errors
- [ ] Check for "Video Speed Pro: Initialized" message

#### Visual Checks
- [ ] Controller doesn't interfere with video controls
- [ ] Controller doesn't block video content
- [ ] Controller is visible on dark/light backgrounds
- [ ] Controller scales properly on different screen sizes

## Test Results Template

```
Site: [Website Name]
URL: [Test URL]
Date: [Date]
Browser: [Browser & Version]

✅ Controller Appears: Yes/No
✅ Speed Controls Work: Yes/No
✅ Keyboard Shortcuts: Yes/No
✅ Advanced Features: Yes/No
✅ Issues Found: [List any issues]
✅ Notes: [Additional notes]
```

## Known Limitations

1. **DRM Content**: Some DRM-protected videos may not allow speed control
2. **Live Streams**: Speed control may not work on live streams
3. **Custom Players**: Sites with heavily customized video players may have issues
4. **Iframe Restrictions**: Some sites may block extension access to iframes

## Reporting Issues

If you find issues:
1. Note the website URL
2. Check browser console for errors
3. Note browser and version
4. Describe the expected vs actual behavior
5. Include screenshots if possible

## Quick Test Script

1. Open browser console (F12)
2. Navigate to test site
3. Run: `document.querySelectorAll('video').length` (should return > 0)
4. Check for controller element: `document.querySelector('.vsc-controller')`
5. Check console for extension messages
