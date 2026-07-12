import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import type {
  CaptureFileRejection,
  CaptureFilesSubmitResult,
  CaptureSubmitResult,
  SubmitFilesCaptureRequest,
  SubmitTextCaptureRequest,
  SubmitUrlCaptureRequest,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  ConversationEventSchema,
  JobRecordSchema,
  SourceRecordSchema,
  type ConversationEvent,
  type JobRecord,
  type SourceKind,
  type SourceRecord
} from "@pige/schemas";
import { redactSensitiveUrl, SourceFetchService, type SourceFetchSnapshot } from "./source-fetch-service";

export interface CaptureVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface SourceFetchPort {
  readonly fetchSnapshot: (url: string) => Promise<SourceFetchSnapshot>;
}

export interface AgentTurnFilePreservationBinding {
  readonly jobId: string;
  readonly sourceId: string;
}

const SHORT_CONVERSATION_TEXT_LIMIT = 500;
const FILE_KIND_BY_EXTENSION = new Map<string, SourceKind>([
  [".md", "markdown_file"],
  [".markdown", "markdown_file"],
  [".txt", "plain_text_file"],
  [".pdf", "pdf_file"],
  [".docx", "docx_file"],
  [".pptx", "pptx_file"],
  [".png", "image_file"],
  [".jpg", "image_file"],
  [".jpeg", "image_file"],
  [".webp", "image_file"],
  [".gif", "image_file"],
  [".tif", "image_file"],
  [".tiff", "image_file"],
  [".bmp", "image_file"]
]);

export class CaptureService {
  readonly #vaults: CaptureVaultPort;
  readonly #sourceFetch: SourceFetchPort;

  constructor(vaults: CaptureVaultPort, sourceFetch: SourceFetchPort = new SourceFetchService()) {
    this.#vaults = vaults;
    this.#sourceFetch = sourceFetch;
  }

  submitText(request: SubmitTextCaptureRequest): CaptureSubmitResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!this.#vaults.current() || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }

    const text = request.text;
    if (!text.trim()) {
      throw new PigeDomainError("capture_empty", "Capture text cannot be empty.");
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const dateKey = timestamp.slice(0, 10).replaceAll("-", "");
    const monthKey = timestamp.slice(0, 7).replace("-", "/");
    const captureId = createDatedId("cap", dateKey);
    const sourceId = createDatedId("src", dateKey);
    const jobId = createDatedId("job", dateKey);
    const eventId = createDatedId("evt", dateKey);
    const conversationId = `conv_${dateKey}`;
    const textBuffer = Buffer.from(text, "utf8");
    const checksum = `sha256:${createHash("sha256").update(textBuffer).digest("hex")}`;
    const managedTextPath = vaultRelativePath("raw", "text", monthKey, `${sourceId}.txt`);
    const sourceRecordPath = vaultRelativePath(".pige", "source-records", monthKey, `${sourceId}.json`);
    const jobRecordPath = vaultRelativePath(".pige", "jobs", monthKey, `${jobId}.json`);
    const conversationPath = vaultRelativePath(".pige", "conversations", monthKey, `${conversationId}.jsonl`);

    writeFileAtomic(resolveVaultPath(vaultPath, managedTextPath), text);

    const sourceRecord: SourceRecord = SourceRecordSchema.parse({
      id: sourceId,
      kind: "text",
      storageStrategy: "copy_to_source_library",
      managedCopy: {
        path: managedTextPath,
        checksum,
        size: textBuffer.byteLength
      },
      artifacts: [],
      metadata: {
        inputKind: request.inputKind,
        userIntent: request.userIntent,
        locale: request.locale,
        captureId
      },
      createdAt: timestamp,
      updatedAt: timestamp
    });
    writeJsonAtomic(resolveVaultPath(vaultPath, sourceRecordPath), sourceRecord);

    const conversationEvent: ConversationEvent = ConversationEventSchema.parse({
      id: eventId,
      conversationId,
      type: "capture_reference",
      createdAt: timestamp,
      sourceId,
      captureId,
      ...(text.length <= SHORT_CONVERSATION_TEXT_LIMIT ? { text } : { textPreview: createTextPreview(text) })
    });
    appendConversationEvent(resolveVaultPath(vaultPath, conversationPath), conversationEvent);

    const jobRecord: JobRecord = JobRecordSchema.parse({
      id: jobId,
      class: "capture",
      state: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      sourceId,
      captureId,
      conversationEventId: eventId,
      message: "Text capture preserved and queued for later processing."
    });
    writeJsonAtomic(resolveVaultPath(vaultPath, jobRecordPath), jobRecord);

    return {
      status: "queued",
      captureId,
      sourceId,
      jobId,
      conversationEventId: eventId,
      preservedAt: timestamp
    };
  }

