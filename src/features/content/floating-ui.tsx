import React from 'react';
import ReactDOM from 'react-dom/client';
import { ActionPanel } from '../shared/action-panel';
import { SelectExportModal } from '../shared/select-export-modal';
import { LogoIcon } from '../../lib/logo';
import { deriveConversationTurns } from '../../lib/chat-selection';
import { getPreferredExportFormat, setPreferredExportFormat } from '../../lib/storage';
import type { Conversation, ExportFormat, UiContext } from '../../lib/types';

export function mountFloatingUi(options: {
  getContext: () => Promise<UiContext>;
  getActiveConversation: () => Promise<Conversation | null>;
  onExportChat: (format: ExportFormat, selectedMessageIds?: string[]) => Promise<void>;
  onCopyChat: (format: ExportFormat, selectedMessageIds?: string[]) => Promise<void>;
  onExportProject: (format: ExportFormat) => Promise<void>;
}) {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.right = '28px';
  host.style.bottom = '22px';
  host.style.zIndex = '2147483647';
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const mount = document.createElement('div');
  shadow.append(mount);

  let api: { openSelectionModal: (format?: ExportFormat) => void } | null = null;
  const root = ReactDOM.createRoot(mount);
  root.render(<FloatingApp {...options} registerApi={(next) => { api = next; }} />);

  return {
    unmount: () => {
      root.unmount();
      host.remove();
    },
    openSelectionModal: (format?: ExportFormat) => {
      api?.openSelectionModal(format);
    },
  };
}

function FloatingApp(props: {
  registerApi?: (api: { openSelectionModal: (format?: ExportFormat) => void }) => void;
  getContext: () => Promise<UiContext>;
  getActiveConversation: () => Promise<Conversation | null>;
  onExportChat: (format: ExportFormat, selectedMessageIds?: string[]) => Promise<void>;
  onCopyChat: (format: ExportFormat, selectedMessageIds?: string[]) => Promise<void>;
  onExportProject: (format: ExportFormat) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [format, setFormat] = React.useState<ExportFormat>('markdown');
  const [busy, setBusy] = React.useState(false);
  const [selectionConversation, setSelectionConversation] = React.useState<Conversation | null>(null);
  const [selectedTurnIds, setSelectedTurnIds] = React.useState<Set<string>>(new Set());
  const [context, setContext] = React.useState<UiContext>({
    provider: null,
    pageKind: 'unknown',
    hasConversation: false,
    hasProject: false,
    waiting: false,
    showFloatingButton: true,
    projectExportStatus: null,
  });
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  const refresh = React.useCallback(async () => {
    const next = await props.getContext();
    setContext(next);
  }, [props]);

  React.useEffect(() => {
    void refresh();
    void getPreferredExportFormat().then(setFormat).catch(() => undefined);
  }, [refresh]);

  React.useEffect(() => {
    const id = window.setInterval(() => { void refresh(); }, open ? 700 : 1200);
    return () => window.clearInterval(id);
  }, [open, refresh]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current) return;
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (path.includes(boxRef.current)) return;
      if (!boxRef.current.contains(event.target as Node | null)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const openSelectionModal = React.useCallback((forcedFormat?: ExportFormat) => {
    setOpen(false);
    if (forcedFormat) {
      setFormat(forcedFormat);
      void setPreferredExportFormat(forcedFormat).catch(() => undefined);
    }
    setBusy(true);
    void props.getActiveConversation().then((conversation) => {
      if (!conversation) return;
      const turns = deriveConversationTurns(conversation);
      if (turns.length === 0) return;
      setSelectionConversation(conversation);
      setSelectedTurnIds(new Set(turns.map((turn) => turn.id)));
    }).finally(() => setBusy(false));
  }, [props]);

  React.useEffect(() => {
    props.registerApi?.({ openSelectionModal });
  }, [openSelectionModal, props]);

  const closeSelectionModal = React.useCallback(() => {
    if (busy) return;
    setSelectionConversation(null);
    setSelectedTurnIds(new Set());
  }, [busy]);

  const toggleTurn = React.useCallback((turnId: string) => {
    setSelectedTurnIds((current) => {
      const next = new Set(current);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });
  }, []);

  const selectionTurns = React.useMemo(
    () => selectionConversation ? deriveConversationTurns(selectionConversation) : [],
    [selectionConversation],
  );

  const confirmSelectionExport = React.useCallback(() => {
    if (!selectionConversation) return;
    const selectedMessageIds = selectionTurns
      .filter((turn) => selectedTurnIds.has(turn.id))
      .flatMap((turn) => turn.messageIds);
    if (selectedMessageIds.length === 0) return;

    setBusy(true);
    void props.onExportChat(format, selectedMessageIds).then(() => {
      setSelectionConversation(null);
      setSelectedTurnIds(new Set());
      setOpen(false);
    }).finally(() => setBusy(false));
  }, [format, props, selectedTurnIds, selectionConversation, selectionTurns]);

  if (context.pageKind === 'unsupported') return null;
  const showButton = context.showFloatingButton;

  return (
    <div ref={boxRef} style={{ position: 'relative', fontFamily: 'system-ui, sans-serif' }}>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            bottom: 'calc(100% + 10px)',
            width: 332,
            background: '#fff',
            border: '1px solid rgba(15,23,42,0.12)',
            borderRadius: 14,
            padding: 12,
            boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
          }}
        >
          <ActionPanel
            pageKind={context.pageKind}
            format={format}
            onFormatChange={(next) => { setFormat(next); void setPreferredExportFormat(next).catch(() => undefined); }}
            showFloatingButton={context.showFloatingButton}
            statusText={context.projectExportStatus ?? undefined}
            disabled={busy}
            onExport={() => {
              if (context.pageKind === 'project') {
                setBusy(true);
                void props.onExportProject(format).finally(() => { setBusy(false); void refresh(); });
                return;
              }
              setBusy(true);
              void props.onExportChat(format).finally(() => { setBusy(false); setOpen(false); });
            }}
            onSelectContentExport={context.pageKind === 'chat' ? openSelectionModal : undefined}
            onClipboard={context.pageKind === 'chat'
              ? () => { setBusy(true); void props.onCopyChat(format).finally(() => { setBusy(false); setOpen(false); }); }
              : undefined}
          />
        </div>
      )}

      {selectionConversation && (
        <SelectExportModal
          format={format}
          title={selectionConversation.title}
          turns={selectionTurns}
          selectedTurnIds={selectedTurnIds}
          busy={busy}
          onClose={closeSelectionModal}
          onSelectAll={() => setSelectedTurnIds(new Set(selectionTurns.map((turn) => turn.id)))}
          onSelectNone={() => setSelectedTurnIds(new Set())}
          onToggleTurn={toggleTurn}
          onConfirm={confirmSelectionExport}
        />
      )}

      {showButton && (
        <button
          type='button'
          onClick={() => {
            const nextOpen = !open;
            setOpen(nextOpen);
            if (nextOpen) void refresh();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 999,
            border: '1px solid rgba(15,23,42,0.14)',
            background: open ? '#1f2937' : '#fff',
            color: open ? '#fff' : '#111',
            cursor: 'pointer',
            boxShadow: '0 8px 22px rgba(0,0,0,0.22)',
          }}
        >
          <LogoIcon size={18} />
          <span>Export</span>
        </button>
      )}
    </div>
  );
}
