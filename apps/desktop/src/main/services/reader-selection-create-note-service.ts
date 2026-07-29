import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  ReaderSelectionIdentity,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalDecisionResult,
  ReaderSelectionProposalGetRequest,
  ReaderSelectionProposalGetResult,
  ReaderSelectionProposalPreview,
  PigeErrorSummary,
  AgentSubmitTurnRequest,
  AgentSubmitTurnResult,
  ReaderSelectionCreateNoteRequest,
  ReaderSelectionCreateNoteResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import {
  JobRecordSchema,
  OperationRecordSchema,
  PigeErrorSummarySchema,
  ReaderSelectionIdentitySchema,
  ReaderSelectionProposalIdSchema,
  ReaderSelectionProposalStateSchema,
  VaultIdSchema,
  type JobRecord,
  type OperationRecord
} from "@pige/schemas";
import { z } from "zod";
import {
  createGeneratedNoteExclusive,
  readGeneratedNoteExact
} from "./generated-note-file";
import type { ResolveJobReviewInput } from "./job-execution-coordinator";
import { containsRestrictedModelContent } from "./model-egress-content";
import {
  createPigeTextToolResult,
  type PigeAgentToolDefinition
} from "./pi-agent-runtime-adapter";
import type { HomeAgentDraftSnapshot } from "./home-agent-service";
import {
  readCurrentNoteEvidenceBinding,
  readCurrentNoteSelectionEvidenceBinding
} from "./retrieval-evidence-boundary";

const MAX_TITLE_CHARACTERS = 120;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PAGE_BYTES = 32 * 1024;
const MAX_OPERATION_BYTES = 256 * 1024;
const MAX_PROPOSAL_BYTES = 64 * 1024;
const CREATE_NOTE_ROLE = "agent_turn_reader_create_note";
export const HOME_CREATE_READER_SELECTION_NOTE_TOOL_NAME = "pige_create_note_from_reader_selection";

type JobRef = NonNullable<JobRecord["inputRefs"]>[number];

export function createReaderSelectionCreateNoteJobRef(selection: ReaderSelectionIdentity): JobRef {
  return {
    kind: "tool",
    id: "reader_selection_create_note",
    role: CREATE_NOTE_ROLE,
    checksum: selection.pageContentHash
  };
}

export function readReaderSelectionCreateNoteBinding(job: JobRecord): {
  readonly selection: ReaderSelectionIdentity;
  readonly action: "create_note";
} | undefined {
  const refs = job.inputRefs ?? [];
  const actionRefs = refs.filter((ref) => ref.role === CREATE_NOTE_ROLE);
  if (actionRefs.length === 0) return undefined;
  const scope = refs.filter((ref) => ref.role === "agent_turn_current_note_scope");
  const selections = refs.filter((ref) => ref.role === "agent_turn_reader_selection");
  const action = actionRefs[0];
  const selected = selections[0];
  const locator = /^utf8_bytes:(\d+):(\d+)$/u.exec(selected?.locator ?? "");
  const selection = {
    pageId: scope[0]?.id,
    pageContentHash: action?.checksum,
    span: {
      unit: "utf8_bytes" as const,
      start: Number(locator?.[1]),
      endExclusive: Number(locator?.[2])
    },
    selectedContentHash: selected?.checksum
  };
  if (
    actionRefs.length !== 1 || scope.length !== 1 || selections.length !== 1 ||
    action?.kind !== "tool" || action.id !== "reader_selection_create_note" ||
    selected?.kind !== "page" || selected.id !== scope[0]?.id || !locator ||
    !/^page_\d{8}_[a-z0-9]{8,}$/u.test(selection.pageId ?? "") ||
    !/^sha256:[a-f0-9]{64}$/u.test(selection.pageContentHash ?? "") ||
    !/^sha256:[a-f0-9]{64}$/u.test(selection.selectedContentHash ?? "")
  ) {
    throw conflict("The durable Reader create-note binding is invalid.");
  }
  return { selection: selection as ReaderSelectionIdentity, action: "create_note" };
}

export function assertReaderSelectionCreateNoteJobBinding(
  refs: readonly JobRef[],
  selection: ReaderSelectionIdentity | undefined,
  enabled: boolean
): void {
  const actual = refs.filter((ref) => ref.role === CREATE_NOTE_ROLE);
  const expected = enabled && selection ? createReaderSelectionCreateNoteJobRef(selection) : undefined;
  if (actual.length > 1 || !isDeepStrictEqual(actual[0], expected)) {
    throw conflict("The existing Agent Job does not match its Reader create-note authority.");
  }
}

