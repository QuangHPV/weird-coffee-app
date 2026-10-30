// A backlog is a flat list of tasks: { id, text, created, done_at }.
// `done_at` is null while the task is open. The first line of `text` is the title, the rest is
// the body. Timestamps are ISO strings; legacy ones may be a plain date.
// Optional fields: `lane` ("now" or "later"; none means Inbox), `plan` (path of the plan file on
// the Mac) and `progress` ({ done, total } steps ticked in that plan).
export const NOW_LIMIT = 3;

export const newTask = (text, now = new Date()) => ({
  id: crypto.randomUUID(), text: text.trim(), created: now.toISOString(), done_at: null
});

export function splitMessage(text) {
  const [title, ...rest] = String(text).trim().split('\n');
  return { title: title.trim(), body: rest.join('\n').trim() };
}

export const hasTime = stamp => String(stamp).length > 10;

export const laneOf = task => task.done_at != null ? 'done' : task.lane === 'now' || task.lane === 'later' ? task.lane : 'inbox';

// Inbox is the lack of a lane. Completing or reopening a task also puts it back in the Inbox.
export function setLane(task, lane) {
  if (lane === 'now' || lane === 'later') task.lane = lane; else delete task.lane;
}

export function tagsOf(text) {
  return [...new Set(String(text).match(/(?<=^|[\s(])#[\p{L}\p{N}_-]+/gu) || [])];
}

const pad = number => String(number).padStart(2, '0');
const localKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// "2026-09-27" for a plain date, otherwise the local calendar day of the timestamp.
export function dayKey(stamp) {
  return hasTime(stamp) ? localKey(new Date(stamp)) : String(stamp);
}

// The Monday of the stamp's week, as a day key.
export function weekKey(stamp) {
  const date = new Date(`${dayKey(stamp)}T00:00:00`);
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return localKey(date);
}

// Newest first, grouped by week. Tasks with the same timestamp keep their stored order.
export function groupByWeek(tasks, field) {
  const sorted = [...tasks].sort((a, b) => Date.parse(b[field]) - Date.parse(a[field]));
  const groups = [];
  for (const task of sorted) {
    const week = weekKey(task[field]);
    if (groups.at(-1)?.week !== week) groups.push({ week, tasks: [] });
    groups.at(-1).tasks.push(task);
  }
  return groups;
}

// "today", "3d", "2w", "5mo"
export function ageLabel(stamp, now = new Date()) {
  const days = Math.max(0, Math.floor((now - new Date(`${dayKey(stamp)}T00:00:00`)) / 86400000));
  if (days < 1) return 'today';
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function normalizeDocument(document) {
  return { tasks: Array.isArray(document?.tasks) ? document.tasks : [] };
}
