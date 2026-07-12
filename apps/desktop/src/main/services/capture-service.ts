import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import type {
  AgentSubmitTurnRequest,
  CaptureUserIntent,
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
  readonly fetchSnapshot: (url: string, signal?: AbortSignal) => Promise<SourceFetchSnapshot>;
}

export interface AgentTurnFilePreservationBinding {
  readonly jobId: string;
  readonly sourceId: string;
}

export interface AgentTurnUrlPreservationBinding {
  readonly jobId: string;
  readonly sourceId: string;
  readonly inputHash: string;
}

export interface AgentTurnUrlPreservationRequest {
  readonly url: string;
  readonly inputKind: AgentSubmitTurnRequest["inputKind"];
  readonly userIntent: CaptureUserIntent;
  readonly locale: AgentSubmitTurnRequest["locale"];
}

export interface AgentTurnUrlPreservationResult {
  readonly sourceId: string;
  readonly captureId: string;
  readonly safeOriginalUrl: string;
  readonly safeFinalUrl: string;
  readonly displayName: string;
  readonly extractedText: string;
  readonly warnings: readonly string[];
  readonly privateContent: boolean;
  readonly sensitiveContent: boolean;
  readonly sourceRevisionHash: string;
  readonly artifactChecksum: string;
}

export interface AgentTurnUrlPreservationHooks {
  readonly onPublicationStart?: () => void;
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
    assertUrlSnapshotMatchesRequest(request.url, snapshot.originalUrl);
    const now = new Date();
    const timestamp = now.toISOString();
    const dateKey = timestamp.slice(0, 10).replaceAll("-", "");
    const captureId = createDatedId("cap", dateKey);
    const sourceId = createDatedId("src", dateKey);
    const jobId = createDatedId("job", dateKey);
    const eventId = createDatedId("evt", dateKey);
    persistUrlSnapshot({
      vaultPath,
      request,
      snapshot,
      timestamp,
      captureId,
      sourceId,
      legacyCapture: { jobId, eventId }
    });

