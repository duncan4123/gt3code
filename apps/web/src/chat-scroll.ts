export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;

interface ScrollPosition {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export function isScrollContainerNearBottom(
  position: ScrollPosition,
  thresholdPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx)
    ? Math.max(0, thresholdPx)
    : AUTO_SCROLL_BOTTOM_THRESHOLD_PX;

  const { scrollTop, clientHeight, scrollHeight } = position;
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
    return true;
  }

  const distanceFromBottom = scrollHeight - clientHeight - scrollTop;
  return distanceFromBottom <= threshold;
}

export function scrollSentMessageIntoView(options: {
  container: HTMLElement | null;
  messageId: string;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  behavior?: ScrollBehavior;
  bottomSlackPx?: number;
}): boolean {
  const {
    container,
    messageId,
    scrollToBottom,
    behavior = "auto",
    bottomSlackPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX / 2,
  } = options;
  if (!container) return false;

  const target = findMessageElement(container, messageId);
  if (!target) return false;

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const needsScroll = targetRect.bottom > containerRect.bottom - bottomSlackPx;
  if (needsScroll) {
    scrollToBottom(behavior);
  }
  return true;
}

function findMessageElement(container: HTMLElement, messageId: string): HTMLElement | null {
  const nodes = container.querySelectorAll<HTMLElement>("[data-message-id]");
  for (const node of nodes) {
    if (node.getAttribute("data-message-id") === messageId) {
      return node;
    }
  }
  return null;
}
