import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderSourceRefreshAction } from "../../apps/desktop/src/renderer/src/components/ReaderSourceRefreshAction";
import { NoteReaderSourceActions } from "../../apps/desktop/src/renderer/src/components/ReaderSourceActions";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globals) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Reader source refresh action", () => {
  it("renders actions only for Main-projected refreshable sources", async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
    installDom(dom);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(NoteReaderSourceActions, {
        activeVaultId: "vault_20260731_abcdefgh",
        currentPageId: "page_20260731_reader1234",
        renderContextId: `notectx_${"a".repeat(32)}`,
        sourceIds: ["src_20260731_source1234", "src_20260731_source5678"],
        visibleSourceIds: ["src_20260731_source1234", "src_20260731_source5678"],
        refreshableSourceIds: ["src_20260731_source5678"],
        labels: {
          reveal: "Show original", revealing: "Showing…", revealed: "Shown", cancelled: "Cancelled",
          stale: "Stale", notFound: "Not found", unavailable: "Unavailable", failed: "Failed",
          reconnect: "Reconnect", reconnecting: "Reconnecting…", reconnected: "Reconnected",
          reconnectChangedTitle: "Changed", reconnectChangedDescription: "Changed", reconnectChangedConfirm: "Confirm",
          reconnectChangedCancel: "Cancel"
        },
        sourceLabel: (number: number) => `Saved source ${number}`,
        t: (key: string) => key,
        getFocusRoot: () => dom.window.document.querySelector("#root")
      }));
      await settle(dom);
    });

    expect(dom.window.document.querySelector('[data-reader-source-refresh="src_20260731_source1234"]')).toBeNull();
    expect(dom.window.document.querySelector('[data-reader-source-refresh="src_20260731_source5678"]')).not.toBeNull();
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shows a bounded change preview and confirms only its exact preview revision", async () => {
    const previewId = `sourcerefreshpreview_${"b".repeat(32)}`;
    const revision = `sourcerefreshrev_${"c".repeat(64)}`;
    const onPreview = vi.fn(async (request: any) => ({
      ...request,
      status: "changed" as const,
      preview: {
        previewId,
        expectedSourceRevision: revision,
        displayName: "Saved article",
        sourceKind: "url" as const,
        previousSize: 1024,
        currentSize: 2048,
        sizeDelta: 1024,
        affectedArtifactCount: 2,
        refreshesSourcePage: true
      }
    }));
    const onConfirm = vi.fn(async (request: any) => ({
      ...request,
      status: "refreshed" as const,
      operationId: "op_20260731_refresh1234",
      jobId: "job_20260731_refresh1234",
      sourceRevision: `sourcerefreshrev_${"d".repeat(64)}`,
      sourcePageConflict: false
    }));
    const onRefreshed = vi.fn();
    const render = {
      summary: {
        pageId: "page_20260731_reader1234", title: "Reader", pageType: "note", status: "active",
        pagePath: "wiki/reader.md", sourceIds: ["src_20260731_source1234"], createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T01:00:00.000Z"
      },
      html: "<p>Refreshed</p>", byteSize: 16, renderContextId: `notectx_${"e".repeat(32)}`
    } as const;
    const harness = await mount({ onPreview, onConfirm, onRender: vi.fn(async () => render), onRefreshed });
    const check = harness.container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => { check.click(); await settle(harness.dom); });

    const dialog = harness.container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Saved article");
    expect(dialog?.textContent).toContain("1 KB → 2 KB");
    expect(dialog?.textContent).toContain("2 artifacts");
    expect(dialog?.textContent).not.toContain(revision);
    expect(dialog?.textContent).not.toContain("sha256:");

    const buttons = [...dialog!.querySelectorAll<HTMLButtonElement>("button")];
    await act(async () => { buttons.at(-1)!.click(); await settle(harness.dom); await settle(harness.dom); });
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ previewId, expectedSourceRevision: revision }));
    expect(harness.container.textContent).toContain("Source refreshed.");
    expect(onRefreshed).toHaveBeenCalledWith(render);
    await harness.unmount();
  });

  it("discards an old preview after the Reader identity changes", async () => {
    const pending = deferred<any>();
    const onPreview = vi.fn(async () => pending.promise);
    const harness = await mount({ onPreview, onConfirm: vi.fn() });
    await act(async () => {
      harness.container.querySelector<HTMLButtonElement>("button")!.click();
      await settle(harness.dom);
      harness.root.render(element({
        activeVaultId: "vault_20260731_changed1234",
        renderContextId: `notectx_${"f".repeat(32)}`,
        onPreview,
        onConfirm: vi.fn()
      }));
      await settle(harness.dom);
      pending.resolve({
        apiVersion: 1, requestId: "sourcerefreshreq_oldresult123456", activeVaultId: "vault_20260731_abcdefgh",
        currentPageId: "page_20260731_reader1234", renderContextId: `notectx_${"a".repeat(32)}`,
        sourceId: "src_20260731_source1234", status: "failed"
      });
      await pending.promise;
      await settle(harness.dom);
    });
    expect(harness.container.querySelector('[role="dialog"], [role="alert"], [role="status"]')).toBeNull();
    await harness.unmount();
  });

  it("keeps the committed refresh notice and trigger focus when the optional Reader reread fails", async () => {
    const onPreview = vi.fn(async (request: any) => ({
      ...request,
      status: "changed" as const,
      preview: {
        previewId: `sourcerefreshpreview_${"6".repeat(32)}`,
        expectedSourceRevision: `sourcerefreshrev_${"7".repeat(64)}`,
        displayName: "Evidence.txt",
        sourceKind: "plain_text" as const,
        previousSize: 1024,
        currentSize: 2048,
        sizeDelta: 1024,
        affectedArtifactCount: 1,
        refreshesSourcePage: true
      }
    }));
    const onConfirm = vi.fn(async (request: any) => ({ ...request, status: "refreshed" as const,
      operationId: "op_20260809_refreshbest_effort", jobId: "job_20260809_refreshbest_effort",
      sourceRevision: `sourcerefreshrev_${"8".repeat(64)}`, sourcePageConflict: false }));
    const onRender = vi.fn(async () => { throw new Error("transient reread"); });
    const harness = await mount({ onPreview, onConfirm, onRender, onRefreshed: vi.fn() });
    const trigger = harness.container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => { trigger.focus(); trigger.click(); await settle(harness.dom); });
    const dialog = harness.container.querySelector('[role="dialog"]')!;
    await act(async () => {
      const buttons = dialog.querySelectorAll<HTMLButtonElement>("button");
      buttons.item(buttons.length - 1).click();
      await settle(harness.dom);
      await settle(harness.dom);
    });
    expect(harness.container.textContent).toContain("Source refreshed.");
    expect(harness.container.textContent).not.toContain("Refresh failed.");
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("distinguishes artifact-only refresh and reports a preserved edited Source Page", async () => {
    const onPreview = vi.fn(async (request: any) => ({
      ...request,
      status: "changed" as const,
      preview: {
        previewId: `sourcerefreshpreview_${"1".repeat(32)}`,
        expectedSourceRevision: `sourcerefreshrev_${"2".repeat(64)}`,
        displayName: "Evidence.pdf",
        sourceKind: "pdf" as const,
        previousSize: 2048,
        currentSize: 4096,
        sizeDelta: 2048,
        affectedArtifactCount: 3,
        refreshesSourcePage: false
      }
    }));
    const onConfirm = vi.fn(async (request: any) => ({
      ...request,
      status: "refreshed" as const,
      operationId: "op_20260731_refreshconflict",
      jobId: "job_20260731_refreshconflict",
      sourceRevision: `sourcerefreshrev_${"3".repeat(64)}`,
      sourcePageConflict: true
    }));
    const harness = await mount({ onPreview, onConfirm });

    await act(async () => {
      harness.container.querySelector<HTMLButtonElement>("button")!.click();
      await settle(harness.dom);
    });
    const dialog = harness.container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("3 artifacts; page unchanged");
    await act(async () => {
      [...dialog.querySelectorAll<HTMLButtonElement>("button")].at(-1)!.click();
      await settle(harness.dom);
    });
    expect(harness.container.textContent).toContain("Source refreshed; edited page kept.");
    await harness.unmount();
  });

  it("restores a durable Source Page conflict with four explicit exits and applies exact authority", async () => {
    const review = { conflictId: `sourcerefreshconflict_${"7".repeat(32)}`,
      expectedSourceRevision: `sourcerefreshrev_${"8".repeat(64)}`,
      expectedPageRevision: `noteeditrev_${"9".repeat(64)}`,
      lines: [{ kind: "removed" as const, text: "My edited paragraph" },
        { kind: "added" as const, text: "New extracted paragraph" }] };
    const onReadConflict = vi.fn(async (request: any) => ({ ...request, status: "ready" as const, review }));
    const onResolveConflict = vi.fn(async (request: any) => ({ ...request, status: "applied" as const,
      operationId: "op_20260802_sourceconflict1" }));
    const onRefreshed = vi.fn();
    const render = { summary: { pageId: "page_20260731_reader1234", title: "Source", pageType: "source",
      status: "active", pagePath: "sources/source.md", sourceIds: ["src_20260731_source1234"],
      createdAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-08-02T01:00:00.000Z" },
      html: "<p>New extracted paragraph</p>", byteSize: 26,
      renderContextId: `notectx_${"e".repeat(32)}` } as const;
    const harness = await mount({ onReadConflict, onResolveConflict,
      onRender: vi.fn(async () => render), onRefreshed });
    await act(async () => { await settle(harness.dom); await settle(harness.dom); });

    const dialog = harness.container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("My edited paragraph");
    expect(dialog.textContent).toContain("New extracted paragraph");
    expect(dialog.textContent).not.toContain(review.expectedPageRevision);
    const labels = [...dialog.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["Keep current", "Edit manually", "Save refreshed as new note", "Apply refreshed"]);
    await act(async () => { dialog.querySelectorAll<HTMLButtonElement>("button").item(3).click();
      await settle(harness.dom); await settle(harness.dom); });
    expect(onResolveConflict).toHaveBeenCalledWith(expect.objectContaining({
      conflictId: review.conflictId, expectedSourceRevision: review.expectedSourceRevision,
      expectedPageRevision: review.expectedPageRevision, decision: "apply_proposed"
    }));
    expect(onRefreshed).toHaveBeenCalledWith(render);
    expect(harness.container.querySelector('[role="dialog"]')).toBeNull();
    await harness.unmount();
  });

  it("keeps the image source action and focus after a confirmed refresh fails", async () => {
    const onPreview = vi.fn(async (request: any) => ({
      ...request,
      status: "changed" as const,
      preview: {
        previewId: `sourcerefreshpreview_${"4".repeat(32)}`,
        expectedSourceRevision: `sourcerefreshrev_${"5".repeat(64)}`,
        displayName: "Evidence.png",
        sourceKind: "image_file" as const,
        previousSize: 2048,
        currentSize: 4096,
        sizeDelta: 2048,
        affectedArtifactCount: 2,
        refreshesSourcePage: true
      }
    }));
    const onConfirm = vi.fn(async (request: any) => ({ ...request, status: "failed" as const }));
    const harness = await mount({ onPreview, onConfirm });
    const trigger = harness.container.querySelector<HTMLButtonElement>("button")!;

    await act(async () => { trigger.click(); await settle(harness.dom); });
    const dialog = harness.container.querySelector('[role="dialog"]')!;
    await act(async () => {
      [...dialog.querySelectorAll<HTMLButtonElement>("button")].at(-1)!.click();
      await settle(harness.dom);
      await settle(harness.dom);
    });

    expect(harness.container.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.container.textContent).toContain("Refresh failed.");
    expect(harness.container.querySelector<HTMLButtonElement>("button")).toBe(trigger);
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });
});

