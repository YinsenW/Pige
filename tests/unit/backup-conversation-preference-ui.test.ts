import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackupConversationPreferenceUpdateRequest, BackupConversationPreferenceUpdateResult } from "@pige/schemas";
import { BackupConversationPreferenceControl } from "../../apps/desktop/src/renderer/src/components/BackupConversationPreferenceControl";

const activeVaultId = "vault_20260801_conversationbackup01";
const revision = `backupconversationrev_${"a".repeat(64)}`;
const labels: Record<string, string> = {
  "backup.conversationPreferenceTitle": "Conversation history",
  "backup.conversationPreferenceDescription": "Include durable conversation history.",
  "backup.conversationPreferenceInclude": "Included",
  "backup.conversationPreferenceExclude": "Excluded",
  "backup.conversationPreferenceUpdated": "Updated",
  "backup.conversationPreferenceBlocked": "Blocked",
  "backup.conversationPreferenceStale": "Stale",
  "backup.conversationPreferenceFailed": "Failed",
  "backup.loading": "Loading"
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

describe("BackupConversationPreferenceControl", () => {
  it("loads authoritative state and applies one exact CAS update without path authority", async () => {
    const requests: BackupConversationPreferenceUpdateRequest[] = [];
    const { dom, container, root } = await mount(async (request) => {
      requests.push(request);
      return { ...request, status: "updated", summary: { apiVersion: 1, activeVaultId, revision: `backupconversationrev_${"b".repeat(64)}`, includeConversations: false, canUpdate: true } };
    });
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.textContent).toBe("Included");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    toggle.focus();
    await click(dom, toggle);
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual(["activeVaultId", "apiVersion", "expectedRevision", "includeConversations", "requestId"]);
    expect(JSON.stringify(requests[0])).not.toMatch(/path|body|prompt|message/iu);
    expect(toggle.textContent).toBe("Excluded");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Updated");
    expect(dom.window.document.activeElement).toBe(toggle);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adopts stale/blocked authority and retains visible state on failure", async () => {
    let outcome: "stale" | "blocked" | "failed" = "stale";
    const update = vi.fn(async (request: BackupConversationPreferenceUpdateRequest): Promise<BackupConversationPreferenceUpdateResult> => {
      if (outcome === "failed") throw new Error("offline");
      return { apiVersion: 1, requestId: request.requestId, activeVaultId, status: outcome,
        summary: { apiVersion: 1, activeVaultId, revision, includeConversations: true, canUpdate: outcome !== "blocked" } };
    });
    const { dom, container, root } = await mount(update);
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await click(dom, toggle);
    expect(toggle.textContent).toBe("Included");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Stale");
    outcome = "failed";
    await click(dom, toggle);
    expect(toggle.textContent).toBe("Included");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Failed");
    expect(update).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    dom.window.close();
  });
});

async function mount(update: (request: BackupConversationPreferenceUpdateRequest) => Promise<BackupConversationPreferenceUpdateResult>) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true, url: "http://pige.test" });
  installDom(dom);
  Object.defineProperty(dom.window.crypto, "randomUUID", { configurable: true, value: () => "01234567-89ab-cdef-0123-456789abcdef" });
  Object.defineProperty(dom.window, "pige", { configurable: true, value: { backup: {
    conversationPreferenceStatus: async () => ({ apiVersion: 1, activeVaultId, revision, includeConversations: true, canUpdate: true }),
    setConversationPreference: update
  } } });
  const container = dom.window.document.querySelector<HTMLElement>("#root")!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(BackupConversationPreferenceControl, { activeVaultId, disabled: false, t: (key) => labels[key] ?? key }));
    await settle(dom);
  });
  return { dom, container, root };
}

function installDom(dom: JSDOM): void {
  for (const key of globalKeys) originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent };
  for (const key of globalKeys) Object.defineProperty(globalThis, key, { configurable: true, value: values[key], writable: true });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
}
async function click(dom: JSDOM, element: HTMLElement): Promise<void> {
  await act(async () => { element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await settle(dom); });
}
async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
  await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(resolve)));
}
