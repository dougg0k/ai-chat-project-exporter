import { defineConfig } from "wxt";

export default defineConfig({
	vite: () => ({
		build: { sourcemap: true },
	}),
	srcDir: "src",
	modules: ["@wxt-dev/module-react", "@wxt-dev/auto-icons"],
	manifest: {
		name: "AI Chat / Project Exporter",
		description: "Local-first exporter for ChatGPT and Claude chats/projects.",
		permissions: ["storage", "tabs"],
		host_permissions: ["https://chatgpt.com/*", "https://claude.ai/*"],
		browser_specific_settings: {
			gecko: {
				id: "ai-chat-project-exporter@dougg0k",
				// @ts-expect-error - missing in current WXT typings
				data_collection_permissions: {
					required: ["none"],
				},
			},
		},
		web_accessible_resources: [
			{
				resources: ["/injected.js"],
				matches: ["https://chatgpt.com/*", "https://claude.ai/*"],
			},
		],
	},
});
