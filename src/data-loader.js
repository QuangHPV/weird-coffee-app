// Read recovery only. Mutations are never replayed by this controller.
export class LoadError extends Error {
  constructor(operation, result = {}) {
    const error = result.error || result;
    super(error.message || `Could not read ${operation}`);
    this.name = 'LoadError';
    this.operation = operation;
    this.code = error.code || '';
    this.status = result.status || error.status || 0;
  }
}

export class SessionEnded extends Error {}

export function readResult(operation, result) {
  if (result.error) throw new LoadError(operation, result);
  return result.data;
}

const authFailure = error => error.name === 'AuthRequiredError' || error.status === 401
  || ['PGRST301', 'PGRST302', 'PGRST303'].includes(error.code)
  || error.code === '42501' && /not authorized|jwt|authentication/i.test(error.message);
const transient = error => !error.status && !error.code
  || [408, 429, 500, 502, 503, 504].includes(error.status)
  || /^(08|53|57P)/.test(error.code) || error.code === 'DATA_NOT_READY';
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
});

export function createDataLoader({ read, apply, refreshSession, state = () => {},
  online = () => navigator.onLine, diagnose = entry => console.warn('[account load]', entry),
  timeoutMs = 12000, delays = [800, 2000], wait = sleep }) {
  let active = null;
  let generation = 0;
  async function timed(task, parent) {
    const request = new AbortController();
    const abort = () => request.abort(parent.reason);
    parent.addEventListener('abort', abort, { once: true });
    if (parent.aborted) abort();
    let timer;
    try {
      const deadline = new Promise((_, reject) => {
        if (request.signal.aborted) { reject(request.signal.reason); return; }
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        timer = setTimeout(() => request.abort(new LoadError('request timeout')), timeoutMs);
      });
      return await Promise.race([Promise.resolve().then(() => task(request.signal)), deadline]);
    } finally {
      clearTimeout(timer);
      parent.removeEventListener('abort', abort);
      request.abort();
    }
  }
  function reset() {
    generation++;
    active?.abort.abort();
    active = null;
  }
  function load({ quiet = false } = {}) {
    if (active) { active.quiet &&= quiet; return active.promise; }
    const run = { abort: new AbortController(), generation, quiet };
    active = run;
    // Start on the next microtask so even synchronous errors see the active run.
    run.promise = Promise.resolve().then(async () => {
      let refreshed = false;
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        if (run.generation !== generation) return false;
        if (!online()) { state({ status: 'offline', quiet: run.quiet }); return false; }
        state({ status: attempt ? 'retrying' : 'loading', quiet: run.quiet });
        try {
          // This also bounds token retrieval before the SDK starts the data fetch.
          const bundle = await timed(read, run.abort.signal);
          if (run.generation !== generation) return false;
          apply(bundle);
          state({ status: 'ready', quiet: run.quiet });
          return true;
        } catch (error) {
          if (run.generation !== generation || run.abort.signal.aborted) return false;
          if (error instanceof SessionEnded) { state({ status: 'signed-out' }); return false; }
          diagnose({ operation: error.operation || 'load', status: error.status || 0, code: error.code || '', attempt: attempt + 1 });
          let retry = transient(error) || authFailure(error) && refreshed;
          if (authFailure(error) && !refreshed) {
            refreshed = true;
            try { await timed(refreshSession, run.abort.signal); retry = true; }
            catch (sessionError) {
              if (run.generation !== generation) return false;
              if (sessionError instanceof SessionEnded) { state({ status: 'signed-out', expired: true }); return false; }
              retry = transient(sessionError);
            }
          }
          if (run.generation !== generation) return false;
          if (!retry || attempt === delays.length) {
            state({ status: online() ? 'error' : 'offline', quiet: run.quiet });
            return false;
          }
        }
        try { await wait(delays[attempt], run.abort.signal); }
        catch { return false; }
      }
    }).finally(() => { if (active === run) active = null; });
    return run.promise;
  }
  return { load, reset };
}
