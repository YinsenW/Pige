import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelProviderSettingsSummary, ProviderProfileSummary } from "@pige/contracts";
import { ProviderProfileEditPanel } from "../../apps/desktop/src/renderer/src/components/ProviderProfileEditPanel";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Event", "MouseEvent", "requestAnimationFrame"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
const provider: ProviderProfileSummary = {
  id: "provider_custom_edit",
  displayName: "Old compatible",
  providerKind: "custom",
  endpointProtocol: "openai_chat_completions",
  authRequirement: "api_key",
  baseUrl: "https://old.example/v1",
  modelListStrategy: "manual_only",
  cloudBoundary: "unknown",
  boundaryVerification: "user_asserted",
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z"
};

afterEach(() => {
  for (const key of globals) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Provider Profile edit panel", () => {
  it("submits one revision-bound reconnect and adopts only the matching authoritative Provider", async () => {
    const updateProviderProfile = vi.fn(async () => summary({
      ...provider, displayName: "New compatible", baseUrl: "https://new.example/v1",
      cloudBoundary: "self_hosted", updatedAt: "2026-08-02T00:01:00.000Z"
    }));
    const onRefresh = vi.fn(async () => summary(provider));
    const harness = await mount(updateProviderProfile, onRefresh);
    const edit = button(harness.container, "Edit connection");
    await act(async () => { edit.click(); await settle(harness.dom); });
    const inputs = harness.container.querySelectorAll<HTMLInputElement>("input");
    await act(async () => { change(inputs[0]!, "New compatible"); change(inputs[1]!, "https://new.example/v1");
      change(harness.container.querySelector("select")!, "self_hosted"); await settle(harness.dom); });
    const save = button(harness.container, "Save and reconnect");
    await act(async () => { save.click(); save.click(); await settle(harness.dom); await settle(harness.dom); });
    await act(async () => { await settle(harness.dom); });

    expect(updateProviderProfile).toHaveBeenCalledTimes(1);
    expect(updateProviderProfile).toHaveBeenCalledWith({
      providerProfileId: provider.id,
      expectedRevision: `sha256:${"a".repeat(64)}`,
      displayName: "New compatible",
      baseUrl: "https://new.example/v1",
      cloudBoundary: "self_hosted"
    });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(harness.container.textContent).toContain("Saved");
    expect(harness.dom.window.document.activeElement?.textContent).toBe("Edit connection");
    await harness.unmount();
  });

  it("retains the exact draft and edit focus after a body-free failure", async () => {
    const updateProviderProfile = vi.fn(async () => { throw new Error("private endpoint body"); });
    const harness = await mount(updateProviderProfile, vi.fn(async () => null));
    await act(async () => { button(harness.container, "Edit connection").click(); await settle(harness.dom); });
    const inputs = harness.container.querySelectorAll<HTMLInputElement>("input");
    await act(async () => { change(inputs[0]!, "Retained draft"); change(inputs[1]!, "https://failed.example/v1");
      await settle(harness.dom); });
    const save = button(harness.container, "Save and reconnect"); save.focus();
    await act(async () => { save.click(); await settle(harness.dom); });
    expect(inputs[0]?.value).toBe("Retained draft");
    expect(inputs[1]?.value).toBe("https://failed.example/v1");
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toBe("Failed");
    expect(harness.container.textContent).not.toContain("private endpoint body");
    await harness.unmount();
  });

  it("does not render endpoint editing for a reviewed preset", async () => {
    const harness = await mount(vi.fn(), vi.fn(), { ...provider, presetId: "openai" });
    expect(harness.container.textContent).toBe("");
    await harness.unmount();
  });
});

function summary(nextProvider: ProviderProfileSummary): ModelProviderSettingsSummary {
  return { revision: `sha256:${"b".repeat(64)}`, presets: [], providers: [nextProvider], models: [],
    hasDefaultModel: false, defaultBinding: { state: "not_configured" } };
}

async function mount(updateProviderProfile: (...args: never[]) => Promise<unknown>, onRefresh: () => Promise<ModelProviderSettingsSummary | null>, nextProvider = provider) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  installDom(dom);
  Object.defineProperty(dom.window, "pige", { configurable: true, value: { models: { updateProviderProfile } } });
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => { root.render(createElement(ProviderProfileEditPanel, {
    provider: nextProvider, expectedRevision: `sha256:${"a".repeat(64)}`, busy: false,
    onBusy: vi.fn(), onRefresh, t: (key: string) => ({
      "models.editConnection": "Edit connection", "models.editConnectionDescription": "Description",
      "field.name": "Name", "models.baseUrl": "Base URL", "models.boundary": "Boundary",
      "models.cloud": "Cloud", "models.selfHosted": "Self-hosted", "models.unknown": "Unknown",
      "models.cancel": "Cancel", "models.saveConnection": "Save and reconnect",
      "models.savingConnection": "Checking", "models.connectionEdit.saved": "Saved",
      "models.connectionEdit.failed": "Failed"
    }[key] ?? key)
  })); await settle(dom); });
  return { dom, container: dom.window.document.querySelector("#root")!, unmount: async () => {
    await act(async () => root.unmount()); dom.window.close();
  } };
}

function button(container: Element, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

function change(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  element.focus();
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(element, value);
  const EventConstructor = element.ownerDocument.defaultView!.Event;
  if (element instanceof HTMLInputElement) {
    const propertyChange = new EventConstructor("propertychange", { bubbles: true });
    Object.defineProperty(propertyChange, "propertyName", { value: "value" });
    element.dispatchEvent(propertyChange);
    element.dispatchEvent(new element.ownerDocument.defaultView!.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  }
  element.dispatchEvent(new EventConstructor("change", { bubbles: true }));
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function installDom(dom: JSDOM): void {
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value(this: HTMLElement, name: string, listener: EventListener) { this.addEventListener(name.replace(/^on/u, ""), listener); } },
    detachEvent: { configurable: true, value(this: HTMLElement, name: string, listener: EventListener) { this.removeEventListener(name.replace(/^on/u, ""), listener); } }
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0) });
  Object.defineProperty(dom.window, "requestAnimationFrame", { configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0) });
}
