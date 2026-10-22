import { createClient } from '@neondatabase/neon-js';
import { BetterAuthVanillaAdapter } from '@neondatabase/neon-js/auth/vanilla/adapters';
import { LoadError, SessionEnded, readResult } from './data-loader.js';

const forceFetch = { fetchOptions: { headers: { 'X-Force-Fetch': 'true' }, timeout: 12000 } };

// Keep the SDK's cookie/session handling, but pin one verified JWT to each read
// bundle. A session refresh alone can return the same cached data token.
export function createAccountClient(authUrl, dataApiUrl) {
  const auth = createClient({ auth: { url: authUrl,
    adapter: BetterAuthVanillaAdapter({ fetchOptions: { timeout: 12000 } }) },
    dataApi: { url: dataApiUrl } }).auth;
  let identity = null, token = null, generation = 0, pending = null;
  function usable(value, userId = identity) {
    try {
      const claims = JSON.parse(atob(value.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
      return claims.sub === userId && claims.exp * 1000 > Date.now() + 30000;
    } catch { return false; }
  }
  function clear() { generation++; identity = token = pending = null; }
  async function getToken(force = false) {
    if (!identity) throw new SessionEnded();
    if (!force && usable(token)) return token;
    if (pending) return pending;
    const before = generation, person = identity;
    const request = (async () => {
      const data = readResult('data token', await auth.token(forceFetch));
      if (generation !== before || identity !== person) throw new SessionEnded();
      if (!usable(data?.token, person)) throw new LoadError('data token', { code: 'DATA_NOT_READY' });
      token = data.token;
      return token;
    })();
    pending = request;
    try { return await request; }
    finally { if (pending === request) pending = null; }
  }
  const dataClient = createClient({ dataApi: { url: dataApiUrl, getToken: () => getToken(),
    options: { global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) } } } });
  return Object.assign(dataClient, {
    auth, clear,
    async accountSession() {
      const before = generation;
      const data = readResult('session', await auth.getSession(forceFetch));
      if (before !== generation) throw new SessionEnded();
      if (!data?.session || !data.user?.id) { clear(); throw new SessionEnded(); }
      if (identity !== data.user.id) { clear(); identity = data.user.id; }
      if (!usable(token) && usable(data.session.token)) token = data.session.token;
      await getToken();
      return identity;
    },
    async refreshSession() { await this.accountSession(); await getToken(true); },
    async forAccount(userId) {
      const value = await getToken();
      if (identity !== userId) throw new SessionEnded();
      return createClient({ dataApi: { url: dataApiUrl, getToken: () => value,
        options: { global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) } } } });
    }
  });
}
