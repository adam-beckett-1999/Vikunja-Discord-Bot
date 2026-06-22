import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DATA_DIR = process.env.DATA_DIR?.trim() || '/data';
const STORE_PATH = resolve(DATA_DIR, 'project-channel-links.json');

const EMPTY_STORE = {
  version: 1,
  links: [],
};

let writeQueue = Promise.resolve();

function normalizeChannelId(value) {
  return String(value ?? '').trim();
}

function normalizeProjectId(value) {
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
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

function normalizeLink(link) {
  if (!link || typeof link !== 'object') return null;

  const projectId = normalizeProjectId(link.projectId);
  const channelId = normalizeChannelId(link.channelId);

  if (!projectId || !channelId) return null;

  return {
    projectId,
    channelId,
    updatedAt: String(link.updatedAt ?? '').trim() || undefined,
  };
}

async function writeStore(nextStore) {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });

  const tempPath = STORE_PATH + '.tmp';
  const json = JSON.stringify(nextStore, null, 2) + '\n';
  await writeFile(tempPath, json, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, STORE_PATH);
}

function enqueueWrite(operation) {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

export async function setProjectChannelLink(projectIdInput, channelIdInput) {
  const projectId = normalizeProjectId(projectIdInput);
  const channelId = normalizeChannelId(channelIdInput);

  if (!projectId) {
    throw new Error('A valid project ID is required.');
  }

  if (!channelId) {
    throw new Error('A valid Discord channel ID is required.');
  }

  return enqueueWrite(async () => {
    const store = await readStore();
    const updatedAt = new Date().toISOString();

    const existingIndex = store.links.findIndex((link) => link.projectId === projectId);

    const nextLink = {
      projectId,
      channelId,
      updatedAt,
    };

    if (existingIndex >= 0) {
      store.links[existingIndex] = nextLink;
    } else {
      store.links.push(nextLink);
    }

    await writeStore(store);
    return nextLink;
  });
}

export async function removeProjectChannelLink(projectIdInput) {
  const projectId = normalizeProjectId(projectIdInput);
  if (!projectId) return false;

  return enqueueWrite(async () => {
    const store = await readStore();
    const nextLinks = store.links.filter((link) => link.projectId !== projectId);

    const removed = nextLinks.length !== store.links.length;
    if (!removed) return false;

    await writeStore({ ...store, links: nextLinks });
    return true;
  });
}

export async function getChannelIdForProject(projectIdInput) {
  const projectId = normalizeProjectId(projectIdInput);
  if (!projectId) return null;

  const store = await readStore();
  const match = store.links.find((link) => link.projectId === projectId);
  return match?.channelId ?? null;
}

export async function listProjectChannelLinks() {
  const store = await readStore();
  return store.links.slice().sort((a, b) => a.projectId - b.projectId);
}