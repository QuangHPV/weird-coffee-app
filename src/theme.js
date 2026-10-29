// Theme choice: 'system' follows the phone, 'light' and 'dark' override it.
// Every dark rule in the CSS sits in @media (prefers-color-scheme: dark), so the choice
// rewrites those media conditions instead of duplicating the styles.
const KEY = 'anotherCupTheme';
const DARK = '(prefers-color-scheme: dark)';
const originals = new WeakMap();

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

function walk(rules, mode) {
  for (const rule of rules) {
    if (rule instanceof CSSMediaRule) {
      if (!originals.has(rule) && rule.media.mediaText.includes(DARK)) originals.set(rule, rule.media.mediaText);
      const original = originals.get(rule);
      if (original) {
        rule.media.mediaText = mode === 'system' ? original
          : original.replace(DARK, mode === 'dark' ? '(min-width: 0px)' : '(min-width: 100000px)');
      }
    }
    if (rule.cssRules) walk(rule.cssRules, mode);
  }
}

export function applyTheme(mode = getTheme()) {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode === 'system' ? '' : mode;
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules, mode); } catch { /* cross-origin sheet */ }
  }
  for (const meta of document.querySelectorAll('meta[name=theme-color]')) {
    if (!meta.dataset.media) meta.dataset.media = meta.getAttribute('media') || '';
    const dark = meta.dataset.media.includes('dark');
    meta.setAttribute('media', mode === 'system' ? meta.dataset.media : (mode === 'dark') === dark ? 'all' : 'not all');
  }
}

export function setTheme(mode) {
  try { localStorage.setItem(KEY, mode); } catch {}
  applyTheme(mode);
}

// Styles added later (such as the toast) follow the choice too.
export function startTheme() {
  applyTheme();
  new MutationObserver(() => { if (getTheme() !== 'system') applyTheme(); }).observe(document.head, { childList: true });
}
