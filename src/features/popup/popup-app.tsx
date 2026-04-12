import React from "react";
import { browser } from "wxt/browser";
import { ActionPanel } from "../shared/action-panel";
import {
	DEFAULT_EXPORT_FORMAT,
	INCLUDE_DOCUMENTS_CANVAS_KEY,
	THEME_MODE_KEY,
} from "../../lib/constants";
import { inferPageKind, inferProvider } from "../../lib/page-context";
import {
	getIncludeDocumentsCanvas,
	getPreferredExportFormat,
	getShowFloatingButton,
	getThemeMode,
	setIncludeDocumentsCanvas,
	setPreferredExportFormat,
	setShowFloatingButton,
	setThemeMode,
} from "../../lib/storage";
import { getUiTheme } from "../../lib/theme";
import type {
	ExportFormat,
	PageKind,
	ProviderName,
	ThemeMode,
	UiContext,
} from "../../lib/types";

const FORMAT_KEY = "preferredExportFormat";
const FLOATING_KEY = "showFloatingExportButton";
const INCLUDE_DOCUMENTS_CANVAS_LOCAL_KEY = "includeDocumentsCanvas";

function initialFormat(): ExportFormat {
	if (typeof localStorage === "undefined") return DEFAULT_EXPORT_FORMAT;
	return localStorage.getItem(FORMAT_KEY) === "html" ? "html" : "markdown";
}

function initialFloating(): boolean {
	if (typeof localStorage === "undefined") return true;
	return localStorage.getItem(FLOATING_KEY) !== "false";
}

function initialTheme(): ThemeMode {
	if (typeof localStorage === "undefined") return "light";
	return localStorage.getItem(THEME_MODE_KEY) === "dark" ? "dark" : "light";
}

function initialIncludeDocumentsCanvas(): boolean {
	if (typeof localStorage === "undefined") return true;
	return localStorage.getItem(INCLUDE_DOCUMENTS_CANVAS_LOCAL_KEY) !== "false";
}

