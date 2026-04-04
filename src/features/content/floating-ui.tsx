import React from "react";
import { browser } from "wxt/browser";
import ReactDOM from "react-dom/client";
import { deriveConversationTurns } from "../../lib/chat-selection";
import { LogoIcon } from "../../lib/Logo";
import type { FloatingButtonPosition } from "../../lib/storage";
import {
	getFloatingButtonPosition,
	getIncludeDocumentsCanvas,
	getPreferredExportFormat,
	getThemeMode,
	setFloatingButtonPosition,
	setIncludeDocumentsCanvas,
	setPreferredExportFormat,
} from "../../lib/storage";
import {
	INCLUDE_DOCUMENTS_CANVAS_KEY,
	THEME_MODE_KEY,
} from "../../lib/constants";
import { getUiTheme } from "../../lib/theme";
import type {
	Conversation,
	ExportFormat,
	ThemeMode,
	UiContext,
} from "../../lib/types";
import { ActionPanel } from "../shared/action-panel";
import { SelectExportModal } from "../shared/select-export-modal";

const DEFAULT_OFFSET = { right: 28, bottom: 22 } as const;
const DEFAULT_BUTTON_SIZE = { width: 114, height: 42 } as const;
const DRAG_THRESHOLD_PX = 5;
const PANEL_GAP_PX = 10;
const PANEL_WIDTH_PX = 332;

export function mountFloatingUi(options: {
	getContext: () => Promise<UiContext>;
	subscribeContext: (listener: (context: UiContext) => void) => () => void;
	getActiveConversation: () => Promise<Conversation | null>;
	onExportChat: (
		format: ExportFormat,
		includeDocumentsCanvas: boolean,
		selectedMessageIds?: string[],
	) => Promise<void>;
	onCopyChat: (
		format: ExportFormat,
		includeDocumentsCanvas: boolean,
		selectedMessageIds?: string[],
	) => Promise<void>;
	onExportProject: (
		format: ExportFormat,
		includeDocumentsCanvas: boolean,
	) => Promise<void>;
	onSkipProjectExport: () => Promise<void>;
}) {
	const host = document.createElement("div");
	host.style.position = "fixed";
	host.style.left = "0px";
	host.style.top = "0px";
	host.style.zIndex = "2147483647";
	document.documentElement.append(host);

	const shadow = host.attachShadow({ mode: "open" });
	const mount = document.createElement("div");
	shadow.append(mount);

	let api: { openSelectionModal: (format?: ExportFormat) => void } | null =
		null;
	let pendingOpenSelectionRequest: {
		hasRequest: true;
		format?: ExportFormat;
	} | null = null;
	const root = ReactDOM.createRoot(mount);
	root.render(
		<FloatingApp
			{...options}
			positionScope={resolveFloatingPositionScope()}
			applyHostPosition={(position) => {
				host.style.left = `${position.x}px`;
				host.style.top = `${position.y}px`;
				host.style.right = "auto";
				host.style.bottom = "auto";
			}}
			registerApi={(next) => {
				api = next;
				if (pendingOpenSelectionRequest) {
					const request = pendingOpenSelectionRequest;
					pendingOpenSelectionRequest = null;
					next.openSelectionModal(request.format);
				}
			}}
		/>,
	);

	return {
		unmount: () => {
			root.unmount();
			host.remove();
		},
		openSelectionModal: (format?: ExportFormat) => {
			if (api) {
				api.openSelectionModal(format);
				return;
			}
			pendingOpenSelectionRequest = { hasRequest: true, format };
		},
	};
}

