import { browser } from "wxt/browser";
import { CHATGPT_VIRTUAL_SCROLL_KEY } from "../../lib/constants";
import { inferPageKind, inferProvider } from "../../lib/page-context";
import { getChatGptVirtualScrollEnabled } from "../../lib/storage";

// ChatGPT-specific DOM integration points.
// If ChatGPT changes its conversation DOM, update these first.
const TURN_SELECTOR = "section[data-testid^='conversation-turn']";
const TOP_SPACER_ATTRIBUTE =
	"data-ai-chat-project-exporter-virtual-scroll-top-spacer";
const BOTTOM_SPACER_ATTRIBUTE =
	"data-ai-chat-project-exporter-virtual-scroll-bottom-spacer";

// Windowing values stay conservative because ChatGPT turn heights vary widely.
const MIN_TURNS_TO_VIRTUALIZE = 18;
const OVERSCAN_ABOVE_PX = 1400;
const OVERSCAN_BELOW_PX = 2200;
const EDGE_BUFFER_PX = 500;
const MIN_ABOVE_TURNS = 4;
const MIN_BELOW_TURNS = 6;

interface TurnEntry {
	node: HTMLElement;
	height: number;
}

interface AnchorSnapshot {
	element: HTMLElement;
	offsetFromScrollerTop: number;
}

interface BoundDom {
	root: HTMLElement;
	scroller: HTMLElement;
	turnNodes: HTMLElement[];
}

interface FlushFlags {
	bind: boolean;
	rebuild: boolean;
	measure: boolean;
	window: boolean;
}

function emptyFlushFlags(): FlushFlags {
	return {
		bind: false,
		rebuild: false,
		measure: false,
		window: false,
	};
}

function isElement(node: Node | null | undefined): node is HTMLElement {
	return Boolean(node && node.nodeType === Node.ELEMENT_NODE);
}

function isTurn(node: Element | null | undefined): node is HTMLElement {
	return Boolean(node && node.matches(TURN_SELECTOR));
}

function isSupportedChatGptChatPage() {
	return (
		inferProvider(window.location.href) === "chatgpt" &&
		inferPageKind(window.location.href) === "chat"
	);
}

function isScrollable(element: HTMLElement | null): element is HTMLElement {
	if (!element) return false;
	const styles = window.getComputedStyle(element);
	const overflowY = styles.overflowY;
	return (
		(overflowY === "auto" || overflowY === "scroll") &&
		element.scrollHeight > element.clientHeight + 2
	);
}

function findScrollContainerFromTurn(turn: HTMLElement): HTMLElement {
	const candidates: HTMLElement[] = [];
	let current: HTMLElement | null = turn;
	while (current && current !== document.documentElement) {
		if (isScrollable(current)) candidates.push(current);
		current = current.parentElement;
	}

	const documentScroller =
		(document.scrollingElement as HTMLElement | null) ??
		document.documentElement;
	if (documentScroller && isScrollable(documentScroller)) {
		const strongestCandidate =
			candidates.reduce<HTMLElement | null>(
				(best, candidate) =>
					!best || candidate.scrollHeight > best.scrollHeight
						? candidate
						: best,
				null,
			) ?? null;
		if (
			!strongestCandidate ||
			documentScroller.scrollHeight >= strongestCandidate.scrollHeight - 2
		) {
			return documentScroller;
		}
	}

	return candidates[0] ?? documentScroller;
}

function findTurnRoot(anyTurn: HTMLElement): HTMLElement | null {
	let node = anyTurn.parentElement;
	let best = node;
	while (node && node !== document.body) {
		const directTurnChildren = Array.from(node.children).filter((child) =>
			isTurn(child),
		).length;
		if (directTurnChildren >= 1) best = node;
		const parent = node.parentElement;
		if (!parent) break;
		const parentDirectTurnChildren = Array.from(parent.children).filter(
			(child) => isTurn(child),
		).length;
		if (
			parentDirectTurnChildren >= directTurnChildren &&
			parentDirectTurnChildren > 0
		) {
			node = parent;
			continue;
		}
		break;
	}
	return best;
}

