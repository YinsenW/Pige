import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentConversationTimeline,
  AgentRuntimeStatus,
  AgentSubmitTurnRequest,
  AgentSubmitTurnResult,
  AgentTurnDraftEvent,
  HighRiskConfirmationChangedEvent,
  HighRiskConfirmationPendingResult,
  HighRiskConfirmationResolveRequest,
  HighRiskConfirmationResolveResult,
  JobsListRequest,
  JobSummary,
  KnowledgeActivitySummary,
  LibraryListResult,
  LibraryRelatedResult,
  ModelProviderSettingsSummary,
  NoteRenderResult,
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult,
  OnboardingStatus,
  SpeechAvailabilityRequest,
  SpeechAvailabilityResult,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  SpeechCancelRequest,
  SpeechSessionEvent,
  SpeechSessionRequest,
  SpeechStartRequest,
  SpeechStartResult,
  SpeechStopResult,
  WindowLayoutRequest,
  WindowLayoutState
} from "@pige/contracts";
import deMessages from "../../apps/desktop/src/renderer/src/locales/de/messages.json";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";
import frMessages from "../../apps/desktop/src/renderer/src/locales/fr/messages.json";
import jaMessages from "../../apps/desktop/src/renderer/src/locales/ja/messages.json";
import koMessages from "../../apps/desktop/src/renderer/src/locales/ko/messages.json";
import zhHansMessages from "../../apps/desktop/src/renderer/src/locales/zh-Hans/messages.json";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLTextAreaElement",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "CompositionEvent"
] as const;
const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
const homeLocaleCases = [
  { locale: "zh-Hans", messages: zhHansMessages },
  { locale: "en", messages: enMessages },
  { locale: "ja", messages: jaMessages },
  { locale: "ko", messages: koMessages },
  { locale: "fr", messages: frMessages },
  { locale: "de", messages: deMessages }
] as const;

afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originalDescriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalDescriptors.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Home durable Agent conversation UI", () => {
  it("probes unsupported voice on demand without starting a session", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    const voiceButton = buttonsByAriaLabel(container, enMessages["home.voice.start"])[0]!;

    expect(voiceButton.disabled).toBe(false);
    expect(voiceButton.title).toBe(enMessages["home.voice.start"]);
    expect(container.querySelector(".home-voice-panel")).toBeNull();
    await clickButtonByAriaLabel(dom, container, enMessages["home.voice.start"]);
    await waitFor(dom, () => container.textContent?.includes(enMessages["home.voice.unsupportedTitle"]) === true);
    expect(harness.speechAvailabilityRequests).toEqual([{ languageTag: "en" }]);
    expect(harness.speechStartRequests).toEqual([]);
    expect(harness.submitRequests).toEqual([]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("installs an explicitly requested language asset and requires a second Start action", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    const installationId = `speechinstall_${"b".repeat(16)}`;
    harness.speechAvailability = {
      status: "unsupported",
      reason: "assets_unavailable",
      canOpenSystemSettings: false
    };
    harness.installSpeechAsset = async (request) => {
      harness.emitSpeechAsset({
        apiVersion: 1,
        kind: "progress",
        installationId,
        sequence: 1,
        completedFraction: 0.25
      });
      return {
        status: "started",
        requestId: request.requestId,
        installationId,
        languageTag: request.languageTag,
        metering: "available"
      };
    };
    harness.speechStartResult = {
      status: "started",
      requestId: "speechreq_1234567890abcdef",
      sessionId: "speech_1234567890abcdef",
      languageTag: "en",
      metering: "available"
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await clickButtonByAriaLabel(dom, container, enMessages["home.voice.start"]);
    await waitFor(dom, () => container.textContent?.includes(enMessages["home.voice.assetsUnavailableTitle"]) === true);
    await clickButton(dom, container, enMessages["home.voice.installLanguageAsset"]);
    await waitFor(dom, () => harness.speechAssetInstallRequests.length === 1);
    await waitFor(dom, () => container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "25");
    expect(harness.speechAssetInstallRequests[0]).toMatchObject({
      requestId: expect.stringMatching(/^speechasset_[a-z0-9]{16,64}$/u),
      languageTag: "en"
    });
    expect(harness.speechStartRequests).toEqual([]);

    await act(async () => {
      harness.speechAvailability = {
        status: "supported",
        languageTag: "en",
        permission: "granted",
        canOpenSystemSettings: true
      };
      harness.emitSpeechAsset({
        apiVersion: 1,
        kind: "progress",
        installationId,
        sequence: 1,
        completedFraction: 0.9
      });
      harness.emitSpeechAsset({
        apiVersion: 1,
        kind: "installed",
        installationId,
        sequence: 2,
        languageTag: "en"
      });
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes(enMessages["home.voice.assetReadyTitle"]) === true);
    expect(harness.speechAvailabilityRequests).toEqual([{ languageTag: "en" }, { languageTag: "en" }]);
    expect(harness.speechStartRequests).toEqual([]);

    await clickButton(dom, container, enMessages["home.voice.startAfterAssetInstall"]);
    await waitFor(dom, () => container.querySelector(".home-voice-recording-row") !== null);
    expect(harness.speechStartRequests).toHaveLength(1);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps the system-managed language asset install visible and non-dismissible until it settles", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    const installationId = `speechinstall_${"c".repeat(16)}`;
    let resolveInstall: ((result: SpeechAssetInstallResult) => void) | undefined;
    harness.speechAvailability = {
      status: "unsupported",
      reason: "assets_unavailable",
      canOpenSystemSettings: false
    };
    harness.installSpeechAsset = (request) => new Promise((resolve) => {
      resolveInstall = resolve;
      expect(request.languageTag).toBe("en");
    });
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await clickButtonByAriaLabel(dom, container, enMessages["home.voice.start"]);
    await waitFor(dom, () => container.textContent?.includes(enMessages["home.voice.assetsUnavailableTitle"]) === true);
    await clickButton(dom, container, enMessages["home.voice.installLanguageAsset"]);
    await waitFor(dom, () => harness.speechAssetInstallRequests.length === 1);
    expect(container.textContent).not.toContain(enMessages["home.voice.continueTyping"]);
    const installingPanel = container.querySelector<HTMLElement>(".home-voice-panel")!;
    await act(async () => {
      installingPanel.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    expect(container.querySelector(".home-voice-panel")).toBe(installingPanel);

    await clickButtonByAriaLabel(dom, container, enMessages["topbar.expandSidebar"]);
    await waitFor(dom, () => container.querySelector("#pige-library-sidebar") !== null);
    expect(buttons(container, enMessages["nav.knowledgeTree"])[0]?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".sidebar-settings-control")?.disabled).toBe(true);

    await act(async () => {
      resolveInstall?.({
        status: "started",
        requestId: harness.speechAssetInstallRequests[0]!.requestId,
        installationId,
        languageTag: "en",
        metering: "available"
      });
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes(enMessages["home.voice.installingAssetTitle"]) === true);
    expect(harness.speechStartRequests).toEqual([]);

    await act(async () => {
      harness.emitSpeechAsset({
        apiVersion: 1,
        kind: "failed",
        installationId,
        sequence: 1,
        error: speechAssetInstallError()
      });
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes(enMessages["home.voice.assetInstallFailedTitle"]) === true);
    expect(buttons(container, enMessages["nav.knowledgeTree"])[0]?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>(".sidebar-settings-control")?.disabled).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("defers a late system-locale result while the language asset installation is active", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    let resolveAppearance: ((appearance: {
      readonly locale: "en";
      readonly availableLocales: readonly ["en"];
    }) => void) | undefined;
    harness.loadAppearance = () => new Promise((resolve) => {
      resolveAppearance = resolve;
    });
    harness.speechAvailability = {
      status: "unsupported",
      reason: "assets_unavailable",
      canOpenSystemSettings: false
    };
    harness.installSpeechAsset = () => new Promise(() => undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await clickButtonByAriaLabel(dom, container, zhHansMessages["home.voice.start"]);
    await waitFor(dom, () => container.textContent?.includes(zhHansMessages["home.voice.assetsUnavailableTitle"]) === true);
    await clickButton(dom, container, zhHansMessages["home.voice.installLanguageAsset"]);
    await waitFor(dom, () => container.textContent?.includes(zhHansMessages["home.voice.installingAssetTitle"]) === true);

    await act(async () => {
      resolveAppearance?.({ locale: "en", availableLocales: ["en"] });
      await settle(dom);
    });
    expect(container.textContent).toContain(zhHansMessages["home.voice.installingAssetTitle"]);
    expect(container.textContent).not.toContain(enMessages["home.voice.installingAssetTitle"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps metering local and appends the final transcript without auto-send", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    const sessionId = "speech_1234567890abcdef";
    harness.speechAvailability = {
      status: "supported",
      languageTag: "en",
      permission: "granted",
      canOpenSystemSettings: true
    };
    harness.speechStartResult = {
      status: "started",
      requestId: "speechreq_1234567890abcdef",
      sessionId,
      languageTag: "en",
      metering: "available"
    };
    harness.speechStopResult = {
      status: "stopped",
      sessionId,
      sequence: 4,
      transcript: "dictated locally"
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await setTextareaValue(dom, container, "Existing draft");

    await clickButtonByAriaLabel(dom, container, enMessages["home.voice.start"]);
    await waitFor(dom, () => container.querySelector(".home-voice-recording-row") !== null);
    await act(async () => {
      harness.emitSpeech({
        apiVersion: 1,
        kind: "meter",
        sessionId,
        sequence: 1,
        elapsedMs: 1_200,
        level: 0.4
      });
      harness.emitSpeech({
        apiVersion: 1,
        kind: "transcript_replace",
        sessionId,
        sequence: 2,
        transcript: "dictated",
        final: false
      });
      await settle(dom);
    });
    expect(container.querySelector(".home-voice-timer")?.textContent).toBe("0:01");
    expect(container.querySelector(".home-voice-wave.has-levels")?.children).toHaveLength(1);

    await clickButtonByAriaLabel(dom, container, enMessages["home.voice.complete"]);
    await waitFor(dom, () => homeComposer(container).value === "Existing draft dictated locally");
    expect(harness.speechStopRequests).toEqual([{ sessionId }]);
    expect(harness.submitRequests).toEqual([]);
    expect(harness.jobs).toEqual([]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("cancels a pending start by request identity and joins CJK without an invented space", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    const sessionId = "speech_abcdef1234567890";
    let releaseStart: (() => void) | undefined;
    harness.speechAvailability = {
      status: "supported",
      languageTag: "en",
      permission: "not-determined",
      canOpenSystemSettings: true
    };
    harness.startSpeech = (request) => new Promise<SpeechStartResult>((resolve) => {
      releaseStart = () => resolve({
        status: "started",
        requestId: request.requestId,
        sessionId,
        languageTag: request.languageTag,
        metering: "unavailable"
      });
    });
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await setTextareaValue(dom, container, "你好");
    await clickButtonByAriaLabel(dom, container, enMessages["home.voice.start"]);
    await waitFor(dom, () => harness.speechStartRequests.length === 1);
    await clickButton(dom, container, enMessages["home.voice.cancel"]);
    const pendingRequestId = harness.speechStartRequests[0]!.requestId;
    expect(harness.speechCancelRequests).toEqual([{ requestId: pendingRequestId }]);
    await act(async () => {
      releaseStart?.();
      await settle(dom);
    });
    expect(container.querySelector(".home-voice-panel")).toBeNull();

    harness.startSpeech = async (request) => ({
      status: "started",
      requestId: request.requestId,
      sessionId,
      languageTag: request.languageTag,
      metering: "unavailable"
    });
    harness.speechStopResult = {
      status: "stopped",
      sessionId,
      sequence: 1,
      transcript: "世界"
    };
    await clickButtonByAriaLabel(dom, container, enMessages["home.voice.start"]);
    await waitFor(dom, () => container.querySelector(".home-voice-recording-row") !== null);
    await clickButtonByAriaLabel(dom, container, enMessages["home.voice.complete"]);
    await waitFor(dom, () => homeComposer(container).value === "你好世界");
    expect(harness.submitRequests).toEqual([]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves word boundaries after English punctuation and between Korean segments", async () => {
    const scenarios = [
      { draft: "Hello.", transcript: "Next sentence", expected: "Hello. Next sentence" },
      { draft: "안녕하세요", transcript: "반갑습니다", expected: "안녕하세요 반갑습니다" },
      { draft: "你好。", transcript: "世界", expected: "你好。世界" },
      { draft: "こんにちは。", transcript: "次です", expected: "こんにちは。次です" }
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const dom = createDom(420);
      const harness = createHarness(undefined);
      const sessionId = `speech_boundary_${index}_abcdef123456`;
      harness.speechAvailability = {
        status: "supported",
        languageTag: index === 0 ? "en" : "ko",
        permission: "granted",
        canOpenSystemSettings: true
      };
      harness.speechStartResult = {
        status: "started",
        requestId: `speechreq_boundary_${index}_abcdef`,
        sessionId,
        languageTag: index === 0 ? "en" : "ko",
        metering: "unavailable"
      };
      harness.speechStopResult = {
        status: "stopped",
        sessionId,
        sequence: 1,
        transcript: scenario.transcript
      };
      const { container, root } = await mountHome(dom, makePigeApi(harness));
      await setTextareaValue(dom, container, scenario.draft);
      await clickButtonByAriaLabel(dom, container, enMessages["home.voice.start"]);
      await waitFor(dom, () => container.querySelector(".home-voice-recording-row") !== null);
      await clickButtonByAriaLabel(dom, container, enMessages["home.voice.complete"]);
      await waitFor(dom, () => homeComposer(container).value === scenario.expected);
      expect(harness.submitRequests).toEqual([]);

      await act(async () => root.unmount());
      dom.window.close();
    }
  });

  it("lets the Models panel solely own its scoped summary failure after Home loads", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.windowMode = "expanded";
    harness.sidebarOpen = true;
    let summaryReads = 0;
    harness.loadModelSummary = async () => {
      summaryReads += 1;
      if (summaryReads === 2) throw new Error("raw navigation summary failure");
      return emptyModelSummary();
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => summaryReads === 1);
    await openSettingsSection(dom, container, "Models");
    await waitFor(dom, () => container.textContent?.includes(enMessages["models.summaryRefreshFailed"]) === true);
    expect(summaryReads).toBe(2);
    expect(container.textContent).not.toContain("raw navigation summary failure");
    expect(buttons(container, "Retry")).toHaveLength(1);

    await clickButton(dom, container, "Retry");
    await waitFor(dom, () => container.querySelector('[role="alert"]') === null);
    expect(summaryReads).toBe(3);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a late Models summary read from replacing a newer reopened view", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.windowMode = "expanded";
    harness.sidebarOpen = true;
    let summaryReads = 0;
    let resolveFirstSummary: ((summary: ModelProviderSettingsSummary) => void) | undefined;
    harness.loadModelSummary = () => {
      summaryReads += 1;
      if (summaryReads === 2) {
        return new Promise((resolve) => {
          resolveFirstSummary = resolve;
        });
      }
      return Promise.resolve(summaryReads === 1 ? emptyModelSummary() : connectedModelSummary());
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => summaryReads === 1);
    await openSettingsSection(dom, container, "Models");
    await waitFor(dom, () => summaryReads === 2);
    await clickButtonByAriaLabel(dom, container, "Close Settings");
    await openSettingsSection(dom, container, "Models");
    await waitFor(dom, () => container.textContent?.includes("Fresh provider") === true);

    await act(async () => {
      resolveFirstSummary?.(emptyModelSummary());
      await settle(dom);
    });
    expect(container.textContent).toContain("Fresh provider");
    expect(summaryReads).toBe(3);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("loads the App-owned Home model summary and switches the global default with keyboard focus", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    let currentSummary = switchableModelSummary("model_alpha");
    let runtimeStatus = readyAgentRuntimeStatus("model_alpha");
    harness.loadModelSummary = async () => currentSummary;
    harness.loadAgentRuntimeStatus = async () => runtimeStatus;
    harness.setDefaultModel = async (modelProfileId) => {
      harness.setDefaultModelIds.push(modelProfileId);
      currentSummary = switchableModelSummary(modelProfileId);
      runtimeStatus = readyAgentRuntimeStatus(modelProfileId);
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttonsByAriaLabelPrefix(container, "Model service: Alpha").length === 1);
    const switcher = buttonsByAriaLabelPrefix(container, "Model service: Alpha")[0]!;
    expect(switcher.getAttribute("aria-label")).toContain("Connected");
    await clickElement(dom, switcher);

    const menu = requireElement(container.querySelector<HTMLElement>('[role="listbox"]'));
    const options = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    await waitFor(dom, () => dom.window.document.activeElement === options[0]);
    await act(async () => {
      menu.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(options[1]);
    await clickElement(dom, options[1]!);

    await waitFor(dom, () => buttonsByAriaLabelPrefix(container, "Model service: Beta").length === 1);
    expect(harness.setDefaultModelIds).toEqual(["model_beta"]);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    await waitFor(dom, () => dom.window.document.activeElement === buttonsByAriaLabelPrefix(container, "Model service: Beta")[0]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps the Home model selection unchanged and reports a body-free local failure", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    const currentSummary = switchableModelSummary("model_alpha");
    harness.loadModelSummary = async () => currentSummary;
    harness.loadAgentRuntimeStatus = async () => waitingAgentRuntimeStatus("model_alpha");
    harness.setDefaultModel = async (modelProfileId) => {
      harness.setDefaultModelIds.push(modelProfileId);
      throw new Error("raw provider endpoint and credential failure");
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttonsByAriaLabelPrefix(container, "Model service: Alpha").length === 1);
    await setTextareaValue(dom, container, "This must wait for an available model.");
    expect(buttonsByAriaLabel(container, "Send")[0]?.disabled).toBe(true);
    await clickElement(dom, buttonsByAriaLabelPrefix(container, "Model service: Alpha")[0]!);
    const beta = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((option) => option.textContent?.includes("Beta"));
    if (!beta) throw new Error("Beta model option not found.");
    await clickElement(dom, beta);

    await waitFor(dom, () => container.textContent?.includes(enMessages["home.modelSwitchFailed"]) === true);
    expect(buttonsByAriaLabelPrefix(container, "Model service: Alpha")).toHaveLength(1);
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(container.textContent).not.toContain("raw provider endpoint and credential failure");
    expect(harness.setDefaultModelIds).toEqual(["model_beta"]);
    expect(buttonsByAriaLabel(container, "Send")[0]?.disabled).toBe(true);
    expect(harness.submitRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps Home Library modal only below its resident width budget", async () => {
    for (const [width, modal] of [[719, true], [720, false]] as const) {
      const dom = createDom(width);
      const harness = createHarness(undefined);
      harness.windowMode = "expanded";
      harness.sidebarOpen = true;
      harness.windowLayoutWidth = width;
      harness.windowLayoutAvailableWidth = width;
      const { container, root } = await mountHome(dom, makePigeApi(harness));
      await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);

      const sidebar = container.querySelector<HTMLElement>("#pige-library-sidebar");
      const workspace = container.querySelector<HTMLElement>("main.workspace");
      expect(sidebar?.getAttribute("role")).toBe(modal ? "dialog" : null);
      expect(sidebar?.getAttribute("aria-modal")).toBe(modal ? "true" : null);
      expect(workspace?.hasAttribute("inert")).toBe(modal);

      if (modal && sidebar) {
        await act(async () => {
          sidebar.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await settle(dom);
        });
        await waitFor(dom, () => container.querySelector("#pige-library-sidebar") === null);
        expect(harness.sidebarOpen).toBe(false);
        await waitFor(dom, () => dom.window.document.activeElement === container.querySelector(".sidebar-toggle-button"));
      }

      await act(async () => root.unmount());
      dom.window.close();
    }
  });

  it("ignores a stale WindowLayout event after a newer resident disclosure revision", async () => {
    const dom = createDom(720);
    const harness = createHarness(undefined);
    harness.windowLayoutWidth = 720;
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => harness.windowLayoutListeners.size === 1);

    const newer: WindowLayoutState = {
      apiVersion: 1,
      revision: 5,
      surface: "home",
      sidebarOpen: true,
      noteAgentOpen: false,
      sidebarPresentation: "resident",
      noteAgentPresentation: "closed",
      autoExpanded: true,
      isMaximized: false,
      isFullScreen: false
    };
    const stale: WindowLayoutState = {
      ...newer,
      revision: 4,
      sidebarOpen: false,
      sidebarPresentation: "closed",
      autoExpanded: false
    };
    await act(async () => {
      for (const listener of harness.windowLayoutListeners) listener(newer);
      for (const listener of harness.windowLayoutListeners) listener(stale);
      await settle(dom);
    });

    expect(container.querySelector("#pige-library-sidebar")).not.toBeNull();
    expect(buttonsByAriaLabel(container, "Collapse sidebar")).toHaveLength(1);

    await act(async () => root.unmount());
    expect(harness.windowLayoutListeners.size).toBe(0);
    dom.window.close();
  });

  it("keeps Reader Library modal until the reader minimum width fits", async () => {
    for (const [width, modal] of [[839, true], [840, false]] as const) {
      const dom = createDom(width);
      const harness = createHarness(undefined);
      harness.windowMode = "expanded";
      harness.sidebarOpen = true;
      harness.windowLayoutWidth = width;
      harness.windowLayoutAvailableWidth = width;
      const { container, root } = await mountHome(dom, makePigeApi(harness));
      await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);
      await openLibraryNote(dom, container, "Note A");

      const sidebar = container.querySelector<HTMLElement>("#pige-library-sidebar");
      const workspace = container.querySelector<HTMLElement>("main.workspace");
      expect(sidebar?.getAttribute("role")).toBe(modal ? "dialog" : null);
      expect(sidebar?.getAttribute("aria-modal")).toBe(modal ? "true" : null);
      expect(workspace?.hasAttribute("inert")).toBe(modal);

      await act(async () => root.unmount());
      dom.window.close();
    }
  });

  it("resolves a Reader link with the exact current vault, page, and render context", async () => {
    const dom = createDom(840);
    const harness = createHarness(undefined);
    harness.sidebarOpen = true;
    harness.windowLayoutWidth = 840;
    harness.windowLayoutAvailableWidth = 1600;
    const targetPageId = "page_20260715_note0002";
    harness.resolveInlineReference = async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "resolved",
      target: { kind: "page", pageId: targetPageId }
    });
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);
    await openLibraryNote(dom, container, "Note A");

    const link = requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:note-b"]'));
    expect(link.dataset.readerLinkState).toBe("ready");
    await clickElement(dom, link);
    await waitFor(dom, () => container.querySelector(".note-reader h1")?.textContent === "Note B");
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector(".note-reader"));

    expect(harness.inlineReferenceRequests).toHaveLength(1);
    expect(harness.inlineReferenceRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_home_conversation",
      currentPageId: "page_20260715_note0001",
      renderContextId: `notectx_${"a".repeat(32)}`,
      href: "#wiki:note-b"
    });
    expect(harness.inlineReferenceRequests[0]?.requestId).toMatch(/^noteref_[a-z0-9]{16,64}$/u);
    expect(harness.noteRenderRequests).toEqual(["page_20260715_note0001", targetPageId]);
    expect(container.textContent).not.toContain("notectx_");
    expect(container.textContent).not.toContain("page_20260715_note0002");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("uses the same typed resolver owner from a Home retrieval Reader", async () => {
    const dom = createDom(720);
    const harness = createHarness(undefined);
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      return retrievalCompletedResult();
    };
    harness.resolveInlineReference = async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "resolved",
      target: { kind: "page", pageId: "page_20260715_note0002" }
    });
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await setTextareaValue(dom, container, "Find the approved Reader fixture.");
    await clickButtonByAriaLabel(dom, container, "Send");
    await waitFor(dom, () => container.textContent?.includes("Local Reader result") === true);
    await clickElement(dom, buttons(container, "Open")[0]!);
    await waitFor(dom, () => container.querySelector(".note-reader h1")?.textContent === "Note A");
    await clickElement(dom, requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:note-b"]')));
    await waitFor(dom, () => container.querySelector(".note-reader h1")?.textContent === "Note B");

    expect(harness.inlineReferenceRequests).toHaveLength(1);
    expect(harness.inlineReferenceRequests[0]).toMatchObject({
      activeVaultId: "vault_home_conversation",
      currentPageId: "page_20260715_note0001",
      renderContextId: `notectx_${"a".repeat(32)}`,
      href: "#wiki:note-b"
    });

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not call the resolver without a current render context", async () => {
    const dom = createDom(840);
    const harness = createHarness(undefined);
    harness.sidebarOpen = true;
    harness.windowLayoutWidth = 840;
    harness.renderNote = async (pageId) => {
      const note = testRenderedNote(pageId);
      return { summary: note.summary, html: note.html, byteSize: note.byteSize };
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);
    await openLibraryNote(dom, container, "Note A");

    const link = requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:note-b"]'));
    expect(link.dataset.readerLinkState).toBe("unavailable");
    await clickElement(dom, link);
    expect(harness.inlineReferenceRequests).toEqual([]);
    expect(container.textContent).toContain(enMessages["note.readerLinkUnavailable"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("drops a delayed reference result after note routing changes the render identity", async () => {
    const dom = createDom(840);
    const harness = createHarness(undefined);
    harness.sidebarOpen = true;
    harness.windowLayoutWidth = 840;
    const pending = deferred<NoteResolveInlineReferenceResult>();
    harness.resolveInlineReference = async () => pending.promise;
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);
    await openLibraryNote(dom, container, "Note A");
    const link = requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:note-b"]'));
    await clickElement(dom, link);
    await waitFor(dom, () => link.dataset.readerLinkState === "resolving");

    await openLibraryNote(dom, container, "Note B");
    const oldRequest = harness.inlineReferenceRequests[0]!;
    await act(async () => {
      pending.resolve({
        apiVersion: 1,
        requestId: oldRequest.requestId,
        status: "resolved",
        target: { kind: "page", pageId: "page_20260715_note0001" }
      });
      await pending.promise;
      await settle(dom);
    });

    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note B");
    expect(harness.noteRenderRequests).toEqual([
      "page_20260715_note0001",
      "page_20260715_note0002"
    ]);
    expect(container.querySelector("[data-reader-reference-feedback]")).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("invalidates a pending Reader reference when Settings switches the active vault", async () => {
    const dom = createDom(840);
    const harness = createHarness(undefined);
    harness.sidebarOpen = true;
    harness.windowLayoutWidth = 840;
    const pending = deferred<NoteResolveInlineReferenceResult>();
    harness.resolveInlineReference = async () => pending.promise;
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => container.querySelector(".sidebar-settings-control") !== null);
    await openLibraryNote(dom, container, "Note A");
    await clickElement(dom, requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:note-b"]')));
    await waitFor(dom, () => harness.inlineReferenceRequests.length === 1);

    await clickElement(dom, requireElement(container.querySelector<HTMLButtonElement>(".sidebar-settings-control")));
    harness.onboarding = {
      ...readyOnboarding(),
      activeVault: {
        ...homeVaultSummary(),
        vaultId: "vault_second_reader",
        name: "Second Reader Vault"
      }
    };
    await clickButtonByAriaLabel(dom, container, "Close Settings");
    await waitFor(dom, () => container.querySelector(".note-reader") === null);

    const oldRequest = harness.inlineReferenceRequests[0]!;
    await act(async () => {
      pending.resolve({
        apiVersion: 1,
        requestId: oldRequest.requestId,
        status: "resolved",
        target: { kind: "page", pageId: "page_20260715_note0002" }
      });
      await pending.promise;
      await settle(dom);
    });
    expect(harness.noteRenderRequests).toEqual(["page_20260715_note0001"]);
    expect(container.querySelector("[data-reader-reference-feedback]")).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps the current Reader and one body-free status when the resolved target cannot render", async () => {
    const dom = createDom(840);
    const harness = createHarness(undefined);
    harness.sidebarOpen = true;
    harness.windowLayoutWidth = 840;
    harness.resolveInlineReference = async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "resolved",
      target: { kind: "source", sourceId: "src_20260715_source001", pageId: "page_20260715_note0002" }
    });
    harness.renderNote = async (pageId) => {
      if (pageId.endsWith("2")) throw new Error("raw private note path and resolver body");
      return testRenderedNote(pageId);
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);
    await openLibraryNote(dom, container, "Note A");
    await clickElement(dom, requireElement(container.querySelector<HTMLAnchorElement>('a[href="#wiki:note-b"]')));
    await waitFor(dom, () => container.querySelector('[data-reader-reference-feedback="failed"]') !== null);

    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note A");
    expect(container.querySelectorAll('[data-reader-reference-feedback="failed"]')).toHaveLength(1);
    expect(container.textContent).not.toContain("raw private note path and resolver body");
    expect(container.textContent).not.toContain("src_20260715_source001");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("requests enough window width before revealing the Library pane", async () => {
    for (const initialMode of ["compact", "expanded"] as const) {
      const dom = createDom(420);
      const harness = createHarness(undefined);
      harness.windowMode = initialMode;
      harness.sidebarOpen = false;
      harness.windowLayoutWidth = 420;
      harness.windowLayoutAvailableWidth = 1600;
      const { container, root } = await mountHome(dom, makePigeApi(harness));

      await clickElement(dom, buttonsByAriaLabel(container, "Expand sidebar")[0]!);
      await waitFor(dom, () => harness.sidebarOpen && harness.windowLayoutWidth === 720);
      expect(harness.windowModeRequests).toEqual([]);
      expect(harness.windowLayoutRequests.at(-1)).toEqual({
        apiVersion: 1,
        surface: "home",
        sidebarOpen: true,
        noteAgentOpen: false
      });
      expect(currentWindowLayout(harness).sidebarPresentation).toBe("resident");

      await act(async () => root.unmount());
      dom.window.close();
    }
  });

  it("expands resident panes through 720, 840, and 1240 then restores the exact user base", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    harness.windowLayoutWidth = 420;
    harness.windowLayoutAvailableWidth = 1600;
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await clickElement(dom, buttonsByAriaLabel(container, "Expand sidebar")[0]!);
    await waitFor(dom, () => harness.windowLayoutWidth === 720);
    await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);

    await openLibraryNote(dom, container, "Note A");
    await waitFor(dom, () => harness.windowLayoutWidth === 840);
    expect(currentWindowLayout(harness).sidebarPresentation).toBe("resident");

    await clickElement(dom, buttonsByAriaLabel(container, "Show note conversation")[0]!);
    await waitFor(dom, () => harness.windowLayoutWidth === 1240);
    expect(currentWindowLayout(harness)).toMatchObject({
      surface: "reader",
      sidebarPresentation: "resident",
      noteAgentPresentation: "resident",
      autoExpanded: true
    });

    await clickButtonByAriaLabel(dom, container, "Hide note conversation");
    await waitFor(dom, () => harness.windowLayoutWidth === 840);
    await clickElement(dom, buttonsByAriaLabel(container, "Collapse sidebar")[0]!);
    await waitFor(dom, () => harness.windowLayoutWidth === 420);
    expect(currentWindowLayout(harness)).toMatchObject({
      sidebarPresentation: "closed",
      noteAgentPresentation: "closed",
      autoExpanded: false
    });

    await clickElement(dom, buttonsByAriaLabel(container, "Expand sidebar")[0]!);
    await waitFor(dom, () => harness.windowLayoutWidth === 840);
    await clickElement(dom, buttonsByAriaLabel(container, "Show note conversation")[0]!);
    await waitFor(dom, () => harness.windowLayoutWidth === 1240);
    await clickElement(dom, buttonsByAriaLabel(container, "Collapse sidebar")[0]!);
    await waitFor(dom, () => harness.windowLayoutWidth === 960);
    expect(currentWindowLayout(harness)).toMatchObject({
      sidebarPresentation: "closed",
      noteAgentPresentation: "resident",
      autoExpanded: true
    });
    await clickButtonByAriaLabel(dom, container, "Hide note conversation");
    await waitFor(dom, () => harness.windowLayoutWidth === 420);
    expect(currentWindowLayout(harness)).toMatchObject({
      sidebarPresentation: "closed",
      noteAgentPresentation: "closed",
      autoExpanded: false
    });
    expect(harness.windowModeRequests).toEqual([]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps overlay state and focus fail closed when the layout owner rejects close", async () => {
    const dom = createDom(719);
    const harness = createHarness(undefined);
    harness.sidebarOpen = true;
    harness.windowLayoutWidth = 719;
    harness.windowLayoutAvailableWidth = 719;
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => container.querySelector("#pige-library-sidebar") !== null);

    const sidebar = container.querySelector<HTMLElement>("#pige-library-sidebar")!;
    const firstControl = sidebar.querySelector<HTMLElement>("button");
    firstControl?.focus();
    harness.failNextWindowLayout = true;
    await act(async () => {
      sidebar.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });

    await waitFor(dom, () => container.textContent?.includes(enMessages["error.generic"]) === true);
    expect(container.querySelector("#pige-library-sidebar")).not.toBeNull();
    expect(harness.sidebarOpen).toBe(true);
    expect(dom.window.document.activeElement).toBe(firstControl);
    expect(container.textContent).not.toContain("raw window layout failure");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves the user-owned note conversation disclosure across note routing", async () => {
    for (const [width, overlay] of [[1239, true], [1240, false]] as const) {
      const dom = createDom(width);
      const harness = createHarness(undefined);
      harness.windowMode = "expanded";
      harness.sidebarOpen = true;
      harness.windowLayoutWidth = width;
      harness.windowLayoutAvailableWidth = width;
      const { container, root } = await mountHome(dom, makePigeApi(harness));
      await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);
      await openLibraryNote(dom, container, "Note A");

      if (overlay) {
        expect(container.querySelector(".note-agent")).toBeNull();
        const opener = buttonsByAriaLabel(container, "Show note conversation")[0]!;
        await clickElement(dom, opener);
        const agent = container.querySelector<HTMLElement>(".note-agent");
        expect(agent?.getAttribute("role")).toBe("dialog");
        expect(agent?.getAttribute("aria-modal")).toBe("true");
        expect(container.querySelector("main.workspace")?.hasAttribute("inert")).toBe(true);
        await act(async () => {
          agent?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          await settle(dom);
        });
        await waitFor(dom, () => container.querySelector(".note-agent") === null);
        await waitFor(dom, () => dom.window.document.activeElement === opener);
      } else {
        expect(harness.windowLayoutRequests.at(-1)).toEqual({
          apiVersion: 1,
          surface: "reader",
          sidebarOpen: true,
          noteAgentOpen: true
        });
        await waitFor(dom, () => container.querySelector(".note-agent") !== null);
        expect(container.querySelector(".note-agent")?.getAttribute("aria-modal")).toBeNull();
        await clickButtonByAriaLabel(dom, container, "Hide note conversation");
        await waitFor(dom, () => container.querySelector(".note-agent") === null);
      }

      await openLibraryNote(dom, container, "Note B");
      expect(container.querySelector(".note-agent")).toBeNull();
      expect(buttonsByAriaLabel(container, "Show note conversation")).toHaveLength(1);

      await act(async () => root.unmount());
      dom.window.close();
    }
  });

  it("uses a resident Note Agent when reader and agent minimum widths fit", async () => {
    const dom = createDom(960);
    const harness = createHarness(undefined);
    harness.windowMode = "expanded";
    harness.sidebarOpen = false;
    harness.windowLayoutWidth = 960;
    harness.windowLayoutAvailableWidth = 1600;
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await clickElement(dom, buttonsByAriaLabel(container, "Expand sidebar")[0]!);
    await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);
    await openLibraryNote(dom, container, "Note A");
    await clickElement(dom, buttonsByAriaLabel(container, "Collapse sidebar")[0]!);
    await waitFor(dom, () => container.querySelector("#pige-library-sidebar") === null);
    await clickElement(dom, buttonsByAriaLabel(container, "Show note conversation")[0]!);

    const agent = container.querySelector<HTMLElement>(".note-agent");
    expect(agent).not.toBeNull();
    expect(agent?.getAttribute("role")).toBeNull();
    expect(agent?.getAttribute("aria-modal")).toBeNull();
    expect(container.querySelector("main.workspace")?.hasAttribute("inert")).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("requests enough window width before revealing the Note Agent", async () => {
    const dom = createDom(840);
    const harness = createHarness(undefined);
    harness.windowMode = "expanded";
    harness.sidebarOpen = true;
    harness.windowLayoutWidth = 840;
    harness.windowLayoutAvailableWidth = 1600;
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);
    await openLibraryNote(dom, container, "Note A");
    await clickElement(dom, buttonsByAriaLabel(container, "Collapse sidebar")[0]!);
    await waitFor(dom, () => container.querySelector("#pige-library-sidebar") === null);
    await clickElement(dom, buttonsByAriaLabel(container, "Show note conversation")[0]!);
    await waitFor(dom, () => container.querySelector(".note-agent") !== null);

    expect(harness.windowModeRequests).toEqual([]);
    expect(harness.windowLayoutWidth).toBe(960);
    expect(harness.windowLayoutRequests.at(-1)).toEqual({
      apiVersion: 1,
      surface: "reader",
      sidebarOpen: false,
      noteAgentOpen: true
    });
    expect(currentWindowLayout(harness).noteAgentPresentation).toBe("resident");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("refreshes durable Home state when returning from Models", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.windowMode = "expanded";
    harness.sidebarOpen = true;
    harness.enforceJobFilters = true;
    harness.onboarding = readyWithoutModelOnboarding(false);
    harness.jobs = [sourceWaitingForModelJob()];
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => container.textContent?.includes("public-alpha.csv") === true);
    await openSettingsSection(dom, container, "Models");
    harness.onboarding = readyOnboarding();
    harness.jobs = [{
      ...sourceWaitingForModelJob(),
      state: "running",
      stage: "agent_running",
      message: "Agent resumed after model connection.",
      updatedAt: "2026-07-13T08:00:02.000Z"
    }];
    const readsBeforeReturn = harness.jobListRequests.length;

    await clickButtonByAriaLabel(dom, container, "Close Settings");
    await waitFor(dom, () => container.querySelector(".task-current-state")?.textContent === enMessages["home.jobRunning"]);
    expect(harness.jobListRequests.length).toBeGreaterThan(readsBeforeReturn);
    expect(container.textContent).toContain("public-alpha.csv");
    expect(buttons(container, "Connect Model")).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("suppresses a superseded durable Home refresh failure after a newer refresh succeeds", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.windowMode = "expanded";
    harness.sidebarOpen = true;
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    let onboardingReads = 0;
    let rejectOlderRefresh: ((reason?: unknown) => void) | undefined;
    harness.loadOnboarding = () => {
      onboardingReads += 1;
      if (onboardingReads === 1) {
        return new Promise((_, reject) => {
          rejectOlderRefresh = reject;
        });
      }
      return Promise.resolve(readyOnboarding());
    };

    await clickButton(dom, container, "Home");
    await waitFor(dom, () => onboardingReads === 1);
    await clickButton(dom, container, "Home");
    await waitFor(dom, () => onboardingReads === 2);

    await act(async () => {
      rejectOlderRefresh?.(new Error("stale durable refresh failure"));
      await settle(dom);
    });
    expect(container.textContent).not.toContain(enMessages["error.generic"]);
    expect(container.textContent).not.toContain("stale durable refresh failure");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps an initial no-source model wait out of Recent Work until its conversation owner loads", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.onboarding = readyWithoutModelOnboarding(true);
    harness.jobs = [modelWaitingJob()];
    let resolveConversation: ((timeline: AgentConversationTimeline) => void) | undefined;
    harness.loadConversation = () => new Promise((resolve) => {
      resolveConversation = resolve;
    });
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.textContent).not.toContain("job_20260713_modelwait");
    expect(container.textContent).not.toContain("Waiting for a local capability");

    await act(async () => {
      resolveConversation?.(modelWaitingTimeline());
      await settle(dom);
    });
    await waitFor(dom, () => buttons(container, "Open Models").length === 1);
    expect(buttons(container, "Open Models")).toHaveLength(1);
    expect(container.querySelector(".task-panel")).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  for (const { locale, messages } of homeLocaleCases) {
    for (const windowMode of ["compact", "expanded"] as const) {
      it(`keeps one missing-model owner in ${locale} ${windowMode}`, async () => {
        const dom = createDom();
        const harness = createHarness(modelWaitingTimeline());
        harness.locale = locale;
        harness.windowMode = windowMode;
        harness.onboarding = readyWithoutModelOnboarding(true);
        harness.jobs = [modelWaitingJob()];
        const { container, root } = await mountHome(dom, makePigeApi(harness));

        const openModels = messages["home.openModels"];
        const retry = messages["home.retryAnswer"];
        await waitFor(dom, () => buttons(container, openModels).length === 1);
        expect(buttons(container, openModels)).toHaveLength(1);
        expect(buttons(container, retry)).toHaveLength(0);
        expect(container.querySelector(".task-panel")).toBeNull();
        expect(container.textContent).not.toContain("job_20260713_modelwait");
        expect(container.textContent).not.toContain(messages["home.jobWaiting"]);
        expect(container.querySelector('.shell[aria-label="Pige"]')?.classList.contains(`mode-${windowMode}`)).toBe(true);

        await act(async () => root.unmount());
        dom.window.close();
      });
    }
  }

  it("sends a non-empty Home turn on Enter and blocks an empty Enter", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    const emptyPrevented = await dispatchComposerKey(dom, container, { key: "Enter" });
    expect(emptyPrevented).toBe(true);
    expect(harness.submitRequests).toHaveLength(0);

    await setTextareaValue(dom, container, "Send this Home turn.");
    const sendPrevented = await dispatchComposerKey(dom, container, { key: "Enter" });
    expect(sendPrevented).toBe(true);
    await waitFor(dom, () => harness.submitRequests.length === 1);
    expect(harness.submitRequests[0]?.text).toBe("Send this Home turn.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("leaves Shift+Enter to the native multiline textarea without submitting", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "First line");
    const prevented = await dispatchComposerKey(dom, container, { key: "Enter", shiftKey: true });
    expect(prevented).toBe(false);
    expect(harness.submitRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not submit during IME composition or the composition-end Enter race", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await setTextareaValue(dom, container, "中文输入");
    const textarea = homeComposer(container);
    const composingEnter = new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true
    });
    const compositionRaceEnter = new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true
    });

    await act(async () => {
      textarea.dispatchEvent(new dom.window.CompositionEvent("compositionstart", { bubbles: true }));
      textarea.dispatchEvent(composingEnter);
      textarea.dispatchEvent(new dom.window.CompositionEvent("compositionend", { bubbles: true }));
      textarea.dispatchEvent(compositionRaceEnter);
      await Promise.resolve();
    });
    expect(harness.submitRequests).toHaveLength(0);
    expect(composingEnter.defaultPrevented).toBe(false);
    expect(compositionRaceEnter.defaultPrevented).toBe(false);

    await settle(dom);
    await dispatchComposerKey(dom, container, { key: "Enter" });
    await waitFor(dom, () => harness.submitRequests.length === 1);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("prevents repeat and second Enter submission while the first turn is in flight", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Only one turn.");
    await dispatchComposerKey(dom, container, { key: "Enter" });
    await waitFor(dom, () => harness.submitRequests.length === 1);
    await dispatchComposerKey(dom, container, { key: "Enter", repeat: true });
    await dispatchComposerKey(dom, container, { key: "Enter" });
    expect(harness.submitRequests).toHaveLength(1);

    await act(async () => {
      resolveTurn?.(completedResult());
      await settle(dom);
    });
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps old and new no-model Jobs hidden while a second turn waits for its result", async () => {
    const dom = createDom();
    const harness = createHarness(modelWaitingTimeline());
    harness.jobs = [modelWaitingJob()];
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    const secondJob = {
      ...modelWaitingJob(),
      id: "job_20260714_modelwait02",
      conversationEventId: "event_20260714_modelwait02",
      createdAt: new Date(Date.now() + 1_000).toISOString(),
      updatedAt: new Date(Date.now() + 1_001).toISOString()
    };
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      harness.jobs = [modelWaitingJob(), secondJob];
      return new Promise((resolve) => {
        resolveTurn = resolve;
      });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => buttons(container, "Open Models").length === 1);

    await setTextareaValue(dom, container, "Try this second turn.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.textContent).not.toContain("job_20260713_modelwait");
    expect(container.textContent).not.toContain("job_20260714_modelwait02");
    expect(container.textContent).not.toContain("Waiting for a local capability");

    const nextTimeline = modelWaitingTimeline();
    harness.timeline = {
      ...nextTimeline,
      tailEventId: "event_20260714_modelwait02",
      messages: nextTimeline.messages.map((message) => ({
        ...message,
        id: "event_20260714_modelwait02",
        jobId: secondJob.id
      })),
      latestTurn: {
        ...nextTimeline.latestTurn,
        jobId: secondJob.id,
        userEventId: "event_20260714_modelwait02"
      }
    };
    await act(async () => {
      resolveTurn?.({
        ...missingModelResult(),
        jobId: secondJob.id,
        conversationEventId: "event_20260714_modelwait02",
        tailEventId: "event_20260714_modelwait02"
      });
      await settle(dom);
    });
    await waitFor(dom, () => buttons(container, "Open Models").length === 1);
    expect(container.querySelector(".task-panel")).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("docks processing files to the composer and removes terminal or non-source Jobs", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    harness.onboarding = readyWithoutModelOnboarding(true);
    harness.jobs = [
      sourceWaitingForModelJob(),
      {
        ...sourceWaitingForModelJob(),
        id: "job_20260716_completedsource",
        state: "completed",
        sourceDisplayName: "completed-source.csv"
      },
      {
        ...sourceWaitingForModelJob(),
        id: "job_20260716_failedsource",
        state: "failed_final",
        sourceDisplayName: "failed-source.csv"
      },
      runningAgentJob()
    ];
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => container.querySelector(".task-panel") !== null);
    expect(container.textContent).toContain("public-alpha.csv");
    expect(container.textContent).not.toContain("completed-source.csv");
    expect(container.textContent).not.toContain("failed-source.csv");
    await clickButtonByAriaLabel(dom, container, "Expand processing files");
    expect(container.querySelectorAll(".task-row")).toHaveLength(1);

    await act(async () => root.unmount());
    dom.window.close();

    const terminalDom = createDom(420);
    const terminalHarness = createHarness(undefined);
    terminalHarness.onboarding = readyWithoutModelOnboarding(true);
    terminalHarness.jobs = [{
      ...sourceWaitingForModelJob(),
      state: "completed",
      sourceDisplayName: "completed-source.csv"
    }];
    const terminalMount = await mountHome(terminalDom, makePigeApi(terminalHarness));
    expect(terminalMount.container.querySelector(".task-panel")).toBeNull();

    await act(async () => terminalMount.root.unmount());
    terminalDom.window.close();
  });

  it("filters conversation-owned model waits before capping Recent Work", async () => {
    const dom = createDom();
    const harness = createHarness(modelWaitingTimeline());
    harness.onboarding = readyWithoutModelOnboarding(false);
    harness.enforceJobFilters = true;
    harness.jobs = [
      {
        ...sourceWaitingForModelJob(),
        updatedAt: "2026-07-13T08:00:00.000Z"
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        ...modelWaitingJob(),
        id: `job_20260713_modelwait0${index + 1}`,
        conversationEventId: `event_20260713_modelwait0${index + 1}`,
        updatedAt: `2026-07-13T08:00:0${index + 2}.000Z`
      }))
    ];
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => container.textContent?.includes("public-alpha.csv") === true);
    expect(container.textContent).toContain("public-alpha.csv");
    expect(container.textContent).not.toContain("job_20260713_modelwait");
    expect(buttons(container, "Open Models")).toHaveLength(1);
    expect(harness.jobListRequests.some((request) =>
      request.limit === 100 && request.classes?.includes("agent_turn")
    )).toBe(true);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shows one truthful source-saved model wait and one repair action across restart", async () => {
    const dom = createDom();
    const harness = createHarness({
      conversationId: "conv_20260713_sourcewait",
      tailEventId: "event_20260713_sourcewait",
      canFollowUp: false,
      messages: [{
        id: "event_20260713_sourcewait",
        role: "user",
        createdAt: "2026-07-13T08:00:00.000Z",
        text: "Review the attached source.",
        jobId: "job_20260713_sourcewait"
      }],
      latestTurn: {
        jobId: "job_20260713_sourcewait",
        userEventId: "event_20260713_sourcewait",
        state: "waiting_dependency",
        error: defaultModelMissingError()
      }
    });
    harness.onboarding = readyWithoutModelOnboarding(true);
    harness.jobs = [sourceWaitingForModelJob()];
    const api = makePigeApi(harness);
    const firstMount = await mountHome(dom, api);
    const expectedStatus = "Source saved. Connect a model for the Agent to continue.";

    await waitFor(dom, () => countText(firstMount.container, expectedStatus) === 1);
    expect(countText(firstMount.container, expectedStatus)).toBe(1);
    expect(buttons(firstMount.container, "Connect Model")).toHaveLength(1);
    expect(firstMount.container.textContent).not.toContain("Waiting for a local capability");
    expect(firstMount.container.textContent).not.toContain("Connect a model service before asking Pi Agent.");
    expect(firstMount.container.textContent).not.toContain(
      "You can save content now. Connect a model to ask Pi Agent."
    );

    await act(async () => firstMount.root.unmount());
    const reopened = await mountHome(dom, api);
    await waitFor(dom, () => countText(reopened.container, expectedStatus) === 1);
    expect(buttons(reopened.container, "Connect Model")).toHaveLength(1);
    expect(reopened.container.textContent).not.toContain("Waiting for a local capability");

    const modelRepairOpener = buttons(reopened.container, "Connect Model")[0]!;
    modelRepairOpener.focus();
    await clickElement(dom, modelRepairOpener);
    await waitFor(dom, () => harness.dismissFirstHomeCalls === 1);
    await waitFor(dom, () => reopened.container.querySelector(".settings-page[aria-label=\"Models\"] h1")?.textContent === "Models");
    expect(modelRepairOpener.isConnected).toBe(true);

    const settingsDialog = reopened.container.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => {
      settingsDialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    await waitFor(dom, () => dom.window.document.activeElement === modelRepairOpener);

    await act(async () => reopened.root.unmount());
    dom.window.close();
  });

  it("keeps Settings as the sole focus surface when a wide window becomes compact", async () => {
    const dom = createDom(720);
    const resizeViewport = installResizableMatchMedia(dom, 720);
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await clickButtonByAriaLabel(dom, container, "Expand sidebar");
    await waitFor(dom, () => container.querySelector(".sidebar-settings-control") !== null);
    const settingsTrigger = requireElement(container.querySelector<HTMLButtonElement>(".sidebar-settings-control"));
    settingsTrigger.focus();
    await clickElement(dom, settingsTrigger);
    await waitFor(dom, () => container.querySelector('[role="dialog"]') !== null);

    const header = requireElement(container.querySelector<HTMLElement>(".topbar"));
    const sidebar = requireElement(container.querySelector<HTMLElement>(".sidebar"));
    const workspace = requireElement(container.querySelector<HTMLElement>(".workspace"));
    expect(header.hasAttribute("inert")).toBe(true);
    expect(sidebar.hasAttribute("inert")).toBe(true);
    expect(workspace.hasAttribute("inert")).toBe(true);
    expect(dom.window.document.activeElement?.getAttribute("aria-label")).toBe("Close Settings");

    await resizeViewport(420);
    const dialog = requireElement(container.querySelector<HTMLElement>('[role="dialog"]'));
    const compactNavigation = requireElement(dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Settings sections"]'
    ));
    await waitFor(dom, () => dom.window.document.activeElement === compactNavigation);
    expect(dom.window.document.activeElement).toBe(compactNavigation);
    expect(header.hasAttribute("inert")).toBe(true);
    expect(sidebar.hasAttribute("inert")).toBe(true);
    expect(workspace.hasAttribute("inert")).toBe(true);

    await act(async () => {
      dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[role="dialog"]') === null);
    await waitFor(dom, () => dom.window.document.activeElement === settingsTrigger);
    expect(header.hasAttribute("inert")).toBe(false);
    expect(sidebar.hasAttribute("inert")).toBe(false);
    expect(workspace.hasAttribute("inert")).toBe(false);
    expect(dom.window.document.activeElement).toBe(settingsTrigger);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("owns one app-wide high-risk confirmation with bounded copy and Deny focused by default", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.confirmationPending = pendingHighRiskConfirmation();
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => container.querySelector('[role="dialog"]') !== null);
    const dialog = requireElement(container.querySelector<HTMLElement>('[role="dialog"]'));
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Allow this high-risk effect?");
    expect(dialog.textContent).toContain("Run a shell command");
    expect(dialog.textContent).toContain("Local system");
    expect(dialog.textContent).toContain("git");
    expect(buttons(dialog, "Deny")).toHaveLength(1);
    expect(buttons(dialog, "Allow this effect")).toHaveLength(1);
    expect(container.querySelector(".topbar")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".main-layout")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".permission-prompt")).toBeNull();
    expect(container.querySelector(".model-egress-prompt")).toBeNull();
    for (const unsafeCopy of [
      "confirm_20260722_abcdefghijklmnop",
      "turn_20260722_abcdefghijkl",
      "/Users/private",
      "git push",
      "secret-value"
    ]) expect(dialog.textContent).not.toContain(unsafeCopy);
    await waitFor(dom, () => dom.window.document.activeElement === buttons(dialog, "Deny")[0]);

    await act(async () => {
      dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        isComposing: true
      }));
      await settle(dom);
    });
    expect(harness.confirmationResolveRequests).toHaveLength(0);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true
      }));
      await settle(dom);
    });
    expect(harness.confirmationResolveRequests).toEqual([{
      apiVersion: 1,
      confirmationId: "confirm_20260722_abcdefghijklmnop",
      expectedRevision: 7,
      decision: "deny"
    }]);
    await waitFor(dom, () => container.querySelector('[role="dialog"]') === null);
    expect(container.querySelector(".topbar")?.hasAttribute("inert")).toBe(false);
    expect(container.querySelector(".main-layout")?.hasAttribute("inert")).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("serializes the exact confirmation decision and keeps failures body-free and retryable", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.confirmationPending = pendingHighRiskConfirmation();
    harness.confirmationResolveMode = "failed";
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttons(container, "Allow this effect").length === 1);
    await clickButton(dom, container, "Allow this effect");
    await waitFor(dom, () => harness.confirmationResolveRequests.length === 1);
    await waitFor(dom, () => container.querySelector('[role="alert"]') !== null);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Pige could not save this decision. Review it and try again."
    );
    expect(container.textContent).not.toContain("synthetic");
    expect(buttons(container, "Deny")[0]?.disabled).toBe(false);
    expect(buttons(container, "Allow this effect")[0]?.disabled).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("adopts only monotonic confirmation events and traps keyboard focus inside the dialog", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.confirmationPending = pendingHighRiskConfirmation();
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttons(container, "Deny").length === 1);
    const dialog = requireElement(container.querySelector<HTMLElement>('[role="dialog"]'));
    const deny = buttons(dialog, "Deny")[0]!;
    const allow = buttons(dialog, "Allow this effect")[0]!;
    allow.focus();
    await act(async () => {
      allow.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(deny);
    await act(async () => {
      deny.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true
      }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(allow);

    const stale: HighRiskConfirmationChangedEvent = { apiVersion: 1, status: "none", revision: 6 };
    for (const listener of harness.confirmationListeners) listener(stale);
    await act(async () => settle(dom));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    const current: HighRiskConfirmationChangedEvent = { apiVersion: 1, status: "none", revision: 8 };
    for (const listener of harness.confirmationListeners) listener(current);
    await act(async () => settle(dom));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps an unreadable confirmation query body-free and offers an explicit retry", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.confirmationResolveMode = "reject_initial";
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => container.querySelector(".confirmation-recovery-notice") !== null);
    const notice = requireElement(container.querySelector<HTMLElement>(".confirmation-recovery-notice"));
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain(
      "Pige could not check whether a high-risk effect needs your decision."
    );
    expect(notice.textContent).not.toContain("synthetic");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    harness.confirmationResolveMode = "success";
    harness.confirmationPending = pendingHighRiskConfirmation();
    await clickButton(dom, notice, "Retry");
    await waitFor(dom, () => container.querySelector('[role="dialog"]') !== null);
    expect(harness.confirmationPendingReads).toBe(2);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("gives a picker source Job sole status ownership before submission resolves", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.onboarding = readyWithoutModelOnboarding(true);
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      harness.jobs = [sourceWaitingForModelJob()];
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    const expectedStatus = "Source saved. Connect a model for the Agent to continue.";

    await attachFile(dom, container, "public-alpha.csv", "item,score\nAlpha,9\n");
    await waitFor(dom, () => countText(container, expectedStatus) === 1);
    expect(countText(container, expectedStatus)).toBe(1);
    expect(buttons(container, "Connect Model")).toHaveLength(1);
    expect(modelActionButtons(container)).toHaveLength(1);
    expect(container.textContent).not.toContain("Pi Agent is working.");
    expect(container.textContent).not.toContain("Connect a model service before asking Pi Agent.");
    expect(container.textContent).not.toContain("Open Models");
    expect(container.textContent).not.toContain("Waiting for a local capability");

    await act(async () => {
      resolveTurn?.(sourceWaitingForModelResult());
      await settle(dom);
    });
    await waitFor(dom, () => countText(container, expectedStatus) === 1);
    expect(modelActionButtons(container)).toHaveLength(1);
    expect(container.textContent).not.toContain("Pi Agent is working.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("routes a full-window Home drop through the same intermediate source owner", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.onboarding = readyWithoutModelOnboarding(true);
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      harness.jobs = [sourceWaitingForModelJob()];
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    const expectedStatus = "Source saved. Connect a model for the Agent to continue.";

    await dropFile(dom, container, "public-alpha.csv", "item,score\nAlpha,9\n");
    await waitFor(dom, () => countText(container, expectedStatus) === 1);
    expect(harness.submitRequests).toHaveLength(1);
    expect(modelActionButtons(container)).toHaveLength(1);
    expect(container.textContent).not.toContain("Pi Agent is working.");
    expect(container.textContent).not.toContain("Waiting for a local capability");

    await act(async () => {
      resolveTurn?.(sourceWaitingForModelResult());
      await settle(dom);
    });
    await waitFor(dom, () => countText(container, expectedStatus) === 1);
    expect(modelActionButtons(container)).toHaveLength(1);
    expect(container.textContent).not.toContain("Pi Agent is working.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("restores a bounded timeline and submits the next message as one exact durable follow-up", async () => {
    const dom = createDom();
    let uuidCalls = 0;
    Object.defineProperty(dom.window.crypto, "randomUUID", {
      configurable: true,
      value: () => {
        uuidCalls += 1;
        return "12345678-90ab-4cde-8f01-234567890abc";
      }
    });
    const harness = createHarness(completedTimeline());
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      harness.timeline = {
        conversationId: "conv_20260712_homefixture",
        tailEventId: "event_20260712_assistant02",
        canFollowUp: true,
        messages: [
          ...completedTimeline().messages,
          {
            id: "event_20260712_user02",
            role: "user",
            createdAt: "2026-07-12T08:02:00.000Z",
            text: "Continue with one practical example.",
            jobId: "job_20260712_turn02"
          },
          {
            id: "event_20260712_assistant02",
            role: "assistant",
            createdAt: "2026-07-12T08:02:01.000Z",
            text: "Here is the second answer.",
            jobId: "job_20260712_turn02"
          }
        ],
        latestTurn: {
          jobId: "job_20260712_turn02",
          userEventId: "event_20260712_user02",
          state: "completed"
        }
      };
      return completedResult();
    };
    const api = makePigeApi(harness);
    const firstMount = await mountHome(dom, api);

    expect(firstMount.container.querySelector('[aria-label="Conversation"]')).not.toBeNull();
    expect(firstMount.container.textContent).toContain("What should I remember?");
    expect(firstMount.container.textContent).toContain("Remember the durable boundary.");

    await setTextareaValue(dom, firstMount.container, "Continue with one practical example.");
    await clickButton(dom, firstMount.container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);

    const request = harness.submitRequests[0];
    expect(request).toMatchObject({
      schemaVersion: 1,
      text: "Continue with one practical example.",
      inputKind: "follow_up",
      objective: "auto",
      locale: "en",
      conversationId: "conv_20260712_homefixture",
      expectedTailEventId: "event_20260712_assistant01"
    });
    expect(request?.clientTurnId).toMatch(/^turn_\d{8}_[a-z0-9]{12,64}$/);
    expect(uuidCalls).toBe(1);
    await waitFor(dom, () => countText(firstMount.container, "Here is the second answer.") === 1);
    expect(countText(firstMount.container, "Here is the second answer.")).toBe(1);

    await act(async () => firstMount.root.unmount());
    const secondMount = await mountHome(dom, api);
    expect(secondMount.container.textContent).toContain("Continue with one practical example.");
    expect(secondMount.container.textContent).toContain("Here is the second answer.");
    expect(secondMount.container.querySelectorAll(".conversation-message")).toHaveLength(4);

    await act(async () => secondMount.root.unmount());
    dom.window.close();
  });

  it("renders a bounded Agent-selected Dataset result as an accessible table with exact citations", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      return datasetCompletedResult();
    };
    const mount = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, mount.container, "Show sales totals by region.");
    await clickButton(dom, mount.container, "Send");
    await waitFor(dom, () => mount.container.querySelector(".dataset-table") !== null);

    const table = mount.container.querySelector<HTMLTableElement>(".dataset-table");
    expect(table?.caption?.textContent).toBe("Sales");
    expect(Array.from(table?.querySelectorAll("th") ?? []).map((cell) => cell.textContent)).toEqual([
      "Region",
      "Total sales"
    ]);
    expect(Array.from(table?.querySelectorAll("tbody tr") ?? []).map((row) => row.textContent)).toEqual([
      "North120.5",
      "South87"
    ]);
    expect(mount.container.textContent).toContain("Dataset result");
    expect(mount.container.textContent).toContain("Rows: 2/2");
    expect(mount.container.textContent).toContain("D1 Sales by region");
    expect(mount.container.textContent).not.toContain("collection.sqlite");
    expect(mount.container.textContent).not.toContain("dataset_20260713_salesdataset01");

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("restores the bounded Dataset table and exact citations from the durable conversation timeline", async () => {
    const dom = createDom();
    const harness = createHarness(completedDatasetTimeline());
    const api = makePigeApi(harness);

    const firstMount = await mountHome(dom, api);
    await waitFor(dom, () => firstMount.container.querySelector(".dataset-table") !== null);
    expect(firstMount.container.textContent).toContain("D1 Sales by region");
    expect(firstMount.container.textContent).toContain("North120.5");
    await act(async () => firstMount.root.unmount());

    const reopened = await mountHome(dom, api);
    await waitFor(dom, () => reopened.container.querySelector(".dataset-table") !== null);
    expect(reopened.container.textContent).toContain("Rows: 2/2");
    expect(reopened.container.textContent).toContain("D1 Sales by region");
    expect(reopened.container.textContent).not.toContain("dataset_20260713_salesdataset01");

    await act(async () => reopened.root.unmount());
    dom.window.close();
  });

  it("does not let an earlier turn completion erase a newly typed follow-up draft", async () => {
    const dom = createDom();
    const harness = createHarness(completedTimeline());
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => {
        resolveTurn = resolve;
      });
    };
    const mount = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, mount.container, "Start the next answer.");
    await clickButton(dom, mount.container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    await setTextareaValue(dom, mount.container, "Draft the follow-up while this runs.");

    await act(async () => {
      resolveTurn?.(completedResult());
      await Promise.resolve();
    });
    await waitFor(dom, () => textareaValue(mount.container) === "Draft the follow-up while this runs.");
    expect(textareaValue(mount.container)).toBe("Draft the follow-up while this runs.");

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("replaces one escaped provisional answer and ignores stale or wrong-turn drafts before the final", async () => {
    const dom = createDom();
    const harness = createHarness(completedTimeline());
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Stream one safe answer.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    await waitFor(dom, () => container.querySelector(".conversation-status-message.state-running") !== null);
    expect(container.querySelector(".conversation-status-message .conversation-loading-dots")).not.toBeNull();
    expect(container.querySelector(".composer > .agent-run-state")).toBeNull();
    const clientTurnId = harness.submitRequests[0]?.clientTurnId;
    if (!clientTurnId) throw new Error("Expected a client turn identity.");

    await act(async () => {
      harness.emitDraft(draftEvent({ clientTurnId: "turn_20260713_wrongturn000", sequence: 1, text: "Wrong turn." }));
      harness.emitDraft(draftEvent({
        clientTurnId,
        sequence: 1,
        text: "## Safe draft one\n\n- Local item\n\n<img src=x onerror=alert(1)>"
      }));
      await settle(dom);
    });
    const provisional = container.querySelector<HTMLElement>('[data-agent-draft="true"]');
    expect(container.querySelector(".conversation-status-message")).toBeNull();
    await waitFor(dom, () => provisional?.querySelector('[data-markdown-ready="true"]') !== null);
    expect(provisional?.querySelector("h2")?.textContent).toBe("Safe draft one");
    expect(provisional?.querySelector("li")?.textContent).toBe("Local item");
    expect(provisional?.querySelector("img")).toBeNull();
    expect(provisional?.closest("[aria-busy]")?.getAttribute("aria-busy")).toBe("true");
    expect(provisional?.getAttribute("aria-live")).toBeNull();

    await act(async () => {
      harness.emitDraft(draftEvent({ clientTurnId, sequence: 1, text: "Stale replacement." }));
      harness.emitDraft(draftEvent({ clientTurnId, sequence: 2, text: "Safe draft two." }));
      await settle(dom);
    });
    expect(container.querySelector('[data-agent-draft="true"]')?.textContent).toContain("Safe draft two.");
    expect(container.textContent).not.toContain("Stale replacement.");

    await act(async () => {
      resolveTurn?.(completedResult());
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-agent-draft="true"]') === null);
    expect(countText(container, "Here is the second answer.")).toBe(1);

    await act(async () => root.unmount());
    const reopened = await mountHome(dom, makePigeApi(harness));
    await act(async () => {
      harness.emitDraft(draftEvent({ clientTurnId, sequence: 3, text: "Must not replay after reopen." }));
      await settle(dom);
    });
    expect(reopened.container.querySelector('[data-agent-draft="true"]')).toBeNull();
    expect(reopened.container.textContent).not.toContain("Must not replay after reopen.");
    await act(async () => reopened.root.unmount());
    dom.window.close();
  });

  it("clears and posts the prompt immediately, then converges one streamed turn without a final duplicate", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const completed = completedResult();
    if (completed.state !== "completed") throw new Error("Expected completed result fixture.");
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      harness.jobs = [{ ...runningAgentJob(), id: completed.jobId }];
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Show this prompt immediately.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    const clientTurnId = harness.submitRequests[0]?.clientTurnId;
    if (!clientTurnId) throw new Error("Expected a client turn identity.");

    expect(textareaValue(container)).toBe("");
    expect(container.querySelectorAll('[data-optimistic-user-message="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-optimistic-user-message="true"]')?.textContent)
      .toContain("Show this prompt immediately.");
    expect(container.querySelectorAll(".conversation-message.role-user")).toHaveLength(1);
    expect(container.querySelector(".conversation-loading-dots")).not.toBeNull();
    expect(container.querySelector(".home")?.classList.contains("home-conversation-active")).toBe(true);

    await act(async () => {
      harness.emitDraft(draftEvent({
        clientTurnId,
        requestId: completed.requestId,
        jobId: completed.jobId,
        conversationId: completed.conversationId,
        conversationEventId: completed.conversationEventId,
        sequence: 1,
        text: "Streaming answer"
      }));
      await settle(dom);
    });
    expect(textareaValue(container)).toBe("");
    expect(container.querySelectorAll(".conversation-message.role-user")).toHaveLength(1);
    expect(container.querySelectorAll('[data-agent-draft="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-agent-draft="true"]')?.textContent).toContain("Streaming answer");

    harness.timeline = {
      conversationId: completed.conversationId,
      tailEventId: completed.tailEventId,
      canFollowUp: true,
      messages: [
        {
          id: completed.conversationEventId,
          role: "user",
          createdAt: "2026-07-18T08:00:00.000Z",
          text: "Show this prompt immediately.",
          jobId: completed.jobId
        },
        {
          id: completed.tailEventId,
          role: "assistant",
          createdAt: "2026-07-18T08:00:01.000Z",
          text: completed.answer.answer,
          jobId: completed.jobId,
          answer: completed.answer
        }
      ],
      latestTurn: {
        jobId: completed.jobId,
        userEventId: completed.conversationEventId,
        state: "completed"
      }
    };
    await act(async () => {
      resolveTurn?.(completed);
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-live-agent-answer="true"]') !== null);

    expect(textareaValue(container)).toBe("");
    expect(container.querySelector('[data-optimistic-user-message="true"]')).toBeNull();
    expect(container.querySelector('[data-agent-draft="true"]')).toBeNull();
    expect(container.querySelectorAll(".conversation-message.role-user")).toHaveLength(1);
    expect(container.querySelectorAll(".conversation-message.role-assistant")).toHaveLength(1);
    expect(container.querySelector('[data-live-agent-answer="true"]')?.textContent)
      .toContain(completed.answer.answer);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("renders final conversation Markdown through the sanitized Pige renderer", async () => {
    const dom = createDom();
    const baseTimeline = completedTimeline();
    const markdownTimeline: AgentConversationTimeline = {
      ...baseTimeline,
      messages: baseTimeline.messages.map((message) => message.role === "assistant" ? {
        ...message,
        text: [
          "## Summary",
          "",
          "- **Local-first**",
          "- `Private`",
          "",
          "| State | Owner |",
          "| --- | --- |",
          "| Ready | Pige |",
          "",
          "[remote](https://example.com/private)",
          "<script>alert('no')</script>"
        ].join("\n")
      } : message)
    };
    const mount = await mountHome(dom, makePigeApi(createHarness(markdownTimeline)));

    await waitFor(dom, () => mount.container.querySelector('[data-markdown-ready="true"]') !== null);
    const assistant = requireElement(mount.container.querySelector<HTMLElement>(".conversation-message.role-assistant"));
    const user = requireElement(mount.container.querySelector<HTMLElement>(".conversation-message.role-user"));
    expect(assistant.querySelector(".conversation-message-role")?.classList.contains("visually-hidden")).toBe(true);
    expect(user.querySelector(".conversation-message-role")?.classList.contains("visually-hidden")).toBe(true);
    expect(assistant.querySelector("h2")?.textContent).toBe("Summary");
    expect(Array.from(assistant.querySelectorAll("li")).map((item) => item.textContent))
      .toEqual(["Local-first", "Private"]);
    expect(assistant.querySelector("code")?.textContent).toBe("Private");
    expect(assistant.querySelector("table")?.textContent).toContain("Ready");
    expect(assistant.querySelector("script")).toBeNull();
    expect(assistant.querySelector("a")?.getAttribute("href")).toBeNull();

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("copies only an authoritative assistant response and announces completion", async () => {
    const dom = createDom();
    const copied: string[] = [];
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { copied.push(text); } }
    });
    const mount = await mountHome(dom, makePigeApi(createHarness(completedTimeline())));

    const assistant = requireElement(mount.container.querySelector<HTMLElement>(".conversation-message.role-assistant"));
    const user = requireElement(mount.container.querySelector<HTMLElement>(".conversation-message.role-user"));
    expect(user.querySelector('[data-conversation-action="copy"]')).toBeNull();
    expect(assistant.querySelectorAll('[data-conversation-action="copy"]')).toHaveLength(1);

    await clickButtonByAriaLabel(dom, assistant, enMessages["home.copyMessage"]);
    await waitFor(dom, () => copied.length === 1);
    expect(copied).toEqual(["Remember the durable boundary."]);
    expect(assistant.querySelector('[role="status"]')?.textContent).toBe(enMessages["home.messageCopied"]);
    expect(buttonsByAriaLabel(assistant, enMessages["home.messageCopied"])).toHaveLength(1);
    expect(assistant.querySelector(".lucide-check")).not.toBeNull();
    expect(assistant.querySelector(".lucide-copy")).toBeNull();

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("keeps clipboard failure body-free and never adds copy to a provisional draft", async () => {
    const dom = createDom();
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("private /Users/example/vault body"); } }
    });
    const harness = createHarness(completedTimeline());
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const mount = await mountHome(dom, makePigeApi(harness));
    const assistant = requireElement(mount.container.querySelector<HTMLElement>(".conversation-message.role-assistant"));

    await clickButtonByAriaLabel(dom, assistant, enMessages["home.copyMessage"]);
    await waitFor(dom, () => buttonsByAriaLabel(assistant, enMessages["home.messageCopyFailed"]).length === 1);
    expect(assistant.querySelector('[role="status"]')?.textContent).toBe(enMessages["home.messageCopyFailed"]);
    expect(mount.container.textContent).not.toContain("/Users/example");

    await setTextareaValue(dom, mount.container, "Stream a draft.");
    await clickButton(dom, mount.container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    const clientTurnId = harness.submitRequests[0]?.clientTurnId;
    if (!clientTurnId) throw new Error("Expected a client turn identity.");
    await act(async () => {
      harness.emitDraft(draftEvent({ clientTurnId, sequence: 1, text: "Temporary answer." }));
      await settle(dom);
    });
    expect(mount.container.querySelector('[data-agent-draft="true"] [data-conversation-action="copy"]')).toBeNull();

    await act(async () => {
      resolveTurn?.(completedResult());
      await settle(dom);
      mount.root.unmount();
    });
    dom.window.close();
  });

  it("renders final grounded citations without internal retrieval data and opens the stable page target", async () => {
    const dom = createDom();
    const harness = createHarness(completedGroundedTimeline());
    let resolveNote: ((note: NoteRenderResult) => void) | undefined;
    harness.renderNote = (pageId) => new Promise((resolve) => {
      if (pageId !== "page_20260715_note0001") throw new Error("Unexpected citation target.");
      resolveNote = resolve;
    });
    const mount = await mountHome(dom, makePigeApi(harness));

    const citation = requireElement(mount.container.querySelector<HTMLButtonElement>(".conversation-citations .citation-row"));
    expect(citation.textContent).toContain("1");
    expect(citation.textContent).toContain("Durable boundaries");
    expect(citation.textContent).toContain("Note");
    expect(mount.container.textContent).not.toContain("page_20260715_note0001");
    expect(mount.container.textContent).not.toContain("wiki/note-a.md");
    expect(mount.container.textContent).not.toContain("heading:durable-boundaries");
    expect(mount.container.textContent).not.toContain("92%");

    await clickElement(dom, citation);
    await waitFor(dom, () => citation.hasAttribute("disabled"));
    expect(harness.noteRenderRequests).toEqual(["page_20260715_note0001"]);
    expect(citation.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      resolveNote?.(testRenderedNote("page_20260715_note0001"));
      await settle(dom);
    });
    await waitFor(dom, () => mount.container.querySelector(".note-reader") !== null);
    expect(mount.container.querySelector(".note-reader")?.textContent).toContain("Note A");

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("keeps citations final-only and omits them from user messages and provisional drafts", async () => {
    const dom = createDom();
    const harness = createHarness(completedGroundedTimeline());
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const mount = await mountHome(dom, makePigeApi(harness));

    expect(mount.container.querySelectorAll(".conversation-citations")).toHaveLength(1);
    expect(mount.container.querySelector(".conversation-message.role-user .conversation-citations")).toBeNull();
    await setTextareaValue(dom, mount.container, "Stream without final citations.");
    await clickButton(dom, mount.container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    const clientTurnId = harness.submitRequests[0]?.clientTurnId;
    if (!clientTurnId) throw new Error("Expected a client turn identity.");
    await act(async () => {
      harness.emitDraft(draftEvent({ clientTurnId, sequence: 1, text: "Provisional grounded copy." }));
      await settle(dom);
    });
    expect(mount.container.querySelector('[data-agent-draft="true"] .conversation-citations')).toBeNull();
    expect(mount.container.querySelectorAll(".conversation-citations")).toHaveLength(1);

    await act(async () => {
      resolveTurn?.(completedResult());
      await settle(dom);
    });
    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("renders the just-completed answer as the same role-free Markdown message", async () => {
    const dom = createDom();
    const harness = createHarness(completedTimeline());
    const completed = completedResult();
    if (completed.state !== "completed") throw new Error("Expected completed result fixture.");
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      return {
        ...completed,
        answer: {
          ...completed.answer,
          answer: "## Live answer\n\n- First\n- Second"
        }
      };
    };
    const mount = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, mount.container, "Return Markdown now.");
    await clickButton(dom, mount.container, "Send");
    await waitFor(dom, () => mount.container.querySelector('[data-live-agent-answer="true"] [data-markdown-ready="true"]') !== null);
    const live = requireElement(mount.container.querySelector<HTMLElement>('[data-live-agent-answer="true"]'));
    expect(live.querySelector(".conversation-message-role")?.classList.contains("visually-hidden")).toBe(true);
    expect(live.querySelector("h2")?.textContent).toBe("Live answer");
    expect(Array.from(live.querySelectorAll("li")).map((item) => item.textContent)).toEqual(["First", "Second"]);
    expect(mount.container.querySelector(".retrieval-answer")).toBeNull();

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("renders safe Reader action presentation and omits unpresentable empty timeline rows", async () => {
    const dom = createDom();
    const timeline = completedTimeline();
    const harness = createHarness({
      ...timeline,
      messages: [
        ...timeline.messages,
        {
          id: "event_20260722_transform01",
          role: "user",
          createdAt: "2026-07-22T08:00:02.000Z",
          text: "",
          jobId: "job_20260722_transform01",
          inputPresentation: {
            kind: "reader_selection_transform",
            action: "translate"
          }
        },
        {
          id: "event_20260722_action01",
          role: "user",
          createdAt: "2026-07-22T08:00:02.500Z",
          text: "",
          jobId: "job_20260722_action01",
          inputPresentation: {
            kind: "reader_selection_action",
            action: "summarize"
          }
        },
        {
          id: "event_20260722_emptyassistant",
          role: "assistant",
          createdAt: "2026-07-22T08:00:03.000Z",
          text: "",
          jobId: "job_20260722_emptyassistant"
        }
      ]
    });
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    const presentation = requireElement(container.querySelector<HTMLElement>(
      '[data-input-presentation="reader_selection_transform"]'
    ));
    expect(presentation.textContent).toContain("Translate selected passage");
    const readPresentation = requireElement(container.querySelector<HTMLElement>(
      '[data-input-presentation="reader_selection_action"]'
    ));
    expect(readPresentation.textContent).toContain("Summarize");
    expect(container.querySelector('[data-message-id="event_20260722_emptyassistant"]')).toBeNull();
    expect(container.querySelectorAll('[data-conversation-action="copy"]')).toHaveLength(1);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a completed answer visible and follows its exact tail when an older timeline read arrives", async () => {
    const dom = createDom();
    const harness = createHarness(completedTimeline());
    const completed = completedResult();
    if (completed.state !== "completed") throw new Error("Expected completed result fixture.");
    let submitCount = 0;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      submitCount += 1;
      if (submitCount === 1) return Promise.resolve(completed);
      harness.jobs = [{ ...runningAgentJob(), id: "job_20260722_multiturn03" }];
      return new Promise<AgentSubmitTurnResult>(() => undefined);
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Complete this turn before the timeline refreshes.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => container.querySelector('[data-live-agent-answer="true"]') !== null);
    expect(container.textContent).toContain("Remember the durable boundary.");
    expect(container.textContent).toContain(completed.answer.answer);

    await setTextareaValue(dom, container, "Continue from that exact answer.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 2);

    expect(container.textContent).toContain(completed.answer.answer);
    expect(container.querySelectorAll(".conversation-message.role-assistant")).toHaveLength(3);
    expect(harness.submitRequests[1]).toMatchObject({
      inputKind: "follow_up",
      conversationId: completed.conversationId,
      expectedTailEventId: completed.tailEventId
    });

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps the active draft when an older completed conversation load arrives late", async () => {
    const dom = createDom();
    const harness = createHarness(completedTimeline());
    let resolveConversation: ((timeline: AgentConversationTimeline | undefined) => void) | undefined;
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const api = makePigeApi(harness) as {
      readonly agent: {
        conversation: () => Promise<AgentConversationTimeline | undefined>;
      };
    };
    api.agent.conversation = () => new Promise((resolve) => { resolveConversation = resolve; });
    const { container, root } = await mountHome(dom, api);

    await setTextareaValue(dom, container, "Start while the old conversation loads.");
    await dispatchComposerKey(dom, container, { key: "Enter" });
    await waitFor(dom, () => harness.submitRequests.length === 1);
    const clientTurnId = harness.submitRequests[0]?.clientTurnId;
    if (!clientTurnId) throw new Error("Expected a client turn identity.");
    await act(async () => {
      harness.emitDraft(draftEvent({ clientTurnId, sequence: 1, text: "Current provisional answer." }));
      await settle(dom);
    });
    expect(container.querySelector('[data-agent-draft="true"]')?.textContent)
      .toContain("Current provisional answer.");

    await act(async () => {
      resolveConversation?.(completedTimeline());
      await settle(dom);
    });
    expect(container.querySelector('[data-agent-draft="true"]')?.textContent)
      .toContain("Current provisional answer.");

    await act(async () => {
      resolveTurn?.(completedResult());
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-agent-draft="true"]') === null);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("clears a provisional answer when the authoritative turn fails", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Fail after a safe draft.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    const clientTurnId = harness.submitRequests[0]?.clientTurnId;
    if (!clientTurnId) throw new Error("Expected a client turn identity.");
    await act(async () => {
      harness.emitDraft(draftEvent({ clientTurnId, sequence: 1, text: "Temporary safe answer." }));
      await settle(dom);
    });
    expect(container.textContent).toContain("Temporary safe answer.");

    await act(async () => {
      resolveTurn?.(failedResult());
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-agent-draft="true"]') === null);
    expect(container.textContent).not.toContain("Temporary safe answer.");
    expect(container.textContent).toContain("The model service did not complete this answer. Try again.");
    expect(textareaValue(container)).toBe("");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves an unsaved prompt when a failed submission has no durable conversation event", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      const failed = failedResult();
      if (failed.state !== "failed") throw new Error("Expected a failed fixture.");
      return {
        requestId: failed.requestId,
        state: failed.state,
        modelUsage: failed.modelUsage,
        sourceIds: failed.sourceIds,
        error: failed.error
      };
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Keep this prompt if no event was saved.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => container.querySelector(".conversation-status-message.state-failed") !== null);
    expect(textareaValue(container)).toBe("Keep this prompt if no event was saved.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not clear a newer draft when a durable submitted turn later fails", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Submit the first prompt.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    await setTextareaValue(dom, container, "Keep this newer draft.");
    await act(async () => {
      resolveTurn?.(failedResult());
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector(".conversation-status-message.state-failed") !== null);
    expect(textareaValue(container)).toBe("Keep this newer draft.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("clears a provisional answer when cancellation settles the active turn", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Cancel after a safe draft.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    const clientTurnId = harness.submitRequests[0]?.clientTurnId;
    if (!clientTurnId) throw new Error("Expected a client turn identity.");
    await act(async () => {
      harness.emitDraft(draftEvent({ clientTurnId, sequence: 1, text: "Temporary answer before cancellation." }));
      await settle(dom);
    });
    expect(container.textContent).toContain("Temporary answer before cancellation.");

    await act(async () => {
      resolveTurn?.(cancelledResult());
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-agent-draft="true"]') === null);
    expect(container.textContent).not.toContain("Temporary answer before cancellation.");
    expect(container.textContent).toContain("The Agent turn was cancelled. You can retry it.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("retries the durable latest Job without submitting a replacement turn", async () => {
    const dom = createDom();
    const harness = createHarness({
      conversationId: "conv_20260712_retryfixture",
      tailEventId: "event_20260712_retryuser",
      canFollowUp: false,
      messages: [{
        id: "event_20260712_retryuser",
        role: "user",
        createdAt: "2026-07-12T09:00:00.000Z",
        text: "Please retry this turn.",
        jobId: "job_20260712_retryfixture"
      }],
      latestTurn: {
        jobId: "job_20260712_retryfixture",
        userEventId: "event_20260712_retryuser",
        state: "failed_retryable",
        error: safeCallError()
      }
    });
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttons(container, "Try again").length === 1);
    await clickButton(dom, container, "Try again");
    await waitFor(dom, () => harness.retryJobIds.length === 1);

    expect(harness.retryJobIds).toEqual(["job_20260712_retryfixture"]);
    expect(harness.submitRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("hands a requeued acknowledgement back to the ordinary failure owner when the same Job fails again", async () => {
    const jobId = "job_20260712_retryfixture";
    const dom = createDom();
    const harness = createHarness({
      conversationId: "conv_20260712_retryfixture",
      tailEventId: "event_20260712_retryuser",
      canFollowUp: false,
      messages: [{
        id: "event_20260712_retryuser",
        role: "user",
        createdAt: "2026-07-12T09:00:00.000Z",
        text: "Please retry this turn.",
        jobId
      }],
      latestTurn: {
        jobId,
        userEventId: "event_20260712_retryuser",
        state: "failed_retryable",
        error: safeCallError()
      }
    });
    harness.jobs = [{
      id: jobId,
      class: "agent_turn",
      state: "failed_retryable",
      error: safeCallError(),
      message: "body-free retry failure",
      createdAt: "2026-07-12T09:00:00.000Z",
      updatedAt: "2026-07-12T09:00:02.000Z"
    }];
    harness.retryMode = "immediate_refail";
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttons(container, "Try again").length === 1);
    await clickButton(dom, container, "Try again");
    await waitFor(dom, () => harness.retryJobIds.length === 1);
    await waitFor(dom, () => container.querySelector(".capture-toast") === null);

    expect(container.querySelector(".conversation-status-message")?.textContent)
      .toContain("The model service did not complete this answer. Try again.");
    expect(buttons(container, "Try again")).toHaveLength(1);
    expect(harness.submitRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("offers cancellation for a running Agent turn and accepts cancel_requested as success", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.jobs = [runningAgentJob()];
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttonsByAriaLabel(container, "Cancel").length === 1);
    await clickElement(dom, buttonsByAriaLabel(container, "Cancel")[0]!);
    await waitFor(dom, () => harness.cancelJobIds.length === 1);

    expect(harness.cancelJobIds).toEqual(["job_20260712_runningfixture"]);
    expect(container.textContent).toContain("Cancellation requested");
    expect(buttonsByAriaLabel(container, "Cancel")[0]?.disabled).toBe(true);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps Activity out of Home and disables repeated Undo from Settings History after durable trash", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.activities = [reversibleActivity()];
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    expect(container.querySelector('[aria-label="Activity"]')).toBeNull();
    await openSettingsSection(dom, container, "Activity History");
    await waitFor(dom, () => buttons(container, "Undo").length === 1);
    expect(container.querySelector(".settings-history-page")?.textContent)
      .toContain("Knowledge note created: Grounded boundary");
    await clickButton(dom, container, "Undo");
    await waitFor(dom, () => harness.undoOperationIds.length === 1);

    expect(harness.undoOperationIds).toEqual(["op_20260712_activityfixture"]);
    expect(container.textContent).toContain("Change moved to recoverable trash.");
    expect(container.textContent).toContain("Undone");
    expect(buttons(container, "Undo")).toHaveLength(0);
    const successToast = container.querySelector<HTMLElement>('[role="status"]');
    expect(successToast?.getAttribute("aria-live")).toBe("polite");
    const activityRow = container.querySelector<HTMLElement>('[data-activity-row-id="op_20260712_activityfixture"]');
    expect(activityRow?.querySelector(".settings-row-copy")).not.toBeNull();
    expect(activityRow?.querySelector(".activity-row-dot")?.classList.contains("is-undone")).toBe(true);
    await waitFor(dom, () => dom.window.document.activeElement === activityRow);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("labels created and updated knowledge Activity distinctly and undoes an updated page", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.activities = [reversibleActivity(), reversibleUpdatedActivity()];
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    expect(container.querySelector('[aria-label="Activity"]')).toBeNull();
    await openSettingsSection(dom, container, "Activity History");
    const createOpenLabel = "Open: Knowledge note created: Grounded boundary (1)";
    const updateOpenLabel = "Open: Knowledge note updated: Refined boundary (2)";
    const updateUndoLabel = "Undo: Knowledge note updated: Refined boundary (2)";
    await waitFor(dom, () => buttonsByAriaLabel(container, updateUndoLabel).length === 1);
    const activityRegion = container.querySelector(".settings-history-page");
    expect(activityRegion?.textContent).toContain("Knowledge note created: Grounded boundary");
    expect(activityRegion?.textContent).toContain("Knowledge note updated: Refined boundary");
    expect(container.querySelector('[data-activity-row-id="op_20260712_activityfixture"]')?.getAttribute("aria-label"))
      .toBe("Knowledge note created: Grounded boundary (1)");
    expect(container.querySelector('[data-activity-row-id="op_20260712_updateactivity"]')?.getAttribute("aria-label"))
      .toBe("Knowledge note updated: Refined boundary (2)");
    expect(buttonsByAriaLabel(container, createOpenLabel)).toHaveLength(1);
    expect(buttonsByAriaLabel(container, updateOpenLabel)).toHaveLength(1);

    await clickElement(dom, buttonsByAriaLabel(container, updateUndoLabel)[0]!);
    await waitFor(dom, () => harness.undoOperationIds.length === 1);

    expect(harness.undoOperationIds).toEqual(["op_20260712_updateactivity"]);
    expect(container.textContent).toContain("Change moved to recoverable trash.");
    expect(buttonsByAriaLabel(container, updateUndoLabel)).toHaveLength(0);
    expect(buttonsByAriaLabel(container, updateOpenLabel)).toHaveLength(0);
    expect(buttonsByAriaLabel(container, createOpenLabel)).toHaveLength(1);
    expect(buttonsByAriaLabel(container, "Undo: Knowledge note created: Grounded boundary (1)")).toHaveLength(1);
    const updatedRow = container.querySelector<HTMLElement>('[data-activity-row-id="op_20260712_updateactivity"]');
    expect(updatedRow?.textContent).toContain("Undone");
    await waitFor(dom, () => dom.window.document.activeElement === updatedRow);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("opens an exact stable Activity target and closes Settings only after Reader render succeeds", async () => {
    const dom = createDom(840);
    const harness = createHarness(undefined);
    harness.activities = [reversibleActivity()];
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await openSettingsSection(dom, container, "Activity History");
    const openLabel = "Open: Knowledge note created: Grounded boundary (1)";
    await waitFor(dom, () => buttonsByAriaLabel(container, openLabel).length === 1);
    const readsBeforeOpen = harness.activityListReads;
    await clickElement(dom, buttonsByAriaLabel(container, openLabel)[0]!);
    await waitFor(dom, () => container.querySelector(".note-reader") !== null);

    expect(container.querySelector("[data-settings-overlay]")).toBeNull();
    expect(harness.noteRenderRequests).toEqual(["page_20260715_note0001"]);
    expect(harness.activityListReads).toBe(readsBeforeOpen);
    expect(harness.undoOperationIds).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shows Activity Open only for a stable target and rejects an old-vault target after async render", async () => {
    const dom = createDom(840);
    const harness = createHarness(undefined);
    const target = reversibleActivity();
    const { target: _ignoredTarget, ...withoutTarget } = target;
    harness.activities = [{ ...withoutTarget, operationId: "op_20260712_activitynotarget" }, target];
    const pending = deferred<NoteRenderResult>();
    harness.renderNote = async () => pending.promise;
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await openSettingsSection(dom, container, "Activity History");
    await waitFor(dom, () => buttonsByAriaLabel(container, "Open: Knowledge note created: Grounded boundary (2)").length === 1);
    expect(buttonsByAriaLabel(container, "Open: Knowledge note created: Grounded boundary (1)")).toHaveLength(0);
    await clickElement(dom, buttonsByAriaLabel(container, "Open: Knowledge note created: Grounded boundary (2)")[0]!);
    await waitFor(dom, () => harness.noteRenderRequests.length === 1);

    harness.onboarding = {
      ...readyOnboarding(),
      activeVault: { ...homeVaultSummary(), vaultId: "vault_second_activity", name: "Second Activity Vault" }
    };
    await clickButtonByAriaLabel(dom, container, "Close Settings");
    await waitFor(dom, () => container.querySelector("[data-settings-overlay]") === null);
    await act(async () => {
      pending.resolve(testRenderedNote("page_20260715_note0001"));
      await pending.promise;
      await settle(dom);
    });

    expect(container.querySelector(".note-reader")).toBeNull();
    expect(harness.noteRenderRequests).toEqual(["page_20260715_note0001"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("re-reads durable Activity truth after a post-commit Undo rejection", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.activities = [reversibleActivity()];
    harness.activityUndoMode = "post_commit_reject";
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await openSettingsSection(dom, container, "Activity History");
    await waitFor(dom, () => buttons(container, "Undo").length === 1);
    await clickButton(dom, container, "Undo");
    await waitFor(dom, () => container.textContent?.includes("Undone") === true);

    expect(container.textContent).toContain("Change moved to recoverable trash.");
    expect(container.textContent).not.toContain("Pige could not safely undo this change.");
    expect(buttons(container, "Undo")).toHaveLength(0);
    const row = container.querySelector<HTMLElement>('[data-activity-row-id="op_20260712_activityfixture"]');
    await waitFor(dom, () => dom.window.document.activeElement === row);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a rejected but still-applied Undo retryable and restores focus to its action", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.activities = [reversibleActivity()];
    harness.activityUndoMode = "retryable_reject";
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await openSettingsSection(dom, container, "Activity History");
    await waitFor(dom, () => buttons(container, "Undo").length === 1);
    await clickButton(dom, container, "Undo");
    await waitFor(dom, () => container.textContent?.includes("Pige could not safely undo this change.") === true);

    const retryButton = buttons(container, "Undo")[0];
    expect(retryButton?.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.getAttribute("aria-live")).toBe("assertive");
    await waitFor(dom, () => dom.window.document.activeElement === retryButton);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fails closed with a live status and row focus when post-rejection truth cannot be read", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.activities = [reversibleActivity()];
    harness.activityUndoMode = "unknown_reject";
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await openSettingsSection(dom, container, "Activity History");
    await waitFor(dom, () => buttons(container, "Undo").length === 1);
    await clickButton(dom, container, "Undo");
    await waitFor(dom, () => container.textContent?.includes("could not verify whether this change was undone") === true);

    const blockedButton = buttons(container, "Undo")[0];
    expect(blockedButton?.disabled).toBe(true);
    const alert = container.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.getAttribute("aria-live")).toBe("assertive");
    expect(alert?.textContent).not.toContain("synthetic");
    const row = container.querySelector<HTMLElement>('[data-activity-row-id="op_20260712_activityfixture"]');
    await waitFor(dom, () => dom.window.document.activeElement === row);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps transcript text safely wrapped, file turns independently keyed, and locale keys aligned", () => {
    const appSource = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/App.tsx"),
      "utf8"
    );
    const styles = fs.readFileSync(
      path.resolve("apps/desktop/src/renderer/src/styles/app.css"),
      "utf8"
    );
    expect(styles).toMatch(/\.activity-history-row\s*\{[\s\S]*?grid-template-columns:\s*8px minmax\(0, 1fr\) auto;/);
    expect(styles).toMatch(/\.activity-row-dot\s*\{[\s\S]*?width:\s*6px;[\s\S]*?background:\s*var\(--success\);/);
    expect(styles).not.toContain(".activity-strip");
    expect(styles).toContain(".conversation-loading-dots");
    const submitFiles = appSource.slice(
      appSource.indexOf("const submitFiles"),
      appSource.indexOf("const cancelJob")
    );
    const retryLatestTurn = appSource.slice(
      appSource.indexOf("const retryLatestConversationTurn"),
      appSource.indexOf("const openProposal")
    );
    const submitHomeInput = appSource.slice(
      appSource.indexOf("const submitHomeInput"),
      appSource.indexOf("const retryLatestConversationTurn")
    );
    const conversationStyles = styles.slice(
      styles.indexOf(".conversation-timeline"),
      styles.indexOf(".retrieval-results")
    );

    expect(submitFiles).toContain("schemaVersion: 1");
    expect(submitFiles).toContain("clientTurnId = createAgentClientTurnId()");
    expect(submitFiles).toContain("clientTurnId,");
    expect(submitFiles).not.toContain("conversationId:");
    expect(retryLatestTurn).toContain("props.onRetryJob(retryableLatestTurn.jobId)");
    expect(retryLatestTurn).not.toContain("submitTurn");
    expect(submitHomeInput.indexOf("const submission = window.pige.agent.submitTurn"))
      .toBeLessThan(submitHomeInput.indexOf("props.onHomeStateChanged()"));
    expect(submitHomeInput.indexOf("props.onHomeStateChanged()"))
      .toBeLessThan(submitHomeInput.indexOf("const outcome = await submission"));
    expect(conversationStyles).toContain("min-width: 0;");
    expect(conversationStyles).toContain("overflow-wrap: anywhere;");
    expect(conversationStyles).toContain("white-space: pre-wrap;");
    expect(conversationStyles).toContain("max-height: min(36vh, 26rem);");
    expect(styles).toMatch(/\.home\.home-conversation-active\s*>\s*\.conversation-timeline\s*\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?max-height:\s*none;[\s\S]*?align-content:\s*end;/);
    expect(styles).toContain("padding-bottom: calc(18px + var(--home-processing-panel-height, 0px));");
    expect(appSource).toContain('"--home-processing-panel-height"');
    expect(appSource).toContain("new window.ResizeObserver(updateHeight)");

    const localeKeys = ["en", "zh-Hans", "ja", "ko", "fr", "de"].map((locale) =>
      Object.keys(JSON.parse(fs.readFileSync(
        path.resolve(`apps/desktop/src/renderer/src/locales/${locale}/messages.json`),
        "utf8"
      )) as Record<string, string>).sort()
    );
    for (const keys of localeKeys.slice(1)) expect(keys).toEqual(localeKeys[0]);
  });
});

interface ConversationHarness {
  timeline: AgentConversationTimeline | undefined;
  onboarding: OnboardingStatus;
  jobs: JobSummary[];
  enforceJobFilters: boolean;
  readonly jobListRequests: JobsListRequest[];
  activities: KnowledgeActivitySummary[];
  readonly submitRequests: AgentSubmitTurnRequest[];
  readonly retryJobIds: string[];
  retryMode: "queued" | "immediate_refail";
  readonly cancelJobIds: string[];
  readonly setDefaultModelIds: string[];
  readonly speechAvailabilityRequests: SpeechAvailabilityRequest[];
  readonly speechStartRequests: SpeechStartRequest[];
  readonly speechStopRequests: SpeechSessionRequest[];
  readonly speechCancelRequests: SpeechCancelRequest[];
  readonly speechListeners: Set<(event: SpeechSessionEvent) => void>;
  readonly speechAssetInstallRequests: SpeechAssetInstallRequest[];
  readonly speechAssetListeners: Set<(event: SpeechAssetInstallEvent) => void>;
  readonly undoOperationIds: string[];
  readonly draftListeners: Set<(event: AgentTurnDraftEvent) => void>;
  activityUndoMode: "success" | "post_commit_reject" | "retryable_reject" | "unknown_reject";
  activityListReads: number;
  dismissFirstHomeCalls: number;
  confirmationPending: HighRiskConfirmationPendingResult;
  confirmationPendingReads: number;
  readonly confirmationResolveRequests: HighRiskConfirmationResolveRequest[];
  readonly confirmationListeners: Set<(event: HighRiskConfirmationChangedEvent) => void>;
  confirmationResolveMode: "success" | "failed" | "stale" | "reject_initial" | "reject_pending" | "reject_unknown";
  locale: "zh-Hans" | "en" | "ja" | "ko" | "fr" | "de";
  windowMode: "compact" | "expanded";
  readonly windowModeRequests: ("compact" | "expanded")[];
  sidebarOpen: boolean;
  noteAgentOpen: boolean;
  windowLayoutRevision: number;
  windowLayoutWidth: number | null;
  windowLayoutAvailableWidth: number;
  windowLayoutBaseWidth: number | null;
  windowLayoutRequest: WindowLayoutRequest;
  readonly windowLayoutRequests: WindowLayoutRequest[];
  readonly windowLayoutListeners: Set<(state: WindowLayoutState) => void>;
  failNextWindowLayout: boolean;
  readonly noteRenderRequests: string[];
  readonly inlineReferenceRequests: NoteResolveInlineReferenceRequest[];
  renderNote: (pageId: string) => Promise<NoteRenderResult>;
  resolveInlineReference: (request: NoteResolveInlineReferenceRequest) => Promise<NoteResolveInlineReferenceResult>;
  loadAppearance: () => Promise<{
    readonly locale: "zh-Hans" | "en" | "ja" | "ko" | "fr" | "de";
    readonly availableLocales: readonly ("zh-Hans" | "en" | "ja" | "ko" | "fr" | "de")[];
  }>;
  loadOnboarding: () => Promise<OnboardingStatus>;
  loadModelSummary: () => Promise<ModelProviderSettingsSummary>;
  loadAgentRuntimeStatus: () => Promise<AgentRuntimeStatus | null>;
  setDefaultModel: (modelProfileId: string) => Promise<void>;
  speechAvailability: SpeechAvailabilityResult;
  speechStartResult: SpeechStartResult;
  speechStopResult: SpeechStopResult;
  startSpeech: (request: SpeechStartRequest) => Promise<SpeechStartResult>;
  installSpeechAsset: (request: SpeechAssetInstallRequest) => Promise<SpeechAssetInstallResult>;
  loadConversation: () => Promise<AgentConversationTimeline | undefined>;
  submitTurn: (request: AgentSubmitTurnRequest) => Promise<AgentSubmitTurnResult>;
  emitDraft: (event: AgentTurnDraftEvent) => void;
  emitSpeech: (event: SpeechSessionEvent) => void;
  emitSpeechAsset: (event: SpeechAssetInstallEvent) => void;
}

function createHarness(timeline: AgentConversationTimeline | undefined): ConversationHarness {
  const harness: ConversationHarness = {
    timeline,
    onboarding: readyOnboarding(),
    jobs: [],
    enforceJobFilters: false,
    jobListRequests: [],
    activities: [],
    submitRequests: [],
    retryJobIds: [],
    retryMode: "queued",
    cancelJobIds: [],
    setDefaultModelIds: [],
    speechAvailabilityRequests: [],
    speechStartRequests: [],
    speechStopRequests: [],
    speechCancelRequests: [],
    speechListeners: new Set(),
    speechAssetInstallRequests: [],
    speechAssetListeners: new Set(),
    undoOperationIds: [],
    draftListeners: new Set(),
    activityUndoMode: "success",
    activityListReads: 0,
    dismissFirstHomeCalls: 0,
    confirmationPending: { apiVersion: 1, status: "none", revision: 0 },
    confirmationPendingReads: 0,
    confirmationResolveRequests: [],
    confirmationListeners: new Set(),
    confirmationResolveMode: "success",
    locale: "en",
    windowMode: "compact",
    windowModeRequests: [],
    sidebarOpen: false,
    noteAgentOpen: false,
    windowLayoutRevision: 0,
    windowLayoutWidth: null,
    windowLayoutAvailableWidth: Number.POSITIVE_INFINITY,
    windowLayoutBaseWidth: null,
    windowLayoutRequest: {
      apiVersion: 1,
      surface: "home",
      sidebarOpen: false,
      noteAgentOpen: false
    },
    windowLayoutRequests: [],
    windowLayoutListeners: new Set(),
    failNextWindowLayout: false,
    noteRenderRequests: [],
    inlineReferenceRequests: [],
    renderNote: async (pageId) => testRenderedNote(pageId),
    resolveInlineReference: async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "not_found"
    }),
    loadAppearance: async () => ({ locale: harness.locale, availableLocales: [harness.locale] }),
    loadOnboarding: async () => harness.onboarding,
    loadModelSummary: async () => harness.onboarding.state === "ready"
      ? switchableModelSummary("model_alpha")
      : emptyModelSummary(),
    loadAgentRuntimeStatus: async () => harness.onboarding.state === "ready"
      ? readyAgentRuntimeStatus("model_alpha")
      : null,
    setDefaultModel: async (modelProfileId) => {
      harness.setDefaultModelIds.push(modelProfileId);
    },
    speechAvailability: {
      status: "unsupported",
      reason: "unsupported_platform",
      canOpenSystemSettings: false
    },
    speechStartResult: {
      status: "blocked",
      requestId: "speechreq_1234567890abcdef",
      error: {
        code: "speech.unsupported_platform",
        domain: "speech",
        messageKey: "errors.speech.unsupported_platform",
        retryable: false,
        severity: "warning",
        userAction: "none"
      }
    },
    speechStopResult: {
      status: "stale_session",
      sessionId: "speech_1234567890abcdef"
    },
    startSpeech: async (speechRequest) => harness.speechStartResult.status === "started"
      ? { ...harness.speechStartResult, requestId: speechRequest.requestId }
      : { ...harness.speechStartResult, requestId: speechRequest.requestId },
    installSpeechAsset: async (request) => ({
      status: "started",
      requestId: request.requestId,
      installationId: `speechinstall_${"a".repeat(16)}`,
      languageTag: request.languageTag,
      metering: "available"
    }),
    loadConversation: async () => harness.timeline,
    submitTurn: async (request) => {
      harness.submitRequests.push(request);
      return completedResult();
    },
    emitDraft: (event) => {
      for (const listener of harness.draftListeners) listener(event);
    },
    emitSpeech: (event) => {
      for (const listener of harness.speechListeners) listener(event);
    },
    emitSpeechAsset: (event) => {
      for (const listener of harness.speechAssetListeners) listener(event);
    }
  };
  return harness;
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

function pendingHighRiskConfirmation(): HighRiskConfirmationPendingResult {
  return {
    apiVersion: 1,
    status: "pending",
    revision: 7,
    confirmation: {
      apiVersion: 1,
      confirmationId: "confirm_20260722_abcdefghijklmnop",
      effect: "arbitrary_shell",
      presentation: {
        action: "run_shell_command",
        target: "local_system",
        subject: { kind: "executable_name", value: "git" }
      },
      owner: { kind: "agent_turn", clientTurnId: "turn_20260722_abcdefghijkl" }
    }
  };
}

function connectedModelSummary(): ModelProviderSettingsSummary {
  return {
    ...emptyModelSummary(),
    providers: [{
      id: "provider_fresh",
      displayName: "Fresh provider",
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

function switchableModelSummary(defaultModelProfileId: string): ModelProviderSettingsSummary {
  const models = [
    {
      id: "model_alpha",
      providerProfileId: "provider_switchable",
      modelId: "alpha",
      displayName: "Alpha",
      source: "provider_list" as const,
      enabled: true,
      isDefault: defaultModelProfileId === "model_alpha",
      createdAt: "2026-07-14T08:00:00.000Z",
      updatedAt: "2026-07-14T08:00:00.000Z"
    },
    {
      id: "model_beta",
      providerProfileId: "provider_switchable",
      modelId: "beta",
      displayName: "Beta",
      source: "provider_list" as const,
      enabled: true,
      isDefault: defaultModelProfileId === "model_beta",
      createdAt: "2026-07-14T08:00:00.000Z",
      updatedAt: "2026-07-14T08:00:00.000Z"
    }
  ];
  return {
    presets: [],
    providers: [{
      id: "provider_switchable",
      displayName: "Switchable provider",
      providerKind: "openai",
      endpointProtocol: "openai_responses",
      authRequirement: "api_key",
      modelListStrategy: "provider_api",
      cloudBoundary: "cloud",
      createdAt: "2026-07-14T08:00:00.000Z",
      updatedAt: "2026-07-14T08:00:00.000Z"
    }],
    models,
    defaultModelProfileId,
    hasDefaultModel: true,
    defaultBinding: {
      state: "ready",
      modelProfileId: defaultModelProfileId,
      providerProfileId: "provider_switchable"
    }
  };
}

function readyAgentRuntimeStatus(defaultModelProfileId: string): AgentRuntimeStatus {
  return {
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full",
    adapterMode: "embedded_pi_sdk",
    state: "ready",
    canRunModelJobs: true,
    missingDependencies: [],
    defaultModelProfileId
  };
}

function waitingAgentRuntimeStatus(defaultModelProfileId: string): AgentRuntimeStatus {
  return {
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full",
    adapterMode: "embedded_pi_sdk",
    state: "waiting_for_model",
    canRunModelJobs: false,
    missingDependencies: ["default_model"],
    defaultModelProfileId
  };
}

function makePigeApi(harness: ConversationHarness): object {
  return {
    getHealth: async () => ({ status: "ok" }),
    window: {
      current: async () => windowState(harness),
      currentLayout: async () => currentWindowLayout(harness),
      setLayout: async (request: WindowLayoutRequest) => {
        if (harness.failNextWindowLayout) {
          harness.failNextWindowLayout = false;
          throw new Error("raw window layout failure");
        }
        return setHarnessWindowLayout(harness, request);
      },
      onLayoutChanged: (listener: (state: WindowLayoutState) => void) => {
        harness.windowLayoutListeners.add(listener);
        return () => harness.windowLayoutListeners.delete(listener);
      },
      setMode: async ({ mode }: { readonly mode: "compact" | "expanded" }) => {
        harness.windowModeRequests.push(mode);
        harness.windowMode = mode;
        return windowState(harness);
      },
      setSidebarOpen: async ({ sidebarOpen }: { readonly sidebarOpen: boolean }) => {
        harness.sidebarOpen = sidebarOpen;
        return windowState(harness);
      },
      setAlwaysOnTop: async () => windowState(harness)
    },
    settings: {
      appearance: () => harness.loadAppearance()
    },
    system: {
      toolchainHealth: async () => ({ status: "ready" })
    },
    vault: {
      onboardingStatus: () => harness.loadOnboarding(),
      dismissFirstHomeGuide: async () => {
        harness.dismissFirstHomeCalls += 1;
        harness.onboarding = { ...harness.onboarding, showFirstHomeGuide: false };
        return harness.onboarding;
      },
      recent: async () => []
    },
    backup: {
      status: async () => null
    },
    models: {
      summary: () => harness.loadModelSummary(),
      setDefaultModel: ({ modelProfileId }: { readonly modelProfileId: string }) =>
        harness.setDefaultModel(modelProfileId)
    },
    speech: {
      availability: async (request: SpeechAvailabilityRequest) => {
        harness.speechAvailabilityRequests.push(request);
        return harness.speechAvailability;
      },
      start: async (request: SpeechStartRequest) => {
        harness.speechStartRequests.push(request);
        return harness.startSpeech(request);
      },
      stop: async (request: SpeechSessionRequest) => {
        harness.speechStopRequests.push(request);
        return harness.speechStopResult;
      },
      cancel: async (request: SpeechCancelRequest) => {
        harness.speechCancelRequests.push(request);
        return "sessionId" in request
          ? { status: "canceled" as const, sessionId: request.sessionId }
          : { status: "canceled" as const, requestId: request.requestId };
      },
      installLanguageAsset: async (request: SpeechAssetInstallRequest) => {
        harness.speechAssetInstallRequests.push(request);
        return harness.installSpeechAsset(request);
      },
      openSystemSettings: async () => ({ status: "opened" as const }),
      onSessionEvent: (listener: (event: SpeechSessionEvent) => void) => {
        harness.speechListeners.add(listener);
        return () => harness.speechListeners.delete(listener);
      },
      onAssetInstallEvent: (listener: (event: SpeechAssetInstallEvent) => void) => {
        harness.speechAssetListeners.add(listener);
        return () => harness.speechAssetListeners.delete(listener);
      }
    },
    agent: {
      runtimeStatus: () => harness.loadAgentRuntimeStatus(),
      conversation: () => harness.loadConversation(),
      submitTurn: (request: AgentSubmitTurnRequest) => harness.submitTurn(request),
      onTurnDraft: (listener: (event: AgentTurnDraftEvent) => void) => {
        harness.draftListeners.add(listener);
        return () => harness.draftListeners.delete(listener);
      }
    },
    jobs: {
      list: async (request: JobsListRequest = {}) => {
        harness.jobListRequests.push(request);
        const stateFilter = new Set(request.states ?? []);
        const classFilter = new Set(request.classes ?? []);
        const filteredJobs = harness.enforceJobFilters
          ? [...harness.jobs]
              .filter((job) => stateFilter.size === 0 || stateFilter.has(job.state))
              .filter((job) => classFilter.size === 0 || classFilter.has(job.class))
          : [...harness.jobs];
        const jobs = filteredJobs
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, request.limit ?? 20);
        return {
        scannedAt: "2026-07-12T08:00:00.000Z",
        activeVaultId: harness.onboarding.activeVault?.vaultId ?? "vault_home_conversation",
        total: jobs.length,
        invalidJobCount: 0,
        jobs
        };
      },
      retry: async ({ jobId }: { readonly jobId: string }) => {
        harness.retryJobIds.push(jobId);
        if (harness.retryMode === "queued" && harness.timeline?.latestTurn?.jobId === jobId) {
          harness.timeline = {
            ...harness.timeline,
            latestTurn: {
              jobId: harness.timeline.latestTurn.jobId,
              userEventId: harness.timeline.latestTurn.userEventId,
              state: "queued"
            }
          };
        }
        if (harness.retryMode === "queued") {
          harness.jobs = harness.jobs.map((job) => job.id === jobId
            ? { ...job, state: "queued", error: undefined, updatedAt: "2026-07-12T10:00:01.000Z" }
            : job);
        }
        return { status: "requeued" };
      },
      cancel: async ({ jobId }: { readonly jobId: string }) => {
        harness.cancelJobIds.push(jobId);
        harness.jobs = harness.jobs.map((job) => job.id === jobId
          ? { ...job, state: "cancel_requested", updatedAt: "2026-07-12T10:00:01.000Z" }
          : job);
        return { status: "cancel_requested", job: harness.jobs.find((job) => job.id === jobId) };
      }
    },
    confirmations: {
      pending: async () => {
        harness.confirmationPendingReads += 1;
        if (
          harness.confirmationResolveMode === "reject_initial" &&
          harness.confirmationPendingReads === 1
        ) throw new Error("synthetic unreadable confirmation state");
        if (
          harness.confirmationResolveMode === "reject_unknown" &&
          harness.confirmationResolveRequests.length > 0
        ) throw new Error("synthetic unreadable confirmation state");
        return harness.confirmationPending;
      },
      resolve: async (request: HighRiskConfirmationResolveRequest): Promise<HighRiskConfirmationResolveResult> => {
        harness.confirmationResolveRequests.push(request);
        if (
          harness.confirmationResolveMode === "reject_pending" ||
          harness.confirmationResolveMode === "reject_unknown"
        ) throw new Error("synthetic confirmation resolution failure");
        if (harness.confirmationResolveMode === "stale") {
          return { apiVersion: 1, status: "stale", current: harness.confirmationPending };
        }
        if (harness.confirmationResolveMode === "failed") {
          return {
            apiVersion: 1,
            status: "failed",
            confirmationId: request.confirmationId,
            revision: request.expectedRevision
          };
        }
        harness.confirmationPending = {
          apiVersion: 1,
          status: "none",
          revision: request.expectedRevision + 1
        };
        return {
          apiVersion: 1,
          status: "committed",
          confirmationId: request.confirmationId,
          revision: request.expectedRevision + 1,
          decision: request.decision
        };
      },
      onChanged: (listener: (event: HighRiskConfirmationChangedEvent) => void) => {
        harness.confirmationListeners.add(listener);
        return () => harness.confirmationListeners.delete(listener);
      }
    },
    activity: {
      list: async () => {
        harness.activityListReads += 1;
        if (harness.activityUndoMode === "unknown_reject" && harness.undoOperationIds.length > 0) {
          throw new Error("synthetic unreadable Activity state");
        }
        return {
          scannedAt: "2026-07-12T08:00:00.000Z",
          activeVaultId: "vault_home_conversation",
          total: harness.activities.length,
          invalidOperationCount: 0,
          activities: harness.activities
        };
      },
      undo: async ({ operationId }: { readonly operationId: string }) => {
        harness.undoOperationIds.push(operationId);
        if (harness.activityUndoMode === "success" || harness.activityUndoMode === "post_commit_reject") {
          harness.activities = harness.activities.map((activity) => activity.operationId === operationId
            ? {
                ...activity,
                status: "undone",
                canUndo: false,
                undoUnavailableReason: "already_undone"
              }
            : activity);
        }
        if (harness.activityUndoMode !== "success") {
          throw new Error(`synthetic ${harness.activityUndoMode}`);
        }
        return {
          status: "undone",
          operationId,
          undoOperationId: "op_20260712_undofixture"
        };
      }
    },
    proposals: {
      list: async () => ({
        scannedAt: "2026-07-12T08:00:00.000Z",
        activeVaultId: "vault_home_conversation",
        total: 0,
        invalidProposalCount: 0,
        proposals: []
      })
    },
    library: {
      list: async () => testLibraryList(),
      related: async ({ pageId }: { readonly pageId: string }) => testRelatedPages(pageId)
    },
    notes: {
      render: async ({ pageId }: { readonly pageId: string }) => {
        harness.noteRenderRequests.push(pageId);
        return harness.renderNote(pageId);
      },
      resolveInlineReference: async (request: NoteResolveInlineReferenceRequest) => {
        harness.inlineReferenceRequests.push(request);
        return harness.resolveInlineReference(request);
      }
    }
  };
}

function windowState(harness: ConversationHarness) {
  return {
    mode: harness.windowMode,
    sidebarOpen: harness.sidebarOpen,
    alwaysOnTop: false,
    isFullScreen: false,
    size: { width: harness.windowMode === "compact" ? 420 : 1200, height: 800 }
  };
}

function currentWindowLayout(harness: ConversationHarness): WindowLayoutState {
  if (harness.windowLayoutWidth === null) harness.windowLayoutWidth = window.innerWidth;
  harness.windowLayoutRequest = {
    ...harness.windowLayoutRequest,
    sidebarOpen: harness.sidebarOpen,
    noteAgentOpen: harness.noteAgentOpen
  };
  return windowLayoutState(harness);
}

function setHarnessWindowLayout(
  harness: ConversationHarness,
  request: WindowLayoutRequest
): WindowLayoutState {
  const currentWidth = harness.windowLayoutWidth ?? window.innerWidth;
  const hadOpenPane = harness.windowLayoutRequest.sidebarOpen || harness.windowLayoutRequest.noteAgentOpen;
  const hasOpenPane = request.sidebarOpen || request.noteAgentOpen;
  if (!hadOpenPane && hasOpenPane) harness.windowLayoutBaseWidth = currentWidth;
  harness.windowLayoutRequest = request;
  harness.windowLayoutRequests.push(request);
  harness.sidebarOpen = request.sidebarOpen;
  harness.noteAgentOpen = request.noteAgentOpen;
  if (!hasOpenPane) {
    harness.windowLayoutWidth = harness.windowLayoutBaseWidth ?? currentWidth;
    harness.windowLayoutBaseWidth = null;
  } else {
    const baseWidth = harness.windowLayoutBaseWidth ?? currentWidth;
    const requiredWidth = requiredWindowLayoutWidth(request);
    harness.windowLayoutWidth = Math.min(
      Math.max(baseWidth, requiredWidth),
      harness.windowLayoutAvailableWidth
    );
  }
  harness.windowLayoutRevision += 1;
  const state = windowLayoutState(harness);
  for (const listener of harness.windowLayoutListeners) listener(state);
  return state;
}

function windowLayoutState(harness: ConversationHarness): WindowLayoutState {
  const request = harness.windowLayoutRequest;
  const width = harness.windowLayoutWidth ?? window.innerWidth;
  const bothReaderPanes = request.surface === "reader" && request.sidebarOpen && request.noteAgentOpen;
  const sidebarPresentation = !request.sidebarOpen
    ? "closed"
    : request.surface === "home"
      ? width >= 720 ? "resident" : "overlay"
      : width >= 840 ? "resident" : "overlay";
  const noteAgentPresentation = !request.noteAgentOpen
    ? "closed"
    : width >= (bothReaderPanes ? 1240 : 960) ? "resident" : "overlay";
  return {
    apiVersion: 1,
    revision: harness.windowLayoutRevision,
    surface: request.surface,
    sidebarOpen: request.sidebarOpen,
    noteAgentOpen: request.noteAgentOpen,
    sidebarPresentation,
    noteAgentPresentation,
    autoExpanded: harness.windowLayoutBaseWidth !== null && width > harness.windowLayoutBaseWidth,
    isMaximized: false,
    isFullScreen: false
  };
}

function requiredWindowLayoutWidth(request: WindowLayoutRequest): number {
  if (request.surface === "home") return request.sidebarOpen ? 720 : 0;
  if (request.sidebarOpen && request.noteAgentOpen) return 1240;
  if (request.sidebarOpen) return 840;
  return request.noteAgentOpen ? 960 : 0;
}

function testLibraryList(): LibraryListResult {
  const pages = ["A", "B"].map((suffix, index) => ({
    pageId: `page_20260715_note000${index + 1}`,
    title: `Note ${suffix}`,
    pageType: "note" as const,
    status: "active" as const,
    pagePath: `wiki/note-${suffix.toLowerCase()}.md`,
    createdAt: "2026-07-15T08:00:00.000Z",
    updatedAt: `2026-07-15T08:0${index}:00.000Z`,
    language: "en",
    sourceIds: []
  }));
  return {
    scannedAt: "2026-07-15T08:02:00.000Z",
    activeVaultId: "vault_home_conversation",
    total: pages.length,
    invalidPageCount: 0,
    pages
  };
}

function testRenderedNote(pageId: string): NoteRenderResult {
  const summary = testLibraryList().pages.find((page) => page.pageId === pageId);
  if (!summary) throw new Error(`Unknown test note: ${pageId}`);
  return {
    summary,
    renderContextId: pageId.endsWith("1")
      ? `notectx_${"a".repeat(32)}`
      : `notectx_${"b".repeat(32)}`,
    html: pageId.endsWith("1")
      ? `<h1>${summary.title}</h1><p>Approved reader fixture. <a href="#wiki:note-b">Open Note B</a></p>`
      : `<h1>${summary.title}</h1><p>Approved reader fixture.</p>`,
    byteSize: 96
  };
}

function testRelatedPages(pageId: string): LibraryRelatedResult {
  return {
    queriedAt: "2026-07-15T08:03:00.000Z",
    activeVaultId: "vault_home_conversation",
    pageId,
    totalOutgoing: 0,
    totalBacklinks: 0,
    invalidPageCount: 0,
    outgoing: [],
    backlinks: [],
    degraded: false
  };
}

function reversibleActivity(): KnowledgeActivitySummary {
  return {
    operationId: "op_20260712_activityfixture",
    kind: "create_page",
    createdAt: "2026-07-12T08:00:00.000Z",
    targetLabel: "Grounded boundary",
    target: { kind: "page", pageId: "page_20260715_note0001" },
    status: "applied",
    canUndo: true
  };
}

function reversibleUpdatedActivity(): KnowledgeActivitySummary {
  return {
    operationId: "op_20260712_updateactivity",
    kind: "update_page",
    createdAt: "2026-07-12T08:01:00.000Z",
    targetLabel: "Refined boundary",
    target: { kind: "page", pageId: "page_20260715_note0002" },
    status: "applied",
    canUndo: true
  };
}

function completedTimeline(): AgentConversationTimeline {
  return {
    conversationId: "conv_20260712_homefixture",
    tailEventId: "event_20260712_assistant01",
    canFollowUp: true,
    messages: [
      {
        id: "event_20260712_user01",
        role: "user",
        createdAt: "2026-07-12T08:00:00.000Z",
        text: "What should I remember?",
        jobId: "job_20260712_turn01"
      },
      {
        id: "event_20260712_assistant01",
        role: "assistant",
        createdAt: "2026-07-12T08:00:01.000Z",
        text: "Remember the durable boundary.",
        jobId: "job_20260712_turn01"
      }
    ],
    latestTurn: {
      jobId: "job_20260712_turn01",
      userEventId: "event_20260712_user01",
      state: "completed"
    }
  };
}

function completedDatasetTimeline(): AgentConversationTimeline {
  const completed = datasetCompletedResult();
  if (completed.state !== "completed") throw new Error("Expected a completed Dataset fixture.");
  return {
    conversationId: completed.conversationId,
    tailEventId: completed.tailEventId,
    canFollowUp: true,
    messages: [
      {
        id: completed.conversationEventId,
        role: "user",
        createdAt: "2026-07-13T08:00:00.000Z",
        text: "Show sales totals by region.",
        jobId: completed.jobId
      },
      {
        id: completed.tailEventId,
        role: "assistant",
        createdAt: "2026-07-13T08:00:01.000Z",
        text: completed.answer.answer,
        jobId: completed.jobId,
        answer: completed.answer
      }
    ],
    latestTurn: {
      jobId: completed.jobId,
      userEventId: completed.conversationEventId,
      state: "completed"
    }
  };
}

function completedGroundedTimeline(): AgentConversationTimeline {
  const timeline = completedTimeline();
  return {
    ...timeline,
    messages: timeline.messages.map((message) => message.role === "assistant" ? {
      ...message,
      answer: {
        answer: message.text,
        grounding: "local_knowledge",
        citations: [{
          refId: "citation_home_grounded_01",
          label: "1",
          pageId: "page_20260715_note0001",
          title: "Durable boundaries",
          pageType: "note",
          locator: "heading:durable-boundaries"
        }]
      }
    } : message)
  };
}

function modelWaitingTimeline(): AgentConversationTimeline {
  return {
    conversationId: "conv_20260713_modelwait",
    tailEventId: "event_20260713_modelwait",
    canFollowUp: false,
    messages: [{
      id: "event_20260713_modelwait",
      role: "user",
      createdAt: "2026-07-13T08:00:00.000Z",
      text: "Please help me plan today.",
      jobId: "job_20260713_modelwait"
    }],
    latestTurn: {
      jobId: "job_20260713_modelwait",
      userEventId: "event_20260713_modelwait",
      state: "waiting_dependency",
      error: defaultModelMissingError()
    }
  };
}

function completedResult(): AgentSubmitTurnResult {
  return {
    requestId: "request_20260712_turn02",
    jobId: "job_20260712_turn02",
    conversationEventId: "event_20260712_user02",
    conversationId: "conv_20260712_homefixture",
    tailEventId: "event_20260712_assistant02",
    state: "completed",
    modelUsage: "local",
    sourceIds: [],
    answer: {
      answer: "Here is the second answer.",
      grounding: "general",
      citations: []
    }
  };
}

function retrievalCompletedResult(): AgentSubmitTurnResult {
  const result = completedResult();
  if (result.state !== "completed") throw new Error("Expected a completed Agent result fixture.");
  return {
    ...result,
    answer: {
      answer: "The local Reader fixture matched.",
      grounding: "local_knowledge",
      citations: [],
      retrieval: {
        searchedAt: "2026-07-15T08:04:00.000Z",
        activeVaultId: "vault_home_conversation",
        query: "approved Reader fixture",
        mode: "lexical_markdown_scan",
        total: 1,
        invalidPageCount: 0,
        degraded: false,
        results: [{
          summary: testLibraryList().pages[0]!,
          score: 1,
          snippets: ["Local Reader result"],
          matchReasons: ["body"]
        }]
      }
    }
  };
}

function datasetCompletedResult(): AgentSubmitTurnResult {
  const hash = `sha256:${"a".repeat(64)}`;
  const resultHash = `sha256:${"b".repeat(64)}`;
  return {
    requestId: "request_20260713_datasetturn",
    jobId: "job_20260713_datasetturn",
    conversationEventId: "evt_20260713_datasetuser",
    conversationId: "conv_20260713_dataset",
    tailEventId: "evt_20260713_datasetassistant",
    state: "completed",
    modelUsage: "cloud",
    sourceIds: [],
    answer: {
      answer: "North has the largest total sales in this bounded result.",
      grounding: "local_knowledge",
      citations: [{
        kind: "dataset",
        refId: "citation_1",
        label: "D1",
        title: "Sales by region",
        locator: "Sales / grouped result",
        evidence: {
          datasetId: "dataset_20260713_salesdataset01",
          revisionId: "dataset_rev_20260713_salesrevision01",
          tableId: "table_salesdatasettable01",
          schemaId: hash,
          columnIds: ["column_salesregioncol01", "column_salestotalcol001"],
          queryPlanHash: hash,
          resultHash,
          sourceId: "src_20260713_salessrc",
          sourceRevisionHash: hash
        }
      }],
      datasetResult: {
        datasetId: "dataset_20260713_salesdataset01",
        revisionId: "dataset_rev_20260713_salesrevision01",
        tableId: "table_salesdatasettable01",
        tableName: "Sales",
        planHash: hash,
        resultHash,
        columns: [
          { key: "region", label: "Region", logicalType: "string", sourceColumnId: "column_salesregioncol01" },
          { key: "sum_sales", label: "Total sales", logicalType: "number", aggregate: "sum" }
        ],
        rows: [
          { values: ["North", 120.5] },
          { values: ["South", 87] }
        ],
        matchedRowCount: 2,
        returnedRowCount: 2,
        truncated: false,
        citationRefs: ["citation_1"]
      }
    }
  };
}

function failedResult(): AgentSubmitTurnResult {
  return {
    requestId: "request_20260713_failedturn",
    jobId: "job_20260713_failedturn",
    conversationEventId: "event_20260713_failedturn",
    conversationId: "conv_20260713_failedturn",
    tailEventId: "event_20260713_failedturn",
    state: "failed",
    modelUsage: "cloud",
    sourceIds: [],
    error: safeCallError()
  };
}

function sourceWaitingForModelResult(): AgentSubmitTurnResult {
  return {
    requestId: "request_20260713_sourcewait",
    jobId: "job_20260713_sourcewait",
    conversationEventId: "event_20260713_sourcewait",
    conversationId: "conv_20260713_sourcewait",
    tailEventId: "event_20260713_sourcewait",
    state: "waiting",
    modelUsage: "none",
    sourceIds: ["src_20260713_sourcewait"],
    error: defaultModelMissingError()
  };
}

function missingModelResult(): AgentSubmitTurnResult {
  return {
    requestId: "request_20260713_modelwait",
    jobId: "job_20260713_modelwait",
    conversationEventId: "event_20260713_modelwait",
    conversationId: "conv_20260713_modelwait",
    tailEventId: "event_20260713_modelwait",
    state: "waiting",
    modelUsage: "none",
    sourceIds: [],
    error: defaultModelMissingError()
  };
}

function cancelledResult(): AgentSubmitTurnResult {
  return {
    requestId: "request_20260713_cancelledturn",
    jobId: "job_20260713_cancelledturn",
    conversationEventId: "event_20260713_cancelledturn",
    conversationId: "conv_20260713_cancelledturn",
    tailEventId: "event_20260713_cancelledturn",
    state: "failed",
    modelUsage: "cloud",
    sourceIds: [],
    error: {
      code: "agent_runtime.turn_cancelled",
      domain: "agent_runtime",
      messageKey: "errors.agent_runtime.turn_cancelled",
      retryable: true,
      severity: "info",
      userAction: "retry"
    }
  };
}

function draftEvent(overrides: Partial<AgentTurnDraftEvent> = {}): AgentTurnDraftEvent {
  return {
    apiVersion: 1,
    kind: "draft_replace",
    requestId: "job_20260713_streamfixture",
    clientTurnId: "turn_20260713_streamfixture",
    jobId: "job_20260713_streamfixture",
    conversationId: "conv_20260713_streamfixture",
    conversationEventId: "event_20260713_streamfixture",
    sequence: 1,
    text: "Safe provisional answer.",
    ...overrides
  };
}

function runningAgentJob(): JobSummary {
  return {
    id: "job_20260712_runningfixture",
    class: "agent_turn",
    state: "running",
    message: "Agent turn running",
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z"
  };
}

function modelWaitingJob(): JobSummary {
  return {
    id: "job_20260713_modelwait",
    class: "agent_turn",
    state: "waiting_dependency",
    stage: "waiting_for_model",
    conversationEventId: "event_20260713_modelwait",
    message: "body-free model wait",
    createdAt: "2026-07-13T08:00:00.000Z",
    updatedAt: "2026-07-13T08:00:01.000Z"
  };
}

function sourceWaitingForModelJob(): JobSummary {
  return {
    id: "job_20260713_sourcewait",
    class: "agent_turn",
    state: "waiting_dependency",
    stage: "waiting_for_model",
    sourceId: "src_20260713_sourcewait",
    sourceKind: "csv_file",
    sourceDisplayName: "public-alpha.csv",
    message: "Source preserved; waiting for model.",
    createdAt: "2026-07-13T08:00:00.000Z",
    updatedAt: "2026-07-13T08:00:01.000Z"
  };
}

function readyOnboarding(): OnboardingStatus {
  return {
    state: "ready",
    hasDefaultModel: true,
    showFirstHomeGuide: false,
    activeVault: homeVaultSummary()
  };
}

function readyWithoutModelOnboarding(showFirstHomeGuide: boolean): OnboardingStatus {
  return {
    state: "ready",
    hasDefaultModel: false,
    showFirstHomeGuide,
    activeVault: homeVaultSummary()
  };
}

function homeVaultSummary() {
  return {
    vaultId: "vault_home_conversation",
    name: "Conversation Vault",
    activeVaultPathDisplay: "/tmp/Conversation Vault",
    knowledgeRootDisplay: "/tmp/Conversation Vault",
    sourceAssetRootDisplay: "/tmp/Conversation Vault/raw",
    sourceAssetRootKind: "inside_vault" as const,
    defaultSourceStorageStrategy: "copy_to_source_library" as const,
    schemaVersion: 1
  };
}

function defaultModelMissingError() {
  return {
    code: "model_provider.default_model_missing",
    domain: "model_provider" as const,
    messageKey: "errors.model_provider.default_model_missing",
    retryable: true,
    severity: "error" as const,
    userAction: "configure_model" as const
  };
}

function safeCallError() {
  return {
    code: "model_provider.call_failed",
    domain: "model_provider" as const,
    messageKey: "errors.model_provider.call_failed",
    retryable: true,
    severity: "error" as const,
    userAction: "retry" as const
  };
}

function speechAssetInstallError() {
  return {
    code: "speech.asset_install_failed",
    domain: "speech" as const,
    messageKey: "errors.speech.asset_install_failed",
    retryable: true,
    severity: "error" as const,
    userAction: "retry" as const
  };
}

function createDom(width = 1200): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://pige.test"
  });
  Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: (query: string) => {
      const max = query.match(/max-width:\s*(\d+)px/)?.[1];
      const min = query.match(/min-width:\s*(\d+)px/)?.[1];
      const matches = (max === undefined || width <= Number(max)) && (min === undefined || width >= Number(min));
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false
      };
    }
  });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  dom.window.cancelAnimationFrame = (handle: number): void => dom.window.clearTimeout(handle);
  installDom(dom);
  return dom;
}

function installResizableMatchMedia(dom: JSDOM, initialWidth: number): (width: number) => Promise<void> {
  let width = initialWidth;
  const queries = new Map<string, {
    readonly media: MediaQueryList;
    readonly listeners: Set<(event: MediaQueryListEvent) => void>;
    matches: boolean;
  }>();
  const queryMatches = (query: string): boolean => {
    const max = query.match(/max-width:\s*(\d+)px/)?.[1];
    const min = query.match(/min-width:\s*(\d+)px/)?.[1];
    return (max === undefined || width <= Number(max)) && (min === undefined || width >= Number(min));
  };

  Object.defineProperty(dom.window, "innerWidth", { configurable: true, get: () => width });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => {
      const existing = queries.get(query);
      if (existing) return existing.media;
      const listeners = new Set<(event: MediaQueryListEvent) => void>();
      const record = { matches: queryMatches(query), listeners } as {
        media: MediaQueryList;
        listeners: Set<(event: MediaQueryListEvent) => void>;
        matches: boolean;
      };
      const media = {
        get matches() { return record.matches; },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === "function") listeners.add(listener as (event: MediaQueryListEvent) => void);
        },
        removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
          if (typeof listener === "function") listeners.delete(listener as (event: MediaQueryListEvent) => void);
        },
        addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
        dispatchEvent: () => true
      } satisfies MediaQueryList;
      record.media = media;
      queries.set(query, record);
      return media;
    }
  });

  return async (nextWidth: number): Promise<void> => {
    width = nextWidth;
    await act(async () => {
      for (const record of queries.values()) {
        const nextMatches = queryMatches(record.media.media);
        if (nextMatches === record.matches) continue;
        record.matches = nextMatches;
        const event = { matches: nextMatches, media: record.media.media } as MediaQueryListEvent;
        for (const listener of record.listeners) listener(event);
      }
      dom.window.dispatchEvent(new dom.window.Event("resize"));
      await settle(dom);
      await settle(dom);
    });
  };
}

async function mountHome(dom: JSDOM, api: object): Promise<{
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
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    CompositionEvent: dom.window.CompositionEvent
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

async function setTextareaValue(dom: JSDOM, container: HTMLElement, value: string): Promise<void> {
  const textarea = homeComposer(container);
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("Textarea setter not found.");
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    textarea.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle(dom);
  });
}

async function dispatchComposerKey(
  dom: JSDOM,
  container: HTMLElement,
  init: KeyboardEventInit
): Promise<boolean> {
  const textarea = homeComposer(container);
  const event = new dom.window.KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init
  });
  await act(async () => {
    textarea.dispatchEvent(event);
    await settle(dom);
  });
  return event.defaultPrevented;
}

function homeComposer(container: HTMLElement): HTMLTextAreaElement {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Capture or ask"]');
  if (!textarea) throw new Error("Home composer not found.");
  return textarea;
}

async function attachFile(dom: JSDOM, container: HTMLElement, name: string, content: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Home file input not found.");
  const file = new dom.window.File([content], name, { type: "text/csv" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle(dom);
  });
}

async function dropFile(dom: JSDOM, container: HTMLElement, name: string, content: string): Promise<void> {
  const shell = container.querySelector<HTMLElement>('.shell[aria-label="Pige"]');
  if (!shell) throw new Error("Application shell not found.");
  const file = new dom.window.File([content], name, { type: "text/csv" });
  const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: { files: [file], types: ["Files"] }
  });
  await act(async () => {
    shell.dispatchEvent(event);
    await settle(dom);
  });
}

function textareaValue(container: HTMLElement): string {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Capture or ask"]');
  if (!textarea) throw new Error("Home composer not found.");
  return textarea.value;
}

async function clickButton(dom: JSDOM, container: HTMLElement, label: string): Promise<void> {
  const match = buttons(container, label)[0];
  if (!match) throw new Error(`Button not found: ${label}`);
  await clickElement(dom, match);
}

async function clickButtonByAriaLabel(dom: JSDOM, container: HTMLElement, label: string): Promise<void> {
  const match = buttonsByAriaLabel(container, label)[0];
  if (!match) throw new Error(`Button not found by aria-label: ${label}`);
  await clickElement(dom, match);
}

async function openSettingsSection(dom: JSDOM, container: HTMLElement, label: string): Promise<void> {
  let settingsTrigger = container.querySelector<HTMLButtonElement>(".sidebar-settings-control");
  if (!settingsTrigger) {
    const sidebarToggle = buttonsByAriaLabel(container, "Expand sidebar")[0];
    if (sidebarToggle) {
      await clickElement(dom, sidebarToggle);
      await waitFor(dom, () => container.querySelector(".sidebar-settings-control") !== null);
      settingsTrigger = container.querySelector<HTMLButtonElement>(".sidebar-settings-control");
    }
  }
  if (!settingsTrigger) throw new Error("Settings trigger not found.");
  await clickElement(dom, settingsTrigger);
  const section = Array.from(container.querySelectorAll<HTMLButtonElement>(".settings-nav-item"))
    .find((candidate) => candidate.querySelector("span")?.textContent === label);
  if (!section) throw new Error(`Settings section not found: ${label}`);
  await clickElement(dom, section);
}

async function openLibraryNote(dom: JSDOM, container: HTMLElement, title: string): Promise<void> {
  const familyDisclosure = Array.from(container.querySelectorAll<HTMLButtonElement>(".library-tree-disclosure"))
    .find((candidate) => candidate.querySelector("span")?.textContent === "Knowledge");
  if (!familyDisclosure) throw new Error("Knowledge disclosure not found.");
  if (familyDisclosure.getAttribute("aria-expanded") !== "true") await clickElement(dom, familyDisclosure);
  const typeDisclosure = Array.from(container.querySelectorAll<HTMLButtonElement>(".type-disclosure"))
    .find((candidate) => candidate.querySelector("span")?.textContent === "Note");
  if (!typeDisclosure) throw new Error("Note disclosure not found.");
  if (typeDisclosure.getAttribute("aria-expanded") !== "true") await clickElement(dom, typeDisclosure);
  const note = Array.from(container.querySelectorAll<HTMLButtonElement>(".library-tree-page"))
    .find((candidate) => candidate.querySelector("span")?.textContent === title);
  if (!note) throw new Error(`Library note not found: ${title}`);
  await clickElement(dom, note);
  await waitFor(dom, () => container.querySelector(".note-reader h1")?.textContent === title);
}

async function clickElement(dom: JSDOM, element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .filter((candidate) => candidate.textContent === label);
}

function buttonsByAriaLabel(container: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .filter((candidate) => candidate.getAttribute("aria-label") === label);
}

function buttonsByAriaLabelPrefix(container: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .filter((candidate) => candidate.getAttribute("aria-label")?.startsWith(label) === true);
}

function modelActionButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .filter((candidate) => candidate.textContent === "Connect Model" || candidate.textContent === "Open Models");
}

function countText(container: HTMLElement, text: string): number {
  return (container.textContent?.match(new RegExp(escapeRegExp(text), "g")) ?? []).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireElement(element: HTMLElement | null): HTMLElement {
  if (!element) throw new Error("Expected test container.");
  return element;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await act(async () => settle(dom));
  }
  throw new Error("Timed out waiting for UI state.");
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
