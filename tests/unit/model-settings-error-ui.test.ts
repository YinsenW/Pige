import { createElement } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelProviderSettingsSummary, ProviderConnectResult } from "@pige/contracts";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
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

describe("Models error ownership", () => {
  it("owns an initial Models summary failure and retries only the summary read", async () => {
    const dom = createDom();
    const summary = presetSummary();
    let summaryReads = 0;
    const mount = await mountPanel(dom, summary, modelApi({}), {
      onRefreshModels: async () => {
        summaryReads += 1;
        if (summaryReads === 1) throw new Error("raw initial summary failure");
      }
    });
    await waitFor(dom, () => mount.container.textContent?.includes(enMessages["models.summaryRefreshFailed"]) === true);

    expect(mount.container.textContent).not.toContain("raw initial summary failure");
    expect(buttonsNamed(mount.container, "Retry")).toHaveLength(1);
    await click(dom, buttonNamed(mount.container, "Retry"));
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') === null);
    expect(summaryReads).toBe(2);

    await unmount(dom, mount.root);
  });

  it("ignores a stale mount-read failure after a newer provider refresh succeeds", async () => {
    const dom = createDom();
    const summary = connectedSummary();
    let summaryReads = 0;
    let rejectInitialRead: ((reason?: unknown) => void) | undefined;
    const mount = await mountPanel(dom, summary, modelApi({}), {
      onRefreshModels: () => {
        summaryReads += 1;
        if (summaryReads === 1) {
          return new Promise<void>((_resolve, reject) => {
            rejectInitialRead = reject;
          });
        }
        return Promise.resolve();
      }
    });

    await click(dom, buttonNamed(mount.container, "Refresh"));
    await waitFor(dom, () => summaryReads === 2);
    await act(async () => {
      rejectInitialRead?.(new Error("raw stale summary failure"));
      await settle(dom);
    });

    expect(mount.container.querySelector('[role="alert"]')).toBeNull();
    expect(mount.container.textContent).not.toContain("raw stale summary failure");
    expect(mount.container.textContent).not.toContain(enMessages["models.summaryRefreshFailed"]);

    await unmount(dom, mount.root);
  });

  it("keeps a preset probe failure inside its preset with one safe retry", async () => {
    const dom = createDom();
    let attempts = 0;
    const summary = presetSummary();
    const api = modelApi({
      addPresetProvider: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("raw upstream secret-shaped failure");
        return summary;
      }
    });
    const mount = await mountPanel(dom, summary, api);

    await setInput(dom, mount.container, "preset-key-openai", "synthetic-key");
    expect(buttonNamed(mount.container, "Connect").disabled).toBe(false);
    await click(dom, buttonNamed(mount.container, "Connect"));
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') !== null);

    expect(mount.container.textContent).toContain("The connection check failed. Check the API key and try again.");
    expect(mount.container.textContent).not.toContain("protocol, Base URL, model ID");
    expect(mount.container.textContent).not.toContain("raw upstream");
    expect(buttonsNamed(mount.container, "Retry")).toHaveLength(1);

    await click(dom, buttonNamed(mount.container, "Retry"));
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') === null);
    expect(attempts).toBe(2);
    expect(buttonsNamed(mount.container, "Connect")).toHaveLength(1);

    await unmount(dom, mount.root);
  });

  it("does not blame an omitted optional API key for a preset probe failure", async () => {
    const dom = createDom();
    const summary = presetSummary("optional_api_key");
    const api = modelApi({
      addPresetProvider: async () => {
        throw new Error("raw optional-auth provider failure");
      }
    });
    const mount = await mountPanel(dom, summary, api);

    await click(dom, buttonNamed(mount.container, "Connect"));
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') !== null);

    expect(mount.container.textContent).toContain(enMessages["models.presetConnectionFailedNoAuth"]);
    expect(mount.container.textContent).not.toContain("Check the API key");
    expect(mount.container.textContent).not.toContain("raw optional-auth provider failure");
    expect(buttonsNamed(mount.container, "Retry")).toHaveLength(1);

    await unmount(dom, mount.root);
  });

  it("uses custom-only technical repair copy and clears it when the panel is reopened", async () => {
    const dom = createDom();
    const summary = presetSummary();
    const api = modelApi({
      addManualProvider: async () => {
        throw new Error("private endpoint response");
      }
    });
    const first = await mountPanel(dom, summary, api);

    await setInput(dom, first.container, "provider-base-url", "https://example.invalid");
    await setInput(dom, first.container, "provider-key", "synthetic-key");
    expect(buttonNamed(first.container, "Test and Save").disabled).toBe(false);
    await click(dom, buttonNamed(first.container, "Test and Save"));
    await waitFor(dom, () => first.container.querySelector('[role="alert"]') !== null);

    expect(first.container.textContent).toContain("Check the protocol, Base URL, model ID, and API key");
    expect(first.container.textContent).not.toContain("private endpoint response");
    expect(buttonsNamed(first.container, "Retry")).toHaveLength(1);

    await unmount(dom, first.root, false);
    const reopened = await mountPanel(dom, summary, api);
    expect(reopened.container.querySelector('[role="alert"]')).toBeNull();
    expect(reopened.container.textContent).not.toContain("Check the protocol, Base URL, model ID, and API key");

    await unmount(dom, reopened.root);
  });

  it("owns discovery failure per provider with Retry and Add custom model", async () => {
    const dom = createDom();
    let refreshAttempts = 0;
    const summary = connectedSummary();
    const api = modelApi({
      refreshProviderModels: async () => {
        refreshAttempts += 1;
        if (refreshAttempts === 1) throw new Error("raw discovery body");
        return summary;
      }
    });
    const mount = await mountPanel(dom, summary, api);

    await click(dom, buttonNamed(mount.container, "Refresh"));
    await waitFor(dom, () => buttonsNamed(mount.container, "Retry").length === 1);
    expect(mount.container.textContent).toContain("Model refresh failed. Retry or add a custom model.");
    expect(mount.container.textContent).toContain("Add custom model");
    expect(mount.container.textContent).not.toContain("raw discovery body");

    await click(dom, buttonNamed(mount.container, "Retry"));
    await waitFor(dom, () => buttonsNamed(mount.container, "Refresh").length === 1);
    expect(refreshAttempts).toBe(2);
    expect(mount.container.textContent).not.toContain("Model refresh failed");

    await unmount(dom, mount.root);
  });

  it("does not repeat provider discovery after its commit when only the summary refresh fails", async () => {
    const dom = createDom();
    const summary = connectedSummary();
    let discoveryWrites = 0;
    let summaryReads = 0;
    const api = modelApi({
      refreshProviderModels: async () => {
        discoveryWrites += 1;
        return summary;
      }
    });
    const mount = await mountPanel(dom, summary, api, {
      onRefreshModels: async () => {
        summaryReads += 1;
        if (summaryReads === 2) throw new Error("raw post-commit summary failure");
      }
    });

    await click(dom, buttonNamed(mount.container, "Refresh"));
    await waitFor(dom, () => mount.container.textContent?.includes(enMessages["models.refreshAfterSaveFailed"]) === true);
    expect(discoveryWrites).toBe(1);
    expect(buttonsNamed(mount.container, "Retry")).toHaveLength(1);
    expect(mount.container.textContent).not.toContain("raw post-commit summary failure");

    await click(dom, buttonNamed(mount.container, "Retry"));
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') === null);
    expect(discoveryWrites).toBe(1);
    expect(summaryReads).toBe(3);

    await unmount(dom, mount.root);
  });

  it("retries only the refresh after a committed preset connection", async () => {
    const dom = createDom();
    const summary = presetSummary();
    let providerWrites = 0;
    let modelRefreshes = 0;
    let runtimeRefreshes = 0;
    const api = modelApi({
      addPresetProvider: async () => {
        providerWrites += 1;
        return summary;
      }
    });
    const mount = await mountPanel(dom, summary, api, {
      onRefreshModels: async () => {
        modelRefreshes += 1;
        if (modelRefreshes === 2) throw new Error("synthetic post-commit refresh failure");
      },
      onRefreshAgentRuntimeStatus: async () => {
        runtimeRefreshes += 1;
        throw new Error("synthetic unrelated runtime-status failure");
      }
    });

    await setInput(dom, mount.container, "preset-key-openai", "synthetic-key");
    await click(dom, buttonNamed(mount.container, "Connect"));
    await waitFor(dom, () => mount.container.textContent?.includes(enMessages["models.refreshAfterSaveFailed"]) === true);

    expect(providerWrites).toBe(1);
    expect(inputNamed(mount.container, "preset-key-openai").value).toBe("");
    expect(buttonsNamed(mount.container, "Retry")).toHaveLength(1);

    await click(dom, buttonNamed(mount.container, "Retry"));
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') === null);
    expect(providerWrites).toBe(1);
    expect(modelRefreshes).toBe(3);
    await waitFor(dom, () => runtimeRefreshes === 1);
    expect(mount.container.querySelector('[role="alert"]')).toBeNull();

    await unmount(dom, mount.root);
  });

  it("keeps a failed custom-model ID in its owning provider until retry succeeds", async () => {
    const dom = createDom();
    const summary = connectedSummary();
    let additions = 0;
    const api = modelApi({
      addManualModel: async () => {
        additions += 1;
        if (additions === 1) throw new Error("raw manual model failure");
        return summary;
      }
    });
    const mount = await mountPanel(dom, summary, api);

    await setInput(dom, mount.container, "custom-model-id-provider_fixture", "synthetic-model");
    await setInput(dom, mount.container, "custom-model-name-provider_fixture", "Synthetic model");
    await click(dom, buttonNamed(mount.container, "Add custom model"));
    await waitFor(dom, () => mount.container.textContent?.includes(enMessages["models.manualModelFailed"]) === true);

    expect(inputNamed(mount.container, "custom-model-id-provider_fixture").value).toBe("synthetic-model");
    expect(inputNamed(mount.container, "custom-model-name-provider_fixture").value).toBe("Synthetic model");
    expect(mount.container.textContent).not.toContain("raw manual model failure");
    expect(buttonsNamed(mount.container, "Retry")).toHaveLength(1);

    await click(dom, buttonNamed(mount.container, "Retry"));
    await waitFor(dom, () => inputNamed(mount.container, "custom-model-id-provider_fixture").value === "");
    expect(additions).toBe(2);
    expect(mount.container.querySelector('[role="alert"]')).toBeNull();

    await unmount(dom, mount.root);
  });
});

