import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WEBHOOK_EVENTS,
  autocompleteWebhookEventsInput,
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

describe('webhook event autocomplete', () => {
  test('suggests values for the current comma-separated token', () => {
    const choices = autocompleteWebhookEventsInput('task.created, task.co');

    assert.ok(choices.length > 0);
    assert.ok(choices.every((choice) => choice.value.startsWith('task.created, ')));
    assert.ok(choices.some((choice) => choice.value.endsWith('task.comment.created, ')));
  });

  test('adds trailing comma to support selecting another event', () => {
    const firstPick = autocompleteWebhookEventsInput('task.cre')[0];

    assert.ok(firstPick.value.endsWith(', '));
    assert.ok(firstPick.value.startsWith('task.created'));
  });
});
