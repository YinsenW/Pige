import { randomUUID } from "node:crypto";
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

export interface ProposalVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

const DEFAULT_PROPOSAL_LIST_LIMIT = 20;
const MAX_PROPOSAL_LIST_LIMIT = 100;
const DECIDABLE_STATES = new Set<ProposalState>(["ready"]);

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
    const { proposals, invalidProposalCount } = readProposalRecords(path.join(vaultPath, ".pige", "proposals"));
    const summaries = proposals
      .filter((proposal) => states.size === 0 || states.has(proposal.state))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
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

  stage(request: StageProposalRequest): StageProposalResult {
    const vaultPath = this.#requireActiveVaultPath();
    validateChangeOperations(request.proposedOperations);

    const now = new Date().toISOString();
    const proposal = ConfirmationProposalSchema.parse({
      id: createProposalId(now),
      schemaVersion: 1,
      ...(request.jobId ? { jobId: request.jobId } : {}),
      createdAt: now,
      updatedAt: now,
      state: "ready",
      trustLevel: request.trustLevel,
      summary: request.summary,
      reason: request.reason,
      sourceRefs: request.sourceRefs ?? [],
      targetRefs: request.targetRefs ?? [],
      proposedOperations: request.proposedOperations,
      diffRefs: request.diffRefs ?? [],
      warnings: request.warnings ?? [],
      baseHashes: request.baseHashes ?? {},
      requiredPermissionIds: request.requiredPermissionIds ?? []
    });
    writeJsonAtomic(resolveProposalPath(vaultPath, proposal.id), proposal);
    return { proposal };
  }

  approve(request: ProposalDecisionRequest): ProposalDecisionResult {
    return this.#decide(request, "approved");
  }

  reject(request: ProposalDecisionRequest): ProposalDecisionResult {
    return this.#decide(request, "rejected");
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

    const updated = ConfirmationProposalSchema.parse({
      ...proposalFile.proposal,
      state,
      updatedAt: new Date().toISOString(),
      decision: {
        decidedAt: new Date().toISOString(),
        decidedBy: "user",
        ...(request.reason ? { reason: request.reason } : {})
      }
    });
    writeJsonAtomic(proposalFile.path, updated);
    return { status: state, proposal: updated };
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
    return vaultPath;
  }
}

function readProposalRecords(root: string): { proposals: ConfirmationProposal[]; invalidProposalCount: number } {
  if (!fs.existsSync(root)) {
    return { proposals: [], invalidProposalCount: 0 };
  }

  const proposals: ConfirmationProposal[] = [];
  let invalidProposalCount = 0;
  for (const filePath of listJsonFiles(root)) {
    try {
      const parsed = ConfirmationProposalSchema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf8")));
      if (parsed.success) {
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

function readProposalRecordFile(
  vaultPath: string,
  proposalId: string
): { path: string; proposal: ConfirmationProposal } | undefined {
  if (!/^proposal_\d{8}_[a-z0-9]{8,}$/.test(proposalId)) return undefined;
  const proposalPath = resolveProposalPath(vaultPath, proposalId);
  if (!fs.existsSync(proposalPath)) return undefined;

  try {
    const parsed = ConfirmationProposalSchema.safeParse(JSON.parse(fs.readFileSync(proposalPath, "utf8")));
    return parsed.success ? { path: proposalPath, proposal: parsed.data } : undefined;
  } catch {
    return undefined;
  }
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

function validateChangeOperations(operations: readonly ChangeOperation[]): void {
  for (const operation of operations) {
    if (operation.kind === "rename") {
      assertVaultRelativePath(operation.from);
      assertVaultRelativePath(operation.to);
      continue;
    }
    assertVaultRelativePath(operation.path);
  }
}

function assertVaultRelativePath(relativePath: string): void {
  if (path.isAbsolute(relativePath) || /^[a-z]:[\\/]/iu.test(relativePath) || relativePath.startsWith("\\\\") || relativePath.includes("\0")) {
    throw new PigeDomainError("proposal.invalid_path", "Proposal paths must be safe vault-relative paths.");
  }
  const normalized = path.posix.normalize(relativePath.replace(/\\/gu, "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new PigeDomainError("proposal.invalid_path", "Proposal paths must stay inside the active vault.");
  }
}

function resolveProposalPath(vaultPath: string, proposalId: string): string {
  const dateKey = /^proposal_(\d{8})_/.exec(proposalId)?.[1];
  if (!dateKey) {
    throw new PigeDomainError("proposal.invalid_id", "Proposal ID is invalid.");
  }
  return path.join(vaultPath, ".pige", "proposals", dateKey.slice(0, 4), dateKey.slice(4, 6), `${proposalId}.json`);
}

function createProposalId(timestamp: string): string {
  const dateKey = timestamp.slice(0, 10).replaceAll("-", "");
  return `proposal_${dateKey}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function listJsonFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function clampLimit(limit: number | undefined): number {
  if (!limit) return DEFAULT_PROPOSAL_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_PROPOSAL_LIST_LIMIT, Math.floor(limit)));
}
