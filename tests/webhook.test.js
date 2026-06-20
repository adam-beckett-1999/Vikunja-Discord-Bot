import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getWebhookEventType } from '../src/webhook/server.js';

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