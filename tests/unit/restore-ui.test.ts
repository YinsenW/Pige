import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AppearanceSettingsSummary,
  BackupCreateResult,
  BackupContinueIncompleteRequest,
  BackupContinueIncompleteResult,
  BackupReconnectDestinationRequest,
  BackupReconnectDestinationResult,
  JobSummary,
  JobsListRequest,
  LocalDatabaseStatus,
  Locale,
  ManagedCopyRootConfigureRequest,
  ManagedCopyRootConfigureResult,
  ModelProviderSettingsSummary,
  OnboardingStatus,
  OpenRecentVaultRequest,
  RecentVaultSummary,
  RestoreApplyRequest,
  RestoreApplyResult,
  RestoreCancelRequest,
  RestoreCancelResult,
  RestoreRollbackCandidate,
  RestoreRollbackPrepareRequest,
  RestoreRollbackPrepareResult,
  RestoreRollbackStatus,
  RestorePreviewResult,
  UpdateSourceStoragePolicyRequest,
  VaultActionResult,
  VaultMigrationApplyRequest,
  VaultMigrationApplyResult,
  VaultMigrationPreview,
  VaultRevealResult,
  VaultRevealTarget,
  VaultSummary
} from "@pige/contracts";
import {
  BackupContinueIncompleteAction,
  ManagedCopyRootSelectionAction
} from "../../apps/desktop/src/renderer/src/components/VaultBackupSettingsPanel";

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
  it("keeps the managed-copy root picker fail-closed, single-flight, quiet on cancel, and focus-owned", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const fallback = dom.window.document.createElement("button");
    fallback.textContent = "Source storage";
    dom.window.document.body.append(fallback);
    const root = createRoot(container);
    let eligible = false;
    let calls = 0;
    let outcome: "cancelled" | "failed" | "selected" = "cancelled";
    let resolveAttempt: ((value: typeof outcome) => void) | undefined;
    const render = (): void => root.render(createElement(ManagedCopyRootSelectionAction, {
      identityKey: "vault_restore_ui:source_storage_revision_7",
      eligible,
      labels: {
        action: "Choose source storage",
        pending: "Choosing source storage…",
        selected: "Source storage updated.",
        stale: "Source storage changed.",
        failed: "Pige could not update source storage."
      },
      onSelect: () => {
        calls += 1;
        return new Promise((resolve) => { resolveAttempt = resolve; });
      },
      onSelected: async () => { eligible = false; render(); },
      returnFocusRef: { current: fallback }
    }));
    await act(async () => { render(); await settle(dom); });
    expect(buttons(container, "Choose source storage")).toHaveLength(0);

    eligible = true;
    await act(async () => { render(); await settle(dom); });
    const choose = button(container, "Choose source storage");
    await act(async () => { choose.click(); choose.click(); await settle(dom); });
    expect(calls).toBe(1);
    expect(container.textContent).toContain("Choosing source storage…");
    await act(async () => { resolveAttempt?.(outcome); await settle(dom); });
    await waitFor(dom, () => dom.window.document.activeElement === choose);
    expect(container.textContent).not.toContain("Source storage updated.");

    outcome = "failed";
    await click(dom, choose);
    await act(async () => { resolveAttempt?.(outcome); await settle(dom); });
    await waitFor(dom, () => container.textContent?.includes("Pige could not update source storage.") === true);
    expect(buttons(container, "Choose source storage")).toHaveLength(1);

    outcome = "selected";
    await click(dom, choose);
    await act(async () => { resolveAttempt?.(outcome); await settle(dom); });
    await waitFor(dom, () => dom.window.document.activeElement === fallback);
    expect(buttons(container, "Choose source storage")).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps explicit incomplete-Backup continuation single-flight, quiet on cancel, and focus-owned on failure", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const fallback = dom.window.document.createElement("button");
    fallback.textContent = "Backup status";
    dom.window.document.body.append(fallback);
    const root = createRoot(container);
    let calls = 0;
    let outcome: "cancelled" | "failed" | "continued" = "cancelled";
    let resolveAttempt: ((value: typeof outcome) => void) | undefined;
    const render = (): void => root.render(createElement(BackupContinueIncompleteAction, {
      identityKey: "vault_restore_ui:job_backup_incomplete:2026-07-29T10:00:00.000Z",
      eligible: true,
      labels: {
        action: "Continue incomplete backup",
        confirmation: "Continue this incomplete backup?",
        confirm: "Continue",
        cancel: "Cancel",
        pending: "Continuing…",
        continued: "Backup is continuing.",
        stale: "This backup changed.",
        failed: "Pige could not continue this backup."
      },
      onContinue: () => {
        calls += 1;
        return new Promise((resolve) => { resolveAttempt = resolve; });
      },
      onContinued: async () => undefined,
      returnFocusRef: { current: fallback }
    }));
    await act(async () => { render(); await settle(dom); });

    await click(dom, button(container, "Continue incomplete backup"));
    await waitFor(dom, () => dom.window.document.activeElement === button(container, "Continue"));
    await click(dom, button(container, "Cancel"));
    await waitFor(dom, () => dom.window.document.activeElement === button(container, "Continue incomplete backup"));
    expect(calls).toBe(0);

    await click(dom, button(container, "Continue incomplete backup"));
    const confirm = button(container, "Continue");
    await act(async () => {
      confirm.click();
      confirm.click();
      await settle(dom);
    });
    expect(calls).toBe(1);
    expect(container.textContent).toContain("Continuing…");
    await act(async () => { resolveAttempt?.(outcome); await settle(dom); });
    await waitFor(dom, () => dom.window.document.activeElement === button(container, "Continue incomplete backup"));
    expect(container.textContent).not.toContain("Backup is continuing.");

    outcome = "failed";
    await click(dom, button(container, "Continue incomplete backup"));
    await click(dom, button(container, "Continue"));
    await act(async () => { resolveAttempt?.(outcome); await settle(dom); });
    await waitFor(dom, () => container.textContent?.includes("Pige could not continue this backup.") === true);
    expect(button(container, "Continue incomplete backup")).toBeDefined();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps first paint language-neutral until the system-derived appearance owner resolves", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    let resolveAppearance: ((value: AppearanceSettingsSummary) => void) | undefined;
    harness.appearance = () => new Promise((resolve) => { resolveAppearance = resolve; });

    const { container, root } = await mountApp(dom, makePigeApi(harness));

    expect(container.querySelector('.first-run-language-loading[role="status"]')).not.toBeNull();
    expect(container.querySelector("#first-run-language")).toBeNull();
    expect(container.textContent).not.toContain("中文");

    await act(async () => {
      resolveAppearance?.(appearanceSummary("en"));
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

  it("opens a recent vault by stable ID once without treating its display path as authority", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    const recent = recentVaultSummary();
    harness.recentVaults = [recent];
    let resolveOpen: ((result: VaultActionResult) => void) | undefined;
    harness.openRecent = (request) => {
      harness.openRecentRequests.push(request);
      return new Promise((resolve) => { resolveOpen = resolve; });
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness));

    await advanceToVault(dom, container);
    const open = buttonByAriaLabel(container, `Open: ${recent.name}`);
    const remove = buttonByAriaLabel(container, `Forget: ${recent.name}`);
    open.focus();
    await act(async () => {
      open.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      open.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
    });

    expect(harness.openRecentRequests).toEqual([{ vaultId: recent.vaultId }]);
    expect(Object.keys(harness.openRecentRequests[0] ?? {})).toEqual(["vaultId"]);
    expect(open.textContent).toBe("Opening…");
    expect(open.disabled).toBe(true);
    expect(remove.disabled).toBe(true);

    await act(async () => {
      harness.onboarding = readyOnboarding();
      resolveOpen?.({ status: "completed", vault: vaultSummary(), onboarding: harness.onboarding });
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('textarea[aria-label="Capture or ask"]') !== null);
    expect(container.textContent).not.toContain(recent.pathDisplay);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a failed recent-vault open body-free and restores focus to the exact action", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    const recent = recentVaultSummary();
    harness.recentVaults = [recent];
    harness.openRecent = async (request) => {
      harness.openRecentRequests.push(request);
      throw new Error("RAW_RECENT_VAULT_ERROR /Users/private-vault");
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness));

    await advanceToVault(dom, container);
    const open = buttonByAriaLabel(container, `Open: ${recent.name}`);
    open.focus();
    await click(dom, open);

    await waitFor(dom, () => container.textContent?.includes("Pige could not open this recent vault.") ?? false);
    expect(container.querySelector('.recent-vault-error[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("RAW_RECENT_VAULT_ERROR");
    expect(container.textContent).not.toContain("/Users/private-vault");
    expect(container.querySelector('textarea[aria-label="Capture or ask"]')).toBeNull();
    await waitFor(dom, () => dom.window.document.activeElement === open);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps vault action failures body-free during first run", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    const api = makePigeApi(harness);
    api.vault.create = async () => {
      throw new Error("RAW_CREATE_SENTINEL /private/first-run-vault");
    };
    const { container, root } = await mountApp(dom, api);

    await advanceToVault(dom, container);
    await click(dom, button(container, "Create Vault"));
    await waitFor(dom, () => container.textContent?.includes("Something went wrong.") ?? false);

    expect(container.textContent).not.toContain("RAW_CREATE_SENTINEL");
    expect(container.textContent).not.toContain("/private/first-run-vault");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("requires explicit migration approval and opens only after the body-free apply result completes", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    const recent = recentVaultSummary();
    harness.recentVaults = [recent];
    const preview = vaultMigrationPreview(recent.vaultId);
    harness.openRecent = async (request) => {
      harness.openRecentRequests.push(request);
      return { status: "needs_migration", preview };
    };
    harness.applyMigration = async (request) => {
      harness.migrationRequests.push(request);
      harness.onboarding = readyOnboarding();
      return {
        ...request,
        status: "completed",
        jobId: "job_20260729_migrationtest",
        operationId: "op_20260729_migrationtest",
        vault: harness.onboarding.activeVault!,
        onboarding: harness.onboarding
      };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness));

    await advanceToVault(dom, container);
    const migrationTrigger = buttonByAriaLabel(container, `Open: ${recent.name}`);
    let triggerFocusCount = 0;
    const focusTrigger = migrationTrigger.focus.bind(migrationTrigger);
    migrationTrigger.focus = () => {
      triggerFocusCount += 1;
      focusTrigger();
    };
    migrationTrigger.focus();
    await click(dom, migrationTrigger);
    await waitFor(dom, () => container.textContent?.includes("Update this vault") ?? false);
    expect(harness.migrationRequests).toHaveLength(0);
    expect(container.textContent).not.toContain("/private/");
    expect(container.textContent).toContain("The update starts only after its private backup completes.");
    expect(container.textContent).toContain("Missing language metadata remains explicitly unknown.");
    expect(container.textContent).toContain("Local search indexes are rebuilt after durable files commit.");

    await click(dom, button(container, "Cancel"));
    await waitFor(dom, () => dom.window.document.activeElement === migrationTrigger);
    const afterCancelFocusCount = triggerFocusCount;

    await click(dom, migrationTrigger);
    await waitFor(dom, () => container.textContent?.includes("Update this vault") ?? false);
    const dialog = requireElement(container.querySelector<HTMLElement>('[aria-labelledby="vault-migration-title"]'));
    await act(async () => {
      dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await settle(dom);
    });
    await waitFor(dom, () => dom.window.document.activeElement === migrationTrigger);
    expect(triggerFocusCount).toBeGreaterThan(afterCancelFocusCount);

    await click(dom, migrationTrigger);
    await waitFor(dom, () => container.textContent?.includes("Update this vault") ?? false);
    const beforeSuccessFocusCount = triggerFocusCount;
    await click(dom, button(container, "Back up and update"));
    await waitFor(dom, () => container.querySelector('textarea[aria-label="Capture or ask"]') !== null);
    expect(triggerFocusCount).toBeGreaterThan(beforeSuccessFocusCount);
    expect(harness.migrationRequests).toHaveLength(1);
    expect(Object.keys(harness.migrationRequests[0]!).sort()).toEqual([
      "apiVersion", "previewId", "requestId", "vaultId"
    ].sort());
    expect(harness.migrationRequests[0]).toMatchObject({ vaultId: recent.vaultId, previewId: preview.previewId });

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

  it("explains a newer unsupported backup without opening an apply surface", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), {
      status: "unsupported",
      reason: "schema_newer"
    });
    const { container, root } = await mountApp(dom, makePigeApi(harness));
    await advanceToVault(dom, container);
    const restore = button(container, "Restore Backup");
    restore.focus();
    await click(dom, restore);

    await waitFor(dom, () => container.textContent?.includes(
      "This backup was created with a newer data schema"
    ) ?? false);
    expect(container.textContent).not.toContain("Restore preview");
    expect(container.textContent).not.toContain("Restore as New Vault");
    await waitFor(dom, () => dom.window.document.activeElement === restore);

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

  it("stops an in-flight Restore once and requires a new preview before retry", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    let resolveApply: ((result: RestoreApplyResult) => void) | undefined;
    harness.applyRestore = (request) => {
      harness.applyRequests.push(request);
      return new Promise((resolve) => { resolveApply = resolve; });
    };
    harness.cancelRestore = async (request) => {
      harness.cancelRestoreRequests.push(request);
      return { ...request, status: "cancel_requested" };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness));

    await advanceToVault(dom, container);
    await click(dom, button(container, "Restore Backup"));
    await waitFor(dom, () => container.textContent?.includes("Restore preview") ?? false);
    await click(dom, button(container, "Restore as New Vault"));
    const cancel = button(container, "Cancel");
    expect(cancel.disabled).toBe(false);

    await act(async () => {
      cancel.click();
      cancel.click();
      await settle(dom);
    });
    expect(harness.cancelRestoreRequests).toHaveLength(1);
    expect(harness.cancelRestoreRequests[0]).toMatchObject({
      apiVersion: 1,
      requestId: expect.stringMatching(/^restorecancelreq_[a-z0-9]{8,64}$/u),
      previewId: "restore-preview-clone",
      mode: "clone_as_new"
    });
    expect(JSON.stringify(harness.cancelRestoreRequests[0])).not.toMatch(/path|jobId|rawError/u);
    expect(container.textContent).toContain("Stopping restore safely...");

    await act(async () => { resolveApply?.({ status: "canceled" }); await settle(dom); });
    await waitFor(dom, () => dom.window.document.activeElement === button(container, "Restore Backup"));
    expect(container.textContent).not.toContain("Restore preview");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("disables an invalid repeated cancel after Restore publication is already committed", async () => {
    const dom = createDom();
    const harness = createHarness(blockedOnboarding(), cloneOnlyPreview());
    let resolveApply: ((result: RestoreApplyResult) => void) | undefined;
    harness.applyRestore = (request) => {
      harness.applyRequests.push(request);
      return new Promise((resolve) => { resolveApply = resolve; });
    };
    harness.cancelRestore = async (request) => {
      harness.cancelRestoreRequests.push(request);
      return { ...request, status: "too_late" };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness));

    await advanceToVault(dom, container);
    await click(dom, button(container, "Restore Backup"));
    await waitFor(dom, () => container.textContent?.includes("Restore preview") ?? false);
    await click(dom, button(container, "Restore as New Vault"));
    await click(dom, button(container, "Cancel"));

    await waitFor(dom, () => container.textContent?.includes("already committed") ?? false);
    expect(button(container, "Cancel").disabled).toBe(true);
    expect(harness.cancelRestoreRequests).toHaveLength(1);

    await act(async () => { resolveApply?.({ status: "canceled" }); await settle(dom); });
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shows explicit replace ownership in Vault settings and requires a new preview after cancellation", async () => {
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

    expect(container.querySelector(".settings-restore-page.restore-preview")).not.toBeNull();
    expect(container.querySelector(".settings-vault-page")).toBeNull();
    expect(container.querySelector(".settings-restore-page h1")?.textContent).toBe("Restore Pige Backup");
    expect(container.querySelectorAll(".settings-restore-page .settings-section")).toHaveLength(2);
    expect(container.querySelectorAll(".restore-settings-summary .settings-row")).toHaveLength(3);
    expect(container.textContent).toContain("Version 1 · Notes 2 · Sources 1 · Memories 1");
    expect(container.textContent).toContain("Restore does not import API keys");
    expect(container.textContent).not.toContain("/private/");
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
    await waitFor(dom, () => container.querySelector(".settings-vault-page") !== null);
    await waitFor(dom, () => dom.window.document.activeElement === button(container, "Restore Backup"));
    expect(container.querySelector(".settings-restore-page")).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("previews only the revalidated previous replacement state and keeps the ordinary confirmation path", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    const candidate: RestoreRollbackCandidate = {
      activeVaultId: "vault_restore_ui",
      restoreJobId: "job_20260714_rollback01",
      expectedRestoreJobUpdatedAt: "2026-07-14T08:10:00.000Z"
    };
    harness.rollbackRestoreStatus = async () => ({ apiVersion: 1, status: "ready", candidate });
    harness.prepareRollbackRestore = async (request) => {
      harness.rollbackRestorePrepareRequests.push(request);
      return {
        ...request,
        status: "prepared",
        preview: readyPreview("sha256:" + "b".repeat(64), ["replace_existing"], "replace_existing") as Extract<RestorePreviewResult, { readonly status: "ready" }>
      };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));

    await openVaultSettings(dom, container);
    await waitFor(dom, () => buttons(container, "Restore previous state").length === 1);
    await click(dom, button(container, "Restore previous state"));
    await waitFor(dom, () => container.textContent?.includes("Restore preview") ?? false);
    expect(container.querySelector('input[value="clone_as_new"]')).toBeNull();
    expect(radio(container, "replace_existing").checked).toBe(true);
    expect(harness.rollbackRestorePrepareRequests).toEqual([{
      apiVersion: 1,
      requestId: expect.stringMatching(/^restorerollbackreq_[a-z0-9]{16,64}$/u),
      ...candidate
    }]);
    expect(JSON.stringify(harness.rollbackRestorePrepareRequests)).not.toContain("/private/");

    await click(dom, button(container, "Replace Current Vault"));
    expect(harness.applyRequests).toEqual([{
      previewId: `sha256:${"b".repeat(64)}`,
      mode: "replace_existing"
    }]);
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
    const expectedLastBackup = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
      .format(new Date("2026-07-14T09:30:00.000Z"));
    await waitFor(dom, () => container.textContent?.includes(expectedLastBackup) ?? false);

    expect(harness.retryJobIds).toEqual(["job_20260714_backupui1"]);
    expect(container.textContent).not.toContain("The backup stopped safely");
    expect(container.querySelectorAll(".backup-job-status")).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reports backup external-dependency completeness without exposing dependency identity", async () => {
    const dom = createDom();
    const preview = bothModesPreview();
    if (preview.status !== "ready") throw new Error("Expected a ready fixture.");
    const harness = createHarness(readyOnboarding(), preview);
    harness.backupCreateResult = {
      status: "created",
      manifest: {
        ...preview.manifest,
        fileCount: 17,
        externalDependencyCount: 3,
        includedExternalDependencyCount: 1,
        missingRequiredExternalDependencyCount: 2,
        externalDependenciesComplete: false
      }
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));

    await openVaultSettings(dom, container);
    await click(dom, button(container, "Create Backup"));
    await waitFor(dom, () => container.textContent?.includes(
      "Backup created, but 2 required external items are missing. Reconnect them before restore."
    ) === true);
    expect(container.textContent).not.toContain("root_");
    expect(container.textContent).not.toContain("/private/");

    harness.backupCreateResult = {
      status: "created",
      manifest: {
        ...preview.manifest,
        fileCount: 19,
        externalDependencyCount: 2,
        includedExternalDependencyCount: 2,
        missingRequiredExternalDependencyCount: 0,
        externalDependenciesComplete: true
      }
    };
    await click(dom, button(container, "Create Backup"));
    await waitFor(dom, () => container.textContent?.includes(
      "Backup complete: 19 files; 2 of 2 external items included."
    ) === true);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("uses the approved maintenance cards, previews reset, restores focus, and keeps failures body-free", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    harness.localDatabaseStatus = {
      driver: "node_sqlite",
      appSchemaVersion: 1,
      appliedMigrationCount: 4,
      status: "ready",
      updatedAt: "2026-07-18T04:00:00.000Z"
    };
    const api = makePigeApi(harness, true);
    api.maintenance.rebuildLocalDatabase = async () => {
      throw new Error("RAW_REBUILD_SENTINEL /private/index");
    };
    let resetCalls = 0;
    api.maintenance.resetLocalDatabase = async () => {
      resetCalls += 1;
      throw new Error("RAW_RESET_SENTINEL /private/database");
    };
    const { container, root } = await mountApp(dom, api);

    await openSettingsSection(dom, container, "Index & Maintenance");
    await waitFor(dom, () => container.querySelector(".maintenance-settings-page") !== null);
    const page = requireElement(container.querySelector(".maintenance-settings-page"));
    expect(page.querySelector(".settings-panel-header")).not.toBeNull();
    expect(page.querySelectorAll(".settings-section")).toHaveLength(3);
    expect(page.querySelectorAll(".settings-card")).toHaveLength(3);
    expect(page.textContent).toContain("Knowledge Index");
    expect(page.textContent).toContain("Healthy");
    expect(page.textContent).toContain("Repair");
    expect(page.textContent).not.toContain("Core Toolchain");

    await click(dom, button(page, "Rebuild"));
    await waitFor(dom, () => page.textContent?.includes("Something went wrong.") ?? false);
    expect(page.textContent).not.toContain("RAW_REBUILD_SENTINEL");
    expect(page.textContent).not.toContain("/private/index");

    const previewReset = button(page, "Preview Reset…");
    await click(dom, previewReset);
    expect(resetCalls).toBe(0);
    expect(page.querySelector("#maintenance-reset-preview")).not.toBeNull();
    await waitFor(dom, () => dom.window.document.activeElement === button(page, "Cancel"));
    await act(async () => {
      page.querySelector("#maintenance-reset-preview")?.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      await settle(dom);
    });
    await waitFor(dom, () => page.querySelector("#maintenance-reset-preview") === null);
    await waitFor(dom, () => dom.window.document.activeElement === previewReset);

    await click(dom, previewReset);
    await click(dom, button(page, "Reset Database"));
    expect(resetCalls).toBe(1);
    await waitFor(dom, () => page.textContent?.includes("Something went wrong.") ?? false);
    expect(page.textContent).not.toContain("RAW_RESET_SENTINEL");
    expect(page.textContent).not.toContain("/private/database");
    expect(page.querySelector("#maintenance-reset-preview")).toBeNull();
    await waitFor(dom, () => dom.window.document.activeElement === previewReset);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps source storage policy failures body-free", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    const api = makePigeApi(harness, true);
    let request: UpdateSourceStoragePolicyRequest | undefined;
    api.vault.updateSourceStoragePolicy = async (input) => {
      request = input;
      throw new Error("RAW_POLICY_SENTINEL /private/source-root");
    };
    const { container, root } = await mountApp(dom, api);

    await openVaultSettings(dom, container);
    const policy = container.querySelector<HTMLSelectElement>("#vault-source-storage-strategy");
    if (!policy) throw new Error("Source storage selector not found.");
    await changeSelect(dom, policy, "reference_original");
    await waitFor(dom, () => container.textContent?.includes("Something went wrong.") ?? false);
    expect(request).toMatchObject({
      apiVersion: 1,
      activeVaultId: harness.onboarding.activeVault?.vaultId,
      expectedRevision: harness.onboarding.activeVault?.managedCopyRoot.sourceStorageRevision,
      defaultStrategy: "reference_original"
    });
    expect(request?.requestId).toMatch(/^sourcepolicyreq_[a-z0-9]{16,64}$/u);
    expect(container.textContent).not.toContain("RAW_POLICY_SENTINEL");
    expect(container.textContent).not.toContain("/private/source-root");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("configures only the pathless future managed-copy root and adopts the authoritative summary", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    let outcome: "failed" | "configured" = "failed";
    harness.configureManagedCopyRoot = async (request) => {
      harness.configureManagedCopyRootRequests.push(request);
      if (outcome === "failed") return { ...request, status: "failed" };
      const summary = {
        activeVaultId: request.activeVaultId,
        sourceStorageRevision: `ssrev_${"b".repeat(64)}`,
        mode: "external_binding" as const,
        availability: "available" as const,
        canConfigure: true
      };
      const current = harness.onboarding.activeVault;
      if (!current) throw new Error("Expected an active Vault.");
      harness.onboarding = {
        ...harness.onboarding,
        activeVault: {
          ...current,
          sourceAssetRootDisplay: "External managed-copy folder",
          sourceAssetRootKind: "external_binding",
          managedCopyRoot: summary
        }
      };
      return { ...request, status: "configured", summary };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));
    await openVaultSettings(dom, container);

    expect(container.textContent).toContain("Applies to future managed copies only. Existing sources are not moved.");
    const choose = button(container, "Choose folder");
    await click(dom, choose);
    await waitFor(dom, () => container.textContent?.includes("Pige could not update source storage.") ?? false);
    expect(harness.configureManagedCopyRootRequests).toHaveLength(1);
    expect(harness.configureManagedCopyRootRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_restore_ui",
      expectedSourceStorageRevision: `ssrev_${"a".repeat(64)}`
    });
    expect(JSON.stringify(harness.configureManagedCopyRootRequests[0])).not.toMatch(/path|rootId|sourceId/u);
    expect(container.textContent).toContain("Restore UI Vault sources");
    await waitFor(dom, () => dom.window.document.activeElement === choose);

    outcome = "configured";
    await click(dom, choose);
    await waitFor(dom, () => buttons(container, "Change folder").length === 1);
    expect(container.textContent).toContain("External managed-copy folder");
    expect(container.textContent).toContain("External folder · Available");
    expect(container.textContent).not.toContain("/private/");
    expect(harness.configureManagedCopyRootRequests).toHaveLength(2);
    await waitFor(dom, () => dom.window.document.activeElement === button(container, "Change folder"));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("offers an explicit pathless reconnect for an unavailable external managed-copy root", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    const activeVault = harness.onboarding.activeVault!;
    harness.onboarding = {
      ...harness.onboarding,
      activeVault: {
        ...activeVault,
        sourceAssetRootKind: "external_binding",
        sourceAssetRootDisplay: "External folder",
        managedCopyRoot: {
          ...activeVault.managedCopyRoot,
          mode: "external_binding",
          availability: "missing"
        }
      }
    };
    harness.configureManagedCopyRoot = async (request) => {
      harness.configureManagedCopyRootRequests.push(request);
      return {
        ...request,
        status: "configured",
        summary: { activeVaultId: request.activeVaultId, sourceStorageRevision: `ssrev_${"d".repeat(64)}`,
          mode: "external_binding", availability: "available", canConfigure: true }
      };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));
    await openVaultSettings(dom, container);

    expect(container.textContent).toContain("External folder · Folder unavailable");
    const reconnect = button(container, "Reconnect folder");
    await click(dom, reconnect);
    await waitFor(dom, () => harness.configureManagedCopyRootRequests.length === 1);
    expect(JSON.stringify(harness.configureManagedCopyRootRequests[0])).not.toMatch(/path|rootId|sourceId/u);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reconnects only an eligible managed-source dependency and resumes through polling without retry", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    harness.jobs = [backupJob("waiting_dependency")];
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));

    await openVaultSettings(dom, container);
    await waitFor(dom, () => container.textContent?.includes("A managed source location needs to be reconnected") ?? false);

    const vaultPage = container.querySelector<HTMLElement>(".settings-vault-page");
    expect(vaultPage).not.toBeNull();
    expect(vaultPage?.querySelectorAll(".settings-summary")).toHaveLength(4);
    expect(vaultPage?.querySelectorAll(".settings-card").length).toBeGreaterThanOrEqual(2);
    expect(vaultPage?.querySelector(".settings-group")).toBeNull();
    expect(container.textContent).not.toContain("RAW_BACKUP_SENTINEL");
    expect(container.textContent).not.toContain("root_external_private_20260717");
    expect(container.textContent).not.toContain("The backup could not continue safely");
    expect(container.querySelectorAll(".backup-job-status")).toHaveLength(1);
    const reconnect = button(container, "Reconnect source location");
    expect(reconnect.disabled).toBe(false);
    expect(Array.from(container.querySelectorAll("button")).some((item) => item.textContent === "Retry")).toBe(false);
    await click(dom, reconnect);
    await waitFor(dom, () => container.textContent?.includes("Source location reconnected") ?? false);
    expect(harness.reconnectRequests).toEqual([{
      activeVaultId: "vault_restore_ui",
      waitingJobId: "job_20260714_backupui1"
    }]);
    expect(harness.retryJobIds).toEqual([]);

    await click(dom, button(container, "View memory"));
    await waitFor(dom, () => container.querySelector(".memory-settings-page") !== null);
    expect(container.textContent).toContain("Agent & Memory");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reconnects only an eligible backup destination with exact Job currentness and resumes the same Job", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    const waitingJob = {
      ...backupJob("waiting_dependency"),
      canReconnectDependency: false,
      canReconnectBackupDestination: true
    };
    harness.jobs = [waitingJob];
    let outcome: "failed" | "reconnected" = "failed";
    harness.reconnectDestination = async (request) => {
      harness.reconnectDestinationRequests.push(request);
      if (outcome === "reconnected") {
        harness.jobs = [{
          ...waitingJob,
          state: "running",
          canReconnectBackupDestination: false,
          updatedAt: "2026-07-30T10:00:01.000Z"
        }];
      }
      return { ...request, status: outcome };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));
    await openVaultSettings(dom, container);

    const reconnect = button(container, "Choose new backup location");
    expect(container.textContent).toContain("The backup location is unavailable.");
    expect(container.textContent).not.toContain("A managed source location needs to be reconnected");
    await act(async () => {
      reconnect.click();
      reconnect.click();
      await settle(dom);
    });
    await waitFor(dom, () => harness.reconnectDestinationRequests.length === 1);
    expect(harness.reconnectDestinationRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_restore_ui",
      waitingJobId: waitingJob.id,
      expectedJobUpdatedAt: waitingJob.updatedAt
    });
    expect(harness.reconnectDestinationRequests[0]?.requestId).toMatch(/^backupdestinationreconnectreq_[a-z0-9]{8,64}$/u);
    expect(JSON.stringify(harness.reconnectDestinationRequests[0])).not.toMatch(/path|root|source/iu);
    expect(container.textContent).toContain("Pige could not reconnect this backup location.");
    expect(buttons(container, "Choose new backup location")).toHaveLength(1);
    await waitFor(dom, () => dom.window.document.activeElement === reconnect);
    expect(harness.retryJobIds).toHaveLength(0);

    outcome = "reconnected";
    await click(dom, reconnect);
    await waitFor(dom, () => harness.reconnectDestinationRequests.length === 2);
    await waitFor(dom, () => buttons(container, "Choose new backup location").length === 0);
    expect(harness.jobs).toHaveLength(1);
    expect(harness.jobs[0]?.id).toBe(waitingJob.id);
    expect(container.textContent).toContain("Creating and validating the backup");
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector('[aria-labelledby="vault-backup-title"]'));
    expect(harness.retryJobIds).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not infer backup-destination reconnect eligibility from a waiting Backup", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    harness.jobs = [{
      ...backupJob("waiting_dependency"),
      canReconnectDependency: false,
      canReconnectBackupDestination: false
    }];
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));
    await openVaultSettings(dom, container);
    expect(buttons(container, "Choose new backup location")).toHaveLength(0);
    expect(harness.reconnectDestinationRequests).toHaveLength(0);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("continues only an eligible incomplete Backup after explicit confirmation and refreshes the same Job", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    const waitingJob = backupJob("waiting_dependency", "choose_path", true);
    harness.jobs = [waitingJob];
    let status: "failed" | "continued" = "failed";
    harness.continueIncomplete = async (request) => {
      harness.continueIncompleteRequests.push(request);
      if (status === "failed") return { ...request, status };
      harness.jobs = [{
        ...waitingJob,
        state: "running",
        canContinueIncomplete: false,
        updatedAt: "2026-07-29T10:00:02.000Z"
      }];
      return { ...request, status };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));
    await openVaultSettings(dom, container);

    await waitFor(dom, () => buttons(container, "Continue incomplete").length === 1);
    await click(dom, button(container, "Continue incomplete"));
    await waitFor(dom, () => dom.window.document.activeElement === button(container, "Continue incomplete backup"));
    const confirm = button(container, "Continue incomplete backup");
    await act(async () => {
      confirm.click();
      confirm.click();
      await settle(dom);
    });
    await waitFor(dom, () => harness.continueIncompleteRequests.length === 1);
    expect(harness.continueIncompleteRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_restore_ui",
      waitingJobId: waitingJob.id,
      expectedJobUpdatedAt: waitingJob.updatedAt
    });
    expect(container.textContent).toContain("Pige could not continue this backup.");
    expect(buttons(container, "Continue incomplete")).toHaveLength(1);
    expect(harness.retryJobIds).toHaveLength(0);

    status = "continued";
    await click(dom, button(container, "Continue incomplete"));
    await click(dom, button(container, "Continue incomplete backup"));
    await waitFor(dom, () => harness.continueIncompleteRequests.length === 2);
    await waitFor(dom, () => buttons(container, "Continue incomplete").length === 0);
    expect(container.querySelectorAll(".backup-job-status")).toHaveLength(1);
    expect(container.textContent).toContain("Creating and validating the backup");
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector('[aria-labelledby="vault-backup-title"]'));
    expect(harness.retryJobIds).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a cancelled reconnect actionable, single-flight, and focus-owned without a notice", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    harness.jobs = [backupJob("waiting_dependency")];
    let resolveReconnect: ((status: "cancelled") => void) | undefined;
    harness.reconnectDependency = async (request) => {
      harness.reconnectRequests.push({ activeVaultId: request.activeVaultId, waitingJobId: request.waitingJobId });
      const status = await new Promise<"cancelled">((resolve) => { resolveReconnect = resolve; });
      return { apiVersion: 1, ...request, status };
    };
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));
    await openVaultSettings(dom, container);
    const reconnect = button(container, "Reconnect source location");
    await act(async () => {
      reconnect.click();
      reconnect.click();
      await settle(dom);
    });
    expect(harness.reconnectRequests).toHaveLength(1);
    expect(container.textContent).toContain("Checking source location…");
    await act(async () => {
      resolveReconnect?.("cancelled");
      await settle(dom);
    });
    await waitFor(dom, () => !reconnect.disabled && dom.window.document.activeElement === reconnect);
    expect(container.textContent).not.toContain("Checking source location…");
    expect(container.textContent).not.toContain("could not reconnect");
    expect(harness.retryJobIds).toEqual([]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("projects a not-found reconnect as the settled body-free stale state", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    harness.jobs = [backupJob("waiting_dependency")];
    harness.reconnectDependency = async (request) => ({ apiVersion: 1, ...request, status: "not_found" });
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));
    await openVaultSettings(dom, container);
    await click(dom, button(container, "Reconnect source location"));
    await waitFor(dom, () => container.textContent?.includes("This backup changed before reconnection finished") ?? false);
    expect(container.textContent).not.toContain("root_external_private_20260717");
    expect(container.textContent).not.toContain("RAW_BACKUP_SENTINEL");
    expect(harness.retryJobIds).toEqual([]);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not infer reconnect eligibility from the visible waiting state", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), bothModesPreview());
    harness.jobs = [{ ...backupJob("waiting_dependency"), canReconnectDependency: false }];
    const { container, root } = await mountApp(dom, makePigeApi(harness, true));
    await openVaultSettings(dom, container);
    await waitFor(dom, () => container.textContent?.includes("A managed source location needs to be reconnected") ?? false);
    expect(Array.from(container.querySelectorAll("button")).some((item) => item.textContent === "Reconnect source location")).toBe(false);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("offers one reachable cancel action while a support bundle export is in flight", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), cloneOnlyPreview());
    let workflow = supportBundleWorkflow();
    let exportRequest: { readonly previewId: string; readonly requestId: string } | undefined;
    const cancelRequests: string[] = [];
    const api = makePigeApi(harness, true) as Record<string, unknown>;
    api.diagnostics = {
      health: async () => null,
      workflowSummary: async () => workflow,
      previewSupportBundle: async (request: { readonly requestId: string }) => supportBundlePreview(request.requestId),
      exportSupportBundle: async (request: typeof exportRequest) => {
        exportRequest = request;
        workflow = supportBundleWorkflow("running", 2);
        return { ...request, status: "started" as const, workflow };
      },
      cancelSupportBundleExport: async (request: { readonly jobId: string }) => {
        cancelRequests.push(request.jobId);
        workflow = supportBundleWorkflow("cancel_requested", 3, false);
        return { ...request, status: "accepted" as const, workflow };
      }
    };
    const { container, root } = await mountApp(dom, api);

    await openSettingsSection(dom, container, "Diagnostics");
    await click(dom, requireElement(container.querySelector<HTMLInputElement>('[data-diagnostics-event-selection] input[type="checkbox"]')));
    await click(dom, button(container, "Preview and export…"));
    await waitFor(dom, () => container.textContent?.includes("Preview ready") ?? false);
    await click(dom, button(container, "Export Support Bundle"));
    await waitFor(dom, () => button(container, "Cancel Export") !== undefined);
    expect(Array.from(container.querySelectorAll("button"))
      .filter((candidate) => candidate.textContent === "Cancel Export")).toHaveLength(1);
    expect(exportRequest?.previewId).toBe(`supportpreview_${"a".repeat(32)}`);
    expect(exportRequest?.requestId).toMatch(/^diagexportreq_[a-z0-9]{16,64}$/u);

    await click(dom, button(container, "Cancel Export"));
    expect(cancelRequests).toEqual(["job_20260731_supportexport01"]);
    await waitFor(dom, () => container.textContent?.includes("Support bundle export was canceled") ?? false);
    expect(container.textContent).not.toContain("RAW_CANCEL_FAILURE");
    expect(container.textContent).not.toContain("/private/diagnostics");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a durable support export running when navigation unmounts its panel", async () => {
    const dom = createDom();
    const harness = createHarness(readyOnboarding(), cloneOnlyPreview());
    let workflow = supportBundleWorkflow();
    const cancelRequests: string[] = [];
    const api = makePigeApi(harness, true) as Record<string, unknown>;
    api.diagnostics = {
      health: async () => null,
      workflowSummary: async () => workflow,
      previewSupportBundle: async (request: { readonly requestId: string }) => supportBundlePreview(request.requestId),
      exportSupportBundle: async (request: { readonly requestId: string }) => {
        workflow = supportBundleWorkflow("running", 2);
        return { ...request, status: "started" as const, workflow };
      },
      cancelSupportBundleExport: async (request: { readonly jobId: string }) => {
        cancelRequests.push(request.jobId);
        return { ...request, status: "accepted" as const, workflow };
      }
    };
    const { container, root } = await mountApp(dom, api);

    await openSettingsSection(dom, container, "Diagnostics");
    await click(dom, requireElement(container.querySelector<HTMLInputElement>('[data-diagnostics-event-selection] input[type="checkbox"]')));
    await click(dom, button(container, "Preview and export…"));
    await waitFor(dom, () => container.textContent?.includes("Preview ready") ?? false);
    await click(dom, button(container, "Export Support Bundle"));
    await waitFor(dom, () => container.textContent?.includes("Cancel Export") ?? false);
    await click(dom, buttonByAriaLabel(container, "Close Settings"));
    await act(async () => settle(dom));
    expect(cancelRequests).toEqual([]);
    expect(workflow.job?.state).toBe("running");
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
    expect(revealNotes.closest(".settings-card")?.getAttribute("aria-busy")).toBe("true");

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
  appearance: () => Promise<AppearanceSettingsSummary>;
  readonly localeRequests: Locale[];
  modelSummary: ModelProviderSettingsSummary;
  modelSummaryReads: number;
  recentVaults: RecentVaultSummary[];
  readonly openRecentRequests: OpenRecentVaultRequest[];
  readonly migrationRequests: VaultMigrationApplyRequest[];
  readonly preview: RestorePreviewResult;
  backupCreateResult: BackupCreateResult;
  readonly applyRequests: RestoreApplyRequest[];
  readonly cancelRestoreRequests: RestoreCancelRequest[];
  jobs: JobSummary[];
  readonly retryJobIds: string[];
  readonly cancelJobIds: string[];
  readonly reconnectRequests: Array<{ readonly activeVaultId: string; readonly waitingJobId: string }>;
  reconnectDependency: (request: { readonly requestId: string; readonly activeVaultId: string; readonly waitingJobId: string }) => Promise<{
    readonly apiVersion: 1;
    readonly requestId: string;
    readonly activeVaultId: string;
    readonly waitingJobId: string;
    readonly status: "resolved" | "cancelled" | "stale" | "not_found" | "failed";
  }>;
  readonly reconnectDestinationRequests: BackupReconnectDestinationRequest[];
  reconnectDestination: (request: BackupReconnectDestinationRequest) => Promise<BackupReconnectDestinationResult>;
  readonly continueIncompleteRequests: BackupContinueIncompleteRequest[];
  continueIncomplete: (request: BackupContinueIncompleteRequest) => Promise<BackupContinueIncompleteResult>;
  readonly rollbackRestorePrepareRequests: RestoreRollbackPrepareRequest[];
  rollbackRestoreStatus: () => Promise<RestoreRollbackStatus>;
  prepareRollbackRestore: (request: RestoreRollbackPrepareRequest) => Promise<RestoreRollbackPrepareResult>;
  readonly configureManagedCopyRootRequests: ManagedCopyRootConfigureRequest[];
  configureManagedCopyRoot: (request: ManagedCopyRootConfigureRequest) => Promise<ManagedCopyRootConfigureResult>;
  readonly revealRequests: VaultRevealTarget[];
  lastBackupAt?: string;
  localDatabaseStatus: LocalDatabaseStatus | null;
  applyRestore: (request: RestoreApplyRequest) => Promise<RestoreApplyResult>;
  cancelRestore: (request: RestoreCancelRequest) => Promise<RestoreCancelResult>;
  openRecent: (request: OpenRecentVaultRequest) => Promise<VaultActionResult>;
  applyMigration: (request: VaultMigrationApplyRequest) => Promise<VaultMigrationApplyResult>;
  revealStorageRoot: (target: VaultRevealTarget) => Promise<VaultRevealResult>;
}