export function createReaderSelectionCreateNoteTool(options: {
  readonly authorize: () => void;
  readonly stage: (input: { readonly title: string; readonly body: string }) => ReaderSelectionProposalPreview;
}): PigeAgentToolDefinition {
  const InputSchema = z.object({
    title: z.string().min(1).max(MAX_TITLE_CHARACTERS),
    body: z.string().min(1).max(MAX_BODY_BYTES)
  }).strict();
  return {
    name: HOME_CREATE_READER_SELECTION_NOTE_TOOL_NAME,
    label: "Create note from Reader selection",
    description: "Stage one standalone note from the exact Host-bound Reader selection for explicit user review.",
    version: "1",
    capability: "write_vault_knowledge",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: MAX_TITLE_CHARACTERS },
        body: { type: "string", minLength: 1, maxLength: MAX_BODY_BYTES }
      },
      required: ["title", "body"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["review_required"] } },
      required: ["status"],
      additionalProperties: false
    },
    effect: "idempotent_write",
    inputTrust: "model_generated",
    outputTrust: "host_validated",
    dataBoundary: {
      resourceScope: "current_note",
      pathAuthority: "host_only",
      sourceIdAuthority: "host_only",
      modelAuthority: "none"
    },
    execution: "sequential",
    idempotency: { mode: "idempotent", scope: "current_note" },
    limits: { maxInputBytes: 20 * 1024, maxOutputBytes: 1_024, timeoutMs: 30_000 },
    ownerService: "ReaderSelectionCreateNoteService",
    authorize: (args) => {
      options.authorize();
      if (!InputSchema.safeParse(args).success) throw new PigeDomainError("agent_runtime.tool_input_invalid", "Create-note tool input is invalid.");
      return true;
    },
    execute: async (args) => {
      options.authorize();
      const parsed = InputSchema.safeParse(args);
      if (!parsed.success) throw new PigeDomainError("agent_runtime.tool_input_invalid", "Create-note tool input is invalid.");
      options.stage(parsed.data);
      return createPigeTextToolResult("The new note was staged for explicit review.", { status: "review_required" });
    }
  };
}

export interface ReaderSelectionCreateNoteIntent {
  readonly proposalId: string;
  readonly selection: ReaderSelectionIdentity;
  readonly title: string;
  readonly body: string;
  readonly modelProfileId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
}

export interface ReaderSelectionCreateNoteAppliedResult {
  readonly operation: OperationRecord;
  readonly pageId: string;
  readonly pagePath: string;
}

export class ReaderSelectionCreateNoteService {
  apply(input: {
    readonly vaultPath: string;
    readonly job: JobRecord;
    readonly intent: ReaderSelectionCreateNoteIntent;
  }): ReaderSelectionCreateNoteAppliedResult {
    const job = requireBoundJob(input.job, input.intent);
    const title = normalizeTitle(input.intent.title);
    const body = normalizeBody(input.intent.body);
    const pageId = createPageId(job.id, input.intent.proposalId);
    const pagePath = createPagePath(pageId);
    const operationId = createOperationId(input.intent.proposalId);
    const createdAt = job.createdAt;
    const markdown = createMarkdown({
      pageId,
      title,
      body,
      createdAt,
      jobId: job.id,
      modelProfileId: input.intent.modelProfileId
    });
    const contentHash = hashText(markdown);
    const operation = createOperation({
      operationId,
      job,
      proposalId: input.intent.proposalId,
      pageId,
      pagePath,
      title,
      contentHash,
      modelProfileId: input.intent.modelProfileId,
      policyContextId: input.intent.policyContextId,
      policyHash: input.intent.policyHash
    });

    const existingOperation = readExactOperation(input.vaultPath, operation);
    if (existingOperation) {
      requireExactPage(input.vaultPath, pagePath, markdown);
      return { operation: existingOperation, pageId, pagePath };
    }

    const absolutePagePath = resolveVaultPath(input.vaultPath, pagePath);
    const pageStatus = createGeneratedNoteExclusive(input.vaultPath, absolutePagePath, markdown);
    if (pageStatus === "exists") requireExactPage(input.vaultPath, pagePath, markdown);
    const committed = commitOperation(input.vaultPath, operation);
    requireExactPage(input.vaultPath, pagePath, markdown);
    return { operation: committed, pageId, pagePath };
  }

