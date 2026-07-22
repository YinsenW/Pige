import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelProfileSummary, ProviderProfileSummary, VaultSummary } from "@pige/contracts";
import type { ConfirmationProposal, JobRecord, OperationRecord, SourceRecord } from "@pige/schemas";
import {
  AgentIngestService,
  createProposalApplyOperationId,
  type AgentIngestModelConfigPort,
  type AgentIngestProposalPort,
  type AgentIngestRuntimePort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { createGeneratedNoteExclusive } from "../../apps/desktop/src/main/services/generated-note-file";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import {
  PiAgentRuntimeAdapter,
  type PiAgentRunRequest,
  type PiAgentRunResult,
  type PiFauxResponse
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { ProposalService } from "../../apps/desktop/src/main/services/proposal-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { markSourceAsLegacyAgentIngestFixture, seedHistoricalAgentIngestJobFixture } from "../helpers/legacy-agent-ingest-fixture";

const roots: string[] = [];
const SOURCE_BODY_CANARY = "SOURCE_BODY_CANARY_PROPOSAL_REVIEW_42";
const NOTE_BODY_CANARY = "NOTE_BODY_CANARY_PROPOSAL_REVIEW_42";
const API_KEY_CANARY = "synthetic-proposal-review-api-key";

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_proposal_review_local",
    displayName: "Proposal Review Faux Provider",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43161/v1",
    authSecretRef: "provider_secret_proposal_review_local",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z"
  },
  model: {
    id: "model_proposal_review_local",
    providerProfileId: "provider_proposal_review_local",
    modelId: "proposal-review-local",
    displayName: "Proposal Review Local Model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z"
  },
  apiKey: API_KEY_CANARY
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("proposal review lifecycle", () => {
  it("approves one exact note, records one redacted proposal Operation, and terminalizes its parent", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Approved note");
    const create = requireCreateOperation(staged.proposal);
    const target = requirePageTarget(staged.proposal);

    const result = await staged.jobs.approveProposal(staged.proposals, {
      proposalId: staged.proposal.id,
      reason: "The grounded note is ready to keep."
    });

    expect(result.status).toBe("applied");
    expect(result.proposal?.state).toBe("applied");
    expect(fs.readFileSync(resolveVaultPath(fixture.vaultPath, create.path), "utf8")).toBe(create.content);

    const createPageOperations = readOperations(fixture.vaultPath)
      .filter((operation) => operation.kind === "create_page");
    expect(createPageOperations).toHaveLength(1);
    const operation = requireValue(createPageOperations[0]);
    expect(operation).toMatchObject({
      jobId: staged.parent.id,
      proposalId: staged.proposal.id,
      kind: "create_page",
      modelProfileId: runtimeConfig.model.id,
      targetRefs: [{ kind: "page", id: target.id, path: create.path }],
      sourceRefs: expect.arrayContaining([
        { kind: "proposal", id: staged.proposal.id },
        { kind: "job", id: staged.parent.id },
        { kind: "source", id: staged.source.id }
      ]),
      policyAudit: {
        policyContextId: staged.parent.policyContextId,
        policyHash: staged.parent.policyHash,
        enforcementOwners: ["Agent Orchestrator", "Change Proposal Service", "Vault Service"]
      },
      after: {
        kind: "page",
        id: `sha256:${createHash("sha256").update(create.content, "utf8").digest("hex")}`,
        path: create.path
      }
    });
    const serializedOperation = JSON.stringify(operation);
    expect(serializedOperation).not.toContain(create.content);
    expect(serializedOperation).not.toContain(NOTE_BODY_CANARY);
    expect(serializedOperation).not.toContain(SOURCE_BODY_CANARY);
    expect(serializedOperation).not.toContain(API_KEY_CANARY);
    expect(serializedOperation).not.toContain(fixture.vaultPath);

    expect(readJob(fixture.vaultPath, staged.parent.id)).toMatchObject({
      state: "completed",
      finishedAt: expect.any(String),
      proposalIds: [staged.proposal.id],
      operationIds: expect.arrayContaining([operation.id]),
      outputRefs: expect.arrayContaining([
        expect.objectContaining({ kind: "page", id: target.id, path: create.path }),
        expect.objectContaining({ kind: "operation", id: operation.id, role: "proposal_apply_audit" })
      ]),
      progress: { completedUnits: 1, totalUnits: 1, unit: "page" },
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          id: `proposal_apply:${staged.proposal.id}`,
          state: "done",
          finishedAt: expect.any(String)
        })
      ])
    });
    expect((fs.readFileSync(path.join(fixture.vaultPath, "log.md"), "utf8")
      .match(new RegExp(`operation:${operation.id}`, "gu")) ?? [])).toHaveLength(1);
    expect((await staged.jobs.approveProposal(staged.proposals, { proposalId: staged.proposal.id })).status)
      .toBe("applied");
    expect((fs.readFileSync(path.join(fixture.vaultPath, "log.md"), "utf8")
      .match(new RegExp(`operation:${operation.id}`, "gu")) ?? [])).toHaveLength(1);
  });

  it("rejects without creating a note or Operation and terminalizes its parent", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Rejected note");
    const create = requireCreateOperation(staged.proposal);
    const operationsBefore = operationSnapshot(fixture.vaultPath);

    const result = staged.jobs.rejectProposal(staged.proposals, {
      proposalId: staged.proposal.id,
      reason: "This note is not useful."
    });

    expect(result.status).toBe("rejected");
    expect(result.proposal).toMatchObject({
      state: "rejected",
      decision: { decidedBy: "user", reason: "This note is not useful." }
    });
    expect(fs.existsSync(resolveVaultPath(fixture.vaultPath, create.path))).toBe(false);
    expect(operationSnapshot(fixture.vaultPath)).toEqual(operationsBefore);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_page"))
      .toEqual([]);
    expect(readJob(fixture.vaultPath, staged.parent.id)).toMatchObject({
      state: "completed_with_warnings",
      finishedAt: expect.any(String),
      proposalIds: [staged.proposal.id],
      progress: { completedUnits: 1, totalUnits: 1, unit: "proposal" }
    });
  });

  it("marks a target collision conflicted and preserves the existing bytes", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Conflicted note");
    const create = requireCreateOperation(staged.proposal);
    const targetPath = resolveVaultPath(fixture.vaultPath, create.path);
    const collisionBytes = Buffer.from("# Existing user note\n\nThese bytes must survive unchanged.\n", "utf8");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, collisionBytes);
    const operationsBefore = operationSnapshot(fixture.vaultPath);

    const result = await staged.jobs.approveProposal(staged.proposals, {
      proposalId: staged.proposal.id,
      reason: "Apply only if the proposed target is still absent."
    });

    expect(result.status).toBe("conflicted");
    expect(result.proposal?.state).toBe("conflicted");
    expect(fs.readFileSync(targetPath)).toEqual(collisionBytes);
    expect(operationSnapshot(fixture.vaultPath)).toEqual(operationsBefore);
    expect(readJob(fixture.vaultPath, staged.parent.id)).toMatchObject({
      state: "failed_final",
      stage: "planning",
      message: expect.stringContaining("Existing bytes were preserved"),
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          id: `proposal_apply:${staged.proposal.id}`,
          step: "proposal_apply_conflicted",
          state: "failed"
        })
      ])
    });
  });

  it("recovers an approved proposal with a legacy hashless Operation without model, runtime, or credential calls", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Recovered note");
    const create = requireCreateOperation(staged.proposal);
    const approved = staged.proposals.approve({
      proposalId: staged.proposal.id,
      reason: "Approved before the simulated restart."
    });
    if (approved.status !== "approved" || !approved.proposal) {
      throw new Error("Test proposal did not enter the approved recovery state.");
    }

    await staged.agentIngest.applyStagedProposal(
      fixture.vaultPath,
      staged.source,
      readJob(fixture.vaultPath, staged.parent.id),
      approved.proposal
    );
    const notePath = resolveVaultPath(fixture.vaultPath, create.path);
    const committedNote = fs.readFileSync(notePath);
    const legacyOperationPath = requireValue(listFiles(
      path.join(fixture.vaultPath, ".pige", "operations"),
      ".json"
    ).find((filePath) => {
      const operation = JSON.parse(fs.readFileSync(filePath, "utf8")) as OperationRecord;
      return operation.kind === "create_page" && operation.proposalId === staged.proposal.id;
    }));
    const legacyOperation = JSON.parse(fs.readFileSync(legacyOperationPath, "utf8")) as OperationRecord;
    const { after: _resultHash, ...hashlessLegacyOperation } = legacyOperation;
    fs.writeFileSync(legacyOperationPath, `${JSON.stringify(hashlessLegacyOperation, null, 2)}\n`, "utf8");
    const committedOperations = operationSnapshot(fixture.vaultPath);
    expect(staged.proposals.get({ proposalId: staged.proposal.id }).proposal.state).toBe("approved");
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("awaiting_review");

    const calls = { model: 0, runtime: 0, credential: 0 };
    const restartedProposals = new ProposalService(fixture.vaultPort);
    const restartedJobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(
        forbiddenModelPort(calls),
        forbiddenRuntime(calls),
        undefined,
        undefined,
        undefined,
        undefined,
        bindProposalPort(restartedProposals, fixture.vaultPath)
      )
    );

    expect(await restartedJobs.recoverProposalDecisions(restartedProposals)).toEqual({
      applied: 1,
      rejected: 0,
      conflicted: 0,
      failed: 0
    });
    expect(calls).toEqual({ model: 0, runtime: 0, credential: 0 });
    expect(fs.readFileSync(notePath)).toEqual(committedNote);
    expect(operationSnapshot(fixture.vaultPath)).toEqual(committedOperations);
    expect(readOperations(fixture.vaultPath).filter((operation) =>
      operation.kind === "create_page" && operation.proposalId === staged.proposal.id
    )).toHaveLength(1);
    expect(readOperations(fixture.vaultPath).find((operation) =>
      operation.kind === "create_page" && operation.proposalId === staged.proposal.id
    )?.after).toBeUndefined();
    expect(restartedProposals.get({ proposalId: staged.proposal.id }).proposal.state).toBe("applied");
    expect(readJob(fixture.vaultPath, staged.parent.id)).toMatchObject({
      state: "completed",
      finishedAt: expect.any(String)
    });
  });

  it("recovers an approved decision before any page effect without model or credential access", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Decision-only recovery");
    const create = requireCreateOperation(staged.proposal);
    expect(staged.proposals.approve({ proposalId: staged.proposal.id }).status).toBe("approved");
    expect(fs.existsSync(resolveVaultPath(fixture.vaultPath, create.path))).toBe(false);

    const calls = { model: 0, runtime: 0, credential: 0 };
    const restartedProposals = new ProposalService(fixture.vaultPort);
    const restartedJobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(
        forbiddenModelPort(calls),
        forbiddenRuntime(calls),
        undefined,
        undefined,
        undefined,
        undefined,
        bindProposalPort(restartedProposals, fixture.vaultPath)
      )
    );

    expect(await restartedJobs.recoverProposalDecisions(restartedProposals)).toEqual({
      applied: 1,
      rejected: 0,
      conflicted: 0,
      failed: 0
    });
    expect(calls).toEqual({ model: 0, runtime: 0, credential: 0 });
    expect(fs.readFileSync(resolveVaultPath(fixture.vaultPath, create.path), "utf8")).toBe(create.content);
    expect(restartedProposals.get({ proposalId: staged.proposal.id }).proposal.state).toBe("applied");
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("completed");
  });

  it("finishes a page-first crash after source drift without another model or credential read", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Page-first recovery");
    const create = requireCreateOperation(staged.proposal);
    const approved = staged.proposals.approve({ proposalId: staged.proposal.id });
    if (approved.status !== "approved" || !approved.proposal) throw new Error("Proposal approval failed.");
    const notePath = resolveVaultPath(fixture.vaultPath, create.path);
    expect(createGeneratedNoteExclusive(fixture.vaultPath, notePath, create.content)).toBe("created");
    const sourcePath = requireValue(listFiles(
      path.join(fixture.vaultPath, ".pige", "source-records"),
      `${staged.source.id}.json`
    )[0]);
    fs.writeFileSync(sourcePath, `${JSON.stringify({
      ...staged.source,
      metadata: { ...staged.source.metadata, private: true },
      updatedAt: "2026-07-12T00:07:00.000Z"
    }, null, 2)}\n`, "utf8");

    const calls = { model: 0, runtime: 0, credential: 0 };
    const restartedProposals = new ProposalService(fixture.vaultPort);
    const restartedJobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(
        forbiddenModelPort(calls),
        forbiddenRuntime(calls),
        undefined,
        undefined,
        undefined,
        undefined,
        bindProposalPort(restartedProposals, fixture.vaultPath)
      )
    );

    expect(await restartedJobs.recoverProposalDecisions(restartedProposals)).toEqual({
      applied: 1,
      rejected: 0,
      conflicted: 0,
      failed: 0
    });
    expect(calls).toEqual({ model: 0, runtime: 0, credential: 0 });
    expect(fs.readFileSync(notePath, "utf8")).toBe(create.content);
    expect(readOperations(fixture.vaultPath).filter((operation) =>
      operation.proposalId === staged.proposal.id && operation.kind === "create_page"
    )).toHaveLength(1);
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("completed");
  });

  it("finalizes an already-applied proposal after a parent-link crash", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Applied-state recovery");
    const approved = staged.proposals.approve({ proposalId: staged.proposal.id });
    if (approved.status !== "approved" || !approved.proposal) throw new Error("Proposal approval failed.");
    await staged.agentIngest.applyStagedProposal(
      fixture.vaultPath,
      staged.source,
      readJob(fixture.vaultPath, staged.parent.id),
      approved.proposal
    );
    expect(staged.proposals.markApplied(staged.proposal.id).status).toBe("applied");
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("awaiting_review");

    const calls = { model: 0, runtime: 0, credential: 0 };
    const restartedProposals = new ProposalService(fixture.vaultPort);
    const restartedJobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(
        forbiddenModelPort(calls),
        forbiddenRuntime(calls),
        undefined,
        undefined,
        undefined,
        undefined,
        bindProposalPort(restartedProposals, fixture.vaultPath)
      )
    );

    expect(await restartedJobs.recoverProposalDecisions(restartedProposals)).toEqual({
      applied: 1,
      rejected: 0,
      conflicted: 0,
      failed: 0
    });
    expect(calls).toEqual({ model: 0, runtime: 0, credential: 0 });
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("completed");
  });

  it("does not finalize an applied proposal whose durable page was deleted", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Missing applied page");
    const create = requireCreateOperation(staged.proposal);
    const approved = staged.proposals.approve({ proposalId: staged.proposal.id });
    if (approved.status !== "approved" || !approved.proposal) throw new Error("Proposal approval failed.");
    await staged.agentIngest.applyStagedProposal(
      fixture.vaultPath,
      staged.source,
      readJob(fixture.vaultPath, staged.parent.id),
      approved.proposal
    );
    expect(staged.proposals.markApplied(staged.proposal.id).status).toBe("applied");
    fs.rmSync(resolveVaultPath(fixture.vaultPath, create.path));

    const restartedProposals = new ProposalService(fixture.vaultPort);
    const restartedJobs = new JobsService(fixture.vaultPort, staged.agentIngest);
    expect(await restartedJobs.recoverProposalDecisions(restartedProposals)).toEqual({
      applied: 0,
      rejected: 0,
      conflicted: 0,
      failed: 1
    });
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("awaiting_review");
  });

  it("recovers a durable rejection without applying any effect", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Rejected-state recovery");
    expect(staged.proposals.reject({ proposalId: staged.proposal.id }).status).toBe("rejected");

    const restartedProposals = new ProposalService(fixture.vaultPort);
    const restartedJobs = new JobsService(fixture.vaultPort);
    expect(await restartedJobs.recoverProposalDecisions(restartedProposals)).toEqual({
      applied: 0,
      rejected: 1,
      conflicted: 0,
      failed: 0
    });
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("completed_with_warnings");
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_page")).toEqual([]);
  });

  it("marks source-revision drift conflicted before any approved write", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Source drift");
    const sourcePath = requireValue(listFiles(
      path.join(fixture.vaultPath, ".pige", "source-records"),
      `${staged.source.id}.json`
    )[0]);
    const changedSource = {
      ...staged.source,
      metadata: { ...staged.source.metadata, private: true },
      updatedAt: "2026-07-12T00:05:00.000Z"
    };
    fs.writeFileSync(sourcePath, `${JSON.stringify(changedSource, null, 2)}\n`, "utf8");
    const create = requireCreateOperation(staged.proposal);

    const result = await staged.jobs.approveProposal(staged.proposals, { proposalId: staged.proposal.id });

    expect(result.status).toBe("conflicted");
    expect(result.proposal?.state).toBe("conflicted");
    expect(fs.existsSync(resolveVaultPath(fixture.vaultPath, create.path))).toBe(false);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_page")).toEqual([]);
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("failed_final");
  });

  it("reconciles a conflicted proposal after a target and source crash window", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Conflicted restart");
    const create = requireCreateOperation(staged.proposal);
    const targetPath = resolveVaultPath(fixture.vaultPath, create.path);
    const collisionBytes = Buffer.from("# Existing target survives recovery\n", "utf8");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, collisionBytes);
    const sourcePath = requireValue(listFiles(
      path.join(fixture.vaultPath, ".pige", "source-records"),
      `${staged.source.id}.json`
    )[0]);
    const changedSourceBytes = Buffer.from(`${JSON.stringify({
      ...staged.source,
      metadata: { ...staged.source.metadata, sensitive: true },
      updatedAt: "2026-07-12T00:08:00.000Z"
    }, null, 2)}\n`, "utf8");
    fs.writeFileSync(sourcePath, changedSourceBytes);
    expect(staged.proposals.approve({ proposalId: staged.proposal.id }).status).toBe("approved");
    expect(staged.proposals.markConflicted(staged.proposal.id).status).toBe("conflicted");
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("awaiting_review");
    const operationsBefore = operationSnapshot(fixture.vaultPath);

    const calls = { model: 0, runtime: 0, credential: 0 };
    const restartedProposals = new ProposalService(fixture.vaultPort);
    const restartedJobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(forbiddenModelPort(calls), forbiddenRuntime(calls))
    );
    expect(await restartedJobs.recoverProposalDecisions(restartedProposals)).toEqual({
      applied: 0,
      rejected: 0,
      conflicted: 1,
      failed: 0
    });
    expect(calls).toEqual({ model: 0, runtime: 0, credential: 0 });
    expect(fs.readFileSync(targetPath)).toEqual(collisionBytes);
    expect(fs.readFileSync(sourcePath)).toEqual(changedSourceBytes);
    expect(operationSnapshot(fixture.vaultPath)).toEqual(operationsBefore);
    expect(readJob(fixture.vaultPath, staged.parent.id)).toMatchObject({
      state: "failed_final",
      checkpoints: expect.arrayContaining([
        expect.objectContaining({
          id: `proposal_apply:${staged.proposal.id}`,
          step: "proposal_apply_conflicted",
          state: "failed"
        })
      ])
    });
  });

  it("reconciles a page-first conflicted proposal without changing page or Operation bytes", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Page-first conflict restart");
    const create = requireCreateOperation(staged.proposal);
    const targetPath = resolveVaultPath(fixture.vaultPath, create.path);
    expect(staged.proposals.approve({ proposalId: staged.proposal.id }).status).toBe("approved");
    expect(createGeneratedNoteExclusive(fixture.vaultPath, targetPath, create.content)).toBe("created");
    const operationId = createProposalApplyOperationId(staged.proposal.id);
    const dateKey = requireValue(/^op_(\d{8})_/.exec(operationId)?.[1]);
    const operationPath = path.join(
      fixture.vaultPath,
      ".pige",
      "operations",
      dateKey.slice(0, 4),
      dateKey.slice(4, 6),
      `${operationId}.json`
    );
    const conflictingOperationBytes = Buffer.from('{"conflict":"preserve exact bytes"}\n', "utf8");
    fs.mkdirSync(path.dirname(operationPath), { recursive: true });
    fs.writeFileSync(operationPath, conflictingOperationBytes);
    expect(staged.proposals.markConflicted(staged.proposal.id).status).toBe("conflicted");
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("awaiting_review");
    const pageBytes = fs.readFileSync(targetPath);

    const calls = { model: 0, runtime: 0, credential: 0 };
    const restartedProposals = new ProposalService(fixture.vaultPort);
    const restartedJobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(forbiddenModelPort(calls), forbiddenRuntime(calls))
    );
    expect(await restartedJobs.recoverProposalDecisions(restartedProposals)).toEqual({
      applied: 0,
      rejected: 0,
      conflicted: 1,
      failed: 0
    });
    expect(calls).toEqual({ model: 0, runtime: 0, credential: 0 });
    expect(fs.readFileSync(targetPath)).toEqual(pageBytes);
    expect(fs.readFileSync(operationPath)).toEqual(conflictingOperationBytes);
    expect(readJob(fixture.vaultPath, staged.parent.id).state).toBe("failed_final");
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked Source Record before proposal apply", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Symlinked source record");
    const sourcePath = requireValue(listFiles(
      path.join(fixture.vaultPath, ".pige", "source-records"),
      `${staged.source.id}.json`
    )[0]);
    const outsidePath = path.join(path.dirname(fixture.vaultPath), "external-source-record.json");
    fs.copyFileSync(sourcePath, outsidePath);
    fs.rmSync(sourcePath);
    fs.symlinkSync(outsidePath, sourcePath, "file");

    await expect(staged.jobs.approveProposal(staged.proposals, { proposalId: staged.proposal.id }))
      .rejects.toMatchObject({ code: "source.record_unsafe" });

    expect(staged.proposals.get({ proposalId: staged.proposal.id }).proposal.state).toBe("approved");
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_page")).toEqual([]);
    expect(fs.readFileSync(outsidePath, "utf8")).toContain(staged.source.id);
  });

  it.skipIf(process.platform === "win32")("marks a symlinked proposal target conflicted without touching its destination", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Symlinked target");
    const create = requireCreateOperation(staged.proposal);
    const targetPath = resolveVaultPath(fixture.vaultPath, create.path);
    const outsidePath = path.join(path.dirname(fixture.vaultPath), "external-note.md");
    fs.writeFileSync(outsidePath, "# External bytes remain private\n", "utf8");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.symlinkSync(outsidePath, targetPath, "file");

    const result = await staged.jobs.approveProposal(staged.proposals, { proposalId: staged.proposal.id });

    expect(result.status).toBe("conflicted");
    expect(fs.readFileSync(outsidePath, "utf8")).toBe("# External bytes remain private\n");
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_page")).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked Operation root before creating the approved page", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Symlinked operation root");
    const create = requireCreateOperation(staged.proposal);
    const operationRoot = path.join(fixture.vaultPath, ".pige", "operations");
    const preservedOperations = path.join(path.dirname(fixture.vaultPath), "preserved-operations");
    const outsideRoot = path.join(path.dirname(fixture.vaultPath), "external-operations");
    fs.renameSync(operationRoot, preservedOperations);
    fs.mkdirSync(outsideRoot);
    fs.symlinkSync(outsideRoot, operationRoot, "dir");

    await expect(staged.jobs.approveProposal(staged.proposals, { proposalId: staged.proposal.id }))
      .rejects.toMatchObject({ code: "proposal.operation_unavailable" });

    expect(staged.proposals.get({ proposalId: staged.proposal.id }).proposal.state).toBe("approved");
    expect(fs.existsSync(resolveVaultPath(fixture.vaultPath, create.path))).toBe(false);
    expect(fs.readdirSync(outsideRoot)).toEqual([]);
    expect(listFiles(preservedOperations, ".json")).toEqual([]);
  });

  it("marks an occupied deterministic Operation identity conflicted before page commit", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Occupied operation identity");
    const create = requireCreateOperation(staged.proposal);
    const operationId = createProposalApplyOperationId(staged.proposal.id);
    const dateKey = requireValue(/^op_(\d{8})_/.exec(operationId)?.[1]);
    const operationPath = path.join(
      fixture.vaultPath,
      ".pige",
      "operations",
      dateKey.slice(0, 4),
      dateKey.slice(4, 6),
      `${operationId}.json`
    );
    fs.mkdirSync(path.dirname(operationPath), { recursive: true });
    fs.writeFileSync(operationPath, '{"invalid":"occupied identity"}\n', "utf8");

    const result = await staged.jobs.approveProposal(staged.proposals, { proposalId: staged.proposal.id });

    expect(result.status).toBe("conflicted");
    expect(result.proposal?.state).toBe("conflicted");
    expect(fs.existsSync(resolveVaultPath(fixture.vaultPath, create.path))).toBe(false);
    expect(fs.readFileSync(operationPath, "utf8")).toBe('{"invalid":"occupied identity"}\n');
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked audit log before proposal effects", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Symlinked audit log");
    const create = requireCreateOperation(staged.proposal);
    const logPath = path.join(fixture.vaultPath, "log.md");
    const outsideLog = path.join(path.dirname(fixture.vaultPath), "external-log.md");
    fs.writeFileSync(outsideLog, "external log bytes\n", "utf8");
    fs.rmSync(logPath);
    fs.symlinkSync(outsideLog, logPath, "file");

    await expect(staged.jobs.approveProposal(staged.proposals, { proposalId: staged.proposal.id }))
      .rejects.toMatchObject({ code: "proposal.log_unsafe" });

    expect(staged.proposals.get({ proposalId: staged.proposal.id }).proposal.state).toBe("approved");
    expect(fs.existsSync(resolveVaultPath(fixture.vaultPath, create.path))).toBe(false);
    expect(fs.readFileSync(outsideLog, "utf8")).toBe("external log bytes\n");
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_page")).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked index before proposal page effects", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Symlinked index");
    const create = requireCreateOperation(staged.proposal);
    const indexPath = path.join(fixture.vaultPath, "index.md");
    const outsideIndex = path.join(path.dirname(fixture.vaultPath), "external-index.md");
    fs.writeFileSync(outsideIndex, "# External index\n", "utf8");
    fs.rmSync(indexPath);
    fs.symlinkSync(outsideIndex, indexPath, "file");

    const result = await staged.jobs.approveProposal(staged.proposals, { proposalId: staged.proposal.id });

    expect(result.status).toBe("conflicted");
    expect(fs.existsSync(resolveVaultPath(fixture.vaultPath, create.path))).toBe(false);
    expect(fs.readFileSync(outsideIndex, "utf8")).toBe("# External index\n");
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_page")).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked parent Job before proposal effects", async () => {
    const fixture = makeVault();
    const staged = await stageReviewProposal(fixture, "Symlinked parent Job");
    const create = requireCreateOperation(staged.proposal);
    const jobPath = requireValue(listFiles(
      path.join(fixture.vaultPath, ".pige", "jobs"),
      `${staged.parent.id}.json`
    )[0]);
    const outsideJob = path.join(path.dirname(fixture.vaultPath), "external-parent-job.json");
    fs.copyFileSync(jobPath, outsideJob);
    fs.rmSync(jobPath);
    fs.symlinkSync(outsideJob, jobPath, "file");

    await expect(staged.jobs.approveProposal(staged.proposals, { proposalId: staged.proposal.id }))
      .rejects.toMatchObject({ code: "proposal.parent_job_changed" });

    expect(staged.proposals.get({ proposalId: staged.proposal.id }).proposal.state).toBe("approved");
    expect(fs.existsSync(resolveVaultPath(fixture.vaultPath, create.path))).toBe(false);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_page")).toEqual([]);
  });

  it("does not approve generic update, rename, or delete proposals through the create-note path", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    const jobs = new JobsService(fixture.vaultPort);
    const cases = [
      {
        kind: "update" as const,
        path: "wiki/existing.md",
        beforeSha256: `sha256:${"a".repeat(64)}`,
        content: "# Changed\n"
      },
      { kind: "rename" as const, from: "wiki/old.md", to: "wiki/new.md" },
      { kind: "delete" as const, path: "wiki/old.md", beforeSha256: `sha256:${"b".repeat(64)}` }
    ];

    for (const operation of cases) {
      const proposal = proposals.stage({
        trustLevel: "explicit_confirmation",
        summary: `Unsupported ${operation.kind}`,
        reason: "This generic operation is outside the bounded create-note apply path.",
        proposedOperations: [operation]
      }).proposal;
      const result = await jobs.approveProposal(proposals, { proposalId: proposal.id });
      expect(result.status).toBe("not_allowed");
      expect(proposals.get({ proposalId: proposal.id }).proposal.state).toBe("ready");
      const rejected = jobs.rejectProposal(proposals, { proposalId: proposal.id });
      expect(rejected.status).toBe("rejected");
      expect(proposals.get({ proposalId: proposal.id }).proposal.state).toBe("rejected");
    }
  });
});

