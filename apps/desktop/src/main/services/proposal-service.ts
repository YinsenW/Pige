import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ProposalDecisionRequest,
  ProposalDecisionResult,
  ProposalGetRequest,
  ProposalGetResult,
  ProposalSummary,
  ProposalsListRequest,
  ProposalsListResult,
  StageProposalRequest,
  StageProposalResult,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  ConfirmationProposalSchema,
  type ChangeOperation,
  type ConfirmationProposal,
  type ProposalState
} from "@pige/schemas";
import { containsRestrictedModelContent } from "./model-egress-content";

export interface ProposalVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

interface ProposalFileRevision {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly checksum: string;
}

interface ProposalRecordFile {
  readonly path: string;
  readonly proposal: ConfirmationProposal;
  readonly revision: ProposalFileRevision;
}

interface ProposalScanState {
  entryCount: number;
}

interface NormalizedStageProposalRequest {
  readonly jobId?: string;
  readonly trustLevel: StageProposalRequest["trustLevel"];
  readonly summary: string;
  readonly reason: string;
  readonly sourceRefs: NonNullable<StageProposalRequest["sourceRefs"]>;
  readonly targetRefs: NonNullable<StageProposalRequest["targetRefs"]>;
  readonly proposedOperations: readonly ChangeOperation[];
  readonly diffRefs: NonNullable<StageProposalRequest["diffRefs"]>;
  readonly warnings: readonly string[];
  readonly baseHashes: Readonly<Record<string, string>>;
  readonly requiredPermissionIds: readonly string[];
}

const DEFAULT_PROPOSAL_LIST_LIMIT = 20;
const MAX_PROPOSAL_LIST_LIMIT = 100;
const MAX_PROPOSAL_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_PROPOSAL_CONTENT_BYTES = 1024 * 1024;
const MAX_PROPOSAL_OPERATIONS = 32;
const MAX_PROPOSAL_REFS = 64;
const MAX_PROPOSAL_WARNINGS = 16;
const MAX_PROPOSAL_PERMISSION_REFS = 64;
const MAX_PROPOSAL_SCAN_ENTRIES = 10_000;
const DECIDABLE_STATES = new Set<ProposalState>(["ready"]);
const RECOVERABLE_DECISION_STATES = new Set<ProposalState>([
  "approved",
  "applied",
  "rejected",
  "conflicted"
]);

export class ProposalService {
  readonly #vaults: ProposalVaultPort;

  constructor(vaults: ProposalVaultPort) {
    this.#vaults = vaults;
  }

  list(request: ProposalsListRequest = {}): ProposalsListResult {
    const activeVault = this.#requireActiveVault();
    const vaultPath = this.#requireActiveVaultPath();
    const states = new Set<ProposalState>(request.states ?? []);
    const limit = clampLimit(request.limit);
    const { proposals, invalidProposalCount } = readProposalRecords(vaultPath);
    const summaries = proposals
      .filter((proposal) => states.size === 0 || states.has(proposal.state))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(toProposalSummary);

    return {
      scannedAt: new Date().toISOString(),
      activeVaultId: activeVault.vaultId,
      total: proposals.length,
      invalidProposalCount,
      proposals: summaries
    };
  }

  get(request: ProposalGetRequest): ProposalGetResult {
    const vaultPath = this.#requireActiveVaultPath();
    const proposalFile = readProposalRecordFile(vaultPath, request.proposalId);
    if (!proposalFile) {
      throw new PigeDomainError("proposal.not_found", "Proposal record was not found.");
    }
    return { proposal: proposalFile.proposal };
  }

  findForJob(jobId: string): ConfirmationProposal | undefined {
    if (!/^job_\d{8}_[a-z0-9]{8,}$/u.test(jobId)) {
      throw new PigeDomainError("proposal.invalid_job_id", "The proposal Job identity is invalid.");
    }
    const vaultPath = this.#requireActiveVaultPath();
    const proposalFile = readProposalRecordFile(vaultPath, createDeterministicProposalId(jobId));
    if (!proposalFile) return undefined;
    if (proposalFile.proposal.jobId !== jobId) {
      throw new PigeDomainError(
        "proposal.identity_conflict",
        "The deterministic proposal does not belong to the requested Job."
      );
    }
    return proposalFile.proposal;
  }

