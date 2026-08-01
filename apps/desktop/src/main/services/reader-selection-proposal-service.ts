import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  PigeErrorSummary,
  ReaderSelectionIdentity,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalDecisionResult,
  ReaderSelectionProposalGetRequest,
  ReaderSelectionProposalGetResult,
  ReaderSelectionProposalPreview,
  ReaderSelectionTransformAction,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  JobIdSchema,
  OperationIdSchema,
  ReaderSelectionIdentitySchema,
  ReaderSelectionProposalIdSchema,
  ReaderSelectionProposalStateSchema,
  ReaderSelectionTransformActionSchema,
  VaultIdSchema,
  type JobRecord,
  type OperationRecord
} from "@pige/schemas";
import { z } from "zod";
import { containsRestrictedModelContent } from "./model-egress-content";
import {
  createReaderSelectionPublicationIntentHash,
  createReaderSelectionReviewResolution
} from "./reader-selection-job-binding";
import type {
  ReaderSelectionConflictDecision,
  ReaderSelectionConflictInput,
  ReaderSelectionConflictState
} from "./reader-selection-conflict-service";
import type { ResolveJobReviewInput } from "./job-execution-coordinator";

const MAX_RECORD_BYTES = 64 * 1024;
const MAX_REPLACEMENT_BYTES = 16 * 1024;
const MAX_PREVIEW_LINES = 8;
const MAX_PREVIEW_LINE_CHARACTERS = 160;
const REVIEW_REPLACEMENT_BYTES = 4 * 1024;

export function readerSelectionContentRestricted(message: string): PigeDomainError {
  return new PigeDomainError("agent_ingest.update_content_restricted", message);
}

const ReaderSelectionProposalRecordSchema = z.object({
  schemaVersion: z.literal(1),
  proposalId: ReaderSelectionProposalIdSchema,
  revision: z.number().int().min(1),
  state: ReaderSelectionProposalStateSchema,
  activeVaultId: VaultIdSchema,
  jobId: JobIdSchema,
  action: ReaderSelectionTransformActionSchema,
  selection: ReaderSelectionIdentitySchema,
  replacement: z.string().min(1).max(MAX_REPLACEMENT_BYTES),
  modelProfileId: z.string().regex(/^model_[a-z0-9_]+$/),
  previewLines: z.array(z.object({
    kind: z.enum(["context", "removed", "added"]),
    text: z.string().min(1).max(MAX_PREVIEW_LINE_CHARACTERS)
  }).strict()).max(MAX_PREVIEW_LINES),
  intentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  operationId: OperationIdSchema.optional()
}).strict();

type ReaderSelectionProposalRecord = z.infer<typeof ReaderSelectionProposalRecordSchema>;

export interface ReaderSelectionProposalVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface ReaderSelectionProposalJobPort {
  readAgentTurnJob(jobId: string): JobRecord | undefined;
  resolveAgentTurnReview(input: ResolveJobReviewInput & { readonly job: JobRecord }): JobRecord;
}

export interface ReaderSelectionProposalWriterPort {
  apply(input: {
    readonly vaultPath: string;
    readonly job: JobRecord;
    readonly selection: ReaderSelectionIdentity;
    readonly replacement: string;
    readonly action: ReaderSelectionTransformAction;
  }): OperationRecord;
}

export interface ReaderSelectionCreateNoteProposalPort {
  get(request: ReaderSelectionProposalGetRequest): ReaderSelectionProposalGetResult | undefined;
  decide(request: ReaderSelectionProposalDecisionRequest): ReaderSelectionProposalDecisionResult | undefined;
}

export interface ReaderSelectionConflictPort {
  read(input: ReaderSelectionConflictInput): ReaderSelectionConflictState;
  resolve(input: ReaderSelectionConflictInput & {
    readonly expectedCurrentRevision: string;
    readonly decision: ReaderSelectionConflictDecision;
  }): ReaderSelectionConflictState;
}

