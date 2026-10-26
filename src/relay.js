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

// Products the Mac would read a product page for: kept by the roaster's filters, with no description in the feed.
function needsPage(roaster, product) {
  const text = (product.body_html || '').replace(/<[^>]*>|&nbsp;/g, '').trim();
  if (text || !product.variants?.length) return false;
  if (roaster.types && !roaster.types.includes(product.product_type)) return false;
  if (roaster.tags_any?.length && !roaster.tags_any.some(tag => (product.tags || []).includes(tag))) return false;
  return !(roaster.skip || []).some(term => product.title.toLowerCase().includes(term.toLowerCase()));
}

// The Mac only reads text out of the page body, so scripts and styles can go.
const slim = html => html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

export async function readFeed(roaster, { fetchFn = (url) => fetch(url), wait = pause } = {}) {
  if (roaster.platform === 'squarespace') {
    const url = `${roaster.url}${roaster.path}?format=json-pretty`;
    return { [url]: await get(url, fetchFn) };
  }
  const pages = {}, all = [];
  for (let page = 1; ; page++) {
    const url = `${roaster.url}/products.json?limit=250&page=${page}`;
    const products = JSON.parse(await get(url, fetchFn)).products;
    if (!Array.isArray(products)) throw new FeedError('No product list');
    pages[url] = JSON.stringify({ products: products.map(trim) });
    all.push(...products);
    if (!products.length) break;
    await wait(PAUSE_MS);
  }
  if (roaster.page_text) {
    for (const product of all.filter(item => needsPage(roaster, item))) {
      const url = `${roaster.url}/products/${product.handle}`;
      pages[url] = slim(await get(url, fetchFn));
      await wait(PAUSE_MS);
    }
  }
  return pages;
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
