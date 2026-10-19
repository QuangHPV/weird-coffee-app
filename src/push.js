// Bell button: turn phone notifications on or off. The subscription is saved in Neon, and the
// Mac sends a push after a refresh finds something (see notify.py).
const PUBLIC_KEY = 'BLVGIvMofzJ77lp075pS_CECunORrkdd3Jhq3-T8vRR7PKRD_SpEVcqrdy3JvrGjLcGgOAf9NRUwyrRr77a_LTM';

const toBytes = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), c => c.charCodeAt(0));
const toText = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function current() {
  const registration = await navigator.serviceWorker.ready;
  return { registration, subscription: await registration.pushManager.getSubscription() };
}

export async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  return !!(await current()).subscription;
}

export async function enablePush(client) {
  if (await Notification.requestPermission() !== 'granted') return false;
  const { registration, subscription } = await current();
  const sub = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(PUBLIC_KEY) });
  const { error } = await client.rpc('save_push_subscription', {
    sub_endpoint: sub.endpoint, sub_p256dh: toText(sub.getKey('p256dh')), sub_auth: toText(sub.getKey('auth')) });
  if (error) throw error;
  return true;
}

export async function disablePush(client) {
  const { subscription } = await current();
  if (!subscription) return;
  await client.rpc('remove_push_subscription', { sub_endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
