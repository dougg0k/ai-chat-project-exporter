import { browser } from 'wxt/browser';
import { CLAUDE_ORG_ID_KEY, DEFAULT_EXPORT_FORMAT, EXPORT_FORMAT_KEY, FLOATING_POSITIONS_KEY, FLOATING_VISIBILITY_KEY } from './constants';
import type { ExportFormat } from './types';

export interface FloatingButtonPosition {
  x: number;
  y: number;
}

type FloatingButtonPositionsByScope = Record<string, FloatingButtonPosition>;

function normalizeFormat(value: unknown): ExportFormat {
  return value === 'html' ? 'html' : 'markdown';
}

function normalizePosition(value: unknown): FloatingButtonPosition | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { x?: unknown; y?: unknown };
  if (typeof candidate.x !== 'number' || !Number.isFinite(candidate.x)) return null;
  if (typeof candidate.y !== 'number' || !Number.isFinite(candidate.y)) return null;
  return { x: candidate.x, y: candidate.y };
}

function normalizePositionMap(value: unknown): FloatingButtonPositionsByScope {
  if (!value || typeof value !== 'object') return {};
  const result: FloatingButtonPositionsByScope = {};
  for (const [scope, position] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizePosition(position);
    if (normalized) result[scope] = normalized;
  }
  return result;
}

export async function getShowFloatingButton(): Promise<boolean> {
  const result = await browser.storage.local.get(FLOATING_VISIBILITY_KEY);
  return result[FLOATING_VISIBILITY_KEY] !== false;
}

export async function setShowFloatingButton(value: boolean): Promise<void> {
  await browser.storage.local.set({ [FLOATING_VISIBILITY_KEY]: value });
}

export async function getPreferredExportFormat(): Promise<ExportFormat> {
  const result = await browser.storage.local.get(EXPORT_FORMAT_KEY);
  return normalizeFormat(result[EXPORT_FORMAT_KEY] ?? DEFAULT_EXPORT_FORMAT);
}

export async function setPreferredExportFormat(value: ExportFormat): Promise<void> {
  await browser.storage.local.set({ [EXPORT_FORMAT_KEY]: value });
}

export async function getFloatingButtonPosition(scope: string): Promise<FloatingButtonPosition | null> {
  const result = await browser.storage.local.get(FLOATING_POSITIONS_KEY);
  const positions = normalizePositionMap(result[FLOATING_POSITIONS_KEY]);
  return positions[scope] ?? null;
}

export async function setFloatingButtonPosition(scope: string, position: FloatingButtonPosition): Promise<void> {
  const result = await browser.storage.local.get(FLOATING_POSITIONS_KEY);
  const positions = normalizePositionMap(result[FLOATING_POSITIONS_KEY]);
  positions[scope] = position;
  await browser.storage.local.set({ [FLOATING_POSITIONS_KEY]: positions });
}

export async function getLastClaudeOrgId(): Promise<string | null> {
  const result = await browser.storage.local.get(CLAUDE_ORG_ID_KEY);
  return typeof result[CLAUDE_ORG_ID_KEY] === 'string' && result[CLAUDE_ORG_ID_KEY].trim() ? result[CLAUDE_ORG_ID_KEY] : null;
}

export async function setLastClaudeOrgId(value: string | null): Promise<void> {
  if (typeof value === 'string' && value.trim()) {
    await browser.storage.local.set({ [CLAUDE_ORG_ID_KEY]: value });
    return;
  }
  await browser.storage.local.remove(CLAUDE_ORG_ID_KEY);
}