  readApplied(input: {
    readonly vaultPath: string;
    readonly job: JobRecord;
    readonly intent: ReaderSelectionCreateNoteIntent;
  }): ReaderSelectionCreateNoteAppliedResult | undefined {
    const job = requireBoundJob(input.job, input.intent);
    const title = normalizeTitle(input.intent.title);
    const body = normalizeBody(input.intent.body);
    const pageId = createPageId(job.id, input.intent.proposalId);
    const pagePath = createPagePath(pageId);
    const markdown = createMarkdown({
      pageId,
      title,
      body,
      createdAt: job.createdAt,
      jobId: job.id,
      modelProfileId: input.intent.modelProfileId
    });
    const operation = createOperation({
      operationId: createOperationId(input.intent.proposalId),
      job,
      proposalId: input.intent.proposalId,
      pageId,
      pagePath,
      title,
      contentHash: hashText(markdown),
      modelProfileId: input.intent.modelProfileId,
      policyContextId: input.intent.policyContextId,
      policyHash: input.intent.policyHash
    });
    const applied = readExactOperation(input.vaultPath, operation);
    if (!applied) return undefined;
    requireExactPage(input.vaultPath, pagePath, markdown);
    return { operation: applied, pageId, pagePath };
  }
}

const CreateNoteProposalRecordSchema = z.object({
  schemaVersion: z.literal(1),
  proposalId: ReaderSelectionProposalIdSchema,
  revision: z.number().int().min(1),
  state: ReaderSelectionProposalStateSchema,
  activeVaultId: VaultIdSchema,
  jobId: z.string().regex(/^job_\d{8}_[a-z0-9]{8,}$/),
  selection: ReaderSelectionIdentitySchema,
  title: z.string().min(1).max(MAX_TITLE_CHARACTERS),
  body: z.string().min(1).max(MAX_BODY_BYTES),
  modelProfileId: z.string().regex(/^model_[a-z0-9_]+$/),
  policyContextId: z.string().min(1),
  policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  intentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  previewLines: z.array(z.object({
    kind: z.enum(["context", "removed", "added"]),
    text: z.string().min(1).max(160)
  }).strict()).max(8),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  operationId: z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/).optional(),
  createdPageId: z.string().regex(/^page_\d{8}_[a-z0-9]{8,}$/).optional()
}).strict().superRefine((record, context) => {
  if ((record.state === "applied") !== (record.operationId !== undefined && record.createdPageId !== undefined)) {
    context.addIssue({ code: "custom", path: ["state"], message: "Applied create-note proposals require exact result identities." });
  }
});

type CreateNoteProposalRecord = z.infer<typeof CreateNoteProposalRecordSchema>;

export interface ReaderSelectionCreateNoteVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface ReaderSelectionCreateNoteJobPort {
  readAgentTurnJob(jobId: string): JobRecord | undefined;
  resolveAgentTurnReview(input: ResolveJobReviewInput & { readonly job: JobRecord }): JobRecord;
}

export interface ReaderSelectionCreateNoteAgentPort {
  submitTurn(request: AgentSubmitTurnRequest, context: {
    readonly currentNoteSelection: ReaderSelectionIdentity;
    readonly currentNoteCreateNoteAction: "create_note";
    readonly assertCurrent: () => void;
    readonly onDraft?: (snapshot: HomeAgentDraftSnapshot) => void;
  }): Promise<AgentSubmitTurnResult>;
}

export class ReaderSelectionCreateNoteActionService {
  constructor(
    readonly vaults: ReaderSelectionCreateNoteVaultPort,
    readonly agent: ReaderSelectionCreateNoteAgentPort,
    readonly proposals: ReaderSelectionCreateNoteProposalService
  ) {}