class RecordingPiRuntime implements AgentIngestRuntimePort {
  calls = 0;

  constructor(private readonly fauxResponses: readonly PiFauxResponse[]) {}

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    this.calls += 1;
    return new PiAgentRuntimeAdapter({ fauxResponses: this.fauxResponses }).run(request);
  }
}

async function stageReviewProposal(
  fixture: ReturnType<typeof makeVault>,
  title: string
): Promise<{
  readonly proposals: ProposalService;
  readonly jobs: JobsService;
  readonly agentIngest: AgentIngestService;
  readonly parent: JobRecord;
  readonly source: SourceRecord;
  readonly proposal: ConfirmationProposal;
}> {
  const proposals = new ProposalService(fixture.vaultPort);
  const runtime = new RecordingPiRuntime([
    toolCall("pige_inspect_source", `inspect_${title.replaceAll(" ", "_").toLowerCase()}`, {}),
    toolCall(
      "pige_stage_knowledge_note_proposal",
      `stage_${title.replaceAll(" ", "_").toLowerCase()}`,
      groundedOutput(title)
    )
  ]);
  const agentIngest = new AgentIngestService(
    modelPort(),
    runtime,
    undefined,
    undefined,
    undefined,
    undefined,
    bindProposalPort(proposals, fixture.vaultPath)
  );
  const jobs = new JobsService(fixture.vaultPort, agentIngest);
  const capture = new LegacyCaptureFixture(fixture.vaultPort, fixture.vaultPath).submitText({
    text: `${SOURCE_BODY_CANARY}: preserved evidence for ${title}.`,
    inputKind: "typed_text",
    userIntent: "capture",
    locale: "en"
  });
  markSourceAsLegacyAgentIngestFixture(fixture.vaultPath, capture.sourceId);
  seedHistoricalAgentIngestJobFixture(fixture.vaultPath, capture.sourceId);
  const captureResult = jobs.processQueuedCaptures({ jobIds: [capture.jobId] });
  if (captureResult.completed !== 1) throw new Error("Test capture did not create its Agent parent.");
  const parent = requireValue(readJobs(fixture.vaultPath).find((job) =>
    job.class === "agent_ingest" && job.sourceId === capture.sourceId
  ));
  const ingestResult = await jobs.processQueuedAgentIngest({ jobIds: [parent.id] });
  if (ingestResult.completed !== 1 || runtime.calls !== 1) {
    throw new Error("Test Agent did not stage exactly one proposal.");
  }
  const durableParent = readJob(fixture.vaultPath, parent.id);
  const proposal = requireValue(proposals.findForJob(parent.id));
  if (durableParent.state !== "awaiting_review" || proposal.state !== "ready") {
    throw new Error("Test proposal is not ready for review.");
  }
  return {
    proposals,
    jobs,
    agentIngest,
    parent: durableParent,
    source: readSource(fixture.vaultPath, capture.sourceId),
    proposal
  };
}

