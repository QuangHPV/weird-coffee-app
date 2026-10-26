import { newTask, splitMessage, hasTime, groupByDay, normalizeDocument } from './backlog-model.js';

const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// #tags in a message are highlighted.
const tagged = text => escapeText(text).replace(/(^|[\s(])(#[\p{L}\p{N}_-]+)/gu, '$1<span class="backlog-tag">$2</span>');
const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>';
const dayLabel = day => new Date(`${day}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
const timeLabel = stamp => hasTime(stamp) ? new Date(stamp).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' }) : '';
const toState = result => ({ ...result, document: normalizeDocument(result.document), revision: Number(result.revision) });
const DOUBLE_CLICK_MS = 400;

export function mountBacklog(root, adapter) {
  let state = null, tab = 'todo', busy = false, loading = false, message = '', draft = '';
  let confirming = null;                 // id of the task whose delete confirmation is open
  let editing = null, editDraft = '';    // id and text of the TODO being edited
  let lastClick = { id: null, time: 0 };
  const disabled = () => busy || loading || state?.synced === false;

  function renderTask(task, field) {
    const { title, body } = splitMessage(task.text);
    const done = task.done_at != null;
    const time = timeLabel(task[field]);
    const open = confirming === task.id;
    const content = editing === task.id
      ? `<form class="backlog-edit"><textarea name="edit" rows="2" maxlength="2000" aria-label="Edit task">${escapeText(editDraft)}</textarea>
          <div class="backlog-edit-actions"><button type="submit" ${disabled() ? 'disabled' : ''}>Save</button>
          <button type="button" data-action="cancel-edit">Cancel</button></div></form>`
      : `<div class="backlog-title">${tagged(title)}</div>
        ${body ? `<div class="backlog-body">${tagged(body)}</div>` : ''}
        ${task.author_name ? `<div class="backlog-author">By ${escapeText(task.author_name)}${task.request_id ? ', Feature request' : ''}</div>` : ''}
        ${time ? `<div class="backlog-time">${time}</div>` : ''}`;
    return `<li class="backlog-task ${done ? 'is-done' : ''}" data-id="${escapeText(task.id)}">
      <input type="checkbox" data-action="toggle" ${done ? 'checked' : ''} ${disabled() ? 'disabled' : ''}
        aria-label="${done ? 'Move back to TODO' : 'Complete'}: ${escapeText(title)}">
      <div class="backlog-text ${done || task.request_id ? '' : 'can-edit'}">${content}</div>
      ${task.request_id ? '' : `<div class="backlog-trash-wrap">
        <button type="button" class="backlog-trash ${open ? 'armed' : ''}" data-action="delete" ${disabled() ? 'disabled' : ''}
          aria-haspopup="true" aria-expanded="${open}" aria-label="Delete: ${escapeText(title)}" title="Delete">${TRASH}</button>
        ${open ? `<div class="backlog-confirm" role="alertdialog" aria-label="Delete this task?"><span>Delete this task?</span>
          <button type="button" class="backlog-confirm-yes" data-action="confirm-delete">Delete</button>
          <button type="button" data-action="cancel-delete">Cancel</button></div>` : ''}
      </div>`}
    </li>`;
  }

  function renderList(name, tasks, field, empty) {
    const groups = groupByDay(tasks, field).map(group => `<div class="backlog-group">
      <h4 class="backlog-day">${escapeText(dayLabel(group.day))}</h4>
      <ul class="backlog-tasks">${group.tasks.map(task => renderTask(task, field)).join('')}</ul></div>`).join('');
    return `<section class="backlog-list" role="tabpanel" aria-label="${name}">
      ${name === 'TODO' ? `<form class="backlog-add"><textarea name="text" rows="1" maxlength="2000" aria-label="New TODO"
        placeholder="Add a TODO. #tags are highlighted." ${disabled() ? 'disabled' : ''}>${escapeText(draft)}</textarea>
        <button type="submit" ${disabled() ? 'disabled' : ''}>Add</button></form>` : ''}
      ${groups || `<p class="backlog-empty">${empty}</p>`}</section>`;
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
    const todo = state.document.tasks.filter(task => task.done_at == null);
    const completed = state.document.tasks.filter(task => task.done_at != null);
    const tabs = [['todo', 'TODO', todo], ['completed', 'Completed', completed]];
    root.innerHTML = `<div class="backlog-tabs" role="tablist" aria-label="Backlog lists">${tabs.map(([key, name, list]) =>
        `<button type="button" role="tab" data-tab="${key}" aria-selected="${tab === key}" class="${tab === key ? 'active' : ''}">${name}<span>${list.length}</span></button>`).join('')}</div>
      <div class="backlog-message" role="status">${escapeText(message || (state.synced === false ? 'Offline copy. Reconnect to edit.' : ''))}</div>
      ${tab === 'todo' ? renderList('TODO', todo, 'created', 'Nothing to do.') : renderList('Completed', completed, 'done_at', 'Nothing completed yet.')}`;
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
    const button = event.target.closest('[data-action]');
    const action = button?.dataset.action;
    if (confirming && !event.target.closest('.backlog-trash-wrap')) { confirming = null; render(); }
    if (action === 'retry') reload();
    else if (action === 'cancel-edit') stopEdit();
    else if (action === 'cancel-delete') closeConfirm();
    else if (action === 'delete') {
      const id = button.closest('.backlog-task').dataset.id;
      confirming = confirming === id ? null : id;
      render();
    } else if (action === 'confirm-delete') {
      const id = button.closest('.backlog-task').dataset.id;
      confirming = null;
      mutate(tasks => { const index = tasks.findIndex(task => task.id === id); if (index >= 0) tasks.splice(index, 1); });
    } else if (!action) {
      // Two clicks (or taps) within 400 ms on an open TODO's text start editing.
      const text = event.target.closest('.backlog-text.can-edit');
      const id = text?.closest('.backlog-task').dataset.id;
      if (!id || editing === id || event.target.closest('form')) return;
      if (lastClick.id === id && event.timeStamp - lastClick.time < DOUBLE_CLICK_MS) {
        lastClick = { id: null, time: 0 };
        startEdit(id);
      } else lastClick = { id, time: event.timeStamp };
    }
  });
  // Clicks outside the backlog close an open delete confirmation.
  // The path is read from the event, since the click already redrew the list and removed the button.
  document.addEventListener('click', event => { if (confirming && !event.composedPath().includes(root)) closeConfirm(); });
  root.addEventListener('change', event => {
    if (event.target.dataset.action !== 'toggle') return;
    const id = event.target.closest('.backlog-task').dataset.id, done = event.target.checked;
    mutate(tasks => { const task = tasks.find(value => value.id === id); if (task) task.done_at = done ? new Date().toISOString() : null; });
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
    saveDraft: () => ({ tab, draft, editing, editDraft }),
    restoreDraft(saved) {
      tab = saved.tab === 'completed' ? 'completed' : 'todo';
      draft = String(saved.draft || '').slice(0, 2000);
      editing = typeof saved.editing === 'string' ? saved.editing : null;
      editDraft = String(saved.editDraft || '').slice(0, 2000);
      if (state) render();
    }
  };
}