  async submit(
    request: ReaderSelectionCreateNoteRequest,
    context: {
      readonly renderContextCurrent: () => boolean;
      readonly onDraft?: (snapshot: HomeAgentDraftSnapshot) => void;
    }
  ): Promise<ReaderSelectionCreateNoteResult> {
    const vault = this.vaults.current();
    const vaultPath = this.vaults.activeVaultPath();
    if (!vault || !vaultPath || vault.vaultId !== request.activeVaultId) return createNoteInvalid(request, "vault_unavailable");
    if (!context.renderContextCurrent()) return createNoteInvalid(request, "render_context_changed");
    if (request.selection.span.endExclusive - request.selection.span.start > 8 * 1024) {
      return createNoteInvalid(request, "selection_too_large");
    }
    const assertCurrent = (): void => {
      if (!context.renderContextCurrent() || this.vaults.current()?.vaultId !== request.activeVaultId) {
        throw new PigeDomainError("note_render_stale", "The Reader create-note render owner changed.");
      }
      const current = readCurrentNoteEvidenceBinding(vaultPath, request.selection.pageId);
      if (current.contentHash !== request.selection.pageContentHash) {
        throw new PigeDomainError("note_render_stale", "The Reader create-note page changed.");
      }
      readCurrentNoteSelectionEvidenceBinding(vaultPath, request.selection);
    };
    try {
      assertCurrent();
      const turn = await this.agent.submitTurn({
        schemaVersion: 1,
        text: request.locale.startsWith("zh")
          ? "根据当前选中的内容创建一篇独立笔记，并提交给我确认。"
          : "Create a standalone note from the current selection and submit it for my review.",
        inputKind: "typed_text",
        scope: { kind: "current_note", pageId: request.selection.pageId },
        locale: request.locale,
        clientTurnId: request.clientTurnId
      }, {
        currentNoteSelection: request.selection,
        currentNoteCreateNoteAction: "create_note",
        assertCurrent,
        ...(context.onDraft ? { onDraft: context.onDraft } : {})
      });
      if (turn.state === "waiting") {
        const proposal = this.proposals.readPublication({
          jobId: turn.jobId,
          selection: request.selection
        });
        if (proposal) return {
          apiVersion: 1,
          requestId: request.requestId,
          status: "review_required",
          jobId: turn.jobId,
          conversationEventId: turn.conversationEventId,
          conversationId: turn.conversationId,
          tailEventId: turn.tailEventId,
          proposal
        };
        return {
          apiVersion: 1,
          requestId: request.requestId,
          status: "waiting",
          jobId: turn.jobId,
          conversationEventId: turn.conversationEventId,
          conversationId: turn.conversationId,
          tailEventId: turn.tailEventId,
          error: turn.error
        };
      }
      if (turn.state === "failed") return {
        apiVersion: 1,
        requestId: request.requestId,
        status: "failed",
        ...(turn.jobId ? { jobId: turn.jobId } : {}),
        ...(turn.conversationEventId ? { conversationEventId: turn.conversationEventId } : {}),
        ...(turn.conversationId ? { conversationId: turn.conversationId } : {}),
        ...(turn.tailEventId ? { tailEventId: turn.tailEventId } : {}),
        error: turn.error
      };
      return createNoteInvalid(request, "mutation_ineligible");
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "note_render_stale") {
        return createNoteInvalid(request, "render_context_changed");
      }
      return {
        apiVersion: 1,
        requestId: request.requestId,
        status: "failed",
        error: PigeErrorSummarySchema.parse({
          code: caught instanceof PigeDomainError ? caught.code : "agent_runtime.turn_failed",
          domain: "agent_runtime",
          messageKey: "error.generic",
          retryable: false,
          severity: "error",
          userAction: "none"
        })
      };
    }
  }
}

export class ReaderSelectionCreateNoteProposalService {
  readonly #vaults: ReaderSelectionCreateNoteVaultPort;
  readonly #jobs: ReaderSelectionCreateNoteJobPort;
  readonly #writer: ReaderSelectionCreateNoteService;
  readonly #adoptPage: ((vaultPath: string) => void) | undefined;

  constructor(
    vaults: ReaderSelectionCreateNoteVaultPort,
    jobs: ReaderSelectionCreateNoteJobPort,
    writer = new ReaderSelectionCreateNoteService(),
    adoptPage?: (vaultPath: string) => void
  ) {
    this.#vaults = vaults;
    this.#jobs = jobs;
    this.#writer = writer;
    this.#adoptPage = adoptPage;
  }

