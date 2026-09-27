import { createClient } from '@neondatabase/neon-js';

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
let view = 'browse';
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
const defaultFilters = () => ({ search: '', vibeQuadrant: null, max: 60, inStock: true, stockBeforeArchive: true, showArchived: false, roastMin: 0, roastMax: 2, roasters: {}, origins: {}, process: {}, sort: 'per100g' });
const cloneFilters = filters => ({ ...filters, roasters: { ...filters.roasters }, origins: { ...filters.origins }, process: { ...filters.process } });
let appliedFilters = defaultFilters();
let draftFilters = null;
let originGroups = [];
const demoSnapshot = {
  beans: [
    { id: 'demo/01', roaster: 'Northline Coffee', title: 'Ethiopia Sidama', price: 24, grams: 250, per100g: 9.6, available: true, url: 'https://example.com', first_seen: '2026-09-26', label: { origins: ['Ethiopia'], process: ['Washed'], roast: 'light', funk: 1, body: 1, notes: ['Floral', 'Citrus'] } },
    { id: 'demo/02', roaster: 'Daybreak Roasters', title: 'Colombia Huila', price: 27, grams: 250, per100g: 10.8, available: true, url: 'https://example.com', first_seen: '2026-09-25', label: { origins: ['Colombia'], process: ['Natural'], roast: 'medium', funk: 4, body: 2, notes: ['Berries', 'Cocoa'] } },
    { id: 'demo/03', roaster: 'Northline Coffee', title: 'Brazil Cerrado', price: 21, grams: 250, per100g: 8.4, available: true, url: 'https://example.com', first_seen: '2026-09-20', label: { origins: ['Brazil'], process: ['Pulped natural'], roast: 'dark', funk: 1, body: 4, notes: ['Caramel', 'Nuts'] } }
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

async function loadData() {
  if (demoMode) {
    snapshot = demoSnapshot;
    ranking ||= { ids: ['demo/02', 'demo/01'], revision: 1 };
    $('published').textContent = 'Sample data';
    buildFilters();
    render();
    notice('');
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
    snapshot = snapResult.data[0].payload;
    ranking = wishResult.data[0];
    if (!Array.isArray(snapshot.beans) || !Array.isArray(snapshot.runs) || !Array.isArray(ranking.ids)) throw new Error('Invalid data');
    $('published').textContent = `Updated ${date(snapResult.data[0].published_at)}`;
    buildFilters();
    render();
    notice('');
  } catch {
    notice('Could not load the latest data. Reconnect and reopen the app to try again.');
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

function matches(bean, filters, skipField = null) {
  if (Boolean(bean.archived) !== filters.showArchived) return false;
  if (filters.inStock && (!bean.available || bean.gone)) return false;
  if (bean.per100g && filters.max < 60 && bean.per100g > filters.max) return false;
  if (filters.vibeQuadrant && vibeQuadrantFor(bean.label) !== filters.vibeQuadrant) return false;
  if (filters.roastMin > 0 || filters.roastMax < ROAST_LEVELS.length - 1) {
    const roast = ROAST_LEVELS.indexOf((bean.label?.roast || '').toLowerCase());
    if (roast < filters.roastMin || roast > filters.roastMax) return false;
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

function beanCard(bean) {
  const card = node('article', 'bean-card');
  const top = node('div', 'bean-top');
  const titleBox = node('div');
  titleBox.append(node('div', 'roaster', bean.roaster), node('div', 'bean-title', bean.title));
  const saved = ranking?.ids.includes(bean.id);
  const heart = node('button', `heart${saved ? ' saved' : ''}`, saved ? '♥' : '♡');
  heart.type = 'button';
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
  card.append(top, meta, footer);
  return card;
}

function renderBrowse() {
  if (!snapshot) return;
  const filtered = snapshot.beans.filter(bean => matches(bean, appliedFilters));
  filtered.sort((a, b) => {
    if (appliedFilters.sort === 'new') return (b.first_seen || '').localeCompare(a.first_seen || '');
    if (appliedFilters.sort === 'per100g') return (a.per100g || 999) - (b.per100g || 999);
    return (a.label?.[appliedFilters.sort] || 0) - (b.label?.[appliedFilters.sort] || 0);
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
  const items = ranking.ids.map((id, index) => {
    const bean = byId.get(id);
    const item = node('li', 'wish-item');
    item.dataset.id = id;
    item.append(node('span', 'wish-position', index + 1));
    const copy = node('div', 'wish-copy');
    copy.append(node('div', 'roaster', bean?.roaster || 'Unavailable listing'),
                node('div', 'bean-title', bean?.title || id));
    if (bean) copy.append(node('p', '', `${(bean.label?.origins || []).join(', ') || 'Origin not stated'} · $${Number(bean.price || 0).toFixed(2)}${bean.archived ? ' · Archived' : ''}`));
    item.append(copy);
    const actions = node('div', 'wish-actions');
    const arrows = node('div', 'wish-arrows');
    const up = node('button', '', '↑');
    up.type = 'button'; up.title = 'Move up'; up.setAttribute('aria-label', `Move ${bean?.title || id} up`);
    up.disabled = index === 0 || saving || !navigator.onLine;
    up.onclick = () => move(index, -1);
    const down = node('button', '', '↓');
    down.type = 'button'; down.title = 'Move down'; down.setAttribute('aria-label', `Move ${bean?.title || id} down`);
    down.disabled = index === ranking.ids.length - 1 || saving || !navigator.onLine;
    down.onclick = () => move(index, 1);
    const remove = node('button', 'wish-remove');
    remove.type = 'button'; remove.disabled = saving || !navigator.onLine;
    remove.setAttribute('aria-label', `Remove ${bean?.title || id} from Wish list`);
    remove.title = 'Remove from Wish list';
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.4c0 4.5-8.8 10.7-8.8 10.7S3.2 12.9 3.2 8.4a4.5 4.5 0 0 1 8.8-1.2 4.5 4.5 0 0 1 8.8 1.2Z"/></svg>';
    remove.onclick = () => saveRanking(ranking.ids.filter(value => value !== id));
    arrows.append(up, down);
    actions.append(arrows, remove);
    item.append(actions);
    return item;
  });
  $('wish-list').replaceChildren(...items);
  if (!items.length) $('wish-list').append(node('li', 'wish-empty', 'No saved beans yet.'));
}

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
  const ids = [...wishList.querySelectorAll(':scope > .wish-item')].map(item => item.dataset.id);
  if (save && ids.some((id, index) => id !== ranking.ids[index])) saveRanking(ids);
  else renderWishlist();
}

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
wishList.addEventListener('contextmenu', event => { if (activeWishDrag) event.preventDefault(); });

function move(index, direction) {
  const ids = [...ranking.ids];
  [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
  saveRanking(ids);
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

function render() { renderBrowse(); renderWishlist(); renderActivity(); }

function setView(next) {
  view = next;
  for (const name of ['browse', 'wishlist', 'activity']) $(name).hidden = name !== view;
  document.querySelectorAll('nav button').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
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
    if (data?.session) { showSignedIn(); await loadData(); }
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
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden) loadData(); });
updateNetwork();
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
if (demoMode) {
  showSignedIn();
  loadData();
} else if (!client) {
  showSignedOut();
  $('auth-form').hidden = true;
  $('auth-error').textContent = 'This build needs public Neon Auth and Data API URLs.';
  $('auth-error').hidden = false;
} else {
  restoreSession();
}
