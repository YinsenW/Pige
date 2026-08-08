import { createElement, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentMemorySettingsPanel,
  AppearanceSettingsPanel,
  MaintenanceSettingsPanel,
  PiPackagesSettingsPanel,
  SettingsSurface,
  SkillsSettingsPanel,
  SystemSettingsPanel,
  type DevelopmentCapability,
  type SettingsSection
} from "../../apps/desktop/src/renderer/src/App";
import { GeneralSettingsPanel } from "../../apps/desktop/src/renderer/src/components/GeneralSettingsPanel";
import type { SettingsProfileTransferApi } from "../../apps/desktop/src/renderer/src/components/SettingsProfileTransferPanel";
import {
  PermissionsPrivacySettingsPanel,
  type PermissionPolicyApi
} from "../../apps/desktop/src/renderer/src/components/PermissionsPrivacySettingsPanel";
import {
  LocalCapabilitiesSettingsPanel,
  type DictationLanguagePreferenceApi,
  type OcrEnginePreferenceApi,
  type OcrLanguagePreferenceApi,
  type PaddleOcrApi,
  type SpeechAssetApi
} from "../../apps/desktop/src/renderer/src/components/LocalCapabilitiesSettingsPanel";
import { SkillTrashRestorePanel } from "../../apps/desktop/src/renderer/src/components/SkillTrashRestorePanel";
import { NoteTrashRestorePanel } from "../../apps/desktop/src/renderer/src/components/NoteTrashRestorePanel";
import { ActivityHistorySettingsPanel } from "../../apps/desktop/src/renderer/src/components/ActivityHistorySettingsPanel";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";
import type {
  LocalSemanticRetrievalDisableRequest,
  LocalSemanticRetrievalDisableResult,
  LocalSemanticRetrievalEnableRequest,
  LocalSemanticRetrievalEnableResult,
  LocalSemanticRetrievalInstallRequest,
  LocalSemanticRetrievalInstallResult,
  LocalSemanticRetrievalRemoveRequest,
  LocalSemanticRetrievalRemoveResult,
  LocalSemanticRetrievalStatus,
  DiagnosticsClearLocalResult,
  JobSummary,
  KnowledgeActivitySummary,
  PaddleOcrDisableRequest,
  PaddleOcrDisableResult,
  PaddleOcrEnableRequest,
  PaddleOcrEnableResult,
  PaddleOcrInstallRequest,
  PaddleOcrInstallResult,
  PaddleOcrLifecycleState,
  PaddleOcrRemoveRequest,
  PaddleOcrRemoveResult,
  PaddleOcrSummary,
  PaddleOcrTestRequest,
  PaddleOcrTestResult,
  PiPackageCatalogEntry,
  PiPackageCatalogQueryRequest,
  PiPackageCatalogQueryResult,
  PiPackageInstallRequest,
  PiPackageInstallResult,
  PiPackageInspectRequest,
  PiPackageInspectResult,
  PiPackageRegistrySummary,
  PiPackageRestoreRequest,
  PiPackageRestoreResult,
  PiPackageRollbackRequest,
  PiPackageRollbackResult,
  PiPackageSetPinnedRequest,
  PiPackageSetPinnedResult,
  PiPackageSetEnabledRequest,
  PiPackageSetEnabledResult,
  PiPackageUninstallRequest,
  PiPackageUninstallResult,
  PiPackageUpdateRequest,
  PiPackageUpdateResult,
  SkillEnableRequest,
  SkillExportRequest,
  SkillLifecycleMutationResult,
  SkillRegistryMutationResult,
  SkillRegistryQueryResult,
  SkillRegistrySummary,
  SkillRestoreRequest,
  SkillRestoreResult,
  SkillStageUpdateRequest,
  SkillStageUpdateResult,
  SkillUninstallRequest,
  NoteTrashListRequest,
  NoteTrashRestoreRequest,
  NoteTrashRestoreResult,
  NoteTrashPurgeRequest,
  NoteTrashPurgeResult,
  SpeechAssetInstallEvent,
  SpeechAvailabilityResult
} from "@pige/contracts";
import {
  LocalSemanticRetrievalSettingsPanel,
  type LocalSemanticRetrievalApi
} from "../../apps/desktop/src/renderer/src/components/LocalSemanticRetrievalSettingsPanel";
import type { PiPackagesApi } from "../../apps/desktop/src/renderer/src/components/PiPackagesSettingsPanel";
import {
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
  LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
  PERMISSION_YOLO_HARD_BOUNDARIES,
  type LocalSemanticRetrievalAssetState,
  MemoryDeleteRequest,
  MemoryEditRequest,
  MemoryEnableRequest,
  MemoryExportRequest,
  MemoryExportResult,
  MemoryLifecycleMutationResult,
  MemoryListRequest,
  MemoryMutationResult,
  MemoryResetRequest,
  MemorySummary,
  type MemoryTrashSummary
} from "@pige/schemas";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "Event",
  "InputEvent",
  "CompositionEvent",
  "KeyboardEvent",
  "MouseEvent",
  "requestAnimationFrame",
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

