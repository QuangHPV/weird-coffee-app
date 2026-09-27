const STAGES = [
  ['collecting', 'Collecting'], ['pending', 'Pending'],
  ['in_progress', 'In progress'], ['done', 'Done']
];
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const freshId = () => crypto.randomUUID();

export function mountBacklog(root, adapter) {
  let state = null;
  let stage = 'pending';
  let opened = null;
  let editing = null;
  let busy = false;
  let message = '';

  function render() {
    if (!state) {
      root.innerHTML = `<div class="backlog-loading">${escapeText(message || 'Loading backlog…')}</div>`;
      return;
    }
    const buckets = state.document.buckets;
    const visible = buckets.filter(bucket => bucket.stage === stage);
    root.innerHTML = `<div class="backlog-top"><div><h2>Backlog</h2><p>Collect ideas into buckets. Mark a bucket Pending when it is ready for a batch.</p></div><button class="backlog-primary" data-action="new-bucket" type="button">New bucket</button></div>
      <div class="backlog-stages" role="tablist" aria-label="Backlog stage">${STAGES.map(([key, label]) =>
        `<button type="button" role="tab" data-stage="${key}" aria-selected="${stage === key}" class="${stage === key ? 'active' : ''}">${label}<span>${buckets.filter(bucket => bucket.stage === key).length}</span></button>`).join('')}</div>
      <div class="backlog-message" role="status">${escapeText(message)}</div>
      <div class="backlog-buckets">${visible.length ? visible.map(bucket => renderBucket(bucket)).join('') : '<div class="backlog-empty">No buckets here yet.</div>'}</div>
      ${editing ? renderEditor(buckets) : ''}`;
  }

  function renderBucket(bucket) {
    const expanded = opened === bucket.id;
    const tasks = bucket.items.filter(item => !item.note);
    const complete = tasks.filter(item => item.done).length;
    return `<article class="backlog-bucket" data-bucket="${escapeText(bucket.id)}">
      <div class="backlog-bucket-head"><button class="backlog-expand" type="button" data-action="expand" data-bucket="${escapeText(bucket.id)}" aria-expanded="${expanded}">
        <span class="backlog-bucket-name"><span class="backlog-chevron" aria-hidden="true">${expanded ? '▾' : '▸'}</span>${escapeText(bucket.title)}</span><span class="backlog-bucket-meta">${bucket.version ? `<em>${escapeText(bucket.version)}</em>` : ''}${complete}/${tasks.length} done</span></button>
        <button class="backlog-icon-button" type="button" data-action="edit-bucket" data-bucket="${escapeText(bucket.id)}" aria-label="Edit ${escapeText(bucket.title)}">✎</button></div>
      ${expanded ? `<div class="backlog-bucket-body"><div class="backlog-items">${bucket.items.map(item => renderItem(bucket, item)).join('')}</div>
        <form class="backlog-add-item" data-bucket="${escapeText(bucket.id)}"><input name="text" maxlength="1000" placeholder="Add a task" aria-label="New task" required><button type="submit" ${busy ? 'disabled' : ''}>Add</button></form></div>` : ''}</article>`;
  }

  function renderItem(bucket, item) {
    return `<div class="backlog-item ${item.done ? 'is-done' : ''} ${item.note ? 'is-note' : ''}" style="--depth:${Number(item.depth) || 0}">
      ${item.note ? '<span class="backlog-note-mark">•</span>' : `<input type="checkbox" data-action="toggle-item" data-bucket="${escapeText(bucket.id)}" data-item="${escapeText(item.id)}" aria-label="Complete ${escapeText(item.text)}" ${item.done ? 'checked' : ''} ${busy ? 'disabled' : ''}>`}
      <span class="backlog-item-text">${escapeText(item.text)}</span><button class="backlog-icon-button" type="button" data-action="edit-item" data-bucket="${escapeText(bucket.id)}" data-item="${escapeText(item.id)}" aria-label="Edit task">✎</button></div>`;
  }

  function renderEditor(buckets) {
    const bucket = buckets.find(value => value.id === editing.bucketId);
    const item = bucket?.items.find(value => value.id === editing.itemId);
    const isBucket = editing.type === 'bucket';
    const currentStage = editing.stage || bucket?.stage || 'collecting';
    return `<div class="backlog-overlay" data-action="close-editor"><form class="backlog-editor" id="backlogEditor" aria-label="${isBucket ? 'Bucket' : 'Task'} editor">
      <div class="backlog-editor-head"><h3>${isBucket ? (bucket ? 'Edit bucket' : 'New bucket') : 'Edit task'}</h3><button class="backlog-icon-button" type="button" data-action="close-editor" aria-label="Close">×</button></div>
      <label>${isBucket ? 'Name' : 'Task'}<textarea name="title" maxlength="${isBucket ? 200 : 1000}" rows="${isBucket ? 2 : 3}" required>${escapeText(editing.text ?? (isBucket ? bucket?.title : item?.text) ?? '')}</textarea></label>
      ${isBucket ? `<label>Version <input name="version" maxlength="60" placeholder="Optional, e.g. 1.2" value="${escapeText(editing.version ?? bucket?.version ?? '')}"></label>
        <div class="backlog-editor-label">Stage</div><div class="backlog-stage-choices">${STAGES.map(([key, label]) => `<button type="button" data-action="choose-stage" data-value="${key}" aria-pressed="${currentStage === key}">${label}</button>`).join('')}</div>` : `<label class="backlog-check-label"><input type="checkbox" name="note" ${editing.note ?? item?.note ? 'checked' : ''}>Note (no checkbox)</label>
        <div class="backlog-editor-label">Bucket</div><div class="backlog-targets">${buckets.map(value => `<button type="button" data-action="choose-target" data-value="${escapeText(value.id)}" aria-pressed="${(editing.targetId || bucket.id) === value.id}">${escapeText(value.title)}</button>`).join('')}</div>`}
      <div class="backlog-editor-actions">${(bucket && isBucket) || item ? '<button type="button" class="backlog-danger" data-action="delete-entry">Delete</button>' : ''}<button type="button" data-action="close-editor">Cancel</button><button class="backlog-primary" type="submit" ${busy ? 'disabled' : ''}>Save</button></div></form></div>`;
  }

  async function reload() {
    try {
      const result = await adapter.load();
      state = { document: result.document, revision: Number(result.revision) };
      if (!opened) opened = state.document.buckets.find(bucket => bucket.stage === stage)?.id || null;
      message = '';
    } catch (error) { message = error.message || 'Could not load the backlog.'; }
    render();
  }

  async function mutate(change) {
    if (busy || !state) return false;
    const next = structuredClone(state.document);
    change(next.buckets);
    busy = true;
    try {
      const saved = await adapter.save(next, state.revision);
      state = { document: saved.document, revision: Number(saved.revision) };
      editing = null;
      message = '';
      return true;
    } catch (error) {
      if (error.conflict) {
        editing = null;
        await reload();
        message = 'Backlog changed on another device. Latest changes are shown; try again.';
      } else message = error.message || 'Could not save the backlog.';
      return false;
    } finally { busy = false; render(); }
  }

  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-action], [data-stage]');
    if (!button || !root.contains(button)) return;
    if (button.dataset.stage) { stage = button.dataset.stage; editing = null; render(); return; }
    const action = button.dataset.action;
    if (action === 'close-editor') {
      if (button.classList.contains('backlog-overlay') && event.target !== button) return;
      editing = null; render(); return;
    }
    if (action === 'new-bucket') { editing = { type: 'bucket', stage: 'collecting' }; render(); return; }
    if (action === 'expand') { opened = opened === button.dataset.bucket ? null : button.dataset.bucket; render(); return; }
    if (action === 'edit-bucket') { editing = { type: 'bucket', bucketId: button.dataset.bucket }; render(); return; }
    if (action === 'edit-item') { editing = { type: 'item', bucketId: button.dataset.bucket, itemId: button.dataset.item }; render(); return; }
    if (action === 'choose-stage' || action === 'choose-target') {
      const form = root.querySelector('#backlogEditor');
      editing.text = form.elements.title.value;
      if (form.elements.version) editing.version = form.elements.version.value;
      if (form.elements.note) editing.note = form.elements.note.checked;
      if (action === 'choose-stage') editing.stage = button.dataset.value;
      else editing.targetId = button.dataset.value;
      render(); return;
    }
    if (action === 'delete-entry') {
      if (!confirm(`Delete this ${editing.type === 'bucket' ? 'bucket and all its tasks' : 'task'}?`)) return;
      const current = editing;
      await mutate(buckets => {
        const index = buckets.findIndex(bucket => bucket.id === current.bucketId);
        if (current.type === 'bucket') buckets.splice(index, 1);
        else buckets[index].items = buckets[index].items.filter(item => item.id !== current.itemId);
      });
    }
  });

  root.addEventListener('change', async event => {
    const input = event.target;
    if (input.dataset.action !== 'toggle-item') return;
    const { bucket: bucketId, item: itemId } = input.dataset;
    const checked = input.checked;
    await mutate(buckets => { buckets.find(bucket => bucket.id === bucketId).items.find(item => item.id === itemId).done = checked; });
  });

  root.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('#backlogEditor, .backlog-add-item')) return;
    event.preventDefault();
    if (busy) return;
    const text = form.elements.title?.value.trim() || form.elements.text?.value.trim();
    if (!text) return;
    if (form.matches('.backlog-add-item')) {
      const bucketId = form.dataset.bucket;
      await mutate(buckets => buckets.find(bucket => bucket.id === bucketId).items.push({ id: freshId(), text, done: false, note: false, depth: 0 }));
      return;
    }
    const current = editing;
    const version = form.elements.version?.value.trim() || '';
    const note = !!form.elements.note?.checked;
    current.text = text;
    current.version = version;
    current.note = note;
    await mutate(buckets => {
      if (current.type === 'bucket') {
        const bucket = buckets.find(value => value.id === current.bucketId);
        if (bucket) { bucket.title = text; bucket.stage = current.stage || bucket.stage; bucket.version = version; }
        else buckets.unshift({ id: freshId(), title: text, stage: current.stage, version, items: [] });
        stage = current.stage;
      } else {
        const source = buckets.find(value => value.id === current.bucketId);
        const item = source.items.find(value => value.id === current.itemId);
        item.text = text; item.note = note;
        const target = buckets.find(value => value.id === (current.targetId || current.bucketId));
        if (target !== source) { source.items = source.items.filter(value => value.id !== item.id); item.depth = 0; target.items.push(item); stage = target.stage; opened = target.id; }
      }
    });
  });

  return { reload };
}
