import type { ProjectChatRef, ProjectListing } from "./types";

function isBetterProjectName(name: string | undefined): boolean {
	return Boolean(name && !/^Project-[A-Za-z0-9-]+$/.test(name));
}

function mergeChatRef(
	existing: ProjectChatRef,
	incoming: ProjectChatRef,
): ProjectChatRef {
	return {
		...existing,
		title:
			typeof incoming.title === "string" && incoming.title.trim()
				? incoming.title
				: existing.title,
		createdAt: existing.createdAt ?? incoming.createdAt,
		updatedAt: incoming.updatedAt ?? existing.updatedAt,
	};
}

export function mergeProjectListings(
	existing: ProjectListing | null,
	incoming: ProjectListing | null,
): ProjectListing | null {
	if (!incoming) return existing;
	if (!existing) return incoming;
	if (
		existing.provider !== incoming.provider ||
		existing.projectId !== incoming.projectId
	) {
		return incoming;
	}

	const mergedChats: ProjectChatRef[] = [];
	const byId = new Map<string, ProjectChatRef>();

	for (const chat of existing.chats) {
		const normalized = { ...chat, order: mergedChats.length };
		mergedChats.push(normalized);
		byId.set(chat.id, normalized);
	}

	for (const chat of incoming.chats) {
		const current = byId.get(chat.id);
		if (current) {
			const merged = mergeChatRef(current, chat);
			const index = mergedChats.findIndex((item) => item.id === chat.id);
			if (index >= 0) mergedChats[index] = { ...merged, order: index };
			byId.set(chat.id, mergedChats[index]);
			continue;
		}
		const normalized = { ...chat, order: mergedChats.length };
		mergedChats.push(normalized);
		byId.set(chat.id, normalized);
	}

	return {
		...existing,
		...incoming,
		projectName: isBetterProjectName(incoming.projectName)
			? incoming.projectName
			: existing.projectName,
		nextCursor:
			incoming.nextCursor !== undefined
				? incoming.nextCursor
				: existing.nextCursor,
		fetchContext: incoming.fetchContext ?? existing.fetchContext,
		chats: mergedChats,
	};
}

export function buildChatGptProjectListingUrl(
	projectId: string,
	cursor: string,
): string {
	const encodedCursor =
		cursor === "0" ? cursor : encodeURIComponent(cursor);
	return `https://chatgpt.com/backend-api/gizmos/${projectId}/conversations?cursor=${encodedCursor}`;
}

export function projectListingSignature(
	project: ProjectListing | null | undefined,
): string {
	if (!project) return "";
	return [
		project.provider,
		project.projectId,
		String(project.nextCursor ?? "null"),
		...project.chats.map((chat) => `${chat.id}:${chat.title}`),
	].join("|");
}

export function sortChatGptProjectListingUrls(urls: string[]): string[] {
	const withCursor = urls.map((url) => {
		try {
			const parsed = new URL(url);
			const raw = parsed.searchParams.get("cursor") ?? "";
			const numeric = /^\d+$/.test(raw)
				? Number(raw)
				: Number.POSITIVE_INFINITY;
			return { url, numeric };
		} catch {
			return { url, numeric: Number.POSITIVE_INFINITY };
		}
	});
	return withCursor
		.sort((a, b) => a.numeric - b.numeric)
		.map((entry) => entry.url);
}