  recoveryCandidates(): readonly ConfirmationProposal[] {
    const vaultPath = this.#requireActiveVaultPath();
    return readProposalRecords(vaultPath).proposals
      .filter((proposal) => RECOVERABLE_DECISION_STATES.has(proposal.state))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id));
  }

  stage(request: StageProposalRequest): StageProposalResult {
    const vaultPath = this.#requireActiveVaultPath();
    const normalized = normalizeStageRequest(request);
    const now = new Date().toISOString();
    const proposalId = normalized.jobId
      ? createDeterministicProposalId(normalized.jobId)
      : createProposalId(now);
    const proposal = ConfirmationProposalSchema.parse({
      id: proposalId,
      schemaVersion: 1,
      ...(normalized.jobId ? { jobId: normalized.jobId } : {}),
      createdAt: now,
      updatedAt: now,
      state: "ready",
      trustLevel: normalized.trustLevel,
      summary: normalized.summary,
      reason: normalized.reason,
      sourceRefs: normalized.sourceRefs,
      targetRefs: normalized.targetRefs,
      proposedOperations: normalized.proposedOperations,
      diffRefs: normalized.diffRefs,
      warnings: normalized.warnings,
      baseHashes: normalized.baseHashes,
      requiredPermissionIds: normalized.requiredPermissionIds
    });
    const proposalPath = resolveProposalPath(vaultPath, proposal.id);
    const existing = readProposalRecordFile(vaultPath, proposal.id);
    if (existing) {
      if (canonicalProposalIntent(existing.proposal) !== canonicalStageIntent(normalized)) {
        throw new PigeDomainError(
          "proposal.identity_conflict",
          "A durable proposal already uses this deterministic identity for different content."
        );
      }
      return { proposal: existing.proposal };
    }

    try {
      writeJsonCreateExclusive(vaultPath, proposalPath, proposal);
    } catch (caught) {
      if (!(caught instanceof PigeDomainError) || caught.code !== "proposal.identity_conflict") throw caught;
      const raced = readProposalRecordFile(vaultPath, proposal.id);
      if (!raced || canonicalProposalIntent(raced.proposal) !== canonicalStageIntent(normalized)) throw caught;
      return { proposal: raced.proposal };
    }
    const committed = readProposalRecordFile(vaultPath, proposal.id);
    if (!committed || canonicalProposalIntent(committed.proposal) !== canonicalStageIntent(normalized)) {
      throw new PigeDomainError("proposal.write_failed", "The durable proposal could not be verified after commit.");
    }
    return { proposal: committed.proposal };
  }

  approve(request: ProposalDecisionRequest): ProposalDecisionResult {
    return this.#decide(request, "approved");
  }

  reject(request: ProposalDecisionRequest): ProposalDecisionResult {
    return this.#decide(request, "rejected");
  }

  markApplied(proposalId: string): ProposalDecisionResult {
    return this.#transition(
      proposalId,
      "applied",
      new Set<ProposalState>(["approved"])
    );
  }

  markConflicted(proposalId: string): ProposalDecisionResult {
    return this.#transition(
      proposalId,
      "conflicted",
      new Set<ProposalState>(["approved"]),
      "The approved proposal target or current evidence changed before apply."
    );
  }

  #decide(request: ProposalDecisionRequest, state: "approved" | "rejected"): ProposalDecisionResult {
    const vaultPath = this.#requireActiveVaultPath();
    const proposalFile = readProposalRecordFile(vaultPath, request.proposalId);
    if (!proposalFile) {
      return { status: "not_found", reason: "Proposal record was not found." };
    }
    if (!DECIDABLE_STATES.has(proposalFile.proposal.state)) {
      return {
        status: "not_allowed",
        reason: `Proposal state ${proposalFile.proposal.state} cannot be ${state}.`,
        proposal: proposalFile.proposal
      };
    }

    const now = new Date().toISOString();
    const decisionReason = request.reason
      ? normalizeSafeMetadata(request.reason, 600, "proposal.invalid_decision_reason")
      : undefined;
    const updated = ConfirmationProposalSchema.parse({
      ...proposalFile.proposal,
      state,
      updatedAt: now,
      decision: {
        decidedAt: now,
        decidedBy: "user",
        ...(decisionReason ? { reason: decisionReason } : {})
      }
    });
    writeJsonReplace(vaultPath, proposalFile.path, updated, proposalFile.revision);
    const committed = readProposalRecordFile(vaultPath, proposalFile.proposal.id);
    if (!committed || committed.proposal.state !== state) {
      throw new PigeDomainError("proposal.write_failed", "The proposal decision could not be verified after commit.");
    }
    return { status: state, proposal: committed.proposal };
  }

  #transition(
    proposalId: string,
    state: "applied" | "conflicted",
    allowedStates: ReadonlySet<ProposalState>,
    warning?: string
  ): ProposalDecisionResult {
    const vaultPath = this.#requireActiveVaultPath();
    const proposalFile = readProposalRecordFile(vaultPath, proposalId);
    if (!proposalFile) {
      return { status: "not_found", reason: "Proposal record was not found." };
    }
    if (proposalFile.proposal.state === state) {
      return { status: state, proposal: proposalFile.proposal };
    }
    if (!allowedStates.has(proposalFile.proposal.state)) {
      return {
        status: "not_allowed",
        reason: `Proposal state ${proposalFile.proposal.state} cannot become ${state}.`,
        proposal: proposalFile.proposal
      };
    }
    const updated = ConfirmationProposalSchema.parse({
      ...proposalFile.proposal,
      state,
      updatedAt: new Date().toISOString(),
      ...(warning ? {
        warnings: Array.from(new Set([...proposalFile.proposal.warnings, warning]))
      } : {})
    });
    writeJsonReplace(vaultPath, proposalFile.path, updated, proposalFile.revision);
    const committed = readProposalRecordFile(vaultPath, proposalId);
    if (!committed || committed.proposal.state !== state) {
      throw new PigeDomainError("proposal.write_failed", "The proposal state transition could not be verified after commit.");
    }
    return { status: state, proposal: committed.proposal };
  }

  #requireActiveVault(): VaultSummary {
    const activeVault = this.#vaults.current();
    if (!activeVault || !this.#vaults.activeVaultPath()) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    return activeVault;
  }

  #requireActiveVaultPath(): string {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!this.#vaults.current() || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    assertSafeVaultRoot(vaultPath);
    return vaultPath;
  }
}

