import { NOW_LIMIT, newTask, splitMessage, laneOf, setLane, tagsOf, groupByWeek, weekKey, dayKey, ageLabel, normalizeDocument } from './backlog-model.js';

const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// #tags in a message are highlighted.
const tagged = text => escapeText(text).replace(/(^|[\s(])(#[\p{L}\p{N}_-]+)/gu, '$1<span class="backlog-tag">$2</span>');
const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>';
const LANE_NAMES = { now: 'Now', inbox: 'Inbox', later: 'Later' };
const MOVES = { now: ['inbox', 'later'], inbox: ['now', 'later'], later: ['now', 'inbox'] };
const shortDay = day => new Date(`${day}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
const entryDay = stamp => new Date(`${dayKey(stamp)}T00:00:00`).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
const toState = result => ({ ...result, document: normalizeDocument(result.document), revision: Number(result.revision) });

function weekLabel(week) {
  const now = new Date().toISOString();
  if (week === weekKey(now)) return 'This week';
  const start = new Date(`${week}T00:00:00`), end = new Date(start);
  end.setDate(end.getDate() + 6);
  if (week === weekKey(new Date(Date.now() - 7 * 86400000).toISOString())) return 'Last week';
  const last = start.getMonth() === end.getMonth() ? end.getDate() : shortDay(dayKey(end.toISOString()));
  return `${shortDay(week)} to ${last}`;
}

export function mountBacklog(root, adapter) {
  let state = null, tab = 'board', busy = false, loading = false, message = '', draft = '';
  let confirming = null;                 // id of the task whose delete confirmation is open
  let editing = null, editDraft = '';    // id and text of the task being edited
  let laterOpen = false, logTag = '';
  const weekOpen = new Map();            // week key -> shown or folded; the newest two weeks start shown
  const logOpen = new Set();             // finished tasks shown in full
  const disabled = () => busy || loading || state?.synced === false;
  // The short title of the task another one was merged into (text before a colon, no #tags).
  const mergedTitle = id => {
    const target = state?.document.tasks.find(value => value.id === id);
    return target ? splitMessage(target.text).title.split(':')[0].replace(/#[\p{L}\p{N}_-]+/gu, '').trim() : 'a removed task';
  };

  function renderTask(task, lane) {
    const { title, body } = splitMessage(task.text);
    const open = confirming === task.id;
    const editable = !task.request_id;
    const total = Number(task.progress?.total) || 0, ticked = Math.min(Number(task.progress?.done) || 0, total);
    const content = editing === task.id
      ? `<form class="backlog-edit"><textarea name="edit" rows="2" maxlength="2000" aria-label="Edit task">${escapeText(editDraft)}</textarea>
          <div class="backlog-edit-actions"><button type="submit" ${disabled() ? 'disabled' : ''}>Save</button>
          <button type="button" data-action="cancel-edit">Cancel</button></div></form>`
      : `<div class="backlog-title">${tagged(title)}</div>${body ? `<div class="backlog-body">${tagged(body)}</div>` : ''}`;
    const note = task.merged_into ? `Merged into ${escapeText(mergedTitle(task.merged_into))}`
      : task.author_name ? `${escapeText(task.author_name)}${task.request_id ? ', request' : ''}` : '';
    return `<li class="backlog-task lane-${lane}" data-id="${escapeText(task.id)}">
      <input type="checkbox" data-action="toggle" ${disabled() ? 'disabled' : ''} aria-label="Complete: ${escapeText(title)}">
      <div class="backlog-main">
        <div class="backlog-text ${editable ? 'can-edit' : ''}">${content}</div>
        ${total ? `<div class="backlog-progress" role="img" aria-label="${ticked} of ${total} steps done"><b><i style="width:${Math.round(ticked / total * 100)}%"></i></b><span>${ticked}/${total}</span></div>` : ''}
        <div class="backlog-meta">
          <span class="backlog-age">${ageLabel(task.created)}</span>${note ? `<span class="backlog-note">${note}</span>` : ''}
          <span class="backlog-actions">
            ${MOVES[lane].map(target => `<button type="button" class="backlog-move" data-action="move" data-lane="${target}" ${disabled() ? 'disabled' : ''}
              aria-label="Move to ${LANE_NAMES[target]}: ${escapeText(title)}">${LANE_NAMES[target]}</button>`).join('')}
            ${editable ? `<span class="backlog-trash-wrap">
              <button type="button" class="backlog-trash ${open ? 'armed' : ''}" data-action="delete" ${disabled() ? 'disabled' : ''}
                aria-haspopup="true" aria-expanded="${open}" aria-label="Delete: ${escapeText(title)}" title="Delete">${TRASH}</button>
              ${open ? `<div class="backlog-confirm" role="alertdialog" aria-label="Delete this task?"><span>Delete this task?</span>
                <button type="button" class="backlog-confirm-yes" data-action="confirm-delete">Delete</button>
                <button type="button" data-action="cancel-delete">Cancel</button></div>` : ''}
            </span>` : ''}
          </span>
        </div>
      </div>
    </li>`;
  }

  function renderLane(lane, tasks, count) {
    const list = tasks.length ? `<ul class="backlog-tasks">${tasks.map(task => renderTask(task, lane)).join('')}</ul>`
      : `<p class="backlog-empty">${lane === 'now' ? 'Nothing in Now' : 'Inbox is empty'}</p>`;
    return `<section class="backlog-lane lane-${lane}" aria-label="${LANE_NAMES[lane]}">
      <h3 class="backlog-label">${LANE_NAMES[lane]}<span>${count}</span></h3>${list}</section>`;
  }

  function renderBoard(open) {
    const newest = lane => open.filter(task => laneOf(task) === lane).sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    const now = open.filter(task => laneOf(task) === 'now'), inbox = newest('inbox'), later = newest('later');
    return `<form class="backlog-add"><textarea name="text" rows="1" maxlength="2000" aria-label="New task"
        placeholder="Add a task #tag" ${disabled() ? 'disabled' : ''}>${escapeText(draft)}</textarea>
        <button type="submit" ${disabled() ? 'disabled' : ''}>Add</button></form>
      ${renderLane('now', now, `${now.length} of ${NOW_LIMIT}`)}
      ${renderLane('inbox', inbox, inbox.length)}
      <section class="backlog-lane lane-later" aria-label="Later">
        <h3 class="backlog-label"><button type="button" class="backlog-fold" data-action="toggle-later" aria-expanded="${laterOpen}">Later<span>${later.length}</span></button></h3>
        ${laterOpen ? `<ul class="backlog-tasks">${later.map(task => renderTask(task, 'later')).join('')}</ul>` : ''}
      </section>`;
  }

  function renderEntry(task) {
    const { title, body } = splitMessage(task.text);
    const open = logOpen.has(task.id);
    return `<li class="backlog-entry ${open ? 'open' : ''}" data-id="${escapeText(task.id)}">
      <button type="button" class="backlog-entry-head" data-action="expand" aria-expanded="${open}">
        <span class="backlog-entry-day">${escapeText(entryDay(task.done_at))}</span>
        <span class="backlog-entry-title">${tagged(title)}</span></button>
      ${open ? `<div class="backlog-entry-body">${body ? `<div class="backlog-body">${tagged(body)}</div>` : ''}
        ${task.author_name ? `<div class="backlog-note">${escapeText(task.author_name)}${task.request_id ? ', request' : ''}</div>` : ''}
        <button type="button" class="backlog-move" data-action="reopen" ${disabled() ? 'disabled' : ''}>Reopen</button></div>` : ''}
    </li>`;
  }

  function renderLog(done) {
    const tags = [...new Set(done.flatMap(task => tagsOf(task.text)))].sort();
    if (logTag && !tags.includes(logTag)) logTag = '';
    const shown = logTag ? done.filter(task => tagsOf(task.text).includes(logTag)) : done;
    const chips = tags.length ? `<div class="backlog-chips" role="group" aria-label="Filter by tag">${['', ...tags].map(tag =>
      `<button type="button" class="backlog-chip ${logTag === tag ? 'on' : ''}" data-tag="${escapeText(tag)}" aria-pressed="${logTag === tag}">${tag ? escapeText(tag) : 'All'}</button>`).join('')}</div>` : '';
    const weeks = groupByWeek(shown, 'done_at').map((group, index) => {
      const open = weekOpen.has(group.week) ? weekOpen.get(group.week) : index < 2;
      const label = escapeText(weekLabel(group.week));
      return `<section class="backlog-week" aria-label="${label}">
        <h3 class="backlog-label"><button type="button" class="backlog-fold" data-action="toggle-week" data-week="${group.week}" aria-expanded="${open}">${label}<span>${group.tasks.length}</span></button></h3>
        ${open ? `<ul class="backlog-log">${group.tasks.map(renderEntry).join('')}</ul>` : ''}</section>`;
    }).join('');
    return `${chips}${weeks || '<p class="backlog-empty">Nothing finished yet</p>'}`;
  }

  // Redrawing replaces the DOM, so put the cursor back in the box the person was typing in.
  function render(focusName = null) {
    const active = document.activeElement;
    const keep = focusName ? { name: focusName, start: Infinity, end: Infinity }
      : root.contains(active) && active.name ? { name: active.name, start: active.selectionStart, end: active.selectionEnd } : null;
    if (!state) {
      root.innerHTML = `<div class="backlog-loading" role="status">${escapeText(message || 'Loading backlog…')}</div>${message ? '<button type="button" data-action="retry">Retry</button>' : ''}`;
      return;
    }
    const open = state.document.tasks.filter(task => task.done_at == null);
    const done = state.document.tasks.filter(task => task.done_at != null);
    const tabs = [['board', 'Board', open.length], ['log', 'Log', done.length]];
    root.innerHTML = `<div class="backlog-tabs" role="tablist" aria-label="Backlog">${tabs.map(([key, name, count]) =>
        `<button type="button" role="tab" data-tab="${key}" aria-selected="${tab === key}" class="${tab === key ? 'active' : ''}">${name}<span>${count}</span></button>`).join('')}</div>
      <div class="backlog-message" role="status">${escapeText(message || (state.synced === false ? 'Offline copy. Reconnect to edit.' : ''))}</div>
      <div class="backlog-panel" role="tabpanel" aria-label="${tab === 'board' ? 'Board' : 'Log'}">${tab === 'board' ? renderBoard(open) : renderLog(done)}</div>`;
    autosize();
    if (keep) {
      const box = root.querySelector(`textarea[name="${keep.name}"]`);
      if (box && !box.disabled) {
        box.focus();
        box.setSelectionRange(Math.min(keep.start, box.value.length), Math.min(keep.end, box.value.length));
      }
    } else if (confirming) root.querySelector('.backlog-confirm-yes')?.focus();
  }

  function autosize() {
    for (const box of root.querySelectorAll('textarea')) { box.style.height = 'auto'; box.style.height = `${box.scrollHeight}px`; }
  }

  async function reload() {
    if (loading || busy) return;
    loading = true;
    try { state = toState(await adapter.load()); message = ''; }
    catch (error) { message = error.message || 'Could not load the backlog.'; }
    finally { loading = false; render(); }
  }

  // Quiet check for changes made on another device. It leaves the screen alone while you are
  // editing, typing, confirming a delete or saving, and redraws only when the saved copy is newer.
  async function refresh() {
    if (!state) return reload();
    // A redraw replaces the text box, and a script cannot bring the phone's keyboard back.
    const writing = () => draft || editDraft || root.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
    if (loading || busy || editing || confirming || writing()) return;
    try {
      const next = toState(await adapter.load());
      if (loading || busy || editing || confirming || writing()) return;
      if (next.revision === state.revision && next.synced === state.synced) return;
      state = next; message = ''; render();
    } catch { /* keep what is on screen; the next check tries again */ }
  }

  // Apply a change and save it. If another device saved first, redo the change on its copy once.
  async function mutate(change) {
    if (!state || disabled()) return false;
    const commit = async base => {
      const tasks = structuredClone(base.document.tasks);
      change(tasks);
      return toState(await adapter.save({ tasks }, base.revision));
    };
    busy = true; message = ''; render();
    try {
      try { state = await commit(state); }
      catch (error) {
        if (!error.conflict) throw error;
        state = await commit(toState(await adapter.load()));
      }
      return true;
    } catch (error) {
      message = error.conflict ? 'Backlog changed on another device. Try again.' : error.message || 'Could not save the backlog.';
      if (error.conflict) state = toState(await adapter.load().catch(() => state));
      return false;
    } finally { busy = false; render(); }
  }

  async function add() {
    const text = draft.trim();
    if (!text) return;
    const task = newTask(text);
    if (await mutate(tasks => tasks.push(task))) draft = '';
    render();
    if (matchMedia('(pointer: fine)').matches) root.querySelector('.backlog-add textarea')?.focus();
  }

  function moveTo(id, lane) {
    const task = state?.document.tasks.find(value => value.id === id);
    if (!task || laneOf(task) === lane) return;
    if (lane === 'now' && state.document.tasks.filter(value => laneOf(value) === 'now').length >= NOW_LIMIT) {
      message = `Now is full (${NOW_LIMIT}). Move one out first.`;
      render();
      return;
    }
    if (lane === 'later') laterOpen = true;
    mutate(tasks => { const found = tasks.find(value => value.id === id); if (found) setLane(found, lane); });
  }

  function startEdit(id) {
    const task = state?.document.tasks.find(value => value.id === id);
    if (!task || task.done_at != null || task.request_id || disabled()) return;
    confirming = null; editing = id; editDraft = task.text;
    render('edit');
  }

  function stopEdit() { editing = null; editDraft = ''; render(); }

  async function saveEdit() {
    const id = editing, text = editDraft.trim();
    if (!id || !text) return;
    const task = state.document.tasks.find(value => value.id === id);
    if (task && task.text === text) return stopEdit();
    const saved = await mutate(tasks => { const found = tasks.find(value => value.id === id); if (found) found.text = text; });
    if (saved) stopEdit();
  }

  function closeConfirm() { confirming = null; render(); }

  root.addEventListener('click', event => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) { confirming = null; editing = null; tab = tabButton.dataset.tab; render(); return; }
    const chip = event.target.closest('[data-tag]');
    if (chip) { logTag = chip.dataset.tag; render(); return; }
    const button = event.target.closest('[data-action]');
    const action = button?.dataset.action;
    if (confirming && !event.target.closest('.backlog-trash-wrap')) { confirming = null; render(); }
    const id = button?.closest('[data-id]')?.dataset.id;
    if (action === 'retry') reload();
    else if (action === 'cancel-edit') stopEdit();
    else if (action === 'cancel-delete') closeConfirm();
    else if (action === 'toggle-later') { laterOpen = !laterOpen; render(); }
    else if (action === 'toggle-week') {
      const week = button.dataset.week;
      weekOpen.set(week, !(weekOpen.has(week) ? weekOpen.get(week) : [...root.querySelectorAll('[data-week]')].findIndex(item => item.dataset.week === week) < 2));
      render();
    }
    else if (action === 'expand') { if (!logOpen.delete(id)) logOpen.add(id); render(); }
    else if (action === 'move') moveTo(id, button.dataset.lane);
    else if (action === 'reopen') mutate(tasks => { const found = tasks.find(value => value.id === id); if (found) { found.done_at = null; setLane(found, 'inbox'); } });
    else if (action === 'delete') { confirming = confirming === id ? null : id; render(); }
    else if (action === 'confirm-delete') {
      confirming = null;
      mutate(tasks => { const index = tasks.findIndex(task => task.id === id); if (index >= 0) tasks.splice(index, 1); });
    } else if (!action) {
      // One click or tap on an open task's text edits it in place (not while selecting text to copy).
      const text = event.target.closest('.backlog-text.can-edit');
      const taskId = text?.closest('.backlog-task').dataset.id;
      if (!taskId || editing === taskId || event.target.closest('form') || getSelection().toString()) return;
      startEdit(taskId);
    }
  });
  // Clicks outside the backlog close an open delete confirmation.
  // The path is read from the event, since the click already redrew the list and removed the button.
  document.addEventListener('click', event => { if (confirming && !event.composedPath().includes(root)) closeConfirm(); });
  root.addEventListener('change', event => {
    if (event.target.dataset.action !== 'toggle') return;
    const id = event.target.closest('.backlog-task').dataset.id;
    mutate(tasks => { const task = tasks.find(value => value.id === id); if (task) { task.done_at = new Date().toISOString(); setLane(task, 'inbox'); } });
  });
  root.addEventListener('input', event => {
    if (event.target.name === 'text') draft = event.target.value;
    else if (event.target.name === 'edit') editDraft = event.target.value;
    else return;
    autosize();
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (editing) { event.preventDefault(); stopEdit(); }
      else if (confirming) { event.preventDefault(); closeConfirm(); }
      return;
    }
    // Enter saves on a desktop keyboard; Shift+Enter starts a new line.
    if ((event.target.name === 'text' || event.target.name === 'edit') && event.key === 'Enter'
        && !event.shiftKey && matchMedia('(pointer: fine)').matches) {
      event.preventDefault();
      if (event.target.name === 'edit') saveEdit(); else add();
    }
  });
  root.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.classList.contains('backlog-edit')) saveEdit(); else add();
  });

  return { reload, refresh, busy: () => busy,
    saveDraft: () => ({ tab, draft, editing, editDraft, laterOpen }),
    restoreDraft(saved) {
      tab = saved.tab === 'log' || saved.tab === 'completed' ? 'log' : 'board';
      laterOpen = !!saved.laterOpen;
      draft = String(saved.draft || '').slice(0, 2000);
      editing = typeof saved.editing === 'string' ? saved.editing : null;
      editDraft = String(saved.editDraft || '').slice(0, 2000);
      if (state) render();
    }
  };
}
