import { createClient } from '@neondatabase/neon-js';
import { mountBacklog } from './backlog-ui.js';
import './backlog-ui.css';
import { reloadWhenIdle, saveSpot, takeSpot } from './live-update.js';

const $ = id => document.getElementById(id);
const demoMode = import.meta.env.DEV && new URLSearchParams(location.search).has('demo');
const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL;
const client = authUrl && dataApiUrl ? createClient({
  auth: { url: authUrl },
  dataApi: { url: dataApiUrl }
}) : null;
let snapshot = null;
let ranking = null;
let saving = false;
let decisions = [];            // replacement choices made on a device, not yet applied by the Mac
let deciding = false;
let view = 'browse';
let demoBacklog = { document: { tasks: [
  { id: 'sample-1', text: 'Refine the Browse cards #mobile\nCheck spacing on a phone.', created: '2026-10-18T09:30:00.000Z', done_at: null },
  { id: 'sample-2', text: 'Add more roasters #catalog', created: '2026-10-17T02:10:00.000Z', done_at: null },
  { id: 'sample-3', text: 'Review spacing on a phone #mobile', created: '2026-10-16T08:00:00.000Z', done_at: '2026-10-17T06:45:00.000Z' }
] }, revision: 1 };
const backlog = mountBacklog($('backlog-root'), {
  async load() {
    if (demoMode) return structuredClone(demoBacklog);
    if (!client || !navigator.onLine) throw new Error('Connect to load the backlog.');
    const result = await client.from('backlog_state').select('document,revision');
    if (result.error) throw result.error;
    if (!result.data?.length) throw new Error('Backlog is not available for this account.');
    return result.data[0];
  },
  async save(document, revision) {
    if (demoMode) { demoBacklog = { document, revision: revision + 1 }; return structuredClone(demoBacklog); }
    const result = await client.rpc('save_backlog', { expected_revision: revision, next_document: document });
    if (result.error) {
      const error = new Error(result.error.message || 'Could not save the backlog.');
      error.conflict = result.error.code === '40001' || /another device/i.test(result.error.message || '');
      throw error;
    }
    return Array.isArray(result.data) ? result.data[0] : result.data;
  }
});
const ROAST_LEVELS = ['light', 'medium', 'dark'];
const ORIGIN_AREAS = [
  { name: 'Central America & Mexico', countries: ['Belize', 'Costa Rica', 'El Salvador', 'Guatemala', 'Honduras', 'Mexico', 'Nicaragua', 'Panama'] },
  { name: 'South America', countries: ['Argentina', 'Bolivia', 'Brazil', 'Colombia', 'Ecuador', 'Paraguay', 'Peru', 'Venezuela'] },
  { name: 'Africa', countries: ['Burundi', 'Cameroon', 'Congo', 'Democratic Republic of the Congo', 'Ethiopia', 'Kenya', 'Malawi', 'Rwanda', 'Tanzania', 'Uganda', 'Zambia', 'Zimbabwe'] },
  { name: 'Southeast Asia', countries: ['Cambodia', 'Indonesia', 'Laos', 'Malaysia', 'Myanmar', 'Philippines', 'Thailand', 'Timor-Leste', 'Vietnam'] },
  { name: 'South Asia', countries: ['India', 'Nepal', 'Sri Lanka'] },
  { name: 'Caribbean & Pacific', countries: ['Cuba', 'Dominican Republic', 'Haiti', 'Jamaica', 'Papua New Guinea', 'Puerto Rico'] }
];
const VIBE_QUADRANTS = [
  { key: 'clean-rich', label: 'Clean and rich', hint: 'cocoa, nuts, caramel' },
  { key: 'funky-rich', label: 'Funky and rich', hint: 'anaerobic, co-ferments' },
  { key: 'clean-bright', label: 'Clean and bright', hint: 'washed, tea-like' },
  { key: 'funky-bright', label: 'Funky and bright', hint: 'juicy, berries, florals' }
];
const SORT_OPTIONS = [
  { key: 'per100g', label: 'Price per 100g' },
  { key: 'funk', label: 'Clean → Funky' },
  { key: 'body', label: 'Bright → Rich' },
  { key: 'new', label: 'Newest' }
];
const defaultFilters = () => ({ search: '', vibeQuadrant: null, max: 60, inStock: true, stockBeforeArchive: true, showArchived: false, roastMin: 0, roastMax: 2, includeUnknown: true, roasters: {}, origins: {}, process: {}, sort: 'per100g' });
const cloneFilters = filters => ({ ...filters, roasters: { ...filters.roasters }, origins: { ...filters.origins }, process: { ...filters.process } });
let appliedFilters = defaultFilters();
let draftFilters = null;
let originGroups = [];
const demoSnapshot = {
  beans: [
    { id: 'demo/01', roaster: 'Northline Coffee', title: 'Ethiopia Sidama', price: 24, grams: 250, per100g: 9.6, available: true, url: 'https://example.com', first_seen: '2026-09-26', label: { origins: ['Ethiopia'], process: ['Washed'], roast: 'light', funk: 1, body: 1, notes: ['Floral', 'Citrus'] } },
    { id: 'demo/02', roaster: 'Daybreak Roasters', title: 'Colombia Huila', price: 27, grams: 250, per100g: 10.8, available: true, url: 'https://example.com', first_seen: '2026-09-25', label: { origins: ['Colombia'], process: ['Natural'], roast: 'medium', roast_range: ['light', 'medium'], funk: 4, funk_range: [3, 5], body: 2, notes: ['Berries', 'Cocoa'],
      why: { funk: { reason: 'Natural process with berry notes; no fermentation details.', quotes: ['Natural'] }, roast: { reason: 'No roast stated.', quotes: [] } } } },
    { id: 'demo/04', roaster: 'Northline Coffee', title: 'Brazil Cerrado Natural', price: 21, grams: 250, per100g: 8.4, available: true, url: 'https://example.com', first_seen: '2026-09-27', label: { origins: ['Brazil'], process: ['Natural'], roast: null, funk: null, funk_range: [1, 5], roast_range: ['light', 'dark'], body: 4, notes: [], why: { funk: { reason: 'No process or tasting notes on the page.', quotes: [] }, roast: { reason: 'No roast level, use or tasting notes are stated.', quotes: [] } } } },
    { id: 'demo/03', roaster: 'Northline Coffee', title: 'Brazil Cerrado', price: 21, grams: 250, per100g: 8.4, available: false, url: 'https://example.com', first_seen: '2026-09-20', label: { origins: ['Brazil'], process: ['Pulped natural'], roast: 'dark', funk: 1, body: 4, notes: ['Caramel', 'Nuts'] } }
  ],
  suggestions: [
    { old_id: 'demo/03', new_id: 'demo/04', confidence: 0.96, reason: 'Same farm and lot number; the new page only adds a process line.', changes: ['process added'], evidence: [] }
  ],
  runs: [
    { finished_at: '2026-09-26T10:00:00Z', source: 'daily', status: 'Completed', labeled_count: 2, events: [{ event: 'new', roaster: 'Northline Coffee', title: 'Ethiopia Sidama' }] },
    { finished_at: '2026-09-25T10:00:00Z', source: 'manual', status: 'Completed', labeled_count: 0, events: [] }
  ]
};

