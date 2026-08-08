import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferencedOriginalConnections } from "../../apps/desktop/src/renderer/src/components/ReferencedOriginalConnections";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
const candidate = {
  sourceId: "src_20260731_reconnectsettings1",
  sourceKind: "plain_text_file" as const,
  sourceRevision: `sourcerev_${"a".repeat(64)}`,
  expectedAvailability: "unavailable" as const,
  expectedChecksum: `sha256:${"b".repeat(64)}`,
  expectedSize: 21,
  formatIdentity: `sourcefmt_${"c".repeat(64)}`,
  displayName: "research.txt"
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

describe("referenced original Connections settings", () => {
  it("sends the exact Main-issued proof and refreshes after persistent repair", async () => {
    let connected = false;
    const reconnectOriginal = vi.fn(async (request: Record<string, unknown>) => ({
      ...request,
      status: "reconnected" as const,
      operationId: "op_20260731_reconnectsettings1",
      contentState: "current" as const,
      resumedJobCount: 1
    }));
    const reconnectableOriginals = vi.fn(async (request: Record<string, unknown>) => ({
      ...request,
      status: "ready" as const,
      sources: connected ? [] : [candidate],
      truncated: false
    }));
    const onRefresh = vi.fn(async () => { connected = true; });
    const harness = await mount({ reconnectableOriginals, reconnectOriginal, onRefresh });
    await waitFor(harness.dom, () => harness.container.textContent?.includes(candidate.displayName) === true);

    await act(async () => {
      button(harness.container, "Reconnect").click();
      await settle(harness.dom);
      await settle(harness.dom);
    });
    await waitFor(harness.dom, () => reconnectOriginal.mock.calls.length === 1);
    await waitFor(harness.dom, () => harness.container.textContent?.includes("All originals are connected.") === true);
    expect(reconnectOriginal.mock.calls[0]?.[0]).toMatchObject({
      activeVaultId: "vault_20260731_settings01",
      sourceId: candidate.sourceId,
      sourceKind: candidate.sourceKind,
      sourceRevision: candidate.sourceRevision,
      expectedAvailability: candidate.expectedAvailability,
      expectedChecksum: candidate.expectedChecksum,
      expectedSize: candidate.expectedSize,
      formatIdentity: candidate.formatIdentity
    });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(harness.container.textContent).toContain("Original reconnected.");
    expect(harness.container.textContent).not.toContain("/private/");
    expect(harness.container.textContent).not.toContain("op_20260731");
    await harness.unmount();
  });

  it("keeps cancellation quiet and retains the exact candidate after mismatch", async () => {
    let outcome: "cancelled" | "mismatch" = "cancelled";
    const reconnectOriginal = vi.fn(async (request: Record<string, unknown>) => ({ ...request, status: outcome }));
    const reconnectableOriginals = vi.fn(async (request: Record<string, unknown>) => ({
      ...request,
      status: "ready" as const,
      sources: [candidate],
      truncated: false
    }));
    const onRefresh = vi.fn(async () => undefined);
    const harness = await mount({ reconnectableOriginals, reconnectOriginal, onRefresh });
    await waitFor(harness.dom, () => harness.container.textContent?.includes(candidate.displayName) === true);

    await act(async () => {
      button(harness.container, "Reconnect").click();
      await settle(harness.dom);
    });
    await waitFor(harness.dom, () => reconnectOriginal.mock.calls.length === 1);
    expect(harness.container.querySelector('[role="status"], [role="alert"]')).toBeNull();
    outcome = "mismatch";
    await act(async () => {
      button(harness.container, "Reconnect").click();
      await settle(harness.dom);
    });
    await waitFor(harness.dom, () => reconnectOriginal.mock.calls.length === 2);
    expect(harness.container.querySelector('[role="status"]')?.textContent)
      .toBe("Choose the original with the same content and format.");
    expect(harness.container.textContent).toContain(candidate.displayName);
    expect(onRefresh).not.toHaveBeenCalled();
    await harness.unmount();
  });

  it("requires explicit confirmation before using changed content and keeps the preview pathless", async () => {
    let connected = false;
    const preview = {
      previewId: `sourcerelinkpreview_${"d".repeat(32)}`,
      expectedSourceRevision: candidate.sourceRevision,
      displayName: candidate.displayName,
      sourceKind: candidate.sourceKind,
      previousSize: candidate.expectedSize,
      currentSize: 42,
      affectedArtifactCount: 1,
      refreshesSourcePage: true
    };
    const reconnectOriginal = vi.fn(async (request: Record<string, unknown>) => request.previewId
      ? { ...request, status: "reconnected" as const, operationId: "op_20260731_changedrelink",
          contentState: "changed" as const, resumedJobCount: 1 }
      : { ...request, status: "changed" as const, preview });
    const reconnectableOriginals = vi.fn(async (request: Record<string, unknown>) => ({
      ...request, status: "ready" as const, sources: connected ? [] : [candidate], truncated: false
    }));
    const harness = await mount({ reconnectableOriginals, reconnectOriginal, onRefresh: async () => { connected = true; } });
    await waitFor(harness.dom, () => harness.container.textContent?.includes(candidate.displayName) === true);
    await act(async () => { button(harness.container, "Reconnect").click(); await settle(harness.dom); });
    await waitFor(harness.dom, () => harness.container.querySelector('[role="dialog"]') !== null);
    expect(harness.container.textContent).toContain("Use this changed file?");
    expect(reconnectOriginal).toHaveBeenCalledOnce();
    await act(async () => { button(harness.container, "Use and refresh").click(); await settle(harness.dom); });
    await waitFor(harness.dom, () => reconnectOriginal.mock.calls.length === 2);
    expect(reconnectOriginal.mock.calls[1]?.[0]).toMatchObject({ previewId: preview.previewId });
    expect(JSON.stringify(reconnectOriginal.mock.calls)).not.toContain("/private/");
    await waitFor(harness.dom, () => harness.container.textContent?.includes("All originals are connected.") === true);
    await harness.unmount();
  });

  it("sends explicit changed-preview cancellation to Main and keeps the source available", async () => {
    const preview = {
      previewId: `sourcerelinkpreview_${"f".repeat(32)}`,
      expectedSourceRevision: candidate.sourceRevision,
      displayName: candidate.displayName,
      sourceKind: candidate.sourceKind,
      previousSize: candidate.expectedSize,
      currentSize: 42,
      affectedArtifactCount: 1,
      refreshesSourcePage: true
    };
    const reconnectOriginal = vi.fn(async (request: Record<string, unknown>) => ({
      ...request,
      status: "changed" as const,
      preview
    }));
    const cancelReconnectPreview = vi.fn(async (request: Record<string, unknown>) => ({
      ...request,
      status: "cancelled" as const
    }));
    const reconnectableOriginals = vi.fn(async (request: Record<string, unknown>) => ({
      ...request,
      status: "ready" as const,
      sources: [candidate],
      truncated: false
    }));
    const harness = await mount({ reconnectableOriginals, reconnectOriginal, cancelReconnectPreview, onRefresh: async () => undefined });
    await waitFor(harness.dom, () => harness.container.textContent?.includes(candidate.displayName) === true);
    await act(async () => { button(harness.container, "Reconnect").click(); await settle(harness.dom); });
    await waitFor(harness.dom, () => harness.container.querySelector('[role="dialog"]') !== null);
    await act(async () => { button(harness.container, "Keep saved source").click(); await settle(harness.dom); });
    await waitFor(harness.dom, () => harness.container.querySelector('[role="dialog"]') === null);
    expect(cancelReconnectPreview).toHaveBeenCalledOnce();
    expect(cancelReconnectPreview.mock.calls[0]?.[0]).toMatchObject({ previewId: preview.previewId });
    expect(reconnectOriginal).toHaveBeenCalledOnce();
    expect(harness.container.textContent).toContain(candidate.displayName);
    await harness.unmount();
  });
});

async function mount(input: {
  readonly reconnectableOriginals: (...args: never[]) => Promise<unknown>;
  readonly reconnectOriginal: (...args: never[]) => Promise<unknown>;
  readonly cancelReconnectPreview?: (...args: never[]) => Promise<unknown>;
  readonly onRefresh: () => Promise<void>;
}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  installDom(dom);
  Object.defineProperty(dom.window, "pige", {
    configurable: true,
    value: { sources: {
      reconnectableOriginals: input.reconnectableOriginals,
      reconnectOriginal: input.reconnectOriginal,
      cancelReconnectPreview: input.cancelReconnectPreview
    } }
  });
  let ordinal = 0;
  Object.defineProperty(dom.window.crypto, "randomUUID", {
    configurable: true,
    value: () => `12345678-1234-4123-8123-${String(++ordinal).padStart(12, "0")}`
  });
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => {
    root.render(createElement(ReferencedOriginalConnections, {
      activeVaultId: "vault_20260731_settings01",
      disabled: false,
      onRefresh: input.onRefresh,
      t
    }));
    await settle(dom);
  });
  return {
    dom,
    root,
    container: dom.window.document.querySelector("#root")!,
    unmount: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    }
  };
}

