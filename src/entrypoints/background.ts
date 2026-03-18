import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { buildProjectChatPageUrls } from "../lib/page-context";
import { parseConversation, parseProjectListing } from "../lib/parser";
import { mergeChatGptTextdocs, parseChatGptTextdocs } from "../lib/parser-chatgpt";
import { mergeProjectListings, projectListingSignature } from "../lib/project-listing";
import type {
	CollectProjectConversationsMessage,
	CollectProjectListingMessage,
	Conversation,
	GetActiveConversationDataMessage,
	GetActiveProjectDataMessage,
	ProjectListing,
	RawCaptureMessage,
	RuntimeMessage,
} from "../lib/types";

const TAB_URL_TIMEOUT_MS = 15000;
const CAPTURE_TIMEOUT_MS = 25000;
const POLL_INTERVAL_MS = 300;

type SenderResponse = {
	ok: boolean;
	error?: string;
	project?: ProjectListing;
	conversations?: Conversation[];
};

const conversationsByTab = new Map<number, Conversation | null>();
const projectsByTab = new Map<number, ProjectListing | null>();
const pendingChatGptTextdocsByTab = new Map<number, Map<string, import("../lib/types").ChatGptTextdoc[]>>();
const observedChatGptTextdocsByTab = new Map<number, Set<string>>();

export default defineBackground(() => {
	browser.runtime.onMessage.addListener(
		(message: RuntimeMessage, sender, sendResponse) => {
			if (message.type === "RAW_CAPTURE") {
				recordRawCapture(message, sender.tab?.id, sender.tab?.url);
				return undefined;
			}

			if (message.type === "COLLECT_PROJECT_LISTING") {
				void respondAsync(sendResponse, () =>
					collectProjectListing(message, sender.tab?.id),
				);
				return true;
			}

			if (message.type === "COLLECT_PROJECT_CONVERSATIONS") {
				void respondAsync(sendResponse, () =>
					collectProjectConversations(message, sender.tab?.id),
				);
				return true;
			}

			return undefined;
		},
	);
});



function markObservedConversationTextdocs(tabId: number, conversationId: string) {
	const observed = observedChatGptTextdocsByTab.get(tabId) ?? new Set<string>();
	observed.add(conversationId);
	observedChatGptTextdocsByTab.set(tabId, observed);
}

function hasObservedConversationTextdocs(tabId: number, conversationId: string): boolean {
	return observedChatGptTextdocsByTab.get(tabId)?.has(conversationId) ?? false;
}

function stashPendingConversationTextdocs(
	tabId: number,
	conversationId: string,
	textdocs: import("../lib/types").ChatGptTextdoc[],
) {
	const byConversation =
		pendingChatGptTextdocsByTab.get(tabId) ??
		new Map<string, import("../lib/types").ChatGptTextdoc[]>();
	byConversation.set(
		conversationId,
		mergeChatGptTextdocs(byConversation.get(conversationId), textdocs) ?? [],
	);
	pendingChatGptTextdocsByTab.set(tabId, byConversation);
}

function applyPendingConversationTextdocs(
	tabId: number,
	conversation: Conversation,
): Conversation {
	if (conversation.provider !== "chatgpt") return conversation;
	const byConversation = pendingChatGptTextdocsByTab.get(tabId);
	const pending = byConversation?.get(conversation.id);
	if (!pending?.length) return conversation;
	byConversation?.delete(conversation.id);
	if (byConversation && byConversation.size === 0)
		pendingChatGptTextdocsByTab.delete(tabId);
	return mergeConversationTextdocs(conversation, conversation.id, pending);
}

function mergeConversationTextdocs(
	conversation: Conversation,
	conversationId: string,
	textdocs: import("../lib/types").ChatGptTextdoc[],
): Conversation {
	if (conversation.provider !== "chatgpt") return conversation;
	if (conversation.id !== conversationId) {
		const sourceMatch = conversation.sourceUrl?.match(/\/c\/([A-Za-z0-9-]+)$/);
		if (sourceMatch?.[1] !== conversationId) return conversation;
	}
	return {
		...conversation,
		chatGptTextdocs: mergeChatGptTextdocs(
			conversation.chatGptTextdocs,
			textdocs,
		),
	};
}

