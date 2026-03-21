import * as React from "react";
import type { ExportFormat } from "../../lib/types";
import { renderMarkdownFragment } from "../../lib/export-format";
import type { ConversationTurn } from "../../lib/chat-selection";

export interface SelectExportModalProps {
	format: ExportFormat;
	title: string;
	turns: ConversationTurn[];
	selectedTurnIds: Set<string>;
	expandedTurnIds: Set<string>;
	busy?: boolean;
	onClose: () => void;
	onSelectAll: () => void;
	onSelectNone: () => void;
	onToggleTurn: (turnId: string) => void;
	onToggleExpanded: (turnId: string) => void;
	onConfirm: () => void;
}

export function SelectExportModal(props: SelectExportModalProps) {
	const selectedCount = props.turns.filter((turn) =>
		props.selectedTurnIds.has(turn.id),
	).length;

	return (
		<div style={overlayStyle}>
			<style>{richDetailCss}</style>
			<div
				style={modalStyle}
				role="dialog"
				aria-modal="true"
				aria-label="Select content to export"
			>
				<div
					style={{
						display: "flex",
						alignItems: "flex-start",
						justifyContent: "space-between",
						gap: 12,
						marginBottom: 12,
					}}
				>
					<div style={{ minWidth: 0 }}>
						<div
							style={{
								fontSize: 18,
								fontWeight: 700,
								color: "#111",
								marginBottom: 4,
							}}
						>
							Select content to export
						</div>
						<div
							style={{
								fontSize: 12,
								color: "#4b5563",
								lineHeight: 1.45,
								overflowWrap: "anywhere",
							}}
						>
							Chat: {props.title}
						</div>
						<div
							style={{
								fontSize: 12,
								color: "#4b5563",
								lineHeight: 1.45,
								marginTop: 4,
							}}
						>
							Current format:{" "}
							<strong>{props.format === "html" ? "HTML" : "Markdown"}</strong>
						</div>
						<div
							style={{
								fontSize: 12,
								color: "#6b7280",
								lineHeight: 1.45,
								marginTop: 6,
							}}
						>
							Selections stay in this tab while the current page remains open.
						</div>
					</div>
					<button
						type="button"
						onClick={props.onClose}
						style={closeButtonStyle}
						aria-label="Close selection modal"
					>
						×
					</button>
				</div>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 8,
						marginBottom: 10,
					}}
				>
					<div style={{ fontSize: 12, color: "#4b5563" }}>
						{selectedCount} of {props.turns.length} turns selected
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						<SmallButton onClick={props.onSelectAll}>Select all</SmallButton>
						<SmallButton onClick={props.onSelectNone}>None</SmallButton>
					</div>
				</div>

				<div style={listStyle}>
					{props.turns.map((turn) => {
						const checked = props.selectedTurnIds.has(turn.id);
						const expanded = props.expandedTurnIds.has(turn.id);
						return (
							<div
								key={turn.id}
								role="button"
								tabIndex={0}
								onClick={() => props.onToggleTurn(turn.id)}
								onKeyDown={(event) => {
									if (event.key !== "Enter" && event.key !== " ") return;
									event.preventDefault();
									props.onToggleTurn(turn.id);
								}}
								style={{
									...turnCardStyle,
									borderColor: checked ? "#111827" : "rgba(15,23,42,0.12)",
									background: checked ? "rgba(17,24,39,0.03)" : "#fff",
								}}
							>
								<div
									style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
								>
									<input
										type="checkbox"
										checked={checked}
										onChange={() => props.onToggleTurn(turn.id)}
										onClick={(event) => event.stopPropagation()}
										style={{
											marginTop: 2,
											width: 16,
											height: 16,
											flex: "0 0 auto",
										}}
									/>
									<div style={{ minWidth: 0, flex: 1 }}>
										<div
											style={{
												fontSize: 12,
												fontWeight: 700,
												color: "#111",
												marginBottom: 6,
											}}
										>
											Turn {turn.index}
										</div>
										<PreviewBlock label="Prompt" text={turn.userPreview} />
										<PreviewBlock label="Answer" text={turn.assistantPreview} />
										<div style={rowActionsStyle}>
											<RowButton
												onClick={(event) => {
													event.stopPropagation();
													props.onToggleExpanded(turn.id);
												}}
											>
												{expanded ? "Hide details" : "Full details"}
											</RowButton>
										</div>
										{expanded ? <TurnDetails turn={turn} /> : null}
									</div>
								</div>
							</div>
						);
					})}
				</div>

				<div
					style={{
						display: "flex",
						justifyContent: "flex-end",
						gap: 8,
						marginTop: 12,
					}}
				>
					<FooterButton onClick={props.onClose} disabled={props.busy}>
						Close
					</FooterButton>
					<FooterButton
						onClick={props.onConfirm}
						disabled={props.busy || selectedCount === 0}
						primary
					>
						{props.busy ? "Exporting…" : "Export selected"}
					</FooterButton>
				</div>
			</div>
		</div>
	);
}

