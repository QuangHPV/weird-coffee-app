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
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

export function mountBacklog(root, adapter) {
  let state = null, stage = 'pending', editing = null, busy = false, loading = false, message = '';
  const opened = new Set(), drafts = new Map();
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
    root.innerHTML = `<div class="backlog-top"><h2>Backlog</h2><button class="backlog-primary" data-action="new-bucket" type="button" ${disabled() ? 'disabled' : ''}>New bucket</button></div>
      <div class="backlog-stages" role="tablist" aria-label="Backlog stage">${STAGES.map(([key, label]) => `<button type="button" role="tab" data-stage="${key}" aria-selected="${stage === key}" class="${stage === key ? 'active' : ''}">${label}<span>${buckets.filter(bucket => bucket.stage === key).length}</span></button>`).join('')}</div>
      <div class="backlog-message" role="status">${escapeText(message || (state.synced === false ? 'Offline copy. Reconnect to edit.' : ''))}</div>
      <div class="backlog-buckets">${visible.map(renderBucket).join('') || (stage === 'pending'
        ? '<div class="backlog-empty backlog-pending-drop" data-drop-bucket="__pending__"><strong>Next batch</strong><span>Pick tasks from Collecting</span></div>'
        : '<div class="backlog-empty">No buckets here yet.</div>')}</div>${editing ? renderEditor() : ''}`;
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
      ${expanded ? `<div class="backlog-bucket-body"><div class="backlog-items">${bucket.items.map((item, index) => renderItem(bucket, item, index)).join('')}</div>
        <form class="backlog-add-item" ${attrs}><input name="text" maxlength="1000" placeholder="Add a task" aria-label="New task in ${escapeText(bucket.title)}" value="${escapeText(drafts.get(bucket.id) || '')}" required ${disabled() ? 'disabled' : ''}><button type="submit" ${disabled() ? 'disabled' : ''}>Add</button></form></div>` : ''}</article>`;
  }

  function renderItem(bucket, item, index) {
    const status = item.note ? 'empty' : checkboxState(bucket.items, index);
    const attrs = `data-bucket="${escapeText(bucket.id)}" data-item="${escapeText(item.id)}"`;
    return `<div class="backlog-item ${status === 'checked' ? 'is-done' : ''} ${item.note ? 'is-note' : ''}" ${attrs} style="--depth:${item.depth}">
      ${item.note ? '<span class="backlog-note-mark">•</span>' : `<input type="checkbox" data-action="toggle-item" ${attrs} data-mixed="${status === 'mixed'}" aria-checked="${status === 'mixed' ? 'mixed' : status === 'checked'}" aria-label="Complete ${escapeText(item.text)}" ${status === 'checked' ? 'checked' : ''} ${disabled() ? 'disabled' : ''}>`}
      <button type="button" class="backlog-item-text" data-action="edit-item" ${attrs} ${disabled() ? 'disabled' : ''}>${escapeText(item.text)}</button>
      <button class="backlog-icon-button backlog-drag-handle" type="button" data-action="edit-item" ${attrs} aria-label="Move ${escapeText(item.text)}. Hold and drag, or activate to choose a bucket" ${disabled() ? 'disabled' : ''}>${icon('grip')}</button>
      <div class="backlog-item-actions">${!item.note && item.depth < 8 ? action('add-child', 'child', 'Add subtask', attrs) : ''}${bucket.stage !== 'pending' ? action('queue-item', 'queue', 'Move task to Pending', attrs) : ''}${action('delete-item', 'trash', 'Delete task and subtasks', attrs)}</div></div>`;
  }

  function renderEditor() {
    if (editing.type === 'delete') return `<div class="backlog-overlay" data-action="close-editor"><section class="backlog-editor" role="dialog" aria-modal="true" aria-labelledby="backlogEditorTitle" tabindex="-1">
      <h3 id="backlogEditorTitle">${editing.itemId ? 'Delete task?' : 'Delete bucket?'}</h3><p>${escapeText(editing.label)}</p><p class="backlog-delete-detail">${editing.count ? `Includes ${editing.count} ${editing.itemId ? 'subtasks and notes' : 'tasks and notes'}.` : ''}</p>
      <div class="backlog-editor-actions"><button type="button" data-action="close-editor">Cancel</button><button class="backlog-danger" type="button" data-action="confirm-delete" ${busy ? 'disabled' : ''}>Delete</button></div><div role="status" class="backlog-message">${escapeText(message)}</div></section></div>`;
    const bucket = editing.bucketId ? getBucket(editing.bucketId) : null;
    const isBucket = editing.type === 'bucket', isChild = editing.type === 'child';
    return `<div class="backlog-overlay" data-action="close-editor"><form class="backlog-editor" id="backlogEditor" role="dialog" aria-modal="true" aria-labelledby="backlogEditorTitle">
      <div class="backlog-editor-head"><h3 id="backlogEditorTitle">${isBucket ? (bucket ? 'Edit bucket' : 'New bucket') : isChild ? 'Add subtask' : 'Edit task'}</h3>${action('close-editor', 'close', 'Close')}</div>
      ${isChild ? `<p class="backlog-parent-label">${escapeText(bucket.items.find(item => item.id === editing.itemId)?.text)}</p>` : ''}
      <label>${isBucket ? 'Name' : 'Task'}<textarea name="text" maxlength="${isBucket ? 200 : 1000}" rows="${isBucket ? 2 : 3}" placeholder="${isBucket ? 'e.g. Mobile UI v3' : ''}" required>${escapeText(editing.text)}</textarea></label>
      ${isBucket && bucket ? `<div class="backlog-editor-label">Stage</div><div class="backlog-stage-choices">${STAGES.map(([key, label]) => `<button type="button" data-action="choose-stage" data-value="${key}" aria-pressed="${editing.stage === key}">${label}</button>`).join('')}</div>` : ''}
      ${!isBucket && !isChild ? `<label class="backlog-check-label"><input type="checkbox" name="note" ${editing.note ? 'checked' : ''}>Note</label><div class="backlog-editor-label">Move with subtasks to</div><div class="backlog-targets">${state.document.buckets.map(value => `<button type="button" data-action="choose-target" data-value="${escapeText(value.id)}" aria-pressed="${editing.targetId === value.id}">${escapeText(value.title)}</button>`).join('')}</div>` : ''}
      <div class="backlog-editor-actions"><button type="button" data-action="close-editor">Cancel</button><button class="backlog-primary" type="submit" ${busy ? 'disabled' : ''}>${isChild ? 'Add' : 'Save'}</button></div><div role="status" class="backlog-message">${escapeText(message)}</div></form></div>`;
  }

  function showEditor(value) {
    editing = value; message = ''; render();
    root.querySelector('.backlog-editor textarea, .backlog-editor button')?.focus();
  }
  function changeStage(next) {
    stage = next;
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
        if (editing?.bucketId && !state.document.buckets.some(bucket => bucket.id === editing.bucketId)) editing = null;
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
      if (button.classList.contains('backlog-overlay') && event.target !== button) return;
      if (!busy) { editing = null; message = ''; render(); } return;
    }
    if (kind === 'expand') { opened.has(bucketId) ? opened.delete(bucketId) : opened.add(bucketId); render(); return; }
    if (disabled()) return;
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
      const bucketId = form.dataset.bucket;
      const saved = await mutate(buckets => buckets.find(bucket => bucket.id === bucketId).items.push(newItem(text)));
      if (saved) { drafts.delete(bucketId); render(); root.querySelector(`.backlog-add-item[data-bucket="${bucketId}"] input`)?.focus(); }
      return;
    }
    const current = { ...editing, text };
    await mutate(buckets => {
      const bucket = buckets.find(value => value.id === current.bucketId);
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
        addSubtask(bucket.items, current.itemId, text); opened.add(bucket.id);
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
  root.addEventListener('keydown', event => {
    if (!editing) return;
    if (event.key === 'Escape' && !busy) { editing = null; render(); }
    if (event.key === 'Tab') {
      const controls = [...root.querySelectorAll('.backlog-editor button:not(:disabled), .backlog-editor textarea, .backlog-editor input')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });

  // Pointer events support both a mouse drag and a touch hold on the grip.
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
    root.setPointerCapture?.(drag.pointerId);
    const bucket = getBucket(drag.bucketId), index = bucket.items.findIndex(item => item.id === drag.itemId);
    const ghost = document.createElement('div'); ghost.className = 'backlog-drag-ghost';
    ghost.textContent = bucket.items[index].text;
    drag.ghost = ghost; document.body.append(ghost); document.body.classList.add('backlog-dragging');
    ghost.style.left = `${Math.max(8, Math.min(drag.x - 90, window.innerWidth - 240))}px`; ghost.style.top = `${drag.y - 28}px`;
    locateDrop(); scrollDrag();
  }
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.backlog-drag-handle');
    if (!handle || disabled() || event.button !== 0 || editing) return;
    drag = { bucketId: handle.dataset.bucket, itemId: handle.dataset.item, pointerId: event.pointerId,
      kind: event.pointerType, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
    if (event.pointerType !== 'mouse') drag.timer = setTimeout(activateDrag, 320);
  });
  window.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active) {
      const moved = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
      if (drag.kind === 'mouse' && moved > 5) activateDrag();
      else if (drag.kind !== 'mouse' && moved > 12) { clearTimeout(drag.timer); drag = null; }
      return;
    }
    event.preventDefault();
    drag.ghost.style.left = `${Math.max(8, Math.min(drag.x - 90, window.innerWidth - 240))}px`;
    drag.ghost.style.top = `${drag.y - 28}px`; locateDrop();
  }, { passive: false });
  async function finishDrag(event, cancel = false) {
    if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
    const current = drag; clearTimeout(current.timer); clearTimeout(current.hoverTimer);
    cancelAnimationFrame(scrollFrame); drag = null;
    if (root.hasPointerCapture?.(current.pointerId)) root.releasePointerCapture(current.pointerId);
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
  window.addEventListener('pointerup', event => finishDrag(event));
  window.addEventListener('pointercancel', event => finishDrag(event, true));
  root.addEventListener('contextmenu', event => { if (event.target.closest('.backlog-drag-handle')) event.preventDefault(); });
  window.addEventListener('blur', () => { if (drag) finishDrag({}, true); });
  return { reload };
}