function readProposalRecords(vaultPath: string): { proposals: ConfirmationProposal[]; invalidProposalCount: number } {
  const root = proposalRoot(vaultPath);
  if (!ensureSafeDirectoryChain(vaultPath, root, false)) {
    return { proposals: [], invalidProposalCount: 0 };
  }

  const { files, invalidEntryCount } = listJsonFiles(vaultPath, root);
  const proposals: ConfirmationProposal[] = [];
  let invalidProposalCount = invalidEntryCount;
  for (const filePath of files) {
    try {
      const snapshot = readSafeRegularTextFile(vaultPath, filePath);
      const parsed = ConfirmationProposalSchema.safeParse(JSON.parse(snapshot.text));
      if (parsed.success && path.basename(filePath) === `${parsed.data.id}.json`) {
        validatePersistedProposalSafety(parsed.data);
        proposals.push(parsed.data);
      } else {
        invalidProposalCount += 1;
      }
    } catch {
      invalidProposalCount += 1;
    }
  }
  return { proposals, invalidProposalCount };
}

function readProposalRecordFile(vaultPath: string, proposalId: string): ProposalRecordFile | undefined {
  if (!/^proposal_\d{8}_[a-z0-9]{8,}$/.test(proposalId)) return undefined;
  const proposalPath = resolveProposalPath(vaultPath, proposalId);
  if (!ensureSafeDirectoryChain(vaultPath, path.dirname(proposalPath), false)) return undefined;
  if (!pathExists(proposalPath)) return undefined;

  const snapshot = readSafeRegularTextFile(vaultPath, proposalPath);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(snapshot.text);
  } catch {
    throw new PigeDomainError("proposal.invalid_record", "The durable proposal record is invalid.");
  }
  const parsed = ConfirmationProposalSchema.safeParse(parsedJson);
  if (!parsed.success || parsed.data.id !== proposalId) {
    throw new PigeDomainError("proposal.invalid_record", "The durable proposal identity does not match its record path.");
  }
  validatePersistedProposalSafety(parsed.data);
  return { path: proposalPath, proposal: parsed.data, revision: snapshot.revision };
}