function t(key: string): string {
  return ({
    "sourceReconnect.title": "Referenced originals",
    "sourceReconnect.description": "Repair missing references.",
    "sourceReconnect.loading": "Checking…",
    "sourceReconnect.failed": "Could not check originals.",
    "sourceReconnect.allConnected": "All originals are connected.",
    "sourceReconnect.reconnecting": "Choosing…",
    "sourceReconnect.action": "Reconnect",
    "sourceReconnect.reconnected": "Original reconnected.",
    "sourceReconnect.mismatch": "Choose the original with the same content and format.",
    "sourceReconnect.stale": "This source changed.",
    "sourceReconnect.truncated": "More originals are unavailable.",
    "sourceReconnect.refresh": "Refresh",
    "sourceRelinkChanged.title": "Use this changed file?",
    "sourceRelinkChanged.changeSummary": "The saved source was {before}; this file is {after}.",
    "sourceRelinkChanged.effectSummary": "Rebuild {count} items and refresh the page.",
    "sourceRelinkChanged.effectSummaryNoPage": "Rebuild {count} items.",
    "sourceRelinkChanged.cancel": "Keep saved source",
    "sourceRelinkChanged.confirm": "Use and refresh"
  } as Record<string, string>)[key] ?? key;
}

function button(container: Element, text: string): HTMLButtonElement {
  const result = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === text);
  if (!result) throw new Error(`Missing ${text} button.`);
  return result;
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for UI state.");
    await settle(dom);
  }
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
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0)
  });
}
