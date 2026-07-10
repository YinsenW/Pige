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
import { MACOS_VISION_OCR_ADAPTER_VERSION, type NativeOcrResult } from "./ocr-types";
import { SourcePageService } from "./source-page-service";
import { tryVerifyReadableSourceFileAsync, verifyReadableSourceFileAsync } from "./source-file-access";

export interface OcrSourceResult {
  readonly sourceId: string;
  readonly created: boolean;
  readonly ocrTextArtifactPath?: string;
  readonly metadataArtifactPath: string;
  readonly textCharacterCount: number;
  readonly confidence?: number;
  readonly agentTextReady: boolean;
  readonly warnings: readonly string[];
  readonly sourcePageUpdated: boolean;
  readonly sourcePageConflict: boolean;
}

interface FileIntegrity {
  readonly checksum: string;
  readonly size: number;
}

const MAX_OCR_SIDECAR_BYTES = 32 * 1024 * 1024;

export class OcrArtifactService {
  readonly #sourcePages: SourcePageService;

  constructor(sourcePages = new SourcePageService()) {
    this.#sourcePages = sourcePages;
  }

  async readExisting(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord
  ): Promise<OcrSourceResult | undefined> {
    if (sourceRecord.kind !== "image_file") return undefined;
    const sourceFile = await tryVerifyReadableSourceFileAsync(vaultPath, sourceRecord);
    if (!sourceFile) return undefined;
    const metadataArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === ocrMetadataArtifactId(sourceRecord.id) && artifact.kind === "metadata"
    );
    if (!metadataArtifact || !await artifactFileMatches(vaultPath, metadataArtifact)) return undefined;
    const textArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === ocrTextArtifactId(sourceRecord.id) && artifact.kind === "ocr"
    );
    if (textArtifact && !await artifactFileMatches(vaultPath, textArtifact)) return undefined;
    const sidecar = await readJsonObject(resolveVaultRelativePath(vaultPath, metadataArtifact.path));
    if (!isReusableSidecar(sidecar, sourceRecord, sourceFile.checksum, textArtifact)) return undefined;

    const page = this.#sourcePages.refreshForSource(vaultPath, sourceRecord, sourceRecordPath, job.id);
    const storedWarnings = stringArray(sidecar.warnings);
    const warnings = page.conflict ? [...storedWarnings, sourcePageConflictWarning()] : storedWarnings;
    writeOcrOperation(vaultPath, sourceRecord, job, warnings);
    const confidence = normalizedNumber(sidecar.confidence);
    return {
      sourceId: sourceRecord.id,
      created: false,
      ...(textArtifact ? { ocrTextArtifactPath: textArtifact.path } : {}),
      metadataArtifactPath: metadataArtifact.path,
      textCharacterCount: nonNegativeInteger(sidecar.textCharacterCount),
      ...(confidence !== undefined ? { confidence } : {}),
      agentTextReady: Boolean(textArtifact && sidecar.agentTextReady === true),
      warnings,
      sourcePageUpdated: page.updated,
      sourcePageConflict: page.conflict
    };
  }

  async persist(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    result: NativeOcrResult
  ): Promise<OcrSourceResult> {
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    if (parsedSource.kind !== "image_file") {
      throw new PigeDomainError("ocr.source_unsupported", "This OCR adapter accepts preserved image sources only.");
    }
    const sourceFile = await verifyReadableSourceFileAsync(vaultPath, parsedSource);
    if (result.adapterVersion !== MACOS_VISION_OCR_ADAPTER_VERSION || result.text !== result.blocks.map((block) => block.text).join("\n")) {
      throw new PigeDomainError("ocr.invalid_result", "The OCR adapter returned inconsistent text or version metadata.");
    }

    const dateBucket = sourceDateBucket(parsedSource.id);
    const textArtifactPath = result.text.length > 0
      ? ["artifacts", "ocr", ...dateBucket, `${parsedSource.id}.txt`].join("/")
      : undefined;
    const metadataArtifactPath = ["artifacts", "metadata", ...dateBucket, `${parsedSource.id}.ocr.json`].join("/");
    const now = new Date().toISOString();
    if (textArtifactPath) {
      await writeFileAtomicAsync(resolveVaultRelativePath(vaultPath, textArtifactPath), `${result.text.trimEnd()}\n`);
    }
    const textIntegrity = textArtifactPath
      ? await fileIntegrity(resolveVaultRelativePath(vaultPath, textArtifactPath), "ocr.artifact_missing")
      : undefined;
    const units = createUnits(result);
    const metadataAbsolutePath = resolveVaultRelativePath(vaultPath, metadataArtifactPath);
    await writeJsonAtomicAsync(metadataAbsolutePath, {
      schemaVersion: 1,
      artifactId: ocrMetadataArtifactId(parsedSource.id),
      sourceId: parsedSource.id,
      kind: "image_ocr_metadata",
      createdAt: now,
      adapter: { id: "macos_vision_ocr", version: result.adapterVersion },
      engine: { id: result.engine, version: result.engineVersion },
      sourceChecksum: sourceFile.checksum,
      ...(textIntegrity ? { ocrTextChecksum: textIntegrity.checksum } : {}),
      textCharacterCount: result.text.length,
      blockCount: result.blocks.length,
      ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
      languageHints: result.languageHints,
      image: result.image,
      agentTextReady: Boolean(textArtifactPath),
      units,
      warnings: result.warnings
    });
    const metadataIntegrity = await fileIntegrity(metadataAbsolutePath, "ocr.artifact_missing");
    const artifacts = upsertOcrArtifacts(parsedSource, textArtifactPath, textIntegrity, metadataArtifactPath, metadataIntegrity);
    const updatedSource = SourceRecordSchema.parse({
      ...parsedSource,
      artifacts,
      metadata: {
        ...parsedSource.metadata,
        parserRequired: true,
        parserStatus: textArtifactPath ? "ocr_completed" : "ocr_completed_empty",
        ocrStatus: textArtifactPath ? "completed" : "completed_empty",
        ocrAdapterId: "macos_vision_ocr",
        ocrAdapterVersion: result.adapterVersion,
        ocrEngine: result.engine,
        ocrEngineVersion: result.engineVersion,
        ocrJobId: job.id,
        ocrTextCharacterCount: result.text.length,
        ocrBlockCount: result.blocks.length,
        ...(result.confidence !== undefined ? { ocrConfidence: result.confidence } : {}),
        ocrLanguageHints: result.languageHints,
        ocrWarnings: result.warnings,
        ocrImageMetadata: result.image,
        needsOcr: false,
        agentTextReady: Boolean(textArtifactPath),
        ocrCompletedAt: now
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
    const warnings = page.conflict ? [...result.warnings, sourcePageConflictWarning()] : result.warnings;
    writeOcrOperation(vaultPath, updatedSource, job, warnings);
    return {
      sourceId: parsedSource.id,
      created: true,
      ...(textArtifactPath ? { ocrTextArtifactPath: textArtifactPath } : {}),
      metadataArtifactPath,
      textCharacterCount: result.text.length,
      ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
      agentTextReady: Boolean(textArtifactPath),
      warnings,
      sourcePageUpdated: page.updated,
      sourcePageConflict: page.conflict
    };
  }
}

function createUnits(result: NativeOcrResult): readonly Record<string, unknown>[] {
  let characterStart = 0;
  return result.blocks.map((block, index) => {
    const characterEnd = characterStart + block.text.length;
    const unit = {
      locator: `ocr:block:${index + 1}`,
      characterStart,
      characterEnd,
      kind: block.kind,
      confidence: block.confidence,
      boundingBox: block.boundingBox,
      languageHints: block.languageHints,
      isTitle: block.isTitle
    };
    characterStart = characterEnd + 1;
    return unit;
  });
}

function upsertOcrArtifacts(
  sourceRecord: SourceRecord,
  textPath: string | undefined,
  textIntegrity: FileIntegrity | undefined,
  metadataPath: string,
  metadataIntegrity: FileIntegrity
): SourceRecord["artifacts"] {
  const replacedIds = new Set([ocrTextArtifactId(sourceRecord.id), ocrMetadataArtifactId(sourceRecord.id)]);
  const artifacts = sourceRecord.artifacts.filter((artifact) => !replacedIds.has(artifact.id));
  if (textPath && textIntegrity) {
    artifacts.push({ id: ocrTextArtifactId(sourceRecord.id), kind: "ocr", path: textPath, ...textIntegrity });
  }
  artifacts.push({ id: ocrMetadataArtifactId(sourceRecord.id), kind: "metadata", path: metadataPath, ...metadataIntegrity });
  return artifacts;
}

function writeOcrOperation(
  vaultPath: string,
  sourceRecord: SourceRecord,
  job: JobRecord,
  warnings: readonly string[]
): OperationRecord {
  const operationId = createOcrOperationId(job.id, sourceRecord.id);
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.operation_id_invalid", "The OCR operation ID is invalid.");
  const operationPath = [".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`].join("/");
  const absoluteOperationPath = resolveVaultRelativePath(vaultPath, operationPath);
  if (fs.existsSync(absoluteOperationPath)) {
    return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(absoluteOperationPath, "utf8")));
  }
  const targetIds = new Set([ocrTextArtifactId(sourceRecord.id), ocrMetadataArtifactId(sourceRecord.id)]);
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
    sourceRefs: [{ kind: "job", id: job.id }, { kind: "source", id: sourceRecord.id }],
    summary: `Created local image OCR artifacts for source ${sourceRecord.id}.`,
    reversible: "best_effort",
    rollbackHint: "Remove derived OCR artifacts only after confirming the Source Record no longer references them.",
    warnings: Array.from(new Set(warnings)).slice(0, 64)
  });
  writeJsonAtomic(absoluteOperationPath, operation);
  return operation;
}

