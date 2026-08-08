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
});

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