  async submitUrl(request: SubmitUrlCaptureRequest): Promise<CaptureSubmitResult> {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!this.#vaults.current() || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }

    const snapshot = await this.#sourceFetch.fetchSnapshot(request.url);
    const now = new Date();
    const timestamp = now.toISOString();
    const dateKey = timestamp.slice(0, 10).replaceAll("-", "");
    const monthKey = timestamp.slice(0, 7).replace("-", "/");
    const captureId = createDatedId("cap", dateKey);
    const sourceId = createDatedId("src", dateKey);
    const jobId = createDatedId("job", dateKey);
    const eventId = createDatedId("evt", dateKey);
    const conversationId = `conv_${dateKey}`;
    const rawBuffer = Buffer.from(snapshot.rawContent, "utf8");
    const extractedBuffer = Buffer.from(snapshot.extractedText, "utf8");
    const rawChecksum = `sha256:${createHash("sha256").update(rawBuffer).digest("hex")}`;
    const extractedChecksum = `sha256:${createHash("sha256").update(extractedBuffer).digest("hex")}`;
    const rawSnapshotExtension = snapshot.contentType === "text/plain" ? "txt" : "html";
    const rawSnapshotPath = vaultRelativePath("raw", "web", monthKey, `${sourceId}.${rawSnapshotExtension}`);
    const extractedTextPath = vaultRelativePath("artifacts", "web", monthKey, `${sourceId}.txt`);
    const sourceRecordPath = vaultRelativePath(".pige", "source-records", monthKey, `${sourceId}.json`);
    const jobRecordPath = vaultRelativePath(".pige", "jobs", monthKey, `${jobId}.json`);
    const conversationPath = vaultRelativePath(".pige", "conversations", monthKey, `${conversationId}.jsonl`);
    const displayName = createUrlDisplayName(snapshot);
    const safeOriginalUrl = redactSensitiveUrl(snapshot.originalUrl);
    const safeFinalUrl = redactSensitiveUrl(snapshot.finalUrl);
    const safeCanonicalUrl = snapshot.canonicalUrl ? normalizeCapturedHttpUrl(snapshot.canonicalUrl) : undefined;
    const safeImageReferences = (snapshot.imageReferences ?? [])
      .map(normalizeCapturedHttpUrl)
      .filter((value): value is string => Boolean(value))
      .slice(0, 64);
    const title = normalizeCapturedMetadata(snapshot.title, 240);
    const byline = normalizeCapturedMetadata(snapshot.byline, 240);
    const siteName = normalizeCapturedMetadata(snapshot.siteName, 240);
    const sourceLanguage = normalizeCapturedMetadata(snapshot.language, 35);
    const publishedTime = normalizeCapturedMetadata(snapshot.publishedTime, 240);
    const excerpt = normalizeCapturedMetadata(snapshot.excerpt, 500);
    const extractionWarnings = snapshot.warnings
      .map((warning) => normalizeCapturedMetadata(warning, 120))
      .filter((warning): warning is string => Boolean(warning))
      .filter((warning, index, all) => all.indexOf(warning) === index)
      .slice(0, 32);

    writeFileAtomic(resolveVaultPath(vaultPath, rawSnapshotPath), snapshot.rawContent);
    writeFileAtomic(resolveVaultPath(vaultPath, extractedTextPath), snapshot.extractedText);

    const sourceRecord: SourceRecord = SourceRecordSchema.parse({
      id: sourceId,
      kind: "url",
      storageStrategy: "copy_to_source_library",
      original: {
        uri: safeOriginalUrl,
        displayName,
        checksum: rawChecksum
      },
      managedCopy: {
        path: rawSnapshotPath,
        checksum: rawChecksum,
        size: rawBuffer.byteLength
      },
      artifacts: [
        {
          id: `art_${sourceId}_text`,
          kind: "extracted_text",
          path: extractedTextPath,
          checksum: extractedChecksum,
          size: extractedBuffer.byteLength
        }
      ],
      metadata: {
        inputKind: request.inputKind,
        userIntent: request.userIntent,
        locale: request.locale,
        captureId,
        originalUrl: safeOriginalUrl,
        finalUrl: safeFinalUrl,
        ...(safeCanonicalUrl ? { canonicalUrl: safeCanonicalUrl } : {}),
        contentType: snapshot.contentType,
        ...(snapshot.charset ? { charset: snapshot.charset } : {}),
        ...(title ? { title } : {}),
        ...(byline ? { byline } : {}),
        ...(siteName ? { siteName } : {}),
        ...(sourceLanguage ? { sourceLanguage } : {}),
        ...(publishedTime ? { publishedTime } : {}),
        ...(excerpt ? { excerpt } : {}),
        ...(safeImageReferences.length > 0 ? { imageReferences: safeImageReferences } : {}),
        ...(snapshot.extraction ? {
          webExtraction: {
            parserId: normalizeCapturedMetadata(snapshot.extraction.parserId, 80) ?? "unknown",
            engine: normalizeCapturedMetadata(snapshot.extraction.engine, 120) ?? "unknown",
            version: normalizeCapturedMetadata(snapshot.extraction.version, 80) ?? "unknown",
            mode: normalizeCapturedMetadata(snapshot.extraction.mode, 80) ?? "unknown",
            textCharacterCount: snapshot.extraction.textCharacterCount,
            ...(snapshot.extraction.elementCount !== undefined ? { elementCount: snapshot.extraction.elementCount } : {}),
            truncated: snapshot.extraction.truncated
          }
        } : {}),
        extractionWarnings,
        extractedTextSize: extractedBuffer.byteLength
      },
      createdAt: timestamp,
      updatedAt: timestamp
    });
    writeJsonAtomic(resolveVaultPath(vaultPath, sourceRecordPath), sourceRecord);

    const conversationEvent: ConversationEvent = ConversationEventSchema.parse({
      id: eventId,
      conversationId,
      type: "capture_reference",
      createdAt: timestamp,
      sourceId,
      captureId,
      displayName,
      sourceKind: "url"
    });
    appendConversationEvent(resolveVaultPath(vaultPath, conversationPath), conversationEvent);

    const jobRecord: JobRecord = JobRecordSchema.parse({
      id: jobId,
      class: "capture",
      state: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      sourceId,
      captureId,
      conversationEventId: eventId,
      message: "URL capture fetched, preserved, and queued for later processing."
    });
    writeJsonAtomic(resolveVaultPath(vaultPath, jobRecordPath), jobRecord);

    return {
      status: "queued",
      captureId,
      sourceId,
      jobId,
      conversationEventId: eventId,
      preservedAt: timestamp
    };
  }