describe("full UI Settings surface", () => {
  it("shows non-Agent active work progress and cancels only Main-authorized Jobs", async () => {
    const dom = createDom();
    installAnimationFrame(dom);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const cancelled: string[] = [];
    const jobs: readonly JobSummary[] = [
      {
        id: "job_20260801_activityparse01", class: "parse", state: "running",
        progress: { completedUnits: 3, totalUnits: 4, unit: "page" },
        sourceDisplayName: "Research.pdf", canReconnectDependency: false,
        canReconnectBackupDestination: false, canContinueIncomplete: false, canCancel: true,
        message: "Parsing source", createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:01:00.000Z"
      },
      {
        id: "job_20260801_activitybackup01", class: "backup", state: "running",
        canReconnectDependency: false, canReconnectBackupDestination: false,
        canContinueIncomplete: false, canCancel: false, message: "Creating backup",
        createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:01:00.000Z"
      },
      {
        id: "job_20260801_activityagent01", class: "agent_turn", state: "running",
        canReconnectDependency: false, canReconnectBackupDestination: false,
        canContinueIncomplete: false, canCancel: true, message: "Agent turn",
        createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:01:00.000Z"
      }
    ];
    await act(async () => {
      root.render(createElement(ActivityHistorySettingsPanel, {
        activeVaultId: null, activities: [], jobs, hasMore: false, loadingMore: false,
        loadMoreFailed: false, undoingId: null, redoingId: null, openingId: null,
        blockedIds: [], locale: "en", onOpen: async () => undefined,
        onUndo: async () => undefined, onRedo: async () => undefined,
        onLoadMore: async () => false,
        onCancelJob: async (jobId) => { cancelled.push(jobId); }, t
      }));
      await settle(dom);
    });
    expect(dom.window.document.querySelector('[data-activity-job-id="job_20260801_activityparse01"]')?.textContent)
      .toContain("75%");
    expect(dom.window.document.querySelector('[data-activity-job-id="job_20260801_activitybackup01"]')).not.toBeNull();
    expect(dom.window.document.querySelector('[data-activity-job-id="job_20260801_activityagent01"]')).toBeNull();
    expect(dom.window.document.querySelectorAll("[data-activity-cancel-job-id]")).toHaveLength(1);
    await act(async () => {
      buttonNamed(dom.window.document, "Cancel").click();
      await settle(dom);
    });
    expect(cancelled).toEqual(["job_20260801_activityparse01"]);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps recent background history visible and restores exact retry or refresh focus on failure", async () => {
    const dom = createDom();
    installAnimationFrame(dom);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let retryAttempts = 0;
    const refresh = vi.fn(async () => false);
    const jobs: readonly JobSummary[] = [
      {
        id: "job_20260801_activityretry01", class: "parse", state: "failed_retryable",
        sourceDisplayName: "Archive.pdf", canReconnectDependency: false,
        canReconnectBackupDestination: false, canContinueIncomplete: false,
        canCancel: false, canRetry: true, message: "Parsing needs attention",
        error: {
          code: "parser.execution_failed", domain: "parser", messageKey: "error.generic",
          retryable: true, severity: "error", userAction: "retry"
        },
        createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T08:02:00.000Z"
      },
      {
        id: "job_20260801_activitydone01", class: "agent_ingest", state: "completed",
        canReconnectDependency: false, canReconnectBackupDestination: false,
        canContinueIncomplete: false, canCancel: false, canRetry: false,
        agentKnowledgeOutcome: {
          schemaVersion: 1, kind: "updated", knowledgeFields: ["summary", "citations"],
          citationRefs: [{ kind: "source", id: "src_20260801_activitydone01" }],
          writeRefs: [{ kind: "page", id: "page_20260801_activitydone01" }],
          operationIds: ["op_20260801_activitydone01"],
          undoOperationIds: ["op_20260801_activitydone01"],
          recoveryRefs: [{ kind: "source", id: "src_20260801_activitydone01" }]
        },
        message: "Index rebuilt", createdAt: "2026-08-01T07:00:00.000Z",
        updatedAt: "2026-08-01T07:05:00.000Z"
      }
    ];
    await act(async () => {
      root.render(createElement(ActivityHistorySettingsPanel, {
        activeVaultId: null, activities: [], jobs, hasMore: false, loadingMore: false,
        loadMoreFailed: false, undoingId: null, redoingId: null, openingId: null,
        blockedIds: [], locale: "en", onOpen: async () => undefined,
        onUndo: async () => undefined, onRedo: async () => undefined,
        onLoadMore: async () => false, onRefreshJobs: refresh,
        onRetryJob: async () => { retryAttempts += 1; return retryAttempts > 1; }, t
      }));
      await settle(dom);
    });
    const retryRow = requireElement(dom.window.document.querySelector<HTMLElement>(
      '[data-activity-job-id="job_20260801_activityretry01"]'
    ));
    expect(retryRow.textContent).toContain("Needs attention");
    expect(retryRow.textContent).toContain("Something went wrong");
    expect(dom.window.document.querySelector('[data-activity-job-id="job_20260801_activitydone01"]')?.textContent)
      .toContain("Completed");
    expect(dom.window.document.querySelector('[data-agent-knowledge-outcome="updated"]')?.textContent)
      .toContain("Knowledge updated · 2 fields · 1 citations · 1 durable writes · 1 recovery references · Undo available");
    const retry = buttonNamed(retryRow, "Retry");
    retry.focus();
    await act(async () => { retry.click(); await settle(dom); await settle(dom); });
    await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 10));
    expect(retryRow.textContent).toContain("could not retry");
    expect(dom.window.document.activeElement).toBe(retryRow);
    await act(async () => { buttonNamed(retryRow, "Retry").click(); await settle(dom); await settle(dom); });
    await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 10));
    expect(refresh).toHaveBeenCalledOnce();
    expect(dom.window.document.body.textContent).toContain("could not refresh background work");
    const refreshButton = buttonNamed(dom.window.document, "Refresh");
    refreshButton.focus();
    await act(async () => { refreshButton.click(); await settle(dom); await settle(dom); });
    await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 10));
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(dom.window.document.activeElement).toBe(refreshButton);
    expect(dom.window.document.querySelector('[data-activity-job-id="job_20260801_activitydone01"]')).not.toBeNull();
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("exposes activity rows as an ordered timeline and fences duplicate Undo activation", async () => {
    const dom = createDom();
    installAnimationFrame(dom);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const undo = vi.fn(async () => { await pending; });
    await act(async () => {
      root.render(createElement(ActivityHistorySettingsPanel, {
        activeVaultId: null,
        activities: [activitySummary("op_20260801_activityquality01", "2026-08-01T08:00:00.000Z")],
        total: 1, hasMore: false, loadingMore: false, loadMoreFailed: false,
        undoingId: null, redoingId: null, openingId: null, blockedIds: [], locale: "en",
        onOpen: async () => undefined, onUndo: undo, onRedo: async () => undefined,
        onLoadMore: async () => false, t
      }));
      await settle(dom);
    });
    const list = requireElement(dom.window.document.querySelector<HTMLElement>(
      '[role="list"][aria-labelledby="activity-recent-title"]'
    ));
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(1);
    const row = requireElement(dom.window.document.querySelector<HTMLElement>(
      '[data-activity-row-id="op_20260801_activityquality01"]'
    ));
    expect(row.getAttribute("aria-posinset")).toBe("1");
    expect(row.getAttribute("aria-setsize")).toBe("1");
    expect(row.getAttribute("data-activity-row-status")).toBe("applied");
    const undoButton = requireElement(row.querySelector<HTMLButtonElement>("[data-activity-undo-id]"));
    undoButton.focus();
    await act(async () => { undoButton.click(); undoButton.click(); await settle(dom); });
    expect(undo).toHaveBeenCalledOnce();
    expect(undoButton.disabled).toBe(true);
    await act(async () => { release(); await pending; await settle(dom); });
    await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 10));
    expect(dom.window.document.activeElement).toBe(row);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("loads older Activity once and returns focus to the history heading on the final page", async () => {
    const dom = createDom();
    installAnimationFrame(dom);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const load = vi.fn(async () => { await pending; return true; });
    const first = activitySummary("op_20260731_activityfirst01", "2026-07-31T10:00:00.000Z");
    const older = activitySummary("op_20260731_activityolder01", "2026-07-30T10:00:00.000Z");
    function Harness(): React.JSX.Element {
      const [activities, setActivities] = useState<readonly KnowledgeActivitySummary[]>([first]);
      const [hasMore, setHasMore] = useState(true);
      return createElement(ActivityHistorySettingsPanel, {
        activeVaultId: null, activities, hasMore, loadingMore: false, loadMoreFailed: false,
        undoingId: null, openingId: null, blockedIds: [], locale: "en",
        onOpen: async () => undefined, onUndo: async () => undefined,
        onLoadMore: async () => { const loaded = await load(); if (loaded) { setActivities([first, older]); setHasMore(false); } return loaded; },
        t
      });
    }
    await act(async () => { root.render(createElement(Harness)); await settle(dom); });
    const loadMore = buttonNamed(dom.window.document, "Load more");
    loadMore.focus();
    await act(async () => { loadMore.click(); loadMore.click(); await settle(dom); });
    expect(load).toHaveBeenCalledOnce();
    await act(async () => { release(); await pending; await settle(dom); await settle(dom); });
    await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 10));
    expect(dom.window.document.querySelectorAll("[data-activity-row-id]")).toHaveLength(2);
    expect(dom.window.document.querySelector("button")?.textContent).not.toBe("Load more");
    expect(dom.window.document.activeElement?.id).toBe("settings-history-title");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("retains visible Activity and trigger focus when the next page fails", async () => {
    const dom = createDom();
    installAnimationFrame(dom);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const first = activitySummary("op_20260731_activityfailed01", "2026-07-31T10:00:00.000Z");
    function Harness(): React.JSX.Element {
      const [failed, setFailed] = useState(false);
      return createElement(ActivityHistorySettingsPanel, {
        activeVaultId: null, activities: [first], hasMore: true, loadingMore: false, loadMoreFailed: failed,
        undoingId: null, openingId: null, blockedIds: [], locale: "en",
        onOpen: async () => undefined, onUndo: async () => undefined,
        onLoadMore: async () => { setFailed(true); return false; }, t
      });
    }
    await act(async () => { root.render(createElement(Harness)); await settle(dom); });
    const loadMore = buttonNamed(dom.window.document, "Load more");
    loadMore.focus();
    await act(async () => { loadMore.click(); await settle(dom); await settle(dom); });
    expect(dom.window.document.querySelectorAll("[data-activity-row-id]")).toHaveLength(1);
    expect(dom.window.document.querySelector("[role=alert]")?.textContent).toContain("visible history was kept");
    expect(dom.window.document.activeElement).toBe(loadMore);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("searches authoritative Activity history once and keeps visible results on failure", async () => {
    const dom = createDom();
    installAnimationFrame(dom);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const matching = { ...activitySummary("op_20260731_activitysearch01", "2026-07-31T10:00:00.000Z"),
      targetLabel: "Quarterly outline", status: "undone" as const, canUndo: false };
    const search = vi.fn(async (request: { readonly query?: string; readonly status?: "applied" | "undone" }) => {
      if (search.mock.calls.length === 1) await pending;
      else throw new Error("redacted activity search failure");
      const found = request.query === "quarterly" && request.status === "undone";
      return { scannedAt: "2026-07-31T12:00:00.000Z", activeVaultId: "vlt_20260731_activitysearch",
        total: found ? 1 : 0, invalidOperationCount: 0, activities: found ? [matching] : [], hasMore: false };
    });
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      activity: { list: search },
      notes: { listTrash: vi.fn(async (request: { apiVersion: 1; requestId: string; activeVaultId: string }) =>
        ({ ...request, status: "ready", notes: [] })) },
      sources: { listTrash: vi.fn(async (request: { apiVersion: 1; requestId: string; activeVaultId: string }) =>
        ({ ...request, status: "ready", sources: [] })) }
    } });
    function Harness(): React.JSX.Element {
      const [activities, setActivities] = useState<readonly KnowledgeActivitySummary[]>([
        activitySummary("op_20260731_activityvisible01", "2026-07-31T11:00:00.000Z")
      ]);
      return createElement(ActivityHistorySettingsPanel, {
        activeVaultId: "vlt_20260731_activitysearch",
        activities,
        total: activities.length,
        hasMore: false,
        loadingMore: false,
        loadMoreFailed: false,
        undoingId: null,
        redoingId: null,
        openingId: null,
        blockedIds: [],
        locale: "en",
        onOpen: async () => undefined,
        onUndo: async () => undefined,
        onRedo: async () => undefined,
        onLoadMore: async () => false,
        onSearchResult: (result) => setActivities(result.activities),
        t
      });
    }
    await act(async () => { root.render(createElement(Harness)); await settle(dom); });
    const input = requireElement(dom.window.document.querySelector<HTMLInputElement>('[aria-label="Search changes"]'));
    const status = requireElement(dom.window.document.querySelector<HTMLSelectElement>('[aria-label="Filter by status"]'));
    await act(async () => {
      inputValue(dom, input, " quarterly ");
      selectValue(dom, status, "undone");
      await settle(dom);
    });
    input.focus();
    const submit = buttonNamed(dom.window.document, "Search");
    await act(async () => { submit.click(); submit.click(); await settle(dom); });
    expect(search).toHaveBeenCalledOnce();
    await act(async () => {
      release();
      await pending;
      await settle(dom);
      await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 10));
      await settle(dom);
    });
    expect(search).toHaveBeenCalledWith({ limit: 20, query: "quarterly", status: "undone" });
    expect(dom.window.document.body.textContent).toContain("Quarterly outline");
    expect(dom.window.document.activeElement).toBe(input);

    await act(async () => { inputValue(dom, input, "missing"); await settle(dom); });
    await act(async () => {
      submit.click();
      await settle(dom);
      await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 10));
      await settle(dom);
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(dom.window.document.body.textContent).toContain("Quarterly outline");
    expect(dom.window.document.body.textContent).toContain("visible history was kept");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps the always-on-top control inert until window truth is known", async () => {
    const dom = createDom();
    const onAlwaysOnTopChange = vi.fn(async () => undefined);
    const startupDestinationApi = {
      load: vi.fn(async () => ({ apiVersion: 1 as const, destination: "home" as const, revision: 0 })),
      set: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(GeneralSettingsPanel, {
        alwaysOnTop: null,
        alwaysOnTopBusy: false,
        onAlwaysOnTopChange,
        onOpenAppearance: vi.fn(),
        startupDestinationApi,
        settingsProfileTransferApi: createSettingsProfileTransferApi(),
        t
      }));
      await settle(dom);
    });

    const alwaysOnTop = requireElement(dom.window.document.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Keep Pige on top"]'
    ));
    expect(alwaysOnTop.disabled).toBe(true);
    expect(alwaysOnTop.getAttribute("aria-checked")).toBe("false");
    alwaysOnTop.click();
    expect(onAlwaysOnTopChange).not.toHaveBeenCalled();

    await act(async () => {
      root.render(createElement(GeneralSettingsPanel, {
        alwaysOnTop: true,
        alwaysOnTopBusy: true,
        onAlwaysOnTopChange,
        onOpenAppearance: vi.fn(),
        startupDestinationApi,
        settingsProfileTransferApi: createSettingsProfileTransferApi(),
        t
      }));
      await settle(dom);
    });
    expect(alwaysOnTop.disabled).toBe(true);
    expect(alwaysOnTop.getAttribute("aria-checked")).toBe("true");
    expect(alwaysOnTop.getAttribute("aria-busy")).toBe("true");
    alwaysOnTop.click();
    expect(onAlwaysOnTopChange).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reflects WindowLayout persistence and the authoritative next-launch destination", async () => {
    const dom = createDom();
    const onAlwaysOnTopChange = vi.fn(async () => undefined);
    const onOpenAppearance = vi.fn();
    const startupDestinationApi = {
      load: vi.fn(async () => ({ apiVersion: 1 as const, destination: "home" as const, revision: 4 })),
      set: vi.fn()
    };
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("General must use only its provided adapters.");
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(GeneralSettingsPanel, {
        alwaysOnTop: false,
        alwaysOnTopBusy: false,
        onAlwaysOnTopChange,
        onOpenAppearance,
        startupDestinationApi,
        settingsProfileTransferApi: createSettingsProfileTransferApi(),
        t
      }));
      await settle(dom);
    });

    const page = dom.window.document.querySelector<HTMLElement>(".settings-general")!;
    expect(page.querySelectorAll(".settings-section")).toHaveLength(3);
    expect(page.querySelectorAll(".settings-row")).toHaveLength(9);
    expect(page.textContent).toContain("Startup & Window");
    expect(page.textContent).toContain("Pige");
    expect(page.textContent).toContain("Adaptive");
    expect(page.textContent).toContain("Automatic");
    expect(page.textContent).toContain("Last state");
    expect(page.textContent).toContain("Temporary pane expansion is never saved as the base size.");
    expect(page.textContent).toContain("A constrained display may present Note Agent as an overlay.");
    const startupDestination = requireElement(page.querySelector<HTMLSelectElement>('select[aria-label="On launch"]'));
    expect(startupDestination.value).toBe("home");
    expect(startupDestination.disabled).toBe(false);
    const alwaysOnTop = requireElement(page.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Keep Pige on top"]'
    ));
    expect(alwaysOnTop.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      for (const button of Array.from(page.querySelectorAll<HTMLButtonElement>(".settings-button"))) {
        button.click();
      }
      alwaysOnTop.click();
      await settle(dom);
    });

    expect(onOpenAppearance).toHaveBeenCalledOnce();
    expect(onAlwaysOnTopChange).toHaveBeenCalledOnce();
    expect(ipcRead).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fences startup destination changes and preserves the attempted choice on stale", async () => {
    const dom = createDom();
    let resolveMutation: ((result: import("@pige/contracts").StartupDestinationMutationResult) => void) | undefined;
    const startupDestinationApi = {
      load: vi.fn(async () => ({ apiVersion: 1 as const, destination: "home" as const, revision: 7 })),
      set: vi.fn(() => new Promise<import("@pige/contracts").StartupDestinationMutationResult>((resolve) => {
        resolveMutation = resolve;
      }))
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(GeneralSettingsPanel, {
        alwaysOnTop: false,
        alwaysOnTopBusy: false,
        onAlwaysOnTopChange: async () => undefined,
        onOpenAppearance: () => undefined,
        startupDestinationApi,
        settingsProfileTransferApi: createSettingsProfileTransferApi(),
        t
      }));
      await settle(dom);
    });
    const select = requireElement(dom.window.document.querySelector<HTMLSelectElement>('select[aria-label="On launch"]'));
    await act(async () => {
      selectValue(dom, select, "library");
      selectValue(dom, select, "home");
      await settle(dom);
    });
    expect(startupDestinationApi.set).toHaveBeenCalledOnce();
    expect(startupDestinationApi.set).toHaveBeenCalledWith({ destination: "library", expectedRevision: 7 });
    expect(select.disabled).toBe(true);

    await act(async () => {
      resolveMutation?.({
        status: "stale",
        summary: { apiVersion: 1, destination: "home", revision: 8 }
      });
      await settle(dom);
      await settle(dom);
    });
    expect(select.value).toBe("library");
    expect(select.disabled).toBe(false);
    expect(dom.window.document.body.textContent).toContain("The saved startup destination changed. Your choice is still selected; retry to save it.");
    expect(dom.window.document.activeElement).toBe(select);

    await act(async () => {
      selectValue(dom, select, "library");
      await settle(dom);
    });
    expect(startupDestinationApi.set).toHaveBeenCalledTimes(2);
    expect(startupDestinationApi.set).toHaveBeenLastCalledWith({ destination: "library", expectedRevision: 8 });
    await act(async () => {
      resolveMutation?.({
        status: "committed",
        summary: { apiVersion: 1, destination: "library", revision: 9 }
      });
      await settle(dom);
      await settle(dom);
    });
    expect(select.value).toBe("library");
    expect(dom.window.document.body.textContent).not.toContain("The saved startup destination changed.");

    await act(async () => {
      selectValue(dom, select, "home");
      await settle(dom);
    });
    expect(startupDestinationApi.set).toHaveBeenLastCalledWith({ destination: "home", expectedRevision: 9 });
    await act(async () => {
      resolveMutation?.({ status: "failed" });
      await settle(dom);
      await settle(dom);
    });
    expect(select.value).toBe("home");
    expect(dom.window.document.body.textContent).toContain("The startup destination could not be saved. Your choice is still selected.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps compact localized Settings navigation labels readable", () => {
    const appSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/App.tsx"),
      "utf8"
    );
    const styles = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/styles/app.css"),
      "utf8"
    );
    const compactSettings = styles.slice(
      styles.indexOf("@media (max-width: 520px)"),
      styles.indexOf("@media (min-width: 761px)")
    );
    const residentCompactSettings = styles.slice(
      styles.indexOf("@media (max-width: 679px)"),
      styles.indexOf("@media (min-width: 680px)")
    );

    expect(styles).toContain(".settings-nav-scroll {\n  min-height: 0;\n  flex: 1 1 auto;");
    expect(appSource).toContain("macosWindowShell={macosWindowShell}");
    expect(appSource).toContain('settings-overlay${props.macosWindowShell ? " platform-macos" : ""}');
    expect(styles).toContain(".settings-overlay.platform-macos .settings-return");
    expect(styles).toContain("margin-left: 84px;");
    expect(residentCompactSettings).toContain(".settings-navigation {");
    expect(residentCompactSettings).toContain("display: block;");
    expect(residentCompactSettings).toContain("max-height: none;");
    expect(residentCompactSettings).toContain("overflow: visible;");
    expect(compactSettings).toContain(".settings-nav-item > span");
    expect(compactSettings).toContain("white-space: normal;");
    expect(compactSettings).toContain("overflow-wrap: anywhere;");
    expect(compactSettings).toContain("text-overflow: clip;");
    expect(compactSettings).toContain(".settings-skills .skill-registry-row");
    expect(compactSettings).toContain("grid-template-columns: 32px minmax(0, 1fr);");
    expect(compactSettings).toContain(".settings-skills .skill-registry-control");
    expect(compactSettings).toContain("grid-column: 1 / -1;");
    expect(styles).toContain(".skill-registry-control .settings-status.is-enabled {\n  color: var(--accent);");
    expect(styles).not.toContain("--accent-strong");
    expect(styles).toContain("--border-strong: var(--border-heavy);");
    expect(styles).toContain("--danger-soft: var(--danger-surface);");
    expect(styles).toContain("--shadow-float: var(--shadow-floating);");
    expect(styles).toContain("--shadow-lg: var(--shadow-floating);");
    expect(styles).toContain("--shadow-xl: var(--shadow-floating);");
    expect(styles).toContain("--ease-basic: var(--ease-standard);");
    expect(styles).toContain("--settings-text: var(--text-primary);");
    expect(styles).toContain("--settings-secondary: var(--text-secondary);");
    expect(styles).toContain("--settings-border: var(--border-default);");
    expect(styles).toContain("--settings-elevated: var(--surface-elevated);");
    expect(styles).toContain("--titlebar-height: 58px;");
    const reducedTransparency = styles.slice(
      styles.indexOf("@media (prefers-reduced-transparency: reduce)"),
      styles.indexOf("\n* {\n  box-sizing: border-box;")
    );
    expect(reducedTransparency).toContain("*::before,\n  *::after {");
    expect(reducedTransparency).toContain("-webkit-backdrop-filter: none !important;");
    expect(reducedTransparency).toContain("backdrop-filter: none !important;");
    const customPropertyDefinitions = new Set(
      Array.from(styles.matchAll(/(--[a-z0-9-]+)\s*:/gi), (match) => match[1]!)
    );
    const undefinedCustomPropertyUses = Array.from(
      new Set(Array.from(styles.matchAll(/var\((--[a-z0-9-]+)/gi), (match) => match[1]!))
    ).filter((property) => !customPropertyDefinitions.has(property)).sort();
    expect(undefinedCustomPropertyUses).toEqual([
      "--branch-opacity",
      "--branch-width",
      "--conversation-anchor-opacity",
      "--conversation-anchor-position",
      "--conversation-rail-height",
      "--conversation-rail-right",
      "--conversation-rail-top",
      "--home-processing-panel-height",
      "--minimap-opacity",
      "--minimap-width",
      "--progress"
    ]);
    expect(styles).toContain("--knowledge-node-root: #d9e2ef;");
    expect(styles).toContain("stroke: var(--knowledge-branch-strong);");
    expect(styles).toContain("color: var(--knowledge-node-root);");
    expect(styles).toContain(".diff-line.removed { background: var(--danger-surface); color: var(--danger); }");
    expect(styles).toContain("--success-text: #13733a;");
    expect(styles).toContain(".diff-line.added { background: var(--success-surface); color: var(--success-text); }");
    expect(styles).toContain("background: color-mix(in oklab, var(--surface-elevated) 97%, transparent);");
    expect(compactSettings).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(compactSettings).toContain("width: min(320px, calc(100% - 48px));");
    expect(compactSettings).toContain('.settings-surface[data-compact-navigation-open="true"] .settings-sidebar');
    expect(compactSettings).toContain(".settings-overlay.platform-macos .settings-compact-header");
    expect(compactSettings).toContain("padding-left: 100px;");
    expect(styles).toContain("width: calc(100% - 84px);");
    expect(styles).toContain("margin-left: 84px;");
    expect(styles).toContain(".settings-summary-grid {");
    expect(styles).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(styles).toContain("@media (max-width: 560px) {");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(styles).toContain(".settings-vault-page .settings-row-control .settings-button");
    expect(styles).toContain(".settings-restore-page.restore-preview");
    expect(styles).toContain(".restore-settings-summary .settings-row");
    expect(styles).toContain(".restore-settings-actions .settings-button");
    expect(styles).toContain("width: 100%;");
  });

  it("uses a focus-owned navigation drawer instead of squeezing compact Settings content", async () => {
    const dom = createDom();
    installMatchMedia(dom, true);
    const close = vi.fn();
    const root = createRoot(dom.window.document.querySelector("#root")!);

    function Harness(): React.JSX.Element {
      const [section, setSection] = useState<SettingsSection>("general");
      return createElement(SettingsSurface, {
        section,
        locale: "en",
        availableLocales: ["en"],
        alwaysOnTop: false,
        developmentNotice: null,
        onSectionChange: setSection,
        onClose: close,
        onLocaleChange: async () => undefined,
        onAlwaysOnTopChange: async () => undefined,
        onDevelopment: vi.fn(),
        t
      }, createElement("button", { type: "button" }, "Page control"));
    }

    await act(async () => {
      root.render(createElement(Harness));
      await settle(dom);
    });

    const dialog = requireElement(dom.window.document.querySelector<HTMLElement>('[role="dialog"]'));
    const drawer = requireElement(dialog.querySelector<HTMLElement>(".settings-sidebar"));
    const content = requireElement(dialog.querySelector<HTMLElement>(".settings-content"));
    const compactReturn = requireElement(dialog.querySelector<HTMLButtonElement>(".settings-compact-return"));
    const trigger = buttonNamed(dialog, "Settings sections");
    expect(dialog.dataset.compactNavigationOpen).toBe("false");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(drawer.hasAttribute("inert")).toBe(true);
    expect(content.hasAttribute("inert")).toBe(false);
    expect(dom.window.document.activeElement).toBe(compactReturn);

    const pageControl = buttonNamed(content, "Page control");
    await act(async () => {
      compactReturn.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(pageControl);
    await act(async () => {
      pageControl.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(compactReturn);

    await act(async () => {
      trigger.click();
      await settle(dom);
      await settle(dom);
    });
    expect(dialog.dataset.compactNavigationOpen).toBe("true");
    expect(drawer.getAttribute("aria-hidden")).toBeNull();
    expect(drawer.hasAttribute("inert")).toBe(false);
    expect(content.hasAttribute("inert")).toBe(true);
    const closeButton = buttonNamed(drawer, "Close Settings");
    expect(dom.window.document.activeElement).toBe(closeButton);
    const lastDrawerControl = buttonNamed(drawer, "DiagnosticsAvailable");
    content.scrollTop = 128;
    await act(async () => {
      buttonNamed(drawer, "AppearancePartially available").click();
      await settle(dom);
    });
    expect(content.scrollTop).toBe(0);
    expect(dialog.dataset.compactNavigationOpen).toBe("false");
    expect(dom.window.document.activeElement).toBe(trigger);

    await act(async () => {
      trigger.click();
      await settle(dom);
      await settle(dom);
    });
    await act(async () => {
      closeButton.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(lastDrawerControl);

    await act(async () => {
      dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
      await settle(dom);
    });
    expect(dialog.dataset.compactNavigationOpen).toBe("false");
    expect(close).not.toHaveBeenCalled();
    expect(dom.window.document.activeElement).toBe(trigger);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("traps focus, closes with Escape, and keeps development activation local", async () => {
    const dom = createDom();
    const close = vi.fn();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("Development navigation must not access IPC.");
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    function Harness(): React.JSX.Element {
      const [section, setSection] = useState<SettingsSection>("general");
      const [capability, setCapability] = useState<DevelopmentCapability | null>(null);
      return createElement(SettingsSurface, {
        section,
        locale: "en",
        availableLocales: ["en"],
        alwaysOnTop: false,
        developmentNotice: capability ? { surface: "settings", capability, state: "development" } : null,
        onSectionChange: setSection,
        onClose: close,
        onLocaleChange: async () => undefined,
        onAlwaysOnTopChange: async () => undefined,
        onDevelopment: setCapability,
        t
      }, createElement("button", { type: "button", id: "last-control" }, "Last control"));
    }

    await act(async () => {
      root.render(createElement(Harness));
      await settle(dom);
    });

    const dialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"]')!;
    const closeButton = buttonNamed(dialog, "Close Settings");
    expect(dom.window.document.activeElement).toBe(closeButton);
    const groups = Array.from(dialog.querySelectorAll<HTMLElement>('.settings-nav-group[role="group"]'));
    expect(groups).toHaveLength(6);
    for (const group of groups) {
      const labelId = group.getAttribute("aria-labelledby");
      expect(labelId).toBeTruthy();
      expect(group.querySelector(`#${labelId}`)?.textContent?.trim().length).toBeGreaterThan(0);
    }

    await act(async () => {
      buttonNamed(dialog, "Index & MaintenanceAvailable").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    await act(async () => {
      buttonNamed(dialog, "Agent & MemoryIn development").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    await act(async () => {
      buttonNamed(dialog, "Local CapabilitiesPartially available").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    await act(async () => {
      buttonNamed(dialog, "SkillsPartially available").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    await act(async () => {
      buttonNamed(dialog, "Pi PackagesPartially available").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    await act(async () => {
      buttonNamed(dialog, "AppearancePartially available").click();
      await settle(dom);
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(ipcRead).toBe(false);

    const last = dom.window.document.querySelector<HTMLButtonElement>("#last-control")!;
    last.focus();
    await act(async () => {
      last.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(closeButton);

    await act(async () => {
      closeButton.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    });
    expect(dom.window.document.activeElement).toBe(last);

    await act(async () => {
      dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(close).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("runs Knowledge Health from Maintenance, groups safe results, and preserves Run Check focus", async () => {
    const dom = createDom();
    let resolveFirst!: (result: unknown) => void;
    let resolveSecond!: (result: unknown) => void;
    const runKnowledgeHealth = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }))
      .mockImplementationOnce(async (request) => ({
        ...request,
        status: "ready",
        checkedAt: "2026-07-27T10:02:00.000Z",
        reportEpoch: 3,
        indexGeneration: "index:8",
        coverage: "complete",
        invalidPageCount: 0,
        counts: {
          totalIssueCount: 0,
          brokenLinkPageCount: 0,
          unresolvedLinkCount: 0,
          orphanPageCount: 0,
          duplicateTopicGroupCount: 0,
          unsourcedClaimCount: 0
        },
        issues: [],
        truncated: false
      }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        maintenance: {
          runKnowledgeHealth,
          rebuildLocalDatabase: vi.fn(),
          resetLocalDatabase: vi.fn()
        }
      }
    });
    const onOpenPage = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(MaintenanceSettingsPanel, {
        activeVaultId: "vault_20260727_healthfixture",
        locale: "en",
        error: null,
        localDatabaseStatus: {
          driver: "node_sqlite",
          appSchemaVersion: 1,
          appliedMigrationCount: 2,
          status: "ready",
          updatedAt: "2026-07-27T10:00:00.000Z"
        },
        onRefresh: vi.fn(async () => undefined),
        onRefreshDiagnostics: vi.fn(async () => undefined),
        onOpenPage,
        onError: vi.fn(),
        t
      }));
      await settle(dom);
    });

    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".maintenance-settings-page"));
    expect(page.textContent).toContain("No check has been run yet.");
    expect(page.textContent).not.toContain("/Users/private");
    const runButton = buttonNamed(page, "Run Check");
    runButton.focus();
    await act(async () => {
      runButton.click();
      await settle(dom);
    });
    expect(runButton.disabled).toBe(true);
    expect(page.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(page.textContent).not.toContain("Latest check");
    const firstRequest = runKnowledgeHealth.mock.calls[0]![0];
    expect(firstRequest).toMatchObject({ apiVersion: 1, activeVaultId: "vault_20260727_healthfixture" });
    expect(firstRequest.requestId).toMatch(/^knowledge_health_request_[a-z0-9]{16,64}$/);

    await act(async () => {
      resolveFirst({
        ...firstRequest,
        status: "ready",
        checkedAt: "2026-07-27T10:01:00.000Z",
        reportEpoch: 1,
        indexGeneration: "index:7",
        coverage: "partial",
        invalidPageCount: 2,
        counts: {
          totalIssueCount: 7,
          brokenLinkPageCount: 1,
          unresolvedLinkCount: 3,
          orphanPageCount: 1,
          duplicateTopicGroupCount: 1,
          unsourcedClaimCount: 4
        },
        issues: [
          { kind: "broken_link", page: { pageId: "page_health_broken", title: "Broken page" }, unresolvedLinkCount: 3 },
          { kind: "orphan_page", page: { pageId: "page_health_orphan", title: "Orphan page" } },
          {
            kind: "duplicate_topic",
            candidatePageCount: 3,
            pages: [
              { pageId: "page_health_topic_a", title: "Topic A" },
              { pageId: "page_health_topic_b", title: "Topic B" }
            ]
          },
          { kind: "unsourced_claim", page: { pageId: "page_health_claim", title: "Unsupported claim" } }
        ],
        truncated: true
      });
      await settle(dom);
    });

    expect(dom.window.document.activeElement).toBe(runButton);
    expect(page.textContent).toContain("7 issues found");
    expect(page.textContent).toContain("Partial");
    expect(page.textContent).toContain("2 pages could not be checked");
    expect(page.textContent).toContain("More results are available");
    const groupText = ["Broken links", "Orphan pages", "Duplicate topics", "Claims without sources"];
    expect(groupText.map((label) => page.textContent!.indexOf(label))).toEqual(
      [...groupText].map((label) => page.textContent!.indexOf(label)).sort((a, b) => a - b)
    );
    expect(page.textContent).not.toContain("sourceId");
    expect(page.textContent).not.toContain("checksum");

    await act(async () => {
      buttonNamed(page, "Broken page").click();
      await settle(dom);
    });
    expect(onOpenPage).toHaveBeenCalledWith("page_health_broken");

    await act(async () => {
      buttonNamed(page, "Orphan page").click();
      await settle(dom);
    });
    expect(onOpenPage).toHaveBeenCalledWith("page_health_orphan");
    expect(page.querySelector('[role="alert"]')?.textContent).toContain("The current Reader was not changed");

    await act(async () => {
      runButton.click();
      await settle(dom);
    });
    expect(page.textContent).not.toContain("Broken page");
    const secondRequest = runKnowledgeHealth.mock.calls[1]![0];
    await act(async () => {
      resolveSecond({ ...secondRequest, status: "unavailable" });
      await settle(dom);
    });
    expect(page.textContent).toContain("Knowledge Health is unavailable until the local index is ready.");

    await act(async () => {
      runButton.click();
      await settle(dom);
    });
    expect(page.textContent).toContain("No issues found.");
    expect(page.textContent).toContain("Complete");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fences stale Knowledge Health responses by vault and reports current failures body-free", async () => {
    const dom = createDom();
    let resolveStale!: (result: unknown) => void;
    const runKnowledgeHealth = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockRejectedValueOnce(new Error("/Users/private/health.sqlite"));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        maintenance: {
          runKnowledgeHealth,
          rebuildLocalDatabase: vi.fn(),
          resetLocalDatabase: vi.fn()
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const renderPanel = async (activeVaultId: string): Promise<void> => {
      root.render(createElement(MaintenanceSettingsPanel, {
        activeVaultId,
        locale: "en",
        error: null,
        localDatabaseStatus: null,
        onRefresh: vi.fn(async () => undefined),
        onRefreshDiagnostics: vi.fn(async () => undefined),
        onOpenPage: vi.fn(async () => false),
        onError: vi.fn(),
        t
      }));
      await settle(dom);
    };

    await act(async () => renderPanel("vault_20260727_healthfirst"));
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".maintenance-settings-page"));
    await act(async () => {
      buttonNamed(page, "Run Check").click();
      await settle(dom);
    });
    const staleRequest = runKnowledgeHealth.mock.calls[0]![0];
    await act(async () => renderPanel("vault_20260727_healthsecond"));
    expect(page.textContent).toContain("No check has been run yet.");
    await act(async () => {
      resolveStale({
        ...staleRequest,
        status: "ready",
        checkedAt: "2026-07-27T11:00:00.000Z",
        reportEpoch: 1,
        indexGeneration: "index:8",
        coverage: "complete",
        invalidPageCount: 0,
        counts: {
          totalIssueCount: 0,
          brokenLinkPageCount: 0,
          unresolvedLinkCount: 0,
          orphanPageCount: 0,
          duplicateTopicGroupCount: 0,
          unsourcedClaimCount: 0
        },
        issues: [],
        truncated: false
      });
      await settle(dom);
    });
    expect(page.textContent).toContain("No check has been run yet.");
    expect(page.textContent).not.toContain("No issues found.");

    await act(async () => {
      buttonNamed(page, "Run Check").click();
      await settle(dom);
    });
    expect(page.querySelector('[role="alert"]')?.textContent).toContain("Knowledge Health could not complete");
    expect(page.textContent).not.toContain("/Users/private");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("repairs only eligible broken references and refreshes the authoritative report", async () => {
    const dom = createDom();
    const repairContextId = `knowledge_health_repair_context_${"a".repeat(32)}`;
    const sourceRevision = `noteeditrev_${"1".repeat(64)}`;
    const sourceRenderProof = `knowledge_health_render_${"2".repeat(64)}`;
    const occurrenceId = `knowledge_health_occurrence_${"3".repeat(64)}`;
    const readyReport = (request: { readonly requestId: string; readonly activeVaultId: string }, issues: unknown[]) => ({
      ...request,
      apiVersion: 1,
      status: "ready",
      checkedAt: "2026-07-27T12:00:00.000Z",
      reportEpoch: 1,
      indexGeneration: "index:repair:4",
      coverage: "complete",
      invalidPageCount: 0,
      counts: {
        totalIssueCount: issues.length,
        brokenLinkPageCount: 2,
        unresolvedLinkCount: 3,
        orphanPageCount: 1,
        duplicateTopicGroupCount: 0,
        unsourcedClaimCount: 0
      },
      issues,
      truncated: false
    });
    const issues = [
      {
        kind: "broken_link",
        page: { pageId: "page_health_repairable", title: "Repairable page" },
        unresolvedLinkCount: 1,
        repairContextId,
        sourceRevision,
        sourceRenderProof,
        occurrenceId,
        repairableOccurrences: [{ ordinal: 1, displayLabel: "Missing page", repairContextId,
          sourceRevision, sourceRenderProof, occurrenceId }]
      },
      {
        kind: "broken_link",
        page: { pageId: "page_health_manual", title: "Manual page" },
        unresolvedLinkCount: 2,
        repairableOccurrences: [
          { ordinal: 1, displayLabel: "First missing page",
            repairContextId: `knowledge_health_repair_context_${"b".repeat(32)}`,
            sourceRevision: `noteeditrev_${"7".repeat(64)}`,
            sourceRenderProof: `knowledge_health_render_${"8".repeat(64)}`,
            occurrenceId: `knowledge_health_occurrence_${"9".repeat(64)}` },
          { ordinal: 2, displayLabel: "Second missing page",
            repairContextId: `knowledge_health_repair_context_${"c".repeat(32)}`,
            sourceRevision: `noteeditrev_${"7".repeat(64)}`,
            sourceRenderProof: `knowledge_health_render_${"8".repeat(64)}`,
            occurrenceId: `knowledge_health_occurrence_${"a".repeat(64)}` }
        ]
      },
      { kind: "orphan_page", page: { pageId: "page_health_orphan_repair", title: "Orphan page" } }
    ];
    const runKnowledgeHealth = vi.fn()
      .mockImplementationOnce(async (request) => readyReport(request, issues))
      .mockImplementationOnce(async (request) => ({
        ...readyReport(request, []),
        indexGeneration: "index:repair:5",
        counts: {
          totalIssueCount: 0,
          brokenLinkPageCount: 0,
          unresolvedLinkCount: 0,
          orphanPageCount: 0,
          duplicateTopicGroupCount: 0,
          unsourcedClaimCount: 0
        }
      }));
    const repairKnowledgeHealth = vi.fn()
      .mockImplementationOnce(async (request) => ({
        ...request,
        status: "stale",
        revision: `noteeditrev_${"b".repeat(32)}`
      }))
      .mockImplementationOnce(async (request) => ({
        ...request,
        status: "committed",
        revision: `noteeditrev_${"c".repeat(32)}`,
        operationId: `operation_${"d".repeat(32)}`
      }));
    const searchKnowledgeHealthTargets = vi.fn(async (request) => ({
      ...request,
      status: "ready",
      targets: [{
        page: { pageId: "page_health_current_target", title: "Current target" },
        pageType: "note",
        targetContextId: `knowledge_health_target_context_${"4".repeat(32)}`,
        targetRevision: `noteeditrev_${"5".repeat(64)}`,
        targetRenderProof: `knowledge_health_render_${"6".repeat(64)}`
      }],
      truncated: false
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        maintenance: {
          runKnowledgeHealth,
          searchKnowledgeHealthTargets,
          repairKnowledgeHealth,
          rebuildLocalDatabase: vi.fn(),
          resetLocalDatabase: vi.fn()
        }
      }
    });
    const onOpenPage = vi.fn(async () => true);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(MaintenanceSettingsPanel, {
        activeVaultId: "vault_20260727_healthrepair",
        locale: "en",
        error: null,
        localDatabaseStatus: null,
        onRefresh: vi.fn(async () => undefined),
        onRefreshDiagnostics: vi.fn(async () => undefined),
        onOpenPage,
        onError: vi.fn(),
        t
      }));
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(dom.window.document, "Run Check").click();
      await settle(dom);
    });

    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".maintenance-settings-page"));
    expect([...page.querySelectorAll("button")].filter((button) => button.textContent === "Remove link")).toHaveLength(3);
    expect([...page.querySelectorAll("button")].filter((button) => button.textContent === "Choose target")).toHaveLength(3);
    expect(page.textContent).toContain("1. First missing page");
    expect(page.textContent).toContain("2. Second missing page");
    expect(page.textContent).toContain("Manual page");
    expect(page.textContent).toContain("Orphan page");

    await act(async () => {
      const repairButton = buttonNamed(page, "Remove link");
      repairButton.click();
      repairButton.click();
      await settle(dom);
    });
    expect(repairKnowledgeHealth).toHaveBeenCalledOnce();
    const firstRepair = repairKnowledgeHealth.mock.calls[0]![0];
    expect(firstRepair).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_20260727_healthrepair",
      indexGeneration: "index:repair:4",
      issueKind: "broken_link",
      pageId: "page_health_repairable",
      action: "unlink_broken_reference",
      repairContextId
    });
    expect(firstRepair.requestId).toMatch(/^knowledge_health_repair_request_[a-z0-9]{16,64}$/);
    expect(page.textContent).toContain("That issue changed or is no longer available");
    expect(page.textContent).toContain("Repairable page");
    expect(onOpenPage).not.toHaveBeenCalled();

    await act(async () => {
      buttonNamed(page, "Choose target").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Search pages").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Current target").click();
      await settle(dom);
    });
    expect(repairKnowledgeHealth).toHaveBeenCalledTimes(2);
    expect(searchKnowledgeHealthTargets).toHaveBeenCalledOnce();
    expect(repairKnowledgeHealth.mock.calls[1]![0]).toMatchObject({
      action: "retarget_broken_reference",
      targetPageId: "page_health_current_target",
      targetContextId: `knowledge_health_target_context_${"4".repeat(32)}`,
      targetRevision: `noteeditrev_${"5".repeat(64)}`,
      targetRenderProof: `knowledge_health_render_${"6".repeat(64)}`
    });
    expect(runKnowledgeHealth).toHaveBeenCalledTimes(2);
    expect(page.textContent).toContain("Broken reference repaired");
    expect(page.textContent).toContain("No issues found.");
    expect(page.textContent).not.toContain("Repairable page");
    expect(page.textContent).not.toContain("operation_");
    expect(page.textContent).not.toContain("repair_context");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("merges one exact duplicate-topic pair while preserving explicit survivor choice", async () => {
    const dom = createDom();
    const repairContextId = `knowledge_health_repair_context_${"7".repeat(32)}`;
    const pageProofs = [
      { pageId: "page_20260731_duplicateaa", revision: `noteeditrev_${"8".repeat(64)}`,
        renderProof: `knowledge_health_render_${"9".repeat(64)}` },
      { pageId: "page_20260731_duplicatebb", revision: `noteeditrev_${"a".repeat(64)}`,
        renderProof: `knowledge_health_render_${"b".repeat(64)}` }
    ] as const;
    const runKnowledgeHealth = vi.fn()
      .mockImplementationOnce(async (request) => ({ ...request, status: "ready", checkedAt: "2026-07-31T12:00:00.000Z", reportEpoch: 1,
        indexGeneration: "index:duplicate:4", coverage: "complete", invalidPageCount: 0,
        counts: { totalIssueCount: 1, brokenLinkPageCount: 0, unresolvedLinkCount: 0, orphanPageCount: 0,
          duplicateTopicGroupCount: 1, unsourcedClaimCount: 0 }, issues: [{ kind: "duplicate_topic", candidatePageCount: 2,
          pages: [{ pageId: pageProofs[0].pageId, title: "Alpha topic" }, { pageId: pageProofs[1].pageId, title: "Beta topic" }],
          repairContextId, pageProofs }], truncated: false }))
      .mockImplementationOnce(async (request) => ({ ...request, status: "ready", checkedAt: "2026-07-31T12:01:00.000Z", reportEpoch: 2,
        indexGeneration: "index:duplicate:5", coverage: "complete", invalidPageCount: 0,
        counts: { totalIssueCount: 0, brokenLinkPageCount: 0, unresolvedLinkCount: 0, orphanPageCount: 0,
          duplicateTopicGroupCount: 0, unsourcedClaimCount: 0 }, issues: [], truncated: false }));
    const repairKnowledgeHealthDuplicateTopic = vi.fn(async (request) => ({
      ...request, status: "committed", operationId: "op_20260731_duplicatetopic123"
    }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: { maintenance: {
      runKnowledgeHealth, repairKnowledgeHealthDuplicateTopic, rebuildLocalDatabase: vi.fn(), resetLocalDatabase: vi.fn()
    } } });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(MaintenanceSettingsPanel, { activeVaultId: "vault_20260731_duplicate", locale: "en",
        error: null, localDatabaseStatus: null, onRefresh: vi.fn(async () => undefined),
        onRefreshDiagnostics: vi.fn(async () => undefined), onOpenPage: vi.fn(async () => true),
        onError: vi.fn(), t }));
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(dom.window.document, "Run Check").click();
      await settle(dom);
    });
    await act(async () => { buttonNamed(dom.window.document, "Merge").click(); await settle(dom); });
    const beta = [...dom.window.document.querySelectorAll<HTMLInputElement>('input[name="knowledge-health-topic-survivor"]')]
      .find((input) => input.value === pageProofs[1].pageId)!;
    await act(async () => { beta.click(); buttonNamed(dom.window.document, "Merge topics").click(); await settle(dom); });
    expect(repairKnowledgeHealthDuplicateTopic).toHaveBeenCalledOnce();
    expect(repairKnowledgeHealthDuplicateTopic.mock.calls[0]![0]).toMatchObject({
      survivorPageId: pageProofs[1].pageId, absorbedPageId: pageProofs[0].pageId, repairContextId
    });
    expect(dom.window.document.body.textContent).toContain("The duplicate topics were merged");
    expect(dom.window.document.body.textContent).toContain("No issues found");
    expect(dom.window.document.body.textContent).not.toContain("op_20260731");
    await act(async () => { await settle(dom); });
    expect(dom.window.document.activeElement?.textContent).toBe("Run Check");
    await act(async () => root.unmount()); dom.window.close();
  });

  it("lets the user choose one current parent for one repairable orphan", async () => {
    const dom = createDom();
    const repairContextId = `knowledge_health_repair_context_${"a".repeat(32)}`;
    const targetRevision = `noteeditrev_${"b".repeat(64)}`;
    const targetRenderProof = `knowledge_health_render_${"c".repeat(64)}`;
    const runKnowledgeHealth = vi.fn(async (request) => runKnowledgeHealth.mock.calls.length === 1 ? ({
      ...request,
      status: "ready" as const,
      checkedAt: "2026-07-31T12:00:00.000Z",
      reportEpoch: 1,
      indexGeneration: "index:orphan:4",
      coverage: "complete" as const,
      invalidPageCount: 0,
      counts: {
        totalIssueCount: 1, brokenLinkPageCount: 0, unresolvedLinkCount: 0,
        orphanPageCount: 1, duplicateTopicGroupCount: 0, unsourcedClaimCount: 0
      },
      issues: [{
        kind: "orphan_page" as const,
        page: { pageId: "page_health_orphan_target", title: "Orphan target" },
        repairContextId,
        targetRevision,
        targetRenderProof
      }],
      truncated: false
    }) : ({
      ...request,
      status: "ready" as const,
      checkedAt: "2026-07-31T12:01:00.000Z",
      reportEpoch: 2,
      indexGeneration: "index:orphan:5",
      coverage: "complete" as const,
      invalidPageCount: 0,
      counts: {
        totalIssueCount: 0, brokenLinkPageCount: 0, unresolvedLinkCount: 0,
        orphanPageCount: 0, duplicateTopicGroupCount: 0, unsourcedClaimCount: 0
      },
      issues: [],
      truncated: false
    }));
    const parent = {
      page: { pageId: "page_health_entry_parent", title: "Entry note" },
      pageType: "note",
      sourceContextId: `knowledge_health_orphan_parent_context_${"d".repeat(32)}`,
      sourceRevision: `noteeditrev_${"e".repeat(64)}`,
      sourceRenderProof: `knowledge_health_render_${"f".repeat(64)}`
    } as const;
    const searchKnowledgeHealthOrphanParents = vi.fn(async (request) => ({
      ...request, status: "ready", parents: [parent], truncated: false
    }));
    const repairKnowledgeHealthOrphan = vi.fn(async (request) =>
      repairKnowledgeHealthOrphan.mock.calls.length === 1 ? ({ ...request, status: "stale" as const }) : ({
        ...request,
        status: "committed" as const,
        revision: `noteeditrev_${"1".repeat(64)}`,
        operationId: "op_20260731_orphanrepairui"
      }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        maintenance: {
          runKnowledgeHealth,
          searchKnowledgeHealthOrphanParents,
          repairKnowledgeHealthOrphan,
          repairKnowledgeHealth: vi.fn(),
          rebuildLocalDatabase: vi.fn(),
          resetLocalDatabase: vi.fn()
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(MaintenanceSettingsPanel, {
        activeVaultId: "vault_20260731_orphanui",
        locale: "en",
        error: null,
        localDatabaseStatus: null,
        onRefresh: vi.fn(async () => undefined),
        onRefreshDiagnostics: vi.fn(async () => undefined),
        onOpenPage: vi.fn(async () => true),
        onError: vi.fn(),
        t
      }));
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(dom.window.document, "Run Check").click();
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".maintenance-settings-page"));
    expect(page.textContent).toContain("Orphan target");
    await act(async () => {
      buttonNamed(page, "Choose parent").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Search pages").click();
      await settle(dom);
    });
    expect(searchKnowledgeHealthOrphanParents).toHaveBeenCalledOnce();
    const search = searchKnowledgeHealthOrphanParents.mock.calls[0]![0];
    expect(search).toMatchObject({
      activeVaultId: "vault_20260731_orphanui",
      reportRequestId: expect.stringMatching(/^knowledge_health_request_/u),
      indexGeneration: "index:orphan:4",
      issueKind: "orphan_page",
      pageId: "page_health_orphan_target",
      repairContextId,
      targetRevision,
      targetRenderProof,
      query: ""
    });
    await act(async () => {
      buttonNamed(page, "Entry note").click();
      await settle(dom);
    });
    expect(repairKnowledgeHealthOrphan).not.toHaveBeenCalled();
    expect(page.textContent).toContain("Confirm this relationship");
    expect(page.textContent).toContain("Entry note → Orphan target");
    expect(dom.window.document.activeElement?.textContent).toBe("Cancel");
    await act(async () => {
      buttonNamed(page, "Connect pages").click();
      await settle(dom);
    });
    expect(repairKnowledgeHealthOrphan).toHaveBeenCalledOnce();
    expect(page.textContent).toContain("That issue changed or is no longer available.");
    expect(dom.window.document.activeElement?.textContent).toBe("Connect pages");
    await act(async () => {
      buttonNamed(page, "Connect pages").click();
      await settle(dom);
    });
    expect(repairKnowledgeHealthOrphan).toHaveBeenCalledTimes(2);
    expect(repairKnowledgeHealthOrphan.mock.calls[0]![0]).toMatchObject({
      action: "connect_orphan_to_parent",
      sourcePageId: parent.page.pageId,
      sourceContextId: parent.sourceContextId,
      sourceRevision: parent.sourceRevision,
      sourceRenderProof: parent.sourceRenderProof,
      pageId: "page_health_orphan_target"
    });
    expect(page.textContent).toContain("The parent now links to this page");
    expect(page.textContent).toContain("No issues found");
    expect(runKnowledgeHealth).toHaveBeenCalledTimes(2);
    expect(page.textContent).not.toContain("op_20260731");
    expect(page.textContent).not.toContain("repair_context");
    await act(async () => { await settle(dom); });
    expect(dom.window.document.activeElement?.textContent).toBe("Run Check");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("ignores a Knowledge Health repair result after the vault identity changes", async () => {
    const dom = createDom();
    let resolveRepair!: (result: unknown) => void;
    const repairContextId = `knowledge_health_repair_context_${"e".repeat(32)}`;
    const sourceRevision = `noteeditrev_${"7".repeat(64)}`;
    const sourceRenderProof = `knowledge_health_render_${"8".repeat(64)}`;
    const occurrenceId = `knowledge_health_occurrence_${"9".repeat(64)}`;
    const runKnowledgeHealth = vi.fn(async (request) => ({
      ...request,
      status: "ready",
      checkedAt: "2026-07-27T12:30:00.000Z",
      reportEpoch: 1,
      indexGeneration: "index:fenced:1",
      coverage: "complete",
      invalidPageCount: 0,
      counts: {
        totalIssueCount: 1,
        brokenLinkPageCount: 1,
        unresolvedLinkCount: 1,
        orphanPageCount: 0,
        duplicateTopicGroupCount: 0,
        unsourcedClaimCount: 0
      },
      issues: [{
        kind: "broken_link",
        page: { pageId: "page_health_fenced", title: "Fenced page" },
        unresolvedLinkCount: 1,
        repairContextId,
        sourceRevision,
        sourceRenderProof,
        occurrenceId,
        repairableOccurrences: [{
          ordinal: 1,
          displayLabel: "Missing page",
          repairContextId,
          sourceRevision,
          sourceRenderProof,
          occurrenceId
        }]
      }],
      truncated: false
    }));
    const repairKnowledgeHealth = vi.fn(() => new Promise((resolve) => { resolveRepair = resolve; }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        maintenance: {
          runKnowledgeHealth,
          searchKnowledgeHealthTargets: vi.fn(),
          repairKnowledgeHealth,
          rebuildLocalDatabase: vi.fn(),
          resetLocalDatabase: vi.fn()
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const renderPanel = async (activeVaultId: string): Promise<void> => {
      root.render(createElement(MaintenanceSettingsPanel, {
        activeVaultId,
        locale: "en",
        error: null,
        localDatabaseStatus: null,
        onRefresh: vi.fn(async () => undefined),
        onRefreshDiagnostics: vi.fn(async () => undefined),
        onOpenPage: vi.fn(async () => true),
        onError: vi.fn(),
        t
      }));
      await settle(dom);
    };

    await act(async () => {
      await renderPanel("vault_20260727_repairfirst");
    });
    await act(async () => {
      buttonNamed(dom.window.document, "Run Check").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(dom.window.document, "Remove link").click();
      await settle(dom);
    });
    const repairRequest = repairKnowledgeHealth.mock.calls[0]![0];
    await act(async () => renderPanel("vault_20260727_repairsecond"));
    await act(async () => {
      resolveRepair({
        ...repairRequest,
        status: "committed",
        revision: `noteeditrev_${"f".repeat(32)}`,
        operationId: `operation_${"g".repeat(32)}`
      });
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".maintenance-settings-page"));
    expect(page.textContent).toContain("No check has been run yet.");
    expect(page.textContent).not.toContain("Broken reference repaired");
    expect(runKnowledgeHealth).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("browses pathless knowledge-page Trash after restart and opens one restored claim through Library", async () => {
    const dom = createDom();
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    const activeVaultId = "vault_20260731_notetrashui";
    const note = {
      trashOperationId: "op_20260731_trashnoteui1234",
      expectedTrashRevision: `notetrashrev_${"a".repeat(64)}` as const,
      pageId: "page_20260731_restorenoteui",
      title: "Restore after restart",
      trashedAt: "2026-07-31T08:00:00.000Z",
      canRestore: true as const
    };
    const listTrash = vi.fn(async (request: NoteTrashListRequest) => ({ ...request, status: "ready" as const, notes: [note] }));
    let mode: "stale" | "wrong_render" | "committed" = "stale";
    const restoreTrash = vi.fn(async (request: NoteTrashRestoreRequest): Promise<NoteTrashRestoreResult> => mode === "stale"
      ? { ...request, status: "stale" }
      : { ...request, status: "committed", operationId: "op_20260731_restorenoteui12", render: {
        summary: { pageId: mode === "wrong_render" ? "page_20260731_wrongrestoreui" : note.pageId,
          title: note.title, pageType: "claim", status: "active",
          pagePath: "wiki/restored.md", createdAt: "2026-07-31T07:00:00.000Z",
          updatedAt: "2026-07-31T08:00:00.000Z", sourceIds: [] },
        html: "<h1>Restore after restart</h1>", byteSize: 64,
        renderContextId: "notectx_0123456789abcdef0123456789abcdef"
      } });
    const opened: string[] = [];
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      notes: { listTrash, restoreTrash }, vault: { current: async () => ({ vaultId: activeVaultId }) }
    } });
    await act(async () => {
      root.render(createElement(NoteTrashRestorePanel, { activeVaultId, locale: "en",
        onCommitted: async (pageId) => { opened.push(pageId); return true; }, t }));
      await settle(dom); await settle(dom);
    });
    expect(listTrash).toHaveBeenCalledWith(expect.objectContaining({ activeVaultId }));
    expect(container.textContent).toContain(note.title);
    const restore = buttonNamed(container, `Restore: ${note.title}`);
    await act(async () => { restore.click(); await settle(dom); await settle(dom); });
    expect(container.textContent).toContain("changed");
    expect(container.querySelector("[data-restorable-note-id]")).not.toBeNull();
    mode = "wrong_render";
    await act(async () => { restore.click(); await settle(dom); await settle(dom); });
    expect(opened).toEqual([]);
    expect(container.querySelector("[data-restorable-note-id]")).not.toBeNull();
    expect(container.textContent).toContain("could not restore");
    mode = "committed";
    await act(async () => { restore.click(); await settle(dom); await settle(dom); });
    expect(restoreTrash).toHaveBeenLastCalledWith(expect.objectContaining({
      activeVaultId, pageId: note.pageId, trashOperationId: note.trashOperationId,
      expectedTrashRevision: note.expectedTrashRevision
    }));
    expect(opened).toEqual([note.pageId]);
    expect(container.querySelector("[data-restorable-note-id]")).toBeNull();
    expect(container.textContent).toContain("knowledge page was restored and opened");
    expect(dom.window.document.activeElement).toBe(container.querySelector("[aria-labelledby='activity-trash-title']"));
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps recoverable-page load failures distinct and retries only the exact current vault request", async () => {
    const dom = createDom();
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    const activeVaultId = "vault_20260731_notetrashretry";
    let returnWrongIdentity = true;
    const listTrash = vi.fn(async (request: NoteTrashListRequest) => returnWrongIdentity
      ? { ...request, requestId: "notetrashlistreq_wrongidentity1234", status: "ready" as const, notes: [] }
      : { ...request, status: "ready" as const, notes: [] });
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      notes: { listTrash, restoreTrash: vi.fn() }, vault: { current: async () => ({ vaultId: activeVaultId }) }
    } });
    await act(async () => {
      root.render(createElement(NoteTrashRestorePanel, { activeVaultId, locale: "en",
        onCommitted: async () => false, t }));
      await settle(dom); await settle(dom);
    });
    expect(container.textContent).toContain("could not check recoverable knowledge pages");
    expect(container.textContent).not.toContain("No recoverable knowledge pages");
    returnWrongIdentity = false;
    await act(async () => { buttonNamed(container, "Try again").click(); await settle(dom); await settle(dom); });
    expect(listTrash).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("No recoverable knowledge pages");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("requires explicit confirmation before permanently deleting one exact knowledge-page trash item", async () => {
    const dom = createDom();
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const root = createRoot(container);
    const activeVaultId = "vault_20260802_notepurgeui";
    const note = { trashOperationId: "op_20260802_notepurgeui12",
      expectedTrashRevision: `notetrashrev_${"a".repeat(64)}` as const,
      pageId: "page_20260802_notepurgeui", title: "Remove exact draft",
      trashedAt: "2026-08-02T08:00:00.000Z", canRestore: true as const };
    const listTrash = vi.fn(async (request: NoteTrashListRequest) => ({ ...request, status: "ready" as const, notes: [note] }));
    let mode: "stale" | "committed" = "stale";
    const purgeTrash = vi.fn(async (request: NoteTrashPurgeRequest): Promise<NoteTrashPurgeResult> => mode === "stale"
      ? { ...request, status: "stale" }
      : { ...request, status: "committed", operationId: "op_20260802_notepurged1234" });
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      notes: { listTrash, restoreTrash: vi.fn(), purgeTrash },
      vault: { current: async () => ({ vaultId: activeVaultId }) }
    } });
    await act(async () => {
      root.render(createElement(NoteTrashRestorePanel, { activeVaultId, locale: "en",
        onCommitted: async () => false, t }));
      await settle(dom); await settle(dom);
    });
    const trigger = buttonNamed(container, `Delete permanently: ${note.title}`);
    expect(purgeTrash).not.toHaveBeenCalled();
    await act(async () => { trigger.click(); await settle(dom); });
    expect(container.textContent).toContain("This cannot be undone");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Delete forever"));
    await act(async () => { buttonNamed(container, "Delete forever").click(); await settle(dom); await settle(dom); });
    expect(purgeTrash).toHaveBeenCalledWith(expect.objectContaining({ activeVaultId, pageId: note.pageId,
      trashOperationId: note.trashOperationId, expectedTrashRevision: note.expectedTrashRevision,
      confirmation: "delete_permanently" }));
    expect(container.querySelector("[data-restorable-note-id]")).not.toBeNull();
    expect(container.textContent).toContain("changed");
    mode = "committed";
    await act(async () => { buttonNamed(container, "Delete forever").click(); await settle(dom); await settle(dom); });
    expect(container.querySelector("[data-restorable-note-id]")).toBeNull();
    expect(container.textContent).toContain("permanently deleted from Trash");
    expect(dom.window.document.activeElement).toBe(container.querySelector("[aria-labelledby='activity-trash-title']"));
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps Skill Trash restore fail-closed, single-flight, retained on conflict, and focus-owned", async () => {
    const dom = createDom();
    installMatchMedia(dom, false);
    const container = requireElement(dom.window.document.querySelector<HTMLElement>("#root"));
    const installedAction = dom.window.document.createElement("button");
    installedAction.textContent = "Enable restored Skill";
    dom.window.document.body.append(installedAction);
    const root = createRoot(container);
    const vaultId = "vault_20260729_skillrestore";
    const restorable = {
      restoreContextId: `skill_restore_${"a".repeat(32)}` as const,
      skillId: "review-notes",
      name: "Review notes",
      version: "1.2.0",
      kind: "pure" as const,
      scope: "machine_local" as const,
      uninstalledAt: "2026-07-29T08:00:00.000Z",
      canRestore: true as const
    };
    let registry: SkillRegistrySummary = { ...skillRegistry(7, false, 0, []), restorableSkills: [restorable] };
    let resolveRestore!: (result: SkillRestoreResult) => void;
    const restoreSkill = vi.fn((_request: SkillRestoreRequest) =>
      new Promise<SkillRestoreResult>((resolve) => { resolveRestore = resolve; }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      skills: { restore: restoreSkill },
      vault: { current: async () => ({ vaultId }) }
    } });
    const render = (): void => root.render(createElement(SkillTrashRestorePanel, {
      registry,
      disabled: false,
      t,
      onCommitted: (next) => {
        registry = next;
        render();
        dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(() => installedAction.focus()));
      }
    }));

    await act(async () => { render(); await settle(dom); });
    const restore = buttonNamed(container, "Restore: Review notes");
    await act(async () => { restore.click(); restore.click(); await settle(dom); });
    expect(restoreSkill).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Restoring...");
    const firstRequest = restoreSkill.mock.calls[0]![0];
    expect(firstRequest).toMatchObject({
      activeVaultId: vaultId,
      restoreContextId: restorable.restoreContextId,
      skillId: restorable.skillId,
      expectedRegistryRevision: 7
    });
    await act(async () => {
      resolveRestore({ ...firstRequest, status: "ineligible", registry: skillRegistry(8, false, 0, []) });
      await settle(dom);
    });
    expect(container.textContent).toContain("The Skill list changed. Review it and try again.");
    expect(container.querySelector("[data-restorable-skill-id]")).not.toBeNull();
    await act(async () => { await settle(dom); await settle(dom); });
    expect(dom.window.document.activeElement).toBe(restore);

    await act(async () => { restore.click(); await settle(dom); });
    expect(restoreSkill).toHaveBeenCalledTimes(2);
    const secondRequest = restoreSkill.mock.calls[1]![0];
    const restoredSkill = { ...skillRegistry(8, false).skills[0]!, enabled: false, canEnable: true };
    await act(async () => {
      resolveRestore({
        ...secondRequest,
        status: "committed",
        registry: { ...skillRegistry(8, false, 0, [restoredSkill]), restorableSkills: [] }
      });
      await settle(dom);
    });
    await act(async () => { await settle(dom); await settle(dom); });
    expect(container.querySelector("[data-restorable-skill-id]")).toBeNull();
    expect(dom.window.document.activeElement).toBe(installedAction);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("renders verified Skills, disables and re-enables with exact CAS, and ignores stale registry events", async () => {
    const dom = createDom();
    let resolveSummary!: (result: SkillRegistryQueryResult) => void;
    let registryListener: ((summary: SkillRegistrySummary) => void) | undefined;
    const unsubscribe = vi.fn();
    const enabledRegistry = skillRegistry(7, true, 1);
    const disabledRegistry = skillRegistry(8, false, 1);
    const reenabledRegistry = skillRegistry(9, true, 1);
    const summary = vi.fn(() => new Promise<SkillRegistryQueryResult>((resolve) => {
      resolveSummary = resolve;
    }));
    const disable = vi.fn(async () => ({ status: "committed" as const, registry: disabledRegistry }));
    const enable = vi.fn(async (request: SkillEnableRequest): Promise<SkillLifecycleMutationResult> => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      scope: request.scope,
      skillId: request.skillId,
      status: "committed" as const,
      registry: reenabledRegistry
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary,
          disable,
          enable,
          onChanged: (listener: (next: SkillRegistrySummary) => void) => {
            registryListener = listener;
            return unsubscribe;
          }
        },
        vault: { current: async () => ({ vaultId: "vault_20260728_skilllifecycle" }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });

    const page = dom.window.document.querySelector<HTMLElement>(".settings-skills")!;
    expect(page.getAttribute("aria-labelledby")).toBe("settings-skills-title");
    expect(page.querySelectorAll('[role="group"]')).toHaveLength(2);
    expect(page.textContent).toContain("Loading Skills");
    expect(page.textContent).not.toContain("No Skills installed");
    expect(summary).toHaveBeenCalledOnce();

    await act(async () => {
      resolveSummary({ status: "ready", registry: enabledRegistry });
      await settle(dom);
    });

    const row = requireElement(page.querySelector<HTMLElement>('[data-skill-id="review-notes"]'));
    expect(page.dataset.skillRegistryRevision).toBeUndefined();
    expect(page.querySelector("[data-skill-registry-revision]")?.getAttribute("data-skill-registry-revision")).toBe("7");
    expect(row.textContent).toContain("Review notes");
    expect(row.textContent).toContain("Summarizes the current source for review.");
    expect(row.textContent).toContain("v1.2.0");
    expect(row.textContent).toContain("Local workflow");
    expect(row.textContent).toContain("This Mac");
    expect(row.textContent).toContain("Local only");
    expect(row.textContent).toContain("Enabled");
    expect(page.textContent).toContain("Some registry entries could not be verified and are hidden.");
    expect(page.textContent).not.toContain("/Users/private");
    expect(page.textContent).toContain("Source, files, and warnings stay visible");

    await act(async () => {
      buttonNamed(row, "Disable: Review notes").click();
      await settle(dom);
    });
    expect(disable).toHaveBeenCalledWith({
      apiVersion: 1, activeVaultId: "vault_20260728_skilllifecycle", scope: "machine_local",
      skillId: "review-notes", expectedRevision: 7
    });
    expect(row.textContent).toContain("Disabled");
    expect(row.textContent).toContain("Enable");
    const disabledStatus = requireElement(row.querySelector<HTMLElement>(".settings-status"));
    expect(disabledStatus.classList.contains("neutral")).toBe(true);
    expect(disabledStatus.classList.contains("is-enabled")).toBe(false);
    expect(buttonNamed(row, "Enable: Review notes").disabled).toBe(false);
    expect(page.textContent).toContain("The Skill is disabled for new Agent runs.");

    await act(async () => {
      buttonNamed(row, "Enable: Review notes").click();
      await settle(dom);
      await settle(dom);
    });
    expect(enable).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u),
      activeVaultId: "vault_20260728_skilllifecycle",
      scope: "machine_local",
      skillId: "review-notes",
      expectedRegistryRevision: 8
    });
    expect(row.textContent).toContain("Enabled");
    expect(page.textContent).toContain("The Skill is enabled for new Agent runs.");

    await act(async () => {
      registryListener?.(enabledRegistry);
      await settle(dom);
    });
    expect(row.textContent).toContain("Enabled");

    await act(async () => {
      buttonNamed(page, "Install from link").click();
      await settle(dom);
    });
    expect(buttonNamed(page, "Import Markdown Skill").disabled).toBe(true);
    expect(requireElement(page.querySelector<HTMLInputElement>("#skill-install-url"))).toBe(dom.window.document.activeElement);

    await act(async () => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    dom.window.close();
  });

  it("exports without paths and confirms one trash-first uninstall with focus and identity fences", async () => {
    const dom = createDom();
    const vaultId = "vault_20260728_skilllifecycle";
    const first = skillRegistry(12, true).skills[0]!;
    const second = {
      ...first,
      id: "organize-notes",
      name: "Organize notes",
      description: "Organizes selected notes."
    };
    const initialRegistry = skillRegistry(12, true, 0, [first, second]);
    const afterUninstall = skillRegistry(13, true, 0, [second]);
    let resolveUninstall!: (result: SkillLifecycleMutationResult) => void;
    const exportSkill = vi.fn(async (request: SkillExportRequest) => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      scope: request.scope,
      skillId: request.skillId,
      registryRevision: request.expectedRegistryRevision,
      status: "cancelled" as const
    }));
    const uninstall = vi.fn((_request: SkillUninstallRequest) =>
      new Promise<SkillLifecycleMutationResult>((resolve) => { resolveUninstall = resolve; }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: initialRegistry }),
          disable: vi.fn(),
          enable: vi.fn(),
          export: exportSkill,
          uninstall,
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const firstRow = requireElement(page.querySelector<HTMLElement>('[data-skill-id="review-notes"]'));

    await act(async () => {
      buttonNamed(firstRow, "Export: Review notes").click();
      await settle(dom);
      await settle(dom);
    });
    expect(exportSkill).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      scope: "machine_local",
      skillId: "review-notes",
      expectedRegistryRevision: 12
    });
    expect(page.querySelector('.settings-note[role="status"]')).toBeNull();
    expect(page.textContent).not.toContain("/Users/");

    const uninstallTrigger = buttonNamed(firstRow, "Uninstall: Review notes");
    await act(async () => {
      uninstallTrigger.click();
      await settle(dom);
    });
    let confirmation = requireElement(page.querySelector<HTMLElement>('[role="alertdialog"]'));
    expect(confirmation.textContent).toContain("move its installed files to Trash");
    expect(dom.window.document.activeElement).toBe(buttonNamed(confirmation, "Cancel"));
    await act(async () => {
      confirmation.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    expect(page.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dom.window.document.activeElement).toBe(uninstallTrigger);

    await act(async () => {
      uninstallTrigger.click();
      await settle(dom);
    });
    confirmation = requireElement(page.querySelector<HTMLElement>('[role="alertdialog"]'));
    const confirm = buttonNamed(confirmation, "Move to Trash");
    await act(async () => {
      confirm.click();
      confirm.click();
      await settle(dom);
    });
    expect(uninstall).toHaveBeenCalledOnce();
    const request = uninstall.mock.calls[0]![0];
    expect(request).toEqual({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      scope: "machine_local",
      skillId: "review-notes",
      expectedRegistryRevision: 12
    });
    await act(async () => {
      resolveUninstall({
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: vaultId,
        scope: "machine_local",
        skillId: "review-notes",
        status: "committed",
        registry: afterUninstall
      });
      await settle(dom);
      await settle(dom);
    });
    expect(page.querySelector('[data-skill-id="review-notes"]')).toBeNull();
    expect(page.textContent).toContain("The Skill was uninstalled and moved to Trash.");
    expect(dom.window.document.activeElement).toBe(buttonNamed(page, "Disable: Organize notes"));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("stages one eligible source update for review and installs it without changing enabled state", async () => {
    const dom = createDom();
    const vaultId = "vault_20260728_skillupdate";
    const updateable = {
      ...skillRegistry(20, false).skills[0]!,
      version: "1.2.0",
      canUpdate: true
    };
    const fixed = {
      ...updateable,
      id: "built-in-review",
      name: "Built-in review",
      scope: "built_in" as const,
      trust: "built_in" as const,
      canEnable: false,
      canUninstall: false,
      canExport: false,
      canUpdate: false
    };
    const initialRegistry = skillRegistry(20, false, 0, [updateable, fixed]);
    const updatedRegistry = skillRegistry(21, false, 0, [{
      ...updateable,
      version: "1.3.0"
    }, fixed]);
    const staged = {
      stagingId: "skillstage_abcdef0123456789abcdef0123456789" as const,
      manifestSha256: `sha256:${"c".repeat(64)}` as const,
      bundleSha256: `sha256:${"d".repeat(64)}` as const,
      registryRevision: 20,
      expiresAt: "2026-07-28T12:00:00.000Z",
      sourceUrl: "https://example.com/SKILL.md" as const,
      id: "review-notes",
      name: "Review notes",
      version: "1.3.0",
      description: "Summarizes the current source with the reviewed update.",
      scope: "machine_local" as const,
      kind: "pure" as const,
      capabilities: ["read_current_source" as const],
      dataBoundaries: ["local" as const],
      author: "Pige Labs",
      license: "MIT",
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 2304, sha256: `sha256:${"d".repeat(64)}` as const }],
      pureUpdateReview: {
        kind: "pure" as const,
        previousVersion: "1.2.0",
        previousManifestSha256: `sha256:${"a".repeat(64)}` as const,
        previousBundleSha256: `sha256:${"b".repeat(64)}` as const,
        addedFiles: [],
        removedFiles: [],
        changedFiles: ["SKILL.md" as const],
        finalEnabled: false
      },
      warnings: ["untrusted_remote_source" as const]
    };
    const stageUpdate = vi.fn(async (request: {
      requestId: `skill_lifecycle_request_${string}`;
      activeVaultId: string;
      scope: "machine_local" | "vault";
      skillId: string;
    }) => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      scope: request.scope,
      skillId: request.skillId,
      status: "ready" as const,
      staged
    }));
    const installStaged = vi.fn(async (request: { requestId: string; activeVaultId: string }) => ({
      status: "committed" as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      registry: updatedRegistry
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: initialRegistry }),
          stageUpdate,
          installStaged,
          discardStaged: vi.fn(),
          disable: vi.fn(),
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const row = requireElement(page.querySelector<HTMLElement>('[data-skill-id="review-notes"]'));
    expect(buttonNamed(row, "Update: Review notes").disabled).toBe(false);
    expect(page.querySelector('[aria-label="Update: Built-in review"]')).toBeNull();

    await act(async () => {
      const update = buttonNamed(row, "Update: Review notes");
      update.click();
      update.click();
      await settle(dom);
      await settle(dom);
    });
    expect(stageUpdate).toHaveBeenCalledOnce();
    expect(stageUpdate).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      scope: "machine_local",
      skillId: "review-notes",
      expectedRegistryRevision: 20
    });
    expect(page.textContent).toContain("v1.3.0");
    expect(page.textContent).toContain("This Skill comes from a remote source you must review.");
    expect(page.textContent).toContain("~ SKILL.md");
    expect(page.textContent).toContain("This Skill will remain disabled after the update.");
    expect(page.textContent).not.toContain(staged.stagingId);
    expect(page.textContent).not.toContain(staged.manifestSha256);
    const confirmUpdate = buttonNamed(page, "Update Skill");
    expect(dom.window.document.activeElement).toBe(confirmUpdate);

    await act(async () => {
      confirmUpdate.click();
      await settle(dom);
      await settle(dom);
    });
    expect(installStaged).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      scope: "machine_local",
      stagingId: staged.stagingId,
      manifestSha256: staged.manifestSha256,
      bundleSha256: staged.bundleSha256,
      expectedRegistryRevision: 20,
      enabled: false
    });
    expect(row.textContent).toContain("v1.3.0");
    expect(row.textContent).toContain("Disabled");
    expect(page.textContent).toContain("The reviewed Skill update was installed.");
    expect(page.querySelector("#skill-url-install")).toBeNull();
    expect(dom.window.document.activeElement).toBe(buttonNamed(row, "Update: Review notes"));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shows External/Web capability changes and accepts the reviewed update only as disabled", async () => {
    const dom = createDom();
    const vaultId = "vault_20260730_externalupdateui";
    const sourceUrl = "https://example.com/external/SKILL.md" as const;
    const runtime = { adapter: "pige_readonly_https_v1" as const, origin: "https://api.example.com" as const };
    const installed: SkillRegistrySummary["skills"][number] = {
      id: "external-review", name: "External review", version: "1", description: "Reads one reviewed origin.",
      scope: "machine_local", kind: "external_web", enabled: true, trust: "user_confirmed",
      capabilities: ["external_network"], dataBoundaries: ["network"], runtime,
      canEnable: false, canUninstall: false, canExport: false, canUpdate: true,
      source: "https", sourceUrl,
      manifestSha256: `sha256:${"a".repeat(64)}`, bundleSha256: `sha256:${"b".repeat(64)}`,
      files: [{ relativePath: "SKILL.md", utf8ByteSize: 1024, sha256: `sha256:${"a".repeat(64)}` }],
      warnings: ["untrusted_remote_source"]
    };
    const initial = skillRegistry(40, false, 0, [installed]);
    const staged = {
      stagingId: `skillstage_${"c".repeat(32)}` as const,
      manifestSha256: `sha256:${"d".repeat(64)}` as const,
      bundleSha256: `sha256:${"e".repeat(64)}` as const,
      registryRevision: 40,
      expiresAt: "2026-07-31T12:00:00.000Z",
      sourceUrl,
      id: installed.id,
      name: installed.name,
      version: "2",
      description: "Reads with a separately reviewed credential.",
      scope: "machine_local" as const,
      kind: "external_web" as const,
      capabilities: ["external_network", "use_brokered_credential"] as const,
      dataBoundaries: ["network", "brokered_credential"] as const,
      source: "https" as const,
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 1200, sha256: `sha256:${"d".repeat(64)}` as const }],
      warnings: ["untrusted_remote_source" as const],
      externalUpdateReview: {
        kind: "external_web" as const,
        previousVersion: "1",
        previousManifestSha256: installed.manifestSha256!,
        previousBundleSha256: installed.bundleSha256!,
        addedCapabilities: ["use_brokered_credential" as const],
        removedCapabilities: [],
        addedDataBoundaries: ["brokered_credential" as const],
        removedDataBoundaries: [],
        finalEnabled: false as const
      }
    };
    const committed = skillRegistry(41, false, 0, [{
      ...installed, version: "2", enabled: false, canEnable: false,
      capabilities: staged.capabilities, dataBoundaries: staged.dataBoundaries, runtime: undefined,
      manifestSha256: staged.manifestSha256, bundleSha256: staged.bundleSha256, files: staged.files
    }]);
    const stageUpdate = vi.fn(async (request: SkillStageUpdateRequest): Promise<SkillStageUpdateResult> => ({
      apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId,
      scope: request.scope, skillId: request.skillId, status: "ready", staged
    }));
    const installStaged = vi.fn(async (request: { requestId: `skillreq_${string}`; activeVaultId: string }) => ({
      status: "committed" as const, requestId: request.requestId,
      activeVaultId: request.activeVaultId, registry: committed
    }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      skills: {
        summary: async () => ({ status: "ready" as const, registry: initial }),
        stageUpdate, installStaged, discardStaged: vi.fn(), disable: vi.fn(), onChanged: () => () => undefined
      },
      vault: { current: async () => ({ vaultId }) }
    } });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => { root.render(createElement(SkillsSettingsPanel, { t })); await settle(dom); });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    await act(async () => { buttonNamed(page, "Update: External review").click(); await settle(dom); await settle(dom); });
    const diff = requireElement(page.querySelector<HTMLElement>('[data-external-skill-update-diff="true"]'));
    expect(diff.textContent).toContain("Previous version · v1");
    expect(diff.textContent).toContain("+ use_brokered_credential");
    expect(diff.textContent).toContain("+ Protected credential");
    expect(diff.textContent).toContain("installed disabled");
    await act(async () => { buttonNamed(page, "Update Skill").click(); await settle(dom); await settle(dom); });
    expect(installStaged).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, expectedRegistryRevision: 40 }));
    expect(page.querySelector('[data-skill-id="external-review"]')?.textContent).toContain("Disabled");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adopts authoritative Skill state for current, stale, and missing update checks", async () => {
    const dom = createDom();
    const vaultId = "vault_20260728_skillupdateclosed";
    const registries = [
      skillRegistry(31, true),
      skillRegistry(32, true),
      skillRegistry(33, true, 0, [])
    ];
    let resultIndex = 0;
    const stageUpdate = vi.fn(async (request: {
      requestId: `skill_lifecycle_request_${string}`;
      activeVaultId: string;
      skillId: string;
    }) => {
      const status = (["current", "stale", "not_found"] as const)[resultIndex]!;
      const registry = registries[resultIndex++]!;
      return {
        apiVersion: 1 as const,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        skillId: request.skillId,
        status,
        registry
      };
    });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: skillRegistry(30, true) }),
          stageUpdate,
          disable: vi.fn(),
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const update = (): HTMLButtonElement => buttonNamed(page, "Update: Review notes");

    await act(async () => {
      update().click();
      await settle(dom);
      await settle(dom);
    });
    expect(page.textContent).toContain("This Skill is already current.");
    expect(page.querySelector("[data-skill-registry-revision]")?.getAttribute("data-skill-registry-revision")).toBe("31");
    expect(dom.window.document.activeElement).toBe(update());

    await act(async () => {
      update().click();
      await settle(dom);
      await settle(dom);
    });
    expect(page.textContent).toContain("The Skill Registry changed");
    expect(page.querySelector("[data-skill-registry-revision]")?.getAttribute("data-skill-registry-revision")).toBe("32");

    await act(async () => {
      update().click();
      await settle(dom);
      await settle(dom);
    });
    expect(page.textContent).toContain("This Skill is no longer available for update.");
    expect(page.textContent).toContain("No Skills installed");
    expect(stageUpdate).toHaveBeenCalledTimes(3);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("stages one Main-picked Markdown Skill for the existing safe review and install flow", async () => {
    const dom = createDom();
    const vaultId = "vault_20260728_markdownskill";
    const initialRegistry = skillRegistry(40, false, 0, []);
    const installedRegistry = skillRegistry(41, true);
    const staged = {
      stagingId: "skillstage_89abcdef0123456789abcdef01234567" as const,
      manifestSha256: `sha256:${"e".repeat(64)}` as const,
      bundleSha256: `sha256:${"a".repeat(64)}` as const,
      registryRevision: 40,
      expiresAt: "2026-07-28T14:00:00.000Z",
      id: "local-review",
      name: "Local review",
      version: "1.0.0",
      description: "Reviews the current source from one local Markdown Skill.",
      scope: "machine_local" as const,
      kind: "pure" as const,
      capabilities: ["read_current_source" as const],
      dataBoundaries: ["local" as const],
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 1536, sha256: `sha256:${"f".repeat(64)}` as const }],
      warnings: []
    };
    let stageAttempt = 0;
    const stageFromMarkdown = vi.fn(async (request: {
      requestId: `skillreq_${string}`;
      activeVaultId: string;
    }) => {
      const identity = {
        apiVersion: 1 as const,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId
      };
      if (stageAttempt++ === 0) return { ...identity, status: "cancelled" as const };
      if (stageAttempt === 2) return { ...identity, status: "ready" as const, staged };
      return { ...identity, status: "failed" as const };
    });
    const installStaged = vi.fn(async (request: { requestId: string; activeVaultId: string }) => ({
      status: "committed" as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      registry: installedRegistry
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: initialRegistry }),
          stageFromMarkdown,
          installStaged,
          discardStaged: vi.fn(),
          disable: vi.fn(),
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const importMarkdown = (): HTMLButtonElement => buttonNamed(page, "Import Markdown Skill");

    await act(async () => {
      const action = importMarkdown();
      action.click();
      action.click();
      await settle(dom);
      await settle(dom);
    });
    expect(stageFromMarkdown).toHaveBeenCalledOnce();
    expect(stageFromMarkdown).toHaveBeenLastCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId
    });
    expect(page.textContent).not.toContain("Pige could not review this Markdown Skill safely.");
    expect(dom.window.document.activeElement).toBe(importMarkdown());

    await act(async () => {
      importMarkdown().click();
      await settle(dom);
      await settle(dom);
    });
    expect(stageFromMarkdown).toHaveBeenCalledTimes(2);
    expect(page.textContent).toContain("Local review");
    expect(page.textContent).toContain("SKILL.md · 2 KB");
    expect(page.textContent).not.toContain(staged.stagingId);
    expect(page.textContent).not.toContain(staged.manifestSha256);
    expect(page.textContent).not.toContain("file://");
    const install = buttonNamed(page, "Install Skill");
    expect(dom.window.document.activeElement).toBe(install);

    await act(async () => {
      install.click();
      await settle(dom);
      await settle(dom);
    });
    expect(installStaged).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      scope: "machine_local",
      stagingId: staged.stagingId,
      manifestSha256: staged.manifestSha256,
      bundleSha256: staged.bundleSha256,
      expectedRegistryRevision: 40,
      enabled: true
    });
    expect(page.textContent).toContain("The reviewed Skill is installed and enabled.");
    expect(page.querySelector("#skill-url-install")).toBeNull();
    expect(dom.window.document.activeElement).toBe(importMarkdown());

    await act(async () => {
      importMarkdown().click();
      await settle(dom);
      await settle(dom);
    });
    expect(stageFromMarkdown).toHaveBeenCalledTimes(3);
    expect(page.textContent).toContain("Pige could not review this Markdown Skill safely.");
    expect(dom.window.document.activeElement).toBe(importMarkdown());

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("stages one Main-picked ZIP Skill, reviews every safe file, and installs the exact bundle", async () => {
    const dom = createDom();
    const vaultId = "vault_20260728_zipskill";
    const initialRegistry = skillRegistry(50, false, 0, []);
    const installedRegistry = skillRegistry(51, true);
    const staged = {
      stagingId: "skillstage_fedcba9876543210fedcba9876543210" as const,
      manifestSha256: `sha256:${"1".repeat(64)}` as const,
      bundleSha256: `sha256:${"2".repeat(64)}` as const,
      registryRevision: 50,
      expiresAt: "2026-07-28T15:00:00.000Z",
      id: "zip-review",
      name: "ZIP review",
      version: "1.0.0",
      description: "Reviews a complete local ZIP Skill bundle.",
      scope: "machine_local" as const,
      kind: "pure" as const,
      capabilities: ["read_current_source" as const],
      dataBoundaries: ["local" as const],
      files: [
        { relativePath: "SKILL.md" as const, utf8ByteSize: 1536, sha256: `sha256:${"3".repeat(64)}` as const },
        { relativePath: "references/config.json" as const, utf8ByteSize: 512, sha256: `sha256:${"4".repeat(64)}` as const },
        { relativePath: "references/guide.md" as const, utf8ByteSize: 3072, sha256: `sha256:${"5".repeat(64)}` as const }
      ],
      warnings: []
    };
    let stageAttempt = 0;
    const stageFromZip = vi.fn(async (request: {
      requestId: `skillreq_${string}`;
      activeVaultId: string;
    }) => {
      const identity = {
        apiVersion: 1 as const,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId
      };
      stageAttempt += 1;
      if (stageAttempt === 1) return { ...identity, status: "cancelled" as const };
      if (stageAttempt === 2) return { ...identity, status: "invalid" as const, reason: "archive_unsafe" as const };
      return { ...identity, status: "ready" as const, staged };
    });
    const installStaged = vi.fn(async (request: { requestId: string; activeVaultId: string }) => ({
      status: "committed" as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      registry: installedRegistry
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: initialRegistry }),
          stageFromZip,
          installStaged,
          discardStaged: vi.fn(),
          disable: vi.fn(),
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const importZip = (): HTMLButtonElement => buttonNamed(page, "Import ZIP Skill");

    await act(async () => {
      importZip().click();
      await settle(dom);
      await settle(dom);
    });
    expect(stageFromZip).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId
    });
    expect(page.textContent).not.toContain("Pige could not review this ZIP Skill safely.");
    expect(dom.window.document.activeElement).toBe(importZip());

    await act(async () => {
      importZip().click();
      await settle(dom);
      await settle(dom);
    });
    expect(page.textContent).toContain("Pige could not review this ZIP Skill safely.");
    expect(page.textContent).not.toContain("archive_unsafe");

    await act(async () => {
      importZip().click();
      await settle(dom);
      await settle(dom);
    });
    expect(page.textContent).toContain("ZIP review");
    expect(page.textContent).toContain("SKILL.md · 2 KB");
    expect(page.textContent).toContain("references/config.json · 512 B");
    expect(page.textContent).toContain("references/guide.md · 3 KB");
    expect(page.textContent).not.toContain(staged.stagingId);
    expect(page.textContent).not.toContain(staged.manifestSha256);
    expect(page.textContent).not.toContain(staged.bundleSha256);
    expect(page.textContent).not.toContain("file://");

    await act(async () => {
      buttonNamed(page, "Install Skill").click();
      await settle(dom);
      await settle(dom);
    });
    expect(installStaged).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      scope: "machine_local",
      stagingId: staged.stagingId,
      manifestSha256: staged.manifestSha256,
      bundleSha256: staged.bundleSha256,
      expectedRegistryRevision: 50,
      enabled: true
    });
    expect(page.textContent).toContain("The reviewed Skill is installed and enabled.");
    expect(dom.window.document.activeElement).toBe(importZip());

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("stages one exact Skill URL for review, installs with the frozen identity, and discards without installing", async () => {
    const dom = createDom();
    const vaultId = "vault_20260728_urlskill";
    const initialRegistry = skillRegistry(3, false, 0, []);
    const installedRegistry = skillRegistry(4, true, 0);
    const staged = {
      stagingId: "skillstage_0123456789abcdef0123456789abcdef" as const,
      manifestSha256: `sha256:${"a".repeat(64)}` as const,
      bundleSha256: `sha256:${"c".repeat(64)}` as const,
      registryRevision: 3,
      expiresAt: "2026-07-27T12:00:00.000Z",
      sourceUrl: "https://example.com/SKILL.md" as const,
      id: "review-notes",
      name: "Review notes",
      version: "1.2.0",
      description: "Summarizes the current source for review.",
      scope: "machine_local" as const,
      kind: "pure" as const,
      capabilities: ["read_current_source" as const],
      dataBoundaries: ["local" as const],
      author: "Pige Labs",
      license: "MIT",
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 2048, sha256: `sha256:${"b".repeat(64)}` as const }],
      warnings: ["untrusted_remote_source" as const]
    };
    let stageCall = 0;
    const stageFromUrl = vi.fn(async (request: { requestId: string; activeVaultId: string }) => ({
      status: "ready" as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      staged: { ...staged, registryRevision: stageCall++ === 0 ? 3 : 4 }
    }));
    const installStaged = vi.fn(async (request: { requestId: string; activeVaultId: string }) => ({
      status: "committed" as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      registry: installedRegistry
    }));
    const discardStaged = vi.fn(async (request: { requestId: string; activeVaultId: string }) => ({
      status: "discarded" as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry: initialRegistry }),
          stageFromUrl,
          installStaged,
          discardStaged,
          disable: vi.fn(),
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    await act(async () => {
      buttonNamed(page, "Install from link").click();
      await settle(dom);
    });
    const input = requireElement(page.querySelector<HTMLInputElement>("#skill-install-url"));
    await act(async () => {
      input.blur();
      inputValue(dom, input, staged.sourceUrl);
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Review Skill").click();
      await settle(dom);
    });
    expect(stageFromUrl).toHaveBeenCalledOnce();
    expect(stageFromUrl.mock.calls[0]?.[0]).toMatchObject({ apiVersion: 1, sourceUrl: staged.sourceUrl });
    expect(stageFromUrl.mock.calls[0]?.[0].requestId).toMatch(/^skillreq_[a-z0-9]{16,64}$/u);
    expect(page.textContent).toContain("Review notes");
    expect(page.textContent).toContain("Read the current source");
    expect(page.textContent).toContain("This Skill comes from a remote source you must review.");
    expect(page.textContent).not.toContain(staged.stagingId);
    expect(page.textContent).not.toContain(staged.manifestSha256);

    await act(async () => {
      buttonNamed(page, "Install Skill").click();
      await settle(dom);
    });
    expect(installStaged).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      scope: "machine_local",
      stagingId: staged.stagingId,
      manifestSha256: staged.manifestSha256,
      bundleSha256: staged.bundleSha256,
      expectedRegistryRevision: 3,
      enabled: true
    });
    expect(page.textContent).toContain("The reviewed Skill is installed and enabled.");
    expect(page.querySelector("#skill-install-url")).toBeNull();
    expect(dom.window.document.activeElement).toBe(buttonNamed(page, "Install from link"));

    await act(async () => {
      buttonNamed(page, "Install from link").click();
      await settle(dom);
    });
    const secondInput = requireElement(page.querySelector<HTMLInputElement>("#skill-install-url"));
    await act(async () => {
      secondInput.blur();
      inputValue(dom, secondInput, staged.sourceUrl);
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Review Skill").click();
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Discard").click();
      await settle(dom);
    });
    expect(discardStaged).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^skillreq_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId,
      scope: "machine_local",
      stagingId: staged.stagingId,
      manifestSha256: staged.manifestSha256,
      bundleSha256: staged.bundleSha256
    });
    expect(Array.from(page.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Discard")).toBe(false);
    const restoredInput = requireElement(page.querySelector<HTMLInputElement>("#skill-install-url"));
    expect(restoredInput.value).toBe(staged.sourceUrl);
    expect(dom.window.document.activeElement).toBe(restoredInput);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adopts ordered chat-staged Skills without installing automatically", async () => {
    const dom = createDom();
    const vaultId = "vault_20260729_skillchatstage";
    const staged = (suffix: string, name: string) => ({
      stagingId: `skillstage_${suffix.repeat(32).slice(0, 32)}` as `skillstage_${string}`,
      manifestSha256: `sha256:${suffix.repeat(64).slice(0, 64)}` as `sha256:${string}`,
      bundleSha256: `sha256:${suffix === "a" ? "b".repeat(64) : "c".repeat(64)}` as `sha256:${string}`,
      registryRevision: 4, expiresAt: "2026-07-29T12:00:00.000Z",
      sourceUrl: `https://example.com/${name}/SKILL.md` as `https://${string}`,
      id: `${name}-skill`, name, version: "1.0.0", description: `Reviews ${name}.`,
      scope: "machine_local" as const, kind: "pure" as const,
      capabilities: ["read_current_source" as const], dataBoundaries: ["local" as const],
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 1024, sha256: `sha256:${"d".repeat(64)}` as const }],
      warnings: ["untrusted_remote_source" as const]
    });
    const first = staged("a", "first-chat-review");
    const second = staged("e", "second-chat-review");
    const pendingStagedReviews = vi.fn()
      .mockImplementationOnce(async (request) => ({ ...request, status: "ready" as const, staged: [first, second] }))
      .mockImplementationOnce(async (request) => ({ ...request, status: "ready" as const, staged: [second] }))
      .mockImplementationOnce(async (request) => ({ ...request, status: "failed" as const }));
    const installStaged = vi.fn(async (request: { requestId: string; activeVaultId: string }) => ({
      status: "committed" as const, requestId: request.requestId,
      activeVaultId: request.activeVaultId, registry: skillRegistry(5, true)
    }));
    const discardStaged = vi.fn(async (request: { requestId: string; activeVaultId: string }) => ({
      status: "discarded" as const, requestId: request.requestId, activeVaultId: request.activeVaultId
    }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      skills: {
        summary: async () => ({ status: "ready" as const, registry: skillRegistry(4, false, 0, []) }),
        pendingStagedReviews, installStaged, discardStaged, disable: vi.fn(), onChanged: () => () => undefined
      },
      vault: { current: async () => ({ vaultId }) }
    } });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => { root.render(createElement(SkillsSettingsPanel, { t })); await settle(dom); await settle(dom); });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    expect(pendingStagedReviews).toHaveBeenCalledWith({
      apiVersion: 1, requestId: expect.stringMatching(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u), activeVaultId: vaultId
    });
    expect(page.textContent).toContain(first.name);
    expect(page.textContent).not.toContain(second.name);
    expect(installStaged).not.toHaveBeenCalled();
    await act(async () => { buttonNamed(page, "Install Skill").click(); await settle(dom); await settle(dom); });
    expect(installStaged).toHaveBeenCalledWith(expect.objectContaining({
      stagingId: first.stagingId, manifestSha256: first.manifestSha256,
      bundleSha256: first.bundleSha256, expectedRegistryRevision: 4, enabled: true
    }));
    expect(page.textContent).toContain(second.name);
    expect(installStaged).toHaveBeenCalledOnce();
    await act(async () => { buttonNamed(page, "Discard").click(); await settle(dom); await settle(dom); });
    expect(discardStaged).toHaveBeenCalledWith(expect.objectContaining({ stagingId: second.stagingId }));
    expect(pendingStagedReviews).toHaveBeenCalledTimes(3);
    expect(page.querySelector("#skill-url-install")).toBeNull();
    expect(dom.window.document.activeElement).toBe(buttonNamed(page, "Install from link"));
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("discloses External/Web Skill boundaries and checksums and installs it disabled", async () => {
    const dom = createDom();
    const vaultId = "vault_20260729_externalwebskill";
    const manifestSha256 = `sha256:${"a".repeat(64)}` as const;
    const bundleSha256 = `sha256:${"b".repeat(64)}` as const;
    const fileSha256 = `sha256:${"c".repeat(64)}` as const;
    const sourceUrl = "https://example.com/external-research/SKILL.md" as const;
    const disclosure = {
      kind: "external_web" as const,
      capabilities: ["read_current_source", "external_network", "use_brokered_credential"] as const,
      dataBoundaries: ["local", "network", "brokered_credential"] as const,
      source: "https" as const, sourceUrl, manifestSha256, bundleSha256,
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 1536, sha256: fileSha256 }],
      warnings: ["untrusted_remote_source" as const]
    };
    const installed: SkillRegistrySummary["skills"][number] = {
      id: "installed-external", name: "Installed external", version: "1.0.0",
      description: "Uses reviewed external capabilities.", scope: "machine_local", enabled: false,
      trust: "user_confirmed", canEnable: false, canUninstall: true, canExport: true, canUpdate: false,
      ...disclosure
    };
    const staged = {
      stagingId: `skillstage_${"d".repeat(32)}` as const, registryRevision: 9,
      expiresAt: "2026-07-30T12:00:00.000Z", id: "staged-external", name: "Staged external",
      version: "1.1.0", description: "Reviews an external workflow before install.",
      scope: "machine_local" as const, ...disclosure,
      sourceUrl: "https://example.com/staged-external/SKILL.md" as const,
      manifestSha256: `sha256:${"d".repeat(64)}` as const,
      bundleSha256: `sha256:${"e".repeat(64)}` as const,
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 2048, sha256: `sha256:${"f".repeat(64)}` as const }]
    };
    const installedRegistry = skillRegistry(9, false, 0, [installed]);
    const committedRegistry = skillRegistry(10, false, 0, [installed, {
      ...installed, id: staged.id, name: staged.name, version: staged.version, description: staged.description,
      sourceUrl: staged.sourceUrl, manifestSha256: staged.manifestSha256,
      bundleSha256: staged.bundleSha256, files: staged.files
    }]);
    const installStaged = vi.fn(async (request: { requestId: string; activeVaultId: string }) => ({
      status: "committed" as const, requestId: request.requestId,
      activeVaultId: request.activeVaultId, registry: committedRegistry
    }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      skills: {
        summary: async () => ({ status: "ready" as const, registry: installedRegistry }),
        pendingStagedReviews: async (request: object) => ({ ...request, status: "ready" as const, staged: [staged] }),
        installStaged, discardStaged: vi.fn(), disable: vi.fn(), onChanged: () => () => undefined
      },
      vault: { current: async () => ({ vaultId }) }
    } });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => { root.render(createElement(SkillsSettingsPanel, { t })); await settle(dom); await settle(dom); });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const installedRow = requireElement(page.querySelector<HTMLElement>('[data-skill-id="installed-external"]'));
    for (const value of ["External workflow", "Local only", "Network", "Protected credential",
      "read_current_source", "external_network", "use_brokered_credential", sourceUrl,
      manifestSha256, bundleSha256, fileSha256, "This Skill comes from a remote source you must review."]) {
      expect(installedRow.textContent).toContain(value);
    }
    const review = requireElement(page.querySelector<HTMLElement>("#skill-url-install"));
    for (const value of [staged.name, staged.sourceUrl, staged.manifestSha256, staged.bundleSha256,
      staged.files[0].sha256, "External workflow", "Local only", "Network", "Protected credential",
      "read_current_source", "external_network", "use_brokered_credential"]) expect(review.textContent).toContain(value);
    expect(installedRow.textContent).toContain("Disabled");
    expect(buttonNamed(installedRow, "Export: Installed external")).toBeTruthy();
    expect(buttonNamed(installedRow, "Uninstall: Installed external")).toBeTruthy();
    await act(async () => { buttonNamed(page, "Install Skill").click(); await settle(dom); await settle(dom); });
    expect(installStaged).toHaveBeenCalledWith(expect.objectContaining({
      stagingId: staged.stagingId, manifestSha256: staged.manifestSha256,
      bundleSha256: staged.bundleSha256, expectedRegistryRevision: 9, enabled: false
    }));
    expect(page.querySelector('[data-skill-id="staged-external"]')?.textContent).toContain("Disabled");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("enables only the authoritative supported External/Web Skill projection", async () => {
    const dom = createDom();
    const vaultId = "vault_20260729_externalwebenable";
    const runtime = { adapter: "pige_readonly_https_v1" as const, origin: "https://api.example.com" as const };
    const external = {
      id: "supported-external", name: "Supported external", version: "1.0.0",
      description: "Reads one reviewed HTTPS origin.", scope: "machine_local" as const,
      kind: "external_web" as const, enabled: false, trust: "user_confirmed" as const,
      capabilities: ["read_current_source", "external_network"] as const,
      dataBoundaries: ["local", "network"] as const, canEnable: true,
      canUninstall: true, canExport: true, canUpdate: false, source: "https" as const,
      sourceUrl: "https://example.com/supported/SKILL.md" as const, runtime,
      manifestSha256: `sha256:${"a".repeat(64)}` as const,
      bundleSha256: `sha256:${"b".repeat(64)}` as const,
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 1024, sha256: `sha256:${"a".repeat(64)}` as const }],
      warnings: ["untrusted_remote_source" as const]
    };
    const unsupported = { ...external, id: "unsupported-external", name: "Unsupported external",
      runtime: undefined, canEnable: false };
    const initial = skillRegistry(14, false, 0, [external, unsupported]);
    const committed = skillRegistry(15, false, 0, [{ ...external, enabled: true, canEnable: false }, unsupported]);
    const enable = vi.fn(async (request: SkillEnableRequest): Promise<SkillLifecycleMutationResult> => ({
      apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId,
      scope: request.scope, skillId: request.skillId, status: "committed", registry: committed
    }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      skills: {
        summary: async () => ({ status: "ready" as const, registry: initial }),
        enable, disable: vi.fn(), onChanged: () => () => undefined
      },
      vault: { current: async () => ({ vaultId }) }
    } });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => { root.render(createElement(SkillsSettingsPanel, { t })); await settle(dom); });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const supportedRow = requireElement(page.querySelector<HTMLElement>('[data-skill-id="supported-external"]'));
    const unsupportedRow = requireElement(page.querySelector<HTMLElement>('[data-skill-id="unsupported-external"]'));
    expect(buttonNamed(supportedRow, "Enable: Supported external").disabled).toBe(false);
    expect(unsupportedRow.querySelector('[aria-label="Enable: Unsupported external"]')).toBeNull();
    await act(async () => { buttonNamed(supportedRow, "Enable: Supported external").click(); await settle(dom); await settle(dom); });
    expect(enable).toHaveBeenCalledWith({
      apiVersion: 1, requestId: expect.stringMatching(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u),
      activeVaultId: vaultId, scope: "machine_local", skillId: external.id, expectedRegistryRevision: 14
    });
    expect(supportedRow.textContent).toContain("Enabled");
    expect(unsupportedRow.textContent).toContain("Disabled");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not replace or refocus a locally staged Skill when the chat query settles later", async () => {
    const dom = createDom();
    const vaultId = "vault_20260729_skillchatfence";
    const summary = {
      stagingId: "skillstage_abcdef0123456789abcdef0123456789" as const,
      manifestSha256: `sha256:${"a".repeat(64)}` as const,
      bundleSha256: `sha256:${"b".repeat(64)}` as const,
      registryRevision: 8, expiresAt: "2026-07-29T12:00:00.000Z",
      sourceUrl: "https://example.com/local/SKILL.md" as const,
      id: "local-review", name: "Local review", version: "1.0.0", description: "Local staged review.",
      scope: "machine_local" as const, kind: "pure" as const,
      capabilities: ["read_current_source" as const], dataBoundaries: ["local" as const],
      files: [{ relativePath: "SKILL.md" as const, utf8ByteSize: 512, sha256: `sha256:${"c".repeat(64)}` as const }],
      warnings: ["untrusted_remote_source" as const]
    };
    let resolvePending!: (value: unknown) => void;
    const pendingStagedReviews = vi.fn((request) => new Promise((resolve) => {
      resolvePending = (value) => resolve({ ...request, ...(value as object) });
    }));
    const stageFromUrl = vi.fn(async (request: { requestId: string; activeVaultId: string }) => ({
      requestId: request.requestId, activeVaultId: request.activeVaultId,
      status: "ready" as const, staged: summary
    }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      skills: {
        summary: async () => ({ status: "ready" as const, registry: skillRegistry(8, false, 0, []) }),
        pendingStagedReviews, stageFromUrl, disable: vi.fn(), onChanged: () => () => undefined
      },
      vault: { current: async () => ({ vaultId }) }
    } });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => { root.render(createElement(SkillsSettingsPanel, { t })); await settle(dom); });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    await act(async () => { buttonNamed(page, "Install from link").click(); await settle(dom); });
    await act(async () => {
      inputValue(dom, requireElement(page.querySelector<HTMLInputElement>("#skill-install-url")), summary.sourceUrl);
      await settle(dom);
    });
    await act(async () => { buttonNamed(page, "Review Skill").click(); await settle(dom); });
    const localInstall = buttonNamed(page, "Install Skill");
    localInstall.focus();
    await act(async () => {
      resolvePending({ status: "ready", staged: [{ ...summary, name: "Pending chat review" }] });
      await settle(dom);
    });
    expect(page.textContent).toContain("Local review");
    expect(page.textContent).not.toContain("Pending chat review");
    expect(dom.window.document.activeElement).toBe(localInstall);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fails closed on the body-free Skill Registry failed result and retries to a verified empty state", async () => {
    const dom = createDom();
    const vaultId = "vault_20260729_skillretry";
    const failedQuery: SkillRegistryQueryResult = {
      status: "failed",
      error: {
        code: "skill.registry_unavailable",
        domain: "skill",
        messageKey: "error.generic",
        retryable: true,
        severity: "error",
        userAction: "retry"
      }
    };
    const summary = vi.fn()
      .mockResolvedValueOnce(failedQuery)
      .mockResolvedValueOnce({ status: "ready" as const, registry: skillRegistry(0, false, 0, []) });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary,
          disable: vi.fn(),
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    expect(page.textContent).toContain("Skill Registry unavailable");
    expect(page.textContent).toContain("No inventory state is being inferred.");
    expect(page.textContent).not.toContain("skill.registry_unavailable");

    await act(async () => {
      buttonNamed(page, "Try again").click();
      await settle(dom);
      await settle(dom);
    });
    expect(summary).toHaveBeenCalledTimes(2);
    expect(page.textContent).toContain("No Skills installed");
    expect(page.textContent).toContain("verified machine-local registry contains no installed Skills");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps verified Skill state unchanged for body-free busy and unavailable disable results", async () => {
    const dom = createDom();
    const vaultId = "vault_20260729_skillfailure";
    const registry = skillRegistry(11, true, 0);
    const failedResult = (code: "skill.registry_busy" | "skill.registry_unavailable"): SkillRegistryMutationResult => ({
      status: "failed",
      error: {
        code,
        domain: "skill",
        messageKey: "error.generic",
        retryable: true,
        severity: "error",
        userAction: "retry"
      }
    });
    const disable = vi.fn()
      .mockResolvedValueOnce(failedResult("skill.registry_busy"))
      .mockResolvedValueOnce(failedResult("skill.registry_unavailable"));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        skills: {
          summary: async () => ({ status: "ready" as const, registry }),
          disable,
          onChanged: () => () => undefined
        },
        vault: { current: async () => ({ vaultId }) }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(SkillsSettingsPanel, { t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-skills"));
    const row = requireElement(page.querySelector<HTMLElement>('[data-skill-id="review-notes"]'));

    await act(async () => {
      buttonNamed(row, "Disable: Review notes").click();
      await settle(dom);
    });
    expect(row.textContent).toContain("Enabled");
    expect(page.textContent).toContain("Another Skill Registry change is in progress. Try again.");

    await act(async () => {
      buttonNamed(row, "Disable: Review notes").click();
      await settle(dom);
    });
    expect(row.textContent).toContain("Enabled");
    expect(page.textContent).toContain("Skill Registry could not save this change. Nothing was changed.");
    expect(page.textContent).not.toContain("registry.json");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("installs one exact Pi package through the typed API and adopts the authoritative disabled inventory", async () => {
    const dom = createDom();
    let settleInstall!: (result: PiPackageInstallResult) => void;
    const summary = vi.fn(async () => ({ status: "ready", registry: piPackageRegistry(2) } as const));
    const install = vi.fn((request: PiPackageInstallRequest) => new Promise<PiPackageInstallResult>((resolve) => {
      settleInstall = resolve;
    }));
    const api: PiPackagesApi = {
      summary,
      catalogQuery: emptyPiPackageCatalogQuery,
      install,
      uninstall: vi.fn(),
      update: vi.fn(),
      rollback: vi.fn(),
      setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);

    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });

    const page = dom.window.document.querySelector<HTMLElement>(".settings-packages")!;
    expect(page.getAttribute("aria-labelledby")).toBe("settings-packages-title");
    expect(page.querySelectorAll('[role="group"]')).toHaveLength(3);
    expect(page.textContent).toContain("No Pi packages installed");
    expect(page.querySelector("[data-package-id]")).toBeNull();
    const packageName = requireElement(page.querySelector<HTMLInputElement>("#pi-package-name"));
    const version = requireElement(page.querySelector<HTMLInputElement>("#pi-package-version"));

    await act(async () => {
      inputValue(dom, packageName, "@larksuite/cli");
      inputValue(dom, version, "1.0.77");
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Install").click();
      await settle(dom);
    });
    expect(install).toHaveBeenCalledTimes(1);
    const request = install.mock.calls[0]![0];
    expect(request).toMatchObject({
      apiVersion: 1,
      expectedRegistryRevision: 2,
      packageName: "@larksuite/cli",
      version: "1.0.77"
    });
    expect(request.requestId).toMatch(/^pi_package_request_[a-f0-9]{32}$/u);
    expect(buttonNamed(page, "Waiting for confirmation…").disabled).toBe(true);

    await act(async () => {
      buttonNamed(page, "Waiting for confirmation…").click();
      await settle(dom);
    });
    expect(install).toHaveBeenCalledTimes(1);

    const installed = piPackageRegistry(3, [{
      packageId: "pkg_0123456789abcdef01234567",
      packageName: "@larksuite/cli",
      version: "1.0.77",
      state: "installed_disabled",
      packageTypes: ["extension"],
      dependencyCount: 0,
      enabled: false,
      trust: "community",
      canUpdate: false,
      canRollback: false,
      rollbackTarget: null
    }]);
    await act(async () => {
      settleInstall({
        apiVersion: 1,
        requestId: request.requestId,
        taskId: "pi_package_task_abcdefghijklmnop",
        status: "installed_disabled",
        registry: installed
      });
      await settle(dom);
    });

    const packageRow = requireElement(page.querySelector<HTMLElement>('[data-package-id="pkg_0123456789abcdef01234567"]'));
    expect(packageRow.textContent).toContain("@larksuite/cli");
    expect(packageRow.textContent).toContain("v1.0.77");
    expect(packageRow.textContent).toContain("Installed · Disabled");
    expect(dom.window.document.activeElement).toBe(packageRow);
    expect(packageName.value).toBe("");
    expect(version.value).toBe("");
    expect(page.textContent).not.toMatch(/Enable|Update|Uninstall/u);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("searches the local reviewed package catalog and fills an exact install draft without installing", async () => {
    const dom = createDom();
    const entry = piPackageCatalogEntry();
    const catalogQuery = vi.fn(async (request: PiPackageCatalogQueryRequest): Promise<PiPackageCatalogQueryResult> => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "ready",
      entries: request.query ? [] : [entry],
      total: request.query ? 0 : 1
    }));
    const install = vi.fn();
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(1) }),
      catalogQuery,
      install,
      uninstall: vi.fn(),
      update: vi.fn(),
      rollback: vi.fn(),
      setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });

    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    expect(catalogQuery).toHaveBeenCalledTimes(1);
    expect(catalogQuery.mock.calls[0]![0]).toMatchObject({ apiVersion: 1, query: "" });
    expect(catalogQuery.mock.calls[0]![0].requestId).toMatch(/^pi_package_catalog_request_[a-f0-9]{32}$/u);
    const row = requireElement(page.querySelector<HTMLElement>(`[data-package-catalog-id="${entry.catalogId}"]`));
    expect(row.textContent).toContain(entry.displayName);
    expect(row.textContent).toContain(entry.purpose);
    const details = requireElement(row.querySelector<HTMLDetailsElement>("details"));
    expect(details.open).toBe(false);
    expect(details.textContent).toContain(entry.packageName);
    expect(details.textContent).toContain(entry.integrity);
    expect(details.textContent).toContain("grants no authority");

    await act(async () => {
      buttonNamed(row, "Use exact version").click();
      await settle(dom);
    });
    expect(install).not.toHaveBeenCalled();
    expect(requireElement(page.querySelector<HTMLInputElement>("#pi-package-name")).value).toBe(entry.packageName);
    expect(requireElement(page.querySelector<HTMLInputElement>("#pi-package-version")).value).toBe(entry.version);
    expect(requireElement(page.querySelector<HTMLInputElement>("#pi-package-integrity")).value).toBe(entry.integrity);

    await act(async () => {
      inputValue(dom, requireElement(page.querySelector<HTMLInputElement>("#pi-package-catalog-query")), "source");
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Search").click();
      await settle(dom);
    });
    expect(catalogQuery).toHaveBeenCalledTimes(2);
    expect(catalogQuery.mock.calls[1]![0]).toMatchObject({ apiVersion: 1, query: "source" });
    expect(page.textContent).toContain("No matching reviewed packages");

    await act(async () => {
      inputValue(dom, requireElement(page.querySelector<HTMLInputElement>("#pi-package-name")), "manual-package");
      await settle(dom);
    });
    expect(page.querySelector("#pi-package-integrity")).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps curated catalog failures and retries body-free", async () => {
    const dom = createDom();
    let attempts = 0;
    const catalogQuery = vi.fn(async (request: PiPackageCatalogQueryRequest): Promise<PiPackageCatalogQueryResult> => {
      attempts += 1;
      return attempts === 1
        ? { apiVersion: 1, requestId: request.requestId, status: "failed" }
        : { apiVersion: 1, requestId: request.requestId, status: "ready", entries: [], total: 0 };
    });
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(1) }),
      catalogQuery,
      install: vi.fn(),
      uninstall: vi.fn(),
      update: vi.fn(),
      rollback: vi.fn(),
      setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    expect(page.textContent).toContain("Reviewed catalog unavailable");
    expect(page.textContent).not.toContain("/private/");

    await act(async () => {
      buttonNamed(page, "Try again").click();
      await settle(dom);
    });
    expect(catalogQuery).toHaveBeenCalledTimes(2);
    expect(page.textContent).toContain("No matching reviewed packages");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("retains the exact Pi package draft and existing inventory across stale, denied, and failed results", async () => {
    const dom = createDom();
    const originalPackage = {
      packageId: "pkg_aaaaaaaaaaaaaaaaaaaaaaaa",
      packageName: "existing-package",
      version: "2.0.0",
      state: "installed_disabled" as const,
      packageTypes: ["skill" as const],
      dependencyCount: 0,
      enabled: false as const,
      trust: "community" as const,
      canUpdate: false,
      canRollback: false,
      rollbackTarget: null
    };
    const results: Array<"stale" | "denied" | "failed"> = ["stale", "denied", "failed"];
    const install = vi.fn(async (request: PiPackageInstallRequest): Promise<PiPackageInstallResult> => {
      const status = results.shift()!;
      return {
        apiVersion: 1,
        requestId: request.requestId,
        taskId: "pi_package_task_abcdefghijklmnop",
        status,
        registry: status === "failed"
          ? piPackageRegistry(6, [{ ...originalPackage, packageName: "must-not-replace-existing" }])
          : piPackageRegistry(5, [originalPackage])
      };
    });
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(4, [originalPackage]) }),
      catalogQuery: emptyPiPackageCatalogQuery,
      install,
      uninstall: vi.fn(),
      update: vi.fn(),
      rollback: vi.fn(),
      setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });

    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    const packageName = requireElement(page.querySelector<HTMLInputElement>("#pi-package-name"));
    const version = requireElement(page.querySelector<HTMLInputElement>("#pi-package-version"));
    await act(async () => {
      inputValue(dom, packageName, "new-package");
      inputValue(dom, version, "1.2.3");
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(page, "Install").click();
      await settle(dom);
    });
    expect(page.querySelector('[data-package-registry-revision="5"]')).not.toBeNull();
    expect(page.textContent).toContain("The package registry changed");

    for (const message of [
      "Installation was not approved",
      "Pige could not install this package"
    ]) {
      await act(async () => {
        buttonNamed(page, "Install").click();
        await settle(dom);
      });
      expect(page.textContent).toContain(message);
      expect(packageName.value).toBe("new-package");
      expect(version.value).toBe("1.2.3");
      expect(page.textContent).toContain("existing-package");
      expect(page.textContent).not.toContain("must-not-replace-existing");
    }
    expect(install.mock.calls.map(([request]) => request.expectedRegistryRevision)).toEqual([4, 5, 5]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("inspects an installed Pi package pathlessly and retains verified details on stale refresh", async () => {
    const dom = createDom();
    const item = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "@narumitw/pi-btw", { version: "0.34.0" });
    const initial = piPackageRegistry(7, [item]);
    const results: PiPackageInspectResult[] = [{
      apiVersion: 1,
      requestId: "pi_package_inspect_request_placeholder0000",
      packageId: item.packageId,
      status: "ready",
      registryRevision: 7,
      inspection: {
        packageId: item.packageId,
        packageName: item.packageName,
        version: item.version,
        integrity: "sha512-ycjtInVV9csP+mR3L6gXgPJOsMGQej80ltkqbJhK0Gy3Mc8BgYvPrdQ0HXTFSGeDzr+//V51CYVK9KcgWti+VA==",
        installedAt: "2026-08-02T00:00:00.000Z",
        state: "installed_disabled",
        packageTypes: ["extension"],
        dependencyCount: 0,
        enabled: false,
        pinned: false,
        source: "npm",
        installationTrust: "community",
        integrityStatus: "verified",
        catalogDisclosure: { status: "reviewed", entry: piPackageCatalogEntry() }
      }
    }, {
      apiVersion: 1,
      requestId: "pi_package_inspect_request_placeholder0000",
      packageId: item.packageId,
      status: "stale",
      registry: piPackageRegistry(8, [item])
    }];
    const inspect = vi.fn(async (request: PiPackageInspectRequest): Promise<PiPackageInspectResult> => ({
      ...results.shift()!,
      requestId: request.requestId,
      packageId: request.packageId
    }));
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: initial }),
      catalogQuery: emptyPiPackageCatalogQuery,
      inspect,
      install: vi.fn(), uninstall: vi.fn(), update: vi.fn(), rollback: vi.fn(), setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    const inspectButton = buttonNamed(page, "Inspect");
    await act(async () => {
      inspectButton.focus();
      inspectButton.click();
      await settle(dom);
    });
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({
      expectedRegistryRevision: 7,
      packageId: item.packageId
    }));
    expect(page.textContent).toContain("Installed files and manifest match the recorded package identity.");
    expect(page.textContent).toContain("Matches the reviewed catalog disclosure");
    expect(page.textContent).toContain("MIT");
    expect(page.textContent).not.toMatch(/relativePath|treeHash|manifestHash|\/private\//u);

    await act(async () => {
      inspectButton.click();
      await settle(dom);
    });
    await act(async () => {
      inspectButton.click();
      await settle(dom);
    });
    expect(page.querySelector('[data-package-registry-revision="8"]')).not.toBeNull();
    expect(page.textContent).toContain("Installed files and manifest match the recorded package identity.");
    expect(page.textContent).toContain("The package inventory changed.");
    expect(dom.window.document.activeElement).toBe(inspectButton);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("removes one exact Pi package, serializes the request, and focuses the authoritative inventory", async () => {
    const dom = createDom();
    const firstPackage = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "first-package");
    const secondPackage = piPackage("pkg_bbbbbbbbbbbbbbbbbbbbbbbb", "second-package");
    let settleUninstall!: (result: PiPackageUninstallResult) => void;
    const uninstall = vi.fn((_request: PiPackageUninstallRequest) => new Promise<PiPackageUninstallResult>((resolve) => {
      settleUninstall = resolve;
    }));
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(7, [firstPackage, secondPackage]) }),
      catalogQuery: emptyPiPackageCatalogQuery,
      install: vi.fn(),
      uninstall,
      update: vi.fn(),
      rollback: vi.fn(),
      setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    const firstRow = requireElement(page.querySelector<HTMLElement>(`[data-package-id="${firstPackage.packageId}"]`));

    await act(async () => {
      buttonNamed(firstRow, "Remove").click();
      await settle(dom);
    });
    expect(uninstall).toHaveBeenCalledTimes(1);
    const request = uninstall.mock.calls[0]![0];
    expect(request).toMatchObject({
      apiVersion: 1,
      expectedRegistryRevision: 7,
      packageId: firstPackage.packageId
    });
    expect(request.requestId).toMatch(/^pi_package_uninstall_request_[a-f0-9]{32}$/u);
    expect(buttonNamed(firstRow, "Removing…").disabled).toBe(true);
    expect(buttonNamed(page, "Remove").disabled).toBe(true);
    expect(buttonNamed(page, "Install").disabled).toBe(true);

    await act(async () => {
      buttonNamed(firstRow, "Removing…").click();
      await settle(dom);
    });
    expect(uninstall).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleUninstall({
        apiVersion: 1,
        requestId: request.requestId,
        packageId: request.packageId,
        status: "removed",
        registry: piPackageRegistry(8, [secondPackage])
      });
      await settle(dom);
    });
    expect(page.querySelector(`[data-package-id="${firstPackage.packageId}"]`)).toBeNull();
    const secondRemove = requireElement(page.querySelector<HTMLButtonElement>(`[data-package-remove-id="${secondPackage.packageId}"]`));
    expect(dom.window.document.activeElement).toBe(secondRemove);
    expect(page.textContent).toContain("The package was removed.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("restores one exact Pi package recovery candidate and adopts its disabled authoritative row", async () => {
    const dom = createDom();
    const candidate = {
      restoreContextId: `pi_package_restore_context_v1_${"a".repeat(48)}` as const,
      packageId: "pkg_aaaaaaaaaaaaaaaaaaaaaaaa" as const,
      packageName: "restorable-package",
      version: "1.2.3",
      integrity: `sha512-${"A".repeat(86)}==` as const,
      packageTypes: ["extension" as const],
      dependencyCount: 0,
      pinned: true,
      rollbackTarget: { rollbackId: "pi_package_rollback_abcdefghijklmnop" as const, targetVersion: "1.1.0" },
      uninstalledAt: "2026-07-30T00:00:00.000Z",
      canRestore: true as const
    };
    const initial = piPackageRegistry(8, [], [candidate]);
    const restoredRegistry = piPackageRegistry(9, [piPackage(candidate.packageId, candidate.packageName, {
      version: candidate.version,
      pinned: candidate.pinned,
      canUpdate: false,
      canRollback: false,
      rollbackTarget: null
    })]);
    let settleRestore!: (result: PiPackageRestoreResult) => void;
    const restore = vi.fn((_request: PiPackageRestoreRequest) => new Promise<PiPackageRestoreResult>((resolve) => {
      settleRestore = resolve;
    }));
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: initial }),
      catalogQuery: emptyPiPackageCatalogQuery,
      install: vi.fn(),
      uninstall: vi.fn(),
      restore,
      update: vi.fn(),
      rollback: vi.fn(),
      setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    const row = requireElement(page.querySelector<HTMLElement>(`[data-package-restore-context="${candidate.restoreContextId}"]`));
    expect(page.textContent).toContain("Recently removed");
    expect(row.textContent).toContain("Pinned");
    expect(row.textContent).not.toContain(candidate.integrity);

    await act(async () => {
      buttonNamed(row, "Restore").click();
      await settle(dom);
    });
    expect(restore).toHaveBeenCalledOnce();
    const request = restore.mock.calls[0]![0];
    expect(request).toEqual({
      apiVersion: 1,
      requestId: expect.stringMatching(/^pi_package_restore_request_[a-f0-9]{32}$/u),
      expectedRegistryRevision: 8,
      restoreContextId: candidate.restoreContextId,
      packageId: candidate.packageId,
      version: candidate.version,
      integrity: candidate.integrity,
      pinned: true,
      rollbackTarget: candidate.rollbackTarget
    });
    expect(buttonNamed(row, "Restoring…").disabled).toBe(true);
    await act(async () => {
      settleRestore({
        apiVersion: 1,
        requestId: request.requestId,
        restoreContextId: request.restoreContextId,
        packageId: request.packageId,
        version: request.version,
        integrity: request.integrity,
        pinned: request.pinned,
        rollbackTarget: request.rollbackTarget,
        status: "committed",
        registry: restoredRegistry
      });
      await settle(dom);
    });
    expect(page.querySelector(`[data-package-restore-context="${candidate.restoreContextId}"]`)).toBeNull();
    const installed = requireElement(page.querySelector<HTMLElement>(`[data-package-id="${candidate.packageId}"]`));
    expect(installed.textContent).toContain("Installed · Disabled");
    expect(dom.window.document.activeElement).toBe(installed);
    expect(page.textContent).toContain("The package was restored and remains disabled.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adopts stale, denied, and not-found package registries while preserving a calm focus target", async () => {
    const cases = [
      ["stale", "The package registry changed. The latest inventory is shown."],
      ["denied", "Removal was not approved. The latest package inventory is shown."],
      ["not_found", "This package is no longer installed. The latest package inventory is shown."]
    ] as const;
    for (const [status, message] of cases) {
      const dom = createDom();
      const installedPackage = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "kept-package");
      const authoritativePackages = status === "not_found" ? [] : [installedPackage];
      const uninstall = vi.fn(async (request: PiPackageUninstallRequest): Promise<PiPackageUninstallResult> => ({
        apiVersion: 1,
        requestId: request.requestId,
        packageId: request.packageId,
        status,
        registry: piPackageRegistry(10, authoritativePackages)
      }));
      const api: PiPackagesApi = {
        summary: async () => ({ status: "ready", registry: piPackageRegistry(9, [installedPackage]) }),
        catalogQuery: emptyPiPackageCatalogQuery,
        install: vi.fn(),
        uninstall,
        update: vi.fn(),
        rollback: vi.fn(),
        setPinned: vi.fn()
      };
      const root = createRoot(dom.window.document.querySelector("#root")!);
      await act(async () => {
        root.render(createElement(PiPackagesSettingsPanel, { api, t }));
        await settle(dom);
      });
      const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
      await act(async () => {
        buttonNamed(page, "Remove").click();
        await settle(dom);
      });
      expect(page.textContent).toContain(message);
      if (status === "not_found") {
        expect(page.querySelector(`[data-package-id="${installedPackage.packageId}"]`)).toBeNull();
        expect(dom.window.document.activeElement).toBe(page.querySelector("#packages-registry-title"));
      } else {
        expect(page.querySelector('[data-package-registry-revision="10"]')).not.toBeNull();
        const remove = requireElement(page.querySelector<HTMLButtonElement>(`[data-package-remove-id="${installedPackage.packageId}"]`));
        expect(dom.window.document.activeElement).toBe(remove);
      }
      await act(async () => root.unmount());
      dom.window.close();
    }
  });

  it("keeps the current Pi package inventory and focus on failed or mismatched uninstall identity", async () => {
    const dom = createDom();
    const installedPackage = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "kept-package");
    const responses: Array<"failed" | "mismatched"> = ["failed", "mismatched"];
    const uninstall = vi.fn(async (request: PiPackageUninstallRequest): Promise<PiPackageUninstallResult> => {
      const response = responses.shift();
      return {
        apiVersion: 1,
        requestId: response === "mismatched" ? "pi_package_uninstall_request_0000000000000000" : request.requestId,
        packageId: request.packageId,
        status: "failed"
      };
    });
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(12, [installedPackage]) }),
      catalogQuery: emptyPiPackageCatalogQuery,
      install: vi.fn(),
      uninstall,
      update: vi.fn(),
      rollback: vi.fn(),
      setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remove = buttonNamed(page, "Remove");
      await act(async () => {
        remove.click();
        await settle(dom);
      });
      expect(page.querySelector('[data-package-registry-revision="12"]')).not.toBeNull();
      expect(page.textContent).toContain("Pige could not remove this package");
      expect(page.textContent).toContain("kept-package");
      expect(dom.window.document.activeElement).toBe(remove);
    }
    expect(uninstall).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("updates one exact Pi package once and adopts the authoritative disabled inventory", async () => {
    const dom = createDom();
    const installedPackage = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "update-package", { canUpdate: true });
    const targetIntegrity = `sha512-${"B".repeat(86)}==`;
    const rollbackId = "pi_package_rollback_abcdefghijklmnop" as const;
    let settleUpdate!: (result: PiPackageUpdateResult) => void;
    const update = vi.fn((_request: PiPackageUpdateRequest) => new Promise<PiPackageUpdateResult>((resolve) => {
      settleUpdate = resolve;
    }));
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(20, [installedPackage]) }),
      catalogQuery: emptyPiPackageCatalogQuery,
      install: vi.fn(),
      uninstall: vi.fn(),
      update,
      rollback: vi.fn(),
      setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });

    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    const row = requireElement(page.querySelector<HTMLElement>(`[data-package-id="${installedPackage.packageId}"]`));
    const targetVersionInput = requireElement(row.querySelector<HTMLInputElement>(`#pi-package-update-version-${installedPackage.packageId}`));
    const targetIntegrityInput = requireElement(row.querySelector<HTMLInputElement>(`#pi-package-update-integrity-${installedPackage.packageId}`));
    expect(buttonNamed(row, "Update").disabled).toBe(true);
    expect(page.textContent).not.toContain("Roll back");

    await act(async () => {
      inputValue(dom, targetVersionInput, "2.0.0");
      await settle(dom);
    });
    await act(async () => {
      inputValue(dom, targetIntegrityInput, targetIntegrity);
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(row, "Update").click();
      await settle(dom);
    });
    expect(update).toHaveBeenCalledTimes(1);
    const request = update.mock.calls[0]![0];
    expect(request).toMatchObject({
      apiVersion: 1,
      packageId: installedPackage.packageId,
      expectedRegistryRevision: 20,
      targetVersion: "2.0.0",
      targetIntegrity
    });
    expect(request.requestId).toMatch(/^pi_package_update_request_[a-f0-9]{32}$/u);
    expect(buttonNamed(row, "Updating…").disabled).toBe(true);
    await act(async () => {
      buttonNamed(row, "Updating…").click();
      await settle(dom);
    });
    expect(update).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleUpdate({
        apiVersion: 1,
        requestId: request.requestId,
        packageId: request.packageId,
        targetVersion: request.targetVersion,
        targetIntegrity: request.targetIntegrity,
        status: "committed",
        registry: piPackageRegistry(21, [piPackage(installedPackage.packageId, installedPackage.packageName, {
          version: "2.0.0",
          canUpdate: true,
          canRollback: true,
          rollbackTarget: { rollbackId, targetVersion: "1.0.0" }
        })])
      });
      await settle(dom);
    });
    const updatedRow = requireElement(page.querySelector<HTMLElement>(`[data-package-id="${installedPackage.packageId}"]`));
    const clearedVersion = requireElement(updatedRow.querySelector<HTMLInputElement>(`#pi-package-update-version-${installedPackage.packageId}`));
    expect(updatedRow.textContent).toContain("v2.0.0");
    expect(updatedRow.textContent).toContain("Roll back to v1.0.0");
    expect(page.textContent).toContain("The package was updated and remains disabled.");
    expect(page.textContent).not.toContain(rollbackId);
    expect(clearedVersion.value).toBe("");
    expect(requireElement(updatedRow.querySelector<HTMLInputElement>(`#pi-package-update-integrity-${installedPackage.packageId}`)).value).toBe("");
    expect(dom.window.document.activeElement).toBe(clearedVersion);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adopts authoritative update outcomes while preserving failure drafts and fencing mismatched results", async () => {
    const authoritativeCases = [
      ["denied", "Update was not approved"],
      ["stale", "The package registry changed"],
      ["not_found", "This package is no longer installed"]
    ] as const;
    const targetIntegrity = `sha512-${"C".repeat(86)}==`;
    for (const [status, message] of authoritativeCases) {
      const dom = createDom();
      const installedPackage = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "kept-update-package", { canUpdate: true });
      const authoritativePackages = status === "not_found" ? [] : [installedPackage];
      const update = vi.fn(async (request: PiPackageUpdateRequest): Promise<PiPackageUpdateResult> => ({
        apiVersion: 1,
        requestId: request.requestId,
        packageId: request.packageId,
        targetVersion: request.targetVersion,
        targetIntegrity: request.targetIntegrity,
        status,
        registry: piPackageRegistry(31, authoritativePackages)
      }));
      const api: PiPackagesApi = {
        summary: async () => ({ status: "ready", registry: piPackageRegistry(30, [installedPackage]) }),
        catalogQuery: emptyPiPackageCatalogQuery,
        install: vi.fn(),
        uninstall: vi.fn(),
        update,
        rollback: vi.fn(),
        setPinned: vi.fn()
      };
      const root = createRoot(dom.window.document.querySelector("#root")!);
      await act(async () => {
        root.render(createElement(PiPackagesSettingsPanel, { api, t }));
        await settle(dom);
      });
      const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
      const versionInput = requireElement(page.querySelector<HTMLInputElement>(`#pi-package-update-version-${installedPackage.packageId}`));
      const integrityInput = requireElement(page.querySelector<HTMLInputElement>(`#pi-package-update-integrity-${installedPackage.packageId}`));
      await act(async () => {
        inputValue(dom, versionInput, "2.0.0");
        await settle(dom);
      });
      await act(async () => {
        inputValue(dom, integrityInput, targetIntegrity);
        await settle(dom);
      });
      await act(async () => {
        buttonNamed(page, "Update").click();
        await settle(dom);
      });
      expect(page.textContent).toContain(message);
      if (status === "not_found") {
        expect(page.querySelector(`[data-package-id="${installedPackage.packageId}"]`)).toBeNull();
        expect(dom.window.document.activeElement).toBe(page.querySelector("#packages-registry-title"));
      } else {
        expect(page.querySelector('[data-package-registry-revision="31"]')).not.toBeNull();
        const preservedVersion = requireElement(page.querySelector<HTMLInputElement>(`#pi-package-update-version-${installedPackage.packageId}`));
        expect(preservedVersion.value).toBe("2.0.0");
        expect(requireElement(page.querySelector<HTMLInputElement>(`#pi-package-update-integrity-${installedPackage.packageId}`)).value).toBe(targetIntegrity);
        expect(dom.window.document.activeElement).toBe(preservedVersion);
      }
      await act(async () => root.unmount());
      dom.window.close();
    }

    const dom = createDom();
    const installedPackage = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "identity-fenced-package", { canUpdate: true });
    const responses: Array<"failed" | "mismatched"> = ["failed", "mismatched"];
    const update = vi.fn(async (request: PiPackageUpdateRequest): Promise<PiPackageUpdateResult> => {
      const response = responses.shift();
      return response === "failed"
        ? { ...request, status: "failed" }
        : {
            ...request,
            requestId: "pi_package_update_request_0000000000000000",
            status: "committed",
            registry: piPackageRegistry(41, [piPackage(installedPackage.packageId, "must-not-replace", { canUpdate: true })])
          };
    });
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(40, [installedPackage]) }),
      catalogQuery: emptyPiPackageCatalogQuery,
      install: vi.fn(),
      uninstall: vi.fn(),
      update,
      rollback: vi.fn(),
      setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    await act(async () => {
      inputValue(dom, requireElement(page.querySelector<HTMLInputElement>(`#pi-package-update-version-${installedPackage.packageId}`)), "2.0.0");
      await settle(dom);
    });
    await act(async () => {
      inputValue(dom, requireElement(page.querySelector<HTMLInputElement>(`#pi-package-update-integrity-${installedPackage.packageId}`)), targetIntegrity);
      await settle(dom);
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => {
        buttonNamed(page, "Update").click();
        await settle(dom);
      });
      expect(page.textContent).toContain("Pige could not update this package");
      expect(page.textContent).toContain("identity-fenced-package");
      expect(page.textContent).not.toContain("must-not-replace");
      expect(page.querySelector('[data-package-registry-revision="40"]')).not.toBeNull();
      expect(requireElement(page.querySelector<HTMLInputElement>(`#pi-package-update-version-${installedPackage.packageId}`)).value).toBe("2.0.0");
      expect(requireElement(page.querySelector<HTMLInputElement>(`#pi-package-update-integrity-${installedPackage.packageId}`)).value).toBe(targetIntegrity);
    }
    expect(update).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shows only an eligible rollback and sends its opaque identity once", async () => {
    const dom = createDom();
    const rollbackId = "pi_package_rollback_abcdefghijklmnop" as const;
    const installedPackage = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "rollback-package", {
      canRollback: true,
      rollbackTarget: { rollbackId, targetVersion: "0.9.0" }
    });
    let settleRollback!: (result: PiPackageRollbackResult) => void;
    const rollback = vi.fn((_request: PiPackageRollbackRequest) => new Promise<PiPackageRollbackResult>((resolve) => {
      settleRollback = resolve;
    }));
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(50, [installedPackage]) }),
      catalogQuery: emptyPiPackageCatalogQuery,
      install: vi.fn(),
      uninstall: vi.fn(),
      update: vi.fn(),
      rollback,
      setPinned: vi.fn()
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    const row = requireElement(page.querySelector<HTMLElement>(`[data-package-id="${installedPackage.packageId}"]`));
    expect(row.querySelector("[data-package-update-version-id]")).toBeNull();
    expect(row.textContent).toContain("Roll back to v0.9.0");
    expect(page.textContent).not.toContain(rollbackId);

    await act(async () => {
      buttonNamed(row, "Roll back to v0.9.0").click();
      await settle(dom);
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    const request = rollback.mock.calls[0]![0];
    expect(request).toMatchObject({
      apiVersion: 1,
      packageId: installedPackage.packageId,
      expectedRegistryRevision: 50,
      rollbackId,
      targetVersion: "0.9.0"
    });
    expect(request.requestId).toMatch(/^pi_package_rollback_request_[a-f0-9]{32}$/u);
    expect(buttonNamed(row, "Rolling back…").disabled).toBe(true);
    await act(async () => {
      buttonNamed(row, "Rolling back…").click();
      await settle(dom);
    });
    expect(rollback).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleRollback({
        apiVersion: 1,
        requestId: request.requestId,
        packageId: request.packageId,
        rollbackId: request.rollbackId,
        targetVersion: request.targetVersion,
        status: "committed",
        registry: piPackageRegistry(51, [piPackage(installedPackage.packageId, installedPackage.packageName, { version: "0.9.0" })])
      });
      await settle(dom);
    });
    const rolledBackRow = requireElement(page.querySelector<HTMLElement>(`[data-package-id="${installedPackage.packageId}"]`));
    expect(rolledBackRow.textContent).toContain("v0.9.0");
    expect(rolledBackRow.textContent).not.toContain("Roll back");
    expect(page.textContent).toContain("The package was rolled back and remains disabled.");
    expect(page.textContent).not.toContain(rollbackId);
    expect(dom.window.document.activeElement).toBe(rolledBackRow);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("pins and unpins one exact installed Pi package with a synchronous mutation fence", async () => {
    const dom = createDom();
    const rollbackId = "pi_package_rollback_abcdefghijklmnop" as const;
    const installedPackage = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "held-package", {
      canUpdate: true,
      canRollback: true,
      rollbackTarget: { rollbackId, targetVersion: "0.9.0" }
    });
    let settlePin!: (result: PiPackageSetPinnedResult) => void;
    const setPinned = vi.fn((request: PiPackageSetPinnedRequest) => {
      if (request.pinned) {
        return new Promise<PiPackageSetPinnedResult>((resolve) => {
          settlePin = resolve;
        });
      }
      return Promise.resolve({
        apiVersion: 1,
        requestId: request.requestId,
        packageId: request.packageId,
        pinned: false,
        status: "committed" as const,
        registry: piPackageRegistry(62, [piPackage(request.packageId, installedPackage.packageName, {
          version: "1.0.0",
          canUpdate: true
        })])
      });
    });
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(60, [installedPackage]) }),
      catalogQuery: emptyPiPackageCatalogQuery,
      install: vi.fn(),
      uninstall: vi.fn(),
      update: vi.fn(),
      rollback: vi.fn(),
      setPinned
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    const registryList = requireElement(page.querySelector<HTMLElement>(
      '[role="list"][aria-labelledby="packages-registry-title"]'
    ));
    const row = requireElement(page.querySelector<HTMLElement>(`[data-package-id="${installedPackage.packageId}"]`));
    expect(row.getAttribute("role")).toBe("listitem");
    expect(row.getAttribute("aria-posinset")).toBe("1");
    expect(row.getAttribute("aria-setsize")).toBe("1");
    expect(row.getAttribute("data-package-state")).toBe("installed_disabled");
    const pin = buttonNamed(row, "Pin version");
    await act(async () => {
      pin.click();
      pin.click();
      await settle(dom);
    });
    expect(setPinned).toHaveBeenCalledTimes(1);
    expect(registryList.getAttribute("aria-busy")).toBe("true");
    const pinRequest = setPinned.mock.calls[0]![0];
    expect(pinRequest).toMatchObject({
      apiVersion: 1,
      packageId: installedPackage.packageId,
      expectedRegistryRevision: 60,
      pinned: true
    });
    expect(pinRequest.requestId).toMatch(/^pi_package_pin_request_[a-f0-9]{32}$/u);
    expect(buttonNamed(row, "Pinning…").disabled).toBe(true);

    await act(async () => {
      settlePin({
        apiVersion: 1,
        requestId: pinRequest.requestId,
        packageId: pinRequest.packageId,
        pinned: true,
        status: "committed",
        registry: piPackageRegistry(61, [piPackage(installedPackage.packageId, installedPackage.packageName, {
          pinned: true,
          canUpdate: false,
          canRollback: false,
          rollbackTarget: null
        })])
      });
      await settle(dom);
    });
    const pinnedRow = requireElement(page.querySelector<HTMLElement>(`[data-package-id="${installedPackage.packageId}"]`));
    const unpin = buttonNamed(pinnedRow, "Unpin version");
    expect(unpin.getAttribute("aria-pressed")).toBe("true");
    expect(pinnedRow.textContent).toContain("Pinned exact version v1.0.0");
    expect(pinnedRow.querySelector("[data-package-update-version-id]")).toBeNull();
    expect(pinnedRow.querySelector("[data-package-rollback-id]")).toBeNull();
    expect(dom.window.document.activeElement).toBe(unpin);

    await act(async () => {
      unpin.click();
      await settle(dom);
    });
    expect(setPinned).toHaveBeenCalledTimes(2);
    expect(setPinned.mock.calls[1]![0]).toMatchObject({
      packageId: installedPackage.packageId,
      expectedRegistryRevision: 61,
      pinned: false
    });
    const unpinnedRow = requireElement(page.querySelector<HTMLElement>(`[data-package-id="${installedPackage.packageId}"]`));
    expect(buttonNamed(unpinnedRow, "Pin version").getAttribute("aria-pressed")).toBe("false");
    expect(unpinnedRow.textContent).not.toContain("Pinned exact version");
    expect(unpinnedRow.querySelector("[data-package-update-version-id]")).not.toBeNull();
    expect(dom.window.document.activeElement).toBe(buttonNamed(unpinnedRow, "Pin version"));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("enables one reviewed package runtime with exact CAS and restores focus", async () => {
    const dom = createDom();
    const t = (key: string): string => enMessages[key as keyof typeof enMessages] ?? key;
    const installed = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "@narumitw/pi-btw", {
      version: "0.34.0", canEnable: true
    });
    const setEnabled = vi.fn(async (request: PiPackageSetEnabledRequest): Promise<PiPackageSetEnabledResult> => ({
      apiVersion: 1, requestId: request.requestId, packageId: request.packageId, enabled: request.enabled,
      status: "committed", registry: piPackageRegistry(2, [{
        ...installed, state: "installed_enabled", enabled: true, canUpdate: false
      }])
    }));
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(1, [installed]) }),
      catalogQuery: emptyPiPackageCatalogQuery, install: vi.fn(), uninstall: vi.fn(), restore: vi.fn(),
      update: vi.fn(), rollback: vi.fn(), setPinned: vi.fn(), setEnabled
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => { root.render(createElement(PiPackagesSettingsPanel, { api, t })); await settle(dom); });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    const enable = requireElement(page.querySelector<HTMLButtonElement>(`[data-package-runtime-id="${installed.packageId}"]`));
    await act(async () => { enable.click(); enable.click(); await settle(dom); });
    expect(setEnabled).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith(expect.objectContaining({ packageId: installed.packageId,
      expectedRegistryRevision: 1, enabled: true }));
    const disable = requireElement(page.querySelector<HTMLButtonElement>(`[data-package-runtime-id="${installed.packageId}"]`));
    expect(disable.textContent).toBe("Disable");
    expect(disable.getAttribute("aria-pressed")).toBe("true");
    expect(page.querySelector<HTMLButtonElement>(`[data-package-remove-id="${installed.packageId}"]`)?.disabled).toBe(true);
    expect(dom.window.document.activeElement).toBe(disable);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adopts authoritative pin registries and preserves inventory and focus on identity-only failure", async () => {
    const authoritativeCases = [
      ["stale", [piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "authoritative-package")], "The package registry changed"],
      ["not_found", [], "This package is no longer installed"]
    ] as const;
    for (const [status, packages, message] of authoritativeCases) {
      const dom = createDom();
      const installedPackage = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "pin-package");
      const setPinned = vi.fn(async (request: PiPackageSetPinnedRequest): Promise<PiPackageSetPinnedResult> => ({
        apiVersion: 1,
        requestId: request.requestId,
        packageId: request.packageId,
        pinned: request.pinned,
        status,
        registry: piPackageRegistry(71, packages)
      }));
      const api: PiPackagesApi = {
        summary: async () => ({ status: "ready", registry: piPackageRegistry(70, [installedPackage]) }),
        catalogQuery: emptyPiPackageCatalogQuery,
        install: vi.fn(),
        uninstall: vi.fn(),
        update: vi.fn(),
        rollback: vi.fn(),
        setPinned
      };
      const root = createRoot(dom.window.document.querySelector("#root")!);
      await act(async () => {
        root.render(createElement(PiPackagesSettingsPanel, { api, t }));
        await settle(dom);
      });
      const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
      await act(async () => {
        buttonNamed(page, "Pin version").click();
        await settle(dom);
      });
      expect(page.textContent).toContain(message);
      if (status === "not_found") {
        expect(page.querySelector(`[data-package-id="${installedPackage.packageId}"]`)).toBeNull();
        expect(page.textContent).toContain("No Pi packages installed");
        expect(dom.window.document.activeElement).toBe(page.querySelector("#packages-registry-title"));
      } else {
        expect(page.querySelector('[data-package-registry-revision="71"]')).not.toBeNull();
        expect(page.textContent).toContain("authoritative-package");
        expect(page.textContent).not.toContain("pin-package");
        expect(dom.window.document.activeElement).toBe(buttonNamed(page, "Pin version"));
      }
      await act(async () => root.unmount());
      dom.window.close();
    }

    const dom = createDom();
    const installedPackage = piPackage("pkg_aaaaaaaaaaaaaaaaaaaaaaaa", "kept-pin-package");
    const setPinned = vi.fn(async (request: PiPackageSetPinnedRequest): Promise<PiPackageSetPinnedResult> => ({
      apiVersion: 1,
      requestId: request.requestId,
      packageId: request.packageId,
      pinned: request.pinned,
      status: "failed"
    }));
    const api: PiPackagesApi = {
      summary: async () => ({ status: "ready", registry: piPackageRegistry(80, [installedPackage]) }),
      catalogQuery: emptyPiPackageCatalogQuery,
      install: vi.fn(),
      uninstall: vi.fn(),
      update: vi.fn(),
      rollback: vi.fn(),
      setPinned
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PiPackagesSettingsPanel, { api, t }));
      await settle(dom);
    });
    const page = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-packages"));
    const pin = buttonNamed(page, "Pin version");
    await act(async () => {
      pin.click();
      await settle(dom);
    });
    expect(page.querySelector('[data-package-registry-revision="80"]')).not.toBeNull();
    expect(page.textContent).toContain("kept-pin-package");
    expect(page.textContent).toContain("Pige could not change the version hold");
    expect(dom.window.document.activeElement).toBe(pin);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("binds real redacted diagnostics and support preview on its own page", async () => {
    const dom = createDom();
    const refreshDiagnostics = vi.fn(async () => undefined);
    const workflow = {
      apiVersion: 1 as const,
      revision: 7,
      scopeContextId: `diagctx_${"a".repeat(48)}`,
      activeVaultId: "vault_20260730_diagnostics",
      localOnly: true as const,
      ownedArtifactCount: 0,
      job: {
        jobId: "job_20260730_revealsupport1",
        state: "completed" as const,
        progress: { completedUnits: 3, totalUnits: 3, percent: 100, messageKey: "diagnostics.support.completed" },
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:01.000Z",
        canCancel: false,
        canRetry: false,
        canReveal: true,
        repairAction: "clear" as const
      },
      eventSelection: {
        revision: `diagevents_${"c".repeat(64)}`,
        events: [{
          eventId: `diagevent_${"d".repeat(32)}`,
          recordedAt: "2026-07-16T00:00:00.000Z",
          level: "warning" as const,
          code: "jobs.resume_failed",
          redactedDetailCount: 1
        }]
      }
    };
    let echoOptionalCategories = true;
    const revealSupportBundle = vi.fn(async (request: {
      apiVersion: 1;
      requestId: string;
      jobId: string;
      scopeContextId: string;
      expectedRevision: number;
    }) => ({ ...request, status: "revealed" as const, workflow }));
    const previewSupportBundle = vi.fn(async (request: {
      apiVersion: 1;
      requestId: string;
      eventSelectionRevision: string;
      selectedDiagnosticEventIds: readonly string[];
      optionalCategories?: readonly ("provider_metadata" | "private_excerpt")[];
      privateExcerpt?: string;
    }) => ({
      ...request,
      previewId: `supportpreview_${"b".repeat(48)}`,
      generatedAt: "2026-07-16T00:00:00.000Z",
      localOnly: true as const,
      estimatedBytes: 2048,
      scopeContextId: workflow.scopeContextId,
      expectedRevision: workflow.revision,
      activeVaultId: workflow.activeVaultId,
      eventSelectionRevision: request.eventSelectionRevision,
      selectedDiagnosticEventIds: request.selectedDiagnosticEventIds,
      selectedDiagnosticEvents: request.selectedDiagnosticEventIds.map((eventId) => ({
        ...workflow.eventSelection.events.find((event) => event.eventId === eventId)!
      })),
      selectedOptionalCategories: echoOptionalCategories ? request.optionalCategories ?? [] : [],
      ...(request.optionalCategories?.includes("private_excerpt") ? {
        reviewedPrivateExcerpt: { text: "Contact [REDACTED_EMAIL]", redactionApplied: true }
      } : {}),
      includedCategories: [{ id: "app_runtime", label: "/private/raw-label", included: true, reason: "private body" }],
      excludedCategories: [{ id: "content", label: "RAW CONTENT", included: false, reason: "excluded" }],
      privacyWarnings: [
        "The bundle is created locally and is not uploaded automatically.",
        "Paths, emails, and common secret patterns are redacted by default.",
        "Review the preview before exporting."
      ]
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        diagnostics: {
          workflowSummary: vi.fn(async () => workflow),
          recentErrors: vi.fn(async () => ({
            apiVersion: 1 as const,
            requestId: "diagrecentreq_abcdefghijklmnop",
            checkedAt: "2026-07-16T00:00:00.000Z",
            localOnly: true as const,
            eventSelectionRevision: workflow.eventSelection.revision,
            errors: []
          })),
          previewSupportBundle,
          exportSupportBundle: vi.fn(),
          cancelSupportBundleExport: vi.fn(),
          retrySupportBundleExport: vi.fn(),
          revealSupportBundle
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    function Harness(): React.JSX.Element {
      const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewSupportBundle>> | null>(null);
      return createElement(SystemSettingsPanel, {
        surface: "diagnostics",
        locale: "en",
        diagnosticsHealth: {
          status: "ok",
          checkedAt: "2026-07-16T00:00:00.000Z",
          localOnly: true,
          recentErrorCount: 0,
          checks: []
        },
        supportBundlePreview: preview,
        onRefreshDiagnostics: refreshDiagnostics,
        onSupportBundlePreviewChange: setPreview,
        t
      });
    }

    await act(async () => {
      root.render(createElement(Harness));
      await settle(dom);
    });
    const panel = dom.window.document.querySelector<HTMLElement>(".settings-system-page")!;
    expect(panel.querySelector("h1")?.textContent).toBe("Diagnostics");
    expect(panel.textContent).not.toContain("Check for updates");
    expect(buttonNamed(panel, "Clear…").disabled).toBe(true);
    expect(buttonNamed(panel, "Show in folder")).not.toBeNull();
    const revealButton = buttonNamed(panel, "Show in folder");
    revealButton.focus();
    await act(async () => {
      revealButton.click();
      revealButton.click();
      await settle(dom);
    });
    expect(revealSupportBundle).toHaveBeenCalledOnce();
    expect(revealSupportBundle).toHaveBeenCalledWith(expect.objectContaining({
      jobId: workflow.job.jobId,
      scopeContextId: workflow.scopeContextId,
      expectedRevision: workflow.revision
    }));
    expect(dom.window.document.activeElement).toBe(buttonNamed(panel, "Show in folder"));
    const providerMetadata = requireElement(panel.querySelector<HTMLInputElement>('input[aria-label="Include provider metadata"]'));
    const privateExcerptToggle = requireElement(panel.querySelector<HTMLInputElement>('input[aria-label="Include a private excerpt"]'));
    expect(providerMetadata.checked).toBe(false);
    expect(privateExcerptToggle.checked).toBe(false);
    expect(buttonNamed(panel, "Preview and export…").disabled).toBe(true);
    const eventSelection = requireElement(panel.querySelector<HTMLElement>("[data-diagnostics-event-selection]"));
    const diagnosticEvent = requireElement(eventSelection.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    expect(eventSelection.textContent).not.toContain("private body");
    await act(async () => {
      diagnosticEvent.click();
      await settle(dom);
    });
    expect(diagnosticEvent.checked).toBe(true);

    await act(async () => {
      providerMetadata.click();
      await settle(dom);
    });
    await act(async () => {
      requireElement(panel.querySelector<HTMLInputElement>('input[aria-label="Include a private excerpt"]')).click();
      await settle(dom);
    });
    const privateExcerptInput = requireElement(panel.querySelector<HTMLTextAreaElement>('textarea[aria-label="Private support excerpt"]'));
    await act(async () => {
      textareaValue(dom, privateExcerptInput, "Contact alice@example.test");
      privateExcerptInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await settle(dom);
    });
    expect(privateExcerptInput.value).toBe("Contact alice@example.test");
    expect(buttonNamed(panel, "Preview and export…").disabled).toBe(false);

    await act(async () => {
      buttonNamed(panel, "Refresh").click();
      await settle(dom);
    });
    expect(refreshDiagnostics).toHaveBeenCalledOnce();

    await act(async () => {
      buttonNamed(panel, "Preview and export…").click();
      await settle(dom);
    });
    expect(previewSupportBundle).toHaveBeenCalledOnce();
    expect(previewSupportBundle).toHaveBeenCalledWith(expect.objectContaining({
      eventSelectionRevision: workflow.eventSelection.revision,
      selectedDiagnosticEventIds: [workflow.eventSelection.events[0]!.eventId],
      optionalCategories: ["provider_metadata", "private_excerpt"],
      privateExcerpt: "Contact alice@example.test"
    }));
    expect(panel.textContent).toContain("Preview ready");
    expect(panel.textContent).toContain("App and platform");
    expect(panel.textContent).toContain("Private knowledge content");
    expect(panel.textContent).toContain("The bundle is created locally and is never uploaded automatically.");
    expect(buttonNamed(panel, "Export Support Bundle").disabled).toBe(false);
    expect(panel.textContent).not.toContain("/private/raw-label");
    expect(panel.textContent).not.toContain("private body");
    expect(panel.textContent).not.toContain("RAW CONTENT");
    const supportPreview = requireElement(panel.querySelector<HTMLElement>(".system-support-preview"));
    expect(supportPreview.textContent).toContain("Contact [REDACTED_EMAIL]");
    expect(supportPreview.textContent).not.toContain("alice@example.test");

    await act(async () => {
      providerMetadata.click();
      await settle(dom);
    });
    expect(panel.textContent).not.toContain("Preview ready");

    await act(async () => {
      providerMetadata.click();
      await settle(dom);
    });
    echoOptionalCategories = false;
    await act(async () => {
      buttonNamed(panel, "Preview and export…").click();
      await settle(dom);
    });
    expect(panel.textContent).toContain("Pige could not prepare a safe support bundle preview.");
    expect(panel.textContent).not.toContain("Preview ready");
    expect(dom.window.document.activeElement).toBe(buttonNamed(panel, "Preview and export…"));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reconnects a failed support Job through the Main picker and retains the action on stale", async () => {
    const dom = createDom();
    const workflow = {
      apiVersion: 1 as const,
      revision: 7,
      scopeContextId: `diagctx_${"a".repeat(48)}`,
      activeVaultId: "vault_20260730_diagnostics",
      localOnly: true as const,
      ownedArtifactCount: 0,
      job: {
        jobId: "job_20260808_supportrepair01",
        state: "failed_retryable" as const,
        progress: { completedUnits: 1, totalUnits: 3, percent: 33, messageKey: "diagnostics.support.failed" },
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:01.000Z",
        canCancel: false,
        canRetry: false,
        canReveal: false,
        repairAction: "choose_destination" as const
      }
    };
    let release!: (result: unknown) => void;
    const reconnectSupportBundleDestination = vi.fn((request: { requestId: string }) => new Promise((resolve) => {
      release = () => resolve({ ...request, status: "stale" as const, workflow });
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        diagnostics: {
          workflowSummary: vi.fn(async () => workflow),
          recentErrors: vi.fn(async () => ({
            apiVersion: 1 as const,
            requestId: "diagrecentreq_abcdefghijklmnop",
            checkedAt: "2026-08-08T00:00:00.000Z",
            localOnly: true as const,
            errors: []
          })),
          previewSupportBundle: vi.fn(),
          exportSupportBundle: vi.fn(),
          cancelSupportBundleExport: vi.fn(),
          retrySupportBundleExport: vi.fn(),
          revealSupportBundle: vi.fn(),
          reconnectSupportBundleDestination
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SystemSettingsPanel, {
        surface: "diagnostics",
        locale: "en",
        diagnosticsHealth: { status: "ok", checkedAt: "2026-08-08T00:00:00.000Z", localOnly: true, recentErrorCount: 0, checks: [] },
        supportBundlePreview: null,
        onRefreshDiagnostics: async () => undefined,
        onSupportBundlePreviewChange: vi.fn(),
        t
      }));
      await settle(dom);
    });
    const panel = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-system-page"));
    const repair = buttonNamed(panel, "Choose a new destination");
    repair.focus();
    await act(async () => {
      repair.click();
      repair.click();
      await settle(dom);
    });
    expect(reconnectSupportBundleDestination).toHaveBeenCalledOnce();
    expect(reconnectSupportBundleDestination).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultId: workflow.activeVaultId,
      jobId: workflow.job!.jobId,
      scopeContextId: workflow.scopeContextId,
      expectedRevision: workflow.revision
    }));
    expect(repair.disabled).toBe(true);
    await act(async () => {
      release({});
      await settle(dom);
      await settle(dom);
    });
    expect(panel.textContent).toContain("Diagnostics changed. The latest local status is shown.");
    expect(buttonNamed(panel, "Choose a new destination")).not.toBeNull();
    expect(dom.window.document.activeElement).toBe(buttonNamed(panel, "Choose a new destination"));
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("confirms diagnostics clearing once, preserves state on cancel or failure, and refreshes authoritative health on success", async () => {
    const dom = createDom();
    const refreshDiagnostics = vi.fn(async () => undefined);
    const clearDiagnostics = vi.fn<() => Promise<DiagnosticsClearLocalResult>>()
      .mockResolvedValueOnce({
        apiVersion: 1,
        requestId: "diagclearreq_aaaaaaaaaaaaaaaa",
        scopeContextId: `diagctx_${"a".repeat(48)}`,
        expectedRevision: 2,
        status: "failed"
      })
      .mockResolvedValueOnce({
        apiVersion: 1,
        requestId: "diagclearreq_bbbbbbbbbbbbbbbb",
        scopeContextId: `diagctx_${"a".repeat(48)}`,
        expectedRevision: 2,
        status: "cleared",
        health: {
          status: "degraded",
          checkedAt: "2026-07-29T00:01:00.000Z",
          localOnly: true,
          recentErrorCount: 0,
          checks: []
        },
        workflow: {
          apiVersion: 1,
          revision: 3,
          scopeContextId: `diagctx_${"a".repeat(48)}`,
          activeVaultId: "vault_20260730_diagnostics",
          localOnly: true,
          ownedArtifactCount: 1
        },
        clearedArtifactCount: 2
      });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        diagnostics: {
          workflowSummary: vi.fn(async () => ({
            apiVersion: 1, revision: 2, scopeContextId: `diagctx_${"a".repeat(48)}`,
            activeVaultId: "vault_20260730_diagnostics", localOnly: true, ownedArtifactCount: 3
          })),
          previewSupportBundle: vi.fn(),
          exportSupportBundle: vi.fn(),
          cancelSupportBundleExport: vi.fn(),
          retrySupportBundleExport: vi.fn(),
          revealSupportBundle: vi.fn()
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);

    function Harness(): React.JSX.Element {
      const [health, setHealth] = useState<import("@pige/contracts").DiagnosticsHealth>({
        status: "ok",
        checkedAt: "2026-07-29T00:00:00.000Z",
        localOnly: true,
        recentErrorCount: 0,
        checks: []
      });
      return createElement(SystemSettingsPanel, {
        surface: "diagnostics",
        locale: "en",
        diagnosticsHealth: health,
        supportBundlePreview: null,
        onRefreshDiagnostics: refreshDiagnostics,
        onClearDiagnostics: async () => {
          const result = await clearDiagnostics();
          if (result.status === "cleared" || result.status === "busy") setHealth(result.health);
          return result;
        },
        onSupportBundlePreviewChange: vi.fn(),
        t
      });
    }

    await act(async () => {
      root.render(createElement(Harness));
      await settle(dom);
    });
    const panel = requireElement(dom.window.document.querySelector<HTMLElement>(".settings-system-page"));
    const clearTrigger = buttonNamed(panel, "Clear…");

    await act(async () => {
      clearTrigger.click();
      await settle(dom);
    });
    expect(panel.textContent).toContain("Clear local diagnostics?");
    expect(dom.window.document.activeElement).toBe(buttonNamed(panel, "Cancel"));

    await act(async () => {
      buttonNamed(panel, "Cancel").click();
      await settle(dom);
    });
    expect(clearDiagnostics).not.toHaveBeenCalled();
    expect(panel.textContent).toContain("Healthy");
    expect(dom.window.document.activeElement).toBe(clearTrigger);

    await act(async () => {
      clearTrigger.click();
      await settle(dom);
      const confirm = buttonNamed(panel, "Clear diagnostics");
      confirm.click();
      confirm.click();
      await settle(dom);
    });
    expect(clearDiagnostics).toHaveBeenCalledOnce();
    expect(refreshDiagnostics).not.toHaveBeenCalled();
    expect(panel.textContent).toContain("Pige could not clear local diagnostics. Nothing else was changed.");
    expect(panel.textContent).toContain("Healthy");
    expect(dom.window.document.activeElement).toBe(clearTrigger);

    await act(async () => {
      clearTrigger.click();
      await settle(dom);
      buttonNamed(panel, "Clear diagnostics").click();
      await settle(dom);
    });
    expect(clearDiagnostics).toHaveBeenCalledTimes(2);
    expect(refreshDiagnostics).not.toHaveBeenCalled();
    expect(panel.textContent).toContain("Local diagnostics were cleared.");
    expect(panel.textContent).toContain("Needs attention");
    expect(dom.window.document.activeElement).toBe(clearTrigger);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("binds explicit signed update download and restart with exact identity and revision fences", async () => {
    const dom = createDom();
    let statusListener: ((event: {
      apiVersion: 1;
      requestId: string;
      sequence: number;
      summary: import("@pige/contracts").UpdateSummary;
    }) => void) | undefined;
    const unsubscribe = vi.fn();
    let resolveCheck: ((result: import("@pige/contracts").UpdateCheckResult) => void) | undefined;
    const check = vi.fn((request: import("@pige/contracts").UpdateCheckRequest) =>
      new Promise<import("@pige/contracts").UpdateCheckResult>((resolve) => {
        resolveCheck = resolve;
      })
    );
    let resolveDownload: ((result: import("@pige/contracts").UpdateDownloadResult) => void) | undefined;
    const download = vi.fn((request: import("@pige/contracts").UpdateDownloadRequest) =>
      new Promise<import("@pige/contracts").UpdateDownloadResult>((resolve) => {
        resolveDownload = resolve;
      })
    );
    const applyResolvers: Array<(result: import("@pige/contracts").UpdateApplyResult) => void> = [];
    const apply = vi.fn((request: import("@pige/contracts").UpdateApplyRequest) =>
      new Promise<import("@pige/contracts").UpdateApplyResult>((resolve) => {
        applyResolvers.push(resolve);
      })
    );
    const openManualDownload = vi.fn(async (request: import("@pige/contracts").UpdateManualDownloadRequest) =>
      ({ ...request, status: "opened" as const })
    );
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        updates: {
          summary: vi.fn(async () => ({
            apiVersion: 1 as const,
            revision: 2,
            channel: "alpha" as const,
            capability: "packaged_ready" as const,
            currentVersion: "0.1.0",
            phase: "idle" as const
          })),
          check,
          download,
          apply,
          openManualDownload,
          onStatusChanged: vi.fn((listener: typeof statusListener) => {
            statusListener = listener;
            return unsubscribe;
          })
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SystemSettingsPanel, {
        surface: "updates",
        locale: "en",
        diagnosticsHealth: null,
        supportBundlePreview: null,
        onRefreshDiagnostics: async () => undefined,
        onSupportBundlePreviewChange: vi.fn(),
        t
      }));
      await settle(dom);
    });
    const panel = dom.window.document.querySelector<HTMLElement>(".settings-updates-page")!;
    expect(panel.querySelector("h1")?.textContent).toBe("Updates");
    expect(panel.textContent).not.toContain("Support bundle");
    expect(panel.textContent).toContain("0.1.0");
    expect(panel.textContent).toContain("Not checked yet");
    const manualDownload = buttonNamed(panel, "Open downloads");
    expect(manualDownload.disabled).toBe(false);
    await act(async () => { manualDownload.click(); await settle(dom); await settle(dom); });
    expect(openManualDownload).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^updatemanualreq_[a-z0-9]{32}$/u)
    });

    await act(async () => {
      buttonNamed(panel, "Check for updates").click();
      buttonNamed(panel, "Check for updates").click();
    });
    expect(check).toHaveBeenCalledOnce();
    const request = check.mock.calls[0]?.[0];
    expect(request?.requestId).toMatch(/^updatereq_[a-z0-9]{32}$/);

    await act(async () => {
      statusListener?.({
        apiVersion: 1,
        requestId: request!.requestId,
        sequence: 1,
        summary: {
          apiVersion: 1,
          revision: 2,
          channel: "alpha",
          capability: "packaged_ready",
          currentVersion: "0.1.0",
          phase: "checking"
        }
      });
      await settle(dom);
    });
    expect(buttonNamed(panel, "Checking…").disabled).toBe(true);

    await act(async () => {
      resolveCheck?.({
        status: "checked",
        requestId: request!.requestId,
        summary: {
          apiVersion: 1,
          revision: 3,
          channel: "alpha",
          capability: "packaged_ready",
          currentVersion: "0.1.0",
          phase: "available",
          availableVersion: "0.2.0",
          checkedAt: "2026-07-19T08:00:00.000Z"
        }
      });
      await settle(dom);
    });
    expect(panel.textContent).toContain("0.2.0");
    expect(buttonNamed(panel, "Download update").disabled).toBe(false);

    await act(async () => {
      buttonNamed(panel, "Download update").click();
      buttonNamed(panel, "Download update").click();
    });
    expect(download).toHaveBeenCalledOnce();
    const downloadRequest = download.mock.calls[0]![0];
    expect(downloadRequest).toMatchObject({
      apiVersion: 1,
      expectedRevision: 3,
      version: "0.2.0"
    });
    expect(downloadRequest.requestId).toMatch(/^updatedownloadreq_[a-z0-9]{32}$/);

    await act(async () => {
      statusListener?.({
        apiVersion: 1,
        requestId: downloadRequest.requestId,
        sequence: 2,
        summary: {
          apiVersion: 1,
          revision: 4,
          channel: "alpha",
          capability: "packaged_ready",
          currentVersion: "0.1.0",
          phase: "downloading",
          availableVersion: "0.2.0",
          progressPercent: 42,
          checkedAt: "2026-07-19T08:00:00.000Z"
        }
      });
      resolveDownload?.({
        status: "started",
        requestId: downloadRequest.requestId,
        version: "0.2.0",
        summary: {
          apiVersion: 1,
          revision: 3,
          channel: "alpha",
          capability: "packaged_ready",
          currentVersion: "0.1.0",
          phase: "available",
          availableVersion: "0.2.0",
          checkedAt: "2026-07-19T08:00:00.000Z"
        }
      });
      await settle(dom);
    });
    expect(panel.textContent).toContain("42%");
    expect(buttonNamed(panel, "Downloading…").disabled).toBe(true);

    await act(async () => {
      statusListener?.({
        apiVersion: 1,
        requestId: downloadRequest.requestId,
        sequence: 3,
        summary: {
          apiVersion: 1,
          revision: 5,
          channel: "alpha",
          capability: "packaged_ready",
          currentVersion: "0.1.0",
          phase: "ready_to_restart",
          availableVersion: "0.2.0",
          checkedAt: "2026-07-19T08:00:00.000Z",
          readyAt: "2026-07-19T08:01:00.000Z"
        }
      });
      await settle(dom);
    });
    expect(buttonNamed(panel, "Restart and update").disabled).toBe(false);

    await act(async () => {
      buttonNamed(panel, "Restart and update").click();
      buttonNamed(panel, "Restart and update").click();
    });
    expect(apply).toHaveBeenCalledOnce();
    const applyRequest = apply.mock.calls[0]![0];
    expect(applyRequest).toMatchObject({ apiVersion: 1, expectedRevision: 5, version: "0.2.0" });
    expect(applyRequest.requestId).toMatch(/^updateapplyreq_[a-z0-9]{32}$/);
    await act(async () => {
      applyResolvers.shift()?.({
        status: "blocked",
        requestId: applyRequest.requestId,
        version: "0.2.0",
        summary: {
          apiVersion: 1,
          revision: 5,
          channel: "alpha",
          capability: "packaged_ready",
          currentVersion: "0.1.0",
          phase: "ready_to_restart",
          availableVersion: "0.2.0",
          checkedAt: "2026-07-19T08:00:00.000Z",
          readyAt: "2026-07-19T08:01:00.000Z"
        }
      });
      await settle(dom);
    });
    expect(panel.textContent).toContain("downloaded update remains ready");
    expect(buttonNamed(panel, "Restart and update").disabled).toBe(false);

    await act(async () => {
      buttonNamed(panel, "Restart and update").click();
    });
    const mismatchedRequest = apply.mock.calls[1]![0];
    await act(async () => {
      applyResolvers.shift()?.({
        status: "restarting",
        requestId: mismatchedRequest.requestId,
        version: "0.3.0",
        summary: {
          apiVersion: 1,
          revision: 6,
          channel: "alpha",
          capability: "packaged_ready",
          currentVersion: "0.1.0",
          phase: "applying",
          availableVersion: "0.3.0",
          checkedAt: "2026-07-19T08:00:00.000Z",
          readyAt: "2026-07-19T08:01:00.000Z"
        }
      } as import("@pige/contracts").UpdateApplyResult);
      await settle(dom);
    });
    expect(buttonNamed(panel, "Restart and update").disabled).toBe(false);

    await act(async () => {
      buttonNamed(panel, "Restart and update").click();
    });
    const staleRequest = apply.mock.calls[2]![0];
    await act(async () => {
      applyResolvers.shift()?.({
        status: "stale",
        requestId: staleRequest.requestId,
        version: "0.2.0",
        summary: {
          apiVersion: 1,
          revision: 6,
          channel: "alpha",
          capability: "packaged_ready",
          currentVersion: "0.1.0",
          phase: "available",
          availableVersion: "0.2.0",
          checkedAt: "2026-07-19T08:02:00.000Z"
        }
      });
      await settle(dom);
    });
    expect(panel.textContent).toContain("Update status changed");
    expect(buttonNamed(panel, "Download update").disabled).toBe(false);

    await act(async () => root.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
    dom.window.close();
  });

  it("shows the real development capability without offering a fake update action", async () => {
    const dom = createDom();
    const check = vi.fn();
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        updates: {
          summary: vi.fn(async () => ({
            apiVersion: 1 as const,
            revision: 0,
            channel: "alpha" as const,
            capability: "development" as const,
            currentVersion: "0.1.0-alpha.1",
            phase: "idle" as const
          })),
          check,
          onStatusChanged: vi.fn(() => () => undefined)
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SystemSettingsPanel, {
        surface: "updates",
        locale: "en",
        diagnosticsHealth: null,
        supportBundlePreview: null,
        onRefreshDiagnostics: async () => undefined,
        onSupportBundlePreviewChange: vi.fn(),
        t
      }));
      await settle(dom);
    });
    const panel = dom.window.document.querySelector<HTMLElement>(".settings-updates-page")!;
    expect(panel.textContent).toContain("Update checking is still in development for this build.");
    expect(buttonNamed(panel, "Check for updates").disabled).toBe(true);
    expect(check).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fails closed when a support preview contains an unreviewed projection", async () => {
    const dom = createDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        diagnostics: {
          workflowSummary: vi.fn(async () => ({
            apiVersion: 1 as const,
            revision: 0,
            scopeContextId: `diagctx_${"a".repeat(48)}`,
            activeVaultId: null,
            localOnly: true as const,
            ownedArtifactCount: 0
          })),
          recentErrors: vi.fn(async () => ({
            apiVersion: 1 as const,
            requestId: "diagrecentreq_abcdefghijklmnop",
            checkedAt: "2026-07-16T00:00:00.000Z",
            localOnly: true as const,
            eventSelectionRevision: `diagevents_${"a".repeat(64)}`,
            errors: []
          })),
          previewSupportBundle: vi.fn(),
          exportSupportBundle: vi.fn(),
          cancelSupportBundleExport: vi.fn()
        }
      }
    });

    await act(async () => {
      root.render(createElement(SystemSettingsPanel, {
        surface: "diagnostics",
        locale: "en",
        diagnosticsHealth: null,
        supportBundlePreview: {
          previewId: "support_unknown",
          generatedAt: "2026-07-16T00:00:00.000Z",
          localOnly: true,
          estimatedBytes: 1024,
          includedCategories: [{ id: "future_private_category", label: "/raw/path", included: true, reason: "raw reason" }],
          excludedCategories: [],
          privacyWarnings: ["raw warning"]
        },
        onRefreshDiagnostics: async () => undefined,
        onSupportBundlePreviewChange: vi.fn(),
        t
      }));
      await settle(dom);
    });

    const panel = dom.window.document.querySelector<HTMLElement>(".settings-system-page")!;
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain("cannot safely describe every preview item");
    expect(buttonNamed(panel, "Export Support Bundle").disabled).toBe(true);
    expect(panel.textContent).not.toContain("/raw/path");
    expect(panel.textContent).not.toContain("raw reason");
    expect(panel.textContent).not.toContain("raw warning");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shows the bounded recovery outcome from an abnormal previous session", async () => {
    const dom = createDom();
    const onReviewRecoveryActivity = vi.fn();
    const onRepairRecoverySources = vi.fn();
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { diagnostics: {
        recentErrors: vi.fn(async () => ({
          apiVersion: 1, requestId: "diagrecentreq_abcdefghijklmnop", checkedAt: "2026-08-01T01:02:00.000Z",
          localOnly: true, eventSelectionRevision: `diagevents_${"a".repeat(64)}`, errors: []
        })), workflowSummary: vi.fn(async () => ({
        apiVersion: 1, revision: 0, scopeContextId: `diagctx_${"a".repeat(48)}`,
        activeVaultId: null, localOnly: true, ownedArtifactCount: 0
      })) } }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(SystemSettingsPanel, {
        surface: "diagnostics", locale: "en", supportBundlePreview: null,
        diagnosticsHealth: {
          status: "degraded", checkedAt: "2026-08-01T01:02:00.000Z", localOnly: true,
          recentErrorCount: 0, checks: [], crashRecovery: {
            recoveryId: `crashrecovery_${"a".repeat(32)}`,
            status: "needs_attention", detectedAt: "2026-08-01T01:00:00.000Z",
            completedAt: "2026-08-01T01:01:00.000Z", capturesPreserved: 2,
            jobsRecovered: 3, jobsNeedRetry: 1, proposalsRecovered: 1, proposalsAwaitingReview: 2,
            sourcesNeedRepair: 1, indexRebuildRunning: false
          }, crashRecoveryHistory: [{
            recoveryId: `crashrecovery_${"a".repeat(32)}`, status: "needs_attention",
            detectedAt: "2026-08-01T01:00:00.000Z", completedAt: "2026-08-01T01:01:00.000Z",
            capturesPreserved: 2, jobsRecovered: 3, jobsNeedRetry: 1, proposalsRecovered: 1,
            proposalsAwaitingReview: 2, sourcesNeedRepair: 0, indexRebuildRunning: false
          }]
        },
        onRefreshDiagnostics: async () => undefined,
        onReviewRecoveryActivity,
        onRepairRecoverySources,
        onSupportBundlePreviewChange: vi.fn(), t
      }));
      await settle(dom);
    });
    const recovery = dom.window.document.querySelector<HTMLElement>('[data-crash-recovery-status="needs_attention"]')!;
    expect(recovery.textContent).toContain("Recovery finished, but some items still need attention.");
    expect(recovery.textContent).toContain("Captures preserved 2");
    expect(recovery.textContent).toContain("Jobs resumed 3");
    expect(recovery.textContent).toContain("Jobs needing retry 1");
    expect(recovery.textContent).toContain("Review activity");
    expect(recovery.textContent).toContain("Repair sources");
    expect(recovery.textContent).not.toContain("job_");
    await act(async () => {
      Array.from(recovery.querySelectorAll("button")).find((button) => button.textContent === "Review activity")?.click();
      Array.from(recovery.querySelectorAll("button")).find((button) => button.textContent === "Repair sources")?.click();
    });
    expect(onReviewRecoveryActivity).toHaveBeenCalledOnce();
    expect(onRepairRecoverySources).toHaveBeenCalledOnce();
    expect(dom.window.document.querySelector("[data-crash-recovery-history]")?.textContent)
      .toContain("Recent startup recoveries");
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("presents connected services and exact high-risk confirmation without standing permission modes", async () => {
    const dom = createDom();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("The Privacy panel must remain a truthful static projection.");
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PermissionsPrivacySettingsPanel, { t }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector("h1")?.textContent).toBe("Permissions & Privacy");
    expect(container.textContent).toContain("Connected model services");
    expect(container.querySelector(".settings-status")?.textContent).toBe("Default policy");
    expect(container.textContent).toContain("Model service");
    expect(container.textContent).toContain(
      "Sending a message sends exactly what you wrote and the selected context to the connected model service."
    );
    expect(container.textContent).toContain(
      "Pige does not classify, redact, or block message content."
    );
    expect(container.textContent).toContain("Uses your connected provider");
    expect(container.textContent).toContain("without a second confirmation dialog");
    expect(container.textContent).toContain("Exact high-risk effects");
    expect(container.textContent).toContain("Confirm each effect");
    expect(container.textContent).toContain("No standing authority");
    expect(container.textContent).toContain("Local app data");
    expect(container.textContent).toContain("protected credential storage when available");
    expect(container.textContent).toContain("On this device");
    expect(container.textContent).not.toContain("Default mode");
    expect(container.textContent).not.toContain("Saved scoped grants");
    expect(container.textContent).not.toContain("YOLO");
    expect(container.textContent).not.toContain("Sensitive content confirms once");
    expect(container.textContent).not.toContain("restricted content never sends");
    expect(container.textContent).not.toContain("Hide obvious secrets before sending");
    expect(container.textContent).not.toContain("Cloud-send controls");
    expect(container.textContent).not.toContain("redaction preference");
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('[data-privacy-control="cloud-policy"]')).toBeNull();
    expect(container.querySelector(".model-egress-prompt")).toBeNull();
    expect(Object.hasOwn(enMessages, "errors.model_provider.output_invalid")).toBe(false);
    expect(Object.hasOwn(enMessages, "errors.agent_runtime.completion_invalid")).toBe(false);
    expect(ipcRead).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("projects Remember Scoped Grants without inferring authority and single-flights revocation", async () => {
    const dom = createDom();
    const initial = {
      apiVersion: 1 as const,
      activeVaultId: "vault_20260729_permissions",
      revision: 1,
      defaultMode: "remember_scoped_grants" as const,
      fullAccess: {
        enabled: false as const,
        canEnable: true,
        hardBoundaries: PERMISSION_YOLO_HARD_BOUNDARIES
      },
      grants: [
        permissionGrant("grant_20260729_abcdefghijklmnop", "Calendar", "Read events"),
        permissionGrant("grant_20260729_qrstuvwxyzabcdef", "Mail", "Draft messages")
      ],
      invalidGrantCount: 0
    };
    let resolveRevoke!: (result: Awaited<ReturnType<PermissionPolicyApi["revokeGrant"]>>) => void;
    const revokeGrant = vi.fn(() => new Promise<Awaited<ReturnType<PermissionPolicyApi["revokeGrant"]>>>((resolve) => {
      resolveRevoke = resolve;
    }));
    const setDefaultMode: PermissionPolicyApi["setDefaultMode"] = vi.fn(async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "committed",
      summary: { ...initial, revision: 3, defaultMode: request.mode, grants: [] }
    }));
    let changedListener: Parameters<PermissionPolicyApi["onChanged"]>[0] | undefined;
    const api: PermissionPolicyApi = {
      summary: vi.fn(async (request) => ({
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        status: "ready",
        summary: initial
      })),
      setDefaultMode,
      revokeGrant,
      onChanged: vi.fn((listener) => {
        changedListener = listener;
        return () => { changedListener = undefined; };
      })
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PermissionsPrivacySettingsPanel, {
        t,
        activeVaultId: initial.activeVaultId,
        api
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Remember scoped grants");
    expect(container.textContent).toContain("Calendar · v1.0.0 · Read events");
    expect(container.textContent).toContain("Mail · v1.0.0 · Draft messages");
    expect(container.textContent).toContain("Full Access");
    expect(container.querySelectorAll(".permission-mode-option")).toHaveLength(3);
    expect(container.textContent).toContain("Ordinary bounded work continues directly.");
    expect(container.textContent).toContain("matching actions continue without asking again");

    const revokeButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) => button.textContent === "Revoke");
    const firstRevoke = revokeButtons[0]!;
    firstRevoke.focus();
    await act(async () => {
      firstRevoke.click();
      firstRevoke.click();
      await settle(dom);
    });
    expect(revokeGrant).toHaveBeenCalledTimes(1);
    expect(revokeGrant).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultId: initial.activeVaultId,
      expectedRevision: 1,
      grantId: "grant_20260729_abcdefghijklmnop"
    }));
    expect(firstRevoke.disabled).toBe(true);

    await act(async () => {
      resolveRevoke({
        apiVersion: 1,
        requestId: "permissionpolicyreq_abcdefghijklmnop",
        activeVaultId: initial.activeVaultId,
        status: "stale",
        summary: { ...initial, revision: 2, grants: [initial.grants[1]!] }
      });
      await settle(dom);
    });
    expect(container.textContent).not.toContain("Calendar · v1.0.0 · Read events");
    expect(container.textContent).toContain("Permissions changed elsewhere. The current settings are shown.");
    await settle(dom);
    await settle(dom);
    expect(dom.window.document.activeElement).toBe(
      container.querySelector<HTMLInputElement>('input[name="privacy-permission-mode"]:checked')
    );

    const ask = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .find((input) => input.parentElement?.textContent?.includes("Ask every time"))!;
    ask.focus();
    await act(async () => {
      ask.click();
      await settle(dom);
    });
    expect(setDefaultMode).toHaveBeenCalledTimes(1);
    expect(setDefaultMode).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultId: initial.activeVaultId,
      expectedRevision: 2,
      mode: "ask_every_time"
    }));
    expect(container.textContent).not.toContain("Mail · v1.0.0 · Draft messages");
    expect(dom.window.document.activeElement).toBe(ask);

    await act(async () => {
      changedListener?.({
        ...initial,
        revision: 4,
        defaultMode: "remember_scoped_grants",
        grants: []
      });
      await settle(dom);
    });
    expect(container.textContent).toContain("Remember scoped grants");
    expect(container.textContent).not.toContain("No saved grants");
    expect(container.textContent).not.toContain("Saved scoped grants");

    await act(async () => {
      changedListener?.({
        ...initial,
        revision: 5,
        grants: [initial.grants[1]!]
      });
      await settle(dom);
    });
    expect(container.textContent).toContain("Mail · v1.0.0 · Draft messages");
    expect(container.textContent).not.toContain("Permissions changed elsewhere");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("requires an explicit Full Access acknowledgement and keeps its hard boundaries visible", async () => {
    const dom = createDom();
    const activeVaultId = "vault_20260729_fullaccess";
    const askSummary = {
      apiVersion: 1 as const,
      activeVaultId,
      revision: 5,
      defaultMode: "ask_every_time" as const,
      fullAccess: {
        enabled: false as const,
        canEnable: true,
        hardBoundaries: PERMISSION_YOLO_HARD_BOUNDARIES
      },
      grants: [],
      invalidGrantCount: 0
    };
    let changedListener: Parameters<PermissionPolicyApi["onChanged"]>[0] | undefined;
    const setDefaultMode: PermissionPolicyApi["setDefaultMode"] = vi.fn(async (request) => (
      request.mode === "yolo_full_access"
        ? {
            apiVersion: 1,
            requestId: request.requestId,
            activeVaultId,
            status: "confirmation_required" as const,
            confirmationId: "confirm_20260729_yolofullaccess1234",
            confirmationRevision: 1,
            summary: askSummary
          }
        : {
            apiVersion: 1,
            requestId: request.requestId,
            activeVaultId,
            status: "committed" as const,
            summary: { ...askSummary, revision: 7 }
          }
    ));
    const api: PermissionPolicyApi = {
      summary: vi.fn(async (request) => ({
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId,
        status: "ready",
        summary: askSummary
      })),
      setDefaultMode,
      revokeGrant: vi.fn(),
      onChanged: vi.fn((listener) => {
        changedListener = listener;
        return () => { changedListener = undefined; };
      })
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(PermissionsPrivacySettingsPanel, { activeVaultId, api, t }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const fullAccessRadio = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .find((input) => input.parentElement?.textContent?.includes("Full Access"))!;
    fullAccessRadio.focus();
    await act(async () => {
      fullAccessRadio.click();
      await settle(dom);
    });
    let dialog = requireElement(container.querySelector<HTMLElement>('[role="alertdialog"]'));
    expect(dialog.textContent).toContain("Turn on Full Access?");
    expect(dialog.textContent).toContain("Permanent deletion");
    expect(dialog.textContent).toContain("Operating system permissions");
    expect(dialog.textContent).toContain("Filesystem confinement and symlink safety");
    expect(dialog.textContent).not.toContain("yolo_full_access");
    const acknowledgement = requireElement(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    await act(async () => settle(dom));
    expect(dom.window.document.activeElement).toBe(acknowledgement);
    expect(buttonNamed(dialog, "Continue to confirmation").disabled).toBe(true);

    await act(async () => {
      dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(dom.window.document.activeElement).toBe(fullAccessRadio);

    await act(async () => {
      fullAccessRadio.click();
      await settle(dom);
    });
    dialog = requireElement(container.querySelector<HTMLElement>('[role="alertdialog"]'));
    const retryAcknowledgement = requireElement(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]'));
    await act(async () => {
      retryAcknowledgement.click();
      await settle(dom);
    });
    const enable = buttonNamed(dialog, "Continue to confirmation");
    await act(async () => {
      enable.click();
      enable.click();
      await settle(dom);
    });
    expect(setDefaultMode).toHaveBeenCalledTimes(1);
    expect(setDefaultMode).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultId,
      expectedRevision: 5,
      mode: "yolo_full_access",
      fullAccessAcknowledgement: {
        kind: "yolo_full_access",
        explicitUserAction: true,
        hardBoundariesAcknowledged: true
      }
    }));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container.textContent).toContain("Review the final Full Access confirmation.");

    await act(async () => {
      changedListener?.({
        ...askSummary,
        revision: 6,
        defaultMode: "yolo_full_access",
        fullAccess: {
          enabled: true,
          enabledAt: "2026-07-29T12:00:00.000Z",
          canDisable: true,
          hardBoundaries: PERMISSION_YOLO_HARD_BOUNDARIES
        }
      });
      await settle(dom);
    });
    expect(container.textContent).toContain("Full Access is on");
    expect(container.textContent).toContain("Still always protected");
    const returnToAsk = buttonNamed(container, "Return to Ask Every Time");
    await act(async () => {
      returnToAsk.click();
      await settle(dom);
      await settle(dom);
    });
    expect(setDefaultMode).toHaveBeenCalledTimes(2);
    expect(setDefaultMode).toHaveBeenLastCalledWith(expect.objectContaining({
      activeVaultId,
      expectedRevision: 6,
      mode: "ask_every_time"
    }));
    expect(setDefaultMode.mock.calls[1]?.[0]).not.toHaveProperty("fullAccessAcknowledgement");
    expect(dom.window.document.activeElement?.getAttribute("name")).toBe("privacy-permission-mode");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("binds the real theme and app language while keeping unfinished language choices honest", async () => {
    const dom = createDom();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("The Appearance panel must use only its provided adapters.");
      }
    });
    let finishLocaleChange: (() => void) | undefined;
    const onLocaleChange = vi.fn(async (locale: string) => {
      if (locale === "fr") await new Promise<void>((resolve) => { finishLocaleChange = resolve; });
      if (locale === "de") throw new Error("raw locale persistence failure /Users/private");
    });
    const onThemeChange = vi.fn(async () => true);
    let finishKnowledgeLanguageChange!: (status: "committed" | "stale" | "failed") => void;
    const onKnowledgeLanguageChange = vi.fn<
      (language: "preserve_source" | "follow_query" | "app_locale") =>
        Promise<"committed" | "stale" | "failed">
    >()
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishKnowledgeLanguageChange = resolve;
      }))
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("committed");
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const renderAppearance = async (
      generatedKnowledgeLanguage: "preserve_source" | "follow_query" | "app_locale"
    ): Promise<void> => {
      await act(async () => {
        root.render(createElement(AppearanceSettingsPanel, {
        locale: "en",
        availableLocales: ["en", "fr", "de"],
        themePreference: "system",
        generatedKnowledgeLanguage,
        themeBusy: false,
        themeError: null,
        onLocaleChange,
        onThemeChange,
        onKnowledgeLanguageChange,
        t
        }));
        await settle(dom);
      });
    };
    await renderAppearance("preserve_source");

    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector("h1")?.textContent).toBe("Appearance & Language");
    const themeGroup = requireElement(container.querySelector<HTMLElement>('[role="radiogroup"]'));
    const themes = Array.from(themeGroup.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(themes).toHaveLength(3);
    expect(themes.map((theme) => theme.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(themes.map((theme) => theme.tabIndex)).toEqual([0, -1, -1]);

    await act(async () => {
      themes[2]!.click();
      themes[0]!.focus();
      themes[0]!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(themes[1]);
    expect(onThemeChange.mock.calls.map(([theme]) => theme)).toEqual(["dark", "light"]);
    expect(themes.map((theme) => theme.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);

    const appLanguage = requireElement(container.querySelector<HTMLSelectElement>('select[aria-label="App language"]'));
    const knowledgeLanguage = requireElement(container.querySelector<HTMLSelectElement>('select[aria-label="Knowledge language"]'));
    expect(knowledgeLanguage.value).toBe("preserve_source");
    expect(Array.from(knowledgeLanguage.options).map((option) => option.value)).toEqual([
      "preserve_source",
      "follow_query",
      "app_locale"
    ]);
    expect(container.textContent).toContain("Source content remains unchanged.");
    expect(container.querySelector('select[aria-label="OCR language hint"]')).toBeNull();
    await act(async () => {
      selectValue(dom, appLanguage, "fr");
      await settle(dom);
    });
    expect(appLanguage.disabled).toBe(true);
    await act(async () => {
      selectValue(dom, appLanguage, "de");
      await settle(dom);
    });
    expect(onLocaleChange.mock.calls.map(([locale]) => locale)).toEqual(["fr"]);
    await act(async () => {
      finishLocaleChange?.();
      await settle(dom);
    });
    expect(appLanguage.disabled).toBe(false);
    expect(onLocaleChange).toHaveBeenCalledWith("fr");
    expect(ipcRead).toBe(false);

    await act(async () => {
      knowledgeLanguage.focus();
      selectValue(dom, knowledgeLanguage, "follow_query");
      selectValue(dom, knowledgeLanguage, "app_locale");
      await settle(dom);
    });
    expect(onKnowledgeLanguageChange).toHaveBeenCalledOnce();
    expect(onKnowledgeLanguageChange).toHaveBeenCalledWith("follow_query");
    expect(knowledgeLanguage.disabled).toBe(true);
    await act(async () => {
      finishKnowledgeLanguageChange("stale");
      await settle(dom);
    });
    await renderAppearance("app_locale");
    expect(knowledgeLanguage.value).toBe("follow_query");
    expect(container.textContent).toContain("Knowledge language changed elsewhere.");
    expect(dom.window.document.activeElement).toBe(knowledgeLanguage);

    await act(async () => {
      selectValue(dom, knowledgeLanguage, "preserve_source");
      await settle(dom);
    });
    await renderAppearance("app_locale");
    expect(onKnowledgeLanguageChange).toHaveBeenCalledTimes(2);
    expect(knowledgeLanguage.value).toBe("preserve_source");
    expect(container.textContent).toContain("Knowledge language could not be changed.");
    expect(dom.window.document.activeElement).toBe(knowledgeLanguage);

    await act(async () => {
      selectValue(dom, knowledgeLanguage, "app_locale");
      await settle(dom);
    });
    expect(onKnowledgeLanguageChange).toHaveBeenCalledTimes(3);
    expect(knowledgeLanguage.value).toBe("app_locale");
    expect(container.querySelector("#appearance-knowledge-language-notice")).toBeNull();
    expect(dom.window.document.activeElement).toBe(knowledgeLanguage);

    await act(async () => {
      selectValue(dom, appLanguage, "de");
      await settle(dom);
    });
    expect(onLocaleChange).toHaveBeenLastCalledWith("de");
    expect(container.querySelector("#appearance-language-error")?.textContent)
      .toBe("Language could not be changed. The current language was kept.");
    expect(appLanguage.getAttribute("aria-describedby"))
      .toBe("appearance-app-language-description appearance-language-error");
    expect(container.querySelector("#appearance-language-error")?.getAttribute("role")).toBe("status");
    expect(appLanguage.disabled).toBe(false);
    expect(container.textContent).not.toContain("raw locale persistence failure");
    expect(container.textContent).not.toContain("/Users/private");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shows real toolchain health without exposing paths and keeps unfinished capability controls local", async () => {
    const dom = createDom();
    let ipcRead = false;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      get() {
        ipcRead = true;
        throw new Error("The capabilities panel must use only its provided adapters.");
      }
    });
    const onRefresh = vi.fn(async () => undefined);
    const onDevelopment = vi.fn();
    let settleFirstReinstall!: (status: "opened" | "stale" | "not_needed" | "failed") => void;
    const onOpenToolchainReinstall = vi.fn<() => Promise<"opened" | "stale" | "not_needed" | "failed">>()
      .mockImplementationOnce(() => new Promise((resolve) => {
        settleFirstReinstall = resolve;
      }))
      .mockResolvedValueOnce("opened");
    const semanticRetrievalApi = semanticAssetApi("ready");
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
        paddleOcrApi: paddleOcrApi("not_installed"),
        semanticRetrievalApi,
        toolchainHealth: {
          status: "needs_repair",
          checkedAt: "2026-07-16T01:00:00.000Z",
          repair: {
            healthId: `toolchain_health_${"a".repeat(64)}`,
            missingRequiredToolIds: ["archive-tools", "pdf-tools"]
          },
          tools: [
            {
              id: "git",
              name: "Git",
              required: true,
              status: "ready",
              resolvedPath: "/private/hidden/bin/git"
            },
            {
              id: "archive-tools",
              name: "Archive tools",
              required: true,
              status: "missing"
            },
            {
              id: "pdf-tools",
              name: "PDF tools",
              required: true,
              status: "missing",
              repairHint: "Install a private dependency from a private path."
            },
            {
              id: "bun",
              name: "Bun",
              required: false,
              status: "missing"
            }
          ]
        },
        speechAvailability: {
          status: "unsupported",
          reason: "assets_unavailable",
          canOpenSystemSettings: false
        },
        speechAvailabilityLoading: false,
        speechAvailabilityFailed: false,
        onRefresh,
        onOpenSpeechSettings: vi.fn(async () => undefined),
        onOpenToolchainReinstall,
        onDevelopment,
        t
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector("h1")?.textContent).toBe("Local Capabilities");
    expect(container.textContent).toContain("Needs repair");
    expect(container.textContent).toContain("Git");
    expect(container.textContent).toContain("Archive tools");
    expect(container.textContent).toContain("PDF tools");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("Missing");
    expect(container.textContent).toContain("Not installed");
    expect(container.querySelector('[aria-label="Bun: Not installed"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="PDF tools: Missing"]')).not.toBeNull();
    expect(container.textContent).not.toContain("/private/hidden/bin/git");
    expect(container.textContent).not.toContain("Install a private dependency");
    expect(container.textContent).toContain("Enabled");
    expect(container.textContent).toContain("Lexical search always remains available.");

    const paddleOcr = requireElement(container.querySelector<HTMLElement>('[data-paddle-ocr-state="not_installed"]'));
    const voice = requireElement(container.querySelector<HTMLElement>('[data-capability-status="voice-input"]'));
    expect(paddleOcr.textContent).toContain("PaddleOCR fallback");
    expect(paddleOcr.textContent).toContain("Not installed");
    expect(paddleOcr.textContent).toContain("Install");
    expect(container.querySelector('[data-capability-control="image-ocr"]')).toBeNull();
    expect(voice.textContent).toBe("Language resource needed");
    expect(container.querySelector('[data-capability-control="voice-input"]')).toBeNull();
    expect(container.querySelector('[data-capability-control="voice-open-settings"]')).toBeNull();
    expect(container.querySelector('select[aria-label="OCR engine"]')).toBeNull();
    expect(container.querySelector('button[role="switch"][aria-label="Image and scanned-page OCR"]')).toBeNull();
    expect(container.querySelector('button[role="switch"][aria-label="Voice input"]')).toBeNull();

    await act(async () => {
      buttonNamed(container, "Check again").click();
      const reinstall = buttonNamed(container, "Open reinstall page");
      reinstall.focus();
      reinstall.click();
      reinstall.click();
      await settle(dom);
    });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onOpenToolchainReinstall).toHaveBeenCalledOnce();
    expect(onOpenToolchainReinstall).toHaveBeenCalledWith();
    expect(buttonNamed(container, "Opening...").hasAttribute("disabled")).toBe(true);
    expect(onDevelopment).not.toHaveBeenCalled();
    expect(voice.textContent).toBe("Language resource needed");
    expect(ipcRead).toBe(false);

    await act(async () => {
      settleFirstReinstall("stale");
      await settle(dom);
    });
    const reinstallAfterFailure = buttonNamed(container, "Open reinstall page");
    expect(container.textContent).toContain("Tool status changed.");
    expect(container.textContent).toContain("Archive tools");
    expect(dom.window.document.activeElement).toBe(reinstallAfterFailure);

    await act(async () => {
      reinstallAfterFailure.click();
      await settle(dom);
    });
    expect(onOpenToolchainReinstall).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Release page opened.");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Open reinstall page"));

    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
        paddleOcrApi: paddleOcrApi("not_installed"),
        semanticRetrievalApi,
        toolchainHealth: {
          status: "ready",
          checkedAt: "2026-07-16T01:01:00.000Z",
          tools: [
            {
              id: "git",
              name: "Git",
              required: true,
              status: "ready"
            },
            {
              id: "bun",
              name: "Bun",
              required: false,
              status: "missing"
            }
          ]
        },
        onRefresh,
        onOpenToolchainReinstall,
        onDevelopment,
        t
      }));
      await settle(dom);
    });
    expect(container.textContent).toContain("Ready");
    expect(container.querySelector('[aria-label="Bun: Not installed"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Missing required tools");
    expect(
      Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Open reinstall page")
    ).toBe(false);
    expect(onOpenToolchainReinstall).toHaveBeenCalledTimes(2);
    expect(ipcRead).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps toolchain repair identity-fenced and leaves health re-probing explicit", () => {
    const appSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/App.tsx"),
      "utf8"
    );
    const repairOwner = appSource.slice(
      appSource.indexOf("const openToolchainReinstall"),
      appSource.indexOf("const setHomeDefaultModel")
    );

    expect(repairOwner).toContain("window.pige.system.repairToolchain({");
    expect(repairOwner).toContain("expectedHealthId: repair.healthId");
    expect(repairOwner).toContain("toolchainHealthRef.current?.repair");
    expect(repairOwner).not.toContain("window.pige.system.toolchainHealth()");
    expect(appSource).toContain("onOpenToolchainReinstall={openToolchainReinstall}");
  });

  it("installs one missing speech language asset and rechecks authoritative availability", async () => {
    const dom = createDom();
    let assetListener: ((event: SpeechAssetInstallEvent) => void) | undefined;
    const installLanguageAsset = vi.fn<SpeechAssetApi["installLanguageAsset"]>()
      .mockImplementationOnce(async (request) => ({
        status: "started",
        requestId: request.requestId,
        installationId: "speechinstall_20260729_settingsasset",
        languageTag: request.languageTag,
        metering: "available"
      }))
      .mockImplementationOnce(async (request) => ({
        status: "blocked",
        requestId: request.requestId,
        error: {
          code: "speech.asset_install_failed",
          domain: "speech",
          messageKey: "errors.speech.asset_install_failed",
          retryable: true,
          severity: "warning",
          userAction: "retry"
        }
      }));
    const speechAssetApi: SpeechAssetApi = {
      installLanguageAsset,
      onAssetInstallEvent: (listener) => {
        assetListener = listener;
        return () => { assetListener = undefined; };
      }
    };
    const refreshSpeechAvailability = vi.fn(async () => undefined);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
        paddleOcrApi: paddleOcrApi("not_installed"),
        semanticRetrievalApi: semanticAssetApi("ready"),
        toolchainHealth: { status: "ready", checkedAt: "2026-07-29T00:00:00.000Z", tools: [] },
        speechAvailability: { status: "unsupported", reason: "assets_unavailable", canOpenSystemSettings: false },
        speechAvailabilityLoading: false,
        speechAvailabilityFailed: false,
        speechAssetApi,
        speechLanguageTag: "en",
        onRefreshSpeechAvailability: refreshSpeechAvailability,
        onRefresh: async () => undefined,
        onDevelopment: vi.fn(),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    const install = buttonNamed(container, "Install resource");

    await act(async () => {
      install.click();
      install.click();
      await settle(dom);
    });
    expect(installLanguageAsset).toHaveBeenCalledOnce();
    expect(installLanguageAsset.mock.calls[0]?.[0]).toMatchObject({ languageTag: "en" });
    expect(installLanguageAsset.mock.calls[0]?.[0].requestId).toMatch(/^speechasset_[a-z0-9]{32}$/u);
    expect(buttonNamed(container, "Installing...").disabled).toBe(true);

    await act(async () => {
      assetListener?.({
        apiVersion: 1,
        installationId: "speechinstall_20260729_settingsasset",
        sequence: 1,
        kind: "progress",
        completedFraction: 0.4
      });
      await settle(dom);
    });
    expect(container.textContent).toContain("Installing language resource 40%");

    await act(async () => {
      assetListener?.({
        apiVersion: 1,
        installationId: "speechinstall_20260729_settingsasset",
        sequence: 2,
        kind: "installed",
        languageTag: "en"
      });
      await settle(dom);
    });
    expect(refreshSpeechAvailability).toHaveBeenCalledOnce();
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Install resource"));

    await act(async () => {
      buttonNamed(container, "Install resource").click();
      await settle(dom);
    });
    expect(installLanguageAsset).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("Status unavailable");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Install resource"));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("rejects speech asset results after locale drift or wrong-language startup", async () => {
    const dom = createDom();
    let resolveFirst!: (result: Awaited<ReturnType<SpeechAssetApi["installLanguageAsset"]>>) => void;
    const first = new Promise<Awaited<ReturnType<SpeechAssetApi["installLanguageAsset"]>>>((resolve) => {
      resolveFirst = resolve;
    });
    let assetListener: ((event: SpeechAssetInstallEvent) => void) | undefined;
    const installLanguageAsset = vi.fn<SpeechAssetApi["installLanguageAsset"]>()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async (request) => ({
        status: "started",
        requestId: request.requestId,
        installationId: "speechinstall_20260729_wronglang",
        languageTag: "en",
        metering: "available"
      }));
    const speechAssetApi: SpeechAssetApi = {
      installLanguageAsset,
      onAssetInstallEvent: (listener) => {
        assetListener = listener;
        return () => { assetListener = undefined; };
      }
    };
    const refreshSpeechAvailability = vi.fn(async () => undefined);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const render = async (languageTag: "en" | "fr"): Promise<void> => {
      await act(async () => {
        root.render(createElement(LocalCapabilitiesSettingsPanel, {
          paddleOcrApi: paddleOcrApi("not_installed"),
          semanticRetrievalApi: semanticAssetApi("ready"),
          toolchainHealth: { status: "ready", checkedAt: "2026-07-29T00:00:00.000Z", tools: [] },
          speechAvailability: { status: "unsupported", reason: "assets_unavailable", canOpenSystemSettings: false },
          speechAvailabilityLoading: false,
          speechAvailabilityFailed: false,
          speechAssetApi,
          speechLanguageTag: languageTag,
          onRefreshSpeechAvailability: refreshSpeechAvailability,
          onRefresh: async () => undefined,
          onDevelopment: vi.fn(),
          t
        }));
        await settle(dom);
      });
    };
    await render("en");
    const container = dom.window.document.querySelector("#root")!;
    await act(async () => {
      buttonNamed(container, "Install resource").click();
      await settle(dom);
    });
    const firstRequest = installLanguageAsset.mock.calls[0]?.[0];
    await render("fr");
    await act(async () => {
      resolveFirst({
        status: "started",
        requestId: firstRequest!.requestId,
        installationId: "speechinstall_20260729_oldlocale",
        languageTag: "en",
        metering: "available"
      });
      assetListener?.({
        apiVersion: 1,
        installationId: "speechinstall_20260729_oldlocale",
        sequence: 1,
        kind: "installed",
        languageTag: "en"
      });
      await settle(dom);
    });
    expect(refreshSpeechAvailability).not.toHaveBeenCalled();
    expect(container.querySelector('[data-capability-status="voice-input"]')?.textContent)
      .toBe("Language resource needed");

    await act(async () => {
      buttonNamed(container, "Install resource").click();
      await settle(dom);
    });
    expect(installLanguageAsset).toHaveBeenCalledTimes(2);
    expect(installLanguageAsset.mock.calls[1]?.[0].languageTag).toBe("fr");
    expect(refreshSpeechAvailability).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("Status unavailable");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps an OCR language CAS draft through stale state, suppresses duplicate updates, and restores focus", async () => {
    const dom = createDom();
    let resolveFirstUpdate!: (result: Awaited<ReturnType<OcrLanguagePreferenceApi["setOcrLanguagePreference"]>>) => void;
    const firstUpdate = new Promise<Awaited<ReturnType<OcrLanguagePreferenceApi["setOcrLanguagePreference"]>>>((resolve) => {
      resolveFirstUpdate = resolve;
    });
    const update = vi.fn()
      .mockImplementationOnce(async () => firstUpdate)
      .mockImplementationOnce(async (request) => ({
        apiVersion: 1,
        requestId: request.requestId,
        status: "committed",
        summary: {
          apiVersion: 1,
          revision: 3,
          preference: { mode: "preferred", language: "ja" },
          appliesTo: "new_ocr_jobs"
        }
      }));
    const ocrLanguagePreferenceApi: OcrLanguagePreferenceApi = {
      ocrLanguagePreference: vi.fn(async (request) => ({
        apiVersion: 1,
        requestId: request.requestId,
        status: "ready",
        summary: {
          apiVersion: 1,
          revision: 1,
          preference: { mode: "automatic" },
          appliesTo: "new_ocr_jobs"
        }
      })),
      setOcrLanguagePreference: update
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
        ocrLanguagePreferenceApi,
        paddleOcrApi: paddleOcrApi("not_installed"),
        semanticRetrievalApi: semanticAssetApi("ready"),
        toolchainHealth: null,
        onRefresh: vi.fn(async () => undefined),
        onDevelopment: vi.fn(),
        t
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    const select = requireElement(container.querySelector<HTMLSelectElement>('select[aria-label="Preferred OCR language"]'));
    expect(Array.from(select.options).map((option) => [option.value, option.textContent])).toEqual([
      ["automatic", "Automatic"],
      ["zh-Hans", "简体中文"],
      ["en", "English"],
      ["ja", "日本語"],
      ["ko", "한국어"],
      ["fr", "Français"],
      ["de", "Deutsch"]
    ]);
    expect(container.textContent).toContain("Used only for new OCR jobs. Existing text is not changed.");

    await act(async () => {
      select.focus();
      selectValue(dom, select, "fr");
      selectValue(dom, select, "de");
      await settle(dom);
    });
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^ocrlangreq_[a-z0-9]{16,64}$/u),
      preference: { mode: "preferred", language: "fr" },
      expectedRevision: 1
    });
    expect(select.value).toBe("fr");
    expect(select.disabled).toBe(true);

    await act(async () => {
      resolveFirstUpdate({
        apiVersion: 1,
        requestId: update.mock.calls[0]![0].requestId,
        status: "stale",
        summary: {
          apiVersion: 1,
          revision: 2,
          preference: { mode: "preferred", language: "en" },
          appliesTo: "new_ocr_jobs"
        }
      });
      await settle(dom);
    });
    expect(select.value).toBe("fr");
    expect(select.disabled).toBe(false);
    expect(dom.window.document.activeElement).toBe(select);
    expect(container.textContent).toContain("The OCR language changed elsewhere. Your selection was kept");

    await act(async () => {
      selectValue(dom, select, "ja");
      await settle(dom);
    });
    expect(update).toHaveBeenLastCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^ocrlangreq_[a-z0-9]{16,64}$/u),
      preference: { mode: "preferred", language: "ja" },
      expectedRevision: 2
    });
    expect(select.value).toBe("ja");
    expect(container.querySelector("#capabilities-ocr-language-notice")).toBeNull();
    expect(dom.window.document.activeElement).toBe(select);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("changes the actual OCR engine preference with CAS and keeps authoritative stale state", async () => {
    const dom = createDom();
    const update = vi.fn(async (request) => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      status: "stale" as const,
      summary: {
        apiVersion: 1 as const,
        revision: 2,
        preference: "platform_native" as const,
        appliesTo: "new_ocr_jobs" as const
      }
    }));
    const api: OcrEnginePreferenceApi = {
      ocrEnginePreference: vi.fn(async (request) => ({
        apiVersion: 1,
        requestId: request.requestId,
        status: "ready",
        summary: {
          apiVersion: 1,
          revision: 1,
          preference: "automatic",
          appliesTo: "new_ocr_jobs"
        }
      })),
      setOcrEnginePreference: update
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
        ocrEnginePreferenceApi: api,
        paddleOcrApi: paddleOcrApi("not_installed"),
        semanticRetrievalApi: semanticAssetApi("ready"),
        toolchainHealth: null,
        onRefresh: vi.fn(async () => undefined),
        onDevelopment: vi.fn(),
        t
      }));
      await settle(dom);
    });

    const select = requireElement(dom.window.document.querySelector<HTMLSelectElement>(
      'select[aria-label="OCR engine"]'
    ));
    expect(Array.from(select.options).map((option) => [option.value, option.textContent])).toEqual([
      ["automatic", "Automatic"],
      ["platform_native", "Prefer system OCR"],
      ["paddleocr_local", "Prefer PaddleOCR"]
    ]);
    await act(async () => {
      selectValue(dom, select, "paddleocr_local");
      await settle(dom);
    });
    expect(update).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^ocrenginereq_[a-z0-9]{16,64}$/u),
      expectedRevision: 1,
      preference: "paddleocr_local"
    });
    expect(select.value).toBe("platform_native");
    expect(dom.window.document.activeElement).toBe(select);
    expect(dom.window.document.querySelector("#capabilities-ocr-engine-notice")?.textContent)
      .toContain("changed elsewhere");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps Speech Service availability App-owned, locale-scoped, and stale-result fenced", () => {
    const appSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/App.tsx"),
      "utf8"
    );
    expect(appSource).toContain('if (!settingsOpen || settingsSection !== "capabilities") return;');
    expect(appSource).toContain("window.pige.speech.availability({ languageTag: dictationLanguageTag })");
    expect(appSource).toContain("dictationLanguagePreference.mode === \"automatic\"");
    expect(appSource).toContain("requestId !== speechAvailabilitySequence.current");
    expect(appSource).toContain("window.pige.speech.openSystemSettings()");
    expect(appSource).not.toContain("navigator.mediaDevices");
  });

  it("persists a dedicated dictation language and reports the authoritative preference to Home", async () => {
    const dom = createDom();
    const onPreferenceChanged = vi.fn();
    const update = vi.fn(async (request) => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      status: "committed" as const,
      summary: {
        apiVersion: 1 as const,
        revision: 2,
        preference: request.preference,
        appliesTo: "new_speech_sessions" as const
      }
    }));
    const api: DictationLanguagePreferenceApi = {
      dictationLanguagePreference: vi.fn(async (request) => ({
        apiVersion: 1,
        requestId: request.requestId,
        status: "ready",
        summary: {
          apiVersion: 1,
          revision: 1,
          preference: { mode: "preferred", language: "fr" },
          appliesTo: "new_speech_sessions"
        }
      })),
      setDictationLanguagePreference: update
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
        dictationLanguagePreferenceApi: api,
        onDictationLanguagePreferenceChanged: onPreferenceChanged,
        paddleOcrApi: paddleOcrApi("not_installed"),
        semanticRetrievalApi: semanticAssetApi("ready"),
        toolchainHealth: null,
        onRefresh: vi.fn(async () => undefined),
        onDevelopment: vi.fn(),
        t
      }));
      await settle(dom);
    });

    const select = requireElement(dom.window.document.querySelector<HTMLSelectElement>(
      'select[aria-label="Dictation language"]'
    ));
    expect(select.value).toBe("fr");
    expect(onPreferenceChanged).toHaveBeenCalledWith({ mode: "preferred", language: "fr" });
    await act(async () => {
      selectValue(dom, select, "ja");
      await settle(dom);
    });
    expect(update).toHaveBeenCalledWith({
      apiVersion: 1,
      requestId: expect.stringMatching(/^dictlangreq_[a-z0-9]{16,64}$/u),
      expectedRevision: 1,
      preference: { mode: "preferred", language: "ja" }
    });
    expect(onPreferenceChanged).toHaveBeenLastCalledWith({ mode: "preferred", language: "ja" });
    expect(dom.window.document.activeElement).toBe(select);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("runs the managed PaddleOCR lifecycle from authoritative actions without exposing package internals", async () => {
    const dom = createDom();
    let current = paddleOcrSummary(1, "not_installed");
    let resolveInstall!: (result: PaddleOcrInstallResult) => void;
    const installResult = new Promise<PaddleOcrInstallResult>((resolve) => {
      resolveInstall = resolve;
    });
    const summary = vi.fn(async () => current);
    const install = vi.fn(async (_request: PaddleOcrInstallRequest) => installResult);
    const enable = vi.fn(async (request: PaddleOcrEnableRequest): Promise<PaddleOcrEnableResult> => {
      current = paddleOcrSummary(3, "ready");
      return {
        apiVersion: 1,
        requestId: request.requestId,
        engineId: "paddleocr_local",
        status: "committed",
        summary: current
      };
    });
    const test = vi.fn(async (request: PaddleOcrTestRequest): Promise<PaddleOcrTestResult> => {
      current = paddleOcrSummary(4, "ready");
      return {
        apiVersion: 1,
        requestId: request.requestId,
        engineId: "paddleocr_local",
        status: "accepted",
        jobId: "job_20260728_paddleocrtest",
        summary: current
      };
    });
    const disable = vi.fn()
      .mockImplementationOnce(async (request: PaddleOcrDisableRequest): Promise<PaddleOcrDisableResult> => ({
        apiVersion: 1,
        requestId: request.requestId,
        engineId: "paddleocr_local",
        status: "failed"
      }))
      .mockImplementationOnce(async (request: PaddleOcrDisableRequest): Promise<PaddleOcrDisableResult> => {
        current = paddleOcrSummary(5, "disabled");
        return {
          apiVersion: 1,
          requestId: request.requestId,
          engineId: "paddleocr_local",
          status: "committed",
          summary: current
        };
      });
    const remove = vi.fn(async (request: PaddleOcrRemoveRequest): Promise<PaddleOcrRemoveResult> => {
      current = paddleOcrSummary(6, "not_installed");
      return {
        apiVersion: 1,
        requestId: request.requestId,
        engineId: "paddleocr_local",
        status: "committed",
        summary: current
      };
    });
    const api: PaddleOcrApi = {
      paddleOcrSummary: summary,
      installPaddleOcr: install,
      enablePaddleOcr: enable,
      testPaddleOcr: test,
      disablePaddleOcr: disable,
      removePaddleOcr: remove
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalCapabilitiesSettingsPanel, {
        paddleOcrApi: api,
        semanticRetrievalApi: semanticAssetApi("ready"),
        toolchainHealth: null,
        speechAvailability: null,
        speechAvailabilityLoading: false,
        speechAvailabilityFailed: false,
        onRefresh: vi.fn(async () => undefined),
        onOpenSpeechSettings: vi.fn(async () => undefined),
        onDevelopment: vi.fn(),
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("PaddleOCR fallback");
    expect(container.textContent).toContain("24 MB");
    expect(container.textContent).toContain("Downloads occur only after you choose Install.");
    expect(container.textContent).not.toContain("Private Python");
    expect(container.textContent).not.toContain("/Users/private");
    expect(container.textContent).not.toContain("sha256:");
    expect(container.querySelector('[data-paddle-ocr-action="update"]')).toBeNull();
    expect(container.querySelector('[data-paddle-ocr-action="repair"]')).toBeNull();
    const paddleButton = (action: string): HTMLButtonElement => requireElement(
      container.querySelector<HTMLButtonElement>(`[data-paddle-ocr-action="${action}"]`)
    );

    const installButton = paddleButton("install");
    await act(async () => {
      installButton.click();
      installButton.click();
    });
    expect(install).toHaveBeenCalledOnce();
    const installRequest = install.mock.calls[0]?.[0];
    expect(installRequest).toEqual({
      apiVersion: 1,
      requestId: expect.stringMatching(/^paddleocr_[a-z0-9]{16,64}$/u),
      expectedRevision: 1
    });
    current = paddleOcrSummary(2, "disabled");
    await act(async () => {
      resolveInstall({
        apiVersion: 1,
        requestId: installRequest!.requestId,
        engineId: "paddleocr_local",
        status: "accepted",
        jobId: "job_20260728_paddleocrinstall",
        summary: current
      });
      await settle(dom);
    });
    expect(container.textContent).toContain("Disabled");

    await act(async () => {
      paddleButton("enable").click();
      await settle(dom);
    });
    await act(async () => {
      paddleButton("test").click();
      await settle(dom);
    });
    await act(async () => {
      paddleButton("disable").click();
      await settle(dom);
    });
    expect(enable).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }));
    expect(test).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));
    expect(disable).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 }));
    expect(container.textContent).toContain("PaddleOCR could not be changed");
    expect(container.textContent).toContain("Ready");

    await act(async () => {
      paddleButton("disable").click();
      await settle(dom);
    });
    await act(async () => {
      paddleButton("remove").click();
      await settle(dom);
    });
    expect(disable).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 4 }));
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 5 }));
    expect(container.textContent).toContain("Not installed");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("projects real speech availability without requesting permission and opens system settings only after denial", async () => {
    const dom = createDom();
    const onOpenSpeechSettings = vi.fn(async () => undefined);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const semanticRetrievalApi = semanticAssetApi("ready");
    const renderPanel = async (speechAvailability: SpeechAvailabilityResult): Promise<void> => {
      await act(async () => {
        root.render(createElement(LocalCapabilitiesSettingsPanel, {
          paddleOcrApi: paddleOcrApi("not_installed"),
          semanticRetrievalApi,
          toolchainHealth: null,
          speechAvailability,
          speechAvailabilityLoading: false,
          speechAvailabilityFailed: false,
          onRefresh: vi.fn(async () => undefined),
          onOpenSpeechSettings,
          onDevelopment: vi.fn(),
          t
        }));
        await settle(dom);
      });
    };

    await renderPanel({
      status: "supported",
      languageTag: "en",
      permission: "not-determined",
      canOpenSystemSettings: true
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector('[data-capability-status="voice-input"]')?.textContent).toBe("Available");
    expect(container.querySelector('[data-capability-control="voice-open-settings"]')).toBeNull();
    expect(onOpenSpeechSettings).not.toHaveBeenCalled();

    await renderPanel({
      status: "supported",
      languageTag: "en",
      permission: "denied",
      canOpenSystemSettings: true
    });
    expect(container.querySelector('[data-capability-status="voice-input"]')?.textContent).toBe("Permission needed");
    await act(async () => {
      requireElement(container.querySelector<HTMLButtonElement>('[data-capability-control="voice-open-settings"]')).click();
      await settle(dom);
    });
    expect(onOpenSpeechSettings).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps install, enable, disable, and remove as distinct revision-fenced semantic asset actions", async () => {
    const dom = createDom();
    let current = semanticAssetStatus(1, "not_installed");
    const status = vi.fn(async () => current);
    const install = vi.fn(async (request: LocalSemanticRetrievalInstallRequest): Promise<LocalSemanticRetrievalInstallResult> => {
      current = semanticAssetStatus(3, "disabled");
      return { apiVersion: 1, requestId: request.requestId, revision: 2, status: "accepted", jobId: "job_20260727_semanticasset" };
    });
    const enable = vi.fn(async (request: LocalSemanticRetrievalEnableRequest): Promise<LocalSemanticRetrievalEnableResult> => {
      current = semanticAssetStatus(4, "ready");
      return { apiVersion: 1, requestId: request.requestId, revision: 4, status: "committed" };
    });
    const disable = vi.fn(async (request: LocalSemanticRetrievalDisableRequest): Promise<LocalSemanticRetrievalDisableResult> => {
      current = semanticAssetStatus(5, "disabled");
      return { apiVersion: 1, requestId: request.requestId, revision: 5, status: "committed" };
    });
    const remove = vi.fn(async (request: LocalSemanticRetrievalRemoveRequest): Promise<LocalSemanticRetrievalRemoveResult> => {
      current = semanticAssetStatus(6, "not_installed");
      return { apiVersion: 1, requestId: request.requestId, revision: 6, status: "committed" };
    });
    const api: LocalSemanticRetrievalApi = {
      localSemanticStatus: status,
      installLocalSemanticAsset: install,
      enableLocalSemanticAsset: enable,
      disableLocalSemanticAsset: disable,
      removeLocalSemanticAsset: remove
    };
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(LocalSemanticRetrievalSettingsPanel, { api, t }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    expect(container.textContent).toContain("Not installed");
    expect(container.textContent).toContain("Lexical search always remains available.");

    await act(async () => {
      buttonNamed(container, "Install").click();
      await settle(dom);
    });
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ apiVersion: 1, expectedRevision: 1 }));
    expect(install.mock.calls[0]?.[0].requestId).toMatch(/^ragasset_[a-z0-9]{16,64}$/u);
    expect(enable).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Disabled");
    expect(buttonNamed(container, "Enable")).not.toBeNull();

    await act(async () => {
      buttonNamed(container, "Enable").click();
      await settle(dom);
    });
    expect(enable).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));
    expect(container.textContent).toContain("Enabled");

    await act(async () => {
      buttonNamed(container, "Disable").click();
      await settle(dom);
    });
    expect(disable).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 }));
    expect(container.textContent).toContain("Disabled");

    await act(async () => {
      buttonNamed(container, "Remove").click();
      await settle(dom);
    });
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 5 }));
    expect(container.textContent).toContain("Not installed");
    expect(container.textContent).not.toContain("qwen3_embedding_0_6b_q8_0");
    expect(container.textContent).not.toContain("provider");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("lists and restores deleted and reset Memory through exact body-free trash authority", async () => {
    const dom = createDom();
    const summary = memorySummary(4, "active");
    const restoredRecord = {
      ...summary.records[0],
      id: "memory_20260802_restoreditem",
      title: "Restored preference",
      body: "Private restored body that is absent from trash inventory."
    } as const;
    let trashState: MemoryTrashSummary = {
      apiVersion: 1 as const,
      activeVaultId: summary.activeVaultId,
      revision: summary.revision,
      records: [{
        memoryId: restoredRecord.id,
        trashOperationId: "op_20260802_memorytrashui",
        kind: "preference" as const,
        title: restoredRecord.title,
        trashedAt: "2026-08-02T01:00:00.000Z"
      }],
      resets: [{
        trashOperationId: "op_20260802_memoryresetui",
        itemCount: 2,
        trashedAt: "2026-08-02T00:30:00.000Z"
      }]
    };
    const listTrash = vi.fn(async () => trashState);
    const restoreTrash = vi.fn(async (request) => {
      const reset = request.memoryId === undefined;
      trashState = { ...trashState, revision: reset ? 6 : 5,
        records: reset ? trashState.records : [], resets: reset ? [] : trashState.resets };
      return {
        apiVersion: 1 as const,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        status: "committed" as const,
        operationId: "op_20260802_memoryrestoreui",
        summary: { ...summary, revision: trashState.revision, records: [...summary.records, restoredRecord] },
        trash: trashState
      };
    });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { memory: {
        list: vi.fn(async () => summary), listTrash, restoreTrash,
        disable: vi.fn(), edit: vi.fn(), enable: vi.fn(), delete: vi.fn(), export: vi.fn(), reset: vi.fn()
      } }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, { activeVaultId: summary.activeVaultId, t }));
      await settle(dom);
    });
    expect(dom.window.document.body.textContent).toContain("Restored preference");
    expect(dom.window.document.body.textContent).not.toContain(restoredRecord.body);

    await act(async () => {
      buttonNamed(dom.window.document, "Restore: Restored preference").click();
      await settle(dom);
    });
    expect(restoreTrash).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultId: summary.activeVaultId,
      memoryId: restoredRecord.id,
      trashOperationId: "op_20260802_memorytrashui",
      expectedRevision: 4
    }));
    expect(dom.window.document.body.textContent).toContain(restoredRecord.body);
    expect(dom.window.document.body.textContent).toContain("The memory was restored.");

    await act(async () => {
      buttonNamed(dom.window.document, "Restore reset").click();
      await settle(dom);
    });
    expect(restoreTrash).toHaveBeenLastCalledWith(expect.objectContaining({
      activeVaultId: summary.activeVaultId,
      trashOperationId: "op_20260802_memoryresetui",
      expectedRevision: 5
    }));
    expect(restoreTrash.mock.calls.at(-1)?.[0]).not.toHaveProperty("memoryId");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("focuses an authoritative Memory Activity target and falls back to the panel heading", async () => {
    const dom = createDom();
    const summary = memorySummary(4, "active");
    const settled = vi.fn();
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        memory: {
          list: vi.fn(async () => summary),
          disable: vi.fn(),
          edit: vi.fn(),
          enable: vi.fn(),
          delete: vi.fn(),
          export: vi.fn(),
          reset: vi.fn(),
        },
      },
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, {
        activeVaultId: summary.activeVaultId,
        focusRequest: {
          activeVaultId: summary.activeVaultId,
          operationId: "op_20260730_memoryopen01",
          memoryId: "memory_20260727_concisestyle",
        },
        onFocusRequestSettled: settled,
        t,
      }));
      await settle(dom);
    });

    expect(dom.window.document.activeElement).toBe(
      buttonNamed(dom.window.document, "Edit: Concise source summaries"),
    );
    expect(settled).toHaveBeenLastCalledWith(
      "op_20260730_memoryopen01",
      "focused",
    );

    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, {
        activeVaultId: summary.activeVaultId,
        focusRequest: {
          activeVaultId: summary.activeVaultId,
          operationId: "op_20260730_memorymissing01",
          memoryId: "memory_20260730_missingrecord",
        },
        onFocusRequestSettled: settled,
        t,
      }));
      await settle(dom);
    });
    const heading = requireElement(dom.window.document.querySelector<HTMLHeadingElement>(
      "#settings-memory-title",
    ));
    expect(dom.window.document.activeElement).toBe(heading);
    expect(settled).toHaveBeenLastCalledWith(
      "op_20260730_memorymissing01",
      "missing",
    );

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reports a Memory Activity load failure without stealing invoking focus", async () => {
    const dom = createDom();
    const origin = dom.window.document.createElement("button");
    origin.textContent = "Open memory activity";
    dom.window.document.body.append(origin);
    origin.focus();
    const settled = vi.fn();
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        memory: {
          list: vi.fn(async () => Promise.reject(new Error("unavailable"))),
        },
      },
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, {
        activeVaultId: "vault_20260727_memoryfixture",
        focusRequest: {
          activeVaultId: "vault_20260727_memoryfixture",
          operationId: "op_20260730_memoryfailed01",
          memoryId: "memory_20260727_concisestyle",
        },
        onFocusRequestSettled: settled,
        t,
      }));
      await settle(dom);
    });

    expect(settled).toHaveBeenCalledWith(
      "op_20260730_memoryfailed01",
      "failed",
    );
    expect(dom.window.document.activeElement).toBe(origin);
    expect(dom.window.document.querySelector('[role="alert"]')?.textContent).toContain(
      "Memory unavailable",
    );

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("changes the next-backup memory inclusion with exact portable preference identity", async () => {
    const dom = createDom();
    const summary = memorySummary(4, "active");
    const preference = {
      apiVersion: 1 as const,
      activeVaultId: summary.activeVaultId,
      revision: `backupmemoryrev_${"a".repeat(64)}` as const,
      includeVaultMemory: true,
      canUpdate: true
    };
    const setMemoryPreference = vi.fn(async (request: any) => ({
      apiVersion: 1 as const,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "updated" as const,
      summary: {
        ...preference,
        revision: `backupmemoryrev_${"b".repeat(64)}` as const,
        includeVaultMemory: false
      }
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        backup: {
          memoryPreferenceStatus: vi.fn(async () => preference),
          setMemoryPreference
        },
        memory: {
          list: vi.fn(async () => summary),
          disable: vi.fn(), edit: vi.fn(), enable: vi.fn(), delete: vi.fn(), export: vi.fn(), reset: vi.fn()
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, { activeVaultId: summary.activeVaultId, t }));
      await settle(dom);
    });
    const control = requireElement(dom.window.document.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Include Agent memory in backups"]'
    ));
    expect(control.getAttribute("aria-checked")).toBe("true");
    await act(async () => { control.click(); control.click(); await settle(dom); });
    expect(setMemoryPreference).toHaveBeenCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: summary.activeVaultId,
      expectedRevision: preference.revision,
      includeVaultMemory: false
    }));
    expect(setMemoryPreference.mock.calls[0]?.[0].requestId).toMatch(/^backupmemoryreq_[a-z0-9]{16,64}$/u);
    expect(setMemoryPreference).toHaveBeenCalledTimes(1);
    expect(control.getAttribute("aria-checked")).toBe("false");
    await act(async () => { await settle(dom); });
    expect(dom.window.document.activeElement).toBe(control);
    expect(dom.window.document.body.textContent).toContain("The Agent memory backup preference was saved.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("manages the reversible vault memory lifecycle with exact CAS and quiet cancellation", async () => {
    const dom = createDom();
    const activeSummary = memorySummary(4, "active");
    const disabledSummary = memorySummary(5, "disabled");
    const enabledSummary = memorySummary(6, "active");
    const staleSummary = memorySummary(7, "active");
    const emptySummary = memoryEmptySummary(8);
    const resetSummary = memoryEmptySummary(9);
    let resolveList!: (summary: MemorySummary) => void;
    const list = vi.fn(() => new Promise<MemorySummary>((resolve) => {
      resolveList = resolve;
    }));
    const disable = vi.fn(async (): Promise<MemoryMutationResult> => ({
      status: "committed",
      summary: disabledSummary
    }));
    const enable = vi.fn(async (request: MemoryEnableRequest): Promise<MemoryLifecycleMutationResult> => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "committed",
      operationId: "op_20260727_memoryenable",
      summary: enabledSummary
    }));
    let deleteAttempt = 0;
    const deleteMemory = vi.fn(async (request: MemoryDeleteRequest): Promise<MemoryLifecycleMutationResult> => {
      deleteAttempt += 1;
      return deleteAttempt === 1
        ? { apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId, status: "stale", summary: staleSummary }
        : { apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId, status: "committed", operationId: "op_20260727_memorydelete", summary: emptySummary };
    });
    let exportAttempt = 0;
    const exportMemory = vi.fn(async (request: MemoryExportRequest): Promise<MemoryExportResult> => {
      exportAttempt += 1;
      return {
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        revision: request.expectedRevision,
        status: exportAttempt === 1 ? "cancelled" : "exported"
      };
    });
    const reset = vi.fn(async (request: MemoryResetRequest): Promise<MemoryLifecycleMutationResult> => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "committed",
      operationId: "op_20260727_memoryreset",
      summary: resetSummary
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { memory: { list, disable, edit: vi.fn(), enable, delete: deleteMemory, export: exportMemory, reset } }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, {
        activeVaultId: "vault_20260727_memoryfixture",
        t
      }));
      await settle(dom);
    });

    const container = dom.window.document.querySelector("#root")!;
    expect(container.querySelector("h1")?.textContent).toBe("Agent & Memory");
    expect(container.textContent).toContain("Loading memories");
    expect(list).toHaveBeenCalledWith({ apiVersion: 1, activeVaultId: "vault_20260727_memoryfixture" });

    await act(async () => {
      resolveList(activeSummary);
      await settle(dom);
    });

    const row = requireElement(container.querySelector<HTMLElement>('[data-memory-id="memory_20260727_concisestyle"]'));
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("4");
    expect(row.textContent).toContain("Concise source summaries");
    expect(row.textContent).toContain("Keep source summaries concise and preserve citations.");
    expect(row.textContent).toContain("Preference");
    expect(row.textContent).toContain("Active");
    expect(row.textContent).toContain("Explicit request");
    expect(row.textContent).not.toContain("conv_20260727_memorysource");
    expect(row.textContent).not.toContain("evt_20260727_memorysourceevent");
    expect(container.textContent).toContain("Export");
    expect(container.textContent).toContain("Reset memory");

    await act(async () => {
      buttonNamed(row, "Disable: Concise source summaries").click();
      await settle(dom);
    });
    expect(disable).toHaveBeenCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: "vault_20260727_memoryfixture",
      memoryId: "memory_20260727_concisestyle",
      expectedRevision: 4
    }));
    expect(disable.mock.calls[0]?.[0].requestId).toMatch(/^memory_request_[a-z0-9]{16,64}$/u);
    expect(row.textContent).toContain("Disabled");
    expect(buttonNamed(row, "Enable: Concise source summaries").disabled).toBe(false);
    expect(container.textContent).toContain("The memory is disabled for future Agent turns.");

    await act(async () => {
      buttonNamed(row, "Enable: Concise source summaries").click();
      await settle(dom);
    });
    expect(enable).toHaveBeenCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: "vault_20260727_memoryfixture",
      memoryId: "memory_20260727_concisestyle",
      expectedRevision: 5
    }));
    expect(enable.mock.calls[0]?.[0].requestId).toMatch(/^memory_request_[a-z0-9]{16,64}$/u);
    expect(container.textContent).toContain("The memory is enabled for future Agent turns.");

    await act(async () => {
      buttonNamed(container, "Export").click();
      await settle(dom);
    });
    expect(exportMemory).toHaveBeenLastCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: "vault_20260727_memoryfixture",
      expectedRevision: 6
    }));
    expect(container.querySelector('.settings-note[role="status"]')).toBeNull();

    await act(async () => {
      buttonNamed(container, "Export").click();
      await settle(dom);
    });
    expect(container.textContent).toContain("Memory was exported safely.");

    await act(async () => {
      buttonNamed(container, "Delete: Concise source summaries").click();
      await settle(dom);
    });
    expect(deleteMemory).toHaveBeenLastCalledWith(expect.objectContaining({
      memoryId: "memory_20260727_concisestyle",
      expectedRevision: 6
    }));
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("7");
    expect(container.textContent).toContain("Memory changed. The latest list is shown.");

    await act(async () => {
      buttonNamed(container, "Delete: Concise source summaries").click();
      await settle(dom);
    });
    expect(deleteMemory).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 7 }));
    expect(container.textContent).toContain("No saved memories");
    expect(container.textContent).toContain("The memory was removed. You can undo this from Activity.");

    const resetTrigger = buttonNamed(container, "Reset memory...");
    await act(async () => {
      resetTrigger.click();
      await settle(dom);
    });
    let dialog = requireElement(container.querySelector<HTMLElement>('[role="alertdialog"]'));
    expect(dialog.textContent).toContain("Reset vault memory?");
    expect(dom.window.document.activeElement).toBe(buttonNamed(dialog, "Reset memory"));
    await act(async () => {
      buttonNamed(dialog, "Cancel").click();
      await settle(dom);
    });
    expect(reset).not.toHaveBeenCalled();
    expect(dom.window.document.activeElement).toBe(resetTrigger);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();

    await act(async () => {
      resetTrigger.click();
      await settle(dom);
    });
    dialog = requireElement(container.querySelector<HTMLElement>('[role="alertdialog"]'));
    await act(async () => {
      buttonNamed(dialog, "Reset memory").click();
      await settle(dom);
    });
    expect(reset).toHaveBeenCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: "vault_20260727_memoryfixture",
      expectedRevision: 8
    }));
    expect(container.textContent).toContain("Memory was reset. You can undo this from Activity.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("edits one memory with exact CAS while preserving the draft across stale, missing, and failed results", async () => {
    const dom = createDom();
    const originalSummary = memorySummary(4, "active");
    const staleSummary = memorySummaryWithText(
      5,
      "Server title",
      "The server changed this memory.",
    );
    const notFoundSummary = memoryEmptySummary(6);
    const committedSummary = memorySummaryWithText(
      7,
      "Local title",
      "Local body with exact wording.",
    );
    let attempt = 0;
    const edit = vi.fn(async (request: MemoryEditRequest): Promise<MemoryLifecycleMutationResult> => {
      attempt += 1;
      if (attempt === 1) {
        return {
          apiVersion: 1,
          requestId: request.requestId,
          activeVaultId: request.activeVaultId,
          status: "stale",
          summary: staleSummary,
        };
      }
      if (attempt === 2) {
        return {
          apiVersion: 1,
          requestId: request.requestId,
          activeVaultId: request.activeVaultId,
          status: "not_found",
          summary: notFoundSummary,
        };
      }
      if (attempt === 3) throw new Error("synthetic edit failure");
      return {
        apiVersion: 1,
        requestId: request.requestId,
        activeVaultId: request.activeVaultId,
        status: "committed",
        operationId: "op_20260728_memoryedit",
        summary: committedSummary,
      };
    });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        memory: {
          list: vi.fn(async () => originalSummary),
          disable: vi.fn(),
          edit,
          enable: vi.fn(),
          delete: vi.fn(),
          export: vi.fn(),
          reset: vi.fn(),
        },
      },
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(
        createElement(AgentMemorySettingsPanel, {
          activeVaultId: "vault_20260727_memoryfixture",
          t,
        }),
      );
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await act(async () => {
      buttonNamed(container, "Edit: Concise source summaries").click();
      await settle(dom);
    });
    const title = requireElement(
      container.querySelector<HTMLInputElement>("#memory-edit-title-memory_20260727_concisestyle"),
    );
    const body = requireElement(
      container.querySelector<HTMLTextAreaElement>("#memory-edit-body-memory_20260727_concisestyle"),
    );
    expect(dom.window.document.activeElement).toBe(title);
    expect(buttonNamed(container, "Export").disabled).toBe(true);
    expect(buttonNamed(container, "Reset memory...").disabled).toBe(true);
    await act(async () => {
      inputValue(dom, title, "Local title");
      textareaValue(dom, body, "Local body with exact wording.");
      await settle(dom);
    });
    const composingEnter = new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: "Enter",
    });
    await act(async () => {
      title.dispatchEvent(composingEnter);
      await settle(dom);
    });
    expect(composingEnter.defaultPrevented).toBe(true);
    expect(edit).not.toHaveBeenCalled();

    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });
    expect(edit).toHaveBeenLastCalledWith(expect.objectContaining({
      apiVersion: 1,
      activeVaultId: "vault_20260727_memoryfixture",
      memoryId: "memory_20260727_concisestyle",
      expectedRevision: 4,
      title: "Local title",
      body: "Local body with exact wording.",
    }));
    expect(title.value).toBe("Local title");
    expect(body.value).toBe("Local body with exact wording.");
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("5");
    expect(container.textContent).toContain("Memory changed. The latest list is shown and your draft is unchanged.");

    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });
    expect(edit.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ expectedRevision: 5 }));
    expect(title.value).toBe("Local title");
    expect(body.value).toBe("Local body with exact wording.");
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("6");
    expect(container.textContent).toContain("That memory is no longer available. Your draft is unchanged.");

    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });
    expect(edit.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ expectedRevision: 6 }));
    expect(title.value).toBe("Local title");
    expect(body.value).toBe("Local body with exact wording.");
    expect(container.textContent).toContain("The edit could not be saved. Your draft is unchanged.");

    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });
    expect(edit.mock.calls[3]?.[0]).toEqual(expect.objectContaining({ expectedRevision: 6 }));
    expect(container.querySelector("#memory-edit-title-memory_20260727_concisestyle")).toBeNull();
    expect(container.textContent).toContain("Local title");
    expect(container.textContent).toContain("Local body with exact wording.");
    expect(container.textContent).toContain("The memory was updated.");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Edit: Local title"));

    await act(async () => {
      buttonNamed(container, "Edit: Local title").click();
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(
      container.querySelector("#memory-edit-title-memory_20260727_concisestyle"),
    );
    await act(async () => {
      buttonNamed(container, "Cancel").click();
      await settle(dom);
    });
    expect(container.querySelector("#memory-edit-title-memory_20260727_concisestyle")).toBeNull();
    expect(container.textContent).toContain("Local title");
    expect(dom.window.document.activeElement).toBe(buttonNamed(container, "Edit: Local title"));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fences an in-flight memory edit when the active vault changes", async () => {
    const dom = createDom();
    let resolveEdit!: (result: MemoryLifecycleMutationResult) => void;
    const list = vi.fn(async (request: MemoryListRequest): Promise<MemorySummary> => memorySummary(
      request.activeVaultId === "vault_20260727_memoryfixture" ? 4 : 20,
      "active",
      request.activeVaultId
    ));
    const edit = vi.fn((_request: MemoryEditRequest) => new Promise<MemoryLifecycleMutationResult>((resolve) => {
      resolveEdit = resolve;
    }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        memory: {
          list,
          disable: vi.fn(),
          edit,
          enable: vi.fn(),
          delete: vi.fn(),
          export: vi.fn(),
          reset: vi.fn()
        }
      }
    });
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, {
        activeVaultId: "vault_20260727_memoryfixture",
        t
      }));
      await settle(dom);
    });
    const container = dom.window.document.querySelector("#root")!;
    await act(async () => {
      buttonNamed(container, "Edit: Concise source summaries").click();
      await settle(dom);
    });
    await act(async () => {
      const title = requireElement(container.querySelector<HTMLInputElement>("#memory-edit-title-memory_20260727_concisestyle"));
      inputValue(dom, title, "A fenced local title");
      await settle(dom);
    });
    await act(async () => {
      buttonNamed(container, "Save").click();
      await settle(dom);
    });

    await act(async () => {
      root.render(createElement(AgentMemorySettingsPanel, {
        activeVaultId: "vault_20260727_memorysecond",
        t
      }));
      await settle(dom);
    });
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("20");

    await act(async () => {
      resolveEdit({
        apiVersion: 1,
        requestId: edit.mock.calls[0]?.[0].requestId,
        activeVaultId: "vault_20260727_memoryfixture",
        status: "committed",
        operationId: "op_20260727_memoryfenced",
        summary: memorySummaryWithText(10, "A fenced local title", "Old vault body")
      });
      await settle(dom);
    });
    expect(container.querySelector("[data-memory-revision]")?.getAttribute("data-memory-revision")).toBe("20");
    expect(container.textContent).not.toContain("A fenced local title");
    expect(container.textContent).not.toContain("The memory was updated.");

    await act(async () => root.unmount());
    dom.window.close();
  });
});

