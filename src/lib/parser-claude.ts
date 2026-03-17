import { cleanVisibleMarkdown } from "./clean-text";
import { unwrapRecordedOrDirectJson } from "./recorded";
import type {
	Conversation,
	Message,
	ProjectChatRef,
	ProjectListing,
} from "./types";

function extractClaudeText(content: any[]): string {
	return cleanVisibleMarkdown(
		content
			.map((item: any) =>
				item?.type === "text" && typeof item.text === "string" ? item.text : "",
			)
			.filter(Boolean)
			.join("\n\n"),
	);
}

function normalizeClaudeProjectChatTitle(value: string): string {
	const normalized = value
		.split(/\r?\n+/)
		.map((segment) => segment.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.filter(
			(segment) =>
				!/^(last message\b|updated\b|edited\b|today\b|yesterday\b|\d+\s+(?:minutes?|hours?|days?|weeks?|months?)\s+ago\b)/i.test(
					segment,
				),
		);

	if (normalized.length > 0) return normalized[0];
	return value.replace(/\s+/g, " ").trim();
}

export function parseClaudeConversation(
	url: string,
	text: string,
	sourceUrl: string,
): Conversation | null {
	if (!url.includes("chat_conversations/")) return null;
	const data = unwrapRecordedOrDirectJson(text);
	if (!Array.isArray(data?.chat_messages)) return null;

	const messages: Message[] = data.chat_messages
		.slice()
		.sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
		.map((msg: any) => {
			const role =
				msg.sender === "assistant"
					? "assistant"
					: msg.sender === "human"
						? "user"
						: null;
			if (!role) return null;
			const markdown = Array.isArray(msg.content)
				? extractClaudeText(msg.content)
				: "";
			if (!markdown) return null;
			return {
				id: msg.uuid ?? crypto.randomUUID(),
				role,
				markdown,
				createdAt: msg.created_at,
			} satisfies Message;
		})
		.filter(Boolean) as Message[];

	if (messages.length === 0) return null;

	return {
		id: data.uuid ?? crypto.randomUUID(),
		provider: "claude",
		title:
			typeof data.name === "string" && data.name.trim()
				? data.name.trim()
				: "Untitled-Chat",
		sourceUrl,
		exportedAt: new Date().toISOString(),
		messages,
	};
}

export function parseClaudeProject(
	url: string,
	text: string,
): ProjectListing | null {
	if (!url.includes("conversations_v2/")) return null;
	const data = unwrapRecordedOrDirectJson(text);
	if (!Array.isArray(data?.data) || data.data.length === 0) return null;

	const match = url.match(
		/\/api\/organizations\/([^/]+)\/(?:project|projects)\/([^/]+)\/conversations_v2/i,
	);
	const orgId = match?.[1];
	const projectId = match?.[2] ?? data.data[0]?.project_uuid;
	if (!projectId) return null;

	const chats: ProjectChatRef[] = data.data
		.filter((item: any) => typeof item?.uuid === "string")
		.map((item: any, index: number) => ({
			id: item.uuid,
			title:
				typeof item.name === "string" && item.name.trim()
					? normalizeClaudeProjectChatTitle(item.name)
					: "Untitled-Chat",
			order: index,
			createdAt: item.created_at,
			updatedAt: item.updated_at,
		}));

	if (chats.length === 0) return null;

	return {
		provider: "claude",
		projectId,
		projectName: `Project-${projectId}`,
		chats,
		fetchContext: orgId ? { orgId } : undefined,
	};
}