  stage(input: {
    readonly job: JobRecord;
    readonly selection: ReaderSelectionIdentity;
    readonly selectedText: string;
    readonly title: string;
    readonly body: string;
    readonly modelProfileId: string;
  }): ReaderSelectionProposalPreview {
    const { vault, vaultPath } = this.#requireVault();
    const job = JobRecordSchema.parse(input.job);
    const binding = readReaderSelectionCreateNoteBinding(job);
    if (!binding || !isDeepStrictEqual(binding.selection, input.selection) || job.activeVaultId !== vault.vaultId ||
      !job.policyContextId || !job.policyHash) {
      throw conflict("The create-note proposal does not match its exact durable turn.");
    }
    const title = normalizeTitle(input.title);
    const body = normalizeBody(input.body);
    if (containsRestrictedModelContent(title) || containsRestrictedModelContent(body)) {
      throw new PigeDomainError("agent_ingest.update_content_restricted", "The create-note proposal contains restricted content.");
    }
    const proposalId = createProposalId(job.id);
    const intentHash = hashText(JSON.stringify({
      jobId: job.id,
      selection: input.selection,
      title,
      body,
      modelProfileId: input.modelProfileId,
      policyContextId: job.policyContextId,
      policyHash: job.policyHash
    }));
    const existing = readProposal(vaultPath, proposalId);
    if (existing) {
      if (existing.activeVaultId !== vault.vaultId || existing.intentHash !== intentHash) {
        throw conflict("The deterministic create-note proposal identity is occupied by another intent.");
      }
      return projectProposal(this.#reconcile(vaultPath, existing));
    }
    const now = new Date().toISOString();
    const record = CreateNoteProposalRecordSchema.parse({
      schemaVersion: 1,
      proposalId,
      revision: 1,
      state: "ready",
      activeVaultId: vault.vaultId,
      jobId: job.id,
      selection: input.selection,
      title,
      body,
      modelProfileId: input.modelProfileId,
      policyContextId: job.policyContextId,
      policyHash: job.policyHash,
      intentHash,
      previewLines: createPreviewLines(input.selectedText, title, body),
      createdAt: now,
      updatedAt: now
    });
    createProposal(vaultPath, record);
    return projectProposal(record);
  }

  readPublication(input: {
    readonly jobId: string;
    readonly selection: ReaderSelectionIdentity;
  }): ReaderSelectionProposalPreview | undefined {
    const { vault, vaultPath } = this.#requireVault();
    const record = readProposal(vaultPath, createProposalId(input.jobId));
    if (!record) return undefined;
    if (record.activeVaultId !== vault.vaultId || record.jobId !== input.jobId ||
      !isDeepStrictEqual(record.selection, input.selection)) {
      throw conflict("The create-note proposal publication binding changed.");
    }
    return projectProposal(this.#reconcile(vaultPath, record));
  }

  get(request: ReaderSelectionProposalGetRequest): ReaderSelectionProposalGetResult | undefined {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath) return undefined;
    const record = readProposal(vaultPath, request.proposalId);
    if (!record) return undefined;
    if (record.activeVaultId !== vault.vaultId) return { apiVersion: 1, status: "unavailable", reason: "vault_changed" };
    try {
      return { apiVersion: 1, status: "available", proposal: projectProposal(this.#reconcile(vaultPath, record)) };
    } catch {
      return { apiVersion: 1, status: "unavailable", reason: "record_invalid" };
    }
  }

  decide(request: ReaderSelectionProposalDecisionRequest): ReaderSelectionProposalDecisionResult | undefined {
    try {
      return this.#decide(request);
    } catch {
      return { apiVersion: 1, status: "failed", error: proposalError("agent_runtime.proposal_decision_failed") };
    }
  }

  #decide(request: ReaderSelectionProposalDecisionRequest): ReaderSelectionProposalDecisionResult | undefined {
    const { vault, vaultPath } = this.#requireVault();
    const current = readProposal(vaultPath, request.proposalId);
    if (!current) return undefined;
    if (current.activeVaultId !== vault.vaultId || current.revision !== request.expectedRevision || current.state !== "ready") {
      return { apiVersion: 1, status: "stale", proposal: projectProposal(this.#reconcile(vaultPath, current)) };
    }
    const job = this.#jobs.readAgentTurnJob(current.jobId);
    if (!job) return { apiVersion: 1, status: "stale", proposal: projectProposal(current) };
    if (request.decision === "reject") {
      const rejected = replaceProposal(vaultPath, current, { state: "rejected" });
      this.#resolve(job, rejected);
      return { apiVersion: 1, status: "rejected", proposal: projectProposal(rejected) };
    }
    const resolving = replaceProposal(vaultPath, current, { state: "resolving" });
    try {
      const result = this.#writer.apply({ vaultPath, job, intent: proposalIntent(resolving) });
      const applied = replaceProposal(vaultPath, resolving, {
        state: "applied",
        operationId: result.operation.id,
        createdPageId: result.pageId
      });
      this.#adoptPage?.(vaultPath);
      this.#resolve(job, applied);
      return {
        apiVersion: 1,
        status: "applied",
        proposal: projectProposal(applied),
        operationId: result.operation.id,
        createdPageId: result.pageId
      };
    } catch (caught) {
      const conflicted = replaceProposal(vaultPath, resolving, { state: "conflicted" });
      this.#resolve(job, conflicted);
      return caught instanceof PigeDomainError
        ? { apiVersion: 1, status: "conflicted", proposal: projectProposal(conflicted) }
        : { apiVersion: 1, status: "failed", error: proposalError("agent_runtime.proposal_decision_failed") };
    }
  }

  #reconcile(vaultPath: string, record: CreateNoteProposalRecord): CreateNoteProposalRecord {
    const job = this.#jobs.readAgentTurnJob(record.jobId);
    if (!job) return record;
    let current = record;
    if (current.state === "resolving") {
      try {
        const result = this.#writer.apply({ vaultPath, job, intent: proposalIntent(current) });
        current = replaceProposal(vaultPath, current, {
          state: "applied",
          operationId: result.operation.id,
          createdPageId: result.pageId
        });
        this.#adoptPage?.(vaultPath);
      } catch {
        current = replaceProposal(vaultPath, current, { state: "conflicted" });
      }
    }
    if (["applied", "rejected", "conflicted"].includes(current.state)) this.#resolve(job, current);
    return current;
  }

  #resolve(job: JobRecord, record: CreateNoteProposalRecord): void {
    try {
      this.#jobs.resolveAgentTurnReview({
        job,
        proposalId: record.proposalId,
        result: record.state === "conflicted" ? "failed_final" : "completed",
        ...(record.state === "conflicted" ? { error: proposalError("agent_runtime.proposal_conflicted") } : {}),
        facts: {
          stage: "planning",
          outputRefs: record.operationId && record.createdPageId ? [
            { kind: "operation", id: record.operationId, role: "reader_selection_create_note_operation" },
            { kind: "page", id: record.createdPageId, role: "reader_selection_created_note" }
          ] : [],
          ...(record.operationId ? { operationIds: [record.operationId] } : {})
        },
        message: record.state === "conflicted"
          ? "The Reader create-note review conflicted with current durable state."
          : "The Reader create-note review was resolved."
      });
    } catch {
      // The proposal record remains authoritative and retries reconciliation on the next read.
    }
  }