function measureElementHeight(element: HTMLElement) {
	const rectHeight = element.getBoundingClientRect().height;
	if (rectHeight > 0) return rectHeight;
	if (element.offsetHeight > 0) return element.offsetHeight;
	if (element.scrollHeight > 0) return element.scrollHeight;
	return 1;
}

function isSpacerElement(element: Element | null | undefined) {
	return Boolean(
		element &&
			(element.getAttribute(TOP_SPACER_ATTRIBUTE) === "true" ||
				element.getAttribute(BOTTOM_SPACER_ATTRIBUTE) === "true"),
	);
}

function mergeFlushFlags(target: FlushFlags, next: Partial<FlushFlags>) {
	if (next.bind) target.bind = true;
	if (next.rebuild) target.rebuild = true;
	if (next.measure) target.measure = true;
	if (next.window) target.window = true;
}

class ChatGptVirtualScrollController {
	private enabled = false;
	private destroyed = false;
	private routeKey = "";
	private root: HTMLElement | null = null;
	private scroller: HTMLElement | null = null;
	private turns: TurnEntry[] = [];
	private prefixHeights: number[] = [0];
	private renderedStart = 0;
	private renderedEnd = 0;
	private topSpacer: HTMLDivElement | null = null;
	private bottomSpacer: HTMLDivElement | null = null;
	private bootstrapObserver: MutationObserver | null = null;
	private rootObserver: MutationObserver | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private flushScheduled = false;
	private pendingFlags = emptyFlushFlags();
	private internalMutation = false;

	constructor() {
		void getChatGptVirtualScrollEnabled()
			.then((enabled) => {
				this.enabled = enabled;
				this.requestFlush({
					bind: true,
					rebuild: true,
					measure: true,
					window: true,
				});
			})
			.catch(() => undefined);
		browser.storage.onChanged.addListener(this.handleStorageChanged);
	}

	refresh = () => {
		if (this.destroyed) return;
		this.requestFlush({
			bind: true,
			rebuild: true,
			measure: true,
			window: true,
		});
	};

	destroy = () => {
		if (this.destroyed) return;
		this.destroyed = true;
		browser.storage.onChanged.removeListener(this.handleStorageChanged);
		this.teardown({ restoreTurns: true });
	};

	private handleStorageChanged = (
		changes: Record<string, { newValue?: unknown }>,
		areaName: string,
	) => {
		if (areaName !== "local") return;
		if (!(CHATGPT_VIRTUAL_SCROLL_KEY in changes)) return;
		this.enabled = changes[CHATGPT_VIRTUAL_SCROLL_KEY]?.newValue === true;
		this.requestFlush({
			bind: true,
			rebuild: true,
			measure: true,
			window: true,
		});
	};

	private requestFlush(next: Partial<FlushFlags>) {
		if (this.destroyed) return;
		mergeFlushFlags(this.pendingFlags, next);
		if (this.flushScheduled) return;
		this.flushScheduled = true;
		requestAnimationFrame(() => {
			this.flushScheduled = false;
			this.flush();
		});
	}

