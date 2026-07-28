import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { ReaderSelectionIdentity } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { extractPigeMarkdownLinkRefs, parsePigeFrontmatter } from "@pige/markdown";
import {
  JobRecordSchema,
  OperationRecordSchema,
  PageIdSchema,
  SourceIdSchema,
  type JobRecord,
  type OperationRecord
} from "@pige/schemas";
import {
  createAgentPageRelationshipOperationId,
  createAgentPageUpdateBeforePath,
  createAgentPageUpdateStagedPath,
  MAX_AGENT_PAGE_UPDATE_BYTES
} from "./agent-page-update-service";
import {
  createGeneratedNoteExclusive,
  readGeneratedNoteExact,
  removeGeneratedNoteExact,
  replaceGeneratedNoteExact
} from "./generated-note-file";
import { readReaderSelectionLinkBinding } from "./reader-selection-job-binding";
import type { CurrentRetrievalPageMutationBinding } from "./retrieval-evidence-boundary";

interface ReaderSelectionLinkResult {
  readonly operation: OperationRecord;
  readonly currentPageId: string;
  readonly targetPageId: string;
}

interface EligiblePage {
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly contentHash: string;
  readonly markdown: string;
}

export function applyReaderSelectionLink(input: {
  readonly vaultPath: string;
  readonly job: JobRecord;
  readonly selection: ReaderSelectionIdentity;
  readonly currentPage: CurrentRetrievalPageMutationBinding;
  readonly targetPage: CurrentRetrievalPageMutationBinding;
}): ReaderSelectionLinkResult {
  const job = requireLinkJob(input.job, input.selection);
  const current = requireCurrentEligiblePage(input.vaultPath, input.currentPage);
  const target = requireCurrentEligiblePage(input.vaultPath, input.targetPage);
  if (current.pageId !== input.selection.pageId) {
    throw pageConflict("The Reader link source does not match its exact selection.");
  }
  if (current.pageId === target.pageId) {
    throw new PigeDomainError(
      "agent_runtime.link_target_self",
      "A Reader link requires two different current notes."
    );
  }

  const operationId = createAgentPageRelationshipOperationId(job.id, current.pageId, target.pageId);
  const beforePath = createAgentPageUpdateBeforePath(operationId);
  const stagedPath = createAgentPageUpdateStagedPath(operationId);
  const preservedBefore = readPrivate(input.vaultPath, beforePath) ?? current.markdown;
  if (hashText(preservedBefore) !== input.selection.pageContentHash) {
    throw pageConflict("The Reader link before-image no longer matches its selection identity.");
  }
  const beforePage = requireEligibleMarkdown(preservedBefore, current.pageId, current.pagePath);
  assertExactSelection(preservedBefore, input.selection);
  if (hasDirectedLink(preservedBefore, current.pagePath, target)) {
    throw new PigeDomainError(
      "agent_runtime.link_target_exists",
      "The selected notes already have this stable directed link."
    );
  }

  const after = createLinkedMarkdown(
    preservedBefore,
    target,
    operationId,
    monotonicTimestamp(beforePage.updatedAt, job.createdAt)
  );
  requireEligibleMarkdown(after, current.pageId, current.pagePath, operationId);
  assertLinkTransition(preservedBefore, after, target.pageId, operationId);
  const afterHash = hashText(after);
  const operation = createLinkOperation({
    operationId,
    job,
    selection: input.selection,
    current,
    target,
    beforePath,
    afterHash
  });
  const existing = readExactOperation(input.vaultPath, operation);
  if (existing) return result(existing, current.pageId, target.pageId);

  stageExact(input.vaultPath, beforePath, preservedBefore, input.selection.pageContentHash);
  stageExact(input.vaultPath, stagedPath, after, afterHash);
  requireCurrentEligiblePage(input.vaultPath, input.targetPage);
  const live = requireLive(input.vaultPath, current.pagePath);
  const liveHash = hashText(live);
  if (liveHash === input.selection.pageContentHash) {
    replaceGeneratedNoteExact(
      input.vaultPath,
      resolveVaultPath(input.vaultPath, current.pagePath),
      resolveVaultPath(input.vaultPath, stagedPath),
      {
        beforeHash: input.selection.pageContentHash,
        afterHash,
        maximumBytes: MAX_AGENT_PAGE_UPDATE_BYTES
      }
    );
  } else if (liveHash !== afterHash) {
    throw pageConflict("The Reader link source changed before publication.");
  }
  const committed = commitOperation(input.vaultPath, operation);
  removeGeneratedNoteExact(
    input.vaultPath,
    resolveVaultPath(input.vaultPath, stagedPath),
    afterHash,
    MAX_AGENT_PAGE_UPDATE_BYTES
  );
  return result(committed, current.pageId, target.pageId);
}

