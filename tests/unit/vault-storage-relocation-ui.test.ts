import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultStorageRelocationRequest, VaultStorageRelocationResult } from "@pige/contracts";
import { VaultStorageRelocationAction } from "../../apps/desktop/src/renderer/src/components/VaultStorageRelocationAction";

const activeVaultId = "vault_20260731_relocateui";
const revision = `vaultrelocationrev_${"a".repeat(64)}`;
const labels = {
  action: "Move vault…",
  pending: "Moving vault…",
  relocated: "Vault storage moved. The original folder was kept.",
  stale: "This vault changed.",
  blocked: "Finish active vault work.",
  destinationExists: "Destination exists.",
  failed: "The original vault is still active."
};
const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "Event", "MouseEvent"] as const;
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

describe("Vault storage relocation Settings action", () => {
  it("sends only exact identity/revision, refreshes on success, and exposes no picker path", async () => {
    const requests: VaultStorageRelocationRequest[] = [];
    const refreshed = vi.fn(async () => undefined);
    const { dom, container, root } = await mount(async (request) => {
      requests.push(request);
      return { ...request, status: "relocated", revision: `vaultrelocationrev_${"b".repeat(64)}` };
    }, refreshed);

    await click(dom, button(container, labels.action));
    await settle(dom);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ apiVersion: 1, activeVaultId, expectedRevision: revision });
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual([
      "activeVaultId", "apiVersion", "expectedRevision", "requestId"
    ]);
    expect(JSON.stringify(requests[0])).not.toMatch(/path|directory|folder/iu);
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(labels.relocated);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("retains the current Settings state on stale, cancel, and failure outcomes", async () => {
    let outcome: "stale" | "cancelled" | "failed" = "stale";
    const refreshed = vi.fn(async () => undefined);
    const { dom, container, root } = await mount(async (request) => outcome === "stale"
      ? { ...request, status: "stale", currentRevision: revision }
      : outcome === "cancelled"
        ? { ...request, status: "cancelled", currentRevision: revision }
        : { ...request, status: "failed" }, refreshed);

    await click(dom, button(container, labels.action));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(labels.stale);
    expect(refreshed).not.toHaveBeenCalled();
    outcome = "cancelled";
    await click(dom, button(container, labels.action));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    outcome = "failed";
    await click(dom, button(container, labels.action));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(labels.failed);
    expect(button(container, labels.action)).toBeTruthy();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps an authoritative relocation success when the summary refresh fails", async () => {
    const refreshed = vi.fn(async () => {
      throw new Error("summary refresh unavailable");
    });
    const { dom, container, root } = await mount(async (request) => ({
      ...request,
      status: "relocated",
      revision: `vaultrelocationrev_${"c".repeat(64)}`
    }), refreshed);

    await click(dom, button(container, labels.action));
    await settle(dom);

    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(labels.relocated);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("is integrated only into Vault & Note Storage", () => {
    const panel = fs.readFileSync(path.resolve(
      "apps/desktop/src/renderer/src/components/VaultBackupSettingsPanel.tsx"
    ), "utf8");
    const action = fs.readFileSync(path.resolve(
      "apps/desktop/src/renderer/src/components/VaultStorageRelocationAction.tsx"
    ), "utf8");
    expect(panel).toContain("<VaultStorageRelocationAction");
    expect(panel).toContain('props.t("vaultSettings.relocateDescription")');
    expect(action).toContain("triggerRef.current?.focus()");
  });
});

async function mount(
  relocateStorage: (request: VaultStorageRelocationRequest) => Promise<VaultStorageRelocationResult>,
  onRelocated: () => Promise<void>
) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://pige.test"
  });
  installDom(dom);
  Object.defineProperty(dom.window.crypto, "randomUUID", {
    configurable: true,
    value: () => "01234567-89ab-cdef-0123-456789abcdef"
  });
  Object.defineProperty(dom.window, "pige", {
    configurable: true,
    value: {
      vault: {
        storageRelocationStatus: async () => ({
          apiVersion: 1,
          status: "ready",
          activeVaultId,
          revision
        }),
        relocateStorage
      }
    }
  });
  const container = dom.window.document.querySelector<HTMLElement>("#root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(VaultStorageRelocationAction, {
      activeVaultId,
      disabled: false,
      labels,
      onRelocated
    }));
    await settle(dom);
  });
  return { dom, container, root };
}

function installDom(dom: JSDOM): void {
  for (const key of globalKeys) originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent
  };
  for (const key of globalKeys) {
    Object.defineProperty(globalThis, key, { configurable: true, value: values[key], writable: true });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === text);
  if (!match) throw new Error(`Button not found: ${text}`);
  return match;
}

async function click(dom: JSDOM, element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
  await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() =>
    dom.window.requestAnimationFrame(() => resolve())));
}
