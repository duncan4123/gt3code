import { describe, expect, it, vi } from "vitest";
import { scrollSentMessageIntoView } from "./chat-scroll";

const noopRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
};

function setRect(element: HTMLElement, rect: Partial<DOMRect>): void {
  const nextRect: DOMRect = {
    ...noopRect,
    ...rect,
    toJSON: () => ({}),
  } as DOMRect;
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => nextRect,
  });
}

describe("scrollSentMessageIntoView", () => {
  it("scrolls when the message extends beyond the viewport", () => {
    const container = document.createElement("div");
    const message = document.createElement("div");
    message.setAttribute("data-message-id", "m-1");
    container.append(message);

    setRect(container, { top: 0, bottom: 400 });
    setRect(message, { top: 350, bottom: 450 });

    const scrollToBottom = vi.fn();
    const handled = scrollSentMessageIntoView({
      container,
      messageId: "m-1",
      scrollToBottom,
      behavior: "smooth",
    });

    expect(handled).toBe(true);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).toHaveBeenCalledWith("smooth");
  });

  it("does not scroll when the message already fits", () => {
    const container = document.createElement("div");
    const message = document.createElement("div");
    message.setAttribute("data-message-id", "m-1");
    container.append(message);

    setRect(container, { top: 0, bottom: 400 });
    setRect(message, { top: 300, bottom: 360 });

    const scrollToBottom = vi.fn();
    const handled = scrollSentMessageIntoView({
      container,
      messageId: "m-1",
      scrollToBottom,
    });

    expect(handled).toBe(true);
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("returns false when no matching message is rendered", () => {
    const container = document.createElement("div");
    setRect(container, { top: 0, bottom: 400 });

    const scrollToBottom = vi.fn();
    const handled = scrollSentMessageIntoView({
      container,
      messageId: "missing",
      scrollToBottom,
    });

    expect(handled).toBe(false);
    expect(scrollToBottom).not.toHaveBeenCalled();
  });
});
