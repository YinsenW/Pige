import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import type { JobRecord, OperationRecord, SourceRecord } from "@pige/schemas";
import {
  AgentIngestService,
  type AgentIngestCapabilityPort,
  type AgentIngestModelConfigPort,
  type AgentIngestRuntimePort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { JobCancellationError } from "../../apps/desktop/src/main/services/job-execution-control";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import { extractPdfText } from "../../apps/desktop/src/main/services/pdf-parser-core";
import { PdfParserService } from "../../apps/desktop/src/main/services/pdf-parser-service";
import {
  createPigeAgentToolCatalogHash,
  PiAgentRuntimeAdapter,
  type PiFauxResponse,
  type PiAgentRunRequest,
  type PiAgentRunResult
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { RESPOND_TO_USER_TOOL_NAME } from "../../apps/desktop/src/main/services/agent-ingest-tool-registry";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { createTestPdf } from "./helpers/pdf-fixture";

const roots: string[] = [];

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_pdf_tool",
    displayName: "PDF Tool Faux Provider",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43123/v1",
    authSecretRef: "provider_secret_pdf_tool",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  model: {
    id: "model_pdf_tool",
    providerProfileId: "provider_pdf_tool",
    modelId: "pdf-tool-model",
    displayName: "PDF Tool Model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  apiKey: "synthetic-pdf-tool-key"
};

const modelPort: AgentIngestModelConfigPort = {
  getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
  getDefaultProvider: () => runtimeConfig.provider,
  hasDefaultRuntimeBinding: () => true,
  getDefaultRuntimeConfig: () => runtimeConfig
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent-led PDF parse tool", () => {
  it("runs Pi inspect -> parse -> inspect -> publish with one durable PDF parse child", async () => {
    const fixture = makeVault();
    const nativeText = "Pige keeps this native PDF evidence durable before its Agent selects the bounded local parser tool.";
    const captured = await preservePdf(fixture, "native-evidence.pdf", nativeText);
    let parserCalls = 0;
    const parser = new PdfParserService({
      isAvailable: () => true,
      extract: (filePath) => {
        parserCalls += 1;
        return extractPdfText({
          requestId: "agent-led-native-pdf",
          filePath,
          limits: { maxBytes: 5 * 1024 * 1024, maxPages: 20 }
        });
      }
    });
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "pi_inspect_native_before" },
        { kind: "tool_call", toolName: "pige_parse_source", args: {}, toolCallId: "pi_parse_native" },
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "pi_inspect_native_after" },
        {
          kind: "tool_call",
          toolName: "pige_create_knowledge_note",
          args: groundedOutput("Agent-selected PDF knowledge"),
          toolCallId: "pi_publish_native"
        }
      ]
    }));
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(modelPort, runtime, capabilityPort(true)),
      undefined,
      parser
    );
    const network = installNetworkTripwire();

    try {
      const preservedBeforeParse = readSource(fixture.vaultPath, captured.sourceId);
      expect(preservedBeforeParse.artifacts).toEqual([]);
      expect(parserCalls).toBe(0);

      expect(jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] })).toEqual({
        processed: 1,
        completed: 1,
        failed: 0
      });
      const parentSummary = requireValue(
        jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]
      );
      const sourcePagePath = findFileContaining(
        path.join(fixture.vaultPath, "sources"),
        captured.sourceId
      );
      expect(readJobs(fixture.vaultPath).filter((job) => job.class === "parse")).toEqual([]);
      expect(fs.readFileSync(sourcePagePath, "utf8")).not.toContain(nativeText);
      expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
      expect(parserCalls).toBe(0);

      expect(await jobs.processQueuedAgentIngest({ jobIds: [parentSummary.id] })).toEqual({
        processed: 1,
        completed: 1,
        failed: 0
      });

      const parent = readJob(fixture.vaultPath, parentSummary.id);
      const parseChildren = readJobs(fixture.vaultPath).filter((job) => job.class === "parse");
      const child = requireValue(parseChildren[0]);
      const source = readSource(fixture.vaultPath, captured.sourceId);
      const notePath = requireValue(
        listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")[0]
      );
      const note = fs.readFileSync(notePath, "utf8");
      const operations = readOperations(fixture.vaultPath);
      const artifactOperation = requireValue(
        operations.find((operation) => operation.kind === "create_artifact")
      );
      const noteOperation = requireValue(
        operations.find((operation) => operation.kind === "create_page")
      );

      expect(parserCalls).toBe(1);
      expect(runtime.results).toHaveLength(1);
      expect(runtime.results[0]?.invokedTools).toEqual([
        "pige_inspect_source",
        "pige_parse_source",
        "pige_inspect_source",
        "pige_create_knowledge_note"
      ]);
      expect(parent).toMatchObject({ class: "agent_ingest", state: "completed" });
      expect(parseChildren).toHaveLength(1);
      expect(child).toMatchObject({
        class: "parse",
        state: "completed",
        parentJobId: parent.id,
        sourceId: captured.sourceId
      });
      expect(parent.childJobIds).toEqual([child.id]);
      expect(source.artifacts.map((artifact) => artifact.kind)).toEqual([
        "extracted_text",
        "metadata"
      ]);
      expect(source.metadata).toMatchObject({
        parserStatus: "parsed",
        parserEngine: "pdfjs-dist",
        textCoverage: "high",
        agentTextReady: true
      });
      for (const artifact of source.artifacts) {
        expect(path.isAbsolute(artifact.path)).toBe(false);
        expect(fs.existsSync(path.join(fixture.vaultPath, artifact.path))).toBe(true);
      }
      const extracted = requireValue(source.artifacts.find((artifact) => artifact.kind === "extracted_text"));
      expect(fs.readFileSync(path.join(fixture.vaultPath, extracted.path), "utf8")).toContain(nativeText);
      expect(fs.readFileSync(sourcePagePath, "utf8")).toContain(nativeText);
      expect(note).toContain("# Agent-selected PDF knowledge");
      expect(note).toContain(`[source:${captured.sourceId}#p1]`);
      expect(artifactOperation.jobId).toBe(child.id);
      expect(noteOperation.jobId).toBe(parent.id);
      expect(parent.operationIds).toContain(noteOperation.id);
      expect(operations.map((operation) => operation.kind)).toEqual(expect.arrayContaining([
        "model_egress_decision",
        "create_artifact",
        "create_page"
      ]));
      expect(fs.readFileSync(captured.managedPath)).toEqual(captured.bytes);
      expect(network.calls).toBe(0);
    } finally {
      network.restore();
    }
  });

  it("reuses a completed parse child when the same parent retries after a post-parse failure", async () => {
    const fixture = makeVault();
    const nativeText = "A completed parser child must remain the one semantic action when its Agent parent retries.";
    const captured = await preservePdf(fixture, "retry-after-parse.pdf", nativeText);
    let parserCalls = 0;
    const parser = new PdfParserService({
      isAvailable: () => true,
      extract: (filePath) => {
        parserCalls += 1;
        return extractPdfText({
          requestId: "agent-led-retry-pdf",
          filePath,
          limits: { maxBytes: 5 * 1024 * 1024, maxPages: 20 }
        });
      }
    });
    const runtime = new SequencedPiRuntime([
      [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "pi_inspect_retry_before" },
        { kind: "tool_call", toolName: "pige_parse_source", args: {}, toolCallId: "pi_parse_retry_first" },
        { kind: "text", text: "Synthetic interruption after durable parsing." }
      ],
      [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "pi_inspect_retry_again" },
        { kind: "tool_call", toolName: "pige_parse_source", args: {}, toolCallId: "pi_parse_retry_second" },
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "pi_inspect_retry_latest" },
        {
          kind: "tool_call",
          toolName: "pige_create_knowledge_note",
          args: groundedOutput("Retried Agent-selected PDF knowledge"),
          toolCallId: "pi_publish_retry"
        }
      ]
    ]);
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(modelPort, runtime, capabilityPort(true)),
      undefined,
      parser
    );

    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(
      jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]
    ).id;
    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    const firstChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "parse"));
    expect(firstChild.state).toBe("completed");
    expect(readJob(fixture.vaultPath, parentId).state).toBe("failed_retryable");
    expect(parserCalls).toBe(1);

    expect(jobs.retry({ jobId: parentId })).toMatchObject({ status: "requeued" });
    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });

    const children = readJobs(fixture.vaultPath).filter((job) => job.class === "parse");
    const child = requireValue(children[0]);
    const provenance = (child.inputRefs ?? []).filter(
      (ref) => ref.role === "agent_tool_call_provenance"
    );
    expect(children).toHaveLength(1);
    expect(child.id).toBe(firstChild.id);
    expect(child.state).toBe("completed");
    expect(parserCalls).toBe(1);
    expect(provenance.map((ref) => ref.checksum)).toEqual([
      hashToolCallId(parentId, "pi_parse_retry_first"),
      hashToolCallId(parentId, "pi_parse_retry_second")
    ]);
    expect(readJob(fixture.vaultPath, parentId)).toMatchObject({
      state: "completed",
      childJobIds: [child.id]
    });
    expect(fs.readFileSync(
      requireValue(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")[0]),
      "utf8"
    )).toContain("# Retried Agent-selected PDF knowledge");
  });

  it("reuses one waiting parse child across a known prior catalog generation and genuine Pi call IDs", async () => {
    const fixture = makeVault();
    const sourceBody = "This preserved PDF waits safely when its local parser dependency is unavailable.";
    const captured = await preservePdf(fixture, "waiting-parser.pdf", sourceBody);
    const uniqueCallIds = Array.from(
      { length: 18 },
      (_, index) => `pi_parse_retry_${String(index + 1).padStart(2, "0")}`
    );
    const parseCallIds = [
      ...uniqueCallIds.slice(0, 16),
      uniqueCallIds[7] as string,
      ...uniqueCallIds.slice(16)
    ];
    const runtime = new SequencedWaitingParseRuntime(parseCallIds);
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(modelPort, runtime, capabilityPort(false))
    );
    const network = installNetworkTripwire();

    try {
      expect(jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] })).toEqual({
        processed: 1,
        completed: 1,
        failed: 0
      });
      const parentId = requireValue(
        jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]
      ).id;
      const observedChildIds: string[] = [];

      for (const [index] of parseCallIds.entries()) {
        expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
          processed: 1,
          completed: 0,
          failed: 1
        });
        const waitingChildren = readJobs(fixture.vaultPath).filter((job) => job.class === "parse");
        expect(waitingChildren).toHaveLength(1);
        if (index === 0) {
          const firstChild = requireValue(waitingChildren[0]);
          writeJob(fixture.vaultPath, {
            ...firstChild,
            inputRefs: firstChild.inputRefs?.map((ref) => ref.role === "agent_tool_catalog"
              ? { ...ref, checksum: runtime.legacyCatalogHash }
              : ref)
          });
        }
        observedChildIds.push(requireValue(waitingChildren[0]).id);
        expect(readJob(fixture.vaultPath, parentId).state).toBe("waiting_dependency");
        if (index < parseCallIds.length - 1) {
          expect(jobs.retry({ jobId: parentId })).toMatchObject({ status: "requeued" });
        }
      }

      const parent = readJob(fixture.vaultPath, parentId);
      const child = requireValue(
        readJobs(fixture.vaultPath).find((job) => job.class === "parse")
      );
      const provenance = (child.inputRefs ?? []).filter(
        (ref) => ref.role === "agent_tool_call_provenance"
      );
      const jobJson = listFiles(path.join(fixture.vaultPath, ".pige", "jobs"), ".json")
        .map((filePath) => fs.readFileSync(filePath, "utf8"))
        .join("\n");

      expect(runtime.results).toHaveLength(parseCallIds.length);
      expect(runtime.results.every((result) => (
        result.invokedTools.join(",") === "pige_inspect_source,pige_parse_source"
      ))).toBe(true);
      expect(new Set(observedChildIds)).toEqual(new Set([child.id]));
      expect(parent).toMatchObject({ class: "agent_ingest", state: "waiting_dependency" });
      expect(parent.childJobIds).toEqual([child.id]);
      expect(child).toMatchObject({
        class: "parse",
        state: "waiting_dependency",
        parentJobId: parent.id,
        sourceId: captured.sourceId
      });
      expect(child.inputRefs?.filter((ref) => ref.role === "agent_tool_source_revision")).toHaveLength(1);
      expect(child.inputRefs?.filter((ref) => ref.role === "agent_tool_canonical_input")).toHaveLength(1);
      expect(child.inputRefs?.filter((ref) => ref.role === "agent_tool_catalog")).toHaveLength(1);
      expect(provenance).toHaveLength(16);
      expect(provenance.map((ref) => ref.checksum)).toEqual(
        uniqueCallIds.slice(0, 16).map((toolCallId) => hashToolCallId(parent.id, toolCallId))
      );
      expect(new Set(provenance.map((ref) => ref.checksum))).toHaveLength(16);
      expect(provenance.every((ref) => (
        ref.kind === "tool" &&
        ref.id === "pige_parse_source" &&
        /^sha256:[a-f0-9]{64}$/u.test(ref.checksum ?? "")
      ))).toBe(true);
      for (const toolCallId of new Set(parseCallIds)) expect(jobJson).not.toContain(toolCallId);
      expect(jobJson).not.toContain(captured.inputPath);
      expect(jobJson).not.toContain(sourceBody);
      expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
      expect(readOperations(fixture.vaultPath).map((operation) => operation.kind)).not.toContain("create_page");
      expect(readSource(fixture.vaultPath, captured.sourceId).artifacts).toEqual([]);
      expect(fs.readFileSync(captured.managedPath)).toEqual(captured.bytes);
      expect(network.calls).toBe(0);
    } finally {
      network.restore();
    }
  });

  it.each(["policy", "catalog"] as const)(
    "rejects a stale %s binding without manufacturing a duplicate parse child",
    async (binding) => {
      const fixture = makeVault();
      const captured = await preservePdf(
        fixture,
        `stale-${binding}.pdf`,
        `A stale ${binding} binding must fail closed without authorizing an old parser action.`
      );
      const runtime = new SequencedWaitingParseRuntime([
        `pi_parse_${binding}_first`,
        `pi_parse_${binding}_second`
      ]);
      const jobs = new JobsService(
        fixture.vaultPort,
        new AgentIngestService(modelPort, runtime, capabilityPort(false))
      );

      jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
      const parentId = requireValue(
        jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]
      ).id;
      expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
        processed: 1,
        completed: 0,
        failed: 1
      });
      const child = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "parse"));
      const staleChecksum = `sha256:${(binding === "policy" ? "a" : "b").repeat(64)}`;
      const tampered: JobRecord = binding === "policy"
        ? { ...child, policyHash: staleChecksum }
        : {
            ...child,
            inputRefs: child.inputRefs?.map((ref) => ref.role === "agent_tool_catalog"
              ? { ...ref, checksum: staleChecksum }
              : ref)
          };
      writeJob(fixture.vaultPath, tampered);

      expect(jobs.retry({ jobId: parentId })).toMatchObject({ status: "requeued" });
      expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
        processed: 1,
        completed: 0,
        failed: 1
      });

      const children = readJobs(fixture.vaultPath).filter((job) => job.class === "parse");
      expect(staleChecksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(children).toHaveLength(1);
      expect(children[0]?.id).toBe(child.id);
      expect(readJob(fixture.vaultPath, parentId).state).toBe("failed_retryable");
      expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
      expect(readOperations(fixture.vaultPath).map((operation) => operation.kind)).not.toContain("create_page");
    }
  );

  it("creates a different parse child when the preserved source revision changes", async () => {
    const fixture = makeVault();
    const captured = await preservePdf(
      fixture,
      "source-revision.pdf",
      "The first preserved PDF revision waits for its parser capability."
    );
    const runtime = new SequencedWaitingParseRuntime([
      "pi_parse_source_revision_first",
      "pi_parse_source_revision_second"
    ]);
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(modelPort, runtime, capabilityPort(false))
    );

    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(
      jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]
    ).id;
    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({
      processed: 1,
      completed: 0,
      failed: 1
    });
    const firstChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "parse"));

    const nextBytes = createTestPdf([
      "The second preserved PDF revision is a distinct semantic parser action."
    ], "source-revision-v2.pdf");
    fs.writeFileSync(captured.managedPath, nextBytes);
    const currentSource = readSource(fixture.vaultPath, captured.sourceId);
    const managedCopy = requireValue(currentSource.managedCopy);
    writeSource(fixture.vaultPath, {
      ...currentSource,
      managedCopy: {
        ...managedCopy,
        checksum: checksum(nextBytes),
        size: nextBytes.byteLength
      },
      updatedAt: "2026-07-11T00:01:00.000Z"
    });

    expect(jobs.retry({ jobId: parentId })).toMatchObject({ status: "requeued" });
    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({
      processed: 1,
      completed: 0,
      failed: 1
    });

    const children = readJobs(fixture.vaultPath).filter((job) => job.class === "parse");
    const firstRevision = requireValue(firstChild.inputRefs?.find(
      (ref) => ref.role === "agent_tool_source_revision"
    )?.checksum);
    expect(children).toHaveLength(2);
    expect(new Set(children.map((child) => child.id)).size).toBe(2);
    expect(children.map((child) => child.inputRefs?.find(
      (ref) => ref.role === "agent_tool_source_revision"
    )?.checksum).sort()).toEqual([firstRevision, checksum(nextBytes)].sort());
    expect(readJob(fixture.vaultPath, parentId).childJobIds).toEqual(
      expect.arrayContaining(children.map((child) => child.id))
    );
  });

  it("propagates parent cancellation into the active PDF parser without publishing a note", async () => {
    const fixture = makeVault();
    const sourceBody = "Cancellation during parser work must retain this preserved PDF as durable evidence.";
    const captured = await preservePdf(fixture, "cancel-parser.pdf", sourceBody);
    const parserStarted = deferred<void>();
    const parser = new PdfParserService({
      isAvailable: () => true,
      extract: (_filePath, signal) => {
        parserStarted.resolve();
        return new Promise((_resolve, reject) => {
          const cancel = (): void => reject(new JobCancellationError());
          if (signal?.aborted) cancel();
          else signal?.addEventListener("abort", cancel, { once: true });
        });
      }
    });
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "pi_inspect_cancel" },
        { kind: "tool_call", toolName: "pige_parse_source", args: {}, toolCallId: "pi_parse_cancel" }
      ]
    }));
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(modelPort, runtime, capabilityPort(true)),
      undefined,
      parser
    );
    const network = installNetworkTripwire();

    try {
      jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
      const parentId = requireValue(
        jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]
      ).id;
      const processing = jobs.processQueuedAgentIngest({ jobIds: [parentId] });
      await parserStarted.promise;

      const runningParent = requireValue(
        jobs.list({ classes: ["agent_ingest"], states: ["running"] }).jobs[0]
      );
      const runningChild = requireValue(
        jobs.list({ classes: ["parse"], states: ["running"] }).jobs[0]
      );
      expect(runningChild.id).not.toBe(runningParent.id);
      expect(jobs.cancel({ jobId: runningParent.id })).toMatchObject({
        status: "cancel_requested",
        job: { state: "cancel_requested" }
      });
      expect(await processing).toEqual({ processed: 1, completed: 0, failed: 1 });

      const parent = readJob(fixture.vaultPath, parentId);
      const child = readJob(fixture.vaultPath, runningChild.id);
      const source = readSource(fixture.vaultPath, captured.sourceId);
      expect(parent).toMatchObject({
        state: "failed_retryable",
        cancellation: { requestedBy: "user", durableWritesApplied: true }
      });
      expect(child).toMatchObject({
        state: "cancelled",
        parentJobId: parent.id,
        cancellation: { durableWritesApplied: false }
      });
      expect(parent.childJobIds).toEqual([child.id]);
      expect(source.artifacts).toEqual([]);
      expect(fs.readFileSync(captured.managedPath)).toEqual(captured.bytes);
      expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
      expect(readOperations(fixture.vaultPath).map((operation) => operation.kind)).not.toEqual(
        expect.arrayContaining(["create_artifact", "create_page"])
      );
      expect(network.calls).toBe(0);
    } finally {
      network.restore();
    }
  });
});

