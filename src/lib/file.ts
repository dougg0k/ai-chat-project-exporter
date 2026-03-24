import type { ProviderName } from "./types";

export function safeFilenamePart(value: string): string {
	return value
		.replace(/[/:*?"<>|]+/g, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 120)
		.toLowerCase();
}

export function buildConversationFilename(
	title: string,
	provider: string,
	ext: string,
	now: Date,
): string {
	return `${safeFilenamePart(title)}_${provider}_chat-export_${buildDateTime(now)}.${ext}`.toLowerCase();
}

export function buildProjectZipFilename(
	projectName: string,
	format: "markdown" | "html",
	now: Date,
	provider: ProviderName,
): string {
	const suffix = format === "html" ? "_html" : "_md";
	return `${safeFilenamePart(projectName)}_${provider}_${buildDateTime(now)}${suffix}.zip`.toLowerCase();
}

export function buildDateTime(now = new Date()) {
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const mi = String(now.getMinutes()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}_${hh}-${mi}`;
}

export function saveTextAsFile(
	text: string,
	filename: string,
	mimeType: string,
): void {
	saveBlobAsFile(new Blob([text], { type: mimeType }), filename);
}

export function saveBlobAsFile(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.style.display = "none";
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function copyText(text: string): Promise<void> {
	await navigator.clipboard.writeText(text);
}