async function respondAsync(
	sendResponse: (response?: any) => void,
	task: () => Promise<SenderResponse>,
) {
	try {
		sendResponse(await task());
	} catch (error) {
		sendResponse({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function recordRawCapture(
	message: RawCaptureMessage,
	tabId?: number,
	pageUrl?: string,
) {
	if (tabId == null) return;
	const conversation = parseConversation(
		message.url,
		message.text,
		pageUrl ?? message.url,
	);
	if (conversation)
		conversationsByTab.set(tabId, applyPendingConversationTextdocs(tabId, conversation));
	const textdocs = parseChatGptTextdocs(message.url, message.text);
	if (textdocs) {
		markObservedConversationTextdocs(tabId, textdocs.conversationId);
		const existing = conversationsByTab.get(tabId);
		if (existing) {
			const merged = mergeConversationTextdocs(
				existing,
				textdocs.conversationId,
				textdocs.textdocs,
			);
			if (merged === existing) {
				stashPendingConversationTextdocs(tabId, textdocs.conversationId, textdocs.textdocs);
			} else {
				conversationsByTab.set(tabId, merged);
			}
		} else {
			stashPendingConversationTextdocs(tabId, textdocs.conversationId, textdocs.textdocs);
		}
	}
	const project = parseProjectListing(message.url, message.text);
	if (project) {
		const nextProject =
			project.provider === "chatgpt"
				? mergeProjectListings(projectsByTab.get(tabId) ?? null, project)
				: project;
		projectsByTab.set(tabId, nextProject);
	}
}

async function collectProjectListing(
	message: CollectProjectListingMessage,
	senderTabId?: number,
): Promise<SenderResponse> {
	const projectId = extractProjectIdFromPageUrl(message.currentProjectPageUrl);
	if (!projectId) return { ok: false, error: "Missing project id." };

	const helper = await browser.tabs.create({
		url: "about:blank",
		active: false,
	});
	if (!helper?.id) return { ok: false, error: "Failed to create helper tab." };

	try {
		await sendProgress(
			senderTabId,
			`Opening: ${formatProviderFromUrl(message.currentProjectPageUrl)} project listing`,
		);
		await navigateTabUntilUrlMatches(helper.id, message.currentProjectPageUrl);
		const project = await pollProjectFromTab(helper.id, projectId, true);
		await sendProgress(senderTabId, null);
		if (!project) return { ok: false, error: "No project data available." };
		return { ok: true, project };
	} finally {
		await closeTabQuietly(helper.id);
		await refocusSenderTab(senderTabId);
	}
}

async function collectProjectConversations(
	message: CollectProjectConversationsMessage,
	senderTabId?: number,
): Promise<SenderResponse> {
	if (!message.project || !message.currentProjectPageUrl) {
		return { ok: false, error: "Missing project export context." };
	}

	const helper = await browser.tabs.create({
		url: "about:blank",
		active: false,
	});
	if (!helper?.id) {
		return { ok: false, error: "Failed to create helper tab." };
	}

	const conversations: Conversation[] = [];

	try {
		for (const chat of message.project.chats) {
			await sendProgress(
				senderTabId,
				`Opening: ${capitalize(message.project.provider)} - ${message.project.projectName} - ${chat.title}`,
			);
			const pageUrl = buildProjectChatPageUrls(
				message.project,
				message.currentProjectPageUrl,
				chat.id,
			)[0];
			if (!pageUrl) continue;
			const captured = await captureConversationFromPage(
				helper.id,
				pageUrl,
				chat.id,
				chat.title,
			);
			if (captured) conversations.push(captured);
		}

		await sendProgress(senderTabId, null);
		return { ok: true, conversations };
	} finally {
		await closeTabQuietly(helper.id);
		await refocusSenderTab(senderTabId);
	}
}

async function captureConversationFromPage(
	helperTabId: number,
	pageUrl: string,
	expectedChatId: string,
	expectedTitle?: string,
): Promise<Conversation | null> {
	clearTabState(helperTabId);
	await navigateTabUntilUrlMatches(helperTabId, pageUrl);
	return pollConversationFromTab(
		helperTabId,
		expectedChatId,
		pageUrl,
		expectedTitle,
		true,
	);
}

async function pollConversationFromTab(
	tabId: number,
	expectedChatId: string,
	expectedPageUrl: string,
	expectedTitle: string | undefined,
	allowNetworkFallback: boolean,
): Promise<Conversation | null> {
	const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
	const isChatGpt = expectedPageUrl.includes("chatgpt.com");
	while (Date.now() < deadline) {
		const cached = conversationsByTab.get(tabId);
		if (
			matchesExpectedConversation(
				cached,
				expectedChatId,
				expectedPageUrl,
				expectedTitle,
			)
		) {
			if (!isChatGpt) return cached;
			if (isChatGptConversationReady(tabId, expectedChatId)) return cached;
		}

		const response = await safeSendMessage<{
			ok?: boolean;
			conversation?: Conversation | null;
		}>(tabId, {
			type: "GET_ACTIVE_CONVERSATION_DATA",
			allowNetworkFallback,
		} satisfies GetActiveConversationDataMessage);

		if (
			response?.ok &&
			matchesExpectedConversation(
				response.conversation ?? null,
				expectedChatId,
				expectedPageUrl,
				expectedTitle,
			)
		) {
			const conversation = response.conversation ?? null;
			if (!isChatGpt) return conversation;
			conversationsByTab.set(tabId, conversation);
			if (isChatGptConversationReady(tabId, expectedChatId)) return conversation;
		}

		await delay(POLL_INTERVAL_MS);
	}
	return conversationsByTab.get(tabId) ?? null;
}

function isChatGptConversationReady(
	tabId: number,
	expectedChatId: string,
): boolean {
	if (hasPendingChatGptTextdocs(tabId, expectedChatId)) return false;
	return hasObservedConversationTextdocs(tabId, expectedChatId);
}

function hasPendingChatGptTextdocs(tabId: number, conversationId: string): boolean {
	const pending = pendingChatGptTextdocsByTab.get(tabId)?.get(conversationId);
	return Boolean(pending && pending.length > 0);
}

async function pollProjectFromTab(
	tabId: number,
	expectedProjectId: string,
	allowNetworkFallback: boolean,
): Promise<ProjectListing | null> {
	const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
	let bestProject: ProjectListing | null = null;
	let lastSignature = "";
	let unchangedCount = 0;

	while (Date.now() < deadline) {
		let candidate = projectsByTab.get(tabId) ?? null;

		const response = await safeSendMessage<{
			ok?: boolean;
			project?: ProjectListing | null;
		}>(tabId, {
			type: "GET_ACTIVE_PROJECT_DATA",
			allowNetworkFallback,
		} satisfies GetActiveProjectDataMessage);

		if (
			response?.ok &&
			response.project &&
			(response.project.projectId === expectedProjectId ||
				response.project.chats.length > 0)
		) {
			candidate =
				response.project.provider === "chatgpt"
					? mergeProjectListings(candidate, response.project)
					: response.project;
		}

		if (candidate?.projectId === expectedProjectId) {
			bestProject =
				candidate.provider === "chatgpt"
					? mergeProjectListings(bestProject, candidate)
					: candidate;
			const signature = projectListingSignature(bestProject);
			if (signature !== lastSignature) {
				lastSignature = signature;
				unchangedCount = 0;
			} else if (bestProject.provider !== "chatgpt") {
				return bestProject;
			} else if (++unchangedCount >= 2) {
				return bestProject;
			}
		}

		await delay(POLL_INTERVAL_MS);
	}
	return bestProject;
}

async function safeSendMessage<T>(
	tabId: number,
	message: any,
): Promise<T | null> {
	try {
		return (await browser.tabs.sendMessage(tabId, message)) as T;
	} catch {
		return null;
	}
}

async function sendProgress(tabId: number | undefined, status: string | null) {
	if (tabId == null) return;
	try {
		await browser.tabs.sendMessage(tabId, {
			type: "PROJECT_EXPORT_PROGRESS",
			status,
		});
	} catch {
		// ignore
	}
}

async function navigateTabUntilUrlMatches(
	tabId: number,
	url: string,
): Promise<void> {
	clearTabState(tabId);
	await browser.tabs.update(tabId, { url, active: false });

	const deadline = Date.now() + TAB_URL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const tab = await browser.tabs.get(tabId).catch(() => null);
		if (tab?.url && urlsMatch(tab.url, url)) return;
		await delay(POLL_INTERVAL_MS);
	}

	throw new Error("Timed out waiting for helper tab navigation.");
}

function urlsMatch(actual: string, expected: string): boolean {
	const normalize = (value: string) => value.replace(/\/$/, "");
	return normalize(actual) === normalize(expected);
}

function matchesExpectedConversation(
	conversation: Conversation | null | undefined,
	expectedChatId: string,
	expectedPageUrl: string,
	expectedTitle?: string,
): conversation is Conversation {
	if (!conversation) return false;
	if (conversation.id === expectedChatId) return true;
	if (
		conversation.sourceUrl &&
		urlsMatch(conversation.sourceUrl, expectedPageUrl)
	)
		return true;
	if (
		expectedTitle &&
		conversation.title === expectedTitle &&
		conversation.messages.length > 0
	)
		return true;
	return false;
}

function clearTabState(tabId: number) {
	conversationsByTab.delete(tabId);
	projectsByTab.delete(tabId);
	pendingChatGptTextdocsByTab.delete(tabId);
	observedChatGptTextdocsByTab.delete(tabId);
}

async function closeTabQuietly(tabId: number) {
	clearTabState(tabId);
	try {
		await browser.tabs.remove(tabId);
	} catch {
		// ignore
	}
}

async function refocusSenderTab(tabId: number | undefined) {
	if (tabId == null) return;
	try {
		await browser.tabs.update(tabId, { active: true });
	} catch {
		// ignore
	}
}

function extractProjectIdFromPageUrl(url: string): string | null {
	const chatgpt = url.match(/\/g\/(g-p-[A-Za-z0-9]+)[^/]*\/project(?:\?.*)?$/);
	if (chatgpt) return chatgpt[1];
	const claude = url.match(/\/(?:project|projects)\/([A-Za-z0-9-]+)(?:\?.*)?$/);
	if (claude) return claude[1];
	return null;
}

function formatProviderFromUrl(url: string): string {
	if (url.includes("chatgpt.com")) return "ChatGPT";
	if (url.includes("claude.ai")) return "Claude";
	return "Project";
}

function capitalize(value: string): string {
	return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