export class ReaderSelectionProposalService {
  readonly #vaults: ReaderSelectionProposalVaultPort;
  readonly #jobs: ReaderSelectionProposalJobPort;
  readonly #writer: ReaderSelectionProposalWriterPort;
  readonly #createNotes: ReaderSelectionCreateNoteProposalPort | undefined;
  readonly #conflicts: ReaderSelectionConflictPort | undefined;

  constructor(
    vaults: ReaderSelectionProposalVaultPort,
    jobs: ReaderSelectionProposalJobPort,
    writer: ReaderSelectionProposalWriterPort,
    createNotes?: ReaderSelectionCreateNoteProposalPort,
    conflicts?: ReaderSelectionConflictPort
  ) {
    this.#vaults = vaults;
    this.#jobs = jobs;
    this.#writer = writer;
    this.#createNotes = createNotes;
    this.#conflicts = conflicts;
  }

  shouldRequireReview(selection: ReaderSelectionIdentity, replacement: string): boolean {
    const replacementBytes = Buffer.byteLength(replacement, "utf8");
    const selectedBytes = selection.span.endExclusive - selection.span.start;
    return replacementBytes > REVIEW_REPLACEMENT_BYTES ||
      replacementBytes > selectedBytes * 2 + 512;
  }

  stage(input: {
    readonly job: JobRecord;
    readonly action: ReaderSelectionTransformAction;
    readonly selection: ReaderSelectionIdentity;
    readonly selectedText: string;
    readonly replacement: string;
    readonly modelProfileId: string;
  }): ReaderSelectionProposalPreview {
    const { vault, vaultPath } = this.#requireVault();
    if (input.job.activeVaultId !== vault.vaultId || input.job.class !== "agent_turn") {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The Reader proposal Job binding is invalid.");
    }
    if (Buffer.byteLength(input.replacement, "utf8") > MAX_REPLACEMENT_BYTES) {
      throw readerSelectionContentRestricted("The Reader transform replacement is too large.");
    }
    if (containsRestrictedModelContent(input.replacement)) {
      throw readerSelectionContentRestricted("The Reader transform replacement contains restricted content.");
    }
    if (
      input.action === "shorten" &&
      Buffer.byteLength(input.replacement, "utf8") >= input.selection.span.endExclusive - input.selection.span.start
    ) {
      throw readerSelectionContentRestricted("The Shorten replacement must be shorter than the exact selection.");
    }
    const proposalId = createReaderSelectionProposalId(input.job.id);
    const intentHash = createReaderSelectionPublicationIntentHash(
      input.job.id,
      input.action,
      input.selection,
      input.replacement
    );
    const existing = readRecord(vaultPath, proposalId);
    if (existing) {
      if (existing.intentHash !== intentHash || existing.activeVaultId !== vault.vaultId ||
        existing.modelProfileId !== input.modelProfileId) {
        throw new PigeDomainError("proposal.identity_conflict", "The Reader proposal identity is already bound to another intent.");
      }
      return project(existing, input.selectedText);
    }
    const now = new Date().toISOString();
    const record = ReaderSelectionProposalRecordSchema.parse({
      schemaVersion: 1,
      proposalId,
      revision: 1,
      state: "ready",
      activeVaultId: vault.vaultId,
      jobId: input.job.id,
      action: input.action,
      selection: input.selection,
      replacement: input.replacement,
      modelProfileId: input.modelProfileId,
      previewLines: createPreviewLines(input.selectedText, input.replacement),
      intentHash,
      createdAt: now,
      updatedAt: now
    });
    writeRecordCreate(vaultPath, record);
    return project(requireRecord(vaultPath, proposalId), input.selectedText);
  }

  get(request: ReaderSelectionProposalGetRequest): ReaderSelectionProposalGetResult {
    const createNote = this.#createNotes?.get(request);
    if (createNote) return createNote;
    const current = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!current || !vaultPath) return { apiVersion: 1, status: "unavailable", reason: "vault_changed" };
    try {
      const record = readRecord(vaultPath, request.proposalId);
      if (!record) return { apiVersion: 1, status: "unavailable", reason: "not_found" };
      if (record.activeVaultId !== current.vaultId) {
        return { apiVersion: 1, status: "unavailable", reason: "vault_changed" };
      }
      return { apiVersion: 1, status: "available", proposal: this.#project(vaultPath, this.#reconcile(vaultPath, record)) };
    } catch {
      return { apiVersion: 1, status: "unavailable", reason: "record_invalid" };
    }
  }

