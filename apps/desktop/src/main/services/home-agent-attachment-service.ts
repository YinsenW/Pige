import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentAttachmentCandidate,
  AgentSubmitTurnRequest,
  CaptureFileRejection,
  CaptureFilesSubmitResult,
  SubmitFilesCaptureRequest
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import type { AgentSourceToolSession } from "./agent-ingest-service";
import {
  createPigeTextToolResult,
  type PigeAgentToolDefinition
} from "./pi-agent-runtime-adapter";
import {
  safeAttachmentDisplayName,
  supportedFileSourceKind,
  type AgentTurnFilePreservationBinding
} from "./capture-service";

export const HOME_AGENT_ATTACHMENT_POLICY = Object.freeze({
  maxFiles: 8,
  maxFileBytes: 200 * 1024 * 1024,
  maxTotalBytes: 400 * 1024 * 1024
});

interface HomeAgentAttachmentCapturePort {
  preserveFilesForAgentTurn(
    request: SubmitFilesCaptureRequest,
    binding: AgentTurnFilePreservationBinding
  ): Promise<CaptureFilesSubmitResult>;
}

interface PreparedAttachmentInput {
  readonly filePath: string;
  readonly displayName: string;
  readonly inputChecksum: string;
  readonly size: number;
}

export interface PreparedHomeAgentAttachments {
  readonly attachmentSetHash: string;
  readonly entries: readonly PreparedAttachmentInput[];
  readonly rejectedFiles: readonly CaptureFileRejection[];
}

export interface PreservedHomeAgentAttachments {
  readonly status: "preserved" | "failed";
  readonly attachmentSetHash: string;
  readonly sourceIds: readonly string[];
  readonly rejectedFiles: readonly CaptureFileRejection[];
}

export interface HomeAgentAttachmentToolEntry {
  readonly ref: string;
  readonly displayName: string;
  readonly kind: string;
  readonly session: AgentSourceToolSession;
}

interface PreserveHomeAgentAttachmentsRequest {
  readonly prepared: PreparedHomeAgentAttachments;
  readonly turn: AgentSubmitTurnRequest;
  readonly jobId: string;
  readonly firstSourceId: string;
}