function TurnDetails(props: { turn: ConversationTurn }) {
	return (
		<div style={detailsWrapStyle}>
			<DetailBlock label="Prompt details" text={props.turn.userDetail} />
			<DetailBlock label="Answer details" text={props.turn.assistantDetail} />
		</div>
	);
}

function PreviewBlock(props: { label: string; text: string }) {
	return (
		<div style={{ marginBottom: 8 }}>
			<div
				style={{
					fontSize: 11,
					fontWeight: 700,
					color: "#4b5563",
					marginBottom: 3,
				}}
			>
				{props.label}
			</div>
			<div
				style={{
					fontSize: 12,
					color: "#111",
					lineHeight: 1.45,
					whiteSpace: "normal",
					overflowWrap: "anywhere",
					wordBreak: "break-word",
				}}
			>
				{props.text}
			</div>
		</div>
	);
}

function DetailBlock(props: { label: string; text: string }) {
	const html = React.useMemo(
		() => renderMarkdownFragment(props.text || "").replace(/>\s+</g, "><"),
		[props.text],
	);

	return (
		<div style={{ marginTop: 10 }}>
			<div
				style={{
					fontSize: 11,
					fontWeight: 700,
					color: "#4b5563",
					marginBottom: 4,
				}}
			>
				{props.label}
			</div>
			<div style={detailTextStyle}>
				<div
					className="select-export-modal-rich"
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			</div>
		</div>
	);
}

function SmallButton(props: {
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={props.onClick}
			style={{
				padding: "6px 10px",
				borderRadius: 8,
				border: "1px solid rgba(15,23,42,0.14)",
				background: "#fff",
				color: "#111",
				cursor: "pointer",
				fontSize: 12,
			}}
		>
			{props.children}
		</button>
	);
}

function RowButton(props: {
	onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	children: React.ReactNode;
}) {
	return (
		<button type="button" onClick={props.onClick} style={rowButtonStyle}>
			{props.children}
		</button>
	);
}

function FooterButton(props: {
	onClick: () => void;
	children: React.ReactNode;
	primary?: boolean;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			disabled={props.disabled}
			onClick={props.onClick}
			style={{
				padding: "9px 14px",
				borderRadius: 10,
				border: props.primary
					? "1px solid #111827"
					: "1px solid rgba(15,23,42,0.14)",
				background: props.primary ? "#111827" : "#fff",
				color: props.primary ? "#fff" : "#111",
				cursor: props.disabled ? "not-allowed" : "pointer",
				opacity: props.disabled ? 0.6 : 1,
			}}
		>
			{props.children}
		</button>
	);
}

const overlayStyle: React.CSSProperties = {
	position: "fixed",
	inset: 0,
	background: "rgba(15,23,42,0.28)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: 14,
};

