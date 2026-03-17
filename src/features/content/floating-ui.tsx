import React from "react";
import ReactDOM from "react-dom/client";
import { ActionPanel } from "../shared/action-panel";
import { SelectExportModal } from "../shared/select-export-modal";
import { LogoIcon } from "../../lib/logo";
import { deriveConversationTurns } from "../../lib/chat-selection";
import {
	getFloatingButtonPosition,
	getPreferredExportFormat,
	setFloatingButtonPosition,
	setPreferredExportFormat,
} from "../../lib/storage";
import type { FloatingButtonPosition } from "../../lib/storage";
import type { Conversation, ExportFormat, UiContext } from "../../lib/types";

const DEFAULT_OFFSET = { right: 28, bottom: 22 } as const;
const DEFAULT_BUTTON_SIZE = { width: 114, height: 42 } as const;
const DRAG_THRESHOLD_PX = 5;
const PANEL_GAP_PX = 10;
const PANEL_WIDTH_PX = 332;
const ACTIVE_ACCENT = "#1f2937";
const ACTIVE_BORDER_PX = 2;

export function mountFloatingUi(options: {
	getContext: () => Promise<UiContext>;
	getActiveConversation: () => Promise<Conversation | null>;
	onExportChat: (
		format: ExportFormat,
		selectedMessageIds?: string[],
	) => Promise<void>;
	onCopyChat: (
		format: ExportFormat,
		selectedMessageIds?: string[],
	) => Promise<void>;
	onExportProject: (format: ExportFormat) => Promise<void>;
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
			}}
		/>,
	);

	return {
		unmount: () => {
			root.unmount();
			host.remove();
		},
		openSelectionModal: (format?: ExportFormat) => {
			api?.openSelectionModal(format);
		},
	};
}

function FloatingApp(props: {
	registerApi?: (api: {
		openSelectionModal: (format?: ExportFormat) => void;
	}) => void;
	getContext: () => Promise<UiContext>;
	getActiveConversation: () => Promise<Conversation | null>;
	onExportChat: (
		format: ExportFormat,
		selectedMessageIds?: string[],
	) => Promise<void>;
	onCopyChat: (
		format: ExportFormat,
		selectedMessageIds?: string[],
	) => Promise<void>;
	onExportProject: (format: ExportFormat) => Promise<void>;
	applyHostPosition: (position: FloatingButtonPosition) => void;
	positionScope: string;
}) {
	const [open, setOpen] = React.useState(false);
	const [format, setFormat] = React.useState<ExportFormat>("markdown");
	const [busy, setBusy] = React.useState(false);
	const [selectionConversation, setSelectionConversation] =
		React.useState<Conversation | null>(null);
	const [selectedTurnIds, setSelectedTurnIds] = React.useState<Set<string>>(
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

	const refresh = React.useCallback(async () => {
		const next = await props.getContext();
		setContext(next);
	}, [props]);

	React.useEffect(() => {
		void refresh();
		void getPreferredExportFormat()
			.then(setFormat)
			.catch(() => undefined);
	}, [refresh]);

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

	React.useEffect(() => {
		const id = window.setInterval(
			() => {
				void refresh();
			},
			open ? 700 : 1200,
		);
		return () => window.clearInterval(id);
	}, [open, refresh]);

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
					setSelectionConversation(conversation);
					setSelectedTurnIds(new Set(turns.map((turn) => turn.id)));
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
		setSelectionConversation(null);
		setSelectedTurnIds(new Set());
	}, [busy]);

	const toggleTurn = React.useCallback((turnId: string) => {
		setSelectedTurnIds((current) => {
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
			.onExportChat(format, selectedMessageIds)
			.then(() => {
				setSelectionConversation(null);
				setSelectedTurnIds(new Set());
				setOpen(false);
			})
			.finally(() => setBusy(false));
	}, [format, props, selectedTurnIds, selectionConversation, selectionTurns]);

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
			style={{ position: "relative", fontFamily: "system-ui, sans-serif" }}
		>
			{open && (
				<div
					style={{
						position: "absolute",
						width: PANEL_WIDTH_PX,
						background: "#fff",
						border: "1px solid rgba(15,23,42,0.12)",
						borderRadius: 14,
						padding: 12,
						boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
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
						onFormatChange={(next) => {
							setFormat(next);
							void setPreferredExportFormat(next).catch(() => undefined);
						}}
						showFloatingButton={context.showFloatingButton}
						statusText={context.projectExportStatus ?? undefined}
						disabled={busy}
						onExport={() => {
							if (context.pageKind === "project") {
								setBusy(true);
								void props.onExportProject(format).finally(() => {
									setBusy(false);
									void refresh();
								});
								return;
							}
							setBusy(true);
							void props.onExportChat(format).finally(() => {
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
										void props.onCopyChat(format).finally(() => {
											setBusy(false);
											setOpen(false);
										});
									}
								: undefined
						}
					/>
				</div>
			)}

			{selectionConversation && (
				<SelectExportModal
					format={format}
					title={selectionConversation.title}
					turns={selectionTurns}
					selectedTurnIds={selectedTurnIds}
					busy={busy}
					onClose={closeSelectionModal}
					onSelectAll={() =>
						setSelectedTurnIds(new Set(selectionTurns.map((turn) => turn.id)))
					}
					onSelectNone={() => setSelectedTurnIds(new Set())}
					onToggleTurn={toggleTurn}
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
							? `${ACTIVE_BORDER_PX}px solid ${ACTIVE_ACCENT}`
							: "1px solid rgba(15,23,42,0.14)",
						boxSizing: "border-box",
						background: open ? ACTIVE_ACCENT : "#fff",
						color: open ? "#fff" : ACTIVE_ACCENT,
						cursor: "grab",
						boxShadow: "0 8px 22px rgba(0,0,0,0.22)",
						userSelect: "none",
						WebkitUserSelect: "none",
						touchAction: "none",
					}}
					aria-label="Export"
					title="Drag to reposition or click to open export actions"
				>
					<LogoIcon size={18} />
					<span
						style={{ fontWeight: 600, color: open ? "#fff" : ACTIVE_ACCENT }}
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
