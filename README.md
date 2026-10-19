# Another Cup mobile

This repository contains only the installable mobile web app. The Mac coffee
manager, its local database, labels, and publishing credential stay on the Mac.

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

The fourth tab is the shared Backlog: a TODO list and a Completed list (two sub-tabs), each grouped by day, newest first. It reads `public.backlog_state` and saves through the authenticated `save_backlog` function with a revision check. The Mac manager uses the same document (`{"tasks": [{id, text, created, done_at}]}`). Apply `migrations/001_backlog.sql` to a new Neon branch before running this version there, followed by the remaining numbered migrations (`004_two_lists.sql` is the current shape). The controls on a task are a tickbox, a trashcan (opens a Delete / Cancel confirmation), and double-tap on an open TODO to edit it; the first line of a message is its title and `#tags` are highlighted.

The backlog quietly checks for changes made on another device (every 15 s while open) and redraws only when the saved copy is newer; it leaves the screen alone while you edit or confirm a delete.

Run `npm test` for the task helpers. The Mac client loads the same `src/backlog-ui.js`, `src/backlog-model.js`, and `src/backlog-ui.css` through its local server.

Bean cards show clean–funky and light–dark as a solid dot inside shaded range dots; tap a row to read the reason and page quotes. The roast slider and vibe quadrants filter on the best guess, not the range.

The Wish list reuses the Browse card under a rank bar (position, move arrows). Press and hold a card to drag it. Tap targets have no tap-highlight flash.
Sold-out Wish list cards are greyed. The "In stock only" toggle hides them without changing the saved order.

Dark mode follows the phone's appearance. The block at the end of `src/style.css` repeats the light rules with flipped colors, so change both together.

On Browse, press and hold a bean that is not saved: it shrinks to a chip, the Wish list opens, and the bean is added where you let go.

Live updates (`src/live-update.js`, `checkForNewVersion` in `src/main.js`): while the app is open it checks for newer data every minute and redraws only when it changed. It also checks the published page for a new deployment (when the app returns to the foreground, when it comes back online, and every 5 minutes). A CSS-only change is swapped in place; a script change shows a "New version ready" toast and reloads once you are not typing, returning to the same tab and scroll position.

Roast or funk that the page does not state shows a dashed "not stated" pill instead of dots. The filter sheet's "Include possible fits" checkbox (hover shows what it does on desktop) (on by default) keeps those lots when the roast slider or a vibe quadrant is active.

Suggested replacements (`snapshot.suggestions`) are pinned above Browse and replace the old listing's row in the Wish list: previous listing, reason with Accept and Reject, new listing, stacked. A choice calls the `decide_replacement` function and is stored in `replacement_decisions`; the Mac applies it. Apply `migrations/005_replacements.sql` to Neon before using it. The bell button at the top turns phone notifications on or off (`src/push.js`, `sw.js` shows the push and opens the app on tap). It saves the subscription with `save_push_subscription` (apply `migrations/006_push.sql`, then refresh the Data API schema cache); the Mac sends the pushes (`notify.py`). The manifest `theme_color` is dark on purpose: Chrome paints an installed app's bottom navigation bar with it, and one colour cannot suit both themes, so the bar matches dark mode (it shows dark under the light theme). Without it the bar turned white. The status bar follows the `theme-color` meta tags in `index.html`. The font is Nunito (Google Fonts link in `index.html`).
