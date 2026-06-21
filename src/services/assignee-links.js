import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getTaskAssignees } from './vikunja.js';
import { extractTaskAssignees } from '../utils/task-assignees.js';

const DATA_DIR = '/data';
const STORE_PATH = resolve(DATA_DIR, 'assignee-links.json');

const EMPTY_STORE = {
  version: 1,
  links: [],
};

let writeQueue = Promise.resolve();

function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeComparable(value) {
  return normalize(value).toLowerCase();
}

function toUserIdentityKey({ id, username, displayName }) {
  if (Number.isFinite(id)) return 'id:' + id;
  if (normalizeComparable(username)) return 'username:' + normalizeComparable(username);
  if (normalizeComparable(displayName)) return 'name:' + normalizeComparable(displayName);
  return '';
}

function getCandidateIdentityKeys(identity) {
  const keys = [];

  if (Number.isFinite(identity?.id)) {
    keys.push('id:' + identity.id);
  }

  const username = normalizeComparable(identity?.username);
  if (username) keys.push('username:' + username);

  const displayName = normalizeComparable(identity?.displayName);
  if (displayName) keys.push('name:' + displayName);

  return keys;
}

async function readStore() {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.links)) {
      return { ...EMPTY_STORE };
    }

    return {
      version: 1,
      links: parsed.links
        .map((link) => normalizeLink(link))
        .filter(Boolean),
    };
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { ...EMPTY_STORE };
    }

    throw err;
  }
}

async function writeStore(nextStore) {
  await mkdir(DATA_DIR, { recursive: true });

  const tempPath = STORE_PATH + '.tmp';
  const json = JSON.stringify(nextStore, null, 2) + '\n';
  await writeFile(tempPath, json, 'utf8');
  await rename(tempPath, STORE_PATH);
}

function normalizeLink(link) {
  if (!link || typeof link !== 'object') return null;

  const discordUserId = normalize(link.discordUserId);
  if (!discordUserId) return null;

  const vikunjaUserId = Number(link.vikunjaUserId);
  const normalizedUserId = Number.isFinite(vikunjaUserId) ? vikunjaUserId : undefined;

  const normalized = {
    vikunjaUserId: normalizedUserId,
    vikunjaUsername: normalize(link.vikunjaUsername) || undefined,
    vikunjaDisplayName: normalize(link.vikunjaDisplayName) || undefined,
    discordUserId,
    updatedAt: normalize(link.updatedAt) || undefined,
  };

  if (!normalized.vikunjaUserId && !normalized.vikunjaUsername && !normalized.vikunjaDisplayName) {
    return null;
  }

  return normalized;
}

function enqueueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

export async function linkAssigneeToDiscordUser(assignee, discordUserId) {
  const normalizedDiscordUserId = normalize(discordUserId);
  if (!normalizedDiscordUserId) {
    throw new Error('A valid Discord user ID is required.');
  }

  const normalizedAssignee = {
    id: Number.isFinite(Number(assignee?.id)) ? Number(assignee.id) : undefined,
    username: normalize(assignee?.username) || undefined,
    displayName: normalize(assignee?.displayName ?? assignee?.label) || undefined,
  };

  const identityKey = toUserIdentityKey(normalizedAssignee);
  if (!identityKey) {
    throw new Error('Could not determine a Vikunja assignee identity to store.');
  }

  return enqueueWrite(async () => {
    const store = await readStore();
    const keys = getCandidateIdentityKeys(normalizedAssignee);

    const updatedLink = {
      vikunjaUserId: normalizedAssignee.id,
      vikunjaUsername: normalizedAssignee.username,
      vikunjaDisplayName: normalizedAssignee.displayName,
      discordUserId: normalizedDiscordUserId,
      updatedAt: new Date().toISOString(),
    };

    const existingIndex = store.links.findIndex((link) => {
      const existingKeys = getCandidateIdentityKeys({
        id: link.vikunjaUserId,
        username: link.vikunjaUsername,
        displayName: link.vikunjaDisplayName,
      });
      return existingKeys.some((key) => keys.includes(key));
    });

    if (existingIndex >= 0) {
      store.links[existingIndex] = updatedLink;
    } else {
      store.links.push(updatedLink);
    }

    await writeStore(store);
    return updatedLink;
  });
}

export async function unlinkAssigneeFromDiscordUser(assignee) {
  const normalizedAssignee = {
    id: Number.isFinite(Number(assignee?.id)) ? Number(assignee.id) : undefined,
    username: normalize(assignee?.username) || undefined,
    displayName: normalize(assignee?.displayName ?? assignee?.label) || undefined,
  };

  const keys = getCandidateIdentityKeys(normalizedAssignee);
  if (!keys.length) {
    return false;
  }

  return enqueueWrite(async () => {
    const store = await readStore();
    const nextLinks = store.links.filter((link) => {
      const existingKeys = getCandidateIdentityKeys({
        id: link.vikunjaUserId,
        username: link.vikunjaUsername,
        displayName: link.vikunjaDisplayName,
      });

      return !existingKeys.some((key) => keys.includes(key));
    });

    const removed = nextLinks.length !== store.links.length;
    if (!removed) return false;

    await writeStore({ ...store, links: nextLinks });
    return true;
  });
}

export async function listAssigneeLinks() {
  const store = await readStore();
  return store.links.slice().sort((a, b) => {
    const aName = a.vikunjaDisplayName || a.vikunjaUsername || String(a.vikunjaUserId ?? '');
    const bName = b.vikunjaDisplayName || b.vikunjaUsername || String(b.vikunjaUserId ?? '');
    return aName.localeCompare(bName);
  });
}

export async function getMappedDiscordUserIdsForTask(task) {
  let assignees = extractTaskAssignees(task);

  if (!assignees.length && Number.isFinite(Number(task?.id))) {
    assignees = await getTaskAssignees(task.id)
      .then((res) => extractTaskAssignees({ assignees: res.data }))
      .catch(() => []);
  }

  if (!assignees.length) return [];

  const store = await readStore();
  if (!store.links.length) return [];

  const mentions = new Set();

  for (const assignee of assignees) {
    const keys = getCandidateIdentityKeys({
      id: assignee.id,
      username: assignee.username,
      displayName: assignee.displayName,
    });

    if (!keys.length) continue;

    for (const link of store.links) {
      const linkKeys = getCandidateIdentityKeys({
        id: link.vikunjaUserId,
        username: link.vikunjaUsername,
        displayName: link.vikunjaDisplayName,
      });

      if (linkKeys.some((key) => keys.includes(key))) {
        mentions.add(link.discordUserId);
      }
    }
  }

  return [...mentions];
}