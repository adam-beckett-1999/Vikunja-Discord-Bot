const taskSnapshotCache = new Map();

function toTaskId(taskOrId) {
  if (taskOrId === undefined || taskOrId === null) return undefined;
  if (typeof taskOrId === 'object') return taskOrId.id;
  return taskOrId;
}

/**
 * Save a shallow snapshot of the latest known task state.
 *
 * @param {object} task
 */
export function cacheTaskSnapshot(task) {
  const taskId = toTaskId(task);
  if (taskId === undefined) return;
  if (!task || typeof task !== 'object') return;

  const key = String(taskId);
  const previous = taskSnapshotCache.get(key) ?? {};
  taskSnapshotCache.set(key, { ...previous, ...task });
}

/**
 * Return the last cached task snapshot for this task id.
 *
 * @param {number|string} taskId
 * @returns {object|undefined}
 */
export function getCachedTaskSnapshot(taskId) {
  if (taskId === undefined || taskId === null) return undefined;
  return taskSnapshotCache.get(String(taskId));
}

/**
 * Remove cached state for a task, typically when deleted.
 *
 * @param {number|string} taskId
 */
export function clearTaskSnapshot(taskId) {
  if (taskId === undefined || taskId === null) return;
  taskSnapshotCache.delete(String(taskId));
}