function node(tag, className, value) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined && value !== null) item.textContent = String(value);
  return item;
}

function safeLink(url, label) {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
    const link = node('a', '', label);
    link.href = parsed.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  } catch { return null; }
}

function date(value) {
  if (!value) return 'Unknown date';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function updateNetwork() {
  $('network').textContent = demoMode ? 'Preview' : navigator.onLine ? 'Online' : 'Offline';
  $('network').classList.toggle('error', !demoMode && !navigator.onLine);
  renderBrowse();
  renderWishlist();
}
window.addEventListener('online', () => { updateNetwork(); loadData(); });
window.addEventListener('offline', updateNetwork);

function showSignedOut() {
  snapshot = null;
  ranking = null;
  $('auth').hidden = false;
  $('app').hidden = true;
  $('navigation').hidden = true;
  $('signout').hidden = true;
  $('auth-form').hidden = false;
  $('auth-retry').hidden = true;
}

function showSignedIn() {
  $('auth').hidden = true;
  $('app').hidden = false;
  $('navigation').hidden = false;
  $('signout').hidden = demoMode;
}

// `quiet` is the background check: it redraws only when the published data or the Wish list changed.
let loadedSignature = '';
async function loadData({ quiet = false } = {}) {
  if (demoMode) {
    snapshot = demoSnapshot;
    ranking ||= { ids: ['demo/02', 'demo/03', 'demo/01'], revision: 1 };
    $('published').textContent = 'Sample data';
    buildFilters();
    render();
    notice('');
    if (view === 'backlog') backlog.refresh();
    return;
  }
  if (!client || !navigator.onLine) {
    notice(navigator.onLine ? 'Set the public Neon Auth and Data API URLs before publishing this app.' : 'Connect to load your beans and Wish list.');
    return;
  }
  try {
    const [snapResult, wishResult] = await Promise.all([
      client.from('app_snapshot').select('payload,published_at').eq('id', 1),
      client.from('wishlist_state').select('ids,revision,updated_at')
    ]);
    if (snapResult.error) throw snapResult.error;
    if (wishResult.error) throw wishResult.error;
    if (!snapResult.data?.length || !wishResult.data?.length) {
      notice('No coffee data is available for this account. If this is your account, setup may not be complete yet.');
      return;
    }
    const signature = `${snapResult.data[0].published_at}|${wishResult.data[0].revision}`;
    if (quiet && signature === loadedSignature) { if (view === 'backlog') backlog.refresh(); return; }
    loadedSignature = signature;
    const decided = await client.from('replacement_decisions').select('old_id,new_id');
    decisions = decided.error ? [] : decided.data;   // the table may not exist yet
    snapshot = snapResult.data[0].payload;
    ranking = wishResult.data[0];
    if (!Array.isArray(snapshot.beans) || !Array.isArray(snapshot.runs) || !Array.isArray(ranking.ids)) throw new Error('Invalid data');
    $('published').textContent = `Updated ${date(snapResult.data[0].published_at)}`;
    buildFilters();
    render();
    notice('');
    if (view === 'backlog') backlog.refresh();
  } catch {
    if (!quiet) notice('Could not load the latest data. Reconnect and reopen the app to try again.');
  }
}

function buildFilters() {
  const vibe = $('filter-vibe');
  vibe.replaceChildren(...VIBE_QUADRANTS.map(({ key, label, hint }) => {
    const button = node('button', 'vibe-cell');
    button.type = 'button';
    button.dataset.quadrant = key;
    button.setAttribute('aria-label', `${label}: ${hint}`);
    button.append(node('span', '', hint));
    button.onclick = () => { draftFilters.vibeQuadrant = draftFilters.vibeQuadrant === key ? null : key; renderFilterPanel(); };
    return button;
  }));

  const processValues = new Set(snapshot.beans.flatMap(bean => values(bean, 'process')));
  $('filter-process').replaceChildren(...[...processValues].sort().map(value => {
    const button = node('button', 'filter-chip');
    button.type = 'button';
    button.dataset.processValue = value;
    button.onclick = () => {
      const current = draftFilters.process[value];
      if (!current) draftFilters.process[value] = 'yes';
      else if (current === 'yes') draftFilters.process[value] = 'no';
      else delete draftFilters.process[value];
      renderFilterPanel();
    };
    return button;
  }));

  const roasters = new Set(snapshot.beans.map(bean => bean.roaster));
  $('filter-roasters').replaceChildren(...[...roasters].sort().map(value => checkboxOption('roasters', value)));

  const available = new Set(snapshot.beans.flatMap(bean => values(bean, 'origins')));
  available.delete('unknown');
  const groups = ORIGIN_AREAS.map(area => ({ name: area.name, countries: area.countries.filter(country => available.delete(country)) }))
    .filter(area => area.countries.length);
  if (available.size) groups.push({ name: 'Other origins', countries: [...available].sort() });
  originGroups = [];
  const origins = $('filter-origins');
  origins.replaceChildren();
  groups.forEach(({ name, countries }, index) => {
    const group = node('section', 'origin-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', name);
    const head = node('div', 'origin-group-head');
    const input = node('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', `All countries in ${name}`);
    input.onchange = () => {
      countries.forEach(country => {
        if (input.checked) draftFilters.origins[country] = true;
        else delete draftFilters.origins[country];
      });
      renderFilterPanel();
    };
    const children = node('div', 'origin-children');
    children.id = `filter-origin-area-${index}`;
    children.hidden = true;
    children.setAttribute('role', 'group');
    children.setAttribute('aria-label', `${name} countries`);
    countries.sort().forEach(country => children.append(checkboxOption('origins', country)));
    const toggle = node('button', 'origin-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', children.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(node('span', 'origin-chevron', '›'), node('span', '', name), node('span', 'filter-count'));
    toggle.onclick = () => {
      children.hidden = !children.hidden;
      toggle.setAttribute('aria-expanded', String(!children.hidden));
    };
    head.append(input, toggle);
    group.append(head, children);
    origins.append(group);
    originGroups.push({ countries, head, input });
  });
  if (snapshot.beans.some(bean => values(bean, 'origins').includes('unknown'))) {
    const option = checkboxOption('origins', 'unknown', 'Origin not stated');
    option.classList.add('origin-unstated');
    origins.append(option);
  }

  $('filter-sort').replaceChildren(...SORT_OPTIONS.map(({ key, label }) => {
    const button = node('button', 'sort-option', label);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.sort = key;
    button.onclick = () => { draftFilters.sort = key; renderFilterPanel(); };
    button.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const next = SORT_OPTIONS[(SORT_OPTIONS.findIndex(option => option.key === key) + direction + SORT_OPTIONS.length) % SORT_OPTIONS.length];
      draftFilters.sort = next.key;
      renderFilterPanel();
      $('filter-sort').querySelector(`[data-sort="${next.key}"]`).focus();
    };
    return button;
  }));
  renderFilterPanel();
}

function values(bean, field) {
  if (field === 'roasters') return [bean.roaster];
  const value = bean.label?.[field];
  if (Array.isArray(value)) return value.length ? value : ['unknown'];
  return [value || 'unknown'];
}

function vibeQuadrantFor(label) {
  if (!Number.isInteger(label?.funk) || !Number.isInteger(label?.body)
      || label.funk < 1 || label.funk > 5 || label.body < 1 || label.body > 5) return null;
  return `${label.funk >= 3 ? 'funky' : 'clean'}-${label.body >= 3 ? 'rich' : 'bright'}`;
}

// A lot whose funk is not stated can still be placed on the bright or rich side. With "Include lots not stated"
// on, it matches either clean or funky as long as its bright or rich side fits.
function fitsQuadrant(label, filters) {
  if (label && label.funk === null && Number.isInteger(label.body) && label.body >= 1 && label.body <= 5) {
    return filters.includeUnknown && filters.vibeQuadrant.endsWith(label.body >= 3 ? '-rich' : '-bright');
  }
  return vibeQuadrantFor(label) === filters.vibeQuadrant;
}

function matches(bean, filters, skipField = null) {
  if (Boolean(bean.archived) !== filters.showArchived) return false;
  if (filters.inStock && (!bean.available || bean.gone)) return false;
  if (bean.per100g && filters.max < 60 && bean.per100g > filters.max) return false;
  if (filters.vibeQuadrant && !fitsQuadrant(bean.label, filters)) return false;
  if (filters.roastMin > 0 || filters.roastMax < ROAST_LEVELS.length - 1) {
    if (bean.label?.roast === null) { if (!filters.includeUnknown) return false; }
    else {
      const roast = ROAST_LEVELS.indexOf((bean.label?.roast || '').toLowerCase());
      if (roast < filters.roastMin || roast > filters.roastMax) return false;
    }
  }
  const search = filters.search.trim().toLowerCase();
  if (search && ![bean.title, bean.roaster, ...values(bean, 'origins'), ...values(bean, 'process'), ...(bean.label?.notes || [])]
    .join(' ').toLowerCase().includes(search)) return false;
  for (const field of ['roasters', 'origins', 'process']) {
    if (field === skipField) continue;
    const beanValues = values(bean, field);
    if (field !== 'process') {
      const selected = Object.keys(filters[field]);
      if (selected.length && !selected.some(value => beanValues.includes(value))) return false;
    } else {
      for (const [value, mode] of Object.entries(filters.process)) {
        if (mode === 'yes' && !beanValues.includes(value)) return false;
        if (mode === 'no' && beanValues.includes(value)) return false;
      }
    }
  }
  return true;
}

function checkboxOption(field, value, displayName = value) {
  const label = node('label', 'filter-option');
  label.dataset.filterField = field;
  label.dataset.value = value;
  const input = node('input');
  input.type = 'checkbox';
  input.onchange = () => {
    if (input.checked) draftFilters[field][value] = true;
    else delete draftFilters[field][value];
    renderFilterPanel();
  };
  label.append(input, node('span', '', displayName), node('span', 'filter-count'));
  return label;
}

function renderFilterPanel() {
  if (!draftFilters || !snapshot) return;
  if ($('filter-search').value !== draftFilters.search) $('filter-search').value = draftFilters.search;
  $('filter-price').value = draftFilters.max;
  $('filter-price-label').textContent = draftFilters.max >= 60 ? 'any' : `≤ $${draftFilters.max}`;
  $('filter-price').setAttribute('aria-valuetext', draftFilters.max >= 60 ? 'Any price' : `Up to $${draftFilters.max} per 100 grams`);
  $('filter-unknown').checked = draftFilters.includeUnknown;
  $('filter-stock').checked = draftFilters.inStock;
  $('filter-stock').disabled = draftFilters.showArchived;
  $('filter-archived').checked = draftFilters.showArchived;
  $('filter-roast-min').value = draftFilters.roastMin;
  $('filter-roast-max').value = draftFilters.roastMax;
  $('filter-roast-min').setAttribute('aria-valuetext', ROAST_LEVELS[draftFilters.roastMin]);
  $('filter-roast-max').setAttribute('aria-valuetext', ROAST_LEVELS[draftFilters.roastMax]);
  $('filter-roast').classList.toggle('collapsed', draftFilters.roastMin === draftFilters.roastMax);
  $('filter-roast-fill').style.left = `${draftFilters.roastMin * 50}%`;
  $('filter-roast-fill').style.width = `${(draftFilters.roastMax - draftFilters.roastMin) * 50}%`;
  const name = value => value[0].toUpperCase() + value.slice(1);
  $('filter-roast-selection').textContent = draftFilters.roastMin === 0 && draftFilters.roastMax === 2 ? 'All roast levels'
    : draftFilters.roastMin === draftFilters.roastMax ? name(ROAST_LEVELS[draftFilters.roastMin])
      : `${name(ROAST_LEVELS[draftFilters.roastMin])} to ${name(ROAST_LEVELS[draftFilters.roastMax])}`;

  document.querySelectorAll('.vibe-cell').forEach(button => {
    const selected = draftFilters.vibeQuadrant === button.dataset.quadrant;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  for (const field of ['roasters', 'origins']) {
    const eligible = snapshot.beans.filter(bean => matches(bean, draftFilters, field));
    document.querySelectorAll(`[data-filter-field="${field}"]`).forEach(label => {
      const value = label.dataset.value;
      const selected = Boolean(draftFilters[field][value]);
      const count = eligible.filter(bean => values(bean, field).includes(value)).length;
      const input = label.querySelector('input');
      input.checked = selected;
      input.disabled = count === 0 && !selected;
      label.classList.toggle('zero', input.disabled);
      label.querySelector('.filter-count').textContent = count;
    });
    if (field === 'origins') originGroups.forEach(({ countries, head, input }) => {
      const selected = countries.filter(country => draftFilters.origins[country]).length;
      const count = eligible.filter(bean => countries.some(country => values(bean, 'origins').includes(country))).length;
      input.checked = selected === countries.length;
      input.indeterminate = selected > 0 && selected < countries.length;
      input.disabled = count === 0 && selected === 0;
      head.classList.toggle('zero', input.disabled);
      head.querySelector('.filter-count').textContent = count;
    });
  }
  const eligibleProcess = snapshot.beans.filter(bean => matches(bean, draftFilters, 'process'));
  document.querySelectorAll('[data-process-value]').forEach(button => {
    const value = button.dataset.processValue;
    const mode = draftFilters.process[value] || '';
    const count = eligibleProcess.filter(bean => values(bean, 'process').includes(value)).length;
    button.className = `filter-chip ${mode}`;
    button.textContent = `${value === 'unknown' ? 'Not stated' : value} ${count}`;
    button.disabled = count === 0 && !mode;
    button.setAttribute('aria-label', `${value === 'unknown' ? 'Process not stated' : value}: ${mode === 'yes' ? 'required' : mode === 'no' ? 'excluded' : 'any'}`);
  });
  document.querySelectorAll('[data-sort]').forEach(button => {
    const selected = button.dataset.sort === draftFilters.sort;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  const count = snapshot.beans.filter(bean => matches(bean, draftFilters)).length;
  $('filter-results').textContent = `${count} ${count === 1 ? 'bean' : 'beans'}`;
}

// Best guess (solid dot) inside its range (shaded dots). Tap the row to read the reason and page quotes.
function tasteMeter(left, right, size, point, range, why, title, names) {
  if (point === null) {
    // No evidence on the page: no dots at all, so it is not mistaken for a wide range.
    const wrap = node('div', 'taste-meter');
    const row = node(why?.reason ? 'button' : 'div', 'taste-row');
    const pill = node('span', 'unknown-pill', 'not stated');
    pill.setAttribute('aria-label', `${title}: not stated`);
    row.append(node('span', '', left), pill, node('span', '', right));
    wrap.append(row);
    if (!why?.reason) return wrap;
    row.type = 'button';
    row.setAttribute('aria-expanded', 'false');
    const pop = node('div', 'taste-why');
    pop.hidden = true;
    pop.append(node('b', '', `${title}: not stated`), node('span', '', why.reason));
    row.onclick = () => { pop.hidden = !pop.hidden; row.setAttribute('aria-expanded', String(!pop.hidden)); };
    wrap.append(pop);
    return wrap;
  }
  const [lo, hi] = Array.isArray(range) ? range : [point, point];
  const name = n => names ? names[n - 1] : n;
  const span = lo === hi ? `${name(point)}` : `${name(point)}, range ${name(lo)} to ${name(hi)}`;
  const row = node(why?.reason ? 'button' : 'div', 'taste-row');
  const dots = node('span', 'taste-dots');
  for (let n = 1; n <= size; n++) dots.append(node('i', n === point ? 'point' : n >= lo && n <= hi ? 'in-range' : ''));
  dots.setAttribute('aria-label', `${title}: ${span}`);
  row.append(node('span', '', left), dots, node('span', '', right));
  const wrap = node('div', 'taste-meter');
  wrap.append(row);
  if (!why?.reason) return wrap;
  row.type = 'button';
  row.setAttribute('aria-expanded', 'false');
  const pop = node('div', 'taste-why');
  pop.hidden = true;
  pop.append(node('b', '', `${title}: ${span}`), node('span', '', why.reason));
  for (const q of why.quotes || []) pop.append(node('blockquote', '', `\u201c${q}\u201d`));
  row.onclick = () => { pop.hidden = !pop.hidden; row.setAttribute('aria-expanded', String(!pop.hidden)); };
  wrap.append(pop);
  return wrap;
}

function beanCard(bean) {
  const card = node('article', 'bean-card');
  card.dataset.beanId = bean.id;
  const top = node('div', 'bean-top');
  const titleBox = node('div');
  titleBox.append(node('div', 'roaster', bean.roaster), node('div', 'bean-title', bean.title));
  const saved = ranking?.ids.includes(bean.id);
  const heart = node('button', `heart${saved ? ' saved' : ''}`);
  heart.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 5.7a5.3 5.3 0 0 0-7.5 0L12 6.8l-1.1-1.1a5.3 5.3 0 0 0-7.5 7.5L12 21l8.6-7.8a5.3 5.3 0 0 0 0-7.5Z"/></svg>';
  heart.type = 'button';
  heart.setAttribute('aria-pressed', String(!!saved));
  heart.setAttribute('aria-label', `${saved ? 'Remove from' : 'Add to'} Wish list: ${bean.title}`);
  heart.disabled = !ranking || saving || !navigator.onLine;
  heart.onclick = () => saveRanking(saved ? ranking.ids.filter(id => id !== bean.id) : [...ranking.ids, bean.id]);
  top.append(titleBox, heart);
  const meta = node('div', 'bean-meta');
  const origin = bean.label?.origins?.length ? bean.label.origins.join(', ') : 'Origin not stated';
  for (const value of [origin, ...(bean.label?.process || []), bean.label?.roast ? `${bean.label.roast} roast` : null]) {
    if (value) meta.append(node('span', 'pill', value));
  }
  if (!bean.available || bean.gone) meta.append(node('span', 'pill out', bean.gone ? 'No longer listed' : 'Sold out'));
  const footer = node('div', 'bean-footer');
  footer.append(node('strong', '', bean.price == null ? 'Price unavailable' : `$${Number(bean.price).toFixed(2)} / ${bean.grams || '?'}g`));
  const link = safeLink(bean.url, 'View bean ↗');
  if (link) footer.append(link);
  const label = bean.label;
  if (label && (Number.isInteger(label.funk) || label.funk === null)) {
    const roast = ROAST_LEVELS.indexOf((label.roast || '').toLowerCase()) + 1;
    const taste = node('div', 'taste');
    taste.append(tasteMeter('clean', 'funky', 5, label.funk, label.funk_range, label.why?.funk, 'Clean to funky'));
    if (label.roast === null) taste.append(tasteMeter('light', 'dark', 3, null, null, label.why?.roast, 'Roast', ROAST_LEVELS));
    else if (roast) taste.append(tasteMeter('light', 'dark', 3, roast, label.roast_range?.map(r => ROAST_LEVELS.indexOf(r) + 1),
      label.why?.roast, 'Roast', ROAST_LEVELS));
    card.append(top, meta, taste, footer);
  } else card.append(top, meta, footer);
  return card;
}

// Pending "same lot, new listing" suggestions that nobody has decided yet.
function pendingReplacements() {
  const byId = new Map((snapshot?.beans || []).map(bean => [bean.id, bean]));
  return (snapshot?.suggestions || []).filter(item => byId.has(item.old_id) && byId.has(item.new_id)
    && !decisions.some(choice => choice.old_id === item.old_id && choice.new_id === item.new_id));
}

function replaceCard(bean, role) {
  const card = node('div', `replace-card ${role}`);
  const origin = bean.label?.origins?.length ? bean.label.origins.join(', ') : 'Origin not stated';
  const title = safeLink(bean.url, bean.title) || node('span', '', bean.title);
  card.append(node('span', 'replace-tag', `${role === 'old' ? 'Previous listing' : 'New listing'}${bean.gone ? ', gone' : ''}`),
    title, node('span', 'meta', `${bean.roaster} · ${origin}`),
    node('span', 'meta', `$${Number(bean.price).toFixed(2)} / ${bean.grams || '?'}g`),
    node('span', 'meta', `First seen ${date(bean.first_seen)}`));
  if (bean.label?.notes?.length) card.append(node('span', 'meta', bean.label.notes.join(', ')));
  return card;
}

// The old listing on top, the new one below, and the choice in between.
function replacePair(item) {
  const byId = new Map(snapshot.beans.map(bean => [bean.id, bean]));
  const pair = node('div', 'replace-pair');
  const middle = node('div', 'replace-middle');
  middle.append(node('b', '', `Same lot? ${Math.round(item.confidence * 100)}% sure`), node('span', '', item.reason));
  if (item.changes?.length) middle.append(node('span', '', `Changed: ${item.changes.join(', ')}`));
  const actions = node('div', 'replace-actions');
  for (const [accept, text, hint] of [[true, 'Accept', 'Same lot: keep the Wish list place, archive choice and first-seen date'],
                                       [false, 'Reject', 'Different lot: keep them as two lots']]) {
    const button = node('button', accept ? 'accept' : '', text);
    button.type = 'button'; button.title = hint;
    button.disabled = deciding || !navigator.onLine;
    button.onclick = () => decideReplacement(item, accept);
    actions.append(button);
  }
  middle.append(actions);
  pair.append(replaceCard(byId.get(item.old_id), 'old'), middle, replaceCard(byId.get(item.new_id), 'new'));
  return pair;
}

async function decideReplacement(item, accept) {
  if (deciding || !navigator.onLine) return;
  deciding = true;
  render();
  try {
    if (demoMode) {
      decisions.push({ old_id: item.old_id, new_id: item.new_id });
      if (accept) ranking = { ...ranking, ids: ranking.ids.map(id => id === item.old_id ? item.new_id : id).filter((id, at, all) => all.indexOf(id) === at) };
    } else {
      const result = await client.rpc('decide_replacement', { old_listing: item.old_id, new_listing: item.new_id, do_accept: accept });
      if (result.error) throw result.error;
      ranking = Array.isArray(result.data) ? result.data[0] : result.data;
      decisions.push({ old_id: item.old_id, new_id: item.new_id });
    }
    notice('');
  } catch (error) {
    notice(`Could not save your choice. Nothing was changed.${error?.message ? ` (${error.message})` : ''}`);
  } finally {
    deciding = false;
    render();
  }
}

// Pinned above the Browse list until each one is accepted or rejected.
function renderReplacements() {
  const box = $('replacements');
  const pairs = !snapshot || appliedFilters.showArchived ? [] : pendingReplacements();
  box.hidden = !pairs.length;
  if (!pairs.length) { box.replaceChildren(); return; }
  box.replaceChildren(node('h3', '', `Possible replacement${pairs.length === 1 ? '' : 's'}`), ...pairs.map(replacePair));
}

function renderBrowse() {
  if (!snapshot) return;
  const filtered = snapshot.beans.filter(bean => matches(bean, appliedFilters));
  filtered.sort((a, b) => {
    if (appliedFilters.sort === 'new') return (b.first_seen || '').localeCompare(a.first_seen || '');
    if (appliedFilters.sort === 'per100g') return (a.per100g || 999) - (b.per100g || 999);
    const score = bean => bean.label?.[appliedFilters.sort] ?? 99;   // lots with no score sort last
    return score(a) - score(b);
  });
  $('count').textContent = `${filtered.length} ${filtered.length === 1 ? 'bean' : 'beans'}`;
  $('bean-list').replaceChildren(...filtered.map(beanCard));
  if (!filtered.length) $('bean-list').append(node('p', 'muted', 'No beans match these filters.'));
  const customized = JSON.stringify(appliedFilters) !== JSON.stringify(defaultFilters());
  $('open-filters').classList.toggle('has-filters', customized);
  $('open-filters').setAttribute('aria-label', customized ? 'Open filters, custom selection active' : 'Open filters');
}

function renderWishlist() {
  if (!ranking || !snapshot) return;
  const byId = new Map(snapshot.beans.map(bean => [bean.id, bean]));
  $('wish-count').textContent = ranking.ids.length;
  const status = !navigator.onLine ? 'Offline. Reconnect before editing your Wish list.' : saving ? 'Saving…' : '';
  $('wish-status').textContent = status;
  $('wish-status').hidden = !status;
  wishShown = shownWishIds(byId);
  $('wish-in-stock').checked = wishInStockOnly;
  const hidden = ranking.ids.length - wishShown.length;
  $('wish-hidden').textContent = hidden ? `${hidden} hidden` : '';
  const items = wishShown.map((id, index) => {
    const bean = byId.get(id);
    const item = node('li', `wish-item${bean && (!bean.available || bean.gone) ? ' out' : ''}`);
    item.dataset.id = id;
    // Rank bar: position on the left, move arrows on the right. Press and hold the card to drag.
    const bar = node('div', 'wish-bar');
    bar.append(node('span', 'wish-position', index + 1));
    const arrows = node('div', 'wish-arrows');
    const up = node('button', '', '↑');
    up.type = 'button'; up.title = 'Move up'; up.setAttribute('aria-label', `Move ${bean?.title || id} up`);
    up.disabled = index === 0 || saving || !navigator.onLine;
    up.onclick = () => move(index, -1);
    const down = node('button', '', '↓');
    down.type = 'button'; down.title = 'Move down'; down.setAttribute('aria-label', `Move ${bean?.title || id} down`);
    down.disabled = index === wishShown.length - 1 || saving || !navigator.onLine;
    down.onclick = () => move(index, 1);
    arrows.append(up, down);
    bar.append(arrows);
    item.append(bar);
    const suggestion = bean && pendingReplacements().find(entry => entry.old_id === id);
    if (suggestion) item.append(replacePair(suggestion));
    else if (bean) item.append(beanCard(bean));
    else {
      // The listing is gone from the data; the heart on a normal card is not available.
      const missing = node('div', 'wish-missing');
      missing.append(node('div', 'bean-title', 'Listing no longer available'), node('p', 'muted', id));
      const remove = node('button', 'link-button', 'Remove from Wish list');
      remove.type = 'button'; remove.disabled = saving || !navigator.onLine;
      remove.onclick = () => saveRanking(ranking.ids.filter(value => value !== id));
      missing.append(remove);
      item.append(missing);
    }
    return item;
  });
  $('wish-list').replaceChildren(...items);
  if (!items.length) $('wish-list').append(node('li', 'wish-empty', ranking.ids.length ? 'Nothing in stock.' : 'No saved beans yet.'));
}

// With "In stock only" on, sold-out and gone beans are hidden but keep their place in the saved order.
let wishInStockOnly = false;
try { wishInStockOnly = localStorage.getItem('wishInStockOnly') === 'true'; } catch {}
let wishShown = [];

function shownWishIds(byId) {
  if (!wishInStockOnly) return ranking.ids;
  return ranking.ids.filter(id => { const bean = byId.get(id); return !bean || (bean.available && !bean.gone); });
}

// Put a new order of the shown beans back into the full list; hidden beans stay where they are.
function mergeShownOrder(order) {
  const shown = new Set(order);
  let next = 0;
  return ranking.ids.map(id => shown.has(id) ? order[next++] : id);
}

$('wish-in-stock').checked = wishInStockOnly;
$('wish-in-stock').onchange = event => {
  wishInStockOnly = event.target.checked;
  try { localStorage.setItem('wishInStockOnly', String(wishInStockOnly)); } catch {}
  renderWishlist();
};

let pendingWishDrag = null;
let activeWishDrag = null;
const wishList = $('wish-list');

function cancelPendingWishDrag() {
  if (pendingWishDrag) clearTimeout(pendingWishDrag.timer);
  pendingWishDrag = null;
}

function startWishDrag(item, x, y, kind, identifier = null) {
  if (pendingWishDrag || activeWishDrag || saving || !navigator.onLine || ranking.ids.length < 2) return;
  pendingWishDrag = { item, x, y, kind, identifier, timer: setTimeout(() => {
    const pending = pendingWishDrag;
    if (!pending || !wishList.contains(pending.item)) return;
    const rect = pending.item.getBoundingClientRect();
    const ghost = pending.item.cloneNode(true);
    ghost.classList.add('wish-drag-ghost');
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    document.body.append(ghost);
    pending.item.classList.add('wish-placeholder');
    document.body.classList.add('wish-reordering');
    activeWishDrag = { item: pending.item, ghost, offsetY: pending.y - rect.top, y: pending.y, kind: pending.kind, identifier: pending.identifier };
    pendingWishDrag = null;
    activeWishDrag.frame = requestAnimationFrame(autoScrollWishList);
  }, 320) };
}

// Press and hold a Browse card that is not saved yet: the card shrinks to a chip, the Wish list
// opens, and the bean is added where the chip is released.
function startAddDrag(card, x, y, kind, identifier = null) {
  const bean = snapshot?.beans.find(value => value.id === card.dataset.beanId);
  if (!bean || ranking?.ids.includes(bean.id) || pendingWishDrag || activeWishDrag || saving || !navigator.onLine) return;
  pendingWishDrag = { item: card, x, y, kind, identifier, timer: setTimeout(() => {
    if (!pendingWishDrag || pendingWishDrag.item !== card) return;
    pendingWishDrag = null;
    setView('wishlist');
    const chip = node('div', 'add-chip');
    chip.append(node('span', 'roaster', bean.roaster), node('b', '', bean.title));
    chip.style.top = `${y - 26}px`;
    document.body.append(chip);
    const slot = node('li', 'wish-item wish-placeholder wish-adding');
    slot.dataset.id = bean.id;
    const bar = node('div', 'wish-bar');
    bar.append(node('span', 'wish-position', ranking.ids.length + 1));
    slot.append(bar, node('div', 'wish-drop-hint', 'Drop here'));
    wishList.querySelector('.wish-empty')?.remove();
    wishList.append(slot);
    document.body.classList.add('wish-reordering');
    activeWishDrag = { item: slot, ghost: chip, offsetY: 26, y, kind, identifier, adding: bean };
    reorderWishAt(y);
    activeWishDrag.frame = requestAnimationFrame(autoScrollWishList);
    navigator.vibrate?.(12);
  }, 320) };
}

function reorderWishAt(y) {
  const drag = activeWishDrag;
  if (!drag) return;
  const others = [...wishList.querySelectorAll(':scope > .wish-item')].filter(item => item !== drag.item);
  const before = others.find(item => y < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2);
  wishList.insertBefore(drag.item, before || null);
  [...wishList.querySelectorAll(':scope > .wish-item')].forEach((item, index) => { item.querySelector('.wish-position').textContent = index + 1; });
}

function moveWishDrag(y) {
  if (!activeWishDrag) return;
  activeWishDrag.y = y;
  activeWishDrag.ghost.style.top = `${y - activeWishDrag.offsetY}px`;
  reorderWishAt(y);
}

function autoScrollWishList() {
  const drag = activeWishDrag;
  if (!drag) return;
  const topEdge = 75;
  const bottomEdge = window.innerHeight - 90;
  const delta = drag.y < topEdge ? -Math.min(12, Math.ceil((topEdge - drag.y) / 7))
    : drag.y > bottomEdge ? Math.min(12, Math.ceil((drag.y - bottomEdge) / 7)) : 0;
  if (delta) { window.scrollBy(0, delta); reorderWishAt(drag.y); }
  drag.frame = requestAnimationFrame(autoScrollWishList);
}

function finishWishDrag(save) {
  cancelPendingWishDrag();
  if (!activeWishDrag) return;
  const drag = activeWishDrag;
  activeWishDrag = null;
  cancelAnimationFrame(drag.frame);
  drag.ghost.remove();
  drag.item.classList.remove('wish-placeholder');
  document.body.classList.remove('wish-reordering');
  if (drag.adding) {
    // A bean dragged in from Browse: insert it after the shown bean just above the drop spot.
    const shown = [...wishList.querySelectorAll(':scope > .wish-item')].map(item => item.dataset.id);
    const above = shown[shown.indexOf(drag.adding.id) - 1];
    drag.item.remove();
    const ids = ranking.ids.filter(id => id !== drag.adding.id);
    ids.splice(above ? ids.indexOf(above) + 1 : 0, 0, drag.adding.id);
    if (save) saveRanking(ids);
    else renderWishlist();
    return;
  }
  const ids = mergeShownOrder([...wishList.querySelectorAll(':scope > .wish-item')].map(item => item.dataset.id));
  if (save && ids.some((id, index) => id !== ranking.ids[index])) saveRanking(ids);
  else renderWishlist();
}

$('bean-list').addEventListener('touchstart', event => {
  const card = event.target.closest('.bean-card');
  if (!card || event.target.closest('button,a') || event.touches.length !== 1) return;
  const touch = event.changedTouches[0];
  startAddDrag(card, touch.clientX, touch.clientY, 'touch', touch.identifier);
}, { passive: true });
$('bean-list').addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button,a')) return;
  const card = event.target.closest('.bean-card');
  if (card) startAddDrag(card, event.clientX, event.clientY, 'mouse');
});
wishList.addEventListener('touchstart', event => {
  const item = event.target.closest('.wish-item');
  if (!item || event.target.closest('button,a') || event.touches.length !== 1) return;
  const touch = event.changedTouches[0];
  startWishDrag(item, touch.clientX, touch.clientY, 'touch', touch.identifier);
}, { passive: true });
window.addEventListener('touchmove', event => {
  const state = activeWishDrag || pendingWishDrag;
  if (!state || state.kind !== 'touch') return;
  const touch = [...event.changedTouches].find(value => value.identifier === state.identifier);
  if (!touch) return;
  if (activeWishDrag) { event.preventDefault(); moveWishDrag(touch.clientY); }
  else if (Math.hypot(touch.clientX - state.x, touch.clientY - state.y) > 9) cancelPendingWishDrag();
}, { passive: false });
window.addEventListener('touchend', event => {
  const state = activeWishDrag || pendingWishDrag;
  if (state?.kind === 'touch' && [...event.changedTouches].some(touch => touch.identifier === state.identifier)) finishWishDrag(true);
});
window.addEventListener('touchcancel', event => {
  const state = activeWishDrag || pendingWishDrag;
  if (state?.kind === 'touch' && [...event.changedTouches].some(touch => touch.identifier === state.identifier)) finishWishDrag(false);
});
wishList.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button,a')) return;
  const item = event.target.closest('.wish-item');
  if (item) startWishDrag(item, event.clientX, event.clientY, 'mouse');
});
window.addEventListener('pointermove', event => {
  const state = activeWishDrag || pendingWishDrag;
  if (state?.kind !== 'mouse') return;
  if (activeWishDrag) moveWishDrag(event.clientY);
  else if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > 9) cancelPendingWishDrag();
});
window.addEventListener('pointerup', () => { if ((activeWishDrag || pendingWishDrag)?.kind === 'mouse') finishWishDrag(true); });
window.addEventListener('pointercancel', () => { if ((activeWishDrag || pendingWishDrag)?.kind === 'mouse') finishWishDrag(false); });
// Long-press opens the browser menu (copy, search, open link); keep it for text fields only.
document.addEventListener('contextmenu', event => { if (!event.target.closest('input, textarea')) event.preventDefault(); });
wishList.addEventListener('contextmenu', event => { if (activeWishDrag) event.preventDefault(); });

