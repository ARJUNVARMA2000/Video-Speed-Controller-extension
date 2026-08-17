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

---

# v1.5 competitive plan

## Context

Competitive review (Aug 2026) against the 10 store search results. Feature-for-feature the
extension already beats the 3,000,000-user incumbent (igrigorik). It loses on reliability bugs
and on three Global Speed features. Ranked by user-visible impact.

## Plan

### Reliability (v1.5.0)

- [x] 1. Make "Force Saved Speed" actually enforce. `forceSpeed` is read once at attach time
      (`content/content.js` `applyInitialSpeed`) and never again; `handleRateChange` only
      repaints the badge. Sites that reset `playbackRate` mid-session (Netflix, YouTube between
      videos) win. Track a desired speed per media element and re-apply it on `ratechange`,
      with a bounded reassert window when force mode is off and a correction-count backoff so a
      page that fights back cannot pin the CPU. Replaces the YouTube-only interval in `setSpeed`.
- [x] 2. Route commands to one frame instead of broadcasting. `chrome.tabs.sendMessage` is
      called without a `frameId`, so MV3 delivers commands to every frame: one Alt+D can hit
      the real video and a video ad at once, and the popup's `getActiveState` races. Frames
      self-report media state to the background, which elects an active frame (playing beats
      paused, then largest visible area, tie-break to the top frame) and targets it.
- [x] 3. Find shadow-DOM media added after load. `findMediaInShadowRoots` runs once at init and
      the MutationObserver uses `querySelectorAll`, which does not pierce shadow roots.
- [x] 4. Render the controller into a closed shadow root. Fixes host-CSS collisions in both
      directions and lets `content/controller.css` stop being injected into every frame.

### Performance (v1.5.0)

- [x] 5. Defer and narrow the initial shadow-DOM scan (`querySelectorAll('*')` over the whole
      document, per frame, synchronously at `document_end`).
- [~] 6. Coalesce MutationObserver records into one rAF-scheduled rescan behind a dirty flag.
      **Implemented, measured, and reverted -- the premise was wrong.** See the review. Do not
      re-propose without new measurements showing the observer path is actually hot.
- [~] 7. rAF-throttle `updateControllerPosition` and cache the container decision from
      `positionController` to stop layout thrash on resize. **Declined on measurement --
      neither half has a premise.** See the review.
- [x] 8. Drop `browser-polyfill.min.js` from the Chrome build; keep it for Firefox only. Bail
      out early in frames under ~150x150px. (The polyfill was removed outright, not split by
      build -- see item 16 for why "keep it for Firefox" was based on a false assumption.)
- [x] 9. Suspend the 1s URL poll when `document.visibilityState === 'hidden'`. (Implemented as a
      back-off rather than a suspend, and it turns out this path never runs in Chrome -- see the
      review.)

### Features (v1.5.1+)

- [x] 10. Hold-to-fast-forward already ships as the `preferred-speed` action (G): keydown
      boosts, keyup restores. Not a missing feature — it is an undocumented one. Surface it in
      the popup and store listing instead of building it, and decide whether G should also
      support a toggle, since the shipped label says "toggle preferred speed".
- [x] 11. Raise the volume boost ceiling from 400% to 600% (Global Speed parity).
- [x] 12. Localize the listing and UI via `_locales/` (currently English-only against 19 and 24).
      Infrastructure and the English catalogue are done; **actual translations are still needed
      and are a decision, not a task** -- see the review.
- [~] 13. Pitch shifting. **Built, measured, and not shipped -- the audio quality is not good
      enough to release.** See the review for the numbers. Needs a phase vocoder or PSOLA, which
      is the "own project" this item always said it was.

### Firefox (new, found during item 8)

- [x] 16. Firefox support does not work and never has. **Decision: dropped the gecko block.** The manifest declares
      `background.service_worker`, which Firefox does not implement -- it needs
      `background.scripts` -- so the entire background layer is absent there: no settings
      storage, no message handling, no commands. `browser_specific_settings.gecko`
      (`strict_min_version: 109.0`) advertises support that cannot function. The service worker
      also uses `importScripts()`, which does not exist in an event-page context, so this is not
      a one-line manifest fix. Either do it properly or drop the gecko block and stop claiming
      Firefox support.

