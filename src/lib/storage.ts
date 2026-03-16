import { browser } from 'wxt/browser';
import { CLAUDE_ORG_ID_KEY, DEFAULT_EXPORT_FORMAT, EXPORT_FORMAT_KEY, FLOATING_VISIBILITY_KEY } from './constants';
import type { ExportFormat } from './types';

function normalizeFormat(value: unknown): ExportFormat {
  return value === 'html' ? 'html' : 'markdown';
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
