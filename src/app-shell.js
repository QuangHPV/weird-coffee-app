import { showToast } from './live-update.js';

// Older WebAPKs can retain standalone mode until Android updates their metadata.
// A deliberate tap provides fullscreen immediately, without reinstalling or data loss.
export function mountAppShell() {
  const button = document.getElementById('enter-fullscreen');
  if (!button) return;
  const modes = ['fullscreen', 'standalone', 'minimal-ui'].map(mode => [mode, matchMedia(`(display-mode: ${mode})`)]);
  const android = /Android/i.test(navigator.userAgent) || navigator.userAgentData?.platform === 'Android';
  function update() {
    const mode = modes.find(([, query]) => query.matches)?.[0] || 'browser';
    document.documentElement.dataset.displayMode = mode;
    button.hidden = !android || mode === 'browser' || mode === 'fullscreen' || !!document.fullscreenElement || !document.fullscreenEnabled;
  }
  button.onclick = async () => {
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); update(); }
    catch { const toast = showToast('Could not enter full screen.'); setTimeout(toast.close, 4000); }
  };
  for (const [, query] of modes) query.addEventListener?.('change', update);
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('visibilitychange', update);
  update();
}
