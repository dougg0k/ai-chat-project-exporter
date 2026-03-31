export const APP_SOURCE = "ai-chat-project-exporter";
export const FLOATING_VISIBILITY_KEY = "showFloatingExportButton";
export const FLOATING_POSITIONS_KEY = "floatingExportButtonPositions";
export const EXPORT_FORMAT_KEY = "preferredExportFormat";
export const DEFAULT_EXPORT_FORMAT = "markdown";
export const THEME_MODE_KEY = "themeMode";
export const CLAUDE_ORG_ID_KEY = "lastClaudeOrgId";
export const PROVIDERS_URI_PATTERNS = [
	"chatgpt.com/backend-api/conversation/",
	"chatgpt.com/backend-api/gizmos/",
	"chat_conversations/",
	"conversations_v2/",
] as const;
export const CONTENT_MATCHES = [
	"https://chatgpt.com/*",
	"https://claude.ai/*",
] as const;
