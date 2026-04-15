import { cleanVisibleMarkdown } from "./clean-text";
import {
	renderConversation,
	renderStandaloneMarkdownHtml,
} from "./export-format";
import { buildConversationFilename, safeFilenamePart } from "./file";
import type {
	Conversation,
	ExportFormat,
	GeneratedDocument,
	Message,
} from "./types";

export interface CanvasAsset {
	kind: "canvas" | "generated-document";
	title: string;
	markdownRelativePath?: string;
	markdown: string;
	htmlRelativePath?: string;
	html?: string;
	embeddedMarkdown?: string;
	linkRelativePath: string;
	sourceMessageId: string;
}

export interface PreparedConversationExport {
	conversation: Conversation;
	canvases: CanvasAsset[];
	mainFilename: string;
}

export function prepareConversationExport(
	conversation: Conversation,
	format: ExportFormat,
	now = new Date(),
	options?: {
		nestAssetsUnderChatFolder?: boolean;
		includeDocumentsCanvas?: boolean;
	},
): PreparedConversationExport {
	const chatFolder = safeFilenamePart(conversation.title) || "untitled-chat";
	const nestAssetsUnderChatFolder = options?.nestAssetsUnderChatFolder ?? true;
	const includeDocumentsCanvas = options?.includeDocumentsCanvas ?? true;
	const ext = format === "html" ? "html" : "md";
	const mainFilename = buildConversationFilename(
		conversation.title,
		conversation.provider,
		ext,
		now,
	);
	const usedPaths = new Set<string>();
	const canvases: CanvasAsset[] = [];
	const chatGptCanvasAssets = includeDocumentsCanvas
		? materializeChatGptTextdocs(
				conversation,
				format,
				chatFolder,
				usedPaths,
				nestAssetsUnderChatFolder,
			)
		: [];
	const chatGptCanvasResolver =
		conversation.provider === "chatgpt"
			? buildChatGptCanvasResolver(chatGptCanvasAssets)
			: undefined;
	canvases.push(...chatGptCanvasAssets);

	const messages = conversation.messages.map((message) =>
		transformMessage(
			message,
			format,
			chatFolder,
			usedPaths,
			canvases,
			nestAssetsUnderChatFolder,
			chatGptCanvasResolver,
			includeDocumentsCanvas,
		),
	);
	const generatedDocumentAssets = includeDocumentsCanvas
		? materializeGeneratedDocuments(
				conversation.generatedDocuments ?? [],
				format,
				chatFolder,
				usedPaths,
				nestAssetsUnderChatFolder,
			)
		: [];
	const appendixMarkdown = includeDocumentsCanvas
		? buildGeneratedDocumentsAppendix(generatedDocumentAssets, format)
		: "";

	return {
		conversation: {
			...conversation,
			messages,
			appendixMarkdown:
				[conversation.appendixMarkdown?.trim(), appendixMarkdown]
					.filter(Boolean)
					.join("\n\n") || undefined,
		},
		canvases: [...canvases, ...generatedDocumentAssets],
		mainFilename,
	};
}

function transformMessage(
	message: Message,
	format: ExportFormat,
	chatFolder: string,
	usedPaths: Set<string>,
	canvases: CanvasAsset[],
	nestAssetsUnderChatFolder: boolean,
	chatGptCanvasResolver: Map<string, CanvasAsset> | undefined,
	includeDocumentsCanvas: boolean,
): Message {
	if (message.role !== "assistant") return message;
	const parsed = findCanvasPayload(message.markdown);
	if (!parsed) return message;

	if (!includeDocumentsCanvas) {
		const prefixOnly = normalizeVisiblePrefix(
			parsed.prefix,
			inferTitleFromPrefix(parsed.prefix) || "Canvas",
		);
		const suffix = parsed.suffix.trim();
		return {
			...message,
			markdown: [prefixOnly, suffix].filter(Boolean).join("\n\n").trim(),
		};
	}

	let artifact: CanvasAsset | null = null;
	if (chatGptCanvasResolver) {
		artifact = resolveChatGptCanvasArtifact(
			parsed.payload,
			parsed.prefix,
			chatGptCanvasResolver,
		);
		const suffix = parsed.suffix.trim();
		if (!artifact) {
			const prefixOnly = normalizeVisiblePrefix(
				parsed.prefix,
				inferTitleFromPrefix(parsed.prefix) || "Canvas",
			);
			return {
				...message,
				markdown: [prefixOnly, suffix].filter(Boolean).join("\n\n").trim(),
			};
		}
		const replacement =
			format === "html"
				? (artifact.embeddedMarkdown ?? "")
				: `[${artifact.title}](${artifact.linkRelativePath})`;
		const prefix = normalizeVisiblePrefix(parsed.prefix, artifact.title);
		const parts = [prefix, replacement, suffix].filter(Boolean);
		return { ...message, markdown: parts.join("\n\n").trim() };
	}

	artifact = materializeCanvas(
		parsed.payload,
		parsed.prefix,
		message.id,
		chatFolder,
		usedPaths,
		format,
		nestAssetsUnderChatFolder,
	);
	if (!artifact) return message;
	canvases.push(artifact);
	const replacement =
		format === "html"
			? (artifact.embeddedMarkdown ?? "")
			: `[${artifact.title}](${artifact.linkRelativePath})`;
	const prefix = normalizeVisiblePrefix(parsed.prefix, artifact.title);
	const suffix = parsed.suffix.trim();
	const parts = [prefix, replacement, suffix].filter(Boolean);
	return { ...message, markdown: parts.join("\n\n").trim() };
}

