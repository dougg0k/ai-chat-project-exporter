import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import { CONTENT_MATCHES } from "../lib/constants";
import {
	exportChat,
	exportProject,
	getActiveConversationData,
	getActiveConversationForSelection,
	getActiveProjectData,
	getRenderedChat,
	getUiContext,
	initializeController,
	setFloatingButtonVisible,
	shouldRenderFloatingButton,
	requestProjectExportSkip,
} from "../features/content/controller";
import { mountFloatingUi } from "../features/content/floating-ui";
import { initializeChatGptVirtualScroll } from "../features/content/chatgpt-virtual-scroll";
import { subscribeUiContext } from "../features/content/controller";
import type { RuntimeMessage } from "../lib/types";

export default defineContentScript({
	matches: [...CONTENT_MATCHES],
	runAt: "document_start",
	main() {
		const chatGptVirtualScroll = initializeChatGptVirtualScroll();
		let mounted = false;
		let floatingUi: ReturnType<typeof mountFloatingUi> | null = null;
		const initPromise = initializeController();

		let refreshQueued = false;

		const mountIfNeeded = async (force = false) => {
			await initPromise;
			if (!mounted && (shouldRenderFloatingButton() || force)) {
				mounted = true;
				floatingUi = mountFloatingUi({
					getContext: getUiContext,
					subscribeContext: subscribeUiContext,
					getActiveConversation: () => getActiveConversationForSelection(),
					onExportChat: async (
						format,
						includeDocumentsCanvas,
						selectedMessageIds,
					) =>
						exportChat(
							format,
							"file",
							selectedMessageIds,
							includeDocumentsCanvas,
						),
					onCopyChat: async (
						format,
						includeDocumentsCanvas,
						selectedMessageIds,
					) =>
						exportChat(
							format,
							"clipboard",
							selectedMessageIds,
							includeDocumentsCanvas,
						),
					onExportProject: exportProject,
					onSkipProjectExport: requestProjectExportSkip,
				});
			}
		};

		const locationChangeEvent = "ai-chat-project-exporter:locationchange";
		const historyState = window.history as History & {
			__aiChatProjectExporterLocationPatched?: boolean;
		};
		if (!historyState.__aiChatProjectExporterLocationPatched) {
			historyState.__aiChatProjectExporterLocationPatched = true;
			const notifyLocationChange = () => {
				window.dispatchEvent(new Event(locationChangeEvent));
			};
			const originalPushState = window.history.pushState.bind(window.history);
			window.history.pushState = ((...args) => {
				const result = originalPushState(...args);
				notifyLocationChange();
				return result;
			}) as History["pushState"];
			const originalReplaceState = window.history.replaceState.bind(
				window.history,
			);
			window.history.replaceState = ((...args) => {
				const result = originalReplaceState(...args);
				notifyLocationChange();
				return result;
			}) as History["replaceState"];
		}

		const queueRefresh = () => {
			if (refreshQueued) return;
			refreshQueued = true;
			queueMicrotask(() => {
				refreshQueued = false;
				chatGptVirtualScroll.refresh();
				void mountIfNeeded();
			});
		};
		window.addEventListener("popstate", queueRefresh);
		window.addEventListener("hashchange", queueRefresh);
		window.addEventListener(locationChangeEvent, queueRefresh);
		document.addEventListener("readystatechange", queueRefresh);
		chatGptVirtualScroll.refresh();
		void mountIfNeeded();
		void browser.runtime
			.sendMessage({
				type: "CONTENT_READY",
				url: window.location.href,
			} satisfies RuntimeMessage)
			.catch(() => undefined);

		browser.runtime.onMessage.addListener(
			(message: RuntimeMessage, _sender, sendResponse) => {
				if (
					message.type !== "GET_UI_CONTEXT" &&
					message.type !== "SET_FLOATING_VISIBILITY" &&
					message.type !== "GET_RENDERED_CHAT" &&
					message.type !== "GET_ACTIVE_CONVERSATION_DATA" &&
					message.type !== "GET_ACTIVE_PROJECT_DATA" &&
					message.type !== "OPEN_SELECT_EXPORT_MODAL" &&
					message.type !== "EXPORT_CHAT" &&
					message.type !== "EXPORT_PROJECT" &&
					message.type !== "PROJECT_EXPORT_PROGRESS" &&
					message.type !== "REQUEST_PROJECT_EXPORT_SKIP"
				) {
					return undefined;
				}

				if (message.type === "PROJECT_EXPORT_PROGRESS") {
					sendResponse({ ok: true });
					return undefined;
				}

				if (message.type === "REQUEST_PROJECT_EXPORT_SKIP") {
					void requestProjectExportSkip()
						.then(() => sendResponse({ ok: true }))
						.catch((error) =>
							sendResponse({
								ok: false,
								error: error instanceof Error ? error.message : String(error),
							}),
						);
					return true;
				}

				void (async () => {
					try {
						await initPromise;
						if (message.type === "GET_UI_CONTEXT") {
							sendResponse(await getUiContext());
							return;
						}
						if (message.type === "SET_FLOATING_VISIBILITY") {
							const context = await setFloatingButtonVisible(message.value);
							if (message.value) await mountIfNeeded(true);
							sendResponse(context);
							return;
						}
						if (message.type === "GET_RENDERED_CHAT") {
							sendResponse({
								ok: true,
								text: await getRenderedChat(
									message.format,
									message.selectedMessageIds,
									message.includeDocumentsCanvas,
								),
							});
							return;
						}
						if (message.type === "GET_ACTIVE_CONVERSATION_DATA") {
							sendResponse({
								ok: true,
								conversation: await getActiveConversationData(
									message.allowNetworkFallback !== false,
								),
							});
							return;
						}
						if (message.type === "GET_ACTIVE_PROJECT_DATA") {
							sendResponse({
								ok: true,
								project: await getActiveProjectData(
									message.allowNetworkFallback !== false,
								),
							});
							return;
						}

						if (message.type === "OPEN_SELECT_EXPORT_MODAL") {
							await mountIfNeeded(true);
							floatingUi?.openSelectionModal(message.format);
							sendResponse({ ok: true });
							return;
						}
						if (message.type === "EXPORT_CHAT") {
							await exportChat(
								message.format,
								message.target,
								message.selectedMessageIds,
								message.includeDocumentsCanvas,
							);
							sendResponse({ ok: true });
							return;
						}
						if (message.type === "EXPORT_PROJECT") {
							await exportProject(
								message.format,
								message.includeDocumentsCanvas,
							);
							sendResponse({ ok: true });
							return;
						}
					} catch (error) {
						sendResponse({
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				})();
				return true;
			},
		);

		window.addEventListener(
			"beforeunload",
			() => {
				chatGptVirtualScroll.destroy();
			},
			{
				once: true,
			},
		);
	},
});
