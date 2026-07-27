import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  SKILL_URL_STAGE_MAX_UTF8_BYTES,
  SkillDiscardStagedRequestSchema,
  SkillDiscardStagedResultSchema,
  SkillInstallStagedRequestSchema,
  SkillInstallStagedResultSchema,
  SkillInstallUrlSchema,
  SkillStageFromUrlRequestSchema,
  SkillStageFromUrlResultSchema,
  SkillStageUpdateRequestSchema,
  SkillStageUpdateResultSchema,
  SkillStagingIdSchema,
  type SkillDiscardStagedRequest,
  type SkillDiscardStagedResult,
  type SkillInstallStagedRequest,
  type SkillInstallStagedResult,
  type SkillManifest,
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
  type SkillStagedInstallCandidate,
  type SkillStagedUpdateBinding,
  type SkillUpdateTarget,
  type SkillStagingStorePort
} from "./skill-source-update-registry";
import { SourceFetchService, type SourceFetchSnapshot } from "./source-fetch-service";
import { hasObjectErrorCode as isErrno } from "./object-error-code";

const STAGE_SCHEMA_VERSION = 1;
const STAGE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STAGE_RECORD_BYTES = 32 * 1024;
const MAX_STAGED_DIRECTORIES = 32;
const STAGE_RECORD_NAME = ".pige-stage.json";
const STAGED_MANIFEST_NAME = "SKILL.md";

interface SkillStageRecord {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly stagingId: string;
  readonly requestSourceUrl: string;
  readonly finalSourceUrl: string;
  readonly manifestSha256: `sha256:${string}`;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly update?: SkillUpdateTarget;
}

export interface SkillUrlFetchPort {
  fetchSnapshot(url: string, signal?: AbortSignal): Promise<SourceFetchSnapshot>;
}

export interface SkillUrlInstallServiceOptions {
  readonly appDataRoot: string;
  readonly registry: SkillRegistryService;
  readonly fetcher?: SkillUrlFetchPort;
  readonly now?: () => Date;
}

export class SkillUrlInstallService implements SkillStagingStorePort {
  readonly #rootPath: string;
  readonly #stagingRoot: string;
  readonly #registry: SkillRegistryService;
  readonly #fetcher: SkillUrlFetchPort;
  readonly #now: () => Date;

  constructor(options: SkillUrlInstallServiceOptions) {
    const appDataRoot = canonicalPrivateRoot(options.appDataRoot);
    this.#rootPath = path.join(appDataRoot, "skills");
    this.#stagingRoot = path.join(this.#rootPath, "staging");
    this.#registry = options.registry;
    this.#fetcher = options.fetcher ?? new SourceFetchService({ maxBytes: SKILL_URL_STAGE_MAX_UTF8_BYTES });
    this.#now = options.now ?? (() => new Date());
    this.#prepare();
    this.#reapExpiredStages();
  }

