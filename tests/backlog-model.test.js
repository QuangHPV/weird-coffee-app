import test from 'node:test';
import assert from 'node:assert/strict';
import { newTask, splitMessage, dayKey, groupByDay, normalizeDocument } from '../src/backlog-model.js';

test('a new task is on the TODO list', () => {
  const task = newTask('  Fix the heart  ');
  assert.equal(task.text, 'Fix the heart');
  assert.equal(task.done_at, null);
  assert.ok(task.id && task.created);
});

test('the first line is the title and the rest is the body', () => {
  assert.deepEqual(splitMessage('Title #mac\n\nmore\ndetail'), { title: 'Title #mac', body: 'more\ndetail' });
  assert.deepEqual(splitMessage('Only a title'), { title: 'Only a title', body: '' });
});

test('plain dates keep their day', () => {
  assert.equal(dayKey('2026-09-27'), '2026-09-27');
});

test('tasks are grouped by day, newest first, ties keep stored order', () => {
  const task = (id, created) => ({ id, text: id, created, done_at: null });
  const groups = groupByDay([
    task('old-a', '2026-09-27'), task('old-b', '2026-09-27'),
    task('new', '2026-10-18'), task('mid', '2026-10-01'),
  ], 'created');
  assert.deepEqual(groups.map(group => group.day), ['2026-10-18', '2026-10-01', '2026-09-27']);
  assert.deepEqual(groups[2].tasks.map(value => value.id), ['old-a', 'old-b']);
});

test('a missing task list becomes empty', () => {
  assert.deepEqual(normalizeDocument({}), { tasks: [] });
  assert.deepEqual(normalizeDocument(null), { tasks: [] });
});
