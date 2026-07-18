import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";
import type { JobRecord, OperationRecord } from "@pige/schemas";
import { ReaderSelectionProposalService } from "../../apps/desktop/src/main/services/reader-selection-proposal-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Reader selection proposal service", () => {
  it("projects only bounded safe preview lines and keeps private mutation identity out of the DTO", () => {
    const fixture = makeFixture();
    const service = makeService(fixture);
    const preview = service.stage({
      job: fixture.job,
      action: "expand",
      selection: fixture.selection,
      selectedText: "SECRET_SELECTED_LINE\nsecond removed line\nthird\nfourth\nfifth",
      replacement: Array.from({ length: 12 }, (_, index) => `replacement line ${index} ${"x".repeat(200)}`).join("\n")
    });

    expect(preview.state).toBe("ready");
    expect(preview.lines).toHaveLength(8);
    expect(preview.lines.every((line) => line.text.length <= 160)).toBe(true);
    const projected = JSON.stringify(preview);
    expect(projected).not.toContain("pageContentHash");
    expect(projected).not.toContain("selectedContentHash");
    expect(projected).not.toContain("span");
    expect(projected).not.toContain("wiki/");
    expect(projected).not.toContain(fixture.job.id);
  });

  it("rejects without invoking the writer and resolves the exact awaiting-review Job", () => {
    const fixture = makeFixture();
    const { service, writer, resolveReview } = makeServiceWithPorts(fixture);
    const preview = stage(service, fixture);

    const result = service.decide({
      apiVersion: 1,
      proposalId: preview.proposalId,
      expectedRevision: preview.revision,
      decision: "reject"
    });

    expect(result).toMatchObject({ status: "rejected", proposal: { state: "rejected", revision: 2 } });
    expect(writer).not.toHaveBeenCalled();
    expect(resolveReview).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: preview.proposalId,
      result: "completed"
    }));
  });

  it("approves through the single confined writer and returns only the Operation identity", () => {
    const fixture = makeFixture();
    const { service, writer, resolveReview } = makeServiceWithPorts(fixture);
    const preview = stage(service, fixture);

    const result = service.decide({
      apiVersion: 1,
      proposalId: preview.proposalId,
      expectedRevision: preview.revision,
      decision: "approve"
    });

    expect(result).toMatchObject({
      status: "applied",
      operationId: "op_20260718_readerreview",
      proposal: { state: "applied", revision: 3 }
    });
    expect(writer).toHaveBeenCalledOnce();
    expect(resolveReview).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: preview.proposalId,
      result: "completed",
      message: "The Reader selection review was resolved.",
      facts: {
        stage: "planning",
        outputRefs: [{
          kind: "operation",
          id: "op_20260718_readerreview",
          role: "reader_selection_transform_operation"
        }],
        operationIds: ["op_20260718_readerreview"]
      }
    }));
    if (result.status !== "applied") throw new Error("Expected an applied proposal result.");
    expect(result.proposal.lines.every((line) => line.text.length <= 160)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("replacement\":");
  });

  it("keeps a durable apply authoritative when parent Job reconciliation is interrupted", () => {
    const fixture = makeFixture();
    const { service, writer, resolveReview } = makeServiceWithPorts(fixture);
    resolveReview.mockImplementationOnce(() => {
      throw new Error("INTERRUPTED JOB COMMIT");
    });
    const preview = stage(service, fixture);

    const result = service.decide({
      apiVersion: 1,
      proposalId: preview.proposalId,
      expectedRevision: preview.revision,
      decision: "approve"
    });

    expect(result).toMatchObject({
      status: "applied",
      operationId: "op_20260718_readerreview",
      proposal: { state: "applied", revision: 3 }
    });
    expect(writer).toHaveBeenCalledOnce();
    expect(service.get({ apiVersion: 1, proposalId: preview.proposalId })).toMatchObject({
      status: "available",
      proposal: { state: "applied", revision: 3 }
    });
    expect(writer).toHaveBeenCalledOnce();
    expect(resolveReview).toHaveBeenCalledTimes(2);
  });

  it("keeps a durable rejection authoritative when parent Job reconciliation is interrupted", () => {
    const fixture = makeFixture();
    const { service, writer, resolveReview } = makeServiceWithPorts(fixture);
    resolveReview.mockImplementationOnce(() => {
      throw new Error("INTERRUPTED JOB COMMIT");
    });
    const preview = stage(service, fixture);

    const result = service.decide({
      apiVersion: 1,
      proposalId: preview.proposalId,
      expectedRevision: preview.revision,
      decision: "reject"
    });

    expect(result).toMatchObject({ status: "rejected", proposal: { state: "rejected", revision: 2 } });
    expect(writer).not.toHaveBeenCalled();
    expect(service.get({ apiVersion: 1, proposalId: preview.proposalId })).toMatchObject({
      status: "available",
      proposal: { state: "rejected", revision: 2 }
    });
    expect(resolveReview).toHaveBeenCalledTimes(2);
  });

  it("fences stale decisions and converges writer conflicts to one body-free conflicted projection", () => {
    const fixture = makeFixture();
    const resolveReview = vi.fn((input) => input.job);
    const service = new ReaderSelectionProposalService(fixture.vaults, {
      readAgentTurnJob: () => fixture.job,
      resolveAgentTurnReview: resolveReview
    }, {
      apply: () => {
        throw new PigeDomainError("agent_ingest.page_conflict", "PRIVATE CURRENT PAGE BYTES");
      }
    });
    const preview = stage(service, fixture);
    expect(service.decide({
      apiVersion: 1,
      proposalId: preview.proposalId,
      expectedRevision: preview.revision + 1,
      decision: "approve"
    })).toMatchObject({ status: "stale", proposal: { revision: 1 } });

    const conflicted = service.decide({
      apiVersion: 1,
      proposalId: preview.proposalId,
      expectedRevision: preview.revision,
      decision: "approve"
    });
    expect(conflicted).toMatchObject({ status: "conflicted", proposal: { state: "conflicted" } });
    expect(JSON.stringify(conflicted)).not.toContain("PRIVATE CURRENT PAGE BYTES");
    expect(resolveReview).toHaveBeenCalledWith(expect.objectContaining({
      result: "failed_final",
      error: expect.objectContaining({ code: "agent_runtime.proposal_conflicted" })
    }));
  });

  it("rejects a symlinked private proposal directory", () => {
    const fixture = makeFixture();
    const outside = path.join(fixture.root, "outside");
    fs.mkdirSync(outside);
    const privateDirectory = path.join(fixture.vaultPath, ".pige", "reader-selection-proposals");
    fs.symlinkSync(outside, privateDirectory, "dir");
    const service = makeService(fixture);
    expect(() => stage(service, fixture)).toThrowError(PigeDomainError);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("projects corrupted decision records as one body-free failure", () => {
    const fixture = makeFixture();
    const service = makeService(fixture);
    const preview = stage(service, fixture);
    const proposalFile = path.join(
      fixture.vaultPath,
      ".pige",
      "reader-selection-proposals",
      `${preview.proposalId}.json`
    );
    fs.writeFileSync(proposalFile, "PRIVATE INVALID PROPOSAL BYTES", "utf8");

    const result = service.decide({
      apiVersion: 1,
      proposalId: preview.proposalId,
      expectedRevision: preview.revision,
      decision: "approve"
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "agent_runtime.proposal_decision_failed", messageKey: "error.generic" }
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE INVALID PROPOSAL BYTES");
  });

  it("rejects restricted replacement bytes before creating a renderer-safe preview", () => {
    const fixture = makeFixture();
    const service = makeService(fixture);
    expect(() => service.stage({
      job: fixture.job,
      action: "expand",
      selection: fixture.selection,
      selectedText: "selected",
      replacement: String.raw`\\server\private\replacement`
    })).toThrowError(expect.objectContaining({ code: "agent_ingest.update_content_restricted" }));
    expect(fs.existsSync(path.join(
      fixture.vaultPath,
      ".pige",
      "reader-selection-proposals"
    ))).toBe(false);
  });

  it("recovers an interrupted resolving proposal idempotently through the same writer", () => {
    const fixture = makeFixture();
    const { service, writer, resolveReview } = makeServiceWithPorts(fixture);
    const preview = stage(service, fixture);
    const proposalFile = path.join(
      fixture.vaultPath,
      ".pige",
      "reader-selection-proposals",
      `${preview.proposalId}.json`
    );
    const record = JSON.parse(fs.readFileSync(proposalFile, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(proposalFile, `${JSON.stringify({
      ...record,
      state: "resolving",
      revision: 2,
      updatedAt: "2026-07-18T12:00:01.000Z"
    }, null, 2)}\n`, "utf8");

    const recovered = service.get({ apiVersion: 1, proposalId: preview.proposalId });

    expect(recovered).toMatchObject({
      status: "available",
      proposal: { state: "applied", revision: 3 }
    });
    expect(writer).toHaveBeenCalledOnce();
    expect(resolveReview).toHaveBeenCalledWith(expect.objectContaining({
      message: "The Reader selection review was resolved.",
      facts: expect.objectContaining({
        operationIds: ["op_20260718_readerreview"]
      })
    }));
  });
});

function stage(service: ReaderSelectionProposalService, fixture: ReturnType<typeof makeFixture>) {
  return service.stage({
    job: fixture.job,
    action: "expand",
    selection: fixture.selection,
    selectedText: "selected",
    replacement: "PRIVATE_REPLACEMENT ".repeat(400)
  });
}

function makeService(fixture: ReturnType<typeof makeFixture>): ReaderSelectionProposalService {
  return makeServiceWithPorts(fixture).service;
}

function makeServiceWithPorts(fixture: ReturnType<typeof makeFixture>) {
  const resolveReview = vi.fn((input) => input.job);
  const writer = vi.fn(() => ({ id: "op_20260718_readerreview" }) as OperationRecord);
  return {
    service: new ReaderSelectionProposalService(fixture.vaults, {
      readAgentTurnJob: () => fixture.job,
      resolveAgentTurnReview: resolveReview
    }, { apply: writer }),
    writer,
    resolveReview
  };
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-reader-proposal-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Reader Proposal",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-18T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Reader Proposal");
  const vault = loadVaultSummary(vaultPath);
  const selected = Buffer.from("selected", "utf8");
  const selection = {
    pageId: "page_20260718_readerreview",
    pageContentHash: `sha256:${"a".repeat(64)}`,
    span: { unit: "utf8_bytes" as const, start: 100, endExclusive: 100 + selected.length },
    selectedContentHash: `sha256:${createHash("sha256").update(selected).digest("hex")}`
  };
  const job = {
    id: "job_20260718_readerreview",
    class: "agent_turn",
    state: "awaiting_review",
    activeVaultId: vault.vaultId
  } as JobRecord;
  return {
    root,
    vaultPath,
    vaults: { current: () => vault, activeVaultPath: () => vaultPath },
    selection,
    job
  };
}
