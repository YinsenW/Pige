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
        onDismiss: () => undefined,
        onStop: () => undefined,
        onComplete: () => undefined,
        t: translate(enMessages)
      }));
    });
    expect(container.querySelector(".home-voice-wave")).not.toBeNull();
    expect(container.textContent).toContain("Editable local transcript");
    expect(container.querySelectorAll("button")).toHaveLength(2);

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

  it("keeps all voice copy aligned across six locale catalogs", () => {
    const localeCatalogs = [deMessages, enMessages, frMessages, jaMessages, koMessages, zhHansMessages];
    const voiceKeys = Object.keys(enMessages).filter((key) => key.startsWith("home.voice."));
    expect(voiceKeys.length).toBeGreaterThanOrEqual(14);
    for (const catalog of localeCatalogs) {
      expect(voiceKeys.every((key) => typeof catalog[key as keyof typeof catalog] === "string")).toBe(true);
    }
  });

  it("binds production to unsupported state without a speech or permission bridge", () => {
    const appSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/App.tsx"), "utf8");
    const voiceSource = fs.readFileSync(path.resolve("apps/desktop/src/renderer/src/components/HomeVoicePanel.tsx"), "utf8");
    expect(appSource).toContain('setVoicePanelState("unsupported")');
    expect(appSource).not.toContain("window.pige.speech");
    expect(voiceSource).not.toContain("window.pige");
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
