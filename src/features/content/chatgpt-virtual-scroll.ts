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

// Windowing values are intentionally conservative.
// They use pixels instead of turn counts because ChatGPT turn heights vary widely.
const MIN_TURNS_TO_VIRTUALIZE = 18;
const OVERSCAN_ABOVE_PX = 1400;
const OVERSCAN_BELOW_PX = 2200;
const EDGE_BUFFER_PX = 500;
const MIN_ABOVE_TURNS = 4;
const MIN_BELOW_TURNS = 6;

interface TurnEntry {
	node: HTMLElement;
	height: number;
	topOffset: number;
	bottomOffset: number;
}

interface AnchorSnapshot {
	element: HTMLElement;
	offsetFromScrollerTop: number;
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

class ChatGptVirtualScrollController {
	private enabled = false;
	private routeKey = "";
	private destroyed = false;
	private root: HTMLElement | null = null;
	private scroller: HTMLElement | null = null;
	private turns: TurnEntry[] = [];
	private renderedStart = 0;
	private renderedEnd = 0;
	private totalLayoutHeight = 0;
	private topSpacer: HTMLDivElement | null = null;
	private bottomSpacer: HTMLDivElement | null = null;
	private bootstrapObserver: MutationObserver | null = null;
	private rootObserver: MutationObserver | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private rafPending = false;
	private internalMutation = false;

	constructor() {
		void getChatGptVirtualScrollEnabled()
			.then((enabled) => {
				this.enabled = enabled;
				this.refresh();
			})
			.catch(() => undefined);
		browser.storage.onChanged.addListener(this.handleStorageChanged);
	}

	refresh = () => {
		if (this.destroyed) return;
		if (!this.enabled || !isSupportedChatGptChatPage()) {
			this.teardown({ restoreTurns: true });
			return;
		}

		const nextRouteKey = `${window.location.pathname}${window.location.search}`;
		const routeChanged = this.routeKey !== nextRouteKey;
		if (routeChanged) {
			this.routeKey = nextRouteKey;
			this.teardown({ restoreTurns: true });
		}

		if (this.ensureActiveRoot()) {
			this.scheduleSync();
			return;
		}
		this.armBootstrapObserver();
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
		this.refresh();
	};

	private ensureActiveRoot() {
		if (
			this.root?.isConnected &&
			this.scroller?.isConnected &&
			this.root.querySelector(TURN_SELECTOR)
		) {
			this.ensureSpacers();
			return true;
		}

		const anyTurn = document.querySelector<HTMLElement>(TURN_SELECTOR);
		if (!anyTurn) return false;
		const nextRoot = findTurnRoot(anyTurn);
		if (!nextRoot) return false;
		const nextScroller = findScrollContainerFromTurn(anyTurn);
		const structureChanged =
			this.root !== nextRoot || this.scroller !== nextScroller;
		if (!structureChanged && this.root && this.scroller) {
			this.ensureSpacers();
			return true;
		}

		this.teardown({ restoreTurns: true });
		this.root = nextRoot;
		this.scroller = nextScroller;
		this.turns = this.collectTurnsFromRoot();
		this.renderedStart = 0;
		this.renderedEnd = this.turns.length;
		this.totalLayoutHeight = this.getTotalLayoutHeightFromEntries(this.turns);
		this.ensureSpacers();
		nextScroller.addEventListener("scroll", this.handleScroll, {
			passive: true,
		});
		this.rootObserver = new MutationObserver(this.handleRootMutations);
		this.rootObserver.observe(nextRoot, { childList: true, subtree: false });
		this.resizeObserver = new ResizeObserver(this.handleRenderedTurnResize);
		this.observeRenderedTurns();
		return true;
	}

	private collectTurnsFromRoot() {
		if (!this.root) return [] as TurnEntry[];
		const nodes = Array.from(this.root.children).filter(
			(node): node is HTMLElement => isTurn(node),
		);
		if (nodes.length === 0) return [] as TurnEntry[];
		const baselineTop = nodes[0]?.getBoundingClientRect().top ?? 0;
		return nodes.map((node) => {
			const rect = node.getBoundingClientRect();
			const topOffset = Math.max(0, rect.top - baselineTop);
			const bottomOffset = Math.max(topOffset + 1, rect.bottom - baselineTop);
			return {
				node,
				height: Math.max(1, bottomOffset - topOffset),
				topOffset,
				bottomOffset,
			};
		});
	}