export class HomeAgentAttachmentService {
  readonly #capture: HomeAgentAttachmentCapturePort;
  readonly #inFlight = new Map<string, {
    readonly attachmentSetHash: string;
    readonly result: Promise<PreservedHomeAgentAttachments>;
  }>();

  constructor(capture: HomeAgentAttachmentCapturePort) {
    this.#capture = capture;
  }

  async prepare(candidates: readonly AgentAttachmentCandidate[]): Promise<PreparedHomeAgentAttachments> {
    const entries: PreparedAttachmentInput[] = [];
    const rejectedFiles: CaptureFileRejection[] = [];
    const hashEntries: unknown[] = [];
    const seen = new Set<string>();
    let acceptedBytes = 0;

    for (const [index, candidate] of candidates.entries()) {
      const displayName = safeAttachmentDisplayName(candidate.displayName || candidate.internalPath);
      if (!candidate.internalPath.trim()) {
        rejectedFiles.push({ displayName, reason: "empty_path" });
        continue;
      }
      const normalizedPath = path.resolve(candidate.internalPath);
      if (seen.has(normalizedPath)) {
        rejectedFiles.push({ displayName, reason: "duplicate" });
        continue;
      }
      seen.add(normalizedPath);

      if (entries.length >= HOME_AGENT_ATTACHMENT_POLICY.maxFiles) {
        rejectedFiles.push({ displayName, reason: "too_many_files" });
        continue;
      }

      const sourceKind = supportedFileSourceKind(normalizedPath);
      if (!sourceKind) {
        rejectedFiles.push({ displayName, reason: "unsupported_type" });
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(normalizedPath);
      } catch {
        rejectedFiles.push({ displayName, reason: "missing" });
        continue;
      }
      if (!stat.isFile()) {
        rejectedFiles.push({ displayName, reason: "not_regular_file" });
        continue;
      }
      if (stat.size > HOME_AGENT_ATTACHMENT_POLICY.maxFileBytes) {
        rejectedFiles.push({ displayName, reason: "file_too_large" });
        continue;
      }
      if (acceptedBytes + stat.size > HOME_AGENT_ATTACHMENT_POLICY.maxTotalBytes) {
        rejectedFiles.push({ displayName, reason: "total_size_exceeded" });
        continue;
      }
      acceptedBytes += stat.size;

      let inputChecksum: string;
      try {
        inputChecksum = await checksumFile(normalizedPath);
      } catch {
        rejectedFiles.push({ displayName, reason: "copy_failed" });
        continue;
      }
      entries.push({ filePath: normalizedPath, displayName, inputChecksum, size: stat.size });
      hashEntries.push({ index, sourceKind, size: stat.size, inputChecksum });
    }

    return {
      attachmentSetHash: sha256(`pige.agent.attachment-set.v1\0${JSON.stringify(hashEntries)}`),
      entries,
      rejectedFiles
    };
  }

  preserve(request: PreserveHomeAgentAttachmentsRequest): Promise<PreservedHomeAgentAttachments> {
    const current = this.#inFlight.get(request.jobId);
    if (current) {
      if (current.attachmentSetHash !== request.prepared.attachmentSetHash) {
        throw new PigeDomainError(
          "agent_runtime.turn_conflict",
          "The in-flight attachment set does not match the preserved Agent turn."
        );
      }
      return current.result;
    }
    const result = this.#preserve(request).finally(() => {
      if (this.#inFlight.get(request.jobId)?.result === result) this.#inFlight.delete(request.jobId);
    });
    this.#inFlight.set(request.jobId, { attachmentSetHash: request.prepared.attachmentSetHash, result });
    return result;
  }

  async #preserve(request: PreserveHomeAgentAttachmentsRequest): Promise<PreservedHomeAgentAttachments> {
    const sourceIds: string[] = [];
    for (const [ordinal, entry] of request.prepared.entries.entries()) {
      const sourceId = ordinal === 0
        ? request.firstSourceId
        : createAttachmentSourceId(request.jobId, ordinal);
      let preserved: CaptureFilesSubmitResult;
      try {
        preserved = await this.#capture.preserveFilesForAgentTurn({
          filePaths: [entry.filePath],
          inputKind: request.turn.inputKind === "file_drop" ? "file_drop" : "file_picker",
          userIntent: "unknown",
          locale: request.turn.locale
        }, {
          jobId: request.jobId,
          sourceId,
          inputChecksum: entry.inputChecksum,
          ordinal,
          attachmentSetHash: request.prepared.attachmentSetHash
        });
      } catch {
        return {
          status: "failed",
          attachmentSetHash: request.prepared.attachmentSetHash,
          sourceIds,
          rejectedFiles: [{ displayName: entry.displayName, reason: "copy_failed" }]
        };
      }
      if (
        preserved.status === "rejected" ||
        preserved.rejectedFiles.length > 0 ||
        preserved.sourceIds.length !== 1 ||
        preserved.sourceIds[0] !== sourceId
      ) {
        return {
          status: "failed",
          attachmentSetHash: request.prepared.attachmentSetHash,
          sourceIds,
          rejectedFiles: [{
            displayName: entry.displayName,
            reason: preserved.rejectedFiles[0]?.reason ?? "copy_failed"
          }]
        };
      }
      sourceIds.push(sourceId);
    }
    return {
      status: "preserved",
      attachmentSetHash: request.prepared.attachmentSetHash,
      sourceIds,
      rejectedFiles: []
    };
  }
}

