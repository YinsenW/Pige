import fs from "node:fs";
import path from "node:path";
import { createElement, useState } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurrentNoteAgent } from "../../apps/desktop/src/renderer/src/components/CurrentNoteAgent";
import {
  NoteAgentPanel,
  type NoteAgentModelOption,
  type NoteAgentProposal
} from "../../apps/desktop/src/renderer/src/components/NoteAgentPanel";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";

const rendererRoot = path.resolve("apps/desktop/src/renderer/src");
const appSource = fs.readFileSync(path.join(rendererRoot, "App.tsx"), "utf8");
const componentSource = fs.readFileSync(path.join(rendererRoot, "components/NoteAgentPanel.tsx"), "utf8");
const adapterSource = fs.readFileSync(path.join(rendererRoot, "components/CurrentNoteAgent.tsx"), "utf8");
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

  it("gives model egress one body-free current-action owner", async () => {
    const dom = createDom();
    const decisions: string[] = [];
    const mount = await mountPanel(dom, {
      availability: "running",
      modelEgressPrompt: {
        kind: "ready",
        reasonMessageKey: "home.modelEgress.sensitive"
      },
      onModelEgressDecision: (decision) => decisions.push(decision)
    });

    expect(mount.container.querySelectorAll(".note-agent-egress-prompt")).toHaveLength(1);
    expect(mount.container.querySelector(".note-agent-run-state")).toBeNull();
    expect(mount.container.textContent).toContain(t("home.modelEgress.sensitive"));
    await click(dom, required(buttonNamed(mount.container, t("home.modelEgress.deny"))));
    await click(dom, required(buttonNamed(mount.container, t("home.modelEgress.allowOnce"))));
    expect(decisions).toEqual(["deny", "allow_once"]);

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

  it("binds one exact current-note scope without attachments or mutation surfaces", async () => {
    const dom = createDom();
    const draftListeners: Array<(event: unknown) => void> = [];
    const conversation = vi.fn().mockResolvedValue(undefined);
    let resolveSubmission!: (value: unknown) => void;
    const submission = new Promise((resolve) => { resolveSubmission = resolve; });
    const submitTurn = vi.fn().mockReturnValue(submission);
    const completedOutcome = {
      requestId: "request_note_1",
      jobId: "job_note_1",
      conversationEventId: "event_user_1",
      conversationId: "conversation_note_1",
      tailEventId: "event_assistant_1",
      state: "completed",
      modelUsage: "local",
      sourceIds: [],
      answer: {
        answer: "Grounded in this note.",
        grounding: "local_knowledge",
        citations: [{
          refId: "ref_current_note_1",
          label: "Current note · quote",
          pageId: "page_current_note_1",
          title: "Current note",
          pageType: "note",
          locator: "quote:0-24"
        }]
      }
    };
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        agent: {
          conversation,
          submitTurn,
          onTurnDraft: (listener: (event: unknown) => void) => {
            draftListeners.push(listener);
            return () => undefined;
          }
        },
        jobs: {
          cancel: vi.fn(),
          retry: vi.fn()
        },
        modelEgress: {
          pending: vi.fn(),
          resolve: vi.fn()
        }
      }
    });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(CurrentNoteAgent, {
        modal: false,
        pageId: "page_current_note_1",
        noteTitle: "Current note.md",
        locale: "en",
        models: modelFixtures(),
        switchingModel: false,
        onClose: () => undefined,
        onOpenModels: () => undefined,
        onSelectModel: async () => true,
        onOpenCitation: () => undefined,
        t
      }));
      await settle(dom);
    });
    expect(conversation).toHaveBeenCalledWith({
      scope: { kind: "current_note", pageId: "page_current_note_1" },
      limit: 24
    });

    const textarea = required(container.querySelector<HTMLTextAreaElement>("textarea"));
    await input(dom, textarea, "What is the core idea?");
    await keydown(dom, textarea, { key: "Enter" });
    await waitFor(dom, () => submitTurn.mock.calls.length === 1);
    expect(submitTurn).toHaveBeenCalledWith(expect.objectContaining({
      text: "What is the core idea?",
      inputKind: "typed_text",
      scope: { kind: "current_note", pageId: "page_current_note_1" },
      locale: "en"
    }));
    expect(submitTurn.mock.calls[0]).toHaveLength(1);
    expect(draftListeners).toHaveLength(1);
    await act(async () => {
      draftListeners[0]?.({
        apiVersion: 1,
        kind: "draft_replace",
        requestId: "request_note_1",
        clientTurnId: submitTurn.mock.calls[0]?.[0]?.clientTurnId,
        jobId: "job_note_1",
        conversationId: "conversation_note_1",
        conversationEventId: "event_user_1",
        sequence: 1,
        text: "First safe draft"
      });
      draftListeners[0]?.({
        apiVersion: 1,
        kind: "draft_replace",
        requestId: "request_note_1",
        clientTurnId: submitTurn.mock.calls[0]?.[0]?.clientTurnId,
        jobId: "job_note_1",
        conversationId: "conversation_note_1",
        conversationEventId: "event_user_1",
        sequence: 2,
        text: "Latest safe draft"
      });
      draftListeners[0]?.({
        apiVersion: 1,
        kind: "draft_replace",
        requestId: "request_note_1",
        clientTurnId: submitTurn.mock.calls[0]?.[0]?.clientTurnId,
        jobId: "job_note_1",
        conversationId: "conversation_note_1",
        conversationEventId: "event_user_1",
        sequence: 1,
        text: "Stale draft"
      });
      await settle(dom);
    });
    expect(container.querySelectorAll(".agent-message-card")).toHaveLength(1);
    expect(container.querySelector(".agent-message-card")?.textContent).toContain("Latest safe draft");
    expect(container.textContent).not.toContain("Stale draft");

    await act(async () => {
      resolveSubmission(completedOutcome);
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes("Grounded in this note.") === true);
    expect(container.textContent).not.toContain("Latest safe draft");
    expect(buttonNamed(container, "Current note · quote")).toBeDefined();
    expect(container.querySelector(".proposal-panel")).toBeNull();
    expect(container.querySelector(".attach-button")?.hasAttribute("disabled")).toBe(true);

    await unmount(dom, root);
  });

  it("reconciles the exact current-note model-egress decision without a duplicate status", async () => {
    const dom = createDom();
    const waitingTimeline = noteEgressTimeline("waiting_model_egress");
    const deniedTimeline = noteEgressTimeline("failed_final");
    const conversation = vi.fn()
      .mockResolvedValueOnce(waitingTimeline)
      .mockResolvedValue(deniedTimeline);
    const resolve = vi.fn().mockResolvedValue({
      status: "denied",
      requestId: "egressreq_note_1",
      jobId: "job_note_egress_1"
    });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        agent: {
          conversation,
          submitTurn: vi.fn(),
          onTurnDraft: () => () => undefined
        },
        jobs: { cancel: vi.fn(), retry: vi.fn() },
        modelEgress: {
          pending: vi.fn().mockResolvedValue({
            requestId: "egressreq_note_1",
            jobId: "job_note_egress_1",
            providerProfileId: "provider_note_1",
            modelProfileId: "model-note-a",
            reasonCode: "sensitive_confirmation",
            contentClasses: ["sensitive"],
            requestedAt: "2026-07-16T01:00:00.000Z"
          }),
          resolve
        }
      }
    });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CurrentNoteAgent, {
        modal: false,
        pageId: "page_current_note_1",
        noteTitle: "Current note.md",
        locale: "en",
        models: modelFixtures(),
        switchingModel: false,
        onClose: () => undefined,
        onOpenModels: () => undefined,
        onSelectModel: async () => true,
        onOpenCitation: () => undefined,
        t
      }));
      await settle(dom);
    });
    await waitFor(dom, () => buttonNamed(container, t("home.modelEgress.deny")) !== undefined);
    expect(container.querySelectorAll(".note-agent-egress-prompt")).toHaveLength(1);
    expect(container.querySelector(".note-agent-run-state")).toBeNull();

    await click(dom, required(buttonNamed(container, t("home.modelEgress.deny"))));
    await waitFor(dom, () => container.querySelector(".note-agent-egress-prompt") === null);
    expect(resolve).toHaveBeenCalledWith({
      requestId: "egressreq_note_1",
      jobId: "job_note_egress_1",
      decision: "deny"
    });
    expect(container.querySelectorAll(".note-agent-run-state.error")).toHaveLength(1);
    expect(container.textContent).toContain(t("errors.model_provider.egress_denied"));
    expect(container.querySelector(".note-agent-run-state button")).toBeNull();

    await unmount(dom, root);
  });

  it("keeps the UI adapter service-free, responsive, and localized in all six catalogs", () => {
    expect(componentSource).not.toContain("window.pige");
    expect(componentSource).not.toContain("errorMessage?:");
    expect(componentSource).toContain("errorMessageKey?: string");
    expect(appSource).toContain("<CurrentNoteAgent");
    expect(appSource).toContain("pageId={selectedNote.summary.pageId}");
    expect(appSource).toContain("onSelectModel={setHomeDefaultModel}");
    expect(adapterSource).toContain('scope: { kind: "current_note", pageId }');
    expect(adapterSource).toContain("proposal={null}");
    expect(adapterSource).not.toContain("window.pige.proposals");
    expect(adapterSource).not.toContain("window.pige.activity");
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

function noteEgressTimeline(state: "waiting_model_egress" | "failed_final"): Record<string, unknown> {
  return {
    conversationId: "conversation_note_egress_1",
    tailEventId: "event_note_user_egress_1",
    canFollowUp: false,
    messages: [{
      id: "event_note_user_egress_1",
      role: "user",
      createdAt: "2026-07-16T01:00:00.000Z",
      text: "Explain the sensitive section.",
      jobId: "job_note_egress_1"
    }],
    latestTurn: {
      jobId: "job_note_egress_1",
      userEventId: "event_note_user_egress_1",
      state,
      error: state === "waiting_model_egress" ? {
        code: "model_provider.egress_confirmation_required",
        domain: "model_provider",
        messageKey: "errors.model_provider.egress_confirmation_required",
        retryable: false,
        severity: "warning",
        userAction: "confirm_model_egress",
        modelEgressApprovalRequestId: "egressreq_note_1"
      } : {
        code: "model_provider.egress_denied",
        domain: "model_provider",
        messageKey: "errors.model_provider.egress_denied",
        retryable: false,
        severity: "warning",
        userAction: "none"
      }
    }
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
