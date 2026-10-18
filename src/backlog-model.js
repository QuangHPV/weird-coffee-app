// A backlog is a flat list of tasks: { id, text, created, done_at }.
// `done_at` is null while the task is on the TODO list. The first line of `text` is the
// title, the rest is the body. Timestamps are ISO strings; legacy ones may be a plain date.
export const newTask = (text, now = new Date()) => ({
  id: crypto.randomUUID(), text: text.trim(), created: now.toISOString(), done_at: null
});

export function splitMessage(text) {
  const [title, ...rest] = String(text).trim().split('\n');
  return { title: title.trim(), body: rest.join('\n').trim() };
}

export const hasTime = stamp => String(stamp).length > 10;

// "2026-09-27" for a plain date, otherwise the local calendar day of the timestamp.
export function dayKey(stamp) {
  if (!hasTime(stamp)) return String(stamp);
  const date = new Date(stamp);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Newest first, grouped by day. Tasks with the same timestamp keep their stored order.
export function groupByDay(tasks, field) {
  const sorted = [...tasks].sort((a, b) => Date.parse(b[field]) - Date.parse(a[field]));
  const groups = [];
  for (const task of sorted) {
    const day = dayKey(task[field]);
    if (groups.at(-1)?.day !== day) groups.push({ day, tasks: [] });
    groups.at(-1).tasks.push(task);
  }
  return groups;
}

export function normalizeDocument(document) {
  return { tasks: Array.isArray(document?.tasks) ? document.tasks : [] };
}