    return {
      status: "queued",
      captureId,
      sourceId,
      jobId,
      conversationEventId: eventId,
      preservedAt: timestamp
    };
  }

  async preserveUrlForAgentTurn(
    request: AgentTurnUrlPreservationRequest,
    binding: AgentTurnUrlPreservationBinding,
    signal?: AbortSignal,
    hooks: AgentTurnUrlPreservationHooks = {}
  ): Promise<AgentTurnUrlPreservationResult> {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!this.#vaults.current() || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    assertAgentTurnUrlBinding(binding);
    const existing = readAgentTurnUrlSource(vaultPath, binding);
    if (existing) {
      hooks.onPublicationStart?.();
      return existing;
    }
    throwIfAborted(signal);
    const snapshot = await this.#sourceFetch.fetchSnapshot(request.url, signal);
    assertUrlSnapshotMatchesRequest(request.url, snapshot.originalUrl);
    throwIfAborted(signal);
    const timestamp = new Date().toISOString();
    const dateKey = binding.sourceId.slice(4, 12);
    const captureId = `cap_${dateKey}_${binding.sourceId.slice(13)}`;
    persistUrlSnapshot({
      vaultPath,
      request,
      snapshot,
      timestamp,
      captureId,
      sourceId: binding.sourceId,
      agentTurn: {
        jobId: binding.jobId,
        inputHash: binding.inputHash
      },
      ...(hooks.onPublicationStart ? { onPublicationStart: hooks.onPublicationStart } : {})
    });
    return requireAgentTurnUrlSource(vaultPath, binding);
  }

  readAgentTurnUrlSource(binding: AgentTurnUrlPreservationBinding): AgentTurnUrlPreservationResult {
    const vaultPath = this.#vaults.activeVaultPath();
    if (!this.#vaults.current() || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    assertAgentTurnUrlBinding(binding);
    return requireAgentTurnUrlSource(vaultPath, binding);
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

function persistUrlSnapshot(input: {
  readonly vaultPath: string;
  readonly request: {
    readonly inputKind: AgentSubmitTurnRequest["inputKind"];
    readonly userIntent: CaptureUserIntent;
    readonly locale: AgentSubmitTurnRequest["locale"];
  };
  readonly snapshot: SourceFetchSnapshot;
  readonly timestamp: string;
  readonly captureId: string;
  readonly sourceId: string;
  readonly legacyCapture?: { readonly jobId: string; readonly eventId: string };
  readonly agentTurn?: { readonly jobId: string; readonly inputHash: string };
  readonly onPublicationStart?: () => void;
}): void {
  const dateKey = /^src_(\d{8})_/u.exec(input.sourceId)?.[1];
  if (!dateKey) {
    throw new PigeDomainError("capture.url_binding_invalid", "The URL source identity is invalid.");
  }
  const monthKey = `${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}`;
  const rawBuffer = Buffer.from(input.snapshot.rawContent, "utf8");
  const extractedBuffer = Buffer.from(input.snapshot.extractedText, "utf8");
  const rawChecksum = checksumBuffer(rawBuffer);
  const extractedChecksum = checksumBuffer(extractedBuffer);
  const rawSnapshotExtension = input.snapshot.contentType === "text/plain" ? "txt" : "html";
  const rawSnapshotPath = vaultRelativePath("raw", "web", monthKey, `${input.sourceId}.${rawSnapshotExtension}`);
  const extractedTextPath = vaultRelativePath("artifacts", "web", monthKey, `${input.sourceId}.txt`);
  const sourceRecordPath = vaultRelativePath(".pige", "source-records", monthKey, `${input.sourceId}.json`);
  const rawSnapshotTarget = resolveConfinedVaultWritePath(input.vaultPath, rawSnapshotPath);
  const extractedTextTarget = resolveConfinedVaultWritePath(input.vaultPath, extractedTextPath);
  const sourceRecordTarget = resolveConfinedVaultWritePath(input.vaultPath, sourceRecordPath);
  const displayName = createUrlDisplayName(input.snapshot);
  const safeOriginalUrl = redactSensitiveUrl(input.snapshot.originalUrl);
  const safeFinalUrl = redactSensitiveUrl(input.snapshot.finalUrl);
  const safeCanonicalUrl = input.snapshot.canonicalUrl
    ? normalizeCapturedHttpUrl(input.snapshot.canonicalUrl)
    : undefined;
  const safeImageReferences = (input.snapshot.imageReferences ?? [])
    .map(normalizeCapturedHttpUrl)
    .filter((value): value is string => Boolean(value))
    .slice(0, 64);
  const title = normalizeCapturedMetadata(input.snapshot.title, 240);
  const byline = normalizeCapturedMetadata(input.snapshot.byline, 240);
  const siteName = normalizeCapturedMetadata(input.snapshot.siteName, 240);
  const sourceLanguage = normalizeCapturedMetadata(input.snapshot.language, 35);
  const publishedTime = normalizeCapturedMetadata(input.snapshot.publishedTime, 240);
  const excerpt = normalizeCapturedMetadata(input.snapshot.excerpt, 500);
  const extractionWarnings = input.snapshot.warnings
    .map((warning) => normalizeCapturedMetadata(warning, 120))
    .filter((warning): warning is string => Boolean(warning))
    .filter((warning, index, all) => all.indexOf(warning) === index)
    .slice(0, 32);

  input.onPublicationStart?.();
  writeConfinedVaultFileAtomic(input.vaultPath, rawSnapshotTarget, input.snapshot.rawContent);
  writeConfinedVaultFileAtomic(input.vaultPath, extractedTextTarget, input.snapshot.extractedText);

  const sourceRecord: SourceRecord = SourceRecordSchema.parse({
    id: input.sourceId,
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
        id: `art_${input.sourceId}_text`,
        kind: "extracted_text",
        path: extractedTextPath,
        checksum: extractedChecksum,
        size: extractedBuffer.byteLength
      }
    ],
    metadata: {
      inputKind: input.request.inputKind,
      userIntent: input.request.userIntent,
      locale: input.request.locale,
      captureId: input.captureId,
      ...(input.agentTurn ? {
        agentTurnJobId: input.agentTurn.jobId,
        agentTurnUrlInputHash: input.agentTurn.inputHash
      } : {}),
      originalUrl: safeOriginalUrl,
      finalUrl: safeFinalUrl,
      ...(safeCanonicalUrl ? { canonicalUrl: safeCanonicalUrl } : {}),
      contentType: input.snapshot.contentType,
      ...(input.snapshot.charset ? { charset: input.snapshot.charset } : {}),
      ...(title ? { title } : {}),
      ...(byline ? { byline } : {}),
      ...(siteName ? { siteName } : {}),
      ...(sourceLanguage ? { sourceLanguage } : {}),
      ...(publishedTime ? { publishedTime } : {}),
      ...(excerpt ? { excerpt } : {}),
      ...(safeImageReferences.length > 0 ? { imageReferences: safeImageReferences } : {}),
      ...(input.snapshot.extraction ? {
        webExtraction: {
          parserId: normalizeCapturedMetadata(input.snapshot.extraction.parserId, 80) ?? "unknown",
          engine: normalizeCapturedMetadata(input.snapshot.extraction.engine, 120) ?? "unknown",
          version: normalizeCapturedMetadata(input.snapshot.extraction.version, 80) ?? "unknown",
          mode: normalizeCapturedMetadata(input.snapshot.extraction.mode, 80) ?? "unknown",
          textCharacterCount: input.snapshot.extraction.textCharacterCount,
          ...(input.snapshot.extraction.elementCount !== undefined
            ? { elementCount: input.snapshot.extraction.elementCount }
            : {}),
          truncated: input.snapshot.extraction.truncated
        }
      } : {}),
      extractionWarnings,
      extractedTextSize: extractedBuffer.byteLength
    },
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  });
  writeConfinedVaultFileAtomic(
    input.vaultPath,
    sourceRecordTarget,
    `${JSON.stringify(sourceRecord, null, 2)}\n`
  );

  if (!input.legacyCapture) return;
  const conversationId = `conv_${dateKey}`;
  const conversationPath = vaultRelativePath(
    ".pige",
    "conversations",
    monthKey,
    `${conversationId}.jsonl`
  );
  const conversationEvent: ConversationEvent = ConversationEventSchema.parse({
    id: input.legacyCapture.eventId,
    conversationId,
    type: "capture_reference",
    createdAt: input.timestamp,
    sourceId: input.sourceId,
    captureId: input.captureId,
    displayName,
    sourceKind: "url"
  });
  appendConversationEvent(resolveVaultPath(input.vaultPath, conversationPath), conversationEvent);

  const jobRecord: JobRecord = JobRecordSchema.parse({
    id: input.legacyCapture.jobId,
    class: "capture",
    state: "queued",
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    sourceId: input.sourceId,
    captureId: input.captureId,
    conversationEventId: input.legacyCapture.eventId,
    message: "URL capture fetched, preserved, and queued for later processing."
  });
  writeJsonAtomic(
    resolveVaultPath(
      input.vaultPath,
      vaultRelativePath(".pige", "jobs", monthKey, `${input.legacyCapture.jobId}.json`)
    ),
    jobRecord
  );
}

