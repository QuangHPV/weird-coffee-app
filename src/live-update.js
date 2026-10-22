// Shared by the Mac page and the mobile app: a small toast, and a reload that waits until
// the person is not typing, so a new version never eats what they were writing.
const STYLE = `
.live-toast{position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom));transform:translateX(-50%);width:max-content;z-index:50;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 32px);padding:10px 12px 10px 16px;border-radius:12px;background:#30251e;color:#fffdfa;font:600 13px/1.35 system-ui,sans-serif;box-shadow:0 8px 28px #0000004d}
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

// "Typing" includes the moments the keyboard briefly takes focus away (for example the language menu),
// and an unsent draft in a text area.
const FIELD = 'input:not([type=checkbox]):not([type=range]), textarea, [contenteditable]';
let lastTyped = 0;
for (const type of ['focusin', 'input', 'keydown']) {
  document.addEventListener(type, event => { if (event.target.closest?.(FIELD)) lastTyped = Date.now(); }, true);
}
export const typing = () => !!document.activeElement?.closest?.(FIELD)
  || Date.now() - lastTyped < 20000
  || [...document.querySelectorAll('textarea')].some(box => box.value.trim());

// A complete release can reload immediately once editing and saves are idle.
let waiting = false;
export function reloadWhenIdle({ busy = typing, beforeReload = () => {}, reload = () => location.reload(), delayMs = 2000 } = {}) {
  if (waiting) return;
  waiting = true;
  let applying = false, timer;
  const apply = async () => {
    if (applying) return;
    applying = true;
    try { rememberDrafts(); await beforeReload(); await reload(); }
    catch { applying = false; toast.set('Update is still preparing. Tap to retry.'); }
  };
  const toast = showToast('New version ready', 'Reload now', apply);
  const check = () => {
    clearTimeout(timer);
    if (applying) return;
    if (busy()) { timer = setTimeout(check, 1000); return; }
    if (delayMs) timer = setTimeout(() => busy() ? check() : apply(), delayMs);
    else apply();
  };
  check();
  return { retry: check };
}

const DRAFTS = 'anotherCupReloadDrafts';
function rememberDrafts() {
  try {
    const drafts = [...document.querySelectorAll('textarea[id]')].map(box => ({ id: box.id, value: box.value, start: box.selectionStart, end: box.selectionEnd }));
    sessionStorage.setItem(DRAFTS, JSON.stringify({ userId: document.documentElement.dataset.accountUserId, drafts }));
  } catch {}
}
export function restoreDrafts(userId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DRAFTS));
    const drafts = saved?.userId === userId ? saved.drafts : [];
    for (const draft of drafts) {
      const box = document.getElementById(draft.id);
      if (box?.tagName !== 'TEXTAREA') continue;
      box.value = draft.value;
      box.setSelectionRange(draft.start, draft.end);
    }
    sessionStorage.removeItem(DRAFTS);
  } catch {}
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
