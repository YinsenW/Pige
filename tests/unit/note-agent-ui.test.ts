import fs from "node:fs";
import path from "node:path";
import { createElement, useState } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import {
  NoteAgentPanel,
  type NoteAgentModelOption,
  type NoteAgentProposal
} from "../../apps/desktop/src/renderer/src/components/NoteAgentPanel";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";

const rendererRoot = path.resolve("apps/desktop/src/renderer/src");
const appSource = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
const componentSource = fs.readFileSync(path.join(rendererRoot, "components/NoteAgentPanel.tsx"), "utf8");
const cssSource = fs.readFileSync(path.join(rendererRoot, "styles/app.css"), "utf8");
const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "CompositionEvent"
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

describe("Note Agent production UI", () => {
  it("keeps the real product fail-closed without fake answers, proposals, or actions", async () => {
    const dom = createDom();
    const mount = await mountPanel(dom, { availability: "unavailable" });

    expect(mount.container.querySelectorAll(".agent-message-card")).toHaveLength(0);
    expect(mount.container.querySelectorAll(".proposal-panel")).toHaveLength(0);
    expect(mount.container.querySelector('[role="status"]')?.textContent).toContain(t("development.state.unavailable"));
    expect(required(mount.container.querySelector<HTMLTextAreaElement>("textarea")).disabled).toBe(true);
    expect(required(mount.container.querySelector<HTMLButtonElement>('.send-button')).disabled).toBe(true);
    expect(required(mount.container.querySelector<HTMLButtonElement>('.note-agent-model-switcher')).disabled).toBe(true);

    await unmount(dom, mount.root);
  });

  it("renders contract-conformant answer and proposal fixtures without binding them as product truth", async () => {
    const dom = createDom();
    const opened: string[] = [];
    const decisions: string[] = [];
    const mount = await mountPanel(dom, {
      availability: "ready",
      messages: [{
        id: "answer-1",
        role: "assistant",
        body: "The current note keeps source evidence attached.",
        timestamp: "10:31",
        citations: [{ pageId: "page_fixture_current", label: "Current note · 1" }]
      }],
      proposal: proposalFixture(),
      onOpenCitation: (pageId) => opened.push(pageId),
      onProposalAction: (proposalId, action) => decisions.push(`${proposalId}:${action}`)
    });

    expect(mount.container.querySelector(".agent-message-card")?.textContent).toContain("source evidence");
    await click(dom, required(buttonNamed(mount.container, "Current note · 1")));
    await click(dom, required(buttonNamed(mount.container, t("note.proposal.apply"))));
    expect(opened).toEqual(["page_fixture_current"]);
    expect(decisions).toEqual(["proposal-fixture:apply"]);
    expect(mount.container.querySelector(".diff-line.remove")?.textContent).toContain("Old wording");
    expect(mount.container.querySelector(".diff-line.add")?.textContent).toContain("Grounded wording");

    await unmount(dom, mount.root);
  });

  it("uses the approved model listbox keyboard and exact focus-return behavior", async () => {
    const dom = createDom();
    const selected: string[] = [];
    const mount = await mountPanel(dom, {
      availability: "ready",
      onSelectModel: async (id) => {
        selected.push(id);
        return false;
      }
    });
    const switcher = required(mount.container.querySelector<HTMLButtonElement>(".note-agent-model-switcher"));

    await click(dom, switcher);
    await waitFor(dom, () => mount.container.querySelector('[role="listbox"]') !== null);
    const options = Array.from(mount.container.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    expect(options).toHaveLength(2);
    await waitFor(dom, () => dom.window.document.activeElement === options[0]);
    expect(dom.window.document.activeElement).toBe(options[0]);
    await keydown(dom, options[0]!, { key: "ArrowDown" });
    expect(dom.window.document.activeElement).toBe(options[1]);
    await click(dom, options[1]!);
    await waitFor(dom, () => mount.container.querySelector('[role="alert"]') !== null);
    expect(selected).toEqual(["model-b"]);
    expect(mount.container.querySelector('[role="listbox"]')).not.toBeNull();
    await keydown(dom, options[1]!, { key: "Escape" });
    await waitFor(dom, () => dom.window.document.activeElement === switcher);
    expect(mount.container.querySelector('[role="listbox"]')).toBeNull();

    await unmount(dom, mount.root);
  });

  it("keeps Enter-to-send IME-safe and preserves Shift+Enter", async () => {
    const dom = createDom();
    let submits = 0;
    const mount = await mountPanel(dom, {
      availability: "ready",
      onSubmit: () => { submits += 1; }
    });
    const textarea = required(mount.container.querySelector<HTMLTextAreaElement>("textarea"));

    await input(dom, textarea, "Explain this note");
    await keydown(dom, textarea, { key: "Enter", shiftKey: true });
    await keydown(dom, textarea, { key: "Enter", isComposing: true });
    await keydown(dom, textarea, { key: "Enter", keyCode: 229 });
    expect(submits).toBe(0);

    await act(async () => {
      textarea.dispatchEvent(new dom.window.CompositionEvent("compositionstart", { bubbles: true }));
      textarea.dispatchEvent(new dom.window.CompositionEvent("compositionend", { bubbles: true }));
      textarea.dispatchEvent(new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });
    expect(submits).toBe(0);
    await settle(dom);
    await keydown(dom, textarea, { key: "Enter" });
    expect(submits).toBe(1);

    await unmount(dom, mount.root);
  });

  it("keeps overlay focus contained and closes through Escape", async () => {
    const dom = createDom();
    let closes = 0;
    const mount = await mountPanel(dom, {
      availability: "ready",
      modal: true,
      onClose: () => { closes += 1; }
    });
    const panel = required(mount.container.querySelector<HTMLElement>(".note-agent"));
    await waitFor(dom, () => dom.window.document.activeElement?.getAttribute("aria-label") === t("note.agentHide"));
    const controls = Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled])"));
    const first = required(controls[0]);
    const last = required(controls[controls.length - 1]);
    last.focus();
    await keydown(dom, last, { key: "Tab" });
    expect(dom.window.document.activeElement).toBe(first);
    await keydown(dom, first, { key: "Tab", shiftKey: true });
    expect(dom.window.document.activeElement).toBe(last);
    await keydown(dom, panel, { key: "Escape" });
    expect(closes).toBe(1);
    await unmount(dom, mount.root);
  });

  it("keeps the UI adapter service-free, responsive, and localized in all six catalogs", () => {
    expect(componentSource).not.toContain("window.pige");
    expect(componentSource).not.toContain("errorMessage?:");
    expect(componentSource).toContain("errorMessageKey?: string");
    expect(appSource).toContain('availability="unavailable"');
    expect(appSource).toContain("onSelectModel={setHomeDefaultModel}");
    expect(cssSource).toContain(".agent-message-card {");
    expect(cssSource).toContain(".proposal-panel {");
    expect(cssSource).toMatch(/\.note-agent-header\s*\{[\s\S]*?padding:\s*0 20px;/);
    expect(cssSource).toMatch(/\.note-agent-thread\s*\{[\s\S]*?padding:\s*22px 20px;/);
    expect(cssSource).toMatch(/\.note-composer\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?border-radius:\s*20px;/);
    expect(cssSource).toMatch(/\.note-composer textarea\s*\{[\s\S]*?min-height:\s*64px;[\s\S]*?font-size:\s*14px;[\s\S]*?line-height:\s*1\.5;/);
    expect(cssSource).toContain(".note-composer-toolbar { display: flex; align-items: center; gap: 8px; }");
    expect(cssSource).toContain("@media (max-width: 1199px)");
    expect(cssSource).toContain("@media (min-width: 1200px)");

    const keys = [
      "note.agentTitle",
      "note.agentEmpty",
      "note.agentModelSwitcher",
      "note.agentModelMenu",
      "note.agentModelSwitchFailed",
      "note.proposal.apply",
      "note.proposal.later",
      "note.proposal.reject"
    ];
    for (const locale of ["de", "en", "fr", "ja", "ko", "zh-Hans"]) {
      const catalog = JSON.parse(fs.readFileSync(path.join(rendererRoot, "locales", locale, "messages.json"), "utf8")) as Record<string, unknown>;
      for (const key of keys) expect(catalog[key], `${locale}:${key}`).toEqual(expect.any(String));
    }
  });
});

type PanelOverrides = Partial<Parameters<typeof NoteAgentPanel>[0]>;

async function mountPanel(dom: JSDOM, overrides: PanelOverrides = {}): Promise<{ readonly root: Root; readonly container: HTMLElement }> {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);

  function Harness(): React.JSX.Element {
    const [draft, setDraft] = useState("");
    return createElement(NoteAgentPanel, {
      modal: false,
      noteTitle: "Current note.md",
      availability: "ready",
      messages: [],
      proposal: null,
      draft,
      models: modelFixtures(),
      switchingModel: false,
      onClose: () => undefined,
      onDraftChange: setDraft,
      t,
      ...overrides
    });
  }

  await act(async () => {
    root.render(createElement(Harness));
    await settle(dom);
  });
  return { root, container };
}

function modelFixtures(): readonly NoteAgentModelOption[] {
  return [
    { id: "model-a", name: "DeepSeek Chat", providerName: "DeepSeek", selected: true, ready: true },
    { id: "model-b", name: "GPT-4o", providerName: "OpenAI", selected: false, ready: false }
  ];
}

function proposalFixture(): NoteAgentProposal {
  return {
    id: "proposal-fixture",
    title: "Update core principle",
    description: "A source provides clearer wording.",
    removed: "Old wording",
    added: "Grounded wording",
    state: "ready"
  };
}

function t(key: string): string {
  return (enMessages as Record<string, string>)[key] ?? key;
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true
  });
  for (const key of globalKeys) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "PointerEvent" ? dom.window.MouseEvent : dom.window[key];
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}

async function input(dom: JSDOM, textarea: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await settle(dom);
  });
}

async function click(dom: JSDOM, button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

async function keydown(
  dom: JSDOM,
  target: HTMLElement,
  init: KeyboardEventInit & { readonly keyCode?: number }
): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    await settle(dom);
  });
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1_500) throw new Error("Timed out waiting for Note Agent state");
    await act(async () => settle(dom));
  }
}

async function unmount(dom: JSDOM, root: Root): Promise<void> {
  await act(async () => root.unmount());
  dom.window.close();
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === name);
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Required test value missing");
  return value;
}
