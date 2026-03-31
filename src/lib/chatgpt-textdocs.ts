import { extractCurrentChatId } from "./page-context";
import { mergeChatGptTextdocs } from "./parser-chatgpt";
import type { ChatGptTextdoc, Conversation } from "./types";

export function replaceConversationTextdocs(
	conversation: Conversation,
	conversationId: string,
	textdocs: ChatGptTextdoc[],
): Conversation {
	if (conversation.provider !== "chatgpt") return conversation;
	if (!conversationMatchesTextdocsConversation(conversation, conversationId))
		return conversation;
	const merged = mergeChatGptTextdocs(conversation.chatGptTextdocs, textdocs);
	if (!merged || merged.length === 0) return conversation;
	return {
		...conversation,
		chatGptTextdocs: [...merged],
	};
}

export function conversationMatchesTextdocsConversation(
	conversation: Conversation,
	conversationId: string,
): boolean {
	if (conversation.provider !== "chatgpt") return false;
	if (conversation.id === conversationId) return true;
	const sourceChatId = conversation.sourceUrl
		? extractCurrentChatId(conversation.sourceUrl)
		: null;
	return sourceChatId === conversationId;
}
