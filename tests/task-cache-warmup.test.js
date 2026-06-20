import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { warmTaskSnapshotCache } from '../src/services/task-cache-warmup.js';
import { clearTaskSnapshot, getCachedTaskSnapshot } from '../src/services/task-update-context.js';

describe('task cache warm-up', () => {
  test('caches tasks across projects and pages', async () => {
    const fetchProjects = async () => ({
      data: [{ id: 101, title: 'Services' }, { id: 102, title: 'Automation' }],
    });

    const calls = [];
    const fetchProjectTasks = async (projectId, params = {}) => {
      calls.push({ projectId, ...params });
      const page = params.page ?? 1;

      if (projectId === 101 && page === 1) {
        return { data: [{ id: 1001, title: 'A' }, { id: 1002, title: 'B' }] };
      }
      if (projectId === 101 && page === 2) {
        return { data: [] };
      }
      if (projectId === 102 && page === 1) {
        return { data: [{ id: 1003, title: 'C' }] };
      }
      return { data: [] };
    };

    const result = await warmTaskSnapshotCache({
      fetchProjects,
      fetchProjectTasks,
      perPage: 2,
      logger: {},
    });

    assert.strictEqual(result.pagesFetched, 3);
    assert.strictEqual(result.tasksCached, 3);
    assert.strictEqual(result.stoppedByMaxPages, false);
    assert.strictEqual(getCachedTaskSnapshot(1001)?.title, 'A');
    assert.strictEqual(getCachedTaskSnapshot(1002)?.title, 'B');
    assert.strictEqual(getCachedTaskSnapshot(1003)?.title, 'C');

    assert.deepStrictEqual(calls.slice(0, 3), [
      { projectId: 101, page: 1, per_page: 2 },
      { projectId: 101, page: 2, per_page: 2 },
      { projectId: 102, page: 1, per_page: 2 },
    ]);

    clearTaskSnapshot(1001);
    clearTaskSnapshot(1002);
    clearTaskSnapshot(1003);
  });

  test('falls back to page-only project requests when per_page is rejected', async () => {
    const fetchProjects = async () => ({ data: [{ id: 201, title: 'Services' }] });

    const calls = [];
    const fetchProjectTasks = async (projectId, params = {}) => {
      calls.push({ projectId, ...params });
      const page = params.page ?? 1;

      if (Object.hasOwn(params, 'per_page')) {
        const error = new Error('Bad Request');
        error.response = {
          status: 400,
          data: { message: 'Invalid model provided: Bad Request' },
        };
        throw error;
      }

      if (page === 1) return { data: [{ id: 2001, title: 'A' }] };
      return { data: [] };
    };

    const result = await warmTaskSnapshotCache({
      fetchProjects,
      fetchProjectTasks,
      perPage: 100,
      logger: {},
    });

    assert.strictEqual(result.pagesFetched, 2);
    assert.strictEqual(result.tasksCached, 1);
    assert.strictEqual(getCachedTaskSnapshot(2001)?.title, 'A');
    assert.deepStrictEqual(calls.slice(0, 3), [
      { projectId: 201, page: 1, per_page: 100 },
      { projectId: 201, page: 1 },
      { projectId: 201, page: 2 },
    ]);

    clearTaskSnapshot(2001);
  });

  test('marks stoppedByMaxPages when project paging hits max page limit', async () => {
    const fetchProjects = async () => ({ data: [{ id: 301, title: 'Services' }] });

    let callCount = 0;
    const fetchProjectTasks = async () => {
      callCount++;
      return { data: [{ id: 3001, title: 'Always full' }] };
    };

    const result = await warmTaskSnapshotCache({
      fetchProjects,
      fetchProjectTasks,
      perPage: 1,
      maxPages: 3,
      logger: {},
    });

    assert.strictEqual(callCount, 3);
    assert.strictEqual(result.pagesFetched, 3);
    assert.strictEqual(result.tasksCached, 3);
    assert.strictEqual(result.stoppedByMaxPages, true);

    clearTaskSnapshot(3001);
  });

  test('returns zero cached tasks when all projects are empty', async () => {
    const fetchProjects = async () => ({ data: [{ id: 401, title: 'Services' }] });
    const fetchProjectTasks = async () => ({ data: [] });

    const result = await warmTaskSnapshotCache({
      fetchProjects,
      fetchProjectTasks,
      logger: {},
    });

    assert.strictEqual(result.pagesFetched, 1);
    assert.strictEqual(result.tasksCached, 0);
    assert.strictEqual(result.stoppedByMaxPages, false);
  });
});
