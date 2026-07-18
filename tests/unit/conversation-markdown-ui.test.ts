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

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "Element", "MouseEvent"] as const;
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

  it("adds a localized final-code copy action with success, failure, focus, and provisional fences", async () => {
    const dom = installDom();
    const copied: string[] = [];
    let rejectCopy = false;
    let finishCopy: (() => void) | undefined;
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          if (rejectCopy) throw new Error("private clipboard detail");
          copied.push(value);
          await new Promise<void>((resolve) => { finishCopy = resolve; });
        }
      }
    });
    const labels: Record<string, string> = {
      "conversation.code": "Code",
      "conversation.copyCode": "Copy code",
      "conversation.copyingCode": "Copying…",
      "conversation.codeCopied": "Copied",
      "conversation.copyCodeFailed": "Copy failed — retry"
    };
    const t = (key: string): string => labels[key] ?? key;
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(ConversationMarkdown, { markdown: "```ts\nconst safe = true;\n```", t }));
    });
    await waitFor(() => markdownRenders.pending.length === 1);
    await act(async () => {
      markdownRenders.pending[0]?.resolve({ html: '<pre><code class="language-ts">const safe = true;\n</code></pre>' });
      await Promise.resolve();
    });

    const wrapper = required(container.querySelector<HTMLElement>(".conversation-code-block"));
    expect(wrapper.querySelector(".conversation-code-language")?.textContent).toBe("ts");
    const copyButton = required(wrapper.querySelector<HTMLButtonElement>("[data-conversation-code-copy]"));
    expect(copyButton.textContent).toBe("Copy code");
    copyButton.focus();
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
    });
    expect(copied).toEqual(["const safe = true;\n"]);
    expect(copyButton.textContent).toBe("Copying…");
    expect(copyButton.disabled).toBe(true);
    expect(copyButton.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      finishCopy?.();
      await Promise.resolve();
    });
    expect(copyButton.textContent).toBe("Copied");
    expect(wrapper.querySelector('[role="status"]')?.textContent).toBe("Copied");
    expect(dom.window.document.activeElement).toBe(copyButton);

    rejectCopy = true;
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
    });
    expect(copyButton.textContent).toBe("Copy failed — retry");
    expect(wrapper.querySelector('[role="status"]')?.textContent).toBe("Copy failed — retry");
    expect(container.textContent).not.toContain("private clipboard detail");
    expect(dom.window.document.activeElement).toBe(copyButton);

    await act(async () => {
      root.render(createElement(ConversationMarkdown, {
        markdown: "```ts\nconst safe = true;\n```",
        provisional: true,
        t
      }));
    });
    expect(container.querySelector("[data-conversation-code-copy]")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toBe("const safe = true;\n");

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

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Required test value missing");
  return value;
}
