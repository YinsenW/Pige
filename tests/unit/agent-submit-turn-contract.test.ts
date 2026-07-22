import type { AgentSubmitTurnIpcPayload } from "@pige/contracts";
import fs from "node:fs";
import path from "node:path";
import {
  AgentSubmitTurnIpcPayloadSchema,
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
      preloadSource.indexOf("submitTurn: async ("),
      preloadSource.indexOf("onTurnDraft:")
    );

    expect(submitTurnAdapter).toContain("files.map((file) => ({");
    expect(submitTurnAdapter).toContain("displayName: file.name");
    expect(submitTurnAdapter).toContain("internalPath: webUtils.getPathForFile(file)");
    expect(submitTurnAdapter).toContain("AgentSubmitTurnIpcPayloadSchema.parse({");
    expect(submitTurnAdapter).toContain('ipcRenderer.invoke("agent.submitTurn", payload)');
    expect(submitTurnAdapter).toContain("AgentSubmitTurnResultSchema.parse(");
    expect(submitTurnAdapter).not.toContain(".filter(");
    expect(submitTurnAdapter).not.toContain("capture.submit");
    expect(submitTurnAdapter.match(/ipcRenderer\.invoke/g)).toHaveLength(1);
  });
});
