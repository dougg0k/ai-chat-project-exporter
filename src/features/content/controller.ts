import JSZip from "jszip";
import { browser } from "wxt/browser";
import { buildConversationBundle } from "../../lib/canvas-export";
import { filterConversationToMessageIds } from "../../lib/chat-selection";
import { cleanVisibleMarkdown } from "../../lib/clean-text";
import {
	chatGptPageFetch,
	collectObservedApiUrls,
	initFetchBridge,
	onRawCapture,
	pageFetch,
} from "../../lib/fetch-bridge";
import {
	buildDateTime,
	buildProjectZipFilename,
	copyText,
	safeFilenamePart,
	saveBlobAsFile,
	saveTextAsFile,
} from "../../lib/file";
import {
	buildClaudeCurrentConversationApiUrl,
	buildCurrentProjectListingUrl,
	extractClaudeOrgIdFromUrl,
	extractCurrentChatId,
	extractCurrentProjectId,
	inferPageKind,
	inferProvider,
} from "../../lib/page-context";
import { parseConversation, parseProjectListing } from "../../lib/parser";
import {
	buildChatGptConversationFromPages,
	parseChatGptConversationPage,
	type ChatGptConversationPage,
} from "../../lib/parser-chatgpt";
import {
	extractChatGptConversationBeforeCursorFromApiUrl,
	getChatGptConversationApiKind,
} from "../../lib/provider-url";
import {
	buildChatGptProjectListingUrl,
	mergeProjectListings,
	sortChatGptProjectListingUrls,
} from "../../lib/project-listing";
import { unwrapRecordedOrDirectJson } from "../../lib/recorded";
import {
	getLastClaudeOrgId,
	getShowFloatingButton,
	setLastClaudeOrgId,
	setShowFloatingButton,
} from "../../lib/storage";
import type {
	CollectProjectConversationsMessage,
	CollectProjectListingMessage,
	Conversation,
	ExportFormat,
	GeneratedDocument,
	ProjectExportProgressMessage,
	ProjectListing,
	RawCaptureMessage,
	UiContext,
} from "../../lib/types";

let latestConversation: Conversation | null = null;
let latestChatGptInitialPage: ChatGptConversationPage | null = null;
const chatGptHistoryPagesByBeforeCursor = new Map<
	string,
	ChatGptConversationPage
>();
let latestProject: ProjectListing | null = null;
let initialized = false;
let showFloatingButton = false;
let lastPageUrl = "";
let projectExportStatus: string | null = null;
let projectExportCanSkip = false;
let lastClaudeOrgId: string | null = null;
const uiContextListeners = new Set<(context: UiContext) => void>();
const CHAT_CONTENT_WAIT_TIMEOUT_MS = 20_000;
const chatContentWaitStartedAt = new Map<string, number>();
const chatContentWaitTimers = new Map<string, ReturnType<typeof setTimeout>>();

function currentUrl(): string {
	return window.location.href;
}

