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
  JobsListRequest,
  JobSummary,
  KnowledgeActivitySummary,
  LibraryListResult,
  LibraryRelatedResult,
  ModelProviderSettingsSummary,
  ModelEgressPendingRequest,
  ModelEgressResolveRequest,
  NoteRenderResult,
  OnboardingStatus,
  PermissionPendingRequest,
  PermissionResolveRequest,
  PermissionResolveResult,
  SpeechAvailabilityRequest,
  SpeechAvailabilityResult,
  SpeechCancelRequest,
  SpeechSessionEvent,
  SpeechSessionRequest,
  SpeechStartRequest,
  SpeechStartResult,
  SpeechStopResult
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

type TestSpeechAssetInstallRequest = {
  readonly requestId: string;
  readonly languageTag: string;
};

type TestSpeechAssetInstallResult =
  | {
      readonly status: "started";
      readonly requestId: string;
      readonly installationId: string;
      readonly languageTag: string;
      readonly metering: "available" | "unavailable";
    }
  | {
      readonly status: "blocked";
      readonly requestId: string;
      readonly error: { readonly code: string };
    };

type TestSpeechAssetInstallEvent =
  | {
      readonly apiVersion: 1;
      readonly kind: "progress";
      readonly installationId: string;
      readonly sequence: number;
      readonly completedFraction: number;
    }
  | {
      readonly apiVersion: 1;
      readonly kind: "installed";
      readonly installationId: string;
      readonly sequence: number;
      readonly languageTag: string;
    }
  | {
      readonly apiVersion: 1;
      readonly kind: "canceled";
      readonly installationId: string;
      readonly sequence: number;
    };

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

  it("cancels only the active language asset install and rejects a late start result", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    const installationId = `speechinstall_${"c".repeat(16)}`;
    let resolveInstall: ((result: TestSpeechAssetInstallResult) => void) | undefined;
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
    await clickButton(dom, container, enMessages["home.voice.continueTyping"]);
    expect(container.querySelector(".home-voice-panel")).toBeNull();

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
    await waitFor(dom, () => harness.speechAssetCancelRequests.length === 1);
    expect(harness.speechAssetCancelRequests).toEqual([{ installationId }]);
    expect(harness.speechStartRequests).toEqual([]);

    const secondInstallationId = `speechinstall_${"d".repeat(16)}`;
    harness.installSpeechAsset = async (request) => ({
      status: "started",
      requestId: request.requestId,
      installationId: secondInstallationId,
      languageTag: request.languageTag,
      metering: "available"
    });
    await clickButtonByAriaLabel(dom, container, enMessages["home.voice.start"]);
    await waitFor(dom, () => container.textContent?.includes(enMessages["home.voice.assetsUnavailableTitle"]) === true);
    await clickButton(dom, container, enMessages["home.voice.installLanguageAsset"]);
    await waitFor(dom, () => harness.speechAssetInstallRequests.length === 2);
    await clickButton(dom, container, enMessages["home.voice.cancelAssetInstall"]);
    await waitFor(dom, () => harness.speechAssetCancelRequests.length === 2);
    expect(harness.speechAssetCancelRequests[1]).toEqual({ installationId: secondInstallationId });
    expect(container.textContent).toContain(enMessages["home.voice.assetsUnavailableTitle"]);

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

  it("keeps the compact Library overlay modal at 831 and resident at 832", async () => {
    for (const [width, modal] of [[831, true], [832, false]] as const) {
      const dom = createDom(width);
      const harness = createHarness(undefined);
      harness.windowMode = "expanded";
      harness.sidebarOpen = true;
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

  it("preserves the user-owned note conversation disclosure across note routing", async () => {
    for (const [width, overlay] of [[1199, true], [1200, false]] as const) {
      const dom = createDom(width);
      const harness = createHarness(undefined);
      harness.windowMode = "expanded";
      harness.sidebarOpen = true;
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
        expect(container.querySelector(".note-agent")?.getAttribute("aria-modal")).toBeNull();
        await clickButtonByAriaLabel(dom, container, "Hide note conversation");
        expect(container.querySelector(".note-agent")).toBeNull();
      }

      await openLibraryNote(dom, container, "Note B");
      expect(container.querySelector(".note-agent")).toBeNull();
      expect(buttonsByAriaLabel(container, "Show note conversation")).toHaveLength(1);

      await act(async () => root.unmount());
      dom.window.close();
    }
  });

  it("refreshes durable Home state when returning from Models", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.windowMode = "expanded";
    harness.sidebarOpen = true;
    harness.enforceJobFilters = true;
    harness.onboarding = captureOnlyOnboarding(false);
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
    harness.onboarding = captureOnlyOnboarding(true);
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
        harness.onboarding = captureOnlyOnboarding(true);
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

  it("persists the explicit choice to continue capture-only and does not show the first-Home guide again", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.onboarding = captureOnlyOnboarding(true);
    const api = makePigeApi(harness);
    const firstMount = await mountHome(dom, api);

    expect(firstMount.container.textContent).toContain(
      "You can save content now. Connect a model to ask Pi Agent."
    );
    expect(buttons(firstMount.container, "Connect Model")).toHaveLength(1);
    expect(buttons(firstMount.container, "Continue capture-only")).toHaveLength(1);

    await clickButton(dom, firstMount.container, "Continue capture-only");
    await waitFor(dom, () => harness.dismissFirstHomeCalls === 1);
    expect(firstMount.container.textContent).not.toContain(
      "You can save content now. Connect a model to ask Pi Agent."
    );

    await act(async () => firstMount.root.unmount());
    const reopened = await mountHome(dom, api);
    expect(reopened.container.textContent).not.toContain(
      "You can save content now. Connect a model to ask Pi Agent."
    );

    await act(async () => reopened.root.unmount());
    dom.window.close();
  });

  it("gives a missing-model text turn sole ownership of the model repair action", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.onboarding = captureOnlyOnboarding(true);
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      harness.jobs = [{
        ...modelWaitingJob(),
        createdAt: new Date(Date.now() + 1_000).toISOString(),
        updatedAt: new Date(Date.now() + 1_001).toISOString()
      }];
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    expect(buttons(container, "Connect Model")).toHaveLength(1);
    await setTextareaValue(dom, container, "Please help me plan today.");
    expect(buttonsByAriaLabel(container, "Send")[0]?.disabled).toBe(false);
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(container.textContent).not.toContain(
      "You can save content now. Connect a model to ask Pi Agent."
    );
    expect(modelActionButtons(container)).toHaveLength(0);
    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.textContent).not.toContain("job_20260713_modelwait");
    expect(container.textContent).not.toContain("Waiting for a local capability");

    await act(async () => {
      resolveTurn?.(missingModelResult());
      await settle(dom);
    });
    await waitFor(dom, () => buttons(container, "Open Models").length === 1);
    expect(modelActionButtons(container)).toHaveLength(1);
    expect(buttons(container, "Connect Model")).toHaveLength(0);
    expect(buttons(container, "Try again")).toHaveLength(0);
    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.textContent).not.toContain("job_20260713_modelwait");
    expect(container.textContent).not.toContain("Waiting for a local capability");
    expect(container.textContent).not.toContain(
      "You can save content now. Connect a model to ask Pi Agent."
    );

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

  it("keeps one model action when existing source waits and a current text repair coexist", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.onboarding = captureOnlyOnboarding(true);
    harness.jobs = [
      sourceWaitingForModelJob(),
      {
        ...sourceWaitingForModelJob(),
        id: "job_20260713_sourcewait02",
        sourceId: "src_20260713_sourcewait02",
        sourceDisplayName: "second-source.csv"
      }
    ];
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      harness.jobs = [...harness.jobs, modelWaitingJob()];
      harness.timeline = modelWaitingTimeline();
      return missingModelResult();
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => modelActionButtons(container).length === 1);
    expect(buttons(container, "Connect Model")).toHaveLength(1);
    await setTextareaValue(dom, container, "Help with a separate question.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => buttons(container, "Open Models").length === 1);

    expect(modelActionButtons(container)).toHaveLength(1);
    expect(buttons(container, "Connect Model")).toHaveLength(0);
    expect(buttons(container, "Open Models")).toHaveLength(1);
    expect(buttons(container, "Try again")).toHaveLength(0);
    expect(container.textContent).not.toContain("job_20260713_modelwait");
    expect(container.querySelector(".task-list")).toBeNull();
    expect(container.textContent).toContain("public-alpha.csv");
    await clickButtonByAriaLabel(dom, container, "Expand processing files");
    await waitFor(dom, () => container.querySelectorAll(".task-row").length === 2);
    expect(container.textContent).toContain("public-alpha.csv");
    expect(container.textContent).toContain("second-source.csv");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("docks processing files to the composer and removes terminal or non-source Jobs", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    harness.onboarding = captureOnlyOnboarding(true);
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
    terminalHarness.onboarding = captureOnlyOnboarding(true);
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
    harness.onboarding = captureOnlyOnboarding(false);
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
    harness.onboarding = captureOnlyOnboarding(true);
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

  it("restores one safe Permission Broker card with sole status ownership and Deny focused by default", async () => {
    const dom = createDom();
    const harness = createHarness(permissionWaitingTimeline());
    harness.jobs = [permissionWaitingJob()];
    harness.permissionPending = {
      ...permissionPendingRequest(),
      rawCommand: "curl https://private.example/release-notes",
      path: "/Users/private/notes.md",
      body: "private source body",
      credential: "secret-value"
    } as PermissionPendingRequest;
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttons(container, "Allow once").length === 1);
    const prompt = container.querySelector<HTMLElement>(".permission-prompt");
    const promptButtons = Array.from(prompt?.querySelectorAll("button") ?? []);
    expect(prompt?.getAttribute("role")).toBe("group");
    expect(prompt?.getAttribute("aria-labelledby")).toBe("home-permission-title");
    expect(prompt?.querySelector("h2")?.textContent).toBe("Permission needed");
    expect(promptButtons.map((button) => button.textContent)).toEqual(["Deny", "Allow once"]);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(prompt?.querySelector('[role="status"]')?.textContent).toContain("Release Notes Skill");
    expect(prompt?.textContent).toContain("Fetch release notes");
    expect(prompt?.textContent).toContain("Network access");
    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.querySelector(".agent-run-state")).toBeNull();
    expect(container.querySelector('[aria-label="Needs attention"]')).toBeNull();
    expect(container.textContent).not.toContain("errors.permission.confirmation_required");
    expect(container.textContent).not.toContain("This external action needs your permission.");
    expect(container.textContent).not.toContain("Always Allow");
    expect(container.textContent).not.toContain("YOLO");
    for (const unsafeCopy of [
      "1.2.3-private-version",
      "external_network",
      "current_domain",
      "permission.external_network_required",
      "permreq_20260714_homepermission01",
      "job_20260714_permission01",
      "curl https://private.example/release-notes",
      "/Users/private/notes.md",
      "private source body",
      "secret-value",
      "Private command material"
    ]) {
      expect(prompt?.textContent).not.toContain(unsafeCopy);
    }
    await waitFor(dom, () => dom.window.document.activeElement === buttons(container, "Deny")[0]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("discovers a live permission wait through the filtered refresh and restores ordinary Job state after Allow once", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.enforceJobFilters = true;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      harness.jobs = [permissionWaitingJob()];
      harness.permissionPending = permissionPendingRequest();
      return new Promise<AgentSubmitTurnResult>(() => undefined);
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Check external release notes.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => buttons(container, "Allow once").length === 1);

    expect(harness.jobListRequests.some((request) =>
      request.states?.includes("waiting_permission") === true
    )).toBe(true);
    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.querySelector(".agent-run-state")).toBeNull();
    await clickButton(dom, container, "Allow once");
    await waitFor(dom, () => harness.permissionResolveRequests.length === 1);
    expect(harness.permissionResolveRequests[0]).toEqual({
      requestId: "permreq_20260714_homepermission01",
      jobId: "job_20260714_permission01",
      decision: "allow_once"
    });
    await waitFor(dom, () => container.querySelector(".permission-prompt") === null);
    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.querySelector(".agent-run-state.state-running")).not.toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps both permission actions disabled while Deny resolves, then returns terminal Job ownership", async () => {
    const dom = createDom();
    const harness = createHarness(permissionWaitingTimeline());
    harness.jobs = [permissionWaitingJob()];
    harness.permissionPending = permissionPendingRequest();
    const api = makePigeApi(harness) as {
      permissions: {
        resolve: (request: PermissionResolveRequest) => Promise<PermissionResolveResult>;
      };
    };
    const durableResolve = api.permissions.resolve;
    let releaseResolve: (() => void) | undefined;
    const resolveGate = new Promise<void>((resolve) => { releaseResolve = resolve; });
    api.permissions.resolve = async (request) => {
      const result = await durableResolve(request);
      await resolveGate;
      return result;
    };
    const { container, root } = await mountHome(dom, api);

    await waitFor(dom, () => buttons(container, "Deny").length === 1);
    await clickButton(dom, container, "Deny");
    await waitFor(dom, () => harness.permissionResolveRequests.length === 1);
    expect(harness.permissionResolveRequests[0]).toEqual({
      requestId: "permreq_20260714_homepermission01",
      jobId: "job_20260714_permission01",
      decision: "deny"
    });
    expect(buttons(container, "Deny")[0]?.disabled).toBe(true);
    expect(buttons(container, "Allow once")[0]?.disabled).toBe(true);
    expect(Array.from(container.querySelectorAll(".permission-actions button")).map((button) => button.textContent))
      .toEqual(["Deny", "Allow once"]);

    await act(async () => {
      releaseResolve?.();
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector(".permission-prompt") === null);
    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.querySelector(".agent-run-state.state-failed")).not.toBeNull();
    expect(container.textContent).toContain("This external action was denied. Your existing work remains saved.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("re-reads durable permission truth after rejected resolution without exposing transport errors", async () => {
    const retryDom = createDom();
    const retryHarness = createHarness(permissionWaitingTimeline());
    retryHarness.jobs = [permissionWaitingJob()];
    retryHarness.permissionPending = permissionPendingRequest();
    retryHarness.permissionResolveMode = "reject_pending";
    const retryMount = await mountHome(retryDom, makePigeApi(retryHarness));

    await waitFor(retryDom, () => buttons(retryMount.container, "Allow once").length === 1);
    await clickButton(retryDom, retryMount.container, "Allow once");
    await waitFor(retryDom, () => retryMount.container.textContent?.includes("The decision was not saved") === true);
    expect(buttons(retryMount.container, "Deny")[0]?.disabled).toBe(false);
    expect(buttons(retryMount.container, "Allow once")[0]?.disabled).toBe(false);
    expect(retryMount.container.querySelector(".task-panel")).toBeNull();
    expect(retryMount.container.textContent).not.toContain("synthetic");
    await act(async () => retryMount.root.unmount());
    retryDom.window.close();

    const committedDom = createDom();
    const committedHarness = createHarness(permissionWaitingTimeline());
    committedHarness.jobs = [permissionWaitingJob()];
    committedHarness.permissionPending = permissionPendingRequest();
    committedHarness.permissionResolveMode = "post_commit_reject";
    const committedMount = await mountHome(committedDom, makePigeApi(committedHarness));

    await waitFor(committedDom, () => buttons(committedMount.container, "Deny").length === 1);
    await clickButton(committedDom, committedMount.container, "Deny");
    await waitFor(committedDom, () => committedMount.container.querySelector(".permission-prompt") === null);
    expect(committedMount.container.querySelector(".task-panel")).toBeNull();
    expect(committedMount.container.querySelector(".agent-run-state.state-failed")).not.toBeNull();
    expect(committedMount.container.textContent).not.toContain("synthetic");
    await act(async () => committedMount.root.unmount());
    committedDom.window.close();

    const unknownDom = createDom();
    const unknownHarness = createHarness(permissionWaitingTimeline());
    unknownHarness.jobs = [permissionWaitingJob()];
    unknownHarness.permissionPending = permissionPendingRequest();
    unknownHarness.permissionResolveMode = "reject_unknown";
    const unknownMount = await mountHome(unknownDom, makePigeApi(unknownHarness));

    await waitFor(unknownDom, () => buttons(unknownMount.container, "Allow once").length === 1);
    await clickButton(unknownDom, unknownMount.container, "Allow once");
    await waitFor(unknownDom, () => unknownMount.container.textContent?.includes("could not verify the pending permission") === true);
    expect(buttons(unknownMount.container, "Deny")).toHaveLength(0);
    expect(buttons(unknownMount.container, "Allow once")).toHaveLength(0);
    expect(unknownMount.container.querySelector(".task-panel")).toBeNull();
    expect(unknownMount.container.textContent).not.toContain("synthetic");
    const unknownReads = unknownHarness.permissionPendingReads;
    await act(async () => settle(unknownDom));
    expect(unknownHarness.permissionPendingReads).toBe(unknownReads);
    await act(async () => unknownMount.root.unmount());
    unknownDom.window.close();
  });

  it("fails closed for stale permission identity and ignores an old-vault resolution", async () => {
    const staleDom = createDom();
    const staleHarness = createHarness(permissionWaitingTimeline());
    staleHarness.jobs = [permissionWaitingJob()];
    staleHarness.permissionPending = permissionPendingRequest({
      requestId: "permreq_20260714_stalerequest02"
    });
    const staleMount = await mountHome(staleDom, makePigeApi(staleHarness));

    await waitFor(staleDom, () => staleMount.container.textContent?.includes("could not verify the pending permission") === true);
    expect(buttons(staleMount.container, "Deny")).toHaveLength(0);
    expect(buttons(staleMount.container, "Allow once")).toHaveLength(0);
    expect(staleMount.container.querySelector(".task-panel")).toBeNull();
    await act(async () => staleMount.root.unmount());
    staleDom.window.close();

    const vaultDom = createDom();
    const vaultHarness = createHarness(permissionWaitingTimeline());
    vaultHarness.jobs = [permissionWaitingJob()];
    vaultHarness.permissionPending = permissionPendingRequest();
    vaultHarness.permissionResolveMode = "success_switch_vault";
    const vaultMount = await mountHome(vaultDom, makePigeApi(vaultHarness));

    await waitFor(vaultDom, () => buttons(vaultMount.container, "Allow once").length === 1);
    await clickButton(vaultDom, vaultMount.container, "Allow once");
    await waitFor(vaultDom, () => vaultHarness.onboarding.activeVault?.vaultId === "vault_20260714_permissionsecond");
    await act(async () => settle(vaultDom));
    expect(vaultMount.container.querySelector(".permission-prompt")).toBeNull();
    expect(vaultMount.container.textContent).not.toContain("Release Notes Skill");

    await act(async () => vaultMount.root.unmount());
    vaultDom.window.close();
  });

  it("restores one bounded model-egress prompt and resumes the exact live Job once", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.jobs = [modelEgressWaitingJob()];
    harness.modelEgressPending = modelEgressPendingRequest();
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttons(container, "Allow once").length === 1);
    expect(buttons(container, "Don't send")).toHaveLength(1);
    expect(container.textContent).toContain("This selected context is marked sensitive");
    expect(container.textContent).not.toContain("provider_sensitive_home");
    expect(container.textContent).not.toContain("This model service needs cloud-send approval");
    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.querySelector(".agent-run-state")).toBeNull();
    expect(container.querySelector('[aria-label="Needs attention"]')).toBeNull();

    await clickButton(dom, container, "Allow once");
    await waitFor(dom, () => harness.modelEgressResolveRequests.length === 1);
    expect(harness.modelEgressResolveRequests[0]).toEqual({
      requestId: "egressreq_20260714_homeapproval0001",
      jobId: "job_20260714_homeapproval",
      decision: "allow_once"
    });
    await waitFor(dom, () => buttons(container, "Allow once").length === 0);
    expect(buttons(container, "Don't send")).toHaveLength(0);
    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.querySelector(".agent-run-state.state-running")).not.toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("discovers a live model-egress wait through the full filtered App refresh", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.enforceJobFilters = true;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      harness.jobs = [modelEgressWaitingJob()];
      harness.modelEgressPending = modelEgressPendingRequest();
      return new Promise<AgentSubmitTurnResult>(() => undefined);
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Send selected sensitive context.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => buttons(container, "Allow once").length === 1);

    expect(harness.jobListRequests.some((request) =>
      request.states?.includes("waiting_model_egress") === true
    )).toBe(true);
    expect(buttons(container, "Allow once")).toHaveLength(1);
    expect(buttons(container, "Don't send")).toHaveLength(1);
    expect(container.querySelector(".task-panel")).toBeNull();
    expect(container.querySelector(".agent-run-state")).toBeNull();
    expect(container.querySelector('[aria-label="Needs attention"]')).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it.each(["allow_once", "deny"] as const)(
    "adopts durable %s truth after a post-commit IPC rejection",
    async (decision) => {
      const dom = createDom();
      const harness = createHarness(modelEgressWaitingTimeline());
      harness.jobs = [modelEgressWaitingJob()];
      harness.modelEgressPending = modelEgressPendingRequest();
      harness.modelEgressResolveMode = "post_commit_reject";
      const { container, root } = await mountHome(dom, makePigeApi(harness));

      const action = decision === "allow_once" ? "Allow once" : "Don't send";
      await waitFor(dom, () => buttons(container, action).length === 1);
      await clickButton(dom, container, action);
      await waitFor(dom, () => buttons(container, "Allow once").length === 0);

      expect(buttons(container, "Don't send")).toHaveLength(0);
      expect(container.textContent).not.toContain("Saving...");
      expect(container.textContent).not.toContain("could not verify");
      expect(container.querySelector(".task-panel")).toBeNull();
      expect(container.querySelector(
        `.agent-run-state.state-${decision === "deny" ? "failed" : "running"}`
      )).not.toBeNull();

      await act(async () => root.unmount());
      dom.window.close();
    }
  );

  it("ignores an old vault decision result after the active vault changes", async () => {
    const dom = createDom();
    const harness = createHarness(modelEgressWaitingTimeline());
    harness.jobs = [modelEgressWaitingJob()];
    harness.modelEgressPending = modelEgressPendingRequest();
    harness.modelEgressResolveMode = "success_switch_vault";
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttons(container, "Allow once").length === 1);
    await clickButton(dom, container, "Allow once");
    await waitFor(dom, () => harness.onboarding.activeVault?.vaultId === "vault_20260714_secondvault");
    await act(async () => settle(dom));

    expect(buttons(container, "Allow once")).toHaveLength(0);
    expect(buttons(container, "Don't send")).toHaveLength(0);
    expect(container.textContent).not.toContain("This selected context is marked sensitive");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a retryable exact decision after an uncertain IPC rejection and fails closed if reread fails", async () => {
    const retryDom = createDom();
    const retryHarness = createHarness(undefined);
    retryHarness.jobs = [modelEgressWaitingJob()];
    retryHarness.modelEgressPending = modelEgressPendingRequest();
    retryHarness.modelEgressResolveMode = "reject_pending";
    const retryMount = await mountHome(retryDom, makePigeApi(retryHarness));

    await waitFor(retryDom, () => buttons(retryMount.container, "Allow once").length === 1);
    await clickButton(retryDom, retryMount.container, "Allow once");
    await waitFor(retryDom, () => retryMount.container.textContent?.includes("The decision was not saved") === true);
    expect(buttons(retryMount.container, "Allow once")).toHaveLength(1);
    expect(buttons(retryMount.container, "Don't send")).toHaveLength(1);
    await act(async () => retryMount.root.unmount());
    retryDom.window.close();

    const unknownDom = createDom();
    const unknownHarness = createHarness(undefined);
    unknownHarness.jobs = [modelEgressWaitingJob()];
    unknownHarness.modelEgressPending = modelEgressPendingRequest();
    unknownHarness.modelEgressResolveMode = "reject_unknown";
    const unknownMount = await mountHome(unknownDom, makePigeApi(unknownHarness));

    await waitFor(unknownDom, () => buttons(unknownMount.container, "Allow once").length === 1);
    await clickButton(unknownDom, unknownMount.container, "Allow once");
    await waitFor(unknownDom, () => unknownMount.container.textContent?.includes("could not verify") === true);
    expect(buttons(unknownMount.container, "Allow once")).toHaveLength(0);
    expect(buttons(unknownMount.container, "Don't send")).toHaveLength(0);
    await act(async () => unknownMount.root.unmount());
    unknownDom.window.close();
  });

  it("gives a picker source Job sole status ownership before submission resolves", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.onboarding = captureOnlyOnboarding(true);
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
    harness.onboarding = captureOnlyOnboarding(true);
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
    const clientTurnId = harness.submitRequests[0]?.clientTurnId;
    if (!clientTurnId) throw new Error("Expected a client turn identity.");

    await act(async () => {
      harness.emitDraft(draftEvent({ clientTurnId: "turn_20260713_wrongturn000", sequence: 1, text: "Wrong turn." }));
      harness.emitDraft(draftEvent({ clientTurnId, sequence: 1, text: "<img src=x onerror=alert(1)> Safe draft one." }));
      await settle(dom);
    });
    const provisional = container.querySelector<HTMLElement>('[data-agent-draft="true"]');
    expect(provisional?.textContent).toContain("<img src=x onerror=alert(1)> Safe draft one.");
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

  it("shows compact Activity and disables repeated Undo after the durable change moves to trash", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.activities = [reversibleActivity()];
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttons(container, "Undo").length === 1);
    expect(container.querySelector('[aria-label="Activity"]')?.textContent)
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
    expect(activityRow?.querySelector(".activity-row-copy")).not.toBeNull();
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

    const updateUndoLabel = "Undo: Knowledge note updated: Refined boundary (2)";
    await waitFor(dom, () => buttonsByAriaLabel(container, updateUndoLabel).length === 1);
    const activityRegion = container.querySelector('[aria-label="Activity"]');
    expect(activityRegion?.textContent).toContain("Knowledge note created: Grounded boundary");
    expect(activityRegion?.textContent).toContain("Knowledge note updated: Refined boundary");
    expect(container.querySelector('[data-activity-row-id="op_20260712_activityfixture"]')?.getAttribute("aria-label"))
      .toBe("Knowledge note created: Grounded boundary (1)");
    expect(container.querySelector('[data-activity-row-id="op_20260712_updateactivity"]')?.getAttribute("aria-label"))
      .toBe("Knowledge note updated: Refined boundary (2)");

    await clickElement(dom, buttonsByAriaLabel(container, updateUndoLabel)[0]!);
    await waitFor(dom, () => harness.undoOperationIds.length === 1);

    expect(harness.undoOperationIds).toEqual(["op_20260712_updateactivity"]);
    expect(container.textContent).toContain("Change moved to recoverable trash.");
    expect(buttonsByAriaLabel(container, updateUndoLabel)).toHaveLength(0);
    expect(buttonsByAriaLabel(container, "Undo: Knowledge note created: Grounded boundary (1)")).toHaveLength(1);
    const updatedRow = container.querySelector<HTMLElement>('[data-activity-row-id="op_20260712_updateactivity"]');
    expect(updatedRow?.textContent).toContain("Undone");
    await waitFor(dom, () => dom.window.document.activeElement === updatedRow);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("re-reads durable Activity truth after a post-commit Undo rejection", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.activities = [reversibleActivity()];
    harness.activityUndoMode = "post_commit_reject";
    const { container, root } = await mountHome(dom, makePigeApi(harness));

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
    expect(styles).toMatch(/\.activity-row\s*\{[\s\S]*?grid-template-columns:\s*8px minmax\(0, 1fr\) auto;[\s\S]*?min-height:\s*32px;/);
    expect(styles).toMatch(/\.activity-row-dot\s*\{[\s\S]*?width:\s*6px;[\s\S]*?background:\s*var\(--success\);/);
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
  readonly cancelJobIds: string[];
  readonly setDefaultModelIds: string[];
  readonly speechAvailabilityRequests: SpeechAvailabilityRequest[];
  readonly speechStartRequests: SpeechStartRequest[];
  readonly speechStopRequests: SpeechSessionRequest[];
  readonly speechCancelRequests: SpeechCancelRequest[];
  readonly speechListeners: Set<(event: SpeechSessionEvent) => void>;
  readonly speechAssetInstallRequests: TestSpeechAssetInstallRequest[];
  readonly speechAssetCancelRequests: { readonly installationId: string }[];
  readonly speechAssetListeners: Set<(event: TestSpeechAssetInstallEvent) => void>;
  readonly undoOperationIds: string[];
  readonly draftListeners: Set<(event: AgentTurnDraftEvent) => void>;
  activityUndoMode: "success" | "post_commit_reject" | "retryable_reject" | "unknown_reject";
  activityListReads: number;
  dismissFirstHomeCalls: number;
  modelEgressPending: ModelEgressPendingRequest | undefined;
  modelEgressPendingReads: number;
  readonly modelEgressResolveRequests: ModelEgressResolveRequest[];
  modelEgressResolveMode: "success" | "reject_pending" | "reject_unknown" | "post_commit_reject" | "success_switch_vault";
  permissionPending: PermissionPendingRequest | undefined;
  permissionPendingReads: number;
  readonly permissionResolveRequests: PermissionResolveRequest[];
  permissionResolveMode: "success" | "reject_pending" | "reject_unknown" | "post_commit_reject" | "success_switch_vault";
  locale: "zh-Hans" | "en" | "ja" | "ko" | "fr" | "de";
  windowMode: "compact" | "expanded";
  sidebarOpen: boolean;
  loadOnboarding: () => Promise<OnboardingStatus>;
  loadModelSummary: () => Promise<ModelProviderSettingsSummary>;
  loadAgentRuntimeStatus: () => Promise<AgentRuntimeStatus | null>;
  setDefaultModel: (modelProfileId: string) => Promise<void>;
  speechAvailability: SpeechAvailabilityResult;
  speechStartResult: SpeechStartResult;
  speechStopResult: SpeechStopResult;
  startSpeech: (request: SpeechStartRequest) => Promise<SpeechStartResult>;
  installSpeechAsset: (request: TestSpeechAssetInstallRequest) => Promise<TestSpeechAssetInstallResult>;
  loadConversation: () => Promise<AgentConversationTimeline | undefined>;
  submitTurn: (request: AgentSubmitTurnRequest) => Promise<AgentSubmitTurnResult>;
  emitDraft: (event: AgentTurnDraftEvent) => void;
  emitSpeech: (event: SpeechSessionEvent) => void;
  emitSpeechAsset: (event: TestSpeechAssetInstallEvent) => void;
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
    cancelJobIds: [],
    setDefaultModelIds: [],
    speechAvailabilityRequests: [],
    speechStartRequests: [],
    speechStopRequests: [],
    speechCancelRequests: [],
    speechListeners: new Set(),
    speechAssetInstallRequests: [],
    speechAssetCancelRequests: [],
    speechAssetListeners: new Set(),
    undoOperationIds: [],
    draftListeners: new Set(),
    activityUndoMode: "success",
    activityListReads: 0,
    dismissFirstHomeCalls: 0,
    modelEgressPending: undefined,
    modelEgressPendingReads: 0,
    modelEgressResolveRequests: [],
    modelEgressResolveMode: "success",
    permissionPending: undefined,
    permissionPendingReads: 0,
    permissionResolveRequests: [],
    permissionResolveMode: "success",
    locale: "en",
    windowMode: "compact",
    sidebarOpen: false,
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
      setMode: async ({ mode }: { readonly mode: "compact" | "expanded" }) => {
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
      appearance: async () => ({ locale: harness.locale, availableLocales: [harness.locale] })
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
      installLanguageAsset: async (request: TestSpeechAssetInstallRequest) => {
        harness.speechAssetInstallRequests.push(request);
        return harness.installSpeechAsset(request);
      },
      cancelLanguageAssetInstall: async (request: { readonly installationId: string }) => {
        harness.speechAssetCancelRequests.push(request);
        return { status: "canceled" as const, installationId: request.installationId };
      },
      openSystemSettings: async () => ({ status: "opened" as const }),
      onSessionEvent: (listener: (event: SpeechSessionEvent) => void) => {
        harness.speechListeners.add(listener);
        return () => harness.speechListeners.delete(listener);
      },
      onAssetInstallEvent: (listener: (event: TestSpeechAssetInstallEvent) => void) => {
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
        if (harness.timeline?.latestTurn?.jobId === jobId) {
          harness.timeline = {
            ...harness.timeline,
            latestTurn: {
              jobId: harness.timeline.latestTurn.jobId,
              userEventId: harness.timeline.latestTurn.userEventId,
              state: "queued"
            }
          };
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
    modelEgress: {
      pending: async () => {
        harness.modelEgressPendingReads += 1;
        if (
          harness.modelEgressResolveMode === "reject_unknown" &&
          harness.modelEgressResolveRequests.length > 0
        ) throw new Error("synthetic unreadable model egress state");
        return harness.modelEgressPending;
      },
      resolve: async (request: ModelEgressResolveRequest) => {
        harness.modelEgressResolveRequests.push(request);
        if (harness.modelEgressResolveMode === "reject_pending" || harness.modelEgressResolveMode === "reject_unknown") {
          throw new Error("synthetic model egress resolution failure");
        }
        harness.modelEgressPending = undefined;
        harness.jobs = harness.jobs.map((job) => job.id === request.jobId
          ? {
              ...job,
              state: request.decision === "deny" ? "failed_final" : "running",
              modelEgressApprovalRequestId: undefined,
              updatedAt: "2026-07-14T08:00:01.000Z"
            }
          : job);
        if (harness.timeline?.latestTurn?.jobId === request.jobId) {
          harness.timeline = {
            ...harness.timeline,
            latestTurn: {
              jobId: harness.timeline.latestTurn.jobId,
              userEventId: harness.timeline.latestTurn.userEventId,
              state: request.decision === "deny" ? "failed_final" : "running"
            }
          };
        }
        if (harness.modelEgressResolveMode === "success_switch_vault") {
          harness.onboarding = {
            ...readyOnboarding(),
            activeVault: { ...homeVaultSummary(), vaultId: "vault_20260714_secondvault", name: "Second vault" }
          };
        }
        if (harness.modelEgressResolveMode === "post_commit_reject") {
          throw new Error("synthetic post-commit transport rejection");
        }
        return {
          status: request.decision === "deny" ? "denied" : "approved",
          requestId: request.requestId,
          jobId: request.jobId
        };
      }
    },
    permissions: {
      pending: async () => {
        harness.permissionPendingReads += 1;
        if (
          harness.permissionResolveMode === "reject_unknown" &&
          harness.permissionResolveRequests.length > 0
        ) throw new Error("synthetic unreadable permission state");
        return harness.permissionPending;
      },
      resolve: async (request: PermissionResolveRequest) => {
        harness.permissionResolveRequests.push(request);
        if (
          harness.permissionResolveMode === "reject_pending" ||
          harness.permissionResolveMode === "reject_unknown"
        ) {
          throw new Error("synthetic permission resolution failure");
        }
        harness.permissionPending = undefined;
        harness.jobs = harness.jobs.map((job) => job.id === request.jobId
          ? {
              ...job,
              state: request.decision === "deny" ? "failed_final" : "running",
              permissionRequestId: request.decision === "deny" ? request.requestId : undefined,
              updatedAt: "2026-07-14T09:00:01.000Z"
            }
          : job);
        if (harness.timeline?.latestTurn?.jobId === request.jobId) {
          harness.timeline = {
            ...harness.timeline,
            latestTurn: {
              jobId: harness.timeline.latestTurn.jobId,
              userEventId: harness.timeline.latestTurn.userEventId,
              state: request.decision === "deny" ? "failed_final" : "running",
              ...(request.decision === "deny"
                ? {
                    error: {
                      code: "permission.denied",
                      domain: "permission" as const,
                      messageKey: "errors.permission.denied",
                      retryable: false,
                      severity: "info" as const,
                      userAction: "none" as const
                    }
                  }
                : {})
            }
          };
        }
        if (harness.permissionResolveMode === "success_switch_vault") {
          harness.onboarding = {
            ...readyOnboarding(),
            activeVault: { ...homeVaultSummary(), vaultId: "vault_20260714_permissionsecond", name: "Second vault" }
          };
        }
        if (harness.permissionResolveMode === "post_commit_reject") {
          throw new Error("synthetic post-commit permission transport rejection");
        }
        return {
          status: request.decision === "deny" ? "denied" : "approved",
          requestId: request.requestId,
          jobId: request.jobId
        };
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
      render: async ({ pageId }: { readonly pageId: string }) => testRenderedNote(pageId)
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
    html: `<h1>${summary.title}</h1><p>Approved reader fixture.</p>`,
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

function permissionWaitingJob(): JobSummary {
  return {
    id: "job_20260714_permission01",
    class: "agent_turn",
    state: "waiting_permission",
    permissionRequestId: "permreq_20260714_homepermission01",
    message: "Private command material must never become renderer copy.",
    createdAt: "2026-07-14T09:00:00.000Z",
    updatedAt: "2026-07-14T09:00:00.000Z"
  };
}

function permissionWaitingTimeline(): AgentConversationTimeline {
  return {
    conversationId: "conv_20260714_permission01",
    tailEventId: "evt_20260714_permissionuser01",
    canFollowUp: false,
    messages: [{
      id: "evt_20260714_permissionuser01",
      role: "user",
      createdAt: "2026-07-14T09:00:00.000Z",
      text: "Check the latest release notes.",
      jobId: "job_20260714_permission01"
    }],
    latestTurn: {
      jobId: "job_20260714_permission01",
      userEventId: "evt_20260714_permissionuser01",
      state: "waiting_permission",
      error: {
        code: "permission.confirmation_required",
        domain: "permission",
        messageKey: "errors.permission.confirmation_required",
        retryable: false,
        severity: "warning",
        userAction: "grant_permission",
        permissionRequestId: "permreq_20260714_homepermission01"
      }
    }
  };
}

function permissionPendingRequest(
  overrides: Partial<PermissionPendingRequest> = {}
): PermissionPendingRequest {
  return {
    requestId: "permreq_20260714_homepermission01",
    jobId: "job_20260714_permission01",
    actorType: "skill",
    actorDisplayName: "Release Notes Skill",
    actorVersion: "1.2.3-private-version",
    capability: "external_network",
    dataBoundary: "network",
    actionLabelKey: "permissions.action.fetch_release_notes",
    resourceScope: "current_domain",
    resourceKind: "network",
    resourceCount: 1,
    reasonCode: "permission.external_network_required",
    createdAt: "2026-07-14T09:00:00.000Z",
    ...overrides
  };
}

function modelEgressWaitingJob(): JobSummary {
  return {
    id: "job_20260714_homeapproval",
    class: "agent_turn",
    state: "waiting_model_egress",
    stage: "waiting_for_model",
    modelEgressApprovalRequestId: "egressreq_20260714_homeapproval0001",
    message: "Agent turn is waiting for one exact model egress decision.",
    createdAt: "2026-07-14T08:00:00.000Z",
    updatedAt: "2026-07-14T08:00:00.000Z"
  };
}

function modelEgressWaitingTimeline(): AgentConversationTimeline {
  return {
    conversationId: "conv_20260714_homeapproval",
    tailEventId: "evt_20260714_homeapprovaluser",
    canFollowUp: false,
    messages: [{
      id: "evt_20260714_homeapprovaluser",
      role: "user",
      createdAt: "2026-07-14T08:00:00.000Z",
      text: "Send selected sensitive context.",
      jobId: "job_20260714_homeapproval"
    }],
    latestTurn: {
      jobId: "job_20260714_homeapproval",
      userEventId: "evt_20260714_homeapprovaluser",
      state: "waiting_model_egress",
      error: {
        code: "model_provider.egress_confirmation_required",
        domain: "model_provider",
        messageKey: "errors.model_provider.egress_confirmation_required",
        retryable: false,
        severity: "warning",
        userAction: "confirm_model_egress",
        modelEgressApprovalRequestId: "egressreq_20260714_homeapproval0001"
      }
    }
  };
}

function modelEgressPendingRequest(): ModelEgressPendingRequest {
  return {
    requestId: "egressreq_20260714_homeapproval0001",
    jobId: "job_20260714_homeapproval",
    providerProfileId: "provider_sensitive_home",
    modelProfileId: "model_sensitive_home",
    reasonCode: "sensitive_confirmation",
    contentClasses: ["sensitive"],
    requestedAt: "2026-07-14T08:00:00.000Z"
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

function captureOnlyOnboarding(showFirstHomeGuide: boolean): OnboardingStatus {
  return {
    state: "capture_only",
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
  const settingsTrigger = container.querySelector<HTMLButtonElement>(".sidebar-settings-control");
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

async function clickElement(dom: JSDOM, element: HTMLButtonElement): Promise<void> {
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