  readPublication(input: {
    readonly job: JobRecord;
    readonly action: ReaderSelectionTransformAction;
    readonly selection: ReaderSelectionIdentity;
    readonly replacement: string;
    readonly modelProfileId: string;
  }): ReaderSelectionProposalPreview | undefined {
    const { vault, vaultPath } = this.#requireVault();
    const proposalId = createReaderSelectionProposalId(input.job.id);
    const record = readRecord(vaultPath, proposalId);
    if (!record) return undefined;
    const expectedIntentHash = createReaderSelectionPublicationIntentHash(
      input.job.id,
      input.action,
      input.selection,
      input.replacement
    );
    if (
      record.activeVaultId !== vault.vaultId ||
      record.jobId !== input.job.id ||
      record.intentHash !== expectedIntentHash ||
      record.action !== input.action ||
      record.modelProfileId !== input.modelProfileId ||
      !isDeepStrictEqual(record.selection, input.selection) ||
      record.replacement !== input.replacement
    ) {
      throw new PigeDomainError(
        "agent_runtime.turn_binding_invalid",
        "The durable Reader proposal does not match its exact publication intent."
      );
    }
    return this.#project(vaultPath, this.#reconcile(vaultPath, record));
  }

  decide(request: ReaderSelectionProposalDecisionRequest): ReaderSelectionProposalDecisionResult {
    const createNote = this.#createNotes?.decide(request);
    if (createNote) return createNote;
    try {
      return this.#decide(request);
    } catch (caught) {
      if (caught instanceof PigeDomainError && new Set([
        "proposal.not_found",
        "proposal.revision_conflict",
        "vault.no_active_vault"
      ]).has(caught.code)) {
        return { apiVersion: 1, status: "stale" };
      }
      return { apiVersion: 1, status: "failed", error: proposalFailureError() };
    }
  }

