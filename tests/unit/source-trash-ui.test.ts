import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderSourceTrashAction } from "../../apps/desktop/src/renderer/src/components/ReaderSourceTrashAction";
import { SourceTrashRestorePanel } from "../../apps/desktop/src/renderer/src/components/SourceTrashRestorePanel";

const keys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "Event", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
afterEach(() => { for (const key of keys) { const descriptor = originals.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } originals.clear(); Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT"); });

describe("source trash UI", () => {
  it("renders only exact Main eligibility and retains the Reader with focus after stale", async () => {
    const harness = await mount();
    const onTrash = vi.fn(async (request) => ({ ...request, status: "stale" as const }));
    const onCommitted = vi.fn();
    await harness.render(createElement(ReaderSourceTrashAction, { activeVaultId: "vault_20260802_abcdefgh",
      note: note(), onTrash, onCommitted, t }));
    const trigger = required(harness.container.querySelector<HTMLButtonElement>("[data-reader-source-trash]"));
    trigger.focus();
    await act(async () => { trigger.click(); await settle(harness.dom); });
    const confirm = button(harness.container, "Move to Trash");
    await act(async () => { confirm.click(); confirm.click(); await settle(harness.dom); });
    expect(onTrash).toHaveBeenCalledOnce();
    expect(onTrash).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "src_20260802_abcdefgh",
      expectedSourceRevision: `sourcerev_${"a".repeat(64)}`, confirmation: "move_to_trash" }));
    expect(onCommitted).not.toHaveBeenCalled();
    expect(harness.container.querySelector("[role=alert]")?.textContent).toContain("remains available");
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("adopts one exact restore and focuses the section after the restored item disappears", async () => {
    const harness = await mount(), operationId = "op_20260802_abcdefghijklmnop";
    const listTrash = vi.fn(async (request) => ({ ...request, status: "ready" as const, sources: [{
      sourceId: "src_20260802_abcdefgh", pageId: "page_20260802_abcdefgh", title: "Evidence",
      storage: "reference_original" as const, trashedAt: "2026-08-02T09:00:00.000Z", trashOperationId: operationId,
      trashRevision: `sourcetrashrev_${"b".repeat(64)}`
    }] }));
    const restoreTrash = vi.fn(async (request) => ({ ...request, status: "committed" as const,
      operationId: "op_20260802_restoredsource" }));
    Object.defineProperty(harness.dom.window, "pige", { configurable: true, value: { sources: { listTrash, restoreTrash },
      vault: { current: async () => ({ vaultId: "vault_20260802_abcdefgh" }) } } });
    const committed = vi.fn(async () => true);
    await harness.render(createElement(SourceTrashRestorePanel, { activeVaultId: "vault_20260802_abcdefgh",
      onCommitted: committed, t }));
    const restore = button(harness.container, "Restore"); restore.focus();
    await act(async () => { restore.click(); await settle(harness.dom); });
    expect(restoreTrash).toHaveBeenCalledOnce(); expect(committed).toHaveBeenCalledWith("page_20260802_abcdefgh");
    expect(harness.container.textContent).not.toContain("Evidence");
    expect(harness.dom.window.document.activeElement).toBe(harness.container.querySelector("section"));
    await harness.unmount();
  });
});

function note() { return { summary: { pageId: "page_20260802_abcdefgh", title: "Evidence", pageType: "source" as const,
  status: "active" as const, pagePath: "sources/evidence.md", createdAt: "2026-08-02T08:00:00.000Z",
  updatedAt: "2026-08-02T08:00:00.000Z", sourceIds: ["src_20260802_abcdefgh"] }, html: "<p>Evidence</p>",
  byteSize: 8, renderContextId: "noterender_abcdefghijklmnop",
  sourceTrashEligibility: { canTrash: true as const, sourceId: "src_20260802_abcdefgh",
    sourceRevision: `sourcerev_${"a".repeat(64)}`, storage: "reference_original" as const } }; }
const messages: Record<string, string> = { "note.sourceTrash.action": "Move source evidence to Trash",
  "note.sourceTrash.title": "Move this source evidence to Trash?", "note.sourceTrash.referenceDescription": "Original stays untouched.",
  "note.sourceTrash.cancel": "Cancel", "note.sourceTrash.confirm": "Move to Trash", "note.sourceTrash.moving": "Moving...",
  "note.sourceTrash.failed": "Source evidence remains available.", "activity.sourceTrash.title": "Recoverable source evidence",
  "activity.sourceTrash.loading": "Loading", "activity.sourceTrash.failed": "Failed", "activity.sourceTrash.retry": "Retry",
  "activity.sourceTrash.empty": "Empty", "activity.sourceTrash.reference": "Original untouched", "activity.sourceTrash.restore": "Restore",
  "activity.sourceTrash.restoring": "Restoring" };
function t(key: string) { return messages[key] ?? key; }
function button(root: HTMLElement, text: string) { return required([...root.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text)); }
function required<T>(value: T | null | undefined): T { if (!value) throw new Error("Expected value."); return value; }
async function mount() {
  const dom = new JSDOM("<!doctype html><div id=root></div>", { url: "https://pige.local", pretendToBeVisual: true });
  for (const key of keys) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] }); }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const { createRoot } = await import("react-dom/client"), container = required(dom.window.document.querySelector<HTMLElement>("#root")), root = createRoot(container);
  return { dom, container, render: async (element: React.ReactElement) => { await act(async () => { root.render(element); await settle(dom); }); },
    unmount: async () => { await act(async () => root.unmount()); dom.window.close(); } };
}
async function settle(dom: JSDOM) { await Promise.resolve(); await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(() => resolve()))); await Promise.resolve(); }
