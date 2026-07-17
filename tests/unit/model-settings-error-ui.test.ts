import { createElement } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ModelProviderSettingsSummary,
  ProviderConnectResult,
  ProviderProfileSummary
} from "@pige/contracts";
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

    await openProviderDetails(dom, mount.container);
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

    await openPreset(dom, mount.container, "OpenAI");
    await setInput(dom, mount.container, "preset-key-openai", "synthetic-key");
    expect(buttonNamed(mount.container, enMessages["models.connectService"]).disabled).toBe(false);
    await click(dom, buttonNamed(mount.container, enMessages["models.connectService"]));
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') !== null);

    expect(inputNamed(mount.container, "preset-key-openai").value).toBe("synthetic-key");
    expect(mount.container.textContent).toContain("Connect OpenAI");
    expect(mount.container.textContent).toContain("The connection check failed. Check the API key and try again.");
    expect(mount.container.textContent).not.toContain("protocol, Base URL, model ID");
    expect(mount.container.textContent).not.toContain("raw upstream");
    expect(buttonsNamed(mount.container, "Retry")).toHaveLength(1);

    await click(dom, buttonNamed(mount.container, "Retry"));
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') === null);
    expect(attempts).toBe(2);
    expect(mount.container.textContent).toContain(enMessages["models.globalDefault"]);
    expect(mount.container.querySelector("#preset-key-openai")).toBeNull();

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

    await openPreset(dom, mount.container, "OpenAI");
    await click(dom, buttonNamed(mount.container, enMessages["models.connectService"]));
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

    await openCustomProvider(dom, first.container);
    await setInput(dom, first.container, "provider-base-url", "https://example.invalid");
    await setInput(dom, first.container, "provider-key", "synthetic-key");
    expect(buttonNamed(first.container, enMessages["models.connectAndCheck"]).disabled).toBe(false);
    await click(dom, buttonNamed(first.container, enMessages["models.connectAndCheck"]));
    await waitFor(dom, () => first.container.querySelector('[role="alert"]') !== null);

    expect(first.container.textContent).toContain("Check the protocol, Base URL, model ID, and API key");
    expect(first.container.textContent).not.toContain("private endpoint response");
    expect(buttonsNamed(first.container, "Retry")).toHaveLength(1);

    await unmount(dom, first.root, false);
    const reopened = await mountPanel(dom, summary, api);
    expect(reopened.container.querySelector('[role="alert"]')).toBeNull();
    expect(reopened.container.textContent).not.toContain("Check the protocol, Base URL, model ID, and API key");
    expect(reopened.container.querySelector("#provider-base-url")).toBeNull();

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

    await openProviderDetails(dom, mount.container);
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

    await openProviderDetails(dom, mount.container);
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

    await openPreset(dom, mount.container, "OpenAI");
    await setInput(dom, mount.container, "preset-key-openai", "synthetic-key");
    await click(dom, buttonNamed(mount.container, enMessages["models.connectService"]));
    await waitFor(dom, () => mount.container.textContent?.includes(enMessages["models.refreshAfterSaveFailed"]) === true);

    expect(providerWrites).toBe(1);
    expect(buttonsNamed(mount.container, "Retry")).toHaveLength(1);

    await click(dom, buttonNamed(mount.container, "Retry"));
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') === null);
    expect(providerWrites).toBe(1);
    expect(modelRefreshes).toBe(3);
    await waitFor(dom, () => runtimeRefreshes === 1);
    expect(mount.container.querySelector('[role="alert"]')).toBeNull();

    await openPreset(dom, mount.container, "OpenAI");
    expect(inputNamed(mount.container, "preset-key-openai").value).toBe("");

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

    await openProviderDetails(dom, mount.container);
    await click(dom, summaryNamed(mount.container, enMessages["models.addCustomModel"]));
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

  it("keeps the approved progressive Models structure without exposing routing controls", async () => {
    const dom = createDom();
    const mount = await mountPanel(dom, connectedSummary(), modelApi({}));

    const globalDefault = mount.container.textContent?.indexOf(enMessages["models.globalDefault"]) ?? -1;
    const services = mount.container.textContent?.indexOf(enMessages["models.services"]) ?? -1;
    expect(globalDefault).toBeGreaterThanOrEqual(0);
    expect(services).toBeGreaterThan(globalDefault);
    expect(mount.container.querySelector("#preset-key-openai")).toBeNull();
    expect(mount.container.querySelector("#provider-base-url")).toBeNull();
    const interactiveCopy = Array.from(mount.container.querySelectorAll("button, select, input"))
      .map((control) => control.getAttribute("aria-label") ?? control.textContent ?? "")
      .join(" ");
    expect(interactiveCopy).not.toMatch(/Advanced Model|Fast Model|model routing/i);

    await click(dom, buttonNamed(mount.container, enMessages["models.addProvider"]));
    expect(mount.container.textContent).toContain(enMessages["models.reviewedProviders"]);
    expect(mount.container.querySelector("#preset-key-openai")).toBeNull();

    await click(dom, buttonContaining(mount.container, "OpenAI"));
    expect(mount.container.querySelector("#preset-key-openai")).not.toBeNull();
    expect(mount.container.querySelector("#provider-base-url")).toBeNull();

    await click(dom, buttonNamed(mount.container, enMessages["models.backToProviders"]));
    await click(dom, buttonContaining(mount.container, enMessages["models.customProvider"]));
    expect(mount.container.querySelector("#provider-base-url")).not.toBeNull();
    expect(mount.container.querySelector("#provider-protocol")).not.toBeNull();

    await unmount(dom, mount.root);
  });

  it("shows configured, discovery, generation, and failed generation as distinct provider truth", async () => {
    const cases = [
      [undefined, enMessages["models.statusConfigured"]],
      [{ discovery: "verified", generation: "not_checked" } as const, enMessages["models.statusDiscoveryVerified"]],
      [{ discovery: "verified", generation: "verified" } as const, enMessages["models.statusGenerationVerified"]],
      [{ discovery: "verified", generation: "failed" } as const, enMessages["models.statusGenerationFailed"]]
    ] as const;

    for (const [runtimeStatus, expectedStatus] of cases) {
      const dom = createDom();
      const mount = await mountPanel(dom, connectedSummary(runtimeStatus), modelApi({}));
      const status = mount.container.querySelector<HTMLElement>(".model-provider-card .settings-status");
      expect(status?.textContent).toBe(expectedStatus);
      expect(status?.textContent).not.toBe(enMessages["models.connected"]);
      if (runtimeStatus?.generation === "not_checked") {
        expect(mount.container.textContent).not.toContain(enMessages["models.statusGenerationVerified"]);
      }
      await unmount(dom, mount.root);
    }
  });

  it("removes the redundant overview model-list controls and keeps management progressive", async () => {
    const dom = createDom();
    const mount = await mountPanel(dom, connectedSummary(), modelApi({}));

    expect(buttonsNamed(mount.container, enMessages["library.refresh"])).toHaveLength(0);
    expect(buttonsNamed(mount.container, enMessages["models.addCustomModel"])).toHaveLength(0);
    expect(buttonsNamed(mount.container, enMessages["models.manage"])).toHaveLength(1);

    await openProviderDetails(dom, mount.container);
    expect(buttonsNamed(mount.container, enMessages["library.refresh"])).toHaveLength(1);
    expect(mount.container.textContent).toContain(enMessages["models.replaceCredential"]);

    await unmount(dom, mount.root);
  });

  it("replaces a provider credential using the latest revision without displaying a saved key", async () => {
    const dom = createDom();
    const summary = connectedSummary();
    let request: { providerProfileId: string; expectedRevision: string; apiKey: string } | undefined;
    const api = modelApi({
      updateProviderCredential: async (nextRequest) => {
        request = nextRequest;
        return summary;
      }
    });
    const mount = await mountPanel(dom, summary, api);

    await openProviderDetails(dom, mount.container);
    const input = inputNamed(mount.container, "provider-credential-provider_fixture");
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
    await setInput(dom, mount.container, input.id, "synthetic-replacement-key");
    await click(dom, buttonNamed(mount.container, enMessages["models.updateCredential"]));
    await waitFor(dom, () => mount.container.textContent?.includes(enMessages["models.credentialUpdated"]) === true);

    expect(request).toEqual({
      providerProfileId: "provider_fixture",
      expectedRevision: summary.revision,
      apiKey: "synthetic-replacement-key"
    });
    expect(inputNamed(mount.container, input.id).value).toBe("");
    expect(mount.container.textContent).not.toContain("synthetic-replacement-key");

    await unmount(dom, mount.root);
  });

  it("keeps the replacement draft and body-free failure when credential validation fails", async () => {
    const dom = createDom();
    const summary = connectedSummary();
    const api = modelApi({
      updateProviderCredential: async () => {
        throw new Error("raw provider credential response");
      }
    });
    const mount = await mountPanel(dom, summary, api);

    await openProviderDetails(dom, mount.container);
    await setInput(dom, mount.container, "provider-credential-provider_fixture", "synthetic-replacement-key");
    await click(dom, buttonNamed(mount.container, enMessages["models.updateCredential"]));
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') !== null);

    expect(inputNamed(mount.container, "provider-credential-provider_fixture").value).toBe("synthetic-replacement-key");
    expect(mount.container.textContent).toContain(enMessages["models.credentialUpdateFailed"]);
    expect(mount.container.textContent).not.toContain("raw provider credential response");

    await unmount(dom, mount.root);
  });

  it("requires inline confirmation and the latest revision before deleting a provider", async () => {
    const dom = createDom();
    const summary = connectedSummary();
    let request: { providerProfileId: string; expectedRevision: string } | undefined;
    const api = modelApi({
      deleteProvider: async (nextRequest) => {
        request = nextRequest;
        return presetSummary();
      }
    });
    const mount = await mountPanel(dom, summary, api);

    await openProviderDetails(dom, mount.container);
    const deleteButton = buttonNamed(mount.container, enMessages["models.deleteProvider"]);
    deleteButton.focus();
    await click(dom, deleteButton);
    expect(request).toBeUndefined();
    expect(mount.container.textContent).toContain(enMessages["models.confirmDeleteProviderDescription"]);
    const keepButton = buttonNamed(mount.container, enMessages["models.keepProvider"]);
    await waitFor(dom, () => dom.window.document.activeElement === keepButton);

    await click(dom, keepButton);
    const restoredDeleteButton = buttonNamed(mount.container, enMessages["models.deleteProvider"]);
    await waitFor(dom, () => dom.window.document.activeElement === restoredDeleteButton);

    await click(dom, restoredDeleteButton);
    await waitFor(dom, () => dom.window.document.activeElement === buttonNamed(
      mount.container,
      enMessages["models.keepProvider"]
    ));

    await click(dom, buttonNamed(mount.container, enMessages["models.confirmDelete"]));
    await waitFor(dom, () => mount.container.textContent?.includes(enMessages["models.providerDeleted"]) === true);
    expect(request).toEqual({
      providerProfileId: "provider_fixture",
      expectedRevision: summary.revision
    });
    expect(mount.container.textContent).toContain(enMessages["models.globalDefault"]);
    const deletedStatus = [...mount.container.querySelectorAll<HTMLElement>('[role="status"]')]
      .find((element) => element.textContent === enMessages["models.providerDeleted"]);
    expect(deletedStatus).toBeDefined();
    expect(dom.window.document.activeElement).toBe(deletedStatus);

    await unmount(dom, mount.root);
  });

  it("fails closed for credential and delete mutations when the settings revision is absent", async () => {
    const dom = createDom();
    const summary = { ...connectedSummary(), revision: undefined };
    let mutations = 0;
    const api = modelApi({
      updateProviderCredential: async () => {
        mutations += 1;
        return summary;
      },
      deleteProvider: async () => {
        mutations += 1;
        return summary;
      }
    });
    const mount = await mountPanel(dom, summary, api);

    await openProviderDetails(dom, mount.container);
    await setInput(dom, mount.container, "provider-credential-provider_fixture", "synthetic-replacement-key");
    expect(buttonNamed(mount.container, enMessages["models.updateCredential"]).disabled).toBe(true);
    expect(buttonNamed(mount.container, enMessages["models.deleteProvider"]).disabled).toBe(true);
    expect(mount.container.textContent).toContain(enMessages["models.revisionUnavailable"]);
    expect(mutations).toBe(0);

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

function connectedSummary(runtimeStatus?: ProviderProfileSummary["runtimeStatus"]): ModelProviderSettingsSummary {
  return {
    ...presetSummary(),
    revision: `sha256:${"a".repeat(64)}`,
    providers: [{
      id: "provider_fixture",
      displayName: "Connected provider",
      providerKind: "openai",
      endpointProtocol: "openai_responses",
      authRequirement: "api_key",
      modelListStrategy: "provider_api",
      cloudBoundary: "cloud",
      ...(runtimeStatus ? { runtimeStatus } : {}),
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
  readonly updateProviderCredential?: (request: {
    readonly providerProfileId: string;
    readonly expectedRevision: string;
    readonly apiKey: string;
  }) => Promise<ModelProviderSettingsSummary>;
  readonly deleteProvider?: (request: {
    readonly providerProfileId: string;
    readonly expectedRevision: string;
  }) => Promise<ModelProviderSettingsSummary>;
}): object {
  const summary = presetSummary();
  return {
    models: {
      summary: async () => summary,
      addPresetProvider: overrides.addPresetProvider ?? (async () => summary),
      addManualProvider: overrides.addManualProvider ?? (async () => summary),
      setDefaultModel: async () => summary,
      refreshProviderModels: overrides.refreshProviderModels ?? (async () => summary),
      updateProviderCredential: overrides.updateProviderCredential ?? (async () => summary),
      deleteProvider: overrides.deleteProvider ?? (async () => summary),
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

async function click(dom: JSDOM, element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

async function openPreset(dom: JSDOM, container: HTMLElement, name: string): Promise<void> {
  await click(dom, buttonNamed(container, enMessages["models.addProvider"]));
  await click(dom, buttonContaining(container, name));
}

async function openCustomProvider(dom: JSDOM, container: HTMLElement): Promise<void> {
  await click(dom, buttonNamed(container, enMessages["models.addProvider"]));
  await click(dom, buttonContaining(container, enMessages["models.customProvider"]));
}

async function openProviderDetails(dom: JSDOM, container: HTMLElement): Promise<void> {
  await click(dom, buttonNamed(container, enMessages["models.manage"]));
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = buttonsNamed(container, name)[0];
  if (!button) throw new Error(`Button not found: ${name}`);
  return button;
}

function buttonContaining(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.includes(name));
  if (!button) throw new Error(`Button containing text not found: ${name}`);
  return button;
}

function summaryNamed(container: HTMLElement, name: string): HTMLElement {
  const summary = Array.from(container.querySelectorAll<HTMLElement>("summary"))
    .find((candidate) => candidate.textContent?.includes(name));
  if (!summary) throw new Error(`Summary not found: ${name}`);
  return summary;
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
