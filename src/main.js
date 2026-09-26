import { createClient } from '@neondatabase/neon-js';
import './style.css';

const $ = id => document.getElementById(id);
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
  $('network').textContent = navigator.onLine ? 'Online' : 'Offline';
  $('network').classList.toggle('error', !navigator.onLine);
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
}

function showSignedIn() {
  $('auth').hidden = true;
  $('app').hidden = false;
  $('navigation').hidden = false;
  $('signout').hidden = false;
}

async function loadData() {
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
  const filterValues = {
    roaster: snapshot.beans.map(bean => bean.roaster),
    origin: snapshot.beans.flatMap(bean => bean.label?.origins || []),
    process: snapshot.beans.flatMap(bean => bean.label?.process || [])
  };
  for (const [name, values] of Object.entries(filterValues)) {
    const select = $(name);
    const selected = select.value;
    select.replaceChildren(select.firstElementChild);
    [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)).forEach(value => {
      const option = node('option', '', value);
      option.value = value;
      select.append(option);
    });
    select.value = selected;
  }
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
  const search = $('search').value.trim().toLowerCase();
  const selectedRoaster = $('roaster').value;
  const selectedOrigin = $('origin').value;
  const selectedProcess = $('process').value;
  const filtered = snapshot.beans.filter(bean => {
    if (Boolean(bean.archived) !== $('archived').checked) return false;
    if ($('stock').checked && (!bean.available || bean.gone)) return false;
    if (selectedRoaster && bean.roaster !== selectedRoaster) return false;
    if (selectedOrigin && !(bean.label?.origins || []).includes(selectedOrigin)) return false;
    if (selectedProcess && !(bean.label?.process || []).includes(selectedProcess)) return false;
    return !search || [bean.title, bean.roaster, ...(bean.label?.origins || []), ...(bean.label?.notes || [])]
      .join(' ').toLowerCase().includes(search);
  });
  $('count').textContent = `${filtered.length} ${filtered.length === 1 ? 'bean' : 'beans'}`;
  $('bean-list').replaceChildren(...filtered.map(beanCard));
  if (!filtered.length) $('bean-list').append(node('p', 'muted', 'No beans match these filters.'));
}

function renderWishlist() {
  if (!ranking || !snapshot) return;
  const byId = new Map(snapshot.beans.map(bean => [bean.id, bean]));
  $('wish-count').textContent = ranking.ids.length;
  $('wish-status').textContent = !navigator.onLine ? 'Offline. Reconnect before editing your Wish list.' :
    saving ? 'Saving…' : ranking.ids.length ? 'Use the arrows to change the order.' : 'Heart a bean in Browse to add it here.';
  const items = ranking.ids.map((id, index) => {
    const bean = byId.get(id);
    const item = node('li', 'wish-item');
    item.append(node('span', 'wish-position', index + 1));
    const copy = node('div', 'wish-copy');
    copy.append(node('div', 'roaster', bean?.roaster || 'Unavailable listing'),
                node('div', 'bean-title', bean?.title || id));
    if (bean) copy.append(node('p', '', `${(bean.label?.origins || []).join(', ') || 'Origin not stated'} · $${Number(bean.price || 0).toFixed(2)}${bean.archived ? ' · Archived' : ''}`));
    item.append(copy);
    const actions = node('div', 'wish-actions');
    const up = node('button', '', '↑');
    up.type = 'button'; up.title = 'Move up'; up.setAttribute('aria-label', `Move ${bean?.title || id} up`);
    up.disabled = index === 0 || saving || !navigator.onLine;
    up.onclick = () => move(index, -1);
    const down = node('button', '', '↓');
    down.type = 'button'; down.title = 'Move down'; down.setAttribute('aria-label', `Move ${bean?.title || id} down`);
    down.disabled = index === ranking.ids.length - 1 || saving || !navigator.onLine;
    down.onclick = () => move(index, 1);
    const remove = node('button', '', 'Remove');
    remove.type = 'button'; remove.disabled = saving || !navigator.onLine;
    remove.setAttribute('aria-label', `Remove ${bean?.title || id} from Wish list`);
    remove.onclick = () => saveRanking(ranking.ids.filter(value => value !== id));
    actions.append(up, down, remove);
    item.append(actions);
    return item;
  });
  $('wish-list').replaceChildren(...items);
}

function move(index, direction) {
  const ids = [...ranking.ids];
  [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
  saveRanking(ids);
}

async function saveRanking(ids) {
  if (!ranking || saving || !navigator.onLine) return;
  saving = true;
  renderBrowse(); renderWishlist();
  try {
    const result = await client.rpc('save_wishlist', { expected_revision: ranking.revision, next_ids: ids });
    if (result.error) {
      if (result.error.code === '40001' || /another device/i.test(result.error.message || '')) {
        const latest = await client.from('wishlist_state').select('ids,revision,updated_at');
        if (!latest.error && latest.data?.length) ranking = latest.data[0];
        notice('Wish list changed on another device. The latest order is shown; try again.');
      } else throw result.error;
    } else {
      ranking = Array.isArray(result.data) ? result.data[0] : result.data;
      notice('');
    }
  } catch {
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
document.querySelectorAll('.filters input,.filters select').forEach(control => control.addEventListener('input', renderBrowse));
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
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden) loadData(); });
updateNetwork();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
if (!client) {
  showSignedOut();
  $('auth-form').hidden = true;
  $('auth-error').textContent = 'This build needs public Neon Auth and Data API URLs.';
  $('auth-error').hidden = false;
} else {
  client.auth.getSession().then(({ data }) => {
    if (data?.session) { showSignedIn(); loadData(); }
    else showSignedOut();
  }).catch(showSignedOut);
}