function groundedOutput(title: string) {
  return {
    title: `${title} ${NOTE_BODY_CANARY}`,
    summary: {
      text: "The preserved source is the factual evidence for this reviewable knowledge note.",
      evidenceRefs: ["ev_01"]
    },
    keyPoints: [{
      text: "Approval must apply the exact staged Markdown through the confined writer.",
      evidenceRefs: ["ev_01"]
    }],
    tags: ["proposal-review"],
    topics: ["Agent-led knowledge"],
    entities: [],
    relatedPageRefs: [],
    warnings: [],
    confidence: "high"
  };
}

function toolCall(
  toolName: string,
  toolCallId: string,
  args: Readonly<Record<string, unknown>>
): PiFauxResponse {
  return { kind: "tool_call", toolName, toolCallId, args };
}

function modelPort(): AgentIngestModelConfigPort {
  const model: ModelProfileSummary = { ...runtimeConfig.model, isDefault: true };
  const provider: ProviderProfileSummary = runtimeConfig.provider;
  return {
    getDefaultModel: () => model,
    getDefaultProvider: () => provider,
    hasDefaultRuntimeBinding: () => true,
    getDefaultRuntimeConfig: () => runtimeConfig
  };
}

function forbiddenModelPort(calls: { model: number; credential: number }): AgentIngestModelConfigPort {
  return {
    getDefaultModel: () => {
      calls.model += 1;
      throw new Error("Recovery must not read the default model.");
    },
    getDefaultProvider: () => {
      calls.model += 1;
      throw new Error("Recovery must not read the default provider.");
    },
    hasDefaultRuntimeBinding: () => {
      calls.model += 1;
      throw new Error("Recovery must not inspect the model binding.");
    },
    getDefaultRuntimeConfig: () => {
      calls.credential += 1;
      throw new Error("Recovery must not read provider credentials.");
    }
  };
}