function FloatingApp(props: {
	registerApi?: (api: {
		openSelectionModal: (format?: ExportFormat) => void;
	}) => void;
	getContext: () => Promise<UiContext>;
	subscribeContext: (listener: (context: UiContext) => void) => () => void;
	getActiveConversation: () => Promise<Conversation | null>;
	onExportChat: (
		format: ExportFormat,
		includeDocumentsCanvas: boolean,
		selectedMessageIds?: string[],
	) => Promise<void>;
	onCopyChat: (
		format: ExportFormat,
		includeDocumentsCanvas: boolean,
		selectedMessageIds?: string[],
	) => Promise<void>;
	onExportProject: (
		format: ExportFormat,
		includeDocumentsCanvas: boolean,
	) => Promise<void>;
	onSkipProjectExport: () => Promise<void>;
	applyHostPosition: (position: FloatingButtonPosition) => void;
	positionScope: string;
}) {
	const [open, setOpen] = React.useState(false);
	const [format, setFormat] = React.useState<ExportFormat>("markdown");
	const [busy, setBusy] = React.useState(false);
	const [themeMode, setThemeState] = React.useState<ThemeMode>("light");
	const [includeDocumentsCanvas, setIncludeDocumentsCanvasState] =
		React.useState(true);
	const [selectionConversation, setSelectionConversation] =
		React.useState<Conversation | null>(null);
	const [selectionVisible, setSelectionVisible] = React.useState(false);
	const [selectedTurnIds, setSelectedTurnIds] = React.useState<Set<string>>(
		new Set(),
	);
	const [expandedTurnIds, setExpandedTurnIds] = React.useState<Set<string>>(
		new Set(),
	);
	const [position, setPosition] = React.useState<FloatingButtonPosition | null>(
		null,
	);
	const [viewport, setViewport] = React.useState({
		width: window.innerWidth,
		height: window.innerHeight,
	});
	const [context, setContext] = React.useState<UiContext>({
		provider: null,
		pageKind: "unknown",
		hasConversation: false,
		hasProject: false,
		waiting: false,
		showFloatingButton: true,
		projectExportStatus: null,
		projectExportCanSkip: false,
	});
	const boxRef = React.useRef<HTMLDivElement | null>(null);
	const buttonRef = React.useRef<HTMLButtonElement | null>(null);
	const positionRef = React.useRef<FloatingButtonPosition | null>(null);
	const suppressClickRef = React.useRef(false);
	const dragStateRef = React.useRef<{
		pointerId: number;
		startPointerX: number;
		startPointerY: number;
		startX: number;
		startY: number;
		dragging: boolean;
	} | null>(null);
	const selectionNavigationCacheRef = React.useRef<Map<string, HTMLElement>>(
		new Map(),
	);
	const theme = React.useMemo(
		() => getUiTheme(themeMode, context.provider),
		[themeMode, context.provider],
	);
	const selectionConversationSignatureRef = React.useRef<string | null>(null);

	const refresh = React.useCallback(async () => {
		const next = await props.getContext();
		setContext(next);
	}, [props]);

	React.useEffect(() => {
		void refresh();
		void Promise.all([
			getPreferredExportFormat(),
			getThemeMode(),
			getIncludeDocumentsCanvas(),
		])
			.then(([storedFormat, storedTheme, storedIncludeDocumentsCanvas]) => {
				setFormat(storedFormat);
				setThemeState(storedTheme);
				setIncludeDocumentsCanvasState(storedIncludeDocumentsCanvas);
			})
			.catch(() => undefined);
	}, [refresh]);

	React.useEffect(() => {
		const onChanged = (
			changes: Record<string, { newValue?: unknown }>,
			areaName: string,
		) => {
			if (areaName !== "local") return;
			const themeChange = changes[THEME_MODE_KEY];
			if (themeChange) {
				setThemeState(themeChange.newValue === "dark" ? "dark" : "light");
			}
			const includeDocumentsCanvasChange =
				changes[INCLUDE_DOCUMENTS_CANVAS_KEY];
			if (!includeDocumentsCanvasChange) return;
			setIncludeDocumentsCanvasState(
				includeDocumentsCanvasChange.newValue !== false,
			);
		};
		browser.storage.onChanged.addListener(onChanged);
		return () => browser.storage.onChanged.removeListener(onChanged);
	}, []);

	React.useEffect(() => {
		let cancelled = false;
		const initializePosition = async () => {
			const saved = await getFloatingButtonPosition(props.positionScope).catch(
				() => null,
			);
			if (cancelled) return;
			const metrics = getButtonMetrics(buttonRef.current);
			const nextPosition = clampPosition(
				saved ?? buildDefaultPosition(viewport, metrics),
				viewport,
				metrics,
			);
			positionRef.current = nextPosition;
			setPosition(nextPosition);
			props.applyHostPosition(nextPosition);
			if (!saved || saved.x !== nextPosition.x || saved.y !== nextPosition.y) {
				void setFloatingButtonPosition(props.positionScope, nextPosition).catch(
					() => undefined,
				);
			}
		};
		void initializePosition();
		return () => {
			cancelled = true;
		};
	}, [props.applyHostPosition, props.positionScope]);

	React.useEffect(() => {
		const onResize = () => {
			const nextViewport = {
				width: window.innerWidth,
				height: window.innerHeight,
			};
			setViewport(nextViewport);
			const current = positionRef.current;
			if (!current) return;
			const metrics = getButtonMetrics(buttonRef.current);
			const nextPosition = clampPosition(current, nextViewport, metrics);
			positionRef.current = nextPosition;
			setPosition(nextPosition);
			props.applyHostPosition(nextPosition);
			if (nextPosition.x !== current.x || nextPosition.y !== current.y) {
				void setFloatingButtonPosition(props.positionScope, nextPosition).catch(
					() => undefined,
				);
			}
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [props]);

	React.useEffect(() => {
		if (!position) return;
		positionRef.current = position;
		props.applyHostPosition(position);
	}, [position, props]);

	React.useEffect(() => props.subscribeContext(setContext), [props]);

	React.useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!boxRef.current) return;
			const path =
				typeof event.composedPath === "function" ? event.composedPath() : [];
			if (path.includes(boxRef.current)) return;
			if (!boxRef.current.contains(event.target as Node | null)) {
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () =>
			document.removeEventListener("pointerdown", onPointerDown, true);
	}, [open]);

	const openSelectionModal = React.useCallback(
		(forcedFormat?: ExportFormat) => {
			setOpen(false);
			if (forcedFormat) {
				setFormat(forcedFormat);
				void setPreferredExportFormat(forcedFormat).catch(() => undefined);
			}
			setBusy(true);
			void props
				.getActiveConversation()
				.then((conversation) => {
					if (!conversation) return;
					const turns = deriveConversationTurns(conversation);
					if (turns.length === 0) return;
					const nextSignature = `${conversation.provider}:${conversation.id}:${conversation.messages.length}`;
					const shouldReset =
						selectionConversationSignatureRef.current !== nextSignature;

					setSelectionConversation(conversation);
					setSelectionVisible(true);
					if (shouldReset) {
						selectionConversationSignatureRef.current = nextSignature;
						selectionNavigationCacheRef.current = new Map();
						setSelectedTurnIds(new Set(turns.map((turn) => turn.id)));
						setExpandedTurnIds(new Set());
					}
				})
				.finally(() => setBusy(false));
		},
		[props],
	);

	React.useEffect(() => {
		props.registerApi?.({ openSelectionModal });
	}, [openSelectionModal, props]);

	const closeSelectionModal = React.useCallback(() => {
		if (busy) return;
		setSelectionVisible(false);
	}, [busy]);

	const toggleTurn = React.useCallback((turnId: string) => {
		setSelectedTurnIds((current) => {
			const next = new Set(current);
			if (next.has(turnId)) next.delete(turnId);
			else next.add(turnId);
			return next;
		});
	}, []);

	const toggleExpandedTurn = React.useCallback((turnId: string) => {
		setExpandedTurnIds((current) => {
			const next = new Set(current);
			if (next.has(turnId)) next.delete(turnId);
			else next.add(turnId);
			return next;
		});
	}, []);

	const selectionTurns = React.useMemo(
		() =>
			selectionConversation
				? deriveConversationTurns(selectionConversation)
				: [],
		[selectionConversation],
	);

	const confirmSelectionExport = React.useCallback(() => {
		if (!selectionConversation) return;
		const selectedMessageIds = selectionTurns
			.filter((turn) => selectedTurnIds.has(turn.id))
			.flatMap((turn) => turn.messageIds);
		if (selectedMessageIds.length === 0) return;

		setBusy(true);
		void props
			.onExportChat(format, includeDocumentsCanvas, selectedMessageIds)
			.then(() => {
				setSelectionVisible(false);
				setOpen(false);
			})
			.finally(() => setBusy(false));
	}, [
		format,
		includeDocumentsCanvas,
		props,
		selectedTurnIds,
		selectionConversation,
		selectionTurns,
	]);

	const handlePointerDown = React.useCallback(
		(event: React.PointerEvent<HTMLButtonElement>) => {
			if (event.button !== 0) return;
			const currentPosition =
				positionRef.current ??
				buildDefaultPosition(viewport, getButtonMetrics(buttonRef.current));
			dragStateRef.current = {
				pointerId: event.pointerId,
				startPointerX: event.clientX,
				startPointerY: event.clientY,
				startX: currentPosition.x,
				startY: currentPosition.y,
				dragging: false,
			};

			const onPointerMove = (moveEvent: PointerEvent) => {
				const dragState = dragStateRef.current;
				if (!dragState || moveEvent.pointerId !== dragState.pointerId) return;
				const dx = moveEvent.clientX - dragState.startPointerX;
				const dy = moveEvent.clientY - dragState.startPointerY;
				if (!dragState.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX)
					return;
				if (!dragState.dragging) {
					dragState.dragging = true;
					suppressClickRef.current = true;
					setOpen(false);
				}
				moveEvent.preventDefault();
				const nextPosition = clampPosition(
					{ x: dragState.startX + dx, y: dragState.startY + dy },
					viewport,
					getButtonMetrics(buttonRef.current),
				);
				positionRef.current = nextPosition;
				setPosition(nextPosition);
			};

			const finishDrag = (endEvent: PointerEvent) => {
				const dragState = dragStateRef.current;
				if (!dragState || endEvent.pointerId !== dragState.pointerId) return;
				window.removeEventListener("pointermove", onPointerMove, true);
				window.removeEventListener("pointerup", finishDrag, true);
				window.removeEventListener("pointercancel", finishDrag, true);
				dragStateRef.current = null;
				if (!dragState.dragging || !positionRef.current) return;
				void setFloatingButtonPosition(
					props.positionScope,
					positionRef.current,
				).catch(() => undefined);
			};

			window.addEventListener("pointermove", onPointerMove, true);
			window.addEventListener("pointerup", finishDrag, true);
			window.addEventListener("pointercancel", finishDrag, true);
		},
		[props.positionScope, viewport],
	);

	if (context.pageKind === "unsupported") return null;
	const showButton = context.showFloatingButton;
	const panelPlacement = getPanelPlacement(
		position,
		viewport,
		getButtonMetrics(buttonRef.current),
	);

	return (
		<div
			ref={boxRef}
			style={{
				position: "relative",
				fontFamily: "system-ui, sans-serif",
				color: theme.text,
			}}
		>
			{open && (
				<div
					style={{
						position: "absolute",
						width: PANEL_WIDTH_PX,
						background: theme.panelBackground,
						border: theme.panelBorder,
						borderRadius: 14,
						padding: 12,
						boxShadow: "none",
						...(panelPlacement.vertical === "below"
							? { top: `calc(100% + ${PANEL_GAP_PX}px)` }
							: { bottom: `calc(100% + ${PANEL_GAP_PX}px)` }),
						...(panelPlacement.horizontal === "start"
							? { left: 0 }
							: { right: 0 }),
					}}
				>
					<ActionPanel
						pageKind={context.pageKind}
						format={format}
						themeMode={themeMode}
						theme={theme}
						onFormatChange={(next) => {
							setFormat(next);
							void setPreferredExportFormat(next).catch(() => undefined);
						}}
						onToggleIncludeDocumentsCanvas={(next) => {
							setIncludeDocumentsCanvasState(next);
							void setIncludeDocumentsCanvas(next).catch(() => undefined);
						}}
						showFloatingButton={context.showFloatingButton}
						includeDocumentsCanvas={includeDocumentsCanvas}
						statusText={context.projectExportStatus ?? undefined}
						canSkipProjectExport={context.projectExportCanSkip === true}
						onSkipProjectExport={
							context.projectExportCanSkip
								? () => {
										setBusy(true);
										void props.onSkipProjectExport().finally(() => {
											setBusy(false);
											void refresh();
										});
									}
								: undefined
						}
						disabled={busy || context.waiting}
						onExport={() => {
							if (context.pageKind === "project") {
								setBusy(true);
								void props
									.onExportProject(format, includeDocumentsCanvas)
									.finally(() => {
										setBusy(false);
										void refresh();
									});
								return;
							}
							setBusy(true);
							void props
								.onExportChat(format, includeDocumentsCanvas)
								.finally(() => {
									setBusy(false);
									setOpen(false);
								});
						}}
						onSelectContentExport={
							context.pageKind === "chat" ? openSelectionModal : undefined
						}
						onClipboard={
							context.pageKind === "chat"
								? () => {
										setBusy(true);
										void props
											.onCopyChat(format, includeDocumentsCanvas)
											.finally(() => {
												setBusy(false);
												setOpen(false);
											});
									}
								: undefined
						}
					/>
				</div>
			)}

			{selectionConversation && selectionVisible && (
				<SelectExportModal
					format={format}
					title={selectionConversation.title}
					turns={selectionTurns}
					selectedTurnIds={selectedTurnIds}
					expandedTurnIds={expandedTurnIds}
					busy={busy}
					onClose={closeSelectionModal}
					onSelectAll={() =>
						setSelectedTurnIds(new Set(selectionTurns.map((turn) => turn.id)))
					}
					onSelectNone={() => setSelectedTurnIds(new Set())}
					onToggleTurn={toggleTurn}
					onToggleExpanded={toggleExpandedTurn}
					onConfirm={confirmSelectionExport}
				/>
			)}

			{showButton && (
				<button
					ref={buttonRef}
					type="button"
					onPointerDown={handlePointerDown}
					onClick={() => {
						if (suppressClickRef.current) {
							suppressClickRef.current = false;
							return;
						}
						const nextOpen = !open;
						setOpen(nextOpen);
						if (nextOpen) void refresh();
					}}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "10px 14px",
						borderRadius: 999,
						border: open
							? theme.floatingButtonOpenBorder
							: theme.floatingButtonBorder,
						boxSizing: "border-box",
						background: open
							? theme.floatingButtonOpenBackground
							: theme.floatingButtonBackground,
						color: open
							? theme.floatingButtonOpenText
							: theme.floatingButtonText,
						cursor: "grab",
						boxShadow: "none",
						userSelect: "none",
						WebkitUserSelect: "none",
						touchAction: "none",
					}}
					aria-label="Export"
					title="Drag to reposition or click to open export actions"
				>
					<LogoIcon size={18} />
					<span
						style={{
							fontWeight: 600,
							color: open
								? theme.floatingButtonOpenText
								: theme.floatingButtonText,
						}}
					>
						Export
					</span>
				</button>
			)}
		</div>
	);
}

