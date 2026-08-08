import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MemorySummary,
  MemoryTrashRestoreRequest,
  MemoryTrashRestoreResult,
  MemoryTrashSummary
} from "@pige/contracts";
import { AgentMemoryTrashRestorePanel } from "../../apps/desktop/src/renderer/src/components/AgentMemoryTrashRestorePanel";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event"] as const;
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

describe("Agent Memory trash restore UI", () => {
  it("does not adopt a stale restore as committed memory state", async () => {
    const dom = installDom();
    const activeVaultId = "vault_20260809_memorytrash";
    const trash = memoryTrash(activeVaultId, 4);
    const summary = memorySummary(activeVaultId, 5);
    const listTrash = vi.fn(async () => trash);
    const restoreTrash = vi.fn(async (request: MemoryTrashRestoreRequest): Promise<MemoryTrashRestoreResult> => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId,
      status: "stale",
      summary,
      trash: memoryTrash(activeVaultId, 5)
    }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      memory: { listTrash, restoreTrash }
    } });
    const onCommitted = vi.fn();
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(AgentMemoryTrashRestorePanel, {
        activeVaultId,
        revision: 4,
        disabled: false,
        onCommitted,
        t
      }));
      await settle(dom);
    });
    const restore = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent === "Restore")!;
    restore.focus();
    await act(async () => {
      restore.click();
      await settle(dom);
    });
    expect(restoreTrash).toHaveBeenCalledOnce();
    expect(restoreTrash).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultId,
      expectedRevision: 4,
      memoryId: "memory_20260809_deleted"
    }));
    expect(onCommitted).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Restore is stale.");
    expect(container.querySelector("[data-memory-trash-id='memory_20260809_deleted']")).not.toBeNull();
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adopts a committed restore and moves focus to the trash heading when the row disappears", async () => {
    const dom = installDom();
    const activeVaultId = "vault_20260809_memorytrash";
    const trash = memoryTrash(activeVaultId, 4);
    const summary = memorySummary(activeVaultId, 5);
    const listTrash = vi.fn(async () => trash);
    const restoredTrash = { ...trash, revision: 5, records: [] };
    const restoreTrash = vi.fn(async (request: MemoryTrashRestoreRequest): Promise<MemoryTrashRestoreResult> => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId,
      status: "committed",
      operationId: "op_20260809_memoryrestore",
      summary,
      trash: restoredTrash
    }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: {
      memory: { listTrash, restoreTrash }
    } });
    const onCommitted = vi.fn();
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(AgentMemoryTrashRestorePanel, {
        activeVaultId,
        revision: 4,
        disabled: false,
        onCommitted,
        t
      }));
      await settle(dom);
    });
    const restore = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent === "Restore")!;
    await act(async () => {
      restore.click();
      await settle(dom);
    });
    expect(onCommitted).toHaveBeenCalledWith(summary);
    expect(container.querySelector("[data-memory-trash-id='memory_20260809_deleted']")).toBeNull();
    expect(dom.window.document.activeElement).toBe(container.querySelector<HTMLElement>("#memory-trash-title"));
    await act(async () => root.unmount());
    dom.window.close();
  });
});

function memoryTrash(activeVaultId: string, revision: number): MemoryTrashSummary {
  return {
    apiVersion: 1,
    activeVaultId,
    revision,
    records: [{
      memoryId: "memory_20260809_deleted",
      trashOperationId: "op_20260809_memorydelete",
      kind: "preference",
      title: "Deleted preference",
      trashedAt: "2026-08-09T08:00:00.000Z"
    }],
    resets: []
  };
}

function memorySummary(activeVaultId: string, revision: number): MemorySummary {
  return {
    apiVersion: 1,
    activeVaultId,
    revision,
    records: [{
      id: "memory_20260809_deleted",
      kind: "preference",
      title: "Restored preference",
      body: "Keep source summaries concise.",
      status: "active",
      provenance: { kind: "explicit_user_request", occurredAt: "2026-08-09T08:00:00.000Z" },
      createdAt: "2026-08-09T08:00:00.000Z",
      updatedAt: "2026-08-09T08:00:00.000Z"
    }]
  };
}

function t(key: string): string {
  return ({
    "memory.trashTitle": "Trash",
    "memory.trashDescription": "Recoverable memories.",
    "memory.trashLoading": "Loading trash…",
    "memory.trashLoadFailed": "Unable to load trash.",
    "memory.retryLoad": "Retry",
    "memory.trashEmpty": "Trash is empty.",
    "memory.trashRestore": "Restore",
    "memory.trashRestoring": "Restoring…",
    "memory.trashRestoreCompleted": "Memory restored.",
    "memory.trashRestoreStale": "Restore is stale.",
    "memory.trashRestoreNotFound": "Memory is no longer in Trash.",
    "memory.trashRestoreFailed": "Restore failed.",
    "memory.kind.preference": "Preference"
  }[key] ?? key);
}

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://pige.local" });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
  await Promise.resolve();
}