export function readReaderSelectionLinkOperation(input: {
  readonly vaultPath: string;
  readonly job: JobRecord;
  readonly selection: ReaderSelectionIdentity;
  readonly targetPage: CurrentRetrievalPageMutationBinding;
}): ReaderSelectionLinkResult | undefined {
  const job = requireLinkJob(input.job, input.selection);
  const target = requireCurrentEligiblePage(input.vaultPath, input.targetPage);
  if (target.pageId === input.selection.pageId) {
    throw new PigeDomainError(
      "agent_runtime.link_target_self",
      "A Reader link requires two different current notes."
    );
  }
  const operationId = createAgentPageRelationshipOperationId(
    job.id,
    input.selection.pageId,
    target.pageId
  );
  const beforePath = createAgentPageUpdateBeforePath(operationId);
  const before = readPrivate(input.vaultPath, beforePath);
  if (before === undefined || hashText(before) !== input.selection.pageContentHash) return undefined;
  const current = requireEligibleMarkdown(before, input.selection.pageId, generatedPagePath(input.selection.pageId));
  assertExactSelection(before, input.selection);
  const after = createLinkedMarkdown(
    before,
    target,
    operationId,
    monotonicTimestamp(current.updatedAt, job.createdAt)
  );
  const expected = createLinkOperation({
    operationId,
    job,
    selection: input.selection,
    current,
    target,
    beforePath,
    afterHash: hashText(after)
  });
  const operation = readExactOperation(input.vaultPath, expected);
  return operation ? result(operation, current.pageId, target.pageId) : undefined;
}

function requireLinkJob(jobValue: JobRecord, selection: ReaderSelectionIdentity): JobRecord {
  const job = JobRecordSchema.parse(jobValue);
  const binding = readReaderSelectionLinkBinding(job);
  if (
    job.class !== "agent_turn" ||
    !["queued", "running", "completed", "completed_with_warnings"].includes(job.state) ||
    !binding ||
    !isDeepStrictEqual(binding.selection, selection)
  ) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "The Reader link Job does not bind this exact selection action."
    );
  }
  return job;
}

function requireCurrentEligiblePage(
  vaultPath: string,
  binding: CurrentRetrievalPageMutationBinding
): EligiblePage {
  const summary = binding.item.summary;
  const pagePath = generatedPagePath(summary.pageId);
  if (
    summary.pageType !== "note" ||
    summary.status !== "active" ||
    summary.pagePath !== pagePath ||
    binding.page.pageId !== summary.pageId ||
    binding.page.updatedAt !== summary.updatedAt ||
    binding.page.contentHash !== hashText(binding.markdown) ||
    path.resolve(binding.absolutePath) !== resolveVaultPath(vaultPath, pagePath) ||
    requireLive(vaultPath, pagePath) !== binding.markdown
  ) {
    throw pageConflict("The Reader link page binding is no longer current.");
  }
  return requireEligibleMarkdown(binding.markdown, summary.pageId, pagePath, undefined, {
    title: summary.title,
    updatedAt: summary.updatedAt
  });
}

