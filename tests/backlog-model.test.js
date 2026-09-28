import test from 'node:test';
import assert from 'node:assert/strict';
import { addSubtask, checkboxState, toggleTask, deleteTask, moveTask, queueTask, queueBucket, normalizeDocument, batchSize, BATCH_LIMIT } from '../src/backlog-model.js';

const task = (id, depth = 0, done = false, note = false) => ({ id, text: id, depth, done, note });
const bucket = (id, items = [], stage = 'collecting') => ({ id, title: id, version: '', stage, items });

test('nested checkboxes propagate down and become partial or checked upwards', () => {
  const items = [task('parent'), task('a', 1), task('nested', 1), task('b', 2), task('c', 2), task('note', 1, false, true)];
  toggleTask(items, 'b', true);
  assert.equal(checkboxState(items, 2), 'mixed');
  assert.equal(checkboxState(items, 0), 'mixed');
  toggleTask(items, 'parent', true);
  assert.equal(checkboxState(items, 0), 'checked');
  assert.equal(items[5].done, false);
  toggleTask(items, 'c', false);
  assert.equal(items[0].done, false);
  assert.equal(checkboxState(items, 0), 'mixed');
});

test('new subtask stays inside its parent and unchecks a completed parent', () => {
  const items = [task('parent', 0, true), task('a', 1, true), task('next')];
  const added = addSubtask(items, 'parent', 'new child');
  assert.equal(items[2].id, added.id);
  assert.equal(added.depth, 1);
  assert.equal(checkboxState(items, 0), 'mixed');
  assert.equal(items[3].id, 'next');
});

test('delete removes all descendants including notes but preserves siblings', () => {
  const items = [task('parent'), task('a', 1), task('note', 2, false, true), task('next')];
  deleteTask(items, 'parent');
  assert.deepEqual(items.map(item => item.id), ['next']);
});

test('move preserves the whole subtree and recomputes former parent', () => {
  const buckets = [bucket('a', [task('parent'), task('child', 1), task('grandchild', 2), task('sibling', 1, true)]), bucket('b', [task('existing')])];
  moveTask(buckets, 'a', 'child', 'b', 'existing');
  assert.deepEqual(buckets[1].items.map(item => [item.id, item.depth]), [['child', 0], ['grandchild', 1], ['existing', 0]]);
  assert.equal(buckets[0].items[0].done, true);
  moveTask(buckets, 'b', 'child', 'b', 'grandchild');
  assert.equal(buckets[1].items.length, 3);
});

test('queuing tasks from several buckets creates only one pending batch', () => {
  const buckets = [bucket('a', [task('a1'), task('a2', 1)]), bucket('b', [task('b1')])];
  const first = queueTask(buckets, 'a', 'a1');
  assert.equal(queueBucket(buckets, 'b'), first);
  assert.equal(buckets.filter(value => value.stage === 'pending').length, 1);
  assert.deepEqual(buckets[0].items.map(item => item.id), ['a1', 'a2', 'b1']);
  assert.equal(batchSize(buckets[0]), 2);
});

test('legacy versions migrate into names without duplicates and pending batches consolidate', () => {
  const input = { buckets: [{ ...bucket('Backlog', [task('a')], 'pending'), version: '2' }, { ...bucket('Mobile v1', [task('b')], 'pending'), version: '1' }] };
  const result = normalizeDocument(input);
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].title, 'Backlog v2');
  assert.equal(result.buckets[0].version, '');
  assert.equal(result.buckets[0].items.length, 2);
  assert.deepEqual(normalizeDocument(result), result);
  assert.equal(input.buckets.length, 2);
});

test('batch warning counts remaining leaf work and ignores notes and completed tasks', () => {
  const value = bucket('batch', [task('parent'), ...Array.from({ length: BATCH_LIMIT + 1 }, (_, i) => task(`task-${i}`, 1)), task('note', 1, false, true), task('done', 0, true)]);
  assert.equal(batchSize(value), BATCH_LIMIT + 1);
});

test('queuing a nested subtree removes originals and preserves its source path through later moves', () => {
  const buckets = [bucket('Ideas', [task('parent'), task('child', 1), task('grandchild', 2), task('sibling')]), bucket('Work', [], 'in_progress')];
  const pendingId = queueTask(buckets, 'Ideas', 'child');
  const pending = buckets.find(b => b.id === pendingId);
  assert.deepEqual(buckets.find(b => b.id === 'Ideas').items.map(i => i.id), ['parent', 'sibling']);
  assert.deepEqual(pending.items.map(i => [i.id, i.depth, i.sourcePath]), [
    ['child', 0, ['Ideas', 'parent']], ['grandchild', 1, ['Ideas', 'parent', 'child']]
  ]);
  moveTask(buckets, pendingId, 'child', 'Work');
  queueBucket(buckets, 'Work');
  assert.deepEqual(pending.items[0].sourcePath, ['Ideas', 'parent']);
  assert.equal(new Set(buckets.flatMap(b => b.items.map(i => i.id))).size, 4);
});

test('dragging directly into Pending records provenance and moving a parent after a sibling keeps children attached', () => {
  const buckets = [bucket('Ideas', [task('parent'), task('child', 1), task('sibling')]), bucket('Next', [], 'pending')];
  moveTask(buckets, 'Ideas', 'parent', 'Ideas', 'sibling', true);
  assert.deepEqual(buckets[0].items.map(i => i.id), ['sibling', 'parent', 'child']);
  moveTask(buckets, 'Ideas', 'parent', 'Next');
  assert.deepEqual(buckets[1].items.map(i => i.sourcePath), [['Ideas'], ['Ideas', 'parent']]);
});
