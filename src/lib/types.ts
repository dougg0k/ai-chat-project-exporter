export type ProviderName = "chatgpt" | "claude";
export type ExportFormat = "markdown" | "html";
export type PageKind = "chat" | "project" | "unknown" | "unsupported";

export interface GeneratedDocument {
	id: string;
	title: string;
	filename: string;
	path: string;
	relativeOutputPath?: string;
	markdown: string;
	mimeType?: string;
	createdAt?: string;
}

export interface Message {
	id: string;
	role: "user" | "assistant";
	markdown: string;
	createdAt?: string;
}

export interface Conversation {
	id: string;
	provider: ProviderName;
	title: string;
	sourceUrl: string;
	exportedAt: string;
	messages: Message[];
	generatedDocuments?: GeneratedDocument[];
	appendixMarkdown?: string;
}

export interface ProjectChatRef {
	id: string;
	title: string;
	order: number;
	createdAt?: string;
	updatedAt?: string;
}

export interface ProjectListing {
	provider: ProviderName;
	projectId: string;
	projectName: string;
	chats: ProjectChatRef[];
	fetchContext?: { orgId?: string };
}

export interface UiContext {
	provider: ProviderName | null;
	pageKind: PageKind;
	hasConversation: boolean;
	hasProject: boolean;
	waiting: boolean;
	title?: string;
	projectName?: string;
	showFloatingButton: boolean;
	projectExportStatus?: string | null;
}

export interface RawCaptureMessage {
	type: "RAW_CAPTURE";
	url: string;
	text: string;
}

export interface RunPageFetchMessage {
	type: "RUN_PAGE_FETCH";
	requestId: string;
	url: string;
}

export interface PageFetchResultMessage {
	type: "PAGE_FETCH_RESULT";
	requestId: string;
	url: string;
	ok: boolean;
	status: number;
	text: string;
}

export interface GetUiContextMessage {
	type: "GET_UI_CONTEXT";
}

export interface SetFloatingVisibilityMessage {
	type: "SET_FLOATING_VISIBILITY";
	value: boolean;
}

export interface ExportChatMessage {
	type: "EXPORT_CHAT";
	format: ExportFormat;
	target: "file" | "clipboard";
	selectedMessageIds?: string[];
}

export interface ExportProjectMessage {
	type: "EXPORT_PROJECT";
	format: ExportFormat;
}

export interface GetRenderedChatMessage {
	type: "GET_RENDERED_CHAT";
	format: ExportFormat;
	selectedMessageIds?: string[];
}

export interface GetActiveConversationDataMessage {
	type: "GET_ACTIVE_CONVERSATION_DATA";
	allowNetworkFallback?: boolean;
}

export interface GetActiveProjectDataMessage {
	type: "GET_ACTIVE_PROJECT_DATA";
	allowNetworkFallback?: boolean;
}

export interface OpenSelectExportModalMessage {
	type: "OPEN_SELECT_EXPORT_MODAL";
	format?: ExportFormat;
}

export interface CollectProjectListingMessage {
	type: "COLLECT_PROJECT_LISTING";
	currentProjectPageUrl: string;
}

export interface CollectProjectConversationsMessage {
	type: "COLLECT_PROJECT_CONVERSATIONS";
	project: ProjectListing;
	currentProjectPageUrl: string;
}

export interface ProjectExportProgressMessage {
	type: "PROJECT_EXPORT_PROGRESS";
	status: string | null;
}

export type RuntimeMessage =
	| RawCaptureMessage
	| RunPageFetchMessage
	| PageFetchResultMessage
	| GetUiContextMessage
	| SetFloatingVisibilityMessage
	| ExportChatMessage
	| ExportProjectMessage
	| GetRenderedChatMessage
	| GetActiveConversationDataMessage
	| GetActiveProjectDataMessage
	| OpenSelectExportModalMessage
	| CollectProjectListingMessage
	| CollectProjectConversationsMessage
	| ProjectExportProgressMessage;
