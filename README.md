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
