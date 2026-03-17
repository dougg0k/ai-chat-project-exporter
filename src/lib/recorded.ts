export function parseJsonText(text: string): any | null {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

export function unwrapRecordedOrDirectJson(text: string): any | null {
	const direct = parseJsonText(text);
	if (!direct) return null;

	if (
		typeof direct === "object" &&
		direct?.content &&
		typeof direct.content === "object" &&
		direct.content.mimeType === "application/json" &&
		typeof direct.content.text === "string"
	) {
		return parseJsonText(direct.content.text);
	}

	return direct;
}
