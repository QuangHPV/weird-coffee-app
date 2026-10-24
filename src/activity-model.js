// Plain-language summaries of refresh runs: what was caught up and what is still queued.

const REASONS = {
  rate_limited: 'limiting requests',
  store_down: 'unavailable',
  offline: 'unreachable',
  slow: 'slow to respond',
};
const RETRY_LIMIT = 6;

export function reasonText(reason) {
  return REASONS[reason] || 'not ready';
}

// Newest first. The chain is the latest scheduled/manual run plus the retries after it.
function chainOf(runs) {
  const end = runs.findIndex(run => run.source !== 'recovery');
  return end === -1 ? runs : runs.slice(0, end + 1);
}

// Each roaster's latest result across the chain, so a retry that finished it replaces the earlier wait.
export function queueState(runs) {
  const chain = chainOf(runs);
  const latest = new Map();
  for (const run of chain) for (const entry of run.queue || []) if (!latest.has(entry.roaster)) latest.set(entry.roaster, entry);
  const entries = [...latest.values()];
  const waiting = entries.filter(entry => entry.status === 'waiting')
    .sort((a, b) => (a.next_try || '').localeCompare(b.next_try || ''));
  const root = chain[chain.length - 1];
  const retries = chain.length - 1;
  const outOfRetries = retries >= RETRY_LIMIT || Date.now() - new Date(root?.started_at).valueOf() > 86400000;
  return {
    total: entries.length,
    done: entries.filter(entry => entry.status === 'ok').length,
    failed: entries.filter(entry => entry.status === 'failed'),
    waiting,
    outOfRetries,
    retries,
  };
}

export function timeOf(value, now = new Date()) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf())) return '';
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(date).setHours(0, 0, 0, 0) - day) / 86400000);
  const clock = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return clock;
  if (days === 1) return `tomorrow ${clock}`;
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${clock}`;
}

function names(entries, limit = 2) {
  const list = entries.map(entry => entry.roaster);
  return list.length <= limit ? list.join(' and ') : `${list.slice(0, limit).join(', ')} and ${list.length - limit} more`;
}

// The planner card at the top of Activity: what we have, what is queued, and when it continues.
export function plannerCard(runs, now = new Date()) {
  const current = runs.find(run => run.status === 'running');
  const state = queueState(runs);
  if (current) {
    const total = current.roasters_total || state.total;
    return { tone: 'busy', title: 'Refreshing now', detail: total ? `${current.roasters_done || 0} of ${total} roasters checked` : 'Starting', done: current.roasters_done || 0, total };
  }
  if (state.waiting.length) {
    const first = state.waiting[0].next_try;
    const due = state.waiting.filter(entry => entry.next_try === first).length;
    const next = state.outOfRetries ? 'The rest will be tried at the next daily refresh.'
      : new Date(first) <= now ? `Trying the rest shortly.`
      : `Next try ${timeOf(first, now)}${due < state.waiting.length ? ` for ${due} of them` : ''}.`;
    return {
      tone: 'waiting',
      title: `Caught up on ${state.done} of ${state.total} roasters`,
      detail: `${names(state.waiting)} ${state.waiting.length === 1 ? 'is' : 'are'} ${reasonText(state.waiting[0].reason)}. ${next}`,
      done: state.done,
      total: state.total,
    };
  }
  const latest = runs[0];
  if (!latest) return { tone: 'done', title: 'No refreshes yet', detail: 'Coffee changes from your roasters appear here.', done: 0, total: 0 };
  if (state.failed.length) {
    return { tone: 'waiting', title: `Caught up on ${state.done} of ${state.total} roasters`, detail: `${names(state.failed)} could not be read. See the latest refresh.`, done: state.done, total: state.total };
  }
  return { tone: 'done', title: 'All caught up', detail: `Last refresh ${timeOf(latest.finished_at || latest.started_at, now)}`, done: state.total, total: state.total };
}

// What one run did, for the detail view.
export function runPlan(run, runs) {
  const queue = run.queue || [];
  if (!queue.length) return null;
  const rows = queue.map(entry => {
    if (entry.status === 'ok') return { roaster: entry.roaster, state: 'ok', text: 'Done' };
    if (entry.status === 'failed') return { roaster: entry.roaster, state: 'failed', text: 'Could not be read' };
    if (entry.resolved) return { roaster: entry.roaster, state: 'ok', text: 'Done on a retry' };
    const stillWaiting = queueState(runs).waiting.some(wait => wait.roaster === entry.roaster);
    return { roaster: entry.roaster, state: 'waiting', text: stillWaiting && entry.next_try ? `Waiting, next try ${timeOf(entry.next_try)}` : 'Waiting' };
  });
  const got = queue.filter(entry => entry.status === 'ok').length;
  const left = rows.filter(row => row.state === 'waiting').length;
  return {
    rows,
    summary: got === queue.length ? `All ${queue.length} roasters checked`
      : `Got ${got} of ${queue.length} roasters${left ? `, ${left} still queued` : ''}`,
  };
}

// The status mark on a list row; nothing for a run that finished cleanly.
export function rowMark(run, runs) {
  if (run.status === 'running') return { tone: 'busy', text: 'Refreshing' };
  if (run.legacy) return null;
  const plan = runPlan(run, runs);
  if (plan?.rows.some(row => row.state === 'waiting')) return { tone: 'waiting', text: 'Retrying' };
  if (plan?.rows.some(row => row.state === 'failed')) return { tone: 'waiting', text: 'Incomplete' };
  if (!plan && ['partial', 'failed', 'interrupted'].includes(run.status)) return { tone: 'waiting', text: 'Incomplete' };
  return null;
}