function assertAgentTurnUrlBinding(binding: AgentTurnUrlPreservationBinding): void {
  const jobMatch = /^job_(\d{8})_([a-z0-9]{8,})$/u.exec(binding.jobId);
  if (
    !jobMatch ||
    binding.sourceId !== `src_${jobMatch[1]}_${jobMatch[2]}` ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding.inputHash)
  ) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "The Agent-selected URL source binding is invalid."
    );
  }
}

function requireAgentTurnUrlSource(
  vaultPath: string,
  binding: AgentTurnUrlPreservationBinding
): AgentTurnUrlPreservationResult {
  const result = readAgentTurnUrlSource(vaultPath, binding);
  if (!result) {
    throw new PigeDomainError(
      "agent_runtime.url_source_unavailable",
      "The Agent-selected URL source is unavailable."
    );
  }
  return result;
}

function readAgentTurnUrlSource(
  vaultPath: string,
  binding: AgentTurnUrlPreservationBinding
): AgentTurnUrlPreservationResult | undefined {
  const dateKey = binding.sourceId.slice(4, 12);
  const monthKey = `${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}`;
  const sourceRecordPath = resolveVaultPath(
    vaultPath,
    vaultRelativePath(".pige", "source-records", monthKey, `${binding.sourceId}.json`)
  );
  if (!fs.existsSync(sourceRecordPath)) return undefined;
  const sourceRecordBytes = readConfinedRegularFile(vaultPath, sourceRecordPath, 2 * 1024 * 1024);
  let sourceRecord: SourceRecord;
  try {
    sourceRecord = SourceRecordSchema.parse(JSON.parse(sourceRecordBytes.toString("utf8")));
  } catch {
    throw new PigeDomainError(
      "agent_runtime.url_source_changed",
      "The Agent-selected URL source record is invalid."
    );
  }
  const extractedArtifact = sourceRecord.artifacts.find((artifact) => artifact.kind === "extracted_text");
  const metadataOriginalUrl = typeof sourceRecord.metadata.originalUrl === "string"
    ? normalizeCapturedHttpUrl(sourceRecord.metadata.originalUrl)
    : undefined;
  const originalUri = sourceRecord.original?.uri
    ? normalizeCapturedHttpUrl(sourceRecord.original.uri)
    : undefined;
  if (
    sourceRecord.id !== binding.sourceId ||
    sourceRecord.kind !== "url" ||
    sourceRecord.metadata.agentTurnJobId !== binding.jobId ||
    sourceRecord.metadata.agentTurnUrlInputHash !== binding.inputHash ||
    !metadataOriginalUrl ||
    metadataOriginalUrl !== originalUri ||
    checksumBuffer(Buffer.from(metadataOriginalUrl, "utf8")) !== binding.inputHash ||
    !sourceRecord.managedCopy ||
    !extractedArtifact?.checksum ||
    extractedArtifact.size === undefined
  ) {
    throw new PigeDomainError(
      "agent_runtime.url_source_changed",
      "The Agent-selected URL source binding changed before reuse."
    );
  }
  const rawBytes = readConfinedRegularFile(
    vaultPath,
    resolveVaultPath(vaultPath, sourceRecord.managedCopy.path),
    2 * 1024 * 1024
  );
  const extractedBytes = readConfinedRegularFile(
    vaultPath,
    resolveVaultPath(vaultPath, extractedArtifact.path),
    4 * 1024 * 1024
  );
  if (
    rawBytes.byteLength !== sourceRecord.managedCopy.size ||
    checksumBuffer(rawBytes) !== sourceRecord.managedCopy.checksum ||
    extractedBytes.byteLength !== extractedArtifact.size ||
    checksumBuffer(extractedBytes) !== extractedArtifact.checksum
  ) {
    throw new PigeDomainError(
      "agent_runtime.url_source_changed",
      "The Agent-selected URL evidence changed before reuse."
    );
  }
  const safeOriginalUrl = metadataOriginalUrl;
  const safeFinalUrl = typeof sourceRecord.metadata.finalUrl === "string"
    ? normalizeCapturedHttpUrl(sourceRecord.metadata.finalUrl)
    : safeOriginalUrl;
  const captureId = typeof sourceRecord.metadata.captureId === "string"
    ? sourceRecord.metadata.captureId
    : undefined;
  if (!safeOriginalUrl || !safeFinalUrl || !captureId || !sourceRecord.original?.displayName) {
    throw new PigeDomainError(
      "agent_runtime.url_source_changed",
      "The Agent-selected URL source metadata is incomplete."
    );
  }
  const warnings = Array.isArray(sourceRecord.metadata.extractionWarnings)
    ? sourceRecord.metadata.extractionWarnings.filter((value): value is string => typeof value === "string")
    : [];
  return {
    sourceId: sourceRecord.id,
    captureId,
    safeOriginalUrl,
    safeFinalUrl,
    displayName: sourceRecord.original.displayName,
    extractedText: extractedBytes.toString("utf8"),
    warnings,
    privateContent: sourceRecord.metadata.private === true || sourceRecord.metadata.privacy === "private",
    sensitiveContent: sourceRecord.metadata.sensitive === true || sourceRecord.metadata.privacy === "sensitive",
    sourceRevisionHash: checksumBuffer(sourceRecordBytes),
    artifactChecksum: extractedArtifact.checksum
  };
}

