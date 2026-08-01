import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JobRecord, OperationRecord } from "@pige/schemas";
import {
  finalizeAgentPageUpdateUndo,
  readAgentPageUpdateOperationBinding
} from "../../apps/desktop/src/main/services/agent-page-update-service";
import {
  CurrentNoteReplaceService,
  type CurrentNoteReplaceRequest
} from "../../apps/desktop/src/main/services/current-note-replace-service";
import { readCurrentNoteEvidenceBinding } from "../../apps/desktop/src/main/services/retrieval-evidence-boundary";

const VAULT_ID = "vault_20260728_notereplace";
const PAGE_ID = "page_20260728_notereplace";
const JOB_ID = "job_20260728_notereplace01";
const PAGE_PATH = `wiki/generated/2026/${PAGE_ID}.md`;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("CurrentNoteReplaceService", () => {
  it("commits one evidence-bound whole-note replacement and remains compatible with exact Activity Undo", () => {
    const fixture = createFixture();
    const staged = requireReview(fixture.service.replace(fixture.request));
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.initialMarkdown);
    const result = requireApplied(fixture.service.decideProposal({
      vaultPath: fixture.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: staged.proposal.proposalId,
      expectedRevision: staged.proposal.revision,
      decision: "approve"
    }));
    expect(result.operation).toMatchObject({
      id: expect.stringMatching(/^op_20260728_[a-f0-9]{12}$/u),
      jobId: JOB_ID,
      actor: { kind: "pige_agent" },
      modelProfileId: "model_note_replace",
      kind: "update_page",
      targetRefs: [{ kind: "page", id: PAGE_ID, path: PAGE_PATH }],
      sourceRefs: [
        { kind: "job", id: JOB_ID },
        { kind: "artifact", id: expect.stringMatching(/^art_current_note_replace_[a-f0-9]{16}$/u), checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) }
      ],
      reversible: "yes"
    });
    expect(readAgentPageUpdateOperationBinding(result.operation)).toMatchObject({ pageId: PAGE_ID, pagePath: PAGE_PATH });
    const manualPathOperation: OperationRecord = {
      ...result.operation,
      targetRefs: [{ kind: "page", id: PAGE_ID, path: "wiki/manual-note.md" }],
      after: { ...result.operation.after!, path: "wiki/manual-note.md" }
    };
    expect(readAgentPageUpdateOperationBinding(manualPathOperation)).toMatchObject({ pagePath: "wiki/manual-note.md" });
    expect(readAgentPageUpdateOperationBinding({
      ...manualPathOperation,
      sourceRefs: manualPathOperation.sourceRefs.map((ref) => ref.kind === "artifact"
        ? { ...ref, id: "art_reader_selection_0123456789abcdef" }
        : ref)
    })).toBeUndefined();

    const replaced = fs.readFileSync(fixture.pagePath, "utf8");
    expect(replaced).toContain("A concise durable conclusion.");
    expect(replaced).toContain("Evidence: [citation_1]");
    expect(replaced).not.toContain("Initial durable body.");
    expect(replaced).not.toContain("pige:managed:");
    expect(replaced).not.toContain("[source:");

    const undo = finalizeAgentPageUpdateUndo(fixture.vaultPath, result.operation, true);
    expect(undo).toMatchObject({ kind: "update_page", actor: { kind: "user" } });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.initialMarkdown);
  });

  it("deduplicates the same Job and adopts a page effect whose Operation commit was interrupted", () => {
    const fixture = createFixture();
    const staged = requireReview(fixture.service.replace(fixture.request));
    const applied = requireApplied(fixture.service.decideProposal({
      vaultPath: fixture.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: staged.proposal.proposalId,
      expectedRevision: staged.proposal.revision,
      decision: "approve"
    }));
    const first = { operation: applied.operation };
    expect(requireCommitted(new CurrentNoteReplaceService().recover(fixture.request))).toMatchObject({
      recovered: true,
      operation: { id: first.operation.id }
    });
    expect(fs.readFileSync(fixture.pagePath, "utf8").match(/A concise durable conclusion\./gu)).toHaveLength(1);

    fs.unlinkSync(operationFile(fixture.vaultPath, first.operation.id));
    const outcomeFile = listPrivateFiles(fixture.vaultPath).find((file) => file.endsWith(".outcome.json"));
    if (!outcomeFile) throw new Error("Expected a durable replacement outcome fixture.");
    fs.unlinkSync(outcomeFile);
    const adopted = requireCommitted(new CurrentNoteReplaceService().recover(fixture.request));
    expect(adopted).toMatchObject({ recovered: true, operation: { id: first.operation.id } });
    expect(fs.readFileSync(fixture.pagePath, "utf8").match(/A concise durable conclusion\./gu)).toHaveLength(1);
    expect(listOperationFiles(fixture.vaultPath)).toHaveLength(1);

    expect(fixture.service.publish(fixture.request)).toEqual({ status: "applied", operationId: first.operation.id });
    expect(fixture.service.readPublication({
      vaultPath: fixture.vaultPath,
      activeVaultId: VAULT_ID,
      job: fixture.request.job
    })).toEqual({ status: "applied", operationId: first.operation.id });

    expect(() => fixture.service.replace({
      ...fixture.request,
      markdown: "A different replacement for the same durable Job."
    })).toThrow("occupied by different facts");
  });

  it("creates one bounded private review on first drift and applies once against the re-proven base", () => {
    const fixture = createFixture();
    const externallyEdited = fixture.initialMarkdown.replace("Initial durable body.", "External durable body.");
    fs.writeFileSync(fixture.pagePath, externallyEdited, "utf8");

    const staged = fixture.service.replace(fixture.request);
    expect(staged.status).toBe("awaiting_review");
    if (staged.status !== "awaiting_review") throw new Error("Expected a replacement review proposal.");
    expect(staged.proposal).toMatchObject({
      kind: "replace_current_note",
      state: "ready",
      revision: 1,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID
    });
    expect(fixture.service.readPublication({
      vaultPath: fixture.vaultPath,
      activeVaultId: VAULT_ID,
      job: fixture.request.job
    })).toEqual({ status: "review_required", proposalId: staged.proposal.proposalId });
    const serializedPreview = JSON.stringify(staged.proposal);
    expect(serializedPreview).not.toContain(PAGE_PATH);
    expect(serializedPreview).not.toContain("sha256:");
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(externallyEdited);
    expect(listOperationFiles(fixture.vaultPath)).toEqual([]);

    expect(fixture.service.get({
      vaultPath: fixture.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: staged.proposal.proposalId
    })).toEqual(staged.proposal);
    const decided = fixture.service.decideProposal({
      vaultPath: fixture.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: staged.proposal.proposalId,
      expectedRevision: staged.proposal.revision,
      decision: "approve"
    });
    expect(decided.status).toBe("applied");
    if (decided.status !== "applied") throw new Error("Expected an applied proposal.");
    expect(decided.proposal.state).toBe("applied");
    expect(fixture.service.decideProposal({
      vaultPath: fixture.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: staged.proposal.proposalId,
      expectedRevision: staged.proposal.revision,
      decision: "approve"
    })).toMatchObject({ status: "applied", operation: { id: decided.operation.id } });
    expect(() => fixture.service.decideProposal({
      vaultPath: fixture.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: staged.proposal.proposalId,
      expectedRevision: staged.proposal.revision,
      decision: "reject"
    })).toThrow("another durable decision");
    const committed = fs.readFileSync(fixture.pagePath, "utf8");
    expect(committed).not.toContain("External durable body.");
    expect(committed).toContain("A concise durable conclusion.");
    expect(committed).not.toContain("pige:managed:");
  });

  it("rejects cancelled Jobs and tampered private intent before writing note bytes", () => {
    const cancelled = createFixture();
    expect(() => cancelled.service.replace({
      ...cancelled.request,
      job: {
        ...cancelled.request.job,
        state: "cancel_requested",
        cancellation: {
          requestedAt: "2026-07-28T10:00:01.000Z",
          requestedBy: "user",
          durableWritesApplied: false
        }
      }
    })).toThrow("not bound to one successful current-note inspection");
    expect(fs.readFileSync(cancelled.pagePath, "utf8")).toBe(cancelled.initialMarkdown);
    expect(fs.existsSync(path.join(cancelled.vaultPath, ".pige"))).toBe(false);

    const tampered = createFixture({ jobId: "job_20260728_notereplace03" });
    fs.writeFileSync(
      tampered.pagePath,
      tampered.initialMarkdown.replace("Initial durable body.", "External review base."),
      "utf8"
    );
    const staged = requireReview(tampered.service.replace(tampered.request));
    const intentFile = listPrivateFiles(tampered.vaultPath).find((file) => file.endsWith(".intent.json"));
    if (!intentFile) throw new Error("Expected one private append intent fixture.");
    const intent = JSON.parse(fs.readFileSync(intentFile, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(intentFile, `${JSON.stringify({ ...intent, activeVaultId: "vault_20260728_tampered" }, null, 2)}\n`, "utf8");
    const beforeDecision = fs.readFileSync(tampered.pagePath, "utf8");
    expect(() => tampered.service.decideProposal({
      vaultPath: tampered.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: tampered.request.job.id,
      proposalId: staged.proposal.proposalId,
      expectedRevision: staged.proposal.revision,
      decision: "approve"
    })).toThrow("immutable Job, page, and intent binding");
    expect(fs.readFileSync(tampered.pagePath, "utf8")).toBe(beforeDecision);
    expect(listOperationFiles(tampered.vaultPath)).toEqual([]);
  });

  it("fails a second drift closed and records rejection without writing the page", () => {
    const conflicted = createFixture();
    fs.writeFileSync(conflicted.pagePath, conflicted.initialMarkdown.replace("Initial durable body.", "First drift."), "utf8");
    const staged = requireReview(conflicted.service.replace(conflicted.request));
    const secondDrift = conflicted.initialMarkdown.replace("Initial durable body.", "Second drift.");
    fs.writeFileSync(conflicted.pagePath, secondDrift, "utf8");
    const decision = conflicted.service.decideProposal({
      vaultPath: conflicted.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: staged.proposal.proposalId,
      expectedRevision: staged.proposal.revision,
      decision: "approve"
    });
    expect(decision).toMatchObject({
      status: "conflicted",
      proposal: {
        state: "conflicted",
        revision: 3,
        currentRevision: expect.stringMatching(/^noteeditrev_[a-f0-9]{64}$/u),
        lines: [
          expect.objectContaining({ kind: "removed", text: expect.stringContaining("First drift") }),
          expect.objectContaining({ kind: "context", text: expect.stringContaining("Second drift") }),
          expect.objectContaining({ kind: "added", text: expect.stringContaining("concise durable conclusion") })
        ]
      }
    });
    expect(fs.readFileSync(conflicted.pagePath, "utf8")).toBe(secondDrift);
    expect(listOperationFiles(conflicted.vaultPath)).toEqual([]);

    const thirdDrift = conflicted.initialMarkdown.replace("Initial durable body.", "Third drift.");
    fs.writeFileSync(conflicted.pagePath, thirdDrift, "utf8");
    const stale = conflicted.service.decideProposal({
      vaultPath: conflicted.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: staged.proposal.proposalId,
      expectedRevision: decision.proposal.revision,
      decision: "keep_current",
      expectedCurrentRevision: decision.proposal.currentRevision
    });
    expect(stale).toMatchObject({ status: "stale", proposal: { state: "conflicted", revision: 3 } });
    if (stale.status !== "stale" || !stale.proposal?.currentRevision) throw new Error("Expected a refreshed exact conflict review.");
    const kept = conflicted.service.decideProposal({
      vaultPath: conflicted.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: staged.proposal.proposalId,
      expectedRevision: stale.proposal.revision,
      decision: "keep_current",
      expectedCurrentRevision: stale.proposal.currentRevision
    });
    expect(kept).toMatchObject({ status: "rejected", proposal: { state: "rejected", revision: 4 } });
    expect(new CurrentNoteReplaceService().getProposal({
      vaultPath: conflicted.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: JOB_ID,
      proposalId: staged.proposal.proposalId
    })).toMatchObject({ state: "rejected", revision: 4 });
    expect(fs.readFileSync(conflicted.pagePath, "utf8")).toBe(thirdDrift);
    expect(listOperationFiles(conflicted.vaultPath)).toEqual([]);

    const rejected = createFixture({ jobId: "job_20260728_notereplace02" });
    fs.writeFileSync(rejected.pagePath, rejected.initialMarkdown.replace("Initial durable body.", "Review base."), "utf8");
    const rejectedStage = requireReview(rejected.service.replace(rejected.request));
    const beforeReject = fs.readFileSync(rejected.pagePath, "utf8");
    expect(rejected.service.decide({
      vaultPath: rejected.vaultPath,
      activeVaultId: VAULT_ID,
      pageId: PAGE_ID,
      jobId: rejected.request.job.id,
      proposalId: rejectedStage.proposal.proposalId,
      expectedRevision: rejectedStage.proposal.revision,
      decision: "reject"
    })).toEqual({ status: "resolved", proposalId: rejectedStage.proposal.proposalId });
    expect(fs.readFileSync(rejected.pagePath, "utf8")).toBe(beforeReject);
    expect(listOperationFiles(rejected.vaultPath)).toEqual([]);
  });

  it("applies the proposed replacement only against the exact reviewed conflict revision and Undo restores those live bytes", () => {
    const fixture = createFixture();
    fs.writeFileSync(fixture.pagePath, fixture.initialMarkdown.replace("Initial durable body.", "First drift."), "utf8");
    const staged = requireReview(fixture.service.replace(fixture.request));
    const reviewedLive = fixture.initialMarkdown.replace("Initial durable body.", "Second drift.");
    fs.writeFileSync(fixture.pagePath, reviewedLive, "utf8");
    const conflicted = fixture.service.decideProposal({
      vaultPath: fixture.vaultPath, activeVaultId: VAULT_ID, pageId: PAGE_ID, jobId: JOB_ID,
      proposalId: staged.proposal.proposalId, expectedRevision: staged.proposal.revision, decision: "approve"
    });
    if (conflicted.status !== "conflicted" || !conflicted.proposal.currentRevision) throw new Error("Expected an exact conflict review.");
    const applied = fixture.service.decideProposal({
      vaultPath: fixture.vaultPath, activeVaultId: VAULT_ID, pageId: PAGE_ID, jobId: JOB_ID,
      proposalId: staged.proposal.proposalId, expectedRevision: conflicted.proposal.revision,
      decision: "apply_proposed", expectedCurrentRevision: conflicted.proposal.currentRevision
    });
    expect(applied).toMatchObject({ status: "applied", proposal: { state: "applied", revision: 4 } });
    if (applied.status !== "applied") throw new Error("Expected the conflicted replacement to apply.");
    const replaced = fs.readFileSync(fixture.pagePath, "utf8");
    expect(replaced).toContain("A concise durable conclusion.");
    expect(replaced).not.toContain("Second drift.");
    expect(new CurrentNoteReplaceService().decideProposal({
      vaultPath: fixture.vaultPath, activeVaultId: VAULT_ID, pageId: PAGE_ID, jobId: JOB_ID,
      proposalId: staged.proposal.proposalId, expectedRevision: 3,
      decision: "apply_proposed", expectedCurrentRevision: conflicted.proposal.currentRevision
    })).toMatchObject({ status: "applied", operation: { id: applied.operation.id } });
    finalizeAgentPageUpdateUndo(fixture.vaultPath, applied.operation, true);
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(reviewedLive);
  });

  it("rejects missing inspect authority, invented evidence, secrets, controls, and oversized text before persistence", () => {
    const fixture = createFixture();
    const invalidRequests: CurrentNoteReplaceRequest[] = [
      { ...fixture.request, inspection: { ...fixture.request.inspection, evidenceRefs: [] as unknown as ["citation_1"] } },
      { ...fixture.request, inspection: { ...fixture.request.inspection, evidenceRefs: ["citation_2"] as unknown as ["citation_1"] } },
      { ...fixture.request, markdown: "Invented evidence [citation_2]." },
      { ...fixture.request, markdown: "Invented [source:src_20260728_notowned#p1] evidence." },
      { ...fixture.request, markdown: "secret=sk-synthetic-12345678901234567890" },
      { ...fixture.request, markdown: "unsafe\u0000control" },
      { ...fixture.request, markdown: "x".repeat(16 * 1024 + 1) }
    ];
    for (const request of invalidRequests) expect(() => fixture.service.replace(request)).toThrow();
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.initialMarkdown);
    expect(fs.existsSync(path.join(fixture.vaultPath, ".pige"))).toBe(false);
  });
});

