import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import {
  BackupDestinationReconnectAction,
  type BackupDestinationReconnectOutcome
} from "../../apps/desktop/src/renderer/src/components/BackupDestinationReconnectAction";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
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

describe("Backup destination reconnect action", () => {
  it("is fail-closed and keeps a cancelled or failed reconnect actionable and focus-owned", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const fallback = dom.window.document.createElement("button");
    fallback.textContent = "Backup status";
    dom.window.document.body.append(fallback);
    const root = createRoot(container);
    let eligible = false;
    let calls = 0;
    let resolveAttempt: ((outcome: BackupDestinationReconnectOutcome) => void) | undefined;
    const render = (): void => root.render(createElement(BackupDestinationReconnectAction, {
      identityKey: "vault_backup_ui:job_backup_waiting:2026-07-30T10:00:00.000Z",
      eligible,
      labels: labels(),
      onReconnect: () => {
        calls += 1;
        return new Promise((resolve) => { resolveAttempt = resolve; });
      },
      onReconnected: async () => undefined,
      returnFocusRef: { current: fallback }
    }));

    await act(async () => { render(); await settle(dom); });
    expect(buttons(container, "Reconnect backup folder")).toHaveLength(0);

    eligible = true;
    await act(async () => { render(); await settle(dom); });
    const reconnect = button(container, "Reconnect backup folder");
    await act(async () => { reconnect.click(); reconnect.click(); await settle(dom); });
    expect(calls).toBe(1);
    expect(container.textContent).toContain("Choosing backup folder…");
    expect(reconnect.getAttribute("aria-busy")).toBe("true");

    await act(async () => { resolveAttempt?.("cancelled"); await settle(dom); });
    await waitFor(dom, () => dom.window.document.activeElement === reconnect);
    expect(container.textContent).not.toContain("Backup folder reconnected.");
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await click(dom, reconnect);
    await act(async () => { resolveAttempt?.("failed"); await settle(dom); });
    await waitFor(dom, () => container.textContent?.includes("Pige could not reconnect this backup folder.") === true);
    expect(buttons(container, "Reconnect backup folder")).toHaveLength(1);
    expect(dom.window.document.activeElement).toBe(reconnect);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("refreshes the same visible Job after success and ignores a stale identity response", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const fallback = dom.window.document.createElement("button");
    fallback.textContent = "Backup status";
    dom.window.document.body.append(fallback);
    const root = createRoot(container);
    let identityKey = "vault_backup_ui:job_backup_waiting:2026-07-30T10:00:00.000Z";
    let eligible = true;
    let refreshes = 0;
    let resolveAttempt: ((outcome: BackupDestinationReconnectOutcome) => void) | undefined;
    const render = (): void => root.render(createElement(BackupDestinationReconnectAction, {
      identityKey,
      eligible,
      labels: labels(),
      onReconnect: () => new Promise((resolve) => { resolveAttempt = resolve; }),
      onReconnected: async () => {
        refreshes += 1;
        eligible = false;
        render();
      },
      returnFocusRef: { current: fallback }
    }));

    await act(async () => { render(); await settle(dom); });
    const first = button(container, "Reconnect backup folder");
    await click(dom, first);
    identityKey = "vault_backup_ui:job_backup_newer:2026-07-30T10:00:01.000Z";
    await act(async () => { render(); await settle(dom); });
    await act(async () => { resolveAttempt?.("reconnected"); await settle(dom); });
    expect(refreshes).toBe(0);
    expect(container.textContent).not.toContain("Backup folder reconnected.");

    const current = button(container, "Reconnect backup folder");
    await click(dom, current);
    await act(async () => { resolveAttempt?.("stale"); await settle(dom); });
    await waitFor(dom, () => container.textContent?.includes("This backup changed before reconnection finished.") === true);
    expect(buttons(container, "Reconnect backup folder")).toHaveLength(1);

    await click(dom, current);
    await act(async () => { resolveAttempt?.("reconnected"); await settle(dom); });
    await waitFor(dom, () => refreshes === 1 && dom.window.document.activeElement === fallback);
    expect(buttons(container, "Reconnect backup folder")).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });
});

function labels() {
  return {
    action: "Reconnect backup folder",
    pending: "Choosing backup folder…",
    reconnected: "Backup folder reconnected.",
    stale: "This backup changed before reconnection finished.",
    failed: "Pige could not reconnect this backup folder."
  };
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost"
  });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  dom.window.cancelAnimationFrame = (handle: number): void => dom.window.clearTimeout(handle);
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await settle(dom); });
  }
  throw new Error("Timed out waiting for UI state.");
}

async function click(dom: JSDOM, element: HTMLButtonElement): Promise<void> {
  await act(async () => { element.click(); await settle(dom); });
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .filter((item) => item.textContent === label);
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = buttons(container, label)[0];
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Expected element.");
  return value;
}
