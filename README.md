# Another Cup mobile

This repository contains only the installable mobile web app. The Mac coffee
manager, its local database, labels, and publishing credential stay on the Mac.

The short two-cup startup animation is shared with the Mac page through
`src/startup.css` and `src/startup.js`. It plays on every page entry or reload
and can be skipped with its button or Escape.

The site is published from `main` → `/docs` at
https://quanghpv.github.io/weird-coffee-app/.

To update the site, run `npm ci` and `npm run build`, then commit the changed
source and `docs` files. `.env.production` contains only public Neon Auth and
Data API URLs. Never add a PostgreSQL connection string or password here.

For a local phone preview, run `npm run dev` and open
`http://127.0.0.1:5173/phone-preview.html`. The preview uses sample data and
offers 375px, 390px, and 430px widths. It is available only in the Vite dev
server and is not included in the GitHub Pages build.

Browse filters open from the icon beside the bean count. Changes in the filter
panel affect the list only after Apply; Cancel restores the previous selection.
Apply saves all Browse filters and chosen roasters to the signed-in account in Neon, so they survive a new session, deployment, or cleared browser cache. The saved filter revision prevents one device from silently overwriting another.
Reset filters restores Browse defaults while keeping the chosen roasters; Apply saves the reset.

The fourth tab shows the owner's private admin backlog to admins as a mailbox (folders Now, Inbox, Later and Done, a list of one-line rows, and an editor pane a row opens), and Feature requests to members. A member's request becomes an Inbox task; completing or reopening that task updates the request status. Both lists display the poster's Auth display name. The Backlog reads `public.backlog_state` and saves through the authenticated `save_backlog` function with a revision check. The Mac manager uses the same document (`{"tasks": [{id, text, created, done_at, author_name, lane?, plan?, progress?}]}`; `lane` is `now` or `later`, none means Inbox, and `plan`/`progress` come from the plan file on the Mac). Apply the numbered migrations through `010_request_merge.sql` (`merged_into` on a task merges it into another: completing the target completes it, members see "Part of: ...", and the Mac sends one completion push per request) on a new Neon branch. The top bar is a search box and a boxed plus. A row opens in an editor that saves itself (title and its icon actions on top: a Now, Inbox, Later dropdown, a check for done, a trash can with a confirmation; then who and when; then Write and Preview tabs for the markdown body); Now holds at most three. Linked request tasks open read only but can be moved and completed. In Done, older weeks are folded and `#tag` chips filter. On a phone the editor replaces the list and the back gesture returns (saving what was typed); on a wide screen both show side by side. Members see their requests in the same row style. The first line of a message is its title and `#tags` are highlighted.

On first sign-in, `bootstrap_account` creates a member profile and an empty personal Wish list. The member chooses at least one roaster before Browse opens; a two-step guide then points to the Browse filter sheet, where roasters can be changed anytime. The guide's completion is stored with the account. The Mac publishes a shared, sanitized catalog; each user's Wish list and archive remain separate. Every account's archive choices, including the owner's, are authoritative in `personal_archives`. The Mac confirms owner edits in Neon before caching them and picks up phone archive choices every 30 seconds. Catalog publication does not replace personal archives. Activity includes refresh status, scraping and processing progress, errors, model batch totals, change counts, and an Important scans only filter. Listing events and expandable checks of the account’s currently archived beans follow chosen roasters. Push notifications also follow chosen roasters. Archive and restore controls are icons for both admin and member accounts. `?demo=member` on the Vite preview exercises onboarding and the member screens without a live account.

The backlog quietly checks for changes made on another device (every 15 s while open) and redraws only when the saved copy is newer; it leaves the screen alone while you edit or save.

Run `npm test` for the task and loading-recovery helpers, and `npm run test:browser` for the mobile browser regression suite (installed Chrome required). See `TESTING.md` for isolated real-account checks. The Mac client loads the same `src/backlog-ui.js`, `src/backlog-model.js`, and `src/backlog-ui.css` through its local server.

Bean cards show clean–funky and light–dark as a solid dot inside shaded range dots; tap a row to read the reason and page quotes. The roast slider and vibe quadrants filter on the best guess, not the range.

The Wish list reuses the Browse card under a rank bar (position, move arrows). Press and hold a card to drag it. Tap targets have no tap-highlight flash.
Sold-out Wish list cards are greyed. The "In stock only" toggle hides them without changing the saved order.

