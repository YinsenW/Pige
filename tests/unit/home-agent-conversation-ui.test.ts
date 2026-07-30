import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentConversationRequest,
  AgentConversationEarlierPage,
  AgentConversationHistoryListRequest,
  AgentConversationHistoryListResult,
  AgentConversationInitialTimeline,
  AgentConversationTimeline,
  AppearanceSettingsSummary,
  CurrentNoteReplaceProposalDecisionRequest,
  CurrentNoteReplaceProposalDecisionResult,
  CurrentNoteReplaceProposalGetRequest,
  CurrentNoteReplaceProposalGetResult,
  AgentRuntimeStatus,
  AgentSubmitTurnRequest,
  AgentSubmitTurnResult,
  AgentStagedSubmitTurnResult,
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
  NoteArchiveCurrentRequest,
  NoteArchiveCurrentResult,
  NoteOpenSourceReferenceRequest,
  NoteOpenSourceReferenceResult,
  NoteReconnectOriginalSourceRequest,
  NoteReconnectOriginalSourceResult,
  NoteRevealSourceRequest,
  NoteRevealSourceResult,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorSaveRequest,
  NoteEditorSaveResult,
  NoteRenderResult,
  NoteMergeRequest,
  NoteMergeResult,
  NoteRelateRequest,
  NoteRelateResult,
  NoteTrashCurrentRequest,
  NoteTrashCurrentResult,
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult,
  OnboardingStatus,
  ProposalReviewDecisionRequest,
  ProposalReviewDecisionResult,
  ProposalReviewPreview,
  ProposalReviewRequest,
  ProposalReviewResult,
  ReaderSelectionCreateNoteRequest,
  ReaderSelectionCreateNoteResult,
  ReaderSelectionActionRequest,
  ReaderSelectionTransformRequest,
  ReaderSelectionTransformResult,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalDecisionResult,
  ReaderSelectionProposalPreview,
  ReaderSelectionResolveRequest,
  ReferencedOriginalReconnectRequest,
  ReferencedOriginalReconnectResult,
  SpeechAvailabilityRequest,
  SpeechAvailabilityResult,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  SpeechCancelRequest,
  SpeechSessionEvent,
  SpeechSessionRequest,
  SetThemeRequest,
  SpeechStartRequest,
  SpeechStartResult,
  SpeechStopResult,
  WindowLayoutRequest,
  WindowLayoutState,
  WindowState
} from "@pige/contracts";
import type {
  CollectionOpenCitationRequest,
  CollectionOpenCitationResult
} from "@pige/schemas";
import deMessages from "../../apps/desktop/src/renderer/src/locales/de/messages.json";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";
import frMessages from "../../apps/desktop/src/renderer/src/locales/fr/messages.json";
import jaMessages from "../../apps/desktop/src/renderer/src/locales/ja/messages.json";
import koMessages from "../../apps/desktop/src/renderer/src/locales/ko/messages.json";
import zhHansMessages from "../../apps/desktop/src/renderer/src/locales/zh-Hans/messages.json";
import {
  HOME_ACCEPTED_TURN_MAX_REFRESHES,
  HOME_ACCEPTED_TURN_MAX_TERMINAL_REFRESHES,
  homeAcceptedTurnProjectionExhausted,
  homeAcceptedTurnProjectionStatus,
  selectCurrentNoSourceTurn,
  terminalTurnOwnsComposerSubmission
} from "../../apps/desktop/src/renderer/src/components/HomeConversationTurnState";
import { HomeJobAction } from "../../apps/desktop/src/renderer/src/components/HomeJobAction";

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
  it("applies the one-shot startup destination only after restoring an active vault", async () => {
    const libraryDom = createDom();
    const libraryHarness = createHarness(undefined);
    libraryHarness.startupDestination = "library";
    const libraryMount = await mountHome(libraryDom, makePigeApi(libraryHarness));
    await waitFor(libraryDom, () => libraryMount.container.querySelector(".library-page") !== null);
    expect(libraryMount.container.querySelector(".home")).toBeNull();
    await act(async () => libraryMount.root.unmount());
    libraryDom.window.close();

    const failedDom = createDom();
    const failedHarness = createHarness(undefined);
    failedHarness.startupDestination = "failed";
    const failedMount = await mountHome(failedDom, makePigeApi(failedHarness));
    await waitFor(failedDom, () => failedMount.container.querySelector(".home") !== null);
    expect(failedMount.container.querySelector(".library-page")).toBeNull();
    await act(async () => failedMount.root.unmount());
    failedDom.window.close();
  });

  it("keeps a waiting dependency repair single-flight and restores focus after failure or disappearance", async () => {
    const dom = createDom();
    const { createRoot } = await import("react-dom/client");
    const container = requireElement(dom.window.document.getElementById("root"));
    const fallback = dom.window.document.createElement("button");
    fallback.textContent = "Processing";
    dom.window.document.body.append(fallback);
    const returnFocusRef = { current: fallback };
    const root = createRoot(container);
    let calls = 0;
    let rejectAttempt: ((reason: Error) => void) | undefined;
    let resolveAttempt: (() => void) | undefined;
    const onActivate = (): Promise<void> => {
      calls += 1;
      return new Promise<void>((resolve, reject) => {
        resolveAttempt = resolve;
        rejectAttempt = reject;
      });
    };
    const renderRepair = (): void => root.render(createElement(HomeJobAction, {
      job: sourceWaitingForModelJob(),
      sourceWaitingForModel: false,
      ownsSourceModelAction: false,
      repair: {
        label: "Reconnect source",
        pendingLabel: "Checking source…",
        onActivate,
        returnFocusRef
      },
      onOpenModels: () => undefined,
      onCancelJob: () => undefined,
      onRetryJob: () => undefined,
      t: (key: string) => key
    }));
    await act(async () => {
      renderRepair();
      await settle(dom);
    });
    const repair = buttons(container, "Reconnect source")[0]!;
    await act(async () => {
      repair.click();
      repair.click();
      await settle(dom);
    });
    expect(calls).toBe(1);
    expect(repair.disabled).toBe(true);
    expect(container.textContent).toContain("Checking source…");
    await act(async () => {
      rejectAttempt?.(new Error("body-free failure"));
      await settle(dom);
    });
    expect(repair.disabled).toBe(false);
    await waitFor(dom, () => dom.window.document.activeElement === repair);

    await act(async () => {
      repair.click();
      await settle(dom);
      root.render(createElement("span", null, "Repaired"));
      resolveAttempt?.();
      await settle(dom);
    });
    expect(calls).toBe(2);
    await waitFor(dom, () => dom.window.document.activeElement === fallback);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reconnects the exact referenced original Job and resumes through Home refresh only", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const waitingJob = referencedOriginalWaitingJob();
    harness.jobs = [waitingJob];
    let mode: "failed" | "cancelled" | "reconnected" = "failed";
    harness.reconnectOriginalSource = async (request) => {
      harness.reconnectOriginalSourceRequests.push(request);
      if (mode !== "reconnected") return { ...request, status: mode };
      const reconnectedJob = { ...waitingJob, state: "queued" as const, canReconnectDependency: false as const,
        updatedAt: "2026-07-29T09:00:02.000Z" };
      harness.jobs = [reconnectedJob];
      return { ...request, status: "reconnected", job: reconnectedJob };
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttons(container, "Reconnect original file").length === 1);
    const repair = buttons(container, "Reconnect original file")[0]!;
    await act(async () => {
      repair.click();
      repair.click();
      await settle(dom);
    });
    expect(harness.reconnectOriginalSourceRequests).toHaveLength(1);
    expect(harness.reconnectOriginalSourceRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_home_conversation",
      waitingJobId: waitingJob.id,
      expectedJobUpdatedAt: waitingJob.updatedAt
    });
    expect(harness.retryJobIds).toHaveLength(0);
    expect(buttons(container, "Reconnect original file")).toHaveLength(1);
    expect(container.textContent).toContain("Pige could not reconnect this original file. Choose the file again.");

    mode = "cancelled";
    await clickButton(dom, container, "Reconnect original file");
    await waitFor(dom, () => harness.reconnectOriginalSourceRequests.length === 2);
    expect(container.textContent).not.toContain("Pige could not reconnect this original file. Choose the file again.");
    expect(buttons(container, "Reconnect original file")).toHaveLength(1);

    mode = "reconnected";
    await clickButton(dom, container, "Reconnect original file");
    await waitFor(dom, () => harness.reconnectOriginalSourceRequests.length === 3);
    await waitFor(dom, () => buttons(container, "Reconnect original file").length === 0);
    expect(container.textContent).toContain("Original file reconnected. Processing is continuing.");
    expect(harness.retryJobIds).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("does not offer referenced-source repair for a non-Agent Job even if eligibility is misprojected", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.jobs = [{
      ...referencedOriginalWaitingJob(),
      class: "backup",
      canReconnectDependency: true
    }];
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => container.textContent?.includes(enMessages["home.processing"]) === true);
    expect(buttons(container, "Reconnect original file")).toHaveLength(0);
    expect(harness.reconnectOriginalSourceRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reviews and decides the exact durable Home proposal without exposing private proposal data", async () => {
    const dom = createDom();
    const proposalId = "proposal_20260729_aaaaaaaa";
    const jobId = "job_20260729_proposalreview";
    const timeline = {
      ...completedTimeline(),
      latestTurn: {
        jobId,
        userEventId: "event_20260729_proposaluser",
        state: "awaiting_review" as const,
        proposalId
      }
    };
    const harness = createHarness(timeline);
    harness.jobs = [{
      id: jobId,
      class: "agent_turn",
      state: "awaiting_review",
      canReconnectDependency: false,
      message: "Review required",
      createdAt: "2026-07-29T08:00:00.000Z",
      updatedAt: "2026-07-29T08:00:01.000Z"
    }];
    harness.proposalPreview = {
      proposalId,
      jobId,
      revision: "2026-07-29T08:00:01.000Z",
      state: "ready",
      trustLevel: "review_required",
      summary: "Create a concise project note",
      reason: "The requested knowledge change needs confirmation.",
      operationKinds: ["create", "update"],
      warnings: ["Existing content remains recoverable."]
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await waitFor(dom, () => buttons(container, enMessages["proposal.review"]).length === 1);
    const trigger = buttons(container, enMessages["proposal.review"])[0]!;
    await clickButton(dom, container, enMessages["proposal.review"]);
    await waitFor(dom, () => container.textContent?.includes(harness.proposalPreview!.summary) === true);
    expect(harness.proposalReviewRequests).toHaveLength(1);
    expect(harness.proposalReviewRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_home_conversation",
      jobId,
      proposalId
    });
    expect(container.textContent).not.toContain(proposalId);
    expect(container.textContent).not.toContain(jobId);
    expect(container.textContent).toContain(enMessages["proposal.operation.create"]);
    expect(container.textContent).toContain(enMessages["proposal.operation.update"]);

    harness.proposalDecisionMode = "stale";
    await clickButton(dom, container, enMessages["proposal.approve"]);
    await waitFor(dom, () => container.textContent?.includes(enMessages["note.proposal.stale"]) === true);
    expect(container.textContent).toContain(harness.proposalPreview.summary);
    expect(harness.proposalDecisionRequests).toHaveLength(1);
    expect(harness.proposalDecisionRequests[0]).toMatchObject({
      activeVaultId: "vault_home_conversation",
      jobId,
      proposalId,
      expectedRevision: harness.proposalPreview.revision,
      decision: "approve"
    });

    harness.proposalDecisionMode = "applied";
    await clickButton(dom, container, enMessages["proposal.approve"]);
    await waitFor(dom, () => container.querySelector(".proposal-review-panel") === null);
    expect(harness.proposalDecisionRequests).toHaveLength(2);
    await waitFor(dom, () => dom.window.document.activeElement === trigger);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("reviews a Reader create-note selection, retains it on reject or stale, and opens only the created note", async () => {
    const dom = createDom(1200);
    const harness = createHarness(undefined);
    harness.sidebarOpen = true;
    harness.windowMode = "expanded";
    harness.windowLayoutWidth = 1200;
    harness.startupDestination = "failed";
    const renderNote = harness.renderNote;
    harness.renderNote = async (pageId) => {
      const note = await renderNote(pageId);
      return pageId === "page_20260715_note0001"
        ? { ...note, html: '<p><span data-pige-selection-segment="readerseg_aaaaaaaaaaaaaaaa">Approved reader fixture.</span></p>' }
        : note;
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);
    await openLibraryNote(dom, container, "Note A");
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    Object.defineProperty(dom.window, "getSelection", { configurable: true, value: () => ({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: selectionNode,
      anchorOffset: 0,
      focusNode: selectionNode,
      focusOffset: 8,
      toString: () => "private selected body",
      getRangeAt: () => ({
        commonAncestorContainer: paragraph,
        startContainer: selectionNode,
        startOffset: 0,
        endContainer: selectionNode,
        endOffset: 8,
        getBoundingClientRect: () => ({ left: 80, top: 90, width: 120, height: 18, right: 200, bottom: 108 })
      })
    }) });
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-selection-action="more"]') !== null);
    await clickElement(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]')));
    const createNote = requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="createNote"]'));
    await clickElement(dom, createNote);
    await waitFor(dom, () => harness.readerCreateNoteRequests.length === 1);
    await waitFor(dom, () => buttons(container, enMessages["note.proposal.reject"]).length === 1);
    expect(harness.readerCreateNoteRequests[0]).toMatchObject({
      action: "create_note",
      activeVaultId: "vault_home_conversation",
      renderContextId: `notectx_${"a".repeat(32)}`,
      selection: { pageId: "page_20260715_note0001" }
    });
    expect(JSON.stringify(harness.readerCreateNoteRequests[0])).not.toContain("private selected body");

    harness.readerProposalDecisionMode = "rejected";
    await clickButton(dom, container, enMessages["note.proposal.reject"]);
    await waitFor(dom, () => harness.readerProposalDecisionRequests.length === 1);
    expect(container.querySelector('[data-selection-more-action="createNote"]')).not.toBeNull();
    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note A");

    await clickElement(dom, createNote);
    await waitFor(dom, () => harness.readerCreateNoteRequests.length === 2);
    harness.readerProposalDecisionMode = "stale";
    await clickButton(dom, container, enMessages["note.proposal.apply"]);
    await waitFor(dom, () => container.textContent?.includes(enMessages["note.proposal.stale"]) === true);
    expect(container.querySelector('[data-selection-more-action="createNote"]')).not.toBeNull();
    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note A");

    harness.readerProposalDecisionMode = "applied";
    await clickButton(dom, container, enMessages["note.proposal.apply"]);
    await waitFor(dom, () => container.querySelector(".note-reader h1")?.textContent === "Note B");
    expect(harness.readerProposalDecisionRequests).toHaveLength(3);
    expect(harness.noteRenderRequests).toEqual(["page_20260715_note0001", "page_20260715_note0002"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("asks about an exact Reader selection and opens the existing Note Agent conversation owner", async () => {
    const dom = createDom(1200);
    const harness = createHarness(undefined);
    harness.sidebarOpen = true;
    harness.windowMode = "expanded";
    harness.windowLayoutWidth = 1200;
    const renderNote = harness.renderNote;
    harness.renderNote = async (pageId) => {
      const note = await renderNote(pageId);
      return pageId === "page_20260715_note0001"
        ? { ...note, html: '<p><span data-pige-selection-segment="readerseg_aaaaaaaaaaaaaaaa">Reader Ask fixture.</span></p>' }
        : note;
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => container.querySelector(".library-sidebar-tree .library-tree-disclosure") !== null);
    await openLibraryNote(dom, container, "Note A");
    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    Object.defineProperty(dom.window, "getSelection", { configurable: true, value: () => ({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: selectionNode,
      anchorOffset: 0,
      focusNode: selectionNode,
      focusOffset: 8,
      toString: () => "private selected body",
      getRangeAt: () => ({
        commonAncestorContainer: paragraph,
        startContainer: selectionNode,
        startOffset: 0,
        endContainer: selectionNode,
        endOffset: 8,
        getBoundingClientRect: () => ({ left: 80, top: 90, width: 120, height: 18, right: 200, bottom: 108 })
      })
    }) });
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-selection-action="more"]') !== null);
    await clickElement(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]')));
    await clickElement(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="ask"]')));
    const question = requireElement(container.querySelector<HTMLInputElement>("#reader-selection-ask-question"));
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(question, "  Why is this important?  ");
      question.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await settle(dom);
    });
    await clickButton(dom, container, enMessages["note.selection.askSubmit"]);
    await waitFor(dom, () => harness.readerSelectionActionRequests.length === 1);
    expect(harness.readerSelectionActionRequests[0]).toMatchObject({
      action: "ask",
      question: "Why is this important?",
      selection: { pageId: "page_20260715_note0001" }
    });
    expect(JSON.stringify(harness.readerSelectionActionRequests[0])).not.toContain("private selected body");
    await waitFor(dom, () => container.querySelector(".note-agent") !== null);
    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note A");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fences and bounds the exact accepted picker turn projection", () => {
    const timeline = completedTimeline();
    const binding = {
      activeVaultId: "vault_home_conversation",
      clientTurnId: "client_turn_projection",
      conversationId: timeline.conversationId,
      conversationEventId: "event_20260726_picker_user",
      jobId: "job_20260726_picker"
    } as const;
    const waiting = {
      ...timeline,
      tailEventId: binding.conversationEventId,
      canFollowUp: false,
      messages: [...timeline.messages, {
        id: binding.conversationEventId,
        role: "user" as const,
        createdAt: "2026-07-26T08:00:00.000Z",
        text: "Inspect the PDF."
      }],
      latestTurn: {
        jobId: binding.jobId,
        userEventId: binding.conversationEventId,
        state: "completed" as const
      }
    };

    expect(homeAcceptedTurnProjectionStatus({
      binding,
      activeVaultId: binding.activeVaultId,
      timeline: waiting
    })).toBe("waiting_terminal_event");
    expect(homeAcceptedTurnProjectionStatus({
      binding,
      activeVaultId: "vault_changed",
      timeline: waiting
    })).toBe("identity_changed");
    expect(homeAcceptedTurnProjectionStatus({
      binding,
      activeVaultId: binding.activeVaultId,
      timeline: { ...waiting, conversationId: "conv_changed" }
    })).toBe("identity_changed");
    expect(homeAcceptedTurnProjectionStatus({
      binding,
      activeVaultId: binding.activeVaultId,
      timeline: {
        ...waiting,
        latestTurn: { ...waiting.latestTurn, state: "failed_final" }
      }
    })).toBe("failed");
    expect(homeAcceptedTurnProjectionStatus({
      binding,
      activeVaultId: binding.activeVaultId,
      timeline: {
        ...waiting,
        latestTurn: { ...waiting.latestTurn, state: "waiting_dependency" }
      }
    })).toBe("paused");
    expect(homeAcceptedTurnProjectionStatus({
      binding,
      activeVaultId: binding.activeVaultId,
      timeline: {
        ...waiting,
        tailEventId: "event_20260726_picker_assistant",
        canFollowUp: true,
        messages: [...waiting.messages, {
          id: "event_20260726_picker_assistant",
          role: "assistant",
          createdAt: "2026-07-26T08:00:01.000Z",
          text: "The durable answer.",
          jobId: binding.jobId
        }]
      }
    })).toBe("converged");
    expect(homeAcceptedTurnProjectionExhausted({
      status: "waiting",
      refreshCount: HOME_ACCEPTED_TURN_MAX_REFRESHES,
      terminalRefreshCount: 0
    })).toBe(true);
    expect(homeAcceptedTurnProjectionExhausted({
      status: "waiting_terminal_event",
      refreshCount: 1,
      terminalRefreshCount: HOME_ACCEPTED_TURN_MAX_TERMINAL_REFRESHES
    })).toBe(true);
  });

  it("lets a terminal timeline supersede only its stale same-Job running projection", () => {
    const timeline = completedTimeline();
    const staleJob = { ...runningAgentJob(), id: timeline.latestTurn!.jobId };
    expect(selectCurrentNoSourceTurn({
      latestTurn: timeline.latestTurn,
      recentJobs: [staleJob],
      activeDraftJobId: staleJob.id
    }))
      .toBeUndefined();

    const currentJob = { ...runningAgentJob(), id: "job_20260726_currentdraft" };
    expect(selectCurrentNoSourceTurn({
      latestTurn: timeline.latestTurn,
      recentJobs: [staleJob, currentJob],
      activeDraftJobId: currentJob.id
    })).toBe(currentJob);
  });

  it("releases a composer submission only for its exact durable terminal turn", () => {
    const timeline = completedTimeline();
    const latestTurn = timeline.latestTurn!;
    const input = {
      conversationId: timeline.conversationId,
      latestTurn,
      activeDraft: {
        clientTurnId: "client_turn_exact",
        conversationId: timeline.conversationId,
        jobId: latestTurn.jobId
      },
      submission: { vaultId: "vault_exact", clientTurnId: "client_turn_exact" },
      activeVaultId: "vault_exact"
    } as const;

    expect(terminalTurnOwnsComposerSubmission(input)).toBe(true);
    expect(terminalTurnOwnsComposerSubmission({ ...input, activeVaultId: "vault_other" })).toBe(false);
    expect(terminalTurnOwnsComposerSubmission({
      ...input,
      activeDraft: { ...input.activeDraft, jobId: "job_other" }
    })).toBe(false);
    expect(terminalTurnOwnsComposerSubmission({
      ...input,
      activeDraft: { ...input.activeDraft, conversationId: "conversation_other" }
    })).toBe(false);
    expect(terminalTurnOwnsComposerSubmission({
      ...input,
      submission: { ...input.submission, clientTurnId: "client_turn_other" }
    })).toBe(false);
  });

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
    let resolveAppearance: ((appearance: AppearanceSettingsSummary) => void) | undefined;
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
      resolveAppearance?.(testAppearanceSummary("en"));
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

  it("binds Appearance theme changes to the exact revision and ignores stale effective-theme events", async () => {
    const dom = createDom(960);
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await openSettingsSection(dom, container, enMessages["settings.section.appearance"]);
    const radios = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.theme-option[role="radio"]'));
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    await clickElement(dom, radios()[2]!);

    expect(harness.appearanceThemeRequests).toEqual([{ themePreference: "dark", expectedRevision: 0 }]);
    expect(dom.window.document.documentElement.dataset.theme).toBe("dark");
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);

    await act(async () => {
      for (const listener of harness.appearanceListeners) listener({
        ...testAppearanceSummary("en"), themePreference: "light", revision: 0
      });
      await settle(dom);
    });
    expect(dom.window.document.documentElement.dataset.theme).toBe("dark");

    await act(async () => {
      for (const listener of harness.appearanceListeners) listener({
        ...testAppearanceSummary("en"), themePreference: "light", revision: 2
      });
      await settle(dom);
    });
    expect(dom.window.document.documentElement.dataset.theme).toBe("light");
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);

    await act(async () => root.unmount());
    expect(dom.window.document.documentElement.hasAttribute("data-theme")).toBe(false);
    dom.window.close();
  });

  it("keeps the authoritative theme and reports both stale and failed mutations locally", async () => {
    for (const status of ["stale", "failed"] as const) {
      const dom = createDom(960);
      const harness = createHarness(undefined);
      harness.appearanceThemeMutationStatus = status;
      const { container, root } = await mountHome(dom, makePigeApi(harness));

      await openSettingsSection(dom, container, enMessages["settings.section.appearance"]);
      const radios = Array.from(container.querySelectorAll<HTMLButtonElement>('.theme-option[role="radio"]'));
      await clickElement(dom, radios[2]!);

      await waitFor(dom, () => container.textContent?.includes(enMessages["appearance.themeUpdateFailed"]) === true);
      expect(harness.appearanceThemeRequests).toEqual([{ themePreference: "dark", expectedRevision: 0 }]);
      expect(dom.window.document.documentElement.dataset.theme).toBe("light");
      expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
      expect(container.querySelector(".appearance-settings-page")).not.toBeNull();

      await act(async () => root.unmount());
      dom.window.close();
    }
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

  it("runs Home Reader transforms through the shared applied and proposal owners", async () => {
    const dom = createDom(1200);
    const harness = createHarness(undefined);
    harness.sidebarOpen = true;
    harness.windowMode = "expanded";
    harness.windowLayoutWidth = 1200;
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      return retrievalCompletedResult();
    };
    harness.readerSelectionTransform = async (request) => request.action === "translate"
      ? {
          apiVersion: 1,
          requestId: request.requestId,
          status: "applied",
          jobId: "job_20260730_transform01",
          conversationEventId: "evt_20260730_transform01",
          conversationId: "conv_20260730_transform01",
          tailEventId: "evt_20260730_transform02",
          operationId: "operation_20260730_transform01"
        }
      : request.action === "polish"
        ? {
            apiVersion: 1,
            requestId: request.requestId,
            status: "review_required",
            jobId: "job_20260730_transform02",
            conversationEventId: "evt_20260730_transform03",
            conversationId: "conv_20260730_transform02",
            tailEventId: "evt_20260730_transform04",
            proposal: {
              proposalId: "proposal_20260730_transform02",
              action: "polish",
              state: "ready",
              revision: 1,
              lines: [{ kind: "added", text: "Reviewed replacement" }]
            }
          }
        : {
            apiVersion: 1,
            requestId: request.requestId,
            status: "invalid",
            reason: "selection_changed"
          };
    const renderNote = harness.renderNote;
    harness.renderNote = async (pageId) => ({
      ...await renderNote(pageId),
      html: '<p><span data-pige-selection-segment="readerseg_aaaaaaaaaaaaaaaa">Home transform fixture.</span></p>'
    });
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await setTextareaValue(dom, container, "Find the Home transform fixture.");
    await clickButtonByAriaLabel(dom, container, "Send");
    await waitFor(dom, () => container.textContent?.includes("Local Reader result") === true);
    await clickElement(dom, buttons(container, "Open")[0]!);
    await waitFor(dom, () => container.querySelector(".note-reader h1")?.textContent === "Note A");

    let collapsed = false;
    let selectionNode: Node | null = null;
    let paragraph: Element | null = null;
    Object.defineProperty(dom.window, "getSelection", { configurable: true, value: () => ({
      isCollapsed: collapsed,
      rangeCount: collapsed ? 0 : 1,
      anchorNode: selectionNode,
      anchorOffset: 0,
      focusNode: selectionNode,
      focusOffset: 8,
      toString: () => "private selected body",
      getRangeAt: () => ({
        commonAncestorContainer: paragraph,
        startContainer: selectionNode,
        startOffset: 0,
        endContainer: selectionNode,
        endOffset: 8,
        getBoundingClientRect: () => ({ left: 80, top: 90, width: 120, height: 18, right: 200, bottom: 108 })
      })
    }) });
    const showSelection = async (): Promise<void> => {
      paragraph = requireElement(container.querySelector(".markdown-body p"));
      selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
      await act(async () => {
        collapsed = true;
        dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
        collapsed = false;
        dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
        await settle(dom);
      });
      await waitFor(dom, () => container.querySelector('[data-selection-action="more"]') !== null);
    };
    const runTransform = async (action: "translate" | "polish" | "expand"): Promise<void> => {
      await showSelection();
      await clickElement(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]')));
      await clickElement(dom, requireElement(container.querySelector<HTMLButtonElement>(`[data-selection-more-action="${action}"]`)));
      await waitFor(dom, () => harness.readerSelectionTransformRequests.some((request) => request.action === action));
    };

    await runTransform("translate");
    await waitFor(dom, () => harness.noteRenderRequests.length === 2);
    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note A");
    expect(harness.readerSelectionTransformRequests[0]).toMatchObject({
      action: "translate",
      locale: "en",
      selection: { pageId: "page_20260715_note0001" }
    });
    expect(JSON.stringify(harness.readerSelectionTransformRequests[0])).not.toContain("private selected body");

    await runTransform("polish");
    await waitFor(dom, () => harness.windowLayoutRequests.some((request) => (
      request.surface === "reader" && request.noteAgentOpen
    )));
    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note A");

    await runTransform("expand");
    await waitFor(dom, () => dom.window.document.activeElement === container.querySelector(".note-reader"));
    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note A");
    expect(harness.readerSelectionTransformRequests.map((request) => request.action)).toEqual([
      "translate", "polish", "expand"
    ]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("refreshes the authoritative Home Reader after an applied current-note replacement", async () => {
    const dom = createDom(1200);
    const harness = createHarness(completedGroundedTimeline());
    harness.sidebarOpen = true;
    harness.windowMode = "expanded";
    harness.windowLayoutWidth = 1200;
    harness.startupDestination = "failed";
    const pageId = "page_20260715_note0001";
    const jobId = "job_20260730_homereplace";
    const proposalId = "proposal_20260730_homereplace";
    let renderCount = 0;
    harness.renderNote = async (requestedPageId) => {
      renderCount += 1;
      return {
        ...testRenderedNote(requestedPageId),
        html: `<p><span data-pige-selection-segment="readerseg_aaaaaaaaaaaaaaaa">Home replacement ${renderCount}.</span></p>`
      };
    };
    const homeTimeline = harness.timeline;
    let currentNoteReads = 0;
    let replaceApplied = false;
    harness.loadConversation = async (request) => {
      harness.conversationRequests.push(request);
      if (request.scope?.kind !== "current_note") return homeTimeline;
      currentNoteReads += 1;
      return !replaceApplied
        ? {
            kind: "initial",
            conversationId: "conv_20260730_homereplace",
            snapshotTailEventId: "evt_20260730_homereplace_user",
            tailEventId: "evt_20260730_homereplace_user",
            canFollowUp: false,
            messages: [{
              id: "evt_20260730_homereplace_user",
              role: "user",
              createdAt: "2026-07-30T08:00:00.000Z",
              text: "Replace this note.",
              jobId
            }],
            latestTurn: {
              jobId,
              userEventId: "evt_20260730_homereplace_user",
              state: "awaiting_review",
              proposalId,
              error: {
                code: "agent_runtime.review_required",
                domain: "agent_runtime",
                messageKey: "errors.agent_runtime.review_required",
                retryable: false,
                severity: "warning",
                userAction: "review_proposal"
              }
            }
          }
        : {
            kind: "initial",
            conversationId: "conv_20260730_homereplace",
            snapshotTailEventId: "evt_20260730_homereplace_assistant",
            tailEventId: "evt_20260730_homereplace_assistant",
            canFollowUp: true,
            messages: [{
              id: "evt_20260730_homereplace_assistant",
              role: "assistant",
              createdAt: "2026-07-30T08:00:01.000Z",
              text: "Replacement applied."
            }],
            latestTurn: {
              jobId,
              userEventId: "evt_20260730_homereplace_user",
              state: "completed"
            }
          };
    };
    harness.readerSelectionTransform = async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "waiting",
      jobId,
      conversationEventId: "evt_20260730_homereplace_user",
      conversationId: "conv_20260730_homereplace",
      tailEventId: "evt_20260730_homereplace_user",
      error: {
        code: "agent_runtime.review_required",
        domain: "agent_runtime",
        messageKey: "errors.agent_runtime.review_required",
        retryable: false,
        severity: "warning",
        userAction: "review_proposal"
      }
    });
    harness.currentNoteReplaceProposal = async (request) => ({
      apiVersion: 1,
      status: "available",
      proposal: {
        proposalId: request.proposalId,
        kind: "replace_current_note",
        state: "ready",
        revision: 1,
        activeVaultId: request.activeVaultId,
        jobId: request.jobId,
        lines: [
          { kind: "removed", text: "Home replacement 1." },
          { kind: "added", text: "Home replacement 2." }
        ]
      }
    });
    harness.decideCurrentNoteReplaceProposal = async (request) => {
      replaceApplied = true;
      return {
        apiVersion: 1,
        status: "applied",
        proposal: {
          proposalId: request.proposalId,
          kind: "replace_current_note",
          state: "applied",
          revision: request.expectedRevision,
          activeVaultId: request.activeVaultId,
          jobId: request.jobId,
          lines: [{ kind: "added", text: "Home replacement 2." }]
        },
        operationId: "operation_20260730_homereplace"
      };
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await clickElement(dom, requireElement(container.querySelector<HTMLButtonElement>(".conversation-citations .citation-row")));
    await waitFor(dom, () => container.querySelector(".note-reader h1")?.textContent === "Note A");

    const paragraph = requireElement(container.querySelector(".markdown-body p"));
    const selectionNode = requireElement(paragraph.querySelector("[data-pige-selection-segment]")).firstChild!;
    Object.defineProperty(dom.window, "getSelection", { configurable: true, value: () => ({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: selectionNode,
      anchorOffset: 0,
      focusNode: selectionNode,
      focusOffset: 8,
      toString: () => "private selected body",
      getRangeAt: () => ({
        commonAncestorContainer: paragraph,
        startContainer: selectionNode,
        startOffset: 0,
        endContainer: selectionNode,
        endOffset: 8,
        getBoundingClientRect: () => ({ left: 80, top: 90, width: 120, height: 18, right: 200, bottom: 108 })
      })
    }) });
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[data-selection-action="more"]') !== null);
    await clickElement(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-selection-action="more"]')));
    await clickElement(dom, requireElement(container.querySelector<HTMLButtonElement>('[data-selection-more-action="polish"]')));
    await waitFor(dom, () => currentNoteReads === 1);
    await waitFor(dom, () => container.textContent?.includes(enMessages["note.proposal.action.replace_current_note"]) === true);

    await clickButton(dom, container, enMessages["note.proposal.apply"]);
    await waitFor(dom, () => renderCount === 2);
    expect(container.querySelector(".markdown-body")?.textContent).toContain("Home replacement 2.");
    expect(harness.currentNoteReplaceProposalRequests).toEqual([{
      apiVersion: 1,
      activeVaultId: "vault_home_conversation",
      jobId,
      proposalId
    }]);
    expect(harness.currentNoteReplaceDecisionRequests[0]).toMatchObject({
      activeVaultId: "vault_home_conversation",
      jobId,
      proposalId,
      expectedRevision: 1,
      decision: "approve"
    });
    expect(harness.noteRenderRequests).toEqual([pageId, pageId]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("opens a saved source from the Home Reader and keeps closed results on the current page", async () => {
    const dom = createDom(720);
    const harness = createHarness(undefined);
    const sourceId = "src_20260715_source001";
    let sourceStatus: "not_found" | "resolved" = "not_found";
    let reconnectStatus: "stale" | "reconnected" = "stale";
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      return retrievalCompletedResult();
    };
    harness.renderNote = async (pageId) => {
      const note = testRenderedNote(pageId);
      return pageId.endsWith("1")
        ? {
            ...note,
            summary: { ...note.summary, sourceIds: [sourceId] },
            reconnectOriginalSourceIds: [sourceId]
          }
        : note;
    };
    harness.reconnectReaderOriginalSource = async (request) => reconnectStatus === "stale"
      ? { ...request, status: "stale" }
      : {
          ...request,
          status: "reconnected",
          render: {
            ...testRenderedNote(request.currentPageId),
            summary: {
              ...testRenderedNote(request.currentPageId).summary,
              sourceIds: [sourceId]
            },
            html: "<p>Reconnected source body.</p>",
            renderContextId: `notectx_${"b".repeat(32)}`,
            reconnectOriginalSourceIds: []
          }
        };
    harness.openSourceReference = async (request) => sourceStatus === "resolved"
      ? {
          apiVersion: 1,
          requestId: request.requestId,
          status: "resolved",
          target: { pageId: "page_20260715_note0002" }
        }
      : { apiVersion: 1, requestId: request.requestId, status: "not_found" };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await setTextareaValue(dom, container, "Open the approved Reader fixture.");
    await clickButtonByAriaLabel(dom, container, "Send");
    await waitFor(dom, () => container.textContent?.includes("Local Reader result") === true);
    await clickElement(dom, buttons(container, "Open")[0]!);
    await waitFor(dom, () => container.querySelector(".note-reader h1")?.textContent === "Note A");

    const reveal = requireElement(container.querySelector<HTMLButtonElement>(`[data-reader-source-reveal="${sourceId}"]`));
    await clickElement(dom, reveal);
    await waitFor(dom, () => container.textContent?.includes("Original opened.") === true);
    expect(harness.sourceRevealRequests).toHaveLength(1);
    expect(harness.sourceRevealRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_home_conversation",
      currentPageId: "page_20260715_note0001",
      renderContextId: `notectx_${"a".repeat(32)}`,
      sourceId
    });
    expect(Object.keys(harness.sourceRevealRequests[0]!).sort()).toEqual([
      "activeVaultId",
      "apiVersion",
      "currentPageId",
      "renderContextId",
      "requestId",
      "sourceId"
    ]);
    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note A");

    const reconnect = requireElement(container.querySelector<HTMLButtonElement>(
      `[data-reader-source-reconnect="${sourceId}"]`
    ));
    reconnect.focus();
    await clickElement(dom, reconnect);
    await waitFor(dom, () => harness.readerSourceReconnectRequests.length === 1);
    expect(harness.readerSourceReconnectRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_home_conversation",
      currentPageId: "page_20260715_note0001",
      renderContextId: `notectx_${"a".repeat(32)}`,
      sourceId
    });
    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note A");
    expect(container.textContent).toContain("This source changed. Review it and try again.");
    expect(dom.window.document.activeElement).toBe(reconnect);

    reconnectStatus = "reconnected";
    await clickElement(dom, reconnect);
    await waitFor(dom, () => container.textContent?.includes("Reconnected source body.") === true);
    expect(harness.readerSourceReconnectRequests).toHaveLength(2);
    expect(container.querySelector(`[data-reader-source-reconnect="${sourceId}"]`)).toBeNull();
    await waitFor(dom, () => dom.window.document.activeElement?.getAttribute("data-reader-source-open") === sourceId);

    const source = requireElement(container.querySelector<HTMLButtonElement>(".reader-source"));
    await clickElement(dom, source);
    await waitFor(dom, () => container.textContent?.includes("The linked local item could not be found.") === true);
    expect(container.querySelector(".note-reader h1")?.textContent).toBe("Note A");
    expect(source.disabled).toBe(false);

    sourceStatus = "resolved";
    await clickElement(dom, source);
    await waitFor(dom, () => container.querySelector(".note-reader h1")?.textContent === "Note B");
    expect(harness.sourceReferenceRequests).toHaveLength(2);
    expect(harness.sourceReferenceRequests[0]).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_home_conversation",
      currentPageId: "page_20260715_note0001",
      renderContextId: `notectx_${"b".repeat(32)}`,
      sourceId
    });
    expect(harness.noteRenderRequests).toEqual([
      "page_20260715_note0001",
      "page_20260715_note0002"
    ]);
    expect(container.textContent).not.toContain(sourceId);

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

  it("places the persistent compact and expanded window switch immediately before Pin", async () => {
    const dom = createDom(420);
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    const expandedButton = buttonsByAriaLabel(container, "Switch to wide layout")[0]!;
    const pinButton = buttonsByAriaLabel(container, "Pin on top")[0]!;
    expect(expandedButton.compareDocumentPosition(pinButton) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    await clickElement(dom, expandedButton);
    await waitFor(dom, () => container.querySelector('.shell.mode-expanded') !== null);
    expect(harness.windowModeRequests).toEqual(["expanded"]);
    await clickButtonByAriaLabel(dom, container, "Switch to compact layout");
    await waitFor(dom, () => container.querySelector('.shell.mode-compact') !== null);
    expect(harness.windowModeRequests).toEqual(["expanded", "compact"]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("uses the wide layout on first paint while window truth is still loading", async () => {
    const dom = createDom(960);
    const harness = createHarness(undefined);
    harness.windowMode = "expanded";
    let resolveWindowState: ((state: WindowState) => void) | undefined;
    const api = makePigeApi(harness) as ReturnType<typeof makePigeApi> & {
      window: { current: () => Promise<WindowState> };
    };
    api.window.current = () => new Promise((resolve) => { resolveWindowState = resolve; });
    const { container, root } = await mountHome(dom, api);

    expect(container.querySelector(".shell.mode-expanded")).not.toBeNull();
    expect(container.querySelector(".shell.mode-compact")).toBeNull();
    const modeToggle = buttonsByAriaLabel(container, "Switch to compact layout")[0]!;
    expect(modeToggle.disabled).toBe(true);
    const pinToggle = buttonsByAriaLabel(container, "Pin on top")[0]!;
    expect(pinToggle.disabled).toBe(true);

    await act(async () => {
      resolveWindowState?.(windowState(harness));
      await settle(dom);
    });
    await waitFor(dom, () => modeToggle.disabled === false);
    await waitFor(dom, () => pinToggle.disabled === false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("exposes mode-switch progress and keeps failures body-free", async () => {
    const dom = createDom(960);
    const harness = createHarness(undefined);
    harness.windowMode = "expanded";
    let modeRequests = 0;
    let pinRequests = 0;
    let resolveModeWrite: ((state: WindowState) => void) | undefined;
    const api = makePigeApi(harness) as ReturnType<typeof makePigeApi> & {
      window: {
        setMode: (request: { readonly mode: "compact" | "expanded" }) => Promise<WindowState>;
      };
    };
    api.window.setMode = () => {
      modeRequests += 1;
      return new Promise((resolve) => { resolveModeWrite = resolve; });
    };
    api.window.setAlwaysOnTop = async () => {
      pinRequests += 1;
      return { ...windowState(harness), alwaysOnTop: true };
    };
    const { container, root } = await mountHome(dom, api);
    const modeToggle = buttonsByAriaLabel(container, "Switch to compact layout")[0]!;
    const pinToggle = buttonsByAriaLabel(container, "Pin on top")[0]!;

    await act(async () => {
      modeToggle.click();
      modeToggle.click();
      pinToggle.click();
      await settle(dom);
    });
    expect(modeRequests).toBe(1);
    expect(pinRequests).toBe(0);
    expect(modeToggle.disabled).toBe(true);
    expect(pinToggle.disabled).toBe(true);
    expect(modeToggle.getAttribute("aria-busy")).toBe("true");

    harness.windowMode = "compact";
    await act(async () => {
      resolveModeWrite?.(windowState(harness));
      await settle(dom);
    });
    await waitFor(dom, () => modeToggle.disabled === false);
    expect(pinToggle.disabled).toBe(false);
    expect(modeToggle.getAttribute("aria-label")).toBe("Switch to wide layout");

    api.window.setMode = async () => {
      throw new Error("raw private path /Users/example/window-state");
    };
    await clickElement(dom, modeToggle);
    await waitFor(dom, () => container.querySelector(".capture-toast.error") !== null);
    const errorToast = container.querySelector<HTMLElement>(".capture-toast.error")!;
    expect(errorToast.textContent).toContain(enMessages["error.generic"]);
    expect(errorToast.textContent).not.toContain("/Users/example/window-state");
    expect(modeToggle.getAttribute("aria-label")).toBe("Switch to wide layout");
    expect(modeToggle.disabled).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("serializes pin writes and keeps IPC failures body-free", async () => {
    const dom = createDom(960);
    const harness = createHarness(undefined);
    harness.windowMode = "expanded";
    let pinRequests = 0;
    let resolvePinWrite: ((state: WindowState) => void) | undefined;
    const api = makePigeApi(harness) as ReturnType<typeof makePigeApi> & {
      window: {
        setAlwaysOnTop: (request: { readonly alwaysOnTop: boolean }) => Promise<WindowState>;
      };
    };
    api.window.setAlwaysOnTop = () => {
      pinRequests += 1;
      return new Promise((resolve) => { resolvePinWrite = resolve; });
    };
    const { container, root } = await mountHome(dom, api);
    const pinToggle = buttonsByAriaLabel(container, "Pin on top")[0]!;

    await act(async () => {
      pinToggle.click();
      pinToggle.click();
      await settle(dom);
    });
    expect(pinRequests).toBe(1);
    expect(pinToggle.disabled).toBe(true);
    expect(pinToggle.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      resolvePinWrite?.({ ...windowState(harness), alwaysOnTop: true });
      await settle(dom);
    });
    await waitFor(dom, () => pinToggle.disabled === false);
    expect(pinToggle.getAttribute("aria-pressed")).toBe("true");

    api.window.setAlwaysOnTop = async () => {
      throw new Error("raw private path /Users/example/secret");
    };
    await clickElement(dom, pinToggle);
    await waitFor(dom, () => container.querySelector(".capture-toast.error") !== null);
    const errorToast = container.querySelector<HTMLElement>(".capture-toast.error")!;
    expect(errorToast.textContent).toContain(enMessages["error.generic"]);
    expect(errorToast.textContent).not.toContain("/Users/example/secret");
    expect(pinToggle.getAttribute("aria-pressed")).toBe("true");
    expect(pinToggle.disabled).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
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
    let resolveTurn: ((result: AgentStagedSubmitTurnResult) => void) | undefined;
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
    const compactReturn = requireElement(dialog.querySelector<HTMLButtonElement>(".settings-compact-return"));
    await waitFor(dom, () => dom.window.document.activeElement === compactReturn);
    expect(dom.window.document.activeElement).toBe(compactReturn);
    expect(compactReturn.nextElementSibling).toBe(compactNavigation);
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

    const composer = homeComposer(container);
    let underlyingEscapeCount = 0;
    composer.addEventListener("keydown", (event) => {
      if (event.key === "Escape") underlyingEscapeCount += 1;
    });
    composer.focus();

    await act(async () => {
      composer.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        isComposing: true
      }));
      await settle(dom);
    });
    expect(underlyingEscapeCount).toBe(0);
    expect(harness.confirmationResolveRequests).toHaveLength(0);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      composer.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true
      }));
      await settle(dom);
    });
    expect(underlyingEscapeCount).toBe(0);
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

  it("remembers only the exact Main-projected eligible scope and single-flights its decision", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.confirmationPending = {
      ...pendingHighRiskConfirmation(),
      rememberScopedGrant: {
        grantContextId: "grantctx_abcdefghijklmnop",
        scope: "resource_scope",
        safeScopeLabel: "Calendar · read events",
        expiresAt: "2026-08-29T10:00:00.000Z"
      }
    };
    const resolveGate = deferred<HighRiskConfirmationResolveResult>();
    const api = makePigeApi(harness);
    const { container, root } = await mountHome(dom, {
      ...api,
      confirmations: {
        ...api.confirmations,
        resolve: (request: HighRiskConfirmationResolveRequest) => {
          harness.confirmationResolveRequests.push(request);
          return resolveGate.promise;
        }
      }
    });

    await waitFor(dom, () => buttons(container, "Remember this scope").length === 1);
    const dialog = requireElement(container.querySelector<HTMLElement>('[role="dialog"]'));
    expect(dialog.textContent).toContain("Calendar · read events");
    expect(dialog.textContent).not.toContain("grantctx_abcdefghijklmnop");
    expect(buttons(dialog, "Allow once")).toHaveLength(1);
    const remember = buttons(dialog, "Remember this scope")[0]!;
    await act(async () => {
      remember.click();
      remember.click();
      await settle(dom);
    });
    expect(harness.confirmationResolveRequests).toEqual([{
      apiVersion: 1,
      confirmationId: "confirm_20260722_abcdefghijklmnop",
      expectedRevision: 7,
      decision: "allow",
      rememberScopedGrant: {
        decision: "allow_scoped",
        grantContextId: "grantctx_abcdefghijklmnop"
      }
    }]);

    resolveGate.resolve({
      apiVersion: 1,
      status: "committed",
      confirmationId: "confirm_20260722_abcdefghijklmnop",
      revision: 8,
      decision: "allow"
    });
    await act(async () => settle(dom));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

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

  it("closes an authoritatively committed confirmation before its resolve call settles", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const resolveGate = deferred<HighRiskConfirmationResolveResult>();
    const api = makePigeApi(harness);
    const deferredApi = {
      ...api,
      confirmations: {
        ...api.confirmations,
        resolve: (request: HighRiskConfirmationResolveRequest) => {
          harness.confirmationResolveRequests.push(request);
          return resolveGate.promise;
        }
      }
    };
    const { container, root } = await mountHome(dom, deferredApi);
    const composer = homeComposer(container);
    composer.focus();
    const pending = pendingHighRiskConfirmation();
    harness.confirmationPending = pending;
    await act(async () => {
      for (const listener of harness.confirmationListeners) listener(pending);
      await settle(dom);
    });
    await waitFor(dom, () => buttons(container, "Allow this effect").length === 1);

    await clickButton(dom, container, "Allow this effect");
    await waitFor(dom, () => harness.confirmationResolveRequests.length === 1);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      for (const listener of harness.confirmationListeners) listener({
        apiVersion: 1,
        status: "none",
        revision: pending.revision + 1
      });
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector('[role="dialog"]') === null);
    expect(dom.window.document.activeElement).toBe(composer);

    resolveGate.resolve({
      apiVersion: 1,
      status: "committed",
      confirmationId: pending.confirmation.confirmationId,
      revision: pending.revision + 1,
      decision: "allow"
    });
    await act(async () => settle(dom));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

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

  it("stages one picker attachment locally, then submits the exact query and file once", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await attachFile(dom, container, "public-alpha.csv", "item,score\nAlpha,9\n");
    expect(harness.submitRequests).toHaveLength(0);
    expect(harness.submittedFileNames).toHaveLength(0);
    expect(container.querySelector(".attachment-chip")?.textContent).toContain("public-alpha.csv");

    await setTextareaValue(dom, container, "Compare this file with related notes.");
    expect(harness.submitRequests).toHaveLength(0);
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(harness.submitRequests[0]).toMatchObject({
      inputKind: "file_picker",
      text: "Compare this file with related notes."
    });
    expect(harness.submitRequests[0]).not.toHaveProperty("conversationId");
    expect(harness.submitRequests[0]).not.toHaveProperty("expectedTailEventId");
    expect(harness.submittedFileNames).toEqual([["public-alpha.csv"]]);
    expect(textareaValue(container)).toBe("");
    expect(container.querySelector(".attachment-chip")).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("leaves an ordinary paste on the native textarea path at the canonical code-point boundary", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    const accepted = await pasteText(dom, container, `${"a".repeat(7_998)}😀`);

    expect(accepted).toBe(true);
    expect(container.querySelector(".pasted-text-chip")).toBeNull();
    expect(harness.submitRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("stages oversized pasted text locally without rendering its body or causing side effects", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const pastedBody = "x".repeat(8_001);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    const accepted = await pasteText(dom, container, pastedBody);
    const chip = requireElement(container.querySelector<HTMLElement>(".pasted-text-chip"));

    expect(accepted).toBe(false);
    expect(chip.textContent).toContain("Pasted text");
    expect(chip.textContent).toContain("8,001 characters");
    expect(chip.textContent).toContain("7.8 KiB");
    expect(chip.textContent).not.toContain(pastedBody);
    expect(harness.submitRequests).toHaveLength(0);
    expect(harness.submittedFileNames).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("classifies the exact resulting body and keeps the existing draft unchanged when staging", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Existing exact draft.");
    await pasteText(dom, container, "x".repeat(8_000));

    expect(textareaValue(container)).toBe("Existing exact draft.");
    expect(container.querySelector(".pasted-text-chip")).not.toBeNull();
    expect(harness.submitRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("uses the exact textarea selection when the resulting body remains within the canonical limit", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "a".repeat(8_001));
    const composer = homeComposer(container);
    composer.setSelectionRange(0, 2);
    const accepted = await pasteText(dom, container, "b");

    expect(accepted).toBe(true);
    expect(container.querySelector(".pasted-text-chip")).toBeNull();
    expect(harness.submitRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a structurally rejected paste visible and removable without clearing the draft or submitting", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const rejectedBody = "x".repeat(4_194_305);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Keep this exact draft.");
    const accepted = await pasteText(dom, container, rejectedBody);
    const chip = requireElement(container.querySelector<HTMLElement>(".rejected-pasted-text-chip"));

    expect(accepted).toBe(false);
    expect(textareaValue(container)).toBe("Keep this exact draft.");
    expect(chip.textContent).toContain("Pasted text");
    expect(chip.textContent).toContain("too large for one message");
    expect(chip.textContent).not.toContain(rejectedBody);
    expect(harness.submitRequests).toHaveLength(0);

    await clickButton(dom, container, "Send");
    expect(harness.submitRequests).toHaveLength(0);
    expect(textareaValue(container)).toBe("Keep this exact draft.");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Remove or adjust rejected pasted text before sending"
    );

    await clickButtonByAriaLabel(dom, container, "Remove pasted text Pasted text");
    expect(container.querySelector(".rejected-pasted-text-chip")).toBeNull();
    expect(textareaValue(container)).toBe("Keep this exact draft.");
    expect(dom.window.document.activeElement).toBe(homeComposer(container));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("shares the canonical eight-item limit across files and oversized pasted text", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await attachFiles(dom, container, Array.from({ length: 8 }, (_, index) => [
      `item-${index + 1}.md`,
      `# Item ${index + 1}\n`
    ] as const));
    await pasteText(dom, container, "x".repeat(8_001));

    expect(container.querySelectorAll(".attachment-chip")).toHaveLength(9);
    expect(container.querySelector(".rejected-pasted-text-chip")?.textContent).toContain(
      "The message item limit was reached"
    );
    expect(harness.submitRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps an aggregate-overflow paste visible and local after two exact four-MiB items", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    const fourMiB = "x".repeat(4_194_304);

    await pasteText(dom, container, fourMiB);
    await pasteText(dom, container, fourMiB);
    await pasteText(dom, container, "x".repeat(8_001));

    expect(container.querySelectorAll(".pasted-text-chip")).toHaveLength(3);
    expect(container.querySelector(".rejected-pasted-text-chip")?.textContent).toContain(
      "The pasted-text limit was reached"
    );
    expect(harness.submitRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps files and pasted text in one visible order and removes the paste locally", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await attachFile(dom, container, "first.md", "# First\n");
    await pasteText(dom, container, "x".repeat(8_001));
    await attachFile(dom, container, "last.csv", "value\n1\n");

    expect(Array.from(container.querySelectorAll(".attachment-chip")).map((chip) =>
      chip.querySelector("strong")?.textContent
    )).toEqual(["first.md", "Pasted text", "last.csv"]);
    await clickButtonByAriaLabel(dom, container, "Remove pasted text Pasted text");
    expect(Array.from(container.querySelectorAll(".attachment-chip")).map((chip) =>
      chip.querySelector("strong")?.textContent
    )).toEqual(["first.md", "last.csv"]);
    expect(dom.window.document.activeElement).toBe(homeComposer(container));
    expect(harness.submitRequests).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("submits the exact ordered official staged-item projection and clears after durable acceptance", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const pastedBody = "x".repeat(8_001);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await attachFile(dom, container, "context.md", "# Context\n");
    await pasteText(dom, container, pastedBody);
    await setTextareaValue(dom, container, "Compare these exact items.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(harness.submitRequests[0]).toMatchObject({
      inputKind: "file_picker",
      text: "Compare these exact items.",
      stagedItems: [
        { kind: "file", ordinal: 0, displayName: "context.md" },
        {
          kind: "large_paste",
          ordinal: 1,
          text: pastedBody,
          unicodeCodePointCount: 8_001,
          utf8ByteSize: 8_001
        }
      ]
    });
    expect(harness.submittedFileNames).toEqual([["context.md"]]);
    expect(textareaValue(container)).toBe("");
    expect(container.querySelectorAll(".attachment-chip")).toHaveLength(0);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps the exact composer snapshot until the early durable acceptance receipt resolves", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    let resolveSubmission: ((result: AgentStagedSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => { resolveSubmission = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await pasteText(dom, container, "x".repeat(8_001));
    await setTextareaValue(dom, container, "Keep until accepted.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(textareaValue(container)).toBe("Keep until accepted.");
    expect(container.querySelectorAll(".attachment-chip")).toHaveLength(1);
    expect(container.querySelector('[data-optimistic-user-message="true"]')?.textContent).toContain(
      "Keep until accepted."
    );

    await act(async () => {
      resolveSubmission?.(acceptedStagedResult(harness.submitRequests[0]!));
      await settle(dom);
      await settle(dom);
    });

    expect(textareaValue(container)).toBe("");
    expect(container.querySelector(".attachment-chip")).toBeNull();

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("sends multiple picker attachments atomically with lock, retention, clearing, and focus recovery", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const submissionResolvers: Array<(result: AgentStagedSubmitTurnResult) => void> = [];
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => { submissionResolvers.push(resolve); });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await attachFiles(dom, container, [
      ["first.md", "# First\n"],
      ["second.csv", "item,score\nBeta,8\n"]
    ]);
    expect(harness.submitRequests).toHaveLength(0);
    expect(harness.submittedFileNames).toHaveLength(0);
    expect(Array.from(container.querySelectorAll(".attachment-chip")).map((chip) => chip.textContent)).toEqual([
      "first.md",
      "second.csv"
    ]);

    await setTextareaValue(dom, container, "Compare these files with my notes.");
    const firstSend = buttons(container, "Send")[0]!;
    firstSend.focus();
    await act(async () => {
      firstSend.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      firstSend.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
    });
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(harness.submitRequests[0]).toMatchObject({
      inputKind: "file_picker",
      text: "Compare these files with my notes.",
      stagedItems: [
        { kind: "file", ordinal: 0, displayName: "first.md" },
        { kind: "file", ordinal: 1, displayName: "second.csv" }
      ]
    });
    expect(harness.submittedFileNames).toEqual([["first.md", "second.csv"]]);
    expect(buttons(container, "Working...")[0]?.disabled).toBe(true);
    expect(textareaValue(container)).toBe("Compare these files with my notes.");
    expect(container.querySelectorAll(".attachment-chip")).toHaveLength(2);

    await act(async () => {
      submissionResolvers.shift()?.({
        requestId: "request_20260729_atomic_failed",
        state: "failed",
        modelUsage: "none",
        sourceIds: [],
        error: turnConflictError()
      });
      await settle(dom);
      await settle(dom);
    });
    expect(textareaValue(container)).toBe("Compare these files with my notes.");
    expect(Array.from(container.querySelectorAll(".attachment-chip strong")).map((chip) => chip.textContent)).toEqual([
      "first.md",
      "second.csv"
    ]);
    expect(dom.window.document.activeElement).toBe(homeComposer(container));

    const retrySend = buttons(container, "Send")[0]!;
    retrySend.focus();
    await clickElement(dom, retrySend);
    await waitFor(dom, () => harness.submitRequests.length === 2);
    expect(harness.submitRequests[1]?.clientTurnId).toBe(harness.submitRequests[0]?.clientTurnId);
    expect(harness.submitRequests[1]?.stagedItems).toEqual(harness.submitRequests[0]?.stagedItems);
    expect(harness.submittedFileNames).toEqual([
      ["first.md", "second.csv"],
      ["first.md", "second.csv"]
    ]);

    await act(async () => {
      submissionResolvers.shift()?.(acceptedStagedResult(harness.submitRequests[1]!));
      await settle(dom);
      await settle(dom);
    });
    expect(textareaValue(container)).toBe("");
    expect(container.querySelector(".attachment-chip")).toBeNull();
    expect(dom.window.document.activeElement).toBe(homeComposer(container));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("renders only safe localized rejection details after partial attachment acceptance", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      const result = acceptedStagedResult(request);
      if (result.state !== "accepted") throw new Error("Expected accepted fixture.");
      return {
        ...result,
        sourceIds: ["source_internal_safe"],
        acceptedItems: [{ ordinal: 0, kind: "file", sourceId: "source_internal_safe" }],
        rejectedItems: [{
          ordinal: 1,
          kind: "file",
          displayName: "blocked.exe",
          reason: "unsupported_type"
        }]
      };
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await attachFiles(dom, container, [
      ["accepted.md", "# Accepted\n"],
      ["blocked.exe", "not-an-executable"]
    ]);
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => container.querySelector(".attachment-submission-notice") !== null);

    const notice = requireElement(container.querySelector<HTMLElement>(".attachment-submission-notice"));
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toContain("Some files could not be attached.");
    expect(notice.textContent).toContain("blocked.exe");
    expect(notice.textContent).toContain("This file type is not supported.");
    expect(notice.textContent).not.toContain("source_internal_safe");
    expect(notice.textContent).not.toContain("/Users/");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("submits an attachment without renderer-authored text and remains available without a model", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.loadModelSummary = async () => emptyModelSummary();
    harness.loadAgentRuntimeStatus = async () => null;
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      harness.jobs = [sourceWaitingForModelJob()];
      return acceptedStagedResult(request);
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await attachFile(dom, container, "offline-source.md", "# Offline source\n");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(harness.submitRequests[0]).toMatchObject({ inputKind: "file_picker" });
    expect(harness.submitRequests[0]?.text).toBeUndefined();
    expect(harness.submittedFileNames).toEqual([["offline-source.md"]]);
    expect(container.textContent).toContain("Use only the attached file(s) as source material.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("removes a staged picker attachment without any durable or network side effect", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await attachFile(dom, container, "remove-me.csv", "value\n1\n");
    await clickButtonByAriaLabel(dom, container, "Remove attachment remove-me.csv");

    expect(container.querySelector(".attachment-chip")).toBeNull();
    expect(harness.submitRequests).toHaveLength(0);
    expect(harness.submittedFileNames).toHaveLength(0);
    expect(dom.window.document.activeElement).toBe(homeComposer(container));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves an exact stale picker continuation and reuses its client turn ID until edited", async () => {
    const dom = createDom();
    const timeline = completedGroundedTimeline();
    const harness = createHarness(timeline);
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      return {
        requestId: "request_20260726_stalepicker",
        state: "failed",
        modelUsage: "none",
        sourceIds: [],
        error: turnConflictError()
      };
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await attachFile(dom, container, "retry.csv", "value\n1\n");
    await setTextareaValue(dom, container, "Analyze this exact file.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    await act(async () => settle(dom));

    expect(textareaValue(container)).toBe("Analyze this exact file.");
    expect(container.querySelector(".attachment-chip")?.textContent).toContain("retry.csv");
    expect(container.querySelector('[data-optimistic-user-message="true"]')).toBeNull();
    const firstClientTurnId = harness.submitRequests[0]?.clientTurnId;
    expect(harness.submitRequests[0]).toMatchObject({
      inputKind: "file_picker",
      conversationId: timeline.conversationId,
      expectedTailEventId: timeline.tailEventId
    });

    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 2);
    expect(harness.submitRequests[1]?.clientTurnId).toBe(firstClientTurnId);
    expect(harness.submitRequests[1]).toMatchObject({
      conversationId: timeline.conversationId,
      expectedTailEventId: timeline.tailEventId
    });

    await setTextareaValue(dom, container, "Analyze this changed request.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 3);
    expect(harness.submitRequests[2]?.clientTurnId).not.toBe(firstClientTurnId);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps an unsent composer draft local when a global drop submits immediately", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Keep this draft for a later message.");
    await dropFile(dom, container, "organize-now.md", "# Organize now\n");
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(harness.submitRequests[0]).toMatchObject({ inputKind: "file_drop" });
    expect(harness.submitRequests[0]?.text).toBeUndefined();
    expect(harness.submitRequests[0]?.conversationId).toBeUndefined();
    expect(harness.submitRequests[0]?.expectedTailEventId).toBeUndefined();
    expect(harness.submittedFileNames).toEqual([["organize-now.md"]]);
    expect(textareaValue(container)).toBe("Keep this draft for a later message.");

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("submits an ordered multi-file global drop immediately as one file_drop turn", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await dropFiles(dom, container, [
      ["drop-first.md", "# First\n"],
      ["drop-second.csv", "value\n2\n"]
    ]);
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(harness.submitRequests[0]).toMatchObject({ inputKind: "file_drop" });
    expect(harness.submittedFileNames).toEqual([["drop-first.md", "drop-second.csv"]]);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves a failed multi-file drop for one explicit duplicate-free retry", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const pendingResults: Array<(result: AgentSubmitTurnResult) => void> = [];
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => pendingResults.push(resolve));
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Keep this separate draft.");
    homeComposer(container).focus();
    await dropFiles(dom, container, [
      ["drop-first.md", "# First\n"],
      ["drop-second.csv", "value\n2\n"]
    ]);
    await waitFor(dom, () => harness.submitRequests.length === 1);

    const firstClientTurnId = harness.submitRequests[0]?.clientTurnId;
    await act(async () => {
      pendingResults[0]?.({
        requestId: "request_20260730_dropfailed",
        state: "failed",
        modelUsage: "none",
        sourceIds: [],
        error: turnConflictError()
      });
      await settle(dom);
      await settle(dom);
    });

    expect(textareaValue(container)).toBe("Keep this separate draft.");
    expect(Array.from(container.querySelectorAll(".attachment-chip strong")).map((chip) => chip.textContent)).toEqual([
      "drop-first.md",
      "drop-second.csv"
    ]);
    expect(dom.window.document.activeElement).toBe(homeComposer(container));

    const retry = requireElement(container.querySelector<HTMLButtonElement>(".attachment-strip .secondary"));
    await act(async () => {
      retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
    });
    await waitFor(dom, () => harness.submitRequests.length === 2);

    expect(harness.submitRequests[1]).toMatchObject({
      inputKind: "file_drop",
      clientTurnId: firstClientTurnId
    });
    expect(harness.submitRequests[1]?.text).toBeUndefined();
    expect(harness.submittedFileNames).toEqual([
      ["drop-first.md", "drop-second.csv"],
      ["drop-first.md", "drop-second.csv"]
    ]);

    await act(async () => {
      pendingResults[1]?.(completedResult());
      await settle(dom);
      await settle(dom);
    });

    expect(container.querySelector(".attachment-chip")).toBeNull();
    expect(textareaValue(container)).toBe("Keep this separate draft.");
    expect(dom.window.document.activeElement).toBe(homeComposer(container));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("preserves an exact dropped file after an IPC rejection without retrying automatically", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      throw new Error("synthetic rejected drop");
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await dropFile(dom, container, "retry-later.md", "# Retry later\n");
    await waitFor(dom, () => container.querySelector(".attachment-chip") !== null);

    expect(harness.submitRequests).toHaveLength(1);
    expect(container.querySelector(".attachment-chip")?.textContent).toContain("retry-later.md");
    expect(buttons(container, "Retry")).toHaveLength(1);
    await act(async () => settle(dom));
    expect(harness.submitRequests).toHaveLength(1);
    await clickButtonByAriaLabel(dom, container, "Remove attachment retry-later.md");
    expect(container.querySelector(".attachment-chip")).toBeNull();
    expect(buttons(container, "Retry")).toHaveLength(0);
    expect(dom.window.document.activeElement).toBe(homeComposer(container));
    expect(harness.submitRequests).toHaveLength(1);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("queues an immediate global drop behind the shared composer submission gate", async () => {
    const dom = createDom();
    const harness = createHarness(undefined);
    const pendingResults: Array<(result: AgentSubmitTurnResult) => void> = [];
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      return new Promise((resolve) => pendingResults.push(resolve));
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, "Finish this turn first.");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);

    await dropFile(dom, container, "queued-drop.md", "# Queued drop\n");
    expect(harness.submitRequests).toHaveLength(1);

    await act(async () => {
      pendingResults[0]?.(completedResult());
      await settle(dom);
    });
    await waitFor(dom, () => harness.submitRequests.length === 2);

    expect(harness.submitRequests.map((request) => request.inputKind)).toEqual([
      "typed_text",
      "file_drop"
    ]);
    expect(harness.submittedFileNames).toEqual([[], ["queued-drop.md"]]);

    await act(async () => {
      pendingResults[1]?.(sourceWaitingForModelResult());
      await settle(dom);
      root.unmount();
    });
    dom.window.close();
  });

  it("stages a picker source without side effects, then gives its Job sole status ownership after Send", async () => {
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
    expect(harness.submitRequests).toHaveLength(0);
    expect(harness.submittedFileNames).toHaveLength(0);
    expect(container.querySelector(".attachment-chip")?.textContent).toContain("public-alpha.csv");
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    expect(harness.submitRequests[0]).toMatchObject({ inputKind: "file_picker" });
    expect(harness.submittedFileNames).toEqual([["public-alpha.csv"]]);

    await act(async () => {
      resolveTurn?.({
        ...acceptedStagedResult(harness.submitRequests[0]!),
        jobId: "job_20260713_sourcewait"
      });
      await settle(dom);
    });
    await waitFor(dom, () =>
      countText(container, expectedStatus) === 1 &&
      !container.textContent?.includes("Pi Agent is working.")
    );
    expect(buttons(container, "Connect Model")).toHaveLength(1);
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

    expect(harness.conversationRequests[0]).toEqual({ limit: 100 });
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

  it("loads earlier Home messages through the typed cursor without replacing tail authority", async () => {
    const dom = createDom();
    const initial = paginatedHomeTimeline();
    const harness = createHarness(initial);
    harness.loadConversation = async (request) => {
      harness.conversationRequests.push(request);
      if ("earlierCursor" in request) {
        return {
          kind: "earlier",
          conversationId: initial.conversationId,
          snapshotTailEventId: initial.snapshotTailEventId,
          messages: [{
            id: "event_20260712_older01",
            role: "assistant",
            createdAt: "2026-07-12T07:59:00.000Z",
            text: "Earlier durable answer."
          }],
          hasEarlier: false
        };
      }
      return initial;
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => buttons(container, enMessages["conversation.loadEarlier"]).length === 1);
    await clickButton(dom, container, enMessages["conversation.loadEarlier"]);
    await waitFor(dom, () => container.textContent?.includes("Earlier durable answer.") === true);

    expect(harness.conversationRequests.at(-1)).toEqual({
      conversationId: initial.conversationId,
      snapshotTailEventId: initial.snapshotTailEventId,
      earlierCursor: initial.nextEarlierCursor,
      limit: 100
    });
    expect(Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]")).map((node) => node.dataset.messageId))
      .toEqual(["event_20260712_older01", "event_20260712_user01", "event_20260712_assistant01"]);
    expect(buttons(container, enMessages["conversation.loadEarlier"])).toHaveLength(0);
    await act(async () => root.unmount());
    dom.window.close();
  });

  it("browses an exact durable conversation without latest polling and rereads Current authoritatively", async () => {
    const dom = createDom();
    const current = paginatedHomeTimeline();
    const historical: AgentConversationInitialTimeline = {
      kind: "initial",
      conversationId: "conv_20260711_historyfixture",
      snapshotTailEventId: "event_20260711_historyassistant",
      tailEventId: "event_20260711_historyassistant",
      canFollowUp: false,
      messages: [
        {
          id: "event_20260711_historyuser",
          role: "user",
          createdAt: "2026-07-11T08:00:00.000Z",
          text: "Show the older plan.",
          jobId: "job_20260711_historyturn"
        },
        {
          id: "event_20260711_historyassistant",
          role: "assistant",
          createdAt: "2026-07-11T08:00:01.000Z",
          text: "This is the selected historical answer.",
          jobId: "job_20260711_historyturn"
        }
      ],
      hasEarlier: false,
      latestTurn: {
        jobId: "job_20260711_historyturn",
        userEventId: "event_20260711_historyuser",
        state: "running"
      }
    };
    const harness = createHarness(current);
    harness.loadConversation = async (request) => {
      harness.conversationRequests.push(request);
      return request.conversationId === historical.conversationId ? historical : current;
    };
    harness.loadConversationHistory = async (request) => {
      harness.conversationHistoryRequests.push(request);
      return {
        apiVersion: 1,
        activeVaultId: request.activeVaultId,
        status: "ready",
        currentConversationId: current.conversationId,
        conversations: [
          {
            conversationId: current.conversationId,
            updatedAt: "2026-07-12T08:00:01.000Z",
            safePreview: "What should I remember?",
            tailEventId: current.tailEventId,
            latestTurnState: "completed"
          },
          {
            conversationId: historical.conversationId,
            updatedAt: "2026-07-11T08:00:01.000Z",
            safePreview: "Show the older plan.",
            tailEventId: historical.tailEventId,
            latestTurnState: "running"
          }
        ],
        hasMore: false
      };
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));
    await setTextareaValue(dom, container, "Keep this draft while browsing.");

    await clickButton(dom, container, enMessages["conversation.history"]);
    await waitFor(dom, () => container.textContent?.includes("Show the older plan.") === true);
    const historicalTrigger = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-conversation-history-panel] .settings-row"))
      .find((button) => button.textContent?.includes("Show the older plan."));
    if (!historicalTrigger) throw new Error("Historical conversation trigger not found.");
    await act(async () => {
      historicalTrigger.click();
      await settle(dom);
    });
    await waitFor(dom, () => container.querySelector(".conversation-timeline-content")?.textContent
      ?.includes("This is the selected historical answer.") === true);

    expect(harness.conversationRequests.at(-1)).toEqual({
      conversationId: historical.conversationId,
      limit: 100
    });
    expect(buttons(container, enMessages["home.send"])[0]?.disabled).toBe(true);
    const requestCountAfterOpen = harness.conversationRequests.length;
    await new Promise((resolve) => dom.window.setTimeout(resolve, 1_250));
    expect(harness.conversationRequests).toHaveLength(requestCountAfterOpen);
    expect(dom.window.document.activeElement).toBe(historicalTrigger);

    harness.loadConversationHistory = async (request) => {
      harness.conversationHistoryRequests.push(request);
      return { apiVersion: 1, activeVaultId: request.activeVaultId, status: "failed" };
    };
    await clickButton(dom, container, enMessages["conversation.current"]);
    expect(container.querySelector(".conversation-timeline-content")?.textContent)
      .toContain("This is the selected historical answer.");

    harness.loadConversationHistory = async (request) => {
      harness.conversationHistoryRequests.push(request);
      return {
        apiVersion: 1,
        activeVaultId: request.activeVaultId,
        status: "ready",
        currentConversationId: current.conversationId,
        conversations: [],
        hasMore: false
      };
    };
    await clickButton(dom, container, enMessages["conversation.current"]);
    await waitFor(dom, () => container.querySelector(".conversation-timeline-content")?.textContent
      ?.includes("Remember the durable boundary.") === true);
    expect(harness.conversationRequests.at(-1)).toEqual({
      conversationId: current.conversationId,
      limit: 100
    });
    expect(buttons(container, enMessages["home.send"])[0]?.disabled).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps following the recovered conversation when its obsolete Job metadata is safely omitted", async () => {
    const dom = createDom();
    const { latestTurn: _obsoleteJob, ...recoveredTimeline } = completedTimeline();
    const harness = createHarness(recoveredTimeline);
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      harness.timeline = {
        conversationId: recoveredTimeline.conversationId,
        tailEventId: "event_20260712_assistant02",
        canFollowUp: true,
        messages: [
          ...recoveredTimeline.messages,
          {
            id: "event_20260712_user02",
            role: "user",
            createdAt: "2026-07-12T08:02:00.000Z",
            text: "Continue after recovering the old turn.",
            jobId: "job_20260712_turn02"
          },
          {
            id: "event_20260712_assistant02",
            role: "assistant",
            createdAt: "2026-07-12T08:02:01.000Z",
            text: "The recovered conversation remains continuous.",
            jobId: "job_20260712_turn02"
          }
        ],
        latestTurn: {
          jobId: "job_20260712_turn02",
          userEventId: "event_20260712_user02",
          state: "completed"
        }
      };
      const completed = completedResult();
      if (completed.state !== "completed") throw new Error("Expected completed result fixture.");
      return {
        ...completed,
        answer: {
          ...completed.answer,
          answer: "The recovered conversation remains continuous."
        }
      };
    };
    const firstMount = await mountHome(dom, makePigeApi(harness));

    expect(firstMount.container.textContent).toContain("What should I remember?");
    expect(firstMount.container.textContent).toContain("Remember the durable boundary.");
    await setTextareaValue(dom, firstMount.container, "Continue after recovering the old turn.");
    await clickButton(dom, firstMount.container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(harness.submitRequests[0]).toMatchObject({
      inputKind: "follow_up",
      conversationId: recoveredTimeline.conversationId,
      expectedTailEventId: recoveredTimeline.tailEventId
    });
    await waitFor(dom, () => countText(
      firstMount.container,
      "The recovered conversation remains continuous."
    ) === 1);

    await act(async () => firstMount.root.unmount());
    const secondMount = await mountHome(dom, makePigeApi(harness));
    expect(secondMount.container.textContent).toContain("What should I remember?");
    expect(secondMount.container.textContent).toContain("Remember the durable boundary.");
    expect(secondMount.container.textContent).toContain("Continue after recovering the old turn.");
    expect(secondMount.container.textContent).toContain("The recovered conversation remains continuous.");
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

  it("opens an exact durable Dataset citation read-only and keeps Home visible on a closed result", async () => {
    const dom = createDom();
    const timeline = completedDatasetTimeline();
    const harness = createHarness(timeline);
    const completed = datasetCompletedResult();
    if (completed.state !== "completed" || !completed.answer.datasetResult) {
      throw new Error("Expected a completed Dataset fixture.");
    }
    harness.openCollectionCitation = async (request) => ({
      ...request,
      status: "ready",
      mode: "citation_readonly",
      preview: completed.answer.datasetResult!,
      highlights: [
        { kind: "range", range: { startRow: 1, endRow: 1 } },
        { kind: "columns", columnIds: ["column_salesregioncol01"] }
      ]
    });
    const mount = await mountHome(dom, makePigeApi(harness));
    await waitFor(dom, () => mount.container.textContent?.includes("D1 Sales by region") === true);

    await clickButton(dom, mount.container, "D1 Sales by region");
    await waitFor(dom, () => mount.container.querySelector(".managed-collection-citation-panel") !== null);
    const request = harness.collectionCitationRequests[0];
    expect(request).toMatchObject({
      apiVersion: 1,
      activeVaultId: "vault_home_conversation",
      conversationId: timeline.conversationId,
      assistantEventId: timeline.tailEventId,
      citationRef: "citation_1"
    });
    expect(Object.keys(request ?? {}).sort()).toEqual([
      "activeVaultId",
      "apiVersion",
      "assistantEventId",
      "citationRef",
      "conversationId",
      "requestId"
    ]);
    const citationPanel = mount.container.querySelector<HTMLElement>(".managed-collection-citation-panel");
    expect(citationPanel?.dataset.collectionMode).toBe("citation_readonly");
    expect(citationPanel?.querySelectorAll("mark").length).toBeGreaterThan(0);
    expect(citationPanel?.querySelector("input, select, textarea")).toBeNull();

    await clickButton(dom, mount.container, "Back");
    await waitFor(dom, () => mount.container.textContent?.includes("D1 Sales by region") === true);
    harness.openCollectionCitation = async (closedRequest) => ({ ...closedRequest, status: "stale" });
    await clickButton(dom, mount.container, "D1 Sales by region");
    await waitFor(dom, () => mount.container.textContent?.includes("Pige could not load or save this collection change.") === true);
    expect(mount.container.querySelector(".managed-collection-citation-panel")).toBeNull();
    expect(mount.container.textContent).toContain("North120.5");
    expect(dom.window.document.activeElement?.textContent?.trim()).toBe("D1 Sales by region");

    await act(async () => mount.root.unmount());
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
    const authoredText = "  Show this prompt immediately.\nKeep the authored spacing.  ";
    const completed = completedResult();
    if (completed.state !== "completed") throw new Error("Expected completed result fixture.");
    let resolveTurn: ((result: AgentSubmitTurnResult) => void) | undefined;
    harness.submitTurn = (request) => {
      harness.submitRequests.push(request);
      harness.jobs = [{ ...runningAgentJob(), id: completed.jobId }];
      return new Promise((resolve) => { resolveTurn = resolve; });
    };
    const { container, root } = await mountHome(dom, makePigeApi(harness));

    await setTextareaValue(dom, container, authoredText);
    await clickButton(dom, container, "Send");
    await waitFor(dom, () => harness.submitRequests.length === 1);
    expect(harness.submitRequests[0]?.text).toBe(authoredText);
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
          text: authoredText,
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
    expect(mount.container.querySelector(".conversation-timeline")).toBeNull();

    await clickElement(dom, buttons(mount.container, enMessages["retrieval.backToResults"])[0]!);
    expect(mount.container.querySelector(".conversation-timeline")).not.toBeNull();
    expect(mount.container.querySelector(".note-reader")).toBeNull();

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("moves an eligible Home-opened note to recoverable Trash and restores composer focus", async () => {
    const dom = createDom();
    const harness = createHarness(completedGroundedTimeline());
    harness.renderNote = async (pageId) => ({
      ...testRenderedNote(pageId),
      trashEligibility: { canTrash: true, revision: `noteeditrev_${"d".repeat(32)}` }
    });
    harness.trashCurrent = async (request) => ({
      ...request,
      status: "committed",
      operationId: "operation_home_note_trash",
      authority: {
        pageId: request.currentPageId,
        pageState: "trashed",
        readerState: "closed",
        libraryPresence: "absent",
        canTrash: false
      }
    });
    const mount = await mountHome(dom, makePigeApi(harness));
    const citation = requireElement(mount.container.querySelector<HTMLButtonElement>(".conversation-citations .citation-row"));
    await clickElement(dom, citation);
    await waitFor(dom, () => mount.container.querySelector(".note-reader") !== null);

    await clickButtonByAriaLabel(dom, mount.container, enMessages["note.moreActions"]);
    await clickButton(dom, mount.container, enMessages["note.document.moveToTrash"]);
    await clickButton(dom, mount.container, enMessages["note.document.trashConfirm"]);
    await waitFor(dom, () => harness.noteTrashRequests.length === 1);
    expect(harness.noteTrashRequests[0]).toMatchObject({
      activeVaultId: "vault_home_conversation",
      currentPageId: "page_20260715_note0001",
      renderContextId: `notectx_${"a".repeat(32)}`,
      expectedRevision: `noteeditrev_${"d".repeat(32)}`
    });
    await waitFor(dom, () => mount.container.querySelector(".note-reader") === null);
    const composer = requireElement(mount.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Capture or ask"]'));
    await waitFor(dom, () => dom.window.document.activeElement === composer);
    expect(mount.container.querySelector(".conversation-timeline")).not.toBeNull();

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("archives an eligible Home-opened note in place and adopts the authoritative read-only render", async () => {
    const dom = createDom();
    const harness = createHarness(completedGroundedTimeline());
    const revision = `noteeditrev_${"d".repeat(32)}`;
    let mode: "stale" | "committed" = "stale";
    harness.renderNote = async (pageId) => ({
      ...testRenderedNote(pageId),
      archiveEligibility: { canArchive: true, revision }
    });
    harness.archiveCurrent = async (request) => mode === "stale"
      ? { ...request, status: "stale" }
      : {
          ...request,
          status: "committed",
          operationId: "operation_home_note_archive",
          render: {
            ...testRenderedNote(request.currentPageId),
            summary: { ...testRenderedNote(request.currentPageId).summary, status: "archived" },
            html: "<p>Archived Home note.</p>",
            renderContextId: `notectx_${"e".repeat(32)}`,
            archiveEligibility: { canArchive: false, revision: `noteeditrev_${"e".repeat(32)}` }
          }
        };
    const mount = await mountHome(dom, makePigeApi(harness));
    const citation = requireElement(mount.container.querySelector<HTMLButtonElement>(".conversation-citations .citation-row"));
    await clickElement(dom, citation);
    await waitFor(dom, () => mount.container.querySelector(".note-reader") !== null);

    await clickButtonByAriaLabel(dom, mount.container, enMessages["note.moreActions"]);
    await clickButton(dom, mount.container, enMessages["note.document.archive"]);
    await clickButton(dom, mount.container, enMessages["note.document.archiveConfirm"]);
    await waitFor(dom, () => harness.noteArchiveRequests.length === 1);
    expect(harness.noteArchiveRequests[0]).toMatchObject({
      activeVaultId: "vault_home_conversation",
      currentPageId: "page_20260715_note0001",
      renderContextId: `notectx_${"a".repeat(32)}`,
      expectedRevision: revision
    });
    expect(mount.container.querySelector(".note-reader")).not.toBeNull();
    expect(mount.container.textContent).toContain(enMessages["note.document.archiveFailed"]);
    expect(dom.window.document.activeElement).toBe(buttons(mount.container, enMessages["note.document.archiveCancel"])[0]);

    mode = "committed";
    await clickButton(dom, mount.container, enMessages["note.document.archiveConfirm"]);
    await waitFor(dom, () => mount.container.textContent?.includes("Archived Home note.") === true);
    expect(harness.noteArchiveRequests).toHaveLength(2);
    expect(mount.container.querySelector(".note-reader")).not.toBeNull();
    expect(mount.container.querySelector('[data-reader-action="edit"]')).toBeNull();
    expect(mount.container.querySelector('[data-reader-action="more"]')).toBeNull();
    await waitFor(dom, () => dom.window.document.activeElement === mount.container.querySelector(".note-reader"));

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("merges a selected note into the Home-opened Reader and adopts the authoritative survivor", async () => {
    const dom = createDom();
    const harness = createHarness(completedGroundedTimeline());
    const revision = `noteeditrev_${"d".repeat(32)}`;
    harness.renderNote = async (pageId) => ({
      ...testRenderedNote(pageId),
      trashEligibility: { canTrash: true, revision }
    });
    harness.mergeCurrent = async (request) => ({
      ...request,
      status: "committed",
      operationId: "operation_home_note_merge",
      render: {
        ...testRenderedNote(request.currentPageId),
        html: "<p>Authoritative merged Home note.</p>",
        trashEligibility: { canTrash: true, revision: `noteeditrev_${"e".repeat(32)}` }
      }
    });
    const mount = await mountHome(dom, makePigeApi(harness));
    await clickElement(dom, requireElement(mount.container.querySelector<HTMLButtonElement>(".conversation-citations .citation-row")));
    await waitFor(dom, () => mount.container.querySelector(".note-reader") !== null);

    await clickButtonByAriaLabel(dom, mount.container, enMessages["note.moreActions"]);
    await clickButton(dom, mount.container, enMessages["note.merge.title"]);
    await waitFor(dom, () => mount.container.querySelector("select")?.value === "page_20260715_note0002");
    await clickButton(dom, mount.container, enMessages["note.merge.confirm"]);
    await waitFor(dom, () => harness.noteMergeRequests.length === 1);
    expect(harness.noteMergeRequests[0]).toMatchObject({
      activeVaultId: "vault_home_conversation",
      currentPageId: "page_20260715_note0001",
      renderContextId: `notectx_${"a".repeat(32)}`,
      expectedRevision: revision,
      targetPageId: "page_20260715_note0002",
      expectedTargetUpdatedAt: "2026-07-15T08:01:00.000Z"
    });
    expect(JSON.stringify(harness.noteMergeRequests[0])).not.toContain("wiki/note");
    await waitFor(dom, () => mount.container.querySelector(".markdown-body")?.textContent?.includes("Authoritative merged Home note.") === true);
    await waitFor(dom, () => dom.window.document.activeElement === mount.container.querySelector(".note-reader"));

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("relates a selected note from the Home-opened Reader and adopts the authoritative related surface", async () => {
    const dom = createDom();
    const harness = createHarness(completedGroundedTimeline());
    const revision = `noteeditrev_${"d".repeat(32)}`;
    harness.renderNote = async (pageId) => ({
      ...testRenderedNote(pageId),
      trashEligibility: { canTrash: true, revision },
    });
    harness.relateCurrent = async (request) => ({
      ...request,
      status: "committed",
      render: {
        ...testRenderedNote(request.currentPageId),
        html: "<p>Authoritative related Home note.</p>",
        trashEligibility: { canTrash: true, revision: `noteeditrev_${"e".repeat(32)}` },
      },
    });
    const mount = await mountHome(dom, makePigeApi(harness));
    await clickElement(dom, requireElement(mount.container.querySelector<HTMLButtonElement>(".conversation-citations .citation-row")));
    await waitFor(dom, () => mount.container.querySelector(".note-reader") !== null);

    await clickButtonByAriaLabel(dom, mount.container, enMessages["note.moreActions"]);
    await clickButton(dom, mount.container, enMessages["note.relate.title"]);
    await waitFor(dom, () => mount.container.querySelector("select")?.value === "page_20260715_note0002");
    await clickButton(dom, mount.container, enMessages["note.relate.confirm"]);
    await waitFor(dom, () => harness.noteRelateRequests.length === 1);
    expect(harness.noteRelateRequests[0]).toMatchObject({
      activeVaultId: "vault_home_conversation",
      currentPageId: "page_20260715_note0001",
      renderContextId: `notectx_${"a".repeat(32)}`,
      expectedRevision: revision,
      targetPageId: "page_20260715_note0002",
      expectedTargetUpdatedAt: "2026-07-15T08:01:00.000Z",
    });
    expect(harness.noteRelateRequests[0]?.requestId).toMatch(/^noterelatereq_[a-z0-9]{16,64}$/u);
    expect(JSON.stringify(harness.noteRelateRequests[0])).not.toContain("wiki/note");
    await waitFor(dom, () => mount.container.querySelector(".markdown-body")?.textContent?.includes("Authoritative related Home note.") === true);
    await waitFor(dom, () => dom.window.document.activeElement === mount.container.querySelector(".note-reader"));

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("edits a Home-opened Reader through the shared canonical editor and adopts the committed render without refetch", async () => {
    const dom = createDom();
    const harness = createHarness(completedGroundedTimeline());
    let renderCount = 0;
    let saveCount = 0;
    harness.renderNote = async (pageId) => {
      renderCount += 1;
      return {
        ...testRenderedNote(pageId),
        renderContextId: renderCount === 1 ? `notectx_${"a".repeat(32)}` : `notectx_${"e".repeat(32)}`
      };
    };
    harness.openEditor = async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      pageId: request.pageId,
      status: "ready",
      renderContextId: request.renderContextId,
      revision: request.renderContextId === `notectx_${"e".repeat(32)}`
        ? `noteeditrev_${"b".repeat(32)}`
        : `noteeditrev_${"a".repeat(32)}`,
      markdown: "# Note A\n\nAuthoritative body\n"
    });
    harness.saveEditor = async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      pageId: request.pageId,
      ...(++saveCount === 1
        ? { status: "stale" as const, revision: `noteeditrev_${"b".repeat(32)}` }
        : {
            status: "committed" as const,
            revision: `noteeditrev_${"c".repeat(32)}`,
            operationId: "operation_home_editor",
            render: {
              ...testRenderedNote(request.pageId),
              html: "<h1>Note A</h1><p>Edited Home body</p>",
              byteSize: 42,
              renderContextId: `notectx_${"d".repeat(32)}`
            }
          })
    });
    const mount = await mountHome(dom, makePigeApi(harness));
    await clickElement(dom, requireElement(mount.container.querySelector<HTMLButtonElement>(".conversation-citations .citation-row")));
    await waitFor(dom, () => mount.container.querySelector(".note-reader") !== null);

    await clickButton(dom, mount.container, enMessages["note.edit"]);
    await waitFor(dom, () => mount.container.querySelector("#note-markdown-editor-input") !== null);
    expect(harness.editorOpenRequests[0]).toMatchObject({
      activeVaultId: "vault_home_conversation",
      pageId: "page_20260715_note0001",
      renderContextId: `notectx_${"a".repeat(32)}`
    });
    const editor = requireElement(mount.container.querySelector<HTMLTextAreaElement>("#note-markdown-editor-input"));
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(editor, "# Note A\n\nEdited Home body\n");
      editor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      editor.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await settle(dom);
    });
    await clickButton(dom, mount.container, enMessages["note.editor.save"]);
    await waitFor(dom, () => mount.container.textContent?.includes(enMessages["note.editor.stale"]) === true);
    expect(editor.value).toBe("# Note A\n\nEdited Home body\n");
    await clickButton(dom, mount.container, enMessages["note.editor.reload"]);
    await waitFor(dom, () => harness.editorOpenRequests.length === 2);
    expect(harness.editorOpenRequests[1]?.renderContextId).toBe(`notectx_${"e".repeat(32)}`);
    expect(editor.value).toBe("# Note A\n\nEdited Home body\n");
    await clickButton(dom, mount.container, enMessages["note.editor.save"]);
    await waitFor(dom, () => mount.container.textContent?.includes("Edited Home body") === true);
    expect(harness.editorSaveRequests[1]).toMatchObject({
      activeVaultId: "vault_home_conversation",
      pageId: "page_20260715_note0001",
      renderContextId: `notectx_${"e".repeat(32)}`,
      expectedRevision: `noteeditrev_${"b".repeat(32)}`,
      markdown: "# Note A\n\nEdited Home body\n"
    });
    expect(harness.noteRenderRequests).toEqual(["page_20260715_note0001", "page_20260715_note0001"]);

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("enables one staged source turn after a completed grounded Reader roundtrip despite a stale running Job", async () => {
    const dom = createDom();
    const completed = completedGroundedTimeline();
    const timeline = { ...completed, latestTurn: undefined };
    const harness = createHarness({
      ...completed,
      canFollowUp: false,
      latestTurn: {
        ...completed.latestTurn!,
        state: "running"
      }
    });
    harness.jobs = [{
      ...runningAgentJob(),
      id: completed.latestTurn!.jobId,
      updatedAt: "2026-07-12T08:00:00.500Z"
    }];
    harness.renderNote = async (pageId) => pageId === "page_20260726_pdfsource" ? {
      summary: {
        ...testLibraryList().pages[0]!,
        pageId,
        title: "PDF source",
        pageType: "source",
        sourceIds: ["src_20260726_pdfsource"]
      },
      renderContextId: `notectx_${"c".repeat(32)}`,
      html: "<h1>PDF source</h1><p>Current native-text PDF source.</p>",
      byteSize: 64
    } : testRenderedNote(pageId);
    harness.submitTurn = async (request) => {
      harness.submitRequests.push(request);
      const completedAt = "2026-07-12T08:00:02.000Z";
      harness.timeline = {
        ...timeline,
        tailEventId: "event_20260726_picker_user",
        canFollowUp: false,
        messages: [
          ...timeline.messages,
          {
            id: "event_20260726_picker_user",
            role: "user",
            createdAt: completedAt,
            text: "Continue with this exact attachment."
          }
        ],
        latestTurn: {
          jobId: "job_20260723_stagedturn",
          userEventId: "event_20260726_picker_user",
          state: "completed"
        }
      };
      harness.jobs = [];
      return {
        ...acceptedStagedResult(request),
        conversationId: timeline.conversationId,
        conversationEventId: "event_20260726_picker_user",
        jobId: "job_20260723_stagedturn",
        tailEventId: "event_20260726_picker_user"
      };
    };
    const mount = await mountHome(dom, makePigeApi(harness));

    const citation = requireElement(mount.container.querySelector<HTMLButtonElement>(".conversation-citations .citation-row"));
    await clickElement(dom, citation);
    await waitFor(dom, () => mount.container.querySelector(".note-reader") !== null);
    await clickElement(dom, buttons(mount.container, enMessages["retrieval.backToResults"])[0]!);
    await waitFor(dom, () => mount.container.querySelector(".note-reader") === null);

    await attachFile(dom, mount.container, "follow-up.txt", "Exact staged evidence.\n");
    const send = requireElement(mount.container.querySelector<HTMLButtonElement>("button.composer-send"));
    expect(send.disabled).toBe(true);
    expect(harness.submitRequests).toHaveLength(0);
    harness.timeline = timeline;
    await act(async () => {
      await new Promise((resolve) => dom.window.setTimeout(resolve, 1_300));
      await settle(dom);
    });
    expect(send.disabled).toBe(false);
    await clickElement(dom, send);
    await waitFor(dom, () => harness.submitRequests.length === 1);

    expect(harness.submitRequests[0]).toMatchObject({
      inputKind: "file_picker",
      stagedItems: [{ kind: "file", ordinal: 0, displayName: "follow-up.txt" }],
      conversationId: timeline.conversationId,
      expectedTailEventId: timeline.tailEventId
    });
    expect(harness.submittedFileNames).toEqual([["follow-up.txt"]]);
    await act(async () => {
      await new Promise((resolve) => dom.window.setTimeout(resolve, 1_300));
      await settle(dom);
    });
    expect(mount.container.textContent).not.toContain("The source continued in the same conversation.");
    const lateTimeline = harness.timeline;
    if (!lateTimeline) throw new Error("Expected the accepted picker timeline.");
    harness.timeline = {
      ...lateTimeline,
      tailEventId: "event_20260726_picker_assistant",
      canFollowUp: true,
      messages: [...lateTimeline.messages, {
        id: "event_20260726_picker_assistant",
        role: "assistant",
        createdAt: "2026-07-12T08:00:03.000Z",
        text: "The source continued in the same conversation.",
        jobId: "job_20260723_stagedturn",
        answer: {
          answer: "The source continued in the same conversation.",
          grounding: "local_knowledge",
          citations: [{
            refId: "citation_11",
            label: "[11]",
            pageId: "page_20260726_pdfsource",
            title: "PDF source",
            pageType: "source",
            locator: "source_page"
          }]
        }
      }]
    };
    await act(async () => {
      await new Promise((resolve) => dom.window.setTimeout(resolve, 1_300));
      await settle(dom);
    });
    await waitFor(dom, () => mount.container.textContent?.includes("The source continued in the same conversation.") === true);
    const pdfCitation = Array.from(mount.container.querySelectorAll<HTMLButtonElement>(".conversation-citations .citation-row"))
      .find((button) => button.textContent?.includes("[11]"));
    if (!pdfCitation) throw new Error("Expected the late durable PDF citation action.");
    await clickElement(dom, pdfCitation);
    await waitFor(dom, () => mount.container.querySelector(".note-reader") !== null);
    expect(harness.noteRenderRequests.at(-1)).toBe("page_20260726_pdfsource");
    expect(buttons(mount.container, enMessages["note.edit"])).toHaveLength(0);
    expect(harness.editorOpenRequests).toHaveLength(0);
    expect(harness.timeline?.conversationId).toBe(timeline.conversationId);

    await act(async () => mount.root.unmount());
    dom.window.close();
  });

  it("keeps a staged picker local when the refreshed conversation identity changes", async () => {
    const dom = createDom();
    const timeline = completedGroundedTimeline();
    const harness = createHarness(timeline);
    const mount = await mountHome(dom, makePigeApi(harness));

    harness.timeline = {
      ...timeline,
      conversationId: "conv_20260726_changedfixture"
    };
    await attachFile(dom, mount.container, "identity-fenced.txt", "Keep this exact staged source.\n");
    const send = requireElement(mount.container.querySelector<HTMLButtonElement>("button.composer-send"));
    await act(async () => {
      await new Promise((resolve) => dom.window.setTimeout(resolve, 1_300));
      await settle(dom);
    });

    expect(send.disabled).toBe(true);
    expect(mount.container.querySelector(".attachment-chip")?.textContent).toContain("identity-fenced.txt");
    expect(harness.submitRequests).toHaveLength(0);
    expect(harness.submittedFileNames).toHaveLength(0);

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
    expect(submitFiles).toContain("text?.trim() ? { text } : {}");
    expect(submitFiles).not.toContain("text: text.trim()");
    expect(submitFiles).not.toContain("conversationId:");
    expect(submitHomeInput).toContain("const submittedText = text;");
    expect(submitHomeInput).toContain('const turnText = hasText ? submittedText : props.t("home.useAttachedFilesAsSourceIntent")');
    expect(submitHomeInput).not.toContain("const submittedText = text.trim()");
    expect(submitHomeInput).toContain("const stagedItems = toAgentStagedItems(submittedItems)");
    expect(submitHomeInput).toContain("stagedItems,");
    expect(submitHomeInput).toContain('inputKind: "file_picker"');
    expect(submitHomeInput).toContain('if (outcome.state !== "accepted")');
    expect(submitHomeInput.indexOf('if (outcome.state !== "accepted")'))
      .toBeLessThan(submitHomeInput.indexOf('props.onDraftChange("")'));
    expect(appSource).not.toContain("HomeLargePasteAdapter");
    expect(appSource).toContain('submitHomeFiles(request.files, "file_drop"');
    expect(appSource).toContain("setStagedComposerItems((current) => [");
    expect(appSource).toContain('kind: "file" as const');
    expect(appSource).toContain("multiple");
    expect(retryLatestTurn).toContain("props.onRetryJob(retryableLatestTurn.jobId)");
    expect(retryLatestTurn).not.toContain("submitTurn");
    expect(submitHomeInput.indexOf("window.pige.agent.submitTurn"))
      .toBeLessThan(submitHomeInput.indexOf('if (outcome.state !== "accepted")'));
    expect(conversationStyles).toContain("min-width: 0;");
    expect(conversationStyles).toContain("overflow-wrap: anywhere;");
    expect(conversationStyles).toContain("white-space: pre-wrap;");
    expect(conversationStyles).toContain("max-height: min(36vh, 26rem);");
    expect(appSource).toContain('className="conversation-timeline-content"');
    expect(appSource).toContain("<ConversationScrollRail timelineRef={conversationTimelineRef} t={props.t} />");
    expect(styles).toContain(".conversation-scroll-rail");
    expect(styles).toContain(".conversation-scroll-anchor-preview");
    expect(styles).toMatch(/\.conversation-scroll-anchor:is\(:hover, :focus-visible\)[\s\S]*?--conversation-anchor-width:\s*16px;/);
    expect(styles).toMatch(/\.conversation-scroll-rail\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
    expect(styles).toMatch(/\.conversation-timeline\.has-conversation-scroll-rail[\s\S]*?scrollbar-width:\s*none;/);
    expect(styles).toMatch(/\.home\.home-conversation-active\s*>\s*\.conversation-timeline\s*\{[\s\S]*?display:\s*block;[\s\S]*?flex:\s*1 1 auto;[\s\S]*?max-height:\s*none;/);
    expect(styles).not.toMatch(/\.home\.home-conversation-active\s*>\s*\.conversation-timeline\s*\{[\s\S]*?align-content:\s*end;/);
    expect(styles).toMatch(/\.conversation-timeline-content\s*\{[\s\S]*?min-height:\s*100%;[\s\S]*?flex-direction:\s*column;[\s\S]*?justify-content:\s*flex-end;[\s\S]*?gap:\s*18px;/);
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
  readonly conversationRequests: AgentConversationRequest[];
  readonly conversationHistoryRequests: AgentConversationHistoryListRequest[];
  readonly collectionCitationRequests: CollectionOpenCitationRequest[];
  readonly submittedFileNames: string[][];
  readonly retryJobIds: string[];
  retryMode: "queued" | "immediate_refail";
  readonly cancelJobIds: string[];
  readonly reconnectOriginalSourceRequests: ReferencedOriginalReconnectRequest[];
  reconnectOriginalSource: (request: ReferencedOriginalReconnectRequest) => Promise<ReferencedOriginalReconnectResult>;
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
  proposalPreview: ProposalReviewPreview | null;
  readonly proposalReviewRequests: ProposalReviewRequest[];
  readonly proposalDecisionRequests: ProposalReviewDecisionRequest[];
  proposalDecisionMode: "applied" | "rejected" | "stale" | "conflicted" | "failed";
  readonly readerCreateNoteRequests: ReaderSelectionCreateNoteRequest[];
  readonly readerSelectionActionRequests: ReaderSelectionActionRequest[];
  readonly readerSelectionTransformRequests: ReaderSelectionTransformRequest[];
  readerSelectionTransform: (request: ReaderSelectionTransformRequest) => Promise<ReaderSelectionTransformResult>;
  readonly readerProposalDecisionRequests: ReaderSelectionProposalDecisionRequest[];
  readerProposalDecisionMode: "applied" | "rejected" | "stale";
  readonly currentNoteReplaceProposalRequests: CurrentNoteReplaceProposalGetRequest[];
  readonly currentNoteReplaceDecisionRequests: CurrentNoteReplaceProposalDecisionRequest[];
  currentNoteReplaceProposal: (request: CurrentNoteReplaceProposalGetRequest) => Promise<CurrentNoteReplaceProposalGetResult>;
  decideCurrentNoteReplaceProposal: (
    request: CurrentNoteReplaceProposalDecisionRequest
  ) => Promise<CurrentNoteReplaceProposalDecisionResult>;
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
  appearanceSummary: AppearanceSettingsSummary;
  startupDestination: "home" | "library" | "failed";
  appearanceThemeMutationStatus: "committed" | "stale" | "failed";
  readonly appearanceThemeRequests: SetThemeRequest[];
  readonly appearanceListeners: Set<(settings: AppearanceSettingsSummary) => void>;
  failNextWindowLayout: boolean;
  readonly noteRenderRequests: string[];
  readonly sourceReferenceRequests: NoteOpenSourceReferenceRequest[];
  readonly sourceRevealRequests: NoteRevealSourceRequest[];
  readonly readerSourceReconnectRequests: NoteReconnectOriginalSourceRequest[];
  readonly inlineReferenceRequests: NoteResolveInlineReferenceRequest[];
  readonly editorOpenRequests: NoteEditorOpenRequest[];
  readonly editorSaveRequests: NoteEditorSaveRequest[];
  readonly noteTrashRequests: NoteTrashCurrentRequest[];
  readonly noteArchiveRequests: NoteArchiveCurrentRequest[];
  readonly noteMergeRequests: NoteMergeRequest[];
  readonly noteRelateRequests: NoteRelateRequest[];
  renderNote: (pageId: string) => Promise<NoteRenderResult>;
  openEditor: (request: NoteEditorOpenRequest) => Promise<NoteEditorOpenResult>;
  saveEditor: (request: NoteEditorSaveRequest) => Promise<NoteEditorSaveResult>;
  trashCurrent: (request: NoteTrashCurrentRequest) => Promise<NoteTrashCurrentResult>;
  archiveCurrent: (request: NoteArchiveCurrentRequest) => Promise<NoteArchiveCurrentResult>;
  mergeCurrent: (request: NoteMergeRequest) => Promise<NoteMergeResult>;
  relateCurrent: (request: NoteRelateRequest) => Promise<NoteRelateResult>;
  openSourceReference: (request: NoteOpenSourceReferenceRequest) => Promise<NoteOpenSourceReferenceResult>;
  revealSource: (request: NoteRevealSourceRequest) => Promise<NoteRevealSourceResult>;
  reconnectReaderOriginalSource: (
    request: NoteReconnectOriginalSourceRequest
  ) => Promise<NoteReconnectOriginalSourceResult>;
  resolveInlineReference: (request: NoteResolveInlineReferenceRequest) => Promise<NoteResolveInlineReferenceResult>;
  loadAppearance: () => Promise<AppearanceSettingsSummary>;
  loadOnboarding: () => Promise<OnboardingStatus>;
  loadModelSummary: () => Promise<ModelProviderSettingsSummary>;
  loadAgentRuntimeStatus: () => Promise<AgentRuntimeStatus | null>;
  setDefaultModel: (modelProfileId: string) => Promise<void>;
  speechAvailability: SpeechAvailabilityResult;
  speechStartResult: SpeechStartResult;
  speechStopResult: SpeechStopResult;
  startSpeech: (request: SpeechStartRequest) => Promise<SpeechStartResult>;
  installSpeechAsset: (request: SpeechAssetInstallRequest) => Promise<SpeechAssetInstallResult>;
  loadConversation: (request: AgentConversationRequest) => Promise<AgentConversationTimeline | AgentConversationEarlierPage | undefined>;
  loadConversationHistory: (request: AgentConversationHistoryListRequest) => Promise<AgentConversationHistoryListResult>;
  openCollectionCitation: (request: CollectionOpenCitationRequest) => Promise<CollectionOpenCitationResult>;
  submitTurn: (
    request: AgentSubmitTurnRequest,
    files?: readonly File[]
  ) => Promise<AgentSubmitTurnResult | AgentStagedSubmitTurnResult>;
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
    conversationRequests: [],
    conversationHistoryRequests: [],
    collectionCitationRequests: [],
    submittedFileNames: [],
    retryJobIds: [],
    retryMode: "queued",
    cancelJobIds: [],
    reconnectOriginalSourceRequests: [],
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
    proposalPreview: null,
    proposalReviewRequests: [],
    proposalDecisionRequests: [],
    proposalDecisionMode: "applied",
    readerCreateNoteRequests: [],
    readerSelectionActionRequests: [],
    readerSelectionTransformRequests: [],
    readerSelectionTransform: async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "invalid",
      reason: "selection_changed"
    }),
    readerProposalDecisionRequests: [],
    readerProposalDecisionMode: "applied",
    currentNoteReplaceProposalRequests: [],
    currentNoteReplaceDecisionRequests: [],
    currentNoteReplaceProposal: async () => ({ apiVersion: 1, status: "not_found" }),
    decideCurrentNoteReplaceProposal: async () => ({ apiVersion: 1, status: "not_found" }),
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
    appearanceSummary: testAppearanceSummary("en"),
    startupDestination: "home",
    appearanceThemeMutationStatus: "committed",
    appearanceThemeRequests: [],
    appearanceListeners: new Set(),
    failNextWindowLayout: false,
    noteRenderRequests: [],
    sourceReferenceRequests: [],
    sourceRevealRequests: [],
    readerSourceReconnectRequests: [],
    inlineReferenceRequests: [],
    editorOpenRequests: [],
    editorSaveRequests: [],
    noteTrashRequests: [],
    noteArchiveRequests: [],
    noteMergeRequests: [],
    noteRelateRequests: [],
    renderNote: async (pageId) => testRenderedNote(pageId),
    openEditor: async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      pageId: request.pageId,
      status: "ready",
      renderContextId: request.renderContextId,
      revision: `noteeditrev_${"a".repeat(32)}`,
      markdown: "# Note A\n\nOriginal body\n"
    }),
    saveEditor: async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      pageId: request.pageId,
      status: "failed"
    }),
    trashCurrent: async (request) => ({ ...request, status: "failed" }),
    archiveCurrent: async (request) => ({ ...request, status: "failed" }),
    mergeCurrent: async (request) => ({ ...request, status: "failed" }),
    relateCurrent: async (request) => ({ ...request, status: "failed" }),
    reconnectOriginalSource: async (request) => ({ ...request, status: "cancelled" }),
    openSourceReference: async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "not_found"
    }),
    revealSource: async (request) => ({ ...request, status: "revealed" }),
    reconnectReaderOriginalSource: async (request) => ({ ...request, status: "cancelled" }),
    resolveInlineReference: async (request) => ({
      apiVersion: 1,
      requestId: request.requestId,
      status: "not_found"
    }),
    loadAppearance: async () => ({
      ...harness.appearanceSummary,
      locale: harness.locale,
      availableLocales: [harness.locale]
    }),
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
    loadConversation: async (request) => {
      harness.conversationRequests.push(request);
      return harness.timeline;
    },
    loadConversationHistory: async (request) => {
      harness.conversationHistoryRequests.push(request);
      return {
        apiVersion: 1,
        activeVaultId: request.activeVaultId,
        status: "ready",
        ...(harness.timeline ? { currentConversationId: harness.timeline.conversationId } : {}),
        conversations: [],
        hasMore: false
      };
    },
    openCollectionCitation: async (request) => ({ ...request, status: "failed" }),
    submitTurn: async (request) => {
      harness.submitRequests.push(request);
      return request.stagedItems ? acceptedStagedResult(request) : completedResult();
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

function testAppearanceSummary(locale: AppearanceSettingsSummary["locale"]): AppearanceSettingsSummary {
  return {
    locale,
    availableLocales: [locale],
    themePreference: "system",
    effectiveTheme: "light",
    generatedKnowledgeLanguage: "preserve_source",
    revision: 0
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
      appearance: () => harness.loadAppearance(),
      startupDestination: async () => {
        if (harness.startupDestination === "failed") throw new Error("startup destination unavailable");
        return { apiVersion: 1 as const, destination: harness.startupDestination, revision: 3 };
      },
      setStartupDestination: async (request) => ({
        status: "committed" as const,
        summary: { apiVersion: 1 as const, destination: request.destination, revision: request.expectedRevision + 1 }
      }),
      setTheme: async (request: SetThemeRequest) => {
        harness.appearanceThemeRequests.push(request);
        if (harness.appearanceThemeMutationStatus !== "committed") {
          return { status: harness.appearanceThemeMutationStatus, settings: harness.appearanceSummary };
        }
        harness.appearanceSummary = {
          ...harness.appearanceSummary,
          themePreference: request.themePreference,
          effectiveTheme: request.themePreference === "dark" ? "dark" : "light",
          revision: harness.appearanceSummary.revision + 1
        };
        return { status: "committed" as const, settings: harness.appearanceSummary };
      },
      onAppearanceChanged: (listener: (settings: AppearanceSettingsSummary) => void) => {
        harness.appearanceListeners.add(listener);
        return () => harness.appearanceListeners.delete(listener);
      }
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
      conversation: (request: AgentConversationRequest) => harness.loadConversation(request),
      conversationHistory: (request: AgentConversationHistoryListRequest) => harness.loadConversationHistory(request),
      submitTurn: (request: AgentSubmitTurnRequest, files: readonly File[] = []) => {
        harness.submittedFileNames.push(files.map((file) => file.name));
        return harness.submitTurn(request, files);
      },
      currentNoteAppendProposal: async () => ({
        apiVersion: 1 as const,
        status: "unavailable" as const,
        reason: "not_found" as const
      }),
      currentNoteReplaceProposal: (request: CurrentNoteReplaceProposalGetRequest) => {
        harness.currentNoteReplaceProposalRequests.push(request);
        return harness.currentNoteReplaceProposal(request);
      },
      decideCurrentNoteReplaceProposal: (request: CurrentNoteReplaceProposalDecisionRequest) => {
        harness.currentNoteReplaceDecisionRequests.push(request);
        return harness.decideCurrentNoteReplaceProposal(request);
      },
      onTurnDraft: (listener: (event: AgentTurnDraftEvent) => void) => {
        harness.draftListeners.add(listener);
        return () => harness.draftListeners.delete(listener);
      }
    },
    collections: {
      openCitation: (request: CollectionOpenCitationRequest) => {
        harness.collectionCitationRequests.push(request);
        return harness.openCollectionCitation(request);
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
      },
      reconnectOriginalSource: (request: ReferencedOriginalReconnectRequest) =>
        harness.reconnectOriginalSource(request)
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
    taskExecution: {
      interaction: async () => ({ status: "none" as const }),
      openInteraction: async () => ({ status: "not_found" as const }),
      onInteractionChanged: () => () => undefined
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
      }),
      review: async (request: ProposalReviewRequest): Promise<ProposalReviewResult> => {
        harness.proposalReviewRequests.push(request);
        const preview = harness.proposalPreview;
        return preview && preview.jobId === request.jobId && preview.proposalId === request.proposalId
          ? { ...request, status: "available", preview }
          : { ...request, status: "not_found" };
      },
      decide: async (request: ProposalReviewDecisionRequest): Promise<ProposalReviewDecisionResult> => {
        harness.proposalDecisionRequests.push(request);
        const preview = harness.proposalPreview;
        if (harness.proposalDecisionMode === "applied" || harness.proposalDecisionMode === "rejected") {
          return {
            ...request,
            status: harness.proposalDecisionMode,
            preview: preview ? {
              ...preview,
              state: harness.proposalDecisionMode === "applied" ? "applied" : "rejected"
            } : undefined
          } as ProposalReviewDecisionResult;
        }
        return {
          ...request,
          status: harness.proposalDecisionMode,
          ...(preview ? { preview } : {})
        } as ProposalReviewDecisionResult;
      }
    },
    readerSelection: {
      resolve: async (request: ReaderSelectionResolveRequest) => ({
        apiVersion: 1 as const,
        requestId: request.requestId,
        status: "resolved" as const,
        selection: {
          pageId: request.currentPageId,
          pageContentHash: `sha256:${"a".repeat(64)}` as const,
          span: { unit: "utf8_bytes" as const, start: 0, endExclusive: 8 },
          selectedContentHash: `sha256:${"b".repeat(64)}` as const
        }
      }),
      submitAction: async (request: ReaderSelectionActionRequest) => {
        harness.readerSelectionActionRequests.push(request);
        return {
          apiVersion: 1 as const,
          requestId: request.requestId,
          status: "completed" as const,
          jobId: "job_20260730_readerask01",
          conversationEventId: "evt_20260730_readerask01",
          conversationId: "conv_20260730_readerask01",
          tailEventId: "evt_20260730_readerask02"
        };
      },
      submitLink: async (request: { readonly requestId: string }) => ({
        apiVersion: 1 as const, requestId: request.requestId, status: "invalid" as const, reason: "selection_changed" as const
      }),
      submitTransform: async (request: ReaderSelectionTransformRequest) => {
        harness.readerSelectionTransformRequests.push(request);
        return harness.readerSelectionTransform(request);
      },
      submitCreateNote: async (request: ReaderSelectionCreateNoteRequest): Promise<ReaderSelectionCreateNoteResult> => {
        harness.readerCreateNoteRequests.push(request);
        return {
          apiVersion: 1,
          requestId: request.requestId,
          status: "review_required",
          jobId: `job_20260729_createnote${harness.readerCreateNoteRequests.length}`,
          conversationEventId: `evt_20260729_createuser${harness.readerCreateNoteRequests.length}`,
          conversationId: `conv_20260729_createnote${harness.readerCreateNoteRequests.length}`,
          tailEventId: `evt_20260729_createassistant${harness.readerCreateNoteRequests.length}`,
          proposal: readerCreateNoteProposal(harness.readerCreateNoteRequests.length)
        };
      },
      currentProposal: async () => ({
        apiVersion: 1 as const,
        status: "available" as const,
        proposal: readerCreateNoteProposal(Math.max(1, harness.readerCreateNoteRequests.length))
      }),
      decideProposal: async (
        request: ReaderSelectionProposalDecisionRequest
      ): Promise<ReaderSelectionProposalDecisionResult> => {
        harness.readerProposalDecisionRequests.push(request);
        const proposal = readerCreateNoteProposal(Math.max(1, harness.readerCreateNoteRequests.length));
        if (harness.readerProposalDecisionMode === "applied") {
          return {
            apiVersion: 1,
            status: "applied",
            proposal: { ...proposal, state: "applied" },
            operationId: "operation_20260729_createnote",
            createdPageId: "page_20260715_note0002"
          };
        }
        return {
          apiVersion: 1,
          status: harness.readerProposalDecisionMode,
          proposal: { ...proposal, state: harness.readerProposalDecisionMode === "rejected" ? "rejected" : "ready" }
        };
      }
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
      },
      openSourceReference: async (request: NoteOpenSourceReferenceRequest) => {
        harness.sourceReferenceRequests.push(request);
        return harness.openSourceReference(request);
      },
      revealSource: async (request: NoteRevealSourceRequest) => {
        harness.sourceRevealRequests.push(request);
        return harness.revealSource(request);
      },
      reconnectOriginalSource: async (request: NoteReconnectOriginalSourceRequest) => {
        harness.readerSourceReconnectRequests.push(request);
        return harness.reconnectReaderOriginalSource(request);
      },
      openEditor: async (request: NoteEditorOpenRequest) => {
        harness.editorOpenRequests.push(request);
        return harness.openEditor(request);
      },
      saveEditor: async (request: NoteEditorSaveRequest) => {
        harness.editorSaveRequests.push(request);
        return harness.saveEditor(request);
      },
      trashCurrent: async (request: NoteTrashCurrentRequest) => {
        harness.noteTrashRequests.push(request);
        return harness.trashCurrent(request);
      },
      archiveCurrent: async (request: NoteArchiveCurrentRequest) => {
        harness.noteArchiveRequests.push(request);
        return harness.archiveCurrent(request);
      },
      merge: async (request: NoteMergeRequest) => {
        harness.noteMergeRequests.push(request);
        return harness.mergeCurrent(request);
      },
      relate: async (request: NoteRelateRequest) => {
        harness.noteRelateRequests.push(request);
        return harness.relateCurrent(request);
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

function readerCreateNoteProposal(sequence: number): ReaderSelectionProposalPreview {
  return {
    proposalId: `proposal_20260729_createnote${sequence}`,
    action: "create_note",
    state: "ready",
    revision: sequence,
    lines: [{ kind: "added", text: "Create a durable note from the selected passage" }]
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

function paginatedHomeTimeline(): AgentConversationInitialTimeline {
  const timeline = completedTimeline();
  return {
    ...timeline,
    kind: "initial",
    snapshotTailEventId: timeline.tailEventId,
    hasEarlier: true,
    nextEarlierCursor: "timeline_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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

function acceptedStagedResult(request: AgentSubmitTurnRequest): AgentStagedSubmitTurnResult {
  const acceptedItems = (request.stagedItems ?? []).map((item) => ({
    ordinal: item.ordinal,
    kind: item.kind,
    sourceId: `src_20260723_staged${item.ordinal}`
  }));
  return {
    requestId: "request_20260723_stagedturn",
    jobId: "job_20260723_stagedturn",
    conversationEventId: "event_20260723_stageduser",
    conversationId: "conv_20260723_staged",
    tailEventId: "event_20260723_stageduser",
    state: "accepted",
    modelUsage: "none",
    sourceIds: acceptedItems.map((item) => item.sourceId),
    acceptedItems
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

function referencedOriginalWaitingJob(): JobSummary {
  return {
    id: "job_20260729_sourcereconnect",
    class: "agent_turn",
    state: "waiting_dependency",
    stage: "waiting_for_path",
    sourceId: "src_20260729_sourcereconnect",
    sourceKind: "plain_text_file",
    sourceDisplayName: "field-notes.txt",
    canReconnectDependency: true,
    message: "Original source needs reconnection.",
    createdAt: "2026-07-29T09:00:00.000Z",
    updatedAt: "2026-07-29T09:00:01.000Z"
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

function turnConflictError() {
  return {
    code: "agent_runtime.turn_conflict",
    domain: "agent_runtime" as const,
    messageKey: "errors.agent_runtime.turn_conflict",
    retryable: false,
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

async function mountHome(
  dom: JSDOM,
  api: object
): Promise<{
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

async function pasteText(dom: JSDOM, container: HTMLElement, text: string): Promise<boolean> {
  const composer = homeComposer(container);
  const event = new dom.window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: { getData: (type: string) => type === "text/plain" ? text : "" }
  });
  let accepted = true;
  await act(async () => {
    accepted = composer.dispatchEvent(event);
    await settle(dom);
  });
  return accepted;
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
  await attachFiles(dom, container, [[name, content]]);
}

async function attachFiles(
  dom: JSDOM,
  container: HTMLElement,
  files: readonly (readonly [name: string, content: string])[]
): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Home file input not found.");
  const selectedFiles = files.map(([name, content]) =>
    new dom.window.File([content], name, { type: "text/csv" })
  );
  Object.defineProperty(input, "files", { configurable: true, value: selectedFiles });
  await act(async () => {
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle(dom);
  });
}

async function dropFile(dom: JSDOM, container: HTMLElement, name: string, content: string): Promise<void> {
  await dropFiles(dom, container, [[name, content]]);
}

async function dropFiles(
  dom: JSDOM,
  container: HTMLElement,
  files: readonly (readonly [name: string, content: string])[]
): Promise<void> {
  const shell = container.querySelector<HTMLElement>('.shell[aria-label="Pige"]');
  if (!shell) throw new Error("Application shell not found.");
  const droppedFiles = files.map(([name, content]) =>
    new dom.window.File([content], name, { type: "text/csv" })
  );
  const event = new dom.window.Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: { files: droppedFiles, types: ["Files"] }
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
