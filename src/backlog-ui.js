import { BATCH_LIMIT, id, newItem, subtreeEnd, checkboxState, syncCompletion, toggleTask,
  addSubtask, deleteTask, moveTask, queueTask, queueBucket, pendingBucket, batchSize,
  normalizeDocument } from './backlog-model.js';

const STAGES = [['collecting', 'Collecting'], ['pending', 'Pending'], ['in_progress', 'In progress'], ['done', 'Done']];
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const ICONS = {
  edit: '<path d="m14 4 6 6M4 20l4-1L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  queue: '<path d="M3 5h11M3 10h8M3 15h6m4 2h8m-4-4 4 4-4 4"/>',
  child: '<path d="M5 3v10h9m0-4v8m-4-4h8"/>',
  more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

export function mountBacklog(root, adapter) {
  let state = null, stage = 'pending', editing = null, busy = false, loading = false, message = '';
  const opened = new Set(), collapsed = new Set(), drafts = new Map();
  let menu = null;
  let drag = null, suppressClick = 0, scrollFrame = null;
  const getBucket = bucketId => state.document.buckets.find(bucket => bucket.id === bucketId);
  const disabled = () => busy || loading || state?.synced === false;
  const action = (name, glyph, label, attributes = '') => `<button type="button" class="backlog-icon-button" data-action="${name}" aria-label="${escapeText(label)}" title="${escapeText(label)}" ${attributes} ${disabled() ? 'disabled' : ''}>${icon(glyph)}</button>`;

  function render() {
    if (!state) {
      root.innerHTML = `<div class="backlog-loading" role="status">${escapeText(message || 'Loading backlog…')}</div>${message ? '<button type="button" data-action="retry">Retry</button>' : ''}`;
      return;
    }
    const buckets = state.document.buckets, visible = buckets.filter(bucket => bucket.stage === stage);
    const editorBucket = editing?.bucketId ? getBucket(editing.bucketId) : null;
    const detachedEditor = editing && (!editorBucket || (editing.itemId && !editorBucket.items.some(item => item.id === editing.itemId)));
    root.innerHTML = `<div class="backlog-top"><h2>Backlog</h2><button class="backlog-primary" data-action="new-bucket" type="button" ${disabled() ? 'disabled' : ''}>New bucket</button></div>
      <div class="backlog-stages" role="tablist" aria-label="Backlog stage">${STAGES.map(([key, label]) => `<button type="button" role="tab" data-stage="${key}" aria-selected="${stage === key}" class="${stage === key ? 'active' : ''}">${label}<span>${buckets.filter(bucket => bucket.stage === key).length}</span></button>`).join('')}</div>
      <div class="backlog-message" role="status">${escapeText(message || (state.synced === false ? 'Offline copy. Reconnect to edit.' : ''))}</div>
      ${detachedEditor ? renderEditor() : ''}<div class="backlog-buckets">${visible.map(renderBucket).join('') || (stage === 'pending'
        ? '<div class="backlog-empty backlog-pending-drop" data-drop-bucket="__pending__"><strong>Next batch</strong><span>Pick tasks from Collecting</span></div>'
        : '<div class="backlog-empty">No buckets here yet.</div>')}</div>`;
    root.querySelectorAll('[data-mixed="true"]').forEach(input => { input.indeterminate = true; });
    root.classList.toggle('backlog-busy', busy);
  }

  function renderBucket(bucket) {
    const expanded = opened.has(bucket.id), tasks = bucket.items.filter(item => !item.note);
    const remaining = batchSize(bucket), count = tasks.filter(item => item.done).length;
    const attrs = `data-bucket="${escapeText(bucket.id)}"`;
    return `<article class="backlog-bucket" ${attrs} data-drop-bucket="${escapeText(bucket.id)}">
      <div class="backlog-bucket-head"><button class="backlog-expand" type="button" data-action="expand" ${attrs} aria-expanded="${expanded}">
        <span class="backlog-bucket-name"><span class="backlog-chevron" aria-hidden="true">${expanded ? '▾' : '▸'}</span>${escapeText(bucket.title)}</span><span class="backlog-bucket-meta">${count}/${tasks.length}</span></button>
        <div class="backlog-bucket-actions">${bucket.stage === 'collecting' && bucket.items.length ? action('queue-bucket', 'queue', 'Move bucket tasks to Pending', attrs) : ''}${action('edit-bucket', 'edit', `Edit ${bucket.title}`, attrs)}${action('delete-bucket', 'trash', `Delete ${bucket.title}`, attrs)}</div></div>
      ${['pending', 'in_progress'].includes(bucket.stage) && remaining > BATCH_LIMIT ? `<div class="backlog-batch-warning" role="status" title="More than ${BATCH_LIMIT} unfinished leaf tasks. Consider a smaller batch.">Large batch · ${remaining} tasks remaining</div>` : ''}
      ${editing?.bucketId === bucket.id && !editing.itemId ? renderEditor() : ''}
      ${expanded ? `<div class="backlog-bucket-body"><div class="backlog-items">${bucket.items.map((item, index) => {
          const hidden = bucket.items.slice(0, index).some((parent, i) => collapsed.has(parent.id) && subtreeEnd(bucket.items, i) > index);
          return hidden ? '' : renderItem(bucket, item, index);
        }).join('')}</div>
        <form class="backlog-add-item" ${attrs}><input name="text" maxlength="1000" placeholder="Add a task" aria-label="New task in ${escapeText(bucket.title)}" value="${escapeText(drafts.get(bucket.id) || '')}" required ${disabled() ? 'disabled' : ''}><button type="submit" ${disabled() ? 'disabled' : ''}>Add</button></form></div>` : ''}</article>`;
  }

  function renderItem(bucket, item, index) {
    const status = item.note ? 'empty' : checkboxState(bucket.items, index);
    const attrs = `data-bucket="${escapeText(bucket.id)}" data-item="${escapeText(item.id)}"`;
    const parent = subtreeEnd(bucket.items, index) > index + 1;
    const source = Array.isArray(item.sourcePath) ? item.sourcePath.join(' / ') : '';
    return `<div class="backlog-item ${status === 'checked' ? 'is-done' : ''} ${item.note ? 'is-note' : ''} ${item.depth ? 'is-child' : ''}" ${attrs} style="--depth:${item.depth}">
      ${parent ? `<button type="button" class="backlog-task-caret" data-action="collapse-task" ${attrs} aria-label="${collapsed.has(item.id) ? 'Expand' : 'Collapse'} subtasks" aria-expanded="${!collapsed.has(item.id)}">${collapsed.has(item.id) ? '▸' : '▾'}</button>` : '<span class="backlog-caret-space"></span>'}
      ${item.note ? '<span class="backlog-note-mark">•</span>' : `<input type="checkbox" data-action="toggle-item" ${attrs} data-mixed="${status === 'mixed'}" aria-checked="${status === 'mixed' ? 'mixed' : status === 'checked'}" aria-label="Complete ${escapeText(item.text)}" ${status === 'checked' ? 'checked' : ''} ${disabled() ? 'disabled' : ''}>`}
      <div class="backlog-item-copy"><div class="backlog-item-text" role="button" tabindex="0" aria-label="Edit ${escapeText(item.text)}" title="Double-click to edit; drag to move" ${attrs}>${escapeText(item.text)}</div>${source ? `<div class="backlog-source" title="From ${escapeText(source)}">${escapeText(source)}</div>` : ''}</div>
      <div class="backlog-item-actions">${bucket.stage !== 'pending' ? action('queue-item', 'queue', 'Move task to Pending', attrs) : ''}${action('task-menu', 'more', 'Task actions', attrs)}</div>
      ${menu?.itemId === item.id ? renderMenu(attrs, item) : ''}</div>
      ${editing?.itemId === item.id && editing.bucketId === bucket.id ? renderEditor() : ''}`;
  }

  function renderMenu(attrs, item) {
    return `<div class="backlog-task-menu" role="menu" aria-label="Task actions">
      <button type="button" role="menuitem" data-action="edit-item" ${attrs}>Edit task</button>
      ${!item.note && item.depth < 8 ? `<button type="button" role="menuitem" data-action="add-child" ${attrs}>Add subtask</button>` : ''}
      <button type="button" role="menuitem" data-action="edit-item" ${attrs}>Move to…</button>
      <button type="button" role="menuitem" data-action="delete-item" ${attrs}>Delete task and subtasks</button>
    </div>`;
  }

  function renderEditor() {
    if (editing.type === 'delete') return `<section class="backlog-editor backlog-delete" aria-labelledby="backlogEditorTitle" tabindex="-1">
      <h3 id="backlogEditorTitle">${editing.itemId ? 'Delete task?' : 'Delete bucket?'}</h3><p>${escapeText(editing.label)}</p><p class="backlog-delete-detail">${editing.count ? `Includes ${editing.count} ${editing.itemId ? 'subtasks and notes' : 'tasks and notes'}.` : ''}</p>
      <div class="backlog-editor-actions"><button type="button" data-action="close-editor">Cancel</button><button class="backlog-danger" type="button" data-action="confirm-delete" ${busy ? 'disabled' : ''}>Delete</button></div><div role="status" class="backlog-message">${escapeText(message)}</div></section>`;
    const bucket = editing.bucketId ? getBucket(editing.bucketId) : null;
    const isBucket = editing.type === 'bucket', isChild = editing.type === 'child';
    return `<form class="backlog-editor" id="backlogEditor" aria-labelledby="backlogEditorTitle">
      <div class="backlog-editor-head"><h3 id="backlogEditorTitle">${isBucket ? (bucket ? 'Edit bucket' : 'New bucket') : isChild ? 'Add subtask' : 'Edit task'}</h3>${action('close-editor', 'close', 'Close')}</div>
      ${isChild ? `<p class="backlog-parent-label">${escapeText(bucket?.items.find(item => item.id === editing.itemId)?.text)}</p>` : ''}
      <label>${isBucket ? 'Name' : 'Task'}<textarea name="text" maxlength="${isBucket ? 200 : 1000}" rows="${isBucket ? 2 : 3}" placeholder="${isBucket ? 'e.g. Mobile UI v3' : ''}" required>${escapeText(editing.text)}</textarea></label>
      ${isBucket && bucket ? `<div class="backlog-editor-label">Stage</div><div class="backlog-stage-choices">${STAGES.map(([key, label]) => `<button type="button" data-action="choose-stage" data-value="${key}" aria-pressed="${editing.stage === key}">${label}</button>`).join('')}</div>` : ''}
      ${!isBucket && !isChild ? `<label class="backlog-check-label"><input type="checkbox" name="note" ${editing.note ? 'checked' : ''}>Note</label><div class="backlog-editor-label">Move with subtasks to</div><div class="backlog-targets">${state.document.buckets.map(value => `<button type="button" data-action="choose-target" data-value="${escapeText(value.id)}" aria-pressed="${editing.targetId === value.id}">${escapeText(value.title)}</button>`).join('')}</div>` : ''}
      <div class="backlog-editor-actions"><button type="button" data-action="close-editor">Cancel</button><button class="backlog-primary" type="submit" ${busy ? 'disabled' : ''}>${isChild ? 'Add' : 'Save'}</button></div><div role="status" class="backlog-message">${escapeText(message)}</div></form>`;
  }

  function showEditor(value) {
    editing = value; menu = null; message = '';
    if (value.bucketId) opened.add(value.bucketId);
    render();
    (root.querySelector('.backlog-editor textarea') || root.querySelector('.backlog-editor button'))?.focus();
    root.querySelector('.backlog-editor')?.scrollIntoView({ block: 'nearest' });
  }
  function changeStage(next) {
    menu = null; stage = next;
    const first = state?.document.buckets.find(bucket => bucket.stage === stage);
    if (first) opened.add(first.id);
    render();
  }
  async function reload() {
    if (loading || busy || editing || drag) return;
    loading = true;
    try {
      const result = await adapter.load();
      state = { ...result, document: normalizeDocument(result.document), revision: Number(result.revision) };
      const first = state.document.buckets.find(bucket => bucket.stage === stage);
      if (first && !opened.size) opened.add(first.id);
      message = '';
    } catch (error) { message = error.message || 'Could not load the backlog.'; }
    finally { loading = false; render(); }
  }
  async function mutate(change) {
    if (!state || disabled()) return false;
    const next = structuredClone(state.document);
    busy = true; message = ''; render();
    try {
      change(next.buckets);
      next.buckets.forEach(bucket => syncCompletion(bucket.items));
      const result = await adapter.save(next, state.revision);
      state = { ...result, document: normalizeDocument(result.document), revision: Number(result.revision) };
      editing = null;
      return true;
    } catch (error) {
      if (error.conflict) {
        const latest = await adapter.load().catch(() => null);
        if (latest) state = { ...latest, document: normalizeDocument(latest.document), revision: Number(latest.revision) };
        // Keep typed work as a draft; save again against the refreshed revision.
        if (editing?.itemId) {
          const moved = state.document.buckets.find(bucket => bucket.items.some(item => item.id === editing.itemId));
          if (moved) { editing.bucketId = moved.id; editing.targetId = moved.id; stage = moved.stage; opened.add(moved.id); }
        }
        message = 'Changed on another device. Latest changes loaded; review and try again.';
      } else message = error.message || 'Could not save. Your draft is still here.';
      return false;
    } finally { busy = false; render(); }
  }
  function askDelete(bucketId, itemId = null) {
    const bucket = getBucket(bucketId), index = bucket.items.findIndex(item => item.id === itemId);
    showEditor({ type: 'delete', bucketId, itemId, label: itemId ? bucket.items[index].text : bucket.title,
      count: itemId ? subtreeEnd(bucket.items, index) - index - 1 : bucket.items.length });
  }

  root.addEventListener('input', event => {
    if (event.target.closest('.backlog-add-item')) drafts.set(event.target.closest('form').dataset.bucket, event.target.value);
    if (editing && event.target.name === 'text' && event.target.closest('#backlogEditor')) editing.text = event.target.value;
  });
  root.addEventListener('click', async event => {
    if (Date.now() < suppressClick) { event.preventDefault(); return; }
    const button = event.target.closest('[data-action], [data-stage]');
    if (!button || !root.contains(button)) return;
    if (button.dataset.stage) { if (!editing) changeStage(button.dataset.stage); return; }
    const { action: kind, bucket: bucketId, item: itemId } = button.dataset;
    if (kind === 'retry') { reload(); return; }
    if (kind === 'close-editor') {
      if (!busy) { editing = null; message = ''; render(); } return;
    }
    if (editing && !button.closest('.backlog-editor')) return;
    if (kind === 'collapse-task') { collapsed.has(itemId) ? collapsed.delete(itemId) : collapsed.add(itemId); render(); return; }
    if (kind === 'expand') { opened.has(bucketId) ? opened.delete(bucketId) : opened.add(bucketId); render(); return; }
    if (disabled()) return;
    if (kind === 'task-menu') { openMenu(bucketId, itemId); return; }
    if (kind === 'new-bucket') { showEditor({ type: 'bucket', text: '', stage: 'collecting' }); return; }
    if (kind === 'edit-bucket') { const bucket = getBucket(bucketId); showEditor({ type: 'bucket', bucketId, text: bucket.title, stage: bucket.stage }); return; }
    if (kind === 'edit-item') { const item = getBucket(bucketId).items.find(value => value.id === itemId); showEditor({ type: 'item', bucketId, itemId, text: item.text, note: item.note, targetId: bucketId }); return; }
    if (kind === 'add-child') { showEditor({ type: 'child', bucketId, itemId, text: '' }); return; }
    if (kind === 'choose-stage' || kind === 'choose-target') {
      editing[kind === 'choose-stage' ? 'stage' : 'targetId'] = button.dataset.value;
      button.parentElement.querySelectorAll('button').forEach(value => value.setAttribute('aria-pressed', String(value === button))); return;
    }
    if (kind === 'delete-bucket' || kind === 'delete-item') { askDelete(bucketId, itemId); return; }
    if (kind === 'confirm-delete') {
      const current = { ...editing };
      await mutate(buckets => {
        if (current.itemId) deleteTask(buckets.find(bucket => bucket.id === current.bucketId).items, current.itemId);
        else buckets.splice(buckets.findIndex(bucket => bucket.id === current.bucketId), 1);
      }); return;
    }
    if (kind === 'queue-item' || kind === 'queue-bucket') {
      await mutate(buckets => {
        const targetId = kind === 'queue-item' ? queueTask(buckets, bucketId, itemId) : queueBucket(buckets, bucketId);
        opened.add(targetId);
      });
    }
  });
  root.addEventListener('change', async event => {
    const input = event.target;
    if (editing && input.name === 'note') editing.note = input.checked;
    if (input.dataset.action === 'toggle-item') {
      if (editing) { render(); return; }
      const { bucket: bucketId, item: itemId } = input.dataset, checked = input.checked;
      await mutate(buckets => toggleTask(buckets.find(bucket => bucket.id === bucketId).items, itemId, checked));
    }
  });
  root.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('#backlogEditor, .backlog-add-item')) return;
    event.preventDefault();
    if (disabled()) return;
    const text = form.elements.text.value.trim();
    if (!text) return;
    if (form.matches('.backlog-add-item')) {
      if (editing) return;
      const bucketId = form.dataset.bucket;
      const saved = await mutate(buckets => buckets.find(bucket => bucket.id === bucketId).items.push(newItem(text)));
      if (saved) { drafts.delete(bucketId); render(); root.querySelector(`.backlog-add-item[data-bucket="${bucketId}"] input`)?.focus(); }
      return;
    }
    const current = { ...editing, text };
    await mutate(buckets => {
      const bucket = buckets.find(value => value.id === current.bucketId);
      if (current.bucketId && !bucket) throw new Error('This bucket was removed. Copy your draft before closing.');
      if (current.type === 'bucket') {
        if (!bucket) {
          const added = { id: id(), title: text, stage: 'collecting', version: '', items: [] };
          buckets.unshift(added); stage = 'collecting'; opened.add(added.id);
        } else {
          bucket.title = text; bucket.version = '';
          if (current.stage === 'pending' && bucket.stage !== 'pending') {
            opened.add(queueBucket(buckets, bucket.id)); stage = 'pending';
          } else { bucket.stage = current.stage; stage = current.stage; }
        }
      } else if (current.type === 'child') {
        addSubtask(bucket.items, current.itemId, text); opened.add(bucket.id); collapsed.delete(current.itemId);
      } else {
        const item = bucket.items.find(value => value.id === current.itemId);
        if (!item) throw new Error('This task was removed on another device.');
        item.text = text; item.note = current.note;
        if (current.targetId !== bucket.id) {
          moveTask(buckets, bucket.id, item.id, current.targetId);
          const target = buckets.find(value => value.id === current.targetId);
          stage = target.stage; opened.add(target.id);
        }
      }
    });
  });
  function editTask(bucketId, itemId) {
    if (disabled() || editing) return;
    const item = getBucket(bucketId).items.find(value => value.id === itemId);
    showEditor({ type: 'item', bucketId, itemId, text: item.text, note: item.note, targetId: bucketId });
  }
  function openMenu(bucketId, itemId) {
    if (disabled() || editing) return;
    menu = menu?.itemId === itemId ? null : { bucketId, itemId };
    render(); root.querySelector('[role="menuitem"]')?.focus();
  }
  root.addEventListener('dblclick', event => {
    const row = event.target.closest('.backlog-item');
    if (row && !event.target.closest('button,input,.backlog-task-menu') && Date.now() >= suppressClick) editTask(row.dataset.bucket, row.dataset.item);
  });
  document.addEventListener('click', event => {
    if (menu && !event.target.closest('.backlog-task-menu,[data-action="task-menu"]')) { menu = null; render(); }
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !busy) { editing = null; menu = null; render(); return; }
    if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const entries = [...root.querySelectorAll('[role="menuitem"]')];
      const index = entries.indexOf(document.activeElement);
      entries[event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]?.focus();
      return;
    }
    const text = event.target.closest('.backlog-item-text');
    if (text && ['Enter', 'F2', ' '].includes(event.key)) { event.preventDefault(); editTask(text.dataset.bucket, text.dataset.item); }
    if (text && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) { event.preventDefault(); openMenu(text.dataset.bucket, text.dataset.item); }
    if (editing && event.target.matches('textarea') && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.target.form.requestSubmit(); }
  });

  // Drag from the task row, leaving controls and normal touch scrolling available.
  function clearDropMarks() { root.querySelectorAll('.backlog-drop-active,.backlog-drop-before,.backlog-drop-after').forEach(el => el.classList.remove('backlog-drop-active', 'backlog-drop-before', 'backlog-drop-after')); }
  function locateDrop() {
    if (!drag?.active) return;
    clearDropMarks();
    const under = document.elementFromPoint(drag.x, drag.y);
    const tab = under?.closest('[data-stage]');
    if (tab && root.contains(tab)) {
      drag.target = tab.dataset.stage === 'pending' ? { bucketId: '__pending__' } : null;
      tab.classList.add('backlog-drop-active');
      if (drag.hoverStage !== tab.dataset.stage) {
        clearTimeout(drag.hoverTimer); drag.hoverStage = tab.dataset.stage;
        drag.hoverTimer = setTimeout(() => { if (drag?.active) { changeStage(tab.dataset.stage); locateDrop(); } }, 550);
      }
      return;
    }
    clearTimeout(drag.hoverTimer); drag.hoverStage = null;
    const container = under?.closest('[data-drop-bucket]');
    drag.target = null;
    if (!container || !root.contains(container)) return;
    const row = under.closest('.backlog-item');
    const after = row ? drag.y > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 : false;
    drag.target = { bucketId: container.dataset.dropBucket, anchorId: row?.dataset.item, after };
    (row || container).classList.add(row ? (after ? 'backlog-drop-after' : 'backlog-drop-before') : 'backlog-drop-active');
  }
  function scrollDrag() {
    if (!drag?.active) return;
    const edge = 90, bottom = window.innerHeight - 75;
    const step = drag.y < edge ? -Math.ceil((edge - drag.y) / 5) : drag.y > bottom ? Math.ceil((drag.y - bottom) / 5) : 0;
    if (step) { window.scrollBy(0, Math.max(-18, Math.min(18, step))); locateDrop(); }
    scrollFrame = requestAnimationFrame(scrollDrag);
  }
  function activateDrag() {
    if (!drag || disabled()) return;
    drag.active = true;
    if (drag.kind !== 'touch') root.setPointerCapture?.(drag.pointerId);
    const bucket = getBucket(drag.bucketId), index = bucket.items.findIndex(item => item.id === drag.itemId);
    const ghost = document.createElement('div'); ghost.className = 'backlog-drag-ghost';
    const children = subtreeEnd(bucket.items, index) - index - 1;
    ghost.textContent = bucket.items[index].text + (children ? ` (+${children} subtasks)` : '');
    drag.ghost = ghost; document.body.append(ghost); document.body.classList.add('backlog-dragging');
    ghost.style.left = `${Math.max(8, Math.min(drag.x - 90, window.innerWidth - 240))}px`; ghost.style.top = `${drag.y - 28}px`;
    locateDrop(); scrollDrag();
  }
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.backlog-item');
    if (!handle || event.target.closest('button,input,a,.backlog-task-menu') || disabled() || event.button !== 0 || editing || event.pointerType === 'touch') return;
    menu = null;
    drag = { bucketId: handle.dataset.bucket, itemId: handle.dataset.item, pointerId: event.pointerId,
      kind: event.pointerType, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };

  });
  function moveDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active) {
      const moved = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
      if (drag.kind === 'mouse' && moved > 5) activateDrag();
      else if (drag.kind !== 'mouse' && moved > 12) { clearTimeout(drag.timer); drag.touchEvents?.abort(); drag = null; }
      return;
    }
    event.preventDefault();
    drag.ghost.style.left = `${Math.max(8, Math.min(drag.x - 90, window.innerWidth - 240))}px`;
    drag.ghost.style.top = `${drag.y - 28}px`; locateDrop();
  }
  window.addEventListener('pointermove', event => { if (drag?.kind !== 'touch') moveDrag(event); }, { passive: false });
  async function finishDrag(event, cancel = false) {
    if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
    const current = drag; clearTimeout(current.timer); clearTimeout(current.hoverTimer);
    cancelAnimationFrame(scrollFrame); current.touchEvents?.abort(); drag = null;
    if (current.kind !== 'touch' && root.hasPointerCapture?.(current.pointerId)) root.releasePointerCapture(current.pointerId);
    current.ghost?.remove(); document.body.classList.remove('backlog-dragging'); clearDropMarks();
    if (!current.active) return;
    suppressClick = Date.now() + 400;
    if (cancel || !current.target) return;
    await mutate(buckets => {
      const targetId = current.target.bucketId === '__pending__' ? pendingBucket(buckets).id : current.target.bucketId;
      moveTask(buckets, current.bucketId, current.itemId, targetId, current.target.anchorId, current.target.after);
      opened.add(targetId);
    });
  }
  window.addEventListener('pointerup', event => { if (drag?.kind !== 'touch') finishDrag(event); });
  window.addEventListener('pointercancel', event => { if (drag?.kind !== 'touch') finishDrag(event, true); });
  root.addEventListener('touchstart', event => {
    const row = event.target.closest('.backlog-item');
    if (!row || event.target.closest('button,input,a,.backlog-task-menu') || disabled() || editing || event.touches.length !== 1) return;
    const touch = event.changedTouches[0];
    drag = { bucketId: row.dataset.bucket, itemId: row.dataset.item, pointerId: touch.identifier, kind: 'touch',
      startX: touch.clientX, startY: touch.clientY, x: touch.clientX, y: touch.clientY, active: false };
    drag.timer = setTimeout(activateDrag, 320);
    drag.touchEvents = new AbortController();
    const options = { passive: false, signal: drag.touchEvents.signal };
    // Keep receiving this gesture even when hovering a stage replaces the row.
    event.target.addEventListener('touchmove', moveTouch, options);
    event.target.addEventListener('touchend', endTouch, options);
    event.target.addEventListener('touchcancel', endTouch, options);
  }, { passive: true });
  function moveTouch(event) {
    if (drag?.kind !== 'touch') return;
    const touch = [...event.changedTouches].find(t => t.identifier === drag.pointerId);
    if (touch) moveDrag({ pointerId: touch.identifier, clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => event.preventDefault() });
  }
  function endTouch(event) {
    if (drag?.kind === 'touch' && [...event.changedTouches].some(t => t.identifier === drag.pointerId)) finishDrag({}, event.type === 'touchcancel');
  }
  root.addEventListener('contextmenu', event => {
    const row = event.target.closest('.backlog-item');
    if (!row) return;
    event.preventDefault();
    if (!drag?.active) { if (drag) { clearTimeout(drag.timer); drag.touchEvents?.abort(); drag = null; } openMenu(row.dataset.bucket, row.dataset.item); }
  });
  window.addEventListener('blur', () => { if (drag) finishDrag({}, true); });
  return { reload };
}
