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
    expect(service.keepCurrent(input)).toEqual({
      proposalId: input.proposalId,
      intentHash: input.intentHash,
      currentRevision,
      lines
    });
    expect(new CurrentNoteConflictReviewService().read(input)).toEqual(service.read(input));
    expect(() => service.keepCurrent({ ...input, currentRevision: currentNoteConflictRevision("other bytes") })).toThrow("another revision");
  });

  it.skipIf(process.platform === "win32")("fails closed when the private proposal parent is a symlink", () => {
    const vaultPath = temporaryVault();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-conflict-outside-"));
    roots.push(outside);
    fs.mkdirSync(path.join(vaultPath, ".pige", "agent"), { recursive: true });
    fs.symlinkSync(outside, path.join(vaultPath, ".pige", "agent", "current-note-append-proposals"));
    expect(() => new CurrentNoteConflictReviewService().keepCurrent({
      vaultPath,
      mutationKind: "append",
      proposalId: "proposal_20260801_conflict002",
      intentHash: `sha256:${"b".repeat(64)}`,
      currentRevision: currentNoteConflictRevision("current bytes"),
      lines: [{ kind: "context", text: "Current" }]
    })).toThrow();
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

function temporaryVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-note-conflict-"));
  roots.push(root);
  return root;
}