function createFixture(options: { readonly jobId?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-current-note-replace-"));
  roots.push(root);
  const vaultPath = path.join(root, "vault");
  const pagePath = path.join(vaultPath, ...PAGE_PATH.split("/"));
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  const initialMarkdown = createMarkdown(options.jobId ?? JOB_ID);
  fs.writeFileSync(pagePath, initialMarkdown, { encoding: "utf8", mode: 0o600 });
  const evidence = readCurrentNoteEvidenceBinding(vaultPath, PAGE_ID);
  const job = createJob(evidence.bindingHash, options.jobId ?? JOB_ID);
  const request: CurrentNoteReplaceRequest = {
    vaultPath,
    activeVaultId: VAULT_ID,
    job,
    inspection: {
      pageId: PAGE_ID,
      contentHash: evidence.contentHash,
      bindingHash: evidence.bindingHash,
      evidenceRefs: ["citation_1"]
    },
    modelProfileId: "model_note_replace",
    markdown: "## Agent conclusion\n\nA concise durable conclusion."
  };
  return { root, vaultPath, pagePath, initialMarkdown, service: new CurrentNoteReplaceService(), request };
}

function createJob(bindingHash: string, jobId: string): JobRecord {
  return {
    schemaVersion: 1,
    id: jobId,
    class: "agent_turn",
    state: "running",
    stage: "planning",
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T10:00:00.000Z",
    activeVaultId: VAULT_ID,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    policyContextId: "policyctx_note_replace_fixture",
    policyHash: `sha256:${"a".repeat(64)}`,
    inputRefs: [{ kind: "page", id: PAGE_ID, checksum: bindingHash, role: "agent_turn_current_note_scope" }],
    message: "Appending an evidence-bound current-note block."
  };
}

function createMarkdown(seedJobId: string): string {
  return `---
id: "${PAGE_ID}"
schema_version: 1
title: "Current note replace fixture"
type: "note"
created_at: "2026-07-28T08:00:00.000Z"
updated_at: "2026-07-28T09:00:00.000Z"
status: "active"
language: "en"
aliases: []
tags: []
topics: []
entities: []
source_ids: []
related_page_ids: []
provenance:
  generated_by: "pige"
  last_job_id: "${seedJobId}"
  model_profile_id: "model_seed"
  confidence: "high"
note:
  note_kind: "summary"
  review_state: "clean"
---

# Current note replace fixture

Initial durable body.
`;
}

function requireCommitted(result: ReturnType<CurrentNoteReplaceService["replace"]>) {
  if (result.status !== "committed") throw new Error("Expected a committed replacement.");
  return result;
}

function requireReview(result: ReturnType<CurrentNoteReplaceService["replace"]>) {
  if (result.status !== "awaiting_review") throw new Error("Expected a replacement review proposal.");
  return result;
}

function requireApplied(result: ReturnType<CurrentNoteReplaceService["decideProposal"]>) {
  if (result.status !== "applied") throw new Error("Expected an applied replacement proposal.");
  return result;
}

function operationFile(vaultPath: string, operationId: string): string {
  const dateKey = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!dateKey) throw new Error("Invalid Operation ID.");
  return path.join(vaultPath, ".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`);
}

function listOperationFiles(vaultPath: string): readonly string[] {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".json")) result.push(target);
    }
  };
  visit(root);
  return result;
}

function listPrivateFiles(vaultPath: string): readonly string[] {
  const root = path.join(vaultPath, ".pige", "agent");
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  visit(root);
  return files;
}