function createHarness(onboarding: OnboardingStatus, preview: RestorePreviewResult): RestoreHarness {
  const harness: RestoreHarness = {
    onboarding,
    appearance: async () => appearanceSummary("en"),
    localeRequests: [],
    modelSummary: emptyModelSummary(),
    modelSummaryReads: 0,
    recentVaults: [],
    openRecentRequests: [],
    migrationRequests: [],
    preview,
    backupCreateResult: { status: "canceled" },
    applyRequests: [],
    cancelRestoreRequests: [],
    jobs: [],
    retryJobIds: [],
    cancelJobIds: [],
    reconnectRequests: [],
    reconnectDependency: async (request) => {
      harness.reconnectRequests.push({ activeVaultId: request.activeVaultId, waitingJobId: request.waitingJobId });
      return { apiVersion: 1, ...request, status: "resolved" };
    },
    reconnectDestinationRequests: [],
    reconnectDestination: async (request) => {
      harness.reconnectDestinationRequests.push(request);
      return { ...request, status: "cancelled" };
    },
    continueIncompleteRequests: [],
    continueIncomplete: async (request) => {
      harness.continueIncompleteRequests.push(request);
      return { ...request, status: "cancelled" };
    },
    rollbackRestorePrepareRequests: [],
    rollbackRestoreStatus: async () => ({ apiVersion: 1, status: "unavailable" }),
    prepareRollbackRestore: async (request) => {
      harness.rollbackRestorePrepareRequests.push(request);
      return { ...request, status: "failed" };
    },
    configureManagedCopyRootRequests: [],
    configureManagedCopyRoot: async (request) => {
      harness.configureManagedCopyRootRequests.push(request);
      return { ...request, status: "cancelled" };
    },
    revealRequests: [],
    localDatabaseStatus: null,
    applyRestore: async (request) => {
      harness.applyRequests.push(request);
      return { status: "canceled" };
    },
    cancelRestore: async (request) => {
      harness.cancelRestoreRequests.push(request);
      return { ...request, status: "cancel_requested" };
    },
    openRecent: async (request) => {
      harness.openRecentRequests.push(request);
      return { status: "canceled" };
    },
    applyMigration: async (request) => ({ ...request, status: "stale", current: "needs_migration" }),
    revealStorageRoot: async (target) => {
      harness.revealRequests.push(target);
      return { status: "revealed", target };
    }
  };
  return harness;
}

