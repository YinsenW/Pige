import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  JobSummary,
  JobsListRequest,
  Locale,
  ModelProviderSettingsSummary,
  OnboardingStatus,
  RestoreApplyRequest,
  RestoreApplyResult,
  RestorePreviewResult,
  VaultRevealResult,
  VaultRevealTarget,
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

describe("First-run onboarding UI", () => {
  it("keeps first paint language-neutral until the system-derived appearance owner resolves", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    let resolveAppearance: ((value: { readonly locale: Locale; readonly availableLocales: readonly Locale[] }) => void) | undefined;
    harness.appearance = () => new Promise((resolve) => { resolveAppearance = resolve; });

    const { container, root } = await mountApp(dom, makePigeApi(harness));

    expect(container.querySelector('.first-run-language-loading[role="status"]')).not.toBeNull();
    expect(container.querySelector("#first-run-language")).toBeNull();
    expect(container.textContent).not.toContain("中文");

    await act(async () => {
      resolveAppearance?.({ locale: "en", availableLocales: ["zh-Hans", "en", "ja", "ko", "fr", "de"] });
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector("#first-run-language") !== null);
    expect(container.querySelector<HTMLSelectElement>("#first-run-language")?.value).toBe("en");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("orders language, optional Models, and mandatory Vault without inventing completion state", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    const { container, root } = await mountApp(dom, makePigeApi(harness));

    await waitFor(dom, () => container.querySelector(".first-run-step.language") !== null);
    const language = container.querySelector<HTMLSelectElement>("#first-run-language");
    if (!language) throw new Error("Language selector not found.");
    await changeSelect(dom, language, "de");
    expect(harness.localeRequests).toEqual(["de"]);

    await click(dom, requireElement(container.querySelector<HTMLButtonElement>(".first-run-step.language .first-run-next")) as HTMLButtonElement);
    await waitFor(dom, () => container.querySelector(".first-run-step.models") !== null);
    expect(container.querySelector(".first-run-model-panel .model-settings-page")).not.toBeNull();
    expect(container.textContent).not.toContain("Create Vault");
    expect(container.querySelector('textarea[aria-label="Capture or ask"]')).toBeNull();
    expect(harness.modelSummaryReads).toBeGreaterThan(0);
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector(".first-run-step.models"));

    await click(dom, requireElement(container.querySelector<HTMLButtonElement>(".first-run-step.models .first-run-next")) as HTMLButtonElement);
    await waitFor(dom, () => container.querySelector(".first-run-step.vault") !== null);
    expect(container.querySelectorAll(".first-run-step.vault .first-run-choice")).toHaveLength(3);
    expect(container.querySelector('textarea[aria-label="Capture or ask"]')).toBeNull();
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector(".first-run-step.vault"));

    await click(dom, requireElement(container.querySelector<HTMLButtonElement>(".first-run-step.vault .first-run-back")) as HTMLButtonElement);
    await waitFor(dom, () => container.querySelector(".first-run-step.models") !== null);

    await act(async () => root.unmount());
    dom.window.close();
  });
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

    await advanceToVault(dom, container);

    expect(container.querySelector(".first-run-card")).not.toBeNull();
    expect(container.querySelector<HTMLImageElement>(".first-run-brand img")?.alt).toBe("");
    expect(container.querySelectorAll(".first-run-choice")).toHaveLength(3);
    expect(container.querySelector("#vault-name")).not.toBeNull();
    expect(container.textContent).toContain("Choose your local knowledge base");
    expect(container.textContent).not.toContain("Connect a model");

    await click(dom, button(container, "Restore Backup"));
    await waitFor(dom, () => container.textContent?.includes("Restore preview") ?? false);

    expect(container.querySelector(".first-run-step.vault")).toBeNull();
    expect(container.querySelector(".first-run-step.restore .restore-preview")).not.toBeNull();

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

    await advanceToVault(dom, container);

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
    await waitFor(dom, () => dom.window.document.activeElement === button(container, "Restore Backup"));
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

    await openVaultSettings(dom, container);
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

    await advanceToVault(dom, container);

    await click(dom, button(container, "Restore Backup"));
    await waitFor(dom, () => container.textContent?.includes("Restore preview") ?? false);
    await click(dom, button(container, "Restore as New Vault"));

    await waitFor(dom, () => container.querySelector('textarea[aria-label="Capture or ask"]') !== null);
    expect(harness.applyRequests).toEqual([{ previewId: "restore-preview-clone", mode: "clone_as_new" }]);
    expect(container.textContent).not.toContain("Restore preview");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("owns restarted Backup status in Vault settings with safe retry and current last-backup truth", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    harness.jobs = [backupJob("failed_retryable", "retry")];
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));

    await openVaultSettings(dom, container);
    await waitFor(dom, () => container.textContent?.includes("The backup stopped safely") ?? false);

    expect(container.textContent).not.toContain("RAW_BACKUP_SENTINEL");
    expect(container.textContent).not.toContain("/private/");
    expect(button(container, "Retry").disabled).toBe(false);

    await click(dom, button(container, "Retry"));
    await waitFor(dom, () => container.textContent?.includes("2026-07-14T09:30:00.000Z") ?? false);

    expect(harness.retryJobIds).toEqual(["job_20260714_backupui1"]);
    expect(container.textContent).not.toContain("The backup stopped safely");
    expect(container.querySelectorAll(".backup-job-status")).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("offers one reachable cancel action while a support bundle export is in flight", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), cloneOnlyPreview());
    let rejectExport: ((reason: Error) => void) | undefined;
    let exportRequest: { readonly previewId: string; readonly exportRequestId: string } | undefined;
    const cancelRequests: Array<{ readonly exportRequestId: string }> = [];
    const api = makePigeApi(harness, true) as Record<string, unknown>;
    api.diagnostics = {
      health: async () => null,
      previewSupportBundle: async () => supportBundlePreview(),
      exportSupportBundle: (request: typeof exportRequest) => {
        exportRequest = request;
        return new Promise((_resolve, reject) => { rejectExport = reject; });
      },
      cancelSupportBundleExport: async (request: { readonly exportRequestId: string }) => {
        cancelRequests.push(request);
        return { status: "cancel_requested" } as const;
      }
    };
    const { container, root } = await mountApp(dom, api);

    await openSettingsSection(dom, container, "Updates & Diagnostics");
    await click(dom, button(container, "Preview and export…"));
    await waitFor(dom, () => container.textContent?.includes("Preview ready") ?? false);
    await click(dom, button(container, "Export Support Bundle"));
    await waitFor(dom, () => button(container, "Cancel Export") !== undefined);
    expect(Array.from(container.querySelectorAll("button"))
      .filter((candidate) => candidate.textContent === "Cancel Export")).toHaveLength(1);
    expect(exportRequest?.previewId).toBe("support_20260715000000");
    expect(exportRequest?.exportRequestId).toMatch(/^[a-f0-9-]{16,64}$/u);

    await click(dom, button(container, "Cancel Export"));
    expect(cancelRequests).toEqual([{ exportRequestId: exportRequest?.exportRequestId }]);
    await act(async () => {
      rejectExport?.(new Error("RAW_CANCEL_FAILURE /private/diagnostics"));
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes("Export Support Bundle") ?? false);
    expect(container.textContent).not.toContain("RAW_CANCEL_FAILURE");
    expect(container.textContent).not.toContain("/private/diagnostics");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("cancels an in-flight support export when navigation unmounts its owning panel", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), cloneOnlyPreview());
    let rejectExport: ((reason: Error) => void) | undefined;
    let exportRequestId: string | undefined;
    const cancelRequests: string[] = [];
    const api = makePigeApi(harness, true) as Record<string, unknown>;
    api.diagnostics = {
      health: async () => null,
      previewSupportBundle: async () => supportBundlePreview(),
      exportSupportBundle: (request: { readonly exportRequestId: string }) => {
        exportRequestId = request.exportRequestId;
        return new Promise((_resolve, reject) => { rejectExport = reject; });
      },
      cancelSupportBundleExport: async (request: { readonly exportRequestId: string }) => {
        cancelRequests.push(request.exportRequestId);
        return { status: "cancel_requested" } as const;
      }
    };
    const { container, root } = await mountApp(dom, api);

    await openSettingsSection(dom, container, "Updates & Diagnostics");
    await click(dom, button(container, "Preview and export…"));
    await waitFor(dom, () => container.textContent?.includes("Preview ready") ?? false);
    await click(dom, button(container, "Export Support Bundle"));
    await waitFor(dom, () => container.textContent?.includes("Cancel Export") ?? false);
    await click(dom, buttonByAriaLabel(container, "Close Settings"));
    await waitFor(dom, () => cancelRequests.length === 1);
    expect(cancelRequests).toEqual([exportRequestId]);

    await act(async () => {
      rejectExport?.(new Error("synthetic cancellation"));
      await settle(dom);
    });
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("offers cancel only for active user Backups and no retry for terminal choose-path failures", async () => {
    const runningDom = createDom();
    const runningHarness = createHarness(readyOnboarding(), bothModesPreview());
    runningHarness.jobs = [backupJob("running")];
    const runningApp = await mountApp(runningDom, makePigeApi(runningHarness, true));

    await openVaultSettings(runningDom, runningApp.container);
    await waitFor(runningDom, () => runningApp.container.textContent?.includes("Creating and validating") ?? false);
    expect(runningApp.container.textContent).not.toContain("RAW_BACKUP_SENTINEL");
    await click(runningDom, button(runningApp.container, "Cancel"));
    expect(runningHarness.cancelJobIds).toEqual(["job_20260714_backupui1"]);
    await waitFor(runningDom, () => runningApp.container.querySelector(".backup-job-status") === null);
    await act(async () => runningApp.root.unmount());
    runningDom.window.close();

    const failedDom = createDom();
    const failedHarness = createHarness(readyOnboarding(), bothModesPreview());
    failedHarness.jobs = [backupJob("failed_final")];
    const failedApp = await mountApp(failedDom, makePigeApi(failedHarness, true));

    await openVaultSettings(failedDom, failedApp.container);
    await waitFor(failedDom, () => failedApp.container.textContent?.includes("could not continue safely") ?? false);
    expect(failedApp.container.textContent).not.toContain("RAW_BACKUP_SENTINEL");
    expect(Array.from(failedApp.container.querySelectorAll("button")).some((item) => item.textContent === "Retry"))
      .toBe(false);
    expect(button(failedApp.container, "Create Backup").disabled).toBe(false);
    await act(async () => failedApp.root.unmount());
    failedDom.window.close();
  });

  it("continues polling a recovered active Backup without ephemeral renderer busy state", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    harness.jobs = [backupJob("running")];
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));

    await openVaultSettings(dom, container);
    await waitFor(dom, () => container.textContent?.includes("Creating and validating") ?? false);
    harness.jobs = [];
    await act(async () => {
      await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 1_300));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector(".backup-job-status") === null);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("owns storage reveal busy, failure, retry, and focus without exposing raw paths", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    let rejectReveal: ((reason: Error) => void) | undefined;
    harness.revealStorageRoot = (target) => {
      harness.revealRequests.push(target);
      return new Promise((_, reject) => { rejectReveal = reject; });
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));

    await openVaultSettings(dom, container);
    const revealNotes = button(container, "Show note storage");
    const revealSources = button(container, "Show source storage");
    await act(async () => {
      revealNotes.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      revealNotes.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
    });

    expect(harness.revealRequests).toEqual(["knowledge_root"]);
    expect(revealNotes.disabled).toBe(true);
    expect(revealSources.disabled).toBe(true);
    expect(button(container, "Open another vault").disabled).toBe(true);
    expect(button(container, "Create new vault").disabled).toBe(true);
    expect(revealNotes.closest(".settings-actions")?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      rejectReveal?.(new Error("RAW_REVEAL_SENTINEL path-sentinel"));
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes("Pige could not show this storage location") ?? false);
    await waitFor(dom, () => dom.window.document.activeElement === revealNotes);
    expect(container.textContent).not.toContain("RAW_REVEAL_SENTINEL");
    expect(container.textContent).not.toContain("path-sentinel");
    expect(revealNotes.disabled).toBe(false);

    harness.revealStorageRoot = async (target) => {
      harness.revealRequests.push(target);
      return { status: "revealed", target };
    };
    await click(dom, revealNotes);
    expect(harness.revealRequests).toEqual(["knowledge_root", "knowledge_root"]);
    expect(container.textContent).toContain("Opened in the system file manager.");
    await waitFor(dom, () => dom.window.document.activeElement === revealNotes);

    await act(async () => root.unmount());
    dom.window.close();
  });
});

