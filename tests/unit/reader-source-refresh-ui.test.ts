import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderSourceRefreshAction } from "../../apps/desktop/src/renderer/src/components/ReaderSourceRefreshAction";

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
  it("shows a bounded change preview and confirms only its exact preview revision", async () => {
    const previewId = `sourcerefreshpreview_${"b".repeat(32)}`;
    const revision = `sourcerefreshrev_${"c".repeat(64)}`;
    const onPreview = vi.fn(async (request: any) => ({
      ...request,
      status: "changed" as const,
      preview: {
        previewId,
        expectedSourceRevision: revision,
        displayName: "Evidence.txt",
        sourceKind: "plain_text_file" as const,
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
    expect(dialog?.textContent).toContain("Evidence.txt");
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
