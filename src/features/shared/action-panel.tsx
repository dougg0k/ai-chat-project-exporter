import React from 'react';
import { LogoIcon } from '../../lib/logo';
import type { ExportFormat, PageKind } from '../../lib/types';

export interface ActionPanelProps {
  pageKind: PageKind;
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  onExport: () => void;
  onClipboard?: () => void;
  onToggleFloating?: (value: boolean) => void;
  showFloatingButton?: boolean;
  disabled?: boolean;
  compact?: boolean;
  statusText?: string;
}

export function ActionPanel(props: ActionPanelProps) {
  const isChat = props.pageKind === 'chat';
  const isProject = props.pageKind === 'project';
  const supported = isChat || isProject;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#111' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <LogoIcon size={20} />
        <div style={{ fontWeight: 700 }}>AI Chat / Project Exporter</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <FormatButton active={props.format === 'markdown'} onClick={() => props.onFormatChange('markdown')}>Markdown</FormatButton>
        <FormatButton active={props.format === 'html'} onClick={() => props.onFormatChange('html')}>HTML</FormatButton>
      </div>

      {!supported && <InfoText>Open a supported chat or project page.</InfoText>}

      {supported && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <ActionButton onClick={props.onExport} disabled={props.disabled}>Export</ActionButton>
          {isChat && props.onClipboard && (
            <ActionButton onClick={props.onClipboard} disabled={props.disabled}>Clipboard</ActionButton>
          )}
        </div>
      )}

      {props.statusText && <StatusText text={props.statusText} />}

      {props.onToggleFloating && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={props.showFloatingButton !== false}
            onChange={(e) => props.onToggleFloating?.(e.target.checked)}
          />
          Show floating export button
        </label>
      )}
    </div>
  );
}

function FormatButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid rgba(15,23,42,0.14)',
        background: props.active ? '#1f2937' : '#fff',
        color: props.active ? '#fff' : '#111',
        cursor: 'pointer',
      }}
    >
      {props.children}
    </button>
  );
}

function ActionButton(props: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        padding: '9px 14px',
        borderRadius: 10,
        border: '1px solid rgba(15,23,42,0.18)',
        background: '#fff',
        color: '#111',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.6 : 1,
      }}
    >
      {props.children}
    </button>
  );
}

function InfoText(props: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 12, fontSize: 13, color: '#555' }}>{props.children}</div>;
}


function StatusText(props: { text: string }) {
  const [label, ...rest] = props.text.split(':');
  if (rest.length === 0) return <InfoText>{props.text}</InfoText>;
  return (
    <div style={{ marginBottom: 12, fontSize: 13, color: '#555' }}>
      <strong>{label}:</strong> {rest.join(':').trim()}
    </div>
  );
}
