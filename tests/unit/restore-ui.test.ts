import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  OnboardingStatus,
  RestoreApplyRequest,
  RestoreApplyResult,
  RestorePreviewResult,
  VaultSummary
} from "@pige/contracts";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
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

describe("Restore identity UI", () => {
  it("renders versioned manifest facts and localized typed warnings without archive details", async () => {
    const dom = createDom();
    const preview = readyPreview(
      "restore-preview-warnings",
      ["clone_as_new"],
      "clone_as_new",
      [
        { code: "invalid_archive_entries", count: 2 },
        { code: "excluded_rebuildable_roots", count: 3 },
        { code: "external_originals_not_included", count: 1 }
      ]
    );
    const { container, root } = await mountApp(
      dom,
      makePigeApi(createHarness(blockedOnboarding(), preview))
    );

    await click(dom, button(container, "Restore Backup"));
    await waitFor(dom, () => container.textContent?.includes("Restore preview") ?? false);

    const text = container.textContent ?? "";
    expect(text).toContain("App version0.0.0-test");
    expect(text).toContain("Vault schema version1");
    expect(text).toContain("Invalid archive entries2");
    expect(text).toContain("Excluded rebuildable roots3");
    expect(text).toContain("External originals not included1");
    expect(text).not.toContain("Checksum, size, or manifest mismatch");
    expect(text).not.toContain("/private/");
    expect(container.querySelectorAll(".restore-warning-list li")).toHaveLength(3);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("defaults first-run restore to the eligible clone mode and fails safely without duplicate apply", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    let rejectApply: ((reason: Error) => void) | undefined;
    harness.applyRestore = (request) => {
      harness.applyRequests.push(request);
      return new Promise((_, reject) => { rejectApply = reject; });
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness));

    const restoreTrigger = button(container, "Restore Backup");
    await click(dom, restoreTrigger);
    await waitFor(dom, () => container.textContent?.includes("Restore preview") ?? false);

    const clone = radio(container, "clone_as_new");
    expect(clone.checked).toBe(true);
    expect(clone.labels?.[0]?.textContent).toContain("Restore as a new vault");
    expect(container.querySelector('input[value="replace_existing"]')).toBeNull();
    expect(container.textContent).not.toContain("Pige will close the current vault");
    expect(container.querySelector("fieldset")?.textContent).toContain("Restore as");

    const apply = button(container, "Restore as New Vault");
    await act(async () => {
      apply.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      apply.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
    });
    expect(harness.applyRequests).toEqual([{ previewId: "restore-preview-clone", mode: "clone_as_new" }]);
    expect(container.textContent).toContain("Restoring and rebuilding local indexes...");

    await act(async () => {
      rejectApply?.(new Error("RAW_RESTORE_SENTINEL /private/vault"));
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes("Pige could not safely continue this restore") ?? false);
    expect(container.textContent).not.toContain("RAW_RESTORE_SENTINEL");
    expect(container.textContent).not.toContain("/private/vault");
    await waitFor(dom, () => dom.window.document.activeElement === apply);

    await click(dom, button(container, "Cancel"));
    await waitFor(dom, () => dom.window.document.activeElement === restoreTrigger);
    expect(container.textContent).not.toContain("Restore preview");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shows explicit replace ownership in Vault settings and restores focus after cancellation", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    harness.applyRestore = async (request) => {
      harness.applyRequests.push(request);
      return { status: "canceled" };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));

    await click(dom, button(container, "Vault & Note Storage"));
    await click(dom, button(container, "Restore Backup"));
    await waitFor(dom, () => container.textContent?.includes("Restore preview") ?? false);

    expect(radio(container, "clone_as_new").checked).toBe(true);
    const replace = radio(container, "replace_existing");
    replace.focus();
    expect(dom.window.document.activeElement).toBe(replace);
    expect(replace.labels?.[0]?.textContent).toContain("Replace the current vault");
    await clickInput(dom, replace);
    expect(replace.checked).toBe(true);
    expect(container.textContent).toContain(
      "Pige will close the current vault and create a rollback backup before replacement."
    );

    const apply = button(container, "Replace Current Vault");
    await click(dom, apply);
    expect(harness.applyRequests).toEqual([{
      previewId: "restore-preview-both",
      mode: "replace_existing"
    }]);
    await waitFor(dom, () => dom.window.document.activeElement === apply);
    expect(container.textContent).toContain("Restore preview");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("activates the restored vault through the ordinary first-run refresh", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    harness.applyRestore = async (request) => {
      harness.applyRequests.push(request);
      harness.onboarding = readyOnboarding();
      return { status: "restored", jobId: "job_restore_20260714_success" };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness));

    await click(dom, button(container, "Restore Backup"));
    await waitFor(dom, () => container.textContent?.includes("Restore preview") ?? false);
    await click(dom, button(container, "Restore as New Vault"));

    await waitFor(dom, () => container.querySelector('textarea[aria-label="Capture or ask"]') !== null);
    expect(harness.applyRequests).toEqual([{ previewId: "restore-preview-clone", mode: "clone_as_new" }]);
    expect(container.textContent).not.toContain("Restore preview");

    await act(async () => root.unmount());
    dom.window.close();
  });
});

