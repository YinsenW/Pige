import { describe, expect, it } from "vitest";
import { assertPublicAlphaObservation, derivePublicAlphaReport } from "../../scripts/release/public-alpha-scenario.mjs";

describe("Public Alpha scenario report derivation", () => {
  it("rejects recipe-shaped claims that do not contain observed service identities", () => {
    expect(() => assertPublicAlphaObservation({
      schemaVersion: 1,
      scenarioId: "public-alpha.mixed-25.v1",
      runId: "rel003_invalidclaims0001",
      sourceRecords: Array.from({ length: 25 }, (_, index) => ({ id: `source-${index}`, kind: "text" })),
      sourcePages: [], inputAdoptions: [], jobs: [], parse: { sourceIds: [] }, ocr: { sourceIds: [] },
      restart: { sourceIds: [] }, restore: { sourceIds: [], pageIds: [] }, search: { pageIds: [] }
    })).toThrow();
  });

  it("derives failure from observed state instead of recipe declarations", () => {
    const observation = validObservation();
    observation.restore.sourceIds.pop();
    const report = derivePublicAlphaReport(observation, metadata());
    expect(report.status).toBe("failed");
    expect(report.sourceCounts.total).toBe(25);
    expect(report.checks.find((item: { id: string }) => item.id === "backup_restore")?.status).toBe("failed");
  });
});

function metadata() {
  return { platform: "macos-arm64", buildId: "alpha25", generatedAt: "2026-07-29T00:00:00.000Z", recipeSha256: "a".repeat(64), observationSha256: "b".repeat(64) };
}

function validObservation(): any {
  const kinds = ["text", "url", "markdown_file", "plain_text_file", "pdf_file", "docx_file", "pptx_file",
    "image_file", "csv_file", "xlsx_file", "sqlite_file"];
  const sourceRecords = Array.from({ length: 25 }, (_, index) => ({
    id: `src_20260729_${String(index).padStart(8, "0")}`,
    kind: kinds[index % kinds.length]
  }));
  const sourcePages = sourceRecords.map((_, index) => ({ id: `page_20260729_${String(index).padStart(8, "0")}` }));
  const jobs = Array.from({ length: 10 }, (_, index) => ({
    id: `job_20260729_${String(index).padStart(8, "0")}`,
    state: "completed"
  }));
  return {
    schemaVersion: 1,
    scenarioId: "public-alpha.mixed-25.v1",
    runId: "rel003_validobservation01",
    sourceRecords,
    sourcePages,
    knowledgePageIds: sourcePages.map((item) => item.id),
    inputAdoptions: sourceRecords.map((item, index) => ({
      caseId: `case-${String(index).padStart(2, "0")}`,
      inputKind: ["typed_text", "large_paste", "text_pdf", "image_pdf", "file_picker"][index % 5],
      sourceId: item.id,
      pageId: sourcePages[index].id,
      jobId: jobs[index % jobs.length].id,
      artifactKinds: index < 5 ? ["extracted_text", "metadata"] : index < 7 ? ["ocr", "metadata"] : []
    })),
    jobs,
    parse: { sourceIds: sourceRecords.slice(0, 5).map((item) => item.id), artifactCount: 10, childJobIds: jobs.slice(0, 5).map((item) => item.id) },
    ocr: { sourceIds: sourceRecords.slice(5, 7).map((item) => item.id), artifactCount: 4, childJobIds: jobs.slice(5, 7).map((item) => item.id) },
    homeRetrieval: { status: "completed", conversationId: "conv_20260729_home0001", eventId: "evt_20260729_home0001", jobId: jobs[0].id, citationPageIds: [sourcePages[0].id] },
    noteAgent: { status: "completed", conversationId: "conv_20260729_note0001", eventId: "evt_20260729_note0001", jobId: jobs[1].id },
    selectionAction: { status: "completed", conversationId: "conv_20260729_select01", eventId: "evt_20260729_select01", jobId: jobs[2].id, action: "summarize" },
    autonomousWriteUndo: { writeStatus: "applied", undoStatus: "undone", operationId: "op_20260729_write0001" },
    exceptionalProposal: { status: "completed", conversationId: "conv_20260729_proposal", eventId: "evt_20260729_proposal", jobId: jobs[3].id, proposalId: "proposal_20260729_alpha001", decisionStatus: "rejected" },
    memory: { status: "completed", conversationId: "conv_20260729_memory01", eventId: "evt_20260729_memory01", jobId: jobs[4].id, memoryId: "memory_20260729_alpha001" },
    degradedRecovery: { jobId: jobs[7].id, events: [
      { jobId: jobs[7].id, status: "rejected", observedAt: "2026-07-29T00:00:00.000Z" },
      { jobId: jobs[7].id, status: "completed", observedAt: "2026-07-29T00:00:01.000Z" }
    ] },
    restart: { sourceIds: sourceRecords.map((item) => item.id), duplicateSourceIds: [], duplicateJobIds: [], replayedEffectIds: [], adoptedEffectIds: ["op_20260729_write0001"] },
    backup: { status: "created", sourceCount: 25, fileCount: 75 },
    restore: { status: "restored", sourceVaultId: "vault_source", resultVaultId: "vault_restore", destinationPreviouslyExisted: false, sourceIds: sourceRecords.map((item) => item.id), pageIds: sourcePages.map((item) => item.id), resolvedPageIds: [sourcePages[0].id] },
    search: { status: "completed", mode: "lexical_sqlite_fts", pageIds: [sourcePages[0].id] },
    warnings: ["degraded_source_recovered"]
  };
}
