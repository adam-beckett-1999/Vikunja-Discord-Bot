import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const DATA_DIR = '/data';
const STORE_PATH = resolve(DATA_DIR, 'webhook-records.json');

const EMPTY_STORE = {
  version: 1,
  records: [],
};

let writeQueue = Promise.resolve();

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeEvents(value) {
  return Array.isArray(value)
    ? value.map((eventName) => normalizeString(eventName)).filter(Boolean)
    : [];
}

async function readStore() {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.records)) {
      return { ...EMPTY_STORE };
    }

    return {
      version: 1,
      records: parsed.records.map((record) => normalizeRecord(record)).filter(Boolean),
    };
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { ...EMPTY_STORE };
    }

    throw err;
  }
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const projectId = normalizeNumber(record.projectId);
  const webhookId = normalizeNumber(record.webhookId);
  const targetUrl = normalizeString(record.targetUrl);
  const secret = normalizeString(record.secret);

  if (!projectId || !webhookId || !targetUrl || !secret) return null;

  return {
    projectId,
    webhookId,
    targetUrl,
    secret,
    events: normalizeEvents(record.events),
    updatedAt: normalizeString(record.updatedAt) || undefined,
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

export function generateWebhookSecret() {
  return randomBytes(32).toString('hex');
}

export async function upsertWebhookRecord(recordInput) {
  const projectId = normalizeNumber(recordInput?.projectId);
  const webhookId = normalizeNumber(recordInput?.webhookId);
  const targetUrl = normalizeString(recordInput?.targetUrl);
  const secret = normalizeString(recordInput?.secret);

  if (!projectId) {
    throw new Error('A valid project ID is required for webhook records.');
  }

  if (!webhookId) {
    throw new Error('A valid webhook ID is required for webhook records.');
  }

  if (!targetUrl) {
    throw new Error('A valid target URL is required for webhook records.');
  }

  if (!secret) {
    throw new Error('A valid webhook secret is required for webhook records.');
  }

  const events = normalizeEvents(recordInput?.events);

  return enqueueWrite(async () => {
    const store = await readStore();
    const updatedAt = new Date().toISOString();

    const nextRecord = {
      projectId,
      webhookId,
      targetUrl,
      secret,
      events,
      updatedAt,
    };

    const existingIndex = store.records.findIndex((record) => record.projectId === projectId);
    if (existingIndex >= 0) {
      store.records[existingIndex] = nextRecord;
    } else {
      store.records.push(nextRecord);
    }

    await writeStore(store);
    return nextRecord;
  });
}

export async function listWebhookRecords() {
  const store = await readStore();
  return store.records.slice().sort((a, b) => a.projectId - b.projectId);
}

export async function getWebhookRecordForProject(projectIdInput) {
  const projectId = normalizeNumber(projectIdInput);
  if (!projectId) return null;

  const store = await readStore();
  return store.records.find((record) => record.projectId === projectId) ?? null;
}