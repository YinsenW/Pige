import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RestoreRollbackPrepareRequest,
  RestoreRollbackPrepareResult,
  RestoreRollbackStatus
} from "@pige/contracts";
import { BackupRestoreRollbackAction } from "../../apps/desktop/src/renderer/src/components/BackupRestoreRollbackAction";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLButtonElement", "Event"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globals) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Backup rollback restore action", () => {
  it("retains the exact candidate and restores focus for stale preparation, then permits retry", async () => {
    const dom = installDom();
    const activeVaultId = "vault_20260809_rollback";
    const candidate = {
      activeVaultId,
      restoreJobId: "job_20260809_rollback01",
      expectedRestoreJobUpdatedAt: "2026-08-09T08:00:00.000Z"
    } as const;
    const rollbackRestoreStatus = vi.fn(async (): Promise<RestoreRollbackStatus> => ({
      apiVersion: 1,
      status: "ready",
      candidate
    }));
    const prepareRollbackRestore = vi.fn(async (request: RestoreRollbackPrepareRequest): Promise<RestoreRollbackPrepareResult> => ({
      ...request,
      status: "stale"
    }));
    const onPreview = vi.fn(async () => undefined);
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      backup: { rollbackRestoreStatus, prepareRollbackRestore }
    } });
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(BackupRestoreRollbackAction, {
        activeVaultId,
        disabled: false,
        restoreIdle: true,
        onPreview,
        t
      }));
      await settle(dom);
    });
    const trigger = button(container, "Restore previous state");
    trigger.focus();
    await act(async () => {
      trigger.click();
      await settle(dom);
    });
    expect(prepareRollbackRestore).toHaveBeenCalledWith(expect.objectContaining(candidate));
    expect(onPreview).not.toHaveBeenCalled();
    expect(container.textContent).toContain("The backup stopped safely.");
    expect(button(container, "Restore previous state")).toBe(trigger);
    expect(dom.window.document.activeElement).toBe(trigger);
    const retry = button(container, "Retry");
    await act(async () => {
      retry.click();
      await settle(dom);
    });
    expect(prepareRollbackRestore).toHaveBeenCalledTimes(2);
    expect(button(container, "Restore previous state")).toBe(trigger);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fails closed when no rollback candidate is available", async () => {
    const harness = await mountRollback({
      activeVaultId: "vault_20260809_unavailable",
      status: async () => ({ apiVersion: 1, status: "unavailable" }),
      prepare: vi.fn()
    });
    expect(harness.container.querySelector("button")).toBeNull();
    await harness.unmount();
  });

  it.each(["not_found", "failed"] as const)("retains the candidate after a %s preparation result", async (status) => {
    const activeVaultId = "vault_20260809_prepare_failure";
    const candidate = rollbackCandidate(activeVaultId, "failure");
    const prepare = vi.fn(async (request: RestoreRollbackPrepareRequest): Promise<RestoreRollbackPrepareResult> => ({
      ...request,
      status
    }));
    const harness = await mountRollback({
      activeVaultId,
      status: async () => ({ apiVersion: 1, status: "ready", candidate }),
      prepare
    });
    const trigger = button(harness.container, "Restore previous state");
    trigger.focus();
    await act(async () => { trigger.click(); await settle(harness.dom); });
    expect(prepare).toHaveBeenCalledOnce();
    expect(button(harness.container, "Restore previous state")).toBe(trigger);
    expect(button(harness.container, "Retry")).not.toBeNull();
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("retains the candidate when opening the preview rejects", async () => {
    const activeVaultId = "vault_20260809_preview_failure";
    const candidate = rollbackCandidate(activeVaultId, "preview");
    const prepare = vi.fn(async (request: RestoreRollbackPrepareRequest): Promise<RestoreRollbackPrepareResult> => ({
      ...request,
      status: "prepared",
      preview: {} as never
    }));
    const onPreview = vi.fn(async () => { throw new Error("preview_failed"); });
    const harness = await mountRollback({
      activeVaultId,
      status: async () => ({ apiVersion: 1, status: "ready", candidate }),
      prepare,
      onPreview
    });
    await act(async () => { button(harness.container, "Restore previous state").click(); await settle(harness.dom); });
    expect(onPreview).toHaveBeenCalledOnce();
    expect(button(harness.container, "Restore previous state")).not.toBeNull();
    expect(button(harness.container, "Retry")).not.toBeNull();
    await harness.unmount();
  });

  it("recovers a rejected status through Retry", async () => {
    const dom = installDom();
    const activeVaultId = "vault_20260809_status_retry";
    const candidate = rollbackCandidate(activeVaultId, "status-retry");
    const refreshedVaultId = `${activeVaultId}_refresh`;
    const refreshedCandidate = rollbackCandidate(refreshedVaultId, "status-retry-refresh");
    let statusCalls = 0;
    const rollbackRestoreStatus = vi.fn(async (): Promise<RestoreRollbackStatus> => {
      statusCalls += 1;
      if (statusCalls === 1) return { apiVersion: 1, status: "ready", candidate };
      if (statusCalls === 2) throw new Error("status_unavailable");
      return { apiVersion: 1, status: "ready", candidate: refreshedCandidate };
    });
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      backup: { rollbackRestoreStatus, prepareRollbackRestore: vi.fn() }
    } });
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(BackupRestoreRollbackAction, {
        activeVaultId, disabled: false, restoreIdle: true, onPreview: vi.fn(async () => undefined), t
      }));
      await settle(dom);
    });
    expect(button(container, "Restore previous state")).not.toBeNull();
    const oldTrigger = button(container, "Restore previous state");
    oldTrigger.focus();
    await act(async () => {
      root.render(createElement(BackupRestoreRollbackAction, {
        activeVaultId: refreshedVaultId, disabled: false, restoreIdle: true,
        onPreview: vi.fn(async () => undefined), t
      }));
      await settle(dom);
    });
    expect(container.textContent).toContain("The backup stopped safely.");
    const retry = button(container, "Retry");
    await act(async () => { retry.click(); await settle(dom); });
    expect(statusCalls).toBe(3);
    expect(button(container, "Restore previous state")).toBeTruthy();
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("ignores a late old-vault status while the new candidate is active", async () => {
    const dom = installDom();
    const firstVault = "vault_20260809_old";
    const secondVault = "vault_20260809_new";
    const firstCandidate = rollbackCandidate(firstVault, "old");
    const secondCandidate = rollbackCandidate(secondVault, "new");
    const firstStatus = deferred<RestoreRollbackStatus>();
    let statusCalls = 0;
    const rollbackRestoreStatus = vi.fn(() => {
      statusCalls += 1;
      return statusCalls === 1
        ? firstStatus.promise
        : Promise.resolve({ apiVersion: 1 as const, status: "ready" as const, candidate: secondCandidate });
    });
    const prepareRollbackRestore = vi.fn(async (request: RestoreRollbackPrepareRequest): Promise<RestoreRollbackPrepareResult> => ({
      ...request,
      status: "stale"
    }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      backup: { rollbackRestoreStatus, prepareRollbackRestore }
    } });
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(BackupRestoreRollbackAction, {
        activeVaultId: firstVault, disabled: false, restoreIdle: true, onPreview: vi.fn(async () => undefined), t
      }));
      await settle(dom);
    });
    await act(async () => {
      root.render(createElement(BackupRestoreRollbackAction, {
        activeVaultId: secondVault, disabled: false, restoreIdle: true, onPreview: vi.fn(async () => undefined), t
      }));
      await settle(dom);
    });
    expect(button(container, "Restore previous state")).not.toBeNull();
    firstStatus.resolve({ apiVersion: 1, status: "ready", candidate: firstCandidate });
    await act(async () => { await settle(dom); });
    expect(prepareRollbackRestore).not.toHaveBeenCalled();
    await act(async () => { button(container, "Restore previous state").click(); await settle(dom); });
    expect(prepareRollbackRestore).toHaveBeenCalledOnce();
    expect(prepareRollbackRestore).toHaveBeenLastCalledWith(expect.objectContaining({
      activeVaultId: secondVault,
      restoreJobId: secondCandidate.restoreJobId
    }));
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("ignores a late preparation result after the active vault changes", async () => {
    const dom = installDom();
    const firstVault = "vault_20260809_prepare_old";
    const secondVault = "vault_20260809_prepare_new";
    const firstCandidate = rollbackCandidate(firstVault, "prepare-old");
    const secondCandidate = rollbackCandidate(secondVault, "prepare-new");
    const oldPrepare = deferred<RestoreRollbackPrepareResult>();
    let statusCalls = 0;
    const rollbackRestoreStatus = vi.fn(async (): Promise<RestoreRollbackStatus> => {
      statusCalls += 1;
      return statusCalls === 1
        ? { apiVersion: 1, status: "ready", candidate: firstCandidate }
        : { apiVersion: 1, status: "ready", candidate: secondCandidate };
    });
    let prepareCalls = 0;
    let oldRequest: RestoreRollbackPrepareRequest | undefined;
    const prepareRollbackRestore = vi.fn(async (request: RestoreRollbackPrepareRequest): Promise<RestoreRollbackPrepareResult> => {
      prepareCalls += 1;
      oldRequest = request;
      return oldPrepare.promise;
    });
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      backup: { rollbackRestoreStatus, prepareRollbackRestore }
    } });
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(BackupRestoreRollbackAction, {
        activeVaultId: firstVault, disabled: false, restoreIdle: true, onPreview: vi.fn(async () => undefined), t
      }));
      await settle(dom);
    });
    const oldTrigger = button(container, "Restore previous state");
    await act(async () => { oldTrigger.click(); await settle(dom); });
    expect(prepareCalls).toBe(1);
    await act(async () => {
      root.render(createElement(BackupRestoreRollbackAction, {
        activeVaultId: secondVault, disabled: false, restoreIdle: true, onPreview: vi.fn(async () => undefined), t
      }));
      await settle(dom);
    });
    const newTrigger = button(container, "Restore previous state");
    oldPrepare.resolve({ ...oldRequest!, status: "stale" });
    await act(async () => { await settle(dom); });
    expect(button(container, "Restore previous state")).toBe(newTrigger);
    expect(container.textContent).not.toContain("The backup stopped safely.");
    await act(async () => { button(container, "Restore previous state").click(); await settle(dom); });
    expect(prepareCalls).toBe(2);
    await act(async () => root.unmount());
    dom.window.close();
  });
});