class RecordingRuntime implements AgentIngestRuntimePort {
  readonly results: PiAgentRunResult[] = [];

  constructor(private readonly delegate: AgentIngestRuntimePort) {}

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    const result = await this.delegate.run(request);
    this.results.push(result);
    return result;
  }
}

class SequencedWaitingParseRuntime implements AgentIngestRuntimePort {
  readonly results: PiAgentRunResult[] = [];
  legacyCatalogHash = "";
  #nextCall = 0;

  constructor(private readonly parseCallIds: readonly string[]) {}

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    this.legacyCatalogHash ||= createPigeAgentToolCatalogHash(
      request.tools.filter((tool) => tool.name !== RESPOND_TO_USER_TOOL_NAME)
    );
    const parseCallId = requireValue(this.parseCallIds[this.#nextCall]);
    const callNumber = this.#nextCall + 1;
    this.#nextCall += 1;
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        {
          kind: "tool_call",
          toolName: "pige_inspect_source",
          args: {},
          toolCallId: `pi_inspect_retry_${String(callNumber).padStart(2, "0")}`
        },
        { kind: "tool_call", toolName: "pige_parse_source", args: {}, toolCallId: parseCallId }
      ]
    });
    const result = await adapter.run(request);
    this.results.push(result);
    return result;
  }
}

