// Shared by the Mac page and the mobile app: a small toast, and a reload that waits until
// the person is not typing, so a new version never eats what they were writing.
const STYLE = `
.live-toast{position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:50;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 32px);padding:10px 12px 10px 16px;border-radius:12px;background:#30251e;color:#fffdfa;font:600 13px/1.35 system-ui,sans-serif;box-shadow:0 8px 28px #0000004d}
.live-toast button{flex:none;border:0;border-radius:8px;padding:6px 12px;background:#fffdfa;color:#30251e;font:inherit;cursor:pointer}
@media(min-width:700px){.live-toast{bottom:24px}}
@media(prefers-color-scheme:dark){.live-toast{background:#f1e8de;color:#211a15}.live-toast button{background:#211a15;color:#f1e8de}}`;

export function showToast(text, buttonLabel, onClick) {
  if (!document.getElementById('live-toast-style')) {
    const style = document.createElement('style');
    style.id = 'live-toast-style';
    style.textContent = STYLE;
    document.head.append(style);
  }
  const toast = document.createElement('div');
  toast.className = 'live-toast';
  toast.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.textContent = text;
  toast.append(label);
  if (buttonLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = buttonLabel;
    button.onclick = onClick;
    toast.append(button);
  }
  document.body.append(toast);
  return { set: value => { label.textContent = value; }, close: () => toast.remove() };
}

export const typing = () => !!document.activeElement?.closest?.('input:not([type=checkbox]):not([type=range]), textarea, [contenteditable]');

// Tell the person a new version is ready, then reload after 2 s, unless they are busy.
let waiting = false;
export function reloadWhenIdle({ busy = typing, beforeReload = () => {} } = {}) {
  if (waiting) return;
  waiting = true;
  const reload = () => { beforeReload(); location.reload(); };
  const toast = showToast('New version ready', 'Reload now', reload);
  const check = () => {
    if (busy()) { toast.set('New version ready. Reloads when you stop typing.'); setTimeout(check, 1000); return; }
    toast.set('New version ready. Reloading…');
    setTimeout(() => (busy() ? check() : reload()), 2000);
  };
  check();
}

// Remember where you were across a reload (tab-session only).
export function saveSpot(key, extra = {}) {
  try { sessionStorage.setItem(key, JSON.stringify({ ...extra, scroll: window.scrollY })); } catch {}
}
export function takeSpot(key) {
  try {
    const spot = JSON.parse(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    return spot;
  } catch { return null; }
}