function toProposalSummary(proposal: ConfirmationProposal): ProposalSummary {
  return {
    id: proposal.id,
    state: proposal.state,
    trustLevel: proposal.trustLevel,
    ...(proposal.jobId ? { jobId: proposal.jobId } : {}),
    summary: proposal.summary,
    reason: proposal.reason,
    operationCount: proposal.proposedOperations.length,
    warningCount: proposal.warnings.length,
    targetCount: proposal.targetRefs.length,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt
  };
}

function normalizeStageRequest(request: StageProposalRequest): NormalizedStageProposalRequest {
  if (request.proposedOperations.length === 0 || request.proposedOperations.length > MAX_PROPOSAL_OPERATIONS) {
    throw new PigeDomainError("proposal.invalid_operations", "A proposal must contain a bounded non-empty operation list.");
  }
  const sourceRefs = request.sourceRefs ?? [];
  const targetRefs = request.targetRefs ?? [];
  const diffRefs = request.diffRefs ?? [];
  if (sourceRefs.length > MAX_PROPOSAL_REFS || targetRefs.length > MAX_PROPOSAL_REFS || diffRefs.length > MAX_PROPOSAL_REFS) {
    throw new PigeDomainError("proposal.invalid_refs", "A proposal contains too many durable references.");
  }
  if ((request.warnings?.length ?? 0) > MAX_PROPOSAL_WARNINGS) {
    throw new PigeDomainError("proposal.invalid_warnings", "A proposal contains too many warnings.");
  }
  if ((request.requiredPermissionIds?.length ?? 0) > MAX_PROPOSAL_PERMISSION_REFS) {
    throw new PigeDomainError("proposal.invalid_permissions", "A proposal contains too many permission references.");
  }

  validateChangeOperations(request.proposedOperations);
  validateOperationRefs([...sourceRefs, ...targetRefs, ...diffRefs]);
  const baseHashes = normalizeBaseHashes(request.baseHashes ?? {});
  const warnings = (request.warnings ?? []).map((warning) =>
    normalizeSafeMetadata(warning, 240, "proposal.invalid_warning")
  );
  return {
    ...(request.jobId ? { jobId: request.jobId } : {}),
    trustLevel: request.trustLevel,
    summary: normalizeSafeMetadata(request.summary, 240, "proposal.invalid_summary"),
    reason: normalizeSafeMetadata(request.reason, 600, "proposal.invalid_reason"),
    sourceRefs,
    targetRefs,
    proposedOperations: request.proposedOperations,
    diffRefs,
    warnings,
    baseHashes,
    requiredPermissionIds: Array.from(new Set(request.requiredPermissionIds ?? [])).sort()
  };
}