	private flush() {
		if (this.destroyed) return;
		const flags = this.pendingFlags;
		this.pendingFlags = emptyFlushFlags();

		if (!this.enabled || !isSupportedChatGptChatPage()) {
			this.teardown({ restoreTurns: true });
			return;
		}

		const nextRouteKey = `${window.location.pathname}${window.location.search}`;
		if (this.routeKey !== nextRouteKey) {
			this.routeKey = nextRouteKey;
			this.teardown({ restoreTurns: true });
			flags.bind = true;
			flags.rebuild = true;
			flags.measure = true;
			flags.window = true;
		}

		if (flags.bind && !this.ensureBound()) {
			this.armBootstrapObserver();
			return;
		}
		this.disarmBootstrapObserver();

		if (!this.root || !this.scroller || this.turns.length === 0) return;

		if (flags.rebuild) this.rebuildStateFromDom();
		if (flags.measure) this.remeasureRenderedTurns();

		if (this.turns.length < MIN_TURNS_TO_VIRTUALIZE) {
			this.ensureAllRendered();
			this.observeRenderedTurns();
			this.syncSpacerHeights();
			return;
		}

		if (flags.window || flags.measure || flags.rebuild || flags.bind) {
			const nextWindow = this.getDesiredWindow();
			if (nextWindow) {
				this.applyWindow(nextWindow.start, nextWindow.end);
			}
		}

		this.observeRenderedTurns();
		this.syncSpacerHeights();
	}

	private armBootstrapObserver() {
		if (this.bootstrapObserver) return;
		this.bootstrapObserver = new MutationObserver(() => {
			this.requestFlush({
				bind: true,
				rebuild: true,
				measure: true,
				window: true,
			});
		});
		this.bootstrapObserver.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	}

	private disarmBootstrapObserver() {
		this.bootstrapObserver?.disconnect();
		this.bootstrapObserver = null;
	}

	private teardown(options: { restoreTurns: boolean }) {
		this.disarmBootstrapObserver();
		this.rootObserver?.disconnect();
		this.rootObserver = null;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		if (options.restoreTurns) this.restoreAllTurns();
		this.topSpacer?.remove();
		this.bottomSpacer?.remove();
		this.topSpacer = null;
		this.bottomSpacer = null;
		this.scroller?.removeEventListener("scroll", this.handleScroll);
		this.root = null;
		this.scroller = null;
		this.turns = [];
		this.prefixHeights = [0];
		this.renderedStart = 0;
		this.renderedEnd = 0;
		this.pendingFlags = emptyFlushFlags();
		this.internalMutation = false;
	}

	private ensureBound() {
		const existingTurns =
			this.root?.isConnected && this.scroller?.isConnected
				? Array.from(this.root.children).filter((child): child is HTMLElement =>
						isTurn(child),
					)
				: [];
		if (this.root && this.scroller && existingTurns.length > 0) {
			this.ensureSpacers();
			return true;
		}

		const bound = this.findBoundDom();
		if (!bound) return false;
		const structureChanged =
			this.root !== bound.root || this.scroller !== bound.scroller;
		if (structureChanged) this.teardown({ restoreTurns: true });

		this.root = bound.root;
		this.scroller = bound.scroller;
		this.turns = bound.turnNodes.map((node) => ({
			node,
			height: measureElementHeight(node),
		}));
		this.renderedStart = 0;
		this.renderedEnd = this.turns.length;
		this.rebuildPrefixHeights();
		this.ensureSpacers();

		if (structureChanged || !this.rootObserver) {
			this.scroller.addEventListener("scroll", this.handleScroll, {
				passive: true,
			});
			this.rootObserver = new MutationObserver(this.handleRootMutations);
			this.rootObserver.observe(this.root, {
				childList: true,
				subtree: false,
			});
			this.resizeObserver = new ResizeObserver(this.handleRenderedResize);
		}

		return true;
	}

	private findBoundDom(): BoundDom | null {
		const anyTurn = document.querySelector<HTMLElement>(TURN_SELECTOR);
		if (!anyTurn) return null;
		const root = findTurnRoot(anyTurn);
		if (!root) return null;
		const scroller = findScrollContainerFromTurn(anyTurn);
		const turnNodes = Array.from(root.children).filter(
			(node): node is HTMLElement => isTurn(node),
		);
		if (turnNodes.length === 0) return null;
		return { root, scroller, turnNodes };
	}

