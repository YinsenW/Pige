import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecentVaultSummary } from "@pige/contracts";
import { RecentVaults } from "../../apps/desktop/src/renderer/src/components/VaultBackupSettingsPanel";

const globalKeys = [
  "window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "Event", "MouseEvent"
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

describe("recent Vault lifecycle UI", () => {
  it("marks the active Vault without exposing forget or reconnect actions", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    const recent = recentVault();
    await act(async () => {
      root.render(createElement(RecentVaults, {
        recentVaults: [recent],
        activeVaultId: recent.vaultId,
        onRecentVaultsChanged: () => undefined,
        t
      }));
      await settle(dom);
    });

    expect(container.textContent).toContain("Active");
    expect(buttons(container, "Forget")).toHaveLength(0);
    expect(buttons(container, "Reconnect")).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reconnects by ID and revision, refreshes immediately, and never sends a path", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    const requests: unknown[] = [];
    let recentVaults = [recentVault()];
    const next = { ...recentVaults[0]!, pathDisplay: "~/Moved", revision: `recentvaultrev_${"b".repeat(64)}` };
    installApi(dom, {
      recent: vi.fn(async () => [next]),
      forgetRecent: vi.fn(),
      reconnectRecent: vi.fn(async (request) => {
        requests.push(request);
        return { ...request, status: "reconnected" as const, revision: next.revision };
      })
    });
    const render = (): void => root.render(createElement(RecentVaults, {
      recentVaults,
      onRecentVaultsChanged: (updated) => { recentVaults = [...updated]; render(); },
      t
    }));
    await act(async () => { render(); await settle(dom); });

    const reconnect = button(container, "Reconnect");
    await click(dom, reconnect);
    await waitFor(dom, () => container.textContent?.includes("Recent Vault reconnected.") === true);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      vaultId: next.vaultId,
      expectedRevision: `recentvaultrev_${"a".repeat(64)}`
    });
    expect(Object.keys(requests[0] as object).sort()).toEqual([
      "apiVersion", "expectedRevision", "requestId", "vaultId"
    ]);
    expect(JSON.stringify(requests[0])).not.toContain("Moved");
    expect(container.textContent).toContain("~/Moved");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("forgets the display entry immediately without giving the renderer delete authority", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    const requests: unknown[] = [];
    let recentVaults = [recentVault()];
    installApi(dom, {
      recent: vi.fn(async () => []),
      forgetRecent: vi.fn(async (request) => {
        requests.push(request);
        return { ...request, status: "forgotten" as const };
      }),
      reconnectRecent: vi.fn()
    });
    const render = (): void => root.render(createElement(RecentVaults, {
      recentVaults,
      onRecentVaultsChanged: (updated) => { recentVaults = [...updated]; render(); },
      t
    }));
    await act(async () => { render(); await settle(dom); });

    await click(dom, button(container, "Forget"));
    await waitFor(dom, () => recentVaults.length === 0 && container.textContent === "");

    expect(Object.keys(requests[0] as object).sort()).toEqual([
      "apiVersion", "expectedRevision", "requestId", "vaultId"
    ]);
    expect(JSON.stringify(requests[0])).not.toContain("Original");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps the current row and restores focus when reconnect validation fails", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    const recent = recentVault();
    const readRecent = vi.fn(async () => [recent]);
    installApi(dom, {
      recent: readRecent,
      forgetRecent: vi.fn(),
      reconnectRecent: vi.fn(async (request) => ({ ...request, status: "mismatch" as const }))
    });
    await act(async () => {
      root.render(createElement(RecentVaults, {
        recentVaults: [recent],
        onRecentVaultsChanged: () => undefined,
        t
      }));
      await settle(dom);
    });

    const reconnect = button(container, "Reconnect");
    await click(dom, reconnect);
    await waitFor(dom, () => dom.window.document.activeElement === reconnect);

    expect(container.textContent).toContain("different Vault");
    expect(container.textContent).toContain(recent.pathDisplay);
    expect(readRecent).not.toHaveBeenCalled();
    expect(buttons(container, "Forget")).toHaveLength(1);

    await act(async () => root.unmount());
    dom.window.close();
  });
});

function recentVault(): RecentVaultSummary {
  return {
    vaultId: "vault_20260731_recentui",
    name: "Recent UI",
    pathDisplay: "~/Original",
    schemaVersion: 2,
    lastOpenedAt: "2026-07-31T08:00:00.000Z",
    revision: `recentvaultrev_${"a".repeat(64)}`
  };
}

function installApi(dom: JSDOM, vault: Record<string, unknown>): void {
  Object.defineProperty(dom.window, "pige", { configurable: true, value: { vault } });
}

function t(key: string): string {
  return ({
    "recent.title": "Recent vaults",
    "recent.active": "Active",
    "recent.forget": "Forget",
    "recent.forgetting": "Forgetting…",
    "recent.reconnect": "Reconnect",
    "recent.reconnecting": "Choosing folder…",
    "recent.reconnected": "Recent Vault reconnected.",
    "recent.stale": "This recent Vault changed.",
    "recent.activeBlocked": "The active Vault cannot be changed here.",
    "recent.mismatch": "That folder belongs to a different Vault.",
    "recent.lifecycleFailed": "The existing entry was kept."
  } as Record<string, string>)[key] ?? key;
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost"
  });
  Object.defineProperty(dom.window.crypto, "randomUUID", {
    configurable: true,
    value: () => "01234567-89ab-cdef-0123-456789abcdef"
  });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
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

async function click(dom: JSDOM, element: HTMLButtonElement): Promise<void> {
  await act(async () => { element.click(); await settle(dom); });
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await settle(dom); });
  }
  throw new Error("Timed out waiting for recent Vault lifecycle UI state.");
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .filter((candidate) => candidate.textContent === label);
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
