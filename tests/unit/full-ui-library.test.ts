import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryListResult, RetrievalSearchRequest, RetrievalSearchResult } from "@pige/contracts";
import { filterLibraryPages, LibraryPanel } from "../../apps/desktop/src/renderer/src/App";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "InputEvent",
  "Event",
  "MouseEvent",
  "KeyboardEvent"
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

describe("full UI Library", () => {
  it("filters real page summaries by title", () => {
    const pages = libraryList().pages;
    expect(filterLibraryPages(pages, "all", " interface ").map((page) => page.title)).toEqual([
      "Interface design"
    ]);
    expect(filterLibraryPages(pages, "all", "missing")).toEqual([]);
  });

  it("filters real page summaries by title and durable page type", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(),
        selectedNote: null,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onSearch: async () => searchResult("unused", []),
        searchFocusRequest: 0,
        onOpenNote: async () => undefined,
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Alpha plan");
    expect(container.textContent).toContain("Interface design");

    await act(async () => {
      buttonNamed(container, "Topics").click();
      await settle(dom);
    });
    expect(buttonNamed(container, "Topics").getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).not.toContain("Alpha plan");
    expect(container.textContent).toContain("Interface design");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("runs typed local search by family, opens stable page identity, and ignores stale results", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: RetrievalSearchRequest[] = [];
    const resolvers = new Map<string, (result: RetrievalSearchResult) => void>();
    const opened: string[] = [];
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(),
        selectedNote: null,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onSearch: (request) => {
          requests.push(request);
          return new Promise((resolve) => resolvers.set(request.query, resolve));
        },
        searchFocusRequest: 0,
        onOpenNote: async (pageId) => { opened.push(pageId); },
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const search = requireElement(container.querySelector<HTMLInputElement>("#librarySearchInput"));
    expect(search.maxLength).toBe(320);

    await act(async () => {
      buttonNamed(container, "Sources").click();
      await settle(dom);
    });
    await inputText(dom, search, "alpha");
    await act(async () => {
      await delay(dom, 150);
    });
    expect(requests).toEqual([{
      query: "alpha",
      limit: 20,
      pageTypes: ["source"],
      scope: { kind: "active_vault", vaultId: "vault_20260715_fullui01" }
    }]);

    await inputText(dom, search, "beta");
    await act(async () => {
      await delay(dom, 150);
    });
    expect(requests.at(-1)).toEqual({
      query: "beta",
      limit: 20,
      pageTypes: ["source"],
      scope: { kind: "active_vault", vaultId: "vault_20260715_fullui01" }
    });

    await act(async () => {
      resolvers.get("beta")?.(searchResult("beta", [{
        summary: sourcePage("page_20260715_beta2222", "Beta source"),
        score: 8,
        snippets: ["A current local result"],
        matchReasons: ["body"]
      }]));
      await settle(dom);
    });
    expect(container.textContent).toContain("Beta source");
    expect(container.textContent).toContain("Content match");
    expect(container.textContent).not.toContain("100%");
    expect(container.textContent).not.toContain("Alpha source");

    await act(async () => {
      resolvers.get("alpha")?.(searchResult("alpha", [{
        summary: sourcePage("page_20260715_alpha1111", "Alpha source"),
        score: 9,
        snippets: ["A stale local result"],
        matchReasons: ["title"]
      }]));
      await settle(dom);
    });
    expect(container.textContent).toContain("Beta source");
    expect(container.textContent).not.toContain("Alpha source");

    await act(async () => {
      buttonContaining(container, "Beta source").click();
      await settle(dom);
    });
    expect(opened).toEqual(["page_20260715_beta2222"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not search without an active vault", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const requests: RetrievalSearchRequest[] = [];
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: null,
        selectedNote: null,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onSearch: async (request) => {
          requests.push(request);
          return searchResult(request.query, []);
        },
        searchFocusRequest: 0,
        onOpenNote: async () => undefined,
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    const search = requireElement(container.querySelector<HTMLInputElement>("#librarySearchInput"));
    await inputText(dom, search, "alpha");
    await act(async () => {
      await delay(dom, 150);
    });
    expect(requests).toEqual([]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps errors body-free, retries with focus return, and marks Tags honestly unavailable", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let attempts = 0;
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(),
        selectedNote: null,
        selectedNoteRelated: null,
        noteLoadingPageId: null,
        error: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onSearch: async (request) => {
          attempts += 1;
          if (attempts === 1) throw new Error("raw vault path and database error");
          return searchResult(request.query, []);
        },
        searchFocusRequest: 0,
        onOpenNote: async () => undefined,
        onCloseNote: () => undefined,
        noteAgentOpen: false,
        onToggleNoteAgent: () => undefined,
        noteAgentToggleRef: { current: null },
        developmentNotice: null,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const search = requireElement(container.querySelector<HTMLInputElement>("#librarySearchInput"));
    await inputText(dom, search, "missing");
    await act(async () => {
      await delay(dom, 150);
    });
    await waitFor(dom, () => container.textContent?.includes("Search is temporarily unavailable") === true);
    expect(container.textContent).not.toContain("raw vault path and database error");

    await act(async () => {
      buttonNamed(container, "Refresh").click();
      await settle(dom);
    });
    await act(async () => {
      await delay(dom, 150);
    });
    expect(attempts).toBe(2);
    await waitFor(dom, () => container.textContent?.includes("No matching pages.") === true);
    await waitFor(dom, () => dom.window.document.activeElement === search);

    const beforeTags = attempts;
    await act(async () => {
      buttonNamed(container, "Tags").focus();
      buttonNamed(container, "Tags").dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true
      }));
      await settle(dom);
    });
    expect(buttonNamed(container, "All").getAttribute("aria-selected")).toBe("true");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "All"));

    await act(async () => {
      buttonNamed(container, "Tags").click();
      await settle(dom);
    });
    expect(container.textContent).toContain("Tag search is in development");
    expect(attempts).toBe(beforeTags);

    await act(async () => root.unmount());
    dom.window.close();
  });
});