	private ensureSpacers() {
		if (!this.root) return;
		if (this.topSpacer?.parentElement !== this.root) {
			this.topSpacer?.remove();
			const spacer = document.createElement("div");
			spacer.setAttribute(TOP_SPACER_ATTRIBUTE, "true");
			spacer.setAttribute("aria-hidden", "true");
			spacer.style.display = "block";
			spacer.style.height = "0px";
			spacer.style.minHeight = "0px";
			spacer.style.pointerEvents = "none";
			spacer.style.visibility = "hidden";
			this.root.insertBefore(spacer, this.root.firstChild);
			this.topSpacer = spacer;
		}
		if (this.bottomSpacer?.parentElement !== this.root) {
			this.bottomSpacer?.remove();
			const spacer = document.createElement("div");
			spacer.setAttribute(BOTTOM_SPACER_ATTRIBUTE, "true");
			spacer.setAttribute("aria-hidden", "true");
			spacer.style.display = "block";
			spacer.style.height = "0px";
			spacer.style.minHeight = "0px";
			spacer.style.pointerEvents = "none";
			spacer.style.visibility = "hidden";
			this.root.appendChild(spacer);
			this.bottomSpacer = spacer;
		}
	}

	private handleRootMutations = (mutations: MutationRecord[]) => {
		if (this.internalMutation) return;
		for (const mutation of mutations) {
			for (const node of Array.from(mutation.addedNodes).concat(
				Array.from(mutation.removedNodes),
			)) {
				if (!isElement(node)) continue;
				if (isSpacerElement(node)) continue;
				if (isTurn(node)) {
					this.requestFlush({
						bind: true,
						rebuild: true,
						measure: true,
						window: true,
					});
					return;
				}
			}
		}
	};

	private handleRenderedResize = () => {
		this.requestFlush({ measure: true, window: true });
	};

	private handleScroll = () => {
		this.requestFlush({ window: true });
	};

	private rebuildStateFromDom() {
		if (!this.root) return;
		this.restoreAllTurns();
		const turnNodes = Array.from(this.root.children).filter(
			(node): node is HTMLElement => isTurn(node),
		);
		this.turns = turnNodes.map((node) => ({
			node,
			height: measureElementHeight(node),
		}));
		this.renderedStart = 0;
		this.renderedEnd = this.turns.length;
		this.rebuildPrefixHeights();
	}

	private rebuildPrefixHeights() {
		const nextPrefix = new Array(this.turns.length + 1);
		nextPrefix[0] = 0;
		for (let index = 0; index < this.turns.length; index += 1) {
			nextPrefix[index + 1] =
				nextPrefix[index]! + Math.max(1, this.turns[index]!.height);
		}
		this.prefixHeights = nextPrefix;
	}

	private ensureAllRendered() {
		if (!this.root || !this.bottomSpacer) return;
		if (this.renderedStart === 0 && this.renderedEnd === this.turns.length)
			return;
		const anchor = this.captureAnchor();
		this.withInternalMutation(() => {
			for (const child of Array.from(this.root.children)) {
				if (isTurn(child)) child.remove();
			}
			const fragment = document.createDocumentFragment();
			for (const entry of this.turns) fragment.appendChild(entry.node);
			this.root?.insertBefore(fragment, this.bottomSpacer);
			this.renderedStart = 0;
			this.renderedEnd = this.turns.length;
		});
		this.restoreAnchor(anchor);
	}

	private observeRenderedTurns() {
		this.resizeObserver?.disconnect();
		for (let index = this.renderedStart; index < this.renderedEnd; index += 1) {
			const entry = this.turns[index];
			if (!entry?.node.isConnected) continue;
			this.resizeObserver?.observe(entry.node);
		}
	}

	private remeasureRenderedTurns() {
		let changed = false;
		for (let index = this.renderedStart; index < this.renderedEnd; index += 1) {
			const entry = this.turns[index];
			if (!entry?.node.isConnected) continue;
			const nextHeight = measureElementHeight(entry.node);
			if (Math.abs(nextHeight - entry.height) < 0.5) continue;
			entry.height = nextHeight;
			changed = true;
		}
		if (changed) this.rebuildPrefixHeights();
	}

