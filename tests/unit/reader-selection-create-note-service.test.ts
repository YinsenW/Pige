import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReaderSelectionIdentity } from "@pige/contracts";
import type { JobRecord } from "@pige/schemas";
import {
  ReaderSelectionCreateNoteProposalService,
  ReaderSelectionCreateNoteService
} from "../../apps/desktop/src/main/services/reader-selection-create-note-service";
import { readCurrentNoteSelectionEvidenceBinding } from "../../apps/desktop/src/main/services/retrieval-evidence-boundary";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Reader selection create-note service", () => {
  it("creates one bounded note and deterministic reversible Operation", () => {
    const fixture = makeFixture();
    const service = new ReaderSelectionCreateNoteService();
    const result = service.apply(fixture.input);

    expect(result.operation).toMatchObject({
      kind: "create_page",
      jobId: fixture.job.id,
      proposalId: fixture.intent.proposalId,
      modelProfileId: fixture.intent.modelProfileId,
      reversible: "best_effort",
      targetRefs: [{ kind: "page", id: result.pageId, path: result.pagePath }],
      sourceRefs: expect.arrayContaining([
        { kind: "proposal", id: fixture.intent.proposalId },
        { kind: "job", id: fixture.job.id }
      ])
    });
    const markdown = fs.readFileSync(path.join(fixture.vaultPath, result.pagePath), "utf8");
    expect(markdown).toContain('type: "note"');
    expect(markdown).toContain("# A bounded Reader note");
    expect(markdown).toContain("Selected evidence summarized safely.");
    expect(result.operation.after?.id).toBe(`sha256:${createHash("sha256").update(markdown).digest("hex")}`);
  });

  it("adopts a committed page after an interrupted Operation commit without duplicating identities", () => {
    const fixture = makeFixture();
    const service = new ReaderSelectionCreateNoteService();
    const first = service.apply(fixture.input);
    const operationPath = findOperation(fixture.vaultPath);
    fs.rmSync(operationPath);

    const adopted = service.apply(fixture.input);

    expect(adopted).toEqual(first);
    expect(findFiles(path.join(fixture.vaultPath, "wiki/generated"), ".md")).toHaveLength(1);
    expect(findFiles(path.join(fixture.vaultPath, ".pige/operations"), ".json")).toHaveLength(1);
    expect(service.readApplied(fixture.input)).toEqual(first);
  });

  it("fails closed on selection, policy, content, and deterministic identity drift", () => {
    const fixture = makeFixture();
    const service = new ReaderSelectionCreateNoteService();
    expect(() => service.apply({
      ...fixture.input,
      intent: { ...fixture.intent, selection: { ...fixture.selection, selectedContentHash: `sha256:${"c".repeat(64)}` } }
    })).toThrowError(expect.objectContaining({ code: "agent_ingest.page_conflict" }));
    expect(() => service.apply({
      ...fixture.input,
      intent: { ...fixture.intent, policyHash: `sha256:${"d".repeat(64)}` }
    })).toThrowError(expect.objectContaining({ code: "agent_ingest.page_conflict" }));
    expect(() => service.apply({
      ...fixture.input,
      intent: { ...fixture.intent, body: "x".repeat(17 * 1024) }
    })).toThrowError(expect.objectContaining({ code: "agent_ingest.update_content_restricted" }));

    const applied = service.apply(fixture.input);
    fs.writeFileSync(path.join(fixture.vaultPath, applied.pagePath), "DIFFERENT PRIVATE PAGE", "utf8");
    expect(() => service.apply(fixture.input)).toThrowError(expect.objectContaining({ code: "agent_ingest.page_conflict" }));
  });

  it("stages one bounded create-note review and approval returns exact page authority", () => {
    const fixture = makeFixture();
    const resolveReview = vi.fn((input) => input.job);
    const adoptPage = vi.fn();
    const proposals = new ReaderSelectionCreateNoteProposalService(
      { current: () => fixture.vault, activeVaultPath: () => fixture.vaultPath },
      { readAgentTurnJob: () => fixture.job, resolveAgentTurnReview: resolveReview },
      undefined,
      adoptPage
    );
    const preview = proposals.stage({
      job: fixture.job,
      selection: fixture.selection,
      selectedText: "Selected evidence",
      title: fixture.intent.title,
      body: fixture.intent.body,
      modelProfileId: fixture.intent.modelProfileId
    });

    expect(preview).toMatchObject({ action: "create_note", state: "ready", revision: 1 });
    expect(JSON.stringify(preview)).not.toContain(fixture.selection.pageContentHash);
    const applied = proposals.decide({
      apiVersion: 1,
      proposalId: preview.proposalId,
      expectedRevision: preview.revision,
      decision: "approve"
    });
    expect(applied).toMatchObject({
      status: "applied",
      proposal: { action: "create_note", state: "applied" },
      operationId: expect.stringMatching(/^op_/),
      createdPageId: expect.stringMatching(/^page_/)
    });
    expect(resolveReview).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: preview.proposalId,
      result: "completed",
      facts: expect.objectContaining({
        outputRefs: expect.arrayContaining([
          expect.objectContaining({ kind: "page", role: "reader_selection_created_note" })
        ])
      })
    }));
    expect(adoptPage).toHaveBeenCalledWith(fixture.vaultPath);
    expect(proposals.get({ apiVersion: 1, proposalId: preview.proposalId })).toMatchObject({
      status: "available",
      proposal: { state: "applied" }
    });
  });
});

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-reader-create-note-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Reader Create Note",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-29T10:00:00.000Z")
  });
  const vaultPath = path.join(root, "Reader Create Note");
  const vault = loadVaultSummary(vaultPath);
  const markdown = `---
id: "page_20260729_readercreate12"
schema_version: 1
title: "Reader create-note source"
type: "note"
created_at: "2026-07-29T10:00:00.000Z"
updated_at: "2026-07-29T10:00:00.000Z"
status: "active"
language: "en"
source_ids: []
---

Selected evidence for a bounded Reader note.
`;
  const pageBytes = Buffer.from(markdown, "utf8");
  const selectionStart = pageBytes.indexOf(Buffer.from("Selected evidence", "utf8"));
  const selectionEnd = selectionStart + Buffer.byteLength("Selected evidence", "utf8");
  fs.writeFileSync(path.join(vaultPath, "wiki", "reader-create-note-source.md"), markdown, "utf8");
  const selection: ReaderSelectionIdentity = {
    pageId: "page_20260729_readercreate12",
    pageContentHash: `sha256:${createHash("sha256").update(pageBytes).digest("hex")}`,
    span: { unit: "utf8_bytes", start: selectionStart, endExclusive: selectionEnd },
    selectedContentHash: `sha256:${createHash("sha256").update(pageBytes.subarray(selectionStart, selectionEnd)).digest("hex")}`
  };
  const selectionBinding = readCurrentNoteSelectionEvidenceBinding(vaultPath, selection);
  const job = {
    id: "job_20260729_readercreate12",
    schemaVersion: 1,
    class: "agent_turn",
    state: "awaiting_review",
    activeVaultId: vault.vaultId,
    createdAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:00:01.000Z",
    actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    policyContextId: "policy_reader_create_note",
    policyHash: `sha256:${"e".repeat(64)}`,
    message: "Reader create-note proposal is awaiting review.",
    inputRefs: [
      { kind: "page", id: selection.pageId, checksum: selectionBinding.bindingHash, role: "agent_turn_current_note_scope" },
      {
        kind: "page",
        id: selection.pageId,
        checksum: selection.selectedContentHash,
        locator: `utf8_bytes:${selectionStart}:${selectionEnd}`,
        role: "agent_turn_reader_selection"
      },
      {
        kind: "tool",
        id: "reader_selection_create_note",
        checksum: selection.pageContentHash,
        role: "agent_turn_reader_create_note"
      }
    ]
  } as JobRecord;
  const intent = {
    proposalId: "proposal_20260729_readercreate12",
    selection,
    title: "A bounded Reader note",
    body: "Selected evidence summarized safely.",
    modelProfileId: "model_reader_create",
    policyContextId: job.policyContextId!,
    policyHash: job.policyHash!
  };
  return { root, vaultPath, vault, selection, job, intent, input: { vaultPath, job, intent } };
}

function findOperation(vaultPath: string): string {
  return findFiles(path.join(vaultPath, ".pige/operations"), ".json")[0]!;
}

function findFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? findFiles(target, suffix) : entry.name.endsWith(suffix) ? [target] : [];
  });
}
