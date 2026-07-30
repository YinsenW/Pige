import { createHash } from "node:crypto";
import type { ReaderSelectionCreatePageAction } from "@pige/contracts";
import { parsePigeFrontmatter } from "@pige/markdown";
import { OperationRecordSchema, type JobRecord, type OperationRecord } from "@pige/schemas";
import { readerSelectionContentRestricted } from "./reader-selection-proposal-service";

const MAX_PAGE_BYTES = 32 * 1024;

export function readerSelectionPageType(
  action: ReaderSelectionCreatePageAction
): "note" | "claim" | "question" {
  return action === "create_claim" ? "claim" : action === "create_question" ? "question" : "note";
}

export function createReaderSelectionPageMarkdown(input: {
  readonly action: ReaderSelectionCreatePageAction;
  readonly pageId: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly jobId: string;
  readonly modelProfileId: string;
}): string {
  const pageType = readerSelectionPageType(input.action);
  const typeFields = pageType === "claim"
    ? 'claim:\n  confidence: "medium"\n  evidence: []\n  contradicts: []'
    : pageType === "question"
      ? 'question:\n  state: "open"\n  answered_by: []'
      : 'note:\n  note_kind: "summary"\n  review_state: "clean"';
  const status = pageType === "claim" ? "needs_review" : "active";
  const markdown = `---\nid: ${JSON.stringify(input.pageId)}\nschema_version: 1\ntitle: ${JSON.stringify(input.title)}\ntype: ${JSON.stringify(pageType)}\ncreated_at: ${JSON.stringify(input.createdAt)}\nupdated_at: ${JSON.stringify(input.createdAt)}\nstatus: ${JSON.stringify(status)}\nlanguage: "und"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: []\nrelated_page_ids: []\nprovenance:\n  generated_by: "pige"\n  last_job_id: ${JSON.stringify(input.jobId)}\n  model_profile_id: ${JSON.stringify(input.modelProfileId)}\n  confidence: "high"\n${typeFields}\n---\n\n# ${escapeHeading(input.title)}\n\n${input.body}\n`;
  if (Buffer.byteLength(markdown, "utf8") > MAX_PAGE_BYTES || !parsePigeFrontmatter(markdown)) {
    throw readerSelectionContentRestricted("The generated Reader page is invalid.");
  }
  return markdown;
}

export function createReaderSelectionPageOperation(input: {
  readonly action: ReaderSelectionCreatePageAction;
  readonly operationId: string;
  readonly job: JobRecord;
  readonly proposalId: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
  readonly contentHash: string;
  readonly modelProfileId: string;
  readonly policyContextId: string;
  readonly policyHash: string;
}): OperationRecord {
  const pageType = readerSelectionPageType(input.action);
  return OperationRecordSchema.parse({
    id: input.operationId,
    schemaVersion: 1,
    jobId: input.job.id,
    proposalId: input.proposalId,
    createdAt: input.job.createdAt,
    actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    modelProfileId: input.modelProfileId,
    policyAudit: {
      policyContextId: input.policyContextId,
      policyHash: input.policyHash,
      enforcementOwners: [
        input.action === "create_note" ? "Reader Selection Create Note Service" : "Reader Selection Create Page Service",
        "Proposal Service",
        "Vault Service"
      ]
    },
    kind: "create_page",
    targetRefs: [{ kind: "page", id: input.pageId, path: input.pagePath }],
    sourceRefs: [
      { kind: "proposal", id: input.proposalId },
      { kind: "job", id: input.job.id }
    ],
    after: { kind: "page", id: input.contentHash, path: input.pagePath },
    summary: input.action === "create_note"
      ? `Created note ${JSON.stringify(input.title)} from an approved Reader selection.`
      : `Created ${pageType} ${JSON.stringify(input.title)} from an approved Reader selection.`,
    reversible: "best_effort",
    rollbackHint: `Move the generated ${pageType} to trash after verifying that it has not changed.`,
    warnings: []
  });
}

export function hashReaderSelectionPage(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function escapeHeading(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|>~-])/gu, "\\$1");
}
