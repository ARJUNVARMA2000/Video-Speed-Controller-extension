# Testing and release checklist

## Automated checks

Run before every package or store upload:

```bash
npm run check
```

This validates JavaScript syntax, manifest structure and referenced assets, settings normalization, site and URL matching, targeted settings patches, message handling, and concurrent per-site storage writes.

## Local Chrome smoke test

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select the repository root.
3. Run `npm run test:manual` and open `http://127.0.0.1:4173/media.html`.
4. Reload the test page once after loading or reloading the extension.
5. Confirm one controller appears for the initial video.
6. Use the popup presets and confirm its current-speed readout changes.
7. Use the overlay increase, decrease, reset, seek, frame, screenshot, filter, volume, and A–B loop controls.
8. Add the dynamic video and confirm a second controller appears without a page reload.
9. Remove the dynamic video and confirm its controller and media state disappear.
10. Disable and re-enable the extension from the popup; confirm controllers disappear and return without a page reload.
11. Change controller mode repeatedly; confirm one click changes speed by exactly one step.
12. Add literal, wildcard, and explicit `/regex/` URL rules and verify first-match precedence.
13. Export settings, import them again, and verify the popup reports success.
14. Open the service worker and page consoles and confirm no unexpected errors appear.

## Release artifact

```bash
npm run package
unzip -t dist/video-speed-controller-v1.4.0.zip
```

Load the unpacked repository for development, but upload only the versioned ZIP from `dist/` to the Chrome Web Store.