  #decide(request: ReaderSelectionProposalDecisionRequest): ReaderSelectionProposalDecisionResult {
    const { vault, vaultPath } = this.#requireVault();
    const current = readRecord(vaultPath, request.proposalId);
    if (!current || current.activeVaultId !== vault.vaultId) {
      return { apiVersion: 1, status: "stale" };
    }
    if (current.revision !== request.expectedRevision) {
      return { apiVersion: 1, status: "stale", proposal: this.#project(vaultPath, this.#reconcile(vaultPath, current)) };
    }
    if (current.state === "conflicted") {
      return this.#resolveConflict(vaultPath, current, request);
    }
    if (current.state !== "ready") {
      return { apiVersion: 1, status: "stale", proposal: this.#project(vaultPath, this.#reconcile(vaultPath, current)) };
    }
    if (isConflictDecision(request.decision)) {
      return { apiVersion: 1, status: "stale", proposal: this.#project(vaultPath, current) };
    }
    if (request.decision === "reject") {
      const rejected = replaceRecord(vaultPath, current, { state: "rejected" });
      const job = this.#jobs.readAgentTurnJob(current.jobId);
      if (!job) return { apiVersion: 1, status: "stale", proposal: project(rejected) };
      try {
        this.#resolveReview(job, { proposalId: current.proposalId, result: "completed" });
      } catch {
        // The durable rejection remains authoritative; get() retries Job reconciliation.
      }
      return { apiVersion: 1, status: "rejected", proposal: this.#project(vaultPath, rejected) };
    }

    const resolving = replaceRecord(vaultPath, current, { state: "resolving" });
    const job = this.#jobs.readAgentTurnJob(current.jobId);
    if (!job) {
      const conflicted = replaceRecord(vaultPath, resolving, { state: "conflicted" });
      return { apiVersion: 1, status: "conflicted", proposal: this.#project(vaultPath, conflicted) };
    }
    let operation: OperationRecord;
    try {
      operation = this.#writer.apply({
        vaultPath,
        job,
        selection: current.selection,
        replacement: current.replacement,
        action: current.action
      });
    } catch (caught) {
      const conflicted = replaceRecord(vaultPath, resolving, { state: "conflicted" });
      if (isExpectedConflict(caught)) {
        const proposal = this.#project(vaultPath, conflicted);
        if (proposal.currentRevision) {
          return { apiVersion: 1, status: "conflicted", proposal };
        }
      }
      const error = conflictError();
      try {
        this.#resolveReview(job, {
          proposalId: current.proposalId,
          result: "failed_final",
          error
        });
      } catch {
        // The durable proposal remains conflicted even if its parent Job changed concurrently.
      }
      if (isExpectedConflict(caught)) return { apiVersion: 1, status: "conflicted", proposal: this.#project(vaultPath, conflicted) };
      return { apiVersion: 1, status: "failed", error };
    }

    const applied = replaceRecord(vaultPath, resolving, {
      state: "applied",
      operationId: operation.id
    });
    try {
      this.#resolveReview(job, {
        proposalId: current.proposalId,
        result: "completed",
        operationId: operation.id
      });
    } catch {
      // The durable apply remains authoritative; get() retries Job reconciliation.
    }
    return {
      apiVersion: 1,
      status: "applied",
      proposal: this.#project(vaultPath, applied),
      operationId: operation.id
    };
  }

  #requireVault(): { readonly vault: VaultSummary; readonly vaultPath: string } {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath) {
      throw new PigeDomainError("vault.no_active_vault", "No active vault is available.");
    }
    return { vault, vaultPath };
  }

  #reconcile(vaultPath: string, record: ReaderSelectionProposalRecord): ReaderSelectionProposalRecord {
    let current = record;
    const job = this.#jobs.readAgentTurnJob(current.jobId);
    if (!job) return current;
    if (current.state === "resolving") {
      try {
        const operation = this.#writer.apply({
          vaultPath,
          job,
          selection: current.selection,
          replacement: current.replacement,
          action: current.action
        });
        current = replaceRecord(vaultPath, current, {
          state: "applied",
          operationId: operation.id
        });
      } catch {
        current = replaceRecord(vaultPath, current, { state: "conflicted" });
      }
    }
    if (current.state === "conflicted") {
      const conflict = this.#readConflict(vaultPath, current);
      if (conflict?.state === "rejected") {
        current = replaceRecord(vaultPath, current, { state: "rejected" });
      } else if (conflict?.state === "applied") {
        current = replaceRecord(vaultPath, current, {
          state: "applied",
          operationId: conflict.operation.id
        });
      }
    }
    try {
      if (current.state === "applied" && current.operationId) {
        this.#resolveReview(job, {
          proposalId: current.proposalId,
          result: "completed",
          operationId: current.operationId
        });
      } else if (current.state === "rejected") {
        this.#resolveReview(job, { proposalId: current.proposalId, result: "completed" });
      } else if (current.state === "conflicted") {
        this.#resolveReview(job, {
          proposalId: current.proposalId,
          result: "failed_final",
          error: conflictError()
        });
      }
    } catch {
      // A terminal or concurrently advanced parent already owns the settled state.
    }
    return current;
  }

  #resolveConflict(
    vaultPath: string,
    current: ReaderSelectionProposalRecord,
    request: ReaderSelectionProposalDecisionRequest
  ): ReaderSelectionProposalDecisionResult {
    if (!this.#conflicts || !isConflictDecision(request.decision) || !request.expectedCurrentRevision) {
      return { apiVersion: 1, status: "stale", proposal: this.#project(vaultPath, current) };
    }
    const input = this.#conflictInput(vaultPath, current);
    if (!input) return { apiVersion: 1, status: "stale", proposal: this.#project(vaultPath, current) };
    const result = this.#conflicts.resolve({
      ...input,
      expectedCurrentRevision: request.expectedCurrentRevision,
      decision: request.decision
    });
    if (result.state === "conflicted") {
      return {
        apiVersion: 1,
        status: "stale",
        proposal: project(current, undefined, result)
      };
    }
    if (result.state === "rejected") {
      const rejected = replaceRecord(vaultPath, current, { state: "rejected" });
      try {
        this.#resolveReview(input.job, { proposalId: current.proposalId, result: "completed" });
      } catch {
        // The durable resolution remains authoritative; get() retries Job convergence.
      }
      return { apiVersion: 1, status: "rejected", proposal: project(rejected, undefined, result) };
    }
    const applied = replaceRecord(vaultPath, current, {
      state: "applied",
      operationId: result.operation.id
    });
    try {
      this.#resolveReview(input.job, {
        proposalId: current.proposalId,
        result: "completed",
        operationId: result.operation.id
      });
    } catch {
      // The durable Operation remains authoritative; get() retries Job convergence.
    }
    return {
      apiVersion: 1,
      status: "applied",
      proposal: project(applied, undefined, result),
      operationId: result.operation.id,
      ...(result.createdPageId ? { createdPageId: result.createdPageId } : {})
    };
  }

  #project(vaultPath: string, record: ReaderSelectionProposalRecord): ReaderSelectionProposalPreview {
    const conflict = record.state === "conflicted" ? this.#readConflict(vaultPath, record) : undefined;
    return project(record, undefined, conflict);
  }

  #readConflict(vaultPath: string, record: ReaderSelectionProposalRecord): ReaderSelectionConflictState | undefined {
    const input = this.#conflictInput(vaultPath, record);
    return input && this.#conflicts ? this.#conflicts.read(input) : undefined;
  }

  #conflictInput(vaultPath: string, record: ReaderSelectionProposalRecord): ReaderSelectionConflictInput | undefined {
    const job = this.#jobs.readAgentTurnJob(record.jobId);
    if (!job) return undefined;
    return {
      vaultPath,
      job,
      proposalId: record.proposalId,
      intentHash: record.intentHash,
      selection: record.selection,
      replacement: record.replacement,
      modelProfileId: record.modelProfileId,
      action: record.action,
      previewLines: record.previewLines
    };
  }

  #resolveReview(job: JobRecord, input: {
    readonly proposalId: string;
    readonly result: "completed" | "failed_final";
    readonly operationId?: string;
    readonly error?: PigeErrorSummary;
  }): JobRecord {
    return this.#jobs.resolveAgentTurnReview({
      job,
      ...createReaderSelectionReviewResolution(input)
    });
  }
}

