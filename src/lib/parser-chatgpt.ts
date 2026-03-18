import { cleanVisibleMarkdown } from "./clean-text";
import { unwrapRecordedOrDirectJson } from "./recorded";
import type {
	ChatGptTextdoc,
	Conversation,
	Message,
	ProjectChatRef,
	ProjectListing,
} from "./types";

function orderedMappingNodes(mapping: Record<string, any>): any[] {
	const roots = Object.values<any>(mapping).filter((node) => !node?.parent);
	const out: any[] = [];
	const visit = (node: any) => {
		if (!node) return;
		out.push(node);
		for (const childId of node.children ?? []) visit(mapping[childId]);
	};
	for (const root of roots) visit(root);
	return out;
}

function extractTextContent(content: any): string {
	if (!content || typeof content !== "object") return "";
	if (content.content_type === "text" && Array.isArray(content.parts)) {
		return cleanVisibleMarkdown(
			content.parts
				.filter((part: unknown) => typeof part === "string")
				.join("\n"),
		);
	}
	if (
		content.content_type === "multimodal_text" &&
		Array.isArray(content.parts)
	) {
		return cleanVisibleMarkdown(
			content.parts
				.map((part: any) =>
					typeof part === "string"
						? part
						: typeof part?.text === "string"
							? part.text
							: "",
				)
				.filter(Boolean)
				.join("\n"),
		);
	}
	return "";
}

export function parseChatGptConversation(
	url: string,
	text: string,
	sourceUrl: string,
): Conversation | null {
	if (!url.includes("chatgpt.com/backend-api/conversation/")) return null;
	const data = unwrapRecordedOrDirectJson(text);
	if (!data?.mapping) return null;

	const messages: Message[] = [];
	for (const node of orderedMappingNodes(data.mapping)) {
		const raw = node?.message;
		if (!raw) continue;
		if (raw?.metadata?.is_visually_hidden_from_conversation) continue;
		const role = raw?.author?.role;
		if (role !== "user" && role !== "assistant") continue;
		const markdown = extractTextContent(raw.content);
		if (!markdown) continue;
		messages.push({
			id: raw.id ?? crypto.randomUUID(),
			role,
			markdown,
			createdAt: raw?.create_time
				? new Date(raw.create_time * 1000).toISOString()
				: undefined,
		});
	}

	if (messages.length === 0) return null;

	return {
		id: data.id ?? crypto.randomUUID(),
		provider: "chatgpt",
		title:
			typeof data.title === "string" && data.title.trim()
				? data.title.trim()
				: "Untitled-Chat",
		sourceUrl,
		exportedAt: new Date().toISOString(),
		messages,
	};
}

export function parseChatGptProject(
	url: string,
	text: string,
): ProjectListing | null {
	if (!url.includes("chatgpt.com/backend-api/gizmos/")) return null;
	const data = unwrapRecordedOrDirectJson(text);
	if (!Array.isArray(data?.items) || data.items.length === 0) return null;

	const gizmoMatch = url.match(
		/\/backend-api\/gizmos\/([^/]+)\/conversations/i,
	);
	const projectId =
		gizmoMatch?.[1] ??
		data.items[0]?.gizmo_id ??
		data.items[0]?.conversation_template_id;
	if (!projectId) return null;

	const chats: ProjectChatRef[] = data.items
		.filter((item: any) => typeof item?.id === "string")
		.map((item: any, index: number) => ({
			id: item.id,
			title:
				typeof item.title === "string" && item.title.trim()
					? item.title.trim()
					: "Untitled-Chat",
			order: index,
			createdAt: item.create_time,
			updatedAt: item.update_time,
		}));

	if (chats.length === 0) return null;

	return {
		provider: "chatgpt",
		projectId,
		projectName: `Project-${projectId}`,
		chats,
	};
}


export function parseChatGptTextdocs(
	url: string,
	text: string,
): { conversationId: string; textdocs: ChatGptTextdoc[] } | null {
	const match = url.match(
		/^https:\/\/chatgpt\.com\/backend-api\/conversation\/([A-Za-z0-9-]+)\/textdocs(?:\?.*)?$/,
	);
	if (!match) return null;
	const data = unwrapRecordedOrDirectJson(text);
	if (!Array.isArray(data)) return { conversationId: match[1], textdocs: [] };

	const textdocs = data
		.filter((item: any) => item && typeof item === "object")
		.map((item: any): ChatGptTextdoc | null => {
			const id = typeof item.id === "string" ? item.id : null;
			const content = typeof item.content === "string" ? item.content : null;
			if (!id || !content) return null;
			const title =
				typeof item.title === "string" && item.title.trim()
					? item.title.trim()
					: "Untitled-Canvas";
			const version =
				typeof item.version === "number" && Number.isFinite(item.version)
					? item.version
					: Number(item.version ?? 0) || 0;
			return {
				id,
				title,
				content,
				version,
				updatedAt:
					typeof item.updated_at === "string"
						? item.updated_at
						: typeof item.updatedAt === "string"
							? item.updatedAt
							: undefined,
				textdocType:
					typeof item.textdoc_type === "string"
						? item.textdoc_type
						: typeof item.textdocType === "string"
							? item.textdocType
							: undefined,
			};
		})
		.filter(Boolean) as ChatGptTextdoc[];

	return { conversationId: match[1], textdocs };
}

export function mergeChatGptTextdocs(
	current: ChatGptTextdoc[] | undefined,
	incoming: ChatGptTextdoc[] | undefined,
): ChatGptTextdoc[] | undefined {
	if (!incoming || incoming.length === 0) return current;
	if (!current || current.length === 0) return [...incoming];
	const merged = new Map<string, ChatGptTextdoc>();
	for (const item of current) merged.set(item.id, item);
	for (const item of incoming) {
		const existing = merged.get(item.id);
		if (!existing) {
			merged.set(item.id, item);
			continue;
		}
		if (item.version > existing.version) {
			merged.set(item.id, item);
			continue;
		}
		if (item.version < existing.version) continue;
		const existingTime = Date.parse(existing.updatedAt ?? "");
		const itemTime = Date.parse(item.updatedAt ?? "");
		if ((Number.isFinite(itemTime) ? itemTime : -Infinity) > (Number.isFinite(existingTime) ? existingTime : -Infinity)) {
			merged.set(item.id, item);
		}
	}
	return [...merged.values()];
}
