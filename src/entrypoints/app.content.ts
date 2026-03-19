import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import { CONTENT_MATCHES } from "../lib/constants";
import {
	exportChat,
	exportProject,
	getActiveConversationData,
	getActiveProjectData,
	getRenderedChat,
	getUiContext,
	initializeController,
	setFloatingButtonVisible,
	shouldRenderFloatingButton,
} from "../features/content/controller";
import { mountFloatingUi } from "../features/content/floating-ui";
import { subscribeUiContext } from "../features/content/controller";
import type { RuntimeMessage } from "../lib/types";

export default defineContentScript({
	matches: [...CONTENT_MATCHES],
	runAt: "document_start",
	main() {
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
					getActiveConversation: () => getActiveConversationData(false),
					onExportChat: async (format, selectedMessageIds) =>
						exportChat(format, "file", selectedMessageIds),
					onCopyChat: async (format, selectedMessageIds) =>
						exportChat(format, "clipboard", selectedMessageIds),
					onExportProject: exportProject,
				});
			}
		};

		const queueRefresh = () => {
			if (refreshQueued) return;
			refreshQueued = true;
			queueMicrotask(() => {
				refreshQueued = false;
				void mountIfNeeded();
			});
		};
		window.addEventListener("popstate", queueRefresh);
		window.addEventListener("hashchange", queueRefresh);
		document.addEventListener("readystatechange", queueRefresh);
		const mountObserver = new MutationObserver(() => {
			if (!mounted) queueRefresh();
		});
		mountObserver.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
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
					message.type !== "PROJECT_EXPORT_PROGRESS"
				) {
					return undefined;
				}

				if (message.type === "PROJECT_EXPORT_PROGRESS") {
					sendResponse({ ok: true });
					return undefined;
				}

				void (async () => {
					try {
						await initPromise;
						if (message.type === "GET_UI_CONTEXT") {
							sendResponse(await getUiContext());
							return;
						}
						if (message.type === "SET_FLOATING_VISIBILITY") {
							sendResponse(await setFloatingButtonVisible(message.value));
							return;
						}
						if (message.type === "GET_RENDERED_CHAT") {
							sendResponse({
								ok: true,
								text: await getRenderedChat(
									message.format,
									message.selectedMessageIds,
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
							);
							sendResponse({ ok: true });
							return;
						}
						if (message.type === "EXPORT_PROJECT") {
							await exportProject(message.format);
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

		window.addEventListener("beforeunload", () => mountObserver.disconnect(), {
			once: true,
		});
	},
});