class SequencedPiRuntime implements AgentIngestRuntimePort {
  #nextRun = 0;

  constructor(
    private readonly responses: readonly (readonly PiFauxResponse[])[]
  ) {}

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    const fauxResponses = requireValue(this.responses[this.#nextRun]);
    this.#nextRun += 1;
    return new PiAgentRuntimeAdapter({ fauxResponses }).run(request);
  }
}

function capabilityPort(parserToolchainReady: boolean): AgentIngestCapabilityPort {
  return {
    snapshot: () => ({
      localDatabaseStatus: "not_initialized",
      parserToolchainReady,
      ocrEngines: [],
      speechInputAvailable: false,
      embeddingModelInstalled: false,
      lexicalSearchAvailable: false,
      vectorSearchAvailable: false,
      rerankerAvailable: false
    })
  };
}

function groundedOutput(title: string) {
  return {
    title,
    summary: {
      text: "The preserved PDF was parsed only after the Agent selected the bounded tool.",
      evidenceRefs: ["ev_01"]
    },
    keyPoints: [{
      text: "The generated note remains grounded in page-level PDF evidence.",
      evidenceRefs: ["ev_01"]
    }],
    tags: ["pdf"],
    topics: ["Agent-led parsing"],
    entities: [],
    warnings: [],
    confidence: "high"
  };
}

function makeVault(): {
  readonly vaultPath: string;
  readonly vaultPort: { current(): VaultSummary; activeVaultPath(): string };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-pdf-tool-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "AgentPdfTool",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-11T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "AgentPdfTool");
  const vault = loadVaultSummary(vaultPath);
  return {
    vaultPath,
    vaultPort: { current: () => vault, activeVaultPath: () => vaultPath }
  };
}