export function createReaderSelectionProposalId(jobId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(jobId)?.[1] ?? "19700101";
  const suffix = createHash("sha256")
    .update(`pige.reader-selection-proposal.v1\0${jobId}`, "utf8")
    .digest("hex")
    .slice(0, 20);
  return `proposal_${dateKey}_${suffix}`;
}

function project(
  record: ReaderSelectionProposalRecord,
  _selectedText?: string,
  conflict?: ReaderSelectionConflictState
): ReaderSelectionProposalPreview {
  return {
    proposalId: record.proposalId,
    action: record.action,
    state: conflict?.state ?? record.state,
    revision: record.revision,
    ...(conflict?.state === "conflicted" ? { currentRevision: conflict.currentRevision } : {}),
    lines: [...(conflict?.lines ?? record.previewLines)]
  };
}

function isConflictDecision(
  decision: ReaderSelectionProposalDecisionRequest["decision"]
): decision is ReaderSelectionConflictDecision {
  return decision === "keep_current" || decision === "apply_proposed" || decision === "save_proposed_as_new_page";
}

function createPreviewLines(selectedText: string, replacement: string): ReaderSelectionProposalPreview["lines"] {
  const removed = boundedLines(selectedText, "removed", 4);
  const added = boundedLines(replacement, "added", Math.max(1, MAX_PREVIEW_LINES - removed.length));
  return [...removed, ...added].slice(0, MAX_PREVIEW_LINES);
}

function boundedLines(
  text: string,
  kind: "removed" | "added",
  limit: number
): ReaderSelectionProposalPreview["lines"] {
  return text.split(/\r?\n/u)
    .map((line) => line.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0 && !containsRestrictedModelContent(line))
    .slice(0, limit)
    .map((line) => ({ kind, text: line.slice(0, MAX_PREVIEW_LINE_CHARACTERS) }));
}

