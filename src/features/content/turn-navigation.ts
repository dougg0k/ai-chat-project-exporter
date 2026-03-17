import type { ConversationTurn } from "../../lib/chat-selection";
import type { ProviderName } from "../../lib/types";

const HIGHLIGHT_STYLE = {
	outline: "3px solid rgba(31, 41, 55, 0.6)",
	outlineOffset: "4px",
	transition: "outline-color 220ms ease",
} as const;

type CandidateRecord = {
	element: HTMLElement;
	normalizedText: string;
};

export function navigateToConversationTurn(options: {
	provider: ProviderName;
	turn: ConversationTurn;
	cache: Map<string, HTMLElement>;
}): boolean {
	const cached = options.cache.get(options.turn.id);
	if (cached?.isConnected) {
		scrollAndHighlight(cached);
		return true;
	}

	const target = findTurnElement(options.provider, options.turn);
	if (!target) return false;
	options.cache.set(options.turn.id, target);
	scrollAndHighlight(target);
	return true;
}

function findTurnElement(
	provider: ProviderName,
	turn: ConversationTurn,
): HTMLElement | null {
	const root =
		document.querySelector<HTMLElement>("main") ??
		document.querySelector<HTMLElement>("[role='main']");
	if (!root) return null;

	if (provider === "claude") {
		const claudeTarget = findClaudeTurnElement(root, turn);
		if (claudeTarget) return claudeTarget;
	}

	const snippets = turn.searchSnippets
		.map(normalizeText)
		.filter((value) => value.length >= 18)
		.sort((a, b) => b.length - a.length);
	if (snippets.length === 0) return null;

	const candidates = collectCandidates(root, provider);
	for (const snippet of snippets) {
		const match = candidates.find((candidate) =>
			candidate.normalizedText.includes(snippet),
		);
		if (match) return match.element;
	}

	for (const snippet of snippets) {
		const match = candidates.find((candidate) =>
			overlapsStrongly(candidate.normalizedText, snippet),
		);
		if (match) return match.element;
	}

	return null;
}

function findClaudeTurnElement(
	root: HTMLElement,
	turn: ConversationTurn,
): HTMLElement | null {
	const userAnchors = buildClaudeUserAnchors(turn);
	const snippetAnchors = Array.from(
		new Set([
			...userAnchors,
			...turn.searchSnippets
				.map(normalizeText)
				.filter((value) => value.length >= 12),
		]),
	).sort((a, b) => b.length - a.length);

	const userMessageCandidates = collectClaudeUserMessageCandidates(root);
	const bestUserMessage = findBestTextMatch({
		anchors: userAnchors.length > 0 ? userAnchors : snippetAnchors,
		candidates: userMessageCandidates,
		allowBestEffort: true,
		mapElement: resolveClaudeNavigationTarget,
	});
	if (bestUserMessage) return bestUserMessage;

	const paragraphCandidates = collectClaudeParagraphCandidates(root);
	const bestParagraph = findBestTextMatch({
		anchors: userAnchors.length > 0 ? userAnchors : snippetAnchors,
		candidates: paragraphCandidates,
		allowBestEffort: true,
		mapElement: resolveClaudeNavigationTarget,
	});
	if (bestParagraph) return bestParagraph;

	const genericCandidates = collectCandidates(root, "claude");
	const bestGeneric = findBestTextMatch({
		anchors: snippetAnchors,
		candidates: genericCandidates,
		minimumScore: 0.28,
	});
	if (bestGeneric) return bestGeneric;

	return null;
}

function buildClaudeUserAnchors(turn: ConversationTurn): string[] {
	const primaryParts = turn.userDetail
		.split(/\n\n────────\n\n/g)
		.map((part) => normalizeText(part))
		.filter((value) => value.length >= 12);

	const preview = normalizeText(
		turn.userPreview.replace(/\s*\(\+\d+ more message[s]?\)\s*$/i, ""),
	);
	const snippets = turn.searchSnippets
		.map(normalizeText)
		.filter((value) => value.length >= 12);

	return Array.from(new Set([...primaryParts, preview, ...snippets])).sort(
		(a, b) => b.length - a.length,
	);
}

function collectClaudeUserMessageCandidates(
	root: HTMLElement,
): CandidateRecord[] {
	const selectorList = [
		"[data-testid='user-message']",
		"[data-testid='user-message'] p.whitespace-pre-wrap.break-words",
		"[data-testid='user-message'] p",
		"[data-testid='user-message'] *",
	];

	const seen = new Set<HTMLElement>();
	const records: CandidateRecord[] = [];
	for (const selector of selectorList) {
		for (const rawElement of Array.from(
			root.querySelectorAll<HTMLElement>(selector),
		)) {
			const element =
				rawElement.closest<HTMLElement>("[data-testid='user-message']") ??
				rawElement;
			if (seen.has(element) || !isVisible(element)) continue;
			const text = normalizeText(
				element.innerText || element.textContent || "",
			);
			if (text.length < 8) continue;
			seen.add(element);
			records.push({ element, normalizedText: text });
		}
	}

	return sortCandidateRecords(records);
}

function collectClaudeParagraphCandidates(
	root: HTMLElement,
): CandidateRecord[] {
	const selectorList = [
		"main [data-testid='user-message'] p",
		"main p.whitespace-pre-wrap.break-words",
		"main p",
	];

	const seen = new Set<HTMLElement>();
	const records: CandidateRecord[] = [];
	for (const selector of selectorList) {
		for (const element of Array.from(
			root.querySelectorAll<HTMLElement>(selector),
		)) {
			if (seen.has(element) || !isVisible(element)) continue;
			const text = normalizeText(
				element.innerText || element.textContent || "",
			);
			if (text.length < 8) continue;
			seen.add(element);
			records.push({ element, normalizedText: text });
		}
	}

	return sortCandidateRecords(records);
}

