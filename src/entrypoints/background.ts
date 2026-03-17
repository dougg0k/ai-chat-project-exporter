import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { buildProjectChatPageUrls } from "../lib/page-context";
import { parseConversation, parseProjectListing } from "../lib/parser";
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
	if (conversation) conversationsByTab.set(tabId, conversation);
	const project = parseProjectListing(message.url, message.text);
	if (project) projectsByTab.set(tabId, project);
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
	await delay(500);
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
	while (Date.now() < deadline) {
		const cached = conversationsByTab.get(tabId);
		if (
			matchesExpectedConversation(
				cached,
				expectedChatId,
				expectedPageUrl,
				expectedTitle,
			)
		)
			return cached;

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
			return response.conversation ?? null;
		}

		await delay(POLL_INTERVAL_MS);
	}
	return null;
}

async function pollProjectFromTab(
	tabId: number,
	expectedProjectId: string,
	allowNetworkFallback: boolean,
): Promise<ProjectListing | null> {
	const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const cached = projectsByTab.get(tabId);
		if (cached?.projectId === expectedProjectId) return cached;

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
			return response.project;
		}

		await delay(POLL_INTERVAL_MS);
	}
	return null;
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
