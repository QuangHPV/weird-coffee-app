import { reloadWhenIdle } from './live-update.js';

const mark = name => { performance.clearMarks(name); performance.mark(name); };

const workerStatus = worker => new Promise(resolve => {
  if (!worker) return resolve(null);
  const channel = new MessageChannel();
  const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 1500);
  channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
  try { worker.postMessage({ type: 'RELEASE_STATUS' }, [channel.port2]); }
  catch { clearTimeout(timer); channel.port1.close(); resolve(null); }
});

export function startReleaseUpdates({ release, busy, beforeReload, onDataChanged }) {
  if (!release || !navigator.serviceWorker?.register) return () => {};
  let checking = false, offered = false, lastCheck = 0, target = null, reloadOffer = null;
  const identify = () => navigator.serviceWorker.controller?.postMessage({ type: 'CLIENT_RELEASE', release });
  let registrationPromise;
  function registered() {
    if (!registrationPromise) registrationPromise = navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(value => {
      value.addEventListener('updatefound', () => {
        const worker = value.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed') check(true); });
      });
      identify();
      return value;
    }).catch(() => { registrationPromise = null; return null; });
    return registrationPromise;
  }
  async function offer(worker, id) {
    if (id === release) return;
    const status = await workerStatus(worker);
    if (!status?.ready || status.id !== id) return;
    target = id;
    if (offered) { reloadOffer?.retry(); return; }
    offered = true;
    mark('app:release-ready');
    reloadOffer = reloadWhenIdle({ busy, beforeReload, delayMs: 0, async reload() {
      const id = target;
      const reg = await registered();
      const active = await workerStatus(navigator.serviceWorker.controller);
      if (active?.id !== id) {
        const next = reg?.waiting;
        if ((await workerStatus(next))?.id !== id) throw new Error('Release changed; retry after it finishes downloading.');
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', controlled); reject(new Error('Update is still preparing. Try again.')); }, 15000);
          const controlled = async () => {
            if ((await workerStatus(navigator.serviceWorker.controller))?.id !== id) return;
            clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', controlled); resolve();
          };
          navigator.serviceWorker.addEventListener('controllerchange', controlled);
          next.postMessage({ type: 'ACTIVATE_RELEASE', release: id });
        });
      }
      mark('app:release-applied');
      location.reload();
    } });
  }
  async function check(force = false) {
    if (checking || document.hidden || !navigator.onLine || !force && Date.now() - lastCheck < 5000) return;
    checking = true; lastCheck = Date.now();
    try {
      const reg = await registered();
      if (!reg) return;
      // A failed first install can leave a detached registration object.
      if (!reg.active && !reg.installing && !reg.waiting) { registrationPromise = null; await registered(); return; }
      const response = await fetch(new URL('./release.json', document.baseURI), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const latest = await response.json();
      if (typeof latest.id !== 'string') return;
      if (latest.id === release) {
        // A fresh page may already run this release under an older controller.
        if (reg.waiting && (await workerStatus(reg.waiting))?.id === release) reg.waiting.postMessage({ type: 'ACTIVATE_RELEASE', release });
        return;
      }
      mark('app:release-detected');
      await reg.update();
      await offer(reg.waiting || reg.active, latest.id);
    } catch { /* Keep the current complete release during a network/deploy failure. */ }
    finally { checking = false; }
  }
  // Resolve relative to the document, including a GitHub Pages project subpath.
  const message = event => {
    if (event.data?.type === 'DATA_CHANGED') onDataChanged();
    if (event.data?.type === 'RELEASE_READY' || event.data?.type === 'RELEASE_ACTIVE') check(true);
  };
  const resume = () => { if (!document.hidden) check(true); };
  navigator.serviceWorker.addEventListener('controllerchange', identify);
  navigator.serviceWorker.addEventListener('message', message);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  const timer = setInterval(check, 10000);
  check(true);
  return () => { clearInterval(timer); navigator.serviceWorker.removeEventListener('controllerchange', identify); navigator.serviceWorker.removeEventListener('message', message); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); };
}
