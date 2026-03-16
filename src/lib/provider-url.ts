export function isRelevantProviderApiUrl(url: string): boolean {
  return isChatGptConversationUrl(url) || isChatGptProjectUrl(url) || isClaudeConversationUrl(url) || isClaudeProjectUrl(url);
}

export function isChatGptConversationUrl(url: string): boolean {
  return /^https:\/\/chatgpt\.com\/backend-api\/conversation\/[A-Za-z0-9-]+(?:\?.*)?$/.test(url);
}

export function isChatGptProjectUrl(url: string): boolean {
  return /^https:\/\/chatgpt\.com\/backend-api\/gizmos\/g-p-[A-Za-z0-9]+\/conversations(?:\?.*)?$/.test(url);
}

export function isClaudeConversationUrl(url: string): boolean {
  return /^https:\/\/claude\.ai\/api\/organizations\/[^/]+\/chat_conversations\/[A-Za-z0-9-]+(?:\?.*)?$/.test(url);
}

export function isClaudeProjectUrl(url: string): boolean {
  return /^https:\/\/claude\.ai\/api\/organizations\/[^/]+\/(?:project|projects)\/[^/]+\/conversations_v2(?:\?.*)?$/.test(url);
}
