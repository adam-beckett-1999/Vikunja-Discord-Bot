const MAX_TEXT_LENGTH = 1024;

function escapeDiscordMarkdown(value) {
  return String(value ?? '').replace(/[\\`*_~|]/g, '\\$&');
}

export function normalizeLabelName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function parseHexColor(hex) {
  if (typeof hex !== 'string') return null;

  let normalized = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    normalized = normalized.split('').map((ch) => ch + ch).join('');
  }

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  const int = Number.parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return { r, g, b };
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }
  }

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return { h, s: s * 100, l: l * 100 };
}

export function getLabelColorBadge(hex) {
  const rgb = parseHexColor(hex);
  if (!rgb) return '🏷️';

  const { h, s, l } = rgbToHsl(rgb);

  if (s < 10 && l < 25) return '⬛';
  if (s < 10 && l > 85) return '⬜';
  if (s < 12) return '⚪';

  if (h < 20 || h >= 345) return '🟥';
  if (h < 45) return '🟧';
  if (h < 70) return '🟨';
  if (h < 170) return '🟩';
  if (h < 260) return '🟦';
  return '🟪';
}

export function extractTaskLabels(task) {
  const rawLabels = Array.isArray(task?.labels)
    ? task.labels
    : Array.isArray(task?.tags)
    ? task.tags
      : [];

  const byName = new Map();

  for (const raw of rawLabels) {
    if (typeof raw === 'string') {
      const normalized = normalizeLabelName(raw);
      if (!normalized) continue;
      byName.set(normalized.toLowerCase(), {
        id: undefined,
        name: normalized,
        color: undefined,
      });
      continue;
    }

    if (!raw || typeof raw !== 'object') continue;

    const normalized = normalizeLabelName(raw.title ?? raw.name ?? raw.label);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    const existing = byName.get(key);
    byName.set(key, {
      id: raw.id ?? existing?.id,
      name: normalized,
      color: raw.hex_color ?? raw.hexColor ?? raw.color ?? existing?.color,
    });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatLabelNameList(names, maxLength = 120) {
  const clean = names.map((name) => escapeDiscordMarkdown(normalizeLabelName(name))).filter(Boolean);
  if (!clean.length) return 'none';

  const text = clean.join(', ');
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + '…';
}

export function formatTaskLabelsForEmbed(task, maxLength = MAX_TEXT_LENGTH) {
  const labels = extractTaskLabels(task);
  if (!labels.length) return null;

  const lines = labels.map((label) => getLabelColorBadge(label.color) + ' ' + escapeDiscordMarkdown(label.name));
  const value = lines.join('\n');
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength - 1).trimEnd() + '…';
}

export function diffTaskLabelNames(oldTask, newTask) {
  const oldNames = extractTaskLabels(oldTask).map((label) => label.name);
  const newNames = extractTaskLabels(newTask).map((label) => label.name);

  const oldSet = new Set(oldNames.map((name) => name.toLowerCase()));
  const newSet = new Set(newNames.map((name) => name.toLowerCase()));

  const added = newNames.filter((name) => !oldSet.has(name.toLowerCase()));
  const removed = oldNames.filter((name) => !newSet.has(name.toLowerCase()));

  return { added, removed, oldNames, newNames };
}

// Backward-compatible aliases.
export const normalizeTagName = normalizeLabelName;
export const getTagColorBadge = getLabelColorBadge;
export const extractTaskTags = extractTaskLabels;
export const formatTagNameList = formatLabelNameList;
export const formatTaskTagsForEmbed = formatTaskLabelsForEmbed;
export const diffTaskTagNames = diffTaskLabelNames;
