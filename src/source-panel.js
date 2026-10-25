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
export function renderSourcePanel(box, sources, { now = Date.now(), onScan = null, scanning = false } = {}) {
  const list = sourceHealth(sources, now);
  box.hidden = !list.length;
  if (!list.length) return list;
  const summary = healthSummary(list);
  box.dataset.tone = summary.tone;

  const head = el('div', 'src-head');
  const text = el('div', 'src-title');
  text.append(el('span', 'src-pulse'), el('strong', '', summary.title));
  if (summary.detail) text.append(el('span', 'src-detail', summary.detail));
  head.append(text);
  if (onScan && summary.toScan.length) {
    const button = el('button', `src-scan${summary.suggested.length ? ' suggested' : ''}`, `Scan ${summary.toScan.length} ${summary.toScan.length === 1 ? 'source' : 'sources'}`);
    button.type = 'button';
    button.disabled = scanning;
    button.onclick = onScan;
    head.append(button);
  }

  const rows = el('ul', 'src-list');
  for (const source of [...list].sort((a, b) => ORDER[a.state] - ORDER[b.state] || (b.age ?? Infinity) - (a.age ?? Infinity))) {
    const row = el('li', `src-row ${source.state}${source.upToDate ? '' : ' stale'}`);
    const strip = el('span', 'src-strip');
    strip.setAttribute('aria-hidden', 'true');
    for (const result of source.history.slice(-14)) strip.append(el('i', result));
    const meta = el('span', 'src-meta');
    meta.append(el('span', 'src-age', source.age == null ? 'Never read' : `Read ${ageText(source.age)} ago`), el('span', 'src-state', stateText(source)));
    row.append(el('span', 'src-dot'), el('span', 'src-name', source.roaster), strip, meta);
    rows.append(row);
  }
  box.replaceChildren(head, rows);
  return list;
}
