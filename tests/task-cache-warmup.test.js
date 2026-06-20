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

  test('falls back to page-only requests when per_page is unsupported', async () => {
    const calls = [];
    const fetchPage = async (params = {}) => {
      calls.push(params);
      const page = params.page ?? 1;

      if (Object.hasOwn(params, 'per_page')) {
        const error = new Error('Bad Request');
        error.response = {
          status: 400,
          data: { message: 'Invalid model provided: Bad Request' },
        };
        throw error;
      }

      if (page === 1) {
        return { data: [{ id: 4001, title: 'A' }, { id: 4002, title: 'B' }] };
      }

      return { data: [] };
    };

    const result = await warmTaskSnapshotCache({ fetchPage, perPage: 100, logger: {} });

    assert.strictEqual(result.pagesFetched, 2);
    assert.strictEqual(result.tasksCached, 2);
    assert.strictEqual(getCachedTaskSnapshot(4001)?.title, 'A');
    assert.strictEqual(getCachedTaskSnapshot(4002)?.title, 'B');
    assert.deepStrictEqual(calls.slice(0, 4), [
      { page: 1, per_page: 100 },
      { page: 1, per_page: 50 },
      { page: 1, per_page: 25 },
      { page: 1 },
    ]);

    clearTaskSnapshot(4001);
    clearTaskSnapshot(4002);
  });

  test('falls back to unpaged request when all pagination params are rejected', async () => {
    const calls = [];
    const fetchPage = async (params = {}) => {
      calls.push(params);

      if (Object.keys(params).length > 0) {
        const error = new Error('Bad Request');
        error.response = {
          status: 400,
          data: { message: 'Invalid model provided: Bad Request' },
        };
        throw error;
      }

      return { data: [{ id: 5001, title: 'Only fallback works' }] };
    };

    const result = await warmTaskSnapshotCache({ fetchPage, perPage: 100, logger: {} });

    assert.strictEqual(result.pagesFetched, 1);
    assert.strictEqual(result.tasksCached, 1);
    assert.strictEqual(getCachedTaskSnapshot(5001)?.title, 'Only fallback works');
    assert.deepStrictEqual(calls.slice(0, 5), [
      { page: 1, per_page: 100 },
      { page: 1, per_page: 50 },
      { page: 1, per_page: 25 },
      { page: 1 },
      {},
    ]);

    clearTaskSnapshot(5001);
  });

  test('falls back to project task listing when /tasks/all path fails entirely', async () => {
    const allTasksCalls = [];
    const fetchPage = async (params = {}) => {
      allTasksCalls.push(params);
      const error = new Error('Bad Request');
      error.response = {
        status: 400,
        data: { message: 'Invalid model provided: Bad Request' },
      };
      throw error;
    };

    const fetchProjects = async () => ({
      data: [{ id: 91, title: 'Services' }, { id: 92, title: 'Automation' }],
    });

    const fetchProjectTasks = async (projectId, params = {}) => {
      if (projectId === 91 && params.page === 1) {
        return { data: [{ id: 6001, title: 'A' }, { id: 6002, title: 'B' }] };
      }
      if (projectId === 91 && params.page === 2) {
        return { data: [] };
      }
      if (projectId === 92 && params.page === 1) {
        return { data: [{ id: 6003, title: 'C' }] };
      }
      return { data: [] };
    };

    const result = await warmTaskSnapshotCache({
      fetchPage,
      fetchProjects,
      fetchProjectTasks,
      perPage: 2,
      logger: {},
    });

    assert.strictEqual(result.tasksCached, 3);
    assert.strictEqual(getCachedTaskSnapshot(6001)?.title, 'A');
    assert.strictEqual(getCachedTaskSnapshot(6002)?.title, 'B');
    assert.strictEqual(getCachedTaskSnapshot(6003)?.title, 'C');
    assert.ok(allTasksCalls.length >= 3, 'Expected /tasks/all attempts before fallback');

    clearTaskSnapshot(6001);
    clearTaskSnapshot(6002);
    clearTaskSnapshot(6003);
  });
});
