import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelProfileSummary, ProviderProfileSummary, VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  JobRecordSchema,
  type ConfirmationProposal,
  type JobRecord,
  type OperationRecord,
  type SourceRecord
} from "@pige/schemas";
import {
  AgentIngestService,
  type AgentIngestModelConfigPort,
  type AgentIngestProposalPort,
  type AgentIngestRuntimePort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { EvidenceAssemblyService } from "../../apps/desktop/src/main/services/evidence-assembly-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import {
  createPigeAgentToolCatalogHash,
  PiAgentRuntimeAdapter,
  type PigeAgentToolResult,
  type PiAgentRunRequest,
  type PiAgentRunResult,
  type PiFauxResponse
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { RESPOND_TO_USER_TOOL_NAME } from "../../apps/desktop/src/main/services/agent-ingest-tool-registry";
import { ProposalService } from "../../apps/desktop/src/main/services/proposal-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_ingest_proposal_local",
    displayName: "Ingest Proposal Faux Provider",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43151/v1",
    authSecretRef: "provider_secret_ingest_proposal_local",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z"
  },
  model: {
    id: "model_ingest_proposal_local",
    providerProfileId: "provider_ingest_proposal_local",
    modelId: "ingest-proposal-local",
    displayName: "Ingest Proposal Local Model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z"
  },
  apiKey: "synthetic-ingest-proposal-local-key"
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent-selected ingest proposal tool", () => {
  it("runs real Pi inspect -> proposal and durably links one body-free awaiting-review parent", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    const runtime = new RecordingPiRuntime([
      toolCall("pige_inspect_source", "inspect_proposal", {}),
      toolCall(
        "pige_stage_knowledge_note_proposal",
        "opaque_proposal_call",
        groundedOutput("Reviewable Agent knowledge")
      )
    ]);
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(
        modelPort(),
        runtime,
        undefined,
        undefined,
        undefined,
        undefined,
        bindProposalPort(proposals, fixture.vaultPath)
      )
    );
    const capture = submitText(fixture, "A grounded proposal must remain unapplied until explicit review.");
    jobs.processQueuedCaptures({ jobIds: [capture.jobId] });
    const parent = requireValue(readJobs(fixture.vaultPath).find((job) =>
      job.class === "agent_ingest" && job.sourceId === capture.sourceId
    ));

    expect(await jobs.processQueuedAgentIngest({ jobIds: [parent.id] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });

    const linked = readJob(fixture.vaultPath, parent.id);
    const proposalSummary = requireValue(proposals.list().proposals[0]);
    const proposal = proposals.get({ proposalId: proposalSummary.id }).proposal;
    const durable = JSON.stringify({ linked, proposal });
    expect(runtime.calls).toBe(1);
    expect(linked).toMatchObject({
      state: "awaiting_review",
      proposalIds: [proposal.id],
      outputRefs: expect.arrayContaining([
        expect.objectContaining({ kind: "proposal", id: proposal.id, role: "awaiting_review" }),
        expect.objectContaining({ kind: "page", role: "proposed_target" })
      ])
    });
    expect(linked.inputRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source", role: "agent_tool_source_revision" }),
      expect.objectContaining({
        kind: "tool",
        id: "pige_stage_knowledge_note_proposal@1",
        role: "agent_tool_canonical_input"
      }),
      expect.objectContaining({ kind: "tool", role: "agent_tool_catalog" }),
      expect.objectContaining({ kind: "tool", role: "agent_tool_call_provenance" })
    ]));
    const provenanceRefs = linked.inputRefs?.filter((ref) => ref.role === "agent_tool_call_provenance") ?? [];
    const expectedProvenanceHash = `sha256:${createHash("sha256")
      .update(`pige:pi-tool-call-provenance:v1\0${parent.id}\0opaque_proposal_call`, "utf8")
      .digest("hex")}`;
    expect(provenanceRefs).toEqual([expect.objectContaining({
      id: "pige_stage_knowledge_note_proposal",
      checksum: expectedProvenanceHash
    })]);
    expect(proposal).toMatchObject({
      jobId: parent.id,
      state: "ready",
      trustLevel: "review_required",
      proposedOperations: [{ kind: "create" }]
    });
    expect(proposal.proposedOperations[0]).toMatchObject({
      path: expect.stringMatching(/^wiki\/generated\//u),
      content: expect.stringContaining("# Reviewable Agent knowledge")
    });
    expect(generatedNotes(fixture.vaultPath)).toEqual([]);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_page")).toEqual([]);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "model_egress_decision")).toHaveLength(1);
    expect(durable).not.toContain("opaque_proposal_call");
    expect(durable).not.toContain(runtimeConfig.apiKey);
    expect(durable).not.toContain(fixture.vaultPath);
  });

  it("applies an approved Pi proposal without another model turn and resolves the parent Job", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    const runtime = new RecordingPiRuntime([
      toolCall("pige_inspect_source", "inspect_apply", {}),
      toolCall(
        "pige_stage_knowledge_note_proposal",
        "opaque_apply_call",
        groundedOutput("Applied Agent knowledge")
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
    const capture = submitText(fixture, "An approved proposal should become one durable note without another model call.");
    jobs.processQueuedCaptures({ jobIds: [capture.jobId] });
    const parent = requireValue(readJobs(fixture.vaultPath).find((job) =>
      job.class === "agent_ingest" && job.sourceId === capture.sourceId
    ));
    await jobs.processQueuedAgentIngest({ jobIds: [parent.id] });
    const proposalId = requireValue(proposals.list({ states: ["ready"] }).proposals[0]).id;
    const proposal = proposals.get({ proposalId }).proposal;

    const result = await jobs.approveProposal(proposals, { proposalId: proposal.id });

    const notePath = requireValue(generatedNotes(fixture.vaultPath)[0]);
    const operations = readOperations(fixture.vaultPath);
    const createOperations = operations.filter((operation) => operation.kind === "create_page");
    const resolvedParent = readJob(fixture.vaultPath, parent.id);
    expect(result.status).toBe("applied");
    expect(result.proposal?.state).toBe("applied");
    expect(runtime.calls).toBe(1);
    expect(fs.readFileSync(notePath, "utf8")).toContain("# Applied Agent knowledge");
    expect(createOperations).toHaveLength(1);
    expect(createOperations[0]).toMatchObject({
      jobId: parent.id,
      proposalId: proposal.id,
      modelProfileId: runtimeConfig.model.id,
      targetRefs: [expect.objectContaining({ kind: "page", path: path.relative(fixture.vaultPath, notePath) })]
    });
    expect(resolvedParent.state).toMatch(/^completed/u);
    expect(resolvedParent.operationIds).toContain(createOperations[0]?.id);
    const durable = JSON.stringify({ result, resolvedParent, createOperations });
    expect(durable).not.toContain("opaque_apply_call");
    expect(durable).not.toContain(runtimeConfig.apiKey);
    expect(durable).not.toContain(fixture.vaultPath);
  });

  it("rejects a staged Pi proposal without applying durable knowledge", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    const runtime = new RecordingPiRuntime([
      toolCall("pige_inspect_source", "inspect_reject", {}),
      toolCall(
        "pige_stage_knowledge_note_proposal",
        "opaque_reject_call",
        groundedOutput("Rejected Agent knowledge")
      )
    ]);
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(
        modelPort(),
        runtime,
        undefined,
        undefined,
        undefined,
        undefined,
        bindProposalPort(proposals, fixture.vaultPath)
      )
    );
    const capture = submitText(fixture, "A rejected proposal must leave source evidence intact and create no note.");
    jobs.processQueuedCaptures({ jobIds: [capture.jobId] });
    const parent = requireValue(readJobs(fixture.vaultPath).find((job) =>
      job.class === "agent_ingest" && job.sourceId === capture.sourceId
    ));
    await jobs.processQueuedAgentIngest({ jobIds: [parent.id] });
    const proposalId = requireValue(proposals.list({ states: ["ready"] }).proposals[0]).id;

    const rejected = jobs.rejectProposal(proposals, { proposalId, reason: "Not useful." });
    const repeated = jobs.rejectProposal(proposals, { proposalId });

    expect(rejected.status).toBe("rejected");
    expect(repeated.status).toBe("rejected");
    expect(proposals.get({ proposalId }).proposal.state).toBe("rejected");
    expect(readJob(fixture.vaultPath, parent.id)).toMatchObject({
      state: "completed_with_warnings",
      message: expect.stringContaining("rejected")
    });
    expect(generatedNotes(fixture.vaultPath)).toEqual([]);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_page")).toEqual([]);
    expect(runtime.calls).toBe(1);
  });

  it("rejects any later model turn after the proposal terminal commits", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    let blockedCode = "";
    const runtime = new FunctionalRuntime(async (request) => {
      await invokeTool(request, "pige_inspect_source", {}, "inspect_terminal_model_guard");
      await invokeTool(
        request,
        "pige_stage_knowledge_note_proposal",
        groundedOutput("Terminal proposal stops later model turns"),
        "terminal_model_guard"
      );
      try {
        await request.beforeModelTurn?.();
      } catch (caught) {
        blockedCode = (caught as { readonly code?: string }).code ?? "";
      }
      return runtimeResult(request, ["pige_inspect_source", "pige_stage_knowledge_note_proposal"]);
    });
    const prepared = prepareAgentSource(fixture, "No provider turn may follow a durable proposal terminal.");

    const result = await new AgentIngestService(
      modelPort(),
      runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      bindProposalPort(proposals, fixture.vaultPath)
    ).ingestSource(fixture.vaultPath, prepared.source, prepared.parent);

    expect(result.outcome).toBe("confirmation_needed");
    expect(blockedCode).toBe("agent_runtime.terminal_action_committed");
    expect(proposals.list().total).toBe(1);
  });

  it("recovers a proposal committed before parent linkage after startup without another runtime or credential read", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    let firstRuntimeCalls = 0;
    let legacyCatalogHash = "";
    const firstRuntime = new FunctionalRuntime(async (request) => {
      firstRuntimeCalls += 1;
      legacyCatalogHash = createPigeAgentToolCatalogHash(
        request.tools.filter((tool) => tool.name !== RESPOND_TO_USER_TOOL_NAME)
      );
      await invokeTool(request, "pige_inspect_source", {}, "inspect_before_crash");
      await invokeTool(
        request,
        "pige_stage_knowledge_note_proposal",
        groundedOutput("Recovered proposal knowledge"),
        "proposal_before_crash"
      );
      throw new Error("Synthetic process failure after durable proposal commit.");
    });
    const capture = submitText(fixture, "A durable proposal must survive the parent-link crash window.");
    const captureJobs = new JobsService(fixture.vaultPort);
    captureJobs.processQueuedCaptures({ jobIds: [capture.jobId] });
    const parent = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "agent_ingest"));
    const parentPath = requireValue(listFiles(
      path.join(fixture.vaultPath, ".pige", "jobs"),
      `${parent.id}.json`
    )[0]);
    let durableParent = JobRecordSchema.parse({
      ...parent,
      state: "running",
      stage: "waiting_for_model",
      startedAt: "2026-07-12T00:01:00.000Z",
      updatedAt: "2026-07-12T00:01:00.000Z"
    });
    fs.writeFileSync(parentPath, `${JSON.stringify(durableParent, null, 2)}\n`, "utf8");
    const crashAfterStagePort: AgentIngestProposalPort = {
      findForJob: (vaultPath, jobId) => {
        assertTestVaultBinding(vaultPath, fixture.vaultPath);
        return proposals.findForJob(jobId);
      },
      stage: (vaultPath, request) => {
        assertTestVaultBinding(vaultPath, fixture.vaultPath);
        proposals.stage(request);
        throw new Error("Synthetic process failure after durable proposal commit.");
      }
    };
    const firstService = new AgentIngestService(
      modelPort(),
      firstRuntime,
      undefined,
      undefined,
      undefined,
      undefined,
      crashAfterStagePort
    );
    await expect(firstService.ingestSource(
      fixture.vaultPath,
      readSource(fixture.vaultPath, capture.sourceId),
      durableParent,
      {
        onPolicyResolved: (snapshot) => {
          durableParent = JobRecordSchema.parse({
            ...durableParent,
            policyContextId: snapshot.policyContextId,
            policyHash: snapshot.policyHash,
            updatedAt: "2026-07-12T00:01:01.000Z"
          });
          fs.writeFileSync(parentPath, `${JSON.stringify(durableParent, null, 2)}\n`, "utf8");
        },
        onEgressRecorded: (operationId) => {
          durableParent = JobRecordSchema.parse({
            ...durableParent,
            operationIds: Array.from(new Set([...(durableParent.operationIds ?? []), operationId])),
            updatedAt: "2026-07-12T00:01:02.000Z"
          });
          fs.writeFileSync(parentPath, `${JSON.stringify(durableParent, null, 2)}\n`, "utf8");
        }
      }
    )).rejects.toThrow("Synthetic process failure");
    const parentId = parent.id;
    const stagedId = requireValue(proposals.findForJob(parentId)?.id);
    const proposalPath = requireValue(listFiles(
      path.join(fixture.vaultPath, ".pige", "proposals"),
      `${stagedId}.json`
    )[0]);
    const legacyProposal = JSON.parse(fs.readFileSync(proposalPath, "utf8")) as ConfirmationProposal;
    fs.writeFileSync(proposalPath, `${JSON.stringify({
      ...legacyProposal,
      sourceRefs: legacyProposal.sourceRefs.map((ref) => (
        ref.kind === "tool" && ref.id.startsWith("agent_proposal_catalog_binding:")
          ? { ...ref, id: `agent_proposal_catalog_binding:${legacyCatalogHash}` }
          : ref
      ))
    }, null, 2)}\n`, "utf8");
    const interruptedParent = readJob(fixture.vaultPath, parentId);
    expect(interruptedParent.state).toBe("running");
    expect(interruptedParent.proposalIds).toBeUndefined();

    let restartedRuntimeCalls = 0;
    let restartedCredentialReads = 0;
    const restartedJobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(
        missingModelPort(() => { restartedCredentialReads += 1; }),
        new FunctionalRuntime(async (request) => {
          restartedRuntimeCalls += 1;
          return runtimeResult(request, []);
        }),
        undefined,
        undefined,
        undefined,
        undefined,
        bindProposalPort(new ProposalService(fixture.vaultPort), fixture.vaultPath)
      )
    );
    expect(restartedJobs.recoverInterruptedJobs()).toEqual({ requeued: 1, failedRetryable: 0 });
    expect(await restartedJobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });

    expect(firstRuntimeCalls).toBe(1);
    expect(restartedRuntimeCalls).toBe(0);
    expect(restartedCredentialReads).toBe(0);
    expect(proposals.list()).toMatchObject({ total: 1 });
    expect(proposals.findForJob(parentId)?.id).toBe(stagedId);
    expect(readJob(fixture.vaultPath, parentId)).toMatchObject({
      state: "awaiting_review",
      proposalIds: [stagedId]
    });
    expect(generatedNotes(fixture.vaultPath)).toEqual([]);
  });

  it.each([
    ["proposal", "pige_stage_knowledge_note_proposal", "pige_create_knowledge_note"],
    ["publication", "pige_create_knowledge_note", "pige_stage_knowledge_note_proposal"]
  ] as const)("allows only the first %s terminal action under concurrent sibling calls", async (
    winner,
    firstTool,
    secondTool
  ) => {
    const fixture = makeVault();
    const prepared = prepareAgentSource(fixture, `Only the ${winner} terminal action may commit.`);
    const proposals = new ProposalService(fixture.vaultPort);
    let siblingResults: readonly PigeAgentToolResult[] = [];
    const runtime = new FunctionalRuntime(async (request) => {
      await invokeTool(request, "pige_inspect_source", {}, `inspect_${winner}`);
      siblingResults = await Promise.all([
        invokeTool(request, firstTool, groundedOutput(`${winner} wins`), `${winner}_first`),
        invokeTool(request, secondTool, groundedOutput(`${winner} loses sibling`), `${winner}_second`)
      ]);
      return runtimeResult(request, ["pige_inspect_source", firstTool, secondTool]);
    });

    const result = await new AgentIngestService(
      modelPort(),
      runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      bindProposalPort(proposals, fixture.vaultPath)
    ).ingestSource(fixture.vaultPath, prepared.source, prepared.parent);

    expect(result.outcome).toBe(winner === "proposal" ? "confirmation_needed" : "published");
    if (winner === "proposal") {
      expect(proposals.list().total).toBe(1);
      expect(generatedNotes(fixture.vaultPath)).toEqual([]);
      expect(siblingResults[1]?.modelText).toContain("already_awaiting_review");
    } else {
      expect(proposals.list().total).toBe(0);
      expect(generatedNotes(fixture.vaultPath)).toHaveLength(1);
      expect(siblingResults[1]?.modelText).toContain("already_published");
    }
  });

  it("rejects model attempts to control proposal paths, trust, or references before staging", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    const runtime = new RecordingPiRuntime([
      toolCall("pige_inspect_source", "inspect_malicious", {}),
      toolCall("pige_stage_knowledge_note_proposal", "malicious_proposal", {
        ...groundedOutput("Must not stage"),
        path: "wiki/model-controlled.md",
        trustLevel: "explicit_confirmation",
        sourceRefs: [{ kind: "source", id: "src_model_controlled" }]
      })
    ]);
    const prepared = prepareAgentSource(fixture, "The model cannot control host-owned proposal metadata.");

    await expect(new AgentIngestService(
      modelPort(),
      runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      bindProposalPort(proposals, fixture.vaultPath)
    ).ingestSource(fixture.vaultPath, prepared.source, prepared.parent)).rejects.toMatchObject({
      code: "model_provider.call_failed"
    });
    expect(proposals.list().total).toBe(0);
    expect(generatedNotes(fixture.vaultPath)).toEqual([]);
  });

  it("fails closed when the current SourceRecord drifts after inspection and before proposal staging", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    let sourceId = "";
    const runtime = new FunctionalRuntime(async (request) => {
      await invokeTool(request, "pige_inspect_source", {}, "inspect_source_drift");
      const sourcePath = requireValue(listFiles(
        path.join(fixture.vaultPath, ".pige", "source-records"),
        `${sourceId}.json`
      )[0]);
      const current = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as SourceRecord;
      fs.writeFileSync(sourcePath, `${JSON.stringify({
        ...current,
        updatedAt: "2026-07-12T00:01:00.000Z"
      }, null, 2)}\n`, "utf8");
      await invokeTool(
        request,
        "pige_stage_knowledge_note_proposal",
        groundedOutput("Must not stage stale source evidence"),
        "proposal_source_drift"
      );
      return runtimeResult(request, []);
    });
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(
        modelPort(),
        runtime,
        undefined,
        undefined,
        undefined,
        undefined,
        bindProposalPort(proposals, fixture.vaultPath)
      )
    );
    const capture = submitText(fixture, "Current source revision must be rebound before proposal staging.");
    sourceId = capture.sourceId;
    jobs.processQueuedCaptures({ jobIds: [capture.jobId] });
    const parentId = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "agent_ingest")?.id);

    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    expect(proposals.list().total).toBe(0);
    expect(generatedNotes(fixture.vaultPath)).toEqual([]);
  });

  it("fails closed when the active vault binding changes before proposal staging", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    let activeVaultPath = fixture.vaultPath;
    const guardedProposalPort: AgentIngestProposalPort = {
      findForJob: (vaultPath, jobId) => {
        assertTestVaultBinding(vaultPath, activeVaultPath);
        return proposals.findForJob(jobId);
      },
      stage: (vaultPath, request) => {
        assertTestVaultBinding(vaultPath, activeVaultPath);
        return proposals.stage(request);
      }
    };
    const runtime = new FunctionalRuntime(async (request) => {
      await invokeTool(request, "pige_inspect_source", {}, "inspect_vault_drift");
      activeVaultPath = path.join(path.dirname(fixture.vaultPath), "DifferentVault");
      await invokeTool(
        request,
        "pige_stage_knowledge_note_proposal",
        groundedOutput("Must not cross vaults"),
        "proposal_vault_drift"
      );
      return runtimeResult(request, []);
    });
    const prepared = prepareAgentSource(fixture, "Proposal storage must remain bound to the executing vault.");

    await expect(new AgentIngestService(
      modelPort(),
      runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      guardedProposalPort
    ).ingestSource(fixture.vaultPath, prepared.source, prepared.parent)).rejects.toMatchObject({
      code: "vault.binding_changed"
    });
    expect(proposals.list().total).toBe(0);
    expect(generatedNotes(fixture.vaultPath)).toEqual([]);
  });

  it("fails closed instead of adopting a note when the same Job also owns a ready proposal", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    const prepared = prepareAgentSource(fixture, "A dual durable terminal must never bypass proposal review.");
    const staged = await new AgentIngestService(
      modelPort(),
      new FunctionalRuntime(async (request) => {
        await invokeTool(request, "pige_inspect_source", {}, "inspect_dual_terminal");
        await invokeTool(
          request,
          "pige_stage_knowledge_note_proposal",
          groundedOutput("Dual terminal conflict"),
          "proposal_dual_terminal"
        );
        return runtimeResult(request, []);
      }),
      undefined,
      undefined,
      undefined,
      undefined,
      bindProposalPort(proposals, fixture.vaultPath)
    ).ingestSource(fixture.vaultPath, prepared.source, prepared.parent);
    if (staged.outcome !== "confirmation_needed") throw new Error("Test proposal did not stage.");
    const proposal = proposals.get({ proposalId: staged.proposalId }).proposal;
    const operation = requireValue(proposal.proposedOperations[0]);
    if (operation.kind !== "create") throw new Error("Test proposal did not contain one create operation.");
    const pagePath = path.join(fixture.vaultPath, ...operation.path.split("/"));
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, operation.content, "utf8");
    let runtimeCalls = 0;

    await expect(new AgentIngestService(
      modelPort(),
      new FunctionalRuntime(async (request) => {
        runtimeCalls += 1;
        return runtimeResult(request, []);
      }),
      undefined,
      undefined,
      undefined,
      undefined,
      bindProposalPort(proposals, fixture.vaultPath)
    ).ingestSource(fixture.vaultPath, prepared.source, prepared.parent)).rejects.toMatchObject({
      code: "agent_runtime.terminal_action_conflict"
    });
    expect(runtimeCalls).toBe(0);
  });

  it("rechecks cancellation after asynchronous evidence refresh and before proposal persistence", async () => {
    const fixture = makeVault();
    const proposals = new ProposalService(fixture.vaultPort);
    const prepared = prepareAgentSource(fixture, "Cancellation during refreshed evidence must prevent proposal persistence.");
    const controller = new AbortController();
    const evidence = new AbortAfterStageRefreshEvidence(controller);
    const runtime = new FunctionalRuntime(async (request) => {
      await invokeTool(request, "pige_inspect_source", {}, "inspect_refresh_cancel");
      await invokeTool(
        request,
        "pige_stage_knowledge_note_proposal",
        groundedOutput("Must not stage after refresh cancellation"),
        "proposal_refresh_cancel"
      );
      return runtimeResult(request, []);
    });

    await expect(new AgentIngestService(
      modelPort(),
      runtime,
      undefined,
      evidence,
      undefined,
      undefined,
      bindProposalPort(proposals, fixture.vaultPath)
    ).ingestSource(
      fixture.vaultPath,
      prepared.source,
      prepared.parent,
      { signal: controller.signal }
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(evidence.calls).toBe(3);
    expect(proposals.list().total).toBe(0);
    expect(generatedNotes(fixture.vaultPath)).toEqual([]);
  });

  it.each(["before", "after"] as const)(
    "keeps cancellation %s proposal commit on the correct durable side of the boundary",
    async (timing) => {
      const fixture = makeVault();
      const proposals = new ProposalService(fixture.vaultPort);
      let jobs!: JobsService;
      let parentId = "";
      const runtime = new FunctionalRuntime(async (request) => {
        await invokeTool(request, "pige_inspect_source", {}, `inspect_cancel_${timing}`);
        if (timing === "before") jobs.cancel({ jobId: parentId });
        await invokeTool(
          request,
          "pige_stage_knowledge_note_proposal",
          groundedOutput(`Cancellation ${timing} proposal`),
          `proposal_cancel_${timing}`
        );
        if (timing === "after") jobs.cancel({ jobId: parentId });
        return runtimeResult(request, ["pige_inspect_source", "pige_stage_knowledge_note_proposal"]);
      });
      jobs = new JobsService(
        fixture.vaultPort,
        new AgentIngestService(
          modelPort(),
          runtime,
          undefined,
          undefined,
          undefined,
          undefined,
          bindProposalPort(proposals, fixture.vaultPath)
        )
      );
      const capture = submitText(fixture, `Cancellation ${timing} the durable proposal boundary.`);
      jobs.processQueuedCaptures({ jobIds: [capture.jobId] });
      parentId = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "agent_ingest")?.id);

      const processed = await jobs.processQueuedAgentIngest({ jobIds: [parentId] });
      if (timing === "before") {
        expect(processed).toEqual({ processed: 1, completed: 0, failed: 1 });
        expect(proposals.list().total).toBe(0);
        expect(readJob(fixture.vaultPath, parentId).state).toBe("cancelled");
      } else {
        expect(processed).toEqual({ processed: 1, completed: 1, failed: 0 });
        expect(proposals.list().total).toBe(1);
        expect(readJob(fixture.vaultPath, parentId)).toMatchObject({
          state: "awaiting_review",
          cancellation: { durableWritesApplied: true }
        });
      }
      expect(generatedNotes(fixture.vaultPath)).toEqual([]);
    }
  );
});

