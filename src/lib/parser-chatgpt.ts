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

interface ChatGptReferenceSource {
	title?: string;
	url?: string;
	attribution?: string;
}

interface ChatGptReferenceItem {
	title?: string;
	url?: string;
}

interface ChatGptContentReference {
	type?: string;
	start_idx?: number;
	end_idx?: number;
	matched_text?: string;
	alt?: string;
	items?: ChatGptReferenceItem[];
	sources?: ChatGptReferenceSource[];
	safe_urls?: string[];
}

function getRawTextContent(content: any): string {
	if (!content || typeof content !== "object") return "";
	if (content.content_type === "text" && Array.isArray(content.parts)) {
		return content.parts
			.filter((part: unknown) => typeof part === "string")
			.join("\n");
	}
	if (
		content.content_type === "multimodal_text" &&
		Array.isArray(content.parts)
	) {
		return content.parts
			.map((part: any) =>
				typeof part === "string"
					? part
					: typeof part?.text === "string"
						? part.text
						: "",
			)
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

function buildReferenceLink(title: string, url: string): string {
	return `[${title}](${url})`;
}

function addReferenceSource(
	map: Map<string, ChatGptReferenceSource>,
	source: ChatGptReferenceSource | ChatGptReferenceItem | null | undefined,
): void {
	if (!source) return;
	const url = typeof source.url === "string" ? source.url.trim() : "";
	if (!url) return;
	const title =
		typeof source.title === "string" && source.title.trim()
			? source.title.trim()
			: "attribution" in source &&
					typeof source.attribution === "string" &&
					source.attribution.trim()
				? source.attribution.trim()
				: url;
	if (!map.has(url)) {
		map.set(url, {
			title,
			url,
			attribution: "attribution" in source ? source.attribution : undefined,
		});
	}
}

function buildSourcesBlock(
	sources: Map<string, ChatGptReferenceSource>,
): string {
	if (sources.size === 0) return "";
	return [
		"Sources:",
		...[...sources.values()].map((source) => {
			const url = source.url?.trim() ?? "";
			const title = source.title?.trim() || url;
			return `- ${buildReferenceLink(title, url)}`;
		}),
	].join("\n");
}

function buildInlineImageGroup(reference: ChatGptContentReference): string {
	const items = Array.isArray(reference.items)
		? reference.items.filter((item): item is ChatGptReferenceItem =>
				Boolean(
					item && typeof item.url === "string" && item.url.trim().length > 0,
				),
			)
		: [];
	if (items.length > 0) {
		return items
			.map((item) => {
				const url = item.url?.trim() ?? "";
				if (!url) return "";
				const title =
					typeof item.title === "string" && item.title.trim()
						? item.title.trim()
						: "";
				return title ? `- ${buildReferenceLink(title, url)}` : `- <${url}>`;
			})
			.filter(Boolean)
			.join("\n");
	}

	const urls = Array.isArray(reference.safe_urls)
		? reference.safe_urls.filter(
				(value): value is string =>
					typeof value === "string" && value.trim().length > 0,
			)
		: [];
	if (urls.length === 0) return "";
	return urls.map((url) => `- <${url}>`).join("\n");
}

function buildInlineLinkTitle(reference: ChatGptContentReference): string {
	const alt = typeof reference.alt === "string" ? reference.alt.trim() : "";
	if (alt) return alt;
	const item = Array.isArray(reference.items)
		? reference.items.find(
				(entry) => entry && typeof entry.url === "string" && entry.url.trim(),
			)
		: undefined;
	if (!item?.url) return "";
	const title =
		typeof item.title === "string" && item.title.trim()
			? item.title.trim()
			: item.url;
	return buildReferenceLink(title, item.url);
}

function renderChatGptReferences(
	input: string,
	references: ChatGptContentReference[],
): string {
	if (!input.trim() || references.length === 0) return input;

	const sources = new Map<string, ChatGptReferenceSource>();
	const applicable = references
		.filter((reference) => reference && typeof reference === "object")
		.map((reference) => ({
			reference,
			start:
				typeof reference.start_idx === "number" &&
				Number.isFinite(reference.start_idx)
					? Math.max(0, Math.min(input.length, reference.start_idx))
					: -1,
			end:
				typeof reference.end_idx === "number" &&
				Number.isFinite(reference.end_idx)
					? Math.max(0, Math.min(input.length, reference.end_idx))
					: -1,
		}))
		.sort((a, b) => a.start - b.start || a.end - b.end);

	const parts: string[] = [];
	let cursor = 0;

	for (const entry of applicable) {
		const { reference, start, end } = entry;
		const type = typeof reference.type === "string" ? reference.type : "";

		if (type === "grouped_webpages") {
			for (const item of Array.isArray(reference.items)
				? reference.items
				: []) {
				addReferenceSource(sources, item);
			}
		} else if (type === "sources_footnote") {
			for (const source of Array.isArray(reference.sources)
				? reference.sources
				: []) {
				addReferenceSource(sources, source);
			}
		}

		if (start < 0 || end < start || start < cursor) continue;
		parts.push(input.slice(cursor, start));

		if (type === "image_group") {
			parts.push(buildInlineImageGroup(reference));
		} else if (type === "link_title") {
			parts.push(buildInlineLinkTitle(reference));
		} else if (type === "grouped_webpages" || type === "sources_footnote") {
			// omit inline reference token; append as sources below
		} else {
			const alt = typeof reference.alt === "string" ? reference.alt.trim() : "";
			parts.push(alt);
		}

		cursor = end;
	}

	parts.push(input.slice(cursor));
	const body = parts.join("");
	const sourcesBlock = buildSourcesBlock(sources);
	return sourcesBlock ? `${body.trim()}\n\n${sourcesBlock}` : body;
}

function extractTextContent(raw: any): string {
	const rawText = getRawTextContent(raw?.content);
	if (!rawText) return "";
	const references = Array.isArray(raw?.metadata?.content_references)
		? (raw.metadata.content_references as ChatGptContentReference[])
		: [];
	const enriched = references.length
		? renderChatGptReferences(rawText, references)
		: rawText;
	return cleanVisibleMarkdown(enriched);
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
		const markdown = extractTextContent(raw);
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
		if (
			(Number.isFinite(itemTime) ? itemTime : -Infinity) >
			(Number.isFinite(existingTime) ? existingTime : -Infinity)
		) {
			merged.set(item.id, item);
		}
	}
	return [...merged.values()];
}
