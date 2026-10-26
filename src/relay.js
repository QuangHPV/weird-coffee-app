// Phone relay: read a roaster's feed with this phone's own connection, so the Mac never has to.
// The result is {feed URL: response text}, the same URLs the Mac's scraper would have requested.

const PAUSE_MS = 1500;    // between requests to the same store

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export class FeedError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

async function get(url, fetchFn) {
  let response;
  try { response = await fetchFn(url); } catch { throw new FeedError('Network request failed'); }
  if (!response.ok) throw new FeedError(`HTTP ${response.status}`, response.status);
  return response.text();
}

// Keep only what the Mac reads, so the upload stays small.
function trim(product) {
  const { title, handle, product_type, tags, variants, images, body_html } = product;
  return { title, handle, product_type, tags, variants, images: (images || []).slice(0, 1), body_html };
}

export async function readFeed(roaster, { fetchFn = (url) => fetch(url), wait = pause } = {}) {
  if (roaster.platform === 'squarespace') {
    const url = `${roaster.url}${roaster.path}?format=json-pretty`;
    return { [url]: await get(url, fetchFn) };
  }
  const pages = {};
  for (let page = 1; ; page++) {
    const url = `${roaster.url}/products.json?limit=250&page=${page}`;
    const products = JSON.parse(await get(url, fetchFn)).products;
    if (!Array.isArray(products)) throw new FeedError('No product list');
    pages[url] = JSON.stringify({ products: products.map(trim) });
    if (!products.length) return pages;
    await wait(PAUSE_MS);
  }
}

// Reads and uploads one roaster at a time. A 429 stops everything, so the phone never pushes a throttled store.
export async function relayRoasters(roasters, upload, { fetchFn, wait = pause, onProgress = () => {} } = {}) {
  const done = [];
  for (const roaster of roasters) {
    onProgress(roaster.roaster, done.length, roasters.length);
    try {
      await upload(roaster.roaster, await readFeed(roaster, { fetchFn, wait }));
      done.push(roaster.roaster);
    } catch (error) {
      return { done, failed: roaster.roaster, reason: error.status === 429 ? 'rate limited' : error.message };
    }
    await wait(PAUSE_MS);
  }
  return { done, failed: null, reason: null };
}
