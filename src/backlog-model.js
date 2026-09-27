export const BATCH_LIMIT = 12;
export const id = () => crypto.randomUUID();
export const newItem = (text, depth = 0) => ({ id: id(), text, depth, done: false, note: false });

export function subtreeEnd(items, index) {
  if (index < 0 || index >= items.length) throw new Error('Task no longer exists.');
  let end = index + 1;
  while (end < items.length && items[end].depth > items[index].depth) end++;
  return end;
}

export function checkboxState(items, index) {
  const descendants = items.slice(index + 1, subtreeEnd(items, index)).filter(item => !item.note);
  if (!descendants.length) return items[index].done ? 'checked' : 'empty';
  if (descendants.every(item => item.done)) return 'checked';
  return descendants.some(item => item.done) ? 'mixed' : 'empty';
}

export function syncCompletion(items) {
  for (let index = items.length - 1; index >= 0; index--) {
    if (!items[index].note) items[index].done = checkboxState(items, index) === 'checked';
  }
}

export function toggleTask(items, itemId, done) {
  const index = items.findIndex(item => item.id === itemId);
  for (const item of items.slice(index, subtreeEnd(items, index))) if (!item.note) item.done = done;
  syncCompletion(items);
}

export function addSubtask(items, parentId, text) {
  const index = items.findIndex(item => item.id === parentId);
  const end = subtreeEnd(items, index);
  if (items[index].depth >= 8) throw new Error('This task is already at the deepest level.');
  const task = newItem(text, items[index].depth + 1);
  items.splice(end, 0, task);
  syncCompletion(items);
  return task;
}

export function deleteTask(items, itemId) {
  const index = items.findIndex(item => item.id === itemId);
  items.splice(index, subtreeEnd(items, index) - index);
  syncCompletion(items);
}

export function moveTask(buckets, sourceId, itemId, targetId, anchorId = null, after = false) {
  const source = buckets.find(bucket => bucket.id === sourceId);
  const target = buckets.find(bucket => bucket.id === targetId);
  if (!source || !target) throw new Error('Bucket no longer exists.');
  const start = source.items.findIndex(item => item.id === itemId);
  const end = subtreeEnd(source.items, start);
  const moving = source.items.slice(start, end);
  if (moving.some(item => item.id === anchorId)) return;
  const anchor = anchorId ? target.items.find(item => item.id === anchorId) : null;
  const depth = anchor?.depth || 0;
  const offset = depth - moving[0].depth;
  if (moving.some(item => item.depth + offset > 8)) throw new Error('Move this task to a shallower level.');
  source.items.splice(start, moving.length);
  let position = anchor ? target.items.findIndex(item => item.id === anchorId) : target.items.length;
  if (anchor && after) position = subtreeEnd(target.items, position);
  moving.forEach(item => { item.depth += offset; });
  target.items.splice(position, 0, ...moving);
  syncCompletion(source.items);
  if (source !== target) syncCompletion(target.items);
}

export function pendingBucket(buckets) {
  let bucket = buckets.find(value => value.stage === 'pending');
  if (!bucket) {
    bucket = { id: id(), title: 'Next batch', stage: 'pending', version: '', items: [] };
    buckets.unshift(bucket);
  }
  return bucket;
}

export function queueTask(buckets, sourceId, itemId) {
  const target = pendingBucket(buckets);
  if (sourceId !== target.id) moveTask(buckets, sourceId, itemId, target.id);
  return target.id;
}

export function queueBucket(buckets, sourceId) {
  const source = buckets.find(bucket => bucket.id === sourceId);
  const target = pendingBucket(buckets);
  if (source !== target) {
    target.items.push(...source.items);
    source.items = [];
  }
  return target.id;
}

export function batchSize(bucket) {
  // Count unfinished leaf tasks, so a parent and its children aren't counted twice.
  return bucket.items.filter((item, index, items) => !item.note && !item.done &&
    !items.slice(index + 1, subtreeEnd(items, index)).some(child => !child.note)).length;
}

export function normalizeDocument(document) {
  const result = structuredClone(document);
  for (const bucket of result.buckets) {
    if (bucket.version?.trim()) {
      const version = bucket.version.trim().replace(/^v/i, '');
      if (!bucket.title.toLowerCase().endsWith(`v${version}`.toLowerCase())) bucket.title += ` v${version}`;
      bucket.title = bucket.title.slice(0, 200);
      bucket.version = '';
    }
    let previous = -1;
    for (const item of bucket.items) {
      item.depth = Math.min(Math.max(0, Number(item.depth) || 0), previous + 1, 8);
      previous = item.depth;
    }
    syncCompletion(bucket.items);
  }
  const pending = result.buckets.filter(bucket => bucket.stage === 'pending');
  if (pending.length > 1) {
    for (const bucket of pending.slice(1)) pending[0].items.push(...bucket.items);
    result.buckets = result.buckets.filter(bucket => bucket.stage !== 'pending' || bucket === pending[0]);
  }
  return result;
}