function validatePersistedProposalSafety(proposal: ConfirmationProposal): void {
  if (
    proposal.proposedOperations.length === 0 ||
    proposal.proposedOperations.length > MAX_PROPOSAL_OPERATIONS ||
    proposal.sourceRefs.length > MAX_PROPOSAL_REFS ||
    proposal.targetRefs.length > MAX_PROPOSAL_REFS ||
    proposal.diffRefs.length > MAX_PROPOSAL_REFS ||
    proposal.warnings.length > MAX_PROPOSAL_WARNINGS ||
    proposal.requiredPermissionIds.length > MAX_PROPOSAL_PERMISSION_REFS
  ) {
    throw new PigeDomainError("proposal.invalid_record", "The durable proposal exceeds its bounded record shape.");
  }
  if (
    normalizeSafeMetadata(proposal.summary, 240, "proposal.invalid_record") !== proposal.summary ||
    normalizeSafeMetadata(proposal.reason, 600, "proposal.invalid_record") !== proposal.reason
  ) {
    throw new PigeDomainError("proposal.invalid_record", "The durable proposal metadata is not canonical.");
  }
  for (const warning of proposal.warnings) {
    if (normalizeSafeMetadata(warning, 240, "proposal.invalid_record") !== warning) {
      throw new PigeDomainError("proposal.invalid_record", "The durable proposal warning is not canonical.");
    }
  }
  if (
    proposal.decision?.reason &&
    normalizeSafeMetadata(proposal.decision.reason, 600, "proposal.invalid_record") !== proposal.decision.reason
  ) {
    throw new PigeDomainError("proposal.invalid_record", "The durable proposal decision reason is not canonical.");
  }
  validateChangeOperations(proposal.proposedOperations);
  validateOperationRefs([...proposal.sourceRefs, ...proposal.targetRefs, ...proposal.diffRefs]);
  normalizeBaseHashes(proposal.baseHashes);
}

function validateChangeOperations(operations: readonly ChangeOperation[]): void {
  let contentBytes = 0;
  for (const operation of operations) {
    if (operation.kind === "rename") {
      assertCanonicalVaultRelativePath(operation.from);
      assertCanonicalVaultRelativePath(operation.to);
      continue;
    }
    assertCanonicalVaultRelativePath(operation.path);
    if ("content" in operation) {
      contentBytes += Buffer.byteLength(operation.content, "utf8");
      assertNoRestrictedContent(operation.content, "proposal.restricted_content");
    }
  }
  if (contentBytes > MAX_PROPOSAL_CONTENT_BYTES) {
    throw new PigeDomainError("proposal.content_too_large", "Proposed Markdown exceeds the bounded proposal size.");
  }
}

function validateOperationRefs(refs: readonly { readonly id: string; readonly path?: string | undefined }[]): void {
  for (const ref of refs) {
    assertNoRestrictedContent(ref.id, "proposal.invalid_ref");
    if (ref.path) assertCanonicalVaultRelativePath(ref.path);
  }
}

function normalizeBaseHashes(baseHashes: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const entries = Object.entries(baseHashes);
  if (entries.length > MAX_PROPOSAL_OPERATIONS) {
    throw new PigeDomainError("proposal.invalid_base_hashes", "A proposal contains too many base hashes.");
  }
  const normalized: Record<string, string> = {};
  for (const [relativePath, checksum] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    assertCanonicalVaultRelativePath(relativePath);
    normalized[relativePath] = checksum;
  }
  return normalized;
}

function normalizeSafeMetadata(value: string, maxCharacters: number, code: string): string {
  const normalized = value.replace(/[\r\n\t]+/gu, " ").replace(/\s{2,}/gu, " ").trim();
  if (!normalized || Array.from(normalized).length > maxCharacters) {
    throw new PigeDomainError(code, "Proposal metadata must be present and remain within its safe bound.");
  }
  assertNoRestrictedContent(normalized, code);
  return normalized;
}

function assertNoRestrictedContent(value: string, code: string): void {
  if (containsRestrictedModelContent(value)) {
    throw new PigeDomainError(code, "Restricted paths or secret-like values cannot be persisted in a proposal.");
  }
}

function assertCanonicalVaultRelativePath(relativePath: string): void {
  if (
    path.isAbsolute(relativePath) ||
    /^[a-z]:[\\/]/iu.test(relativePath) ||
    relativePath.startsWith("\\\\") ||
    relativePath.includes("\0") ||
    relativePath.includes("\\")
  ) {
    throw new PigeDomainError("proposal.invalid_path", "Proposal paths must be canonical vault-relative paths.");
  }
  const normalized = path.posix.normalize(relativePath);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized !== relativePath ||
    relativePath.endsWith("/")
  ) {
    throw new PigeDomainError("proposal.invalid_path", "Proposal paths must stay canonically inside the active vault.");
  }
}

