import { defineContentScript } from "wxt/utils/define-content-script";
import { APP_SOURCE, CONTENT_MATCHES } from "../lib/constants";
import { isRelevantProviderApiUrl } from "../lib/provider-url";

export default defineContentScript({
	matches: [...CONTENT_MATCHES],
	runAt: "document_start",
	world: "MAIN",
	main() {
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
				if (!isRelevantProviderApiUrl(url)) return;
				if (typeof text === "string" && text.trim()) emitCapture(url, text);
			} catch {
				// ignore
			}
		};

		const originalFetch = window.fetch;
		window.fetch = async (...args) => {
			const response = await originalFetch(...args);
			try {
				const request = args[0];
				const url =
					typeof request === "string"
						? request
						: request instanceof Request
							? request.url
							: "";
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
				this.__captureUrl = String(url);
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
			if (data.type !== "PAGE_FETCH_REQUEST") return;

			try {
				const response = await originalFetch(data.url, {
					method: "GET",
					credentials: "include",
					headers: { accept: "application/json, text/plain, */*" },
				});
				const text = await response.text();
				emitFetchResult(
					data.requestId,
					data.url,
					response.ok,
					response.status,
					text,
				);
			} catch {
				emitFetchResult(data.requestId, data.url, false, 0, "");
			}
		});
	},
});
