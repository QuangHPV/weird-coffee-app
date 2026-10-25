// How fresh each roaster's data is, shared by the Mac page and the phone.

const MINUTE = 60000;
const DAY = 86400000;
const FRESH_MS = DAY;    // a source is up to date if it was read within a day

export function ageText(ms) {
  if (ms == null) return 'never';
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

export function timeOf(value, now = new Date()) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf())) return '';
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(date).setHours(0, 0, 0, 0) - day) / DAY);
  const clock = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return clock;
  if (days === 1) return `tomorrow ${clock}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${clock}`;
}

// One entry per roaster. A failed source is paused until its suggested time, then "suggested" until someone scans it.
export function sourceHealth(sources = [], now = Date.now()) {
  return sources.map(source => {
    const lastOk = source.last_ok ? new Date(source.last_ok).valueOf() : NaN;
    const age = Number.isNaN(lastOk) ? null : Math.max(0, now - lastOk);
    const upToDate = age !== null && age <= FRESH_MS;
    const locked = Boolean(source.status) && source.status !== 'ok';
    const nextTry = source.next_try ? new Date(source.next_try).valueOf() : NaN;
    const state = locked ? (nextTry > now ? 'paused' : 'suggested') : upToDate ? 'ok' : 'old';
    return { ...source, age, upToDate, locked, state, history: source.history || [] };
  });
}

// The status banner: stronger the longer the oldest data is.
export function healthSummary(list) {
  const stale = list.filter(source => !source.upToDate);
  const paused = list.filter(source => source.locked);
  const toScan = list.filter(source => source.locked || !source.upToDate);
  const suggested = list.filter(source => source.state === 'suggested');
  if (!stale.length && !paused.length) return { tone: 'ok', title: 'All sources up to date', detail: '', toScan, suggested };
  const oldest = stale.reduce((max, source) => Math.max(max, source.age ?? 7 * DAY), 0);
  return {
    tone: oldest >= 2 * DAY ? 'down' : 'warn',
    title: stale.length ? `${stale.length} of ${list.length} sources out of date` : `${paused.length} of ${list.length} sources paused`,
    detail: stale.length ? `Oldest data is ${ageText(oldest)} old` : '',
    toScan, suggested,
  };
}

// Roasters whose data is older than a day, for marking their lots untrusted.
export function staleRoasters(sources, now = Date.now()) {
  return new Map(sourceHealth(sources, now).filter(source => !source.upToDate).map(source => [source.roaster, source]));
}

// Wish list slider: each step also shows everything the one before it shows.
export const WISH_LEVELS = ['Trusted', '+ Sold out', 'Everything'];

export function wishShows(bean, level, stale) {
  if (!bean) return true;
  if (level >= 2) return true;
  if (stale.has(bean.roaster)) return false;
  return level >= 1 || (bean.available && !bean.gone);
}

// What one run did, for the detail view.
export function runPlan(run) {
  const queue = run.queue || [];
  if (!queue.length) return null;
  const rows = queue.map(entry => {
    if (entry.status === 'ok') return { roaster: entry.roaster, state: 'ok', text: 'Updated' };
    if (entry.status === 'failed') return { roaster: entry.roaster, state: 'failed', text: 'Could not be read' };
    return entry.resolved ? { roaster: entry.roaster, state: 'ok', text: 'Updated later' } : { roaster: entry.roaster, state: 'waiting', text: 'Not updated' };
  });
  const got = queue.filter(entry => entry.status === 'ok').length;
  return { rows, summary: got === queue.length ? `All ${queue.length} roasters updated` : `Updated ${got} of ${queue.length} roasters` };
}

// The status mark on a list row; nothing for a run that finished cleanly.
export function rowMark(run) {
  if (run.status === 'running') return { tone: 'busy', text: 'Refreshing' };
  if (run.legacy) return null;
  const plan = runPlan(run);
  if (plan?.rows.some(row => row.state !== 'ok')) return { tone: 'waiting', text: 'Incomplete' };
  if (!plan && ['partial', 'failed', 'interrupted'].includes(run.status)) return { tone: 'waiting', text: 'Incomplete' };
  return null;
}