	private getDesiredWindow() {
		if (!this.root || !this.scroller || this.turns.length === 0) return null;
		const anchorIndex = this.getVisibleAnchorIndex();
		if (anchorIndex == null) return null;

		const currentStartSafe =
			anchorIndex - this.renderedStart >= MIN_ABOVE_TURNS &&
			this.distanceAboveAnchor(anchorIndex, this.renderedStart) >=
				EDGE_BUFFER_PX;
		const currentEndSafe =
			this.renderedEnd - anchorIndex - 1 >= MIN_BELOW_TURNS &&
			this.distanceBelowAnchor(anchorIndex, this.renderedEnd) >= EDGE_BUFFER_PX;
		if (
			this.renderedStart < this.renderedEnd &&
			currentStartSafe &&
			currentEndSafe
		) {
			return {
				start: this.renderedStart,
				end: this.renderedEnd,
			};
		}

		let start = anchorIndex;
		while (start > 0) {
			const nextStart = start - 1;
			const nextAboveTurns = anchorIndex - nextStart;
			const nextAbovePixels = this.distanceAboveAnchor(anchorIndex, nextStart);
			start = nextStart;
			if (
				nextAbovePixels >= OVERSCAN_ABOVE_PX &&
				nextAboveTurns >= MIN_ABOVE_TURNS
			) {
				break;
			}
		}

		let end = anchorIndex + 1;
		while (end < this.turns.length) {
			const nextEnd = end + 1;
			const nextBelowTurns = nextEnd - anchorIndex - 1;
			const nextBelowPixels = this.distanceBelowAnchor(anchorIndex, nextEnd);
			end = nextEnd;
			if (
				nextBelowPixels >= OVERSCAN_BELOW_PX &&
				nextBelowTurns >= MIN_BELOW_TURNS
			) {
				break;
			}
		}

		return { start, end };
	}

	private distanceAboveAnchor(anchorIndex: number, startIndex: number) {
		return Math.max(
			0,
			this.prefixHeights[anchorIndex]! - this.prefixHeights[startIndex]!,
		);
	}

	private distanceBelowAnchor(anchorIndex: number, endIndex: number) {
		return Math.max(
			0,
			this.prefixHeights[endIndex]! - this.prefixHeights[anchorIndex + 1]!,
		);
	}

	private getVisibleAnchorIndex() {
		if (!this.scroller) return null;
		const scrollerTop = this.scroller.getBoundingClientRect().top;
		for (let index = this.renderedStart; index < this.renderedEnd; index += 1) {
			const node = this.turns[index]?.node;
			if (!node?.isConnected) continue;
			if (node.getBoundingClientRect().bottom > scrollerTop + 1) return index;
		}
		return this.renderedEnd > this.renderedStart ? this.renderedEnd - 1 : null;
	}

	private applyWindow(start: number, end: number) {
		if (!this.root || !this.bottomSpacer) return;
		if (start === this.renderedStart && end === this.renderedEnd) return;
		const anchor = this.captureAnchor();
		this.withInternalMutation(() => {
			if (start < this.renderedStart) {
				const fragment = document.createDocumentFragment();
				for (
					let index = start;
					index < this.renderedStart && index < end;
					index += 1
				) {
					const entry = this.turns[index];
					if (!entry) continue;
					fragment.appendChild(entry.node);
				}
				const firstRenderedNode = this.findFirstRenderedDomNode();
				this.root?.insertBefore(
					fragment,
					firstRenderedNode ?? this.bottomSpacer,
				);
			}

			if (end > this.renderedEnd) {
				const fragment = document.createDocumentFragment();
				for (
					let index = Math.max(this.renderedEnd, start);
					index < end;
					index += 1
				) {
					const entry = this.turns[index];
					if (!entry) continue;
					fragment.appendChild(entry.node);
				}
				this.root?.insertBefore(fragment, this.bottomSpacer);
			}

			for (
				let index = this.renderedStart;
				index < Math.min(this.renderedEnd, start);
				index += 1
			) {
				this.turns[index]?.node.remove();
			}
			for (
				let index = Math.max(this.renderedStart, end);
				index < this.renderedEnd;
				index += 1
			) {
				this.turns[index]?.node.remove();
			}

			this.renderedStart = start;
			this.renderedEnd = end;
		});
		this.restoreAnchor(anchor);
	}