function requireEligibleMarkdown(
  markdown: string,
  pageId: string,
  pagePath: string,
  expectedOperationId?: string,
  expected?: { readonly title: string; readonly updatedAt: string }
): EligiblePage {
  const parsed = parsePigeFrontmatter(markdown);
  const related = parsed ? readInlineArray(parsed.raw, "related_page_ids", 64) : undefined;
  const sources = parsed ? readInlineArray(parsed.raw, "source_ids", 64) : undefined;
  const title = parsed?.frontmatter.title;
  const updatedAt = parsed?.frontmatter.updated_at;
  if (
    !parsed ||
    !markdown.startsWith("---\n") ||
    Buffer.byteLength(markdown, "utf8") > MAX_AGENT_PAGE_UPDATE_BYTES ||
    markdown.includes("\0") ||
    parsed.frontmatter.id !== pageId ||
    parsed.frontmatter.type !== "note" ||
    parsed.frontmatter.status !== "active" ||
    typeof title !== "string" || !title.trim() ||
    typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt)) ||
    (expected && (title !== expected.title || updatedAt !== expected.updatedAt)) ||
    readNestedScalar(parsed.raw, "provenance", "generated_by") !== "pige" ||
    readNestedScalar(parsed.raw, "note", "review_state") !== "clean" ||
    !related || related.some((id) => !PageIdSchema.safeParse(id).success) ||
    !sources || sources.some((id) => !SourceIdSchema.safeParse(id).success) ||
    markdown.slice(parsed.bodyStartOffset).trim().length === 0 ||
    !hasBalancedManagedBlocks(markdown) ||
    (expectedOperationId &&
      !markdown.includes(`<!-- pige:managed:start agent-link ${expectedOperationId} -->`))
  ) {
    throw new PigeDomainError(
      "agent_runtime.link_target_changed",
      "Reader links require clean active Pige-generated notes."
    );
  }
  return {
    pageId,
    pagePath,
    title,
    updatedAt,
    contentHash: hashText(markdown),
    markdown
  };
}

function createLinkedMarkdown(
  before: string,
  target: EligiblePage,
  operationId: string,
  updatedAt: string
): string {
  const parsed = parsePigeFrontmatter(before);
  if (!parsed) throw pageConflict("The Reader link source frontmatter is invalid.");
  const related = readInlineArray(parsed.raw, "related_page_ids", 64);
  if (!related || related.length >= 64) throw pageConflict("The Reader link source has no relationship slot.");
  let raw = replaceUniqueLine(parsed.raw, "updated_at", JSON.stringify(updatedAt));
  raw = replaceUniqueLine(raw, "related_page_ids", JSON.stringify([...related, target.pageId]));
  const rawStart = before.indexOf("\n") + 1;
  const withFrontmatter = `${before.slice(0, rawStart)}${raw}${before.slice(rawStart + parsed.raw.length)}`;
  const separator = withFrontmatter.endsWith("\n") ? "\n" : "\n\n";
  const label = target.title
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\\/gu, "\\\\")
    .replace(/\]/gu, "\\]")
    .replace(/\s+/gu, " ")
    .trim();
  return `${withFrontmatter}${separator}<!-- pige:managed:start agent-link ${operationId} -->
## Related

- [${label}](#wiki:${encodeURIComponent(target.pageId)})
<!-- pige:managed:end -->
`;
}

function assertLinkTransition(
  before: string,
  after: string,
  targetPageId: string,
  operationId: string
): void {
  const beforeParsed = parsePigeFrontmatter(before);
  const afterParsed = parsePigeFrontmatter(after);
  if (!beforeParsed || !afterParsed) throw pageConflict("The Reader link transition is invalid.");
  const updatedAt = afterParsed.frontmatter.updated_at;
  const related = readInlineArray(afterParsed.raw, "related_page_ids", 64);
  let expectedRaw = replaceUniqueLine(beforeParsed.raw, "updated_at", JSON.stringify(updatedAt));
  expectedRaw = replaceUniqueLine(
    expectedRaw,
    "related_page_ids",
    JSON.stringify([...(readInlineArray(beforeParsed.raw, "related_page_ids", 64) ?? []), targetPageId])
  );
  const rawStart = before.indexOf("\n") + 1;
  const expectedPrefix = `${before.slice(0, rawStart)}${expectedRaw}${before.slice(rawStart + beforeParsed.raw.length)}`;
  if (
    !related?.includes(targetPageId) ||
    afterParsed.frontmatter.source_ids?.join("\0") !== beforeParsed.frontmatter.source_ids?.join("\0") ||
    !after.startsWith(`${expectedPrefix}${expectedPrefix.endsWith("\n") ? "\n" : "\n\n"}`) ||
    !after.endsWith("<!-- pige:managed:end -->\n") ||
    !after.includes(`<!-- pige:managed:start agent-link ${operationId} -->`) ||
    !after.includes(`](#wiki:${encodeURIComponent(targetPageId)})`)
  ) {
    throw pageConflict("The Reader link changed bytes outside its bounded relationship fields.");
  }
}

