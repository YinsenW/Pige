import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HomeCaptureDropZone,
  settleHomeCaptureBatch
} from "../../apps/desktop/src/renderer/src/components/HomeCaptureDropZone";

const globals = ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Event", "MouseEvent"] as const;
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

describe("Home capture drop zone", () => {
  it("uses one keyboard-focusable entry for the picker and an exact non-bubbling drop", async () => {
    const dom = installDom();
    const onPick = vi.fn();
    const onDrop = vi.fn();
    const outerDrop = vi.fn();
    dom.window.document.body.addEventListener("drop", outerDrop);
    const root = createRoot(dom.window.document.querySelector("#root")!);
    await act(async () => {
      root.render(createElement(HomeCaptureDropZone, { disabled: false, status: null, onPick, onDrop, t }));
    });

    const trigger = button(dom, "Drop files here or choose files");
    const input = dom.window.document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const openPicker = vi.spyOn(input, "click").mockImplementation(() => undefined);
    trigger.focus();
    expect(dom.window.document.activeElement).toBe(trigger);
    expect(trigger.tabIndex).toBe(0);
    trigger.click();
    expect(openPicker).toHaveBeenCalledOnce();

    const file = new dom.window.File(["safe"], "safe.md", { type: "text/markdown" });
    const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      value: { files: [file], types: ["Files"], dropEffect: "none" }
    });
    await act(async () => { trigger.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(outerDrop).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledWith([file]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("announces explicit mixed counts and retains safe per-file failure details", async () => {
    const dom = installDom();
    const root = createRoot(dom.window.document.querySelector("#root")!);
    const rejectedFiles = [{ displayName: "blocked.zip", reason: "unsupported_type" as const }];
    const partial = settleHomeCaptureBatch(2, rejectedFiles, false);
    await act(async () => {
      root.render(createElement(HomeCaptureDropZone, {
        disabled: false, status: partial, onPick: vi.fn(), onDrop: vi.fn(), t
      }));
    });
    const status = dom.window.document.querySelector('[role="status"]')!;
    expect(status.textContent).toContain("Queued: 2 · Rejected: 1");
    expect(status.textContent).toContain("blocked.zip");
    expect(status.textContent).toContain("This file type is not supported.");
    expect(status.textContent).not.toContain("/Users/");
    expect(button(dom, "Choose files again")).toBeTruthy();

    await act(async () => {
      root.render(createElement(HomeCaptureDropZone, {
        disabled: false,
        status: { status: "failed", queuedCount: 0, rejectedFiles },
        onPick: vi.fn(), onDrop: vi.fn(), t
      }));
    });
    const alert = dom.window.document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("This file batch could not be submitted.");
    expect(alert.textContent).toContain("blocked.zip");
    expect(alert.textContent).toContain("Queued: 0 · Rejected: 1");

    await act(async () => root.unmount());
    dom.window.close();
  });
});

function t(key: string): string {
  return ({
    "home.captureDropZone": "Drop files here or choose files",
    "home.captureDropZoneHint": "Dropped files send now. Chosen files wait for Send.",
    "home.attachToMessage": "Attach to this message",
    "home.captureBatchSubmitting": "Checking and preserving files…",
    "home.captureBatchComplete": "File batch result",
    "home.captureBatchFailed": "This file batch could not be submitted.",
    "home.captureBatchCounts": "Queued: {queued} · Rejected: {rejected}",
    "home.captureChooseAgain": "Choose files again",
    "home.attachmentRejection.unsupportedType": "This file type is not supported."
  } as Record<string, string>)[key] ?? key;
}

function installDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: "https://pige.local/"
  });
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}

function button(dom: JSDOM, text: string): HTMLButtonElement {
  const candidate = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
    .find((entry) => entry.textContent?.includes(text));
  if (!candidate) throw new Error(`Missing button: ${text}`);
  return candidate;
}
