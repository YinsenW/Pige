import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  OperationRecordSchema,
  SourceRecordSchema,
  type JobRecord,
  type OperationRecord,
  type SourceRecord
} from "@pige/schemas";
import { SourcePageService } from "./source-page-service";
import { tryVerifyReadableSourceFile, verifyReadableSourceFile } from "./source-file-access";
import { OFFICE_MEDIA_TARGET_SCHEMA_VERSION } from "./office-parser-types";

export type ParserTextCoverage = "none" | "low" | "medium" | "high";

export interface ParserDescriptor {
  readonly id: string;
  readonly engine: string;
  readonly version: string;
}

export interface DocumentParseSourceResult {
  readonly sourceId: string;
  readonly created: boolean;
  readonly extractedTextArtifactPath?: string;
  readonly metadataArtifactPath: string;
  readonly textCharacterCount: number;
  readonly textCoverage: ParserTextCoverage;
  readonly needsOcr: boolean;
  readonly agentTextReady: boolean;
  readonly warnings: readonly string[];
  readonly sourcePageUpdated: boolean;
  readonly sourcePageConflict: boolean;
}

export interface NormalizedParserExtraction {
  readonly format: "pdf" | "docx" | "pptx";
  readonly parser: ParserDescriptor;
  readonly title?: string;
  readonly text: string;
  readonly textCharacterCount: number;
  readonly textCoverage: ParserTextCoverage;
  readonly truncated: boolean;
  readonly needsOcr: boolean;
  readonly agentTextReady: boolean;
  readonly ocrCandidateLocators: readonly string[];
  readonly sidecarMetadata: Readonly<Record<string, unknown>>;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
  readonly warnings: readonly string[];
}

interface FileIntegrity {
  readonly checksum: string;
  readonly size: number;
}

const MAX_PARSER_SIDECAR_BYTES = 16 * 1024 * 1024;
const SIDECAR_RESERVED_KEYS = new Set([
  "schemaVersion",
  "artifactId",
  "sourceId",
  "kind",
  "createdAt",
  "parser",
  "sourceChecksum",
  "extractedTextChecksum",
  "textCharacterCount",
  "textCoverage",
  "truncated",
  "needsOcr",
  "agentTextReady",
  "ocrCandidateLocators",
  "warnings"
]);
const SOURCE_METADATA_RESERVED_KEYS = new Set([
  "title",
  "parserRequired",
  "parserStatus",
  "parserFormat",
  "parserId",
  "parserEngine",
  "parserVersion",
  "parserJobId",
  "textCharacterCount",
  "textCoverage",
  "parserTruncated",
  "needsOcr",
  "agentTextReady",
  "ocrCandidateLocators",
  "parserWarnings"
]);

export class ParserArtifactService {
  readonly #sourcePages: SourcePageService;

  constructor(sourcePages = new SourcePageService()) {
    this.#sourcePages = sourcePages;
  }