function titleSegments(value: string): string[] {
	return value
		.split(/\s+[|·—:-]\s+|\s+[|·—:]\s*|\s*-\s+/)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

function looksGenericProviderTitle(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return (
		normalized === "chatgpt" ||
		normalized === "claude" ||
		normalized === "project"
	);
}

function bestNonGenericTitleSegment(value: string): string | null {
	const segments = titleSegments(value)
		.filter((segment) => !looksGenericProviderTitle(segment))
		.sort((a, b) => b.length - a.length);
	return segments[0] ?? null;
}

function guessProjectName(project: ProjectListing, pageUrl: string): string {
	if (
		project.projectName &&
		!/^Project-[A-Za-z0-9-]+$/.test(project.projectName)
	)
		return project.projectName;

	const provider = inferProvider(pageUrl);
	if (provider === "chatgpt") {
		try {
			const url = new URL(pageUrl);
			const segment = url.pathname.split("/")[2] ?? "";
			const match = segment.match(/^g-p-[^-]+-(.+)$/);
			if (match?.[1]) {
				return match[1]
					.split("-")
					.filter(Boolean)
					.map((part) => part[0].toUpperCase() + part.slice(1))
					.join(" ");
			}
		} catch {
			// ignore
		}
	}

	const fromTitle = bestNonGenericTitleSegment(document.title);
	if (fromTitle) return fromTitle;
	return project.projectName;
}

function withBetterProjectName(project: ProjectListing): ProjectListing {
	const nextName = guessProjectName(project, currentUrl());
	return nextName === project.projectName
		? project
		: { ...project, projectName: nextName };
}

async function fetchChatGptProjectListingChain(
	projectId: string,
	seedUrls: string[],
): Promise<ProjectListing | null> {
	const queue = sortChatGptProjectListingUrls(Array.from(new Set(seedUrls)));
	const seen = new Set<string>();
	let merged: ProjectListing | null = null;

	while (queue.length > 0) {
		const url = queue.shift();
		if (!url || seen.has(url)) continue;
		seen.add(url);

		const result = await pageFetch(url).catch(() => null);
		if (!result?.ok || !result.text.trim()) continue;
		const parsed = parseProjectListing(url, result.text);
		if (!parsed || parsed.provider !== "chatgpt") continue;
		if (parsed.projectId !== projectId) continue;

		merged = mergeProjectListings(merged, withBetterProjectName(parsed));
		if (typeof parsed.nextCursor === "string" && parsed.nextCursor) {
			const nextUrl = buildChatGptProjectListingUrl(
				projectId,
				parsed.nextCursor,
			);
			if (!seen.has(nextUrl)) queue.push(nextUrl);
		}
	}

	return merged;
}

function firstNonGenericTitleSegment(value: string): string | null {
	return (
		titleSegments(value).find(
			(segment) => !looksGenericProviderTitle(segment),
		) ?? null
	);
}

function extractClaudeProjectTitleFromDom(): string | null {
	const selectors = [
		"main h1",
		'[role="main"] h1',
		'main [role="heading"][aria-level="1"]',
		'[role="main"] [role="heading"][aria-level="1"]',
		"h1",
		'[role="heading"][aria-level="1"]',
	];

	for (const selector of selectors) {
		const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
		for (const node of nodes) {
			const value = node.innerText?.trim() || node.textContent?.trim() || "";
			if (!value || looksGenericProviderTitle(value)) continue;
			if (/^Project-[A-Za-z0-9-]+$/i.test(value)) continue;
			return value;
		}
	}

	return firstNonGenericTitleSegment(document.title);
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

function getAnchorDisplayTitle(anchor: HTMLAnchorElement): string {
	const preferredChildSelectors = [
		"h1",
		"h2",
		"h3",
		'[role="heading"]',
		"strong",
		"b",
	];

	for (const selector of preferredChildSelectors) {
		const node = anchor.querySelector<HTMLElement>(selector);
		const value = node?.innerText?.trim() || node?.textContent?.trim() || "";
		if (value) return normalizeClaudeProjectChatTitle(value);
	}

	const direct = anchor.innerText?.trim() || anchor.textContent?.trim() || "";
	if (direct) return normalizeClaudeProjectChatTitle(direct);
	const aria = anchor.getAttribute("aria-label")?.trim();
	if (aria) return normalizeClaudeProjectChatTitle(aria);
	const title = anchor.getAttribute("title")?.trim();
	if (title) return normalizeClaudeProjectChatTitle(title);
	return "";
}

function isProbablyProjectChatTitle(
	value: string,
	projectTitle: string | null,
): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (looksGenericProviderTitle(trimmed)) return false;
	if (projectTitle && trimmed === projectTitle) return false;
	if (/^Project-[A-Za-z0-9-]+$/i.test(trimmed)) return false;
	if (
		/^(new chat|start chat|untitled(?:-chat)?|home|projects?)$/i.test(trimmed)
	)
		return false;
	if (trimmed.length > 180) return false;
	if (trimmed.split(/\s+/).length > 20) return false;
	return true;
}

function collectClaudeProjectChatAnchors(): HTMLAnchorElement[] {
	const selectors = [
		'main a[href*="/chat/"]',
		'[role="main"] a[href*="/chat/"]',
		'section a[href*="/chat/"]',
		'article a[href*="/chat/"]',
	];

	for (const selector of selectors) {
		const anchors = Array.from(
			document.querySelectorAll<HTMLAnchorElement>(selector),
		);
		if (anchors.length > 0) return anchors;
	}

	return [];
}

function scrapeClaudeProjectFromDom(): ProjectListing | null {
	if (
		inferProvider(currentUrl()) !== "claude" ||
		inferPageKind(currentUrl()) !== "project"
	)
		return null;
	const projectId = extractCurrentProjectId(currentUrl());
	if (!projectId) return null;

	const projectTitle = extractClaudeProjectTitleFromDom();
	const candidates = collectClaudeProjectChatAnchors();
	const seen = new Set<string>();
	const chats = candidates
		.map((anchor, index) => {
			const href = anchor.href || anchor.getAttribute("href") || "";
			const match = href.match(/\/chat\/([A-Za-z0-9-]+)/);
			const chatId = match?.[1];
			if (!chatId || seen.has(chatId)) return null;
			const title = getAnchorDisplayTitle(anchor).replace(/\s+/g, " ").trim();
			if (!isProbablyProjectChatTitle(title, projectTitle)) return null;
			seen.add(chatId);
			return { id: chatId, title, order: index };
		})
		.filter(Boolean) as ProjectListing["chats"];

	if (chats.length === 0) return null;

	return withBetterProjectName({
		provider: "claude",
		projectId,
		projectName: projectTitle || `Project-${projectId}`,
		chats,
		fetchContext: lastClaudeOrgId ? { orgId: lastClaudeOrgId } : undefined,
	});
}

type ClaudeListFileRecord = {
	path: string;
	filename: string;
	contentType?: string;
	createdAt?: string;
	relativeOutputPath?: string;
};

function currentClaudeOrgIdFromContext(): string | null {
	const observed = collectObservedApiUrls();
	return (
		extractClaudeOrgIdFromUrl(
			observed.find((url) => extractClaudeOrgIdFromUrl(url) !== null) ?? "",
		) ||
		lastClaudeOrgId ||
		null
	);
}

function buildClaudeListFilesUrl(
	orgId: string,
	conversationId: string,
): string {
	return `https://claude.ai/api/organizations/${orgId}/conversations/${conversationId}/wiggle/list-files?prefix=`;
}

function buildClaudeDownloadFileUrl(
	orgId: string,
	conversationId: string,
	path: string,
): string {
	return `https://claude.ai/api/organizations/${orgId}/conversations/${conversationId}/wiggle/download-file?path=${encodeURIComponent(path)}`;
}

function parseClaudeListFiles(text: string): ClaudeListFileRecord[] {
	const data = unwrapRecordedOrDirectJson(text);
	if (!data || typeof data !== "object") return [];
	const metadata = Array.isArray((data as any).files_metadata)
		? (data as any).files_metadata
		: [];
	return metadata
		.filter((entry: any) => typeof entry?.path === "string")
		.map((entry: any) => {
			const path = String(entry.path);
			const filename =
				typeof entry?.custom_metadata?.filename === "string" &&
				entry.custom_metadata.filename.trim()
					? entry.custom_metadata.filename.trim()
					: path.split("/").filter(Boolean).pop() || "untitled";
			return {
				path,
				filename,
				contentType:
					typeof entry?.content_type === "string"
						? entry.content_type
						: undefined,
				createdAt:
					typeof entry?.created_at === "string" ? entry.created_at : undefined,
				relativeOutputPath: path.startsWith("/mnt/user-data/outputs/")
					? path.slice("/mnt/user-data/outputs/".length)
					: undefined,
			} satisfies ClaudeListFileRecord;
		});
}

function isClaudeGeneratedDocumentFile(file: ClaudeListFileRecord): boolean {
	if (!file.path.startsWith("/mnt/user-data/outputs/")) return false;
	if (/\.(md|markdown|txt)$/i.test(file.filename)) return true;
	if (file.contentType && /^text\//i.test(file.contentType)) return true;
	return false;
}

function inferGeneratedDocumentTitle(file: ClaudeListFileRecord): string {
	const source = file.relativeOutputPath || file.filename;
	return source.replace(/\.[^.]+$/, "");
}

function extractClaudeDownloadedDocumentMarkdown(
	text: string,
): { markdown: string; mimeType?: string } | null {
	const direct = (() => {
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	})();

	if (
		direct &&
		typeof direct === "object" &&
		(direct as any).content &&
		typeof (direct as any).content === "object"
	) {
		const content = (direct as any).content;
		if (typeof content.text === "string" && content.text.trim()) {
			return {
				markdown: cleanVisibleMarkdown(content.text),
				mimeType:
					typeof content.mimeType === "string" ? content.mimeType : undefined,
			};
		}
	}

	const trimmed = text.trim();
	if (!trimmed) return null;
	if (/^#\s+/m.test(trimmed) || trimmed.includes("\n")) {
		return { markdown: cleanVisibleMarkdown(trimmed) };
	}

	return null;
}

async function maybeEnrichClaudeConversationWithGeneratedDocuments(
	conversation: Conversation,
	allowNetworkFallback = true,
): Promise<Conversation> {
	if (!allowNetworkFallback) return conversation;
	if (conversation.provider !== "claude") return conversation;
	if (
		conversation.generatedDocuments &&
		conversation.generatedDocuments.length > 0
	)
		return conversation;

	const orgId = currentClaudeOrgIdFromContext();
	if (!orgId || !conversation.id) return conversation;

	const listFilesResult = await pageFetch(
		buildClaudeListFilesUrl(orgId, conversation.id),
	).catch(() => null);
	if (!listFilesResult?.ok || !listFilesResult.text.trim()) return conversation;

	const listedFiles = parseClaudeListFiles(listFilesResult.text).filter(
		isClaudeGeneratedDocumentFile,
	);
	if (listedFiles.length === 0) return conversation;

	const generatedDocuments: GeneratedDocument[] = [];
	for (const file of listedFiles) {
		const downloadResult = await pageFetch(
			buildClaudeDownloadFileUrl(orgId, conversation.id, file.path),
		).catch(() => null);
		if (!downloadResult?.ok || !downloadResult.text.trim()) continue;

		const extracted = extractClaudeDownloadedDocumentMarkdown(
			downloadResult.text,
		);
		if (!extracted?.markdown.trim()) continue;

		generatedDocuments.push({
			id: `claude-doc:${conversation.id}:${file.path}`,
			title: inferGeneratedDocumentTitle(file),
			filename: file.filename,
			path: file.path,
			relativeOutputPath: file.relativeOutputPath,
			markdown: extracted.markdown,
			mimeType: extracted.mimeType || file.contentType,
			createdAt: file.createdAt,
		});
	}

	if (generatedDocuments.length === 0) return conversation;
	return { ...conversation, generatedDocuments };
}

function getChatGptInitialPageForPage(
	pageUrl = currentUrl(),
): ChatGptConversationPage | null {
	const currentChatId = extractCurrentChatId(pageUrl);
	if (!currentChatId) return null;
	if (latestChatGptInitialPage?.conversationId !== currentChatId) return null;
	return latestChatGptInitialPage;
}

type CapturedChatGptConversationState =
	| { kind: "complete"; conversation: Conversation }
	| { kind: "missing-initial" }
	| { kind: "missing-history"; beforeCursor: string }
	| { kind: "invalid"; error: string };

function buildCompleteCapturedChatGptConversation(
	pageUrl: string,
): CapturedChatGptConversationState {
	const conversationId = extractCurrentChatId(pageUrl);
	if (!conversationId) {
		return { kind: "invalid", error: "Missing ChatGPT conversation id." };
	}
	const initialPage = getChatGptInitialPageForPage(pageUrl);
	if (!initialPage) return { kind: "missing-initial" };
	if (initialPage.conversationId !== conversationId) {
		return {
			kind: "invalid",
			error: "ChatGPT returned conversation data for a different chat.",
		};
	}
	if (initialPage.pageInfo.hasNextPage) {
		return {
			kind: "invalid",
			error:
				"ChatGPT returned an initial conversation page that is not the newest page.",
		};
	}

	const pagesOldestToNewest: ChatGptConversationPage[] = [initialPage];
	const seenBeforeCursors = new Set<string>();
	let oldestPage = initialPage;

	while (oldestPage.pageInfo.hasPreviousPage) {
		const cursor = oldestPage.pageInfo.startCursor;
		if (!cursor) {
			return {
				kind: "invalid",
				error:
					"ChatGPT reports older chat history but did not provide a previous-page cursor.",
			};
		}
		if (seenBeforeCursors.has(cursor)) {
			return {
				kind: "invalid",
				error: "ChatGPT repeated the same chat history cursor.",
			};
		}
		seenBeforeCursors.add(cursor);

		const olderPage = chatGptHistoryPagesByBeforeCursor.get(cursor);
		if (!olderPage) {
			return { kind: "missing-history", beforeCursor: cursor };
		}
		if (olderPage.conversationId !== conversationId) {
			return {
				kind: "invalid",
				error: "ChatGPT returned history data for a different chat.",
			};
		}
		pagesOldestToNewest.unshift(olderPage);
		oldestPage = olderPage;
	}

	const conversation = buildChatGptConversationFromPages(
		pagesOldestToNewest,
		pageUrl,
	);
	if (!conversation) {
		return {
			kind: "invalid",
			error: "ChatGPT conversation data could not be converted for export.",
		};
	}
	return { kind: "complete", conversation };
}

function storeChatGptInitialPage(
	page: ChatGptConversationPage,
	pageUrl: string,
): Conversation | null {
	const expectedChatId = extractCurrentChatId(pageUrl);
	if (expectedChatId && page.conversationId !== expectedChatId) return null;

	const existing = getChatGptInitialPageForPage(pageUrl);
	const sameStartCursor =
		existing?.conversationId === page.conversationId &&
		existing.pageInfo.startCursor === page.pageInfo.startCursor;
	latestChatGptInitialPage = page;
	latestConversation = null;
	if (!sameStartCursor) chatGptHistoryPagesByBeforeCursor.clear();
	clearChatContentWait(page.conversationId);

	const state = buildCompleteCapturedChatGptConversation(pageUrl);
	if (state.kind !== "complete") return null;
	latestConversation = state.conversation;
	return state.conversation;
}

function storeChatGptHistoryPage(
	page: ChatGptConversationPage,
	apiUrl: string,
	pageUrl: string,
): Conversation | null {
	const expectedChatId = extractCurrentChatId(pageUrl);
	if (expectedChatId && page.conversationId !== expectedChatId) return null;
	const beforeCursor = extractChatGptConversationBeforeCursorFromApiUrl(apiUrl);
	if (!beforeCursor) return null;
	chatGptHistoryPagesByBeforeCursor.set(beforeCursor, page);

	const state = buildCompleteCapturedChatGptConversation(pageUrl);
	if (state.kind !== "complete") return null;
	latestConversation = state.conversation;
	return state.conversation;
}

function buildChatGptHistoryPageUrl(
	initialPage: ChatGptConversationPage,
	beforeCursor: string,
): string {
	const initialUrl = new URL(initialPage.sourceApiUrl);
	const historyUrl = new URL(
		`/backend-api/conversations/${encodeURIComponent(initialPage.conversationId)}/messages`,
		initialUrl,
	);
	historyUrl.searchParams.set("before", beforeCursor);
	const includeHasVersions = initialUrl.searchParams.get(
		"include_has_versions",
	);
	historyUrl.searchParams.set(
		"include_has_versions",
		includeHasVersions ?? "true",
	);
	const numTurns = initialUrl.searchParams.get("num_turns");
	historyUrl.searchParams.set("num_turns", numTurns ?? "10");
	return historyUrl.href;
}

async function ensureCompleteChatGptConversationForExport(
	pageUrl: string,
): Promise<Conversation | null> {
	const initialPage = getChatGptInitialPageForPage(pageUrl);
	if (!initialPage) return null;

	while (true) {
		if (currentUrl() !== pageUrl) return getActiveConversationForPage();
		if (getChatGptInitialPageForPage(pageUrl) !== initialPage) {
			throw new Error(
				"ChatGPT chat data changed while older history was being loaded. Try exporting again.",
			);
		}

		const state = buildCompleteCapturedChatGptConversation(pageUrl);
		if (state.kind === "complete") {
			latestConversation = state.conversation;
			return state.conversation;
		}
		if (state.kind === "missing-initial") return null;
		if (state.kind === "invalid") throw new Error(state.error);

		const historyUrl = buildChatGptHistoryPageUrl(
			initialPage,
			state.beforeCursor,
		);
		const result = await chatGptPageFetch(historyUrl);
		if (currentUrl() !== pageUrl) return getActiveConversationForPage();
		if (!result.ok) {
			const status = result.status > 0 ? ` HTTP ${result.status}` : "";
			throw new Error(`ChatGPT conversation history request failed${status}.`);
		}
		if (!result.text.trim()) {
			throw new Error("ChatGPT returned an empty conversation history page.");
		}
		const olderPage = parseChatGptConversationPage(
			result.url || historyUrl,
			result.text,
		);
		if (!olderPage) {
			throw new Error(
				"ChatGPT returned an unsupported conversation history response.",
			);
		}
		if (olderPage.conversationId !== initialPage.conversationId) {
			throw new Error("ChatGPT returned history data for a different chat.");
		}
		storeChatGptHistoryPage(olderPage, historyUrl, pageUrl);
	}
}

function clearChatContentWait(conversationId: string) {
	chatContentWaitStartedAt.delete(conversationId);
	const timeoutId = chatContentWaitTimers.get(conversationId);
	if (timeoutId) clearTimeout(timeoutId);
	chatContentWaitTimers.delete(conversationId);
}

function clearAllChatContentWaits() {
	for (const timeoutId of chatContentWaitTimers.values()) {
		clearTimeout(timeoutId);
	}
	chatContentWaitTimers.clear();
	chatContentWaitStartedAt.clear();
}

function syncPageState() {
	const url = currentUrl();
	if (url === lastPageUrl) return;
	lastPageUrl = url;
	latestConversation = null;
	latestChatGptInitialPage = null;
	chatGptHistoryPagesByBeforeCursor.clear();
	latestProject = null;
	clearAllChatContentWaits();
	projectExportStatus = null;
	emitUiContextChanged();
}

function conversationMatchesCurrentChat(
	conversation: Conversation | null,
	conversationId: string,
): boolean {
	if (!conversation) return false;
	if (conversation.id === conversationId) return true;
	const sourceChatId = conversation.sourceUrl
		? extractCurrentChatId(conversation.sourceUrl)
		: null;
	return sourceChatId === conversationId;
}

function getChatContentWaitStartedAt(conversationId: string): number {
	const existing = chatContentWaitStartedAt.get(conversationId);
	if (typeof existing === "number") return existing;

	const now = Date.now();
	chatContentWaitStartedAt.set(conversationId, now);
	const timeoutId = setTimeout(() => {
		chatContentWaitTimers.delete(conversationId);
		if (extractCurrentChatId(currentUrl()) === conversationId) {
			emitUiContextChanged();
		}
	}, CHAT_CONTENT_WAIT_TIMEOUT_MS);
	chatContentWaitTimers.set(conversationId, timeoutId);
	return now;
}

function hasChatContentWaitTimedOut(conversationId: string): boolean {
	return (
		Date.now() - getChatContentWaitStartedAt(conversationId) >=
		CHAT_CONTENT_WAIT_TIMEOUT_MS
	);
}

function getCurrentChatGptLoadingState(): {
	status: string | null;
	waiting: boolean;
} {
	if (inferProvider(currentUrl()) !== "chatgpt") {
		return { status: null, waiting: false };
	}
	if (inferPageKind(currentUrl()) !== "chat") {
		return { status: null, waiting: false };
	}
	const currentChatId = extractCurrentChatId(currentUrl());
	if (!currentChatId) return { status: null, waiting: false };
	const activeConversation = getActiveConversationForPage();
	if (conversationMatchesCurrentChat(activeConversation, currentChatId)) {
		clearChatContentWait(currentChatId);
		return { status: null, waiting: false };
	}

	const capturedState = buildCompleteCapturedChatGptConversation(currentUrl());
	if (
		capturedState.kind === "complete" ||
		capturedState.kind === "missing-history"
	) {
		clearChatContentWait(currentChatId);
		return { status: null, waiting: false };
	}
	if (capturedState.kind === "invalid") {
		clearChatContentWait(currentChatId);
		return { status: capturedState.error, waiting: false };
	}
	if (hasChatContentWaitTimedOut(currentChatId)) {
		return {
			status:
				"Chat data was not intercepted within 20 seconds. Reload the chat page and try again.",
			waiting: false,
		};
	}
	return {
		status: "Chat content are still loading, please wait...",
		waiting: true,
	};
}

function getCurrentChatGptProjectLoadingStatus(): string | null {
	if (inferProvider(currentUrl()) !== "chatgpt") return null;
	if (inferPageKind(currentUrl()) !== "project") return null;
	const activeProject = getActiveProjectForPage();
	if (!activeProject) return null;
	if (activeProject.provider !== "chatgpt") return null;
	if (activeProject.nextCursor == null) return null;
	return "List is not fully loaded. Please scroll all the way to the end, before exporting.";
}

function handleRawCapture(message: RawCaptureMessage) {
	void browser.runtime.sendMessage(message).catch(() => undefined);

	const orgId = extractClaudeOrgIdFromUrl(message.url);
	if (orgId && orgId !== lastClaudeOrgId) {
		lastClaudeOrgId = orgId;
		void setLastClaudeOrgId(orgId).catch(() => undefined);
	}
	const chatGptApiKind = getChatGptConversationApiKind(message.url);
	const chatGptPage = parseChatGptConversationPage(message.url, message.text);
	if (chatGptApiKind === "initial" && chatGptPage) {
		storeChatGptInitialPage(chatGptPage, currentUrl());
	} else if (chatGptApiKind === "messages" && chatGptPage) {
		storeChatGptHistoryPage(chatGptPage, message.url, currentUrl());
	} else if (chatGptApiKind !== "messages") {
		const conversation = parseConversation(
			message.url,
			message.text,
			currentUrl(),
		);
		if (conversation) {
			latestConversation = conversation;
			if (conversation.provider === "chatgpt") {
				clearChatContentWait(conversation.id);
			}
		}
	}
	const project = parseProjectListing(message.url, message.text);
	if (project) {
		const nextProject = withBetterProjectName(project);
		latestProject =
			nextProject.provider === "chatgpt"
				? mergeProjectListings(latestProject, nextProject)
				: nextProject;
	}
	emitUiContextChanged();
}

function setProjectStatus(status: string | null, canSkip = false) {
	projectExportStatus = status;
	projectExportCanSkip = Boolean(status) && canSkip;
	emitUiContextChanged();
}

function emitUiContextChanged() {
	const context = buildContext(false);
	for (const listener of uiContextListeners) listener(context);
	void browser.runtime
		.sendMessage({ type: "UI_CONTEXT_CHANGED", context })
		.catch(() => undefined);
}

export function subscribeUiContext(
	listener: (context: UiContext) => void,
): () => void {
	uiContextListeners.add(listener);
	return () => uiContextListeners.delete(listener);
}

function capitalizeWord(value: string): string {
	return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function getActiveConversationForPage(): Conversation | null {
	syncPageState();
	const conversation = latestConversation;
	if (!conversation) return null;
	if (inferPageKind(currentUrl()) !== "chat") return null;

	const currentChatId = extractCurrentChatId(currentUrl());
	if (currentChatId && conversation.id !== currentChatId) {
		const sourceChatId = conversation.sourceUrl
			? extractCurrentChatId(conversation.sourceUrl)
			: null;
		if (sourceChatId !== currentChatId) return null;
	}

	return conversation;
}

function getActiveProjectForPage(): ProjectListing | null {
	syncPageState();
	const project = latestProject;
	if (!project) return null;
	if (inferPageKind(currentUrl()) !== "project") return null;
	const projectId = extractCurrentProjectId(currentUrl());
	if (projectId && project.projectId !== projectId) return null;
	return project;
}

function buildContext(waiting = false): UiContext {
	syncPageState();
	const provider = inferProvider(currentUrl());
	const pageKind = inferPageKind(currentUrl());
	const activeConversation = getActiveConversationForPage();
	const activeChatGptInitialPage =
		provider === "chatgpt" && pageKind === "chat"
			? getChatGptInitialPageForPage()
			: null;
	const activeProject = getActiveProjectForPage();
	const chatLoadingState = getCurrentChatGptLoadingState();
	const projectLoadingStatus = getCurrentChatGptProjectLoadingStatus();
	const loadingStatus = projectLoadingStatus ?? chatLoadingState.status;
	const isLoading =
		waiting || Boolean(projectLoadingStatus) || chatLoadingState.waiting;

	return {
		provider,
		pageKind,
		hasConversation: Boolean(activeConversation || activeChatGptInitialPage),
		hasProject: Boolean(activeProject),
		waiting: isLoading,
		title: activeConversation?.title ?? activeChatGptInitialPage?.title,
		projectName: activeProject?.projectName,
		showFloatingButton,
		projectExportStatus: projectExportStatus ?? loadingStatus,
		projectExportCanSkip,
	};
}

async function ensureActiveConversationForPage(
	allowNetworkFallback = true,
): Promise<Conversation | null> {
	const pageUrl = currentUrl();
	const provider = inferProvider(pageUrl);

	if (provider === "chatgpt" && inferPageKind(pageUrl) === "chat") {
		const state = buildCompleteCapturedChatGptConversation(pageUrl);
		if (state.kind === "complete") {
			latestConversation = state.conversation;
			return state.conversation;
		}
		if (state.kind === "invalid" || !allowNetworkFallback) return null;
		return ensureCompleteChatGptConversationForExport(pageUrl);
	}

	const conversation = getActiveConversationForPage();
	if (conversation) {
		const enriched = await maybeEnrichClaudeConversationWithGeneratedDocuments(
			conversation,
			allowNetworkFallback,
		);
		if (currentUrl() === pageUrl && enriched !== conversation) {
			latestConversation = enriched;
		}
		return currentUrl() === pageUrl ? enriched : getActiveConversationForPage();
	}

	if (
		provider !== "claude" ||
		inferPageKind(pageUrl) !== "chat" ||
		!allowNetworkFallback
	) {
		return getActiveConversationForPage();
	}

	const observed = collectObservedApiUrls();
	const apiUrl = buildClaudeCurrentConversationApiUrl(
		pageUrl,
		observed,
		lastClaudeOrgId,
	);
	if (!apiUrl) return getActiveConversationForPage();

	const orgId = extractClaudeOrgIdFromUrl(apiUrl);
	if (orgId && orgId !== lastClaudeOrgId) {
		lastClaudeOrgId = orgId;
		void setLastClaudeOrgId(orgId).catch(() => undefined);
	}

	const result = await pageFetch(apiUrl).catch(() => null);
	if (currentUrl() !== pageUrl) return getActiveConversationForPage();
	if (!result?.ok || !result.text.trim()) return getActiveConversationForPage();

	const parsed = parseConversation(apiUrl, result.text, pageUrl);
	if (!parsed) return getActiveConversationForPage();
	const expectedChatId = extractCurrentChatId(pageUrl);
	if (
		expectedChatId &&
		!conversationMatchesCurrentChat(parsed, expectedChatId)
	) {
		return getActiveConversationForPage();
	}

	const enriched = await maybeEnrichClaudeConversationWithGeneratedDocuments(
		parsed,
		allowNetworkFallback,
	);
	if (currentUrl() !== pageUrl) return getActiveConversationForPage();
	latestConversation = enriched;
	return getActiveConversationForPage();
}

async function waitForSingleChatConversationForExport(): Promise<Conversation | null> {
	return ensureActiveConversationForPage();
}

async function ensureActiveProjectData(): Promise<ProjectListing | null> {
	const project = getActiveProjectForPage();
	if (project) return project;

	if (inferPageKind(currentUrl()) === "project") {
		const provider = inferProvider(currentUrl());
		const observed = collectObservedApiUrls();
		const observedOrgId = extractClaudeOrgIdFromUrl(
			observed.find((url) => extractClaudeOrgIdFromUrl(url) !== null) ?? "",
		);
		if (observedOrgId && observedOrgId !== lastClaudeOrgId) {
			lastClaudeOrgId = observedOrgId;
			void setLastClaudeOrgId(observedOrgId).catch(() => undefined);
		}

		const listingUrl = buildCurrentProjectListingUrl(
			currentUrl(),
			observed,
			lastClaudeOrgId,
		);
		const listingUrls =
			provider === "chatgpt"
				? (() => {
						const projectId = extractCurrentProjectId(currentUrl());
						const matchingObserved = observed.filter((url) =>
							projectId
								? url.includes(`/backend-api/gizmos/${projectId}/conversations`)
								: false,
						);
						const urls = listingUrl
							? [...matchingObserved, listingUrl]
							: matchingObserved;
						return sortChatGptProjectListingUrls(Array.from(new Set(urls)));
					})()
				: listingUrl
					? [listingUrl]
					: [];

		if (provider === "chatgpt") {
			const projectId = extractCurrentProjectId(currentUrl());
			if (projectId && listingUrls.length > 0) {
				const nextProject = await fetchChatGptProjectListingChain(
					projectId,
					listingUrls,
				);
				if (nextProject) {
					latestProject = mergeProjectListings(latestProject, nextProject);
				}
			}
		} else {
			for (const url of listingUrls) {
				const orgId = extractClaudeOrgIdFromUrl(url);
				if (orgId && orgId !== lastClaudeOrgId) {
					lastClaudeOrgId = orgId;
					void setLastClaudeOrgId(orgId).catch(() => undefined);
				}
				const result = await pageFetch(url).catch(() => null);
				if (!result?.ok || !result.text.trim()) continue;
				const parsed = parseProjectListing(url, result.text);
				if (!parsed) continue;
				const nextProject = withBetterProjectName(parsed);
				latestProject = nextProject;
			}
		}

		const active = getActiveProjectForPage();
		if (active) return active;

		if (provider === "claude") {
			const scraped = scrapeClaudeProjectFromDom();
			if (scraped) {
				latestProject = scraped;
				return getActiveProjectForPage();
			}
		}
	}

	return getActiveProjectForPage();
}

export async function initializeController(): Promise<void> {
	if (initialized) return;
	initialized = true;
	lastPageUrl = currentUrl();

	initFetchBridge();
	onRawCapture(handleRawCapture);

	browser.runtime.onMessage.addListener(
		(message: ProjectExportProgressMessage) => {
			if (message.type === "PROJECT_EXPORT_PROGRESS") {
				setProjectStatus(message.status ?? null, message.canSkip === true);
				return undefined;
			}
			return undefined;
		},
	);

	showFloatingButton = await getShowFloatingButton().catch(() => false);
	lastClaudeOrgId = await getLastClaudeOrgId().catch(() => null);
	const observedOrgId = extractClaudeOrgIdFromUrl(
		collectObservedApiUrls().find(
			(url) => extractClaudeOrgIdFromUrl(url) !== null,
		) ?? "",
	);
	if (observedOrgId && observedOrgId !== lastClaudeOrgId) {
		lastClaudeOrgId = observedOrgId;
		void setLastClaudeOrgId(observedOrgId).catch(() => undefined);
	}
}

export async function getUiContext(): Promise<UiContext> {
	return buildContext(false);
}

export async function setFloatingButtonVisible(
	value: boolean,
): Promise<UiContext> {
	showFloatingButton = value;
	await setShowFloatingButton(value).catch(() => undefined);
	const context = buildContext(false);
	emitUiContextChanged();
	return context;
}

export function shouldRenderFloatingButton(): boolean {
	const kind = inferPageKind(currentUrl());
	return showFloatingButton && (kind === "chat" || kind === "project");
}

export async function getActiveConversationData(
	allowNetworkFallback = true,
): Promise<Conversation | null> {
	return ensureActiveConversationForPage(allowNetworkFallback);
}

export async function getActiveConversationForSelection(): Promise<Conversation | null> {
	return waitForSingleChatConversationForExport();
}

export async function getActiveProjectData(
	_allowNetworkFallback = true,
): Promise<ProjectListing | null> {
	return ensureActiveProjectData();
}

export async function requestProjectExportSkip(): Promise<void> {
	const result = (await browser.runtime.sendMessage({
		type: "SKIP_PROJECT_EXPORT",
	} as const)) as { ok?: boolean; error?: string };
	if (result?.ok === false) {
		throw new Error(result.error || "No project export is waiting for skip.");
	}
	setProjectStatus(projectExportStatus, false);
}

export async function getRenderedChat(
	format: ExportFormat,
	selectedMessageIds?: string[],
	includeDocumentsCanvas = true,
): Promise<string> {
	const conversation = await waitForSingleChatConversationForExport();
	if (!conversation) {
		throw new Error("No chat data available.");
	}
	const filteredConversation = normalizeSelectedConversation(
		conversation,
		selectedMessageIds,
	);
	return buildConversationBundle(filteredConversation, format, new Date(), {
		includeDocumentsCanvas:
			conversation.provider === "chatgpt" ? true : includeDocumentsCanvas,
	}).mainContent;
}

export async function exportChat(
	format: ExportFormat,
	target: "file" | "clipboard",
	selectedMessageIds?: string[],
	includeDocumentsCanvas = true,
): Promise<void> {
	const conversation = await waitForSingleChatConversationForExport();
	if (!conversation) {
		throw new Error("No chat data available.");
	}

	const filteredConversation = normalizeSelectedConversation(
		conversation,
		selectedMessageIds,
	);
	const rendered = buildConversationBundle(
		filteredConversation,
		format,
		new Date(),
		{
			nestAssetsUnderChatFolder: false,
			includeDocumentsCanvas:
				conversation.provider === "chatgpt" ? true : includeDocumentsCanvas,
		},
	);
	if (target === "clipboard") {
		await copyText(rendered.mainContent);
		return;
	}

	if (rendered.canvases.length === 0) {
		const mime =
			format === "html"
				? "text/html;charset=utf-8"
				: "text/markdown;charset=utf-8";
		saveTextAsFile(rendered.mainContent, rendered.mainFilename, mime);
		return;
	}

	const zip = new JSZip();
	zip.file(rendered.mainFilename, rendered.mainContent);
	for (const canvas of rendered.canvases) {
		if (format === "html") {
			if (canvas.htmlRelativePath && canvas.html)
				zip.file(canvas.htmlRelativePath, canvas.html);
			continue;
		}
		if (canvas.markdownRelativePath)
			zip.file(canvas.markdownRelativePath, canvas.markdown);
	}
	const blob = await zip.generateAsync({ type: "blob" });
	const bundleName = rendered.mainFilename.replace(
		/\.(html|md)$/i,
		`_${format === "html" ? "html" : "md"}.zip`,
	);
	saveBlobAsFile(blob, bundleName);
}

function normalizeSelectedConversation(
	conversation: Conversation,
	selectedMessageIds?: string[],
): Conversation {
	if (!Array.isArray(selectedMessageIds) || selectedMessageIds.length === 0)
		return conversation;
	const filteredConversation = filterConversationToMessageIds(
		conversation,
		selectedMessageIds,
	);
	if (filteredConversation.messages.length === 0) {
		throw new Error("No selected chat content available.");
	}
	return filteredConversation;
}

export async function exportProject(
	format: ExportFormat,
	includeDocumentsCanvas = true,
): Promise<void> {
	let activeProject = await ensureActiveProjectData();

	if (
		activeProject?.provider === "chatgpt" &&
		activeProject.nextCursor != null
	) {
		throw new Error(
			"List is not fully loaded. Please scroll all the way to the end, before exporting.",
		);
	}

	if (
		!activeProject &&
		inferPageKind(currentUrl()) === "project" &&
		inferProvider(currentUrl()) !== "claude"
	) {
		setProjectStatus("Opening: Project listing");
		const listingResult = (await browser.runtime.sendMessage({
			type: "COLLECT_PROJECT_LISTING",
			currentProjectPageUrl: currentUrl(),
		} satisfies CollectProjectListingMessage)) as {
			ok?: boolean;
			project?: ProjectListing;
			error?: string;
		};

		if (listingResult?.ok && listingResult.project) {
			activeProject = withBetterProjectName(listingResult.project);
			latestProject = activeProject;
		}
	}

	if (!activeProject) throw new Error("No project data available.");

	activeProject = withBetterProjectName(activeProject);
	setProjectStatus(
		`Preparing: ${capitalizeWord(activeProject.provider)} - ${activeProject.projectName} - ${activeProject.chats.length} chats`,
	);
	try {
		const result = (await browser.runtime.sendMessage({
			type: "COLLECT_PROJECT_CONVERSATIONS",
			project: activeProject,
			currentProjectPageUrl: currentUrl(),
		} satisfies CollectProjectConversationsMessage)) as {
			ok?: boolean;
			conversations?: Conversation[];
			error?: string;
		};

		if (!result?.ok || !Array.isArray(result.conversations)) {
			throw new Error(result?.error || "No project chats could be exported.");
		}

		const conversations = result.conversations;
		if (conversations.length === 0)
			throw new Error("No project chats could be exported.");

		const zip = new JSZip();
		const now = new Date();
		const folderName =
			`${safeFilenamePart(activeProject.projectName)}_${capitalizeWord(activeProject.provider)}_${buildDateTime(now)}`.toLowerCase();
		const sorted = conversations.slice().sort((a, b) => {
			const ai =
				activeProject.chats.find((chat) => chat.id === a.id)?.order ?? 0;
			const bi =
				activeProject.chats.find((chat) => chat.id === b.id)?.order ?? 0;
			return ai - bi;
		});

		for (const conversation of sorted) {
			const prepared = buildConversationBundle(conversation, format, now, {
				includeDocumentsCanvas:
					conversation.provider === "chatgpt" ? true : includeDocumentsCanvas,
			});
			zip.file(`${folderName}/${prepared.mainFilename}`, prepared.mainContent);
			for (const canvas of prepared.canvases) {
				if (format === "html") {
					if (canvas.htmlRelativePath && canvas.html)
						zip.file(`${folderName}/${canvas.htmlRelativePath}`, canvas.html);
					continue;
				}
				if (canvas.markdownRelativePath)
					zip.file(
						`${folderName}/${canvas.markdownRelativePath}`,
						canvas.markdown,
					);
			}
		}

		setProjectStatus(
			`Finalizing: ${capitalizeWord(activeProject.provider)} - ${activeProject.projectName}`,
		);
		const blob = await zip.generateAsync({ type: "blob" });
		saveBlobAsFile(
			blob,
			buildProjectZipFilename(
				activeProject.projectName,
				format,
				now,
				activeProject.provider,
			),
		);
	} finally {
		setProjectStatus(null);
	}
}