function normalizeVisiblePrefix(prefix: string, title: string): string {
	const trimmed = prefix.trim();
	if (!trimmed) return "";
	return trimmed
		.replace(
			new RegExp(String.raw`^Canvas:\s*${escapeRegExp(title)}\s*$`, "im"),
			"",
		)
		.replace(/^Canvas:\s*$/im, "")
		.trim();
}

function materializeCanvas(
	payload: any,
	prefix: string,
	messageId: string,
	chatFolder: string,
	usedPaths: Set<string>,
	format: ExportFormat,
	nestAssetsUnderChatFolder: boolean,
): CanvasAsset | null {
	if (!payload || typeof payload !== "object") return null;

	if (typeof payload.name === "string" && typeof payload.content === "string") {
		const title =
			payload.name.trim() || inferTitleFromPrefix(prefix) || "Untitled-Canvas";
		const markdown = cleanVisibleMarkdown(payload.content);
		if (!markdown.trim()) return null;
		return buildAsset({
			kind: "canvas",
			title,
			markdown,
			messageId,
			chatFolder,
			usedPaths,
			format,
			nestAssetsUnderChatFolder,
			folderName: "canvas",
			label: "Canvas",
		});
	}

	if (Array.isArray(payload.updates)) {
		const candidate = [...payload.updates]
			.reverse()
			.find(
				(update) =>
					typeof update?.replacement === "string" &&
					looksLikeCanvasDocument(update?.replacement, update?.pattern),
			);
		if (!candidate) return null;
		const markdown = cleanVisibleMarkdown(candidate.replacement);
		if (!markdown.trim()) return null;
		const title =
			inferTitleFromPrefix(prefix) ||
			inferTitleFromMarkdown(markdown) ||
			"Untitled-Canvas";
		return buildAsset({
			kind: "canvas",
			title,
			markdown,
			messageId,
			chatFolder,
			usedPaths,
			format,
			nestAssetsUnderChatFolder,
			folderName: "canvas",
			label: "Canvas",
		});
	}

	return null;
}

function materializeChatGptTextdocs(
	conversation: Conversation,
	format: ExportFormat,
	chatFolder: string,
	usedPaths: Set<string>,
	nestAssetsUnderChatFolder: boolean,
): CanvasAsset[] {
	if (conversation.provider !== "chatgpt") return [];
	const textdocs = conversation.chatGptTextdocs ?? [];
	if (textdocs.length === 0) return [];
	return textdocs
		.map((textdoc) => {
			const markdown = cleanVisibleMarkdown(textdoc.content || "");
			if (!markdown.trim()) return null;
			return buildAsset({
				kind: "canvas",
				title: textdoc.title || "Untitled-Canvas",
				markdown,
				messageId: textdoc.id,
				chatFolder,
				usedPaths,
				format,
				nestAssetsUnderChatFolder,
				folderName: "canvas",
				label: "Canvas",
			});
		})
		.filter(Boolean) as CanvasAsset[];
}

function buildChatGptCanvasResolver(
	assets: CanvasAsset[],
): Map<string, CanvasAsset> {
	const resolver = new Map<string, CanvasAsset>();
	for (const asset of assets) {
		resolver.set(normalizeCanvasLookupKey(asset.title), asset);
	}
	return resolver;
}

function resolveChatGptCanvasArtifact(
	payload: any,
	prefix: string,
	resolver: Map<string, CanvasAsset>,
): CanvasAsset | null {
	const candidates = [
		typeof payload?.name === "string" ? payload.name : "",
		inferTitleFromPrefix(prefix) ?? "",
	];
	for (const candidate of candidates) {
		const key = normalizeCanvasLookupKey(candidate);
		if (!key) continue;
		const asset = resolver.get(key);
		if (asset) return asset;
	}
	return null;
}