  readExisting(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    format: NormalizedParserExtraction["format"],
    expectedParser: ParserDescriptor,
    onPublicationStart?: () => void
  ): DocumentParseSourceResult | undefined {
    const sourceFile = tryVerifyReadableSourceFile(vaultPath, sourceRecord);
    if (!sourceFile) return undefined;
    const metadataArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === metadataArtifactId(sourceRecord.id, format) && artifact.kind === "metadata"
    );
    if (!metadataArtifact || !artifactFileMatches(vaultPath, metadataArtifact)) return undefined;
    const extractedTextArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === extractedTextArtifactId(sourceRecord.id, format) && artifact.kind === "extracted_text"
    );
    if (extractedTextArtifact && !artifactFileMatches(vaultPath, extractedTextArtifact)) return undefined;
    const parserStatus = sourceRecord.metadata.parserStatus;
    if (parserStatus !== "parsed" && parserStatus !== "parsed_needs_ocr") return undefined;
    const sidecar = readJsonObject(resolveVaultRelativePath(vaultPath, metadataArtifact.path));
    if (!isReusableSidecar(sidecar, sourceRecord, sourceFile.checksum, format, expectedParser, extractedTextArtifact)) return undefined;

    onPublicationStart?.();
    const page = this.#sourcePages.refreshForSource(vaultPath, sourceRecord, sourceRecordPath, job.id);
    const parserWarnings = stringArrayMetadata(sidecar.warnings);
    const warnings = page.conflict
      ? [...parserWarnings, sourcePageConflictWarning()]
      : parserWarnings;
    writeArtifactOperation(vaultPath, sourceRecord, job, format, warnings);
    return {
      sourceId: sourceRecord.id,
      created: false,
      ...(extractedTextArtifact ? { extractedTextArtifactPath: extractedTextArtifact.path } : {}),
      metadataArtifactPath: metadataArtifact.path,
      textCharacterCount: numberMetadata(sidecar.textCharacterCount),
      textCoverage: isTextCoverage(sidecar.textCoverage) ? sidecar.textCoverage : "none",
      needsOcr: sidecar.needsOcr === true,
      agentTextReady: sidecar.agentTextReady === true,
      warnings,
      sourcePageUpdated: page.updated,
      sourcePageConflict: page.conflict
    };
  }

  persist(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    extraction: NormalizedParserExtraction,
    onPublicationStart?: () => void
  ): DocumentParseSourceResult {
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    const sourceFile = verifyReadableSourceFile(vaultPath, parsedSource);
    if (
      !Number.isSafeInteger(extraction.textCharacterCount) ||
      extraction.textCharacterCount < 0 ||
      extraction.textCharacterCount > extraction.text.length
    ) {
      throw new PigeDomainError("parser.invalid_extraction", "The parser returned inconsistent extracted-text metadata.");
    }
    assertNoReservedMetadataKeys(extraction.sidecarMetadata, SIDECAR_RESERVED_KEYS, "sidecar");
    assertNoReservedMetadataKeys(extraction.sourceMetadata, SOURCE_METADATA_RESERVED_KEYS, "source");
    onPublicationStart?.();
    const dateBucket = sourceDateBucket(parsedSource.id);
    const extractedTextArtifactPath = extraction.text.length > 0
      ? ["artifacts", "extracted-text", ...dateBucket, `${parsedSource.id}.txt`].join("/")
      : undefined;
    const metadataArtifactPath = [
      "artifacts",
      "metadata",
      ...dateBucket,
      `${parsedSource.id}.${extraction.format}.json`
    ].join("/");
    const now = new Date().toISOString();

    if (extractedTextArtifactPath) {
      writeFileAtomic(resolveVaultRelativePath(vaultPath, extractedTextArtifactPath), `${extraction.text.trimEnd()}\n`);
    }
    const extractedTextChecksum = extractedTextArtifactPath
      ? checksumFile(resolveVaultRelativePath(vaultPath, extractedTextArtifactPath))
      : undefined;
    const metadataAbsolutePath = resolveVaultRelativePath(vaultPath, metadataArtifactPath);
    writeJsonAtomic(metadataAbsolutePath, {
      ...extraction.sidecarMetadata,
      schemaVersion: 1,
      artifactId: metadataArtifactId(parsedSource.id, extraction.format),
      sourceId: parsedSource.id,
      kind: `${extraction.format}_parse_metadata`,
      createdAt: now,
      parser: extraction.parser,
      sourceChecksum: sourceFile.checksum,
      ...(extractedTextChecksum ? { extractedTextChecksum } : {}),
      textCharacterCount: extraction.textCharacterCount,
      textCoverage: extraction.textCoverage,
      truncated: extraction.truncated,
      needsOcr: extraction.needsOcr,
      agentTextReady: extraction.agentTextReady,
      ocrCandidateLocators: extraction.ocrCandidateLocators,
      warnings: extraction.warnings
    });

    const extractedTextIntegrity = extractedTextArtifactPath
      ? fileIntegrity(resolveVaultRelativePath(vaultPath, extractedTextArtifactPath))
      : undefined;
    const metadataIntegrity = fileIntegrity(metadataAbsolutePath);
    const artifacts = upsertArtifacts(
      parsedSource,
      extraction.format,
      extractedTextArtifactPath,
      extractedTextIntegrity,
      metadataArtifactPath,
      metadataIntegrity
    );
    const updatedSource = SourceRecordSchema.parse({
      ...parsedSource,
      artifacts,
      metadata: {
        ...parsedSource.metadata,
        ...extraction.sourceMetadata,
        ...(extraction.title && typeof parsedSource.metadata.title !== "string" ? { title: extraction.title } : {}),
        parserRequired: true,
        parserStatus: extraction.needsOcr ? "parsed_needs_ocr" : "parsed",
        parserFormat: extraction.format,
        parserId: extraction.parser.id,
        parserEngine: extraction.parser.engine,
        parserVersion: extraction.parser.version,
        parserJobId: job.id,
        textCharacterCount: extraction.textCharacterCount,
        textCoverage: extraction.textCoverage,
        parserTruncated: extraction.truncated,
        needsOcr: extraction.needsOcr,
        agentTextReady: extraction.agentTextReady,
        ocrCandidateLocators: extraction.ocrCandidateLocators,
        parserWarnings: extraction.warnings
      },
      updatedAt: now
    });
    const page = this.#sourcePages.refreshForSource(
      vaultPath,
      updatedSource,
      sourceRecordPath,
      job.id,
      parsedSource
    );
    const warnings = page.conflict ? [...extraction.warnings, sourcePageConflictWarning()] : extraction.warnings;
    writeArtifactOperation(vaultPath, updatedSource, job, extraction.format, warnings);

    return {
      sourceId: parsedSource.id,
      created: true,
      ...(extractedTextArtifactPath ? { extractedTextArtifactPath } : {}),
      metadataArtifactPath,
      textCharacterCount: extraction.textCharacterCount,
      textCoverage: extraction.textCoverage,
      needsOcr: extraction.needsOcr,
      agentTextReady: extraction.agentTextReady,
      warnings,
      sourcePageUpdated: page.updated,
      sourcePageConflict: page.conflict
    };
  }
}

