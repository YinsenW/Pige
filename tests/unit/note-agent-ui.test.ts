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
  type NoteAgentMessage,
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
    const proposalPanel = required(mount.container.querySelector<HTMLElement>(".proposal-panel"));
    expect(proposalPanel.getAttribute("aria-labelledby")).toBe("note-agent-proposal-title");
    expect(proposalPanel.getAttribute("aria-describedby")).toBe("note-agent-proposal-description");
    expect(proposalPanel.innerHTML).toContain("Old wording");
    expect(mount.container.querySelector('[data-kind="removed"]')?.textContent).toContain("Old wording");
    expect(mount.container.querySelector('[data-kind="added"]')?.textContent).toContain("Grounded wording");
    expect(mount.container.querySelector(".diff-line.context")?.textContent).toContain("Nearby context");
    expect(mount.container.querySelector(".proposal-panel")?.textContent).toContain(t("note.proposal.action.polish"));
    expect(mount.container.querySelector(".proposal-panel")?.textContent).toContain(t("note.proposal.description"));
    expect(mount.container.querySelector(".proposal-panel")?.textContent).not.toContain("proposal-fixture");
    expect(mount.container.querySelector(".proposal-panel")?.textContent).not.toContain("7");
    await click(dom, required(buttonNamed(mount.container, "Current note · 1")));
    await click(dom, required(buttonNamed(mount.container, t("note.proposal.apply"))));
    expect(opened).toEqual(["page_fixture_current"]);
    expect(decisions).toEqual(["proposal-fixture:apply"]);

    await unmount(dom, mount.root);
  });

  it("keeps a resolving proposal focus-owned and blocks duplicate decisions", async () => {
    const dom = createDom();
    const mount = await mountPanel(dom, {
      proposal: {
        ...proposalFixture(),
        state: "resolving",
        errorMessageKey: "note.proposal.decisionFailed"
      },
      onProposalAction: () => undefined
    });
    const panel = required(mount.container.querySelector<HTMLElement>(".proposal-panel"));
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain(t("note.proposal.decisionFailed"));
    expect(Array.from(panel.querySelectorAll<HTMLButtonElement>("button"))).toHaveLength(3);
    expect(Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).every((button) => button.disabled)).toBe(true);
    await unmount(dom, mount.root);
  });

  it("replaces exceptional review controls with one focused terminal result", async () => {
    const dom = createDom();
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);

    function Harness(): React.JSX.Element {
      const [proposal, setProposal] = useState<NoteAgentProposal>(proposalFixture());
      return createElement(NoteAgentPanel, {
        modal: false,
        noteTitle: "Current note.md",
        availability: "ready",
        messages: [],
        proposal,
        draft: "",
        models: modelFixtures(),
        switchingModel: false,
        onClose: () => undefined,
        onDraftChange: () => undefined,
        onProposalAction: (_proposalId, action) => {
          if (action === "apply") setProposal((current) => ({ ...current, state: "applied" }));
        },
        t
      });
    }

    await act(async () => {
      root.render(createElement(Harness));
      await settle(dom);
    });
    await click(dom, required(buttonNamed(container, t("note.proposal.apply"))));
    const terminal = required(container.querySelector<HTMLElement>(".proposal-panel.state-applied"));
    await waitFor(dom, () => dom.window.document.activeElement === terminal);
    expect(terminal.querySelector('[role="status"]')?.textContent).toContain(t("note.proposal.status.applied"));
    expect(buttonNamed(container, t("note.proposal.apply"))).toBeUndefined();
    expect(terminal.textContent).not.toContain("proposal-fixture");

    await unmount(dom, root);
  });

  it("renders role-free sanitized Markdown messages with one provisional streaming owner", async () => {
    const dom = createDom();
    const mount = await mountPanel(dom, {
      availability: "ready",
      messages: [
        {
          id: "user-markdown",
          role: "user",
          body: "Please explain **this note**."
        },
        {
          id: "assistant-markdown",
          role: "assistant",
          body: "## Summary\n\n- First point\n- Second point\n\n`local only`\n\n<script>private()</script>"
        },
        {
          id: "assistant-draft",
          role: "assistant",
          body: "**Draft** answer",
          provisional: true,
          citations: [{ pageId: "page_must_not_render", label: "Hidden draft citation" }]
        }
      ],
      onCopyMessage: async () => true
    });

    await waitFor(dom, () => mount.container.querySelectorAll('[data-markdown-ready="true"]').length === 3);
    expect(mount.container.querySelectorAll(".agent-message-author")).toHaveLength(0);
    expect(mount.container.querySelectorAll(".agent-message-role.visually-hidden")).toHaveLength(3);
    expect(mount.container.querySelector(".role-user strong")?.textContent).toBe("this note");
    expect(mount.container.querySelector(".role-assistant h2")?.textContent).toBe("Summary");
    expect(mount.container.querySelectorAll(".role-assistant li")).toHaveLength(2);
    expect(mount.container.querySelector(".role-assistant code")?.textContent).toBe("local only");
    expect(mount.container.querySelector("script")).toBeNull();
    expect(mount.container.textContent).not.toContain("private()");
    expect(mount.container.querySelector('[data-provisional="true"] .provisional-markdown strong')?.textContent).toBe("Draft");
    expect(mount.container.querySelector('[data-provisional="true"] .message-actions')).toBeNull();
    expect(mount.container.querySelector('[data-provisional="true"] .note-agent-citations')).toBeNull();

    await unmount(dom, mount.root);
  });

  it("acknowledges final-message copy success and failure without exposing actions on provisional drafts", async () => {
    const dom = createDom();
    let finishCopy!: (copied: boolean) => void;
    const onCopyMessage = vi.fn(() => new Promise<boolean>((resolve) => {
      finishCopy = resolve;
    }));
    const mount = await mountPanel(dom, {
      availability: "ready",
      messages: [
        { id: "answer-final", role: "assistant", body: "Final grounded answer" },
        { id: "answer-draft", role: "assistant", body: "Provisional answer", provisional: true }
      ],
      onCopyMessage
    });

    const copyButton = required(buttonAriaNamed(mount.container, t("note.agentCopy")));
    copyButton.focus();
    await click(dom, copyButton);
    expect(onCopyMessage).toHaveBeenCalledTimes(1);
    expect(onCopyMessage).toHaveBeenCalledWith("answer-final");
    expect(required(buttonAriaNamed(mount.container, t("note.agentCopying"))).disabled).toBe(true);
    expect(dom.window.document.activeElement).toBe(copyButton);
    expect(mount.container.querySelector('[data-provisional="true"] .message-actions')).toBeNull();

    await act(async () => {
      finishCopy(true);
      await settle(dom);
    });
    expect(buttonAriaNamed(mount.container, t("note.agentCopied"))).toBe(copyButton);
    expect(mount.container.querySelector(".message-copy-feedback.copied")?.textContent).toBe(t("note.agentCopied"));
    expect(dom.window.document.activeElement).toBe(copyButton);

    await click(dom, copyButton);
    await act(async () => {
      finishCopy(false);
      await settle(dom);
    });
    const retryButton = required(buttonAriaNamed(mount.container, t("note.agentCopyFailed")));
    expect(retryButton.disabled).toBe(false);
    expect(mount.container.querySelector(".message-copy-feedback.failed")?.textContent).toBe(t("note.agentCopyFailed"));
    expect(dom.window.document.activeElement).toBe(copyButton);

    await unmount(dom, mount.root);
  });

  it("places running feedback in the message thread instead of a separate status strip", async () => {
    const dom = createDom();
    const mount = await mountPanel(dom, {
      availability: "running",
      messages: [],
      onCancel: () => undefined
    });

    expect(mount.container.querySelectorAll(".note-agent-loading-message .conversation-loading-dots")).toHaveLength(1);
    expect(mount.container.querySelector("article.note-agent-run-state.note-agent-loading-message")).not.toBeNull();
    const workingLabels = Array.from(mount.container.querySelectorAll(".note-agent-loading-message > span"))
      .filter((node) => node.textContent === t("note.agentWorking"));
    expect(workingLabels).toHaveLength(1);
    expect(workingLabels[0]?.classList.contains("visually-hidden")).toBe(true);
    expect(mount.container.querySelector(".note-agent-loading-message .agent-message-role")?.classList.contains("visually-hidden")).toBe(true);

    await unmount(dom, mount.root);
  });

  it("follows streaming growth only while the reader remains near the thread bottom", async () => {
    const dom = createDom();
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);
    let updateMessages!: (messages: readonly NoteAgentMessage[]) => void;

    function Harness(): React.JSX.Element {
      const [messages, setMessages] = useState<readonly NoteAgentMessage[]>([
        { id: "answer", role: "assistant", body: "First safe snapshot" }
      ]);
      updateMessages = setMessages;
      return createElement(NoteAgentPanel, {
        modal: false,
        noteTitle: "Current note.md",
        availability: "ready",
        messages,
        proposal: null,
        draft: "",
        models: modelFixtures(),
        switchingModel: false,
        onClose: () => undefined,
        onDraftChange: () => undefined,
        t
      });
    }

    await act(async () => {
      root.render(createElement(Harness));
      await settle(dom);
    });
    const thread = required(container.querySelector<HTMLDivElement>(".note-agent-thread"));
    Object.defineProperty(thread, "scrollHeight", { configurable: true, value: 600 });
    Object.defineProperty(thread, "clientHeight", { configurable: true, value: 200 });
    thread.scrollTop = 400;

    await act(async () => {
      updateMessages([{ id: "answer", role: "assistant", body: "First safe snapshot grows" }]);
      await settle(dom);
    });
    expect(thread.scrollTop).toBe(600);

    thread.scrollTop = 0;
    await act(async () => {
      thread.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
      updateMessages([{ id: "answer", role: "assistant", body: "A later snapshot must not steal reading position" }]);
      await settle(dom);
    });
    expect(thread.scrollTop).toBe(0);

    await unmount(dom, root);
  });

  it("uses the approved model listbox keyboard and exact focus-return behavior", async () => {
    const dom = createDom();
    const selected: string[] = [];
    let closes = 0;
    const mount = await mountPanel(dom, {
      modal: true,
      onClose: () => { closes += 1; },
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
    expect(closes).toBe(0);

    await unmount(dom, mount.root);
  });

  it("keeps Enter-to-send IME-safe and preserves Shift+Enter", async () => {
    const dom = createDom();
    let submits = 0;
    let closes = 0;
    const mount = await mountPanel(dom, {
      modal: true,
      onClose: () => { closes += 1; },
      availability: "ready",
      onSubmit: () => { submits += 1; }
    });
    const textarea = required(mount.container.querySelector<HTMLTextAreaElement>("textarea"));

    await input(dom, textarea, "Explain this note");
    await keydown(dom, textarea, { key: "Enter", shiftKey: true });
    await keydown(dom, textarea, { key: "Enter", isComposing: true });
    await keydown(dom, textarea, { key: "Enter", keyCode: 229 });
    await keydown(dom, textarea, { key: "Escape", isComposing: true });
    await keydown(dom, textarea, { key: "Escape", keyCode: 229 });
    expect(submits).toBe(0);
    expect(closes).toBe(0);

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
        vaultId: "vault_current_note_1",
        pageId: "page_current_note_1",
        noteTitle: "Current note.md",
        locale: "en",
        models: modelFixtures(),
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
    expect(container.querySelector(".agent-message-card")?.getAttribute("data-provisional")).toBe("true");
    expect(container.querySelector(".agent-message-card")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".agent-message-card .message-actions")).toBeNull();
    expect(container.querySelector(".agent-message-card .note-agent-citations")).toBeNull();
    expect(container.textContent).not.toContain("Stale draft");

    await act(async () => {
      resolveSubmission(completedOutcome);
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes("Grounded in this note.") === true);
    expect(container.textContent).not.toContain("Latest safe draft");
    expect(container.querySelector('[data-provisional="true"]')).toBeNull();
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
        vaultId: "vault_current_note_1",
        pageId: "page_current_note_1",
        noteTitle: "Current note.md",
        locale: "en",
        models: modelFixtures(),
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
    expect(required(container.querySelector<HTMLButtonElement>(".note-agent-model-switcher")).disabled).toBe(true);

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

  it("refreshes one waiting current-note Job through model recovery and stops at terminal truth", async () => {
    const dom = createDom();
    const timelines = [
      noteRecoveryTimeline("waiting_dependency"),
      noteRecoveryTimeline("queued"),
      noteRecoveryTimeline("running"),
      noteRecoveryTimeline("completed")
    ];
    const conversation = vi.fn().mockImplementation(async () => timelines.shift() ?? noteRecoveryTimeline("completed"));
    const intervalCallbacks = new Map<number, () => void>();
    let nextIntervalId = 1;
    vi.spyOn(dom.window, "setInterval").mockImplementation(((handler: TimerHandler) => {
      const id = nextIntervalId++;
      intervalCallbacks.set(id, () => {
        if (typeof handler === "function") handler();
      });
      return id;
    }) as typeof dom.window.setInterval);
    vi.spyOn(dom.window, "clearInterval").mockImplementation(((id: number | undefined) => {
      if (id !== undefined) intervalCallbacks.delete(Number(id));
    }) as typeof dom.window.clearInterval);
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: noteAgentApi(conversation)
    });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(CurrentNoteAgent, currentNoteAgentProps("page_current_note_recovery")));
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes(t("errors.model_provider.default_model_missing")) === true);
    expect(required(container.querySelector<HTMLButtonElement>(".send-button")).disabled).toBe(true);
    expect(intervalCallbacks.size).toBe(1);

    await runOnlyInterval(dom, intervalCallbacks);
    await waitFor(dom, () => container.textContent?.includes(t("errors.model_provider.default_model_missing")) === false);
    expect(container.querySelectorAll(".note-agent-run-state")).toHaveLength(1);
    expect(required(container.querySelector<HTMLButtonElement>(".note-agent-model-switcher")).disabled).toBe(true);
    expect(intervalCallbacks.size).toBe(1);

    await runOnlyInterval(dom, intervalCallbacks);
    expect(container.querySelectorAll(".note-agent-run-state")).toHaveLength(1);
    expect(intervalCallbacks.size).toBe(1);

    await runOnlyInterval(dom, intervalCallbacks);
    await waitFor(dom, () => container.textContent?.includes("Recovered from the same note Job.") === true);
    expect(container.textContent).not.toContain(t("errors.model_provider.default_model_missing"));
    expect(container.querySelector(".note-agent-run-state")).toBeNull();
    expect(intervalCallbacks.size).toBe(0);
    const textarea = required(container.querySelector<HTMLTextAreaElement>("textarea"));
    await input(dom, textarea, "Continue from the recovered answer");
    expect(required(container.querySelector<HTMLButtonElement>(".send-button")).disabled).toBe(false);
    expect(conversation).toHaveBeenCalledTimes(4);
    for (const [request] of conversation.mock.calls) {
      expect(request).toEqual({
        scope: { kind: "current_note", pageId: "page_current_note_recovery" },
        limit: 24
      });
    }

    await unmount(dom, root);
  });

  it("does not apply a late timeline result from the previously selected note", async () => {
    const dom = createDom();
    let resolveOldPage!: (value: unknown) => void;
    const oldPageTimeline = new Promise((resolve) => { resolveOldPage = resolve; });
    const conversation = vi.fn().mockImplementation(({ scope }: { scope: { pageId: string } }) =>
      scope.pageId === "page_old" ? oldPageTimeline : Promise.resolve(notePageTimeline("page_new", "New page answer"))
    );
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: noteAgentApi(conversation)
    });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(CurrentNoteAgent, { key: "page_old", ...currentNoteAgentProps("page_old") }));
      await settle(dom);
    });
    await waitFor(dom, () => conversation.mock.calls.some(([request]) => request.scope.pageId === "page_old"));
    await act(async () => {
      root.render(createElement(CurrentNoteAgent, { key: "page_new", ...currentNoteAgentProps("page_new") }));
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes("New page answer") === true);
    await act(async () => {
      resolveOldPage(notePageTimeline("page_old", "Stale old page answer"));
      await settle(dom);
    });
    expect(container.textContent).toContain("New page answer");
    expect(container.textContent).not.toContain("Stale old page answer");
    expect(conversation).toHaveBeenCalledWith({ scope: { kind: "current_note", pageId: "page_old" }, limit: 24 });
    expect(conversation).toHaveBeenCalledWith({ scope: { kind: "current_note", pageId: "page_new" }, limit: 24 });

    await unmount(dom, root);
  });

  it("keeps the composer gated until the first scoped timeline read completes and fails closed", async () => {
    const dom = createDom();
    let resolveTimeline!: (value: unknown) => void;
    const conversation = vi.fn().mockReturnValue(new Promise((resolve) => { resolveTimeline = resolve; }));
    const onSelectModel = vi.fn().mockResolvedValue(true);
    Object.defineProperty(dom.window, "pige", { configurable: true, value: noteAgentApi(conversation) });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CurrentNoteAgent, {
        ...currentNoteAgentProps("page_initial_read"),
        onSelectModel
      }));
      await settle(dom);
    });
    expect(required(container.querySelector<HTMLTextAreaElement>("textarea")).disabled).toBe(true);
    expect(required(container.querySelector<HTMLButtonElement>(".send-button")).disabled).toBe(true);
    expect(required(container.querySelector<HTMLButtonElement>(".note-agent-model-switcher")).disabled).toBe(true);
    expect(onSelectModel).not.toHaveBeenCalled();
    expect(container.querySelector(".note-agent-state")).toBeNull();
    expect(container.querySelectorAll(".note-agent-run-state")).toHaveLength(1);

    await act(async () => {
      resolveTimeline(undefined);
      await settle(dom);
    });
    await waitFor(dom, () => required(container.querySelector<HTMLTextAreaElement>("textarea")).disabled === false);
    await unmount(dom, root);

    const failedDom = createDom();
    const failedConversation = vi.fn().mockRejectedValue(new Error("private detail must not render"));
    Object.defineProperty(failedDom.window, "pige", { configurable: true, value: noteAgentApi(failedConversation) });
    const failedContainer = failedDom.window.document.createElement("div");
    failedDom.window.document.body.append(failedContainer);
    const failedRoot = createRoot(failedContainer);
    await act(async () => {
      failedRoot.render(createElement(CurrentNoteAgent, {
        ...currentNoteAgentProps("page_failed_read"),
        onSelectModel
      }));
      await settle(failedDom);
    });
    await waitFor(failedDom, () => failedContainer.querySelector('[role="alert"]') !== null);
    expect(failedContainer.textContent).toContain(t("errors.model_provider.call_failed"));
    expect(failedContainer.textContent).not.toContain("private detail");
    expect(failedContainer.querySelector(".note-agent-state")).toBeNull();
    expect(failedContainer.querySelectorAll(".note-agent-run-state")).toHaveLength(1);
    expect(required(failedContainer.querySelector<HTMLTextAreaElement>("textarea")).disabled).toBe(true);
    expect(required(failedContainer.querySelector<HTMLButtonElement>(".send-button")).disabled).toBe(true);
    expect(required(failedContainer.querySelector<HTMLButtonElement>(".note-agent-model-switcher")).disabled).toBe(true);
    expect(onSelectModel).not.toHaveBeenCalled();
    await unmount(failedDom, failedRoot);
  });

  it("renders Reader transform timeline intent from the strict presentation enum, never Host instructions", async () => {
    const dom = createDom();
    const conversation = vi.fn().mockResolvedValue({
      conversationId: "conversation_reader_transform",
      tailEventId: "event_reader_transform_user",
      canFollowUp: false,
      messages: [{
        id: "event_reader_transform_user",
        role: "user",
        createdAt: "2026-07-18T15:20:00.000Z",
        text: "INTERNAL HOST INSTRUCTION MUST NOT RENDER",
        inputPresentation: { kind: "reader_selection_transform", action: "translate" },
        jobId: "job_reader_transform"
      }],
      latestTurn: {
        jobId: "job_reader_transform",
        userEventId: "event_reader_transform_user",
        state: "waiting_dependency",
        error: {
          code: "model_provider.default_model_missing",
          domain: "model_provider",
          messageKey: "errors.model_provider.default_model_missing",
          retryable: false,
          severity: "warning",
          userAction: "configure_models"
        }
      }
    });
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: noteAgentApi(conversation)
    });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(CurrentNoteAgent, currentNoteAgentProps("page_reader_transform")));
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes(t("note.proposal.action.translate")) === true);

    expect(container.textContent).toContain(t("note.proposal.action.translate"));
    expect(container.textContent).not.toContain("INTERNAL HOST INSTRUCTION");

    await unmount(dom, root);
  });

  it("invalidates a pending submit when the active vault changes for the same page ID", async () => {
    const dom = createDom();
    const pageId = "page_shared_between_vaults";
    const conversation = vi.fn()
      .mockResolvedValueOnce(notePageTimeline(pageId, "Old vault timeline"))
      .mockResolvedValue(notePageTimeline(pageId, "New vault timeline"));
    let resolveOldSubmit!: (value: unknown) => void;
    const submitTurn = vi.fn().mockReturnValue(new Promise((resolve) => { resolveOldSubmit = resolve; }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { ...noteAgentApi(conversation), agent: {
        conversation,
        submitTurn,
        onTurnDraft: () => () => undefined
      } }
    });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CurrentNoteAgent, {
        key: `vault_old:${pageId}`,
        ...currentNoteAgentProps(pageId, "vault_old")
      }));
      await settle(dom);
    });
    await waitFor(dom, () => required(container.querySelector<HTMLTextAreaElement>("textarea")).disabled === false);
    const textarea = required(container.querySelector<HTMLTextAreaElement>("textarea"));
    await input(dom, textarea, "Old vault question");
    await keydown(dom, textarea, { key: "Enter" });
    await waitFor(dom, () => submitTurn.mock.calls.length === 1);

    await act(async () => {
      root.render(createElement(CurrentNoteAgent, {
        key: `vault_new:${pageId}`,
        ...currentNoteAgentProps(pageId, "vault_new")
      }));
      await settle(dom);
    });
    await waitFor(dom, () => container.textContent?.includes("New vault timeline") === true);
    await act(async () => {
      resolveOldSubmit(completedNoteOutcome(pageId, "Old vault answer must stay stale"));
      await settle(dom);
    });
    expect(container.textContent).toContain("New vault timeline");
    expect(container.textContent).not.toContain("Old vault timeline");
    expect(container.textContent).not.toContain("Old vault answer must stay stale");
    expect(conversation).toHaveBeenCalledTimes(2);
    await unmount(dom, root);
  });

  it("serializes model changes, permits waiting-model recovery, and blocks active turns", async () => {
    const dom = createDom();
    const conversation = vi.fn().mockResolvedValue(noteRecoveryTimeline("waiting_dependency"));
    let resolveSwitch!: (value: boolean) => void;
    const onSelectModel = vi.fn().mockReturnValue(new Promise<boolean>((resolve) => { resolveSwitch = resolve; }));
    Object.defineProperty(dom.window, "pige", { configurable: true, value: noteAgentApi(conversation) });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CurrentNoteAgent, {
        ...currentNoteAgentProps("page_current_note_recovery"),
        onSelectModel
      }));
      await settle(dom);
    });
    const switcher = required(container.querySelector<HTMLButtonElement>(".note-agent-model-switcher"));
    await waitFor(dom, () => switcher.disabled === false);
    await click(dom, switcher);
    const secondOption = required(Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))[1]);
    await click(dom, secondOption);
    await waitFor(dom, () => onSelectModel.mock.calls.length === 1);
    expect(switcher.disabled).toBe(true);
    await click(dom, secondOption);
    expect(onSelectModel).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSwitch(true);
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[role="listbox"]') === null);
    await unmount(dom, root);

    const runningDom = createDom();
    Object.defineProperty(runningDom.window, "pige", {
      configurable: true,
      value: noteAgentApi(vi.fn().mockResolvedValue(noteRecoveryTimeline("running")))
    });
    const runningContainer = runningDom.window.document.createElement("div");
    runningDom.window.document.body.append(runningContainer);
    const runningRoot = createRoot(runningContainer);
    await act(async () => {
      runningRoot.render(createElement(CurrentNoteAgent, currentNoteAgentProps("page_current_note_recovery")));
      await settle(runningDom);
    });
    await waitFor(runningDom, () => runningContainer.querySelector(".note-agent-run-state") !== null);
    expect(required(runningContainer.querySelector<HTMLButtonElement>(".note-agent-model-switcher")).disabled).toBe(true);
    await unmount(runningDom, runningRoot);
  });

  it.each(["failed_final", "cancelled"] as const)(
    "removes a provisional draft when the exact turn becomes %s",
    async (terminalState) => {
      const dom = createDom();
      const draftListeners: Array<(event: Record<string, unknown>) => void> = [];
      const conversation = vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(noteDraftTimeline("running"))
        .mockResolvedValue(noteDraftTimeline(terminalState));
      const submitTurn = vi.fn().mockResolvedValue(waitingNoteOutcome());
      const intervalCallbacks = new Map<number, () => void>();
      let nextIntervalId = 1;
      vi.spyOn(dom.window, "setInterval").mockImplementation(((handler: TimerHandler) => {
        const id = nextIntervalId++;
        intervalCallbacks.set(id, () => { if (typeof handler === "function") handler(); });
        return id;
      }) as typeof dom.window.setInterval);
      vi.spyOn(dom.window, "clearInterval").mockImplementation(((id: number | undefined) => {
        if (id !== undefined) intervalCallbacks.delete(Number(id));
      }) as typeof dom.window.clearInterval);
      Object.defineProperty(dom.window, "pige", {
        configurable: true,
        value: { ...noteAgentApi(conversation), agent: {
          conversation,
          submitTurn,
          onTurnDraft: (listener: (event: Record<string, unknown>) => void) => {
            draftListeners.push(listener);
            return () => undefined;
          }
        } }
      });
      const container = dom.window.document.createElement("div");
      dom.window.document.body.append(container);
      const { createRoot } = await import("react-dom/client");
      const root = createRoot(container);
      await act(async () => {
        root.render(createElement(CurrentNoteAgent, currentNoteAgentProps("page_draft_cleanup")));
        await settle(dom);
      });
      await waitFor(dom, () => required(container.querySelector<HTMLTextAreaElement>("textarea")).disabled === false);
      const textarea = required(container.querySelector<HTMLTextAreaElement>("textarea"));
      await input(dom, textarea, "Start one scoped turn");
      await keydown(dom, textarea, { key: "Enter" });
      await waitFor(dom, () => intervalCallbacks.size === 1);
      await act(async () => {
        draftListeners[0]?.({
          apiVersion: 1,
          kind: "draft_replace",
          requestId: "request_note_draft_1",
          clientTurnId: submitTurn.mock.calls[0]?.[0]?.clientTurnId,
          jobId: "job_note_draft_1",
          conversationId: "conversation_note_draft_1",
          conversationEventId: "event_note_user_draft_1",
          sequence: 1,
          text: "Provisional text that must clear"
        });
        await settle(dom);
      });
      expect(container.querySelector('[data-provisional="true"]')?.textContent).toContain("Provisional text that must clear");
      await runOnlyInterval(dom, intervalCallbacks);
      await waitFor(dom, () => container.querySelector('[data-provisional="true"]') === null);
      expect(container.textContent).not.toContain("Provisional text that must clear");
      expect(intervalCallbacks.size).toBe(0);
      await unmount(dom, root);
    }
  );

  it("revokes a provisional draft immediately when submit fails and the scoped reread also fails", async () => {
    const dom = createDom();
    const draftListeners: Array<(event: Record<string, unknown>) => void> = [];
    const conversation = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("private reread failure must stay hidden"));
    let resolveSubmission!: (value: unknown) => void;
    const submitTurn = vi.fn().mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve; }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { ...noteAgentApi(conversation), agent: {
        conversation,
        submitTurn,
        onTurnDraft: (listener: (event: Record<string, unknown>) => void) => {
          draftListeners.push(listener);
          return () => undefined;
        }
      } }
    });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CurrentNoteAgent, currentNoteAgentProps("page_failed_submission")));
      await settle(dom);
    });
    await waitFor(dom, () => required(container.querySelector<HTMLTextAreaElement>("textarea")).disabled === false);
    const textarea = required(container.querySelector<HTMLTextAreaElement>("textarea"));
    await input(dom, textarea, "Fail this scoped turn safely");
    await keydown(dom, textarea, { key: "Enter" });
    await waitFor(dom, () => submitTurn.mock.calls.length === 1);
    await act(async () => {
      draftListeners[0]?.({
        apiVersion: 1,
        kind: "draft_replace",
        requestId: "request_failed_submission",
        clientTurnId: submitTurn.mock.calls[0]?.[0]?.clientTurnId,
        jobId: "job_failed_submission",
        conversationId: "conversation_failed_submission",
        conversationEventId: "event_failed_submission",
        sequence: 1,
        text: "Provisional text that must be revoked"
      });
      await settle(dom);
    });
    expect(container.querySelector('[data-provisional="true"]')?.textContent).toContain("Provisional text that must be revoked");

    await act(async () => {
      resolveSubmission({
        requestId: "request_failed_submission",
        jobId: "job_failed_submission",
        conversationEventId: "event_failed_submission",
        conversationId: "conversation_failed_submission",
        tailEventId: "event_failed_submission",
        state: "failed",
        modelUsage: "none",
        sourceIds: [],
        error: {
          code: "agent.internal_error",
          domain: "agent",
          messageKey: "error.generic",
          retryable: false,
          severity: "error",
          userAction: "none"
        }
      });
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-provisional="true"]') === null);
    expect(container.textContent).not.toContain("Provisional text that must be revoked");
    expect(container.textContent).not.toContain("private reread failure");
    expect(container.querySelectorAll(".note-agent-run-state.error")).toHaveLength(1);
    expect(container.querySelector(".agent-message-card .message-actions")).toBeNull();
    expect(container.querySelector(".agent-message-card .note-agent-citations")).toBeNull();
    await unmount(dom, root);
  });

  it("revokes a provisional draft when the submit transport fails", async () => {
    const dom = createDom();
    const draftListeners: Array<(event: Record<string, unknown>) => void> = [];
    const conversation = vi.fn().mockResolvedValue(undefined);
    let rejectSubmission!: (reason: unknown) => void;
    const submitTurn = vi.fn().mockReturnValue(new Promise((_, reject) => { rejectSubmission = reject; }));
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: { ...noteAgentApi(conversation), agent: {
        conversation,
        submitTurn,
        onTurnDraft: (listener: (event: Record<string, unknown>) => void) => {
          draftListeners.push(listener);
          return () => undefined;
        }
      } }
    });
    const container = dom.window.document.createElement("div");
    dom.window.document.body.append(container);
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CurrentNoteAgent, currentNoteAgentProps("page_transport_failure")));
      await settle(dom);
    });
    await waitFor(dom, () => required(container.querySelector<HTMLTextAreaElement>("textarea")).disabled === false);
    const textarea = required(container.querySelector<HTMLTextAreaElement>("textarea"));
    await input(dom, textarea, "Fail the transport safely");
    await keydown(dom, textarea, { key: "Enter" });
    await waitFor(dom, () => submitTurn.mock.calls.length === 1);
    await act(async () => {
      draftListeners[0]?.({
        apiVersion: 1,
        kind: "draft_replace",
        requestId: "request_transport_failure",
        clientTurnId: submitTurn.mock.calls[0]?.[0]?.clientTurnId,
        jobId: "job_transport_failure",
        conversationId: "conversation_transport_failure",
        conversationEventId: "event_transport_failure",
        sequence: 1,
        text: "Transport draft that must be revoked"
      });
      await settle(dom);
    });
    expect(container.querySelector('[data-provisional="true"]')).not.toBeNull();
    await act(async () => {
      rejectSubmission(new Error("private transport detail must stay hidden"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-provisional="true"]') === null);
    expect(container.textContent).not.toContain("Transport draft that must be revoked");
    expect(container.textContent).not.toContain("private transport detail");
    expect(container.querySelectorAll(".note-agent-run-state.error")).toHaveLength(1);
    await unmount(dom, root);
  });

  it("keeps the UI adapter service-free, responsive, and localized in all six catalogs", () => {
    expect(componentSource).not.toContain("window.pige");
    expect(componentSource).not.toContain("errorMessage?:");
    expect(componentSource).toContain("errorMessageKey?: string");
    expect(appSource).toContain("<CurrentNoteAgent");
    expect(appSource).toContain('key={`${activeVault.vaultId}:${selectedNote.summary.pageId}:${noteAgentExternalRevision}`}');
    expect(appSource).toContain("vaultId={activeVault.vaultId}");
    expect(appSource).toContain("selectedNoteVaultId === activeVault.vaultId");
    expect(appSource).toContain("pageId={selectedNote.summary.pageId}");
    expect(appSource).toContain("onSelectModel={setHomeDefaultModel}");
    expect(adapterSource).toContain('scope: { kind: "current_note", pageId }');
    expect(adapterSource).toContain("proposal={props.proposal ? {");
    expect(appSource).toContain("window.pige.readerSelection.decideProposal");
    expect(appSource).toContain("window.pige.readerSelection.currentProposal");
    expect(appSource).toContain('decision: action === "apply" ? "approve" : "reject"');
    expect(appSource).toContain('if (result.status === "applied") await openNoteTarget(current.pageId);');
    expect(appSource).toContain('result.status !== "waiting" && !(result.status === "failed" && result.conversationId)');
    expect(appSource).toContain("current.vaultId === onboarding?.activeVault?.vaultId");
    expect(appSource).toContain("current.pageId === selectedNote?.summary.pageId");
    expect(adapterSource).not.toContain("window.pige.proposals");
    expect(adapterSource).not.toContain("window.pige.activity");
    expect(cssSource).toContain(".agent-message-card {");
    expect(cssSource).toContain(".agent-message-card.provisional {");
    expect(cssSource).toMatch(/\.agent-message-card\.role-user\s*\{[\s\S]*?justify-self:\s*end;[\s\S]*?background:\s*var\(--surface-muted\);/);
    expect(cssSource).toContain(".note-agent-loading-message {");
    expect(componentSource).toContain('<span className="agent-message-role visually-hidden">');
    expect(componentSource).not.toContain('className="agent-message-author"');
    expect(componentSource).toContain("<ConversationMarkdown");
    expect(componentSource).toContain("markdown={message.body}");
    expect(componentSource).toContain("...(message.provisional ? { provisional: true } : {})");
    expect(componentSource).toContain("followThreadRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 48");
    expect(cssSource).toContain(".proposal-panel {");
    expect(cssSource).toMatch(/\.note-agent\s*\{[\s\S]*?background:\s*var\(--surface\);/);
    expect(cssSource).not.toMatch(/\.note-agent\s*\{[\s\S]*?background:\s*#fdfdfd;/);
    expect(cssSource).toMatch(/\.note-agent-header\s*\{[\s\S]*?padding:\s*0 20px;/);
    expect(cssSource).toMatch(/\.note-agent-thread\s*\{[\s\S]*?padding:\s*22px 20px;/);
    expect(cssSource).toMatch(/\.note-composer\s*\{[\s\S]*?min-height:\s*132px;[\s\S]*?border-radius:\s*20px;/);
    expect(cssSource).toMatch(/\.note-composer textarea\s*\{[\s\S]*?min-height:\s*64px;[\s\S]*?font-size:\s*14px;[\s\S]*?line-height:\s*1\.5;/);
    expect(cssSource).toContain(".note-composer-toolbar { display: flex; align-items: center; gap: 8px; }");
    expect(cssSource).toContain("@media (max-width: 959px)");
    expect(cssSource).toContain("@media (min-width: 960px) and (max-width: 1239px)");
    expect(cssSource).toContain("@media (min-width: 1240px)");

    const keys = [
      "note.agentTitle",
      "note.agentEmpty",
      "note.agentModelSwitcher",
      "note.agentModelMenu",
      "note.agentModelSwitchFailed",
      "note.proposal.apply",
      "note.proposal.action.expand",
      "note.proposal.action.polish",
      "note.proposal.action.translate",
      "note.proposal.description",
      "note.proposal.decisionFailed",
      "note.proposal.later",
      "note.proposal.line.added",
      "note.proposal.line.context",
      "note.proposal.line.removed",
      "note.proposal.preview",
      "note.proposal.reject",
      "note.proposal.stale",
      "note.proposal.unavailable",
      "note.selection.applied",
      "note.selection.reviewReady"
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
    action: "polish",
    revision: 7,
    lines: [
      { kind: "context", text: "Nearby context" },
      { kind: "removed", text: "Old wording" },
      { kind: "added", text: "Grounded wording" }
    ],
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

function noteRecoveryTimeline(state: "waiting_dependency" | "queued" | "running" | "completed"): Record<string, unknown> {
  const pageId = "page_current_note_recovery";
  const jobId = "job_note_recovery_1";
  if (state === "completed") return notePageTimeline(pageId, "Recovered from the same note Job.", jobId);
  return {
    conversationId: "conversation_note_recovery_1",
    tailEventId: "event_note_user_recovery_1",
    canFollowUp: false,
    messages: [{
      id: "event_note_user_recovery_1",
      role: "user",
      createdAt: "2026-07-16T01:00:00.000Z",
      text: "Explain the current note.",
      jobId
    }],
    latestTurn: {
      jobId,
      userEventId: "event_note_user_recovery_1",
      state,
      ...(state === "waiting_dependency" ? {
        error: {
          code: "model_provider.default_model_missing",
          domain: "model_provider",
          messageKey: "errors.model_provider.default_model_missing",
          retryable: false,
          severity: "warning",
          userAction: "configure_models"
        }
      } : {})
    }
  };
}

function notePageTimeline(pageId: string, answer: string, jobId = `job_${pageId}`): Record<string, unknown> {
  return {
    conversationId: `conversation_${pageId}`,
    tailEventId: `event_assistant_${pageId}`,
    canFollowUp: true,
    messages: [
      {
        id: `event_user_${pageId}`,
        role: "user",
        createdAt: "2026-07-16T01:00:00.000Z",
        text: "Explain the current note.",
        jobId
      },
      {
        id: `event_assistant_${pageId}`,
        role: "assistant",
        createdAt: "2026-07-16T01:00:01.000Z",
        text: answer,
        answer: { answer, grounding: "local_knowledge", citations: [] }
      }
    ],
    latestTurn: {
      jobId,
      userEventId: `event_user_${pageId}`,
      state: "completed"
    }
  };
}

function noteDraftTimeline(state: "running" | "failed_final" | "cancelled"): Record<string, unknown> {
  return {
    conversationId: "conversation_note_draft_1",
    tailEventId: "event_note_user_draft_1",
    canFollowUp: false,
    messages: [{
      id: "event_note_user_draft_1",
      role: "user",
      createdAt: "2026-07-16T01:00:00.000Z",
      text: "Start one scoped turn",
      jobId: "job_note_draft_1"
    }],
    latestTurn: {
      jobId: "job_note_draft_1",
      userEventId: "event_note_user_draft_1",
      state,
      ...(state === "failed_final" ? {
        error: {
          code: "agent.internal_error",
          domain: "agent",
          messageKey: "error.generic",
          retryable: false,
          severity: "error",
          userAction: "none"
        }
      } : {})
    }
  };
}

function waitingNoteOutcome(): Record<string, unknown> {
  return {
    requestId: "request_note_draft_1",
    jobId: "job_note_draft_1",
    conversationEventId: "event_note_user_draft_1",
    conversationId: "conversation_note_draft_1",
    tailEventId: "event_note_user_draft_1",
    state: "waiting",
    modelUsage: "none",
    sourceIds: [],
    error: {
      code: "model_provider.default_model_missing",
      domain: "model_provider",
      messageKey: "errors.model_provider.default_model_missing",
      retryable: false,
      severity: "warning",
      userAction: "configure_models"
    }
  };
}

function completedNoteOutcome(pageId: string, answer: string): Record<string, unknown> {
  return {
    requestId: `request_${pageId}`,
    jobId: `job_${pageId}`,
    conversationEventId: `event_user_${pageId}`,
    conversationId: `conversation_${pageId}`,
    tailEventId: `event_assistant_${pageId}`,
    state: "completed",
    modelUsage: "local",
    sourceIds: [],
    answer: { answer, grounding: "local_knowledge", citations: [] }
  };
}

function noteAgentApi(conversation: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return {
    agent: {
      conversation,
      submitTurn: vi.fn(),
      onTurnDraft: () => () => undefined
    },
    jobs: { cancel: vi.fn(), retry: vi.fn() },
    modelEgress: { pending: vi.fn(), resolve: vi.fn() }
  };
}

function currentNoteAgentProps(
  pageId: string,
  vaultId = "vault_current_note_1"
): Parameters<typeof CurrentNoteAgent>[0] {
  return {
    modal: false,
    vaultId,
    pageId,
    noteTitle: `${pageId}.md`,
    locale: "en",
    models: modelFixtures(),
    onClose: () => undefined,
    onOpenModels: () => undefined,
    onSelectModel: async () => true,
    onOpenCitation: () => undefined,
    t
  };
}

async function runOnlyInterval(dom: JSDOM, callbacks: Map<number, () => void>): Promise<void> {
  const callback = required(Array.from(callbacks.values())[0]);
  await act(async () => {
    callback();
    await settle(dom);
  });
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

function buttonAriaNamed(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.getAttribute("aria-label") === name);
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Required test value missing");
  return value;
}
