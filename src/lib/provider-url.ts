export type ChatGptConversationApiKind = "legacy" | "initial" | "messages";

export interface ChatGptConversationApiMatch {
	kind: ChatGptConversationApiKind;
	conversationId: string;
}

export function isRelevantProviderApiUrl(url: string): boolean {
	return (
		isChatGptConversationUrl(url) ||
		isChatGptProjectUrl(url) ||
		isClaudeConversationUrl(url) ||
		isClaudeProjectUrl(url)
	);
}

export function matchChatGptConversationApiUrl(
	url: string,
): ChatGptConversationApiMatch | null {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "chatgpt.com") return null;

		const legacy = parsed.pathname.match(
			/^\/backend-api\/conversation\/([A-Za-z0-9-]+)\/?$/,
		);
		if (legacy) {
			const conversationId = legacy[1];
			return conversationId ? { kind: "legacy", conversationId } : null;
		}

		const paginated = parsed.pathname.match(
			/^\/backend-api\/conversations\/([A-Za-z0-9-]+)(\/messages)?\/?$/,
		);
		if (!paginated) return null;
		const conversationId = paginated[1];
		if (!conversationId) return null;
		return {
			kind: paginated[2] ? "messages" : "initial",
			conversationId,
		};
	} catch {
		return null;
	}
}

export function isChatGptConversationUrl(url: string): boolean {
	return matchChatGptConversationApiUrl(url) !== null;
}

export function getChatGptConversationApiKind(
	url: string,
): ChatGptConversationApiKind | null {
	return matchChatGptConversationApiUrl(url)?.kind ?? null;
}

export function extractChatGptConversationIdFromApiUrl(
	url: string,
): string | null {
	return matchChatGptConversationApiUrl(url)?.conversationId ?? null;
}

export function extractChatGptConversationBeforeCursorFromApiUrl(
	url: string,
): string | null {
	const match = matchChatGptConversationApiUrl(url);
	if (match?.kind !== "messages") return null;
	try {
		const value = new URL(url).searchParams.get("before")?.trim();
		return value || null;
	} catch {
		return null;
	}
}

export function isChatGptProjectUrl(url: string): boolean {
	return /^https:\/\/chatgpt\.com\/backend-api\/gizmos\/g-p-[A-Za-z0-9]+\/conversations(?:\?.*)?$/.test(
		url,
	);
}

export function isClaudeConversationUrl(url: string): boolean {
	return /^https:\/\/claude\.ai\/api\/organizations\/[^/]+\/chat_conversations\/[A-Za-z0-9-]+(?:\?.*)?$/.test(
		url,
	);
}

export function isClaudeProjectUrl(url: string): boolean {
	return /^https:\/\/claude\.ai\/api\/organizations\/[^/]+\/(?:project|projects)\/[^/]+\/conversations_v2(?:\?.*)?$/.test(
		url,
	);
}
