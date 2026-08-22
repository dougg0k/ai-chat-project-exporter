import { APP_SOURCE } from "./constants";
import {
	isChatGptConversationUrl,
	isRelevantProviderApiUrl,
	matchChatGptConversationApiUrl,
} from "./provider-url";
import type { PageFetchResultMessage, RawCaptureMessage } from "./types";

const pending = new Map<
	string,
	{
		resolve: (value: PageFetchResultMessage) => void;
		reject: (reason?: unknown) => void;
	}
>();
const rawCaptureListeners = new Set<(message: RawCaptureMessage) => void>();
let initialized = false;

export function initFetchBridge() {
	if (initialized) return;
	initialized = true;

	window.addEventListener("message", (event) => {
		if (event.source !== window) return;
		const data = event.data;
		if (!data || data.source !== APP_SOURCE) return;

		if (data.type === "RAW_CAPTURE") {
			const message: RawCaptureMessage = {
				type: "RAW_CAPTURE",
				url: data.url,
				text: data.text,
			};
			rawCaptureListeners.forEach((listener) => listener(message));
			return;
		}

		if (data.type === "PAGE_FETCH_RESULT") {
			const handler = pending.get(data.requestId);
			if (!handler) return;
			pending.delete(data.requestId);
			handler.resolve({
				type: "PAGE_FETCH_RESULT",
				requestId: data.requestId,
				url: data.url,
				ok: Boolean(data.ok),
				status: Number(data.status ?? 0),
				text: typeof data.text === "string" ? data.text : "",
			});
		}
	});
}

export function onRawCapture(
	listener: (message: RawCaptureMessage) => void,
): () => void {
	rawCaptureListeners.add(listener);
	return () => rawCaptureListeners.delete(listener);
}

function requestPageFetch(
	url: string,
	type: "PAGE_FETCH_REQUEST" | "CHATGPT_PAGE_FETCH_REQUEST",
): Promise<PageFetchResultMessage> {
	const requestId = crypto.randomUUID();
	const promise = new Promise<PageFetchResultMessage>((resolve, reject) => {
		pending.set(requestId, { resolve, reject });
		setTimeout(() => {
			if (pending.has(requestId)) {
				pending.delete(requestId);
				reject(new Error(`Timed out fetching ${url}`));
			}
		}, 20_000);
	});

	window.postMessage({ source: APP_SOURCE, type, requestId, url }, "*");
	return promise;
}

function resolvePageUrl(url: string): string {
	try {
		return new URL(url, window.location.href).href;
	} catch {
		return url;
	}
}

export async function pageFetch(url: string): Promise<PageFetchResultMessage> {
	if (isChatGptConversationUrl(resolvePageUrl(url))) {
		throw new Error(
			"ChatGPT conversation requests require the captured page request context.",
		);
	}
	return requestPageFetch(url, "PAGE_FETCH_REQUEST");
}

export async function chatGptPageFetch(
	url: string,
): Promise<PageFetchResultMessage> {
	const resolvedUrl = resolvePageUrl(url);
	const match = matchChatGptConversationApiUrl(resolvedUrl);
	if (!match || match.kind !== "messages") {
		throw new Error(
			"Only ChatGPT conversation history pages can be requested.",
		);
	}
	return requestPageFetch(resolvedUrl, "CHATGPT_PAGE_FETCH_REQUEST");
}

export function collectObservedApiUrls(): string[] {
	try {
		const entries = performance.getEntriesByType(
			"resource",
		) as PerformanceResourceTiming[];
		const urls = new Set<string>();
		for (const entry of entries) {
			const url = entry.name;
			if (
				isRelevantProviderApiUrl(url) ||
				url.includes("https://claude.ai/api/organizations/")
			) {
				urls.add(url);
			}
		}
		return [...urls];
	} catch {
		return [];
	}
}