interface RestoreHarness {
  onboarding: OnboardingStatus;
  readonly preview: RestorePreviewResult;
  readonly applyRequests: RestoreApplyRequest[];
  applyRestore: (request: RestoreApplyRequest) => Promise<RestoreApplyResult>;
}

function createHarness(onboarding: OnboardingStatus, preview: RestorePreviewResult): RestoreHarness {
  const harness: RestoreHarness = {
    onboarding,
    preview,
    applyRequests: [],
    applyRestore: async (request) => {
      harness.applyRequests.push(request);
      return { status: "canceled" };
    }
  };
  return harness;
}

function makePigeApi(harness: RestoreHarness, sidebarOpen = false): object {
  return {
    getHealth: async () => ({ status: "ok", appVersion: "test", checkedAt: "2026-07-14T08:00:00.000Z" }),
    window: {
      current: async () => ({
        mode: "expanded",
        alwaysOnTop: false,
        sidebarOpen,
        isFullScreen: false,
        size: { width: 1280, height: 800 }
      }),
      setMode: async ({ mode }: { readonly mode: string }) => ({
        mode,
        alwaysOnTop: false,
        sidebarOpen,
        isFullScreen: false,
        size: { width: 1280, height: 800 }
      }),
      setAlwaysOnTop: async () => ({
        mode: "expanded",
        alwaysOnTop: false,
        sidebarOpen,
        isFullScreen: false,
        size: { width: 1280, height: 800 }
      }),
      setSidebarOpen: async ({ sidebarOpen: next }: { readonly sidebarOpen: boolean }) => ({
        mode: "expanded",
        alwaysOnTop: false,
        sidebarOpen: next,
        isFullScreen: false,
        size: { width: 1280, height: 800 }
      })
    },
    settings: {
      appearance: async () => ({ locale: "en", availableLocales: ["en"] }),
      setLocale: async () => ({ locale: "en", availableLocales: ["en"] })
    },
    system: {
      toolchainHealth: async () => null
    },
    vault: {
      onboardingStatus: async () => harness.onboarding,
      recent: async () => [],
      removeRecent: async () => [],
      dismissFirstHomeGuide: async () => harness.onboarding
    },
    backup: {
      status: async () => ({
        phase: "available",
        createAvailable: Boolean(harness.onboarding.activeVault),
        restoreAvailable: true,
        messageKey: harness.onboarding.activeVault ? "backup.statusReady" : "backup.statusNoVault",
        defaultIncludes: {
          markdownKnowledge: true,
          sourceRecords: true,
          managedSourceCopies: true,
          conversations: true,
          vaultMemory: true,
          trash: true,
          rebuildableDatabaseCache: false,
          secrets: false
        }
      }),
      previewRestore: async () => harness.preview,
      applyRestore: (request: RestoreApplyRequest) => harness.applyRestore(request),
      create: async () => ({ status: "canceled" })
    },
    agent: {
      runtimeStatus: async () => null,
      conversation: async () => undefined,
      onTurnDraft: () => () => undefined
    },
    modelEgress: {
      pending: async () => undefined
    },
    jobs: {
      list: async () => ({
        scannedAt: "2026-07-14T08:00:00.000Z",
        activeVaultId: harness.onboarding.activeVault?.vaultId ?? "vault_restore_ui",
        total: 0,
        invalidJobCount: 0,
        jobs: []
      })
    },
    proposals: {
      list: async () => ({
        scannedAt: "2026-07-14T08:00:00.000Z",
        activeVaultId: harness.onboarding.activeVault?.vaultId ?? "vault_restore_ui",
        total: 0,
        invalidProposalCount: 0,
        proposals: []
      })
    },
    activity: {
      list: async () => ({
        scannedAt: "2026-07-14T08:00:00.000Z",
        activeVaultId: harness.onboarding.activeVault?.vaultId ?? "vault_restore_ui",
        total: 0,
        invalidOperationCount: 0,
        activities: []
      })
    }
  };
}