function writeArtifactOperation(
  vaultPath: string,
  sourceRecord: SourceRecord,
  job: JobRecord,
  format: NormalizedParserExtraction["format"],
  warnings: readonly string[]
): OperationRecord {
  const operationId = createArtifactOperationId(job.id, sourceRecord.id, format);
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1];
  if (!dateKey) throw new PigeDomainError("parser.operation_id_invalid", "The parser operation ID is invalid.");
  const operationPath = [".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`].join("/");
  const absoluteOperationPath = resolveVaultRelativePath(vaultPath, operationPath);
  if (fs.existsSync(absoluteOperationPath)) {
    return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(absoluteOperationPath, "utf8")));
  }

  const targetIds = new Set([
    extractedTextArtifactId(sourceRecord.id, format),
    metadataArtifactId(sourceRecord.id, format)
  ]);
  const operation = OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: job.id,
    createdAt: new Date().toISOString(),
    actor: { kind: "system", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    permissionDecisionIds: [],
    kind: "create_artifact",
    targetRefs: sourceRecord.artifacts
      .filter((artifact) => targetIds.has(artifact.id))
      .map((artifact) => ({ kind: "artifact", id: artifact.id, path: artifact.path })),
    sourceRefs: [
      { kind: "job", id: job.id },
      { kind: "source", id: sourceRecord.id }
    ],
    summary: `Created local ${format.toUpperCase()} parse artifacts for source ${sourceRecord.id}.`,
    reversible: "best_effort",
    rollbackHint: "Remove derived parser artifacts only after confirming the Source Record no longer references them.",
    warnings: Array.from(new Set(warnings)).slice(0, 64)
  });
  writeJsonAtomic(absoluteOperationPath, operation);
  return operation;
}

function createArtifactOperationId(jobId: string, sourceId: string, format: string): string {
  const dateKey = /^job_(\d{8})_/.exec(jobId)?.[1] ?? /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) throw new PigeDomainError("parser.operation_id_invalid", "The parser operation has no valid date bucket.");
  const suffix = createHash("sha256").update(`${jobId}:${sourceId}:${format}-artifacts`).digest("hex").slice(0, 12);
  return `op_${dateKey}_${suffix}`;
}

function upsertArtifacts(
  sourceRecord: SourceRecord,
  format: NormalizedParserExtraction["format"],
  extractedTextPath: string | undefined,
  extractedTextIntegrity: FileIntegrity | undefined,
  metadataPath: string,
  metadataIntegrity: FileIntegrity
): SourceRecord["artifacts"] {
  const replacedIds = new Set([
    extractedTextArtifactId(sourceRecord.id, format),
    metadataArtifactId(sourceRecord.id, format)
  ]);
  const artifacts = sourceRecord.artifacts.filter((artifact) => !replacedIds.has(artifact.id));
  if (extractedTextPath && extractedTextIntegrity) {
    artifacts.push({
      id: extractedTextArtifactId(sourceRecord.id, format),
      kind: "extracted_text",
      path: extractedTextPath,
      ...extractedTextIntegrity
    });
  }
  artifacts.push({
    id: metadataArtifactId(sourceRecord.id, format),
    kind: "metadata",
    path: metadataPath,
    ...metadataIntegrity
  });
  return artifacts;
}

function extractedTextArtifactId(sourceId: string, format: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_${format}_text`;
}

function metadataArtifactId(sourceId: string, format: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_${format}_metadata`;
}