class RecordingPiRuntime implements AgentIngestRuntimePort {
  calls = 0;
  readonly results: PiAgentRunResult[] = [];

  constructor(private readonly fauxResponses: readonly PiFauxResponse[]) {}

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    this.calls += 1;
    const result = await new PiAgentRuntimeAdapter({ fauxResponses: this.fauxResponses }).run(request);
    this.results.push(result);
    return result;
  }
}

class FunctionalRuntime implements AgentIngestRuntimePort {
  constructor(private readonly callback: (request: PiAgentRunRequest) => Promise<PiAgentRunResult>) {}

  run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    return this.callback(request);
  }
}

class AbortAfterStageRefreshEvidence extends EvidenceAssemblyService {
  calls = 0;

  constructor(private readonly controller: AbortController) {
    super();
  }

  override async assemble(...args: Parameters<EvidenceAssemblyService["assemble"]>) {
    const result = await super.assemble(...args);
    this.calls += 1;
    if (this.calls === 3) this.controller.abort();
    return result;
  }
}

async function invokeTool(
  request: PiAgentRunRequest,
  toolName: string,
  args: unknown,
  toolCallId: string
): Promise<PigeAgentToolResult> {
  const tool = requireValue(request.tools.find((candidate) => candidate.name === toolName));
  const signal = request.signal ?? new AbortController().signal;
  const context = { toolCallId, signal };
  if (await tool.authorize?.(args, context) === false) {
    throw new Error(`Test tool ${toolName} was unexpectedly denied.`);
  }
  return tool.execute(args, signal, context);
}

