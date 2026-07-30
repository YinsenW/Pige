import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { VaultDisplayNameEditor } from "../../apps/desktop/src/renderer/src/components/VaultDisplayNameEditor";

const globalKeys = [
  "window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "Event", "MouseEvent"
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

describe("Vault display-name Settings editor", () => {
  it("submits the exact active Vault revision, adopts success, refreshes, and restores focus", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    const requests: unknown[] = [];
    const pendingChanges: boolean[] = [];
    let refreshes = 0;
    installRename(dom, async (request) => {
      requests.push(request);
      return {
        ...request,
        status: "renamed" as const,
        metadata: {
          activeVaultId: request.activeVaultId,
          displayName: request.displayName,
          revision: `vaultmeta_${"b".repeat(64)}`
        }
      };
    });
    const vault = makeVault("vault_20260731_renameui1", "Original", "a");
    await act(async () => {
      root.render(createElement(VaultDisplayNameEditor, {
        vault,
        disabled: false,
        onPendingChange: (pending) => { pendingChanges.push(pending); },
        onRefresh: async () => { refreshes += 1; },
        t
      }));
      await settle(dom);
    });
    const edit = button(container, "Rename");
    await click(dom, edit);
    const input = requireElement(container.querySelector<HTMLInputElement>("#vault-display-name"));
    await change(dom, input, "Project Atlas");
    const save = button(container, "Save name");
    await click(dom, save);
    await waitFor(dom, () => refreshes === 1 && dom.window.document.activeElement === button(container, "Rename"));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: vault.vaultId,
      expectedMetadataRevision: vault.metadataRevision,
      displayName: "Project Atlas"
    });
    expect(String((requests[0] as { requestId: string }).requestId)).toMatch(/^vaultrenamereq_[a-z0-9]{16,64}$/u);
    expect(input.value).toBe("Project Atlas");
    expect(container.textContent).toContain("Vault name updated.");
    expect(pendingChanges).toEqual([true, false]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a stale draft across authoritative refresh and resets it only when the active Vault changes", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    let vault = makeVault("vault_20260731_renameui2", "Original", "c");
    const render = (): void => root.render(createElement(VaultDisplayNameEditor, {
      vault,
      disabled: false,
      onPendingChange: () => undefined,
      onRefresh: async () => {
        vault = makeVault(vault.vaultId, "Elsewhere", "d");
        render();
      },
      t
    }));
    installRename(dom, async (request) => ({
      ...request,
      status: "stale" as const,
      metadata: {
        activeVaultId: request.activeVaultId,
        displayName: "Elsewhere",
        revision: `vaultmeta_${"d".repeat(64)}`
      }
    }));
    await act(async () => { render(); await settle(dom); });
    await click(dom, button(container, "Rename"));
    const input = requireElement(container.querySelector<HTMLInputElement>("#vault-display-name"));
    await change(dom, input, "My retained draft");
    await click(dom, button(container, "Save name"));
    await waitFor(dom, () => container.textContent?.includes("changed elsewhere") === true);

    expect(input.value).toBe("My retained draft");
    expect(container.textContent).toContain("/display/fixed-vault");

    vault = makeVault("vault_20260731_renameui3", "Second Vault", "e");
    await act(async () => { render(); await settle(dom); });
    expect(container.querySelector("#vault-display-name")).toBeNull();
    expect(container.textContent).toContain("Second Vault");
    expect(container.textContent).not.toContain("changed elsewhere");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("cancels with Escape, discards the draft, and restores the rename trigger focus", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    installRename(dom, vi.fn());
    await act(async () => {
      root.render(createElement(VaultDisplayNameEditor, {
        vault: makeVault("vault_20260731_renameui4", "Original", "f"),
        disabled: false,
        onPendingChange: () => undefined,
        onRefresh: async () => undefined,
        t
      }));
      await settle(dom);
    });

    const edit = button(container, "Rename");
    await click(dom, edit);
    const input = requireElement(container.querySelector<HTMLInputElement>("#vault-display-name"));
    await change(dom, input, "Discard me");
    await act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    await waitFor(dom, () => dom.window.document.activeElement === button(container, "Rename"));

    expect(container.querySelector("#vault-display-name")).toBeNull();
    expect(container.textContent).toContain("Original");

    await act(async () => root.unmount());
    dom.window.close();
  });
});

function makeVault(vaultId: string, name: string, revisionCharacter: string): VaultSummary {
  return {
    vaultId,
    name,
    metadataRevision: `vaultmeta_${revisionCharacter.repeat(64)}`,
    activeVaultPathDisplay: "/display/fixed-vault",
    knowledgeRootDisplay: "/display/fixed-vault",
    sourceAssetRootDisplay: "/display/fixed-vault/raw",
    sourceAssetRootKind: "inside_vault",
    managedCopyRoot: {
      activeVaultId: vaultId,
      sourceStorageRevision: `ssrev_${"a".repeat(64)}`,
      mode: "inside_vault",
      availability: "available",
      canConfigure: true
    },
    defaultSourceStorageStrategy: "copy_to_source_library",
    schemaVersion: 2
  };
}

function installRename(dom: JSDOM, renameDisplayName: (...args: any[]) => unknown): void {
  Object.defineProperty(dom.window, "pige", {
    configurable: true,
    value: { vault: { renameDisplayName: vi.fn(renameDisplayName) } }
  });
}

function t(key: string): string {
  return ({
    "vaultSettings.rename.label": "Vault name",
    "vaultSettings.rename.description": "Display only",
    "vaultSettings.rename.cancel": "Cancel",
    "vaultSettings.rename.edit": "Rename",
    "vaultSettings.rename.save": "Save name",
    "vaultSettings.rename.saving": "Saving…",
    "vaultSettings.rename.renamed": "Vault name updated.",
    "vaultSettings.rename.stale": "The Vault name changed elsewhere.",
    "vaultSettings.rename.notFound": "The active Vault changed.",
    "vaultSettings.rename.failed": "Rename failed."
  } as Record<string, string>)[key] ?? key;
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost"
  });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}

async function change(dom: JSDOM, input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await settle(dom);
  });
}

async function click(dom: JSDOM, element: HTMLButtonElement): Promise<void> {
  await act(async () => { element.click(); await settle(dom); });
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await act(async () => { await settle(dom); });
  }
  throw new Error("Timed out waiting for Vault display-name UI state.");
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Expected element.");
  return value;
}