	private getTotalLayoutHeightFromEntries(entries: TurnEntry[]) {
		return entries[entries.length - 1]?.bottomOffset ?? 0;
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
		this.syncSpacerHeights();
	}

	private armBootstrapObserver() {
		if (this.bootstrapObserver) return;
		this.bootstrapObserver = new MutationObserver(() => {
			if (this.ensureActiveRoot()) {
				this.disarmBootstrapObserver();
				this.scheduleSync();
			}
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
		this.renderedStart = 0;
		this.renderedEnd = 0;
		this.totalLayoutHeight = 0;
		this.rafPending = false;
		this.internalMutation = false;
	}

	private restoreAllTurns() {
		if (!this.root || this.turns.length === 0) return;
		const anchor = this.captureAnchor();
		this.withInternalMutation(() => {
			for (const child of Array.from(this.root.children)) {
				if (isTurn(child)) child.remove();
			}
			for (const entry of this.turns) {
				this.root?.insertBefore(entry.node, this.bottomSpacer ?? null);
			}
			this.renderedStart = 0;
			this.renderedEnd = this.turns.length;
			this.remeasureRenderedRange();
			this.totalLayoutHeight = this.getTotalLayoutHeightFromEntries(this.turns);
			this.syncSpacerHeights();
			this.observeRenderedTurns();
		});
		this.restoreAnchor(anchor);
	}

	private rebuildFromDom() {
		if (!this.root) return;
		this.restoreAllTurns();
		this.turns = this.collectTurnsFromRoot();
		this.renderedStart = 0;
		this.renderedEnd = this.turns.length;
		this.totalLayoutHeight = this.getTotalLayoutHeightFromEntries(this.turns);
		this.ensureSpacers();
		this.observeRenderedTurns();
		this.scheduleSync();
	}

	private handleRootMutations = (mutations: MutationRecord[]) => {
		if (this.internalMutation) return;
		for (const mutation of mutations) {
			for (const node of Array.from(mutation.addedNodes).concat(
				Array.from(mutation.removedNodes),
			)) {
				if (!isElement(node)) continue;
				if (
					isSpacerElement(node) ||
					node.querySelector(`[${TOP_SPACER_ATTRIBUTE}]`) ||
					node.querySelector(`[${BOTTOM_SPACER_ATTRIBUTE}]`)
				) {
					continue;
				}
				const hasTurnDescendant = node.querySelector(TURN_SELECTOR) !== null;
				if (isTurn(node) || hasTurnDescendant) {
					this.rebuildFromDom();
					return;
				}
			}
		}
	};

	private applyHeightDelta(index: number, nextHeight: number) {
		const entry = this.turns[index];
		if (!entry) return;
		const delta = nextHeight - entry.height;
		if (Math.abs(delta) < 0.5) return;
		entry.height = nextHeight;
		entry.bottomOffset += delta;
		for (
			let nextIndex = index + 1;
			nextIndex < this.turns.length;
			nextIndex += 1
		) {
			const nextEntry = this.turns[nextIndex];
			if (!nextEntry) continue;
			nextEntry.topOffset += delta;
			nextEntry.bottomOffset += delta;
		}
		this.totalLayoutHeight = Math.max(0, this.totalLayoutHeight + delta);
	}

	private handleRenderedTurnResize = (entries: ResizeObserverEntry[]) => {
		let changed = false;
		for (const resizeEntry of entries) {
			const node = resizeEntry.target;
			if (!(node instanceof HTMLElement)) continue;
			const index = this.turns.findIndex((entry) => entry.node === node);
			if (index < 0) continue;
			const nextHeight = Math.max(
				resizeEntry.contentRect.height,
				measureElementHeight(node),
			);
			const before = this.turns[index]?.height ?? 0;
			this.applyHeightDelta(index, nextHeight);
			if (Math.abs((this.turns[index]?.height ?? 0) - before) >= 0.5)
				changed = true;
		}
		if (!changed) return;
		this.syncSpacerHeights();
	};

	private handleScroll = () => {
		this.scheduleSync();
	};

	private scheduleSync() {
		if (this.rafPending) return;
		this.rafPending = true;
		requestAnimationFrame(() => {
			this.rafPending = false;
			this.sync();
		});
	}

	private sync() {
		if (!this.root || !this.scroller) return;
		if (this.turns.length === 0) return;
		if (this.turns.length < MIN_TURNS_TO_VIRTUALIZE) {
			if (this.renderedStart !== 0 || this.renderedEnd !== this.turns.length) {
				this.applyWindow(0, this.turns.length);
			} else {
				this.remeasureRenderedRange();
				this.syncSpacerHeights();
			}
			return;
		}

		const anchorIndex = this.getAnchorIndex();
		if (anchorIndex == null) return;
		const nextWindow = this.getDesiredWindow(anchorIndex);
		if (
			nextWindow.start === this.renderedStart &&
			nextWindow.end === this.renderedEnd
		) {
			this.remeasureRenderedRange();
			this.syncSpacerHeights();
			return;
		}
		this.applyWindow(nextWindow.start, nextWindow.end);
	}

	private getAnchorIndex() {
		if (!this.scroller) return null;
		const renderedEntries = this.turns.slice(
			this.renderedStart,
			this.renderedEnd,
		);
		if (renderedEntries.length === 0) return null;
		const scrollerTop = this.scroller.getBoundingClientRect().top;
		const visibleEntry =
			renderedEntries.find(
				(entry) => entry.node.getBoundingClientRect().bottom > scrollerTop + 1,
			) ??
			renderedEntries[renderedEntries.length - 1] ??
			null;
		if (!visibleEntry) return null;
		return this.turns.indexOf(visibleEntry);
	}

	private getDesiredWindow(anchorIndex: number) {
		const totalTurns = this.turns.length;
		if (totalTurns <= MIN_TURNS_TO_VIRTUALIZE) {
			return { start: 0, end: totalTurns };
		}

		const anchorEntry = this.turns[anchorIndex];
		const renderedStartEntry = this.turns[this.renderedStart];
		const renderedEndEntry = this.turns[this.renderedEnd - 1];
		if (!anchorEntry || !renderedStartEntry || !renderedEndEntry) {
			return { start: 0, end: totalTurns };
		}

		const pixelsBeforeAnchor = Math.max(
			0,
			anchorEntry.topOffset - renderedStartEntry.topOffset,
		);
		const pixelsAfterAnchor = Math.max(
			0,
			renderedEndEntry.bottomOffset - anchorEntry.bottomOffset,
		);
		const currentWindowStartSafe =
			pixelsBeforeAnchor >= EDGE_BUFFER_PX &&
			anchorIndex - this.renderedStart >= MIN_ABOVE_TURNS;
		const currentWindowEndSafe =
			pixelsAfterAnchor >= EDGE_BUFFER_PX &&
			this.renderedEnd - anchorIndex - 1 >= MIN_BELOW_TURNS;
		if (
			this.renderedStart < this.renderedEnd &&
			currentWindowStartSafe &&
			currentWindowEndSafe
		) {
			return {
				start: this.renderedStart,
				end: this.renderedEnd,
			};
		}

		let start = anchorIndex;
		let aboveTurns = 0;
		while (start > 0) {
			const nextStart = start - 1;
			const nextAboveTurns = aboveTurns + 1;
			const nextAbovePixels =
				anchorEntry.topOffset - this.turns[nextStart]!.topOffset;
			start = nextStart;
			aboveTurns = nextAboveTurns;
			if (
				nextAbovePixels >= OVERSCAN_ABOVE_PX &&
				nextAboveTurns >= MIN_ABOVE_TURNS
			) {
				break;
			}
		}

		let end = anchorIndex + 1;
		let belowTurns = 0;
		while (end < totalTurns) {
			const nextEnd = end + 1;
			const nextBelowTurns = belowTurns + 1;
			const nextBelowPixels =
				this.turns[nextEnd - 1]!.bottomOffset - anchorEntry.bottomOffset;
			end = nextEnd;
			belowTurns = nextBelowTurns;
			if (
				nextBelowPixels >= OVERSCAN_BELOW_PX &&
				nextBelowTurns >= MIN_BELOW_TURNS
			) {
				break;
			}
		}

		return { start, end };
	}

	private applyWindow(start: number, end: number) {
		if (!this.root || !this.bottomSpacer) return;
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
			this.remeasureRenderedRange();
			this.syncSpacerHeights();
			this.observeRenderedTurns();
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

	private observeRenderedTurns() {
		this.resizeObserver?.disconnect();
		for (const entry of this.turns.slice(
			this.renderedStart,
			this.renderedEnd,
		)) {
			this.resizeObserver?.observe(entry.node);
		}
	}

	private captureAnchor(): AnchorSnapshot | null {
		if (!this.scroller) return null;
		const renderedEntries = this.turns.slice(
			this.renderedStart,
			this.renderedEnd,
		);
		if (renderedEntries.length === 0) return null;
		const scrollerTop = this.scroller.getBoundingClientRect().top;
		const visibleEntry =
			renderedEntries.find(
				(entry) => entry.node.getBoundingClientRect().bottom > scrollerTop + 1,
			) ??
			renderedEntries[renderedEntries.length - 1] ??
			null;
		if (!visibleEntry) return null;
		return {
			element: visibleEntry.node,
			offsetFromScrollerTop:
				visibleEntry.node.getBoundingClientRect().top - scrollerTop,
		};
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

	private syncSpacerHeights() {
		if (!this.topSpacer || !this.bottomSpacer) return;
		if (this.renderedStart >= this.renderedEnd || this.turns.length === 0) {
			this.topSpacer.style.height = "0px";
			this.topSpacer.style.minHeight = "0px";
			this.bottomSpacer.style.height = "0px";
			this.bottomSpacer.style.minHeight = "0px";
			return;
		}
		const topHeight = Math.max(
			0,
			this.turns[this.renderedStart]?.topOffset ?? 0,
		);
		const lastRenderedEntry = this.turns[this.renderedEnd - 1];
		const bottomHeight = Math.max(
			0,
			this.totalLayoutHeight - (lastRenderedEntry?.bottomOffset ?? 0),
		);
		this.topSpacer.style.height = `${topHeight}px`;
		this.topSpacer.style.minHeight = `${topHeight}px`;
		this.bottomSpacer.style.height = `${bottomHeight}px`;
		this.bottomSpacer.style.minHeight = `${bottomHeight}px`;
	}

	private remeasureRenderedRange() {
		if (this.renderedStart >= this.renderedEnd) return;
		const firstRenderedEntry = this.turns[this.renderedStart];
		const lastRenderedEntry = this.turns[this.renderedEnd - 1];
		if (
			!firstRenderedEntry?.node.isConnected ||
			!lastRenderedEntry?.node.isConnected
		) {
			return;
		}

		const baseRectTop = firstRenderedEntry.node.getBoundingClientRect().top;
		const baseOffset = firstRenderedEntry.topOffset;
		const oldWindowBottom = lastRenderedEntry.bottomOffset;
		let nextWindowBottom = oldWindowBottom;

		for (let index = this.renderedStart; index < this.renderedEnd; index += 1) {
			const entry = this.turns[index];
			if (!entry?.node.isConnected) continue;
			const rect = entry.node.getBoundingClientRect();
			const nextTopOffset = Math.max(0, baseOffset + (rect.top - baseRectTop));
			const nextBottomOffset = Math.max(
				nextTopOffset + 1,
				baseOffset + (rect.bottom - baseRectTop),
			);
			entry.topOffset = nextTopOffset;
			entry.bottomOffset = nextBottomOffset;
			entry.height = Math.max(1, nextBottomOffset - nextTopOffset);
			nextWindowBottom = nextBottomOffset;
		}

		const delta = nextWindowBottom - oldWindowBottom;
		if (Math.abs(delta) < 0.5) return;
		for (let index = this.renderedEnd; index < this.turns.length; index += 1) {
			const entry = this.turns[index];
			if (!entry) continue;
			entry.topOffset += delta;
			entry.bottomOffset += delta;
		}
		this.totalLayoutHeight = Math.max(0, this.totalLayoutHeight + delta);
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