function sourceDateBucket(sourceId: string): [string, string] {
  const dateKey = /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) throw new PigeDomainError("parser.source_id_invalid", "The source ID has no valid date bucket.");
  return [dateKey.slice(0, 4), dateKey.slice(4, 6)];
}

function sourcePageConflictWarning(): string {
  return "The source page was edited after capture, so Pige preserved the edit and did not replace its body.";
}

function artifactFileMatches(vaultPath: string, artifact: SourceRecord["artifacts"][number]): boolean {
  if (!artifact.checksum || artifact.size === undefined) return false;
  const absolutePath = resolveVaultRelativePath(vaultPath, artifact.path);
  try {
    const stat = fs.statSync(absolutePath);
    return stat.isFile() && stat.size === artifact.size && checksumFile(absolutePath) === artifact.checksum;
  } catch {
    return false;
  }
}

function fileIntegrity(filePath: string): FileIntegrity {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new PigeDomainError("parser.artifact_missing", "A parser artifact was not written as a regular file.");
  return { checksum: checksumFile(filePath), size: stat.size };
}

function checksumFile(filePath: string): string {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_PARSER_SIDECAR_BYTES) return undefined;
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isReusableSidecar(
  sidecar: Record<string, unknown> | undefined,
  sourceRecord: SourceRecord,
  sourceChecksum: string,
  format: NormalizedParserExtraction["format"],
  expectedParser: ParserDescriptor,
  extractedTextArtifact: SourceRecord["artifacts"][number] | undefined
): sidecar is Record<string, unknown> {
  if (!sidecar) return false;
  const parser = isRecord(sidecar.parser) ? sidecar.parser : undefined;
  if (
    sidecar.schemaVersion !== 1 ||
    sidecar.artifactId !== metadataArtifactId(sourceRecord.id, format) ||
    sidecar.sourceId !== sourceRecord.id ||
    sidecar.kind !== `${format}_parse_metadata` ||
    sidecar.sourceChecksum !== sourceChecksum ||
    !parser ||
    parser.id !== expectedParser.id ||
    parser.engine !== expectedParser.engine ||
    parser.version !== expectedParser.version ||
    sourceRecord.metadata.parserFormat !== format ||
    sourceRecord.metadata.parserId !== expectedParser.id ||
    sourceRecord.metadata.parserEngine !== expectedParser.engine ||
    sourceRecord.metadata.parserVersion !== expectedParser.version ||
    !isTextCoverage(sidecar.textCoverage) ||
    typeof sidecar.textCharacterCount !== "number" ||
    !Number.isSafeInteger(sidecar.textCharacterCount) ||
    sidecar.textCharacterCount < 0 ||
    typeof sidecar.truncated !== "boolean" ||
    typeof sidecar.needsOcr !== "boolean" ||
    typeof sidecar.agentTextReady !== "boolean" ||
    !Array.isArray(sidecar.warnings) ||
    sidecar.warnings.some((warning) => typeof warning !== "string")
  ) {
    return false;
  }
  if (format === "pptx" && sidecar.mediaTargetSchemaVersion !== OFFICE_MEDIA_TARGET_SCHEMA_VERSION) {
    return false;
  }
  if (!extractedTextArtifact) {
    return sidecar.extractedTextChecksum === undefined && sidecar.textCharacterCount === 0;
  }
  return typeof sidecar.extractedTextChecksum === "string" &&
    sidecar.extractedTextChecksum === extractedTextArtifact.checksum;
}

function assertNoReservedMetadataKeys(
  metadata: Readonly<Record<string, unknown>>,
  reservedKeys: ReadonlySet<string>,
  location: string
): void {
  const conflict = Object.keys(metadata).find((key) => reservedKeys.has(key));
  if (conflict) {
    throw new PigeDomainError("parser.reserved_metadata_key", `The parser returned a reserved ${location} metadata key.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextCoverage(value: unknown): value is ParserTextCoverage {
  return value === "none" || value === "low" || value === "medium" || value === "high";
}

function numberMetadata(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArrayMetadata(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function resolveVaultRelativePath(vaultPath: string, relativePath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(vaultPath, ...relativePath.split("/"));
  if (resolvedPath !== resolvedVault && !resolvedPath.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new PigeDomainError("parser.path_outside_vault", "The parser path escapes the active vault.");
  }
  return resolvedPath;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFileAtomic(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, value, "utf8");
  fs.renameSync(temporaryPath, filePath);
}