function element(overrides: Record<string, unknown> = {}) {
  return createElement(ReaderSourceRefreshAction, {
    activeVaultId: "vault_20260731_abcdefgh",
    currentPageId: "page_20260731_reader1234",
    renderContextId: `notectx_${"a".repeat(32)}`,
    sourceIds: ["src_20260731_source1234"],
    sourceLabel: (number: number) => `Saved source ${number}`,
    t: (key: string) => ({
      "note.refreshSource.region": "Source refresh",
      "note.refreshSource.action": "Check for update",
      "note.refreshSource.checking": "Checking…",
      "note.refreshSource.confirmTitle": "Refresh this source?",
      "note.refreshSource.changeSummary": "{before} → {after}",
      "note.refreshSource.effectSummary": "{count} artifacts",
      "note.refreshSource.effectSummaryNoPage": "{count} artifacts; page unchanged",
      "note.refreshSource.cancel": "Cancel",
      "note.refreshSource.confirm": "Refresh source",
      "note.refreshSource.refreshed": "Source refreshed.",
      "note.refreshSource.refreshedConflict": "Source refreshed; edited page kept.",
      "note.refreshSource.conflictTitle": "Choose which Source Page to keep",
      "note.refreshSource.conflictDescription": "Review the current edit and refreshed page.",
      "note.proposal.keep_current": "Keep current",
      "note.proposal.manual_edit": "Edit manually",
      "note.proposal.save_proposed_as_new_page": "Save refreshed as new note",
      "note.proposal.apply_proposed": "Apply refreshed",
      "note.refreshSource.failed": "Refresh failed."
    } as Record<string, string>)[key] ?? key,
    onPreview: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides
  });
}

async function mount(overrides: Record<string, unknown>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  installDom(dom);
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => { root.render(element(overrides)); await settle(dom); });
  return {
    dom,
    root,
    container: dom.window.document.querySelector("#root")!,
    unmount: async () => { await act(async () => root.unmount()); dom.window.close(); }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function installDom(dom: JSDOM): void {
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
}
