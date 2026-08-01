import { createHash } from "node:crypto";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  createGeneratedNoteExclusive,
  readGeneratedNoteExact
} from "./generated-note-file";

const MAX_RESOLUTION_BYTES = 32 * 1024;
const PROPOSAL_ID = /^proposal_[a-z0-9_]{8,128}$/u;
const INTENT_HASH = /^sha256:[a-f0-9]{64}$/u;
const NOTE_REVISION = /^noteeditrev_[a-f0-9]{64}$/u;

export type CurrentNoteConflictMutationKind = "append" | "replace";
export type CurrentNoteConflictLine = {
  readonly kind: "context" | "removed" | "added";
  readonly text: string;
};

export interface CurrentNoteConflictResolution {
  readonly proposalId: string;
  readonly intentHash: string;
  readonly currentRevision: `noteeditrev_${string}`;
  readonly lines: readonly CurrentNoteConflictLine[];
}

interface ResolutionRecord extends CurrentNoteConflictResolution {
  readonly schemaVersion: 1;
  readonly kind: "current_note_conflict_resolution";
  readonly mutationKind: CurrentNoteConflictMutationKind;
  readonly decision: "keep_current";
  readonly decidedAt: string;
}

export function currentNoteConflictRevision(markdown: string): `noteeditrev_${string}` {
  return `noteeditrev_${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
}

export function projectCurrentNoteConflictLines(
  original: readonly CurrentNoteConflictLine[],
  currentMarkdown: string
): readonly CurrentNoteConflictLine[] {
  const base = original.find((line) => line.kind === "context" || line.kind === "removed");
  const current = currentMarkdown.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1) ?? "Current note";
  const proposed = original.filter((line) => line.kind === "added").slice(0, 6);
  return [
    ...(base ? [{ kind: "removed" as const, text: truncateSafe(base.text) }] : []),
    { kind: "context" as const, text: truncateSafe(current) },
    ...proposed.map((line) => ({ kind: "added" as const, text: truncateSafe(line.text) }))
  ].slice(0, 8);
}

export class CurrentNoteConflictReviewService {
  read(input: {
    readonly vaultPath: string;
    readonly mutationKind: CurrentNoteConflictMutationKind;
    readonly proposalId: string;
    readonly intentHash: string;
  }): CurrentNoteConflictResolution | undefined {
    assertIdentity(input.proposalId, input.intentHash);
    const raw = readGeneratedNoteExact(
      input.vaultPath,
      resolutionPath(input.vaultPath, input.mutationKind, input.proposalId),
      MAX_RESOLUTION_BYTES
    );
    if (raw === undefined) return undefined;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw conflict("The current-note conflict resolution is invalid."); }
    if (!isResolution(value) || value.mutationKind !== input.mutationKind || value.intentHash !== input.intentHash) {
      throw conflict("The current-note conflict resolution changed immutable identity.");
    }
    return projectResolution(value);
  }

  keepCurrent(input: {
    readonly vaultPath: string;
    readonly mutationKind: CurrentNoteConflictMutationKind;
    readonly proposalId: string;
    readonly intentHash: string;
    readonly currentRevision: `noteeditrev_${string}`;
    readonly lines: readonly CurrentNoteConflictLine[];
  }): CurrentNoteConflictResolution {
    assertIdentity(input.proposalId, input.intentHash);
    if (!NOTE_REVISION.test(input.currentRevision) || !validLines(input.lines)) {
      throw conflict("The current-note conflict review is outside its safe bound.");
    }
    const record: ResolutionRecord = {
      schemaVersion: 1,
      kind: "current_note_conflict_resolution",
      mutationKind: input.mutationKind,
      proposalId: input.proposalId,
      intentHash: input.intentHash,
      currentRevision: input.currentRevision,
      lines: input.lines,
      decision: "keep_current",
      decidedAt: new Date().toISOString()
    };
    const target = resolutionPath(input.vaultPath, input.mutationKind, input.proposalId);
    const result = createGeneratedNoteExclusive(input.vaultPath, target, `${JSON.stringify(record, null, 2)}\n`);
    const durable = this.read(input);
    if (!durable) throw conflict("The current-note conflict resolution could not be adopted.");
    if (result === "exists" && stableIdentity(durable) !== stableIdentity(projectResolution(record))) {
      throw conflict("The current-note conflict was already resolved against another revision.");
    }
    return durable;
  }
}

function resolutionPath(vaultPath: string, mutationKind: CurrentNoteConflictMutationKind, proposalId: string): string {
  return path.join(vaultPath, ".pige", "agent", `current-note-${mutationKind}-proposals`, `${proposalId}.conflict-resolution.json`);
}

function assertIdentity(proposalId: string, intentHash: string): void {
  if (!PROPOSAL_ID.test(proposalId) || !INTENT_HASH.test(intentHash)) throw conflict("The current-note conflict identity is invalid.");
}

function isResolution(value: unknown): value is ResolutionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ResolutionRecord>;
  return record.schemaVersion === 1 && record.kind === "current_note_conflict_resolution" &&
    (record.mutationKind === "append" || record.mutationKind === "replace") &&
    record.decision === "keep_current" && typeof record.decidedAt === "string" &&
    typeof record.proposalId === "string" && PROPOSAL_ID.test(record.proposalId) &&
    typeof record.intentHash === "string" && INTENT_HASH.test(record.intentHash) &&
    typeof record.currentRevision === "string" && NOTE_REVISION.test(record.currentRevision) &&
    Array.isArray(record.lines) && validLines(record.lines);
}

function validLines(value: readonly unknown[]): value is readonly CurrentNoteConflictLine[] {
  return value.length <= 8 && value.every((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) return false;
    const item = line as Partial<CurrentNoteConflictLine>;
    return (item.kind === "context" || item.kind === "removed" || item.kind === "added") &&
      typeof item.text === "string" && item.text.length > 0 && Array.from(item.text).length <= 160 &&
      !/[\u0000-\u001f\u007f]/u.test(item.text);
  });
}

function projectResolution(record: ResolutionRecord): CurrentNoteConflictResolution {
  return {
    proposalId: record.proposalId,
    intentHash: record.intentHash,
    currentRevision: record.currentRevision,
    lines: record.lines
  };
}

function stableIdentity(value: CurrentNoteConflictResolution): string {
  return JSON.stringify(value);
}

function truncateSafe(value: string): string {
  const safe = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return Array.from(safe).slice(0, 160).join("") || "(empty)";
}

function conflict(message: string): PigeDomainError {
  return new PigeDomainError("agent_runtime.turn_conflict", message);
}