function runtimeResult(request: PiAgentRunRequest, invokedTools: readonly string[]): PiAgentRunResult {
  return {
    adapterMode: "embedded_pi_sdk",
    providerProfileId: request.runtimeConfig.provider.id,
    modelProfileId: request.runtimeConfig.model.id,
    modelId: request.runtimeConfig.model.modelId,
    events: [],
    assistantText: "",
    invokedTools
  };
}

function toolCall(
  toolName: string,
  toolCallId: string,
  args: Readonly<Record<string, unknown>>
): PiFauxResponse {
  return { kind: "tool_call", toolName, toolCallId, args };
}

function groundedOutput(title: string) {
  return {
    title,
    summary: {
      text: "The preserved source is the factual evidence for this reviewable knowledge note.",
      evidenceRefs: ["ev_01"]
    },
    keyPoints: [{
      text: "Pige owns the durable proposal path, references, and review state.",
      evidenceRefs: ["ev_01"]
    }],
    tags: ["proposal"],
    topics: ["Agent-led knowledge"],
    entities: [],
    relatedPageRefs: [],
    warnings: [],
    confidence: "high"
  };
}

function modelPort(onRuntimeConfigRead: () => void = () => undefined): AgentIngestModelConfigPort {
  const model: ModelProfileSummary = { ...runtimeConfig.model, isDefault: true };
  const provider: ProviderProfileSummary = runtimeConfig.provider;
  return {
    getDefaultModel: () => model,
    getDefaultProvider: () => provider,
    hasDefaultRuntimeBinding: () => true,
    getDefaultRuntimeConfig: () => {
      onRuntimeConfigRead();
      return runtimeConfig;
    }
  };
}