  #requireVault(): { readonly vault: VaultSummary; readonly vaultPath: string } {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath) throw new PigeDomainError("vault.no_active_vault", "No active vault is available.");
    return { vault, vaultPath };
  }
}

function requireBoundJob(jobValue: JobRecord, intent: ReaderSelectionCreateNoteIntent): JobRecord {
  const job = JobRecordSchema.parse(jobValue);
  if (
    job.class !== "agent_turn" ||
    !["queued", "running", "awaiting_review", "completed", "completed_with_warnings"].includes(job.state) ||
    !job.activeVaultId ||
    job.policyContextId !== intent.policyContextId ||
    job.policyHash !== intent.policyHash ||
    !/^model_[a-z0-9_]+$/u.test(intent.modelProfileId) ||
    !/^proposal_\d{8}_[a-z0-9]{8,}$/u.test(intent.proposalId) ||
    !hasExactSelectionBinding(job, intent.selection) ||
    !isDeepStrictEqual(readReaderSelectionCreateNoteBinding(job)?.selection, intent.selection)
  ) {
    throw conflict("The Reader create-note intent is not bound to its exact Job authority.");
  }
  return job;
}

function hasExactSelectionBinding(job: JobRecord, selection: ReaderSelectionIdentity): boolean {
  const refs = job.inputRefs ?? [];
  const scope = refs.filter((ref) => ref.role === "agent_turn_current_note_scope");
  const selected = refs.filter((ref) => ref.role === "agent_turn_reader_selection");
  const locator = `utf8_bytes:${selection.span.start}:${selection.span.endExclusive}`;
  return scope.length === 1 && selected.length === 1 &&
    scope[0]?.kind === "page" && scope[0].id === selection.pageId &&
    selected[0]?.kind === "page" && selected[0].id === selection.pageId &&
    selected[0].checksum === selection.selectedContentHash && selected[0].locator === locator &&
    typeof scope[0].checksum === "string" &&
    isDeepStrictEqual(scope[0].checksum, selection.pageContentHash);
}

function normalizeTitle(value: string): string {
  const title = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!title || Array.from(title).length > MAX_TITLE_CHARACTERS) {
    throw new PigeDomainError("agent_ingest.update_content_restricted", "The generated note title is invalid.");
  }
  return title;
}

function normalizeBody(value: string): string {
  const body = value.replace(/\r\n?/gu, "\n").trim();
  if (!body || body.includes("\0") || Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    throw new PigeDomainError("agent_ingest.update_content_restricted", "The generated note body is invalid.");
  }
  return body;
}

function createMarkdown(input: {
  readonly pageId: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly jobId: string;
  readonly modelProfileId: string;
}): string {
  const markdown = `---\nid: ${JSON.stringify(input.pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(input.title)}\ntype: "note"\ncreated_at: ${JSON.stringify(input.createdAt)}\nupdated_at: ${JSON.stringify(input.createdAt)}\nstatus: "active"\nlanguage: "und"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: []\nprovenance:\n  generated_by: "pige"\n  last_job_id: ${JSON.stringify(input.jobId)}\n  model_profile_id: ${JSON.stringify(input.modelProfileId)}\n  confidence: "high"\nnote:\n  note_kind: "summary"\n  review_state: "clean"\n---\n\n# ${escapeHeading(input.title)}\n\n${input.body}\n`;
  if (Buffer.byteLength(markdown, "utf8") > MAX_PAGE_BYTES || !parsePigeFrontmatter(markdown)) {
    throw new PigeDomainError("agent_ingest.update_content_restricted", "The generated note is invalid.");
  }
  return markdown;
}