interface RestoreHarness {
  onboarding: OnboardingStatus;
  appearance: () => Promise<{ readonly locale: Locale; readonly availableLocales: readonly Locale[] }>;
  readonly localeRequests: Locale[];
  modelSummary: ModelProviderSettingsSummary;
  modelSummaryReads: number;
  readonly preview: RestorePreviewResult;
  readonly applyRequests: RestoreApplyRequest[];
  jobs: JobSummary[];
  readonly retryJobIds: string[];
  readonly cancelJobIds: string[];
  readonly revealRequests: VaultRevealTarget[];
  lastBackupAt?: string;
  applyRestore: (request: RestoreApplyRequest) => Promise<RestoreApplyResult>;
  revealStorageRoot: (target: VaultRevealTarget) => Promise<VaultRevealResult>;
}

function createHarness(onboarding: OnboardingStatus, preview: RestorePreviewResult): RestoreHarness {
  const harness: RestoreHarness = {
    onboarding,
    appearance: async () => ({ locale: "en", availableLocales: ["zh-Hans", "en", "ja", "ko", "fr", "de"] }),
    localeRequests: [],
    modelSummary: emptyModelSummary(),
    modelSummaryReads: 0,
    preview,
    applyRequests: [],
    jobs: [],
    retryJobIds: [],
    cancelJobIds: [],
    revealRequests: [],
    applyRestore: async (request) => {
      harness.applyRequests.push(request);
      return { status: "canceled" };
    },
    revealStorageRoot: async (target) => {
      harness.revealRequests.push(target);
      return { status: "revealed", target };
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
      currentLayout: async () => ({
        apiVersion: 1,
        revision: 0,
        surface: "home",
        sidebarOpen,
        noteAgentOpen: false,
        sidebarPresentation: sidebarOpen ? "resident" : "closed",
        noteAgentPresentation: "closed",
        autoExpanded: false,
        isMaximized: false,
        isFullScreen: false
      }),
      setLayout: async (request: { readonly surface: "home" | "reader"; readonly sidebarOpen: boolean; readonly noteAgentOpen: boolean }) => ({
        apiVersion: 1,
        revision: 1,
        ...request,
        sidebarPresentation: request.sidebarOpen ? "resident" : "closed",
        noteAgentPresentation: request.noteAgentOpen ? "resident" : "closed",
        autoExpanded: false,
        isMaximized: false,
        isFullScreen: false
      }),
      onLayoutChanged: () => () => undefined,
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
      appearance: () => harness.appearance(),
      setLocale: async ({ locale }: { readonly locale: Locale }) => {
        harness.localeRequests.push(locale);
        return { locale, availableLocales: ["zh-Hans", "en", "ja", "ko", "fr", "de"] };
      }
    },
    system: {
      toolchainHealth: async () => null
    },
    maintenance: {
      localDatabaseStatus: async () => null,
      rebuildLocalDatabase: async () => ({ status: "queued" }),
      resetLocalDatabase: async () => ({ resetAt: "2026-07-15T00:00:00.000Z", removedRoots: [], recreatedRoots: [] })
    },
    diagnostics: {
      health: async () => null,
      previewSupportBundle: async () => supportBundlePreview(),
      exportSupportBundle: async () => ({ status: "canceled" }),
      cancelSupportBundleExport: async () => ({ status: "not_found" })
    },
    vault: {
      onboardingStatus: async () => harness.onboarding,
      recent: async () => [],
      removeRecent: async () => [],
      dismissFirstHomeGuide: async () => harness.onboarding,
      revealKnowledgeRoot: async () => harness.revealStorageRoot("knowledge_root"),
      revealSourceAssetRoot: async () => harness.revealStorageRoot("source_asset_root")
    },
    backup: {
      status: async () => ({
        phase: "available",
        createAvailable: Boolean(harness.onboarding.activeVault),
        restoreAvailable: true,
        ...(harness.lastBackupAt ? { lastBackupAt: harness.lastBackupAt } : {}),
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
    speech: {
      onAssetInstallEvent: () => () => undefined
    },
    agent: {
      runtimeStatus: async () => null,
      conversation: async () => undefined,
      onTurnDraft: () => () => undefined
    },
    models: {
      summary: async () => {
        harness.modelSummaryReads += 1;
        return harness.modelSummary;
      }
    },
    modelEgress: {
      pending: async () => undefined
    },
    jobs: {
      list: async (request: JobsListRequest = {}) => {
        const stateFilter = new Set(request.states ?? []);
        const classFilter = new Set(request.classes ?? []);
        const jobs = harness.jobs
          .filter((job) => stateFilter.size === 0 || stateFilter.has(job.state))
          .filter((job) => classFilter.size === 0 || classFilter.has(job.class));
        return {
        scannedAt: "2026-07-14T08:00:00.000Z",
        activeVaultId: harness.onboarding.activeVault?.vaultId ?? "vault_restore_ui",
        total: jobs.length,
        invalidJobCount: 0,
        jobs
        };
      },
      retry: async ({ jobId }: { readonly jobId: string }) => {
        harness.retryJobIds.push(jobId);
        const job = harness.jobs.find((candidate) => candidate.id === jobId);
        if (!job) return { status: "not_found" } as const;
        const completed = { ...job, state: "completed", updatedAt: "2026-07-14T09:30:00.000Z" } as const;
        harness.jobs = [];
        harness.lastBackupAt = completed.updatedAt;
        return { status: "requeued", job: completed } as const;
      },
      cancel: async ({ jobId }: { readonly jobId: string }) => {
        harness.cancelJobIds.push(jobId);
        harness.jobs = [];
        return { status: "cancelled" } as const;
      }
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

function supportBundlePreview() {
  return {
    previewId: "support_20260715000000",
    generatedAt: "2026-07-15T00:00:00.000Z",
    localOnly: true as const,
    estimatedBytes: 1024,
    includedCategories: [],
    excludedCategories: [],
    privacyWarnings: []
  };
}

function emptyModelSummary(): ModelProviderSettingsSummary {
  return {
    presets: [],
    providers: [],
    models: [],
    hasDefaultModel: false,
    defaultBinding: { state: "not_configured" }
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

function backupJob(
  state: "failed_retryable" | "failed_final" | "running",
  userAction: "retry" | "choose_path" = "choose_path"
): JobSummary {
  return {
    id: "job_20260714_backupui1",
    class: "backup",
    state,
    stage: "backing_up",
    backupKind: "user_backup",
    ...(state.startsWith("failed") ? {
      error: {
        code: state === "failed_retryable" ? "backup.execution_failed" : "backup.destination_changed",
        domain: "backup",
        messageKey: state === "failed_retryable"
          ? "errors.backup.execution_failed"
          : "errors.backup.destination_changed",
        retryable: state === "failed_retryable",
        severity: "error",
        userAction
      }
    } : {}),
    message: "RAW_BACKUP_SENTINEL /private/hidden-backup.zip",
    createdAt: "2026-07-14T09:00:00.000Z",
    updatedAt: "2026-07-14T09:05:00.000Z"
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
    .find((candidate) =>
      candidate.textContent === label ||
      candidate.querySelector("strong")?.textContent === label
    );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

function buttonByAriaLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const match = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!match) throw new Error(`Button not found by aria-label: ${label}`);
  return match;
}

async function openVaultSettings(dom: JSDOM, container: HTMLElement): Promise<void> {
  await openSettingsSection(dom, container, "Vault & Note Storage");
}

async function openSettingsSection(dom: JSDOM, container: HTMLElement, label: string): Promise<void> {
  const settingsTrigger = container.querySelector<HTMLButtonElement>(".sidebar-settings-control");
  if (!settingsTrigger) throw new Error("Settings trigger not found.");
  await click(dom, settingsTrigger);
  const section = Array.from(container.querySelectorAll<HTMLButtonElement>(".settings-nav-item"))
    .find((candidate) => candidate.querySelector("span")?.textContent === label);
  if (!section) throw new Error(`Settings section not found: ${label}`);
  await click(dom, section);
}

async function advanceToVault(dom: JSDOM, container: HTMLElement): Promise<void> {
  await waitFor(dom, () => container.querySelector(".first-run-step.language .first-run-next") !== null);
  await click(dom, requireElement(
    container.querySelector<HTMLButtonElement>(".first-run-step.language .first-run-next")
  ) as HTMLButtonElement);
  await waitFor(dom, () => container.querySelector(".first-run-step.models .first-run-next") !== null);
  await click(dom, requireElement(
    container.querySelector<HTMLButtonElement>(".first-run-step.models .first-run-next")
  ) as HTMLButtonElement);
  await waitFor(dom, () => container.querySelector(".first-run-step.vault") !== null);
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

async function changeSelect(dom: JSDOM, element: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
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