function presetSummary(
  authRequirement: "api_key" | "optional_api_key" | "none" = "api_key"
): ModelProviderSettingsSummary {
  return {
    presets: [{
      presetId: "openai",
      displayName: "OpenAI",
      providerKind: "openai",
      endpointProtocol: "openai_responses",
      authRequirement,
      fixedBaseUrl: "https://api.openai.com",
      modelListStrategy: "provider_api",
      cloudBoundary: "cloud"
    }],
    providers: [],
    models: [],
    hasDefaultModel: false,
    defaultBinding: { state: "not_configured" }
  };
}

function connectedSummary(): ModelProviderSettingsSummary {
  return {
    ...presetSummary(),
    providers: [{
      id: "provider_fixture",
      displayName: "Connected provider",
      providerKind: "openai",
      endpointProtocol: "openai_responses",
      authRequirement: "api_key",
      modelListStrategy: "provider_api",
      cloudBoundary: "cloud",
      createdAt: "2026-07-14T08:00:00.000Z",
      updatedAt: "2026-07-14T08:00:00.000Z"
    }]
  };
}

function modelApi(overrides: {
  readonly addPresetProvider?: () => Promise<ProviderConnectResult>;
  readonly addManualProvider?: () => Promise<ProviderConnectResult>;
  readonly refreshProviderModels?: () => Promise<ModelProviderSettingsSummary>;
  readonly addManualModel?: () => Promise<ModelProviderSettingsSummary>;
}): object {
  const summary = presetSummary();
  return {
    models: {
      summary: async () => summary,
      addPresetProvider: overrides.addPresetProvider ?? (async () => summary),
      addManualProvider: overrides.addManualProvider ?? (async () => summary),
      setDefaultModel: async () => summary,
      refreshProviderModels: overrides.refreshProviderModels ?? (async () => summary),
      addManualModel: overrides.addManualModel ?? (async () => summary),
      updateModel: async () => summary
    }
  };
}

