# Coffee mobile

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

The fourth tab is the shared Backlog. It reads `public.backlog_state` and saves
through the authenticated `save_backlog` function with a revision check. The Mac
manager uses the same document. Apply `migrations/001_backlog.sql` to a new Neon
branch before running this version there, followed by the remaining numbered
migrations. New buckets start in Collecting. Queue selected tasks into the one
Pending batch, then move that batch to In progress and Done. Versions belong
in bucket names. Subtasks move and delete with their parent; checking a parent
updates all of its children. More than 12 unfinished leaf tasks triggers a batch
size warning. Use the grip to drag with a mouse or hold and drag on a phone.

Run `npm test` for task-tree and batch logic. With the Vite dev server on port
5173, `npm run test:browser` checks editing, checkboxes, deletion, and mouse/touch
dragging in headless Chrome using sample data. Set `CHROME_BIN` when Chrome is
installed elsewhere. Test fixtures are not included in the published build.

The Mac client loads the same `src/backlog-ui.js`, `src/backlog-model.js`, and
`src/backlog-ui.css` through its local server.
