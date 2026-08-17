# Video Speed Controller improvement plan

## Goal

Ship a reliability-first v1.4 that makes the existing feature set safer, faster, and easier to maintain before adding more features.

## Plan

- [x] Add a dependency-light test harness for settings, URL/site matching, speed bounds, and message handling, plus syntax and manifest checks.
- [x] Harden settings persistence: validate imported and incoming values, save targeted patches instead of stale full snapshots, serialize map updates, and surface storage failures.
- [x] Reduce page overhead: replace the always-running animation-frame tracker, remove stale media state and timers cleanly, and keep production console output quiet.
- [x] Improve the popup's core workflow and accessibility: prioritize current-site speed controls, make save/error state visible, and add proper labels/focus behavior.
- [x] Restore a deterministic local media test page and document a repeatable Chrome smoke-test checklist.
- [x] Update the README and privacy-policy contact placeholder so documentation matches the shipped popup and supported behavior.
- [x] Run automated checks and manual Chrome smoke tests, then record results below.
- [ ] Push the release through GitHub and submit the packaged update to the Chrome Web Store.

## Review

- Automated checks: 11 passing tests; manifest 1.4.0 and release ZIP validated.
- Local media fixture: initial and dynamically added 12-second WebM videos load successfully; dynamic removal succeeds.
- Manual unpacked-extension smoke test: controller injection, playback, context-menu speed changes, per-site persistence, dynamic media cleanup, and runtime error checks pass in Chrome.
- Smoke-test follow-up: another installed speed-controller extension also handles the default global shortcuts, so isolated shortcut assertions require temporarily disabling that unrelated extension. The test exposed and fixed zero-width focused controls in minimal mode.
- GitHub release branch and draft PR: `agent/v1-4-reliability` / PR #1.
- Chrome Web Store submission: package is ready; upload remains pending in the signed-in developer console.
- Release artifact: `dist/video-speed-controller-v1.4.0.zip` (generated, ignored by git).
