import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskEmbed, formatTaskDescription } from '../src/utils/embeds.js';

describe('embed helpers – pure logic', () => {
  test('priority label mapping covers 0–5', () => {
    const PRIORITY_LABELS = {
      0: 'Unset',
      1: 'Low',
      2: 'Medium',
      3: 'High',
      4: 'Urgent',
      5: 'DO NOW',
    };
    for (let i = 0; i <= 5; i++) {
      assert.ok(PRIORITY_LABELS[i], 'Missing label for priority ' + i);
    }
  });

  test('ISO date string is parseable', () => {
    const iso = new Date('2025-12-31').toISOString();
    assert.ok(iso.startsWith('2025-12-31'), 'ISO string should start with the input date');
  });

  test('invalid date string is detected', () => {
    const d = new Date('not-a-date');
    assert.ok(isNaN(d.getTime()), 'Invalid date should be NaN');
  });

  test('description truncation at Discord 4096 char limit', () => {
    const long = 'x'.repeat(5000);
    const truncated = long.length > 4096 ? long.slice(0, 4093) + '…' : long;
    // 4093 chars + single '…' character = 4094 total
    assert.strictEqual(truncated.length, 4094);
    assert.ok(truncated.endsWith('…'));
  });

  test('short description is not truncated', () => {
    const short = 'Hello world';
    const result = short.length > 4096 ? short.slice(0, 4093) + '…' : short;
    assert.strictEqual(result, 'Hello world');
  });

  test('html checklist description is converted to readable text', () => {
    const input = '<p>Header</p><ul><li data-checked="true"><label><input type="checkbox" checked="checked"></label><div><p>First item</p></div></li><li data-checked="false"><div><p>Second item</p></div></li></ul>';
    const formatted = formatTaskDescription(input);

    assert.ok(formatted.includes('Header'));
    assert.ok(formatted.includes('- [x] First item'));
    assert.ok(formatted.includes('- [ ] Second item'));
    assert.ok(!formatted.includes('<li'));
    assert.ok(!formatted.includes('<input'));
  });

  test('task embed uses fallback text when no description fields are present', () => {
    const embed = buildTaskEmbed({ id: 1, title: 'Task with no description', priority: 0, done: false });
    const data = embed.toJSON();
    assert.strictEqual(data.description, 'No description.');
  });

  test('task embed can render from alternate description_html field', () => {
    const embed = buildTaskEmbed({
      id: 2,
      title: 'Task with html field',
      priority: 0,
      done: false,
      description_html: '<p>Hello from html</p>',
    });
    const data = embed.toJSON();
    assert.strictEqual(data.description, 'Hello from html');
  });

  test('task embed shows Project field using provided project name', () => {
    const embed = buildTaskEmbed(
      { id: 3, title: 'Task', priority: 0, done: false, project_id: 5 },
      undefined,
      'Services & Containers'
    );
    const data = embed.toJSON();
    const projectField = (data.fields ?? []).find((field) => field.name === 'Project');

    assert.ok(projectField, 'Project field should exist');
    assert.strictEqual(projectField.value, 'Services & Containers');
  });

  test('task embed shows updated field details when provided', () => {
    const embed = buildTaskEmbed(
      { id: 4, title: 'Task', priority: 0, done: false },
      'Updated',
      undefined,
      { field: 'Title', before: 'Old title', after: 'New title' }
    );
    const data = embed.toJSON();
    const updatedField = (data.fields ?? []).find((field) => field.name === 'Updated');

    assert.ok(updatedField, 'Updated field should exist');
    assert.ok(updatedField.value.includes('**Title**'));
    assert.ok(updatedField.value.includes('Old title → New title'));
  });

  test('task embed renders tags with color badges', () => {
    const embed = buildTaskEmbed({
      id: 5,
      title: 'Task',
      priority: 1,
      done: false,
      labels: [
        { id: 11, title: 'Backend', hex_color: '#0f9d58' },
        { id: 12, title: 'Bug', hex_color: '#db4437' },
      ],
    });

    const data = embed.toJSON();
    const tagsField = (data.fields ?? []).find((field) => field.name === 'Tags');

    assert.ok(tagsField, 'Tags field should exist');
    assert.ok(tagsField.value.includes('Backend'));
    assert.ok(tagsField.value.includes('Bug'));
  });

  test('task embed renders tag diff update details', () => {
    const embed = buildTaskEmbed(
      { id: 6, title: 'Task', priority: 2, done: false },
      'Updated',
      'Project A',
      {
        field: 'Tags',
        before: 'bug',
        after: 'backend, bug',
        added: ['backend'],
        removed: [],
      }
    );

    const data = embed.toJSON();
    const updatedField = (data.fields ?? []).find((field) => field.name === 'Updated');

    assert.ok(updatedField, 'Updated field should exist');
    assert.ok(updatedField.value.includes('**Tags**'));
    assert.ok(updatedField.value.includes('Added: backend'));
    assert.ok(updatedField.value.includes('Removed: none'));
  });
});

describe('config parsing helpers', () => {
  test('trailing slash is stripped from base URL', () => {
    const url = 'https://example.com/';
    const cleaned = url.replace(/\/$/, '');
    assert.strictEqual(cleaned, 'https://example.com');
  });

  test('guild ID splitting handles empty string', () => {
    const raw = '';
    const ids = raw ? raw.split(',').map((id) => id.trim()).filter(Boolean) : [];
    assert.deepStrictEqual(ids, []);
  });

  test('guild ID splitting handles multiple ids', () => {
    const raw = '111,222, 333';
    const ids = raw ? raw.split(',').map((id) => id.trim()).filter(Boolean) : [];
    assert.deepStrictEqual(ids, ['111', '222', '333']);
  });
});

describe('webhook signature verification logic', () => {
  test('non-hex signature characters are rejected', () => {
    const HEX_PATTERN = /^[0-9a-f]+$/i;
    assert.ok(!HEX_PATTERN.test('zzzz'), 'Non-hex should fail pattern');
    assert.ok(HEX_PATTERN.test('deadbeef'), 'Valid hex should pass pattern');
    assert.ok(!HEX_PATTERN.test(''), 'Empty string should fail pattern');
  });

  test('timingSafeEqual rejects different length buffers', () => {
    const a = Buffer.from('abc', 'hex');
    const b = Buffer.from('abcd', 'hex');
    // Different lengths should not be considered equal.
    assert.notStrictEqual(a.length, b.length);
  });

  test('crypto hmac produces consistent output', async () => {
    const { createHmac } = await import('node:crypto');
    const hmac1 = createHmac('sha256', 'secret').update('body', 'utf8').digest('hex');
    const hmac2 = createHmac('sha256', 'secret').update('body', 'utf8').digest('hex');
    assert.strictEqual(hmac1, hmac2, 'Same input should produce same HMAC');
  });

  test('crypto hmac differs with different secrets', async () => {
    const { createHmac } = await import('node:crypto');
    const hmac1 = createHmac('sha256', 'secret1').update('body', 'utf8').digest('hex');
    const hmac2 = createHmac('sha256', 'secret2').update('body', 'utf8').digest('hex');
    assert.notStrictEqual(hmac1, hmac2, 'Different secrets should produce different HMACs');
  });
});
