import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataLoader, LoadError, SessionEnded } from '../src/data-loader.js';

function fixture(overrides = {}) {
  const events = [], applied = [], diagnostics = [];
  const loader = createDataLoader({ read: async () => ({ ok: true }), apply: value => applied.push(value),
    refreshSession: async () => {}, state: value => events.push(value), online: () => true,
    diagnose: value => diagnostics.push(value), wait: async () => {}, ...overrides });
  return { ...loader, events, applied, diagnostics };
}

test('transient failures recover without a reload or partial apply', async () => {
  let attempts = 0;
  const run = fixture({ read: async () => {
    if (++attempts < 3) throw new LoadError('catalog', { status: 503, message: 'warming up' });
    return { complete: true };
  } });
  assert.equal(await run.load(), true);
  assert.equal(attempts, 3);
  assert.deepEqual(run.applied, [{ complete: true }]);
  assert.equal(run.events.at(-1).status, 'ready');
});

test('authorization failure refreshes session once, then succeeds', async () => {
  let attempts = 0, refreshes = 0;
  const run = fixture({ read: async () => {
    if (++attempts === 1) throw new LoadError('account setup', { status: 403, code: '42501', message: 'Not authorized' });
    return 'data';
  }, refreshSession: async () => { refreshes++; } });
  assert.equal(await run.load(), true);
  assert.equal(refreshes, 1);
});

test('persistent authorization failures stop after one refresh', async () => {
  let attempts = 0, refreshes = 0;
  const run = fixture({ read: async () => { attempts++; throw new LoadError('account setup', { status: 401 }); },
    refreshSession: async () => { refreshes++; } });
  assert.equal(await run.load(), false);
  assert.equal(attempts, 3);
  assert.equal(refreshes, 1);
  assert.equal(run.events.at(-1).status, 'error');
});

test('expired session returns to sign in without replaying data calls', async () => {
  const run = fixture({ read: async () => { throw new LoadError('profile', { status: 401 }); },
    refreshSession: async () => { throw new SessionEnded(); } });
  await run.load();
  assert.equal(run.events.at(-1).status, 'signed-out');
  assert.equal(run.events.at(-1).expired, true);
  assert.equal(run.applied.length, 0);
});

test('permission and data-format errors do not retry', async () => {
  for (const error of [new LoadError('catalog', { code: '42501', status: 403, message: 'permission denied' }), new LoadError('format', { code: 'INVALID_DATA' })]) {
    const run = fixture({ read: async () => { throw error; } });
    await run.load();
    assert.equal(run.diagnostics.length, 1);
    assert.equal(run.events.at(-1).status, 'error');
  }
});

test('empty account data is retried within a fixed budget', async () => {
  const run = fixture({ read: async () => { throw new LoadError('profile', { code: 'DATA_NOT_READY' }); } });
  await run.load();
  assert.equal(run.diagnostics.length, 3);
  assert.equal(run.applied.length, 0);
});

test('hung data and token requests time out, abort, and leave retry available', async () => {
  const signals = [];
  const run = fixture({ timeoutMs: 10, read: signal => { signals.push(signal); return new Promise(() => {}); } });
  assert.equal(await run.load(), false);
  assert.equal(signals.length, 3);
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(run.events.at(-1).status, 'error');
});

test('hung session recovery is bounded too', async () => {
  const run = fixture({ timeoutMs: 10, read: async () => { throw new LoadError('catalog', { status: 401 }); }, refreshSession: () => new Promise(() => {}) });
  assert.equal(await run.load(), false);
  assert.equal(run.events.at(-1).status, 'error');
});

test('concurrent resume, online, retry, and polling share one load', async () => {
  let resolve, count = 0;
  const run = fixture({ read: () => { count++; return new Promise(done => { resolve = done; }); } });
  const first = run.load({ quiet: true });
  const second = run.load();
  assert.equal(first, second);
  await new Promise(done => setImmediate(done));
  resolve('data');
  await first;
  assert.equal(count, 1);
  assert.equal(run.events.at(-1).quiet, false);
});

test('sign out aborts old requests and cannot restore the old account', async () => {
  let resolve;
  const run = fixture({ read: () => new Promise(done => { resolve = done; }) });
  const pending = run.load();
  await new Promise(done => setImmediate(done));
  run.reset();
  resolve('old account');
  assert.equal(await pending, false);
  assert.equal(run.applied.length, 0);
});

test('sign out during session recovery cannot apply or report an old error', async () => {
  let resolve;
  const run = fixture({ read: async () => { throw new LoadError('catalog', { status: 401 }); }, refreshSession: () => new Promise(done => { resolve = done; }) });
  const pending = run.load();
  await new Promise(done => setImmediate(done));
  run.reset(); resolve();
  await pending;
  assert.equal(run.events.at(-1).status, 'loading');
  assert.equal(run.applied.length, 0);
});

test('offline fails immediately and reconnect can start a fresh attempt', async () => {
  let connected = false;
  const run = fixture({ online: () => connected });
  assert.equal(await run.load(), false);
  assert.equal(run.events.at(-1).status, 'offline');
  connected = true;
  assert.equal(await run.load(), true);
});

test('failed background refresh preserves previously applied data', async () => {
  let fail = false;
  const run = fixture({ read: async () => { if (fail) throw new LoadError('catalog', { status: 503 }); return 'previous data'; } });
  await run.load(); fail = true;
  await run.load({ quiet: true });
  assert.deepEqual(run.applied, ['previous data']);
  assert.equal(run.events.at(-1).quiet, true);
});