function createLinkOperation(input: {
  readonly operationId: string;
  readonly job: JobRecord;
  readonly selection: ReaderSelectionIdentity;
  readonly current: EligiblePage;
  readonly target: EligiblePage;
  readonly beforePath: string;
  readonly afterHash: string;
}): OperationRecord {
  const artifact = createSelectionArtifact(input.job.id, input.selection);
  return OperationRecordSchema.parse({
    id: input.operationId,
    schemaVersion: 1,
    jobId: input.job.id,
    createdAt: input.job.createdAt,
    actor: {
      kind: "pige_agent",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    kind: "update_page",
    targetRefs: [{ kind: "page", id: input.current.pageId, path: input.current.pagePath }],
    sourceRefs: [
      { kind: "job", id: input.job.id },
      { kind: "artifact", id: artifact.id, checksum: artifact.checksum },
      {
        kind: "page",
        id: input.target.pageId,
        path: input.target.pagePath,
        checksum: input.target.contentHash
      }
    ],
    before: {
      kind: "page",
      id: input.selection.pageContentHash,
      path: input.beforePath
    },
    after: { kind: "page", id: input.afterHash, path: input.current.pagePath },
    summary: `Linked Pige-managed note ${input.current.pageId} to related note ${input.target.pageId}.`,
    reversible: "yes",
    rollbackHint: "Restore the exact private before-image only while the live page matches this Operation's after hash.",
    warnings: []
  });
}

function createSelectionArtifact(jobId: string, selection: ReaderSelectionIdentity): {
  readonly id: string;
  readonly checksum: string;
} {
  const checksum = hashText(JSON.stringify({ schemaVersion: 1, jobId, action: "link", selection }));
  return {
    id: `art_reader_selection_${checksum.slice("sha256:".length, "sha256:".length + 16)}`,
    checksum
  };
}

function hasDirectedLink(before: string, sourcePath: string, target: EligiblePage): boolean {
  const parsed = parsePigeFrontmatter(before);
  if (readInlineArray(parsed?.raw ?? "", "related_page_ids", 64)?.includes(target.pageId)) return true;
  return extractPigeMarkdownLinkRefs(before).some((link) => {
    if (link.target === target.pageId || link.target === target.pagePath) return true;
    if (link.target.startsWith("#wiki:")) {
      try {
        return decodeURIComponent(link.target.slice("#wiki:".length)) === target.pageId;
      } catch {
        return false;
      }
    }
    const relativeTarget = link.target.split("#", 1)[0]?.replace(/\\/gu, "/") ?? "";
    return relativeTarget.endsWith(".md") &&
      path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), relativeTarget)) === target.pagePath;
  });
}

function assertExactSelection(markdown: string, selection: ReaderSelectionIdentity): void {
  const bytes = Buffer.from(markdown, "utf8");
  const { start, endExclusive } = selection.span;
  if (
    selection.span.unit !== "utf8_bytes" ||
    start < 0 || endExclusive <= start || endExclusive > bytes.length ||
    !isUtf8Boundary(bytes, start) || !isUtf8Boundary(bytes, endExclusive) ||
    hashBytes(bytes.subarray(start, endExclusive)) !== selection.selectedContentHash
  ) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "The Reader link selection no longer matches its durable bytes."
    );
  }
}

function readExactOperation(vaultPath: string, expected: OperationRecord): OperationRecord | undefined {
  const serialized = readGeneratedNoteExact(
    vaultPath,
    resolveVaultPath(vaultPath, operationPath(expected.id)),
    256 * 1024
  );
  if (serialized === undefined) return undefined;
  let operation: OperationRecord;
  try {
    operation = OperationRecordSchema.parse(JSON.parse(serialized));
  } catch {
    throw pageConflict("The Reader link Operation is invalid.");
  }
  if (stableJson(operation) !== stableJson(expected)) {
    throw pageConflict("The Reader link Operation identity is occupied by different audit facts.");
  }
  return operation;
}

function commitOperation(vaultPath: string, operation: OperationRecord): OperationRecord {
  const absolutePath = resolveVaultPath(vaultPath, operationPath(operation.id));
  const status = createGeneratedNoteExclusive(vaultPath, absolutePath, `${JSON.stringify(operation, null, 2)}\n`);
  if (status === "created") return operation;
  return readExactOperation(vaultPath, operation) ?? (() => {
    throw pageConflict("The Reader link Operation is unavailable.");
  })();
}

