import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type { BackupTrashPreferenceUpdateRequest } from "@pige/schemas";
import { BackupTrashPreferenceControl } from "../../apps/desktop/src/renderer/src/components/BackupTrashPreferenceControl";

const activeVaultId = "vault_20260801_trashbackup0001";
const revision = `backuptrashrev_${"a".repeat(64)}`;
const labels: Record<string, string> = {
  "backup.trashPreferenceTitle": "Recoverable trash",
  "backup.trashPreferenceDescription": "Include recoverable trash.",
  "backup.trashPreferenceInclude": "Included",
  "backup.trashPreferenceExclude": "Excluded",
  "backup.trashPreferenceUpdated": "Updated",
  "backup.trashPreferenceFailed": "Failed",
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

describe("BackupTrashPreferenceControl", () => {
  it("loads authoritative state and applies one exact CAS update", async () => {
    const requests: BackupTrashPreferenceUpdateRequest[] = [];
    const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true, url: "http://pige.test" });
    installDom(dom);
    Object.defineProperty(dom.window.crypto, "randomUUID", { configurable: true, value: () => "01234567-89ab-cdef-0123-456789abcdef" });
    Object.defineProperty(dom.window, "pige", { configurable: true, value: { backup: {
      trashPreferenceStatus: async () => ({ apiVersion: 1, activeVaultId, revision, includeTrash: true, canUpdate: true }),
      setTrashPreference: async (request: BackupTrashPreferenceUpdateRequest) => {
        requests.push(request);
        return { ...request, status: "updated" as const, summary: { apiVersion: 1 as const, activeVaultId, revision: `backuptrashrev_${"b".repeat(64)}`, includeTrash: false, canUpdate: true } };
      }
    } } });
    const container = dom.window.document.querySelector<HTMLElement>("#root")!;
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(BackupTrashPreferenceControl, { activeVaultId, disabled: false, t: (key) => labels[key] ?? key }));
      await settle(dom);
    });
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.textContent).toBe("Included");
    await act(async () => { toggle.click(); await settle(dom); });
    expect(Object.keys(requests[0] ?? {}).sort()).toEqual(["activeVaultId", "apiVersion", "expectedRevision", "includeTrash", "requestId"]);
    expect(JSON.stringify(requests[0])).not.toMatch(/path|body|prompt|message/iu);
    expect(toggle.textContent).toBe("Excluded");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Updated");
    await act(async () => root.unmount());
    dom.window.close();
  });
});

function installDom(dom: JSDOM): void {
  for (const key of globalKeys) originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent };
  for (const key of globalKeys) Object.defineProperty(globalThis, key, { configurable: true, value: values[key], writable: true });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
  await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(resolve)));
}
