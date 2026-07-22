import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HomeAgentAttachmentService,
  createAttachmentSetToolSession,
  createAttachmentSourceId
} from "../../apps/desktop/src/main/services/home-agent-attachment-service";
import {
  createPigeAgentToolCatalogHash,
  createPigeTextToolResult
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("HomeAgentAttachmentService", () => {
  it("preserves one ordered attachment set once under deterministic source identities", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-attachment-owner-"));
    roots.push(root);
    const files = ["first.md", "second.txt", "third.pdf"].map((name, index) => {
      const filePath = path.join(root, name);
      fs.writeFileSync(filePath, `attachment-${index}\n`);
      return filePath;
    });
    const preserve = vi.fn(async (_request, binding: { readonly sourceId: string }) => ({
      status: "queued" as const,
      captureId: "cap_20260722_abcdefgh",
      sourceIds: [binding.sourceId],
      jobIds: [],
      conversationEventIds: [],
      rejectedFiles: [],
      preservedAt: "2026-07-22T00:00:00.000Z"
    }));
    const service = new HomeAgentAttachmentService({
      preserveFilesForAgentTurn: preserve,
      preserveTextForAgentTurn: vi.fn()
    });
    const prepared = await service.prepare(files.map((internalPath) => ({
      displayName: path.basename(internalPath),
      internalPath
    })));
    const request = {
      prepared,
      turn: { schemaVersion: 1 as const, inputKind: "file_picker" as const, locale: "en" as const },
      jobId: "job_20260722_abcdefghijkl",
      firstSourceId: "src_20260722_abcdefghijkl"
    };

    const [first, joined] = await Promise.all([service.preserve(request), service.preserve(request)]);

    expect(joined).toEqual(first);
    expect(first).toMatchObject({ status: "preserved", rejectedFiles: [] });
    expect(preserve).toHaveBeenCalledTimes(3);
    expect(first.sourceIds).toEqual([
      request.firstSourceId,
      createAttachmentSourceId(request.jobId, 1),
      createAttachmentSourceId(request.jobId, 2)
    ]);
    expect(preserve.mock.calls.map((call) => call[1])).toEqual(first.sourceIds.map((sourceId, ordinal) => ({
      jobId: request.jobId,
      sourceId,
      inputChecksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      ordinal,
      attachmentSetHash: prepared.attachmentSetHash
    })));
  });

  it("returns a path-free partial failure and retries the same ordered set", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-attachment-partial-"));
    roots.push(root);
    const files = ["first.md", "second.md"].map((name) => {
      const internalPath = path.join(root, name);
      fs.writeFileSync(internalPath, name);
      return { displayName: name, internalPath };
    });
    let failSecond = true;
    const preserve = vi.fn(async (_request, binding: { readonly sourceId: string; readonly ordinal: number }) => {
      if (binding.ordinal === 1 && failSecond) {
        failSecond = false;
        throw new Error("synthetic private copy failure");
      }
      return {
        status: "queued" as const,
        captureId: "cap_20260722_abcdefgh",
        sourceIds: [binding.sourceId],
        jobIds: [],
        conversationEventIds: [],
        rejectedFiles: [],
        preservedAt: "2026-07-22T00:00:00.000Z"
      };
    });
    const service = new HomeAgentAttachmentService({
      preserveFilesForAgentTurn: preserve,
      preserveTextForAgentTurn: vi.fn()
    });
    const prepared = await service.prepare(files);
    const request = {
      prepared,
      turn: { schemaVersion: 1 as const, inputKind: "file_picker" as const, locale: "en" as const },
      jobId: "job_20260722_partialcopy1",
      firstSourceId: "src_20260722_partialcopy1"
    };

    const failed = await service.preserve(request);
    const retried = await service.preserve(request);

    expect(failed).toEqual({
      status: "failed",
      attachmentSetHash: prepared.attachmentSetHash,
      sourceIds: [request.firstSourceId],
      rejectedFiles: [{ displayName: "second.md", reason: "copy_failed" }]
    });
    expect(JSON.stringify(failed)).not.toContain(root);
    expect(retried).toMatchObject({
      status: "preserved",
      sourceIds: [request.firstSourceId, createAttachmentSourceId(request.jobId, 1)],
      rejectedFiles: []
    });
  });

  it("classifies invalid, unresolved, and over-policy candidates before preservation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-attachment-reject-"));
    roots.push(root);
    const valid = path.join(root, "valid.md");
    fs.writeFileSync(valid, "valid");
    const preserve = vi.fn();
    const service = new HomeAgentAttachmentService({
      preserveFilesForAgentTurn: preserve,
      preserveTextForAgentTurn: vi.fn()
    });

    const extra = Array.from({ length: 8 }, (_, index) => {
      const internalPath = path.join(root, `extra-${index}.md`);
      fs.writeFileSync(internalPath, String(index));
      return { displayName: `extra-${index}.md`, internalPath };
    });
    const prepared = await service.prepare([
      { displayName: "unresolved.md", internalPath: "" },
      { displayName: "valid.md", internalPath: valid },
      { displayName: "missing.md", internalPath: path.join(root, "missing.md") },
      ...extra
    ]);

    expect(prepared.entries).toHaveLength(8);
    expect(prepared.rejectedFiles).toEqual([
      { displayName: "unresolved.md", reason: "empty_path" },
      { displayName: "missing.md", reason: "missing" },
      { displayName: "extra-7.md", reason: "too_many_files" }
    ]);
    expect(prepared.rejectedItems).toEqual([]);
    expect(preserve).not.toHaveBeenCalled();
  });

  it("preserves an exact mixed file and pasted-text order under one source-set identity", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-mixed-source-owner-"));
    roots.push(root);
    const filePath = path.join(root, "first.md");
    fs.writeFileSync(filePath, "# First\n", "utf8");
    const preserveFile = vi.fn(async (_request, binding: { readonly sourceId: string }) => ({
      status: "queued" as const,
      captureId: "cap_20260723_mixedowner01",
      sourceIds: [binding.sourceId],
      jobIds: [],
      conversationEventIds: [],
      rejectedFiles: [],
      preservedAt: "2026-07-23T00:00:00.000Z"
    }));
    const preserveText = vi.fn((_request, binding: { readonly sourceId: string; readonly inputChecksum: string }) => ({
      sourceId: binding.sourceId,
      captureId: "cap_20260723_mixedowner02",
      inputChecksum: binding.inputChecksum
    }));
    const service = new HomeAgentAttachmentService({
      preserveFilesForAgentTurn: preserveFile,
      preserveTextForAgentTurn: preserveText
    });
    const pastedText = "  password=literal\n😀  ";
    const stagedItems = [
      { kind: "file" as const, ordinal: 0, displayName: "first.md" },
      {
        kind: "large_paste" as const,
        ordinal: 1,
        text: pastedText,
        unicodeCodePointCount: [...pastedText].length,
        utf8ByteSize: Buffer.byteLength(pastedText)
      },
      { kind: "file" as const, ordinal: 2, displayName: "blocked.exe" }
    ];
    const prepared = await service.prepare(
      [
        { ordinal: 0, displayName: "first.md", internalPath: filePath },
        { ordinal: 2, displayName: "blocked.exe", internalPath: path.join(root, "blocked.exe") }
      ],
      stagedItems
    );
    const result = await service.preserve({
      prepared,
      turn: { schemaVersion: 1, inputKind: "file_picker", locale: "en", stagedItems },
      jobId: "job_20260723_mixedowner01",
      firstSourceId: "src_20260723_mixedowner01"
    });

    expect(result).toMatchObject({
      status: "preserved",
      sourceIds: ["src_20260723_mixedowner01", createAttachmentSourceId("job_20260723_mixedowner01", 1)]
    });
    expect(prepared.rejectedItems).toEqual([
      { ordinal: 2, kind: "file", displayName: "blocked.exe", reason: "unsupported_type" }
    ]);
    expect(preserveText).toHaveBeenCalledWith(
      { text: pastedText, locale: "en" },
      expect.objectContaining({ ordinal: 1, attachmentSetHash: prepared.attachmentSetHash })
    );
  });

  it("retains the exact staged ordinal when file preservation fails after an accepted paste", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-mixed-source-failure-"));
    roots.push(root);
    const filePath = path.join(root, "second.md");
    fs.writeFileSync(filePath, "# Second\n", "utf8");
    const pastedText = "first pasted source";
    const stagedItems = [
      {
        kind: "large_paste" as const,
        ordinal: 0,
        text: pastedText,
        unicodeCodePointCount: pastedText.length,
        utf8ByteSize: Buffer.byteLength(pastedText)
      },
      { kind: "file" as const, ordinal: 1, displayName: "second.md" }
    ];
    const service = new HomeAgentAttachmentService({
      preserveTextForAgentTurn: (_request, binding) => ({
        sourceId: binding.sourceId,
        captureId: "cap_20260723_mixedfail01",
        inputChecksum: binding.inputChecksum
      }),
      preserveFilesForAgentTurn: async () => {
        throw new Error("synthetic copy failure");
      }
    });
    const prepared = await service.prepare(
      [{ ordinal: 1, displayName: "second.md", internalPath: filePath }],
      stagedItems
    );
    const result = await service.preserve({
      prepared,
      turn: { schemaVersion: 1, inputKind: "file_picker", locale: "en", stagedItems },
      jobId: "job_20260723_mixedfail01",
      firstSourceId: "src_20260723_mixedfail01"
    });

    expect(result).toMatchObject({
      status: "failed",
      sourceIds: ["src_20260723_mixedfail01"],
      rejectedFiles: [{ displayName: "second.md", reason: "copy_failed" }],
      rejectedItems: [{ ordinal: 1, kind: "file", displayName: "second.md", reason: "copy_failed" }]
    });
  });

  it("routes shared source tools through the exact selected opaque attachment", async () => {
    const calls: string[] = [];
    const session = (name: string) => ({
      tools: [{
        name: "pige_inspect_source",
        label: "Inspect",
        description: "Inspect selected source",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        version: "1",
        capability: "read_current_source",
        outputSchema: {
          type: "object",
          properties: {
            modelText: { type: "string" },
            details: { type: "object" },
            terminate: { type: "boolean" }
          },
          required: ["modelText", "details"],
          additionalProperties: false
        },
        effect: "read_only" as const,
        inputTrust: "model_generated" as const,
        outputTrust: "host_validated" as const,
        dataBoundary: {
          resourceScope: "current_source" as const,
          pathAuthority: "host_only" as const,
          sourceIdAuthority: "host_only" as const,
          modelAuthority: "none" as const
        },
        execution: "parallel_read_only" as const,
        idempotency: { mode: "idempotent" as const, scope: "current_source" as const },
        limits: { maxInputBytes: 2, maxOutputBytes: 1024, timeoutMs: 1000 },
        ownerService: "test",
        execute: async () => {
          calls.push(name);
          return createPigeTextToolResult(name, {});
        }
      }],
      bindCatalog: vi.fn(),
      beforeModelTurn: vi.fn(async () => undefined),
      result: () => undefined
    });
    const toolSession = createAttachmentSetToolSession([
      { ref: "attachment_1", displayName: "one.md", kind: "markdown_file", session: session("one") },
      { ref: "attachment_2", displayName: "two.md", kind: "markdown_file", session: session("two") }
    ]);
    const context = { toolCallId: "tool_1", signal: new AbortController().signal };
    const select = toolSession.tools.find((tool) => tool.name === "pige_select_attachment")!;
    const inspect = toolSession.tools.find((tool) => tool.name === "pige_inspect_source")!;

    expect(createPigeAgentToolCatalogHash(toolSession.tools)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    await inspect.execute({}, context.signal, context);
    await select.execute({ attachmentRef: "attachment_2" }, context.signal, context);
    await inspect.execute({}, context.signal, context);

    expect(calls).toEqual(["one", "two"]);
  });
});
