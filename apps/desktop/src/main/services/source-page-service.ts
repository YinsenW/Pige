import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type SourceRecord } from "@pige/schemas";

export interface SourcePageResult {
  readonly pageId: string;
  readonly pagePath: string;
  readonly created: boolean;
  readonly title: string;
}

export interface SourcePageRefreshResult extends SourcePageResult {
  readonly updated: boolean;
  readonly conflict: boolean;
}

export interface SourcePagePublicationHooks {
  readonly onPublicationStart?: () => void;
}

interface SourcePageRefreshPending {
  readonly previousChecksum?: string;
  readonly targetChecksum: string;
  readonly updatedAt: string;
  readonly jobId: string;
}

interface RegularFileRevision {
  readonly checksum: string;
  readonly size: number;
  readonly dev: number;
  readonly ino: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

interface RegularTextFileSnapshot {
  readonly text: string;
  readonly revision: RegularFileRevision;
}

type ExpectedFileRevision = RegularFileRevision | "absent";

const INLINE_SOURCE_LIMIT = 4000;
const PREVIEW_LIMIT = 1200;
const SOURCE_READ_LIMIT_BYTES = 16 * 1024;

export class SourcePageService {
  createForSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    jobId: string,
    expectedCurrentSourceRecord: SourceRecord = sourceRecord,
    hooks: SourcePagePublicationHooks = {}
  ): SourcePageResult {
    const startPublication = createPublicationGate(hooks.onPublicationStart);
    const pageId = createPageId(sourceRecord.id);
    const pagePath = createSourcePagePath(sourceRecord);
    const absolutePagePath = resolveVaultRelativePath(vaultPath, pagePath);
    const absoluteSourceRecordPath = resolveSourceRecordPath(vaultPath, sourceRecordPath);
    const sourceRecordProjectionPath = toVaultRelativePath(vaultPath, absoluteSourceRecordPath);
    const currentSourceRecord = readRequiredRegularTextFile(vaultPath, absoluteSourceRecordPath);
    assertExpectedSourceRecord(currentSourceRecord, expectedCurrentSourceRecord);
    let sourceRecordRevision = currentSourceRecord.revision;
    const title = createTitle(vaultPath, sourceRecord);
    const now = new Date().toISOString();
    const sourceRecordForPage = SourceRecordSchema.parse({ ...sourceRecord, updatedAt: now });
    const pending = readRefreshPending(sourceRecord.metadata.sourcePageRefreshPending);

    if (pending) {
      const recovered = recoverPendingRefresh({
        vaultPath,
        sourceRecord,
        sourceRecordPath: sourceRecordProjectionPath,
        absolutePagePath,
        pageId,
        pagePath,
        title,
        pending,
        sourceRecordRevision,
        onPublicationStart: startPublication
      });
      return { pageId, pagePath, created: recovered.created, title };
    }

    const existingPage = readOptionalRegularTextFile(vaultPath, absolutePagePath);
    const pageAlreadyExists = existingPage !== undefined;
    const renderedPage = pageAlreadyExists
      ? undefined
      : renderSourcePage({
        pageId,
        pagePath,
        sourceRecord: sourceRecordForPage,
        sourceRecordPath: sourceRecordProjectionPath,
        jobId,
        title,
        now,
        vaultPath
      });
    const recordedPageChecksum = stringMetadata(sourceRecord.metadata.knowledgePageChecksum);
    const existingPageMatches = Boolean(
      existingPage && recordedPageChecksum && existingPage.revision.checksum === recordedPageChecksum
    );
    const pageConflict = pageAlreadyExists && !existingPageMatches;
    const pageChecksum = renderedPage
      ? checksumText(renderedPage)
      : existingPageMatches
        ? recordedPageChecksum
        : undefined;
    if (renderedPage && pageChecksum) {
      startPublication();
      const pendingRecord = createPendingSourceRecord(sourceRecord, {
        pageId,
        pagePath,
        pending: { targetChecksum: pageChecksum, updatedAt: now, jobId }
      });
      sourceRecordRevision = writeJsonAtomic(
        vaultPath,
        absoluteSourceRecordPath,
        pendingRecord,
        sourceRecordRevision,
        "source_record.target_changed"
      );
      writeFileAtomic(
        vaultPath,
        absolutePagePath,
        renderedPage,
        "absent",
        "source_page.target_changed"
      );
    }

    const updatedSourceRecord = SourceRecordSchema.parse({
      ...sourceRecord,
      knowledgePageId: pageId,
      knowledgePagePath: pagePath,
      metadata: {
        ...withoutPendingMetadata(sourceRecord.metadata),
        ...(pageChecksum ? { knowledgePageChecksum: pageChecksum } : {}),
        sourcePageRefreshConflict: pageConflict
      },
      updatedAt: now
    });
    startPublication();
    writeJsonAtomic(
      vaultPath,
      absoluteSourceRecordPath,
      updatedSourceRecord,
      sourceRecordRevision,
      "source_record.target_changed"
    );

    return {
      pageId,
      pagePath,
      created: !pageAlreadyExists,
      title
    };
  }

  refreshForSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    jobId: string,
    expectedCurrentSourceRecord: SourceRecord = sourceRecord,
    hooks: SourcePagePublicationHooks = {}
  ): SourcePageRefreshResult {
    const startPublication = createPublicationGate(hooks.onPublicationStart);
    if (!sourceRecord.knowledgePageId || !sourceRecord.knowledgePagePath) {
      const created = this.createForSource(
        vaultPath,
        sourceRecord,
        sourceRecordPath,
        jobId,
        expectedCurrentSourceRecord,
        { onPublicationStart: startPublication }
      );
      return { ...created, updated: created.created, conflict: false };
    }

    const absolutePagePath = resolveVaultRelativePath(vaultPath, sourceRecord.knowledgePagePath);
    const absoluteSourceRecordPath = resolveSourceRecordPath(vaultPath, sourceRecordPath);
    const sourceRecordProjectionPath = toVaultRelativePath(vaultPath, absoluteSourceRecordPath);
    const currentSourceRecord = readRequiredRegularTextFile(vaultPath, absoluteSourceRecordPath);
    assertExpectedSourceRecord(currentSourceRecord, expectedCurrentSourceRecord);
    const sourceRecordRevision = currentSourceRecord.revision;
    const pending = readRefreshPending(sourceRecord.metadata.sourcePageRefreshPending);
    if (pending) {
      const recovered = recoverPendingRefresh({
        vaultPath,
        sourceRecord,
        sourceRecordPath: sourceRecordProjectionPath,
        absolutePagePath,
        pageId: sourceRecord.knowledgePageId,
        pagePath: sourceRecord.knowledgePagePath,
        title: createTitle(vaultPath, sourceRecord),
        pending,
        sourceRecordRevision,
        onPublicationStart: startPublication
      });
      return {
        pageId: sourceRecord.knowledgePageId,
        pagePath: sourceRecord.knowledgePagePath,
        created: recovered.created,
        updated: recovered.updated,
        conflict: recovered.conflict,
        title: createTitle(vaultPath, sourceRecord)
      };
    }
    const currentPage = readOptionalRegularTextFile(vaultPath, absolutePagePath);
    if (!currentPage) {
      const created = this.createForSource(
        vaultPath,
        sourceRecord,
        sourceRecordPath,
        jobId,
        expectedCurrentSourceRecord,
        { onPublicationStart: startPublication }
      );
      return { ...created, updated: created.created, conflict: false };
    }

    const expectedChecksum = stringMetadata(sourceRecord.metadata.knowledgePageChecksum);
    const currentChecksum = currentPage.revision.checksum;
    if (!expectedChecksum || expectedChecksum !== currentChecksum) {
      startPublication();
      writeSourcePageConflictRecord(
        vaultPath,
        absoluteSourceRecordPath,
        sourceRecord,
        sourceRecordRevision
      );
      return {
        pageId: sourceRecord.knowledgePageId,
        pagePath: sourceRecord.knowledgePagePath,
        created: false,
        updated: false,
        conflict: true,
        title: createTitle(vaultPath, sourceRecord)
      };
    }

    const now = sourceRecord.updatedAt;
    const title = createTitle(vaultPath, sourceRecord);
    const renderedPage = renderSourcePage({
      pageId: sourceRecord.knowledgePageId,
      pagePath: sourceRecord.knowledgePagePath,
      sourceRecord,
      sourceRecordPath: sourceRecordProjectionPath,
      jobId,
      title,
      now,
      vaultPath
    });
    const targetChecksum = checksumText(renderedPage);
    if (targetChecksum === currentChecksum) {
      const currentBeforeCommit = readOptionalRegularTextFile(vaultPath, absolutePagePath);
      if (!currentBeforeCommit || !sameRevision(currentBeforeCommit.revision, currentPage.revision)) {
        writeSourcePageConflictRecord(
          vaultPath,
          absoluteSourceRecordPath,
          sourceRecord,
          sourceRecordRevision
        );
        return {
          pageId: sourceRecord.knowledgePageId,
          pagePath: sourceRecord.knowledgePagePath,
          created: false,
          updated: false,
          conflict: true,
          title
        };
      }
      const unchangedRecord = SourceRecordSchema.parse({
        ...sourceRecord,
        metadata: {
          ...withoutPendingMetadata(sourceRecord.metadata),
          knowledgePageChecksum: targetChecksum,
          sourcePageRefreshConflict: false
        }
      });
      startPublication();
      writeJsonAtomic(
        vaultPath,
        absoluteSourceRecordPath,
        unchangedRecord,
        sourceRecordRevision,
        "source_record.target_changed"
      );
      return {
        pageId: sourceRecord.knowledgePageId,
        pagePath: sourceRecord.knowledgePagePath,
        created: false,
        updated: false,
        conflict: false,
        title
      };
    }
    const pendingRecord = createPendingSourceRecord(sourceRecord, {
      pageId: sourceRecord.knowledgePageId,
      pagePath: sourceRecord.knowledgePagePath,
      pending: { previousChecksum: currentChecksum, targetChecksum, updatedAt: now, jobId }
    });
    startPublication();
    const pendingRevision = writeJsonAtomic(
      vaultPath,
      absoluteSourceRecordPath,
      pendingRecord,
      sourceRecordRevision,
      "source_record.target_changed"
    );
    writeFileAtomic(
      vaultPath,
      absolutePagePath,
      renderedPage,
      currentPage.revision,
      "source_page.target_changed"
    );
    const updatedSourceRecord = SourceRecordSchema.parse({
      ...sourceRecord,
      metadata: {
        ...withoutPendingMetadata(sourceRecord.metadata),
        knowledgePageChecksum: targetChecksum,
        sourcePageRefreshConflict: false
      },
      updatedAt: now
    });
    writeJsonAtomic(
      vaultPath,
      absoluteSourceRecordPath,
      updatedSourceRecord,
      pendingRevision,
      "source_record.target_changed"
    );
    return {
      pageId: sourceRecord.knowledgePageId,
      pagePath: sourceRecord.knowledgePagePath,
      created: false,
      updated: true,
      conflict: false,
      title
    };
  }
}