function resolveFloatingPositionScope(): string {
	const host = window.location.hostname.toLowerCase();
	if (host.includes("claude.ai")) return "claude.ai";
	if (host.includes("chatgpt.com")) return "chatgpt.com";
	return host || "unknown";
}

function getButtonMetrics(button: HTMLButtonElement | null) {
	if (!button) return DEFAULT_BUTTON_SIZE;
	return {
		width: button.offsetWidth || DEFAULT_BUTTON_SIZE.width,
		height: button.offsetHeight || DEFAULT_BUTTON_SIZE.height,
	};
}

function buildDefaultPosition(
	viewport: { width: number; height: number },
	metrics: { width: number; height: number },
): FloatingButtonPosition {
	return clampPosition(
		{
			x: viewport.width - metrics.width - DEFAULT_OFFSET.right,
			y: viewport.height - metrics.height - DEFAULT_OFFSET.bottom,
		},
		viewport,
		metrics,
	);
}

function clampPosition(
	position: FloatingButtonPosition,
	viewport: { width: number; height: number },
	metrics: { width: number; height: number },
): FloatingButtonPosition {
	const maxX = Math.max(0, viewport.width - metrics.width - 8);
	const maxY = Math.max(0, viewport.height - metrics.height - 8);
	return {
		x: clampNumber(position.x, 8, maxX),
		y: clampNumber(position.y, 8, maxY),
	};
}

function clampNumber(value: number, min: number, max: number): number {
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

function getPanelPlacement(
	position: FloatingButtonPosition | null,
	viewport: { width: number; height: number },
	metrics: { width: number; height: number },
) {
	const current = position ?? buildDefaultPosition(viewport, metrics);
	const centerX = current.x + metrics.width / 2;
	const centerY = current.y + metrics.height / 2;
	return {
		vertical:
			centerY <= viewport.height / 2 ? ("below" as const) : ("above" as const),
		horizontal:
			centerX <= viewport.width / 2 ? ("start" as const) : ("end" as const),
	};
}
