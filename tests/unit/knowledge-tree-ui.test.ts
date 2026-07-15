import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type { KnowledgeTreeResult } from "@pige/contracts";
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
    const meter = mount.container.querySelector<HTMLMeterElement>("meter.knowledge-tree-weight");
    expect(meter?.value).toBe(9);
    expect(meter?.max).toBe(9);
    expect(meter?.getAttribute("aria-label")).toBe("Weight: 9");
    expect(mount.container.textContent).toContain("Weight: 9");
    expect(mount.container.textContent).toContain("Sources: 3");

    const topicNode = treeItemNamed(mount.container, "Local RAG");
    await click(dom, topicNode);
    expect(topicNode.getAttribute("aria-selected")).toBe("true");
    expect(treeItemNamed(mount.container, "Lexical retrieval")).toBeTruthy();
    expect(treeItemNamed(mount.container, "Source evidence")).toBeTruthy();
    expect(mount.container.textContent).not.toContain("src_private_internal_01");

    const conceptNode = treeItemNamed(mount.container, "Lexical retrieval");
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
  onOpenNote: (pageId: string, focusKey: string) => Promise<void>
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
      onOpenNote,
      developmentNotice: null,
      onDevelopment: () => undefined,
      t
    }));
    await settle(dom);
  });
  return { root, container };
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

async function unmount(dom: JSDOM, root: Root): Promise<void> {
  await act(async () => root.unmount());
  dom.window.close();
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