function permissionGrant(grantId: string, actorLabel: string, resourceLabel: string) {
  return {
    grantId,
    actorType: "skill" as const,
    actorLabel,
    actorVersion: "1.0.0",
    capability: "external_network" as const,
    dataBoundary: "network" as const,
    scope: "resource_scope" as const,
    resourceScope: "current_domain" as const,
    resourceLabel,
    createdAt: "2026-07-29T10:00:00.000Z",
    expiresAt: "2026-08-29T10:00:00.000Z",
    canRevoke: true as const
  };
}

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost" });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) {
      this.addEventListener(name.replace(/^on/u, ""), listener);
    }
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value(this: HTMLElement, name: string, listener: EventListener) {
      this.removeEventListener(name.replace(/^on/u, ""), listener);
    }
  });
  return dom;
}

function createSettingsProfileTransferApi(): SettingsProfileTransferApi {
  return {
    exportProfile: vi.fn(async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "failed"
    })),
    previewImport: vi.fn(async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "failed"
    })),
    applyImport: vi.fn(async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "failed"
    }))
  };
}

function installAnimationFrame(dom: JSDOM): void {
  const requestAnimationFrame = (callback: FrameRequestCallback): number =>
    dom.window.setTimeout(() => callback(0), 0);
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: requestAnimationFrame
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: requestAnimationFrame
  });
}

