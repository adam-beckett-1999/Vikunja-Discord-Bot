import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { warmTaskSnapshotCache } from '../src/services/task-cache-warmup.js';
import { clearTaskSnapshot, getCachedTaskSnapshot } from '../src/services/task-update-context.js';

describe('task cache warm-up', () => {
  test('caches tasks across paginated responses', async () => {
    const calls = [];
    const fetchPage = async ({ page, per_page }) => {
      calls.push({ page, per_page });
      if (page === 1) {
        return { data: [{ id: 1001, title: 'A' }, { id: 1002, title: 'B' }] };
      }
      if (page === 2) {
        return { data: [{ id: 1003, title: 'C' }] };
      }
      return { data: [] };
    };

    const result = await warmTaskSnapshotCache({ fetchPage, perPage: 2 });

    assert.strictEqual(result.pagesFetched, 2);
    assert.strictEqual(result.tasksCached, 3);
    assert.strictEqual(result.stoppedByMaxPages, false);
    assert.deepStrictEqual(calls, [
      { page: 1, per_page: 2 },
      { page: 2, per_page: 2 },
    ]);

    assert.strictEqual(getCachedTaskSnapshot(1001)?.title, 'A');
    assert.strictEqual(getCachedTaskSnapshot(1002)?.title, 'B');
    assert.strictEqual(getCachedTaskSnapshot(1003)?.title, 'C');

    clearTaskSnapshot(1001);
    clearTaskSnapshot(1002);
    clearTaskSnapshot(1003);
  });

  test('stops when max page limit is reached', async () => {
    let callCount = 0;
    const fetchPage = async () => {
      callCount++;
      return { data: [{ id: 2001, title: 'Only full pages' }] };
    };

    const result = await warmTaskSnapshotCache({ fetchPage, perPage: 1, maxPages: 3, logger: {} });

    assert.strictEqual(callCount, 3);
    assert.strictEqual(result.pagesFetched, 3);
    assert.strictEqual(result.tasksCached, 3);
    assert.strictEqual(result.stoppedByMaxPages, true);

    clearTaskSnapshot(2001);
  });

  test('retries with smaller per_page when API rejects requested page size', async () => {
    const calls = [];
    const fetchPage = async ({ page, per_page }) => {
      calls.push({ page, per_page });

      if (page === 1 && per_page > 50) {
        const error = new Error('Bad Request');
        error.response = {
          status: 400,
          data: { message: 'Invalid model provided: Bad Request' },
        };
        throw error;
      }

      if (page === 1 && per_page === 50) {
        return { data: [{ id: 3001, title: 'A' }, { id: 3002, title: 'B' }] };
      }

      return { data: [] };
    };

    const result = await warmTaskSnapshotCache({ fetchPage, perPage: 200, logger: {} });

    assert.strictEqual(result.pagesFetched, 1);
    assert.strictEqual(result.tasksCached, 2);
    assert.strictEqual(getCachedTaskSnapshot(3001)?.title, 'A');
    assert.strictEqual(getCachedTaskSnapshot(3002)?.title, 'B');
    assert.deepStrictEqual(calls.slice(0, 3), [
      { page: 1, per_page: 200 },
      { page: 1, per_page: 100 },
      { page: 1, per_page: 50 },
    ]);

    clearTaskSnapshot(3001);
    clearTaskSnapshot(3002);
  });
});
