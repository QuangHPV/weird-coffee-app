import { newTask, splitMessage, hasTime, groupByDay, normalizeDocument } from './backlog-model.js';

const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// #tags in a message are highlighted.
const tagged = text => escapeText(text).replace(/(^|[\s(])(#[\p{L}\p{N}_-]+)/gu, '$1<span class="backlog-tag">$2</span>');
const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>';
const dayLabel = day => new Date(`${day}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
const timeLabel = stamp => hasTime(stamp) ? new Date(stamp).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' }) : '';
const toState = result => ({ ...result, document: normalizeDocument(result.document), revision: Number(result.revision) });

export function mountBacklog(root, adapter) {
  let state = null, tab = 'todo', busy = false, loading = false, message = '', draft = '', armed = null, armTimer = null;
  const disabled = () => busy || loading || state?.synced === false;

  function renderTask(task, field) {
    const { title, body } = splitMessage(task.text);
    const done = task.done_at != null;
    const time = timeLabel(task[field]);
    return `<li class="backlog-task ${done ? 'is-done' : ''}" data-id="${escapeText(task.id)}">
      <input type="checkbox" data-action="toggle" ${done ? 'checked' : ''} ${disabled() ? 'disabled' : ''}
        aria-label="${done ? 'Move back to TODO' : 'Complete'}: ${escapeText(title)}">
      <div class="backlog-text"><div class="backlog-title">${tagged(title)}</div>
        ${body ? `<div class="backlog-body">${tagged(body)}</div>` : ''}${time ? `<div class="backlog-time">${time}</div>` : ''}</div>
      <button type="button" class="backlog-trash ${armed === task.id ? 'armed' : ''}" data-action="delete" ${disabled() ? 'disabled' : ''}
        aria-label="${armed === task.id ? 'Tap again to delete' : 'Delete'}: ${escapeText(title)}"
        title="${armed === task.id ? 'Tap again to delete' : 'Delete'}">${TRASH}</button>
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

  function render() {
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
  }

  function autosize() {
    const box = root.querySelector('.backlog-add textarea');
    if (box) { box.style.height = 'auto'; box.style.height = `${box.scrollHeight}px`; }
  }

  async function reload() {
    if (loading || busy) return;
    loading = true;
    try { state = toState(await adapter.load()); message = ''; }
    catch (error) { message = error.message || 'Could not load the backlog.'; }
    finally { loading = false; render(); }
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

  function disarm() { clearTimeout(armTimer); armed = null; }

  async function add() {
    const text = draft.trim();
    if (!text) return;
    const task = newTask(text);
    if (await mutate(tasks => tasks.push(task))) draft = '';
    render();
    if (matchMedia('(pointer: fine)').matches) root.querySelector('.backlog-add textarea')?.focus();
  }

  root.addEventListener('click', event => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) { disarm(); tab = tabButton.dataset.tab; render(); return; }
    const button = event.target.closest('[data-action]');
    if (armed && button?.dataset.action !== 'delete') { disarm(); render(); }
    if (button?.dataset.action === 'retry') reload();
    if (button?.dataset.action !== 'delete') return;
    const id = button.closest('.backlog-task').dataset.id;
    if (armed !== id) {
      disarm(); armed = id; armTimer = setTimeout(() => { armed = null; render(); }, 3000); render();
      return;
    }
    disarm();
    mutate(tasks => { const index = tasks.findIndex(task => task.id === id); if (index >= 0) tasks.splice(index, 1); });
  });
  root.addEventListener('change', event => {
    if (event.target.dataset.action !== 'toggle') return;
    const id = event.target.closest('.backlog-task').dataset.id, done = event.target.checked;
    mutate(tasks => { const task = tasks.find(value => value.id === id); if (task) task.done_at = done ? new Date().toISOString() : null; });
  });
  root.addEventListener('input', event => {
    if (event.target.name !== 'text') return;
    draft = event.target.value;
    autosize();
  });
  root.addEventListener('keydown', event => {
    // Enter adds on a desktop keyboard; Shift+Enter starts a new line.
    if (event.target.name === 'text' && event.key === 'Enter' && !event.shiftKey && matchMedia('(pointer: fine)').matches) {
      event.preventDefault();
      add();
    }
  });
  root.addEventListener('submit', event => { event.preventDefault(); add(); });

  return { reload };
}