### Positioning

- [x] 14. Decide on the name. **Decision: keep the name, differentiate the listing.** A different extension (TinyFlash, store ID
      `jlhimcnaojgbmmmambapclkgonfcpajb`) ships under the identical name "Video Speed Controller
      Pro" and is running content marketing on it; our own listing already reads as "Your Video
      Speed Controller Pro" in store search.
- [ ] 15. Ship the pending v1.4 upload. Listing recency is a ranking input and ours is stale
      (last updated 2026-01-28; the two leaders both shipped in Aug 2026).

## Review

Items 1-5, 8-12 are implemented. Item 6 was implemented and reverted on measurement; item 7
was declined on measurement before being built; item 13 was built, measured, and withdrawn.
Items 14 and 16 were decided (keep the name; drop the Firefox claim). Item 15 is partly mine --
the branch is committed and pushed -- and partly yours: the Chrome Web Store upload needs your
signed-in developer console and cannot be done from here.

The performance section (items 5-9) is now closed. Net result: one real improvement (5, smaller
than claimed), one regression reverted (6), one no-op declined (7), one dead-code removal that
was worth doing for hygiene rather than speed (8), and one near-zero-value change kept because
it fixed an unrelated bug (9). The most valuable thing to come out of the section was not a
speed-up at all -- it was discovering that Firefox support does not work (item 16).

**Four of the five performance items did not survive measurement.** Items 6 and 7 were a
regression and a no-op, item 5 was real but roughly an order of magnitude smaller than claimed,
and item 9 targets a code path that never executes in Chrome. Only item 8 removed something
that was genuinely there on every page, and even that was worth doing for dead-code hygiene
rather than for the 0.1ms. The original ranking was written from reading the code rather than
profiling it. Items 10-16 are feature and positioning work and were not derived the same way,
but nothing in this section should be taken on the original analysis's word alone.

**1. Speed enforcement.** Intent is now recorded per media element (`setDesiredSpeed`) and
defended on `ratechange` (`enforceDesiredSpeed`) in `content/content.js`. Force mode defends
indefinitely; with force off, only a 1.5s window after an intentional set is defended, so a
site's own speed menu still works. A correction-count limit (8 per second) trips a 5s cooldown
so a page that rewrites the rate in a loop, or media that clamps the value, cannot spin on
ratechange. Re-entry is self-limiting: a successful correction leaves `playbackRate` at the
desired value, so the ratechange it fires exits at the equality check. The YouTube-only
5x100ms interval in `setSpeed` is gone, replaced by this generic path. `applyPlaybackRate` is
now the only direct `playbackRate` writer in the file.

**2. Frame election.** Content scripts report `{ hasMedia, playing, area, isTop }` to the
background (debounced 250ms, sent on attach/detach/play/pause/activate/deactivate). The
background keeps a per-tab frame registry and elects one frame: playing beats paused, then
largest visible area, top frame breaks ties. `chrome.commands` and the popup both dispatch
through `sendToActiveFrame`, which falls back to a tab-wide send when no frame has reported
yet or the elected frame has died, so behavior degrades to the old broadcast rather than
dropping commands. The popup's relay is restricted to `getActiveState` and `setSpeed`. The
registry is cleared on tab close and on navigation, with a 5-minute staleness floor.

**3. Shadow DOM.** The one-shot `findMediaInShadowRoots` is replaced by `scanMedia` (cheap,
selector-only) and `scanShadowHosts` (walks `*` to find hosts, registers each open shadow root
with the shared observer, recurses). A MutationObserver instance can hold many targets and
`disconnect()` drops them all, so `setupObserver` resets the registry when it rebuilds the
observer, and `activateExtension` now sets up the observer *before* the initial scan so roots
found during the scan attach to a live observer.

