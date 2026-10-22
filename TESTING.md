# Mobile loading and interaction regression checks

## 2026-10-22 investigation

The original client was reproduced on this Mac against the isolated Neon branch
`test-account-features-2026-10-21`, using a disposable member created through the
real Auth signup flow. Production user accounts were not used or changed.
Signup was temporarily enabled on that branch and then restored to disabled.
Credentials and session cookies remain outside the repository in private `/tmp`
files; diagnostics never print passwords or JWTs.

The real API intermittently returned HTTP 403 / SQLSTATE 42501 / `Not authorized`
from `bootstrap_account` immediately after a successful session response. The
outgoing JWT had the expected subject, `authenticated` role and about 15 minutes
remaining. It happened on more than one browser run. The exact internal reason
for the API losing that identity was not confirmed. Subsequent isolated identity
probes returned matching JWT subjects and database identities.

The previous loader stopped at that first failure, suppressed the error details,
had no bounded retry or timeout, and allowed overlapping loads. The new loader
recovered from an observed real 403 by refreshing the session and retrying,
without a page reload. This failure is also reproduced deterministically by a
browser regression test, alongside other failure modes below. Authorization is
still enforced by Neon; no policies, grants or production schema were relaxed.

## Automated checks

- `npm test`: 18 tests for backlog helpers and loading orchestration.
- `npm run test:browser`: 55 mobile Chrome tests. The API and permission responses
  are intercepted locally; this suite cannot create production accounts or data.
- `npm run build` and `git diff --check`.

The browser suite covers initial and background loading; failure in each required
request; network disconnection; 401/403 recovery; repeated 503s; missing RLS rows;
stalled session and data requests exceeding the real 12-second deadline; Retry;
session expiry; coalesced resume/online events; sign-out and account changes during
loads; late refreshes racing with Wish-list edits; and preservation of existing
data during a failed refresh. Unit tests additionally cover permanently stalled
recovery, cancellation, retry limits and permanent permission/data-format errors.

Touch checks cover holding card text, holding the heart, cancellation when
scrolling, no duplicate save after a drag, unconsumed context menus with touch,
mouse or missing pointer types,
selection remaining available in text inputs, and no `navigator.vibrate` calls.
The heart-hold check was repeated eight times after waiting for the startup
overlay to disappear; all eight passed. Layout and bundled-font checks include a
320px screen and a long coffee name, with no remote font requests. Both Manrope
and Bricolage Grotesque must actually finish loading. A real service worker test
also verifies that their stylesheets and fonts remain available offline.

Notification tests cover installation detection, an explicit tap before browser
permission, persistent dismissal, denied/unsupported permission, later permission
changes in settings, restored grants, subscription save failures and retries,
and detaching the subscription at sign-out. No permission prompt is shown on an
ordinary browser visit before installation.

## Real account and built PWA

`tests/live-account.mjs` runs only against a production-mode build configured with
the isolated test URLs. It refuses to contact any other Neon endpoint. The check
uses installed Chrome with mobile viewport and touch enabled, and exercises the
real SDK, Auth, Data API, RLS and service worker.

Verified: cold database start, sign-in/session restoration, onboarding, ten
consecutive page reloads, five resume checks, offline/reconnect recovery, and
service-worker activation. The final cold-start run reproduced the intermittent 403, automatically refreshed
the session and recovered. The subsequent ten reloads, five resumes and reconnect
passed with no page errors or manual recovery reloads. The disposable account's sessions were then expired in the test
database; its existing browser cookies correctly returned to the sign-in page.

The opt-in scripts read `/tmp/coffee-loading-account.json` and optionally
`/tmp/coffee-loading-session.json`. Neither file is checked in. Serve the test
build at `http://127.0.0.1:5176/`, with that origin allowed on the test branch.
Use `EXPECT_SIGNED_OUT=1 node tests/live-account.mjs` for the expired-session check.
`tests/reproduce-loading.mjs` retains the manual request/identity diagnostic used
during investigation; its temporary probe exists only on the test branch.

## Phone verification still needed