function makePigeApi(harness: RestoreHarness, sidebarOpen = false) {
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
      pigePolicy: async () => ({
        apiVersion: 1 as const,
        activeVaultId: harness.onboarding.activeVault?.vaultId ?? "vault_restore_ui",
        revision: `pigepolicyrev_${"c".repeat(64)}`,
        markdown: "# PIGE\n\nFixture policy.",
        requiredSections: ["Goals", "Scope", "Style", "Sources", "Privacy", "Safety", "Tools", "Review"],
        canEdit: true as const
      }),
      updatePigePolicy: async (request: { readonly requestId: string; readonly activeVaultId: string }) => ({
        apiVersion: 1 as const,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        status: "failed" as const
      }),
      startupDestination: async () => ({ apiVersion: 1 as const, destination: "home" as const, revision: 0 }),
      setStartupDestination: async (request) => ({
        status: "committed" as const,
        summary: { apiVersion: 1 as const, destination: request.destination, revision: request.expectedRevision + 1 }
      }),
      onAppearanceChanged: () => () => undefined,
      setLocale: async ({ locale }: { readonly locale: Locale }) => {
        harness.localeRequests.push(locale);
        return appearanceSummary(locale);
      }
    },
    system: {
      toolchainHealth: async () => null
    },
    maintenance: {
      localDatabaseStatus: async () => harness.localDatabaseStatus,
      rebuildLocalDatabase: async () => ({ status: "queued" }),
      resetLocalDatabase: async () => ({ resetAt: "2026-07-15T00:00:00.000Z", removedRoots: [], recreatedRoots: [] })
    },
    diagnostics: {
      health: async () => null,
      previewSupportBundle: async (request: { readonly requestId: string }) => supportBundlePreview(request.requestId),
      exportSupportBundle: async () => ({ status: "canceled" }),
      cancelSupportBundleExport: async () => ({ status: "not_found" })
    },
    vault: {
      onboardingStatus: async () => harness.onboarding,
      recent: async () => harness.recentVaults,
      openRecent: (request: OpenRecentVaultRequest) => harness.openRecent(request),
      applyMigration: (request: VaultMigrationApplyRequest) => harness.applyMigration(request),
      create: async () => ({ status: "canceled" as const }),
      open: async () => ({ status: "canceled" as const }),
      forgetRecent: async (request) => ({ ...request, status: "forgotten" as const }),
      reconnectRecent: async (request) => ({
        ...request,
        status: "cancelled" as const,
        currentRevision: request.expectedRevision
      }),
      dismissFirstHomeGuide: async () => harness.onboarding,
      revealKnowledgeRoot: async () => harness.revealStorageRoot("knowledge_root"),
      revealSourceAssetRoot: async () => harness.revealStorageRoot("source_asset_root"),
      configureManagedCopyRoot: (request: ManagedCopyRootConfigureRequest) => harness.configureManagedCopyRoot(request),
      updateSourceStoragePolicy: async (request: UpdateSourceStoragePolicyRequest) => {
        if (!harness.onboarding.activeVault) throw new Error("No active vault.");
        return {
          ...request,
          status: "current" as const,
          summary: {
            activeVaultId: harness.onboarding.activeVault.vaultId,
            revision: harness.onboarding.activeVault.managedCopyRoot.sourceStorageRevision,
            defaultStrategy: harness.onboarding.activeVault.defaultSourceStorageStrategy
          }
        };
      }
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
      conversationPreferenceStatus: async () => ({
        apiVersion: 1 as const,
        activeVaultId: harness.onboarding.activeVault?.vaultId ?? "vault_restore_ui",
        revision: `backupconversationrev_${"a".repeat(64)}`,
        includeConversations: true,
        canUpdate: true
      }),
      setConversationPreference: async (request: { readonly activeVaultId: string }) => ({
        apiVersion: 1 as const,
        requestId: "backupconversationpreferencereq_fixture",
        activeVaultId: request.activeVaultId,
        status: "failed" as const
      }),
      trashPreferenceStatus: async () => ({
        apiVersion: 1 as const,
        activeVaultId: harness.onboarding.activeVault?.vaultId ?? "vault_restore_ui",
        revision: `backuptrashrev_${"b".repeat(64)}`,
        includeTrash: true,
        canUpdate: true
      }),
      setTrashPreference: async (request: { readonly activeVaultId: string }) => ({
        apiVersion: 1 as const,
        requestId: "backuptrashpreferencereq_fixture",
        activeVaultId: request.activeVaultId,
        status: "failed" as const
      }),
      previewRestore: async () => harness.preview,
      applyRestore: (request: RestoreApplyRequest) => harness.applyRestore(request),
      cancelRestore: (request: RestoreCancelRequest) => harness.cancelRestore(request),
      create: async () => harness.backupCreateResult,
      rollbackRestoreStatus: () => harness.rollbackRestoreStatus(),
      prepareRollbackRestore: (request: RestoreRollbackPrepareRequest) => harness.prepareRollbackRestore(request),
      reconnectDependency: (request: { readonly requestId: string; readonly activeVaultId: string; readonly waitingJobId: string }) =>
        harness.reconnectDependency(request),
      reconnectDestination: (request: BackupReconnectDestinationRequest) => harness.reconnectDestination(request),
      continueIncomplete: (request: BackupContinueIncompleteRequest) => harness.continueIncomplete(request)
    },
    confirmations: {
      pending: async () => ({ apiVersion: 1 as const, status: "none" as const, revision: 0 }),
      resolve: async () => ({ apiVersion: 1 as const, status: "not_found" as const, revision: 0 }),
      onChanged: () => () => undefined
    },
    speech: {
      onAssetInstallEvent: () => () => undefined
    },
    localCapabilities: {
      dictationLanguagePreference: async (request: { readonly requestId: string }) => ({
        apiVersion: 1 as const,
        requestId: request.requestId,
        status: "ready" as const,
        summary: {
          apiVersion: 1 as const,
          revision: 0,
          preference: { mode: "automatic" as const },
          appliesTo: "new_speech_sessions" as const
        }
      })
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
      },
      onChanged: () => () => undefined
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