function missingModelPort(onRuntimeConfigRead: () => void): AgentIngestModelConfigPort {
  return {
    getDefaultModel: () => undefined,
    getDefaultProvider: () => undefined,
    hasDefaultRuntimeBinding: () => false,
    getDefaultRuntimeConfig: () => {
      onRuntimeConfigRead();
      return undefined;
    }
  };
}

function bindProposalPort(
  proposals: ProposalService,
  expectedVaultPath: string
): AgentIngestProposalPort {
  return {
    findForJob: (vaultPath, jobId) => {
      if (vaultPath !== expectedVaultPath) throw new Error("Proposal recovery escaped the active test vault.");
      return proposals.findForJob(jobId);
    },
    stage: (vaultPath, request) => {
      if (vaultPath !== expectedVaultPath) throw new Error("Proposal staging escaped the active test vault.");
      return proposals.stage(request);
    }
  };
}

function assertTestVaultBinding(requested: string, active: string): void {
  if (requested !== active) {
    throw new PigeDomainError("vault.binding_changed", "The active test vault changed before proposal storage.");
  }
}

function makeVault(): {
  readonly vaultPath: string;
  readonly vault: VaultSummary;
  readonly vaultPort: { current(): VaultSummary; activeVaultPath(): string };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-ingest-proposal-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "AgentIngestProposal",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-12T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "AgentIngestProposal");
  const vault = loadVaultSummary(vaultPath);
  return {
    vaultPath,
    vault,
    vaultPort: { current: () => vault, activeVaultPath: () => vaultPath }
  };
}

function submitText(
  fixture: ReturnType<typeof makeVault>,
  text: string
): { readonly sourceId: string; readonly jobId: string } {
  return new CaptureService(fixture.vaultPort).submitText({
    text,
    inputKind: "typed_text",
    userIntent: "capture",
    locale: "en"
  });
}

function prepareAgentSource(
  fixture: ReturnType<typeof makeVault>,
  text: string
): { readonly source: SourceRecord; readonly parent: JobRecord } {
  const capture = submitText(fixture, text);
  const jobs = new JobsService(fixture.vaultPort);
  const processed = jobs.processQueuedCaptures({ jobIds: [capture.jobId] });
  if (processed.completed !== 1) throw new Error("Test capture did not create its Agent parent.");
  const parent = requireValue(readJobs(fixture.vaultPath).find((job) =>
    job.class === "agent_ingest" && job.sourceId === capture.sourceId
  ));
  return { source: readSource(fixture.vaultPath, capture.sourceId), parent };
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

function generatedNotes(vaultPath: string): string[] {
  return listFiles(path.join(vaultPath, "wiki", "generated"), ".md");
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
