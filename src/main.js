import { createClient } from '@neondatabase/neon-js';
import { BetterAuthVanillaAdapter } from '@neondatabase/neon-js/auth/vanilla/adapters';
import { createDataLoader, LoadError, SessionEnded, readResult } from './data-loader.js';
import './startup.js';
import { mountBacklog } from './backlog-ui.js';
import './backlog-ui.css';
import { reloadWhenIdle, saveSpot, takeSpot } from './live-update.js';
import { mountPushPrompt } from './push.js';

const $ = id => document.getElementById(id);
const demoMode = import.meta.env.DEV && new URLSearchParams(location.search).has('demo');
const demoMember = demoMode && new URLSearchParams(location.search).get('demo') === 'member';
const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL;
const client = authUrl && dataApiUrl ? createClient({
  auth: { url: authUrl, adapter: BetterAuthVanillaAdapter({ fetchOptions: { timeout: 12000 } }) },
  dataApi: { url: dataApiUrl }
}) : null;
let snapshot = null;
let ranking = null;
let profile = null;
let archiveIds = new Set();
let showingSetup = false;
let tourStep = 0;
let requests = [];
let saving = false;
let savingFilters = false;
let savingArchive = false;
let decisions = [];            // replacement choices made on a device, not yet applied by the Mac
let deciding = false;
let view = 'browse';
let demoBacklog = { document: { tasks: [
  { id: 'sample-1', text: 'Refine the Browse cards #mobile\nCheck spacing on a phone.', created: '2026-10-18T09:30:00.000Z', done_at: null, author_name: 'Coffee Owner' },
  { id: 'sample-2', text: 'Add more roasters #catalog', created: '2026-10-17T02:10:00.000Z', done_at: null, author_name: 'Coffee Owner' },
  { id: 'sample-3', text: 'Review spacing on a phone #mobile', created: '2026-10-16T08:00:00.000Z', done_at: '2026-10-17T06:45:00.000Z', author_name: 'Coffee Owner' }
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
function savedFilters(raw, roasters) {
  const filters = defaultFilters();
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const key of ['search', 'vibeQuadrant', 'max', 'inStock', 'stockBeforeArchive', 'showArchived', 'roastMin', 'roastMax', 'includeUnknown', 'sort']) {
    if (typeof source[key] === typeof filters[key] || source[key] === null && filters[key] === null) filters[key] = source[key];
  }
  if (typeof source.vibeQuadrant === 'string') filters.vibeQuadrant = source.vibeQuadrant;
  if (!Number.isInteger(filters.max) || filters.max < 5 || filters.max > 60) filters.max = 60;
  if (!Number.isInteger(filters.roastMin) || filters.roastMin < 0 || filters.roastMin > 2) filters.roastMin = 0;
  if (!Number.isInteger(filters.roastMax) || filters.roastMax < filters.roastMin || filters.roastMax > 2) filters.roastMax = 2;
  if (!SORT_OPTIONS.some(option => option.key === filters.sort)) filters.sort = 'per100g';
  if (filters.vibeQuadrant && !VIBE_QUADRANTS.some(option => option.key === filters.vibeQuadrant)) filters.vibeQuadrant = null;
  filters.search = filters.search.slice(0, 200);
  for (const field of ['origins', 'process']) {
    const entries = Object.entries(source[field] && typeof source[field] === 'object' ? source[field] : {}).slice(0, 100);
    filters[field] = Object.fromEntries(entries.filter(([key, value]) => key.length <= 100 && (field === 'origins' ? value === true : ['yes', 'no'].includes(value))));
  }
  filters.roasters = Object.fromEntries((roasters || []).map(name => [name, true]));
  return filters;
}
const portableFilters = filters => { const { roasters, ...rest } = filters; return rest; };
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
    // A button avoids Android's native link-preview long press and its haptic.
    const link = node('button', 'external-link', label);
    link.type = 'button';
    link.setAttribute('role', 'link');
    link.onclick = () => window.open(parsed.href, '_blank', 'noopener,noreferrer');
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
  if (!demoMode && !navigator.onLine) setLoadState({ status: 'offline' });
  renderBrowse();
  renderWishlist();
}
window.addEventListener('online', () => { updateNetwork(); loadData(); });
window.addEventListener('offline', updateNetwork);

function showSignedOut({ cancelLoad = true } = {}) {
  if (cancelLoad) cancelAccountLoad();
  pushPrompt.reset();
  snapshot = null;
  ranking = null;
  profile = null;
  archiveIds = new Set();
  showingSetup = false;
  tourStep = 0;
  renderTour();
  requests = [];
  loadedSignature = '';
  $('auth').hidden = false;
  $('app').hidden = true;
  $('navigation').hidden = true;
  $('signout').hidden = true;
  $('auth-form').hidden = false;
}

function showSignedIn() {
  $('auth').hidden = true;
  $('app').hidden = false;
  $('navigation').hidden = showingSetup;
  $('signout').hidden = demoMode;
}

async function accountSession() {
  const result = await client.auth.getSession({ fetchOptions: { headers: { 'X-Force-Fetch': 'true' }, timeout: 12000 } });
  const data = readResult('session', result);
  if (!data?.session || !data.user?.id) throw new SessionEnded();
  return data.user.id;
}

function setLoadState({ status, quiet = false, expired = false }) {
  const box = $('data-status');
  const loading = status === 'loading' || status === 'retrying';
  box.hidden = status === 'ready' || status === 'signed-out' || loading && !!snapshot;
  $('data-retry').hidden = loading;
  $('data-retry').disabled = !navigator.onLine;
  $('data-message').textContent = status === 'offline'
    ? snapshot ? 'Offline. Showing your last loaded data.' : 'Offline. Reconnect to load your coffee.'
    : loading ? status === 'retrying' ? 'Still connecting…' : 'Loading your coffee…'
    : snapshot ? 'Could not refresh. Showing your last loaded data.' : 'Could not load your coffee. Try again.';
  $('app').setAttribute('aria-busy', String(loading));
  if (status === 'signed-out') {
    const wasSignedIn = !!profile;
    showSignedOut();
    if (expired || wasSignedIn) {
      $('auth-error').textContent = 'Your session has ended. Sign in again.';
      $('auth-error').hidden = false;
    }
  }
}

const accountLoader = createDataLoader({
  async read(signal) {
    const userId = await accountSession();
    if (signal.aborted) throw signal.reason;
    if (profile && profile.user_id !== userId) {
      showSignedOut({ cancelLoad: false });
      $('auth').hidden = true;
      setLoadState({ status: 'loading' });
    }
    const initial = profile?.user_id === userId ? profile : readResult('account setup', await client.rpc('bootstrap_account').abortSignal(signal));
    const initialized = Array.isArray(initial) ? initial[0] : initial;
    const specs = [
      ['catalog', client.from('app_snapshot').select('payload,published_at').eq('id', 1)],
      ['wish list', client.from('wishlist_state').select('ids,revision,updated_at')],
      ['archives', client.from('personal_archives').select('bean_id')],
      ['profile', client.from('app_users').select('user_id,role,display_name,roasters,setup_complete,filter_state,filter_revision,tour_complete')]
    ];
    const [catalog, wish, archives, profiles] = await Promise.all(specs.map(async ([name, query]) =>
      readResult(name, await query.abortSignal(signal))));
    // Never install half a bundle or an empty RLS result as a successful load.
    if (!catalog?.length || !wish?.length || !profiles?.length || profiles[0].user_id !== userId) {
      throw new LoadError('account data', { code: 'DATA_NOT_READY', message: 'Account data is not ready' });
    }
    const payload = catalog[0].payload;
    if (!Array.isArray(payload?.beans) || !Array.isArray(payload?.runs) || !Array.isArray(wish[0].ids)) {
      throw new LoadError('data format', { code: 'INVALID_DATA' });
    }
    const choices = await client.from('replacement_decisions').select('old_id,new_id').abortSignal(signal);
    return { catalog: catalog[0], wish: wish[0], archives, profile: { ...initialized, ...profiles[0] },
      decisions: choices.error ? decisions : choices.data };
  },
  apply(bundle) {
    const nextProfile = bundle.profile;
    const signature = `${nextProfile.user_id}|${bundle.catalog.published_at}|${bundle.wish.revision}|${bundle.archives.map(row => row.bean_id).sort().join(',')}|${nextProfile.filter_revision}|${nextProfile.tour_complete}|${JSON.stringify(bundle.decisions)}`;
    profile = nextProfile;
    showSignedIn();
    if (signature === loadedSignature) { if (view === 'backlog') refreshBacklogView(); pushPrompt.update(profile); return; }
    loadedSignature = signature;
    decisions = bundle.decisions;
    ranking = bundle.wish;
    archiveIds = new Set(bundle.archives.map(row => row.bean_id));
    snapshot = { ...bundle.catalog.payload, beans: bundle.catalog.payload.beans.map(bean => ({ ...bean, archived: archiveIds.has(bean.id) })) };
    appliedFilters = savedFilters(profile.filter_state, profile.roasters);
    $('published').textContent = `Updated ${date(bundle.catalog.published_at)}`;
    showingSetup = !profile.setup_complete;
    renderSetup(); buildFilters(); render();
    if (profile.role === 'member' && profile.setup_complete && !profile.tour_complete && !tourStep) startTour();
    else renderTour();
    if (view === 'backlog') refreshBacklogView();
    restoreSpot();
    pushPrompt.update(profile);
  },
  refreshSession: accountSession,
  state: setLoadState
});
function cancelAccountLoad() {
  accountLoader.reset();
  $('app').setAttribute('aria-busy', 'false');
}
$('data-retry').onclick = () => loadData();

// `quiet` is the background check: it redraws only when the published data or the Wish list changed.
let loadedSignature = '';
async function loadData({ quiet = false } = {}) {
  if (demoMode) {
    snapshot = demoSnapshot;
    ranking ||= { ids: demoMember ? [] : ['demo/02', 'demo/03', 'demo/01'], revision: 1 };
    profile ||= { role: demoMember ? 'member' : 'admin', display_name: demoMember ? 'Alex' : 'Coffee Owner', roasters: demoMember ? [] : ['Northline Coffee', 'Daybreak Roasters'], filter_state: {}, filter_revision: 1, setup_complete: !demoMember, tour_complete: !demoMember };
    appliedFilters = savedFilters(profile.filter_state, profile.roasters);
    if (!profile.setup_complete) showingSetup = true;
    $('published').textContent = 'Sample data';
    renderSetup();
    buildFilters();
    render();
    notice('');
    if (view === 'backlog') backlog.refresh();
    return;
  }
  if (snapshot && (saving || savingFilters || savingArchive || deciding || activeWishDrag || pendingWishDrag || document.body.classList.contains('filters-open'))) return false;
  if (client) return accountLoader.load({ quiet });
}

function renderSetup() {
  if (!snapshot || !profile) return;
  const names = [...new Set(snapshot.beans.map(bean => bean.roaster))].sort();
  $('setup-roasters').replaceChildren(...names.map(name => {
    const label = node('label', 'setup-roaster');
    const box = document.createElement('input');
    box.type = 'checkbox'; box.value = name; box.checked = profile.roasters.includes(name);
    label.append(box, node('span', '', name));
    return label;
  }));
  $('roaster-setup').hidden = !showingSetup;
  $('navigation').hidden = showingSetup;
  for (const name of ['browse', 'wishlist', 'activity', 'backlog']) $(name).hidden = showingSetup || name !== view;
}

$('roaster-form').onsubmit = async event => {
  event.preventDefault();
  const chosen = [...$('setup-roasters').querySelectorAll('input:checked')].map(box => box.value);
  if (!chosen.length) { notice('Choose at least one roaster.'); return; }
  cancelAccountLoad();
  $('save-roasters').disabled = true;
  try {
    if (demoMode) profile = { ...profile, roasters: chosen, setup_complete: true, filter_revision: profile.filter_revision + 1 };
    else {
      const result = await client.rpc('save_roaster_subscriptions', { next_roasters: chosen });
      if (result.error) throw result.error;
      profile = Array.isArray(result.data) ? result.data[0] : result.data;
    }
    appliedFilters = savedFilters(profile.filter_state, profile.roasters);
    showingSetup = false;
    notice('');
    renderSetup(); buildFilters(); render();
    if (profile.role === 'member' && !profile.tour_complete) startTour();
  } catch (error) { notice(error.message || 'Could not save roasters.'); }
  finally { $('save-roasters').disabled = false; }
};

function startTour() {
  tourStep = 1;
  setView('browse');
  renderTour();
}

function renderTour() {
  $('feature-tour').hidden = !tourStep;
  $('navigation').inert = Boolean(tourStep);
  $('feature-tour').classList.toggle('in-filters', tourStep === 2);
  $('open-filters').classList.toggle('tour-focus', tourStep === 1);
  $('filter-roaster-section').classList.toggle('tour-focus', tourStep === 2);
  if (!tourStep) return;
  $('tour-count').textContent = `Step ${tourStep} of 2`;
  $('tour-title').textContent = tourStep === 1 ? 'Your coffee, your way' : 'Change roasters anytime';
  $('tour-copy').textContent = tourStep === 1
    ? 'The filter button is where you shape Browse. Your choices are saved to your account.'
    : 'You can change this anytime in Filters. Browse, Activity, and new bean notifications follow your roaster choices.';
  $('tour-next').textContent = tourStep === 1 ? 'Show filters' : 'Got it';
}

async function finishTour() {
  cancelAccountLoad();
  if (!demoMode) {
    const result = await client.rpc('complete_account_guide');
    if (result.error) { notice('Could not save the guide progress. Reconnect and try again.'); return; }
  }
  profile.tour_complete = true;
  tourStep = 0;
  renderTour();
  if (!$('filter-overlay').hidden) closeFilters();
  pushPrompt.update(profile);
}

$('tour-next').onclick = () => {
  if (tourStep === 1) openFilters(); else finishTour();
};
$('tour-skip').onclick = finishTour;

function buildFilters() {
  const selectedBeans = snapshot.beans;
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

  const processValues = new Set(selectedBeans.flatMap(bean => values(bean, 'process')));
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

  const roasters = new Set(selectedBeans.map(bean => bean.roaster));
  $('filter-roasters').replaceChildren(...[...roasters].sort().map(value => checkboxOption('roasters', value)));

  const available = new Set(selectedBeans.flatMap(bean => values(bean, 'origins')));
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
  if (selectedBeans.some(bean => values(bean, 'origins').includes('unknown'))) {
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
  if (skipField !== 'roasters' && !filters.roasters[bean.roaster]) return false;
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
    if (field === skipField || field === 'roasters') continue;
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
  heart.onclick = () => {
    if (activeWishDrag || Date.now() < suppressHeartClickUntil) return;
    saveRanking(saved ? ranking.ids.filter(id => id !== bean.id) : [...ranking.ids, bean.id]);
  };
  top.append(titleBox, heart);
  if (profile?.role === 'member') {
    const archive = node('button', 'archive-action', bean.archived ? 'Restore' : 'Archive');
    archive.type = 'button';
    archive.setAttribute('aria-label', `${bean.archived ? 'Restore' : 'Archive'}: ${bean.title}`);
    archive.disabled = !navigator.onLine || savingArchive;
    archive.onclick = () => setArchive(bean, !bean.archived);
    top.append(archive);
  }
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

async function setArchive(bean, archived) {
  if (savingArchive || !navigator.onLine) return;
  savingArchive = true;
  cancelAccountLoad();
  renderBrowse();
  try {
    if (!demoMode) {
      const result = await client.rpc('set_personal_archive', { listing: bean.id, do_archive: archived });
      if (result.error) throw result.error;
    }
    if (archived) archiveIds.add(bean.id); else archiveIds.delete(bean.id);
    snapshot = { ...snapshot, beans: snapshot.beans.map(item => item.id === bean.id ? { ...item, archived } : item) };
    render(); notice('');
  } catch (error) { notice(error.message || 'Could not update archive.'); }
  finally { savingArchive = false; renderBrowse(); }
}

// Pending "same lot, new listing" suggestions that nobody has decided yet.
function pendingReplacements() {
  if (profile?.role !== 'admin') return [];
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
  cancelAccountLoad();
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
  const pairs = !snapshot || profile?.role !== 'admin' || appliedFilters.showArchived ? [] : pendingReplacements();
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
  if (!filtered.length) {
    const empty = node('div', 'empty-state');
    empty.append(node('h3', '', appliedFilters.showArchived ? 'Nothing archived yet' : 'No beans here yet'),
      node('p', '', appliedFilters.showArchived ? 'Archive a bean to keep it out of Browse.' : 'Try another filter or choose more roasters.'));
    const button = node('button', '', 'Open filters');
    button.onclick = openFilters;
    empty.append(button); $('bean-list').append(empty);
  }
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
  if (!items.length) {
    const empty = node('li', 'empty-state');
    empty.append(node('h3', '', ranking.ids.length ? 'Nothing in stock right now' : 'Your Wish list is empty'),
      node('p', '', ranking.ids.length ? 'Turn off “In stock only” to see all saved beans.' : 'Find a bean you like and tap its heart.'));
    if (!ranking.ids.length) { const button = node('button', '', 'Browse beans'); button.onclick = () => setView('browse'); empty.append(button); }
    $('wish-list').append(empty);
  }
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
let suppressHeartClickUntil = 0;
const wishList = $('wish-list');

function cancelPendingWishDrag() {
  if (pendingWishDrag) clearTimeout(pendingWishDrag.timer);
  pendingWishDrag = null;
}

function startWishDrag(item, x, y, kind, identifier = null) {
  if (pendingWishDrag || activeWishDrag || saving || !navigator.onLine || ranking.ids.length < 2) return;
  cancelAccountLoad();
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

// Press and hold an unsaved heart: the card shrinks to a chip, the Wish list
// opens, and the bean is added where the chip is released.
function startAddDrag(card, x, y, kind, identifier = null) {
  const bean = snapshot?.beans.find(value => value.id === card.dataset.beanId);
  if (!bean || tourStep || showingSetup || ranking?.ids.includes(bean.id) || pendingWishDrag || activeWishDrag || saving || !navigator.onLine) return;
  cancelAccountLoad();
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
    suppressHeartClickUntil = Date.now() + 600;
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
  if (!card || !event.target.closest('.heart:not(.saved)') || event.touches.length !== 1) return;
  const touch = event.changedTouches[0];
  startAddDrag(card, touch.clientX, touch.clientY, 'touch', touch.identifier);
}, { passive: true });
$('bean-list').addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || !event.target.closest('.heart:not(.saved)')) return;
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
window.addEventListener('touchstart', event => { if (event.touches.length > 1) finishWishDrag(false); }, { passive: true });
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
// Chrome Android vibrates when a page consumes a long-press contextmenu event.
// CSS disables selection/callouts, and product links are buttons, so touch presses
// can stay unconsumed. Preserve native selection menus in editable fields.
let lastPointerWasTouch = false;
document.addEventListener('pointerdown', event => { lastPointerWasTouch = event.pointerType === 'touch'; }, { capture: true, passive: true });
document.addEventListener('contextmenu', event => {
  if (event.pointerType === 'touch' || lastPointerWasTouch || event.target.closest('input,textarea,[contenteditable="true"]')) return;
  event.preventDefault();
});

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
  cancelAccountLoad();
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
  $('activity-intro').textContent = 'New beans, sold out listings, and restocks from your roasters.';
  const runs = snapshot.runs.filter(run =>
    (run.events || []).some(event => event.event !== 'archived_checked' && profile.roasters.includes(event.roaster)));
  const sections = runs.map(run => {
    const section = node('article', 'run');
    const head = node('div', 'run-head');
    head.append(node('time', '', date(run.finished_at || run.started_at)));
    section.append(head);
    const events = run.events || [];
    const changes = events.filter(event => event.event !== 'archived_checked' && profile.roasters.includes(event.roaster));
    section.append(node('p', '', `${changes.length} coffee ${changes.length === 1 ? 'change' : 'changes'}`));
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
  if (!runs.length) $('activity-list').append(node('div', 'empty-state', 'No coffee changes from your roasters yet.'));
}

function render() { renderReplacements(); renderBrowse(); renderWishlist(); renderActivity(); }

function renderRequests() {
  const list = $('request-list');
  list.replaceChildren(...requests.map(item => {
    const card = node('article', 'request-card');
    const head = node('div', 'request-head');
    head.append(node('span', `request-state ${item.status}`, item.status === 'completed' ? 'Completed' : 'Requested'),
      node('span', 'request-author', `By ${item.author_name || 'Member'}`),
      node('time', '', date(item.completed_at || item.created_at)));
    const [title, ...body] = item.text.split('\n');
    card.append(head, node('h3', '', title));
    if (body.length) card.append(node('p', '', body.join('\n')));
    return card;
  }));
  if (!requests.length) list.append(node('div', 'empty-state', 'No feature requests yet. Tell us what would make Another Cup better.'));
}

async function refreshRequests() {
  if (demoMode) { renderRequests(); return; }
  const result = await client.from('feature_requests').select('id,author_name,text,status,created_at,completed_at').order('created_at', { ascending: false });
  if (result.error) { $('request-status').textContent = 'Could not load requests. Pull to refresh or try again later.'; return; }
  requests = result.data || [];
  $('request-status').textContent = '';
  renderRequests();
}

$('request-form').onsubmit = async event => {
  event.preventDefault();
  const text = $('request-text').value.trim();
  if (!text) return;
  const button = $('request-form').querySelector('button');
  button.disabled = true;
  try {
    if (demoMode) requests.unshift({ id: crypto.randomUUID(), author_name: profile.display_name, text, status: 'requested', created_at: new Date().toISOString(), completed_at: null });
    else {
      const result = await client.rpc('submit_feature_request', { request_text: text });
      if (result.error) throw result.error;
    }
    $('request-text').value = '';
    await refreshRequests();
  } catch (error) { $('request-status').textContent = error.message || 'Could not send request.'; }
  finally { button.disabled = false; }
};

function refreshBacklogView() {
  const admin = profile?.role === 'admin';
  $('backlog-root').hidden = !admin;
  $('requests-root').hidden = admin;
  document.querySelector('nav [data-view="backlog"]').setAttribute('aria-label', admin ? 'Admin TODOs' : 'Feature requests');
  if (admin) backlog.reload(); else refreshRequests();
}

function setView(next) {
  view = next;
  for (const name of ['browse', 'wishlist', 'activity', 'backlog']) $(name).hidden = showingSetup || name !== view;
  document.querySelectorAll('nav button').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (view === 'backlog') refreshBacklogView();
}

document.querySelectorAll('nav button').forEach(button => button.onclick = () => setView(button.dataset.view));
function openFilters() {
  cancelAccountLoad();
  draftFilters = cloneFilters(appliedFilters);
  const availableRoasters = new Set(snapshot.beans.map(bean => bean.roaster));
  draftFilters.roasters = Object.fromEntries(Object.keys(draftFilters.roasters)
    .filter(name => availableRoasters.has(name)).map(name => [name, true]));
  $('filter-overlay').hidden = false;
  document.body.classList.add('filters-open');
  document.querySelector('.filter-body').scrollTop = 0;
  renderFilterPanel();
  $('filter-close').focus();
  if (tourStep === 1) { tourStep = 2; renderTour(); $('filter-roaster-section').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}
$('open-filters').onclick = openFilters;
function closeFilters() {
  draftFilters = null;
  $('filter-overlay').hidden = true;
  document.body.classList.remove('filters-open');
  if (tourStep === 2) { tourStep = 1; renderTour(); }
  $('open-filters').focus();
}
async function applyFilters() {
  if (!draftFilters || savingFilters) return;
  const chosen = Object.keys(draftFilters.roasters).filter(name => draftFilters.roasters[name]);
  if (!chosen.length) { $('filter-results').textContent = 'Choose at least one roaster.'; return; }
  if (!demoMode && !navigator.onLine) { $('filter-results').textContent = 'Reconnect to save filters.'; return; }
  savingFilters = true;
  cancelAccountLoad();
  $('filter-apply').disabled = true;
  try {
    if (demoMode) profile = { ...profile, roasters: chosen, filter_state: portableFilters(draftFilters), filter_revision: profile.filter_revision + 1 };
    else {
      const result = await client.rpc('save_filter_preferences', {
        expected_revision: profile.filter_revision, next_roasters: chosen, next_filters: portableFilters(draftFilters)
      });
      if (result.error) throw result.error;
      profile = Array.isArray(result.data) ? result.data[0] : result.data;
    }
    appliedFilters = cloneFilters(draftFilters);
    const finishGuide = tourStep === 2;
    buildFilters(); render(); notice('');
    if (finishGuide) await finishTour(); else closeFilters();
  } catch (error) {
    $('filter-results').textContent = error.code === '40001' ? 'Filters changed on another device. Close and reopen to reload.'
      : error.message || 'Could not save filters.';
  } finally { savingFilters = false; $('filter-apply').disabled = false; }
}
$('filter-close').onclick = closeFilters;
$('filter-cancel').onclick = closeFilters;
$('filter-apply').onclick = applyFilters;
$('filter-reset').onclick = () => {
  if (!draftFilters) return;
  draftFilters = savedFilters({}, Object.keys(draftFilters.roasters));
  renderFilterPanel();
};
document.querySelector('.filter-backdrop').onclick = closeFilters;
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
    await loadData();
  } catch (error) {
    $('auth-error').textContent = error.message || 'Could not sign in.';
    $('auth-error').hidden = false;
  } finally {
    $('auth-submit').disabled = false;
  }
};
const pushPrompt = mountPushPrompt({ client, panel: $('push-prompt'), enable: $('push-enable'), dismiss: $('push-dismiss'), message: $('push-message'), enabled: !demoMode });
$('signout').onclick = async () => {
  cancelAccountLoad();
  await pushPrompt.detach().catch(() => {});
  try {
    const result = await client?.auth.signOut();
    if (result?.error) throw result.error;
  }
  catch { notice('Could not sign out. Reconnect and try again.'); return; }
  showSignedOut();
  $('data-status').hidden = true;
};
async function restoreSession() {
  return loadData();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden) { loadData(); checkForNewVersion(); } });
updateNetwork();
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// Live updates: check for newer data every minute while the app is open and quiet.
setInterval(() => {
  const dragging = activeWishDrag || pendingWishDrag;
  if (document.hidden || $('app').hidden || saving || dragging || showingSetup || document.body.classList.contains('filters-open')) return;
  loadData({ quiet: true });
}, 60000);

// The backlog is checked more often while it is on screen.
setInterval(() => {
  if (view !== 'backlog' || document.hidden || $('app').hidden) return;
  if (profile?.role === 'admin') backlog.refresh(); else refreshRequests();
}, 15000);

// New deployment: the published page points at different script or CSS files than the ones running.
// A CSS-only change is swapped in place; a script change reloads once you are not typing.
const SPOT = 'anotherCupSpot';
let spot = takeSpot(SPOT);
function restoreSpot() {
  if (!spot) return;
  if (tourStep || showingSetup) { spot = null; return; }
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
