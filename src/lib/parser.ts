import { parseChatGptConversation, parseChatGptProject } from './parser-chatgpt';
import { parseClaudeConversation, parseClaudeProject } from './parser-claude';
import type { Conversation, ProjectListing } from './types';

export function parseConversation(url: string, text: string, sourceUrl: string): Conversation | null {
  return parseChatGptConversation(url, text, sourceUrl) ?? parseClaudeConversation(url, text, sourceUrl);
}

export function parseProjectListing(url: string, text: string): ProjectListing | null {
  return parseChatGptProject(url, text) ?? parseClaudeProject(url, text);
}