function readConfinedRegularFile(vaultPath: string, filePath: string, maxBytes: number): Buffer {
  const vaultRoot = fs.realpathSync(vaultPath);
  let fileRealPath: string;
  let stat: fs.Stats;
  try {
    const linkStat = fs.lstatSync(filePath);
    if (linkStat.isSymbolicLink()) throw new Error("symlink");
    fileRealPath = fs.realpathSync(filePath);
    stat = fs.statSync(fileRealPath);
  } catch {
    throw new PigeDomainError("agent_runtime.url_source_changed", "The URL evidence file is unavailable.");
  }
  const relative = path.relative(vaultRoot, fileRealPath);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !stat.isFile() ||
    stat.size > maxBytes
  ) {
    throw new PigeDomainError("agent_runtime.url_source_changed", "The URL evidence file is unsafe.");
  }
  return fs.readFileSync(fileRealPath);
}

function checksumBuffer(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new PigeDomainError("url_fetch.cancelled", "The Agent-selected URL fetch was cancelled.");
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

function assertUrlSnapshotMatchesRequest(requestedUrl: string, snapshotOriginalUrl: string): void {
  const requested = normalizeCapturedHttpUrl(requestedUrl);
  const original = normalizeCapturedHttpUrl(snapshotOriginalUrl);
  if (!requested || !original || requested !== original) {
    throw new PigeDomainError(
      "capture.url_binding_invalid",
      "The fetched URL snapshot does not match the submitted source binding."
    );
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

function resolveConfinedVaultWritePath(vaultPath: string, relativePath: string): string {
  const vaultRoot = path.resolve(vaultPath);
  const segments = relativePath.split("/");
  if (
    path.isAbsolute(relativePath) ||
    segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\0"))
  ) {
    throw new PigeDomainError("capture.url_target_unsafe", "The URL snapshot target is invalid.");
  }
  let vaultStat: fs.Stats;
  try {
    vaultStat = fs.lstatSync(vaultRoot);
  } catch {
    throw new PigeDomainError("capture.url_target_unsafe", "The active vault root is unavailable.");
  }
  if (!vaultStat.isDirectory() || vaultStat.isSymbolicLink()) {
    throw new PigeDomainError("capture.url_target_unsafe", "The active vault root is not a confined directory.");
  }
  const targetPath = path.resolve(vaultRoot, ...segments);
  if (!targetPath.startsWith(`${vaultRoot}${path.sep}`)) {
    throw new PigeDomainError("capture.url_target_unsafe", "The URL snapshot target escapes the active vault.");
  }
  ensureConfinedVaultDirectory(vaultRoot, path.dirname(targetPath));
  assertSafeVaultFileTarget(targetPath);
  return targetPath;
}

function ensureConfinedVaultDirectory(vaultRoot: string, directoryPath: string): void {
  const relative = path.relative(vaultRoot, directoryPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (relative) {
      throw new PigeDomainError("capture.url_target_unsafe", "The URL snapshot directory escapes the active vault.");
    }
    return;
  }
  let current = vaultRoot;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (caught) {
      if (!isErrnoCode(caught, "ENOENT")) {
        throw new PigeDomainError("capture.url_target_unsafe", "A URL snapshot directory cannot be inspected safely.");
      }
      try {
        fs.mkdirSync(current, { mode: 0o700 });
        stat = fs.lstatSync(current);
      } catch {
        throw new PigeDomainError("capture.url_target_unsafe", "A URL snapshot directory cannot be created safely.");
      }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PigeDomainError("capture.url_target_unsafe", "A URL snapshot directory is not a confined directory.");
    }
  }
  const expectedRealDirectory = path.resolve(
    fs.realpathSync(vaultRoot),
    path.relative(vaultRoot, directoryPath)
  );
  if (fs.realpathSync(directoryPath) !== expectedRealDirectory) {
    throw new PigeDomainError("capture.url_target_unsafe", "A URL snapshot directory resolves through a symlink.");
  }
}

function assertSafeVaultFileTarget(filePath: string): void {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new PigeDomainError("capture.url_target_unsafe", "The URL snapshot target is not a private regular file.");
    }
  } catch (caught) {
    if (isErrnoCode(caught, "ENOENT")) return;
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("capture.url_target_unsafe", "The URL snapshot target cannot be inspected safely.");
  }
}

function writeConfinedVaultFileAtomic(vaultPath: string, filePath: string, value: string | Buffer): void {
  const vaultRoot = path.resolve(vaultPath);
  const directoryPath = path.dirname(filePath);
  ensureConfinedVaultDirectory(vaultRoot, directoryPath);
  assertSafeVaultFileTarget(filePath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let descriptor: number | undefined;
  try {
    const flags = fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW ?? 0);
    descriptor = fs.openSync(temporaryPath, flags, 0o600);
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    ensureConfinedVaultDirectory(vaultRoot, directoryPath);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Cleanup must not replace the confinement failure.
      }
    }
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The temporary path is absent after a successful atomic rename.
    }
  }
}

function isErrnoCode(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && value.code === code;
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
