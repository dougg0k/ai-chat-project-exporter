import { cleanVisibleMarkdown } from "./clean-text";
import { unwrapRecordedOrDirectJson } from "./recorded";
import {
	extractChatGptConversationIdFromApiUrl,
	getChatGptConversationApiKind,
	isChatGptConversationUrl,
} from "./provider-url";
import type {
	Conversation,
	Message,
	ProjectChatRef,
	ProjectListing,
} from "./types";

function orderedMappingNodes(mapping: Record<string, any>): any[] {
	const entries = Object.values<any>(mapping).filter(Boolean);
	if (entries.length === 0) return [];

	const roots = entries.filter((node) => !node?.parent);
	const startNodes = roots.length > 0 ? roots : entries;
	const out: any[] = [];
	const seen = new Set<any>();
	const queued = new Set<any>();
	const stack = [...startNodes].reverse();

	for (const node of stack) queued.add(node);

	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) continue;
		queued.delete(node);
		if (seen.has(node)) continue;
		seen.add(node);
		out.push(node);
		const children = Array.isArray(node.children) ? node.children : [];
		for (let index = children.length - 1; index >= 0; index -= 1) {
			const childId = children[index];
			if (typeof childId !== "string") continue;
			const child = mapping[childId];
			if (!child || seen.has(child) || queued.has(child)) continue;
			stack.push(child);
			queued.add(child);
		}
	}

	if (seen.size < entries.length) {
		for (const node of entries) {
			if (seen.has(node)) continue;
			seen.add(node);
			out.push(node);
		}
	}

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

export interface ChatGptConversationPage {
	conversationId: string;
	title?: string;
	sourceApiUrl: string;
	rawMessages: any[];
	pageInfo: {
		startCursor: string | null;
		hasPreviousPage: boolean;
		hasNextPage: boolean;
	};
}

function parseVisibleChatGptMessages(rawMessages: any[]): Message[] {
	const messages: Message[] = [];
	for (const raw of rawMessages) {
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
	return messages;
}

function parseChatGptConversationPageData(
	url: string,
	data: any,
): ChatGptConversationPage | null {
	const kind = getChatGptConversationApiKind(url);
	if (kind !== "initial" && kind !== "messages") return null;
	if (!Array.isArray(data?.messages)) return null;
	if (!data?.page_info || typeof data.page_info !== "object") return null;
	if (typeof data.page_info.has_previous_page !== "boolean") return null;
	if (typeof data.page_info.has_next_page !== "boolean") return null;

	const urlConversationId = extractChatGptConversationIdFromApiUrl(url);
	const dataConversationId =
		typeof data.conversation_id === "string" && data.conversation_id.trim()
			? data.conversation_id.trim()
			: null;
	if (!urlConversationId && !dataConversationId) return null;
	if (
		urlConversationId &&
		dataConversationId &&
		urlConversationId !== dataConversationId
	) {
		return null;
	}

	return {
		conversationId: dataConversationId ?? urlConversationId ?? "",
		title:
			typeof data.title === "string" && data.title.trim()
				? data.title.trim()
				: undefined,
		sourceApiUrl: url,
		rawMessages: data.messages,
		pageInfo: {
			startCursor:
				typeof data.page_info.start_cursor === "string" &&
				data.page_info.start_cursor.trim()
					? data.page_info.start_cursor
					: null,
			hasPreviousPage: data.page_info.has_previous_page,
			hasNextPage: data.page_info.has_next_page,
		},
	};
}

export function parseChatGptConversationPage(
	url: string,
	text: string,
): ChatGptConversationPage | null {
	if (!isChatGptConversationUrl(url)) return null;
	const data = unwrapRecordedOrDirectJson(text);
	return parseChatGptConversationPageData(url, data);
}

export function buildChatGptConversationFromPages(
	pagesOldestToNewest: ChatGptConversationPage[],
	sourceUrl: string,
): Conversation | null {
	const firstPage = pagesOldestToNewest[0];
	if (!firstPage) return null;
	const conversationId = firstPage.conversationId;
	if (
		!conversationId ||
		pagesOldestToNewest.some((page) => page.conversationId !== conversationId)
	) {
		return null;
	}

	const rawMessages: any[] = [];
	const rawIndexById = new Map<string, number>();
	for (const page of pagesOldestToNewest) {
		for (const raw of page.rawMessages) {
			if (!raw) continue;
			const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : null;
			if (!id) {
				rawMessages.push(raw);
				continue;
			}
			const existingIndex = rawIndexById.get(id);
			if (existingIndex == null) {
				rawIndexById.set(id, rawMessages.length);
				rawMessages.push(raw);
			} else {
				rawMessages[existingIndex] = raw;
			}
		}
	}
	const messages = parseVisibleChatGptMessages(rawMessages);
	if (messages.length === 0) return null;

	const title = [...pagesOldestToNewest]
		.reverse()
		.find((page) => page.title?.trim())?.title;

	return {
		id: conversationId,
		provider: "chatgpt",
		title: title ?? "Untitled-Chat",
		sourceUrl,
		exportedAt: new Date().toISOString(),
		messages,
	};
}

export function parseChatGptConversation(
	url: string,
	text: string,
	sourceUrl: string,
): Conversation | null {
	if (!isChatGptConversationUrl(url)) return null;
	const data = unwrapRecordedOrDirectJson(text);

	if (data?.mapping && typeof data.mapping === "object") {
		const rawMessages = orderedMappingNodes(data.mapping)
			.map((node) => node?.message)
			.filter(Boolean);
		const messages = parseVisibleChatGptMessages(rawMessages);
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

	const page = parseChatGptConversationPageData(url, data);
	if (
		getChatGptConversationApiKind(url) !== "initial" ||
		!page ||
		page.pageInfo.hasPreviousPage ||
		page.pageInfo.hasNextPage
	)
		return null;
	return buildChatGptConversationFromPages([page], sourceUrl);
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
		nextCursor:
			typeof data.cursor === "string"
				? data.cursor
				: data.cursor === null
					? null
					: undefined,
	};
}