function normalizeCanvasLookupKey(value: string): string {
	return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function materializeGeneratedDocuments(
	documents: GeneratedDocument[],
	format: ExportFormat,
	chatFolder: string,
	usedPaths: Set<string>,
	nestAssetsUnderChatFolder: boolean,
): CanvasAsset[] {
	return documents
		.map((document) => {
			const markdown = cleanVisibleMarkdown(document.markdown || "");
			if (!markdown.trim()) return null;
			return buildAsset({
				kind: "generated-document",
				title: document.title,
				markdown,
				messageId: document.id,
				chatFolder,
				usedPaths,
				format,
				nestAssetsUnderChatFolder,
				folderName: "documents",
				label: "Generated Document",
				sourceRelativePath: document.relativeOutputPath || document.filename,
			});
		})
		.filter(Boolean) as CanvasAsset[];
}

function buildGeneratedDocumentsAppendix(
	assets: CanvasAsset[],
	format: ExportFormat,
): string {
	if (assets.length === 0) return "";

	if (format === "html") {
		return [
			"## Generated Documents",
			"",
			...assets.map(
				(asset) =>
					asset.embeddedMarkdown ??
					`### Generated Document: [${asset.title}](${asset.linkRelativePath})`,
			),
		]
			.join("\n\n")
			.trim();
	}

	const lines = ["## Generated Documents", ""];
	for (const asset of assets)
		lines.push(`- [${asset.title}](${asset.linkRelativePath})`);
	return lines.join("\n").trim();
}

type AssetBuildOptions = {
	kind: "canvas" | "generated-document";
	title: string;
	markdown: string;
	messageId: string;
	chatFolder: string;
	usedPaths: Set<string>;
	format: ExportFormat;
	nestAssetsUnderChatFolder: boolean;
	folderName: "canvas" | "documents";
	label: "Canvas" | "Generated Document";
	sourceRelativePath?: string;
};

function buildAsset(options: AssetBuildOptions): CanvasAsset {
	const {
		kind,
		title,
		markdown,
		messageId,
		chatFolder,
		usedPaths,
		format,
		nestAssetsUnderChatFolder,
		folderName,
		label,
		sourceRelativePath,
	} = options;
	const { markdownRelativePath, htmlRelativePath } = buildUniqueAssetPaths(
		folderName,
		chatFolder,
		title,
		sourceRelativePath,
		format,
		usedPaths,
		nestAssetsUnderChatFolder,
	);
	const linkRelativePath =
		format === "html" ? htmlRelativePath : markdownRelativePath;

	return {
		kind,
		title,
		markdownRelativePath:
			format === "markdown" ? markdownRelativePath : undefined,
		markdown,
		htmlRelativePath: format === "html" ? htmlRelativePath : undefined,
		html:
			format === "html"
				? renderStandaloneMarkdownHtml(title, markdown)
				: undefined,
		embeddedMarkdown:
			format === "html"
				? buildEmbeddedAssetMarkdown(label, title, markdown, linkRelativePath)
				: undefined,
		linkRelativePath,
		sourceMessageId: messageId,
	};
}

function buildUniqueAssetPaths(
	folderName: "canvas" | "documents",
	chatFolder: string,
	title: string,
	sourceRelativePath: string | undefined,
	format: ExportFormat,
	usedPaths: Set<string>,
	nestAssetsUnderChatFolder: boolean,
): { markdownRelativePath: string; htmlRelativePath: string } {
	const preferredBase = sourceRelativePath
		? normalizeRelativeAssetBase(sourceRelativePath, title)
		: safeFilenamePart(title) || "untitled-asset";
	const assetFolder = nestAssetsUnderChatFolder
		? `${folderName}/${chatFolder}`
		: folderName;
	let markdownRelativePath = `${assetFolder}/${preferredBase}.md`;
	let htmlRelativePath = `${assetFolder}/${preferredBase}.html`;
	let counter = 2;
	while (
		(format === "markdown" && usedPaths.has(markdownRelativePath)) ||
		(format === "html" && usedPaths.has(htmlRelativePath))
	) {
		const withCounter = appendCounterToRelativeBase(preferredBase, counter);
		markdownRelativePath = `${assetFolder}/${withCounter}.md`;
		htmlRelativePath = `${assetFolder}/${withCounter}.html`;
		counter += 1;
	}

	if (format === "html") usedPaths.add(htmlRelativePath);
	else usedPaths.add(markdownRelativePath);

	return { markdownRelativePath, htmlRelativePath };
}

function normalizeRelativeAssetBase(
	relativePath: string,
	fallbackTitle: string,
): string {
	const segments = relativePath
		.split("/")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.map((segment, index, array) => {
			const isLast = index === array.length - 1;
			const withoutExt = isLast ? segment.replace(/\.[^.]+$/, "") : segment;
			return (
				safeFilenamePart(withoutExt) ||
				(isLast ? safeFilenamePart(fallbackTitle) || "untitled-asset" : "part")
			);
		});

	return segments.length > 0
		? segments.join("/")
		: safeFilenamePart(fallbackTitle) || "untitled-asset";
}

function appendCounterToRelativeBase(
	relativeBase: string,
	counter: number,
): string {
	const segments = relativeBase.split("/").filter(Boolean);
	if (segments.length === 0) return `untitled-asset-${counter}`;
	const last = segments[segments.length - 1];
	segments[segments.length - 1] = `${last}-${counter}`;
	return segments.join("/");
}

function buildEmbeddedAssetMarkdown(
	label: "Canvas" | "Generated Document",
	title: string,
	markdown: string,
	linkRelativePath: string,
): string {
	const withoutDuplicateTitle = markdown
		.replace(new RegExp(`^#\\s+${escapeRegExp(title)}\\s*\\n+`, "i"), "")
		.trim();
	const body = withoutDuplicateTitle || markdown.trim();
	return `### ${label}: [${title}](${linkRelativePath})\n\n${body}`.trim();
}

function inferTitleFromPrefix(prefix: string): string | null {
	const match = prefix.match(/^Canvas:\s*(.+)$/im);
	const value = match?.[1]?.trim();
	return value || null;
}

function inferTitleFromMarkdown(markdown: string): string | null {
	const match = markdown.match(/^#\s+(.+)$/m);
	const value = match?.[1]?.trim();
	return value || null;
}

function looksLikeCanvasDocument(
	replacement: string,
	pattern?: string,
): boolean {
	const body = replacement.trim();
	if (!body) return false;
	if (/^#\s+/m.test(body)) return true;
	if (typeof pattern === "string" && /\[\\s\\S\]\*/.test(pattern)) return true;
	return body.includes("\n\n") && body.length >= 80;
}

function findCanvasPayload(
	markdown: string,
): { prefix: string; payload: any; suffix: string } | null {
	const whole = tryParseCanvasPayload(markdown.trim());
	if (whole) return { prefix: "", payload: whole, suffix: "" };

	const fenced =
		/```json\s*([\s\S]*?)```/i.exec(markdown) ||
		/```\s*([\s\S]*?)```/.exec(markdown);
	if (fenced) {
		const payload = tryParseCanvasPayload(fenced[1]);
		if (payload) {
			return {
				prefix: markdown.slice(0, fenced.index),
				payload,
				suffix: markdown.slice((fenced.index ?? 0) + fenced[0].length),
			};
		}
	}

	let start = -1;
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = 0; i < markdown.length; i += 1) {
		const char = markdown[i];

		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === '"') inString = false;
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (char === "{") {
			if (depth === 0) start = i;
			depth += 1;
			continue;
		}

		if (char !== "}" || depth === 0) continue;
		depth -= 1;
		if (depth !== 0 || start < 0) continue;

		const payload = tryParseCanvasPayload(markdown.slice(start, i + 1));
		if (payload) {
			return {
				prefix: markdown.slice(0, start),
				payload,
				suffix: markdown.slice(i + 1),
			};
		}

		start = -1;
	}

	return null;
}

function tryParseCanvasPayload(text: string): any | null {
	if (!text || text[0] !== "{") return null;
	try {
		const parsed = JSON.parse(text);
		if (!parsed || typeof parsed !== "object") return null;
		if (typeof parsed.name === "string" && typeof parsed.content === "string")
			return parsed;
		if (Array.isArray(parsed.updates)) return parsed;
		return null;
	} catch {
		return null;
	}
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildConversationBundle(
	conversation: Conversation,
	format: ExportFormat,
	now = new Date(),
	options?: {
		nestAssetsUnderChatFolder?: boolean;
		includeDocumentsCanvas?: boolean;
	},
): {
	mainFilename: string;
	mainContent: string;
	canvases: CanvasAsset[];
} {
	const prepared = prepareConversationExport(
		conversation,
		format,
		now,
		options,
	);
	return {
		mainFilename: prepared.mainFilename.toLowerCase(),
		mainContent: renderConversation(prepared.conversation, format),
		canvases: prepared.canvases,
	};
}