type RollbackHarness = {
  readonly dom: JSDOM;
  readonly container: HTMLElement;
  unmount(): Promise<void>;
};

async function mountRollback(input: {
  readonly activeVaultId: string;
  readonly status: () => Promise<RestoreRollbackStatus>;
  readonly prepare: ReturnType<typeof vi.fn>;
  readonly onPreview?: ReturnType<typeof vi.fn>;
}): Promise<RollbackHarness> {
  const dom = installDom();
  Object.defineProperty(dom.window, "pige", { configurable: true, value: {
    backup: { rollbackRestoreStatus: input.status, prepareRollbackRestore: input.prepare }
  } });
  const container = dom.window.document.querySelector<HTMLElement>("#root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(BackupRestoreRollbackAction, {
      activeVaultId: input.activeVaultId,
      disabled: false,
      restoreIdle: true,
      onPreview: input.onPreview ?? vi.fn(async () => undefined),
      t
    }));
    await settle(dom);
  });
  return { dom, container, async unmount() { await act(async () => root.unmount()); dom.window.close(); } };
}

function rollbackCandidate(activeVaultId: string, suffix: string) {
  return {
    activeVaultId,
    restoreJobId: `job_20260809_${suffix}`,
    expectedRestoreJobUpdatedAt: "2026-08-09T08:00:00.000Z"
  } as const;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function t(key: string): string {
  return ({
    "backup.restorePrevious": "Restore previous state",
    "backup.restorePreviousDescription": "Review the protected snapshot created before the last replacement restore.",
    "backup.opening": "Opening...",
    "backup.failedRetryable": "The backup stopped safely. Retry continues with the same backup identity.",
    "confirmation.retry": "Retry"
  }[key] ?? key);
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const match = [...root.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text);
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://pige.local" });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0)
  });
  return dom;
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
  await Promise.resolve();
}
