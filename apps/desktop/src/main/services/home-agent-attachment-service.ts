import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentAttachmentCandidate,
  AgentStagedItem,
  AgentSubmitTurnRequest,
  CaptureFileRejection,
  CaptureFileRejectionReason,
  CaptureFilesSubmitResult,
  SubmitFilesCaptureRequest
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { AGENT_STAGED_ITEM_MAX_COUNT } from "@pige/schemas";
import type { AgentSourceToolSession } from "./agent-ingest-service";
import {
  createPigeTextToolResult,
  type PigeAgentToolDefinition
} from "./pi-agent-runtime-adapter";
import {
  safeAttachmentDisplayName,
  supportedFileSourceKind,
  type AgentTurnFilePreservationBinding,
  type AgentTurnTextPreservationBinding,
  type AgentTurnTextPreservationRequest,
  type AgentTurnTextPreservationResult
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
  preserveTextForAgentTurn(
    request: AgentTurnTextPreservationRequest,
    binding: AgentTurnTextPreservationBinding
  ): AgentTurnTextPreservationResult;
}

interface PreparedFileInput {
  readonly kind: "file";
  readonly ordinal: number;
  readonly filePath: string;
  readonly displayName: string;
  readonly inputChecksum: string;
  readonly size: number;
}

interface PreparedLargePasteInput {
  readonly kind: "large_paste";
  readonly ordinal: number;
  readonly text: string;
  readonly displayName: "Pasted text";
  readonly inputChecksum: string;
  readonly size: number;
}

type PreparedAttachmentInput = PreparedFileInput | PreparedLargePasteInput;

export interface PreparedHomeAgentAttachments {
  readonly attachmentSetHash: string;
  readonly usesStagedItems: boolean;
  readonly entries: readonly PreparedAttachmentInput[];
  readonly rejectedFiles: readonly CaptureFileRejection[];
  readonly rejectedItems: readonly {
    readonly ordinal: number;
    readonly kind: "file";
    readonly displayName: string;
    readonly reason: CaptureFileRejectionReason;
  }[];
}

export interface PreservedHomeAgentAttachments {
  readonly status: "preserved" | "failed";
  readonly attachmentSetHash: string;
  readonly sourceIds: readonly string[];
  readonly rejectedFiles: readonly CaptureFileRejection[];
  readonly rejectedItems?: PreparedHomeAgentAttachments["rejectedItems"];
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