function recordsDirectory(vaultPath: string): string {
  return path.join(vaultPath, ".pige", "reader-selection-proposals");
}

function recordPath(vaultPath: string, proposalId: string): string {
  ReaderSelectionProposalIdSchema.parse(proposalId);
  return path.join(recordsDirectory(vaultPath), `${proposalId}.json`);
}

function requireRecord(vaultPath: string, proposalId: string): ReaderSelectionProposalRecord {
  const record = readRecord(vaultPath, proposalId);
  if (!record) throw new PigeDomainError("proposal.not_found", "Reader proposal record was not found.");
  return record;
}

function readRecord(vaultPath: string, proposalId: string): ReaderSelectionProposalRecord | undefined {
  const filePath = recordPath(vaultPath, proposalId);
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.lstatSync(filePath);
  const realVault = fs.realpathSync(vaultPath);
  const realFile = fs.realpathSync(filePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > MAX_RECORD_BYTES ||
    !realFile.startsWith(`${realVault}${path.sep}`)
  ) {
    throw new PigeDomainError("proposal.record_invalid", "Reader proposal record is not a private regular file.");
  }
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const current = fs.fstatSync(descriptor);
    if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size) {
      throw new PigeDomainError("proposal.record_invalid", "Reader proposal record changed during read.");
    }
    const bytes = Buffer.alloc(current.size);
    if (fs.readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) {
      throw new PigeDomainError("proposal.record_invalid", "Reader proposal record could not be read exactly.");
    }
    return ReaderSelectionProposalRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeRecordCreate(vaultPath: string, record: ReaderSelectionProposalRecord): void {
  const directory = recordsDirectory(vaultPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  const realVault = fs.realpathSync(vaultPath);
  const realDirectory = fs.realpathSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !realDirectory.startsWith(`${realVault}${path.sep}`)
  ) {
    throw new PigeDomainError("proposal.record_invalid", "Reader proposal directory is unsafe.");
  }
  const filePath = recordPath(vaultPath, record.proposalId);
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    if (bytes.length > MAX_RECORD_BYTES) throw new PigeDomainError("proposal.record_invalid", "Reader proposal record is too large.");
    fs.writeSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function replaceRecord(
  vaultPath: string,
  expected: ReaderSelectionProposalRecord,
  patch: { readonly state: ReaderSelectionProposalRecord["state"]; readonly operationId?: string }
): ReaderSelectionProposalRecord {
  const current = requireRecord(vaultPath, expected.proposalId);
  if (current.revision !== expected.revision || current.intentHash !== expected.intentHash) {
    throw new PigeDomainError("proposal.revision_conflict", "Reader proposal changed before commit.");
  }
  const next = ReaderSelectionProposalRecordSchema.parse({
    ...current,
    state: patch.state,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    ...(patch.operationId ? { operationId: patch.operationId } : {})
  });
  const filePath = recordPath(vaultPath, next.proposalId);
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const before = requireRecord(vaultPath, expected.proposalId);
    if (before.revision !== expected.revision || before.intentHash !== expected.intentHash) {
      throw new PigeDomainError("proposal.revision_conflict", "Reader proposal changed before replace.");
    }
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
  return requireRecord(vaultPath, next.proposalId);
}

function conflictError(): PigeErrorSummary {
  return {
    code: "agent_runtime.proposal_conflicted",
    domain: "agent_runtime",
    messageKey: "error.generic",
    retryable: false,
    severity: "error",
    userAction: "none"
  };
}

function proposalFailureError(): PigeErrorSummary {
  return {
    code: "agent_runtime.proposal_decision_failed",
    domain: "agent_runtime",
    messageKey: "error.generic",
    retryable: false,
    severity: "error",
    userAction: "none"
  };
}

function isExpectedConflict(value: unknown): boolean {
  return value instanceof PigeDomainError && new Set([
    "agent_ingest.page_conflict",
    "agent_ingest.update_target_ineligible",
    "agent_runtime.turn_binding_invalid",
    "proposal.revision_conflict"
  ]).has(value.code);
}
