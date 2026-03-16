import type { PageKind, ProjectListing, ProviderName } from './types';
import {
  isChatGptProjectUrl,
  isClaudeProjectUrl,
  isClaudeConversationUrl,
} from './provider-url';

export function inferProvider(urlString: string): ProviderName | null {
  try {
    const url = new URL(urlString);
    if (url.hostname === 'chatgpt.com') return 'chatgpt';
    if (url.hostname === 'claude.ai') return 'claude';
    return null;
  } catch {
    return null;
  }
}

export function inferPageKind(urlString: string): PageKind {
  try {
    const url = new URL(urlString);
    const path = url.pathname;

    if (url.hostname === 'chatgpt.com') {
      if (/^\/c\/[A-Za-z0-9-]+$/.test(path)) return 'chat';
      if (/^\/g\/g-p-[^/]+\/c\/[A-Za-z0-9-]+$/.test(path)) return 'chat';
      if (/\/g-p-[A-Za-z0-9]+/.test(path) || /^\/g\/g-p-[A-Za-z0-9]+$/.test(path)) return 'project';
      if (path === '/' || /^\/gpts/.test(path) || /^\/library/.test(path)) return 'unsupported';
      return 'unknown';
    }

    if (url.hostname === 'claude.ai') {
      if (/\/chat\/[A-Za-z0-9-]+$/.test(path)) return 'chat';
      if (/\/(project|projects)\/[A-Za-z0-9-]+\/(chat|chats)\/[A-Za-z0-9-]+$/.test(path)) return 'chat';
      if (/\/(project|projects)\/[A-Za-z0-9-]+$/.test(path)) return 'project';
      if (path === '/' || /^\/new/.test(path) || /^\/settings/.test(path)) return 'unsupported';
      return 'unknown';
    }

    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

export function extractCurrentChatId(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    const path = url.pathname;
    const chatgpt = path.match(/^\/c\/([A-Za-z0-9-]+)$/);
    if (chatgpt) return chatgpt[1];
    const chatgptProject = path.match(/^\/g\/g-p-[^/]+\/c\/([A-Za-z0-9-]+)$/);
    if (chatgptProject) return chatgptProject[1];
    const claudeDirect = path.match(/\/chat\/([A-Za-z0-9-]+)$/);
    if (claudeDirect) return claudeDirect[1];
    const claudeProject = path.match(/\/(?:project|projects)\/[A-Za-z0-9-]+\/(?:chat|chats)\/([A-Za-z0-9-]+)$/);
    if (claudeProject) return claudeProject[1];
    return null;
  } catch {
    return null;
  }
}

export function extractCurrentProjectId(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    const path = url.pathname;
    const chatgpt = path.match(/g-p-([A-Za-z0-9]+)/);
    if (chatgpt) return `g-p-${chatgpt[1]}`;
    const claude = path.match(/\/(?:project|projects)\/([A-Za-z0-9-]+)/);
    if (claude) return claude[1];
    return null;
  } catch {
    return null;
  }
}

export function extractClaudeOrgIdFromUrl(url: string): string | null {
  const match = url.match(/\/api\/organizations\/([^/]+)\//);
  return match ? match[1] : null;
}

export function extractClaudeOrgIdFromUrls(urls: string[]): string | null {
  for (const url of urls) {
    const orgId = extractClaudeOrgIdFromUrl(url);
    if (orgId) return orgId;
  }
  return null;
}

export function buildCurrentProjectListingUrl(currentProjectPageUrl: string, observedApiUrls: string[], fallbackClaudeOrgId?: string | null): string | null {
  const provider = inferProvider(currentProjectPageUrl);
  if (provider === 'chatgpt') {
    const observed = observedApiUrls.find(isChatGptProjectUrl);
    if (observed) return observed;
    const projectId = extractCurrentProjectId(currentProjectPageUrl);
    if (!projectId) return null;
    return `https://chatgpt.com/backend-api/gizmos/${projectId}/conversations?cursor=0`;
  }

  if (provider === 'claude') {
    const observed = observedApiUrls.find(isClaudeProjectUrl);
    if (observed) return observed;
    const projectId = extractCurrentProjectId(currentProjectPageUrl);
    const orgId = extractClaudeOrgIdFromUrls(observedApiUrls) ?? fallbackClaudeOrgId ?? null;
    if (!projectId || !orgId) return null;
    return `https://claude.ai/api/organizations/${orgId}/projects/${projectId}/conversations_v2?limit=30&offset=0`;
  }

  return null;
}


export function buildChatGptCurrentConversationApiUrl(currentChatPageUrl: string, observedApiUrls: string[]): string | null {
  const observed = observedApiUrls.find((url) => /^https:\/\/chatgpt\.com\/backend-api\/conversation\/[A-Za-z0-9-]+(?:\?.*)?$/.test(url));
  if (observed) return observed;
  const chatId = extractCurrentChatId(currentChatPageUrl);
  if (!chatId) return null;
  return `https://chatgpt.com/backend-api/conversation/${chatId}`;
}

export function buildClaudeCurrentConversationApiUrl(currentChatPageUrl: string, observedApiUrls: string[], fallbackClaudeOrgId?: string | null): string | null {
  const chatId = extractCurrentChatId(currentChatPageUrl);
  const observed = chatId
    ? observedApiUrls.find((url) => isClaudeConversationUrl(url) && url.includes(`/chat_conversations/${chatId}`))
    : null;
  if (observed) return observed;
  const orgId = extractClaudeOrgIdFromUrls(observedApiUrls) ?? fallbackClaudeOrgId ?? null;
  if (!chatId || !orgId) return null;
  return `https://claude.ai/api/organizations/${orgId}/chat_conversations/${chatId}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=strong`;
}

export function buildProjectChatPageUrls(project: ProjectListing, currentProjectPageUrl: string, chatId: string): string[] {
  if (project.provider === 'chatgpt') {
    const base = currentProjectPageUrl.replace(/\/project(?:\?.*)?$/, '').replace(/\/$/, '');
    return [`${base}/c/${chatId}`];
  }

  if (project.provider === 'claude') {
    return [`https://claude.ai/chat/${chatId}`];
  }

  return [];
}