  async prepare(
    candidates: readonly AgentAttachmentCandidate[],
    stagedItems?: readonly AgentStagedItem[]
  ): Promise<PreparedHomeAgentAttachments> {
    const entries: PreparedAttachmentInput[] = [];
    const rejectedFiles: CaptureFileRejection[] = [];
    const rejectedItems: Array<{
      ordinal: number;
      kind: "file";
      displayName: string;
      reason: CaptureFileRejectionReason;
    }> = [];
    const reject = (ordinal: number, displayName: string, reason: CaptureFileRejectionReason): void => {
      rejectedFiles.push({ displayName, reason });
      if (stagedItems !== undefined) {
        rejectedItems.push({ ordinal, kind: "file", displayName, reason });
      }
    };
    const hashEntries: unknown[] = [];
    const seen = new Set<string>();
    let acceptedBytes = 0;

    const orderedItems: readonly AgentStagedItem[] = stagedItems ?? candidates.map((candidate, index) => ({
      kind: "file" as const,
      ordinal: candidate.ordinal ?? index,
      displayName: candidate.displayName
    }));
    const candidatesByOrdinal = new Map(candidates.map((candidate, index) => [candidate.ordinal ?? index, candidate]));
    for (const [index, item] of orderedItems.entries()) {
      if (item.kind === "large_paste") {
        const inputChecksum = sha256(item.text);
        entries.push({
          kind: "large_paste",
          ordinal: item.ordinal,
          text: item.text,
          displayName: "Pasted text",
          inputChecksum,
          size: item.utf8ByteSize
        });
        hashEntries.push({ index, kind: item.kind, size: item.utf8ByteSize, inputChecksum });
        continue;
      }
      const candidate = candidatesByOrdinal.get(item.ordinal);
      if (!candidate) {
        reject(item.ordinal, item.displayName, "empty_path");
        continue;
      }
      const displayName = safeAttachmentDisplayName(candidate.displayName || candidate.internalPath);
      if (!candidate.internalPath.trim()) {
        reject(item.ordinal, displayName, "empty_path");
        continue;
      }
      const normalizedPath = path.resolve(candidate.internalPath);
      if (seen.has(normalizedPath)) {
        reject(item.ordinal, displayName, "duplicate");
        continue;
      }
      seen.add(normalizedPath);

      if (entries.length >= AGENT_STAGED_ITEM_MAX_COUNT) {
        reject(item.ordinal, displayName, "too_many_files");
        continue;
      }

      const sourceKind = supportedFileSourceKind(normalizedPath);
      if (!sourceKind) {
        reject(item.ordinal, displayName, "unsupported_type");
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(normalizedPath);
      } catch {
        reject(item.ordinal, displayName, "missing");
        continue;
      }
      if (!stat.isFile()) {
        reject(item.ordinal, displayName, "not_regular_file");
        continue;
      }
      if (stat.size > HOME_AGENT_ATTACHMENT_POLICY.maxFileBytes) {
        reject(item.ordinal, displayName, "file_too_large");
        continue;
      }
      if (acceptedBytes + stat.size > HOME_AGENT_ATTACHMENT_POLICY.maxTotalBytes) {
        reject(item.ordinal, displayName, "total_size_exceeded");
        continue;
      }
      acceptedBytes += stat.size;

      let inputChecksum: string;
      try {
        inputChecksum = await checksumFile(normalizedPath);
      } catch {
        reject(item.ordinal, displayName, "copy_failed");
        continue;
      }
      entries.push({
        kind: "file",
        ordinal: item.ordinal,
        filePath: normalizedPath,
        displayName,
        inputChecksum,
        size: stat.size
      });
      hashEntries.push({ index, sourceKind, size: stat.size, inputChecksum });
    }

    return {
      attachmentSetHash: sha256(`pige.agent.attachment-set.v1\0${JSON.stringify(hashEntries)}`),
      usesStagedItems: stagedItems !== undefined,
      entries,
      rejectedFiles,
      rejectedItems
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
      if (entry.kind === "large_paste") {
        try {
          const preserved = this.#capture.preserveTextForAgentTurn({
            text: entry.text,
            locale: request.turn.locale
          }, {
            jobId: request.jobId,
            sourceId,
            inputChecksum: entry.inputChecksum,
            ordinal,
            attachmentSetHash: request.prepared.attachmentSetHash
          });
          if (preserved.sourceId !== sourceId || preserved.inputChecksum !== entry.inputChecksum) {
            throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The pasted-text source binding changed.");
          }
          sourceIds.push(sourceId);
          continue;
        } catch {
          return {
            status: "failed",
            attachmentSetHash: request.prepared.attachmentSetHash,
            sourceIds,
            rejectedFiles: [],
            ...(request.prepared.usesStagedItems ? { rejectedItems: [] } : {})
          };
        }
      }
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
        const rejection = { displayName: entry.displayName, reason: "copy_failed" as const };
        return {
          status: "failed",
          attachmentSetHash: request.prepared.attachmentSetHash,
          sourceIds,
          rejectedFiles: [rejection],
          ...(request.prepared.usesStagedItems
            ? { rejectedItems: [{ ordinal: entry.ordinal, kind: "file" as const, ...rejection }] }
            : {})
        };
      }
      if (
        preserved.status === "rejected" ||
        preserved.rejectedFiles.length > 0 ||
        preserved.sourceIds.length !== 1 ||
        preserved.sourceIds[0] !== sourceId
      ) {
        const rejection = {
          displayName: entry.displayName,
          reason: preserved.rejectedFiles[0]?.reason ?? "copy_failed"
        };
        return {
          status: "failed",
          attachmentSetHash: request.prepared.attachmentSetHash,
          sourceIds,
          rejectedFiles: [rejection],
          ...(request.prepared.usesStagedItems
            ? { rejectedItems: [{ ordinal: entry.ordinal, kind: "file" as const, ...rejection }] }
            : {})
        };
      }
      sourceIds.push(sourceId);
    }
    return {
      status: "preserved",
      attachmentSetHash: request.prepared.attachmentSetHash,
      sourceIds,
      rejectedFiles: [],
      ...(request.prepared.usesStagedItems ? { rejectedItems: [] } : {})
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
