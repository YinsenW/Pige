import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProposalService } from "../../apps/desktop/src/main/services/proposal-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import type { VaultSummary } from "@pige/contracts";

const tempRoots: string[] = [];

function makeVault(): { vaultPath: string; vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-proposal-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Proposals",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Proposals");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeService(vaultPath: string, vault: VaultSummary): ProposalService {
  return new ProposalService({
    current: () => vault,
    activeVaultPath: () => vaultPath
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("proposal service", () => {
  it("stages durable proposals and lists safe summaries without proposed content", () => {
    const { vaultPath, vault } = makeVault();
    const service = makeService(vaultPath, vault);
    const staged = service.stage({
      jobId: "job_20260709_abcdef123456",
      trustLevel: "review_required",
      summary: "Review update to existing note",
      reason: "The Agent wants to edit an existing page.",
      sourceRefs: [{ kind: "job", id: "job_20260709_abcdef123456" }],
      targetRefs: [{ kind: "page", id: "page_20260709_abcdef123456", path: "wiki/note.md" }],
      proposedOperations: [
        {
          kind: "update",
          path: "wiki/note.md",
          beforeSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          content: "# Proposed body\n\nLarge Markdown body stays out of summaries."
        }
      ],
      warnings: ["Check source confidence before applying."],
      baseHashes: {
        "wiki/note.md": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    });
    const listed = service.list();
    const fetched = service.get({ proposalId: staged.proposal.id });
    const proposalPath = findFile(path.join(vaultPath, ".pige/proposals"), `${staged.proposal.id}.json`);

    expect(staged.proposal.id).toMatch(/^proposal_\d{8}_[a-z0-9]{8,}$/);
    expect(fs.existsSync(proposalPath)).toBe(true);
    expect(listed.activeVaultId).toBe(vault.vaultId);
    expect(listed.invalidProposalCount).toBe(0);
    expect(listed.proposals).toHaveLength(1);
    expect(listed.proposals[0]).toMatchObject({
      id: staged.proposal.id,
      state: "ready",
      trustLevel: "review_required",
      operationCount: 1,
      warningCount: 1,
      targetCount: 1
    });
    expect(JSON.stringify(listed)).not.toContain("Large Markdown body");
    expect(fetched.proposal.proposedOperations[0]).toMatchObject({ kind: "update", path: "wiki/note.md" });
  });

  it("approves and rejects only ready proposals", () => {
    const { vaultPath, vault } = makeVault();
    const service = makeService(vaultPath, vault);
    const first = service.stage({
      trustLevel: "explicit_confirmation",
      summary: "Delete note",
      reason: "Deletes require explicit confirmation.",
      proposedOperations: [
        {
          kind: "delete",
          path: "wiki/old.md",
          beforeSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        }
      ],
      baseHashes: {
        "wiki/old.md": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    });
    const second = service.stage({
      trustLevel: "review_required",
      summary: "Create note",
      reason: "New note can be reviewed before apply.",
      proposedOperations: [{ kind: "create", path: "wiki/new.md", content: "# New\n" }]
    });

    const approved = service.approve({ proposalId: first.proposal.id, reason: "Looks right." });
    const rejected = service.reject({ proposalId: second.proposal.id, reason: "Not needed." });
    const repeatApprove = service.approve({ proposalId: first.proposal.id });

    expect(approved.status).toBe("approved");
    expect(approved.proposal?.state).toBe("approved");
    expect(approved.proposal?.decision?.reason).toBe("Looks right.");
    expect(rejected.status).toBe("rejected");
    expect(rejected.proposal?.state).toBe("rejected");
    expect(repeatApprove.status).toBe("not_allowed");
    expect(repeatApprove.proposal?.state).toBe("approved");
  });

  it("counts invalid proposal records without failing lists", () => {
    const { vaultPath, vault } = makeVault();
    const service = makeService(vaultPath, vault);
    const invalidPath = path.join(vaultPath, ".pige", "proposals", "2026", "07", "broken.json");
    fs.mkdirSync(path.dirname(invalidPath), { recursive: true });
    fs.writeFileSync(invalidPath, "{not json", "utf8");

    const listed = service.list();

    expect(listed.invalidProposalCount).toBe(1);
    expect(listed.proposals).toHaveLength(0);
  });

  it("rejects proposed operations with unsafe paths", () => {
    const { vaultPath, vault } = makeVault();
    const service = makeService(vaultPath, vault);

    expect(() => service.stage({
      trustLevel: "review_required",
      summary: "Unsafe update",
      reason: "Should be blocked.",
      proposedOperations: [{ kind: "create", path: "../outside.md", content: "# Escape\n" }]
    })).toThrow("Proposal paths must stay inside the active vault");

    expect(() => service.stage({
      trustLevel: "review_required",
      summary: "Unsafe Windows path",
      reason: "Should be blocked.",
      proposedOperations: [{ kind: "create", path: "C:\\Users\\source.md", content: "# Escape\n" }]
    })).toThrow("Proposal paths must be safe vault-relative paths");
  });
});

function findFile(root: string, suffix: string): string {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(fullPath, suffix);
      if (found) return found;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      return fullPath;
    }
  }
  throw new Error(`Missing file ending with ${suffix}`);
}

function findFileOptional(root: string, suffix: string): string | undefined {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(fullPath, suffix);
      if (found) return found;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      return fullPath;
    }
  }
  return undefined;
}