On the mutation path only `scanMedia` runs synchronously; the `*` walk is deferred to
`requestIdleCallback` (500ms timeout, `setTimeout` fallback) so the hot path stays as cheap as
before. Removal handling is now one `detachDisconnectedMedia()` sweep per mutation batch
instead of a per-node subtree query — cheaper when many nodes are removed, and it catches media
removed from inside a shadow root, which the old subtree query could not see.

Verified in a browser rather than asserted: a `document.body` observer records 0 additions when
a video is appended to a shadow root while a per-root observer records 1; `isConnected` is
false for media inside a removed shadow host, so the detach sweep is correct; and shadow-aware
discovery finds 4 of the 5 test videos while `document.querySelectorAll` finds 1.

Two limitations remain, both inherent rather than incidental. Closed shadow roots are
unreachable — nothing an extension can do without main-world patching. And `attachShadow()`
called later on an element that is *already* in the DOM produces no mutation record, so that
root is only discovered if something is added near it afterwards; catching it reliably needs a
`world: "MAIN"` script patching `Element.prototype.attachShadow`, which is its own change.

**Known cosmetic gap this exposes:** a controller placed inside the page's shadow root renders
unstyled, because `content/controller.css` is injected into the document and document styles do
not cross a shadow boundary. This is pre-existing — it already applied to shadow media found at
load — but the fix surfaces more of it. Controls still function. Item 4 resolves it properly;
injecting a duplicate stylesheet into every registered root would be thrown away by that work.

**4. Style isolation.** Every overlay -- controller, feedback, right-click menu, PiP indicator
-- now renders into a closed shadow root. Each gets a host element in the page DOM that is a
transparent full-bleed layer (`inset: 0`, `pointer-events: none`), so overlays position
themselves in exactly the coordinate space they used when the stylesheet was injected into the
document. That is what kept the change small: all 17 `controller.querySelector` sites, the
class toggles, and the CSS-variable colour overrides work unchanged, because `mediaElements`
still stores the inner `.vsc-controller` and only positioning and removal moved to the host.

`content/controller.css` is no longer injected by the manifest. It is fetched once per frame
from `web_accessible_resources`, parsed into one `CSSStyleSheet`, and shared by every root via
`adoptedStyleSheets`; `activateExtension` awaits it before the first scan so nothing renders
unstyled. A `<link>` per root is the fallback if a strict page CSP blocks the fetch. This also
removes 810 lines of CSS from every frame of every page, including pages with no video.

Roots are closed, which also means `scanShadowHosts` from item 3 does not descend into our own
overlays. Events from a closed root retarget to the host, so the context menu now matches
`.vsc-shadow-host` rather than `.vsc-controller`, and the menu is tracked in a variable because
a document query can no longer find it. Each host carries a `vsc-host-<role>` class -- the only
thing about an overlay still visible from the page.

**A bug the verification caught.** Pinning the host with plain inline styles was not enough: an
author rule marked `!important` outranks a normal inline declaration, and a page shipping
`div { position: static !important }` collapsed the host to `position: static; z-index: 0`.
The host now sets its layout properties with inline `!important`, the only tier above that.
`.vsc-wrapper` needed the same treatment -- it stays in the page DOM, so the sheet can no longer
reach it, and its old `position: relative !important` rule was dead. Those rules are deleted and
the wrapper is pinned inline instead.

Verified in a browser against hostile CSS: with `div { position: static !important }`,
`* { z-index: 0 !important }`, and `.vsc-controller { display: none !important }` applied, a
page-DOM controller computes to `display: none` and `font-size: 60px` while the shadowed one
holds `display: block`, `font-size: 14px`, and its own colour, with the host at
`position: absolute` and `z-index: 2147483647`. Event retargeting was confirmed to hand the
document listener the host element, and `host.shadowRoot` is null from the page.

**5. Deferred shadow scan.** The recursive `scanShadowHosts` is replaced by a resumable pump:
a queue of roots, a `TreeWalker` per root, and idle slices that check
`deadline.timeRemaining()` every 250 nodes. Nested roots go on the same queue instead of
recursing, so depth cannot blow the stack or run unbounded synchronous work. `findMediaElements`
now scans for media synchronously (cheap, and users want the controller immediately) and queues
the host search for idle. `scheduleIdle` hands its `setTimeout` fallback a deadline-shaped
object so there is only one code path.

