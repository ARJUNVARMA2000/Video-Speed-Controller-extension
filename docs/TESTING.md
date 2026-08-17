# Testing and release checklist

## Automated checks

Install the test runtime once, then run both suites before packaging:

```bash
npm install
npx playwright install chromium
npm run check:full
```

`npm run check` validates JavaScript syntax, manifest assets, all locale catalogues, settings
normalization, Sync quota/chunk migration, serialized writes, and targeted frame routing.

`npm run test:e2e` launches Chromium with the unpacked extension and verifies:

- no controller/CSS portal on a page without media;
- one fixed closed-shadow portal for the active media, with no wrappers or media reparenting;
- dynamic and open-shadow media discovery, deterministic active-player keyboard control, and exact modifier chords;
- speed reassertion after a simulated site reset and user override during silence acceleration;
- hostile page CSS isolation and one portal across a 42-media stress page, with a 100 ms frame budget;
- timer-free thumbnail-media and tiny-frame deferral/growth, plus popup routing to one playing iframe;
- custom presets, legacy-shaped import, Sync collection chunking, and round-trip reads;
- 30-second time-saved batching with immediate partial flush on pause; and
- controller cleanup after all media and iframe owners are removed.

The live-site check is deliberately opt-in so normal development does not depend on a third party:

```bash
VSC_REAL_SITE_SMOKE=1 npm run test:e2e
```

It opens the YouTube HTML5 test player, waits for the extension portal, and verifies keyboard
speed control. A failure can also mean YouTube changed or blocked automated playback, so confirm
it manually before treating it as an extension regression.

## Manual Chrome smoke test

1. Open `chrome://extensions`, enable **Developer mode**, and load the repository root unpacked.
2. Run `npm run test:manual`, open `http://127.0.0.1:4173/media.html`, and reload once.
3. Confirm exactly one shared controller appears for the initial video.
4. Add the dynamic video and the 40-video feed. The controller count must remain one; starting or
   interacting with another player must retarget that controller.
5. Remove the active video and confirm another eligible player takes over. Remove all media and
   confirm the controller host disappears.
6. Verify compact-popup play/pause, remaining time, custom presets, plus/minus step, current speed,
   enabled state, and the **Advanced settings** link.
7. In the options page, verify shortcut recording/conflict feedback, appearance, rules,
   silence-skip settings, and settings import/export.
8. Use the full overlay's seek, frame, screenshot, filters, volume, intro/outro, and A–B loop tools.
9. Open the service-worker and page consoles and confirm there are no unexpected errors.

## Shadow roots and style isolation

1. Exercise **Add shadow host**, **Fill existing shadow**, and **Add nested shadow**. Each reachable
   video must be controllable through the same top-frame portal.
2. **Add closed shadow video** is expected to remain unreachable; this is a browser boundary.
3. Click **Toggle hostile page CSS**. The controller, right-click menu, feedback, and PiP indicator
   must stay normally sized and positioned.
4. Click **Check controllers**. It should report one shared controller for any number of reachable
   videos in the frame.

## Frames and real sites

1. Click **Add iframes (tiny + real)**. The 640×360 frame initializes; the 120×120 frame does not.
2. Click **Grow the tiny frame** and confirm it initializes without a page reload.
3. Play only the real iframe and use the compact popup. Only that frame's media should change.
4. On YouTube, enable **Force Saved Speed**, advance to another video, and confirm the saved speed
   is restored. With force mode disabled, YouTube's native speed menu must still be respected once
   the extension's short correction window expires.
5. Netflix and other authenticated/DRM sites require a signed-in manual pass. Confirm speed changes,
   next-episode behavior, and that unsupported silence analysis fails closed without muting audio.

## Release artifact

```bash
npm run package
unzip -t dist/video-speed-controller-v1.6.0.zip
```

Load the repository root unpacked for development. Upload only the versioned ZIP from `dist/`.