function renderSourcePage(input: {
  readonly pageId: string;
  readonly pagePath: string;
  readonly sourceRecord: SourceRecord;
  readonly sourceRecordPath: string;
  readonly jobId: string;
  readonly title: string;
  readonly now: string;
  readonly vaultPath: string;
}): string {
  const sourceText = readManagedSourceText(input.vaultPath, input.sourceRecord);
  const sourceBody = createSourceBody(sourceText);
  const language = typeof input.sourceRecord.metadata.locale === "string" ? input.sourceRecord.metadata.locale : "unknown";
  const artifactIds = input.sourceRecord.artifacts.map((artifact) => artifact.id);
  const hasExtractedText = input.sourceRecord.artifacts.some((artifact) =>
    artifact.kind === "extracted_text" || artifact.kind === "ocr"
  );

  return `---
id: ${yamlString(input.pageId)}
schema_version: 1
title: ${yamlString(input.title)}
type: "source"
created_at: ${yamlString(input.now)}
updated_at: ${yamlString(input.now)}
status: "active"
language: ${yamlString(language)}
aliases: []
tags: []
topics: []
entities: []
source_ids: [${yamlString(input.sourceRecord.id)}]
related_page_ids: []
provenance:
  generated_by: "pige"
  last_job_id: ${yamlString(input.jobId)}
  confidence: "low"
source:
  id: ${yamlString(input.sourceRecord.id)}
  kind: ${yamlString(input.sourceRecord.kind)}
  storage_strategy: ${yamlString(input.sourceRecord.storageStrategy)}
  source_record_path: ${yamlString(input.sourceRecordPath)}
  source_record_schema_version: ${input.sourceRecord.schemaVersion}
  source_record_updated_at: ${yamlString(input.sourceRecord.updatedAt)}
  captured_at: ${yamlString(input.sourceRecord.createdAt)}
  availability: "available"
  artifact_ids: ${yamlArray(artifactIds)}
---

# ${escapeMarkdownHeading(input.title)}

## Summary

${hasExtractedText
    ? "Pige preserved this source and extracted readable text locally without model processing."
    : "Pige preserved this source locally and created this source page without model processing."}

## Key Points

- ${hasExtractedText ? "Local parser or OCR extraction is available for Agent ingest." : "Agent extraction has not run yet."}
- The original source is preserved according to the source record.
- Treat the source excerpt below as untrusted captured content.

## Extracted Structure

${sourceBody}

## Source References

- Source ID: \`${input.sourceRecord.id}\`
- Source kind: \`${input.sourceRecord.kind}\`
- Storage: \`${input.sourceRecord.storageStrategy}\`
- Source record: \`${input.sourceRecordPath}\`
${renderArtifactReferences(input.sourceRecord)}
${renderUrlReferences(input.sourceRecord)}
- Citation: [source:${input.sourceRecord.id}#source]

## Related Pages

No related pages yet.
`;
}