function createOcrOperationId(jobId: string, sourceId: string): string {
  const dateKey = /^job_(\d{8})_/.exec(jobId)?.[1] ?? /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.operation_id_invalid", "The OCR operation has no valid date bucket.");
  const suffix = createHash("sha256").update(`${jobId}:${sourceId}:ocr-artifacts`).digest("hex").slice(0, 12);
  return `op_${dateKey}_${suffix}`;
}

function isReusableSidecar(
  sidecar: Record<string, unknown> | undefined,
  sourceRecord: SourceRecord,
  sourceChecksum: string,
  textArtifact: SourceRecord["artifacts"][number] | undefined
): sidecar is Record<string, unknown> {
  if (!sidecar) return false;
  const adapter = isRecord(sidecar.adapter) ? sidecar.adapter : undefined;
  const engine = isRecord(sidecar.engine) ? sidecar.engine : undefined;
  if (
    sidecar.schemaVersion !== 1 ||
    sidecar.artifactId !== ocrMetadataArtifactId(sourceRecord.id) ||
    sidecar.sourceId !== sourceRecord.id ||
    sidecar.kind !== "image_ocr_metadata" ||
    sidecar.sourceChecksum !== sourceChecksum ||
    adapter?.id !== "macos_vision_ocr" ||
    adapter.version !== MACOS_VISION_OCR_ADAPTER_VERSION ||
    (engine?.id !== "macos_vision_document" && engine?.id !== "macos_vision_text") ||
    typeof engine.version !== "string" ||
    !Number.isSafeInteger(sidecar.textCharacterCount) ||
    (sidecar.textCharacterCount as number) < 0 ||
    !Number.isSafeInteger(sidecar.blockCount) ||
    (sidecar.blockCount as number) < 0 ||
    typeof sidecar.agentTextReady !== "boolean" ||
    !Array.isArray(sidecar.units) ||
    !Array.isArray(sidecar.warnings) ||
    sidecar.warnings.some((warning) => typeof warning !== "string")
  ) return false;
  if (!textArtifact) {
    return sidecar.ocrTextChecksum === undefined && sidecar.textCharacterCount === 0 && sidecar.agentTextReady === false;
  }
  return sidecar.ocrTextChecksum === textArtifact.checksum && sidecar.agentTextReady === true;
}

