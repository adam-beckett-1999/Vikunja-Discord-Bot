import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheProject,
  clearCachedProjectTitle,
  getCachedProjectTitle,
  warmProjectNameCache,
} from '../src/services/project-cache.js';

describe('project cache', () => {
  test('stores and resolves cached project names', () => {
    cacheProject({ id: 501, title: 'Services & Containers' });

    assert.strictEqual(getCachedProjectTitle(501), 'Services & Containers');

    clearCachedProjectTitle(501);
    assert.strictEqual(getCachedProjectTitle(501), undefined);
  });

  test('warms cache from Vikunja project list', async () => {
    const fetchProjects = async () => ({
      data: [
        { id: 601, title: 'Infrastructure' },
        { id: 602, title: 'Networking' },
      ],
    });

    const result = await warmProjectNameCache({ fetchProjects });

    assert.strictEqual(getCachedProjectTitle(601), 'Infrastructure');
    assert.strictEqual(getCachedProjectTitle(602), 'Networking');
    assert.strictEqual(result.projectsCached, 2);

    clearCachedProjectTitle(601);
    clearCachedProjectTitle(602);
  });
});
