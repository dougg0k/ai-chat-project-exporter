import { cleanVisibleMarkdown } from "./clean-text";
import type { Conversation, Message } from "./types";

export interface ConversationTurn {
	id: string;
	index: number;
	messageIds: string[];
	userPreview: string;
	assistantPreview: string;
	userDetail: string;
	assistantDetail: string;
	searchSnippets: string[];
	messageCount: number;
}

export function deriveConversationTurns(
	conversation: Conversation,
): ConversationTurn[] {
	const turns: ConversationTurn[] = [];
	let currentMessages: Message[] = [];
	let turnIndex = 0;

	const pushTurn = () => {
		if (currentMessages.length === 0) return;
		turnIndex += 1;
		turns.push({
			id: `turn-${turnIndex}`,
			index: turnIndex,
			messageIds: currentMessages.map((message) => message.id),
			userPreview: buildRolePreview(currentMessages, "user"),
			assistantPreview: buildRolePreview(currentMessages, "assistant"),
			userDetail: buildRoleDetail(currentMessages, "user"),
			assistantDetail: buildRoleDetail(currentMessages, "assistant"),
			searchSnippets: buildSearchSnippets(currentMessages),
			messageCount: currentMessages.length,
		});
		currentMessages = [];
	};

	for (const message of conversation.messages) {
		if (message.role === "user" && currentMessages.length > 0) {
			pushTurn();
		}
		currentMessages.push(message);
	}

	pushTurn();
	return turns;
}

export function filterConversationToMessageIds(
	conversation: Conversation,
	selectedMessageIds: string[],
): Conversation {
	const allowed = new Set(selectedMessageIds);
	return {
		...conversation,
		messages: conversation.messages.filter((message) =>
			allowed.has(message.id),
		),
	};
}

function buildRolePreview(messages: Message[], role: Message["role"]): string {
	const roleMessages = messages.filter((message) => message.role === role);
	if (roleMessages.length === 0) {
		return role === "user"
			? "No user prompt in this selection unit."
			: "No assistant reply in this selection unit.";
	}

	const first = summarizeMarkdown(
		roleMessages[0].markdown,
		role === "user" ? 160 : 220,
	);
	if (roleMessages.length === 1) return first;
	return `${first} (+${roleMessages.length - 1} more ${role === "user" ? "message" : "reply"}${roleMessages.length > 2 ? "s" : ""})`;
}

function buildRoleDetail(messages: Message[], role: Message["role"]): string {
	const roleMessages = messages.filter((message) => message.role === role);
	if (roleMessages.length === 0) {
		return role === "user"
			? "No user prompt in this selection unit."
			: "No assistant reply in this selection unit.";
	}

	return roleMessages
		.map((message, index) => {
			const cleaned = cleanVisibleMarkdown(message.markdown).trim();
			const body = cleaned || "No visible text.";
			if (roleMessages.length === 1) return body;
			return `${role === "user" ? "Prompt" : "Reply"} ${index + 1}\n${body}`;
		})
		.join("\n\n────────\n\n");
}

function buildSearchSnippets(messages: Message[]): string[] {
	const snippets = messages
		.map((message) => buildSearchSnippet(message.markdown))
		.filter((value): value is string => Boolean(value));
	return Array.from(new Set(snippets));
}

function buildSearchSnippet(markdown: string): string | null {
	const normalized = normalizeSearchText(markdown);
	if (!normalized) return null;
	if (normalized.length <= 120) return normalized;
	return normalized.slice(0, 120).trimEnd();
}

function summarizeMarkdown(markdown: string, maxLength: number): string {
	const normalized = normalizeSearchText(markdown);
	const safeText = normalized || "No visible text.";
	if (safeText.length <= maxLength) return safeText;
	return `${safeText.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeSearchText(markdown: string): string {
	return cleanVisibleMarkdown(markdown)
		.replace(/```[\s\S]*?```/g, " code block ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/!\[[^\]]*\]\(([^)]+)\)/g, "$1")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
		.replace(/[>*_~]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