function createOperation(input: {
  readonly operationId: string;
  readonly job: JobRecord;
  readonly proposalId: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
  readonly contentHash: string;
  readonly modelProfileId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
}): OperationRecord {
  return OperationRecordSchema.parse({
    id: input.operationId,
    schemaVersion: 1,
    jobId: input.job.id,
    proposalId: input.proposalId,
    createdAt: input.job.createdAt,
    actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    modelProfileId: input.modelProfileId,
    policyAudit: {
      policyContextId: input.policyContextId,
      policyHash: input.policyHash,
      enforcementOwners: ["Reader Selection Create Note Service", "Proposal Service", "Vault Service"]
    },
    kind: "create_page",
    targetRefs: [{ kind: "page", id: input.pageId, path: input.pagePath }],
    sourceRefs: [
      { kind: "proposal", id: input.proposalId },
      { kind: "job", id: input.job.id }
    ],
    after: { kind: "page", id: input.contentHash, path: input.pagePath },
    summary: `Created note ${JSON.stringify(input.title)} from an approved Reader selection.`,
    reversible: "best_effort",
    rollbackHint: "Move the generated note to trash after verifying that it has not changed.",
    warnings: []
  });
}

function readExactOperation(vaultPath: string, expected: OperationRecord): OperationRecord | undefined {
  const serialized = readGeneratedNoteExact(
    vaultPath,
    resolveVaultPath(vaultPath, operationPath(expected.id)),
    MAX_OPERATION_BYTES
  );
  if (serialized === undefined) return undefined;
  let current: OperationRecord;
  try {
    current = OperationRecordSchema.parse(JSON.parse(serialized));
  } catch {
    throw conflict("The Reader create-note Operation is invalid.");
  }
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw conflict("The deterministic create-note Operation identity is occupied by different facts.");
  }
  return current;
}

function commitOperation(vaultPath: string, operation: OperationRecord): OperationRecord {
  const serialized = `${JSON.stringify(operation, null, 2)}\n`;
  const status = createGeneratedNoteExclusive(
    vaultPath,
    resolveVaultPath(vaultPath, operationPath(operation.id)),
    serialized
  );
  if (status === "created") return operation;
  return readExactOperation(vaultPath, operation) ?? (() => {
    throw conflict("The Reader create-note Operation is unavailable.");
  })();
}

function requireExactPage(vaultPath: string, pagePath: string, expected: string): void {
  const current = readGeneratedNoteExact(vaultPath, resolveVaultPath(vaultPath, pagePath), MAX_PAGE_BYTES);
  if (current !== expected) throw conflict("The deterministic create-note page identity is occupied by different content.");
}

function createPageId(jobId: string, proposalId: string): string {
  const date = /^job_(\d{8})_/u.exec(jobId)?.[1] ?? "19700101";
  const suffix = createHash("sha256").update(`reader-create-note\0${jobId}\0${proposalId}`, "utf8").digest("hex").slice(0, 16);
  return `page_${date}_${suffix}`;
}

function createPagePath(pageId: string): string {
  const year = /^page_(\d{4})\d{4}_[a-f0-9]{16}$/u.exec(pageId)?.[1];
  if (!year) throw conflict("The Reader create-note page identity is invalid.");
  return `wiki/generated/${year}/${pageId}.md`;
}

function createOperationId(proposalId: string): string {
  const date = /^proposal_(\d{8})_/u.exec(proposalId)?.[1] ?? "19700101";
  const suffix = createHash("sha256").update(`reader-create-note-operation\0${proposalId}`, "utf8").digest("hex").slice(0, 16);
  return `op_${date}_${suffix}`;
}

function operationPath(operationId: string): string {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1] ?? "19700101";
  return `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operationId}.json`;
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw conflict("The Reader create-note path is invalid.");
  }
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw conflict("The Reader create-note path escapes its vault.");
  return resolved;
}

function escapeHeading(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|>~-])/gu, "\\$1");
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function conflict(message: string): PigeDomainError {
  return new PigeDomainError("agent_ingest.page_conflict", message);
}

function createProposalId(jobId: string): string {
  const date = /^job_(\d{8})_/u.exec(jobId)?.[1] ?? "19700101";
  const suffix = createHash("sha256").update(`pige.reader-selection-proposal.v1\0${jobId}`, "utf8").digest("hex").slice(0, 20);
  return `proposal_${date}_${suffix}`;
}

function proposalIntent(record: CreateNoteProposalRecord): ReaderSelectionCreateNoteIntent {
  return {
    proposalId: record.proposalId,
    selection: record.selection,
    title: record.title,
    body: record.body,
    modelProfileId: record.modelProfileId,
    policyContextId: record.policyContextId,
    policyHash: record.policyHash
  };
}

