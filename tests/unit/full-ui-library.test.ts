import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  LibraryListResult,
  NoteRenderResult,
  ReaderSelectionActionRequest,
  ReaderSelectionActionResult,
  ReaderSelectionResolveRequest,
  ReaderSelectionResolveResult,
  ReaderSelectionTransformRequest,
  ReaderSelectionTransformResult,
  RetrievalSearchRequest,
  RetrievalSearchResult
} from "@pige/contracts";
import { filterLibraryPages, LibraryPanel, NoteReader } from "../../apps/desktop/src/renderer/src/App";
import type { ReaderInlineReferenceActivation } from "../../apps/desktop/src/renderer/src/components/ReaderInlineReferenceSurface";
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
  it("lets the selection menu escape its toolbar while the menu owns internal scrolling", () => {
    const styles = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/styles/app.css"),
      "utf8"
    );
    const toolbarRule = styles.match(/\.selection-toolbar\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    const menuRule = styles.match(/\.selection-more-menu\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    expect(toolbarRule).toContain("overflow: visible");
    expect(menuRule).toContain("overflow: auto");
  });

  it("keeps inline-reference feedback out of the Reader document flow", () => {
    const styles = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/styles/app.css"),
      "utf8"
    );
    const feedbackRule = styles.match(/\.reader-inline-reference-feedback\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
    expect(feedbackRule).toContain("position: fixed");
    expect(feedbackRule).toContain("top: calc(var(--titlebar-height) + 12px)");
    expect(feedbackRule).toContain("transform: translateX(-50%)");
    expect(feedbackRule).toContain("pointer-events: none");
    expect(feedbackRule).toContain("margin: 0");
    expect(feedbackRule).not.toContain("margin: 0 0");
  });

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

  it("binds the approved Reader toolbar to real copy and keeps unowned actions honest", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const copied: string[] = [];
    const unavailable: string[] = [];
    let cleared = 0;
    const note = readerNote();
    await act(async () => {
      root.render(createElement(LibraryPanel, {
        libraryList: libraryList(),
        selectedNote: note,
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
        onClearDevelopment: () => { cleared += 1; },
        onCopyNote: async (pageId) => { copied.push(pageId); return true; },
        onDevelopment: (capability) => unavailable.push(capability),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;

    await act(async () => {
      buttonWithLabel(container, "Copy Markdown").click();
      await settle(dom);
    });
    expect(copied).toEqual([note.summary.pageId]);
    expect(container.textContent).toContain("Markdown copied.");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    await act(async () => {
      buttonWithLabel(container, "Edit note").click();
      await settle(dom);
    });
    expect(unavailable).toEqual(["document_actions"]);
    expect(cleared).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("Markdown copied.");

    const sourceButtons = container.querySelectorAll<HTMLButtonElement>(".reader-source");
    expect(sourceButtons).toHaveLength(2);
    expect(container.textContent).toContain("Saved source 1");
    expect(container.textContent).not.toContain("source_private_0001");
    expect(container.textContent).not.toContain("/Users/example/private.md");
    await act(async () => {
      sourceButtons[0]!.click();
      await settle(dom);
    });
    expect(unavailable.at(-1)).toBe("source_reference");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("renders one page title when Markdown repeats the exact frontmatter title", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const matchingTitleNote = {
      ...readerNote(),
      html: "<h1>  Reader <em>actions</em> </h1><p>Selected note body</p>"
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: matchingTitleNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector(".note-header h1")?.textContent).toBe("Reader actions");
    expect(container.querySelector(".markdown-body > h1")?.classList.contains("reader-duplicate-title")).toBe(true);

    await act(async () => {
      root.render(createElement(NoteReader, {
        note: matchingTitleNote,
        related: "unavailable",
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    expect(container.querySelector(".markdown-body > h1")?.classList.contains("reader-duplicate-title")).toBe(true);

    const distinctHeadingNote = {
      ...matchingTitleNote,
      html: "<h1>Implementation details</h1><p>Selected note body</p>"
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: distinctHeadingNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    expect(container.querySelector(".markdown-body > h1")?.classList.contains("reader-duplicate-title")).toBe(false);
    expect(container.querySelector(".markdown-body > h1")?.textContent).toBe("Implementation details");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fails closed for unresolved internal Reader links without mutating the window hash", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const unavailable: string[] = [];
    const linkedNote = {
      ...readerNote(),
      html: [
        '<p><a href="#wiki:page_20260715_link1111"><em>Linked note</em></a></p>',
        '<p><a href="#source:src_20260715_link2222#source">Saved source</a></p>',
        '<p><a href="#section">Local section</a></p>'
      ].join("")
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: linkedNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: (capability) => unavailable.push(capability),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const internalLinks = Array.from(container.querySelectorAll<HTMLAnchorElement>(
      '.markdown-body a[data-reader-link-state="unavailable"]'
    ));
    expect(internalLinks).toHaveLength(2);
    const descriptionId = internalLinks[0]!.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(internalLinks[1]!.getAttribute("aria-describedby")).toBe(descriptionId);
    const description = dom.window.document.getElementById(descriptionId!);
    expect(description?.hidden).toBe(true);
    expect(description?.textContent).toContain(
      "Opening linked notes and sources is temporarily unavailable"
    );

    const originalUrl = dom.window.location.href;
    const wikiClick = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      requireElement(internalLinks[0]!.querySelector("em")).dispatchEvent(wikiClick);
      await settle(dom);
    });
    expect(wikiClick.defaultPrevented).toBe(true);
    expect(dom.window.location.href).toBe(originalUrl);
    expect(unavailable).toEqual(["reader_link"]);

    internalLinks[1]!.focus();
    const keyboardClick = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 });
    await act(async () => {
      internalLinks[1]!.dispatchEvent(keyboardClick);
      await settle(dom);
    });
    expect(keyboardClick.defaultPrevented).toBe(true);
    expect(dom.window.document.activeElement).toBe(internalLinks[1]);
    expect(dom.window.location.href).toBe(originalUrl);
    expect(unavailable).toEqual(["reader_link", "reader_link"]);

    const sourceAuxClick = new dom.window.MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    await act(async () => {
      internalLinks[1]!.dispatchEvent(sourceAuxClick);
      await settle(dom);
    });
    expect(sourceAuxClick.defaultPrevented).toBe(true);
    expect(dom.window.location.href).toBe(originalUrl);
    expect(unavailable).toEqual(["reader_link", "reader_link", "reader_link"]);

    const localSection = requireElement(container.querySelector<HTMLAnchorElement>('a[href="#section"]'));
    expect(localSection.hasAttribute("data-reader-link-state")).toBe(false);
    expect(localSection.hasAttribute("aria-describedby")).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("serializes typed inline-reference activation and keeps one body-free status owner", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const linkedNote = {
      ...readerNote(),
      html: [
        '<p><a href="#wiki:page_20260715_link1111"><em>Linked note</em></a></p>',
        '<p><a href="#source:src_20260715_link2222#source">Saved source</a></p>',
        '<p><a href="#section">Local section</a></p>'
      ].join("")
    };
    const pending = deferred<ReaderInlineReferenceActivation>();
    const calls: string[] = [];
    let next: Promise<ReaderInlineReferenceActivation> = pending.promise;
    const onActivate = (href: string): Promise<ReaderInlineReferenceActivation> => {
      calls.push(href);
      return next;
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: linkedNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        onActivateInlineReference: onActivate,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>(
      '.markdown-body a[data-reader-link-state="ready"]'
    ));
    expect(links).toHaveLength(2);
    expect(dom.window.document.getElementById(links[0]!.getAttribute("aria-describedby")!)?.textContent)
      .toBe("Open this linked local note or source.");

    links[0]!.focus();
    const firstClick = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      requireElement(links[0]!.querySelector("em")).dispatchEvent(firstClick);
      await settle(dom);
    });
    expect(firstClick.defaultPrevented).toBe(true);
    expect(calls).toEqual(["#wiki:page_20260715_link1111"]);
    expect(links[0]!.dataset.readerLinkState).toBe("resolving");
    expect(links[0]!.getAttribute("aria-busy")).toBe("true");
    expect(links[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(container.querySelectorAll('[data-reader-reference-feedback="resolving"]')).toHaveLength(1);

    await act(async () => {
      links[0]!.click();
      links[1]!.click();
      await settle(dom);
    });
    expect(calls).toHaveLength(1);
    expect(links[1]!.dataset.readerLinkState).toBe("resolving");
    expect(links[1]!.getAttribute("aria-disabled")).toBe("true");
    expect(links[1]!.hasAttribute("aria-busy")).toBe(false);

    await act(async () => {
      pending.resolve("ambiguous");
      await pending.promise;
      await settle(dom);
    });
    const ambiguous = requireElement(container.querySelector<HTMLElement>(
      '[data-reader-reference-feedback="ambiguous"]'
    ));
    expect(ambiguous.textContent).toBe("More than one local item matches this reference. Nothing was opened.");
    expect(ambiguous.textContent).not.toContain("page_20260715_link1111");
    expect(ambiguous.textContent).not.toContain("#wiki:");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(links[0]!.dataset.readerLinkState).toBe("ambiguous");
    expect(links[0]!.hasAttribute("aria-busy")).toBe(false);
    expect(dom.window.document.activeElement).toBe(links[0]);

    for (const [outcome, message] of [
      ["not_found", "The linked local item could not be found."],
      ["stale", "The note changed while this reference was checked. Try again."],
      ["failed", "This reference could not be opened. Try again."]
    ] as const) {
      next = Promise.resolve(outcome);
      await act(async () => {
        links[0]!.click();
        await settle(dom);
      });
      const status = requireElement(container.querySelector<HTMLElement>(
        `[data-reader-reference-feedback="${outcome}"]`
      ));
      expect(status.textContent).toBe(message);
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(links[0]!.dataset.readerLinkState).toBe(outcome);
    }

    next = Promise.reject(new Error("private resolver body"));
    await act(async () => {
      links[0]!.click();
      await settle(dom);
    });
    expect(container.textContent).not.toContain("private resolver body");
    expect(container.querySelectorAll('[data-reader-reference-feedback="failed"]')).toHaveLength(1);

    next = Promise.resolve("opened_source");
    await act(async () => {
      links[1]!.click();
      await settle(dom);
    });
    expect(calls.at(-1)).toBe("#source:src_20260715_link2222#source");
    expect(container.querySelector('[data-reader-reference-feedback]')).toBeNull();
    expect(links[0]!.dataset.readerLinkState).toBe("ready");
    expect(links[1]!.dataset.readerLinkState).toBe("ready");
    expect(container.querySelector<HTMLAnchorElement>('a[href="#section"]')?.dataset.readerLinkState).toBeUndefined();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("drops an old inline-reference result after the Reader render context changes", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const oldResult = deferred<ReaderInlineReferenceActivation>();
    const calls: string[] = [];
    const onActivate = (href: string): Promise<ReaderInlineReferenceActivation> => {
      calls.push(href);
      return oldResult.promise;
    };
    const oldNote = {
      ...readerNote(),
      renderContextId: `notectx_${"a".repeat(32)}`,
      html: '<p><a href="#wiki:page_20260715_old11111">Old note</a></p>'
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: oldNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        onActivateInlineReference: onActivate,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const oldLink = requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:page_20260715_old11111"]'));
    await act(async () => {
      oldLink.click();
      await settle(dom);
    });
    expect(calls).toEqual(["#wiki:page_20260715_old11111"]);
    expect(requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:page_20260715_old11111"]'))
      .dataset.readerLinkState).toBe("resolving");

    const nextNote = {
      ...readerNote(),
      renderContextId: `notectx_${"b".repeat(32)}`,
      html: '<p><a href="#wiki:page_20260715_new22222">New note</a></p>'
    };
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: nextNote,
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        onActivateInlineReference: onActivate,
        t
      }));
      await settle(dom);
    });
    const newLink = requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:page_20260715_new22222"]'));
    expect(newLink.dataset.readerLinkState).toBe("ready");
    expect(container.querySelector('[data-reader-reference-feedback]')).toBeNull();

    await act(async () => {
      oldResult.resolve("not_found");
      await oldResult.promise;
      await settle(dom);
    });
    expect(calls).toEqual(["#wiki:page_20260715_old11111"]);
    expect(newLink.dataset.readerLinkState).toBe("ready");
    expect(container.querySelector('[data-reader-reference-feedback]')).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("rejects an invalid internal href locally without navigation or resolver IPC", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const href = `#wiki:${"x".repeat(1_024)}`;
    const calls: string[] = [];
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: { ...readerNote(), html: `<p><a href="${href}">Invalid local reference</a></p>` },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        onActivateInlineReference: async (value) => {
          calls.push(value);
          return "opened_page";
        },
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const link = requireElement(container.querySelector<HTMLAnchorElement>('a[href^="#wiki:"]'));
    const originalUrl = dom.window.location.href;
    const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => {
      link.dispatchEvent(click);
      await settle(dom);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(calls).toEqual([]);
    expect(dom.window.location.href).toBe(originalUrl);
    expect(link.dataset.readerLinkState).toBe("failed");
    expect(container.textContent).toContain("This reference could not be opened. Try again.");
    expect(container.textContent).not.toContain(href);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("submits only exact render identity and keeps unresolved or stale selections copy-only", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const first = deferred<ReaderSelectionResolveResult>();
    const requests: ReaderSelectionResolveRequest[] = [];
    const actionRequests: ReaderSelectionActionRequest[] = [];
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        activeVaultId: "vault_20260715_fullui01",
        onResolveSelection: async (request) => {
          requests.push(request);
          if (requests.length === 1) return first.promise;
          if (requests.length === 2) return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "invalid",
            reason: "unsupported_content"
          };
          return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "resolved",
            selection: {
              pageId: request.currentPageId,
              pageContentHash: `sha256:${"a".repeat(64)}`,
              span: { unit: "utf8_bytes", start: 1, endExclusive: 9 },
              selectedContentHash: `sha256:${"b".repeat(64)}`
            }
          };
        },
        onSubmitSelectionAction: async (request) => {
          actionRequests.push(request);
          return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "completed",
            jobId: "job_20260718_selection01",
            conversationEventId: "evt_20260718_selection01",
            conversationId: "conv_20260718_selection01",
            tailEventId: "evt_20260718_selection02"
          };
        },
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    let revision = 1;
    Object.defineProperty(dom.window, "getSelection", {
      configurable: true,
      value: () => ({
        isCollapsed: false,
        rangeCount: 1,
        anchorNode: selectionNode,
        anchorOffset: revision - 1,
        focusNode: selectionNode,
        focusOffset: revision + 7,
        toString: () => `private selected body ${revision}`,
        getRangeAt: () => ({
          commonAncestorContainer: paragraph,
          startContainer: selectionNode,
          startOffset: revision - 1,
          endContainer: selectionNode,
          endOffset: revision + 7,
          getBoundingClientRect: () => ({
            left: 80 + revision,
            top: 90,
            width: 120,
            height: 18,
            right: 200 + revision,
            bottom: 108
          })
        })
      })
    });

    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => requests.length === 1);
    expect(requests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_20260715_fullui01",
      currentPageId: "page_20260715_reader1111",
      renderContextId: `notectx_${"c".repeat(32)}`,
      anchor: { segmentId: "readerseg_aaaaaaaaaaaaaaaa", utf16Offset: 0 },
      focus: { segmentId: "readerseg_aaaaaaaaaaaaaaaa", utf16Offset: 8 }
    });
    expect(JSON.stringify(requests[0])).not.toContain("private selected body");
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('[role="toolbar"] > button')).map((button) => button.dataset.selectionAction))
      .toEqual(["copy", "copyAsQuote"]);

    revision = 2;
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => requests.length === 2);
    await waitFor(dom, () => container.querySelector('[data-selection-action="more"]') === null);
    await act(async () => {
      first.resolve({
        apiVersion: 1,
        requestId: requests[0]!.requestId,
        status: "resolved",
        selection: {
          pageId: requests[0]!.currentPageId,
          pageContentHash: `sha256:${"a".repeat(64)}`,
          span: { unit: "utf8_bytes", start: 0, endExclusive: 8 },
          selectedContentHash: `sha256:${"b".repeat(64)}`
        }
      });
      await first.promise;
      await settle(dom);
    });
    expect(container.querySelector('[data-selection-action="more"]')).toBeNull();

    revision = 3;
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => requests.length === 3);
    await waitFor(dom, () => container.querySelector('[data-selection-action="more"]') !== null);
    await act(async () => {
      requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="explain"]')).click();
      await settle(dom);
    });
    expect(actionRequests).toHaveLength(1);
    expect(actionRequests[0]).toMatchObject({
      apiVersion: 1,
      action: "explain",
      locale: "en",
      selection: {
        pageId: "page_20260715_reader1111",
        span: { unit: "utf8_bytes", start: 1, endExclusive: 9 }
      }
    });
    expect(actionRequests[0]!.requestId).toMatch(/^readerselaction_[a-z0-9]{8,64}$/u);
    expect(actionRequests[0]!.clientTurnId).toMatch(/^turn_\d{8}_[a-z0-9]{12,64}$/u);
    expect(JSON.stringify(actionRequests[0])).not.toContain("private selected body");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("measures compact selection actions, dismisses on scroll, and restores exact focus ownership", async () => {
    const dom = createDom();
    Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 360 });
    Object.defineProperty(dom.window, "innerHeight", { configurable: true, value: 240 });
    const focusOwner = dom.window.document.createElement("button");
    focusOwner.textContent = "Reader focus owner";
    dom.window.document.body.prepend(focusOwner);
    focusOwner.focus();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const unavailable: string[] = [];
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        ...resolvedSelectionProps(),
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: (capability) => unavailable.push(capability),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    const originalBoundingClientRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
    dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      if ((this as HTMLElement).classList.contains("selection-toolbar")) {
        return {
          left: 0,
          top: 0,
          width: 330,
          height: 84,
          right: 330,
          bottom: 84,
          x: 0,
          y: 0,
          toJSON: () => ({})
        } as DOMRect;
      }
      return originalBoundingClientRect.call(this);
    };
    let selectionCollapsed = false;
    Object.defineProperty(dom.window, "getSelection", {
      configurable: true,
      value: () => ({
        isCollapsed: selectionCollapsed,
        rangeCount: selectionCollapsed ? 0 : 1,
        anchorNode: selectionNode,
        anchorOffset: 0,
        focusNode: selectionNode,
        focusOffset: 8,
        getRangeAt: () => ({
          commonAncestorContainer: paragraph,
          startContainer: selectionNode,
          startOffset: 0,
          endContainer: selectionNode,
          endOffset: 8,
          getBoundingClientRect: () => ({ left: 330, top: 15, width: 20, height: 18, right: 350, bottom: 33 })
        })
      })
    });
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector<HTMLElement>('[role="toolbar"]')?.style.left === "18px");

    let toolbar = requireElement(container.querySelector<HTMLElement>('[role="toolbar"]'));
    let actions = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
    expect(toolbar.style.left).toBe("18px");
    expect(toolbar.style.top).toBe("41px");
    expect(actions.map((button) => button.textContent)).toEqual(["Explain", "Summarize", "Link", "More"]);
    expect(actions.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1]);
    actions[0]!.focus();
    await act(async () => {
      toolbar.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(actions[1]);
    expect(actions.map((button) => button.tabIndex)).toEqual([-1, 0, -1, -1]);

    await act(async () => {
      toolbar.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[role="toolbar"]') === null);
    await waitFor(dom, () => dom.window.document.activeElement === focusOwner);

    focusOwner.focus();
    await act(async () => {
      selectionCollapsed = true;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      selectionCollapsed = false;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector<HTMLElement>('[role="toolbar"]')?.style.left === "18px");
    toolbar = requireElement(container.querySelector<HTMLElement>('[role="toolbar"]'));
    actions = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
    const pointerDown = new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    await act(async () => {
      actions[1]!.dispatchEvent(pointerDown);
      actions[1]!.click();
      await settle(dom);
    });
    expect(pointerDown.defaultPrevented).toBe(true);
    await waitFor(dom, () => dom.window.document.activeElement === focusOwner);
    expect(unavailable).toEqual([]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Opened in Note Agent.");
    expect(container.querySelector('[role="toolbar"]')).toBeNull();

    focusOwner.focus();
    await act(async () => {
      selectionCollapsed = true;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      selectionCollapsed = false;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[role="toolbar"]') !== null);
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event("scroll"));
      await settle(dom);
    });
    expect(container.querySelector('[role="toolbar"]')).toBeNull();

    focusOwner.remove();
    await act(async () => {
      selectionCollapsed = true;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      selectionCollapsed = false;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    toolbar = requireElement(container.querySelector<HTMLElement>('[role="toolbar"]'));
    await act(async () => {
      toolbar.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector(".note-reader"));

    await act(async () => root.unmount());
    dom.window.HTMLElement.prototype.getBoundingClientRect = originalBoundingClientRect;
    dom.window.close();
  });

  it("keeps Copy and quoted Copy local while More owns its keyboard and body-free status", async () => {
    const dom = createDom();
    const clipboardWrites: string[] = [];
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          clipboardWrites.push(value);
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const unavailable: string[] = [];
    const transformRequests: ReaderSelectionTransformRequest[] = [];
    const transformResults: ReaderSelectionTransformResult[] = [];
    await act(async () => {
      root.render(createElement(NoteReader, {
        note: readerNote(),
        ...resolvedSelectionProps(),
        onSubmitSelectionTransform: async (request) => {
          transformRequests.push(request);
          return {
            apiVersion: 1,
            requestId: request.requestId,
            status: "review_required",
            jobId: "job_20260718_transform01",
            conversationEventId: "evt_20260718_transform01",
            conversationId: "conv_20260718_transform01",
            tailEventId: "evt_20260718_transform01",
            proposal: {
              proposalId: "proposal_20260718_transform01",
              action: request.action,
              state: "ready",
              revision: 1,
              lines: [{ kind: "added", text: "Reviewed replacement" }]
            }
          };
        },
        onSelectionTransformResult: (result) => transformResults.push(result),
        related: null,
        relatedLoadingPageId: null,
        onOpenRelated: async () => undefined,
        onDevelopment: (capability) => unavailable.push(capability),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    const originalBoundingClientRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
    dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      if ((this as HTMLElement).classList.contains("selection-toolbar")) {
        return {
          left: 40, top: 40, width: 220, height: 34, right: 260, bottom: 74,
          x: 40, y: 40, toJSON: () => ({})
        } as DOMRect;
      }
      if ((this as HTMLElement).classList.contains("selection-more-menu")) {
        return {
          left: 84, top: 80, width: 176, height: 172, right: 260, bottom: 252,
          x: 84, y: 80, toJSON: () => ({})
        } as DOMRect;
      }
      return originalBoundingClientRect.call(this);
    };
    let collapsed = false;
    Object.defineProperty(dom.window, "getSelection", {
      configurable: true,
      value: () => ({
        isCollapsed: collapsed,
        rangeCount: collapsed ? 0 : 1,
        anchorNode: selectionNode,
        anchorOffset: 0,
        focusNode: selectionNode,
        focusOffset: 8,
        toString: () => "Selected first line\nSelected second line",
        getRangeAt: () => ({
          commonAncestorContainer: paragraph,
          startContainer: selectionNode,
          startOffset: 0,
          endContainer: selectionNode,
          endOffset: 8,
          getBoundingClientRect: () => ({ left: 90, top: 100, width: 120, height: 18, right: 210, bottom: 118 })
        })
      })
    });

    const showSelection = async (): Promise<void> => {
      await act(async () => {
        collapsed = true;
        dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
        collapsed = false;
        dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
        await settle(dom);
      });
      await waitFor(dom, () => container.querySelector('[role="toolbar"]') !== null);
    };

    await showSelection();
    let more = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]'));
    await act(async () => {
      more.click();
      collapsed = true;
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      collapsed = false;
      await settle(dom);
    });
    let menu = requireElement(container.querySelector<HTMLElement>('[role="menu"]'));
    const menuItems = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(menuItems.map((item) => item.dataset.selectionMoreAction)).toEqual([
      "copy", "copyAsQuote", "translate", "polish", "expand"
    ]);
    expect(dom.window.document.activeElement).toBe(menuItems[0]);
    await act(async () => {
      menu.dispatchEvent(new dom.window.Event("scroll"));
      await settle(dom);
    });
    expect(container.querySelector('[role="menu"]')).toBe(menu);
    await act(async () => {
      menu.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(menuItems[1]);
    await act(async () => {
      menu.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector('[data-selection-action="more"]'));
    more = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]'));

    await act(async () => {
      more.click();
      await settle(dom);
    });
    menu = requireElement(container.querySelector<HTMLElement>('[role="menu"]'));
    await act(async () => {
      requireElement(menu.querySelector<HTMLButtonElement>('[data-selection-more-action="copy"]')).click();
      await settle(dom);
    });
    expect(clipboardWrites).toEqual(["Selected first line\nSelected second line"]);
    expect(unavailable).toEqual([]);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Copied.");

    await showSelection();
    more = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]'));
    await act(async () => {
      more.click();
      await settle(dom);
      requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="copyAsQuote"]')).click();
      await settle(dom);
    });
    expect(clipboardWrites).toEqual([
      "Selected first line\nSelected second line",
      "> Selected first line\n> Selected second line"
    ]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Quote copied.");

    await showSelection();
    more = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]'));
    await act(async () => {
      more.click();
      await settle(dom);
      requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="translate"]')).click();
      await settle(dom);
    });
    expect(transformRequests).toHaveLength(1);
    expect(transformRequests[0]).toMatchObject({
      apiVersion: 1,
      action: "translate",
      locale: "en",
      selection: {
        pageId: "page_20260715_reader1111",
        span: { unit: "utf8_bytes", start: 0, endExclusive: 8 }
      }
    });
    expect(transformResults[0]?.status).toBe("review_required");
    expect(unavailable).toEqual([]);
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Review the proposed change in Note Agent.");

    await act(async () => root.unmount());
    dom.window.HTMLElement.prototype.getBoundingClientRect = originalBoundingClientRect;
    dom.window.close();
  });
});

function readerNote(): NoteRenderResult {
  return {
    summary: {
      pageId: "page_20260715_reader1111",
      title: "Reader actions",
      pageType: "note",
      status: "active",
      pagePath: "wiki/reader-actions.md",
      createdAt: "2026-07-15T10:00:00.000Z",
      updatedAt: "2026-07-15T10:00:00.000Z",
      language: "en",
      sourceIds: ["source_private_0001", "source_private_0002"]
    },
    html: '<p><span data-pige-selection-segment="readerseg_aaaaaaaaaaaaaaaa">Selected note body</span></p>',
    renderContextId: `notectx_${"c".repeat(32)}`,
    byteSize: 256
  };
}

function resolvedSelectionProps(): {
  readonly activeVaultId: string;
  readonly onResolveSelection: (request: ReaderSelectionResolveRequest) => Promise<ReaderSelectionResolveResult>;
  readonly onSubmitSelectionAction: (request: ReaderSelectionActionRequest) => Promise<ReaderSelectionActionResult>;
} {
  return {
    activeVaultId: "vault_20260715_fullui01",
    onResolveSelection: async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "resolved",
      selection: {
        pageId: request.currentPageId,
        pageContentHash: `sha256:${"a".repeat(64)}`,
        span: { unit: "utf8_bytes", start: 0, endExclusive: 8 },
        selectedContentHash: `sha256:${"b".repeat(64)}`
      }
    }),
    onSubmitSelectionAction: async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "completed",
      jobId: "job_20260718_selection01",
      conversationEventId: "evt_20260718_selection01",
      conversationId: "conv_20260718_selection01",
      tailEventId: "evt_20260718_selection02"
    })
  };
}

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
  Object.defineProperty(dom.window, "cancelAnimationFrame", {
    configurable: true,
    value: (handle: number) => dom.window.clearTimeout(handle)
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

function buttonWithLabel(container: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Missing button with label: ${label}`);
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

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}