function appearanceSummary(locale: Locale): AppearanceSettingsSummary {
  return {
    locale,
    availableLocales: ["zh-Hans", "en", "ja", "ko", "fr", "de"],
    themePreference: "system",
    effectiveTheme: "light",
    generatedKnowledgeLanguage: "preserve_source",
    revision: 0
  };
}

function supportBundlePreview(requestId: string) {
  return {
    apiVersion: 1 as const,
    requestId,
    previewId: `supportpreview_${"a".repeat(32)}` as const,
    generatedAt: "2026-07-15T00:00:00.000Z",
    localOnly: true as const,
    estimatedBytes: 1024,
    scopeContextId: `diagctx_${"b".repeat(32)}` as const,
    expectedRevision: 1,
    activeVaultId: null,
    eventSelectionRevision: `diagevents_${"a".repeat(64)}`,
    selectedDiagnosticEventIds: [`diagevent_${"b".repeat(32)}`],
    selectedDiagnosticEvents: [{
      eventId: `diagevent_${"b".repeat(32)}`,
      recordedAt: "2026-07-31T00:00:00.000Z",
      level: "warning" as const,
      code: "jobs.recovery_failed",
      redactedDetailCount: 0
    }],
    selectedOptionalCategories: [],
    includedCategories: [{ id: "app_runtime", label: "App runtime", included: true,
      reason: "Required runtime diagnostics." }],
    excludedCategories: [{ id: "secrets", label: "Secrets", included: false,
      reason: "Secrets are always excluded." }],
    privacyWarnings: ["The bundle is created locally and is not uploaded automatically."]
  };
}