function move(index, direction) {
  const order = [...wishShown];
  [order[index], order[index + direction]] = [order[index + direction], order[index]];
  saveRanking(mergeShownOrder(order));
}

async function saveRanking(ids) {
  if (!ranking || saving || !navigator.onLine) return;
  if (demoMode) {
    ranking = { ...ranking, ids };
    render();
    return;
  }
  const previousRanking = ranking;
  saving = true;
  ranking = { ...ranking, ids };
  renderBrowse(); renderWishlist();
  try {
    const result = await client.rpc('save_wishlist', { expected_revision: previousRanking.revision, next_ids: ids });
    if (result.error) {
      if (result.error.code === '40001' || /another device/i.test(result.error.message || '')) {
        const latest = await client.from('wishlist_state').select('ids,revision,updated_at');
        ranking = !latest.error && latest.data?.length ? latest.data[0] : previousRanking;
        notice('Wish list changed on another device. The latest order is shown; try again.');
      } else throw result.error;
    } else {
      ranking = Array.isArray(result.data) ? result.data[0] : result.data;
      notice('');
    }
  } catch {
    ranking = previousRanking;
    notice('Could not save your Wish list. Your previous order is still in place.');
  } finally {
    saving = false;
    renderBrowse(); renderWishlist();
  }
}

