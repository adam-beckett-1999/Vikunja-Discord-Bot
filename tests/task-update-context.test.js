import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheTaskSnapshot,
  clearTaskSnapshot,
  getCachedTaskSnapshot,
  markManualTaskUpdate,
  shouldSuppressWebhookUpdate,
} from '../src/services/task-update-context.js';

describe('task update context', () => {
  test('manual task update suppression is one-time', () => {
    markManualTaskUpdate(42);

    assert.strictEqual(shouldSuppressWebhookUpdate(42), true);
    assert.strictEqual(shouldSuppressWebhookUpdate(42), false);
  });

  test('task snapshot cache stores and clears task states', () => {
    const task = { id: 99, title: 'Task', done: false };

    cacheTaskSnapshot(task);
    const cached = getCachedTaskSnapshot(99);
    assert.ok(cached);
    assert.strictEqual(cached.title, 'Task');

    clearTaskSnapshot(99);
    assert.strictEqual(getCachedTaskSnapshot(99), undefined);
  });
});