function resolveClaudeNavigationTarget(element: HTMLElement): HTMLElement {
	const userMessage =
		element.closest<HTMLElement>("[data-testid='user-message']") ?? element;
	const bubble = userMessage.closest<HTMLElement>(
		"div.group.relative.inline-flex, [class*='inline-flex'][class*='break-words'], article, section, li, [data-testid*='message']",
	);
	return bubble ?? userMessage;
}

function collectCandidates(
	root: HTMLElement,
	provider: ProviderName,
): CandidateRecord[] {
	const selectorList =
		provider === "chatgpt"
			? [
					"article",
					"[data-message-author-role]",
					"[data-testid*='conversation-turn']",
					"section",
					"li",
				]
			: [
					"article",
					"section",
					"li",
					"[data-testid*='message']",
					"[data-testid*='chat']",
				];

	const seen = new Set<HTMLElement>();
	const records: CandidateRecord[] = [];
	for (const selector of selectorList) {
		for (const element of Array.from(
			root.querySelectorAll<HTMLElement>(selector),
		)) {
			if (seen.has(element) || !isVisible(element)) continue;
			const text = normalizeText(
				element.innerText || element.textContent || "",
			);
			if (text.length < 18) continue;
			seen.add(element);
			records.push({ element, normalizedText: text });
		}
	}

	return sortCandidateRecords(records);
}

function sortCandidateRecords(records: CandidateRecord[]) {
	return records.sort((a, b) => {
		const lengthDelta = a.normalizedText.length - b.normalizedText.length;
		if (lengthDelta !== 0) return lengthDelta;
		return domDepth(b.element) - domDepth(a.element);
	});
}

function findBestTextMatch(options: {
	anchors: string[];
	candidates: CandidateRecord[];
	minimumScore?: number;
	allowBestEffort?: boolean;
	mapElement?: (element: HTMLElement) => HTMLElement;
}): HTMLElement | null {
	const anchors = options.anchors.filter((value) => value.length >= 8);
	if (anchors.length === 0 || options.candidates.length === 0) return null;

	let best: { element: HTMLElement; score: number } | null = null;
	for (const anchor of anchors) {
		for (const candidate of options.candidates) {
			const score = textMatchScore(anchor, candidate.normalizedText);
			if (!best || score > best.score) {
				best = { element: candidate.element, score };
			}
		}
	}

	if (!best) return null;
	if (!options.allowBestEffort && best.score < (options.minimumScore ?? 0.45)) {
		return null;
	}
	return options.mapElement ? options.mapElement(best.element) : best.element;
}

function textMatchScore(anchor: string, candidate: string): number {
	if (anchor === candidate) return 1;

	const shorter = Math.min(anchor.length, candidate.length);
	const longer = Math.max(anchor.length, candidate.length) || 1;
	let score = 0;

	if (candidate.includes(anchor) || anchor.includes(candidate)) {
		score = Math.max(score, 0.9 + shorter / longer / 10);
	}

	const head = anchor.slice(0, Math.max(18, Math.min(anchor.length, 96)));
	if (head.length >= 18 && candidate.includes(head)) {
		score = Math.max(
			score,
			0.8 + head.length / Math.max(anchor.length, 1) / 10,
		);
	}

	const anchorTokens = tokenize(anchor);
	const candidateTokens = tokenize(candidate);
	if (anchorTokens.length > 0 && candidateTokens.length > 0) {
		const candidateSet = new Set(candidateTokens);
		const common = anchorTokens.filter((token) =>
			candidateSet.has(token),
		).length;
		const minCoverage =
			common / Math.min(anchorTokens.length, candidateTokens.length);
		const maxCoverage =
			common / Math.max(anchorTokens.length, candidateTokens.length);
		score = Math.max(score, minCoverage * 0.78 + maxCoverage * 0.18);
	}

	if (
		overlapsStrongly(candidate, anchor) ||
		overlapsStrongly(anchor, candidate)
	) {
		score = Math.max(score, 0.62);
	}

	return score;
}

function tokenize(value: string): string[] {
	return value
		.split(" ")
		.map((token) => token.trim())
		.filter((token) => token.length >= 3);
}

function scrollAndHighlight(element: HTMLElement) {
	element.scrollIntoView({
		behavior: "smooth",
		block: "center",
		inline: "nearest",
	});
	const previousOutline = element.style.outline;
	const previousOutlineOffset = element.style.outlineOffset;
	const previousTransition = element.style.transition;
	element.style.outline = HIGHLIGHT_STYLE.outline;
	element.style.outlineOffset = HIGHLIGHT_STYLE.outlineOffset;
	element.style.transition = [previousTransition, HIGHLIGHT_STYLE.transition]
		.filter(Boolean)
		.join(", ");
	window.setTimeout(() => {
		element.style.outline = previousOutline;
		element.style.outlineOffset = previousOutlineOffset;
		element.style.transition = previousTransition;
	}, 1800);
}

function isVisible(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return false;
	const style = window.getComputedStyle(element);
	return style.display !== "none" && style.visibility !== "hidden";
}

function normalizeText(value: string): string {
	return value
		.normalize("NFKC")
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function overlapsStrongly(candidate: string, snippet: string): boolean {
	const shortened = snippet.slice(
		0,
		Math.max(18, Math.min(96, snippet.length)),
	);
	return candidate.includes(shortened);
}

function domDepth(element: HTMLElement): number {
	let depth = 0;
	let current: HTMLElement | null = element;
	while (current?.parentElement) {
		depth += 1;
		current = current.parentElement;
	}
	return depth;
}
