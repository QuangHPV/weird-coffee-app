import test from 'node:test';
import assert from 'node:assert/strict';
import { readFeed, relayRoasters } from '../src/relay.js';

const wait = async () => {};
const shop = { roaster: 'Shop', url: 'https://shop.test', platform: 'shopify', path: '/coffee' };

test('reads every page until an empty one and keeps only needed fields', async () => {
  const bodies = [{ products: [{ title: 'A', handle: 'a', variants: [], images: [{ src: '1' }, { src: '2' }], body_html: 'x', extra: 1 }] }, { products: [] }];
  const seen = [];
  const pages = await readFeed(shop, { wait, fetchFn: async url => { seen.push(url); return { ok: true, text: async () => JSON.stringify(bodies[seen.length - 1]) }; } });
  assert.deepEqual(Object.keys(pages), ['https://shop.test/products.json?limit=250&page=1', 'https://shop.test/products.json?limit=250&page=2']);
  const first = JSON.parse(pages[seen[0]]).products[0];
  assert.equal(first.images.length, 1);
  assert.equal(first.extra, undefined);
});

test('reads product pages for lots with no description when the roaster needs page text', async () => {
  const feed = { products: [
    { title: 'Bare', handle: 'bare', product_type: 'Beans', tags: [], variants: [{}], body_html: ' <p>&nbsp;</p>' },
    { title: 'Described', handle: 'described', product_type: 'Beans', tags: [], variants: [{}], body_html: '<p>Notes</p>' },
    { title: 'Merch', handle: 'merch', product_type: 'Gear', tags: [], variants: [{}], body_html: '' },
  ] };
  const seen = [];
  const pages = await readFeed({ ...shop, page_text: true, types: ['Beans'], skip: [] }, { wait, fetchFn: async url => {
    seen.push(url);
    const body = url.includes('/products/') ? '<p>Hi</p><script>x</script>' : url.endsWith('page=1') ? JSON.stringify(feed) : '{"products":[]}';
    return { ok: true, text: async () => body };
  } });
  assert.deepEqual(seen.filter(url => url.includes('/products/')), ['https://shop.test/products/bare']);
  assert.equal(pages['https://shop.test/products/bare'].includes('script'), false);
});

test('a 429 stops the relay and keeps what was already sent', async () => {
  const sent = [];
  const fetchFn = async url => url.startsWith('https://bad') ? { ok: false, status: 429 } : { ok: true, text: async () => '{"products":[]}' };
  const result = await relayRoasters([shop, { ...shop, roaster: 'Bad', url: 'https://bad.test' }, { ...shop, roaster: 'Never' }],
    async name => { sent.push(name); }, { fetchFn, wait });
  assert.deepEqual(sent, ['Shop']);
  assert.deepEqual(result, { done: ['Shop'], failed: 'Bad', reason: 'rate limited' });
});
