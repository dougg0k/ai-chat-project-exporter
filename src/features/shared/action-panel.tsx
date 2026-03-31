import type React from "react";
import { LogoIcon } from "../../lib/Logo";
import type { UiTheme } from "../../lib/theme";
import type { ExportFormat, PageKind, ThemeMode } from "../../lib/types";

export interface ActionPanelProps {
	pageKind: PageKind;
	format: ExportFormat;
	themeMode?: ThemeMode;
	theme: UiTheme;
	onFormatChange: (format: ExportFormat) => void;
	onExport: () => void;
	onSelectContentExport?: () => void;
	onClipboard?: () => void;
	onToggleFloating?: (value: boolean) => void;
	onToggleTheme?: (value: ThemeMode) => void;
	onSkipProjectExport?: () => void;
	showFloatingButton?: boolean;
	disabled?: boolean;
	compact?: boolean;
	statusText?: string;
	canSkipProjectExport?: boolean;
}

export function ActionPanel(props: ActionPanelProps) {
	const isChat = props.pageKind === "chat";
	const isProject = props.pageKind === "project";
	const supported = isChat || isProject;

	return (
		<div
			style={{ fontFamily: "system-ui, sans-serif", color: props.theme.text }}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					marginBottom: 14,
				}}
			>
				<LogoIcon size={20} />
				<div
					style={{
						fontSize: 14,
						fontWeight: 700,
						letterSpacing: "-0.01em",
					}}
				>
					AI Chat / Project Exporter
				</div>
			</div>

			<div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
				<FormatButton
					active={props.format === "markdown"}
					onClick={() => props.onFormatChange("markdown")}
					theme={props.theme}
				>
					Markdown
				</FormatButton>
				<FormatButton
					active={props.format === "html"}
					onClick={() => props.onFormatChange("html")}
					theme={props.theme}
				>
					HTML
				</FormatButton>
			</div>

			{!supported && (
				<InfoText theme={props.theme}>
					Open a supported chat or project page.
				</InfoText>
			)}

			{supported && (
				<div
					style={{
						display: "flex",
						gap: 8,
						marginBottom: 14,
						flexWrap: "wrap",
					}}
				>
					<ActionButton
						onClick={props.onExport}
						disabled={props.disabled}
						theme={props.theme}
					>
						Export
					</ActionButton>
					{isChat && props.onSelectContentExport && (
						<ActionButton
							onClick={props.onSelectContentExport}
							disabled={props.disabled}
							theme={props.theme}
						>
							Select content
						</ActionButton>
					)}
					{isChat && props.onClipboard && (
						<ActionButton
							onClick={props.onClipboard}
							disabled={props.disabled}
							theme={props.theme}
						>
							Clipboard
						</ActionButton>
					)}
				</div>
			)}

			{props.statusText && (
				<StatusText text={props.statusText} theme={props.theme} />
			)}
			{props.canSkipProjectExport && props.onSkipProjectExport && (
				<div style={{ marginBottom: 12 }}>
					<ActionButton onClick={props.onSkipProjectExport} theme={props.theme}>
						Skip failed chat
					</ActionButton>
				</div>
			)}

			{(props.onToggleFloating || props.onToggleTheme) && (
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					{props.onToggleFloating && (
						<ToggleRow theme={props.theme}>
							<input
								type="checkbox"
								checked={props.showFloatingButton !== false}
								onChange={(e) => props.onToggleFloating?.(e.target.checked)}
								style={{ accentColor: props.theme.accent }}
							/>
							<span>Show floating export button</span>
						</ToggleRow>
					)}
					{props.onToggleTheme && (
						<ToggleRow theme={props.theme}>
							<input
								type="checkbox"
								checked={props.themeMode === "dark"}
								onChange={(e) =>
									props.onToggleTheme?.(e.target.checked ? "dark" : "light")
								}
								style={{ accentColor: props.theme.accent }}
							/>
							<span>Dark theme</span>
						</ToggleRow>
					)}
				</div>
			)}
		</div>
	);
}

function FormatButton(props: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
	theme: UiTheme;
}) {
	return (
		<button
			type="button"
			onClick={props.onClick}
			style={{
				padding: "8px 12px",
				minHeight: 36,
				minWidth: 104,
				borderRadius: 11,
				border: props.theme.buttonBorder,
				background: props.active
					? props.theme.buttonActiveBackground
					: props.theme.buttonBackground,
				color: props.active
					? props.theme.buttonActiveText
					: props.theme.buttonText,
				cursor: "pointer",
				fontWeight: 600,
				fontSize: 13,
				letterSpacing: "-0.01em",
			}}
		>
			{props.children}
		</button>
	);
}

function ActionButton(props: {
	onClick: () => void;
	children: React.ReactNode;
	disabled?: boolean;
	theme: UiTheme;
}) {
	return (
		<button
			type="button"
			disabled={props.disabled}
			onClick={props.onClick}
			style={{
				padding: "9px 14px",
				minHeight: 38,
				borderRadius: 11,
				border: props.theme.buttonBorder,
				background: props.theme.buttonBackground,
				color: props.theme.buttonText,
				cursor: props.disabled ? "not-allowed" : "pointer",
				opacity: props.disabled ? 0.6 : 1,
				fontWeight: 600,
				fontSize: 13,
				letterSpacing: "-0.01em",
			}}
		>
			{props.children}
		</button>
	);
}

function ToggleRow(props: { children: React.ReactNode; theme: UiTheme }) {
	return (
		<label
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "9px 10px",
				borderRadius: 11,
				fontSize: 13,
				border: props.theme.buttonBorder,
				background: props.theme.buttonBackground,
				lineHeight: 1.35,
			}}
		>
			{props.children}
		</label>
	);
}

function InfoText(props: { children: React.ReactNode; theme: UiTheme }) {
	return (
		<div
			style={{
				marginBottom: 12,
				fontSize: 12.5,
				lineHeight: 1.45,
				color: props.theme.mutedText,
			}}
		>
			{props.children}
		</div>
	);
}

function StatusText(props: { text: string; theme: UiTheme }) {
	const [label, ...rest] = props.text.split(":");
	if (rest.length === 0)
		return <InfoText theme={props.theme}>{props.text}</InfoText>;
	return (
		<div
			style={{
				marginBottom: 12,
				fontSize: 12.5,
				lineHeight: 1.45,
				color: props.theme.mutedText,
			}}
		>
			<strong>{label}:</strong> {rest.join(":").trim()}
		</div>
	);
}
