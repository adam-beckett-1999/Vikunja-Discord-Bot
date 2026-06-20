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
