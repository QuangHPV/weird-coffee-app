# Coffee Beans SG mobile

This repository contains only the installable mobile web app. The Mac coffee
manager, its local database, labels, and publishing credential stay on the Mac.

The site is published from `main` → `/docs` at
https://quanghpv.github.io/weird-coffee-app/.

To update the site, run `npm ci` and `npm run build`, then commit the changed
source and `docs` files. `.env.production` contains only public Neon Auth and
Data API URLs. Never add a PostgreSQL connection string or password here.
