const MANUAL_UPDATE_TTL_MS = 15000;

const recentManualUpdates = new Map();
const taskSnapshotCache = new Map();

function toTaskId(taskOrId) {
  if (taskOrId === undefined || taskOrId === null) return undefined;
  if (typeof taskOrId === 'object') return taskOrId.id;
  return taskOrId;
}

function purgeExpiredManualUpdates(now = Date.now()) {
  for (const [taskId, timestamp] of recentManualUpdates.entries()) {
    if (now - timestamp > MANUAL_UPDATE_TTL_MS) {
      recentManualUpdates.delete(taskId);
    }
  }
}

/**
 * Mark that a task was just updated by a bot command so the immediate webhook
 * callback can be suppressed to avoid duplicate notifications.
 *
 * @param {number|string} taskId
 */
export function markManualTaskUpdate(taskId) {
  if (taskId === undefined || taskId === null) return;
  purgeExpiredManualUpdates();
  recentManualUpdates.set(String(taskId), Date.now());
}

/**
 * Check whether a task.updated webhook should be skipped because it likely
 * originated from a just-issued bot command.
 *
 * @param {number|string} taskId
 * @returns {boolean}
 */
export function shouldSuppressWebhookUpdate(taskId) {
  if (taskId === undefined || taskId === null) return false;

  purgeExpiredManualUpdates();
  const key = String(taskId);
  if (!recentManualUpdates.has(key)) return false;

  // One-time suppression: consume marker when used.
  recentManualUpdates.delete(key);
  return true;
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