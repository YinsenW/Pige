import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentTurnAnswer } from "@pige/contracts";
import type { ConversationEvent } from "@pige/schemas";
import { AgentTurnConversationStore } from "../../apps/desktop/src/main/services/agent-turn-conversation-store";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent turn conversation store", () => {
  it("persists and reads back a user turn bound to its domain-separated hash", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const text = "  Synthetic user turn for a general Agent conversation.  ";

    const preserved = service.appendUserTurn(vaultPath, text);
    const resumed = service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      preserved.inputHash
    );
    const events = readEvents(vaultPath, preserved.locator);

    expect(preserved.event).toMatchObject({
      type: "user_message",
      text: text.trim(),
      inputHash: preserved.inputHash
    });
    expect(preserved.locator).toMatch(
      /^\.pige\/conversations\/\d{4}\/\d{2}\/conv_\d{8}_[a-z0-9]{12,64}\.jsonl$/u
    );
    expect(preserved.event.clientTurnId).toMatch(/^turn_\d{8}_[a-z0-9]{12,64}$/u);
    expect(preserved.event.conversationId).toBe(preserved.event.clientTurnId?.replace(/^turn_/u, "conv_"));
    expect(preserved.inputHash).toBe(hashValue(
      `pige.agent_turn.user.v2\0${text.trim()}\0null\0${preserved.event.clientTurnId}` +
      `\0${preserved.event.conversationId}\0`
    ));
    expect(resumed).toEqual(preserved);
    expect(events).toEqual([preserved.event]);
  });

  it("appends a bounded assistant event without duplicating the user or source-like body", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const syntheticBody = `SYNTHETIC_SOURCE_BODY_${"x".repeat(32 * 1024)}`;
    const userText = `Analyze the already-preserved source reference. ${syntheticBody}`;
    const userTurn = service.appendUserTurn(vaultPath, userText);

    const assistant = service.appendAssistantTurn(
      vaultPath,
      userTurn,
      "job_20260712_abcdef123456",
      "Synthetic concise answer based on the referenced source."
    );
    const adopted = service.appendAssistantTurn(
      vaultPath,
      userTurn,
      "job_20260712_abcdef123456",
      "Synthetic concise answer based on the referenced source."
    );
    const events = readEvents(vaultPath, userTurn.locator);
    const fileText = readConversationFile(vaultPath, userTurn.locator);

    expect(events).toHaveLength(2);
    expect(events[1]).toEqual(assistant);
    expect(events[1]).toMatchObject({
      conversationId: userTurn.event.conversationId,
      type: "assistant_message",
      parentEventId: userTurn.event.id,
      jobId: "job_20260712_abcdef123456",
      text: "Synthetic concise answer based on the referenced source."
    });
    expect(assistant.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(adopted).toEqual(assistant);
    expect(events[1]).not.toHaveProperty("sourceId");
    expect(events[1]).not.toHaveProperty("captureId");
    expect(JSON.stringify(events[1])).not.toContain("SYNTHETIC_SOURCE_BODY_");
    expect(fileText.split(syntheticBody)).toHaveLength(2);
  });

  it("stores only a neutral marker for restricted input while retaining its opaque hash binding", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const opaqueOriginal = "Synthetic private memory with opaque credential zebra-frost-91.";

    const preserved = service.appendBlockedTurnMarker(vaultPath, opaqueOriginal);
    const fileText = readConversationFile(vaultPath, preserved.locator);

    expect(preserved.event).toMatchObject({
      type: "error",
      text: "Restricted content was blocked before Agent ingress."
    });
    expect(preserved.inputHash).toBe(hashValue(
      `pige.agent_turn.blocked.v2\0${opaqueOriginal}\0null\0${preserved.event.clientTurnId}` +
      `\0${preserved.event.conversationId}\0`
    ));
    expect(preserved.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(fileText).not.toContain(opaqueOriginal);
    expect(fileText).not.toContain("zebra-frost-91");
    expect(fileText).not.toContain("private memory");
  });

  it("fails closed for a mismatched expected hash and a tampered stored user turn", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const preserved = service.appendUserTurn(vaultPath, "Original synthetic turn.");
    const otherHash = hashValue("pige.agent_turn.user.v1\0Different synthetic turn.");

    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      otherHash
    ))).toMatchObject({ code: "agent_runtime.turn_changed" });

    const events = readEvents(vaultPath, preserved.locator);
    events[0] = { ...events[0], text: "Tampered synthetic turn." };
    fs.writeFileSync(
      conversationPath(vaultPath, preserved.locator),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    );

    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      preserved.inputHash
    ))).toMatchObject({ code: "agent_runtime.turn_changed" });
  });

  it("fails closed when a checksum-bound assistant result changes after completion", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const userTurn = service.appendUserTurn(vaultPath, "Synthetic turn for assistant integrity.");
    const jobId = "job_20260712_assistanthash";
    const assistant = service.appendAssistantTurn(vaultPath, userTurn, jobId, {
      answer: "Original checksum-bound assistant answer.",
      grounding: "general",
      citations: []
    });

    expect(assistant.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const events = readEvents(vaultPath, userTurn.locator);
    events[1] = { ...events[1], text: "Tampered assistant answer." };
    fs.writeFileSync(
      conversationPath(vaultPath, userTurn.locator),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    );

    expect(captureError(() => service.findAssistantTurn(
      vaultPath,
      userTurn.locator,
      jobId
    ))).toMatchObject({ code: "agent_runtime.turn_changed" });
    expect(captureError(() => service.readConversationTimeline(
      vaultPath,
      userTurn.event.conversationId
    ))).toMatchObject({ code: "agent_runtime.turn_changed" });
  });

  it("persists and restarts an exact bounded Dataset citation and preview roundtrip", () => {
    const vaultPath = makeVault();
    const writer = new AgentTurnConversationStore();
    const userTurn = writer.appendUserTurn(vaultPath, "Which region has three records?");
    const jobId = "job_20260713_datasetround1";
    const answer = makeDatasetAnswer();

    const assistant = writer.appendAssistantTurn(vaultPath, userTurn, jobId, answer);
    const adopted = new AgentTurnConversationStore().appendAssistantTurn(
      vaultPath,
      userTurn,
      jobId,
      answer
    );
    const restarted = new AgentTurnConversationStore().findAssistantTurn(
      vaultPath,
      userTurn.locator,
      jobId
    );
    const timeline = new AgentTurnConversationStore().readConversationTimeline(
      vaultPath,
      userTurn.event.conversationId
    );
    const events = readEvents(vaultPath, userTurn.locator);
    const persistedText = readConversationFile(vaultPath, userTurn.locator);

    expect(adopted).toEqual(assistant);
    expect(restarted).toEqual(assistant);
    expect(events[1]).toEqual(assistant);
    expect(assistant).toMatchObject({
      schemaVersion: 1,
      answerGrounding: "local_knowledge",
      answerCitations: answer.citations,
      answerDatasetResult: answer.datasetResult
    });
    expect(assistant.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(timeline?.messages.at(-1)).toMatchObject({
      id: assistant.id,
      role: "assistant",
      answer
    });
    expect(persistedText).not.toContain("SELECT ");
    expect(persistedText).not.toContain("/private/");
    expect(persistedText).not.toContain("providerData");

    const changedAnswer: AgentTurnAnswer = {
      ...answer,
      datasetResult: {
        ...(answer.datasetResult as NonNullable<AgentTurnAnswer["datasetResult"]>),
        rows: [{ rowId: "row_abcdef123456", values: ["North", 4] }]
      }
    };
    expect(captureError(() => writer.appendAssistantTurn(
      vaultPath,
      userTurn,
      jobId,
      changedAnswer
    ))).toMatchObject({ code: "agent_runtime.turn_conflict" });
  });

  it("projects durable plain and structured assistant events as exact Agent answers", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const plainTurn = service.appendUserTurn(vaultPath, "Synthetic plain answer request.");
    const plainEvent = service.appendAssistantTurn(
      vaultPath,
      plainTurn,
      "job_20260722_plainanswer1",
      "Synthetic durable plain answer."
    );
    const datasetTurn = service.appendUserTurn(vaultPath, "Synthetic Dataset answer request.");
    const datasetAnswer = makeDatasetAnswer();
    const datasetEvent = service.appendAssistantTurn(
      vaultPath,
      datasetTurn,
      "job_20260722_datasetanswer1",
      datasetAnswer
    );

    expect(service.readAssistantAnswer(plainEvent)).toEqual({
      answer: "Synthetic durable plain answer.",
      grounding: "general",
      citations: []
    });
    expect(service.readAssistantAnswer(datasetEvent)).toEqual(datasetAnswer);
  });

  it("fails closed for invalid or changed durable assistant events", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const userTurn = service.appendUserTurn(vaultPath, "Synthetic adversarial answer request.");
    const assistant = service.appendAssistantTurn(
      vaultPath,
      userTurn,
      "job_20260722_adversarial1",
      makeDatasetAnswer()
    );

    expect(captureError(() => service.readAssistantAnswer(userTurn.event))).toMatchObject({
      code: "agent_runtime.turn_conflict"
    });
    expect(captureError(() => service.readAssistantAnswer({
      ...assistant,
      text: undefined
    } as unknown as ConversationEvent))).toMatchObject({ code: "agent_runtime.turn_conflict" });
    expect(captureError(() => service.readAssistantAnswer({
      ...assistant,
      answerGrounding: undefined
    } as ConversationEvent))).toMatchObject({ code: "agent_runtime.turn_conflict" });
    expect(captureError(() => service.readAssistantAnswer({
      ...assistant,
      answerCitations: []
    }))).toMatchObject({ code: "agent_runtime.turn_changed" });
  });

  it("reads a pre-Dataset checksum-bound structured page assistant event", () => {
    const vaultPath = makeVault();
    const locator = ".pige/conversations/2026/07/conv_20260713_legacy.jsonl";
    const filePath = conversationPath(vaultPath, locator);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const userEvent = {
      id: "evt_20260713_legacyuser01",
      conversationId: "conv_20260713_legacy",
      type: "user_message",
      createdAt: "2026-07-13T01:00:00.000Z",
      text: "Legacy page question."
    };
    const jobId = "job_20260713_legacypage1";
    const citations = [{
      refId: "citation_1",
      label: "[1]",
      pageId: "page_20260713_abcdef12",
      title: "Legacy page",
      pageType: "note",
      locator: "snippet:1"
    }];
    const answerPayload = {
      text: "Legacy page-grounded answer.",
      grounding: "local_knowledge",
      citations
    };
    const assistantEvent = {
      id: "evt_20260713_legacyanswer1",
      conversationId: userEvent.conversationId,
      type: "assistant_message",
      createdAt: "2026-07-13T01:00:01.000Z",
      parentEventId: userEvent.id,
      jobId,
      text: answerPayload.text,
      answerGrounding: answerPayload.grounding,
      answerCitations: citations,
      contentHash: hashValue(
        `pige.agent_assistant.v1\0${jobId}\0${userEvent.id}\0${JSON.stringify(answerPayload)}`
      )
    };
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(userEvent)}\n${JSON.stringify(assistantEvent)}\n`,
      "utf8"
    );

    expect(new AgentTurnConversationStore().findAssistantTurn(vaultPath, locator, jobId)).toMatchObject({
      text: answerPayload.text,
      answerGrounding: answerPayload.grounding,
      answerCitations: citations,
      contentHash: assistantEvent.contentHash
    });
  });

  it("fails assistant integrity when persisted Dataset preview or citation content is tampered", () => {
    for (const target of ["preview", "citation"] as const) {
      const vaultPath = makeVault();
      const service = new AgentTurnConversationStore();
      const userTurn = service.appendUserTurn(vaultPath, `Dataset tamper check for ${target}.`);
      const jobId = `job_20260713_${target}tamper1`;
      service.appendAssistantTurn(vaultPath, userTurn, jobId, makeDatasetAnswer());
      const events = readEvents(vaultPath, userTurn.locator);
      const assistant = events[1];
      if (!assistant) throw new Error("Expected a persisted assistant event.");

      if (target === "preview") {
        const preview = assistant.answerDatasetResult as {
          rows: Array<{ values: Array<string | number | boolean | null> }>;
        };
        const row = preview.rows[0];
        if (!row) throw new Error("Expected a persisted Dataset preview row.");
        row.values[1] = 4;
      } else {
        const citations = assistant.answerCitations as Array<{ label: string }>;
        const citation = citations[0];
        if (!citation) throw new Error("Expected a persisted Dataset citation.");
        citation.label = "[D2]";
      }
      fs.writeFileSync(
        conversationPath(vaultPath, userTurn.locator),
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8"
      );

      expect(captureError(() => new AgentTurnConversationStore().findAssistantTurn(
        vaultPath,
        userTurn.locator,
        jobId
      ))).toMatchObject({ code: "agent_runtime.turn_changed" });
    }
  });

  it("fails closed when an earlier checksum-bound user turn changes before follow-up history is read", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const first = service.appendUserTurn(vaultPath, "Original durable conversation question.", undefined, {
      clientTurnId: "turn_20260712_historyhash01"
    });
    const assistant = service.appendAssistantTurn(
      vaultPath,
      first,
      "job_20260712_historyhash01",
      "Durable answer before follow-up."
    );
    const followUp = service.appendUserTurn(vaultPath, "Follow-up using exact history.", undefined, {
      clientTurnId: "turn_20260712_historyhash02",
      conversationId: first.event.conversationId,
      expectedTailEventId: assistant.id
    });
    const events = readEvents(vaultPath, first.locator);
    events[0] = { ...events[0], text: "Tampered prior conversation question." };
    fs.writeFileSync(
      conversationPath(vaultPath, first.locator),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    );

    expect(captureError(() => service.readContextBeforeUserTurn(
      vaultPath,
      followUp
    ))).toMatchObject({ code: "agent_runtime.turn_changed" });
    expect(captureError(() => service.readConversationTimeline(
      vaultPath,
      first.event.conversationId
    ))).toMatchObject({ code: "agent_runtime.turn_changed" });
  });

  it("rejects malformed hashes, locators, missing events, and non-user assistant bindings", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const preserved = service.appendUserTurn(vaultPath, "Synthetic binding checks.");
    const blocked = service.appendBlockedTurnMarker(vaultPath, "Synthetic blocked binding.");

    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      "sha256:not-a-checksum"
    ))).toMatchObject({ code: "agent_runtime.turn_binding_invalid" });
    expect(captureError(() => service.readUserTurn(
      vaultPath,
      "../outside.jsonl",
      preserved.event.id,
      preserved.inputHash
    ))).toMatchObject({ code: "agent_runtime.turn_binding_invalid" });
    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      "evt_20260712_missing12",
      preserved.inputHash
    ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });
    expect(captureError(() => service.appendAssistantTurn(
      vaultPath,
      blocked,
      "job_20260712_abcdef123456",
      "This must not append."
    ))).toMatchObject({ code: "agent_runtime.turn_binding_invalid" });
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked conversation directory without writing outside the vault",
    () => {
      const vaultPath = makeVault();
      const outside = makeTempRoot("pige-agent-turn-outside-dir-");
      fs.mkdirSync(path.join(vaultPath, ".pige"), { recursive: true });
      fs.symlinkSync(outside, path.join(vaultPath, ".pige", "conversations"), "dir");

      expect(captureError(() => new AgentTurnConversationStore().appendUserTurn(
        vaultPath,
        "Synthetic turn must remain confined."
      ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });
      expect(fs.readdirSync(outside)).toEqual([]);
    }
  );

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked conversation file for read and append without changing its target",
    () => {
      const vaultPath = makeVault();
      const service = new AgentTurnConversationStore();
      const preserved = service.appendUserTurn(vaultPath, "Synthetic turn before file substitution.");
      const filePath = conversationPath(vaultPath, preserved.locator);
      const outsideRoot = makeTempRoot("pige-agent-turn-outside-file-");
      const outsideFile = path.join(outsideRoot, "external.jsonl");
      fs.writeFileSync(outsideFile, "SYNTHETIC_EXTERNAL_CONTENT\n", "utf8");
      fs.rmSync(filePath);
      fs.symlinkSync(outsideFile, filePath, "file");

      expect(captureError(() => service.readUserTurn(
        vaultPath,
        preserved.locator,
        preserved.event.id,
        preserved.inputHash
      ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });
      expect(captureError(() => service.appendAssistantTurn(
        vaultPath,
        preserved,
        "job_20260712_abcdef123456",
        "This must not reach the external file."
      ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });
      expect(fs.readFileSync(outsideFile, "utf8")).toBe("SYNTHETIC_EXTERNAL_CONTENT\n");
    }
  );

  it("rejects empty, null-containing, and oversized turn text before persistence", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();

    for (const text of ["   ", "synthetic\0turn", "x".repeat(64 * 1024 + 1)]) {
      expect(captureError(() => service.appendUserTurn(vaultPath, text))).toMatchObject({
        code: "agent_runtime.turn_invalid"
      });
    }
    expect(fs.existsSync(path.join(vaultPath, ".pige", "conversations"))).toBe(false);
  });

  it("rejects an oversized or invalid conversation file during resume", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const preserved = service.appendUserTurn(vaultPath, "Synthetic turn for file-bound checks.");
    const filePath = conversationPath(vaultPath, preserved.locator);

    fs.writeFileSync(filePath, "{not-json}\n", "utf8");
    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      preserved.inputHash
    ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });

    fs.truncateSync(filePath, 8 * 1024 * 1024 + 1);
    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      preserved.inputHash
    ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });
  });

  it("adopts exact client retries and enforces exact follow-up tail bindings", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const metadata = { inputKind: "typed_text", objective: "auto", locale: "en" } as const;
    const firstBinding = { clientTurnId: "turn_20260712_aaaaaaaaaaaa" };
    const first = service.appendUserTurn(vaultPath, "First durable turn.", metadata, firstBinding);
    const adopted = new AgentTurnConversationStore().appendUserTurn(
      vaultPath,
      "First durable turn.",
      metadata,
      firstBinding
    );

    expect(adopted).toEqual(first);
    expect(first.event).toMatchObject({
      id: "evt_20260712_aaaaaaaaaaaa",
      conversationId: "conv_20260712_aaaaaaaaaaaa",
      clientTurnId: firstBinding.clientTurnId
    });
    expect(readEvents(vaultPath, first.locator)).toHaveLength(1);

    for (const action of [
      () => service.appendUserTurn(vaultPath, "Changed text.", metadata, firstBinding),
      () => service.appendUserTurn(vaultPath, "First durable turn.", { ...metadata, objective: "capture" }, firstBinding),
      () => service.appendUserTurn(vaultPath, "First durable turn.", metadata, {
        ...firstBinding,
        conversationId: first.event.conversationId,
        expectedTailEventId: first.event.id
      })
    ]) {
      expect(captureError(action)).toMatchObject({ code: "agent_runtime.turn_changed" });
    }

    const assistant = service.appendAssistantTurn(vaultPath, first, "job_20260712_followup0001", {
      answer: "Durable assistant answer.",
      grounding: "general",
      citations: []
    });
    expect(assistant).toMatchObject({
      parentEventId: first.event.id,
      answerGrounding: "general",
      answerCitations: []
    });
    expect(captureError(() => service.appendUserTurn(vaultPath, "Stale follow-up.", metadata, {
      clientTurnId: "turn_20260712_bbbbbbbbbbbb",
      conversationId: first.event.conversationId,
      expectedTailEventId: first.event.id
    }))).toMatchObject({ code: "agent_runtime.turn_conflict" });

    const followUp = service.appendUserTurn(vaultPath, "Exact-tail follow-up.", {
      ...metadata,
      inputKind: "follow_up"
    }, {
      clientTurnId: "turn_20260712_cccccccccccc",
      conversationId: first.event.conversationId,
      expectedTailEventId: assistant.id
    });
    expect(followUp.event.parentEventId).toBe(assistant.id);
    expect(readEvents(vaultPath, first.locator)).toHaveLength(3);
  });

  it("isolates checksum-bound current-note conversations across restart and follow-up", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const scopeA = { kind: "current_note", pageId: "page_20260712_noteaaaa" } as const;
    const scopeB = { kind: "current_note", pageId: "page_20260712_notebbbb" } as const;
    const metadata = { inputKind: "typed_text", objective: "auto", locale: "en", scope: scopeA } as const;
    const first = service.appendUserTurn(vaultPath, "What does this note say?", metadata, {
      clientTurnId: "turn_20260712_noteaaaa0001"
    });
    const assistant = service.appendAssistantTurn(
      vaultPath,
      first,
      "job_20260712_noteaaaa0001",
      "It describes a synthetic launch date."
    );

    const restarted = new AgentTurnConversationStore();
    expect(restarted.readConversationTimeline(vaultPath, undefined, 24, scopeA)).toMatchObject({
      conversationId: first.event.conversationId,
      tailEventId: assistant.id
    });
    expect(restarted.readConversationTimeline(vaultPath, undefined, 24)).toBeUndefined();
    expect(restarted.readConversationTimeline(vaultPath, undefined, 24, scopeB)).toBeUndefined();
    expect(captureError(() => restarted.readConversationTimeline(
      vaultPath,
      first.event.conversationId,
      24,
      scopeB
    ))).toMatchObject({ code: "agent_runtime.turn_binding_invalid" });

    const sameScopeFollowUp = restarted.appendUserTurn(vaultPath, "Continue in this note.", {
      ...metadata,
      inputKind: "follow_up"
    }, {
      clientTurnId: "turn_20260712_noteaaaa0002",
      conversationId: first.event.conversationId,
      expectedTailEventId: assistant.id
    });
    expect(restarted.readContextBeforeUserTurn(vaultPath, sameScopeFollowUp)).toEqual([
      expect.objectContaining({ role: "user", historyContentClasses: ["sensitive"] }),
      expect.objectContaining({ role: "assistant", historyContentClasses: ["sensitive"] })
    ]);

    expect(captureError(() => restarted.appendUserTurn(vaultPath, "Cross-note follow-up.", {
      ...metadata,
      inputKind: "follow_up",
      scope: scopeB
    }, {
      clientTurnId: "turn_20260712_notebbbb0002",
      conversationId: first.event.conversationId,
      expectedTailEventId: assistant.id
    }))).toMatchObject({ code: "agent_runtime.turn_binding_invalid" });

    const events = readEvents(vaultPath, first.locator);
    const mixedEvents = [events[0], {
      schemaVersion: 1,
      id: "evt_20260712_sourceref1",
      conversationId: first.event.conversationId,
      type: "source_reference",
      createdAt: "2026-07-12T00:00:00.000Z",
      sourceId: "src_20260712_sourceref1"
    }, events[1]];
    fs.writeFileSync(
      conversationPath(vaultPath, first.locator),
      `${mixedEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    );
    expect(captureError(() => restarted.readConversationTimeline(
      vaultPath,
      first.event.conversationId,
      24,
      scopeA
    ))).toMatchObject({ code: "agent_runtime.turn_binding_invalid" });

    events[0] = { ...events[0], scope: scopeB };
    fs.writeFileSync(
      conversationPath(vaultPath, first.locator),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    );
    expect(captureError(() => restarted.readConversationTimeline(
      vaultPath,
      first.event.conversationId,
      24,
      scopeA
    ))).toMatchObject({ code: "agent_runtime.turn_changed" });
  });

  it("returns bounded context and exact/latest timelines after restart", () => {
    const vaultPath = makeVault();
    const writer = new AgentTurnConversationStore();
    let current = writer.appendUserTurn(vaultPath, `Turn 0 ${"u".repeat(5_000)}`, undefined, {
      clientTurnId: "turn_20260712_dddddddddddd"
    });
    for (let index = 0; index < 9; index += 1) {
      const assistant = writer.appendAssistantTurn(
        vaultPath,
        current,
        `job_20260712_${String(index).padStart(12, "a")}`,
        `Answer ${index} ${"a".repeat(5_000)}`
      );
      current = writer.appendUserTurn(vaultPath, `Turn ${index + 1} ${"u".repeat(5_000)}`, undefined, {
        clientTurnId: `turn_20260712_${String(index).padStart(12, "b")}`,
        conversationId: current.event.conversationId,
        expectedTailEventId: assistant.id
      });
    }

    const reader = new AgentTurnConversationStore();
    const context = reader.readContextBeforeUserTurn(vaultPath, current);
    const exact = reader.readConversationTimeline(vaultPath, current.event.conversationId, 5);
    const latest = reader.readLatestConversationTimeline(vaultPath, 5);

    expect(context.length).toBeLessThanOrEqual(16);
    expect(context.reduce((bytes, message) => bytes + Buffer.byteLength(message.text), 0)).toBeLessThanOrEqual(64 * 1024);
    expect(context.every((message) => ["user", "assistant"].includes(message.role))).toBe(true);
    expect(exact).toEqual(latest);
    expect(exact).toMatchObject({
      conversationId: current.event.conversationId,
      tailEventId: current.event.id
    });
    expect(exact?.messages).toHaveLength(5);
    expect(JSON.stringify(exact)).not.toContain(".pige/conversations");
  });

  it("reads legacy daily records without exposing error details in timelines", () => {
    const vaultPath = makeVault();
    const locator = ".pige/conversations/2026/07/conv_20260712.jsonl";
    const filePath = conversationPath(vaultPath, locator);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const legacyEvents = [
      {
        id: "evt_20260712_legacyuser01",
        conversationId: "conv_20260712",
        type: "user_message",
        createdAt: "2026-07-12T01:00:00.000Z",
        text: "Legacy user text."
      },
      {
        id: "evt_20260712_legacyanswer1",
        conversationId: "conv_20260712",
        type: "assistant_message",
        createdAt: "2026-07-12T01:00:01.000Z",
        jobId: "job_20260712_legacyjob001",
        text: "Legacy assistant text."
      },
      {
        id: "evt_20260712_legacyerror01",
        conversationId: "conv_20260712",
        type: "error",
        createdAt: "2026-07-12T01:00:02.000Z",
        rawError: "private raw failure",
        path: "/private/legacy/path"
      }
    ];
    fs.writeFileSync(filePath, `${legacyEvents.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");

    const service = new AgentTurnConversationStore();
    const expectedHash = hashValue("pige.agent_turn.user.v1\0Legacy user text.\0null");
    expect(service.readUserTurn(vaultPath, locator, legacyEvents[0].id, expectedHash).event.text).toBe("Legacy user text.");
    expect(service.findAssistantTurn(vaultPath, locator, legacyEvents[1].jobId)).toMatchObject({
      id: legacyEvents[1].id,
      text: "Legacy assistant text."
    });
    const timeline = service.readConversationTimeline(vaultPath, "conv_20260712");
    expect(timeline?.messages.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: "user", text: "Legacy user text." },
      { role: "assistant", text: "Legacy assistant text." }
    ]);
    expect(timeline?.tailEventId).toBe(legacyEvents[2].id);
    expect(JSON.stringify(timeline)).not.toContain("private raw failure");
    expect(JSON.stringify(timeline)).not.toContain("/private/legacy/path");
  });

  it.skipIf(process.platform === "win32")("rejects symlinked roots and files during latest discovery", () => {
    const realVault = makeVault();
    const linkRoot = makeTempRoot("pige-agent-turn-root-link-");
    const linkedVault = path.join(linkRoot, "VaultLink");
    fs.symlinkSync(realVault, linkedVault, "dir");
    const service = new AgentTurnConversationStore();
    expect(captureError(() => service.readLatestConversationTimeline(linkedVault))).toMatchObject({
      code: "agent_runtime.turn_unavailable"
    });

    const vaultPath = makeVault();
    const monthPath = path.join(vaultPath, ".pige", "conversations", "2026", "07");
    fs.mkdirSync(monthPath, { recursive: true });
    const outsideFile = path.join(makeTempRoot("pige-agent-turn-latest-file-"), "outside.jsonl");
    fs.writeFileSync(outsideFile, "{}\n", "utf8");
    fs.symlinkSync(outsideFile, path.join(monthPath, "conv_20260712_abcd.jsonl"), "file");
    expect(captureError(() => service.readLatestConversationTimeline(vaultPath))).toMatchObject({
      code: "agent_runtime.turn_unavailable"
    });
  });
});

function makeVault(): string {
  const root = makeTempRoot("pige-agent-turn-store-");
  const vaultPath = path.join(root, "Vault");
  fs.mkdirSync(vaultPath, { recursive: true });
  return vaultPath;
}

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function conversationPath(vaultPath: string, locator: string): string {
  return path.join(vaultPath, ...locator.split("/"));
}

function readConversationFile(vaultPath: string, locator: string): string {
  return fs.readFileSync(conversationPath(vaultPath, locator), "utf8");
}

function readEvents(vaultPath: string, locator: string): Array<Record<string, unknown>> {
  return readConversationFile(vaultPath, locator)
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function makeDatasetAnswer(): AgentTurnAnswer {
  const schemaId = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const planHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const resultHash = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  const sourceRevisionHash = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  return {
    answer: "North has three records.",
    grounding: "local_knowledge",
    citations: [{
      kind: "dataset",
      refId: "dataset_citation_1",
      label: "[D1]",
      title: "Regional totals",
      locator: "dataset:regional-totals#rows:1",
      evidence: {
        datasetId: "dataset_20260713_abcdef123456",
        revisionId: "dataset_rev_20260713_abcdef123456",
        tableId: "table_abcdef123456",
        schemaId,
        columnIds: ["column_abcdef123456", "column_bcdefa123456"],
        rowIds: ["row_abcdef123456"],
        range: { startRow: 1, endRow: 1 },
        queryPlanHash: planHash,
        resultHash,
        sourceId: "src_20260713_abcdef12",
        sourceRevisionHash
      }
    }],
    datasetResult: {
      datasetId: "dataset_20260713_abcdef123456",
      revisionId: "dataset_rev_20260713_abcdef123456",
      tableId: "table_abcdef123456",
      tableName: "Regional totals",
      planHash,
      resultHash,
      columns: [
        {
          key: "region",
          label: "Region",
          logicalType: "string",
          sourceColumnId: "column_abcdef123456"
        },
        {
          key: "record_count",
          label: "Records",
          logicalType: "integer",
          sourceColumnId: "column_bcdefa123456",
          aggregate: "count"
        }
      ],
      rows: [{ rowId: "row_abcdef123456", values: ["North", 3] }],
      matchedRowCount: 1,
      returnedRowCount: 1,
      truncated: false,
      citationRefs: ["dataset_citation_1"]
    }
  };
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (caught) {
    return caught;
  }
  throw new Error("Expected action to throw.");
}
