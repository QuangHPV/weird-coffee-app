import {
  NOW_LIMIT, newTask, splitMessage, joinMessage, laneOf, setLane, tagsOf, stripTags, previewLine, matchesQuery,
  groupByWeek, weekKey, dayKey, ageLabel, escapeHtml, renderMarkdown, normalizeDocument
} from './backlog-model.js';

// Mail model: folders (Now, Inbox, Later, Done) list one-line rows; a row opens in one editor pane.
// Narrow screens show the list or the editor; wide screens show both side by side.
const FOLDERS = [['now', 'Now'], ['inbox', 'Inbox'], ['later', 'Later'], ['done', 'Done']];
const NAMES = Object.fromEntries(FOLDERS);
const LANES = ['now', 'inbox', 'later'];
const EMPTY = { now: 'Nothing in Now', inbox: 'Inbox is empty', later: 'Nothing in Later', done: 'Nothing finished yet' };
const WIDE = 820;
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>';
const CHEVRON = '<svg class="bl-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const shortDay = day => new Date(`${day}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
const longDay = stamp => new Date(`${dayKey(stamp)}T00:00:00`).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const toState = result => ({ ...result, document: normalizeDocument(result.document), revision: Number(result.revision) });

function weekLabel(week) {
  if (week === weekKey(new Date().toISOString())) return 'This week';
  if (week === weekKey(new Date(Date.now() - 7 * 86400000).toISOString())) return 'Last week';
  const start = new Date(`${week}T00:00:00`), end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${shortDay(week)} to ${start.getMonth() === end.getMonth() ? end.getDate() : shortDay(dayKey(end.toISOString()))}`;
}

export function mountBacklog(root, adapter) {
  let state = null, folder = 'now', query = '', tag = '';
  let openId = null;                       // id of the task in the editor, 'new' for a task not saved yet
  let edit = null;                         // { title, body, mode: 'write' | 'preview', lane } of the open task
  let confirming = false, busy = false, loading = false, message = '', listScroll = 0;
  const weekOpen = new Map();              // week key -> shown or folded; the newest two weeks start shown
  const tasks = () => state?.document.tasks ?? [];
  const find = id => tasks().find(task => task.id === id);
  const disabled = () => busy || loading || state?.synced === false;
  const wide = () => root.clientWidth >= WIDE;
  const original = () => { const task = find(openId); return task ? splitMessage(task.text) : { title: '', body: '' }; };
  const dirty = () => !!edit && (openId === 'new' ? !!(edit.title.trim() || edit.body.trim())
    : edit.title.trim() !== original().title || edit.body.trim() !== original().body);
  const nowCount = () => tasks().filter(task => laneOf(task) === 'now').length;
  const q = selector => root.querySelector(selector);
  // The short title of the task another one was merged into (text before a colon, no #tags).
  const mergedTitle = id => {
    const target = find(id);
    return target ? stripTags(splitMessage(target.text).title).split(':')[0].trim() : 'a removed task';
  };

  const shell = () => `<div class="bl">
    <section class="bl-list-pane" aria-label="Tasks">
      <div class="bl-top">
        <input type="search" name="query" class="bl-search" placeholder="Search tasks" aria-label="Search tasks" autocomplete="off" enterkeyhint="search">
        <button type="button" class="bl-new" data-action="new" aria-label="New task">${PLUS}</button>
      </div>
      <div class="bl-folders" role="tablist" aria-label="Folders"></div>
      <div class="bl-chips" role="group" aria-label="Filter by tag"></div>
      <div class="bl-message" role="status"></div>
      <ul class="bl-list"></ul>
    </section>
    <section class="bl-detail-pane" aria-label="Task"></section>
  </div>`;

  const inFolder = name => tasks().filter(task => laneOf(task) === name);
  const searched = name => inFolder(name).filter(task => matchesQuery(task.text, query));
  const shown = name => searched(name).filter(task => !tag || tagsOf(task.text).includes(tag));

  function rowHtml(task) {
    const { title, body } = splitMessage(task.text);
    const total = Number(task.progress?.total) || 0, ticked = Math.min(Number(task.progress?.done) || 0, total);
    const open = openId === task.id;
    const preview = previewLine(body);
    return `<li><button type="button" class="bl-row ${open ? 'is-open' : ''}" data-action="open" data-id="${escapeHtml(task.id)}" ${open ? 'aria-current="true"' : ''}>
      <span class="bl-row-title"><span class="bl-row-name">${escapeHtml(stripTags(title) || title)}</span>${tagsOf(task.text).slice(0, 3).map(name => `<span class="bl-tag">${escapeHtml(name)}</span>`).join('')}</span>
      <span class="bl-row-side">${task.done_at ? shortDay(dayKey(task.done_at)) : ageLabel(task.created)}${total ? `<b>${ticked}/${total}</b>` : ''}</span>
      ${preview ? `<span class="bl-row-preview">${escapeHtml(preview)}</span>` : ''}
      ${total ? `<span class="bl-row-bar" role="img" aria-label="${ticked} of ${total} steps done"><i style="width:${Math.round(ticked / total * 100)}%"></i></span>` : ''}
    </button></li>`;
  }

  function paintList() {
    const filtering = !!(query.trim() || tag);
    q('.bl-folders').innerHTML = FOLDERS.map(([key, label]) =>
      `<button type="button" role="tab" class="bl-folder ${folder === key ? 'on' : ''}" data-folder="${key}" aria-selected="${folder === key}">${label}<b>${shown(key).length}</b></button>`).join('');
    const counts = new Map();
    for (const task of searched(folder)) for (const name of tagsOf(task.text)) counts.set(name, (counts.get(name) || 0) + 1);
    if (tag && !counts.has(tag)) counts.set(tag, 0);
    q('.bl-chips').innerHTML = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) =>
      `<button type="button" class="bl-chip ${tag === name ? 'on' : ''}" data-tag="${escapeHtml(name)}" aria-pressed="${tag === name}">${escapeHtml(name)}</button>`).join('');
    const rows = shown(folder);
    let html;
    if (!rows.length) html = `<li class="bl-empty">${filtering ? 'No matches' : EMPTY[folder]}</li>`;
    else if (folder === 'done') {
      html = groupByWeek(rows, 'done_at').map((group, index) => {
        const open = filtering || (weekOpen.has(group.week) ? weekOpen.get(group.week) : index < 2);
        return `<li class="bl-week-item"><button type="button" class="bl-week" data-action="toggle-week" data-week="${group.week}" aria-expanded="${open}">${escapeHtml(weekLabel(group.week))}<span>${group.tasks.length}</span>${CHEVRON}</button></li>${open ? group.tasks.map(rowHtml).join('') : ''}`;
      }).join('');
    } else {
      const ordered = folder === 'now' ? rows : [...rows].sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
      html = ordered.map(rowHtml).join('');
    }
    q('.bl-list').innerHTML = html;
    q('.bl').classList.toggle('has-detail', openId !== null);
  }

  function paintMessage() {
    q('.bl-message').textContent = message || (state?.synced === false ? 'Offline copy. Reconnect to edit.' : '');
  }

  function autosize() {
    for (const box of root.querySelectorAll('.bl-title-input, .bl-body-input')) { box.style.height = 'auto'; box.style.height = `${box.scrollHeight}px`; }
  }

  function syncSave() {
    const save = q('[data-action="save"]');
    if (save) save.disabled = !dirty() || disabled();
  }

  function paintDetail(focus = null) {
    const pane = q('.bl-detail-pane');
    const task = openId === 'new' ? null : find(openId);
    if (openId && openId !== 'new' && !task) { openId = null; edit = null; }
    if (!openId) { pane.innerHTML = '<div class="bl-blank">No task open</div>'; q('.bl').classList.remove('has-detail'); return; }
    const readonly = !!task?.request_id;
    const lane = task ? laneOf(task) : edit.lane;
    const total = Number(task?.progress?.total) || 0, ticked = Math.min(Number(task?.progress?.done) || 0, total);
    const meta = [task ? `Created ${longDay(task.created)}` : '', task?.done_at ? `Done ${longDay(task.done_at)}` : '',
      task?.merged_into ? `Merged into ${mergedTitle(task.merged_into)}` : '',
      task?.author_name ? `${task.author_name}${task.request_id ? ', request' : ''}` : ''].filter(Boolean).map(escapeHtml).join(' | ');
    const tools = `<div class="bl-tools">
      ${lane === 'done' ? '' : `<div class="bl-seg" role="group" aria-label="Move to">${LANES.map(name =>
        `<button type="button" class="bl-seg-btn ${lane === name ? 'on' : ''}" data-action="lane" data-lane="${name}" aria-pressed="${lane === name}">${NAMES[name]}</button>`).join('')}</div>`}
      ${task ? `<button type="button" class="bl-btn" data-action="finish">${lane === 'done' ? 'Reopen' : 'Mark done'}</button>` : ''}
      ${task && !readonly ? (confirming
        ? `<span class="bl-confirm" role="alertdialog" aria-label="Delete this task?">Delete this task?
            <button type="button" class="bl-btn danger" data-action="confirm-delete">Delete</button>
            <button type="button" class="bl-btn" data-action="cancel-delete">Keep</button></span>`
        : `<button type="button" class="bl-icon" data-action="delete" aria-label="Delete task" title="Delete">${TRASH}</button>`) : ''}
    </div>`;
    const editor = readonly
      ? `<h2 class="bl-title-read">${escapeHtml(stripTags(edit.title) || edit.title)}</h2><div class="bl-preview">${renderMarkdown(edit.body)}</div>`
      : `<textarea class="bl-title-input" name="title" rows="1" placeholder="Title" maxlength="200" aria-label="Title" autocomplete="off">${escapeHtml(edit.title)}</textarea>
        <div class="bl-modes" role="tablist" aria-label="Editor">
          <button type="button" role="tab" class="bl-mode ${edit.mode === 'write' ? 'on' : ''}" data-action="mode" data-mode="write" aria-selected="${edit.mode === 'write'}">Write</button>
          <button type="button" role="tab" class="bl-mode ${edit.mode === 'preview' ? 'on' : ''}" data-action="mode" data-mode="preview" aria-selected="${edit.mode === 'preview'}">Preview</button>
        </div>
        ${edit.mode === 'write'
          ? `<textarea class="bl-body-input" name="body" placeholder="Details, steps, notes. Markdown works." aria-label="Details" maxlength="1790">${escapeHtml(edit.body)}</textarea>`
          : `<div class="bl-preview">${edit.body.trim() ? renderMarkdown(edit.body) : '<p class="bl-quiet">Nothing to preview</p>'}</div>`}`;
    pane.innerHTML = `<div class="bl-bar">
        <button type="button" class="bl-btn" data-action="cancel">${readonly ? 'Close' : 'Cancel'}</button>
        <span class="bl-bar-title">${openId === 'new' ? 'New task' : NAMES[lane]}</span>
        ${readonly ? '<span class="bl-bar-gap"></span>' : `<button type="button" class="bl-btn primary" data-action="save">${openId === 'new' ? 'Add' : 'Save'}</button>`}
      </div>
      ${tools}${editor}
      ${total ? `<div class="bl-plan"><span>Plan, ${ticked} of ${total} steps</span><span class="bl-row-bar"><i style="width:${Math.round(ticked / total * 100)}%"></i></span></div>` : ''}
      ${meta ? `<p class="bl-meta">${meta}</p>` : ''}`;
    q('.bl').classList.add('has-detail');
    autosize();
    syncSave();
    const target = focus || (openId === 'new' ? 'title' : null);
    if (target && !readonly) q(target === 'body' ? '.bl-body-input' : '.bl-title-input')?.focus();
  }

  function paintAll() { if (!state) return; paintList(); paintMessage(); paintDetail(); }

  function render() {
    if (!state) {
      root.innerHTML = `<div class="bl-loading" role="status">${escapeHtml(message || 'Loading backlog…')}</div>${message ? '<button type="button" class="bl-btn" data-action="retry">Retry</button>' : ''}`;
      return;
    }
    if (!q('.bl')) { root.innerHTML = shell(); q('[name=query]').value = query; }
    paintAll();
  }

  function resetEdit() {
    const task = find(openId);
    if (task) { const { title, body } = splitMessage(task.text); edit = { title, body, mode: edit?.mode || 'write', lane: laneOf(task) }; }
  }

  async function reload() {
    if (loading || busy) return;
    loading = true;
    try { state = toState(await adapter.load()); message = ''; }
    catch (error) { message = error.message || 'Could not load the backlog.'; }
    finally {
      loading = false;
      if (state && openId && openId !== 'new' && !dirty()) resetEdit();
      render();
    }
  }

  // Quiet check for changes made on another device. It leaves the screen alone while a task is
  // being edited or saved, and redraws only when the saved copy is newer.
  async function refresh() {
    if (!state) return reload();
    if (loading || busy || dirty() || root.contains(document.activeElement) && document.activeElement.name === 'query') return;
    try {
      const next = toState(await adapter.load());
      if (loading || busy || dirty()) return;
      if (next.revision === state.revision && next.synced === state.synced) return;
      state = next; message = '';
      if (openId && openId !== 'new') { if (find(openId)) resetEdit(); else closeDetail(); }
      paintAll();
    } catch { /* keep what is on screen; the next check tries again */ }
  }

  // Apply a change and save it. If another device saved first, redo the change on its copy once.
  async function mutate(change) {
    if (!state || disabled()) return false;
    const commit = async base => {
      const list = structuredClone(base.document.tasks);
      change(list);
      return toState(await adapter.save({ tasks: list }, base.revision));
    };
    busy = true; message = ''; root.dataset.busy = ''; syncSave();
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
    } finally { busy = false; delete root.dataset.busy; paintList(); paintMessage(); syncSave(); }
  }

  function openTask(id) {
    const task = find(id);
    if (!task) return;
    const first = openId === null;
    openId = id; confirming = false; resetEdit(); edit.mode = 'write';
    if (first) { listScroll = window.scrollY; adapter.enterDetail?.(); if (!wide()) window.scrollTo(0, 0); }
    paintList(); paintDetail(wide() && matchMedia('(pointer: fine)').matches ? 'body' : null);
  }

  function startNew() {
    if (disabled()) return;
    const first = openId === null;
    openId = 'new'; confirming = false;
    edit = { title: '', body: '', mode: 'write', lane: folder === 'now' || folder === 'later' ? folder : 'inbox' };
    if (first) { listScroll = window.scrollY; adapter.enterDetail?.(); if (!wide()) window.scrollTo(0, 0); }
    paintList(); paintDetail('title');
  }

  function closeDetail({ fromHistory = false } = {}) {
    const wasOpen = openId !== null;
    openId = null; edit = null; confirming = false;
    if (state) { paintList(); paintDetail(); }
    if (wasOpen) { if (!wide()) window.scrollTo(0, listScroll); if (!fromHistory) adapter.exitDetail?.(); }
  }

  const fits = lane => lane !== 'now' || nowCount() < NOW_LIMIT;
  const full = () => { message = `Now is full (${NOW_LIMIT}). Move one out first.`; paintMessage(); };

  // Save the open task. Returns true if it is saved or nothing changed.
  async function saveTask() {
    if (!edit || disabled()) return false;
    const title = edit.title.trim();
    if (!dirty()) return true;
    if (!title) { message = 'Add a title.'; paintMessage(); return false; }
    const text = joinMessage(title, edit.body);
    if (openId === 'new') {
      if (!fits(edit.lane)) { full(); return false; }
      const task = newTask(text);
      setLane(task, edit.lane);
      if (!await mutate(list => list.push(task))) return false;
      folder = edit.lane; openId = task.id;
    } else {
      const id = openId;
      if (!await mutate(list => { const found = list.find(value => value.id === id); if (found) found.text = text; })) return false;
    }
    resetEdit();
    return true;
  }

  async function onSave() {
    if (!await saveTask()) return;
    if (wide()) { paintList(); paintDetail(); } else closeDetail();
  }

  // Lane, done and delete keep any unsaved text with them.
  async function change(apply, { follow = null, remove = false } = {}) {
    const id = openId;
    if (id === 'new') return;
    const text = edit && edit.title.trim() ? joinMessage(edit.title, edit.body) : null;
    const saved = await mutate(list => {
      const index = list.findIndex(value => value.id === id);
      if (index < 0) return;
      if (remove) { list.splice(index, 1); return; }
      if (text && !list[index].request_id) list[index].text = text;
      apply(list[index]);
    });
    if (!saved) return;
    if (follow) folder = follow;
    if (remove || !wide()) closeDetail();
    else { resetEdit(); paintList(); paintDetail(); }
  }

  const onLane = lane => {
    if (openId === 'new') { edit.lane = lane; paintDetail(); return; }
    const task = find(openId);
    if (!task || laneOf(task) === lane) return;
    if (!fits(lane)) return full();
    change(found => setLane(found, lane), { follow: lane });
  };
  const onFinish = () => {
    const task = find(openId);
    if (!task) return;
    const reopen = task.done_at != null;
    change(found => { found.done_at = reopen ? null : new Date().toISOString(); setLane(found, 'inbox'); }, { follow: reopen ? 'inbox' : 'done' });
  };

  // Moving to another task keeps what was typed on the open one.
  async function leaveOpen() {
    if (openId !== null && dirty() && openId !== 'new') return saveTask();
    return true;
  }

  root.addEventListener('click', async event => {
    const folderButton = event.target.closest('[data-folder]');
    if (folderButton) { folder = folderButton.dataset.folder; paintList(); return; }
    const chip = event.target.closest('[data-tag]');
    if (chip) { tag = tag === chip.dataset.tag ? '' : chip.dataset.tag; paintList(); return; }
    const button = event.target.closest('[data-action]');
    const action = button?.dataset.action;
    if (!action) return;
    if (action === 'retry') reload();
    else if (action === 'new') { if (await leaveOpen()) startNew(); }
    else if (action === 'open') { if (button.dataset.id !== openId && await leaveOpen()) openTask(button.dataset.id); }
    else if (action === 'toggle-week') {
      weekOpen.set(button.dataset.week, button.getAttribute('aria-expanded') !== 'true');
      paintList();
    } else if (action === 'cancel') closeDetail();
    else if (action === 'save') onSave();
    else if (action === 'lane') onLane(button.dataset.lane);
    else if (action === 'finish') onFinish();
    else if (action === 'delete') { confirming = true; paintDetail(); }
    else if (action === 'cancel-delete') { confirming = false; paintDetail(); }
    else if (action === 'confirm-delete') change(() => {}, { remove: true });
    else if (action === 'mode') { edit.mode = button.dataset.mode; paintDetail(edit.mode === 'write' ? 'body' : null); }
  });

  root.addEventListener('input', event => {
    const name = event.target.name;
    if (name === 'query') { query = event.target.value; paintList(); }
    else if (name === 'title') { edit.title = event.target.value; autosize(); syncSave(); }
    else if (name === 'body') { edit.body = event.target.value; autosize(); syncSave(); }
  });

  root.addEventListener('keydown', event => {
    const name = event.target.name;
    if (event.key === 'Escape') {
      if (confirming) { event.preventDefault(); confirming = false; paintDetail(); }
      else if (name === 'query' && query) { event.preventDefault(); query = ''; event.target.value = ''; paintList(); }
      else if (openId !== null && (name === 'title' || name === 'body')) { event.preventDefault(); closeDetail(); }
      return;
    }
    if ((name === 'title' || name === 'body') && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSave();
    } else if (name === 'title' && event.key === 'Enter') {
      event.preventDefault();
      if (edit.mode === 'write') q('.bl-body-input')?.focus();
    }
  });

  return { reload, refresh,
    busy: () => busy || dirty(),
    detailOpen: () => openId !== null,
    // The phone's back gesture: keep what was typed, then return to the list.
    async leave() {
      if (openId === null) return;
      if (dirty()) await saveTask();
      closeDetail({ fromHistory: true });
    },
    saveDraft: () => ({ folder, query, tag, openId, edit }),
    restoreDraft(saved) {
      folder = FOLDERS.some(([key]) => key === saved.folder) ? saved.folder : 'now';
      query = String(saved.query || '').slice(0, 200); tag = String(saved.tag || '');
      if (typeof saved.openId === 'string' && saved.edit) {
        openId = saved.openId;
        edit = { title: String(saved.edit.title || '').slice(0, 200), body: String(saved.edit.body || '').slice(0, 1790), mode: 'write', lane: LANES.includes(saved.edit.lane) ? saved.edit.lane : 'inbox' };
      }
      if (state) render();
    }
  };
}
