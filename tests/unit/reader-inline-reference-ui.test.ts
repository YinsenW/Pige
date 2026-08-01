import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderInlineReferenceSurface } from "../../apps/desktop/src/renderer/src/components/ReaderInlineReferenceSurface";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "Element", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
const labels: Record<string, string> = {
  "conversation.code": "Code",
  "conversation.copyCode": "Copy code",
  "conversation.copyingCode": "Copying…",
  "conversation.codeCopied": "Copied",
  "conversation.copyCodeFailed": "Copy failed — retry",
  "note.readerLinkReady": "Open this reference",
  "note.readerLinkUnavailable": "Reference unavailable"
};

afterEach(() => {
  for (const key of globals) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Reader inline reference surface", () => {
  it("copies exact sanitized code once and fences a late result after the Reader changes", async () => {
    const harness = mount();
    const writes: string[] = [];
    let finish: (() => void) | undefined;
    Object.defineProperty(harness.dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async (value: string) => {
        writes.push(value);
        await new Promise<void>((resolve) => { finish = resolve; });
      }) }
    });
    render(harness.root, "page-a", '<pre><code class="language-ts">const exact = true;\n</code></pre>');
    const first = required(harness.container.querySelector<HTMLButtonElement>("[data-reader-code-copy]"));
    expect(harness.container.querySelector(".conversation-code-language")?.textContent).toBe("ts");
    first.focus();
    await act(async () => {
      first.click();
      first.click();
      await Promise.resolve();
    });
    expect(writes).toEqual(["const exact = true;\n"]);
    expect(first.textContent).toBe("Copying…");
    expect(first.disabled).toBe(true);
    expect(first.getAttribute("aria-busy")).toBe("true");

    render(harness.root, "page-b", "<pre><code>second page</code></pre>");
    const current = required(harness.container.querySelector<HTMLButtonElement>("[data-reader-code-copy]"));
    current.focus();
    await act(async () => {
      finish?.();
      await Promise.resolve();
    });
    expect(current.textContent).toBe("Copy code");
    expect(current.disabled).toBe(false);
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("");
    expect(harness.dom.window.document.activeElement).toBe(current);
    await harness.unmount();
  });

  it("keeps the exact trigger focused and exposes only localized failure before retry", async () => {
    const harness = mount();
    const writeText = vi.fn()
      .mockRejectedValueOnce(new Error("PRIVATE CLIPBOARD FAILURE"))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(harness.dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    render(harness.root, "page-a", "<pre><code>safe code</code></pre>");
    const button = required(harness.container.querySelector<HTMLButtonElement>("[data-reader-code-copy]"));
    button.focus();
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(button.textContent).toBe("Copy failed — retry");
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe("Copy failed — retry");
    expect(harness.container.textContent).not.toContain("PRIVATE CLIPBOARD FAILURE");
    expect(harness.dom.window.document.activeElement).toBe(button);

    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(button.textContent).toBe("Copied");
    expect(harness.dom.window.document.activeElement).toBe(button);
    await harness.unmount();
  });
});

function mount(): { readonly dom: JSDOM; readonly container: HTMLDivElement; readonly root: Root; readonly unmount: () => Promise<void> } {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const root = createRoot(container);
  return { dom, container, root, unmount: async () => {
    await act(async () => root.unmount());
    dom.window.close();
  } };
}

function render(root: Root, pageIdentity: string, html: string): void {
  act(() => root.render(createElement(ReaderInlineReferenceSurface, {
    pageIdentity,
    html,
    onUnavailable: vi.fn(),
    t: (key: string) => labels[key] ?? key
  })));
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Required test value missing");
  return value;
}
