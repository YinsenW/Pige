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

  it("reuses a deterministic job-scoped proposal across retries and service restart", () => {
    const { vaultPath, vault } = makeVault();
    const request = {
      jobId: "job_20260709_abcdef123456",
      trustLevel: "review_required" as const,
      summary: "Review generated note",
      reason: "The Agent produced a low-confidence note.",
      sourceRefs: [{ kind: "job" as const, id: "job_20260709_abcdef123456" }],
      targetRefs: [{ kind: "page" as const, id: "page_20260709_abcdef123456", path: "wiki/generated.md" }],
      proposedOperations: [{ kind: "create" as const, path: "wiki/generated.md", content: "# Generated\n" }]
    };

    const first = makeService(vaultPath, vault).stage(request);
    const retried = makeService(vaultPath, vault).stage(request);
    const records = listFiles(path.join(vaultPath, ".pige", "proposals"));

    expect(first.proposal.id).toBe(retried.proposal.id);
    expect(first.proposal.createdAt).toBe(retried.proposal.createdAt);
    expect(first.proposal.id).toMatch(/^proposal_20260709_[a-f0-9]{16}$/u);
    expect(records.filter((filePath) => filePath.endsWith(".json"))).toHaveLength(1);
  });

  it("fails closed when one job tries to replace its deterministic proposal intent", () => {
    const { vaultPath, vault } = makeVault();
    const service = makeService(vaultPath, vault);
    const base = {
      jobId: "job_20260709_abcdef123456",
      trustLevel: "review_required" as const,
      summary: "Review generated note",
      reason: "The Agent produced a low-confidence note."
    };
    const first = service.stage({
      ...base,
      proposedOperations: [{ kind: "create", path: "wiki/first.md", content: "# First\n" }]
    });
    expect(() => service.stage({
      ...base,
      proposedOperations: [{ kind: "create", path: "wiki/second.md", content: "# Second\n" }]
    })).toThrow("deterministic identity for different content");
    expect(service.list().proposals).toHaveLength(1);
    expect(service.get({ proposalId: first.proposal.id }).proposal.proposedOperations[0])
      .toMatchObject({ kind: "create", path: "wiki/first.md" });
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
    expect(fs.existsSync(path.join(vaultPath, "wiki", "old.md"))).toBe(false);
    expect(fs.existsSync(path.join(vaultPath, "wiki", "new.md"))).toBe(false);
  });

  it("persists idempotent applied and conflicted transitions for decision recovery", () => {
    const { vaultPath, vault } = makeVault();
    const service = makeService(vaultPath, vault);
    const first = service.stage({
      jobId: "job_20260709_abcdef123456",
      trustLevel: "review_required",
      summary: "Review first generated note",
      reason: "The first note requires review.",
      proposedOperations: [{ kind: "create", path: "wiki/generated/first.md", content: "# First\n" }]
    });
    const second = service.stage({
      jobId: "job_20260709_bcdefa123456",
      trustLevel: "review_required",
      summary: "Review second generated note",
      reason: "The second note requires review.",
      proposedOperations: [{ kind: "create", path: "wiki/generated/second.md", content: "# Second\n" }]
    });

    expect(service.markApplied(first.proposal.id).status).toBe("not_allowed");
    expect(service.approve({ proposalId: first.proposal.id }).status).toBe("approved");
    expect(service.markApplied(first.proposal.id).status).toBe("applied");
    expect(service.markApplied(first.proposal.id).status).toBe("applied");
    expect(service.approve({ proposalId: second.proposal.id }).status).toBe("approved");
    expect(service.markConflicted(second.proposal.id).status).toBe("conflicted");
    expect(service.markConflicted(second.proposal.id).status).toBe("conflicted");

    const restarted = makeService(vaultPath, vault);
    expect(restarted.get({ proposalId: first.proposal.id }).proposal.state).toBe("applied");
    expect(restarted.get({ proposalId: second.proposal.id }).proposal.state).toBe("conflicted");
    expect(restarted.recoveryCandidates().map((proposal) => proposal.id)).toEqual([
      first.proposal.id,
      second.proposal.id
    ]);
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
    })).toThrow("Proposal paths must stay canonically inside the active vault");

    expect(() => service.stage({
      trustLevel: "review_required",
      summary: "Unsafe Windows path",
      reason: "Should be blocked.",
      proposedOperations: [{ kind: "create", path: "C:\\Users\\source.md", content: "# Escape\n" }]
    })).toThrow("Proposal paths must be canonical vault-relative paths");

    for (const unsafePath of ["wiki\\note.md", "wiki/./note.md", "wiki//note.md", "wiki/note.md/"]) {
      expect(() => service.stage({
        trustLevel: "review_required",
        summary: "Ambiguous path",
        reason: "Should be blocked.",
        proposedOperations: [{ kind: "create", path: unsafePath, content: "# Escape\n" }]
      })).toThrow("Proposal paths must");
    }

    expect(() => service.stage({
      trustLevel: "review_required",
      summary: "Unsafe ref",
      reason: "Should be blocked.",
      sourceRefs: [{ kind: "page", id: "page_20260709_abcdef123456", path: "/Users/example/private.md" }],
      proposedOperations: [{ kind: "create", path: "wiki/note.md", content: "# Note\n" }]
    })).toThrow("Proposal paths must");

    expect(() => service.stage({
      trustLevel: "review_required",
      summary: "Unsafe base hash",
      reason: "Should be blocked.",
      proposedOperations: [{ kind: "update", path: "wiki/note.md", beforeSha256: sha("a"), content: "# Note\n" }],
      baseHashes: { "wiki/./note.md": sha("a") }
    })).toThrow("Proposal paths must");
  });

  it("rejects restricted secrets and private paths before proposal persistence", () => {
    const { vaultPath, vault } = makeVault();
    const service = makeService(vaultPath, vault);
    const cases = [
      { summary: "apiKey=opaque-value-123456", reason: "Unsafe summary", content: "# Safe\n" },
      { summary: "Unsafe reason", reason: "See file:///Users/alice/vault/private.md", content: "# Safe\n" },
      { summary: "Unsafe content", reason: "Should be blocked", content: '{"apiKey":"opaque-value-123456"}' }
    ];

    for (const [index, fixture] of cases.entries()) {
      expect(() => service.stage({
        jobId: `job_20260709_abcdef12345${index}`,
        trustLevel: "review_required",
        summary: fixture.summary,
        reason: fixture.reason,
        proposedOperations: [{ kind: "create", path: `wiki/note-${index}.md`, content: fixture.content }]
      })).toThrow(/Restricted paths|Restricted paths or secret-like values/u);
    }

    expect(() => service.stage({
      jobId: "job_20260709_abcdef123459",
      trustLevel: "review_required",
      summary: "Unsafe ref",
      reason: "Should be blocked",
      sourceRefs: [{ kind: "source", id: "file:///Users/alice/vault/private.md" }],
      proposedOperations: [{ kind: "create", path: "wiki/ref.md", content: "# Safe\n" }]
    })).toThrow("Restricted paths or secret-like values");

    expect(service.list().proposals).toHaveLength(0);
  });

  it("rejects restricted decision reasons without changing the ready proposal", () => {
    const { vaultPath, vault } = makeVault();
    const service = makeService(vaultPath, vault);
    const staged = service.stage({
      trustLevel: "review_required",
      summary: "Review generated note",
      reason: "The generated note needs review.",
      proposedOperations: [{ kind: "create", path: "wiki/note.md", content: "# Safe\n" }]
    });

    expect(() => service.approve({
      proposalId: staged.proposal.id,
      reason: "apiKey=opaque-value-123456"
    })).toThrow("Restricted paths or secret-like values");
    expect(service.get({ proposalId: staged.proposal.id }).proposal.state).toBe("ready");
  });

  it("quarantines externally edited records whose safe summary contains a secret", () => {
    const { vaultPath, vault } = makeVault();
    const service = makeService(vaultPath, vault);
    const staged = service.stage({
      trustLevel: "review_required",
      summary: "Review generated note",
      reason: "The generated note needs review.",
      proposedOperations: [{ kind: "create", path: "wiki/note.md", content: "# Safe\n" }]
    });
    const recordPath = findFile(path.join(vaultPath, ".pige", "proposals"), `${staged.proposal.id}.json`);
    fs.writeFileSync(recordPath, `${JSON.stringify({
      ...staged.proposal,
      summary: "apiKey=opaque-value-123456"
    }, null, 2)}\n`, "utf8");

    const listed = service.list();

    expect(listed.proposals).toHaveLength(0);
    expect(listed.invalidProposalCount).toBe(1);
    expect(JSON.stringify(listed)).not.toContain("opaque-value-123456");
    expect(() => service.get({ proposalId: staged.proposal.id })).toThrow("Restricted paths or secret-like values");
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked proposal root without writing outside the vault", () => {
    const { vaultPath, vault } = makeVault();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pige-proposal-outside-"));
    tempRoots.push(outside);
    const proposalRoot = path.join(vaultPath, ".pige", "proposals");
    fs.rmSync(proposalRoot, { recursive: true, force: true });
    fs.symlinkSync(outside, proposalRoot, "dir");

    expect(() => makeService(vaultPath, vault).stage({
      jobId: "job_20260709_abcdef123456",
      trustLevel: "review_required",
      summary: "Review generated note",
      reason: "Should remain confined.",
      proposedOperations: [{ kind: "create", path: "wiki/note.md", content: "# Note\n" }]
    })).toThrow("Proposal paths cannot traverse symbolic links");
    expect(fs.readdirSync(outside)).toHaveLength(0);
  });

  it.skipIf(process.platform === "win32")("counts a symlinked proposal record without reading external content", () => {
    const { vaultPath, vault } = makeVault();
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pige-proposal-record-")), "external.json");
    tempRoots.push(path.dirname(outside));
    fs.writeFileSync(outside, JSON.stringify({ privateCanary: "external-proposal-body" }), "utf8");
    const recordRoot = path.join(vaultPath, ".pige", "proposals", "2026", "07");
    fs.mkdirSync(recordRoot, { recursive: true });
    const proposalId = "proposal_20260709_abcdef123456";
    fs.symlinkSync(outside, path.join(recordRoot, `${proposalId}.json`), "file");

    const listed = makeService(vaultPath, vault).list();

    expect(listed.proposals).toHaveLength(0);
    expect(listed.invalidProposalCount).toBe(1);
    expect(JSON.stringify(listed)).not.toContain("external-proposal-body");
    expect(() => makeService(vaultPath, vault).get({ proposalId })).toThrow("regular file");
  });

  it.skipIf(process.platform === "win32")("rejects a hard-linked external proposal record", () => {
    const { vaultPath, vault } = makeVault();
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pige-proposal-hardlink-")), "external.json");
    tempRoots.push(path.dirname(outside));
    fs.writeFileSync(outside, JSON.stringify({ privateCanary: "hardlink-proposal-body" }), "utf8");
    const recordRoot = path.join(vaultPath, ".pige", "proposals", "2026", "07");
    fs.mkdirSync(recordRoot, { recursive: true });
    const proposalId = "proposal_20260709_abcdef123456";
    fs.linkSync(outside, path.join(recordRoot, `${proposalId}.json`));

    const listed = makeService(vaultPath, vault).list();

    expect(listed.proposals).toHaveLength(0);
    expect(listed.invalidProposalCount).toBe(1);
    expect(JSON.stringify(listed)).not.toContain("hardlink-proposal-body");
    expect(() => makeService(vaultPath, vault).get({ proposalId })).toThrow("regular file");
  });
});

function sha(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

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