	private findFirstRenderedDomNode() {
		for (let index = this.renderedStart; index < this.renderedEnd; index += 1) {
			const node = this.turns[index]?.node;
			if (node?.isConnected) return node;
		}
		return null;
	}

	private syncSpacerHeights() {
		if (!this.topSpacer || !this.bottomSpacer) return;
		if (this.turns.length === 0 || this.renderedStart >= this.renderedEnd) {
			this.topSpacer.style.height = "0px";
			this.topSpacer.style.minHeight = "0px";
			this.bottomSpacer.style.height = "0px";
			this.bottomSpacer.style.minHeight = "0px";
			return;
		}
		const totalHeight = this.prefixHeights[this.turns.length] ?? 0;
		const topHeight = this.prefixHeights[this.renderedStart] ?? 0;
		const bottomHeight = Math.max(
			0,
			totalHeight - (this.prefixHeights[this.renderedEnd] ?? 0),
		);
		this.topSpacer.style.height = `${topHeight}px`;
		this.topSpacer.style.minHeight = `${topHeight}px`;
		this.bottomSpacer.style.height = `${bottomHeight}px`;
		this.bottomSpacer.style.minHeight = `${bottomHeight}px`;
	}

	private captureAnchor(): AnchorSnapshot | null {
		if (!this.scroller) return null;
		const scrollerTop = this.scroller.getBoundingClientRect().top;
		for (let index = this.renderedStart; index < this.renderedEnd; index += 1) {
			const node = this.turns[index]?.node;
			if (!node?.isConnected) continue;
			const rect = node.getBoundingClientRect();
			if (rect.bottom <= scrollerTop + 1) continue;
			return {
				element: node,
				offsetFromScrollerTop: rect.top - scrollerTop,
			};
		}
		return null;
	}

	private restoreAnchor(anchorSnapshot: AnchorSnapshot | null) {
		if (
			!anchorSnapshot ||
			!this.scroller ||
			!anchorSnapshot.element.isConnected
		)
			return;
		const scrollerTop = this.scroller.getBoundingClientRect().top;
		const nextOffset =
			anchorSnapshot.element.getBoundingClientRect().top - scrollerTop;
		const delta = nextOffset - anchorSnapshot.offsetFromScrollerTop;
		if (delta !== 0) this.scroller.scrollTop += delta;
	}

	private restoreAllTurns() {
		if (!this.root || !this.bottomSpacer || this.turns.length === 0) return;
		const anchor = this.captureAnchor();
		this.withInternalMutation(() => {
			for (const child of Array.from(this.root.children)) {
				if (isTurn(child)) child.remove();
			}
			const fragment = document.createDocumentFragment();
			for (const entry of this.turns) fragment.appendChild(entry.node);
			this.root?.insertBefore(fragment, this.bottomSpacer);
			this.renderedStart = 0;
			this.renderedEnd = this.turns.length;
		});
		this.restoreAnchor(anchor);
	}

	private withInternalMutation(task: () => void) {
		this.internalMutation = true;
		try {
			task();
		} finally {
			this.internalMutation = false;
		}
	}
}

export function initializeChatGptVirtualScroll() {
	const controller = new ChatGptVirtualScrollController();
	return {
		refresh: () => controller.refresh(),
		destroy: () => controller.destroy(),
	};
}