function supportBundleWorkflow(
  state: "queued" | "running" | "cancel_requested" = "queued",
  revision = 1,
  canCancel = state === "running"
) {
  return {
    apiVersion: 1 as const,
    revision,
    scopeContextId: `diagctx_${"b".repeat(32)}` as const,
    activeVaultId: null,
    localOnly: true as const,
    ownedArtifactCount: 0,
    eventSelection: {
      revision: `diagevents_${"a".repeat(64)}`,
      events: [{
        eventId: `diagevent_${"b".repeat(32)}`,
        recordedAt: "2026-07-31T00:00:00.000Z",
        level: "warning" as const,
        code: "jobs.recovery_failed",
        redactedDetailCount: 0
      }]
    },
    job: {
      jobId: "job_20260731_supportexport01",
      state,
      progress: { completedUnits: state === "queued" ? 0 : 1, totalUnits: 3 as const,
        percent: state === "queued" ? 0 : 33, messageKey: "diagnostics.export.running" },
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: `2026-07-31T00:00:0${revision}.000Z`,
      canCancel,
      canRetry: false,
      repairAction: "none" as const
    }
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
    managedCopyRoot: {
      activeVaultId: "vault_restore_ui",
      sourceStorageRevision: `ssrev_${"a".repeat(64)}`,
      mode: "inside_vault",
      availability: "available",
      canConfigure: true
    },
    defaultSourceStorageStrategy: "copy_to_source_library",
    schemaVersion: 2,
    counts: { notes: 2, sources: 1, managedSourceCopies: 1, referencedOriginals: 0 }
  };
}

