import { describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord, type SourceRecord } from "@pige/schemas";
import {
  DocumentParseJobExecutor,
  type ActiveDocumentParseJob,
  type QueuedDocumentParseJob
} from "../../apps/desktop/src/main/services/document-parse-job-executor";
import type { DocumentParserPort } from "../../apps/desktop/src/main/services/document-parser-service";
import type { JobExecutionControl } from "../../apps/desktop/src/main/services/job-execution-control";

describe("DocumentParseJobExecutor", () => {
  it("owns parse execution while projecting compatibility scheduling through its port", async () => {
    const fixture = makeQueuedParseJob();
    const parseSource = vi.fn<DocumentParserPort["parseSource"]>(async () => parseResult());
    fixture.prepareFollowUp.mockReturnValue({
      agentReadySourceId: fixture.source.id
    });
    const executor = new DocumentParseJobExecutor({ canParse: () => true, parseSource }, {
      queued: () => [fixture.candidate]
    });

    await expect(executor.process()).resolves.toEqual({
      processed: 1,
      completed: 1,
      failed: 0,
      agentReadySourceIds: [fixture.source.id],
      ocrWaitingSourceIds: []
    });
    expect(parseSource).toHaveBeenCalledWith(
      "/vault-a",
      fixture.source,
      "/vault-a/.pige/source-records/source.json",
      fixture.job,
      fixture.control
    );
    expect(fixture.complete).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: fixture.source.id }),
      "completed",
      "PDF text extracted (42 characters, high coverage)."
    );
    expect(fixture.finish).toHaveBeenCalledOnce();
  });

  it("keeps background startup barriers in the queued owner", async () => {
    const parseSource = vi.fn<DocumentParserPort["parseSource"]>();
    const executor = new DocumentParseJobExecutor({ canParse: () => true, parseSource }, {
      queued: () => []
    });

    await expect(executor.process()).resolves.toEqual({
      processed: 0,
      completed: 0,
      failed: 0,
      agentReadySourceIds: [],
      ocrWaitingSourceIds: []
    });
    expect(parseSource).not.toHaveBeenCalled();
  });

  it("settles missing sources and unavailable parsers before execution", async () => {
    const missing = makeQueuedParseJob({ source: false });
    const unavailable = makeQueuedParseJob();
    let queuedCall = 0;
    const executor = new DocumentParseJobExecutor(undefined, {
      queued: () => queuedCall++ === 0 ? [missing.candidate] : [unavailable.candidate]
    });

    await expect(executor.process()).resolves.toMatchObject({ failed: 1 });
    await expect(executor.process()).resolves.toMatchObject({ failed: 1 });
    expect(missing.failMissingSource).toHaveBeenCalledWith(
      "Source record is missing. Preserved parse job remains retryable."
    );
    expect(unavailable.waitForParser).toHaveBeenCalledWith(
      "Waiting for a bundled local parser that supports this document type."
    );
    expect(missing.begin).not.toHaveBeenCalled();
    expect(unavailable.begin).not.toHaveBeenCalled();
  });

  it("keeps parser failures body-free and always releases execution ownership", async () => {
    const fixture = makeQueuedParseJob();
    const failure = new PigeDomainError("source.external_unavailable", "/private/source.pdf");
    const executor = new DocumentParseJobExecutor({
      canParse: () => true,
      parseSource: async () => { throw failure; }
    }, { queued: () => [fixture.candidate] });

    await expect(executor.process()).resolves.toMatchObject({ failed: 1 });
    expect(fixture.fail).toHaveBeenCalledWith(failure, {
      final: false,
      waiting: true,
      message: "The referenced original PDF is unavailable. Reconnect it before retrying this job."
    });
    expect(fixture.finish).toHaveBeenCalledOnce();
  });

  it("fails closed when the queued vault binding loses its lease before begin", async () => {
    const fixture = makeQueuedParseJob();
    const bindingFailure = new PigeDomainError("vault.binding_changed", "private vault detail");
    fixture.begin.mockImplementation(() => { throw bindingFailure; });
    const parseSource = vi.fn<DocumentParserPort["parseSource"]>();
    const executor = new DocumentParseJobExecutor({ canParse: () => true, parseSource }, {
      queued: () => [fixture.candidate]
    });

    await expect(executor.process()).rejects.toBe(bindingFailure);
    expect(parseSource).not.toHaveBeenCalled();
    expect(fixture.finish).not.toHaveBeenCalled();
  });
});

function parseResult() {
  return {
    sourceId: "src_20260726_parse001",
    created: true,
    extractedTextArtifactPath: "artifacts/extracted-text/parse.txt",
    metadataArtifactPath: "artifacts/metadata/parse.json",
    textCharacterCount: 42,
    textCoverage: "high" as const,
    needsOcr: false,
    agentTextReady: true,
    warnings: [],
    sourcePageUpdated: true,
    sourcePageConflict: false,
    durableEffect: {
      outputRefs: [{
        kind: "artifact" as const,
        id: "art_20260726_parse001_pdf_text",
        path: "artifacts/extracted-text/parse.txt",
        checksum: `sha256:${"a".repeat(64)}`,
        role: "parser_extracted_text"
      }],
      operationIds: ["op_20260726_parse001"]
    }
  };
}

function makeQueuedParseJob(options: { readonly source?: boolean } = {}) {
  const job = JobRecordSchema.parse({
    id: "job_20260726_parse001",
    class: "parse",
    state: "queued",
    sourceId: "src_20260726_parse001",
    createdAt: "2026-07-26T04:00:00.000Z",
    updatedAt: "2026-07-26T04:00:00.000Z",
    message: "Queued."
  });
  const source = {
    schemaVersion: 1,
    id: "src_20260726_parse001",
    kind: "pdf_file",
    storageStrategy: "copy_to_source_library",
    managedCopy: {
      pathBasis: "vault_relative",
      path: "raw/files/2026/07/source.pdf",
      checksum: `sha256:${"b".repeat(64)}`,
      size: 12
    },
    artifacts: [],
    metadata: {},
    createdAt: "2026-07-26T04:00:00.000Z",
    updatedAt: "2026-07-26T04:00:00.000Z"
  } as SourceRecord;
  const control: JobExecutionControl = {
    signal: new AbortController().signal,
    throwIfCancellationRequested: vi.fn(),
    reportProgress: vi.fn(),
    markDurableCheckpoint: vi.fn(),
    durableWriteState: () => ({ durableWritesApplied: false })
  };
  const prepareFollowUp = vi.fn(() => ({}));
  const complete = vi.fn(() => ({ ...job, state: "completed" as const }));
  const fail = vi.fn();
  const finish = vi.fn();
  const active: ActiveDocumentParseJob = { job, control, prepareFollowUp, complete, fail, finish };
  const failMissingSource = vi.fn();
  const waitForParser = vi.fn();
  const begin = vi.fn(() => active);
  const candidate: QueuedDocumentParseJob = {
    job,
    vaultPath: "/vault-a",
    ...(options.source === false ? {} : {
      source: { path: "/vault-a/.pige/source-records/source.json", record: source }
    }),
    failMissingSource,
    waitForParser,
    begin
  };
  return { job, source, candidate, control, prepareFollowUp, complete, fail, finish, failMissingSource, waitForParser, begin };
}
