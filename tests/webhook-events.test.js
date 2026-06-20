import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WEBHOOK_EVENTS,
  formatWebhookEventsHelp,
  parseWebhookEventsInput,
} from '../src/services/webhook-events.js';

describe('webhook event parsing', () => {
  test('uses defaults when no value is provided', () => {
    const { events, invalid } = parseWebhookEventsInput('');

    assert.deepStrictEqual(events, DEFAULT_WEBHOOK_EVENTS);
    assert.deepStrictEqual(invalid, []);
  });

  test('deduplicates and normalizes custom event list', () => {
    const { events, invalid } = parseWebhookEventsInput('Task.Created, task.created, task.comment.created');

    assert.deepStrictEqual(events, ['task.created', 'task.comment.created']);
    assert.deepStrictEqual(invalid, []);
  });

  test('returns invalid tokens separately', () => {
    const { events, invalid } = parseWebhookEventsInput('task.created, ???, task.updated');

    assert.deepStrictEqual(events, ['task.created', 'task.updated']);
    assert.deepStrictEqual(invalid, ['???']);
  });
});

describe('webhook event help text', () => {
  test('contains formatting instructions and an example', () => {
    const help = formatWebhookEventsHelp();

    assert.ok(help.includes('Format: comma-separated event names.'));
    assert.ok(help.includes('Example: `task.created, task.updated, task.comment.created`'));
  });

  test('contains common event names and meanings', () => {
    const help = formatWebhookEventsHelp();

    assert.ok(help.includes('`task.created` - A new task was created.'));
    assert.ok(help.includes('`project.deleted` - A project was deleted.'));
  });
});