function projectProposal(record: CreateNoteProposalRecord): ReaderSelectionProposalPreview {
  return {
    proposalId: record.proposalId,
    action: "create_note",
    state: record.state,
    revision: record.revision,
    lines: record.previewLines
  };
}

function createPreviewLines(selectedText: string, title: string, body: string): ReaderSelectionProposalPreview["lines"] {
  const clean = (value: string): string[] => value.split(/\r?\n/u)
    .map((line) => line.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim())
    .filter((line) => line && !containsRestrictedModelContent(line));
  const context = clean(selectedText).slice(0, 3).map((text) => ({ kind: "context" as const, text: text.slice(0, 160) }));
  const added = clean(`${title}\n${body}`).slice(0, 8 - context.length)
    .map((text) => ({ kind: "added" as const, text: text.slice(0, 160) }));
  return [...context, ...added];
}

function proposalDirectory(vaultPath: string): string {
  return path.join(vaultPath, ".pige", "reader-selection-create-note-proposals");
}

function proposalPath(vaultPath: string, proposalId: string): string {
  ReaderSelectionProposalIdSchema.parse(proposalId);
  return path.join(proposalDirectory(vaultPath), `${proposalId}.json`);
}

function readProposal(vaultPath: string, proposalId: string): CreateNoteProposalRecord | undefined {
  const filePath = proposalPath(vaultPath, proposalId);
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_PROPOSAL_BYTES) {
    throw conflict("The create-note proposal record is not a bounded private file.");
  }
  const realVault = fs.realpathSync(vaultPath);
  const realFile = fs.realpathSync(filePath);
  if (!realFile.startsWith(`${realVault}${path.sep}`)) throw conflict("The create-note proposal record escapes its vault.");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const current = fs.fstatSync(descriptor);
    if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size) {
      throw conflict("The create-note proposal record changed during read.");
    }
    const bytes = Buffer.alloc(current.size);
    if (fs.readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) {
      throw conflict("The create-note proposal record could not be read exactly.");
    }
    return CreateNoteProposalRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
  } finally {
    fs.closeSync(descriptor);
  }
}

function createProposal(vaultPath: string, record: CreateNoteProposalRecord): void {
  const directory = proposalDirectory(vaultPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertSafeProposalDirectory(vaultPath, directory);
  const descriptor = fs.openSync(
    proposalPath(vaultPath, record.proposalId),
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
    0o600
  );
  try {
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    if (bytes.length > MAX_PROPOSAL_BYTES) throw conflict("The create-note proposal record is too large.");
    fs.writeSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function replaceProposal(
  vaultPath: string,
  expected: CreateNoteProposalRecord,
  patch: {
    readonly state: CreateNoteProposalRecord["state"];
    readonly operationId?: string;
    readonly createdPageId?: string;
  }
): CreateNoteProposalRecord {
  const current = readProposal(vaultPath, expected.proposalId);
  if (!current || current.revision !== expected.revision || current.intentHash !== expected.intentHash) {
    throw conflict("The create-note proposal changed before commit.");
  }
  const next = CreateNoteProposalRecordSchema.parse({
    ...current,
    state: patch.state,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    ...(patch.operationId ? { operationId: patch.operationId } : {}),
    ...(patch.createdPageId ? { createdPageId: patch.createdPageId } : {})
  });
  const filePath = proposalPath(vaultPath, next.proposalId);
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    assertSafeProposalDirectory(vaultPath, path.dirname(filePath));
    const before = readProposal(vaultPath, expected.proposalId);
    if (!before || before.revision !== expected.revision || before.intentHash !== expected.intentHash) {
      throw conflict("The create-note proposal changed before replace.");
    }
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
  return readProposal(vaultPath, next.proposalId) ?? (() => {
    throw conflict("The create-note proposal disappeared after replace.");
  })();
}

function assertSafeProposalDirectory(vaultPath: string, directory: string): void {
  const stat = fs.lstatSync(directory);
  const realVault = fs.realpathSync(vaultPath);
  const realDirectory = fs.realpathSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !realDirectory.startsWith(`${realVault}${path.sep}`)) {
    throw conflict("The create-note proposal directory is unsafe.");
  }
}

function proposalError(code: string): PigeErrorSummary {
  return {
    code,
    domain: "agent_runtime",
    messageKey: "error.generic",
    retryable: false,
    severity: "error" as const,
    userAction: "none" as const
  };
}

function createNoteInvalid(
  request: ReaderSelectionCreateNoteRequest,
  reason: Extract<ReaderSelectionCreateNoteResult, { status: "invalid" }>["reason"]
): ReaderSelectionCreateNoteResult {
  return { apiVersion: 1, requestId: request.requestId, status: "invalid", reason };
}
