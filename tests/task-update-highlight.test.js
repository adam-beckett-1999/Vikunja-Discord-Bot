import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTaskUpdateHighlightFromPayload,
  getTaskUpdateHighlightFromTasks,
} from '../src/utils/task-update-highlight.js';

describe('task update highlight from task objects', () => {
  test('returns changed title details', () => {
    const highlight = getTaskUpdateHighlightFromTasks(
      { title: 'Old title' },
      { title: 'New title' }
    );

    assert.deepStrictEqual(highlight, {
      field: 'Title',
      before: 'Old title',
      after: 'New title',
    });
  });

  test('returns null when no tracked fields differ', () => {
    const highlight = getTaskUpdateHighlightFromTasks(
      { title: 'Same', done: false },
      { title: 'Same', done: false }
    );

    assert.strictEqual(highlight, null);
  });

  test('escapes markdown in before/after values', () => {
    const highlight = getTaskUpdateHighlightFromTasks(
      { title: '*Old*' },
      { title: '`New`' }
    );

    assert.deepStrictEqual(highlight, {
      field: 'Title',
      before: '\\*Old\\*',
      after: '\\`New\\`',
    });
  });

  test('returns tag add/remove details when labels changed', () => {
    const highlight = getTaskUpdateHighlightFromTasks(
      { labels: [{ id: 1, title: 'bug' }] },
      { labels: [{ id: 1, title: 'bug' }, { id: 2, title: 'backend' }] }
    );

    assert.deepStrictEqual(highlight, {
      field: 'Tags',
      before: 'bug',
      after: 'backend, bug',
      added: ['backend'],
      removed: [],
    });
  });

  test('returns null for tag-only compare when no tag changes exist', () => {
    const highlight = getTaskUpdateHighlightFromTasks(
      { labels: [{ id: 1, title: 'bug' }] },
      { labels: [{ id: 1, title: 'bug' }] }
    );

    assert.strictEqual(highlight, null);
  });

  test('ignores tag diff when new task payload omits tag fields and still highlights priority', () => {
    const highlight = getTaskUpdateHighlightFromTasks(
      {
        priority: 0,
        labels: [{ id: 1, title: 'container' }, { id: 2, title: 'docker' }],
      },
      {
        priority: 2,
      }
    );

    assert.deepStrictEqual(highlight, {
      field: 'Priority',
      before: 'Unset',
      after: 'Medium',
    });
  });

  test('formats priority diff values as labels', () => {
    const highlight = getTaskUpdateHighlightFromTasks(
      { priority: 1 },
      { priority: 3 }
    );

    assert.deepStrictEqual(highlight, {
      field: 'Priority',
      before: 'Low',
      after: 'High',
    });
  });
});

describe('task update highlight from webhook payload', () => {
  test('returns null for non-update events', () => {
    const highlight = getTaskUpdateHighlightFromPayload(
      'task.created',
      { data: { old_task: { title: 'Old' } } },
      { title: 'New' }
    );

    assert.strictEqual(highlight, null);
  });
});
