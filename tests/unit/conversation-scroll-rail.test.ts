import { createElement, type RefObject } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationScrollRail } from "../../apps/desktop/src/renderer/src/components/ConversationScrollRail";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "MutationObserver",
  "ResizeObserver"
] as const;
const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originalDescriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalDescriptors.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Conversation scroll rail", () => {
  it("appears only for overflow, previews bounded text, and jumps without replacing native scrolling", async () => {
    const dom = createDom();
    const { timeline, messages } = createTimeline(dom, [
      "First message",
      `Second ${"detail ".repeat(40)}`,
      "Third message"
    ]);
    const root = createRoot(dom.window.document.getElementById("root")!);
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      timeline.scrollTop = Number(options.top ?? 0);
    });
    timeline.scrollTo = scrollTo;

    await act(async () => {
      root.render(createElement(ConversationScrollRail, {
        timelineRef: { current: timeline } as RefObject<HTMLElement>,
        t: translate
      }));
    });

    const rail = dom.window.document.querySelector<HTMLElement>(".conversation-scroll-rail");
    expect(rail?.getAttribute("aria-label")).toBe("Conversation navigation");
    expect(rail?.style.getPropertyValue("--conversation-rail-height")).toBe("18px");
    expect(rail?.style.getPropertyValue("--conversation-rail-top")).toBe("61px");
    expect(timeline.classList.contains("has-conversation-scroll-rail")).toBe(true);
    const anchors = Array.from(rail!.querySelectorAll<HTMLButtonElement>(".conversation-scroll-anchor"));
    expect(anchors).toHaveLength(3);
    expect(anchors[0]?.getAttribute("aria-current")).toBe("true");
    expect(anchors.map((anchor) => anchor.tabIndex)).toEqual([0, -1, -1]);

    rail!.getBoundingClientRect = () => ({
      x: 396, y: 63, top: 63, right: 410, bottom: 77, left: 396,
      width: 14, height: 14, toJSON: () => ({})
    });
    await act(async () => rail!.dispatchEvent(new dom.window.MouseEvent("mousemove", {
      bubbles: true,
      clientY: 70
    })));
    const preview = rail!.querySelector<HTMLElement>(".conversation-scroll-anchor-preview");
    expect(preview?.textContent?.endsWith("…")).toBe(true);
    expect(Array.from(preview?.textContent ?? "")).toHaveLength(161);
    expect(anchors[0]?.classList.contains("neighbor-one")).toBe(true);
    expect(anchors[2]?.classList.contains("neighbor-one")).toBe(true);

    await act(async () => rail!.dispatchEvent(new dom.window.MouseEvent("click", {
      bubbles: true,
      clientY: 70
    })));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 250, behavior: "smooth" });
    expect(anchors[1]?.getAttribute("aria-current")).toBe("true");

    timeline.scrollTop = 500;
    await act(async () => timeline.dispatchEvent(new dom.window.Event("scroll")));
    expect(anchors[2]?.getAttribute("aria-current")).toBe("true");

    await act(async () => root.unmount());
    expect(timeline.classList.contains("has-conversation-scroll-rail")).toBe(false);
    expect(messages[0]?.isConnected).toBe(true);
    dom.window.close();
  });

  it("supports roving keyboard navigation and stays absent for a short transcript", async () => {
    const dom = createDom();
    const { timeline } = createTimeline(dom, ["One", "Two", "Three"]);
    const root = createRoot(dom.window.document.getElementById("root")!);
    timeline.scrollTo = vi.fn();

    await act(async () => {
      root.render(createElement(ConversationScrollRail, {
        timelineRef: { current: timeline } as RefObject<HTMLElement>,
        t: translate
      }));
    });
    let anchors = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>(".conversation-scroll-anchor"));
    anchors[0]!.focus();
    await act(async () => {
      anchors[0]!.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "End",
        bubbles: true
      }));
    });
    expect(dom.window.document.activeElement).toBe(anchors[2]);
    expect(timeline.scrollTo).toHaveBeenCalledOnce();

    Object.defineProperty(timeline, "scrollHeight", { configurable: true, value: 100 });
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("resize")));
    await act(async () => new Promise((resolve) => dom.window.setTimeout(resolve, 0)));
    anchors = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>(".conversation-scroll-anchor"));
    expect(anchors).toHaveLength(0);
    expect(timeline.classList.contains("has-conversation-scroll-rail")).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a long transcript in a compact centered tick band", async () => {
    const dom = createDom();
    const { timeline } = createTimeline(dom, Array.from(
      { length: 64 },
      (_, index) => `Message ${index + 1}`
    ));
    Object.defineProperties(timeline, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 6_000 }
    });
    timeline.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      top: 20,
      right: 410,
      bottom: 620,
      left: 10,
      width: 400,
      height: 600,
      toJSON: () => ({})
    });
    const root = createRoot(dom.window.document.getElementById("root")!);

    await act(async () => {
      root.render(createElement(ConversationScrollRail, {
        timelineRef: { current: timeline } as RefObject<HTMLElement>,
        t: translate
      }));
    });

    const rail = dom.window.document.querySelector<HTMLElement>(".conversation-scroll-rail");
    expect(rail?.style.getPropertyValue("--conversation-rail-height")).toBe("260px");
    expect(rail?.style.getPropertyValue("--conversation-rail-top")).toBe("190px");
    expect(rail?.querySelectorAll(".conversation-scroll-anchor")).toHaveLength(64);

    await act(async () => root.unmount());
    dom.window.close();
  });
});

function createTimeline(dom: JSDOM, texts: readonly string[]): {
  readonly timeline: HTMLElement;
  readonly messages: readonly HTMLElement[];
} {
  const timeline = dom.window.document.createElement("section");
  timeline.className = "conversation-timeline";
  const content = dom.window.document.createElement("div");
  content.className = "conversation-timeline-content";
  timeline.append(content);
  dom.window.document.body.append(timeline);
  Object.defineProperties(timeline, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 600 },
    scrollTop: { configurable: true, writable: true, value: 0 }
  });
  timeline.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    top: 20,
    right: 410,
    bottom: 120,
    left: 10,
    width: 400,
    height: 100,
    toJSON: () => ({})
  });
  const messages = texts.map((text, index) => {
    const message = dom.window.document.createElement("article");
    message.className = "conversation-message";
    message.dataset.messageId = `message-${index}`;
    message.textContent = text;
    Object.defineProperties(message, {
      offsetTop: { configurable: true, value: index * 280 },
      offsetHeight: { configurable: true, value: 40 }
    });
    content.append(message);
    return message;
  });
  return { timeline, messages };
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://pige.test"
  });
  Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 420 });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    })
  });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(Date.now());
    return 1;
  };
  dom.window.cancelAnimationFrame = () => undefined;
  Object.defineProperty(dom.window, "ResizeObserver", {
    configurable: true,
    value: class TestResizeObserver {
      observe(): void {}
      disconnect(): void {}
    }
  });
  installDom(dom);
  return dom;
}

function installDom(dom: JSDOM): void {
  for (const key of globalKeys) {
    if (!originalDescriptors.has(key)) {
      originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    }
    const value = key === "ResizeObserver"
      ? dom.window.ResizeObserver
      : dom.window[key as keyof Window];
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true
  });
}

function translate(key: string): string {
  return ({
    "home.scrollRailLabel": "Conversation navigation",
    "home.scrollRailJump": "Jump to message",
    "home.scrollRailMessageFallback": "Message"
  } as Record<string, string>)[key] ?? key;
}