function renderActivity() {
  if (!snapshot) return;
  const runs = snapshot.runs;
  const sections = runs.map(run => {
    const section = node('article', 'run');
    const head = node('div', 'run-head');
    head.append(node('time', '', date(run.finished_at || run.started_at)),
                node('small', '', run.source === 'manual' ? 'Manual scan' : run.source === 'legacy' ? 'Earlier scan' : 'Daily scan'));
    section.append(head);
    const events = run.events || [];
    const changes = events.filter(event => event.event !== 'archived_checked');
    section.append(node('p', '', `${run.status || 'Completed'} · ${changes.length} listing ${changes.length === 1 ? 'change' : 'changes'}${run.labeled_count == null ? '' : ` · ${run.labeled_count} labeled`}`));
    if (changes.length) {
      const list = node('ul');
      for (const event of changes) {
        const line = node('li', '', `${event.event.replaceAll('_', ' ')} · ${event.roaster} · ${event.title}`);
        list.append(line);
      }
      section.append(list);
    }
    return section;
  });
  $('activity-list').replaceChildren(...sections);
  if (!runs.length) $('activity-list').append(node('p', 'muted', 'No completed scans yet.'));
}

function render() { renderReplacements(); renderBrowse(); renderWishlist(); renderActivity(); }

function setView(next) {
  view = next;
  for (const name of ['browse', 'wishlist', 'activity', 'backlog']) $(name).hidden = name !== view;
  document.querySelectorAll('nav button').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (view === 'backlog') backlog.reload();
}

