import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AgentSubmitTurnRequest,
  CaptureUserIntent,
  CaptureFileRejection,
  CaptureFilesSubmitResult,
  SubmitFilesCaptureRequest,
  VaultSummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  CurrentSourceRecordSchema,
  SourceRecordSchema,
  type SourceKind,
  type SourceRecord
} from "@pige/schemas";
import {
  writeSingleWriterFileAtomic as writeFileAtomic,
  writeSingleWriterJsonAtomic as writeJsonAtomic
} from "./single-writer-file-commit";
import { hasErrorInstanceCode as isErrnoCode } from "./object-error-code";
import {
  ingressSnapshotService,
  type IngressSnapshotDescriptor
} from "./ingress-snapshot-service";
import { freezeAcceptedFileIngress, resolveAcceptedFileIngress } from "./accepted-file-ingress-service";
import { redactSensitiveUrl, SourceFetchService, type SourceFetchSnapshot } from "./source-fetch-service";
import { observedLanguageFact, unknownLanguageFact } from "./durable-language";
import { readBoundedSourceFileNoFollow, verifyReadableSourceFile } from "./source-file-access";
import { readVaultManifest } from "./vault-layout";
import { ManagedCopyRootService, selectCaptureManagedCopyRoot } from "./managed-copy-root-service";
import { authoredTextMetadataMatches, authoredTextSourceIdentity, type AuthoredTextProvenance } from "./home-authored-text-capture-service";

export interface CaptureVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
  assertWriterLease?(vaultPath: string): void;
}

export interface SourceFetchPort {
  readonly fetchSnapshot: (url: string, signal?: AbortSignal) => Promise<SourceFetchSnapshot>;
}

export interface AgentTurnFilePreservationBinding {
  readonly jobId: string;
  readonly sourceId: string;
  readonly inputChecksum?: string;
  readonly ordinal?: number; readonly snapshotOrdinal?: number;
  readonly attachmentSetHash?: string;
}

export interface AgentTurnTextPreservationBinding {
  readonly jobId: string;
  readonly sourceId: string;
  readonly inputChecksum: string;
  readonly ordinal: number;
  readonly attachmentSetHash: string; readonly authoredTextProvenance?: AuthoredTextProvenance;
}

export interface AgentTurnTextPreservationRequest {
  readonly text: string;
  readonly locale: AgentSubmitTurnRequest["locale"];
}