Mac touch emulation cannot feel an Android vibration motor or reproduce the
Android system permission sheet. The app's explicit vibration is removed, and
the global context-menu blocker is now removed entirely. Its previous fallback
still consumed events reported as mouse events or without a pointer type; those
cases now have regression coverage.
Chromium's Android implementation vibrates on consumed long-press events:
[GestureListenerManagerImpl](https://github.com/chromium/chromium/blob/main/content/public/android/java/src/org/chromium/content/browser/GestureListenerManagerImpl.java#L339-L342).
Product destinations use accessible link-role buttons, avoiding native link
previews while retaining tap and keyboard activation. Native scroll and pinch
zoom are preserved.

An Android API 35 emulator was also attempted on this Mac. Its host connection
and native input service repeatedly stalled. DevTools touch injection did not
produce Android's native long-press event, so that attempt cannot establish that
the phone's native haptic is fixed. Physical Android verification is still needed.

The installed app offers Enable / Not now once. A tap is required by the
[browser permission API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API).
After permission is granted, reopening the app synchronizes its subscription.
Android controls notification delivery; if website permission itself was denied,
the browser's site permission may also need to be enabled. No backend migration
is required for this release.

## 2026-10-22 reliability follow-up

The Mac's TCP Postgres requests exceeded 20 seconds, while a read-only HTTPS
query against the same database took 40 ms. Neon reported no stalled queries.
The catalog publication was pending since October 21. All nine roasters failed
DNS lookup during the October 22 scheduled scan. These are transport failures;
the snapshot was about 175 KB and the production branch about 33 MB.

The Mac now uses parameterized HTTPS SQL with a total deadline, bounded
concurrency and atomic batch transactions. A deliberately failing transaction on
the isolated branch rolled back correctly. Wish-list/backlog reads recovered to
about 55 ms. A real complete refresh succeeded for all nine roasters, processed
11 labels with Claude, and published 159 beans. The desktop page rendered in
259 ms while its external font, suggestions and cloud Wish list were stalled.
Desktop browser checks also verify Retry without reloading and re-enabling
editing when sync returns with the same revision.

Mobile startup errors previously stopped automatic polling because the app was
still hidden. Resume and minute polling now recover that state. Authorization
recovery explicitly requests a data JWT through the managed Auth token endpoint;
refreshing the cookie session alone could reuse the same data token. All queries
in one read bundle use one token, and sign-out/account changes clear it from
memory. Browser regressions cover startup recovery and verify that a 42501 retry
actually uses a different token.

The built service worker now precaches the entry JavaScript and CSS before
activating or replacing cached HTML. Each build has a separate shell cache, and
same-origin network requests fall back after a six-second deadline. This avoids
an offline shell pointing at missing bundles. The real test account passed ten
reloads, five resumes, an offline reload and reconnect without page errors or a
manual recovery reload. A first bootstrap call still intermittently returns
403/42501 from the Data API; the client recovered by requesting a fresh JWT.
The underlying API identity failure has not been established as a capacity or
policy problem. No production policies or schema were changed.

Archive sync follow-up: publication previously replaced the owner's cloud
archives with the local SQLite copy, potentially undoing phone choices. Owner
archives now use the same cloud authority as member archives. Desktop writes are
confirmed remotely before updating the local cache, phone choices are pulled
every 30 seconds, and the desktop data fingerprint includes archive IDs. Tests
cover read/write failures, preserving unrelated choices, fingerprint changes,
and ensuring catalog publication does not replace owner archives.

## Latest backlog UI changes

The existing Manrope body and Bricolage Grotesque heading fonts now use weights
500 and 750 respectively. Archive/restore icons appear for admin and member
accounts in Browse and Wish list cards. New browser checks exercise successful
archive and restore for both roles.

Activity receives public scan metadata, progress, errors and batch totals. It
shows quiet/failed scans, an Important scans only filter, detailed listing counts
and links, and expandable checks derived from each account's current archive.
Owner archive flags are excluded from the shared publication. Activity-only
updates preserve catalog beans and replacement suggestions; that SQL was also
verified on the isolated branch. Three Python checks cover publication metadata,
progress, privacy and update deduplication. Light/dark 320px Activity layouts
and heavier-font narrow cards were checked.


## Fast startup and release handover (2026-10-22)

The production worker was reproduced in a disposable local fixture: a warm
reload took 12,034 ms with eight-second network responses, and HTTP 404s for
old CSS produced an unstyled page even though that CSS existed in CacheStorage.
The former worker tried the network for every resource and only fell back on
thrown errors for CSS/JS. The old deployment checker also fetched its old entry
script before it could detect a release; removal of that file broke detection.

The build now generates `release.json`, embeds its ID in HTML, and inserts an
asset manifest with SHA-256 hashes into the stable `sw.js`. Install verifies all
required files before completing. A running app serves its matching cached shell
and static files immediately. Updates wait for the page's activation message;
reload occurs only after the new controller confirms the target release. Open
clients identify their releases so cleanup retains their files. The preceding
Git commit's entry assets and the original legacy entry files are also published
for migration from the old checker.

Visible clients check the release manifest every ten seconds and on resume or
reconnect. Data checks also run every ten seconds, request catalog metadata first,
and reuse the payload when its publication is unchanged. A recently verified
session can be reused for thirty seconds; resume/reconnect force verification.
Unchanged cards remain attached, Activity updates do not replace Browse/Wish-list
cards, and expanded Activity details survive progress updates. Warm entries and
automatic updates skip the opening animation.

Account snapshots are display-only IndexedDB records, scoped to the Data API and
user ID. Online startup verifies the account before showing its cache. Offline
startup can show the last confirmed account only until that session's recorded
expiry. Cached content carries a checking/saved-copy state; failed refreshes keep
it visible. Storage reads are bounded, unavailable storage falls back to normal
loading, local edits invalidate the saved snapshot, and sign-out clears it and
hides other open tabs. JWTs, credentials and mutation queues are not persisted.

`npm run test:pwa` builds with isolated fake API URLs, then uses real Chrome
service workers and local deployment fixtures. It covers slow networks, old
asset 404s, offline styles/fonts/data, safe activation, scroll/view restoration,
corrupt/partial releases, ten-second detection, several releases while typing,
drafts across explicit reload, multiple tabs, real CDP-delivered Web Push,
first-install/registration recovery, expired offline identity and migration from
the preceding worker. The former development-worker font test is now covered
against production bundles in this suite. The suite has 12 cases. Warm-shell measurements on this Mac
were 50–78 ms; these are shell timings, not physical Android content benchmarks.

Additional browser checks cover cached content before delayed data, revoked and
changed accounts, metadata-only polling, card identity/focus preservation, storage
failure and cross-tab sign-out. The real isolated Neon account also passed ten
reloads, five resumes, offline startup and reconnection, with no page errors.
In the final run, cached account content appeared in 45–86 ms over ten reloads;
all real API requests succeeded.
Its first bootstrap again returned 403/42501; existing token recovery succeeded.
The upstream intermittent authorization issue remains unconfirmed.

Physical Android timing and visual verification are still needed. Background
OS suspension and notification delivery can delay updates; visible polling
latency starts when a complete release is available from hosting.


## Android shell, gesture strip and launch branding (2026-10-22)

The supplied screenshot shows Android's gesture handle in a native light strip
below the app navigation, rather than trailing document padding. The manifest
now requests `fullscreen`, which uses the full display on supported Android
installations and hides both native status and navigation bars. The standard
fallback chain remains standalone/minimal-ui/browser. The explicit manifest ID
resolves to the former start URL, preserving the installed app identity.

Existing WebAPKs may retain standalone mode until Android updates their metadata.
An Android-only **Use full screen** header icon is shown in those installed modes
when the Fullscreen API is supported. It requests fullscreen only after a tap,
with `navigationUI: hide`; it disappears once fullscreen is active. Ordinary web
tabs and installations already in fullscreen do not show it. Edge gestures retain
access to system controls. This is a real viewport/system-bar change, rather than
recoloring the native gap. Manifest fullscreen may hide the top status bar too.

The fixed app nav now has constant maximum-inset padding and a compositor bottom
offset, following Chrome's edge-to-edge guidance. Its visible height drives the
content reserve; the former hard-coded 110px reserve and wide-screen sticky-nav
behavior are removed. `100dvh` follows viewport height, with `100vh` fallback.
The viewport requests `interactive-widget=resizes-content` for Android keyboard
resizing, and lateral safe areas protect controls in landscape.

The mobile page no longer adds its own timed opening animation. Desktop animation
files remain intact. Separate transparent general icons and opaque maskable icons
are rendered from the existing SVG; the artwork fits the full central 40%-radius
safe circle. New icon filenames and matching splash/icon background metadata
replace the old baked-in square treatment. `npm run build:icons` reproducibly
renders these vector assets with librsvg. Standard metadata cannot suppress the
Android system's own launch window.

The worker fetches the web app manifest from the network, even for an old client
that is postponing a code update, and falls back to its current complete cached
manifest offline. Website release checks remain separate from Android WebAPK
updates. For developer verification use `about://webapks`; Chrome may need the app
closed, Wi-Fi and charging before replacing installed metadata. Clearing account
data is not required.

Nine added browser checks cover dynamic/max bottom inset transitions, constant
nav geometry, content clearance, 320/390px portrait and 844px landscape, keyboard
resize/restore, hidden-nav clearance, absence of a second splash, fullscreen
notification eligibility, stable identity, icon transparency/mask safety, and
the explicit legacy fullscreen action. The PWA suite now has 13 cases, including
fresh metadata during a deferred code release and offline metadata fallback.

References:
- https://developer.chrome.com/docs/css-ui/edge-to-edge
- https://web.dev/learn/pwa/app-design
- https://web.dev/articles/maskable-icon
- https://web.dev/articles/manifest-updates


Native Android follow-up: a read-only Android 15 emulator with Chrome 124 used an
isolated local build and fake account/catalog APIs. Its native Chrome first-run
UI repeatedly stalled; after disabling those prompts and reducing emulator
resolution, the actual Fullscreen API succeeded with a simulated user activation.
The layout viewport and app nav bottom expanded from 828px to the full 960px
screen height. An Android system screenshot confirmed removal of the gesture
strip and status/browser bars. This verifies the native API workaround; it is
not a claim that a freshly minted WebAPK or the user's particular phone has been
verified. The nine layout/action checks and all 13 production-worker checks pass;
the existing loading, account, interaction and notification checks also pass.