Measured on a 24,000-element DOM: the old synchronous `querySelectorAll('*')` plus iteration
blocks for **5.3ms**; the new walker finishes the same work in **1.3ms**, in a single slice that
never reaches the 8ms budget. The speedup is from not materializing a 24k-element NodeList.
Resumption was verified separately by forcing a yield at every budget check: all 24 planted
shadow roots were found across 235 slices, with node visits exceeding the light-DOM element
count by exactly the 40 elements living inside those roots -- so slices resume in place rather
than re-walking.

**Correction to my own sizing of this item.** The original analysis presented this scan as a
notable cost ("15-30k elements walked synchronously... before the video is even playing"). It is
5ms, not tens of milliseconds. The change is still worth having -- it is off the critical path
now, roughly 4x faster, and bounded on pathological DOMs -- but it was oversold. This should
change the priority of what is left: item 8 (a 10KB polyfill and 810 lines of CSS parsed in
every frame of every page, including ad iframes with no video) is a per-frame constant cost that
is almost certainly larger than this was, and item 6 matters most on sites with heavy DOM churn.
Neither has been measured yet; both should be, before assuming the ranking is right.

**6. Mutation coalescing -- reverted.** Built it (accumulate records, flush once per rAF with a
timer fallback for hidden tabs, adaptive per-node vs per-root scanning), measured it against the
synchronous code it replaced, and reverted it. It is slower:

| workload | sync (kept) | deferred | adaptive |
| --- | --- | --- | --- |
| steady churn, 2,000 nodes | **0.8ms** | 1.9ms | 1.6ms |
| single burst, 6,000 nodes | **1.9ms** | 2.9ms | 2.9ms |

The burst row is the tell: the adaptive path cut `querySelectorAll` calls from 6,000 to 2 and
still took exactly as long as the version doing 6,000. Queries were never the bottleneck, so
coalescing had nothing to save, and the `Set` bookkeeping needed to coalesce cost more than the
scanning it avoided. Deferring also delays attaching a controller by a frame.

A first attempt was worse still: scanning one "dirty root" per frame instead of per added node
took 3.6ms against 1.5ms, because a root query costs what the whole page costs and repeats every
frame, while a subtree query costs only what was added. That is the measured crossover behind
the 200-node figure that the adaptive path used.

The premise behind this item -- that an unbatched observer is a meaningful cost on churn-heavy
pages -- is not supported. At 0.8ms per 2,000 added nodes, even 10,000 nodes/sec is under 0.5%
of one core. The synchronous callback stays.

**8. Polyfill removed, tiny frames skipped.** `browser-polyfill.min.js` is deleted, along with
its references in the manifest, the popup, and the packaging script. It was never load-bearing:
there is not a single `browser.*` reference anywhere in the codebase, only `chrome.*`, and every
call is either promise-style (natively supported in Chrome MV3) or callback-style with
`chrome.runtime.lastError`. The service worker had already been running promise-style
`chrome.storage` calls without the polyfill. Cost measured at 0.1ms median parse per frame
(p90 0.2ms) -- small, so the argument for removing it is that it was 10KB of dead code injected
into every frame of every page, not the milliseconds.

Subframes measured smaller than 150px in either direction now skip initialisation entirely,
avoiding two message round-trips, a stylesheet fetch, and an observer each. A frame reporting
0x0 is treated as "not laid out yet" rather than "small", matching how `attachController` treats
undersized videos. Skipped frames watch for `resize` and initialise if they grow; this was
verified to fire in the child when the parent resizes the iframe element. Because `init` can now
run twice, the message listener and context-menu listener gained binding guards.

Measured coverage: the threshold skips tracking pixels (1x1), mobile banners (320x50), and
leaderboards (728x90), but not 300x250 or 160x600 ad units, whose smaller side clears 150px.
Left deliberately conservative -- frame election (item 2) already prevents those frames from
taking commands, so this test only has to be cheap and safe, and raising it would risk skipping
small legitimate embeds.

