import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  SKILL_URL_STAGE_MAX_UTF8_BYTES,
  AgentClientTurnIdSchema,
  ConversationEventIdSchema,
  deriveSkillDataBoundaries,
  JobIdSchema,
  SkillDiscardStagedRequestSchema,
  SkillDiscardStagedResultSchema,
  SkillInstallStagedRequestSchema,
  SkillInstallStagedResultSchema,
  SkillInstallUrlSchema,
  SkillPendingStagedReviewsRequestSchema,
  SkillPendingStagedReviewsResultSchema,
  SkillStageFromMarkdownRequestSchema,
  SkillStageFromMarkdownResultSchema,
  SkillStageFromZipRequestSchema,
  SkillStageFromZipResultSchema,
  SkillStageFromUrlRequestSchema,
  SkillStageFromUrlResultSchema,
  SkillStageUpdateRequestSchema,
  SkillStageUpdateResultSchema,
  SkillStagedFileSummarySchema,
  SkillStagingIdSchema,
  VaultIdSchema,
  type SkillDiscardStagedRequest,
  type SkillDiscardStagedResult,
  type SkillInstallStagedRequest,
  type SkillInstallStagedResult,
  type SkillInstallSourceKind,
  type SkillPendingStagedReviewsRequest,
  type SkillPendingStagedReviewsResult,
  type SkillManifest,
  type SkillStageFromMarkdownRequest,
  type SkillStageFromMarkdownResult,
  type SkillStageFromZipRequest,
  type SkillStageFromZipResult,
  type SkillStageFromUrlRequest,
  type SkillStageFromUrlResult,
  type SkillStageUpdateRequest,
  type SkillStageUpdateResult,
  type SkillStagedSummary
} from "@pige/schemas";
import { containsRestrictedModelContent } from "./model-egress-content";
import {
  assertSkillManifestRendererSafe,
  parseSkillManifest,
  SkillRegistryService
} from "./skill-registry-service";
import {
  isSkillUpdateStageRecord,
  projectPureSkillUpdateReview,
  type SkillStagedInstallCandidate,
  type SkillStagedUpdateBinding,
  type SkillUpdateTarget,
  type SkillStagingStorePort
} from "./skill-source-update-registry";
import { SourceFetchService, type SourceFetchSnapshot } from "./source-fetch-service";
import { hasObjectErrorCode as isErrno } from "./object-error-code";
import {
  normalizeBundleFiles,
  singleManifestBundle,
  SkillZipStageError,
  SkillZipStageService,
  skillBundleSha256,
  type SkillBundleFile,
  type SkillZipBundle
} from "./skill-zip-stage-service";

const STAGE_SCHEMA_VERSION = 1;
const STAGE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STAGE_RECORD_BYTES = 64 * 1024;
const MAX_STAGED_DIRECTORIES = 32;
const STAGE_RECORD_NAME = ".pige-stage.json";
const STAGED_MANIFEST_NAME = "SKILL.md";