async function mountPanel(
  dom: JSDOM,
  summary: ModelProviderSettingsSummary,
  api: object,
  callbacks: {
    readonly onRefreshModels?: () => Promise<void>;
    readonly onRefreshAgentRuntimeStatus?: () => Promise<void>;
  } = {}
): Promise<{ readonly container: HTMLElement; readonly root: Root }> {
  Object.defineProperty(dom.window, "pige", { configurable: true, value: api });
  const [{ createRoot }, { ModelSettingsPanel }] = await Promise.all([
    import("react-dom/client"),
    import("../../apps/desktop/src/renderer/src/App")
  ]);
  const container = requireElement(dom.window.document.getElementById("root"));
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ModelSettingsPanel, {
      busy: false,
      modelSummary: summary,
      onRefreshModels: callbacks.onRefreshModels ?? (async () => undefined),
      onRefreshAgentRuntimeStatus: callbacks.onRefreshAgentRuntimeStatus ?? (async () => undefined),
      onBusy: () => undefined,
      t
    }));
    await settle(dom);
  });
  return { container, root };
}

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://pige.local/"
  });
  installDom(dom);
  return dom;
}

function installDom(dom: JSDOM): void {
  for (const key of globalKeys) originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values: Record<(typeof globalKeys)[number], unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
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

async function setInput(dom: JSDOM, container: HTMLElement, id: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`Input not found: ${id}`);
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Input setter not found.");
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle(dom);
  });
}

async function click(dom: JSDOM, element: HTMLButtonElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = buttonsNamed(container, name)[0];
  if (!button) throw new Error(`Button not found: ${name}`);
  return button;
}

function inputNamed(container: HTMLElement, id: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`Input not found: ${id}`);
  return input;
}

function buttonsNamed(container: HTMLElement, name: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .filter((button) => button.textContent === name);
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await act(async () => settle(dom));
  }
  throw new Error("Timed out waiting for UI state.");
}

async function unmount(dom: JSDOM, root: Root, close = true): Promise<void> {
  await act(async () => root.unmount());
  if (close) dom.window.close();
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function requireElement(element: HTMLElement | null): HTMLElement {
  if (!element) throw new Error("Expected test container.");
  return element;
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}
