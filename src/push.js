// Permission is requested once per installation, from a deliberate tap.
const PUBLIC_KEY = 'BLVGIvMofzJ77lp075pS_CECunORrkdd3Jhq3-T8vRR7PKRD_SpEVcqrdy3JvrGjLcGgOAf9NRUwyrRr77a_LTM';
const ASKED = 'anotherCupNotificationsAsked';
const INSTALLED = 'anotherCupInstalled';
const OFF = 'anotherCupNotificationsOff';
const toBytes = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), c => c.charCodeAt(0));
const toText = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const stored = key => { try { return localStorage.getItem(key) === 'true'; } catch { return false; } };
const remember = key => { try { localStorage.setItem(key, 'true'); } catch {} };
const forget = key => { try { localStorage.removeItem(key); } catch {} };
const bounded = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Notification setup timed out')), 8000); })]); }
  finally { clearTimeout(timer); }
};

export function mountPushPrompt({ client, panel, enable, dismiss, message, enabled = true }) {
  let profile = null, busy = false, generation = 0, saved = '', asked = stored(ASKED), off = stored(OFF);
  let installed = stored(INSTALLED) || ['standalone', 'fullscreen', 'minimal-ui'].some(mode => matchMedia(`(display-mode: ${mode})`).matches) || navigator.standalone === true;
  const eligible = () => enabled && client && profile?.setup_complete && (profile.role === 'admin' || profile.tour_complete) && pushSupported();
  async function sync() {
    if (!eligible() || off || Notification.permission !== 'granted' || !navigator.onLine || busy) return;
    const run = generation, owner = profile.user_id;
    busy = true;
    try {
      const registration = await bounded(navigator.serviceWorker.ready);
      let sub = await bounded(registration.pushManager.getSubscription());
      if (run !== generation) return;
      sub ||= await bounded(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(PUBLIC_KEY) }));
      if (run !== generation || Notification.permission !== 'granted') return;
      const signature = `${owner}|${sub.endpoint}`;
      if (saved === signature) return;
      const result = await bounded(client.rpc('save_push_subscription', {
        sub_endpoint: sub.endpoint, sub_p256dh: toText(sub.getKey('p256dh')), sub_auth: toText(sub.getKey('auth'))
      }));
      if (result.error) throw result.error;
      if (run === generation) saved = signature;
    } finally { busy = false; }
  }
  function update(next = profile) {
    profile = next;
    panel.hidden = !eligible() || !installed || asked || Notification.permission !== 'default';
    if (eligible() && Notification.permission === 'granted') sync().catch(() => {
      // Permission stays granted. Retry registration on the next successful load/resume.
      console.warn('[notifications] Subscription sync failed; will retry.');
    });
  }
  enable.onclick = async () => {
    if (!eligible() || busy) return;
    asked = true; remember(ASKED);
    enable.disabled = true;
    message.textContent = '';
    try {
      // Keep this call before any await: browsers require an active user gesture.
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission === 'granted') await sync();
      panel.hidden = true;
    } catch {
      message.textContent = 'Could not set up notifications. Try again.';
      enable.textContent = 'Retry';
    } finally { enable.disabled = false; }
  };
  dismiss.onclick = () => { asked = true; remember(ASKED); panel.hidden = true; };
  window.addEventListener('appinstalled', () => { installed = true; remember(INSTALLED); update(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  navigator.permissions?.query({ name: 'notifications' }).then(permission => {
    permission.addEventListener('change', () => update());
  }).catch(() => {});
  return {
    update,
    supported: pushSupported,
    // The Notifications settings toggle: on means allowed, not switched off here, and subscribed.
    async isOn() {
      if (!eligible() || off || Notification.permission !== 'granted') return false;
      const registration = await bounded(navigator.serviceWorker.ready);
      return Boolean(await bounded(registration.pushManager.getSubscription()));
    },
    async turnOn() {
      // Keep the permission request before any await: browsers require an active user gesture.
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      off = false; forget(OFF);
      if (permission === 'granted') await sync();
    },
    async turnOff() {
      off = true; remember(OFF);
      await this.detach();
    },
    reset() { generation++; profile = null; saved = ''; panel.hidden = true; },
    async detach() {
      if (!eligible() || Notification.permission !== 'granted') return;
      const registration = await bounded(navigator.serviceWorker.ready);
      const sub = await bounded(registration.pushManager.getSubscription());
      if (!sub) return;
      try { await bounded(client.rpc('remove_push_subscription', { sub_endpoint: sub.endpoint })); }
      finally { await sub.unsubscribe(); saved = ''; }
    }
  };
}