interface SkillStageRecordBase {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly stagingId: string;
  readonly manifestSha256: `sha256:${string}`;
  readonly bundleSha256: `sha256:${string}`;
  readonly files: readonly { readonly relativePath: string; readonly utf8ByteSize: number; readonly sha256: `sha256:${string}` }[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

interface SkillUrlStageRecord extends SkillStageRecordBase {
  readonly requestSourceUrl: string;
  readonly finalSourceUrl: string;
  readonly chat?: SkillChatStageBinding;
  readonly update?: SkillUpdateTarget;
}

interface SkillLocalMarkdownStageRecord extends SkillStageRecordBase {
  readonly sourceKind: "local_markdown" | "local_zip";
  readonly update?: SkillUpdateTarget;
}

type SkillStageRecord = SkillUrlStageRecord | SkillLocalMarkdownStageRecord;

export interface SkillChatStageBinding {
  readonly activeVaultId: string;
  readonly jobId: string;
  readonly clientTurnId: string;
  readonly conversationEventId: string;
  readonly candidateIndex: number;
}

export interface SkillUrlFetchPort {
  fetchSnapshot(url: string, signal?: AbortSignal): Promise<SourceFetchSnapshot>;
}

export interface SkillUrlInstallServiceOptions {
  readonly appDataRoot: string;
  readonly registry: SkillRegistryService;
  readonly fetcher?: SkillUrlFetchPort;
  readonly now?: () => Date;
  readonly zipStage?: SkillZipStageService;
}

export class SkillUrlInstallService implements SkillStagingStorePort {
  readonly #rootPath: string;
  readonly #stagingRoot: string;
  readonly #registry: SkillRegistryService;
  readonly #fetcher: SkillUrlFetchPort;
  readonly #now: () => Date;
  readonly #zipStage: SkillZipStageService;

  constructor(options: SkillUrlInstallServiceOptions) {
    const appDataRoot = canonicalPrivateRoot(options.appDataRoot);
    this.#rootPath = path.join(appDataRoot, "skills");
    this.#stagingRoot = path.join(this.#rootPath, "staging");
    this.#registry = options.registry;
    this.#fetcher = options.fetcher ?? new SourceFetchService({ maxBytes: SKILL_URL_STAGE_MAX_UTF8_BYTES });
    this.#now = options.now ?? (() => new Date());
    this.#zipStage = options.zipStage ?? new SkillZipStageService(appDataRoot);
    this.#prepare();
    this.#reapExpiredStages();
  }

  async stageFromUrl(
    requestInput: SkillStageFromUrlRequest,
    signal: AbortSignal = new AbortController().signal
  ): Promise<SkillStageFromUrlResult> {
    const request = SkillStageFromUrlRequestSchema.parse(requestInput);
    return await this.#stageUrl(request, undefined, signal, () => undefined);
  }

  async stageFromChatUrl(
    requestInput: SkillStageFromUrlRequest,
    bindingInput: SkillChatStageBinding,
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<SkillStageFromUrlResult> {
    const request = SkillStageFromUrlRequestSchema.parse(requestInput);
    const binding = parseChatBinding(bindingInput);
    return await this.#stageUrl(request, binding, signal, assertCurrent);
  }

  pendingStagedReviews(requestInput: SkillPendingStagedReviewsRequest): SkillPendingStagedReviewsResult {
    const request = SkillPendingStagedReviewsRequestSchema.parse(requestInput);
    try {
      this.#reapExpiredStages();
      const staged = fs.readdirSync(this.#stagingRoot)
        .filter((entry) => SkillStagingIdSchema.safeParse(entry).success)
        .sort()
        .map((entry) => this.#readCandidate(entry))
        .filter((candidate): candidate is ReadStageCandidate =>
          candidate !== undefined &&
          !isLocalMarkdownRecord(candidate.record) &&
          candidate.record.chat?.activeVaultId === request.activeVaultId &&
          candidate.record.update === undefined &&
          !isExpired(candidate.record.expiresAt, this.#now())
        )
        .map((candidate) => this.#project(candidate));
      return SkillPendingStagedReviewsResultSchema.parse({ ...request, status: "ready", staged });
    } catch {
      return SkillPendingStagedReviewsResultSchema.parse({ ...request, status: "failed" });
    }
  }

  async #stageUrl(
    request: SkillStageFromUrlRequest,
    chat: SkillChatStageBinding | undefined,
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<SkillStageFromUrlResult> {
    const stagingId = createStagingId(request.requestId);
    try {
      signal.throwIfAborted();
      assertCurrent();
      const existing = this.#readCandidate(stagingId);
      if (existing) {
        if (existing.record.requestId !== request.requestId || isLocalMarkdownRecord(existing.record) ||
          existing.record.requestSourceUrl !== request.sourceUrl ||
          !sameOptionalChatBinding(existing.record.chat, chat)) {
          return stageFailed(request.requestId);
        }
        assertCurrent();
        if (!isExpired(existing.record.expiresAt, this.#now())) {
          return SkillStageFromUrlResultSchema.parse({
            status: "ready",
            requestId: request.requestId,
            staged: this.#project(existing)
          });
        }
        this.#removeStage(stagingId, existing.record.manifestSha256, existing.record.bundleSha256);
      }

      const snapshot = await this.#fetcher.fetchSnapshot(request.sourceUrl, signal);
      signal.throwIfAborted();
      assertCurrent();
      const finalSourceUrl = SkillInstallUrlSchema.safeParse(snapshot.finalUrl);
      if (!finalSourceUrl.success) return stageFailed(request.requestId);
      if (!isMarkdownContentType(snapshot.contentType)) {
        return invalidStageResult(request.requestId, "unsafe_content");
      }
      const source = snapshot.rawContent;
      const bytes = Buffer.from(source, "utf8");
      if (bytes.length === 0 || bytes.length > SKILL_URL_STAGE_MAX_UTF8_BYTES) {
        return invalidStageResult(request.requestId, "source_too_large");
      }
      if (source.includes("\uFFFD") || containsRestrictedModelContent(source)) {
        return invalidStageResult(request.requestId, "unsafe_content");
      }

      let manifest: SkillManifest;
      try {
        manifest = parseSkillManifest(source);
      } catch {
        return invalidStageResult(request.requestId, "manifest_invalid");
      }
      if (manifest.scope !== "machine_local") return invalidStageResult(request.requestId, "unsupported_scope");
      if (!isStagedSkillKind(manifest.kind)) return invalidStageResult(request.requestId, "unsupported_kind");
      if (manifest.kind === "external_web" && manifest.sourceUrl !== undefined && manifest.sourceUrl !== finalSourceUrl.data) {
        return invalidStageResult(request.requestId, "manifest_invalid");
      }
      try {
        assertSkillManifestRendererSafe(manifest);
      } catch {
        return invalidStageResult(request.requestId, "unsafe_content");
      }

      const bundle = singleManifestBundle(bytes);
      const now = this.#now();
      const record: SkillStageRecord = {
        schemaVersion: STAGE_SCHEMA_VERSION,
        requestId: request.requestId,
        stagingId,
        requestSourceUrl: request.sourceUrl,
        finalSourceUrl: finalSourceUrl.data,
        ...(chat ? { chat } : {}),
        manifestSha256: digest(bytes),
        bundleSha256: bundle.bundleSha256,
        files: projectFiles(bundle.files),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + STAGE_TTL_MS).toISOString()
      };
      this.#publishStage(record, bundle.files, assertCurrent);
      const staged = this.#readCandidate(stagingId);
      if (!staged || staged.record.manifestSha256 !== record.manifestSha256) return stageFailed(request.requestId);
      return SkillStageFromUrlResultSchema.parse({
        status: "ready",
        requestId: request.requestId,
        staged: this.#project(staged)
      });
    } catch {
      return stageFailed(request.requestId);
    }
  }

  async stageFromMarkdown(
    requestInput: SkillStageFromMarkdownRequest,
    sourcePath: string
  ): Promise<SkillStageFromMarkdownResult> {
    const request = SkillStageFromMarkdownRequestSchema.parse(requestInput);
    const identity = markdownIdentity(request);
    const stagingId = createStagingId(request.requestId);
    try {
      const existing = this.#readCandidate(stagingId);
      if (existing) {
        if (existing.record.requestId !== request.requestId || !isLocalMarkdownRecord(existing.record) ||
          existing.record.sourceKind !== "local_markdown") {
          return markdownFailed(identity);
        }
        if (!isExpired(existing.record.expiresAt, this.#now())) {
          return SkillStageFromMarkdownResultSchema.parse({ ...identity, status: "ready", staged: this.#project(existing) });
        }
        this.#removeStage(stagingId, existing.record.manifestSha256, existing.record.bundleSha256);
      }

      const bytes = readSelectedMarkdown(sourcePath);
      const source = decodeUtf8(bytes);
      if (containsRestrictedModelContent(source)) return markdownFailed(identity);
      const manifest = parseSkillManifest(source);
      if (manifest.scope !== "machine_local" || !isStagedSkillKind(manifest.kind) || manifest.sourceUrl !== undefined) {
        return markdownFailed(identity);
      }
      assertSkillManifestRendererSafe(manifest);
      const bundle = singleManifestBundle(bytes);
      const now = this.#now();
      const record: SkillLocalMarkdownStageRecord = {
        schemaVersion: STAGE_SCHEMA_VERSION,
        requestId: request.requestId,
        stagingId,
        sourceKind: "local_markdown",
        manifestSha256: digest(bytes),
        bundleSha256: bundle.bundleSha256,
        files: projectFiles(bundle.files),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + STAGE_TTL_MS).toISOString()
      };
      this.#publishStage(record, bundle.files);
      const staged = this.#readCandidate(stagingId);
      if (!staged || !isLocalMarkdownRecord(staged.record) || staged.record.sourceKind !== "local_markdown" ||
        staged.record.manifestSha256 !== record.manifestSha256) {
        return markdownFailed(identity);
      }
      return SkillStageFromMarkdownResultSchema.parse({ ...identity, status: "ready", staged: this.#project(staged) });
    } catch {
      return markdownFailed(identity);
    }
  }

  async stageFromZip(requestInput: SkillStageFromZipRequest, sourcePath: string): Promise<SkillStageFromZipResult> {
    const request = SkillStageFromZipRequestSchema.parse(requestInput);
    const identity = markdownIdentity(request);
    const stagingId = createStagingId(request.requestId);
    try {
      const existing = this.#readCandidate(stagingId);
      if (existing) {
        if (existing.record.requestId !== request.requestId || !isLocalMarkdownRecord(existing.record) ||
          existing.record.sourceKind !== "local_zip") {
          return zipFailed(identity);
        }
        if (!isExpired(existing.record.expiresAt, this.#now())) {
          return SkillStageFromZipResultSchema.parse({ ...identity, status: "ready", staged: this.#project(existing) });
        }
        this.#removeStage(stagingId, existing.record.manifestSha256, existing.record.bundleSha256);
      }
      const bundle = await this.#zipStage.readSelectedArchive(sourcePath);
      const source = decodeUtf8(bundle.manifestBytes);
      const manifest = parseSkillManifest(source);
      if (manifest.scope !== "machine_local" || !isStagedSkillKind(manifest.kind) || manifest.sourceUrl !== undefined) {
        return zipInvalid(identity, "manifest_invalid");
      }
      assertSkillManifestRendererSafe(manifest);
      const now = this.#now();
      const record: SkillLocalMarkdownStageRecord = {
        schemaVersion: STAGE_SCHEMA_VERSION,
        requestId: request.requestId,
        stagingId,
        sourceKind: "local_zip",
        manifestSha256: bundle.manifestSha256,
        bundleSha256: bundle.bundleSha256,
        files: projectFiles(bundle.files),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + STAGE_TTL_MS).toISOString()
      };
      this.#publishStage(record, bundle.files);
      const staged = this.#readCandidate(stagingId);
      if (!staged || !isLocalMarkdownRecord(staged.record) || staged.record.sourceKind !== "local_zip" ||
        staged.record.bundleSha256 !== bundle.bundleSha256) {
        return zipFailed(identity);
      }
      return SkillStageFromZipResultSchema.parse({ ...identity, status: "ready", staged: this.#project(staged) });
    } catch (caught) {
      if (caught instanceof SkillZipStageError) return zipInvalid(identity, caught.reason);
      return zipFailed(identity);
    }
  }

  async stageUpdate(
    requestInput: SkillStageUpdateRequest,
    selectedPath?: string,
    signal: AbortSignal = new AbortController().signal
  ): Promise<SkillStageUpdateResult> {
    const request = SkillStageUpdateRequestSchema.parse(requestInput);
    const identity = updateIdentity(request);
    const resolution = this.#registry.resolveUpdateTarget(request);
    if (resolution.status === "result") return resolution.result;
    const target = resolution.target;
    const stagingId = createStagingId(request.requestId);
    try {
      signal.throwIfAborted();
      const existing = this.#readCandidate(stagingId);
      if (existing) {
        if (!existing.record.update ||
          !sameUpdateBinding(existing.record.update, target)) return updateFailed(identity);
        if (!isExpired(existing.record.expiresAt, this.#now())) {
          return SkillStageUpdateResultSchema.parse({ ...identity, status: "ready", staged: this.#project(existing) });
        }
        this.#removeStage(stagingId, existing.record.manifestSha256, existing.record.bundleSha256);
      }

      let bundle: SkillZipBundle;
      let sourceUrl: string | undefined;
      if (target.sourceKind) {
        if (!selectedPath) return updateFailed(identity);
        const selectedKind = target.sourceKind === "local_file"
          ? path.extname(selectedPath).toLocaleLowerCase("en-US") === ".zip" ? "local_zip" : "local_markdown"
          : target.sourceKind;
        if (selectedKind === "local_markdown") {
          const bytes = readSelectedMarkdown(selectedPath);
          bundle = { ...singleManifestBundle(bytes), manifestBytes: bytes, manifestSha256: digest(bytes) };
        } else {
          bundle = await this.#zipStage.readSelectedArchive(selectedPath);
        }
      } else {
        const snapshot = await this.#fetcher.fetchSnapshot(target.sourceUrl, signal);
        signal.throwIfAborted();
        const finalSourceUrl = SkillInstallUrlSchema.safeParse(snapshot.finalUrl);
        if (!finalSourceUrl.success || finalSourceUrl.data !== target.sourceUrl || !isMarkdownContentType(snapshot.contentType)) {
          return updateFailed(identity);
        }
        const bytes = Buffer.from(snapshot.rawContent, "utf8");
        if (bytes.length === 0 || bytes.length > SKILL_URL_STAGE_MAX_UTF8_BYTES ||
          snapshot.rawContent.includes("\uFFFD") || containsRestrictedModelContent(snapshot.rawContent)) {
          return updateFailed(identity);
        }
        bundle = { ...singleManifestBundle(bytes), manifestBytes: bytes, manifestSha256: digest(bytes) };
        sourceUrl = target.sourceUrl;
      }
      const source = decodeUtf8(bundle.manifestBytes);
      if (containsRestrictedModelContent(source)) return updateFailed(identity);
      const manifest = parseSkillManifest(source);
      assertSkillManifestRendererSafe(manifest);
      const expectedKind = target.kind === "external_web" ? "external_web" : "pure";
      if (manifest.id !== target.skillId || manifest.scope !== "machine_local" || manifest.kind !== expectedKind ||
        manifest.sourceUrl !== sourceUrl || !manifest.updatedAt) return updateFailed(identity);
      const manifestSha256 = bundle.manifestSha256;
      const refreshed = this.#registry.resolveUpdateTarget(request);
      if (refreshed.status === "result") return refreshed.result;
      if (!sameUpdateTarget(refreshed.target, target)) return updateFailed(identity);
      if (target.sourceKind
        ? bundle.bundleSha256 === target.installedBundleSha256
        : manifestSha256 === target.installedManifestSha256) {
        return this.#registry.stageUpdateResult(request, "current");
      }
      if (manifest.version === target.installedVersion ||
        Date.parse(manifest.updatedAt) <= Date.parse(target.installedUpdatedAt)) return updateFailed(identity);

      const now = this.#now();
      const baseRecord: SkillStageRecordBase = {
        schemaVersion: STAGE_SCHEMA_VERSION,
        requestId: request.requestId,
        stagingId,
        manifestSha256,
        bundleSha256: bundle.bundleSha256,
        files: projectFiles(bundle.files),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + STAGE_TTL_MS).toISOString()
      };
      const record: SkillStageRecord = target.sourceKind ? {
        ...baseRecord,
        sourceKind: target.sourceKind === "local_file"
          ? path.extname(selectedPath!).toLocaleLowerCase("en-US") === ".zip" ? "local_zip" : "local_markdown"
          : target.sourceKind,
        update: target
      } : {
        ...baseRecord,
        requestSourceUrl: target.sourceUrl,
        finalSourceUrl: target.sourceUrl,
        update: target
      };
      this.#publishStage(record, bundle.files);
      const staged = this.#readCandidate(stagingId);
      if (!staged || staged.record.manifestSha256 !== manifestSha256 ||
        !staged.record.update || !sameUpdateBinding(staged.record.update, target)) return updateFailed(identity);
      return SkillStageUpdateResultSchema.parse({ ...identity, status: "ready", staged: this.#project(staged) });
    } catch {
      return updateFailed(identity);
    }
  }

  resolveUpdateSource(requestInput: SkillStageUpdateRequest): "https" | "local_markdown" | "local_zip" | "local_file" | undefined {
    const resolution = this.#registry.resolveUpdateTarget(SkillStageUpdateRequestSchema.parse(requestInput));
    if (resolution.status !== "ready") return undefined;
    return resolution.target.sourceKind ?? "https";
  }

  installStaged(requestInput: SkillInstallStagedRequest): SkillInstallStagedResult {
    const request = SkillInstallStagedRequestSchema.parse(requestInput);
    return SkillInstallStagedResultSchema.parse(this.#registry.installStaged(request, this));
  }

  discardStaged(requestInput: SkillDiscardStagedRequest): SkillDiscardStagedResult {
    const request = SkillDiscardStagedRequestSchema.parse(requestInput);
    return SkillDiscardStagedResultSchema.parse(this.#registry.discardStaged(request, this));
  }

  readForInstall(stagingId: string, manifestSha256: string, bundleSha256: string): SkillStagedInstallCandidate | "stale" | undefined {
    const parsedId = SkillStagingIdSchema.parse(stagingId);
    const current = this.#readCandidate(parsedId);
    if (!current) return undefined;
    if (current.record.manifestSha256 !== manifestSha256 || current.record.bundleSha256 !== bundleSha256) return "stale";
    if (isExpired(current.record.expiresAt, this.#now())) return undefined;
    return {
      stagingId: parsedId,
      requestId: current.record.requestId,
      source: stageSource(current.record),
      ...(!isLocalMarkdownRecord(current.record) ? { sourceUrl: current.record.finalSourceUrl } : {}),
      manifestSha256: current.record.manifestSha256,
      bundleSha256: current.record.bundleSha256,
      expiresAt: current.record.expiresAt,
      manifest: current.manifest,
      bytes: current.bytes,
      files: current.files,
      warnings: this.#warnings(current),
      ...(current.record.update ? { update: current.record.update } : {})
    };
  }

  discardExact(stagingId: string, manifestSha256: string, bundleSha256: string): "discarded" | "stale" | "not_found" {
    return this.#removeStage(SkillStagingIdSchema.parse(stagingId), manifestSha256, bundleSha256);
  }

  #project(candidate: ReadStageCandidate): SkillStagedSummary {
    const manifest = candidate.manifest;
    if (!isStagedSkillKind(manifest.kind)) throw stageInvalid();
    const warnings = this.#warnings(candidate);
    return {
      stagingId: candidate.record.stagingId,
      manifestSha256: candidate.record.manifestSha256,
      bundleSha256: candidate.record.bundleSha256,
      registryRevision: candidate.record.update?.expectedRegistryRevision ??
        this.#registry.currentRevision(),
      expiresAt: candidate.record.expiresAt,
      ...(!isLocalMarkdownRecord(candidate.record) ? { sourceUrl: candidate.record.finalSourceUrl } : {}),
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      scope: "machine_local",
      kind: manifest.kind,
      capabilities: manifest.capabilities,
      dataBoundaries: manifest.kind === "pure" ? ["local"] : [...deriveSkillDataBoundaries(manifest.capabilities)],
      ...(manifest.kind === "external_web" ? { source: stageSource(candidate.record) } : {}),
      ...(!isLocalMarkdownRecord(candidate.record) && candidate.record.update?.kind === "external_web" ? {
        externalUpdateReview: externalUpdateReview(candidate.record.update, manifest)
      } : {}),
      ...(candidate.record.update && candidate.record.update.kind !== "external_web" ? {
        pureUpdateReview: projectPureSkillUpdateReview(candidate.record.update, candidate.record.files)
      } : {}),
      ...(manifest.runtime ? { runtime: manifest.runtime } : {}),
      ...(manifest.author ? { author: manifest.author } : {}),
      ...(manifest.license ? { license: manifest.license } : {}),
      files: [...candidate.record.files],
      warnings
    };
  }

  #warnings(candidate: ReadStageCandidate): SkillStagedSummary["warnings"] {
    return [
      ...(!isLocalMarkdownRecord(candidate.record) ? ["untrusted_remote_source" as const] : []),
      ...(this.#registry.hasTriggerOverlap(candidate.manifest) ? ["trigger_overlap" as const] : [])
    ];
  }

  #publishStage(
    record: SkillStageRecord,
    files: readonly SkillBundleFile[],
    beforeCommit: () => void = () => undefined
  ): void {
    this.#prepare();
    if (fs.readdirSync(this.#stagingRoot).filter((name) => SkillStagingIdSchema.safeParse(name).success).length >= MAX_STAGED_DIRECTORIES) {
      throw stageError("skill.stage_limit_reached", "Too many Skill reviews are staged.");
    }
    const temporaryPath = path.join(this.#stagingRoot, `.stage.${record.stagingId}.${randomUUID()}.tmp`);
    const destination = this.#stagePath(record.stagingId);
    let published = false;
    try {
      fs.mkdirSync(temporaryPath, { mode: 0o700 });
      writeBundleFiles(temporaryPath, files);
      writePrivateFile(path.join(temporaryPath, STAGE_RECORD_NAME), Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8"));
      fsyncDirectory(temporaryPath);
      try {
        beforeCommit();
        fs.renameSync(temporaryPath, destination);
        published = true;
        fsyncDirectory(this.#stagingRoot);
      } catch (caught) {
        if (!isErrno(caught, "EEXIST") && !isErrno(caught, "ENOTEMPTY")) throw caught;
      }
    } finally {
      if (!published) fs.rmSync(temporaryPath, { recursive: true, force: true });
    }
  }

  #readCandidate(stagingId: string): ReadStageCandidate | undefined {
    const stagePath = this.#stagePath(stagingId);
    let stageStats: fs.Stats;
    try {
      stageStats = fs.lstatSync(stagePath);
    } catch (caught) {
      if (isErrno(caught, "ENOENT")) return undefined;
      throw caught;
    }
    if (!stageStats.isDirectory() || stageStats.isSymbolicLink()) throw stageInvalid();
    const canonicalStage = fs.realpathSync.native(stagePath);
    if (canonicalStage !== stagePath) throw stageInvalid();
    const record = parseStageRecord(readPrivateFile(path.join(stagePath, STAGE_RECORD_NAME), MAX_STAGE_RECORD_BYTES));
    if (record.stagingId !== stagingId || createStagingId(record.requestId) !== stagingId) throw stageInvalid();
    const files = readBundleFiles(stagePath, record.files);
    if (skillBundleSha256(files) !== record.bundleSha256) throw stageInvalid();
    const bytes = files.find((file) => file.relativePath === STAGED_MANIFEST_NAME)?.bytes;
    if (!bytes) throw stageInvalid();
    if (bytes.length === 0 || digest(bytes) !== record.manifestSha256) throw stageInvalid();
    const source = decodeUtf8(bytes);
    const manifest = parseSkillManifest(source);
    if (manifest.scope !== "machine_local" || !isStagedSkillKind(manifest.kind)) throw stageInvalid();
    const sourceKind = stageSource(record);
    if (manifest.kind === "external_web" &&
      ((!isLocalMarkdownRecord(record) && manifest.sourceUrl !== undefined && manifest.sourceUrl !== record.finalSourceUrl) ||
        (sourceKind !== "https" && manifest.sourceUrl !== undefined))) throw stageInvalid();
    assertSkillManifestRendererSafe(manifest);
    return { record, bytes, files, manifest };
  }

  #removeStage(stagingId: string, expectedManifestSha256: string, expectedBundleSha256: string): "discarded" | "stale" | "not_found" {
    const current = this.#readCandidate(stagingId);
    if (!current) return "not_found";
    if (current.record.manifestSha256 !== expectedManifestSha256 || current.record.bundleSha256 !== expectedBundleSha256) return "stale";
    const destination = this.#stagePath(stagingId);
    const tombstone = path.join(this.#stagingRoot, `.discarded.${stagingId}.${randomUUID()}`);
    fs.renameSync(destination, tombstone);
    fsyncDirectory(this.#stagingRoot);
    fs.rmSync(tombstone, { recursive: true, force: true });
    return "discarded";
  }

  #reapExpiredStages(): void {
    for (const entry of fs.readdirSync(this.#stagingRoot)) {
      if (!SkillStagingIdSchema.safeParse(entry).success) continue;
      try {
        const current = this.#readCandidate(entry);
        if (current && isExpired(current.record.expiresAt, this.#now())) {
          this.#removeStage(entry, current.record.manifestSha256, current.record.bundleSha256);
        }
      } catch {
        // Unsafe residue is retained for explicit repair rather than guessed away.
      }
    }
  }

  #stagePath(stagingId: string): string {
    const candidate = path.join(this.#stagingRoot, stagingId);
    if (path.dirname(candidate) !== this.#stagingRoot) throw stageInvalid();
    return candidate;
  }

  #prepare(): void {
    fs.mkdirSync(this.#stagingRoot, { recursive: true, mode: 0o700 });
    for (const directory of [this.#rootPath, this.#stagingRoot]) {
      const stats = fs.lstatSync(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync.native(directory) !== directory) {
        throw stageInvalid();
      }
    }
  }
}

interface ReadStageCandidate {
  readonly record: SkillStageRecord;
  readonly bytes: Buffer;
  readonly files: readonly SkillBundleFile[];
  readonly manifest: SkillManifest;
}

function parseStageRecord(bytes: Buffer): SkillStageRecord {
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(bytes));
  } catch {
    throw stageInvalid();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw stageInvalid();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  const isLocal = [
    "bundleSha256,createdAt,expiresAt,files,manifestSha256,requestId,schemaVersion,sourceKind,stagingId",
    "bundleSha256,createdAt,expiresAt,files,manifestSha256,requestId,schemaVersion,sourceKind,stagingId,update"
  ].includes(keys) &&
    (record.sourceKind === "local_markdown" || record.sourceKind === "local_zip") && typeof record.requestId === "string" &&
    (/^skillreq_[a-z0-9]{16,64}$/u.test(record.requestId) || isSkillUpdateStageRecord(record)) &&
    (record.update === undefined || [record.sourceKind, "local_file"].includes(
      String((record.update as Record<string, unknown>).sourceKind)
    ));
  let chatBindingValid = true;
  if (record.chat !== undefined) {
    try {
      parseChatBinding(record.chat);
    } catch {
      chatBindingValid = false;
    }
  }
  const isUrl = [
    "bundleSha256,createdAt,expiresAt,files,finalSourceUrl,manifestSha256,requestId,requestSourceUrl,schemaVersion,stagingId",
    "bundleSha256,chat,createdAt,expiresAt,files,finalSourceUrl,manifestSha256,requestId,requestSourceUrl,schemaVersion,stagingId",
    "bundleSha256,createdAt,expiresAt,files,finalSourceUrl,manifestSha256,requestId,requestSourceUrl,schemaVersion,stagingId,update"
  ].includes(keys) &&
    (SkillStageFromUrlRequestSchema.safeParse({ apiVersion: 1, requestId: record.requestId, sourceUrl: record.requestSourceUrl }).success ||
      isSkillUpdateStageRecord(record)) && SkillInstallUrlSchema.safeParse(record.finalSourceUrl).success &&
    chatBindingValid &&
    !(record.chat !== undefined && record.update !== undefined);
  if (
    (!isLocal && !isUrl) ||
    record.schemaVersion !== STAGE_SCHEMA_VERSION ||
    !SkillStagingIdSchema.safeParse(record.stagingId).success ||
    typeof record.manifestSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.manifestSha256) ||
    typeof record.bundleSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.bundleSha256) ||
    !Array.isArray(record.files) || record.files.length < 1 ||
    typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
    typeof record.expiresAt !== "string" || !Number.isFinite(Date.parse(record.expiresAt))
  ) throw stageInvalid();
  let files;
  try { files = record.files.map((file) => SkillStagedFileSummarySchema.parse(file)); } catch { throw stageInvalid(); }
  return { ...record, files } as unknown as SkillStageRecord;
}

function isLocalMarkdownRecord(record: SkillStageRecord): record is SkillLocalMarkdownStageRecord {
  return "sourceKind" in record;
}

function isStagedSkillKind(kind: SkillManifest["kind"]): kind is "pure" | "external_web" {
  return kind === "pure" || kind === "external_web";
}

function stageSource(record: SkillStageRecord): SkillInstallSourceKind {
  return isLocalMarkdownRecord(record) ? record.sourceKind : "https";
}

function parseChatBinding(value: unknown): SkillChatStageBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw stageInvalid();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "activeVaultId,candidateIndex,clientTurnId,conversationEventId,jobId" ||
    !VaultIdSchema.safeParse(record.activeVaultId).success ||
    !JobIdSchema.safeParse(record.jobId).success ||
    !AgentClientTurnIdSchema.safeParse(record.clientTurnId).success ||
    !ConversationEventIdSchema.safeParse(record.conversationEventId).success ||
    !Number.isInteger(record.candidateIndex) || Number(record.candidateIndex) < 1 || Number(record.candidateIndex) > 8
  ) throw stageInvalid();
  return record as unknown as SkillChatStageBinding;
}

function sameOptionalChatBinding(
  left: SkillChatStageBinding | undefined,
  right: SkillChatStageBinding | undefined
): boolean {
  if (!left || !right) return left === right;
  return left.activeVaultId === right.activeVaultId && left.jobId === right.jobId &&
    left.clientTurnId === right.clientTurnId && left.conversationEventId === right.conversationEventId &&
    left.candidateIndex === right.candidateIndex;
}

function canonicalPrivateRoot(rootInput: string): string {
  if (!path.isAbsolute(rootInput)) throw stageInvalid();
  fs.mkdirSync(rootInput, { recursive: true, mode: 0o700 });
  const root = fs.realpathSync.native(rootInput);
  const stats = fs.lstatSync(root);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw stageInvalid();
  return root;
}

function readPrivateFile(filePath: string, maximumBytes: number, expected?: fs.Stats): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size <= 0 || before.size > maximumBytes) {
      throw stageInvalid();
    }
    if (expected && (before.dev !== expected.dev || before.ino !== expected.ino || before.size !== expected.size ||
      before.mtimeMs !== expected.mtimeMs)) throw stageInvalid();
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!sameIdentity(before, after)) throw stageInvalid();
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readSelectedMarkdown(filePath: string): Buffer {
  if (!path.isAbsolute(filePath) || path.extname(filePath).toLocaleLowerCase("en-US") !== ".md") throw stageInvalid();
  const selected = fs.lstatSync(filePath);
  if (!selected.isFile() || selected.isSymbolicLink()) throw stageInvalid();
  const canonicalPath = fs.realpathSync.native(filePath);
  const canonical = fs.lstatSync(canonicalPath);
  if (selected.dev !== canonical.dev || selected.ino !== canonical.ino) throw stageInvalid();
  return readPrivateFile(canonicalPath, SKILL_URL_STAGE_MAX_UTF8_BYTES, selected);
}

function writePrivateFile(filePath: string, bytes: Buffer): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function projectFiles(files: readonly SkillBundleFile[]) {
  return normalizeBundleFiles(files).map((file) => ({
    relativePath: file.relativePath,
    utf8ByteSize: file.bytes.length,
    sha256: file.sha256
  }));
}

function writeBundleFiles(rootPath: string, files: readonly SkillBundleFile[]): void {
  for (const file of normalizeBundleFiles(files)) {
    const destination = path.join(rootPath, ...file.relativePath.split("/"));
    if (!destination.startsWith(`${rootPath}${path.sep}`)) throw stageInvalid();
    const parent = path.dirname(destination);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    let cursor = parent;
    while (cursor !== rootPath) {
      const stats = fs.lstatSync(cursor);
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw stageInvalid();
      cursor = path.dirname(cursor);
    }
    writePrivateFile(destination, file.bytes);
  }
}

function readBundleFiles(
  rootPath: string,
  summaries: SkillStageRecordBase["files"]
): readonly SkillBundleFile[] {
  const expected = new Map(summaries.map((file) => [file.relativePath, file]));
  if (expected.size !== summaries.length) throw stageInvalid();
  const discovered: string[] = [];
  const visit = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === STAGE_RECORD_NAME && prefix === "") continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      const stats = fs.lstatSync(absolutePath);
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) throw stageInvalid();
      if (entry.isDirectory() && stats.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile() && stats.isFile() && stats.nlink === 1) {
        discovered.push(relativePath);
      } else {
        throw stageInvalid();
      }
    }
  };
  visit(rootPath, "");
  if (discovered.length !== expected.size || discovered.some((entry) => !expected.has(entry))) throw stageInvalid();
  const files = summaries.map((summary) => {
    if (!Number.isSafeInteger(summary.utf8ByteSize) || summary.utf8ByteSize < 1 ||
      !/^sha256:[a-f0-9]{64}$/u.test(summary.sha256)) throw stageInvalid();
    const absolutePath = path.join(rootPath, ...summary.relativePath.split("/"));
    if (!absolutePath.startsWith(`${rootPath}${path.sep}`)) throw stageInvalid();
    const bytes = readPrivateFile(absolutePath, summary.utf8ByteSize);
    if (bytes.length !== summary.utf8ByteSize || digest(bytes) !== summary.sha256) throw stageInvalid();
    decodeUtf8(bytes);
    return { relativePath: summary.relativePath, bytes, sha256: summary.sha256 };
  });
  return normalizeBundleFiles(files);
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw stageInvalid();
  }
}

function createStagingId(requestId: string): string {
  return SkillStagingIdSchema.parse(
    `skillstage_${createHash("sha256").update("pige.skill.stage.v1\0", "utf8").update(requestId, "utf8").digest("hex").slice(0, 32)}`
  );
}

function digest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function isMarkdownContentType(value: string): boolean {
  const contentType = value.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
  return contentType === "text/markdown" || contentType === "text/plain";
}

function isExpired(value: string, now: Date): boolean {
  return Date.parse(value) <= now.getTime();
}

function fsyncDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!["EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"].some((code) => isErrno(caught, code))) {
      throw caught;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function invalidStageResult(requestId: string, reason: "source_too_large" | "manifest_invalid" | "unsupported_kind" | "unsupported_scope" | "unsafe_content"): SkillStageFromUrlResult {
  return SkillStageFromUrlResultSchema.parse({ status: "invalid", requestId, reason });
}

function stageFailed(requestId: string): SkillStageFromUrlResult {
  return SkillStageFromUrlResultSchema.parse({
    status: "failed",
    requestId,
    error: {
      code: "skill.stage_unavailable",
      domain: "skill",
      messageKey: "error.generic",
      retryable: true,
      severity: "error",
      userAction: "retry"
    }
  });
}

function markdownIdentity(request: SkillStageFromMarkdownRequest) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId };
}

function markdownFailed(identity: ReturnType<typeof markdownIdentity>): SkillStageFromMarkdownResult {
  return SkillStageFromMarkdownResultSchema.parse({ ...identity, status: "failed" });
}

function zipInvalid(
  identity: ReturnType<typeof markdownIdentity>,
  reason: SkillZipStageError["reason"]
): SkillStageFromZipResult {
  return SkillStageFromZipResultSchema.parse({ ...identity, status: "invalid", reason });
}

function zipFailed(identity: ReturnType<typeof markdownIdentity>): SkillStageFromZipResult {
  return SkillStageFromZipResultSchema.parse({ ...identity, status: "failed" });
}

function updateIdentity(request: SkillStageUpdateRequest) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId, skillId: request.skillId };
}

function updateFailed(identity: ReturnType<typeof updateIdentity>): SkillStageUpdateResult {
  return SkillStageUpdateResultSchema.parse({ ...identity, status: "failed" });
}

function sameUpdateBinding(left: SkillStagedUpdateBinding, right: SkillStagedUpdateBinding): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameUpdateTarget(left: SkillUpdateTarget, right: SkillUpdateTarget): boolean {
  return left.sourceUrl === right.sourceUrl && left.sourceKind === right.sourceKind && sameUpdateBinding(left, right);
}

function externalUpdateReview(update: SkillStagedUpdateBinding, manifest: SkillManifest) {
  if (update.kind !== "external_web" || !update.installedBundleSha256 ||
    !update.installedCapabilities || !update.installedDataBoundaries) throw stageInvalid();
  const nextBoundaries = deriveSkillDataBoundaries(manifest.capabilities);
  return {
    kind: "external_web" as const,
    previousVersion: update.installedVersion,
    previousManifestSha256: update.installedManifestSha256,
    previousBundleSha256: update.installedBundleSha256,
    addedCapabilities: manifest.capabilities.filter((value) => !update.installedCapabilities!.includes(value)),
    removedCapabilities: update.installedCapabilities.filter((value) => !manifest.capabilities.includes(value)),
    addedDataBoundaries: nextBoundaries.filter((value) => !update.installedDataBoundaries!.includes(value)),
    removedDataBoundaries: update.installedDataBoundaries.filter((value) => !nextBoundaries.includes(value)),
    finalEnabled: false as const
  };
}

function stageError(code: string, message: string): PigeDomainError {
  return new PigeDomainError(code, message);
}

function stageInvalid(): PigeDomainError {
  return stageError("skill.stage_invalid", "The staged Skill is unavailable or invalid.");
}