Dark mode follows the phone's appearance. The block at the end of `src/style.css` repeats the light rules with flipped colors, so change both together.

On Browse, press and hold an unsaved bean’s heart: it shrinks to a chip, the Wish list opens, and the bean is added where you let go.

Live updates (`src/live-update.js`, `checkForNewVersion` in `src/main.js`): while the app is open it checks for newer data every minute and redraws only when it changed. It also checks the published page for a new deployment (when the app returns to the foreground, when it comes back online, and every 5 minutes). A CSS-only change is swapped in place; a script change shows a "New version ready" toast and reloads once you are not typing, returning to the same tab and scroll position.

Roast or funk that the page does not state shows a dashed "not stated" pill instead of dots. The filter sheet's "Include possible fits" checkbox (hover shows what it does on desktop) (on by default) keeps those lots when the roast slider or a vibe quadrant is active.

Suggested replacements (`snapshot.suggestions`) are pinned above Browse and replace the old listing's row in the Wish list: previous listing, reason with Accept and Reject, new listing, stacked. A choice calls the `decide_replacement` function and is stored in `replacement_decisions`; the Mac applies it. Apply `migrations/005_replacements.sql` to Neon before using it. After installation and account setup, a one-time prompt offers notifications (`src/push.js`; `sw.js` shows pushes and opens the app on tap). The browser permission prompt requires a tap. Dismissal is remembered for that installation. Once permission is granted, subscription registration is synchronized on successful data loads and app resume; Android/browser notification settings control delivery. Notifications can be switched on or off in Settings (gear icon in the header), which also holds the theme (System, Light, Dark), Roasters (subscribe to roasters) and Sign out. Roasters moved there from Filters. Fullscreen has no status bar: the header sits just below the camera cutout, never less than 28px from the top. A swipe right anywhere goes back to the latest earlier view, or out of an Activity run's details; there are no back buttons. The Notifications view's "Open in system settings" opens Chrome's notification settings through an Android intent link; a web page cannot open the installed app's own settings. It saves the subscription with `save_push_subscription` (apply `migrations/006_push.sql`, then refresh the Data API schema cache); the Mac sends the pushes (`notify.py`). The manifest `theme_color` is dark on purpose: Chrome paints an installed app's bottom navigation bar with it, and one colour cannot suit both themes, so the bar matches dark mode (it shows dark under the light theme). Without it the bar turned white. The status bar follows the `theme-color` meta tags in `index.html`. The app pairs Bricolage Grotesque headings and coffee names with Manrope body text. Variable fonts and their OFL licenses are bundled in `public/fonts` and precached for offline use; no remote font request is needed.

Account loading uses `src/data-loader.js`: one active load, a 12-second deadline per attempt, up to three attempts with backoff, a forced session refresh after authentication failures, atomic installation of the complete account data, and cancellation on sign-out or local edits. Existing data remains visible when a refresh fails. The Retry action starts a new attempt without reloading the page. Diagnostics log only the operation, status, code and attempt, never credentials or JWTs. There is no persistent Online label.

Touch selection/callouts are disabled in CSS except in text inputs. There is no global contextmenu handler, including for events reported as mouse events or without a pointer type, because Chrome Android generates haptics for consumed long presses. Product destinations are accessible link-role buttons so they have no native link-preview menu. No explicit vibration is sent by the app. Native scrolling and pinch zoom remain available.

### Reliability checks

`src/account-client.js` keeps managed Auth cookies and pins one JWT per account
read. Authorization recovery obtains a fresh data token. A failed startup keeps
checking on resume and every minute, and does not require a page reload.
Service-worker activation and cached HTML updates require the page's entry
JavaScript and stylesheets to be available first; each build has its own cache.
See `TESTING.md` for real-account, offline reload and desktop transport findings.

### Push notifications only arrive when Chrome is opened

Phone pushes that only show after opening Chrome or the app (OnePlus 15, Chinese ROM, ColorOS): the phone's Smart mode kills Chrome's background activity, so the service worker cannot run. Allow all background activity for Chrome (and the installed app) in battery settings. Confirmed 2026-10-28 with test pushes: Google accepted every one (201), but they appeared only after opening Chrome until this was changed.