export interface AgentTurnTextPreservationResult {
  readonly sourceId: string;
  readonly captureId: string;
  readonly inputChecksum: string;
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

const FILE_KIND_BY_EXTENSION = new Map<string, SourceKind>([
  ...[".md", ".markdown"].map((extension) => [extension, "markdown_file"] as const),
  [".txt", "plain_text_file"], [".pdf", "pdf_file"], [".docx", "docx_file"], [".pptx", "pptx_file"],
  [".csv", "csv_file"], [".xlsx", "xlsx_file"],
  ...[".sqlite", ".sqlite3", ".db"].map((extension) => [extension, "sqlite_file"] as const),
  ...[".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".bmp"]
    .map((extension) => [extension, "image_file"] as const)
]);

export function supportedFileSourceKind(filePath: string): SourceKind | undefined {
  return FILE_KIND_BY_EXTENSION.get(path.extname(filePath).toLowerCase());
}

export function safeAttachmentDisplayName(filePath: string): string {
  const sanitized = Array.from(path.basename(filePath).normalize("NFKC"))
    .filter((character) => !/[\\/\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(character))
    .join("")
    .trim()
    .slice(0, 160);
  return sanitized || "Unknown file";
}

export class CaptureService {
  readonly #vaults: CaptureVaultPort;
  readonly #sourceFetch: SourceFetchPort;
  readonly #managedRoots: ManagedCopyRootService | undefined;

  constructor(
    vaults: CaptureVaultPort,
    sourceFetch: SourceFetchPort = new SourceFetchService(),
    managedRoots?: ManagedCopyRootService
  ) {
    this.#vaults = vaults;
    this.#sourceFetch = sourceFetch;
    this.#managedRoots = managedRoots;
  }

  async preserveUrlForAgentTurn(
    request: AgentTurnUrlPreservationRequest,
    binding: AgentTurnUrlPreservationBinding,
    signal?: AbortSignal,
    hooks: AgentTurnUrlPreservationHooks = {}
  ): Promise<AgentTurnUrlPreservationResult> {
    const vaultPath = this.#vaults.activeVaultPath();
    const vault = this.#vaults.current();
    if (!vault || !vaultPath) {
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
      managedRoot: selectCaptureManagedCopyRoot(this.#managedRoots, vault, vaultPath),
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
    const vault = this.#vaults.current();
    if (!vault || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    assertAgentTurnUrlBinding(binding);
    return requireAgentTurnUrlSource(vaultPath, binding);
  }

  async preserveFilesForAgentTurn(
    request: SubmitFilesCaptureRequest,
    binding: AgentTurnFilePreservationBinding
  ): Promise<CaptureFilesSubmitResult> {
    if (
      (!/^job_\d{8}_[a-z0-9]{8,}$/u.test(binding.jobId) ||
        !/^src_\d{8}_[a-z0-9]{8,}$/u.test(binding.sourceId) ||
        (binding.inputChecksum !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(binding.inputChecksum)) ||
        [binding.ordinal, binding.snapshotOrdinal].some((ordinal) => ordinal !== undefined && (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 7)) ||
        (binding.attachmentSetHash !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(binding.attachmentSetHash)) ||
        request.filePaths.length !== 1)
    ) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The source preservation binding is invalid.");
    }
    return this.#preserveFiles(request, binding);
  }

  preserveTextForAgentTurn(
    request: AgentTurnTextPreservationRequest,
    binding: AgentTurnTextPreservationBinding
  ): AgentTurnTextPreservationResult {
    if (
      !/^job_\d{8}_[a-z0-9]{8,}$/u.test(binding.jobId) ||
      !/^src_\d{8}_[a-z0-9]{8,}$/u.test(binding.sourceId) ||
      !/^sha256:[a-f0-9]{64}$/u.test(binding.inputChecksum) ||
      !Number.isInteger(binding.ordinal) ||
      binding.ordinal < 0 ||
      binding.ordinal > 7 ||
      !/^sha256:[a-f0-9]{64}$/u.test(binding.attachmentSetHash)
    ) {
      throw new PigeDomainError(
        "agent_runtime.turn_binding_invalid",
        "The pasted-text preservation binding is invalid."
      );
    }
    const vaultPath = this.#vaults.activeVaultPath();
    const vault = this.#vaults.current();
    if (!vault || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    this.#vaults.assertWriterLease?.(vaultPath);
    const body = Buffer.from(request.text, "utf8");
    const checksum = checksumBuffer(body);
    if (checksum !== binding.inputChecksum) {
      throw new PigeDomainError("agent_runtime.turn_binding_invalid", "The pasted text changed before preservation.");
    }
    const dateKey = binding.sourceId.slice(4, 12);
    const monthKey = `${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}`;
    const managedCopyPath = vaultRelativePath("raw", "text", monthKey, `${binding.sourceId}.txt`);
    const managedRoot = selectCaptureManagedCopyRoot(this.#managedRoots, vault, vaultPath);
    const sourceRecordPath = vaultRelativePath(".pige", "source-records", monthKey, `${binding.sourceId}.json`);
    const recordTarget = resolveVaultPath(vaultPath, sourceRecordPath);
    const authored = binding.authoredTextProvenance; const textIdentity = authoredTextSourceIdentity(authored, binding.sourceId, checksum);
    if (fs.existsSync(recordTarget)) {
      const existing = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(recordTarget, "utf8")));
      const managedTarget = existing.managedCopy ? verifyReadableSourceFile(vaultPath, existing) : undefined;
      if (
        existing.id !== binding.sourceId ||
        existing.kind !== "text" ||
        existing.semanticOrchestration !== "agent_turn" ||
        existing.metadata.agentTurnJobId !== binding.jobId ||
        existing.metadata.agentTurnAttachmentOrdinal !== binding.ordinal ||
        existing.metadata.agentTurnAttachmentSetHash !== binding.attachmentSetHash ||
        existing.metadata.inputKind !== textIdentity.inputKind || existing.original?.uri !== textIdentity.uri ||
        existing.original?.displayName !== textIdentity.displayName || !authoredTextMetadataMatches(existing.metadata, authored) ||
        existing.managedCopy?.checksum !== checksum ||
        existing.managedCopy.size !== body.byteLength ||
        !managedTarget ||
        checksumBuffer(fs.readFileSync(managedTarget.absolutePath)) !== checksum
      ) {
        throw new PigeDomainError(
          "agent_runtime.turn_binding_invalid",
          "The existing pasted-text source does not match the Agent turn."
        );
      }
      return {
        sourceId: binding.sourceId,
        captureId: String(existing.metadata.captureId),
        inputChecksum: checksum
      };
    }
    const timestamp = new Date().toISOString();
    const captureId = createDatedId("cap", timestamp.slice(0, 10).replaceAll("-", ""));
    writeFileAtomic(path.resolve(managedRoot.rootPath, ...managedCopyPath.split("/")), body);
    const sourceRecord: SourceRecord = CurrentSourceRecordSchema.parse({
      id: binding.sourceId,
      language: unknownLanguageFact("source_record"),
      kind: "text",
      storageStrategy: "copy_to_source_library",
      semanticOrchestration: "agent_turn",
      original: {
        uri: textIdentity.uri,
        displayName: textIdentity.displayName,
        lastKnownSize: body.byteLength,
        checksum
      },
      managedCopy: {
        path: managedCopyPath,
        rootId: managedRoot.rootId,
        pathBasis: managedRoot.pathBasis,
        checksum,
        size: body.byteLength
      },
      artifacts: [],
      metadata: {
        inputKind: textIdentity.inputKind,
        locale: request.locale,
        captureId,
        agentTurnJobId: binding.jobId,
        agentTurnAttachmentOrdinal: binding.ordinal,
        agentTurnAttachmentSetHash: binding.attachmentSetHash,
        ...textIdentity.metadata,
        unicodeCodePointCount: [...request.text].length,
        utf8ByteSize: body.byteLength,
        parserStatus: "text_ready",
        parserRequired: false
      },
      createdAt: timestamp,
      updatedAt: timestamp
    });
    writeJsonAtomic(recordTarget, sourceRecord);
    return { sourceId: binding.sourceId, captureId, inputChecksum: checksum };
  }

  async #preserveFiles(
    request: SubmitFilesCaptureRequest,
    agentTurnBinding: AgentTurnFilePreservationBinding
  ): Promise<CaptureFilesSubmitResult> {
    const vaultPath = this.#vaults.activeVaultPath();
    const vault = this.#vaults.current();
    if (!vault || !vaultPath) {
      throw new PigeDomainError("vault_missing", "No active Pige vault is selected.");
    }
    this.#vaults.assertWriterLease?.(vaultPath);
    const storageStrategy = vault.defaultSourceStorageStrategy;

    const uniqueFilePaths = Array.from(new Set(request.filePaths.map((filePath) => filePath.trim()))).filter(Boolean);
    if (uniqueFilePaths.length === 0) {
      return createRejectedFileResult([{ displayName: "Unknown file", reason: "empty_path" }]);
    }

    const timestamp = new Date().toISOString();
    const dateKey = agentTurnBinding.sourceId.slice(4, 12);
    const monthKey = `${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}`;
    const captureId = `cap_${dateKey}_${agentTurnBinding.sourceId.slice(13)}`;
    const sourceIds: string[] = [];
    const rejectedFiles: CaptureFileRejection[] = [];

    for (const filePath of uniqueFilePaths) {
      let existingSnapshot: IngressSnapshotDescriptor | undefined;
      try {
        existingSnapshot = await resolveAcceptedFileIngress({
          vaultPath, vaultId: vault.vaultId, filePath, binding: agentTurnBinding
        });
      } catch {
        rejectedFiles.push({ displayName: safeAttachmentDisplayName(filePath), reason: "copy_failed" });
        continue;
      }
      const boundSourcePath = existingSnapshot?.sourceProvenance.originalPath ?? filePath;
      const displayName = safeAttachmentDisplayName(boundSourcePath);
      const extension = path.extname(displayName).toLowerCase();
      const sourceKind = supportedFileSourceKind(displayName);
      if (!sourceKind) {
        rejectedFiles.push({ displayName, reason: "unsupported_type" });
        continue;
      }

      const sqliteSidecars = existingSnapshot || sourceKind !== "sqlite_file"
        ? []
        : detectSqliteSidecars(boundSourcePath);
      if (!existingSnapshot) {
        const fileState = inspectRegularFile(boundSourcePath);
        if (fileState !== "ok") {
          rejectedFiles.push({ displayName, reason: fileState });
          continue;
        }
        if (storageStrategy === "copy_to_source_library" && sqliteSidecars.length > 0) {
          rejectedFiles.push({ displayName, reason: "copy_failed" });
          continue;
        }
      }

      const sourceId = agentTurnBinding.sourceId;
      const managedCopyPath = vaultRelativePath("raw", "files", monthKey, `${sourceId}${extension}`);
      const sourceRecordPath = vaultRelativePath(".pige", "source-records", monthKey, `${sourceId}.json`);
      let unpublishedSnapshot: IngressSnapshotDescriptor | undefined;

      try {
        const snapshot = existingSnapshot ?? await freezeAcceptedFileIngress({
          vaultPath,
          vaultId: vault.vaultId,
          filePath: boundSourcePath,
          binding: agentTurnBinding
        });
        unpublishedSnapshot = snapshot;
        const selectedRoot = selectCaptureManagedCopyRoot(this.#managedRoots, vault, vaultPath);
        const managedRoot = path.resolve(selectedRoot.rootPath, "raw", "files");
        if (storageStrategy === "copy_to_source_library") {
          fs.mkdirSync(managedRoot, { recursive: true, mode: 0o700 });
        }
        const adoptedSnapshot = storageStrategy === "copy_to_source_library"
          ? await ingressSnapshotService.promoteManagedCopy({
            vaultPath,
            binding: snapshot,
            managedRoot,
            destinationPath: path.resolve(selectedRoot.rootPath, ...managedCopyPath.split("/"))
          })
          : snapshot;
        unpublishedSnapshot = adoptedSnapshot;
        if (adoptExistingAgentTurnFileSource(
          vaultPath,
          boundSourcePath,
          displayName,
          sourceKind,
          agentTurnBinding,
          adoptedSnapshot,
          this.#managedRoots
        )) {
          sourceIds.push(sourceId);
          continue;
        }
        const sourceRecord: SourceRecord = CurrentSourceRecordSchema.parse({
          id: sourceId,
          language: unknownLanguageFact("source_record"),
          kind: sourceKind,
          storageStrategy,
          semanticOrchestration: "agent_turn",
          original: {
            uri: pathToFileURL(boundSourcePath).href,
            path: boundSourcePath,
            displayName,
            lastKnownMtime: new Date(adoptedSnapshot.sourceProvenance.identity.modifiedAtMs).toISOString(),
            lastKnownSize: adoptedSnapshot.size,
            checksum: adoptedSnapshot.checksum
          },
          ...(storageStrategy === "copy_to_source_library" ? {
            managedCopy: {
              path: managedCopyPath,
              rootId: selectedRoot.rootId,
              pathBasis: selectedRoot.pathBasis,
              checksum: adoptedSnapshot.checksum,
              size: adoptedSnapshot.size
            }
          } : {}),
          artifacts: [],
          metadata: {
            inputKind: request.inputKind,
            userIntent: request.userIntent,
            locale: request.locale,
            captureId,
            agentTurnJobId: agentTurnBinding.jobId,
            ...(agentTurnBinding.ordinal === undefined ? {} : { agentTurnAttachmentOrdinal: agentTurnBinding.ordinal }),
            ...(agentTurnBinding.attachmentSetHash === undefined ? {} : {
              agentTurnAttachmentSetHash: agentTurnBinding.attachmentSetHash
            }),
            originalExtension: extension,
            parserStatus: isTextLikeFileSource(sourceKind)
              ? "text_ready"
              : isStructuredFileSource(sourceKind)
                ? "waiting_agent_dataset_tool"
                : "waiting_parser_or_ocr",
            parserRequired: !isTextLikeFileSource(sourceKind) && !isStructuredFileSource(sourceKind),
            ...(isStructuredFileSource(sourceKind) ? { datasetToolAvailable: true } : {}),
            ...(sqliteSidecars.length > 0 ? { sqliteLiveSidecars: sqliteSidecars } : {})
          },
          createdAt: timestamp,
          updatedAt: timestamp
        });
        writeJsonAtomic(resolveVaultPath(vaultPath, sourceRecordPath), sourceRecord);
        unpublishedSnapshot = undefined;

        sourceIds.push(sourceId);
      } catch (caught) {
        if (unpublishedSnapshot && !fs.existsSync(resolveVaultPath(vaultPath, sourceRecordPath))) {
          const currentSnapshot = ingressSnapshotService.read(vaultPath, unpublishedSnapshot) ?? unpublishedSnapshot;
          const discarded = ingressSnapshotService.discardUnpublished(
            vaultPath,
            currentSnapshot,
            currentSnapshot.descriptorDigest
          );
          if (discarded.status !== "released" && discarded.status !== "not_found") throw caught;
        }
        rejectedFiles.push({ displayName, reason: "copy_failed" });
      }
    }

    return {
      status: sourceIds.length === 0 ? "rejected" : rejectedFiles.length > 0 ? "partially_queued" : "queued",
      captureId,
      sourceIds,
      jobIds: [],
      conversationEventIds: [],
      rejectedFiles,
      preservedAt: timestamp
    };
  }

}

function adoptExistingAgentTurnFileSource(
  vaultPath: string,
  filePath: string,
  displayName: string,
  sourceKind: SourceKind,
  binding: AgentTurnFilePreservationBinding,
  snapshot: IngressSnapshotDescriptor,
  managedRoots?: ManagedCopyRootService
): boolean {
  const dateKey = binding.sourceId.slice(4, 12);
  const sourceRecordPath = resolveVaultPath(
    vaultPath,
    vaultRelativePath(
      ".pige",
      "source-records",
      `${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}`,
      `${binding.sourceId}.json`
    )
  );
  if (!fs.existsSync(sourceRecordPath)) return false;
  const parsed = SourceRecordSchema.safeParse(JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")));
  const existing = parsed.success ? parsed.data : undefined;
  if (
    !existing ||
    existing.id !== binding.sourceId ||
    existing.kind !== sourceKind ||
    existing.semanticOrchestration !== "agent_turn" ||
    existing.metadata.agentTurnJobId !== binding.jobId ||
    existing.metadata.agentTurnAttachmentOrdinal !== binding.ordinal ||
    existing.metadata.agentTurnAttachmentSetHash !== binding.attachmentSetHash ||
    !existing.original ||
    existing.original.path !== filePath ||
    existing.original.displayName !== displayName ||
    existing.original.checksum !== snapshot.checksum ||
    existing.original.lastKnownSize !== snapshot.size ||
    existing.original.lastKnownMtime !== new Date(snapshot.sourceProvenance.identity.modifiedAtMs).toISOString() ||
    existing.storageStrategy !== (snapshot.managedCopy ? "copy_to_source_library" : "reference_original") ||
    Boolean(existing.managedCopy) !== Boolean(snapshot.managedCopy) ||
    snapshot.parentJobId !== binding.jobId ||
    snapshot.sourceId !== binding.sourceId ||
    snapshot.ordinal !== (binding.snapshotOrdinal ?? binding.ordinal ?? 0)
  ) {
    throw new PigeDomainError(
      "agent_runtime.turn_binding_invalid",
      "An existing Agent attachment source does not match the submitted turn."
    );
  }
  if (existing.managedCopy) {
    const resolved = existing.managedCopy.rootId && existing.managedCopy.rootId !== "root_vault_managed"
      ? managedRoots?.resolveManagedCopy(readVaultManifest(vaultPath).vault_id, vaultPath, existing.managedCopy)
      : undefined;
    const managedCopyPath = resolved?.absolutePath ?? resolveVaultPath(vaultPath, existing.managedCopy.path);
    if (
      !fs.existsSync(managedCopyPath) ||
      existing.managedCopy.checksum !== snapshot.checksum ||
      existing.managedCopy.size !== snapshot.size ||
      snapshot.managedCopy?.destinationPath !== fs.realpathSync(managedCopyPath)
    ) {
      resolved?.release();
      throw new PigeDomainError(
        "agent_runtime.turn_binding_invalid",
        "The existing managed attachment copy is unavailable."
      );
    }
    resolved?.assertCurrent();
    resolved?.release();
  }
  return true;
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
  readonly managedRoot: {
    readonly rootId: string;
    readonly rootPath: string;
    readonly pathBasis: "vault_relative" | "root_relative";
  };
  readonly agentTurn: { readonly jobId: string; readonly inputHash: string };
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
  const rawSnapshotTarget = resolveConfinedVaultWritePath(input.managedRoot.rootPath, rawSnapshotPath);
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
  writeFileAtomic(rawSnapshotTarget, input.snapshot.rawContent);
  writeConfinedVaultFileAtomic(input.vaultPath, extractedTextTarget, input.snapshot.extractedText);

  const sourceRecord: SourceRecord = CurrentSourceRecordSchema.parse({
    id: input.sourceId,
    language: observedLanguageFact("source_record", sourceLanguage, "explicit_source"),
    kind: "url",
    storageStrategy: "copy_to_source_library",
    semanticOrchestration: "agent_turn",
    original: {
      uri: safeOriginalUrl,
      displayName,
      checksum: rawChecksum
    },
    managedCopy: {
      path: rawSnapshotPath,
      rootId: input.managedRoot.rootId,
      pathBasis: input.managedRoot.pathBasis,
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
      agentTurnJobId: input.agentTurn.jobId,
      agentTurnUrlInputHash: input.agentTurn.inputHash,
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
  const verifiedRaw = verifyReadableSourceFile(vaultPath, sourceRecord);
  const rawBytes = readBoundedSourceFileNoFollow(verifiedRaw.absolutePath, 2 * 1024 * 1024);
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

function isStructuredFileSource(sourceKind: SourceKind): boolean {
  return sourceKind === "csv_file" || sourceKind === "xlsx_file" || sourceKind === "sqlite_file";
}

function detectSqliteSidecars(filePath: string): readonly string[] {
  return ["-journal", "-wal", "-shm"].filter((suffix) => fs.existsSync(`${filePath}${suffix}`));
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

function vaultRelativePath(...segments: string[]): string {
  return segments.join("/");
}

function resolveVaultPath(vaultPath: string, relativePath: string): string {
  return path.join(vaultPath, ...relativePath.split("/"));
}