  async stageFromUrl(
    requestInput: SkillStageFromUrlRequest,
    signal: AbortSignal = new AbortController().signal
  ): Promise<SkillStageFromUrlResult> {
    const request = SkillStageFromUrlRequestSchema.parse(requestInput);
    const stagingId = createStagingId(request.requestId);
    try {
      signal.throwIfAborted();
      const existing = this.#readCandidate(stagingId);
      if (existing) {
        if (existing.record.requestId !== request.requestId || existing.record.requestSourceUrl !== request.sourceUrl) {
          return stageFailed(request.requestId);
        }
        if (!isExpired(existing.record.expiresAt, this.#now())) {
          return SkillStageFromUrlResultSchema.parse({
            status: "ready",
            requestId: request.requestId,
            staged: this.#project(existing)
          });
        }
        this.#removeStage(stagingId, existing.record.manifestSha256);
      }

      const snapshot = await this.#fetcher.fetchSnapshot(request.sourceUrl, signal);
      signal.throwIfAborted();
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
      if (manifest.kind !== "pure") return invalidStageResult(request.requestId, "unsupported_kind");
      try {
        assertSkillManifestRendererSafe(manifest);
      } catch {
        return invalidStageResult(request.requestId, "unsafe_content");
      }

      const now = this.#now();
      const record: SkillStageRecord = {
        schemaVersion: STAGE_SCHEMA_VERSION,
        requestId: request.requestId,
        stagingId,
        requestSourceUrl: request.sourceUrl,
        finalSourceUrl: finalSourceUrl.data,
        manifestSha256: digest(bytes),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + STAGE_TTL_MS).toISOString()
      };
      this.#publishStage(record, bytes);
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

  async stageUpdate(
    requestInput: SkillStageUpdateRequest,
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
        if (!existing.record.update || !sameUpdateBinding(existing.record.update, target)) return updateFailed(identity);
        if (!isExpired(existing.record.expiresAt, this.#now())) {
          return SkillStageUpdateResultSchema.parse({ ...identity, status: "ready", staged: this.#project(existing) });
        }
        this.#removeStage(stagingId, existing.record.manifestSha256);
      }

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
      const manifest = parseSkillManifest(snapshot.rawContent);
      assertSkillManifestRendererSafe(manifest);
      if (manifest.id !== target.skillId || manifest.scope !== "machine_local" || manifest.kind !== "pure" ||
        manifest.sourceUrl !== target.sourceUrl || !manifest.updatedAt) return updateFailed(identity);
      const manifestSha256 = digest(bytes);
      const refreshed = this.#registry.resolveUpdateTarget(request);
      if (refreshed.status === "result") return refreshed.result;
      if (!sameUpdateTarget(refreshed.target, target)) return updateFailed(identity);
      if (manifestSha256 === target.installedManifestSha256) {
        return this.#registry.stageUpdateResult(request, "current");
      }
      if (manifest.version === target.installedVersion ||
        Date.parse(manifest.updatedAt) <= Date.parse(target.installedUpdatedAt)) return updateFailed(identity);

      const now = this.#now();
      const record: SkillStageRecord = {
        schemaVersion: STAGE_SCHEMA_VERSION,
        requestId: request.requestId,
        stagingId,
        requestSourceUrl: target.sourceUrl,
        finalSourceUrl: target.sourceUrl,
        manifestSha256,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + STAGE_TTL_MS).toISOString(),
        update: target
      };
      this.#publishStage(record, bytes);
      const staged = this.#readCandidate(stagingId);
      if (!staged || staged.record.manifestSha256 !== manifestSha256 ||
        !staged.record.update || !sameUpdateBinding(staged.record.update, target)) return updateFailed(identity);
      return SkillStageUpdateResultSchema.parse({ ...identity, status: "ready", staged: this.#project(staged) });
    } catch {
      return updateFailed(identity);
    }
  }

  installStaged(requestInput: SkillInstallStagedRequest): SkillInstallStagedResult {
    const request = SkillInstallStagedRequestSchema.parse(requestInput);
    return SkillInstallStagedResultSchema.parse(this.#registry.installStaged(request, this));
  }

  discardStaged(requestInput: SkillDiscardStagedRequest): SkillDiscardStagedResult {
    const request = SkillDiscardStagedRequestSchema.parse(requestInput);
    return SkillDiscardStagedResultSchema.parse(this.#registry.discardStaged(request, this));
  }

  readForInstall(stagingId: string, manifestSha256: string): SkillStagedInstallCandidate | "stale" | undefined {
    const parsedId = SkillStagingIdSchema.parse(stagingId);
    const current = this.#readCandidate(parsedId);
    if (!current) return undefined;
    if (current.record.manifestSha256 !== manifestSha256) return "stale";
    if (isExpired(current.record.expiresAt, this.#now())) return undefined;
    return {
      stagingId: parsedId,
      requestId: current.record.requestId,
      sourceUrl: current.record.finalSourceUrl,
      manifestSha256: current.record.manifestSha256,
      expiresAt: current.record.expiresAt,
      manifest: current.manifest,
      bytes: current.bytes,
      ...(current.record.update ? { update: current.record.update } : {})
    };
  }

  discardExact(stagingId: string, manifestSha256: string): "discarded" | "stale" | "not_found" {
    return this.#removeStage(SkillStagingIdSchema.parse(stagingId), manifestSha256);
  }

  #project(candidate: ReadStageCandidate): SkillStagedSummary {
    const manifest = candidate.manifest;
    const warnings = [
      "untrusted_remote_source" as const,
      ...(this.#registry.hasTriggerOverlap(manifest) ? ["trigger_overlap" as const] : [])
    ];
    return {
      stagingId: candidate.record.stagingId,
      manifestSha256: candidate.record.manifestSha256,
      registryRevision: candidate.record.update?.expectedRegistryRevision ?? this.#registry.currentRevision(),
      expiresAt: candidate.record.expiresAt,
      sourceUrl: candidate.record.finalSourceUrl,
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      scope: "machine_local",
      kind: "pure",
      capabilities: manifest.capabilities,
      dataBoundaries: ["local"],
      ...(manifest.author ? { author: manifest.author } : {}),
      ...(manifest.license ? { license: manifest.license } : {}),
      files: [{ relativePath: "SKILL.md", utf8ByteSize: candidate.bytes.length, sha256: candidate.record.manifestSha256 }],
      warnings
    };
  }

  #publishStage(record: SkillStageRecord, bytes: Buffer): void {
    this.#prepare();
    if (fs.readdirSync(this.#stagingRoot).filter((name) => SkillStagingIdSchema.safeParse(name).success).length >= MAX_STAGED_DIRECTORIES) {
      throw stageError("skill.stage_limit_reached", "Too many Skill reviews are staged.");
    }
    const temporaryPath = path.join(this.#stagingRoot, `.stage.${record.stagingId}.${randomUUID()}.tmp`);
    const destination = this.#stagePath(record.stagingId);
    let published = false;
    try {
      fs.mkdirSync(temporaryPath, { mode: 0o700 });
      writePrivateFile(path.join(temporaryPath, STAGED_MANIFEST_NAME), bytes);
      writePrivateFile(path.join(temporaryPath, STAGE_RECORD_NAME), Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8"));
      fsyncDirectory(temporaryPath);
      try {
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
    const bytes = readPrivateFile(path.join(stagePath, STAGED_MANIFEST_NAME), SKILL_URL_STAGE_MAX_UTF8_BYTES);
    if (bytes.length === 0 || digest(bytes) !== record.manifestSha256) throw stageInvalid();
    const source = decodeUtf8(bytes);
    const manifest = parseSkillManifest(source);
    if (manifest.scope !== "machine_local" || manifest.kind !== "pure") throw stageInvalid();
    assertSkillManifestRendererSafe(manifest);
    return { record, bytes, manifest };
  }

  #removeStage(stagingId: string, expectedManifestSha256: string): "discarded" | "stale" | "not_found" {
    const current = this.#readCandidate(stagingId);
    if (!current) return "not_found";
    if (current.record.manifestSha256 !== expectedManifestSha256) return "stale";
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
          this.#removeStage(entry, current.record.manifestSha256);
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
  if (
    ![
      "createdAt,expiresAt,finalSourceUrl,manifestSha256,requestId,requestSourceUrl,schemaVersion,stagingId",
      "createdAt,expiresAt,finalSourceUrl,manifestSha256,requestId,requestSourceUrl,schemaVersion,stagingId,update"
    ].includes(Object.keys(record).sort().join(",")) ||
    record.schemaVersion !== STAGE_SCHEMA_VERSION ||
    !(SkillStageFromUrlRequestSchema.safeParse({ apiVersion: 1, requestId: record.requestId, sourceUrl: record.requestSourceUrl }).success ||
      isUpdateRecord(record)) ||
    !SkillStagingIdSchema.safeParse(record.stagingId).success ||
    !SkillInstallUrlSchema.safeParse(record.finalSourceUrl).success ||
    typeof record.manifestSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.manifestSha256) ||
    typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
    typeof record.expiresAt !== "string" || !Number.isFinite(Date.parse(record.expiresAt))
  ) throw stageInvalid();
  return record as unknown as SkillStageRecord;
}

function canonicalPrivateRoot(rootInput: string): string {
  if (!path.isAbsolute(rootInput)) throw stageInvalid();
  fs.mkdirSync(rootInput, { recursive: true, mode: 0o700 });
  const root = fs.realpathSync.native(rootInput);
  const stats = fs.lstatSync(root);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw stageInvalid();
  return root;
}

function readPrivateFile(filePath: string, maximumBytes: number): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size <= 0 || before.size > maximumBytes) {
      throw stageInvalid();
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!sameIdentity(before, after)) throw stageInvalid();
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
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
  return left.sourceUrl === right.sourceUrl && sameUpdateBinding(left, right);
}

function isUpdateRecord(record: Record<string, unknown>): boolean {
  if (!record.update || typeof record.update !== "object" || Array.isArray(record.update)) return false;
  const update = record.update as Record<string, unknown>;
  return Object.keys(update).sort().join(",") ===
      "activeVaultId,enabled,expectedRegistryRevision,installedManifestSha256,installedUpdatedAt,installedVersion,skillId,sourceUrl" &&
    SkillStageUpdateRequestSchema.safeParse({
      apiVersion: 1,
      requestId: record.requestId,
      activeVaultId: update.activeVaultId,
      skillId: update.skillId,
      expectedRegistryRevision: update.expectedRegistryRevision
    }).success && update.sourceUrl === record.requestSourceUrl && update.sourceUrl === record.finalSourceUrl &&
    SkillInstallUrlSchema.safeParse(update.sourceUrl).success && typeof update.enabled === "boolean" &&
    typeof update.installedManifestSha256 === "string" && /^sha256:[a-f0-9]{64}$/u.test(update.installedManifestSha256) &&
    typeof update.installedVersion === "string" && typeof update.installedUpdatedAt === "string" &&
    Number.isFinite(Date.parse(update.installedUpdatedAt));
}

function stageError(code: string, message: string): PigeDomainError {
  return new PigeDomainError(code, message);
}

function stageInvalid(): PigeDomainError {
  return stageError("skill.stage_invalid", "The staged Skill is unavailable or invalid.");
}