  async submitFiles(request: SubmitFilesCaptureRequest): Promise<CaptureFilesSubmitResult> {
    return this.#preserveFiles(request, true);
  }

  async preserveFilesForAgentTurn(
    request: SubmitFilesCaptureRequest,
    binding?: AgentTurnFilePreservationBinding
  ): Promise<CaptureFilesSubmitResult> {
    if (
      binding &&
      (!/^job_\d{8}_[a-z0-9]{8,}$/u.test(binding.jobId) ||
        !/^src_\d{8}_[a-z0-9]{8,}$/u.test(binding.sourceId) ||
        request.filePaths.length !== 1)
    ) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The source preservation binding is invalid.");
    }
    return this.#preserveFiles(request, false, binding);
  }

  async #preserveFiles(
    request: SubmitFilesCaptureRequest,
    createCaptureJobs: boolean,
    agentTurnBinding?: AgentTurnFilePreservationBinding
  ): Promise<CaptureFilesSubmitResult> {
    const vaultPath = this.#vaults.activeVaultPath();
    const vault = this.#vaults.current();
    if (!vault || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    const storageStrategy = vault.defaultSourceStorageStrategy;

    const uniqueFilePaths = Array.from(new Set(request.filePaths.map((filePath) => filePath.trim()))).filter(Boolean);
    if (uniqueFilePaths.length === 0) {
      return createRejectedFileResult([{ displayName: "Unknown file", reason: "empty_path" }]);
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const dateKey = timestamp.slice(0, 10).replaceAll("-", "");
    const monthKey = timestamp.slice(0, 7).replace("-", "/");
    const captureId = createDatedId("cap", dateKey);
    const conversationId = `conv_${dateKey}`;
    const conversationPath = vaultRelativePath(".pige", "conversations", monthKey, `${conversationId}.jsonl`);
    const sourceIds: string[] = [];
    const jobIds: string[] = [];
    const conversationEventIds: string[] = [];
    const rejectedFiles: CaptureFileRejection[] = [];

    for (const filePath of uniqueFilePaths) {
      const displayName = path.basename(filePath) || "Unknown file";
      const extension = path.extname(displayName).toLowerCase();
      const sourceKind = FILE_KIND_BY_EXTENSION.get(extension);
      if (!sourceKind) {
        rejectedFiles.push({ displayName, reason: "unsupported_type" });
        continue;
      }

      const fileState = inspectRegularFile(filePath);
      if (fileState !== "ok") {
        rejectedFiles.push({ displayName, reason: fileState });
        continue;
      }

      const sourceId = agentTurnBinding?.sourceId ?? createDatedId("src", dateKey);
      const jobId = createDatedId("job", dateKey);
      const eventId = createDatedId("evt", dateKey);
      const managedCopyPath = vaultRelativePath("raw", "files", monthKey, `${sourceId}${extension}`);
      const sourceRecordPath = vaultRelativePath(".pige", "source-records", monthKey, `${sourceId}.json`);
      const jobRecordPath = vaultRelativePath(".pige", "jobs", monthKey, `${jobId}.json`);

      try {
        const sourceStat = fs.statSync(filePath);
        const preserved = storageStrategy === "copy_to_source_library"
          ? await copyFileAtomicWithChecksum(filePath, resolveVaultPath(vaultPath, managedCopyPath))
          : await checksumFileWithSize(filePath);
        const sourceRecord: SourceRecord = SourceRecordSchema.parse({
          id: sourceId,
          kind: sourceKind,
          storageStrategy,
          original: {
            uri: pathToFileURL(filePath).href,
            path: filePath,
            displayName,
            lastKnownMtime: sourceStat.mtime.toISOString(),
            lastKnownSize: sourceStat.size,
            checksum: preserved.checksum
          },
          ...(storageStrategy === "copy_to_source_library" ? {
            managedCopy: {
              path: managedCopyPath,
              checksum: preserved.checksum,
              size: preserved.size
            }
          } : {}),
          artifacts: [],
          metadata: {
            inputKind: request.inputKind,
            userIntent: request.userIntent,
            locale: request.locale,
            captureId,
            ...(agentTurnBinding ? { agentTurnJobId: agentTurnBinding.jobId } : {}),
            originalExtension: extension,
            parserStatus: isTextLikeFileSource(sourceKind) ? "text_ready" : "waiting_parser_or_ocr",
            parserRequired: !isTextLikeFileSource(sourceKind)
          },
          createdAt: timestamp,
          updatedAt: timestamp
        });
        writeJsonAtomic(resolveVaultPath(vaultPath, sourceRecordPath), sourceRecord);

        const conversationEvent: ConversationEvent = ConversationEventSchema.parse({
          id: eventId,
          conversationId,
          type: createCaptureJobs ? "capture_reference" : "attachment_reference",
          createdAt: timestamp,
          sourceId,
          captureId,
          displayName,
          sourceKind
        });
        appendConversationEvent(resolveVaultPath(vaultPath, conversationPath), conversationEvent);

        if (createCaptureJobs) {
          const jobRecord: JobRecord = JobRecordSchema.parse({
            id: jobId,
            class: "capture",
            state: "queued",
            createdAt: timestamp,
            updatedAt: timestamp,
            sourceId,
            captureId,
            conversationEventId: eventId,
            message: "File capture preserved and queued for later processing."
          });
          writeJsonAtomic(resolveVaultPath(vaultPath, jobRecordPath), jobRecord);
        }

        sourceIds.push(sourceId);
        if (createCaptureJobs) jobIds.push(jobId);
        conversationEventIds.push(eventId);
      } catch {
        rejectedFiles.push({ displayName, reason: "copy_failed" });
      }
    }

    return {
      status: sourceIds.length === 0 ? "rejected" : rejectedFiles.length > 0 ? "partially_queued" : "queued",
      captureId,
      sourceIds,
      jobIds,
      conversationEventIds,
      rejectedFiles,
      preservedAt: timestamp
    };
  }
}

function isTextLikeFileSource(sourceKind: SourceKind): boolean {
  return sourceKind === "markdown_file" || sourceKind === "plain_text_file";
}

function createDatedId(prefix: "cap" | "src" | "job" | "evt", dateKey: string): string {
  return `${prefix}_${dateKey}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function createRejectedFileResult(rejectedFiles: readonly CaptureFileRejection[]): CaptureFilesSubmitResult {
  const now = new Date();
  return {
    status: "rejected",
    captureId: createDatedId("cap", now.toISOString().slice(0, 10).replaceAll("-", "")),
    sourceIds: [],
    jobIds: [],
    conversationEventIds: [],
    rejectedFiles,
    preservedAt: now.toISOString()
  };
}

function createTextPreview(text: string): string {
  return `${text.slice(0, 240).trimEnd()}...`;
}

function createUrlDisplayName(snapshot: SourceFetchSnapshot): string {
  const title = normalizeCapturedMetadata(snapshot.title, 120);
  if (title) return title;
  try {
    return new URL(snapshot.finalUrl).hostname;
  } catch {
    return snapshot.finalUrl.slice(0, 120);
  }
}

function normalizeCapturedMetadata(value: string | undefined, maxLength: number): string | undefined {
  const normalized = (value ?? "").replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeCapturedHttpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    return redactSensitiveUrl(parsed.toString());
  } catch {
    return undefined;
  }
}

function inspectRegularFile(filePath: string): "ok" | "missing" | "not_regular_file" {
  try {
    if (!path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
      return "missing";
    }

    const fileInfo = fs.lstatSync(filePath);
    if (!fileInfo.isFile()) {
      return "not_regular_file";
    }
  } catch {
    return "missing";
  }

  return "ok";
}

function appendConversationEvent(filePath: string, event: ConversationEvent): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(ConversationEventSchema.parse(event))}\n`, "utf8");
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFileAtomic(filePath: string, value: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, value);
  fs.renameSync(temporaryPath, filePath);
}

async function copyFileAtomicWithChecksum(sourcePath: string, destinationPath: string): Promise<{ checksum: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await pipeline(
      fs.createReadStream(sourcePath),
      new Transform({
        transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
          size += chunk.byteLength;
          hash.update(chunk);
          callback(null, chunk);
        }
      }),
      fs.createWriteStream(temporaryPath, { flags: "wx" })
    );
    await fs.promises.rename(temporaryPath, destinationPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }

  return {
    checksum: `sha256:${hash.digest("hex")}`,
    size
  };
}

async function checksumFileWithSize(sourcePath: string): Promise<{ checksum: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of fs.createReadStream(sourcePath, { highWaterMark: 1024 * 1024 })) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    hash.update(buffer);
  }
  return { checksum: `sha256:${hash.digest("hex")}`, size };
}

function vaultRelativePath(...segments: string[]): string {
  return segments.join("/");
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  return path.join(vaultPath, ...relativePath.split("/"));
}
