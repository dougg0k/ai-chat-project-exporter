import React from 'react';
import { browser } from 'wxt/browser';
import { ActionPanel } from '../shared/action-panel';
import { DEFAULT_EXPORT_FORMAT } from '../../lib/constants';
import { inferPageKind } from '../../lib/page-context';
import { getPreferredExportFormat, getShowFloatingButton, setPreferredExportFormat, setShowFloatingButton } from '../../lib/storage';
import type { ExportFormat, PageKind, UiContext } from '../../lib/types';

const FORMAT_KEY = 'preferredExportFormat';
const FLOATING_KEY = 'showFloatingExportButton';

function initialFormat(): ExportFormat {
  if (typeof localStorage === 'undefined') return DEFAULT_EXPORT_FORMAT;
  return localStorage.getItem(FORMAT_KEY) === 'html' ? 'html' : 'markdown';
}

function initialFloating(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(FLOATING_KEY) !== 'false';
}

export function PopupApp() {
  const [format, setFormatState] = React.useState<ExportFormat>(initialFormat);
  const [pageKind, setPageKind] = React.useState<PageKind>('unknown');
  const [showFloatingButton, setShowFloatingState] = React.useState<boolean>(initialFloating);
  const [activeTabId, setActiveTabId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string>('');
  const [status, setStatus] = React.useState<string>('');
  const [loadingSelection, setLoadingSelection] = React.useState(false);

  const refreshContext = React.useCallback(async () => {
    if (activeTabId == null) return;
    try {
      const ctx = await browser.tabs.sendMessage(activeTabId, { type: 'GET_UI_CONTEXT' }) as UiContext;
      if (ctx?.pageKind) {
        setPageKind(ctx.pageKind);
        setStatus(ctx.projectExportStatus ?? '');
      }
    } catch {
      // ignore
    }
  }, [activeTabId]);

  React.useEffect(() => {
    void (async () => {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url) {
          setPageKind('unsupported');
          return;
        }
        setActiveTabId(tab.id);
        setPageKind(inferPageKind(tab.url));
      } catch {
        setPageKind('unsupported');
      }
    })();

    void (async () => {
      try {
        const [storedFormat, storedFloating] = await Promise.all([
          getPreferredExportFormat(),
          getShowFloatingButton(),
        ]);
        setFormatState(storedFormat);
        setShowFloatingState(storedFloating);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(FORMAT_KEY, storedFormat);
          localStorage.setItem(FLOATING_KEY, storedFloating ? 'true' : 'false');
        }
      } catch {
        // ignore storage sync failures
      }
    })();
  }, []);

  React.useEffect(() => {
    void refreshContext();
    const id = window.setInterval(() => { void refreshContext(); }, 800);
    return () => window.clearInterval(id);
  }, [refreshContext]);

  const setFormat = React.useCallback((next: ExportFormat) => {
    setFormatState(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(FORMAT_KEY, next);
    void setPreferredExportFormat(next).catch(() => undefined);
  }, []);

  const toggleFloating = React.useCallback((next: boolean) => {
    setShowFloatingState(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(FLOATING_KEY, next ? 'true' : 'false');
    void setShowFloatingButton(next).catch(() => undefined);
    if (activeTabId != null) {
      void browser.tabs.sendMessage(activeTabId, { type: 'SET_FLOATING_VISIBILITY', value: next }).catch(() => undefined);
    }
  }, [activeTabId]);

  const runChatAction = React.useCallback((target: 'file' | 'clipboard', selectedMessageIds?: string[]) => {
    if (activeTabId == null) return;
    setError('');

    if (target === 'clipboard') {
      void browser.tabs.sendMessage(activeTabId, { type: 'GET_RENDERED_CHAT', format, selectedMessageIds }).then(async (result) => {
        if (!result?.ok || typeof result.text !== 'string') {
          setError(result?.error || 'Clipboard failed.');
          return;
        }
        await navigator.clipboard.writeText(result.text);
        window.close();
      }).catch((err) => setError(err?.message || 'Clipboard failed.'));
      return;
    }

    void browser.tabs.sendMessage(activeTabId, { type: 'EXPORT_CHAT', format, target, selectedMessageIds }).then((result) => {
      if (result?.ok === false) {
        setError(result.error || 'Chat action failed.');
        return;
      }
      window.close();
    }).catch((err) => setError(err?.message || 'Chat action failed.'));
  }, [activeTabId, format]);

  const runProjectAction = React.useCallback(() => {
    if (activeTabId == null) return;
    setError('');
    void browser.tabs.sendMessage(activeTabId, { type: 'EXPORT_PROJECT', format }).then((result) => {
      if (result?.ok === false) {
        setError(result.error || 'Project export failed.');
        return;
      }
      window.close();
    }).catch((err) => setError(err?.message || 'Project export failed.'));
  }, [activeTabId, format]);

  const openSelectionModal = React.useCallback(() => {
    if (activeTabId == null) return;
    setError('');
    setLoadingSelection(true);
    void browser.tabs.sendMessage(activeTabId, { type: 'OPEN_SELECT_EXPORT_MODAL', format }).then((result) => {
      if (result?.ok === false) {
        setError(result.error || 'Failed to open content selector.');
        return;
      }
      window.close();
    }).catch((err) => setError(err?.message || 'Failed to open content selector.')).finally(() => setLoadingSelection(false));
  }, [activeTabId, format]);

  return (
    <main style={{ minWidth: 340, padding: 14, fontFamily: 'system-ui, sans-serif' }}>
      <ActionPanel
        pageKind={pageKind}
        format={format}
        onFormatChange={setFormat}
        onExport={pageKind === 'project' ? runProjectAction : () => runChatAction('file')}
        onSelectContentExport={pageKind === 'chat' ? openSelectionModal : undefined}
        onClipboard={pageKind === 'chat' ? () => runChatAction('clipboard') : undefined}
        onToggleFloating={toggleFloating}
        showFloatingButton={showFloatingButton}
        statusText={status || undefined}
        disabled={loadingSelection}
      />
      {error && <div style={{ marginTop: 10, fontSize: 12, color: '#b91c1c' }}>{error}</div>}
    </main>
  );
}
