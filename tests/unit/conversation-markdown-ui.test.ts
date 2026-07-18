import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

const markdownRenders = vi.hoisted(() => ({
  pending: [] as Array<{
    readonly source: string;
    readonly resolve: (value: { readonly html: string }) => void;
  }>
}));

vi.mock("@pige/markdown", () => ({
  renderPigeMarkdownToHtml: (source: string) => new Promise<{ readonly html: string }>((resolve) => {
    markdownRenders.pending.push({ source, resolve });
  })
}));

import { ConversationMarkdown } from "../../apps/desktop/src/renderer/src/components/ConversationMarkdown";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "Element"] as const;
const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  markdownRenders.pending.length = 0;
  for (const key of globalKeys) {
    const descriptor = originalDescriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalDescriptors.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Conversation Markdown streaming presentation", () => {
  it("keeps the last sanitized frame visible while the next draft snapshot renders", async () => {
    const dom = installDom();
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(ConversationMarkdown, {
        markdown: "## First frame",
        provisional: true
      }));
    });
    await waitFor(() => markdownRenders.pending.length === 1);
    await act(async () => {
      markdownRenders.pending[0]?.resolve({ html: "<h2>First frame</h2>" });
      await Promise.resolve();
    });
    expect(container.querySelector("h2")?.textContent).toBe("First frame");

    await act(async () => {
      root.render(createElement(ConversationMarkdown, {
        markdown: "## Second streaming frame",
        provisional: true
      }));
    });
    await waitFor(() => markdownRenders.pending.length === 2);
    const updating = container.querySelector<HTMLElement>('[data-markdown-updating="true"]');
    expect(updating?.getAttribute("data-markdown-ready")).toBe("true");
    expect(updating?.querySelector("h2")?.textContent).toBe("First frame");
    expect(container.textContent).not.toContain("## Second streaming frame");

    await act(async () => {
      markdownRenders.pending[1]?.resolve({ html: "<h2>Second streaming frame</h2>" });
      await Promise.resolve();
    });
    expect(container.querySelector("h2")?.textContent).toBe("Second streaming frame");
    expect(container.querySelector("[data-markdown-updating]")).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });
});

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key]
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true
  });
  return dom;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for streaming Markdown state.");
}
