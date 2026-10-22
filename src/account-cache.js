// Display-only account snapshots. Never persist JWTs, credentials or mutations.
export function createAccountCache(namespace) {
  const key = 'anotherCupAccount:' + namespace;
  let generation = 0;
  const database = new Promise(resolve => {
    try {
      const request = indexedDB.open('another-cup-read-cache', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('accounts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  async function operation(mode, task, expected = generation) {
    const db = await database;
    if (!db || expected !== generation) return null;
    return new Promise(resolve => {
      try {
        const transaction = db.transaction('accounts', mode);
        const request = task(transaction.objectStore('accounts'));
        transaction.oncomplete = () => resolve(request.result ?? null);
        transaction.onerror = transaction.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  const bounded = promise => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), 150))]);
  function identity() {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  return {
    identity,
    confirm(userId, expiresAt) {
      const old = identity();
      if (old && old.userId !== userId) this.invalidate();
      try { localStorage.setItem(key, JSON.stringify({ userId, expiresAt })); } catch {}
    },
    async read(userId) {
      const epoch = generation;
      const record = await bounded(operation('readonly', store => store.get(key), epoch));
      if (epoch !== generation || record?.schema !== 1 || record.userId !== userId || record.bundle?.profile?.user_id !== userId || Date.now() - record.savedAt > 7 * 86400000) return null;
      return record.bundle;
    },
    write(bundle) {
      const userId = bundle.profile.user_id;
      if (identity()?.userId !== userId) return;
      return operation('readwrite', store => store.put({ schema: 1, userId, savedAt: Date.now(), bundle }, key));
    },
    invalidate() { generation++; return operation('readwrite', store => store.delete(key)); },
    clear() { try { localStorage.removeItem(key); } catch {} return this.invalidate(); },
    isIdentityEvent(event) { return event.key === key; }
  };
}