function installMatchMedia(dom: JSDOM, matches: boolean): void {
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches,
      media: "(max-width: 520px)",
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true
    })
  });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0)
  });
}

function buttonNamed(container: ParentNode, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent ?? "")
      .replace(/\s+/g, "").trim() === name.replace(/\s+/g, ""));
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function requireElement<T>(value: T | null): T {
  if (!value) throw new Error("Required element not found.");
  return value;
}

function selectValue(dom: JSDOM, select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function inputValue(dom: JSDOM, input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function textareaValue(dom: JSDOM, input: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function piPackageRegistry(
  revision: number,
  packages: PiPackageRegistrySummary["packages"] = [],
  restorablePackages?: NonNullable<PiPackageRegistrySummary["restorablePackages"]>
): PiPackageRegistrySummary {
  return { apiVersion: 1, revision, packages, ...(restorablePackages ? { restorablePackages } : {}) };
}

function piPackageCatalogEntry(): PiPackageCatalogEntry {
  return {
    catalogId: "pi_catalog_reviewed_source",
    packageName: "reviewed-source-package",
    version: "1.2.3",
    integrity: `sha512-${"A".repeat(86)}==`,
    displayName: "Reviewed source helper",
    purpose: "Organizes selected source material with an inspectable workflow.",
    license: "MIT",
    packageTypes: ["skill"],
    capabilities: ["read_current_source"],
    dataBoundaries: ["local"],
    trust: "curated",
    source: "npm"
  };
}

async function emptyPiPackageCatalogQuery(
  request: PiPackageCatalogQueryRequest
): Promise<PiPackageCatalogQueryResult> {
  return { apiVersion: 1, requestId: request.requestId, status: "ready", entries: [], total: 0 };
}

function piPackage(
  packageId: `pkg_${string}`,
  packageName: string,
  overrides: Partial<PiPackageRegistrySummary["packages"][number]> = {}
): PiPackageRegistrySummary["packages"][number] {
  return {
    packageId,
    packageName,
    version: "1.0.0",
    state: "installed_disabled",
    packageTypes: ["extension"],
    dependencyCount: 0,
    enabled: false,
    canEnable: false,
    trust: "community",
    pinned: false,
    canUpdate: false,
    canRollback: false,
    rollbackTarget: null,
    ...overrides
  };
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function skillRegistry(
  revision: number,
  enabled: boolean,
  invalidManifestCount = 0,
  skills: SkillRegistrySummary["skills"] = [{
    id: "review-notes",
    name: "Review notes",
    version: "1.2.0",
    description: "Summarizes the current source for review.",
    scope: "machine_local",
    kind: "pure",
    enabled,
    trust: "user_confirmed",
    capabilities: ["read_current_source"],
    dataBoundaries: ["local"],
    canEnable: !enabled,
    canUninstall: true,
    canExport: true,
    canUpdate: true
  }]
): SkillRegistrySummary {
  return { apiVersion: 1, revision, invalidManifestCount, skills, restorableSkills: [] };
}

function memorySummary(
  revision: number,
  status: "active" | "disabled",
  activeVaultId = "vault_20260727_memoryfixture"
): MemorySummary {
  return {
    apiVersion: 1,
    activeVaultId,
    revision,
    records: [{
      id: "memory_20260727_concisestyle",
      kind: "preference",
      title: "Concise source summaries",
      body: "Keep source summaries concise and preserve citations.",
      status,
      provenance: { kind: "explicit_user_request", occurredAt: "2026-07-27T08:00:00.000Z" },
      createdAt: "2026-07-27T08:00:00.000Z",
      updatedAt: status === "active" ? "2026-07-27T08:00:00.000Z" : "2026-07-27T09:00:00.000Z"
    }]
  };
}

function memoryEmptySummary(revision: number): MemorySummary {
  return {
    apiVersion: 1,
    activeVaultId: "vault_20260727_memoryfixture",
    revision,
    records: []
  };
}

function memorySummaryWithText(
  revision: number,
  title: string,
  body: string,
): MemorySummary {
  const current = memorySummary(revision, "active");
  return {
    ...current,
    records: current.records.map((record) => ({ ...record, title, body })),
  };
}

function semanticAssetStatus(
  revision: number,
  assetState: LocalSemanticRetrievalAssetState
): LocalSemanticRetrievalStatus {
  return {
    apiVersion: 1,
    revision,
    assetId: LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID,
    assetState,
    downloadSizeBytes: LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES,
    lexicalSearchRemainsAvailable: true,
    ...(assetState === "installing" || assetState === "verifying"
      ? { activeJobId: "job_20260727_semanticasset" }
      : {})
  };
}

function semanticAssetApi(assetState: LocalSemanticRetrievalAssetState): LocalSemanticRetrievalApi {
  const unavailable = async (): Promise<never> => {
    throw new Error("Mutation is not used by this fixture.");
  };
  return {
    localSemanticStatus: async () => semanticAssetStatus(1, assetState),
    installLocalSemanticAsset: unavailable,
    enableLocalSemanticAsset: unavailable,
    disableLocalSemanticAsset: unavailable,
    removeLocalSemanticAsset: unavailable
  };
}

function paddleOcrSummary(revision: number, state: PaddleOcrLifecycleState): PaddleOcrSummary {
  const [canInstall, canEnable, canTest, canDisable, canRemove] = state === "not_installed"
    ? [true, false, false, false, false]
    : state === "ready"
      ? [false, false, true, true, true]
      : state === "disabled"
        ? [false, true, true, false, true]
        : state === "needs_repair"
          ? [false, false, false, false, true]
          : [false, false, false, false, false];
  return {
    apiVersion: 1,
    revision,
    engineId: "paddleocr_local",
    state,
    catalogVersion: "2026.07",
    components: [{
      componentId: "runtime",
      kind: "python_runtime",
      label: "Private Python /Users/private",
      version: "sha256:private",
      sizeBytes: 8 * 1024 * 1024
    }],
    downloadSizeBytes: 24 * 1024 * 1024,
    nativeOcrPreferred: true,
    hiddenDownloadsAllowed: false,
    canInstall,
    canEnable,
    canTest,
    canDisable,
    canRemove
  };
}

function paddleOcrApi(state: PaddleOcrLifecycleState): PaddleOcrApi {
  const unavailable = async (): Promise<never> => {
    throw new Error("Mutation is not used by this fixture.");
  };
  return {
    paddleOcrSummary: async () => paddleOcrSummary(1, state),
    installPaddleOcr: unavailable,
    enablePaddleOcr: unavailable,
    testPaddleOcr: unavailable,
    disablePaddleOcr: unavailable,
    removePaddleOcr: unavailable
  };
}

function activitySummary(operationId: string, createdAt: string): KnowledgeActivitySummary {
  return {
    operationId,
    kind: "update_page",
    createdAt,
    targetLabel: "Activity note",
    target: { kind: "page", pageId: "page_20260731_activitynote01" },
    status: "applied",
    canUndo: true
  };
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}
