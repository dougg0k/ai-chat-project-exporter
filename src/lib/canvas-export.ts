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
): PreparedConversationExport {
	const chatFolder = safeFilenamePart(conversation.title) || "untitled-chat";
	const ext = format === "html" ? "html" : "md";
	const mainFilename = buildConversationFilename(
		conversation.title,
		conversation.provider,
		ext,
		now,
	);
	const usedPaths = new Set<string>();
	const canvases: CanvasAsset[] = [];

	const messages = conversation.messages.map((message) =>
		transformMessage(message, format, chatFolder, usedPaths, canvases),
	);
	const generatedDocumentAssets = materializeGeneratedDocuments(
		conversation.generatedDocuments ?? [],
		format,
		chatFolder,
		usedPaths,
	);
	const appendixMarkdown = buildGeneratedDocumentsAppendix(
		generatedDocumentAssets,
		format,
	);

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
): Message {
	if (message.role !== "assistant") return message;
	const parsed = findCanvasPayload(message.markdown);
	if (!parsed) return message;

	const artifact = materializeCanvas(
		parsed.payload,
		parsed.prefix,
		message.id,
		chatFolder,
		usedPaths,
		format,
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
			folderName: "canvas",
			label: "Canvas",
		});
	}

	return null;
}

function materializeGeneratedDocuments(
	documents: GeneratedDocument[],
	format: ExportFormat,
	chatFolder: string,
	usedPaths: Set<string>,
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
): { markdownRelativePath: string; htmlRelativePath: string } {
	const preferredBase = sourceRelativePath
		? normalizeRelativeAssetBase(sourceRelativePath, title)
		: safeFilenamePart(title) || "untitled-asset";
	let markdownRelativePath = `${folderName}/${chatFolder}/${preferredBase}.md`;
	let htmlRelativePath = `${folderName}/${chatFolder}/${preferredBase}.html`;
	let counter = 2;
	while (
		(format === "markdown" && usedPaths.has(markdownRelativePath)) ||
		(format === "html" && usedPaths.has(htmlRelativePath))
	) {
		const withCounter = appendCounterToRelativeBase(preferredBase, counter);
		markdownRelativePath = `${folderName}/${chatFolder}/${withCounter}.md`;
		htmlRelativePath = `${folderName}/${chatFolder}/${withCounter}.html`;
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

	for (let i = 0; i < markdown.length; i += 1) {
		if (markdown[i] !== "{") continue;
		const prefix = markdown.slice(0, i);
		const candidate = markdown.slice(i).trim();
		const payload = tryParseCanvasPayload(candidate);
		if (payload) return { prefix, payload, suffix: "" };
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
): {
	mainFilename: string;
	mainContent: string;
	canvases: CanvasAsset[];
} {
	const prepared = prepareConversationExport(conversation, format, now);
	return {
		mainFilename: prepared.mainFilename,
		mainContent: renderConversation(prepared.conversation, format),
		canvases: prepared.canvases,
	};
}