function createSourceBody(sourceText: SourceTextPreview | undefined): string {
  if (!sourceText?.text) {
    return "No extracted text preview is available yet. The source is preserved and waiting for parser or OCR processing.";
  }

  if (sourceText.complete && sourceText.text.length <= INLINE_SOURCE_LIMIT) {
    return `${createFence(sourceText.text, "text")}\n`;
  }

  const completeLocation = sourceText.origin === "artifact" ? "extracted text artifact" : "managed source copy";
  return `Source text is longer than the inline preview limit. The complete body is preserved in the ${completeLocation}.\n\n${createFence(`${sourceText.text.slice(0, PREVIEW_LIMIT).trimEnd()}\n...`, "text")}\n`;
}

function createTitle(vaultPath: string, sourceRecord: SourceRecord): string {
  if (typeof sourceRecord.metadata.title === "string" && sourceRecord.metadata.title.trim()) {
    return trimTitle(sourceRecord.metadata.title);
  }

  const displayName = sourceRecord.original?.displayName;
  if (displayName) {
    return trimTitle(path.basename(displayName, path.extname(displayName)));
  }

  const sourceText = readManagedSourceText(vaultPath, sourceRecord);
  const firstLine = sourceText?.text.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim();
  if (firstLine) {
    return trimTitle(firstLine.replace(/^#+\s*/u, ""));
  }

  return `Captured Source ${sourceRecord.id}`;
}

function trimTitle(title: string): string {
  const trimmed = title.replace(/\s+/gu, " ").trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77).trimEnd()}...` : trimmed || "Untitled Source";
}

interface SourceTextPreview {
  readonly text: string;
  readonly complete: boolean;
  readonly origin: "artifact" | "managed_copy";
}

function readManagedSourceText(vaultPath: string, sourceRecord: SourceRecord): SourceTextPreview | undefined {
  if (!hasReadableTextPreview(sourceRecord)) return undefined;
  const extractedTextPath = sourceRecord.artifacts.find((artifact) =>
    artifact.kind === "extracted_text" || artifact.kind === "ocr"
  )?.path;
  const managedCopyPath = extractedTextPath ?? sourceRecord.managedCopy?.path;
  if (!managedCopyPath) return undefined;
  const absolutePath = resolveVaultRelativePath(vaultPath, managedCopyPath);
  const preview = readOptionalRegularTextPrefix(vaultPath, absolutePath, SOURCE_READ_LIMIT_BYTES);
  if (!preview) return undefined;
  return {
    ...preview,
    origin: extractedTextPath ? "artifact" : "managed_copy"
  };
}

function hasReadableTextPreview(sourceRecord: SourceRecord): boolean {
  return sourceRecord.kind === "text" ||
    sourceRecord.kind === "markdown_file" ||
    sourceRecord.kind === "plain_text_file" ||
    sourceRecord.kind === "url" ||
    sourceRecord.artifacts.some((artifact) => artifact.kind === "extracted_text" || artifact.kind === "ocr");
}

function createPageId(sourceId: string): string {
  return sourceId.replace(/^src_/u, "page_");
}

function createSourcePagePath(sourceRecord: SourceRecord): string {
  const dateKey = /^src_(\d{8})_/.exec(sourceRecord.id)?.[1] ?? new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const year = dateKey.slice(0, 4);
  const bucket = sourceRecord.kind === "text" ? "text" : sourceRecord.kind === "url" ? "web" : "files";
  return ["sources", bucket, year, `${sourceRecord.id}.md`].join("/");
}

function renderUrlReferences(sourceRecord: SourceRecord): string {
  if (sourceRecord.kind !== "url") return "";
  const originalUrl = typeof sourceRecord.metadata.originalUrl === "string" ? sourceRecord.metadata.originalUrl : sourceRecord.original?.uri;
  const finalUrl = typeof sourceRecord.metadata.finalUrl === "string" ? sourceRecord.metadata.finalUrl : undefined;
  const canonicalUrl = typeof sourceRecord.metadata.canonicalUrl === "string" ? sourceRecord.metadata.canonicalUrl : undefined;
  const lines = [
    originalUrl ? `- Original URL: ${originalUrl}` : undefined,
    finalUrl && finalUrl !== originalUrl ? `- Final URL: ${finalUrl}` : undefined,
    canonicalUrl && canonicalUrl !== finalUrl ? `- Canonical URL: ${canonicalUrl}` : undefined
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function renderArtifactReferences(sourceRecord: SourceRecord): string {
  return sourceRecord.artifacts.length > 0
    ? `${sourceRecord.artifacts.map((artifact) => `- ${artifact.kind} artifact: \`${artifact.id}\``).join("\n")}\n`
    : "";
}

function createFence(value: string, info: string): string {
  const maxTildeRun = Math.max(0, ...Array.from(value.matchAll(/~+/gu), (match) => match[0].length));
  const fence = "~".repeat(Math.max(3, maxTildeRun + 1));
  return `${fence}${info}\n${value}\n${fence}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlArray(values: readonly string[]): string {
  return `[${values.map(yamlString).join(", ")}]`;
}

function escapeMarkdownHeading(value: string): string {
  return value.replace(/[\r\n]+/gu, " ").trim() || "Untitled Source";
}

function resolveVaultRelativePath(vaultPath: string, relativePath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(vaultPath, ...relativePath.split("/"));
  const allowedPrefix = `${resolvedVault}${path.sep}`;
  if (resolvedPath !== resolvedVault && !resolvedPath.startsWith(allowedPrefix)) {
    throw new PigeDomainError("vault.path_unsafe", "The source-page path escapes the active vault.");
  }
  return resolvedPath;
}

function resolveSourceRecordPath(vaultPath: string, sourceRecordPath: string): string {
  const sourceRecordRoot = path.resolve(vaultPath, ".pige", "source-records");
  const resolvedPath = path.isAbsolute(sourceRecordPath)
    ? path.resolve(sourceRecordPath)
    : resolveVaultRelativePath(vaultPath, sourceRecordPath);
  if (resolvedPath === sourceRecordRoot || !isContainedPath(resolvedPath, sourceRecordRoot)) {
    throw new PigeDomainError(
      "vault.path_unsafe",
      "The Source Record path is outside the active vault Source Record root."
    );
  }
  return resolvedPath;
}

function toVaultRelativePath(vaultPath: string, filePath: string): string {
  return path.relative(path.resolve(vaultPath), path.resolve(filePath)).split(path.sep).join("/");
}

function writeJsonAtomic(
  vaultPath: string,
  filePath: string,
  value: unknown,
  expected: ExpectedFileRevision,
  conflictCode: string
): RegularFileRevision {
  return writeFileAtomic(vaultPath, filePath, `${JSON.stringify(value, null, 2)}\n`, expected, conflictCode);
}

function writeFileAtomic(
  vaultPath: string,
  filePath: string,
  value: string,
  expected: ExpectedFileRevision,
  conflictCode: string
): RegularFileRevision {
  ensureSafeVaultParent(vaultPath, filePath, true);
  assertExpectedRevision(vaultPath, filePath, expected, conflictCode);
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let descriptor: number | undefined;
  try {
    const flags = fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW ?? 0);
    descriptor = fs.openSync(temporaryPath, flags, 0o600);
    fs.writeFileSync(descriptor, value, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    ensureSafeVaultParent(vaultPath, filePath, false);
    assertExpectedRevision(vaultPath, filePath, expected, conflictCode);
    fs.renameSync(temporaryPath, filePath);

    const written = readRequiredRegularTextFile(vaultPath, filePath);
    if (written.revision.checksum !== checksumText(value)) {
      throw new PigeDomainError("vault.write_failed", "The source-page write did not persist the expected bytes.");
    }
    return written.revision;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("vault.write_failed", "Pige could not commit a durable source-page file.");
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The original write error remains authoritative.
      }
    }
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Cleanup must not replace the authoritative commit result.
    }
  }
}

