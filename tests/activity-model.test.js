import assert from 'node:assert/strict';
import test from 'node:test';
import { plannerCard, timeline, queueState, rowMark, runPlan } from '../src/activity-model.js';

const now = new Date('2026-10-24T05:00:00Z');
const later = new Date(now.getTime() + 3600000).toISOString();
const entry = (roaster, status, extra = {}) => ({ roaster, status, reason: status === 'waiting' ? 'rate_limited' : null, resolved: false, ...extra });
const root = { id: 2, source: 'scheduled', status: 'partial', started_at: now.toISOString(), queue: [
  entry('A', 'ok'), entry('B', 'waiting', { next_try: later }), entry('C', 'waiting', { next_try: later })] };

test('planner says how much is done and when the rest continues', () => {
  const card = plannerCard([root], now);
  assert.equal(card.title, '1 of 3 roasters done');
  assert.equal(card.tone, 'waiting');
  assert.deepEqual(card.steps.map(step => [step.state, step.text]), [['past', '1 of 3'], ['next', '3 of 3']]);
});

test('a retry that finishes a roaster removes it from the queue', () => {
  const retry = { id: 3, source: 'recovery', status: 'partial', started_at: now.toISOString(),
    queue: [entry('B', 'ok'), entry('C', 'waiting', { next_try: later })] };
  const runs = [retry, { ...root, queue: root.queue.map(item => item.roaster === 'B' ? { ...item, resolved: true } : item) }];
  assert.equal(queueState(runs).waiting.length, 1);
  assert.equal(plannerCard(runs, now).title, '2 of 3 roasters done');
  assert.equal(runPlan(runs[1], runs).rows[1].text, 'Done on a retry');
  assert.equal(rowMark(runs[1], runs).text, 'Retrying');
});

test('everything done reads as caught up and shows no mark', () => {
  const done = { ...root, status: 'success', queue: [entry('A', 'ok'), entry('B', 'ok')], finished_at: now.toISOString() };
  assert.equal(plannerCard([done], now).title, 'All caught up');
  assert.equal(rowMark(done, [done]), null);
});

test('after the retry budget the plan points to the daily refresh', () => {
  const retries = Array.from({ length: 6 }, (_, index) => ({ id: 10 + index, source: 'recovery', status: 'partial', started_at: now.toISOString(), queue: [entry('B', 'waiting', { next_try: later })] }));
  assert.match(plannerCard([...retries, root], now).detail, /daily refresh/);
  assert.ok(plannerCard([...retries, root], now).steps.every(step => step.state === 'past'));
});

test('a running refresh shows its progress', () => {
  const card = plannerCard([{ id: 4, status: 'running', roasters_done: 3, roasters_total: 9 }, root], now);
  assert.equal(card.detail, '3 of 9 roasters checked');
});
