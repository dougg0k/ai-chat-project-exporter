import React from 'react';
import type { ExportFormat } from '../../lib/types';
import type { ConversationTurn } from '../../lib/chat-selection';

export interface SelectExportModalProps {
  format: ExportFormat;
  title: string;
  turns: ConversationTurn[];
  selectedTurnIds: Set<string>;
  busy?: boolean;
  onClose: () => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onToggleTurn: (turnId: string) => void;
  onConfirm: () => void;
}

export function SelectExportModal(props: SelectExportModalProps) {
  const selectedCount = props.turns.filter((turn) => props.selectedTurnIds.has(turn.id)).length;

  return (
    <div style={overlayStyle}>
      <div style={modalStyle} role="dialog" aria-modal="true" aria-label="Select content to export">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 4 }}>Select content to export</div>
            <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
              Chat: {props.title}
            </div>
            <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.45, marginTop: 4 }}>
              Current format: <strong>{props.format === 'html' ? 'HTML' : 'Markdown'}</strong>
            </div>
          </div>
          <button type="button" onClick={props.onClose} style={closeButtonStyle} aria-label="Close selection modal">×</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#4b5563' }}>{selectedCount} of {props.turns.length} turns selected</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <SmallButton onClick={props.onSelectAll}>Select all</SmallButton>
            <SmallButton onClick={props.onSelectNone}>None</SmallButton>
          </div>
        </div>

        <div style={listStyle}>
          {props.turns.map((turn) => {
            const checked = props.selectedTurnIds.has(turn.id);
            return (
              <label key={turn.id} style={{ ...turnCardStyle, borderColor: checked ? '#111827' : 'rgba(15,23,42,0.12)', background: checked ? 'rgba(17,24,39,0.03)' : '#fff' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => props.onToggleTurn(turn.id)}
                  style={{ marginTop: 2, width: 16, height: 16, flex: '0 0 auto' }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#111', marginBottom: 6 }}>
                    Turn {turn.index}
                  </div>
                  <PreviewBlock label="Prompt" text={turn.userPreview} />
                  <PreviewBlock label="Answer" text={turn.assistantPreview} />
                </div>
              </label>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <FooterButton onClick={props.onClose} disabled={props.busy}>Cancel</FooterButton>
          <FooterButton onClick={props.onConfirm} disabled={props.busy || selectedCount === 0} primary>
            {props.busy ? 'Exporting…' : 'Export selected'}
          </FooterButton>
        </div>
      </div>
    </div>
  );
}

function PreviewBlock(props: { label: string; text: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', marginBottom: 3 }}>{props.label}</div>
      <div style={{ fontSize: 12, color: '#111', lineHeight: 1.45, whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
        {props.text}
      </div>
    </div>
  );
}

function SmallButton(props: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={props.onClick} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(15,23,42,0.14)', background: '#fff', color: '#111', cursor: 'pointer', fontSize: 12 }}>
      {props.children}
    </button>
  );
}

function FooterButton(props: { onClick: () => void; children: React.ReactNode; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        padding: '9px 14px',
        borderRadius: 10,
        border: props.primary ? '1px solid #111827' : '1px solid rgba(15,23,42,0.14)',
        background: props.primary ? '#111827' : '#fff',
        color: props.primary ? '#fff' : '#111',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.6 : 1,
      }}
    >
      {props.children}
    </button>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.28)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 14,
};

const modalStyle: React.CSSProperties = {
  width: 768,
  maxWidth: '100%',
  maxHeight: 'min(92vh, 760px)',
  background: '#fff',
  borderRadius: 16,
  border: '1px solid rgba(15,23,42,0.12)',
  boxShadow: '0 18px 48px rgba(0,0,0,0.18)',
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
};

const listStyle: React.CSSProperties = {
  overflowY: 'auto',
  maxHeight: 'min(64vh, 520px)',
  paddingRight: 2,
};

const turnCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: 12,
  borderRadius: 12,
  border: '1px solid rgba(15,23,42,0.12)',
  cursor: 'pointer',
  marginBottom: 8,
};

const closeButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(15,23,42,0.14)',
  background: '#fff',
  color: '#111',
  borderRadius: 10,
  width: 32,
  height: 32,
  cursor: 'pointer',
  fontSize: 20,
  lineHeight: 1,
  flex: '0 0 auto',
};
