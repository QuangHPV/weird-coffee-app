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

// Steps for the planner timeline: each past try with how many roasters were done, then the planned retries.
export function timeline(runs, now = new Date()) {
  const state = queueState(runs);
  const chain = chainOf(runs).filter(run => run.queue?.length).reverse();
  const status = new Map();
  const steps = chain.map(run => {
    for (const entry of run.queue) status.set(entry.roaster, entry.status);
    return { when: run.started_at, text: `${[...status.values()].filter(value => value === 'ok').length} of ${state.total}`, state: 'past' };
  });
  steps.splice(0, Math.max(0, steps.length - 4));
  if (!state.outOfRetries) {
    const groups = new Map();
    for (const entry of state.waiting) groups.set(entry.next_try, (groups.get(entry.next_try) || 0) + 1);
    let left = state.waiting.length;
    for (const [when, count] of [...groups].slice(0, 2)) {
      steps.push({ when, text: `${state.total - left + count} of ${state.total}`, state: 'next' });
      left -= count;
    }
  }
  return steps;
}

// The planner card at the top of Activity.
export function plannerCard(runs, now = new Date()) {
  const current = runs.find(run => run.status === 'running');
  const state = queueState(runs);
  if (current) {
    const total = current.roasters_total || state.total;
    return { tone: 'busy', title: 'Refreshing now', detail: total ? `${current.roasters_done || 0} of ${total} roasters checked` : 'Starting', steps: [] };
  }
  if (state.waiting.length) {
    return { tone: 'waiting', title: `${state.done} of ${state.total} roasters done`, detail: state.outOfRetries ? 'The rest wait for the daily refresh' : '', steps: timeline(runs, now) };
  }
  const latest = runs[0];
  if (!latest) return { tone: 'done', title: 'No refreshes yet', detail: 'Coffee changes from your roasters appear here.', steps: [] };
  if (state.failed.length) return { tone: 'waiting', title: `${state.done} of ${state.total} roasters done`, detail: `${names(state.failed)} could not be read`, steps: [] };
  return { tone: 'done', title: 'All caught up', detail: `Last refresh ${timeOf(latest.finished_at || latest.started_at, now)}`, steps: [] };
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
