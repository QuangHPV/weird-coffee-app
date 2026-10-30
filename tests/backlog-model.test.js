import test from 'node:test';
import assert from 'node:assert/strict';
import { newTask, splitMessage, dayKey, weekKey, groupByWeek, laneOf, setLane, tagsOf, ageLabel, normalizeDocument } from '../src/backlog-model.js';

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

test('a task is in Inbox unless it has a lane or is done', () => {
  assert.equal(laneOf({ done_at: null }), 'inbox');
  assert.equal(laneOf({ done_at: null, lane: 'now' }), 'now');
  assert.equal(laneOf({ done_at: null, lane: 'later' }), 'later');
  assert.equal(laneOf({ done_at: null, lane: 'odd' }), 'inbox');
  assert.equal(laneOf({ done_at: '2026-10-01', lane: 'now' }), 'done');
});

test('moving to Inbox removes the lane', () => {
  const task = { lane: 'now' };
  setLane(task, 'later');
  assert.equal(task.lane, 'later');
  setLane(task, 'inbox');
  assert.equal('lane' in task, false);
});

test('tags are found once each, not inside words', () => {
  assert.deepEqual(tagsOf('Fix it #ui #mobile\nmore #ui a#b'), ['#ui', '#mobile']);
});

test('weeks start on Monday', () => {
  assert.equal(weekKey('2026-10-28'), '2026-10-26');
  assert.equal(weekKey('2026-10-26'), '2026-10-26');
  assert.equal(weekKey('2026-11-01'), '2026-10-26');
});

test('tasks are grouped by week, newest first, ties keep stored order', () => {
  const task = (id, done_at) => ({ id, text: id, created: done_at, done_at });
  const groups = groupByWeek([
    task('old-a', '2026-09-27'), task('old-b', '2026-09-27'),
    task('new', '2026-10-28'), task('same-week', '2026-10-27'),
  ], 'done_at');
  assert.deepEqual(groups.map(group => group.week), ['2026-10-26', '2026-09-21']);
  assert.deepEqual(groups[0].tasks.map(value => value.id), ['new', 'same-week']);
  assert.deepEqual(groups[1].tasks.map(value => value.id), ['old-a', 'old-b']);
});

test('ages are short', () => {
  const now = new Date('2026-10-30T12:00:00');
  assert.equal(ageLabel('2026-10-30', now), 'today');
  assert.equal(ageLabel('2026-10-27', now), '3d');
  assert.equal(ageLabel('2026-10-09', now), '3w');
  assert.equal(ageLabel('2026-07-30', now), '3mo');
});

test('a missing task list becomes empty', () => {
  assert.deepEqual(normalizeDocument({}), { tasks: [] });
  assert.deepEqual(normalizeDocument(null), { tasks: [] });
});