**7. Position updates -- declined.** Measured before building, and neither half of the item
holds up. `positionController` runs once per controller from `createController`, never on
resize, so there is no repeated container decision to cache. And the resize path costs
microseconds:

| videos on page | interleaved (current) | batched reads/writes |
| --- | --- | --- |
| 1 | **0.0047ms** | 0.0343ms |
| 3 | **0.0047ms** | 0.0280ms |
| 10 | **0.0087ms** | 0.0370ms |
| 40 | **0.0297ms** | 0.0733ms |

Batching is consistently slower -- at these element counts the array allocation costs more than
the layout it saves. There is also structurally nothing to thrash any more, and item 4 is why:
the controller is absolutely positioned inside an out-of-flow `inset: 0` host, so writing `top`
and `right` cannot invalidate the container's layout. `ResizeObserver` already coalesces to once
per frame, so rAF-throttling would add a frame of lag for no gain. No code was changed.

**9. URL poll back-off.** The poll now runs at 1s while visible and 5s while hidden, swapping
on `visibilitychange`, with an immediate re-check when the tab becomes visible so a navigation
that happened while hidden is not left waiting. The `visibilitychange` listener is bound only
if polling actually starts, so browsers that use the Navigation API pay nothing.

Implemented as a back-off rather than the suspend the item asked for. A hidden tab can still
navigate itself -- an SPA advancing to the next track or video is exactly the background-playback
case this extension is used for -- and stopping the poll entirely would leave speed rules
unapplied until someone looked at the tab again. Backing off cuts wakeups 5x with no such
downside.

Also fixed a latent bug found while rewriting: both the interval callback and
`handleContextInvalidated` called `clearInterval(urlCheckInterval)` without clearing the
variable, so the `if (urlCheckInterval) return;` guard would have blocked the poll from ever
restarting. All paths now go through `stopUrlPoll()`.

**Value of this item is close to zero on the shipping target,** and I should have checked that
before writing it rather than after. `'navigation' in window` is true in Chrome 102+, verified
true in the browser here, so `startPollingUrlDetection` is never called in Chrome. The polling
path only runs in browsers without the Navigation API -- which, given item 16, means it runs
nowhere the extension currently works. Even when it does run, `handleUrlChange` early-returns on
an unchanged URL, so the cost being saved was a string comparison per second, against a timer
Chrome already throttles in hidden tabs. Kept because it is small, strictly reduces work, and
fixes the restart bug; not because it buys measurable performance.

**10. Hold-to-boost surfaced.** No behaviour change; the feature already existed. The popup
label was "Preferred Speed", which describes a stored preference rather than a press-and-hold
control, so it is now "Hold to Boost". README gained a keyboard shortcut table documenting the
whole key surface, which was previously undocumented anywhere.

**11. Volume ceiling raised to 600%.** `VOLUME_BOOST_MAX` is now a single exported constant used
by the settings clamp, the content script, and the controller slider, instead of `400` written
in six places. The settings test now asserts against the constant rather than a literal, so
raising the cap again cannot silently leave a stale expectation.

Also added a limiter to the audio graph (`source -> gain -> limiter -> destination`). At 6x gain
anything above -15.5 dBFS clips, which is most material; the limiter sits at -1 dBFS with a hard
knee and a 20:1 ratio, so it is close to inert until the signal would otherwise clip. **Not
verified by listening** -- the node configuration is reasoned, not heard.

**12. Localization scaffolding.** `_locales/en/messages.json` holds 117 messages extracted from
the popup; `manifest.json` gains `default_locale` and `__MSG_appName__` / `__MSG_appDesc__`, which
is what makes the *store listing* localizable -- the actual discovery lever. The popup carries
`data-i18n`, `data-i18n-aria`, and `data-i18n-placeholder` attributes, applied at popup init.

Designed so it cannot break the UI: the English text stays inline in `popup.html` as the
fallback and translations are layered over it, so a missing key or an `chrome.i18n` failure
renders exactly as the untranslated popup rather than blank. Verified by rendering the popup in
a browser -- 93 tagged elements, none empty, none mis-nested, a stubbed translation swapping
correctly while untranslated keys stayed English. `validate-manifest.js` now fails if the
catalogue is missing, if the manifest references an absent message, or if the popup references a
key the catalogue lacks; it reports 117 messages / 122 references / 0 unused.