document.querySelectorAll('nav button').forEach(button => button.onclick = () => setView(button.dataset.view));
$('open-filters').onclick = () => {
  draftFilters = cloneFilters(appliedFilters);
  $('filter-overlay').hidden = false;
  document.body.classList.add('filters-open');
  document.querySelector('.filter-body').scrollTop = 0;
  renderFilterPanel();
  $('filter-close').focus();
};
function closeFilters(apply = false) {
  if (apply) {
    appliedFilters = cloneFilters(draftFilters);
    renderBrowse();
  }
  draftFilters = null;
  $('filter-overlay').hidden = true;
  document.body.classList.remove('filters-open');
  $('open-filters').focus();
}
$('filter-close').onclick = () => closeFilters();
$('filter-cancel').onclick = () => closeFilters();
$('filter-apply').onclick = () => closeFilters(true);
document.querySelector('.filter-backdrop').onclick = () => closeFilters();
$('filter-dialog').onkeydown = event => {
  if (event.key === 'Escape') { event.preventDefault(); closeFilters(); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...$('filter-dialog').querySelectorAll('button:not(:disabled),input:not(:disabled)')]
    .filter(element => element.getClientRects().length);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
};
$('filter-search').oninput = event => { draftFilters.search = event.target.value; renderFilterPanel(); };
$('filter-price').oninput = event => { draftFilters.max = Number(event.target.value); renderFilterPanel(); };
$('filter-unknown').onchange = event => { draftFilters.includeUnknown = event.target.checked; renderFilterPanel(); };
$('filter-stock').onchange = event => { draftFilters.inStock = event.target.checked; draftFilters.stockBeforeArchive = event.target.checked; renderFilterPanel(); };
$('filter-archived').onchange = event => {
  draftFilters.showArchived = event.target.checked;
  draftFilters.inStock = draftFilters.showArchived ? false : draftFilters.stockBeforeArchive;
  renderFilterPanel();
};
$('filter-roast-min').oninput = event => { draftFilters.roastMin = Math.min(Number(event.target.value), draftFilters.roastMax); renderFilterPanel(); };
$('filter-roast-max').oninput = event => { draftFilters.roastMax = Math.max(Number(event.target.value), draftFilters.roastMin); renderFilterPanel(); };
$('auth-form').onsubmit = async event => {
  event.preventDefault();
  if (!client) return;
  $('auth-submit').disabled = true;
  $('auth-error').hidden = true;
  try {
    const result = await client.auth.signIn.email({
      email: $('email').value.trim(),
      password: $('password').value
    });
    if (result?.error) throw result.error;
    $('password').value = '';
    showSignedIn();
    await loadData();
  } catch (error) {
    $('auth-error').textContent = error.message || 'Could not sign in.';
    $('auth-error').hidden = false;
  } finally {
    $('auth-submit').disabled = false;
  }
};
$('signout').onclick = async () => {
  await client?.auth.signOut();
  showSignedOut();
};
$('auth-retry').onclick = restoreSession;
async function restoreSession() {
  $('auth-retry').disabled = true;
  $('auth-error').hidden = true;
  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data?.session) { showSignedIn(); await loadData(); restoreSpot(); }
    else showSignedOut();
  } catch {
    $('auth').hidden = false;
    $('app').hidden = true;
    $('navigation').hidden = true;
    $('auth-form').hidden = true;
    $('auth-retry').hidden = false;
    $('auth-error').textContent = 'Could not check your session. Try again.';
    $('auth-error').hidden = false;
  } finally {
    $('auth-retry').disabled = false;
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden) { loadData(); checkForNewVersion(); } });
updateNetwork();
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// Live updates: check for newer data every minute while the app is open and quiet.
setInterval(() => {
  const dragging = activeWishDrag || pendingWishDrag;
  if (document.hidden || $('app').hidden || saving || dragging || document.body.classList.contains('filters-open')) return;
  loadData({ quiet: true });
}, 60000);