function blockedOnboarding(): OnboardingStatus {
  return {
    state: "blocked_no_vault",
    hasDefaultModel: false,
    showFirstHomeGuide: false
  };
}

function readyOnboarding(): OnboardingStatus {
  return {
    state: "ready",
    hasDefaultModel: true,
    showFirstHomeGuide: false,
    activeVault: vaultSummary()
  };
}

function vaultSummary(): VaultSummary {
  return {
    vaultId: "vault_restore_ui",
    name: "Restore UI Vault",
    activeVaultPathDisplay: "Restore UI Vault",
    knowledgeRootDisplay: "Restore UI Vault",
    sourceAssetRootDisplay: "Restore UI Vault sources",
    sourceAssetRootKind: "inside_vault",
    defaultSourceStorageStrategy: "copy_to_source_library",
    schemaVersion: 1,
    counts: { notes: 2, sources: 1, managedSourceCopies: 1, referencedOriginals: 0 }
  };
}

function cloneOnlyPreview(): RestorePreviewResult {
  return readyPreview("restore-preview-clone", ["clone_as_new"], "clone_as_new");
}

function bothModesPreview(): RestorePreviewResult {
  return readyPreview(
    "restore-preview-both",
    ["clone_as_new", "replace_existing"],
    "replace_existing"
  );
}

function readyPreview(
  previewId: string,
  permittedModes: readonly ("clone_as_new" | "replace_existing")[],
  defaultMode: "clone_as_new" | "replace_existing",
  warnings: Extract<RestorePreviewResult, { readonly status: "ready" }>["warnings"] = []
): RestorePreviewResult {
  return {
    status: "ready",
    previewId,
    manifest: {
      formatVersion: 1,
      format: "pige-backup",
      appVersion: "0.0.0-test",
      vaultId: "vault_restore_ui",
      vaultName: "Restore UI Vault",
      vaultSchemaVersion: 1,
      createdAt: "2026-07-14T08:00:00.000Z",
      fileCount: 5,
      totalBytes: 512,
      noteCount: 2,
      sourceCount: 1,
      conversationCount: 1,
      memoryCount: 1,
      includesSecrets: false,
      includes: {
        markdownKnowledge: true,
        sourceRecords: true,
        managedSourceCopies: true,
        conversations: true,
        vaultMemory: true,
        trash: true,
        rebuildableDatabaseCache: false,
        secrets: false
      }
    },
    invalidFileCount: 0,
    warnings,
    permittedModes,
    defaultMode
  };
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://pige.test"
  });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  dom.window.cancelAnimationFrame = (handle: number): void => dom.window.clearTimeout(handle);
  installDom(dom);
  return dom;
}

async function mountApp(dom: JSDOM, api: object): Promise<{
  readonly container: HTMLElement;
  readonly root: { unmount: () => void };
}> {
  Object.defineProperty(dom.window, "pige", { configurable: true, value: api });
  const [{ createRoot }, { App }] = await Promise.all([
    import("react-dom/client"),
    import("../../apps/desktop/src/renderer/src/App")
  ]);
  const container = requireElement(dom.window.document.getElementById("root"));
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(App));
    await settle(dom);
  });
  return { container, root };
}

function installDom(dom: JSDOM): void {
  for (const key of globalKeys) originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values: Record<(typeof globalKeys)[number], unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent
  };
  for (const key of globalKeys) {
    Object.defineProperty(globalThis, key, { configurable: true, value: values[key], writable: true });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true
  });
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

function radio(container: HTMLElement, value: string): HTMLInputElement {
  const match = container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!match) throw new Error(`Radio not found: ${value}`);
  return match;
}

async function click(dom: JSDOM, element: HTMLButtonElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

async function clickInput(dom: JSDOM, element: HTMLInputElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

function requireElement(element: HTMLElement | null): HTMLElement {
  if (!element) throw new Error("Expected test container.");
  return element;
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await act(async () => settle(dom));
  }
  throw new Error("Timed out waiting for restore UI state.");
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