function forbiddenRuntime(calls: { runtime: number }): AgentIngestRuntimePort {
  return {
    run: async () => {
      calls.runtime += 1;
      throw new Error("Recovery must not invoke the Agent runtime.");
    }
  };
}

function bindProposalPort(
  proposals: ProposalService,
  expectedVaultPath: string
): AgentIngestProposalPort {
  return {
    findForJob: (vaultPath, jobId) => {
      if (vaultPath !== expectedVaultPath) throw new Error("Proposal access escaped the active test vault.");
      return proposals.findForJob(jobId);
    },
    stage: (vaultPath, request) => {
      if (vaultPath !== expectedVaultPath) throw new Error("Proposal staging escaped the active test vault.");
      return proposals.stage(request);
    }
  };
}

function makeVault(): {
  readonly vaultPath: string;
  readonly vault: VaultSummary;
  readonly vaultPort: { current(): VaultSummary; activeVaultPath(): string };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-proposal-review-lifecycle-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "ProposalReviewLifecycle",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-12T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "ProposalReviewLifecycle");
  const vault = loadVaultSummary(vaultPath);
  return {
    vaultPath,
    vault,
    vaultPort: { current: () => vault, activeVaultPath: () => vaultPath }
  };
}

function requireCreateOperation(proposal: ConfirmationProposal) {
  const operation = proposal.proposedOperations[0];
  if (!operation || operation.kind !== "create") {
    throw new Error("Expected one create operation in the test proposal.");
  }
  return operation;
}