function stageExact(
  vaultPath: string,
  relativePath: string,
  content: string,
  expectedHash: string
): void {
  const status = createGeneratedNoteExclusive(vaultPath, resolveVaultPath(vaultPath, relativePath), content);
  if (status === "exists" && hashText(readPrivate(vaultPath, relativePath) ?? "") !== expectedHash) {
    throw pageConflict("A private Reader link recovery file changed.");
  }
}

function readPrivate(vaultPath: string, relativePath: string): string | undefined {
  return readGeneratedNoteExact(
    vaultPath,
    resolveVaultPath(vaultPath, relativePath),
    MAX_AGENT_PAGE_UPDATE_BYTES
  );
}

function requireLive(vaultPath: string, relativePath: string): string {
  const value = readPrivate(vaultPath, relativePath);
  if (value === undefined) throw pageConflict("The Reader link page is unavailable.");
  return value;
}

function readInlineArray(raw: string, key: string, maximum: number): readonly string[] | undefined {
  const matches = raw.split("\n").filter((line) => line.startsWith(`${key}:`));
  if (matches.length !== 1) return undefined;
  try {
    const value: unknown = JSON.parse(matches[0]!.slice(key.length + 1).trim());
    return Array.isArray(value) && value.length <= maximum && value.every((item) => typeof item === "string")
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function readNestedScalar(raw: string, parent: string, key: string): string | undefined {
  const lines = raw.split("\n");
  const parentIndex = lines.indexOf(`${parent}:`);
  if (parentIndex < 0) return undefined;
  const end = lines.findIndex((line, index) => index > parentIndex && line.length > 0 && !/^\s/u.test(line));
  const match = lines
    .slice(parentIndex + 1, end < 0 ? lines.length : end)
    .find((line) => line.startsWith(`  ${key}:`));
  if (!match) return undefined;
  const value = match.slice(`  ${key}:`.length).trim();
  try {
    const parsed: unknown = value.startsWith('"') ? JSON.parse(value) : value;
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function hasBalancedManagedBlocks(markdown: string): boolean {
  let depth = 0;
  for (const line of markdown.split(/\r?\n/u)) {
    const value = line.trim();
    if (/^<!-- pige:managed:start [^\r\n]+ -->$/u.test(value)) depth += 1;
    if (value === "<!-- pige:managed:end -->") depth -= 1;
    if (depth < 0 || depth > 1) return false;
    if (value.includes("pige:managed:start") &&
      !/^<!-- pige:managed:start [^\r\n]+ -->$/u.test(value)) return false;
  }
  return depth === 0;
}

function replaceUniqueLine(raw: string, key: string, value: string): string {
  const lines = raw.split("\n");
  const matches = lines.flatMap((line, index) => line.startsWith(`${key}:`) ? [index] : []);
  if (matches.length !== 1) throw pageConflict(`The Reader link source has an ambiguous ${key} field.`);
  lines[matches[0]!] = `${key}: ${value}`;
  return lines.join("\n");
}

function generatedPagePath(pageId: string): string {
  const year = /^page_(\d{4})\d{4}_[a-z0-9]{8,}$/u.exec(pageId)?.[1];
  if (!year) throw pageConflict("The Reader link page identity is invalid.");
  return `wiki/generated/${year}/${pageId}.md`;
}

function operationPath(operationId: string): string {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1] ?? "19700101";
  return `.pige/operations/${date.slice(0, 4)}/${date.slice(4, 6)}/${operationId}.json`;
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\\") ||
    relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw pageConflict("The Reader link path is invalid.");
  }
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw pageConflict("The Reader link path escapes its vault.");
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw pageConflict("The Reader link vault is unsafe.");
  return resolved;
}

function monotonicTimestamp(current: string, requested: string): string {
  const currentTime = Date.parse(current);
  const requestedTime = Date.parse(requested);
  if (!Number.isFinite(currentTime) || !Number.isFinite(requestedTime)) {
    throw pageConflict("The Reader link timestamp binding is invalid.");
  }
  return new Date(Math.max(requestedTime, currentTime + 1)).toISOString();
}

function result(
  operation: OperationRecord,
  currentPageId: string,
  targetPageId: string
): ReaderSelectionLinkResult {
  return { operation, currentPageId, targetPageId };
}

function isUtf8Boundary(bytes: Uint8Array, offset: number): boolean {
  return offset === 0 || offset === bytes.length || (bytes[offset]! & 0xc0) !== 0x80;
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function pageConflict(message: string): PigeDomainError {
  return new PigeDomainError("agent_runtime.link_conflict", message);
}
