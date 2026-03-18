import { extractCurrentChatId } from "./page-context";
import type { ChatGptTextdoc, Conversation } from "./types";

export function replaceConversationTextdocs(
	conversation: Conversation,
	conversationId: string,
	textdocs: ChatGptTextdoc[],
): Conversation {
	if (conversation.provider !== "chatgpt") return conversation;
	if (!conversationMatchesTextdocsConversation(conversation, conversationId))
		return conversation;
	return {
		...conversation,
		chatGptTextdocs: [...textdocs],
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