export function createAttachmentSetToolSession(
  entries: readonly HomeAgentAttachmentToolEntry[]
): AgentSourceToolSession {
  if (entries.length < 2 || entries.length > HOME_AGENT_ATTACHMENT_POLICY.maxFiles) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The attachment tool set is invalid.");
  }
  let selected = 0;
  const toolsByName = new Map<string, PigeAgentToolDefinition[]>();
  for (const entry of entries) {
    for (const tool of entry.session.tools) {
      const tools = toolsByName.get(tool.name) ?? [];
      tools.push(tool);
      toolsByName.set(tool.name, tools);
    }
  }
  const listTool: PigeAgentToolDefinition = {
    name: "pige_list_attachments",
    label: "List submitted attachments",
    description: "List the bounded attachments in this exact Agent turn by opaque attachment reference.",
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
    effect: "read_only",
    inputTrust: "model_generated",
    outputTrust: "host_validated",
    dataBoundary: {
      resourceScope: "current_source",
      pathAuthority: "host_only",
      sourceIdAuthority: "host_only",
      modelAuthority: "none"
    },
    execution: "sequential",
    idempotency: { mode: "idempotent", scope: "current_source" },
    limits: { maxInputBytes: 2, maxOutputBytes: 16_384, timeoutMs: 1_000 },
    ownerService: "HomeAgentAttachmentService",
    execute: async () => createPigeTextToolResult(
      JSON.stringify(entries.map((entry) => ({
        attachmentRef: entry.ref,
        displayName: entry.displayName,
        kind: entry.kind
      }))),
      { attachmentCount: entries.length }
    )
  };
  const selectTool: PigeAgentToolDefinition = {
    ...listTool,
    name: "pige_select_attachment",
    label: "Select submitted attachment",
    description: "Select one opaque attachment reference for subsequent source inspection, parsing, OCR, or Dataset tools.",
    parameters: {
      type: "object",
      properties: { attachmentRef: { type: "string", enum: entries.map((entry) => entry.ref) } },
      required: ["attachmentRef"],
      additionalProperties: false
    },
    limits: { maxInputBytes: 128, maxOutputBytes: 1_024, timeoutMs: 1_000 },
    execute: async (args) => {
      const ref = isRecord(args) && typeof args.attachmentRef === "string" ? args.attachmentRef : undefined;
      const index = entries.findIndex((entry) => entry.ref === ref);
      if (index < 0) {
        throw new PigeDomainError("agent_runtime.tool_input_invalid", "The attachment reference is invalid.");
      }
      selected = index;
      return createPigeTextToolResult(
        JSON.stringify({ attachmentRef: entries[index]!.ref, selected: true }),
        { selected: true }
      );
    }
  };
  const delegatedTools = Array.from(toolsByName.entries()).flatMap(([name, tools]) => {
    if (tools.length !== entries.length) return [];
    const exemplar = tools[0]!;
    return [{
      ...exemplar,
      execution: "sequential" as const,
      authorize: async (args, context) => {
        const delegate = tools[selected]!;
        return delegate.authorize ? delegate.authorize(args, context) : true;
      },
      execute: async (args, signal, context, onUpdate) =>
        tools[selected]!.execute(args, signal, context, onUpdate)
    } satisfies PigeAgentToolDefinition];
  });
  return {
    tools: [listTool, selectTool, ...delegatedTools],
    bindCatalog: (catalogHash) => {
      for (const entry of entries) entry.session.bindCatalog(catalogHash);
    },
    beforeModelTurn: async () => {
      for (const entry of entries) await entry.session.beforeModelTurn();
    },
    result: () => entries.map((entry) => entry.session.result()).findLast((result) => result !== undefined)
  };
}

export function createAttachmentSourceId(jobId: string, ordinal: number): string {
  const match = /^job_(\d{8})_[a-z0-9]{8,}$/u.exec(jobId);
  if (!match || ordinal < 1 || ordinal >= HOME_AGENT_ATTACHMENT_POLICY.maxFiles) {
    throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Agent attachment source identity is invalid.");
  }
  const suffix = createHash("sha256")
    .update(`pige.agent.attachment-source.v1\0${jobId}\0${ordinal}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `src_${match[1]}_${suffix}`;
}

async function checksumFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return `sha256:${hash.digest("hex")}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