export function PopupApp() {
	const [format, setFormatState] = React.useState<ExportFormat>(initialFormat);
	const [pageKind, setPageKind] = React.useState<PageKind>("unknown");
	const [showFloatingButton, setShowFloatingState] =
		React.useState<boolean>(initialFloating);
	const [themeMode, setThemeState] = React.useState<ThemeMode>(initialTheme);
	const [includeDocumentsCanvas, setIncludeDocumentsCanvasState] =
		React.useState<boolean>(initialIncludeDocumentsCanvas);
	const [provider, setProvider] = React.useState<ProviderName | null>(null);
	const [activeTabId, setActiveTabId] = React.useState<number | null>(null);
	const [error, setError] = React.useState<string>("");
	const [status, setStatus] = React.useState<string>("");
	const [canSkipProjectExport, setCanSkipProjectExport] = React.useState(false);
	const [loadingSelection, setLoadingSelection] = React.useState(false);
	const [waiting, setWaiting] = React.useState(false);
	const theme = React.useMemo(
		() => getUiTheme(themeMode, provider),
		[themeMode, provider],
	);

	const refreshContext = React.useCallback(async () => {
		if (activeTabId == null) return;
		try {
			const ctx = (await browser.tabs.sendMessage(activeTabId, {
				type: "GET_UI_CONTEXT",
			})) as UiContext;
			if (ctx?.pageKind) {
				setPageKind(ctx.pageKind);
				setProvider(ctx.provider ?? null);
				setStatus(ctx.projectExportStatus ?? "");
				setCanSkipProjectExport(Boolean(ctx.projectExportCanSkip));
				setWaiting(Boolean(ctx.waiting));
			}
		} catch {
			// ignore
		}
	}, [activeTabId]);

	React.useEffect(() => {
		void (async () => {
			try {
				const [tab] = await browser.tabs.query({
					active: true,
					currentWindow: true,
				});
				if (!tab?.id || !tab.url) {
					setPageKind("unsupported");
					return;
				}
				setActiveTabId(tab.id);
				setPageKind(inferPageKind(tab.url));
				setProvider(inferProvider(tab.url));
			} catch {
				setPageKind("unsupported");
				setProvider(null);
			}
		})();

		void (async () => {
			try {
				const [
					storedFormat,
					storedFloating,
					storedTheme,
					storedIncludeDocumentsCanvas,
				] = await Promise.all([
					getPreferredExportFormat(),
					getShowFloatingButton(),
					getThemeMode(),
					getIncludeDocumentsCanvas(),
				]);
				setFormatState(storedFormat);
				setShowFloatingState(storedFloating);
				setThemeState(storedTheme);
				setIncludeDocumentsCanvasState(storedIncludeDocumentsCanvas);
				if (typeof localStorage !== "undefined") {
					localStorage.setItem(FORMAT_KEY, storedFormat);
					localStorage.setItem(FLOATING_KEY, storedFloating ? "true" : "false");
					localStorage.setItem(THEME_MODE_KEY, storedTheme);
					localStorage.setItem(
						INCLUDE_DOCUMENTS_CANVAS_LOCAL_KEY,
						storedIncludeDocumentsCanvas ? "true" : "false",
					);
				}
			} catch {
				// ignore storage sync failures
			}
		})();
	}, []);

	React.useEffect(() => {
		void refreshContext();
	}, [refreshContext]);

	React.useEffect(() => {
		const root = document.documentElement;
		const body = document.body;
		root.style.background = theme.appBackground;
		root.style.colorScheme = themeMode === "dark" ? "dark" : "light";
		body.style.margin = "0";
		body.style.background = theme.appBackground;
		body.style.color = theme.text;
		body.style.width = "340px";
		body.style.maxWidth = "340px";
		body.style.minWidth = "340px";
	}, [theme, themeMode]);

	React.useEffect(() => {
		const onChanged = (
			changes: Record<string, { newValue?: unknown }>,
			areaName: string,
		) => {
			if (areaName !== "local") return;
			const themeChange = changes[THEME_MODE_KEY];
			if (themeChange) {
				const nextTheme = themeChange.newValue === "dark" ? "dark" : "light";
				setThemeState(nextTheme);
				if (typeof localStorage !== "undefined") {
					localStorage.setItem(THEME_MODE_KEY, nextTheme);
				}
			}
			const includeDocumentsCanvasChange =
				changes[INCLUDE_DOCUMENTS_CANVAS_KEY];
			if (!includeDocumentsCanvasChange) return;
			const nextIncludeDocumentsCanvas =
				includeDocumentsCanvasChange.newValue !== false;
			setIncludeDocumentsCanvasState(nextIncludeDocumentsCanvas);
			if (typeof localStorage !== "undefined") {
				localStorage.setItem(
					INCLUDE_DOCUMENTS_CANVAS_LOCAL_KEY,
					nextIncludeDocumentsCanvas ? "true" : "false",
				);
			}
		};
		browser.storage.onChanged.addListener(onChanged);
		return () => browser.storage.onChanged.removeListener(onChanged);
	}, []);

	React.useEffect(() => {
		const onRuntimeMessage = (
			message: { type?: string; context?: UiContext },
			sender: { tab?: { id?: number } },
		) => {
			if (message.type !== "UI_CONTEXT_CHANGED") return undefined;
			if (
				activeTabId != null &&
				sender.tab?.id != null &&
				sender.tab.id !== activeTabId
			) {
				return undefined;
			}
			const ctx = message.context;
			if (!ctx) return undefined;
			setPageKind(ctx.pageKind);
			setProvider(ctx.provider ?? null);
			setStatus(ctx.projectExportStatus ?? "");
			setCanSkipProjectExport(Boolean(ctx.projectExportCanSkip));
			setWaiting(Boolean(ctx.waiting));
			return undefined;
		};
		browser.runtime.onMessage.addListener(onRuntimeMessage);
		return () => browser.runtime.onMessage.removeListener(onRuntimeMessage);
	}, [activeTabId]);

	React.useEffect(() => {
		const onActivated = (activeInfo: { tabId: number }) => {
			setActiveTabId(activeInfo.tabId);
			void browser.tabs
				.query({ active: true, currentWindow: true })
				.then(([tab]) => {
					if (tab?.url) {
						setPageKind(inferPageKind(tab.url));
						setProvider(inferProvider(tab.url));
					}
					void refreshContext();
				})
				.catch(() => undefined);
		};
		const onUpdated = (
			tabId: number,
			changeInfo: { status?: string; url?: string },
			tab: { url?: string },
		) => {
			if (tabId !== activeTabId) return;
			if (!tab.url && !changeInfo.url) return;
			setPageKind(inferPageKind(changeInfo.url || tab.url || ""));
			setProvider(inferProvider(changeInfo.url || tab.url || ""));
			if (changeInfo.status === "complete" || changeInfo.url) {
				void refreshContext();
			}
		};
		const onFocusChanged = () => {
			void browser.tabs
				.query({ active: true, currentWindow: true })
				.then(([tab]) => {
					if (!tab?.id) return;
					setActiveTabId(tab.id);
					if (tab.url) {
						setPageKind(inferPageKind(tab.url));
						setProvider(inferProvider(tab.url));
					}
					void refreshContext();
				})
				.catch(() => undefined);
		};
		browser.tabs.onActivated.addListener(onActivated);
		browser.tabs.onUpdated.addListener(onUpdated);
		browser.windows.onFocusChanged.addListener(onFocusChanged);
		return () => {
			browser.tabs.onActivated.removeListener(onActivated);
			browser.tabs.onUpdated.removeListener(onUpdated);
			browser.windows.onFocusChanged.removeListener(onFocusChanged);
		};
	}, [activeTabId, refreshContext]);

	const setFormat = React.useCallback((next: ExportFormat) => {
		setFormatState(next);
		if (typeof localStorage !== "undefined")
			localStorage.setItem(FORMAT_KEY, next);
		void setPreferredExportFormat(next).catch(() => undefined);
	}, []);

	const toggleFloating = React.useCallback(
		(next: boolean) => {
			setShowFloatingState(next);
			if (typeof localStorage !== "undefined")
				localStorage.setItem(FLOATING_KEY, next ? "true" : "false");
			void setShowFloatingButton(next).catch(() => undefined);
			if (activeTabId != null) {
				void browser.tabs
					.sendMessage(activeTabId, {
						type: "SET_FLOATING_VISIBILITY",
						value: next,
					})
					.catch(() => undefined);
			}
		},
		[activeTabId],
	);

	const toggleTheme = React.useCallback((next: ThemeMode) => {
		setThemeState(next);
		if (typeof localStorage !== "undefined")
			localStorage.setItem(THEME_MODE_KEY, next);
		void setThemeMode(next).catch(() => undefined);
	}, []);

	const toggleIncludeDocumentsCanvas = React.useCallback((next: boolean) => {
		setIncludeDocumentsCanvasState(next);
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(
				INCLUDE_DOCUMENTS_CANVAS_LOCAL_KEY,
				next ? "true" : "false",
			);
		}
		void setIncludeDocumentsCanvas(next).catch(() => undefined);
	}, []);

	const runChatAction = React.useCallback(
		(target: "file" | "clipboard", selectedMessageIds?: string[]) => {
			if (activeTabId == null) return;
			setError("");

			if (target === "clipboard") {
				void browser.tabs
					.sendMessage(activeTabId, {
						type: "GET_RENDERED_CHAT",
						format,
						selectedMessageIds,
					})
					.then(async (result) => {
						if (!result?.ok || typeof result.text !== "string") {
							setError(result?.error || "Clipboard failed.");
							return;
						}
						await navigator.clipboard.writeText(result.text);
						window.close();
					})
					.catch((err) => setError(err?.message || "Clipboard failed."));
				return;
			}

			void browser.tabs
				.sendMessage(activeTabId, {
					type: "EXPORT_CHAT",
					format,
					target,
					selectedMessageIds,
					includeDocumentsCanvas,
				})
				.then((result) => {
					if (result?.ok === false) {
						setError(result.error || "Chat action failed.");
						return;
					}
					window.close();
				})
				.catch((err) => setError(err?.message || "Chat action failed."));
		},
		[activeTabId, format, includeDocumentsCanvas],
	);

	const runProjectAction = React.useCallback(() => {
		if (activeTabId == null) return;
		setError("");
		void browser.tabs
			.sendMessage(activeTabId, {
				type: "EXPORT_PROJECT",
				format,
				includeDocumentsCanvas,
			})
			.then((result) => {
				if (result?.ok === false) {
					setError(result.error || "Project export failed.");
					return;
				}
				window.close();
			})
			.catch((err) => setError(err?.message || "Project export failed."));
	}, [activeTabId, format, includeDocumentsCanvas]);

	const skipProjectExport = React.useCallback(() => {
		if (activeTabId == null) return;
		setError("");
		setCanSkipProjectExport(false);
		void browser.tabs
			.sendMessage(activeTabId, { type: "REQUEST_PROJECT_EXPORT_SKIP" })
			.then((result) => {
				if (result?.ok === false) {
					setError(result.error || "Failed to skip chat.");
				}
			})
			.catch((err) => setError(err?.message || "Failed to skip chat."));
	}, [activeTabId]);

	const openSelectionModal = React.useCallback(() => {
		if (activeTabId == null) return;
		setError("");
		setLoadingSelection(true);
		void browser.tabs
			.sendMessage(activeTabId, { type: "OPEN_SELECT_EXPORT_MODAL", format })
			.then((result) => {
				if (result?.ok === false) {
					setError(result.error || "Failed to open content selector.");
					return;
				}
				window.close();
			})
			.catch((err) =>
				setError(err?.message || "Failed to open content selector."),
			)
			.finally(() => setLoadingSelection(false));
	}, [activeTabId, format]);

	return (
		<main
			style={{
				width: 340,
				maxWidth: 340,
				minWidth: 340,
				boxSizing: "border-box",
				padding: 12,
				fontFamily: "system-ui, sans-serif",
				background: theme.appBackground,
				color: theme.text,
			}}
		>
			<div
				style={{
					background: theme.panelBackground,
					width: "100%",
					maxWidth: "100%",
					boxSizing: "border-box",
					border: theme.panelBorder,
					borderRadius: 16,
					padding: 14,
					boxShadow: theme.shadow,
				}}
			>
				<ActionPanel
					pageKind={pageKind}
					format={format}
					themeMode={themeMode}
					theme={theme}
					onFormatChange={setFormat}
					onExport={
						pageKind === "project"
							? runProjectAction
							: () => runChatAction("file")
					}
					onSelectContentExport={
						pageKind === "chat" ? openSelectionModal : undefined
					}
					onClipboard={
						pageKind === "chat" ? () => runChatAction("clipboard") : undefined
					}
					onToggleFloating={toggleFloating}
					onToggleTheme={toggleTheme}
					onToggleIncludeDocumentsCanvas={toggleIncludeDocumentsCanvas}
					showFloatingButton={showFloatingButton}
					includeDocumentsCanvas={includeDocumentsCanvas}
					statusText={status || undefined}
					canSkipProjectExport={canSkipProjectExport}
					onSkipProjectExport={
						canSkipProjectExport ? skipProjectExport : undefined
					}
					disabled={loadingSelection || waiting}
				/>
				{error && (
					<div style={{ marginTop: 10, fontSize: 12, color: theme.errorText }}>
						{error}
					</div>
				)}
			</div>
		</main>
	);
}
