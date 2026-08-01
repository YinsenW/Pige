import { createHash } from "node:crypto";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import { createGeneratedNoteExclusive, readGeneratedNoteExact } from "./generated-note-file";
import {
  CurrentNoteConflictReviewService,
  type CurrentNoteConflictLine
} from "./current-note-conflict-review-service";

const MAX_PAGE_BYTES = 128 * 1024;

export interface CurrentNoteConflictSaveInput {
  readonly vaultPath: string;
  readonly mutationKind: "append" | "replace";
  readonly proposalId: string;
  readonly intentHash: string;
  readonly currentRevision: string;
  readonly originalPageId: string;
  readonly jobId: string;
  readonly createdAt: string;
  readonly modelProfileId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
  readonly proposedMarkdown: string;
  readonly assertCurrent: () => void;
}

export interface CurrentNoteConflictSavedNote {
  readonly pageId: string;
  readonly operation: OperationRecord;
}

export class CurrentNoteConflictSaveAsNoteService {
  saveResolution(input: Omit<CurrentNoteConflictSaveInput, "assertCurrent"> & {
    readonly lines: readonly CurrentNoteConflictLine[];
    readonly readCurrentMarkdown: () => string;
  }): CurrentNoteConflictSavedNote {
    const assertCurrent = (): void => {
      if (`noteeditrev_${hashHex(input.readCurrentMarkdown())}` !== input.currentRevision) {
        throw conflict("The current note changed before its proposal could be saved separately.");
      }
    };
    const saved = this.save({ ...input, assertCurrent });
    new CurrentNoteConflictReviewService().resolve({
      vaultPath: input.vaultPath,
      mutationKind: input.mutationKind,
      proposalId: input.proposalId,
      intentHash: input.intentHash,
      currentRevision: input.currentRevision as `noteeditrev_${string}`,
      lines: input.lines,
      decision: "save_proposed_as_note",
      operationId: saved.operation.id,
      createdPageId: saved.pageId
    });
    return saved;
  }

  save(input: CurrentNoteConflictSaveInput): CurrentNoteConflictSavedNote {
    const artifact = createArtifact(input);
    input.assertCurrent();
    const pagePath = resolveVaultPath(input.vaultPath, artifact.pagePath);
    const existing = readGeneratedNoteExact(input.vaultPath, pagePath, MAX_PAGE_BYTES);
    if (existing === undefined) {
      createGeneratedNoteExclusive(input.vaultPath, pagePath, artifact.markdown, {
        assertSourceCurrent: input.assertCurrent
      });
    }
    if (readGeneratedNoteExact(input.vaultPath, pagePath, MAX_PAGE_BYTES) !== artifact.markdown) {
      throw conflict("The deterministic saved-note page identity is occupied by different bytes.");
    }
    const operation = commitOperation(input.vaultPath, artifact.operation, input.assertCurrent);
    if (readGeneratedNoteExact(input.vaultPath, pagePath, MAX_PAGE_BYTES) !== artifact.markdown) {
      throw conflict("The saved proposal note changed before its Operation was adopted.");
    }
    return { pageId: artifact.pageId, operation };
  }
}

function commitOperation(vaultPath: string, operation: OperationRecord, assertCurrent: () => void): OperationRecord {
  const dateKey = /^op_(\d{8})_/u.exec(operation.id)?.[1];
  if (!dateKey) throw conflict("The saved proposal Operation identity is invalid.");
  const operationPath = resolveVaultPath(
    vaultPath,
    `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${operation.id}.json`
  );
  const serialized = `${JSON.stringify(operation, null, 2)}\n`;
  const existing = readGeneratedNoteExact(vaultPath, operationPath, 256 * 1024);
  if (existing === undefined) {
    createGeneratedNoteExclusive(vaultPath, operationPath, serialized, { assertSourceCurrent: assertCurrent });
  }
  const durable = readGeneratedNoteExact(vaultPath, operationPath, 256 * 1024);
  if (durable === undefined) throw conflict("The saved proposal Operation could not be adopted.");
  let parsed: OperationRecord;
  try { parsed = OperationRecordSchema.parse(JSON.parse(durable)); } catch { throw conflict("The saved proposal Operation is invalid."); }
  if (JSON.stringify(parsed) !== JSON.stringify(operation)) {
    throw conflict("The saved proposal Operation identity is occupied by different facts.");
  }
  return parsed;
}