function resolveProposalPath(vaultPath: string, proposalId: string): string {
  const dateKey = /^proposal_(\d{8})_/.exec(proposalId)?.[1];
  if (!dateKey) {
    throw new PigeDomainError("proposal.invalid_id", "Proposal ID is invalid.");
  }
  return path.join(proposalRoot(vaultPath), dateKey.slice(0, 4), dateKey.slice(4, 6), `${proposalId}.json`);
}

function proposalRoot(vaultPath: string): string {
  return path.join(path.resolve(vaultPath), ".pige", "proposals");
}

function createProposalId(timestamp: string): string {
  const dateKey = timestamp.slice(0, 10).replaceAll("-", "");
  return `proposal_${dateKey}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createDeterministicProposalId(jobId: string): string {
  const dateKey = /^job_(\d{8})_/.exec(jobId)?.[1] ?? new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const digest = createHash("sha256")
    .update("pige.proposal.stage.v1\0", "utf8")
    .update(jobId, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `proposal_${dateKey}_${digest}`;
}

function canonicalStageIntent(request: NormalizedStageProposalRequest): string {
  return stableStringify({
    identityVersion: 1,
    jobId: request.jobId ?? null,
    trustLevel: request.trustLevel,
    summary: request.summary,
    reason: request.reason,
    sourceRefs: request.sourceRefs,
    targetRefs: request.targetRefs,
    proposedOperations: request.proposedOperations,
    diffRefs: request.diffRefs,
    warnings: request.warnings,
    baseHashes: request.baseHashes,
    requiredPermissionIds: request.requiredPermissionIds
  });
}

function canonicalProposalIntent(proposal: ConfirmationProposal): string {
  return stableStringify({
    identityVersion: 1,
    jobId: proposal.jobId ?? null,
    trustLevel: proposal.trustLevel,
    summary: proposal.summary,
    reason: proposal.reason,
    sourceRefs: proposal.sourceRefs,
    targetRefs: proposal.targetRefs,
    proposedOperations: proposal.proposedOperations,
    diffRefs: proposal.diffRefs,
    warnings: proposal.warnings,
    baseHashes: proposal.baseHashes,
    requiredPermissionIds: proposal.requiredPermissionIds
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function listJsonFiles(
  vaultPath: string,
  root: string,
  depth = 0,
  state: ProposalScanState = { entryCount: 0 }
): { files: string[]; invalidEntryCount: number } {
  if (!ensureSafeDirectoryChain(vaultPath, root, false)) {
    return { files: [], invalidEntryCount: 0 };
  }
  const files: string[] = [];
  let invalidEntryCount = 0;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  state.entryCount += entries.length;
  if (state.entryCount > MAX_PROPOSAL_SCAN_ENTRIES) {
    throw new PigeDomainError("proposal.scan_limit", "The durable proposal store exceeds its bounded scan limit.");
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      invalidEntryCount += 1;
      continue;
    }
    if (entry.isDirectory()) {
      const expectedDirectory = depth === 0 ? /^\d{4}$/u : /^\d{2}$/u;
      if (depth >= 2 || !expectedDirectory.test(entry.name)) {
        invalidEntryCount += 1;
        continue;
      }
      const nested = listJsonFiles(vaultPath, fullPath, depth + 1, state);
      files.push(...nested.files);
      invalidEntryCount += nested.invalidEntryCount;
      continue;
    }
    if (depth === 2 && entry.isFile() && entry.name.endsWith(".json")) {
      assertPathWithinVault(vaultPath, fullPath);
      files.push(fullPath);
      continue;
    }
    invalidEntryCount += 1;
  }
  return { files, invalidEntryCount };
}

function readSafeRegularTextFile(
  vaultPath: string,
  filePath: string
): { readonly text: string; readonly revision: ProposalFileRevision } {
  assertPathWithinVault(vaultPath, filePath);
  if (!ensureSafeDirectoryChain(vaultPath, path.dirname(filePath), false)) {
    throw new PigeDomainError("proposal.path_unsafe", "The proposal parent directory is unavailable.");
  }
  const pathStatBefore = safeLstat(filePath);
  if (
    !pathStatBefore.isFile() ||
    pathStatBefore.isSymbolicLink() ||
    pathStatBefore.nlink !== 1 ||
    pathStatBefore.size > MAX_PROPOSAL_RECORD_BYTES
  ) {
    throw new PigeDomainError("proposal.invalid_record", "A proposal record must be a bounded regular file.");
  }
  assertRealPathWithinVault(vaultPath, filePath);

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const descriptorStatBefore = fs.fstatSync(descriptor);
    if (!sameFileIdentity(pathStatBefore, descriptorStatBefore)) {
      throw new PigeDomainError("proposal.file_changed", "The proposal record changed before it could be read.");
    }
    const boundedBuffer = Buffer.allocUnsafe(MAX_PROPOSAL_RECORD_BYTES + 1);
    let byteCount = 0;
    while (byteCount < boundedBuffer.length) {
      const readCount = fs.readSync(
        descriptor,
        boundedBuffer,
        byteCount,
        boundedBuffer.length - byteCount,
        null
      );
      if (readCount === 0) break;
      byteCount += readCount;
    }
    if (byteCount > MAX_PROPOSAL_RECORD_BYTES) {
      throw new PigeDomainError("proposal.invalid_record", "A proposal record exceeds its bounded read limit.");
    }
    const bytes = boundedBuffer.subarray(0, byteCount);
    const descriptorStatAfter = fs.fstatSync(descriptor);
    const pathStatAfter = safeLstat(filePath);
    if (
      bytes.length !== descriptorStatAfter.size ||
      !sameFileIdentity(descriptorStatBefore, descriptorStatAfter) ||
      !sameFileIdentity(descriptorStatAfter, pathStatAfter) ||
      descriptorStatAfter.mtimeMs !== descriptorStatBefore.mtimeMs ||
      pathStatAfter.isSymbolicLink() ||
      descriptorStatAfter.nlink !== 1 ||
      pathStatAfter.nlink !== 1
    ) {
      throw new PigeDomainError("proposal.file_changed", "The proposal record changed while it was read.");
    }
    return {
      text: bytes.toString("utf8"),
      revision: {
        dev: descriptorStatAfter.dev,
        ino: descriptorStatAfter.ino,
        size: descriptorStatAfter.size,
        mtimeMs: descriptorStatAfter.mtimeMs,
        checksum: checksumBytes(bytes)
      }
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeJsonCreateExclusive(vaultPath: string, filePath: string, value: unknown): void {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (bytes.length > MAX_PROPOSAL_RECORD_BYTES) {
    throw new PigeDomainError("proposal.content_too_large", "The durable proposal record exceeds its size bound.");
  }
  const directoryPath = path.dirname(filePath);
  ensureSafeDirectoryChain(vaultPath, directoryPath, true);
  if (pathExists(filePath)) {
    throw new PigeDomainError("proposal.identity_conflict", "A durable proposal already exists at this identity.");
  }
  const temporaryPath = path.join(directoryPath, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    ensureSafeDirectoryChain(vaultPath, directoryPath, false);
    try {
      fs.linkSync(temporaryPath, filePath);
    } catch (caught) {
      if (isErrno(caught, "EEXIST")) {
        throw new PigeDomainError("proposal.identity_conflict", "A durable proposal already exists at this identity.");
      }
      throw caught;
    }
    flushDirectoryWhereSupported(directoryPath);
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the authoritative write result.
      }
    }
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the authoritative write result.
    }
  }
}

function writeJsonReplace(
  vaultPath: string,
  filePath: string,
  value: unknown,
  expected: ProposalFileRevision
): void {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (bytes.length > MAX_PROPOSAL_RECORD_BYTES) {
    throw new PigeDomainError("proposal.content_too_large", "The durable proposal record exceeds its size bound.");
  }
  const directoryPath = path.dirname(filePath);
  ensureSafeDirectoryChain(vaultPath, directoryPath, false);
  const temporaryPath = path.join(directoryPath, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertExpectedRevision(vaultPath, filePath, expected);
    fs.renameSync(temporaryPath, filePath);
    flushDirectoryWhereSupported(directoryPath);
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the authoritative update result.
      }
    }
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the authoritative update result.
    }
  }
}

function assertExpectedRevision(vaultPath: string, filePath: string, expected: ProposalFileRevision): void {
  const current = readSafeRegularTextFile(vaultPath, filePath).revision;
  if (
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    current.size !== expected.size ||
    current.mtimeMs !== expected.mtimeMs ||
    current.checksum !== expected.checksum
  ) {
    throw new PigeDomainError("proposal.conflicted", "The proposal changed before the decision could be recorded.");
  }
}

function assertSafeVaultRoot(vaultPath: string): void {
  const resolvedVault = path.resolve(vaultPath);
  const stat = safeLstat(resolvedVault);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("proposal.path_unsafe", "The active vault must be a non-symlink directory.");
  }
}

function ensureSafeDirectoryChain(vaultPath: string, directoryPath: string, create: boolean): boolean {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedDirectory = path.resolve(directoryPath);
  assertPathWithinVault(vaultPath, resolvedDirectory, true);
  assertSafeVaultRoot(vaultPath);
  const realVault = fs.realpathSync(resolvedVault);
  const relative = path.relative(resolvedVault, resolvedDirectory);
  let current = resolvedVault;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    if (!pathExists(current)) {
      if (!create) return false;
      fs.mkdirSync(current, { mode: 0o700 });
      flushDirectoryWhereSupported(path.dirname(current));
    }
    const stat = safeLstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PigeDomainError("proposal.path_unsafe", "Proposal paths cannot traverse symbolic links.");
    }
    const realCurrent = fs.realpathSync(current);
    if (realCurrent !== realVault && !realCurrent.startsWith(`${realVault}${path.sep}`)) {
      throw new PigeDomainError("proposal.path_unsafe", "The proposal directory resolves outside the active vault.");
    }
  }
  return true;
}

function assertPathWithinVault(vaultPath: string, filePath: string, allowVault = false): void {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(filePath);
  if (
    (!allowVault && resolvedPath === resolvedVault) ||
    (resolvedPath !== resolvedVault && !resolvedPath.startsWith(`${resolvedVault}${path.sep}`))
  ) {
    throw new PigeDomainError("proposal.path_unsafe", "A proposal path escapes the active vault.");
  }
}

function assertRealPathWithinVault(vaultPath: string, filePath: string): void {
  const realVault = fs.realpathSync(path.resolve(vaultPath));
  const realFile = fs.realpathSync(filePath);
  if (realFile === realVault || !realFile.startsWith(`${realVault}${path.sep}`)) {
    throw new PigeDomainError("proposal.path_unsafe", "A proposal record resolves outside the active vault.");
  }
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function safeLstat(filePath: string): fs.Stats {
  try {
    return fs.lstatSync(filePath);
  } catch {
    throw new PigeDomainError("proposal.path_unavailable", "A durable proposal path cannot be inspected safely.");
  }
}

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return false;
    throw new PigeDomainError("proposal.path_unavailable", "A durable proposal path cannot be inspected safely.");
  }
}

function checksumBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function flushDirectoryWhereSupported(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isUnsupportedDirectoryFlush(caught)) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isUnsupportedDirectoryFlush(value: unknown): boolean {
  if (!(value instanceof Error) || !("code" in value)) return false;
  const code = String(value.code);
  if (new Set(["EBADF", "EINVAL", "ENOSYS", "ENOTSUP"]).has(code)) return true;
  return process.platform === "win32" && new Set(["EACCES", "EISDIR", "EPERM"]).has(code);
}

function isErrno(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && value.code === code;
}

function clampLimit(limit: number | undefined): number {
  if (!limit) return DEFAULT_PROPOSAL_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_PROPOSAL_LIST_LIMIT, Math.floor(limit)));
}