function ocrTextArtifactId(sourceId: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_ocr_text`;
}

function ocrMetadataArtifactId(sourceId: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_ocr_metadata`;
}

function sourceDateBucket(sourceId: string): [string, string] {
  const dateKey = /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.source_id_invalid", "The source ID has no valid date bucket.");
  return [dateKey.slice(0, 4), dateKey.slice(4, 6)];
}

async function regularFileMatches(filePath: string, integrity: FileIntegrity): Promise<boolean> {
  try {
    const stat = await fs.promises.lstat(filePath);
    return stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size === integrity.size &&
      await checksumFile(filePath) === integrity.checksum;
  } catch {
    return false;
  }
}

async function artifactFileMatches(vaultPath: string, artifact: SourceRecord["artifacts"][number]): Promise<boolean> {
  if (!artifact.checksum || artifact.size === undefined) return false;
  return regularFileMatches(resolveVaultRelativePath(vaultPath, artifact.path), { checksum: artifact.checksum, size: artifact.size });
}

async function fileIntegrity(filePath: string, errorCode: string): Promise<FileIntegrity> {
  const stat = await fs.promises.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new PigeDomainError(errorCode, "An OCR artifact was not written as a regular file.");
  }
  return { checksum: await checksumFile(filePath), size: stat.size };
}

async function checksumFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk as Buffer);
  }
  return `sha256:${hash.digest("hex")}`;
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_OCR_SIDECAR_BYTES) return undefined;
    const value = JSON.parse(await fs.promises.readFile(filePath, "utf8")) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function sourcePageConflictWarning(): string {
  return "The source page was edited after capture, so Pige preserved the edit and did not replace its body.";
}

function nonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function normalizedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveVaultRelativePath(vaultPath: string, relativePath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(vaultPath, ...relativePath.split("/"));
  if (resolvedPath !== resolvedVault && !resolvedPath.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The OCR path escapes the active vault.");
  }
  return resolvedPath;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonAtomicAsync(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomicAsync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFileAtomic(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, value, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

async function writeFileAtomicAsync(filePath: string, value: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, value, "utf8");
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}
