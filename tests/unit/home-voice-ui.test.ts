import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { HomeVoicePanel } from "../../apps/desktop/src/renderer/src/components/HomeVoicePanel";
import deMessages from "../../apps/desktop/src/renderer/src/locales/de/messages.json";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";
import frMessages from "../../apps/desktop/src/renderer/src/locales/fr/messages.json";
import jaMessages from "../../apps/desktop/src/renderer/src/locales/ja/messages.json";
import koMessages from "../../apps/desktop/src/renderer/src/locales/ko/messages.json";
import zhHansMessages from "../../apps/desktop/src/renderer/src/locales/zh-Hans/messages.json";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
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

describe("Home voice UI", () => {
  it("renders an honest unsupported surface without recording or system actions", async () => {
    const dom = createDom();
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    let dismissed = false;

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "unsupported",
        onDismiss: () => { dismissed = true; },
        t: translate(enMessages)
      }));
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain(enMessages["home.voice.unsupportedTitle"]);
    expect(container.querySelector(".home-voice-wave")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.textContent).not.toContain(enMessages["home.voice.openSystemSettings"]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(dismissed).toBe(true);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps recording and permission states complete for contract-conformant adapters", async () => {
    const dom = createDom();
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "recording",
        transcript: "Editable local transcript",
        elapsedMs: 19_000,
        levels: [0, 0.2, 0.65, 1, 0.4, 0.1],
        onAttach: () => undefined,
        onDismiss: () => undefined,
        onStop: () => undefined,
        onComplete: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.querySelector(".home-voice-wave")).not.toBeNull();
    expect(container.querySelector(".home-voice-recording-row")).not.toBeNull();
    expect(container.querySelector(".home-voice-timer")?.textContent).toBe("0:19");
    expect(container.querySelector(".home-voice-wave.has-levels")?.children).toHaveLength(6);
    expect(container.textContent).toContain("Editable local transcript");
    expect(container.querySelectorAll("button")).toHaveLength(3);

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "permission_denied",
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(enMessages["home.voice.permissionTitle"]);
    expect(container.querySelector<HTMLButtonElement>("button.primary")?.disabled).toBe(true);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps language asset installation explicit and driven only by typed progress", async () => {
    const dom = createDom();
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    let installed = 0;
    let dismissed = 0;

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "assets_unavailable",
        onInstallLanguageAsset: () => { installed += 1; },
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.textContent).toContain(enMessages["home.voice.assetsUnavailableTitle"]);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === enMessages["home.voice.installLanguageAsset"])!
        .click();
    });
    expect(installed).toBe(1);

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "installing_asset",
        assetInstallProgress: 42,
        onDismiss: () => { dismissed += 1; },
        t: translate(enMessages)
      }));
    });
    const progress = container.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(progress.getAttribute("aria-valuenow")).toBe("42");
    expect(progress.getAttribute("aria-valuetext")).toContain("42%");
    expect(container.textContent).toContain("42%");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(dom.window.document.activeElement).toBe(container.querySelector(".home-voice-panel"));
    expect(container.textContent).not.toContain(enMessages["home.voice.continueTyping"]);
    await act(async () => {
      container.querySelector<HTMLElement>(".home-voice-panel")!.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(dismissed).toBe(0);

    let started = 0;
    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "asset_ready",
        onStartAfterAssetInstall: () => { started += 1; },
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.textContent).toContain(enMessages["home.voice.assetReadyTitle"]);
    expect(container.textContent).toContain(enMessages["home.voice.assetReadyDescription"]);
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === enMessages["home.voice.startAfterAssetInstall"])!
        .click();
    });
    expect(started).toBe(1);

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "asset_install_failed",
        onInstallLanguageAsset: () => undefined,
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain(enMessages["home.voice.assetInstallFailedTitle"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("covers permission, stopped, on-device transcription, ready and generic failure states", async () => {
    const dom = createDom();
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    let completed = 0;
    let retried = 0;

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "requesting_permission",
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).toContain(enMessages["home.voice.requestingPermissionTitle"]);
    expect(container.textContent).toContain(enMessages["home.voice.cancel"]);

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "stopped",
        transcript: "A local retained transcript",
        onComplete: () => { completed += 1; },
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.textContent).toContain("A local retained transcript");
    expect(container.querySelector(".home-voice-wave")).toBeNull();
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === enMessages["home.voice.useTranscript"])!
        .click();
    });
    expect(completed).toBe(1);

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "transcribing",
        transcript: "Monotonic partial transcript",
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.querySelector('[aria-busy="true"]')?.textContent).toContain("Monotonic partial transcript");
    expect(container.textContent).toContain(enMessages["home.voice.transcribingDescription"]);

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "ready",
        transcript: "Authoritative final transcript",
        onComplete: () => { completed += 1; },
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("false");
    expect(container.textContent).toContain(enMessages["home.voice.readyDescription"]);

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "failed",
        onRetry: () => { retried += 1; },
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(enMessages["home.voice.failedTitle"]);
    expect(container.textContent).toContain(enMessages["home.voice.failedDescription"]);
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === enMessages["home.voice.retry"])!
        .click();
    });
    expect(retried).toBe(1);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fails closed when the adapter has not supplied recording or transcript actions", async () => {
    const dom = createDom();
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "recording",
        transcript: "Local partial text",
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).every((button) => button.disabled)).toBe(true);
    expect(container.querySelector(".home-voice-wave.is-neutral")).not.toBeNull();
    expect(container.querySelector(".home-voice-timer")).toBeNull();

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "ready",
        transcript: "",
        onComplete: () => undefined,
        onDismiss: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === enMessages["home.voice.useTranscript"])?.disabled).toBe(true);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps retained transcript editing and dismissal inside the composer-owned voice mode", async () => {
    const dom = createDom();
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    const transcript = "Initial local transcript";
    let dismissed = 0;

    await act(async () => {
      root.render(createElement(HomeVoicePanel, {
        state: "stopped",
        transcript,
        onTranscriptChange: () => undefined,
        onComplete: () => undefined,
        onDismiss: () => { dismissed += 1; },
        t: translate(enMessages)
      }));
    });

    const editor = container.querySelector<HTMLTextAreaElement>(".home-voice-transcript")!;
    expect(editor.readOnly).toBe(false);
    expect(editor.value).toBe("Initial local transcript");
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === enMessages["home.voice.cancel"])!
        .click();
    });
    expect(dismissed).toBe(1);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps all voice copy aligned across six locale catalogs", () => {
    const localeCatalogs = [deMessages, enMessages, frMessages, jaMessages, koMessages, zhHansMessages];
    const voiceKeys = Object.keys(enMessages).filter((key) => key.startsWith("home.voice."));
    expect(voiceKeys.length).toBeGreaterThanOrEqual(32);
    for (const catalog of localeCatalogs) {
      expect(voiceKeys.every((key) => typeof catalog[key as keyof typeof catalog] === "string")).toBe(true);
    }
  });

  it("keeps the component service-free while the App owns the typed speech adapter", () => {
    const appSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const voiceSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/components/HomeVoicePanel.tsx"), "utf8");
    const cssSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/styles/app.css"), "utf8");
    expect(appSource).toContain("window.pige.speech.availability");
    expect(appSource).toContain("window.pige.speech.start");
    expect(appSource).toContain("window.pige.speech?.onSessionEvent");
    expect(appSource).toContain("draftTextRef.current");
    expect(appSource).not.toContain("navigator.mediaDevices");
    expect(voiceSource).not.toContain("window.pige");
    expect(voiceSource).toContain("home-voice-recording-row");
    expect(voiceSource).toContain("home-voice-transcript");
    expect(voiceSource).toContain("onInput={(event) => onTranscriptChange?.(event.currentTarget.value)}");
    expect(voiceSource).toContain("event.nativeEvent.isComposing");
    expect(cssSource).toContain(".home-voice-recording-row");
    expect(cssSource).not.toContain(".home-voice-panel {\n  width: 100%;\n  margin-bottom");
  });
});

function translate(messages: typeof enMessages): (key: string) => string {
  return (key) => messages[key as keyof typeof messages] ?? key;
}

function createDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost"
  });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: dom.window[key as keyof Window]
    });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}