async function preservePdf(
  fixture: ReturnType<typeof makeVault>,
  fileName: string,
  body: string
): Promise<{
  readonly sourceId: string;
  readonly captureJobId: string;
  readonly inputPath: string;
  readonly managedPath: string;
  readonly bytes: Buffer;
}> {
  const inputPath = path.join(path.dirname(fixture.vaultPath), fileName);
  const bytes = createTestPdf([body], fileName);
  fs.writeFileSync(inputPath, bytes);
  const result = await new CaptureService(fixture.vaultPort).submitFiles({
    filePaths: [inputPath],
    inputKind: "file_drop",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = requireValue(result.sourceIds[0]);
  const source = readSource(fixture.vaultPath, sourceId);
  const managedRelativePath = requireValue(source.managedCopy?.path);
  return {
    sourceId,
    captureJobId: requireValue(result.jobIds[0]),
    inputPath,
    managedPath: path.join(fixture.vaultPath, managedRelativePath),
    bytes
  };
}

function hashToolCallId(parentJobId: string, toolCallId: string): string {
  return `sha256:${createHash("sha256")
    .update("pige:pi-tool-call-provenance:v1\0", "utf8")
    .update(parentJobId, "utf8")
    .update("\0", "utf8")
    .update(toolCallId, "utf8")
    .digest("hex")}`;
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function installNetworkTripwire(): { readonly calls: number; restore(): void } {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Unexpected network access in Agent-led PDF test.");
  };
  return {
    get calls() { return calls; },
    restore: () => { globalThis.fetch = originalFetch; }
  };
}

function readSource(vaultPath: string, sourceId: string): SourceRecord {
  return readJsonBySuffix<SourceRecord>(
    path.join(vaultPath, ".pige", "source-records"),
    `${sourceId}.json`
  );
}

function writeSource(vaultPath: string, source: SourceRecord): void {
  const filePath = requireValue(
    listFiles(path.join(vaultPath, ".pige", "source-records"), `${source.id}.json`)[0]
  );
  fs.writeFileSync(filePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
}

function readJob(vaultPath: string, jobId: string): JobRecord {
  return readJsonBySuffix<JobRecord>(
    path.join(vaultPath, ".pige", "jobs"),
    `${jobId}.json`
  );
}

function writeJob(vaultPath: string, job: JobRecord): void {
  const filePath = requireValue(
    listFiles(path.join(vaultPath, ".pige", "jobs"), `${job.id}.json`)[0]
  );
  fs.writeFileSync(filePath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

function readJobs(vaultPath: string): JobRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "jobs"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as JobRecord);
}

function readOperations(vaultPath: string): OperationRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "operations"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as OperationRecord)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function readJsonBySuffix<T>(root: string, suffix: string): T {
  const filePath = requireValue(listFiles(root, suffix)[0]);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function findFileContaining(root: string, marker: string): string {
  for (const filePath of listFiles(root, ".md")) {
    if (fs.readFileSync(filePath, "utf8").includes(marker)) return filePath;
  }
  throw new Error(`Missing Markdown file containing ${marker}.`);
}

function listFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(filePath, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [filePath] : [];
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test value to exist.");
  return value;
}
