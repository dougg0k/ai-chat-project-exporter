import { defineContentScript } from "wxt/utils/define-content-script";
import { APP_SOURCE, CONTENT_MATCHES } from "../lib/constants";
import {
	isChatGptConversationUrl,
	isRelevantProviderApiUrl,
	matchChatGptConversationApiUrl,
} from "../lib/provider-url";

interface ChatGptRequestContext {
	headers: [string, string][];
	credentials: RequestCredentials;
	cache: RequestCache;
	redirect: RequestRedirect;
	referrer: string;
	referrerPolicy: ReferrerPolicy;
	integrity: string;
	keepalive: boolean;
	mode: RequestMode;
}

export default defineContentScript({
	matches: [...CONTENT_MATCHES],
	runAt: "document_start",
	world: "MAIN",
	main() {
		const chatGptRequestContexts = new Map<string, ChatGptRequestContext>();

		const normalizeUrl = (value: string): string => {
			try {
				return new URL(value, window.location.href).href;
			} catch {
				return value;
			}
		};

		const requestUrl = (input: RequestInfo | URL): string => {
			if (typeof input === "string") return normalizeUrl(input);
			if (input instanceof Request) return normalizeUrl(input.url);
			if (input instanceof URL) return input.href;
			return "";
		};

		const emitCapture = (url: string, text: string) => {
			window.postMessage(
				{ source: APP_SOURCE, type: "RAW_CAPTURE", url, text },
				"*",
			);
		};

		const emitFetchResult = (
			requestId: string,
			url: string,
			ok: boolean,
			status: number,
			text: string,
		) => {
			window.postMessage(
				{
					source: APP_SOURCE,
					type: "PAGE_FETCH_RESULT",
					requestId,
					url,
					ok,
					status,
					text,
				},
				"*",
			);
		};

		const captureText = (url: string, text: string) => {
			try {
				const normalizedUrl = normalizeUrl(url);
				if (!isRelevantProviderApiUrl(normalizedUrl)) return;
				if (typeof text === "string" && text.trim()) {
					emitCapture(normalizedUrl, text);
				}
			} catch {
				// ignore
			}
		};

		const rememberChatGptRequestContext = (
			input: RequestInfo | URL,
			init: RequestInit | undefined,
			url: string,
		) => {
			const match = matchChatGptConversationApiUrl(url);
			if (!match || match.kind === "legacy") return;
			try {
				const request =
					input instanceof Request
						? new Request(input, init)
						: new Request(url, init);
				if (request.method.toUpperCase() !== "GET") return;
				const headers: [string, string][] = [];
				request.headers.forEach((value, name) => headers.push([name, value]));
				chatGptRequestContexts.set(match.conversationId, {
					headers,
					credentials: request.credentials,
					cache: request.cache,
					redirect: request.redirect,
					referrer: request.referrer,
					referrerPolicy: request.referrerPolicy,
					integrity: request.integrity,
					keepalive: request.keepalive,
					mode: request.mode,
				});
			} catch {
				// A captured response can still be exported if no older page is needed.
			}
		};

		const originalFetch = window.fetch;
		window.fetch = async (...args) => {
			const url = requestUrl(args[0]);
			if (url) rememberChatGptRequestContext(args[0], args[1], url);

			const response = await originalFetch(...args);
			try {
				if (url && isRelevantProviderApiUrl(url)) {
					const clone = response.clone();
					const text = await clone.text();
					captureText(url, text);
				}
			} catch {
				// ignore fetch capture failures
			}
			return response;
		};

		const NativeXHR = window.XMLHttpRequest;
		class CaptureXHR extends NativeXHR {
			private __captureUrl = "";

			open(
				method: string,
				url: string | URL,
				async?: boolean,
				username?: string | null,
				password?: string | null,
			): void {
				this.__captureUrl = normalizeUrl(String(url));
				super.open(
					method,
					url,
					async ?? true,
					username ?? undefined,
					password ?? undefined,
				);
			}

			send(body?: Document | XMLHttpRequestBodyInit | null): void {
				this.addEventListener("loadend", () => {
					try {
						if (
							!this.__captureUrl ||
							!isRelevantProviderApiUrl(this.__captureUrl)
						)
							return;
						const responseType = this.responseType;
						if (
							responseType === "arraybuffer" ||
							responseType === "blob" ||
							responseType === "document"
						)
							return;
						if (responseType === "json") {
							const jsonText =
								typeof this.response === "string"
									? this.response
									: JSON.stringify(this.response ?? null);
							captureText(this.__captureUrl, jsonText);
							return;
						}
						captureText(this.__captureUrl, this.responseText ?? "");
					} catch {
						// ignore xhr capture failures
					}
				});
				super.send(body as any);
			}
		}

		window.XMLHttpRequest = CaptureXHR as typeof XMLHttpRequest;

		window.addEventListener("message", async (event) => {
			if (event.source !== window) return;
			const data = event.data;
			if (!data || data.source !== APP_SOURCE) return;
			if (
				data.type !== "PAGE_FETCH_REQUEST" &&
				data.type !== "CHATGPT_PAGE_FETCH_REQUEST"
			)
				return;

			const normalizedUrl = normalizeUrl(String(data.url ?? ""));

			if (data.type === "CHATGPT_PAGE_FETCH_REQUEST") {
				const match = matchChatGptConversationApiUrl(normalizedUrl);
				if (!match || match.kind !== "messages") {
					emitFetchResult(data.requestId, normalizedUrl, false, 0, "");
					return;
				}
				const context = chatGptRequestContexts.get(match.conversationId);
				if (!context) {
					emitFetchResult(data.requestId, normalizedUrl, false, 0, "");
					return;
				}
				try {
					const response = await originalFetch(normalizedUrl, {
						method: "GET",
						headers: context.headers,
						credentials: context.credentials,
						cache: context.cache,
						redirect: context.redirect,
						referrer: context.referrer,
						referrerPolicy: context.referrerPolicy,
						integrity: context.integrity,
						keepalive: context.keepalive,
						mode: context.mode,
					});
					const text = await response.text();
					emitFetchResult(
						data.requestId,
						normalizedUrl,
						response.ok,
						response.status,
						text,
					);
				} catch {
					emitFetchResult(data.requestId, normalizedUrl, false, 0, "");
				}
				return;
			}

			if (isChatGptConversationUrl(normalizedUrl)) {
				emitFetchResult(data.requestId, normalizedUrl, false, 0, "");
				return;
			}

			try {
				const response = await originalFetch(normalizedUrl, {
					method: "GET",
					credentials: "include",
					headers: { accept: "application/json, text/plain, */*" },
				});
				const text = await response.text();
				emitFetchResult(
					data.requestId,
					normalizedUrl,
					response.ok,
					response.status,
					text,
				);
			} catch {
				emitFetchResult(data.requestId, normalizedUrl, false, 0, "");
			}
		});
	},
});