function createArtifact(input: CurrentNoteConflictSaveInput): {
  readonly pageId: string;
  readonly pagePath: string;
  readonly markdown: string;
  readonly operation: OperationRecord;
} {
  if (!/^proposal_\d{8}_[a-z0-9_]{8,128}$/u.test(input.proposalId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.intentHash) ||
    !/^noteeditrev_[a-f0-9]{64}$/u.test(input.currentRevision)) {
    throw conflict("The saved proposal note identity is invalid.");
  }
  const dateKey = /^proposal_(\d{8})_/u.exec(input.proposalId)?.[1];
  if (!dateKey) throw conflict("The saved proposal note date identity is invalid.");
  const digest = hashHex([input.mutationKind, input.proposalId, input.intentHash].join("\0"));
  const pageId = `page_${dateKey}_${digest.slice(0, 16)}`;
  const operationId = `op_${dateKey}_${digest.slice(16, 32)}`;
  const pagePath = `wiki/generated/${dateKey.slice(0, 4)}/${pageId}.md`;
  const title = deriveTitle(input.proposedMarkdown);
  const markdown = createMarkdown({ ...input, pageId, operationId, title });
  const contentHash = `sha256:${hashHex(markdown)}`;
  const operation = OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: input.jobId,
    proposalId: input.proposalId,
    createdAt: input.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    modelProfileId: input.modelProfileId,
    policyAudit: {
      policyContextId: input.policyContextId,
      policyHash: input.policyHash,
      enforcementOwners: ["Current Note Conflict Save As Note Service"]
    },
    kind: "create_page",
    targetRefs: [{ kind: "page", id: pageId, path: pagePath }],
    sourceRefs: [
      { kind: "job", id: input.jobId },
      { kind: "proposal", id: input.proposalId, checksum: input.intentHash },
      { kind: "page", id: input.originalPageId, checksum: input.currentRevision.replace("noteeditrev_", "sha256:") }
    ],
    after: { kind: "page", id: contentHash, path: pagePath },
    summary: `Saved the reviewed ${input.mutationKind} proposal as a new note without changing the current note.`,
    reversible: "best_effort",
    rollbackHint: "Move the generated note to trash after verifying that it has not changed.",
    warnings: []
  });
  return { pageId, pagePath, markdown, operation };
}

function createMarkdown(input: CurrentNoteConflictSaveInput & {
  readonly pageId: string;
  readonly operationId: string;
  readonly title: string;
}): string {
  const body = input.proposedMarkdown.trim();
  const markdown = `---\nid: ${JSON.stringify(input.pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(input.title)}\ntype: "note"\ncreated_at: ${JSON.stringify(input.createdAt)}\nupdated_at: ${JSON.stringify(input.createdAt)}\nstatus: "active"\nlanguage: "und"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: [${JSON.stringify(input.originalPageId)}]\nprovenance:\n  generated_by: "pige"\n  last_job_id: ${JSON.stringify(input.jobId)}\n  last_operation_id: ${JSON.stringify(input.operationId)}\n  model_profile_id: ${JSON.stringify(input.modelProfileId)}\n  confidence: "high"\nnote:\n  note_kind: "summary"\n  review_state: "clean"\n---\n\n# ${escapeHeading(input.title)}\n\n${body}\n`;
  if (Buffer.byteLength(markdown, "utf8") > MAX_PAGE_BYTES || !parsePigeFrontmatter(markdown)) {
    throw conflict("The saved proposal note is invalid or outside its size bound.");
  }
  return markdown;
}

function deriveTitle(markdown: string): string {
  const first = markdown.split(/\r?\n/gu)
    .map((line) => line.replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)])\s+/u, "").trim())
    .find(Boolean) ?? "Saved proposed note";
  const safe = first.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ").trim() || "Saved proposed note";
  return Array.from(safe).slice(0, 120).join("");
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw conflict("The saved proposal note path escaped the Vault.");
  return resolved;
}

function hashHex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function escapeHeading(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|>~-])/gu, "\\$1");
}

function conflict(message: string): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_conflict", message);
}
