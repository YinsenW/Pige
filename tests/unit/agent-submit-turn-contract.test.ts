import type { AgentSubmitTurnIpcPayload } from "@pige/contracts";
import fs from "node:fs";
import path from "node:path";
import {
  AGENT_AUTHORED_TEXT_MAX_CODE_POINTS,
  AGENT_LARGE_PASTE_ITEM_MAX_UTF8_BYTES,
  AgentSubmitTurnIpcPayloadSchema,
  AgentSubmitTurnAcceptedResultSchema,
  AgentStagedSubmitTurnResultSchema,
  AgentSubmitTurnResultSchema,
  CaptureFileRejectionSchema
} from "@pige/schemas";
import { describe, expect, it } from "vitest";

describe("Agent submit-turn attachment boundary", () => {
  it.each(["file_drop", "file_picker"] as const)(
    "accepts an ordered bounded candidate set for %s without inventing renderer file identity",
    (inputKind) => {
      const attachments = [
        { displayName: "first.txt", internalPath: "/private/tmp/first.txt" },
        { displayName: "second.md", internalPath: "/private/tmp/second.md" },
        { displayName: "first.txt", internalPath: "/private/tmp/first.txt" }
      ];
      const payload = AgentSubmitTurnIpcPayloadSchema.parse({
        request: {
          schemaVersion: 1,
          inputKind,
          locale: "en",
          clientTurnId: "turn_20260722_attachment001"
        },
        attachments
      }) satisfies AgentSubmitTurnIpcPayload;

      expect(payload.attachments).toEqual(attachments);
      expect(payload.request).not.toHaveProperty("files");
      expect(payload.request).not.toHaveProperty("fileIds");
    }
  );

  it("preserves exact authored text and uses trim only to reject empty text turns", () => {
    const text = "  Keep my spacing.\n\nAnd this line.  ";
    const parsed = AgentSubmitTurnIpcPayloadSchema.parse({
      request: { inputKind: "typed_text", locale: "en", text },
      attachments: []
    });

    expect(parsed.request.text).toBe(text);
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({
      request: { inputKind: "typed_text", locale: "en", text: " \n\t " },
      attachments: []
    }).success).toBe(false);
    expect(AgentSubmitTurnIpcPayloadSchema.parse({
      request: { inputKind: "file_picker", locale: "en", text: " \n\t " },
      attachments: [{ displayName: "source.txt", internalPath: "/private/tmp/source.txt" }]
    }).request.text).toBe(" \n\t ");
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({
      request: { inputKind: "typed_text", locale: "en", text, objective: "auto" },
      attachments: []
    }).success).toBe(false);
  });

  it("accepts one exact large-paste-only staged source without an OS file candidate", () => {
    const text = "  token=exact\n😀  ";
    const payload = AgentSubmitTurnIpcPayloadSchema.parse({
      request: {
        inputKind: "file_picker",
        locale: "en",
        clientTurnId: "turn_20260723_largepaste001",
        stagedItems: [{
          kind: "large_paste",
          ordinal: 0,
          text,
          unicodeCodePointCount: [...text].length,
          utf8ByteSize: new TextEncoder().encode(text).byteLength
        }]
      },
      attachments: []
    });

    expect(payload.request.stagedItems?.[0]).toMatchObject({ kind: "large_paste", text });
    expect(payload.attachments).toEqual([]);
  });

  it("measures authored text as Unicode code points and cheaply rejects adversarial paste payloads", () => {
    const exactLimit = "😀".repeat(AGENT_AUTHORED_TEXT_MAX_CODE_POINTS);
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({
      request: { inputKind: "typed_text", locale: "en", text: exactLimit },
      attachments: []
    }).success).toBe(true);
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({
      request: { inputKind: "typed_text", locale: "en", text: `${exactLimit}x` },
      attachments: []
    }).success).toBe(false);

    const oversized = "x".repeat(AGENT_LARGE_PASTE_ITEM_MAX_UTF8_BYTES + 1);
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({
      request: {
        inputKind: "file_picker",
        locale: "en",
        stagedItems: [{
          kind: "large_paste",
          ordinal: 0,
          text: oversized,
          unicodeCodePointCount: oversized.length,
          utf8ByteSize: oversized.length
        }]
      },
      attachments: []
    }).success).toBe(false);
  });

  it("parses early accepted and pre-accept failed staged results", () => {
    expect(AgentSubmitTurnAcceptedResultSchema.parse({
      requestId: "turn_20260723_largepaste001",
      jobId: "job_20260723_largepaste01",
      conversationEventId: "evt_20260723_largepaste01",
      conversationId: "conv_20260723_paste",
      tailEventId: "evt_20260723_largepaste01",
      state: "accepted",
      modelUsage: "none",
      sourceIds: ["src_20260723_largepaste01"],
      acceptedItems: [{ ordinal: 0, kind: "large_paste", sourceId: "src_20260723_largepaste01" }],
      rejectedItems: [{ ordinal: 1, kind: "file", displayName: "blocked.exe", reason: "unsupported_type" }]
    }).state).toBe("accepted");
    expect(AgentSubmitTurnAcceptedResultSchema.safeParse({
      requestId: "turn_20260723_largepaste001",
      jobId: "job_20260723_largepaste01",
      conversationEventId: "evt_20260723_largepaste01",
      conversationId: "conv_20260723_paste",
      tailEventId: "evt_20260723_largepaste01",
      state: "accepted",
      modelUsage: "none",
      sourceIds: ["src_20260723_largepaste01", "src_20260723_largepaste02"],
      acceptedItems: [
        { ordinal: 0, kind: "large_paste", sourceId: "src_20260723_largepaste01" },
        { ordinal: 0, kind: "file", sourceId: "src_20260723_largepaste02" }
      ]
    }).success).toBe(false);
    expect(AgentStagedSubmitTurnResultSchema.parse({
      requestId: "turn_20260723_largepaste001",
      state: "failed",
      modelUsage: "none",
      sourceIds: [],
      error: {
        code: "capture.file_rejected",
        domain: "capture",
        messageKey: "errors.agent_runtime.source_turn_failed",
        retryable: true,
        severity: "warning",
        userAction: "retry"
      }
    }).state).toBe("failed");
  });

  it("carries up to 64 candidates, including unresolved paths, for main-owned classification", () => {
    const request = { inputKind: "file_drop" as const, locale: "en" as const };
    expect(AgentSubmitTurnIpcPayloadSchema.parse({
      request,
      attachments: [{ displayName: "only.txt", internalPath: "/tmp/only.txt" }]
    }).attachments).toHaveLength(1);
    expect(AgentSubmitTurnIpcPayloadSchema.parse({
      request,
      attachments: Array.from({ length: 64 }, (_, index) => ({
        displayName: `${index}.txt`,
        internalPath: `/tmp/${index}.txt`
      }))
    }).attachments).toHaveLength(64);
    expect(AgentSubmitTurnIpcPayloadSchema.parse({
      request,
      attachments: [{ displayName: "unresolved.txt", internalPath: "" }]
    }).attachments[0]).toEqual({ displayName: "unresolved.txt", internalPath: "" });
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({ request, attachments: [] }).success).toBe(false);
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({
      request,
      attachments: Array.from({ length: 65 }, (_, index) => ({
        displayName: `${index}.txt`,
        internalPath: `/tmp/${index}.txt`
      }))
    }).success).toBe(false);
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({
      request: { inputKind: "typed_text", locale: "en", text: "hello" },
      attachments: [{ displayName: "source.txt", internalPath: "/tmp/source.txt" }]
    }).success).toBe(false);
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({
      request: { ...request, files: [{ name: "source.txt", size: 42 }] },
      attachments: [{ displayName: "source.txt", internalPath: "/tmp/source.txt" }]
    }).success).toBe(false);
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({
      request,
      attachments: [{ displayName: "source.txt", internalPath: "/tmp/source.txt", size: 42 }]
    }).success).toBe(false);
    expect(AgentSubmitTurnIpcPayloadSchema.safeParse({
      request,
      attachments: [{ ordinal: 0, displayName: "source.txt", internalPath: "/tmp/source.txt" }]
    }).success).toBe(false);
  });

  it("strictly parses bounded path-free rejection results", () => {
    expect(CaptureFileRejectionSchema.safeParse({
      displayName: "safe.txt",
      reason: "unsupported_type",
      path: "/private/tmp/safe.txt"
    }).success).toBe(false);
    expect(CaptureFileRejectionSchema.safeParse({
      displayName: "../unsafe.txt",
      reason: "unsupported_type"
    }).success).toBe(false);

    const result = AgentSubmitTurnResultSchema.parse({
      requestId: "request_attachment_001",
      jobId: "job_20260722_attachment01",
      conversationEventId: "evt_20260722_attachment01",
      conversationId: "conv_20260722_attach",
      tailEventId: "evt_20260722_attachment01",
      state: "waiting",
      modelUsage: "none",
      sourceIds: ["src_20260722_attachment01"],
      rejectedFiles: [{ displayName: "archive.zip", reason: "unsupported_type" }],
      error: {
        code: "agent_runtime.tool_dependency_waiting",
        domain: "agent_runtime",
        messageKey: "errors.agent_runtime.tool_dependency_waiting",
        retryable: true,
        severity: "warning",
        userAction: "repair_tool"
      }
    });
    expect(result.rejectedFiles).toEqual([
      { displayName: "archive.zip", reason: "unsupported_type" }
    ]);
    const { rejectedFiles: _rejectedFiles, ...singleFileCompatibleResult } = result;
    expect(AgentSubmitTurnResultSchema.parse(singleFileCompatibleResult))
      .not.toHaveProperty("rejectedFiles");
    expect(AgentSubmitTurnResultSchema.safeParse({ ...result, rawPath: "/private/tmp" }).success)
      .toBe(false);
  });

  it("keeps drop and picker on one side-effect-free preload adapter", () => {
    const preloadSource = fs.readFileSync(
      path.resolve("apps/desktop/src/preload/index.ts"),
      "utf8"
    );
    const submitTurnAdapter = preloadSource.slice(
      preloadSource.indexOf("submitTurn: (async ("),
      preloadSource.indexOf("onTurnDraft:")
    );

    expect(submitTurnAdapter).toContain("files.map((file, index) => ({");
    expect(submitTurnAdapter).toContain("stagedFileItems === undefined ? {} : { ordinal: stagedFileItems[index]!.ordinal }");
    expect(submitTurnAdapter).not.toContain("ordinal: stagedFileItems?.[index]?.ordinal ?? index");
    expect(submitTurnAdapter).toContain("displayName: stagedFileItems?.[index]?.displayName ?? file.name");
    expect(submitTurnAdapter).toContain("internalPath: webUtils.getPathForFile(file)");
    expect(submitTurnAdapter).toContain("request.stagedItems");
    expect(submitTurnAdapter).toContain("AgentSubmitTurnIpcPayloadSchema.parse({");
    expect(submitTurnAdapter).toContain('ipcRenderer.invoke("agent.submitTurn", payload)');
    expect(submitTurnAdapter).toContain("AgentSubmitTurnIpcResultSchema.parse(");
    expect(submitTurnAdapter).not.toContain("capture.submit");
    expect(submitTurnAdapter.match(/ipcRenderer\.invoke/g)).toHaveLength(1);
  });

  it("returns the staged durable receipt before scheduling model execution", () => {
    const mainSource = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    const handler = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("agent.submitTurn"'),
      mainSource.indexOf('ipcMain.handle("jobs.list"')
    );
    const receiptIndex = handler.indexOf("const receipt = home.acceptPreparedSourceTurn(prepared)");
    const scheduleIndex = handler.indexOf("scheduleAcceptedAgentTurn(() =>");
    const runIndex = handler.indexOf("home.runAcceptedPreparedSourceTurn(prepared, draftContext)");

    expect(receiptIndex).toBeGreaterThan(-1);
    expect(scheduleIndex).toBeGreaterThan(receiptIndex);
    expect(runIndex).toBeGreaterThan(scheduleIndex);
    expect(handler).not.toContain("void home.runAcceptedPreparedSourceTurn");
  });
});
