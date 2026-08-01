import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CurrentNoteConflictReviewService,
  currentNoteConflictRevision,
  projectCurrentNoteConflictLines
} from "../../apps/desktop/src/main/services/current-note-conflict-review-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("CurrentNoteConflictReviewService", () => {
  it("projects a bounded escaped unified review and adopts one exact keep-current resolution", () => {
    const vaultPath = temporaryVault();
    const service = new CurrentNoteConflictReviewService();
    const lines = projectCurrentNoteConflictLines([
      { kind: "context", text: "Reviewed base" },
      { kind: "added", text: "Proposed addition" }
    ], "---\ntype: note\n---\nCurrent\u0000 live line");
    expect(lines).toEqual([
      { kind: "removed", text: "Reviewed base" },
      { kind: "context", text: "Current  live line" },
      { kind: "added", text: "Proposed addition" }
    ]);
    const currentRevision = currentNoteConflictRevision("current bytes");
    const input = {
      vaultPath,
      mutationKind: "append" as const,
      proposalId: "proposal_20260801_conflict001",
      intentHash: `sha256:${"a".repeat(64)}`,
      currentRevision,
      lines
    };
    expect(service.resolve({ ...input, decision: "keep_current" })).toEqual({
      proposalId: input.proposalId,
      intentHash: input.intentHash,
      currentRevision,
      lines,
      decision: "keep_current"
    });
    expect(new CurrentNoteConflictReviewService().read(input)).toEqual(service.read(input));
    expect(() => service.resolve({ ...input, currentRevision: currentNoteConflictRevision("other bytes"), decision: "keep_current" })).toThrow("another revision");

    const applied = { ...input, proposalId: "proposal_20260801_conflict003", decision: "apply_proposed" as const, operationId: "op_20260801_conflictapply01" };
    expect(service.resolve(applied)).toMatchObject({ decision: "apply_proposed", operationId: applied.operationId });
    expect(() => service.resolve({ ...applied, operationId: undefined })).toThrow("outside its safe bound");
    const saved = {
      ...input,
      proposalId: "proposal_20260801_conflict004",
      decision: "save_proposed_as_note" as const,
      operationId: "op_20260801_conflictsave001",
      createdPageId: "page_20260801_conflictsave001"
    };
    expect(service.resolve(saved)).toMatchObject({
      decision: "save_proposed_as_note",
      operationId: saved.operationId,
      createdPageId: saved.createdPageId
    });
  });

  it.skipIf(process.platform === "win32")("fails closed when the private proposal parent is a symlink", () => {
    const vaultPath = temporaryVault();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-conflict-outside-"));
    roots.push(outside);
    fs.mkdirSync(path.join(vaultPath, ".pige", "agent"), { recursive: true });
    fs.symlinkSync(outside, path.join(vaultPath, ".pige", "agent", "current-note-append-proposals"));
    expect(() => new CurrentNoteConflictReviewService().resolve({
      vaultPath,
      mutationKind: "append",
      proposalId: "proposal_20260801_conflict002",
      intentHash: `sha256:${"b".repeat(64)}`,
      currentRevision: currentNoteConflictRevision("current bytes"),
      lines: [{ kind: "context", text: "Current" }],
      decision: "keep_current"
    })).toThrow();
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

function temporaryVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-conflict-"));
  roots.push(root);
  return root;
}