function readRequiredRegularTextFile(vaultPath: string, filePath: string): RegularTextFileSnapshot {
  const snapshot = readOptionalRegularTextFile(vaultPath, filePath);
  if (!snapshot) {
    throw new PigeDomainError("vault.file_unavailable", "A required durable vault file is unavailable.");
  }
  return snapshot;
}

function readOptionalRegularTextFile(vaultPath: string, filePath: string): RegularTextFileSnapshot | undefined {
  if (!ensureSafeVaultParent(vaultPath, filePath, false)) return undefined;
  let pathStatBefore: fs.Stats;
  try {
    pathStatBefore = fs.lstatSync(filePath);
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    throw new PigeDomainError("vault.file_unavailable", "A durable vault file cannot be inspected.");
  }
  if (!pathStatBefore.isFile() || pathStatBefore.isSymbolicLink()) {
    throw new PigeDomainError("vault.path_unsafe", "A durable vault target is not a regular file.");
  }

  assertFileResolvesWithinVault(vaultPath, filePath);

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor: number;
  try {
    descriptor = fs.openSync(filePath, flags);
  } catch {
    throw new PigeDomainError("vault.file_unavailable", "A durable vault file cannot be opened safely.");
  }
  try {
    const descriptorStatBefore = fs.fstatSync(descriptor);
    if (!sameIdentity(pathStatBefore, descriptorStatBefore)) {
      throw new PigeDomainError("vault.file_changed", "A durable vault file changed before it could be read.");
    }
    const bytes = fs.readFileSync(descriptor);
    const descriptorStatAfter = fs.fstatSync(descriptor);
    let pathStatAfter: fs.Stats;
    try {
      pathStatAfter = fs.lstatSync(filePath);
    } catch {
      throw new PigeDomainError("vault.file_changed", "A durable vault file changed while it was being read.");
    }
    if (
      !sameIdentity(descriptorStatBefore, descriptorStatAfter) ||
      descriptorStatAfter.size !== bytes.length ||
      descriptorStatAfter.mtimeMs !== descriptorStatBefore.mtimeMs ||
      descriptorStatAfter.ctimeMs !== descriptorStatBefore.ctimeMs ||
      !sameIdentity(descriptorStatAfter, pathStatAfter) ||
      pathStatAfter.isSymbolicLink()
    ) {
      throw new PigeDomainError("vault.file_changed", "A durable vault file changed while it was being read.");
    }
    return {
      text: bytes.toString("utf8"),
      revision: {
        checksum: checksumBuffer(bytes),
        size: descriptorStatAfter.size,
        dev: descriptorStatAfter.dev,
        ino: descriptorStatAfter.ino,
        mtimeMs: descriptorStatAfter.mtimeMs,
        ctimeMs: descriptorStatAfter.ctimeMs
      }
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function readOptionalRegularTextPrefix(
  vaultPath: string,
  filePath: string,
  byteLimit: number
): { readonly text: string; readonly complete: boolean } | undefined {
  if (!ensureSafeVaultParent(vaultPath, filePath, false)) return undefined;
  let pathStatBefore: fs.Stats;
  try {
    pathStatBefore = fs.lstatSync(filePath);
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    throw new PigeDomainError("vault.file_unavailable", "A vault preview file cannot be inspected.");
  }
  if (!pathStatBefore.isFile() || pathStatBefore.isSymbolicLink()) {
    throw new PigeDomainError("vault.path_unsafe", "A vault preview target is not a regular file.");
  }
  assertFileResolvesWithinVault(vaultPath, filePath);

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor: number;
  try {
    descriptor = fs.openSync(filePath, flags);
  } catch {
    throw new PigeDomainError("vault.file_unavailable", "A vault preview file cannot be opened safely.");
  }
  try {
    const descriptorStatBefore = fs.fstatSync(descriptor);
    if (!sameIdentity(pathStatBefore, descriptorStatBefore)) {
      throw new PigeDomainError("vault.file_changed", "A vault preview file changed before it could be read.");
    }
    const bytesToRead = Math.min(descriptorStatBefore.size, byteLimit);
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = bytesToRead === 0 ? 0 : fs.readSync(descriptor, buffer, 0, bytesToRead, 0);
    const descriptorStatAfter = fs.fstatSync(descriptor);
    let pathStatAfter: fs.Stats;
    try {
      pathStatAfter = fs.lstatSync(filePath);
    } catch {
      throw new PigeDomainError("vault.file_changed", "A vault preview file changed while it was being read.");
    }
    if (
      !sameIdentity(descriptorStatBefore, descriptorStatAfter) ||
      !sameIdentity(descriptorStatAfter, pathStatAfter) ||
      pathStatAfter.isSymbolicLink()
    ) {
      throw new PigeDomainError("vault.file_changed", "A vault preview file changed while it was being read.");
    }
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      complete: descriptorStatAfter.size <= bytesRead
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertFileResolvesWithinVault(vaultPath: string, filePath: string): void {
  let realVaultPath: string;
  let realFilePath: string;
  try {
    realVaultPath = fs.realpathSync(path.resolve(vaultPath));
    realFilePath = fs.realpathSync(filePath);
  } catch {
    throw new PigeDomainError("vault.file_unavailable", "A vault file cannot be resolved safely.");
  }
  if (!isContainedPath(realFilePath, realVaultPath)) {
    throw new PigeDomainError("vault.path_unsafe", "A vault file resolves outside the active vault.");
  }
}

function assertExpectedRevision(
  vaultPath: string,
  filePath: string,
  expected: ExpectedFileRevision,
  conflictCode: string
): void {
  const current = readOptionalRegularTextFile(vaultPath, filePath);
  const matches = expected === "absent"
    ? current === undefined
    : Boolean(current && sameRevision(current.revision, expected));
  if (!matches) {
    throw new PigeDomainError(conflictCode, "A durable vault target changed before Pige could commit its update.");
  }
}

function assertExpectedSourceRecord(
  current: RegularTextFileSnapshot,
  expected: SourceRecord
): void {
  let currentRecord: SourceRecord;
  try {
    currentRecord = SourceRecordSchema.parse(JSON.parse(current.text));
  } catch {
    throw new PigeDomainError("source_record.invalid", "The current Source Record is not valid JSON data.");
  }
  if (!isDeepStrictEqual(currentRecord, SourceRecordSchema.parse(expected))) {
    throw new PigeDomainError(
      "source_record.target_changed",
      "The Source Record changed before source-page projection could begin."
    );
  }
}

function ensureSafeVaultParent(vaultPath: string, filePath: string, create: boolean): boolean {
  const resolvedVaultPath = path.resolve(vaultPath);
  const resolvedFilePath = path.resolve(filePath);
  if (!isContainedPath(resolvedFilePath, resolvedVaultPath) || resolvedFilePath === resolvedVaultPath) {
    throw new PigeDomainError("vault.path_unsafe", "A durable write path escapes the active vault.");
  }
  let vaultStat: fs.Stats;
  try {
    vaultStat = fs.lstatSync(resolvedVaultPath);
  } catch {
    throw new PigeDomainError("vault.path_unsafe", "The active vault cannot be inspected safely.");
  }
  if (!vaultStat.isDirectory() || vaultStat.isSymbolicLink()) {
    throw new PigeDomainError("vault.path_unsafe", "The active vault is not a safe directory.");
  }

  const relativeParent = path.relative(resolvedVaultPath, path.dirname(resolvedFilePath));
  let current = resolvedVaultPath;
  for (const component of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (caught) {
      if (!isErrno(caught, "ENOENT")) {
        throw new PigeDomainError("vault.path_unsafe", "A durable write parent cannot be inspected safely.");
      }
      if (!create) return false;
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!isErrno(mkdirError, "EEXIST")) {
          throw new PigeDomainError("vault.write_failed", "Pige could not create a durable write directory.");
        }
      }
      stat = fs.lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PigeDomainError("vault.path_unsafe", "A durable write parent is not a safe directory.");
    }
  }

  let realVaultPath: string;
  let realParentPath: string;
  try {
    realVaultPath = fs.realpathSync(resolvedVaultPath);
    realParentPath = fs.realpathSync(path.dirname(resolvedFilePath));
  } catch {
    throw new PigeDomainError("vault.path_unsafe", "A durable write parent cannot be resolved safely.");
  }
  if (!isContainedPath(realParentPath, realVaultPath)) {
    throw new PigeDomainError("vault.path_unsafe", "A durable write parent resolves outside the active vault.");
  }
  return true;
}

function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function sameRevision(left: RegularFileRevision, right: RegularFileRevision): boolean {
  return left.checksum === right.checksum &&
    left.size === right.size &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function checksumBuffer(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isContainedPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function isErrno(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && value.code === code;
}

function checksumText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readRefreshPending(value: unknown): SourcePageRefreshPending | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const previousChecksum = stringMetadata(candidate.previousChecksum);
  const targetChecksum = stringMetadata(candidate.targetChecksum);
  const updatedAt = stringMetadata(candidate.updatedAt);
  const jobId = stringMetadata(candidate.jobId);
  if (!targetChecksum || !updatedAt || !jobId) return undefined;
  return { ...(previousChecksum ? { previousChecksum } : {}), targetChecksum, updatedAt, jobId };
}

function withoutPendingMetadata(metadata: SourceRecord["metadata"]): SourceRecord["metadata"] {
  const { sourcePageRefreshPending: _pending, ...rest } = metadata;
  return rest;
}

function createPendingSourceRecord(
  sourceRecord: SourceRecord,
  input: {
    readonly pageId: string;
    readonly pagePath: string;
    readonly pending: SourcePageRefreshPending;
  }
): SourceRecord {
  return SourceRecordSchema.parse({
    ...sourceRecord,
    knowledgePageId: input.pageId,
    knowledgePagePath: input.pagePath,
    metadata: {
      ...withoutPendingMetadata(sourceRecord.metadata),
      sourcePageRefreshPending: input.pending
    },
    updatedAt: input.pending.updatedAt
  });
}

function recoverPendingRefresh(input: {
  readonly vaultPath: string;
  readonly sourceRecord: SourceRecord;
  readonly sourceRecordPath: string;
  readonly absolutePagePath: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
  readonly pending: SourcePageRefreshPending;
  readonly sourceRecordRevision: RegularFileRevision;
  readonly onPublicationStart: () => void;
}): { readonly created: boolean; readonly updated: boolean; readonly conflict: boolean } {
  const absoluteSourceRecordPath = resolveSourceRecordPath(input.vaultPath, input.sourceRecordPath);
  const currentPage = readOptionalRegularTextFile(input.vaultPath, input.absolutePagePath);
  const pageExists = currentPage !== undefined;
  const currentChecksum = currentPage?.revision.checksum;
  if (currentChecksum === input.pending.targetChecksum) {
    input.onPublicationStart();
    finalizePendingRefresh(input);
    return { created: false, updated: true, conflict: false };
  }

  const canApplyTarget = (!pageExists && !input.pending.previousChecksum) ||
    (Boolean(currentChecksum) && currentChecksum === input.pending.previousChecksum);
  if (canApplyTarget) {
    const renderedPage = renderSourcePage({
      pageId: input.pageId,
      pagePath: input.pagePath,
      sourceRecord: input.sourceRecord,
      sourceRecordPath: input.sourceRecordPath,
      jobId: input.pending.jobId,
      title: input.title,
      now: input.pending.updatedAt,
      vaultPath: input.vaultPath
    });
    if (checksumText(renderedPage) === input.pending.targetChecksum) {
      input.onPublicationStart();
      writeFileAtomic(
        input.vaultPath,
        input.absolutePagePath,
        renderedPage,
        currentPage?.revision ?? "absent",
        "source_page.target_changed"
      );
      finalizePendingRefresh(input);
      return { created: !pageExists, updated: pageExists, conflict: false };
    }
  }

  input.onPublicationStart();
  writeSourcePageConflictRecord(
    input.vaultPath,
    absoluteSourceRecordPath,
    input.sourceRecord,
    input.sourceRecordRevision
  );
  return { created: false, updated: false, conflict: true };
}

function createPublicationGate(onPublicationStart: (() => void) | undefined): () => void {
  let started = false;
  return () => {
    if (started) return;
    onPublicationStart?.();
    started = true;
  };
}

function finalizePendingRefresh(input: {
  readonly vaultPath: string;
  readonly sourceRecord: SourceRecord;
  readonly sourceRecordPath: string;
  readonly pageId: string;
  readonly pagePath: string;
  readonly pending: SourcePageRefreshPending;
  readonly sourceRecordRevision: RegularFileRevision;
}): void {
  const finalized = SourceRecordSchema.parse({
    ...input.sourceRecord,
    knowledgePageId: input.pageId,
    knowledgePagePath: input.pagePath,
    metadata: {
      ...withoutPendingMetadata(input.sourceRecord.metadata),
      knowledgePageChecksum: input.pending.targetChecksum,
      sourcePageRefreshConflict: false
    },
    updatedAt: input.pending.updatedAt
  });
  writeJsonAtomic(
    input.vaultPath,
    resolveSourceRecordPath(input.vaultPath, input.sourceRecordPath),
    finalized,
    input.sourceRecordRevision,
    "source_record.target_changed"
  );
}

function writeSourcePageConflictRecord(
  vaultPath: string,
  absoluteSourceRecordPath: string,
  sourceRecord: SourceRecord,
  sourceRecordRevision: RegularFileRevision
): void {
  const conflictRecord = SourceRecordSchema.parse({
    ...sourceRecord,
    metadata: {
      ...withoutPendingMetadata(sourceRecord.metadata),
      sourcePageRefreshConflict: true
    },
    updatedAt: new Date().toISOString()
  });
  writeJsonAtomic(
    vaultPath,
    absoluteSourceRecordPath,
    conflictRecord,
    sourceRecordRevision,
    "source_record.target_changed"
  );
}
