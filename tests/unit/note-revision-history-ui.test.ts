import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteRenderResult } from "@pige/contracts";
import { NoteRevisionHistoryDialog } from "../../apps/desktop/src/renderer/src/components/NoteRevisionHistoryDialog";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
const HISTORY_PAGE_TYPES = ["note", "claim", "question", "concept", "entity", "topic"] as const;

afterEach(() => {
  for (const key of globals) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("NoteRevisionHistoryDialog", () => {
  it.each(HISTORY_PAGE_TYPES)("restores an exact historical %s revision only after confirmation", async (pageType) => {
    const hidden = await mount(renderNote(false, pageType), api("committed", pageType));
    expect(hidden.container.querySelector("button")).toBeNull();
    await hidden.unmount();

    const methods = api("committed", pageType);
    const onCommitted = vi.fn();
    const harness = await mount(renderNote(true, pageType), methods, onCommitted);
    const trigger = harness.container.querySelector<HTMLButtonElement>('[data-reader-action="history"]')!;
    trigger.focus();
    await click(trigger, harness.dom);
    expect(methods.listRevisionHistory).toHaveBeenCalledTimes(1);
    const historical = [...harness.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("7/30"));
    expect(historical).toBeTruthy();
    await click(historical!, harness.dom);
    expect(harness.container.querySelector("[data-note-history-preview]")?.textContent).toContain("Earlier body");
    await click(button(harness.container, "Restore this version"), harness.dom);
    await click(button(harness.container, "Restore version"), harness.dom);
    expect(methods.restoreRevisionHistory).toHaveBeenCalledTimes(1);
    expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.objectContaining({ pageType }) }));
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("keeps the current Reader and exact trigger after a stale restore", async () => {
    const methods = api("stale");
    const onCommitted = vi.fn();
    const harness = await mount(renderNote(true), methods, onCommitted);
    const trigger = harness.container.querySelector<HTMLButtonElement>('[data-reader-action="history"]')!;
    await click(trigger, harness.dom);
    const historical = [...harness.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent?.includes("7/30"))!;
    await click(historical, harness.dom);
    await click(button(harness.container, "Restore this version"), harness.dom);
    await click(button(harness.container, "Restore version"), harness.dom);
    expect(onCommitted).not.toHaveBeenCalled();
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toContain("unchanged");
    expect(harness.container.querySelector('[role="dialog"]')).not.toBeNull();
    await harness.unmount();
  });

  it("rejects a committed render whose page type drifted", async () => {
    const methods = api("committed", "claim", "question");
    const onCommitted = vi.fn();
    const harness = await mount(renderNote(true, "claim"), methods, onCommitted);
    await click(harness.container.querySelector<HTMLButtonElement>('[data-reader-action="history"]')!, harness.dom);
    const historical = [...harness.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent?.includes("7/30"))!;
    await click(historical, harness.dom);
    await click(button(harness.container, "Restore this version"), harness.dom);
    await click(button(harness.container, "Restore version"), harness.dom);
    expect(onCommitted).not.toHaveBeenCalled();
    expect(harness.container.querySelector('[role="dialog"]')).not.toBeNull();
    await harness.unmount();
  });
});

function api(
  restoreStatus: "committed" | "stale" = "committed",
  pageType: HistoryPageType = "note",
  resultPageType: HistoryPageType = pageType
) {
  const historical = {
    revisionId: `notehistoryrev_${"a".repeat(64)}` as const,
    createdAt: "2026-07-30T10:00:00.000Z",
    origin: "user" as const,
    isCurrent: false,
    canOpen: true as const
  };
  return {
    listRevisionHistory: vi.fn(async (request) => ({
      ...request, status: "ready" as const, currentRevision: `noteeditrev_${"b".repeat(64)}` as const,
      revisions: [{ ...historical, revisionId: `notehistoryrev_${"b".repeat(64)}` as const, isCurrent: true, origin: "current" as const }, historical]
    })),
    openRevisionHistory: vi.fn(async (request) => ({
      ...request, status: "opened" as const, revision: historical,
      currentRevision: `noteeditrev_${"b".repeat(64)}` as const, html: "<p>Earlier body</p>", byteSize: 12
    })),
    restoreRevisionHistory: vi.fn(async (request) => restoreStatus === "committed"
      ? { ...request, status: "committed" as const, operationId: "op_20260731_historyrestore", revision: `noteeditrev_${"a".repeat(64)}` as const, render: renderNote(true, resultPageType) }
      : { ...request, status: "stale" as const })
  };
}

type HistoryPageType = typeof HISTORY_PAGE_TYPES[number];

function renderNote(history: boolean, pageType: HistoryPageType = "note"): NoteRenderResult {
  return {
    summary: {
      pageId: "page_20260731_historyui", title: "History", pageType, status: "active",
      pagePath: "wiki/history.md", createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z", language: "en", sourceIds: []
    },
    html: "<p>Current</p>", byteSize: 12,
    renderContextId: `notectx_${"c".repeat(32)}`,
    ...(history ? { historyEligibility: { canBrowse: true, revision: `noteeditrev_${"b".repeat(64)}` } } : {})
  };
}

async function mount(note: NoteRenderResult, methods: ReturnType<typeof api>, onCommitted = vi.fn()) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://pige.local" });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  Object.defineProperty(dom.window, "crypto", { configurable: true, value: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" } });
  Object.defineProperty(dom.window, "pige", { configurable: true, value: { notes: methods } });
  dom.window.requestAnimationFrame = (callback) => { callback(0); return 1; };
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = dom.window.document.getElementById("root")!;
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(NoteRevisionHistoryDialog, {
      note, activeVaultId: "vault_20260731_historyui", t: (key: string) => labels[key] ?? key, onCommitted
    }));
    await settle(dom);
  });
  return { dom, container, root, unmount: async () => act(async () => root.unmount()) };
}

async function click(element: HTMLButtonElement, dom: JSDOM): Promise<void> {
  await act(async () => { element.click(); await settle(dom); });
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text);
  if (!result) throw new Error(`Missing ${text} button.`);
  return result;
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

const labels: Record<string, string> = {
  "note.history.action": "Revision history", "note.history.title": "Revision history",
  "note.history.description": "Review earlier", "note.history.current": "Current version",
  "note.history.restore": "Restore this version", "note.history.restoreDescription": "Confirm restore",
  "note.history.restoreConfirm": "Restore version", "note.history.restoring": "Restoring",
  "note.history.close": "Close", "note.history.failed": "The current note is unchanged."
};