function vaultMigrationPreview(vaultId: string): VaultMigrationPreview {
  return {
    apiVersion: 1,
    previewId: `vaultmigration_${"a".repeat(32)}`,
    vaultId,
    fromVersion: 1,
    toVersion: 2,
    migrationClass: "transform",
    requiresBackup: true,
    languagePolicy: "preserve_or_unknown",
    affectedDomains: [
      { domain: "vault_manifest", count: 1 },
      { domain: "source_records", count: 2 },
      { domain: "markdown_pages", count: 3 },
      { domain: "ocr_artifacts", count: 4 },
      { domain: "conversation_events", count: 5 },
      { domain: "memory", count: 6 },
      { domain: "rebuildable_chunks", count: 7 }
    ],
    warnings: ["pre_migration_backup_required", "unknown_language_preserved", "rebuildable_indexes_after_commit"]
  };
}

function recentVaultSummary(): RecentVaultSummary {
  return {
    vaultId: "vault_restore_ui",
    name: "Restore UI Vault",
    pathDisplay: "~/Documents/Pige Vault",
    schemaVersion: 1,
    lastOpenedAt: "2026-07-14T08:00:00.000Z",
    revision: `recentvaultrev_${"a".repeat(64)}`
  };
}

function backupJob(
  state: "failed_retryable" | "failed_final" | "running" | "waiting_dependency",
  userAction: "retry" | "choose_path" = "choose_path",
  canContinueIncomplete = false
): JobSummary {
  return {
    id: "job_20260714_backupui1",
    class: "backup",
    state,
    stage: "backing_up",
    backupKind: "user_backup",
    canReconnectDependency: state === "waiting_dependency" && !canContinueIncomplete,
    canReconnectBackupDestination: false,
    canContinueIncomplete,
    ...(state === "waiting_dependency" ? {
      waitingDependency: {
        dependencyKind: "external_source" as const,
        dependencyId: "root_external_private_20260717",
        requiredAction: "reconnect_path" as const,
        messageKey: "errors.source.external_root_unavailable"
      }
    } : {}),
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
      externalDependencyCount: 0,
      includedExternalDependencyCount: 0,
      missingRequiredExternalDependencyCount: 0,
      externalDependenciesComplete: true,
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

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .filter((candidate) => candidate.textContent === label);
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
