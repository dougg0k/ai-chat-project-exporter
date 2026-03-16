import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import { deriveConversationTurns } from './chat-selection';
import type { Conversation, ExportFormat, ProjectListing } from './types';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: true,
});

function formatDateTime(value?: string): string {
  if (!value) return 'Unknown';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} UTC`;
}

function totalCharacters(conversation: Conversation): number {
  return conversation.messages.reduce((sum, msg) => sum + msg.markdown.length, 0);
}

function buildHtmlDocument(title: string, markdown: string): string {
  const renderedHtml = md.render(markdown);
  const formattedHtml = renderedHtml
    .replace(/></g, '>\n<')
    .replace(/\n{3,}/g, '\n\n');
  const safeHtml = DOMPurify.sanitize(formattedHtml);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; line-height: 1.6; margin: 32px auto; max-width: 900px; padding: 0 16px; color: #111; }
      pre { background: #111; color: #eee; padding: 12px; border-radius: 8px; overflow: auto; white-space: pre-wrap; }
      code { font-family: ui-monospace, monospace; }
      blockquote { color: #555; border-left: 4px solid #ddd; padding-left: 12px; margin-left: 0; }
    </style>
  </head>
  <body>${safeHtml}</body>
</html>`;
}

export function buildMarkdown(conversation: Conversation): string {
  const totalTurns = deriveConversationTurns(conversation).length;
  const lines: string[] = [
    `# ${conversation.title}`,
    '',
    `Platform: ${conversation.provider}`,
    `Source URL: ${conversation.sourceUrl}`,
    `Exported At: ${formatDateTime(conversation.exportedAt)}`,
    `Total Turns: ${totalTurns}`,
    `Underlying Messages: ${conversation.messages.length}`,
    `Total Characters: ${totalCharacters(conversation)}`,
    '',
  ];

  for (const message of conversation.messages) {
    lines.push(`## ${message.role === 'user' ? 'User' : 'Assistant'}`);
    if (message.createdAt) {
      lines.push(`Date Time: ${formatDateTime(message.createdAt)}`);
    }
    lines.push('', message.markdown, '');
  }

  if (conversation.appendixMarkdown?.trim()) {
    lines.push(conversation.appendixMarkdown.trim(), '');
  }

  return `${lines.join('\n').trim()}\n`;
}

export function buildHtml(conversation: Conversation): string {
  return buildHtmlDocument(conversation.title, buildMarkdown(conversation));
}

export function renderStandaloneMarkdownHtml(title: string, markdown: string): string {
  const content = markdown.trimStart().startsWith('# ') ? markdown : `# ${title}\n\n${markdown}`;
  return buildHtmlDocument(title, content);
}

export function renderConversation(conversation: Conversation, format: ExportFormat): string {
  return format === 'html' ? buildHtml(conversation) : buildMarkdown(conversation);
}

export function buildProjectManifest(project: ProjectListing, conversations: Conversation[]) {
  return {
    projectName: project.projectName,
    provider: project.provider,
    projectId: project.projectId,
    chatCount: project.chats.length,
    exportedCount: conversations.length,
    chats: project.chats.map((chat) => {
      const convo = conversations.find((c) => c.id === chat.id);
      return {
        id: chat.id,
        title: chat.title,
        order: chat.order,
        createdAt: chat.createdAt ? formatDateTime(chat.createdAt) : null,
        updatedAt: chat.updatedAt ? formatDateTime(chat.updatedAt) : null,
        messageCount: convo?.messages.length ?? null,
        totalCharacters: convo ? convo.messages.reduce((sum, msg) => sum + msg.markdown.length, 0) : null,
        answerDatetimes: convo
          ? convo.messages.filter((m) => m.role === 'assistant').map((m) => (m.createdAt ? formatDateTime(m.createdAt) : null))
          : [],
      };
    }),
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