function requirePageTarget(proposal: ConfirmationProposal) {
  const target = proposal.targetRefs[0];
  if (!target || target.kind !== "page" || !target.path) {
    throw new Error("Expected one page target in the test proposal.");
  }
  return target;
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  return path.join(vaultPath, ...relativePath.split("/"));
}

function readSource(vaultPath: string, sourceId: string): SourceRecord {
  return readJsonBySuffix<SourceRecord>(
    path.join(vaultPath, ".pige", "source-records"),
    `${sourceId}.json`
  );
}

function readJob(vaultPath: string, jobId: string): JobRecord {
  return readJsonBySuffix<JobRecord>(path.join(vaultPath, ".pige", "jobs"), `${jobId}.json`);
}

function readJobs(vaultPath: string): JobRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "jobs"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as JobRecord);
}

function readOperations(vaultPath: string): OperationRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "operations"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as OperationRecord);
}

function operationSnapshot(vaultPath: string): readonly { readonly path: string; readonly bytes: string }[] {
  const root = path.join(vaultPath, ".pige", "operations");
  return listFiles(root, ".json").map((filePath) => ({
    path: path.relative(root, filePath),
    bytes: fs.readFileSync(filePath, "utf8")
  }));
}

function readJsonBySuffix<T>(root: string, suffix: string): T {
  const filePath = requireValue(listFiles(root, suffix)[0]);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function listFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(filePath, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [filePath] : [];
  }).sort();
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test value to exist.");
  return value;
}
