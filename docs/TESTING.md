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

## Shadow DOM

Selectors never cross a shadow boundary, so these cases are invisible to the document
observer and need their own pass. Use the shadow buttons on the test page.

15. **Add shadow host with video** — a host that enters the DOM with a video already inside
    its shadow root gets a controller.
16. **Add video into existing shadow** — a shadow root that was attached at load and was empty
    gets a controller when a video is added to it later. This is the lazy-loading player case.
17. **Add nested shadow video** — a video two shadow roots deep gets a controller.
18. **Add closed shadow video** — expected to get **no** controller. Closed roots are
    unreachable from an extension; this is a limitation, not a regression.
19. For each controlled shadow video, confirm the overlay is styled and that speed changes and
    keyboard shortcuts affect playback.
20. **Remove shadow videos** and confirm the controllers and tracked media state disappear.
21. Click **Check controllers** and confirm the count reports `pass`. The counter walks open
    shadow roots and excludes closed-root videos.

## Style isolation

Overlays render into closed shadow roots, so page CSS cannot reach them and their styles
cannot leak into the page.

22. Click **Toggle hostile page CSS** on the test page. Every overlay must stay visible,
    correctly positioned, and normally sized. The injected rules use `!important`, which
    outranks a plain inline style — the regression this guards against is a host that collapses
    to `position: static` or `z-index: 0`.
23. With hostile CSS on, confirm the controller, the right-click speed menu, and the
    picture-in-picture indicator all still work.
24. Confirm the page's own layout is unchanged when the extension is enabled — no font, colour,
    or spacing shifts from overlay styles leaking outward.
25. On a site with a strict Content-Security-Policy, confirm overlays are still styled. The
    stylesheet is fetched from `web_accessible_resources`; if the fetch is blocked the code
    falls back to a `<link>` inside each root, and an unstyled overlay means both paths failed.

## Frame skipping

The content script skips subframes it measures as smaller than 150px in either direction. A
frame reporting 0x0 is not laid out yet rather than small, so it is never skipped on that basis.

26. Click **Add iframes (tiny + real)**. The 640x360 frame gets a controller; the 120x120 frame
    does not.
27. Click **Grow the tiny frame** and confirm it picks up a controller without a page reload.
28. Note the threshold catches tracking pixels, 320x50 banners, and 728x90 leaderboards, but not
    300x250 or 160x600 ad units. That is deliberate: frame election already stops those from
    taking commands, so the size test only has to be cheap and safe, not exhaustive.

## Frame routing

29. Open a page with an embedded player in an iframe plus a second video. Confirm a keyboard
    shortcut changes the speed of the intended video only, not both.
30. Confirm the popup's speed presets and current-speed readout act on the same video the
    keyboard shortcuts do.

## Speed enforcement

31. On YouTube, set a speed and let the video advance to the next one. With **Force Saved
    Speed** on, the speed must be reapplied rather than reverting to 1.00x.
32. With **Force Saved Speed** off, the site's own speed menu must still work: changing speed
    through the player's native control must stick and not be overridden.

## Release artifact

```bash
npm run package
unzip -t dist/video-speed-controller-v1.4.0.zip
```

Load the unpacked repository for development, but upload only the versioned ZIP from `dist/` to the Chrome Web Store.
