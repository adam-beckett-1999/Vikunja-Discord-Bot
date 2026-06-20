import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getTaskUpdateHighlight, getWebhookEventType } from '../src/webhook/server.js';

describe('webhook payload parsing', () => {
  test('prefers Vikunja event_name field', () => {
    assert.strictEqual(
      getWebhookEventType({ event_name: 'task.updated' }),
      'task.updated'
    );
  });

  test('supports legacy event_type field', () => {
    assert.strictEqual(
      getWebhookEventType({ event_type: 'task.created' }),
      'task.created'
    );
  });

  test('supports generic type field as final fallback', () => {
    assert.strictEqual(
      getWebhookEventType({ type: 'task.deleted' }),
      'task.deleted'
    );
  });
});

describe('webhook task update highlighting', () => {
  test('extracts title change from nested old_task payload', () => {
    const highlight = getTaskUpdateHighlight(
      'task.updated',
      { data: { old_task: { title: 'Old title' } } },
      { title: 'New title' }
    );

    assert.deepStrictEqual(highlight, {
      field: 'Title',
      before: 'Old title',
      after: 'New title',
    });
  });

  test('extracts done state change from top-level old_task payload', () => {
    const highlight = getTaskUpdateHighlight(
      'task.updated',
      { old_task: { done: false } },
      { done: true }
    );

    assert.deepStrictEqual(highlight, {
      field: 'Done',
      before: 'false',
      after: 'true',
    });
  });

  test('returns null when event is not task.updated', () => {
    assert.strictEqual(
      getTaskUpdateHighlight('task.created', { old_task: { title: 'Old' } }, { title: 'New' }),
      null
    );
  });

  test('returns null when tracked fields did not change', () => {
    assert.strictEqual(
      getTaskUpdateHighlight(
        'task.updated',
        { old_task: { title: 'Same', done: false } },
        { title: 'Same', done: false }
      ),
      null
    );
  });
});