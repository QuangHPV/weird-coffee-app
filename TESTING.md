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
- `npm run test:browser`: 31 mobile Chrome tests. The API and permission responses
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
scrolling, no duplicate save after a drag, unconsumed touch context menus,
selection remaining available in text inputs, and no `navigator.vibrate` calls.
The heart-hold check was repeated eight times after waiting for the startup
overlay to disappear; all eight passed. Layout and system-font checks include a
320px screen and a long coffee name, with no remote font requests.

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
touch long presses are no longer consumed by the blanket context-menu blocker.
Chromium's Android implementation vibrates on consumed long-press events:
[GestureListenerManagerImpl](https://github.com/chromium/chromium/blob/main/content/public/android/java/src/org/chromium/content/browser/GestureListenerManagerImpl.java#L339-L342).
Product destinations use accessible link-role buttons, avoiding native link
previews while retaining tap and keyboard activation. Native scroll and pinch
zoom are preserved.

The installed app offers Enable / Not now once. A tap is required by the
[browser permission API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API).
After permission is granted, reopening the app synchronizes its subscription.
Android controls notification delivery; if website permission itself was denied,
the browser's site permission may also need to be enabled. No backend migration
is required for this release.
