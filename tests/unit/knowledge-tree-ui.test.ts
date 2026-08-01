import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { KnowledgeTreeResult, LibraryRelatedResult } from "@pige/contracts";
import { KnowledgeTreePanel } from "../../apps/desktop/src/renderer/src/App";
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
  "MouseEvent"
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

describe("Knowledge Tree renderer", () => {
  it("renders deterministic accessible weight and density semantics with source-backed navigation", async () => {
    const dom = createDom();
    const opened: Array<{ readonly pageId: string; readonly focusKey: string }> = [];
    const mount = await mountTree(dom, readyTree(), async (pageId, focusKey) => {
      opened.push({ pageId, focusKey });
    });

    expect(mount.container.querySelector("#knowledge-tree-heading")?.textContent).toBe("Knowledge Tree");
    expect(mount.container.textContent).toContain("Domains: 1");
    expect(mount.container.textContent).toContain("Fragments: 2");

    const tree = mount.container.querySelector<SVGElement>('svg[role="tree"]');
    expect(tree?.getAttribute("aria-label")).toBe("Knowledge Tree");
    const rootNode = treeItemNamed(mount.container, "Local-first");
    expect(rootNode.getAttribute("aria-level")).toBe("2");
    expect(rootNode.getAttribute("aria-selected")).toBe("true");
    expect(rootNode.getAttribute("tabindex")).toBe("0");
    expect(rootNode.getAttribute("aria-description")).toBe(
      "Local-first. Weight 9. 2 fragments, 3 sources, 5 leaves. Evidence density 5."
    );
    expect(rootNode.dataset.knowledgeDensity).toBe("5");
    expect(rootNode.dataset.knowledgeLeafCount).toBe("5");
    expect(rootNode.classList.contains("density-2")).toBe(true);
    const meter = mount.container.querySelector<HTMLMeterElement>("meter.knowledge-tree-weight");
    expect(meter?.value).toBe(9);
    expect(meter?.max).toBe(9);
    expect(meter?.getAttribute("aria-label")).toBe("Weight: 9");
    expect(mount.container.textContent).toContain("Weight: 9");
    expect(mount.container.textContent).toContain("Sources: 3");
    expect(mount.container.textContent).toContain("Leaves 5");
    expect(mount.container.textContent).toContain("Evidence density 5");

    const moreActions = buttonNamed(mount.container, "More Knowledge Tree actions");
    expect(moreActions.dataset.knowledgeAction).toBe("more");
    await click(dom, moreActions);
    expect(mount.container.querySelector("#knowledge-map-status")?.textContent)
      .toBe("This Knowledge Tree action is not available.");
    expect(opened).toEqual([]);

    const personalKnowledge = treeItemNamed(mount.container, "Personal knowledge");
    await click(dom, personalKnowledge);
    const openUnavailableTopic = buttonNamed(mount.container, "Open");
    expect(openUnavailableTopic.dataset.knowledgeAction).toBe("open-topic");
    await click(dom, openUnavailableTopic);
    expect(mount.container.querySelector("#knowledge-map-status")?.textContent)
      .toBe("This Knowledge Tree action is not available.");
    expect(opened).toEqual([]);

    const topicNode = treeItemNamed(mount.container, "Local RAG");
    await click(dom, topicNode);
    expect(topicNode.getAttribute("aria-selected")).toBe("true");
    expect(treeItemNamed(mount.container, "Lexical retrieval")).toBeTruthy();
    expect(treeItemNamed(mount.container, "Source evidence")).toBeTruthy();
    expect(mount.container.textContent).not.toContain("src_private_internal_01");

    const conceptNode = treeItemNamed(mount.container, "Lexical retrieval");
    expect(conceptNode.dataset.knowledgeDensity).toBe("1");
    expect(conceptNode.dataset.knowledgeLeafCount).toBe("1");
    expect(conceptNode.classList.contains("density-1")).toBe(true);
    await click(dom, conceptNode);
    expect(conceptNode.getAttribute("aria-selected")).toBe("true");
    const openConcept = buttonNamed(mount.container, "Open");
    expect(openConcept.dataset.knowledgeOpenKey).toBe("root-0-child-0-child-0-node");
    await click(dom, openConcept);
    expect(opened).toEqual([{
      pageId: "page_20260713_concept01",
      focusKey: "root-0-child-0-child-0-node"
    }]);

    const listMode = buttonNamed(mount.container, "List view");
    await click(dom, listMode);
    expect(listMode.getAttribute("aria-pressed")).toBe("true");
    expect(mount.container.querySelector(".knowledge-map-status")?.textContent).toBe("Fine-grained leaf nodes hidden");
    expect(conceptNode.getAttribute("aria-hidden")).toBe("true");
    expect(conceptNode.getAttribute("tabindex")).toBe("-1");
    expect(topicNode.getAttribute("aria-selected")).toBe("true");

    const networkMode = buttonNamed(mount.container, "Relationship view");
    await click(dom, networkMode);
    expect(networkMode.getAttribute("aria-pressed")).toBe("true");
    expect(mount.container.querySelector(".knowledge-map-status")?.textContent).toBe("Node relationships emphasized");
    expect(conceptNode.getAttribute("aria-hidden")).toBe("false");

    const treeMode = buttonNamed(mount.container, "Tree view");
    await click(dom, treeMode);
    expect(treeMode.getAttribute("aria-pressed")).toBe("true");
    expect(mount.container.querySelector(".knowledge-map-status")?.textContent).toBe("Tree layout restored");

    const search = mount.container.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error("Missing Knowledge Tree search.");
    await inputText(dom, search, "Lexical");
    expect(rootNode.getAttribute("aria-hidden")).toBe("false");
    expect(rootNode.classList.contains("is-dimmed")).toBe(true);
    expect(conceptNode.getAttribute("aria-hidden")).toBe("false");
    expect(mount.container.querySelector(".knowledge-map-status")?.textContent).toBe("1 matching knowledge units");
    await inputText(dom, search, "");

    const filter = buttonNamed(mount.container, "Show nodes that need review");
    await click(dom, filter);
    expect(filter.getAttribute("aria-pressed")).toBe("true");
    expect(topicNode.getAttribute("aria-hidden")).toBe("true");
    expect(topicNode.getAttribute("tabindex")).toBe("-1");
    const personalRoot = treeItemNamed(mount.container, "Personal knowledge");
    expect(personalRoot.getAttribute("aria-selected")).toBe("true");
    expect(personalRoot.getAttribute("tabindex")).toBe("0");
    await click(dom, filter);
    expect(filter.getAttribute("aria-pressed")).toBe("false");

    const treeItems = Array.from(mount.container.querySelectorAll<SVGGElement>('[role="treeitem"]'));
    expect(treeItems.filter((item) => item.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(treeItems.every((item) => ["0", "-1"].includes(item.getAttribute("tabindex") ?? ""))).toBe(true);
    for (const button of mount.container.querySelectorAll<HTMLButtonElement>("button")) expect(button.tabIndex).toBeGreaterThanOrEqual(0);

    await unmount(dom, mount.root);
  });

  it("deepens dense evidence leaves and outlines review-needed growth without hiding exact counts", async () => {
    const dom = createDom();
    const base = readyTree();
    const domain = base.roots[0]!;
    const topic = domain.children[0]!;
    const concept = topic.children[0]!;
    const denseConcept = {
      ...concept,
      status: "needs_review" as const,
      metrics: {
        ...concept.metrics,
        fragmentPageCount: 6,
        sourceCount: 4,
        leafCount: 10,
        weight: 11
      }
    };
    const tree = {
      ...base,
      roots: [{
        ...domain,
        children: [{ ...topic, children: [denseConcept, ...topic.children.slice(1)] }]
      }]
    };
    const mount = await mountTree(dom, tree, async () => undefined);
    const dense = treeItemNamed(mount.container, "Lexical retrieval");
    const sparse = treeItemNamed(mount.container, "Source evidence");

    expect(dense.dataset.knowledgeDensity).toBe("10");
    expect(dense.dataset.knowledgeLeafCount).toBe("10");
    expect(dense.classList.contains("density-3")).toBe(true);
    expect(dense.classList.contains("needs-review")).toBe(true);
    expect(Number(dense.querySelector("circle:not(.knowledge-map-pulse)")?.getAttribute("r")))
      .toBeGreaterThan(Number(sparse.querySelector("circle:not(.knowledge-map-pulse)")?.getAttribute("r")));
    expect(dense.getAttribute("aria-description")).toContain("6 fragments, 4 sources, 10 leaves. Evidence density 10.");
    expect(dense.getAttribute("aria-description")).toContain("Needs review.");

    await unmount(dom, mount.root);
  });

  it("adopts related pages only for the exact selected navigable node and opens returned page identities", async () => {
    const dom = createDom();
    const requests: string[] = [];
    const pending = new Map<string, ReturnType<typeof deferred<LibraryRelatedResult>>>();
    const opened: Array<{ readonly pageId: string; readonly focusKey: string }> = [];
    const mount = await mountTree(
      dom,
      readyTree(),
      async (pageId, focusKey) => { opened.push({ pageId, focusKey }); },
      (pageId) => {
        requests.push(pageId);
        if (pageId === "page_20260713_note0001") return Promise.reject(new Error("private index failure"));
        const request = deferred<LibraryRelatedResult>();
        pending.set(pageId, request);
        return request.promise;
      }
    );
    expect(requests).toEqual(["page_20260713_domain01"]);
    expect(mount.container.textContent).toContain("Loading related pages…");

    await click(dom, treeItemNamed(mount.container, "Local RAG"));
    await click(dom, treeItemNamed(mount.container, "Lexical retrieval"));
    expect(requests).toEqual([
      "page_20260713_domain01",
      "page_20260713_topic001",
      "page_20260713_concept01"
    ]);
    await act(async () => {
      pending.get("page_20260713_domain01")?.resolve(relatedResult("page_20260713_domain01", "Wrong old relation"));
      pending.get("page_20260713_concept01")?.resolve(relatedResult("page_20260713_concept01", "Exact related note"));
      await settle(dom);
    });
    expect(mount.container.textContent).toContain("Exact related note");
    expect(mount.container.textContent).toContain("Exact backlink note");
    expect(mount.container.textContent).toContain("Answers this question");
    expect(mount.container.textContent).toContain("Outgoing links");
    expect(mount.container.textContent).toContain("Backlinks");
    expect(mount.container.textContent).not.toContain("Wrong old relation");
    expect(mount.container.textContent).not.toContain("wiki/private-related.md");
    expect(mount.container.textContent).not.toContain("heading:private");

    const relatedOpen = buttonNamed(mount.container, "Open: Exact related note");
    relatedOpen.focus();
    await click(dom, relatedOpen);
    expect(opened).toEqual([{
      pageId: "page_20260713_related01",
      focusKey: "root-0-child-0-child-0-node:outgoing:answers:page_20260713_related01"
    }]);

    const rankingNote = treeItemNamed(mount.container, "Ranking note");
    await click(dom, rankingNote);
    await waitFor(dom, () => mount.container.textContent?.includes("Related pages are temporarily unavailable.") === true);
    expect(rankingNote.getAttribute("aria-selected")).toBe("true");
    expect(dom.window.document.activeElement).toBe(rankingNote);
    expect(mount.container.textContent).not.toContain("private index failure");

    const sourceOnly = treeItemNamed(mount.container, "Source evidence");
    await click(dom, sourceOnly);
    expect(requests).toHaveLength(4);
    expect(buttonNamed(mount.container, "Open").dataset.knowledgeAction).toBe("open-topic");
    await unmount(dom, mount.root);
  });

  it("preserves the approved local camera, search focus, minimap, and reset behavior", async () => {
    const dom = createDom();
    const mount = await mountTree(dom, readyTree(), async () => undefined);
    const viewport = mount.container.querySelector<HTMLElement>(".knowledge-map-viewport");
    const stage = mount.container.querySelector<SVGGElement>(".knowledge-map-stage");
    const minimap = mount.container.querySelector<HTMLElement>(".knowledge-minimap");
    if (!viewport || !stage || !minimap) throw new Error("Missing Knowledge Tree viewport structure.");

    expect(viewport.getAttribute("aria-label")).toContain("plus or minus to zoom");
    expect(minimap.getAttribute("aria-hidden")).toBe("true");
    expect(minimap.querySelectorAll("path").length).toBeGreaterThan(0);

    await click(dom, buttonNamed(mount.container, "Zoom in"));
    expect(stage.getAttribute("transform")).not.toBe("translate(0 0) scale(1)");
    expect(mount.container.querySelector(".knowledge-map-status")?.textContent).toBe("Knowledge Tree zoom 118%");

    await keyDown(dom, viewport, "0");
    expect(stage.getAttribute("transform")).toBe("translate(0 0) scale(1)");
    expect(mount.container.querySelector(".knowledge-map-status")?.textContent).toBe("Knowledge Tree zoom 100%");

    await wheel(dom, viewport, -100);
    expect(mount.container.querySelector(".knowledge-map-status")?.textContent).toBe("Knowledge Tree zoom 112%");

    await pointer(dom, viewport, "pointerdown", { pointerId: 7, clientX: 100, clientY: 100 });
    expect(viewport.classList.contains("is-dragging")).toBe(true);
    const beforePan = stage.getAttribute("transform");
    await pointer(dom, viewport, "pointermove", { pointerId: 7, clientX: 190, clientY: 150 });
    expect(stage.getAttribute("transform")).not.toBe(beforePan);
    await pointer(dom, viewport, "pointerup", { pointerId: 7, clientX: 190, clientY: 150 });
    expect(viewport.classList.contains("is-dragging")).toBe(false);

    const original = treeItemNamed(mount.container, "Local-first");
    const search = mount.container.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error("Missing Knowledge Tree search.");
    await inputText(dom, search, "Lexical");
    await keyDown(dom, search, "Enter");
    const match = treeItemNamed(mount.container, "Lexical retrieval");
    expect(match.getAttribute("aria-selected")).toBe("true");
    expect(match.getAttribute("tabindex")).toBe("0");
    expect(mount.container.querySelector(".knowledge-map-status")?.textContent).toBe("Lexical retrieval focused");

    await keyDown(dom, search, "Escape");
    expect(search.value).toBe("");
    expect(original.getAttribute("aria-selected")).toBe("true");
    expect(original.getAttribute("tabindex")).toBe("0");

    const styles = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/styles/app.css"),
      "utf8"
    );
    expect(styles).toMatch(/\.knowledge-minimap\s*\{[\s\S]*?width:\s*62px;[\s\S]*?height:\s*74px;/);
    expect(styles).toMatch(/@media \(max-width:\s*679px\)\s*\{[\s\S]*?\.knowledge-minimap\s*\{\s*display:\s*none;/);
    expect(styles).toMatch(/@media \(max-width:\s*679px\)\s*\{[\s\S]*?\.knowledge-toolbar-action\.filter\s*\{\s*display:\s*none;/);

    await unmount(dom, mount.root);
  });

  it("keeps degraded and empty states localized without inventing hierarchy", async () => {
    const dom = createDom();
    const mount = await mountTree(dom, {
      ...emptyTree(),
      degraded: true,
      degradedReason: "local_database_not_ready"
    }, async () => undefined);

    expect(mount.container.textContent).toContain("Knowledge Tree is temporarily unavailable");
    expect(mount.container.querySelector(".knowledge-state.degraded .state-copy")).not.toBeNull();
    expect(mount.container.querySelector(".knowledge-tree-roots")).toBeNull();

    await act(async () => {
      mount.root.render(createElement(KnowledgeTreePanel, {
        tree: emptyTree(),
        error: null,
        noteLoadingPageId: null,
        onGoHome: () => undefined,
        onRefresh: async () => undefined,
        onLoadRelated: async (pageId) => emptyRelatedResult(pageId),
        onOpenNote: async () => undefined,
        developmentNotice: null,
        onDevelopment: () => undefined,
        t
      }));
      await settle(dom);
    });
    expect(mount.container.textContent).toContain("Knowledge Tree has no content yet");
    expect(mount.container.querySelector(".knowledge-state.empty .state-copy")).not.toBeNull();
    expect(mount.container.querySelector(".knowledge-tree-roots")).toBeNull();

    await unmount(dom, mount.root);
  });
});

function readyTree(): KnowledgeTreeResult {
  return {
    queriedAt: "2026-07-13T09:00:00.000Z",
    activeVaultId: "vault_20260713_treefixture",
    schemaVersion: 1,
    state: "ready",
    degraded: false,
    invalidPageCount: 1,
    totals: {
      pageCount: 5,
      topicCount: 2,
      conceptCount: 1,
      entityCount: 0,
      fragmentPageCount: 2,
      sourceCount: 3,
      leafCount: 5
    },
    roots: [{
      id: "page_20260713_domain01",
      kind: "domain",
      title: "Local-first",
      pageType: "topic",
      status: "active",
      navigation: {
        pageId: "page_20260713_domain01",
        pagePath: "wiki/topics/local-first.md"
      },
      relatedParentPageIds: [],
      pageRefs: [{
        pageId: "page_20260713_note0001",
        pagePath: "wiki/notes/ranking.md",
        title: "Ranking note",
        pageType: "note",
        status: "active",
        sourceIds: ["src_20260713_ranking01"]
      }],
      sourceRefs: ["src_20260713_ranking01", "src_20260713_retrieval", "src_private_internal_01"],
      metrics: {
        structuralPageCount: 3,
        fragmentPageCount: 2,
        sourceCount: 3,
        leafCount: 5,
        weight: 9
      },
      children: [{
        id: "page_20260713_topic001",
        kind: "topic",
        title: "Local RAG",
        pageType: "topic",
        status: "active",
        navigation: {
          pageId: "page_20260713_topic001",
          pagePath: "wiki/topics/local-rag.md"
        },
        relatedParentPageIds: ["page_20260713_domain02"],
        pageRefs: [],
        sourceRefs: ["src_20260713_retrieval", "src_private_internal_01"],
        metrics: {
          structuralPageCount: 2,
          fragmentPageCount: 1,
          sourceCount: 2,
          leafCount: 3,
          weight: 5
        },
        children: [{
          id: "page_20260713_concept01",
          kind: "concept",
          title: "Lexical retrieval",
          pageType: "concept",
          status: "active",
          navigation: {
            pageId: "page_20260713_concept01",
            pagePath: "wiki/concepts/lexical-retrieval.md"
          },
          relatedParentPageIds: [],
          pageRefs: [],
          sourceRefs: ["src_20260713_retrieval"],
          metrics: {
            structuralPageCount: 1,
            fragmentPageCount: 0,
            sourceCount: 1,
            leafCount: 1,
            weight: 2
          },
          children: []
        }, {
          id: "page_20260713_topic001/source:src_private_internal_01",
          kind: "source",
          title: "src_private_internal_01",
          sourceId: "src_private_internal_01",
          relatedParentPageIds: [],
          pageRefs: [],
          sourceRefs: ["src_private_internal_01"],
          metrics: {
            structuralPageCount: 0,
            fragmentPageCount: 0,
            sourceCount: 1,
            leafCount: 1,
            weight: 1
          },
          children: []
        }]
      }]
    }]
  };
}

function emptyTree(): KnowledgeTreeResult {
  return {
    queriedAt: "2026-07-13T09:00:00.000Z",
    activeVaultId: "vault_20260713_treefixture",
    schemaVersion: 1,
    state: "empty",
    degraded: false,
    invalidPageCount: 0,
    totals: {
      pageCount: 0,
      topicCount: 0,
      conceptCount: 0,
      entityCount: 0,
      fragmentPageCount: 0,
      sourceCount: 0,
      leafCount: 0
    },
    roots: []
  };
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}

async function mountTree(
  dom: JSDOM,
  tree: KnowledgeTreeResult,
  onOpenNote: (pageId: string, focusKey: string) => Promise<void>,
  onLoadRelated: (pageId: string) => Promise<LibraryRelatedResult> = async (pageId) => emptyRelatedResult(pageId)
): Promise<{ readonly root: Root; readonly container: HTMLElement }> {
  const container = dom.window.document.getElementById("root");
  if (!container) throw new Error("Missing test root.");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(KnowledgeTreePanel, {
      tree,
      error: null,
      noteLoadingPageId: null,
      onGoHome: () => undefined,
      onRefresh: async () => undefined,
      onLoadRelated,
      onOpenNote,
      developmentNotice: null,
      onDevelopment: () => undefined,
      t
    }));
    await settle(dom);
  });
  return { root, container };
}

function emptyRelatedResult(pageId: string): LibraryRelatedResult {
  return {
    queriedAt: "2026-07-13T09:05:00.000Z",
    activeVaultId: "vault_20260713_treefixture",
    pageId,
    totalOutgoing: 0,
    totalBacklinks: 0,
    invalidPageCount: 0,
    outgoing: [],
    backlinks: [],
    degraded: false
  };
}

function relatedResult(pageId: string, title: string): LibraryRelatedResult {
  return {
    ...emptyRelatedResult(pageId),
    totalOutgoing: 1,
    totalBacklinks: 1,
    outgoing: [{
      relation: "outgoing",
      relationType: "answers",
      target: "heading:private",
      summary: {
        pageId: "page_20260713_related01",
        title,
        pageType: "note",
        status: "active",
        pagePath: "wiki/private-related.md",
        createdAt: "2026-07-13T09:00:00.000Z",
        updatedAt: "2026-07-13T09:00:00.000Z",
        sourceIds: []
      }
    }],
    backlinks: [{
      relation: "backlink",
      relationType: "links_to",
      target: "heading:private-backlink",
      summary: {
        pageId: "page_20260713_backlink01",
        title: "Exact backlink note",
        pageType: "note",
        status: "active",
        pagePath: "wiki/private-backlink.md",
        createdAt: "2026-07-13T09:00:00.000Z",
        updatedAt: "2026-07-13T09:00:00.000Z",
        sourceIds: []
      }
    }]
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/"
  });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key as keyof Window]
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    writable: true,
    value: true
  });
  return dom;
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent === name);
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function treeItemNamed(container: HTMLElement, name: string): SVGGElement {
  const item = Array.from(container.querySelectorAll<SVGGElement>('[role="treeitem"]'))
    .find((candidate) => candidate.getAttribute("aria-label") === name);
  if (!item) throw new Error(`Missing tree item: ${name}`);
  return item;
}

async function click(dom: JSDOM, element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
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

async function keyDown(dom: JSDOM, element: Element, key: string): Promise<void> {
  await act(async () => {
    if (element instanceof dom.window.HTMLElement) element.focus();
    await settle(dom);
    element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await settle(dom);
  });
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await act(async () => settle(dom));
  }
  throw new Error("Timed out waiting for Knowledge Tree state.");
}

async function wheel(dom: JSDOM, element: Element, deltaY: number): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
    await settle(dom);
  });
}

async function pointer(
  dom: JSDOM,
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { readonly pointerId: number; readonly clientX: number; readonly clientY: number }
): Promise<void> {
  await act(async () => {
    const event = new dom.window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: init.clientX,
      clientY: init.clientY
    });
    Object.defineProperty(event, "pointerId", { configurable: true, value: init.pointerId });
    element.dispatchEvent(event);
    await settle(dom);
  });
}

async function unmount(dom: JSDOM, root: Root): Promise<void> {
  await act(async () => root.unmount());
  dom.window.close();
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