**What is deliberately not done: the translations themselves.** Machine-translating 100+ UI
strings into 19-24 languages and publishing them under your name is a quality decision, not an
implementation detail -- bad translations read worse than English and land in store reviews.
The plumbing is ready for `_locales/<lang>/messages.json` drops whenever you want to source
them. Content-script strings (overlay aria-labels, feedback text) are not extracted yet either.

**13. Pitch shifting -- built, measured, not shipped.** Implemented a two-head granular shifter
as an AudioWorklet, then tested it numerically with `OfflineAudioContext` before wiring it into
anything. Fed a 440 Hz sine, shifted it, and measured how much output energy actually lands on
the target pitch, normalised so 1.0 means "as clean as the input sine":

| shift | purity | |
| --- | --- | --- |
| 0 (bypass) | 1.000 | clean |
| +1 semitone | 0.554 | audible artefacts |
| -1 semitone | 0.192 | poor |
| +2 | 0.199 | poor |
| +3 | 0.108 | poor |
| +7 (fifth) | 0.039 | poor |
| +12 (octave) | 0.035 | poor |
| -12 (octave) | 0.049 | poor |

There is no usable range -- only bypass is clean. The splice rate of a fixed-grain two-head
shifter scales with |ratio - 1|, so any real shift smears the spectrum. Acceptable quality needs
a phase vocoder or PSOLA with pitch tracking.

Shipping this would put audibly broken audio on the single feature meant to close the gap with
Global Speed, which is the fastest route to one-star reviews about sound quality. The worklet is
deleted rather than left behind a flag. Testing before wiring it in meant none of the
integration work was wasted.

One bug worth recording: the first version had the phase increment sign inverted, which froze
the read head instead of advancing it and produced broadband noise. The numeric test caught it
immediately; listening would have caught it too, but nothing else would have.

**14. Name -- keeping it, competing on the listing.** No code change. Since the name stays, the
listing has to do the differentiating against an extension of the same name backed by a content
operation. Concrete levers, in rough order of effect: rating volume (1 rating renders as no
social proof at all -- roughly 20 changes how the listing card reads); screenshots showing the
features the 3M-user incumbent lacks (A-B loop, volume boost, filters, screenshots,
intro/outro skip); a description opening on those differentiators rather than on speed control,
which every competitor also claims; and listing freshness, which item 15 addresses.

**16. Firefox -- claim dropped.** `browser_specific_settings` is removed from the manifest, so it
no longer advertises support that cannot function. README gains a Browser Support section stating
plainly that Firefox is unsupported and why. This is the honest position rather than the
aspirational one; making it real needs an event-page background script, which is its own project.

**Correction to the competitive analysis:** hold-to-fast-forward was listed as a missing
feature. It already ships as the `preferred-speed` action — see item 10, now rescoped from
"build it" to "document it".

**Checks:** `npm run check` passes — syntax on all four sources, manifest 1.4.0 validated,
18/18 tests (11 existing, 7 new covering frame election, dead-frame fallback, registry
clearing, and relay whitelisting). The manifest validator was extended to check
`web_accessible_resources`, which item 4 made the only reference to `content/controller.css` --
without it a missing stylesheet would have shipped silently. The service-worker test harness gained `tabs.onRemoved` /
`tabs.onUpdated` mocks, a recording `tabs.sendMessage`, and a configurable frame responder.

**Not yet verified:** no end-to-end Chrome smoke test with the extension loaded unpacked has
been run against any of these changes. The shadow DOM mechanism was verified directly in a
browser, but not with the extension itself attached. Speed enforcement needs a real site that
resets `playbackRate` (YouTube between videos, Netflix), and frame election needs a page with
an embedded player plus a second video. `docs/TESTING.md` now carries cases 15-25 covering
shadow DOM, frame routing, and enforcement; the test lab has fixtures for the shadow cases.