function libraryList(): LibraryListResult {
  return {
    scannedAt: "2026-07-15T10:00:00.000Z",
    activeVaultId: "vault_20260715_fullui01",
    total: 2,
    invalidPageCount: 0,
    pages: [{
      pageId: "page_20260715_aaaa1111",
      title: "Alpha plan",
      pageType: "note",
      status: "active",
      pagePath: "wiki/alpha-plan.md",
      createdAt: "2026-07-15T10:00:00.000Z",
      updatedAt: "2026-07-15T10:00:00.000Z",
      language: "en",
      sourceIds: []
    }, {
      pageId: "page_20260715_bbbb2222",
      title: "Interface design",
      pageType: "topic",
      status: "active",
      pagePath: "wiki/interface-design.md",
      createdAt: "2026-07-15T10:00:00.000Z",
      updatedAt: "2026-07-15T10:00:00.000Z",
      language: "en",
      sourceIds: []
    }]
  };
}

function sourcePage(pageId: string, title: string): LibraryListResult["pages"][number] {
  return {
    pageId,
    title,
    pageType: "source",
    status: "active",
    pagePath: `sources/${pageId}.md`,
    createdAt: "2026-07-15T10:00:00.000Z",
    updatedAt: "2026-07-15T10:00:00.000Z",
    language: "en",
    sourceIds: []
  };
}

function searchResult(
  query: string,
  results: RetrievalSearchResult["results"]
): RetrievalSearchResult {
  return {
    searchedAt: "2026-07-15T10:00:00.000Z",
    activeVaultId: "vault_20260715_fullui01",
    query,
    mode: "lexical_sqlite_fts",
    total: results.length,
    invalidPageCount: 0,
    degraded: false,
    results
  };
}

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost"
  });
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
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(Date.now()), 0)
  });
  return dom;
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === name);
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function buttonContaining(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Missing button containing: ${text}`);
  return button;
}

async function inputText(dom: JSDOM, input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new dom.window.InputEvent("input", {
      bubbles: true,
      data: value,
      inputType: "insertText"
    }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle(dom);
  });
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Required element not found.");
  return value;
}

async function delay(dom: JSDOM, milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, milliseconds));
}

async function waitFor(dom: JSDOM, predicate: () => boolean, timeoutMs = 1_500): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for Library state.");
    await act(async () => delay(dom, 10));
  }
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}
