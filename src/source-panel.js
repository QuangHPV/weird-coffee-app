// The source health panel used by both Activity views: a status banner and one row per roaster.
import { sourceHealth, healthSummary, ageText, timeOf } from './activity-model.js';

const ORDER = { suggested: 0, paused: 1, old: 2, ok: 3 };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function stateText(source) {
  if (source.state === 'suggested') return 'Scan suggested now';
  if (source.state === 'paused') return `Paused, try after ${timeOf(source.next_try)}`;
  if (source.state === 'old') return 'Not updated in a day';
  return 'Up to date';
}

// onScan is given only where scanning is possible (the Mac); the phone just shows the state.
// onScan(null, names) scans the out of date roasters, onScan(names, names) the ticked ones. `selected` and `seen` are kept by the caller.
export function renderSourcePanel(box, sources, { now = Date.now(), onScan = null, scanning = false, selected = new Set(), seen = new Map(), note = '', onAlt = null, scanOff = false } = {}) {
  const list = sourceHealth(sources, now);
  for (const name of selected) if (!list.some(source => source.roaster === name)) selected.delete(name);
  box.hidden = !list.length;
  if (!list.length) return list;
  // Roasters ready to scan get ticked when their time comes, and unticked when a failure sets a new time.
  for (const source of list) {
    const key = `${source.state}|${source.next_try}`;
    if (seen.get(source.roaster) === key) continue;
    seen.set(source.roaster, key);
    if (source.state === 'suggested') selected.add(source.roaster);
    else if (source.state === 'paused') selected.delete(source.roaster);
  }
  const early = list.filter(source => selected.has(source.roaster) && source.state === 'paused');
  const summary = healthSummary(list);
  box.dataset.tone = summary.tone;
  // Red when nothing is up to date, green when everything is, with every shade between.
  const share = list.filter(source => source.upToDate && !source.locked).length / list.length;
  box.style.setProperty('--health', `hsl(${Math.round(share * 125)} 55% 42%)`);

  const head = el('div', 'src-head');
  const text = el('div', 'src-title');
  text.append(el('span', 'src-pulse'), el('strong', '', summary.title));
  if (summary.detail) text.append(el('span', 'src-detail', summary.detail));
  const actions = el('div', 'src-actions');
  head.append(text, actions);
  if (onScan && summary.toScan.length) {
    const button = el('button', `src-scan${summary.suggested.length ? ' suggested' : ''}`, `Scan ${summary.toScan.length} ${summary.toScan.length === 1 ? 'roaster' : 'roasters'}`);
    button.type = 'button';
    button.disabled = scanning || scanOff;
    button.onclick = () => onScan(null, summary.toScan.map(source => source.roaster));
    actions.append(button);
  }
  if (onAlt && (selected.size || summary.toScan.length)) {
    const names = selected.size ? [...selected] : summary.toScan.map(source => source.roaster);
    const button = el('button', 'src-scan alt', 'Scan with Playwright');
    button.type = 'button';
    button.disabled = scanning;
    button.onclick = () => onAlt(selected.size ? names : null);
    actions.append(button);
  }
  if (onScan && selected.size) {
    const button = el('button', `src-scan${early.length ? ' early' : ''}`, `Scan selected (${selected.size})`);
    button.type = 'button';
    button.disabled = scanning || scanOff;
    button.onclick = () => onScan([...selected], [...selected]);
    actions.append(button);
  }

  const rows = el('ul', 'src-list');
  for (const source of [...list].sort((a, b) => ORDER[a.state] - ORDER[b.state] || (b.age ?? Infinity) - (a.age ?? Infinity))) {
    const row = el('li', `src-row ${source.state}${source.upToDate ? '' : ' stale'}`);
    const strip = el('span', 'src-strip');
    strip.setAttribute('aria-hidden', 'true');
    for (const result of source.history.slice(-14)) strip.append(el('i', result));
    const meta = el('span', 'src-meta');
    meta.append(el('span', 'src-age', source.age == null ? 'Never read' : `Read ${ageText(source.age)} ago`), el('span', 'src-state', stateText(source)));
    if (onScan) {
      const pick = el('input', 'src-pick');
      pick.type = 'checkbox';
      pick.checked = selected.has(source.roaster);
      pick.disabled = scanning;
      pick.tabIndex = -1;
      row.classList.add('pickable');
      if (pick.checked) row.classList.add('picked');
      row.title = 'Click to select';
      row.onclick = () => {
        if (scanning) return;
        if (selected.has(source.roaster)) selected.delete(source.roaster); else selected.add(source.roaster);
        renderSourcePanel(box, sources, { now, onScan, onAlt, scanOff, scanning, selected, seen, note });
      };
      row.append(pick);
    }
    row.append(el('span', 'src-dot'), el('span', 'src-name', source.roaster), strip, meta);
    rows.append(row);
  }
  const warn = early.length ? el('p', 'src-warn', `Too early for ${early.map(source => source.roaster).join(', ')}. Scanning now may get throttled again.`) : null;
  const status = note ? el('p', 'src-note', note) : null;
  box.replaceChildren(...[head, warn, status, rows].filter(Boolean));
  return list;
}
