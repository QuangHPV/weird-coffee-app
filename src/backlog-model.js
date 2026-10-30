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

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export const joinMessage = (title, body) => body.trim() ? `${title.trim()}\n${body.trim()}` : title.trim();

// The title without its #tags.
export const stripTags = text => String(text).replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, '$1').replace(/\s+/g, ' ').trim();

// First line of the body with the markdown marks removed, for the list preview.
export function previewLine(body) {
  const line = String(body).split('\n').map(value => value.trim()).find(Boolean) || '';
  return line.replace(/^(#{1,3}\s+|[-*]\s+(\[[ xX]\]\s+)?)/, '').replace(/[*`]/g, '').slice(0, 160);
}

export const matchesQuery = (text, query) => {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = String(text).toLowerCase();
  return words.every(word => haystack.includes(word));
};

const inline = line => escapeHtml(line)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  .replace(/(^|[\s(>])(#[\p{L}\p{N}_-]+)/gu, '$1<span class="bl-tag">$2</span>');

// A small, safe subset of markdown: headings, bullet and checkbox lists, paragraphs,
// **bold**, `code`, links and #tags. Everything else is plain text.
export function renderMarkdown(text) {
  const html = [];
  let list = false, paragraph = [];
  const endParagraph = () => { if (paragraph.length) html.push(`<p>${paragraph.join('<br>')}</p>`); paragraph = []; };
  const endList = () => { if (list) html.push('</ul>'); list = false; };
  for (const line of String(text).split('\n')) {
    const heading = line.match(/^(#{1,3})\s+(.*)$/), item = line.match(/^\s*[-*]\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (heading) { endParagraph(); endList(); html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); }
    else if (item) {
      endParagraph();
      if (!list) { html.push('<ul>'); list = true; }
      const box = item[1] === undefined ? '' : `<input type="checkbox" disabled ${item[1] === ' ' ? '' : 'checked'}> `;
      html.push(`<li${box ? ' class="check"' : ''}>${box}${inline(item[2])}</li>`);
    } else if (!line.trim()) { endParagraph(); endList(); }
    else { endList(); paragraph.push(inline(line)); }
  }
  endParagraph(); endList();
  return html.join('');
}
