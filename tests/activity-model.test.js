import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceHealth, healthSummary, staleRoasters, wishShows, rowMark, runPlan, ageText } from '../src/activity-model.js';

const now = new Date('2026-10-26T12:00:00Z').valueOf();
const hours = count => new Date(now - count * 3600000).toISOString();
const source = (roaster, last, status = 'ok', next_try = null) => ({ roaster, last_ok: last, status, next_try, history: [] });

test('a source is up to date within a day and states follow failures and the suggested time', () => {
  const list = sourceHealth([
    source('A', hours(2)), source('B', hours(30)),
    source('C', hours(30), 'waiting', new Date(now + 3600000).toISOString()),
    source('D', hours(60), 'waiting', new Date(now - 3600000).toISOString()),
    source('E', null, 'waiting')], now);
  assert.deepEqual(list.map(item => item.state), ['ok', 'old', 'paused', 'suggested', 'suggested']);
  assert.deepEqual(list.map(item => item.upToDate), [true, false, false, false, false]);
});

test('the banner grows more serious as the oldest data ages', () => {
  const warn = healthSummary(sourceHealth([source('A', hours(2)), source('B', hours(30))], now));
  assert.equal(warn.tone, 'warn');
  assert.equal(warn.title, '1 of 2 roasters out of date');
  assert.equal(healthSummary(sourceHealth([source('B', hours(60))], now)).tone, 'down');
  assert.equal(healthSummary(sourceHealth([source('A', hours(2))], now)).tone, 'ok');
  const paused = healthSummary(sourceHealth([source('A', hours(2), 'waiting', new Date(now + 3600000).toISOString())], now));
  assert.equal(paused.title, '1 of 1 roasters paused');
  assert.equal(paused.toScan.length, 1);
});

test('only sources older than a day are untrusted', () => {
  const stale = staleRoasters([source('A', hours(2)), source('B', hours(30))], now);
  assert.deepEqual([...stale.keys()], ['B']);
  assert.equal(ageText(90 * 60000), '1 h');
  assert.equal(ageText(3 * 86400000), '3 days');
});

test('each Wish list level shows everything the level before it shows', () => {
  const stale = new Map([['Old', {}]]);
  const stocked = { roaster: 'New', available: true, gone: false };
  const soldOut = { roaster: 'New', available: false, gone: false };
  const fromOld = { roaster: 'Old', available: true, gone: false };
  const shown = level => [stocked, soldOut, fromOld].filter(bean => wishShows(bean, level, stale)).length;
  assert.deepEqual([0, 1, 2].map(shown), [1, 2, 3]);
  assert.equal(wishShows(null, 0, stale), true);
});

test('run summaries say what was updated, never "retrying"', () => {
  const run = { status: 'partial', queue: [{ roaster: 'A', status: 'ok' }, { roaster: 'B', status: 'waiting', resolved: false }, { roaster: 'C', status: 'waiting', resolved: true }] };
  assert.equal(runPlan(run).summary, 'Updated 1 of 3 roasters');
  assert.deepEqual(runPlan(run).rows.map(row => row.text), ['Updated', 'Not updated', 'Updated later']);
  assert.equal(rowMark(run).text, 'Incomplete');
  assert.equal(rowMark({ status: 'success', queue: [{ roaster: 'A', status: 'ok' }] }), null);
});
