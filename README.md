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

The fourth tab is the shared Backlog: a TODO list and a Completed list (two sub-tabs), each grouped by day, newest first. It reads `public.backlog_state` and saves through the authenticated `save_backlog` function with a revision check. The Mac manager uses the same document (`{"tasks": [{id, text, created, done_at}]}`). Apply `migrations/001_backlog.sql` to a new Neon branch before running this version there, followed by the remaining numbered migrations (`004_two_lists.sql` is the current shape). The only controls on a task are a tickbox and a trashcan (tap twice to delete); the first line of a message is its title and `#tags` are highlighted.

Run `npm test` for the task helpers. The Mac client loads the same `src/backlog-ui.js`, `src/backlog-model.js`, and `src/backlog-ui.css` through its local server.

Bean cards show clean–funky and light–dark as a solid dot inside shaded range dots; tap a row to read the reason and page quotes. The roast slider and vibe quadrants filter on the best guess, not the range.

The Wish list reuses the Browse card under a rank bar (position, move arrows). Press and hold a card to drag it. Tap targets have no tap-highlight flash.
Sold-out Wish list cards are greyed. The "In stock only" toggle hides them without changing the saved order.
