import { createElement } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReaderSourceActions,
  type ReaderSourceActionLabels,
  type ReaderSourceActionOutcome
} from "../../apps/desktop/src/renderer/src/components/ReaderSourceActions";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
const labels: ReaderSourceActionLabels = {
  region: "Original source actions",
  reveal: "Show original",
  revealing: "Opening…",
  revealed: "Original opened.",
  stale: "This source changed. Review the current source.",
  notFound: "This source is no longer available.",
  unavailable: "The original source cannot be opened here.",
  failed: "The original source could not be opened.",
  reconnect: "Reconnect original",
  reconnecting: "Choosing original…",
  reconnected: "Original reconnected.",
  reconnectIneligible: "This source cannot be reconnected.",
  reconnectMismatch: "Choose the original with the same content and format.",
  reconnectFailed: "The original source could not be reconnected."
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

describe("Reader source actions", () => {
  it("renders nothing without exact Main-projected eligibility", async () => {
    const harness = await mount({
      sources: [{
        sourceId: "source_1",
        label: "Saved source 1",
        canRevealOriginal: false,
        canReconnectOriginal: false
      }],
      onRevealOriginal: vi.fn()
    });
    expect(harness.container.textContent).toBe("");
    expect(harness.container.querySelector("button")).toBeNull();
    await harness.unmount();
  });

  it("single-flights a reveal, keeps cancellation quiet, and restores its exact trigger", async () => {
    const pending = deferred<ReaderSourceActionOutcome>();
    const onRevealOriginal = vi.fn(async () => pending.promise);
    const harness = await mount({ sources: eligibleSources(), onRevealOriginal });
    const first = revealButton(harness.container, "source_1");
    const second = revealButton(harness.container, "source_2");
    first.focus();
    await act(async () => {
      first.click();
      first.click();
      second.click();
      await settle(harness.dom);
    });
    expect(onRevealOriginal).toHaveBeenCalledTimes(1);
    expect(onRevealOriginal).toHaveBeenCalledWith("source_1");
    expect(first.getAttribute("aria-busy")).toBe("true");
    expect(second.disabled).toBe(true);

    await act(async () => {
      pending.resolve("cancelled");
      await pending.promise;
      await settle(harness.dom);
    });
    expect(harness.container.querySelector('[role="status"], [role="alert"]')).toBeNull();
    expect(harness.dom.window.document.activeElement).toBe(first);
    expect(second.disabled).toBe(false);
    await harness.unmount();
  });

  it.each([
    ["stale", labels.stale, "status"],
    ["not_found", labels.notFound, "status"],
    ["unavailable", labels.unavailable, "status"],
    ["failed", labels.failed, "alert"]
  ] as const)("retains both sources and focus after %s", async (outcome, message, role) => {
    const harness = await mount({
      sources: eligibleSources(),
      onRevealOriginal: vi.fn(async () => outcome)
    });
    const trigger = revealButton(harness.container, "source_2");
    trigger.focus();
    await act(async () => {
      trigger.click();
      await settle(harness.dom);
    });
    expect(harness.container.querySelectorAll("button")).toHaveLength(2);
    expect(harness.container.querySelector(`[role="${role}"]`)?.textContent).toBe(message);
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("fences an old result after Reader owner identity changes", async () => {
    const pending = deferred<ReaderSourceActionOutcome>();
    const onRevealOriginal = vi.fn(async () => pending.promise);
    const harness = await mount({ sources: eligibleSources(), onRevealOriginal });
    const oldTrigger = revealButton(harness.container, "source_1");
    oldTrigger.focus();
    await act(async () => {
      oldTrigger.click();
      await settle(harness.dom);
      harness.root.render(createElement(ReaderSourceActions, {
        ownerIdentity: "vault_2:page_2:render_2",
        sources: eligibleSources(),
        labels,
        onRevealOriginal
      }));
      await settle(harness.dom);
    });
    const newTrigger = revealButton(harness.container, "source_1");
    newTrigger.focus();
    await act(async () => {
      pending.resolve("failed");
      await pending.promise;
      await settle(harness.dom);
    });
    expect(harness.container.querySelector('[role="status"], [role="alert"]')).toBeNull();
    expect(harness.dom.window.document.activeElement).toBe(newTrigger);
    expect(newTrigger.disabled).toBe(false);
    await harness.unmount();
  });

  it("single-flights reconnect and adopts an authoritative render only for the current owner", async () => {
    const render = {
      summary: {
        pageId: "page_20260730_reader001",
        title: "Source",
        pageType: "source",
        status: "active",
        pagePath: "wiki/sources/source.md",
        sourceIds: ["src_20260730_reader001"],
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
        language: "en"
      },
      html: "<p>Reconnected.</p>",
      byteSize: 12,
      renderContextId: `notectx_${"b".repeat(32)}`
    } as const;
    const pending = deferred<{ readonly outcome: "reconnected"; readonly render: typeof render }>();
    const onReconnectOriginal = vi.fn(async () => pending.promise);
    const onReconnected = vi.fn();
    const harness = await mount({
      sources: [{
        sourceId: "src_20260730_reader001",
        label: "Saved source 1",
        canRevealOriginal: true,
        canReconnectOriginal: true
      }],
      onRevealOriginal: vi.fn(async () => "revealed"),
      onReconnectOriginal,
      onReconnected
    });
    const reconnect = reconnectButton(harness.container, "src_20260730_reader001");
    await act(async () => {
      reconnect.click();
      reconnect.click();
      await settle(harness.dom);
    });
    expect(onReconnectOriginal).toHaveBeenCalledTimes(1);
    expect(reconnect.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      pending.resolve({ outcome: "reconnected", render });
      await pending.promise;
      await settle(harness.dom);
    });
    expect(onReconnected).toHaveBeenCalledWith("src_20260730_reader001", render);
    expect(harness.container.textContent).toContain(labels.reconnected);
    await harness.unmount();
  });

  it("keeps the reconnect action available after an exact-content mismatch", async () => {
    const sourceId = "src_20260730_reader001";
    const harness = await mount({
      sources: [{
        sourceId,
        label: "Saved source 1",
        canRevealOriginal: false,
        canReconnectOriginal: true
      }],
      onRevealOriginal: vi.fn(async () => "unavailable"),
      onReconnectOriginal: vi.fn(async () => ({ outcome: "mismatch" }))
    });
    const reconnect = reconnectButton(harness.container, sourceId);
    await act(async () => {
      reconnect.click();
      await settle(harness.dom);
      await settle(harness.dom);
    });
    expect(harness.container.querySelector('[role="status"]')?.textContent).toBe(labels.reconnectMismatch);
    expect(reconnect.disabled).toBe(false);
    await harness.unmount();
  });
});

function eligibleSources() {
  return [
    { sourceId: "source_1", label: "Saved source 1", canRevealOriginal: true, canReconnectOriginal: false },
    { sourceId: "source_2", label: "Saved source 2", canRevealOriginal: true, canReconnectOriginal: false }
  ] as const;
}

async function mount(props: {
  readonly sources: readonly {
    readonly sourceId: string;
    readonly label: string;
    readonly canRevealOriginal: boolean;
    readonly canReconnectOriginal: boolean;
  }[];
  readonly onRevealOriginal: (sourceId: string) => Promise<ReaderSourceActionOutcome>;
  readonly onReconnectOriginal?: Parameters<typeof ReaderSourceActions>[0]["onReconnectOriginal"];
  readonly onReconnected?: Parameters<typeof ReaderSourceActions>[0]["onReconnected"];
}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/"
  });
  installDom(dom);
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => {
    root.render(createElement(ReaderSourceActions, {
      ownerIdentity: "vault_1:page_1:render_1",
      sources: props.sources,
      labels,
      onRevealOriginal: props.onRevealOriginal,
      ...(props.onReconnectOriginal ? { onReconnectOriginal: props.onReconnectOriginal } : {}),
      ...(props.onReconnected ? { onReconnected: props.onReconnected } : {})
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

function reconnectButton(container: Element, sourceId: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-reader-source-reconnect="${sourceId}"]`);
  if (!button) throw new Error(`Missing reconnect action for ${sourceId}.`);
  return button;
}

function revealButton(container: Element, sourceId: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[data-reader-source-reveal="${sourceId}"]`);
  if (!button) throw new Error(`Missing reveal action for ${sourceId}.`);
  return button;
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
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0)
  });
}
