import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentConversationTimeline,
  AgentSubmitTurnRequest,
  AgentSubmitTurnResult,
  AgentTurnDraftEvent,
  JobSummary,
  KnowledgeActivitySummary
} from "@pige/contracts";

const globalKeys = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLTextAreaElement",
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

describe("Home durable Agent conversation UI", () => {
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
  jobs: JobSummary[];
  activities: KnowledgeActivitySummary[];
  readonly submitRequests: AgentSubmitTurnRequest[];
  readonly retryJobIds: string[];
  readonly cancelJobIds: string[];
  readonly undoOperationIds: string[];
  readonly draftListeners: Set<(event: AgentTurnDraftEvent) => void>;
  activityUndoMode: "success" | "post_commit_reject" | "retryable_reject" | "unknown_reject";
  activityListReads: number;
  submitTurn: (request: AgentSubmitTurnRequest) => Promise<AgentSubmitTurnResult>;
  emitDraft: (event: AgentTurnDraftEvent) => void;
}

function createHarness(timeline: AgentConversationTimeline | undefined): ConversationHarness {
  const harness: ConversationHarness = {
    timeline,
    jobs: [],
    activities: [],
    submitRequests: [],
    retryJobIds: [],
    cancelJobIds: [],
    undoOperationIds: [],
    draftListeners: new Set(),
    activityUndoMode: "success",
    activityListReads: 0,
    submitTurn: async (request) => {
      harness.submitRequests.push(request);
      return completedResult();
    },
    emitDraft: (event) => {
      for (const listener of harness.draftListeners) listener(event);
    }
  };
  return harness;
}

function makePigeApi(harness: ConversationHarness): object {
  return {
    getHealth: async () => ({ status: "ok" }),
    window: {
      current: async () => ({ mode: "compact", sidebarOpen: false, alwaysOnTop: false })
    },
    settings: {
      appearance: async () => ({ locale: "en", availableLocales: ["en"] })
    },
    system: {
      toolchainHealth: async () => ({ status: "ready" })
    },
    vault: {
      onboardingStatus: async () => ({
        state: "ready",
        hasDefaultModel: true,
        activeVault: { vaultId: "vault_home_conversation", name: "Conversation Vault" }
      }),
      recent: async () => []
    },
    backup: {
      status: async () => null
    },
    agent: {
      runtimeStatus: async () => null,
      conversation: async () => harness.timeline,
      submitTurn: (request: AgentSubmitTurnRequest) => harness.submitTurn(request),
      onTurnDraft: (listener: (event: AgentTurnDraftEvent) => void) => {
        harness.draftListeners.add(listener);
        return () => harness.draftListeners.delete(listener);
      }
    },
    jobs: {
      list: async () => ({
        scannedAt: "2026-07-12T08:00:00.000Z",
        activeVaultId: "vault_home_conversation",
        total: harness.jobs.length,
        invalidJobCount: 0,
        jobs: harness.jobs
      }),
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
      list: async () => ({
        scannedAt: "2026-07-12T08:00:00.000Z",
        activeVaultId: "vault_home_conversation",
        total: 0,
        invalidPageCount: 0,
        pages: []
      })
    }
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

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://pige.test"
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

async function setTextareaValue(dom: JSDOM, container: HTMLElement, value: string): Promise<void> {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Capture or ask"]');
  if (!textarea) throw new Error("Home composer not found.");
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("Textarea setter not found.");
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    textarea.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
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