// The backlog is checked more often while it is on screen.
setInterval(() => { if (view === 'backlog' && !document.hidden && !$('app').hidden) backlog.refresh(); }, 15000);

// New deployment: the published page points at different script or CSS files than the ones running.
// A CSS-only change is swapped in place; a script change reloads once you are not typing.
const SPOT = 'anotherCupSpot';
let spot = takeSpot(SPOT);
function restoreSpot() {
  if (!spot) return;
  if (spot.view && spot.view !== view) setView(spot.view);
  window.scrollTo(0, spot.scroll || 0);
  spot = null;
}
const filesOf = html => {
  const page = new DOMParser().parseFromString(html, 'text/html');
  return {
    script: page.querySelector('script[type=module][src]')?.getAttribute('src') || '',
    styles: [...page.querySelectorAll('link[rel=stylesheet]')].map(link => link.getAttribute('href')).filter(href => href.startsWith('./')),
  };
};
let versionCheckedAt = 0;
let knownScript = '', runningPrint = '';
// The script file name changes with any CSS change too, so compare the scripts with the CSS names removed.
// Old files disappear after a deployment, so the running script is fingerprinted once, at the first check.
async function scriptPrint(url) {
  const text = (await (await fetch(url)).text()).replace(/index-[\w-]{8}\.css/g, 'index.css');
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function checkForNewVersion() {
  if (!import.meta.env.PROD || !navigator.onLine || Date.now() - versionCheckedAt < 30000) return;
  versionCheckedAt = Date.now();
  try {
    const response = await fetch(location.pathname, { cache: 'no-store' });
    if (!response.ok) return;
    const latest = filesOf(await response.text());
    const running = filesOf(document.documentElement.outerHTML);
    if (!knownScript) { knownScript = running.script; runningPrint = await scriptPrint(running.script); }
    navigator.serviceWorker?.getRegistration().then(registration => registration?.update()).catch(() => {});
    if (latest.script && latest.script !== knownScript) {
      if (await scriptPrint(latest.script) !== runningPrint) {
        reloadWhenIdle({ beforeReload: () => saveSpot(SPOT, { view }) });
        return;
      }
      knownScript = latest.script;
    }
    for (const link of document.querySelectorAll('link[rel=stylesheet]')) {
      const href = link.getAttribute('href');
      if (!href.startsWith('./') || latest.styles.includes(href)) continue;
      const next = latest.styles.find(value => value.replace(/-[\w-]{8}\.css$/, '') === href.replace(/-[\w-]{8}\.css$/, ''));
      if (!next) continue;
      const fresh = link.cloneNode();
      fresh.href = next;
      fresh.onload = () => link.remove();
      link.after(fresh);
    }
  } catch { /* try again at the next check */ }
}
setInterval(() => { if (!document.hidden) checkForNewVersion(); }, 300000);
window.addEventListener('online', checkForNewVersion);
checkForNewVersion();
if (demoMode) {
  showSignedIn();
  loadData();
  const previewView = new URLSearchParams(location.search).get('view');
  if (['browse', 'wishlist', 'activity', 'backlog'].includes(previewView)) setView(previewView);
  restoreSpot();
} else if (!client) {
  showSignedOut();
  $('auth-form').hidden = true;
  $('auth-error').textContent = 'This build needs public Neon Auth and Data API URLs.';
  $('auth-error').hidden = false;
} else {
  restoreSession();
}