const modalStyle: React.CSSProperties = {
	width: 768,
	maxWidth: "100%",
	maxHeight: "min(92vh, 760px)",
	overflow: "hidden",
	borderRadius: 18,
	border: "1px solid rgba(15,23,42,0.12)",
	background: "#fff",
	padding: 16,
	boxShadow: "0 20px 50px rgba(0,0,0,0.28)",
	display: "flex",
	flexDirection: "column",
};

const listStyle: React.CSSProperties = {
	overflow: "auto",
	paddingRight: 4,
	display: "flex",
	flexDirection: "column",
	gap: 10,
};

const turnCardStyle: React.CSSProperties = {
	border: "1px solid rgba(15,23,42,0.12)",
	borderRadius: 12,
	padding: 12,
	cursor: "pointer",
	boxSizing: "border-box",
};

const closeButtonStyle: React.CSSProperties = {
	width: 32,
	height: 32,
	borderRadius: 999,
	border: "1px solid rgba(15,23,42,0.12)",
	background: "#fff",
	color: "#111",
	fontSize: 20,
	lineHeight: 1,
	cursor: "pointer",
	flex: "0 0 auto",
};

const rowActionsStyle: React.CSSProperties = {
	display: "flex",
	flexWrap: "wrap",
	gap: 8,
	marginTop: 10,
};

const rowButtonStyle: React.CSSProperties = {
	padding: "6px 10px",
	borderRadius: 8,
	border: "1px solid rgba(15,23,42,0.14)",
	background: "#fff",
	color: "#111",
	cursor: "pointer",
	fontSize: 12,
};

const detailsWrapStyle: React.CSSProperties = {
	marginTop: 10,
	padding: 10,
	borderRadius: 10,
	background: "rgba(15,23,42,0.035)",
	border: "1px solid rgba(15,23,42,0.08)",
};

const detailTextStyle: React.CSSProperties = {
	fontSize: 12,
	color: "#111",
	lineHeight: 1.5,
	whiteSpace: "normal",
	overflowWrap: "anywhere",
	wordBreak: "break-word",
	maxHeight: 220,
	overflow: "auto",
	padding: "8px 10px",
	borderRadius: 8,
	background: "#fff",
	border: "1px solid rgba(15,23,42,0.08)",
};

const _noticeStyle: React.CSSProperties = {
	fontSize: 12,
	color: "#92400e",
	background: "#fffbeb",
	border: "1px solid #fcd34d",
	borderRadius: 10,
	padding: "8px 10px",
	marginBottom: 10,
	lineHeight: 1.45,
};
const richDetailCss = `
.select-export-modal-rich {
	white-space: normal;
}
.select-export-modal-rich > :first-child {
	margin-top: 0 !important;
}
.select-export-modal-rich > :last-child {
	margin-bottom: 0 !important;
}
.select-export-modal-rich p,
.select-export-modal-rich ul,
.select-export-modal-rich ol,
.select-export-modal-rich blockquote,
.select-export-modal-rich pre {
	margin: 0 0 0.6em 0;
}
.select-export-modal-rich ul,
.select-export-modal-rich ol {
	padding-left: 1.25em;
}
.select-export-modal-rich li + li {
	margin-top: 0.2em;
}
.select-export-modal-rich h1,
.select-export-modal-rich h2,
.select-export-modal-rich h3,
.select-export-modal-rich h4,
.select-export-modal-rich h5,
.select-export-modal-rich h6 {
	margin: 0 0 0.45em 0;
	line-height: 1.35;
}
.select-export-modal-rich pre {
	white-space: pre-wrap;
	overflow-x: auto;
	padding: 8px 10px;
	border-radius: 8px;
	background: rgba(15, 23, 42, 0.04);
}
.select-export-modal-rich code {
	overflow-wrap: anywhere;
}
.select-export-modal-rich hr {
	margin: 0.75em 0;
	border: 0;
	border-top: 1px solid rgba(15, 23, 42, 0.1);
}
`;
