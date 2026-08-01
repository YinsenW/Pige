import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  LOCAL_RERANKER_ASSET_BYTES,
  LOCAL_RERANKER_ASSET_ID,
  LOCAL_RERANKER_ASSET_REVISION,
  LOCAL_RERANKER_ASSET_SHA256,
  type LocalSemanticRetrievalAssetState
} from "@pige/schemas";

const RECORD_NAME = "asset-state.json";
const ASSET_NAME = "Qwen3-Reranker-0.6B-Q3_K_M.gguf";
const MAX_RECORD_BYTES = 256 * 1024;

export interface LocalRerankerReceipt {
  readonly requestId: string;
  readonly action: "install" | "enable" | "disable" | "remove";
  readonly revision: number;
  readonly status: string;
  readonly jobId?: string;
}

export interface LocalRerankerRecord {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly assetId: typeof LOCAL_RERANKER_ASSET_ID;
  readonly assetRevision: typeof LOCAL_RERANKER_ASSET_REVISION;
  readonly assetSha256: typeof LOCAL_RERANKER_ASSET_SHA256;
  readonly assetBytes: typeof LOCAL_RERANKER_ASSET_BYTES;
  readonly state: LocalSemanticRetrievalAssetState;
  readonly updatedAt: string;
  readonly activeRequestId?: string;
  readonly activeJobId?: string;
  readonly receipts: readonly LocalRerankerReceipt[];
}

export interface VerifiedLocalRerankerAsset {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface LocalRerankerAssetStorePort {
  read(now: string): LocalRerankerRecord;
  write(record: LocalRerankerRecord): void;
  createStagingPath(requestId: string): string;
  verify(pathInput?: string): Promise<VerifiedLocalRerankerAsset>;
  stillMatches(binding: VerifiedLocalRerankerAsset | undefined): boolean;
  publish(stagingPath: string): Promise<VerifiedLocalRerankerAsset>;
  removeAsset(): void;
  discardStaging(): void;
  assetPath(): string;
}

export class LocalRerankerAssetStore implements LocalRerankerAssetStorePort {
  readonly #root: string;
  readonly #stagingRoot: string;
  readonly #assetRoot: string;

  constructor(appDataRootInput: string) {
    if (!path.isAbsolute(appDataRootInput)) throw new Error("Local reranker root must be absolute.");
    fs.mkdirSync(appDataRootInput, { recursive: true, mode: 0o700 });
    const appDataRoot = fs.realpathSync.native(appDataRootInput);
    this.#root = path.join(appDataRoot, "local-reranker");
    this.#stagingRoot = path.join(this.#root, "staging");
    this.#assetRoot = path.join(this.#root, "assets");
    for (const directory of [this.#root, this.#stagingRoot, this.#assetRoot]) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Local reranker storage is unsafe.");
    }
    if (fs.realpathSync.native(this.#root) !== this.#root) throw new Error("Local reranker storage escaped its root.");
  }

  read(now: string): LocalRerankerRecord {
    const recordPath = path.join(this.#root, RECORD_NAME);
    if (!fs.existsSync(recordPath)) return initialRecord(now);
    const stat = fs.lstatSync(recordPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD_BYTES) {
      throw new Error("Local reranker state is invalid.");
    }
    return parseRecord(JSON.parse(fs.readFileSync(recordPath, "utf8")));
  }

  write(record: LocalRerankerRecord): void {
    const parsed = parseRecord(record);
    const temporaryPath = path.join(this.#root, `.${RECORD_NAME}.${process.pid}.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
        0o600
      );
      fs.writeFileSync(descriptor, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, path.join(this.#root, RECORD_NAME));
      fsyncDirectory(this.#root);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      fs.rmSync(temporaryPath, { force: true });
    }
  }

  createStagingPath(requestId: string): string {
    if (!/^rerankasset_[a-z0-9]{16,64}$/u.test(requestId)) throw new Error("Invalid reranker request identity.");
    return path.join(this.#stagingRoot, `${requestId}.${randomUUID()}.download`);
  }

  async verify(pathInput = this.assetPath()): Promise<VerifiedLocalRerankerAsset> {
    const descriptor = await fs.promises.open(pathInput, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const before = await descriptor.stat();
      if (!before.isFile() || before.size !== LOCAL_RERANKER_ASSET_BYTES) {
        throw new Error("Local reranker size is invalid.");
      }
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let position = 0;
      while (position < before.size) {
        const { bytesRead } = await descriptor.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
        if (bytesRead <= 0) throw new Error("Local reranker ended unexpectedly.");
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      const after = await descriptor.stat();
      if (!sameStat(before, after) || `sha256:${hash.digest("hex")}` !== LOCAL_RERANKER_ASSET_SHA256) {
        throw new Error("Local reranker identity is invalid.");
      }
      return { path: pathInput, dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs };
    } finally {
      await descriptor.close();
    }
  }

  stillMatches(binding: VerifiedLocalRerankerAsset | undefined): boolean {
    if (!binding) return false;
    try {
      const stat = fs.lstatSync(binding.path);
      return !stat.isSymbolicLink() && stat.isFile() && stat.dev === binding.dev && stat.ino === binding.ino &&
        stat.size === binding.size && stat.mtimeMs === binding.mtimeMs;
    } catch {
      return false;
    }
  }

  async publish(stagingPath: string): Promise<VerifiedLocalRerankerAsset> {
    const resolved = path.resolve(stagingPath);
    if (!resolved.startsWith(`${this.#stagingRoot}${path.sep}`)) throw new Error("Reranker staging escaped its owner.");
    await this.verify(resolved);
    fs.rmSync(this.assetPath(), { force: true });
    fs.renameSync(resolved, this.assetPath());
    fsyncDirectory(this.#assetRoot);
    return this.verify(this.assetPath());
  }

  removeAsset(): void {
    fs.rmSync(this.assetPath(), { force: true });
    fsyncDirectory(this.#assetRoot);
  }

  discardStaging(): void {
    for (const entry of fs.readdirSync(this.#stagingRoot, { withFileTypes: true })) {
      if (entry.isFile() || entry.isSymbolicLink()) fs.rmSync(path.join(this.#stagingRoot, entry.name), { force: true });
    }
    fsyncDirectory(this.#stagingRoot);
  }

  assetPath(): string {
    return path.join(this.#assetRoot, ASSET_NAME);
  }
}

function initialRecord(now: string): LocalRerankerRecord {
  return {
    schemaVersion: 1, revision: 0, assetId: LOCAL_RERANKER_ASSET_ID,
    assetRevision: LOCAL_RERANKER_ASSET_REVISION, assetSha256: LOCAL_RERANKER_ASSET_SHA256,
    assetBytes: LOCAL_RERANKER_ASSET_BYTES, state: "not_installed", updatedAt: now, receipts: []
  };
}

function parseRecord(value: unknown): LocalRerankerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reranker state.");
  const record = value as Partial<LocalRerankerRecord>;
  const states = ["not_installed", "installing", "verifying", "ready", "disabled", "needs_repair"];
  const active = states.slice(1, 3).includes(record.state ?? "");
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || (record.revision ?? -1) < 0 ||
    record.assetId !== LOCAL_RERANKER_ASSET_ID || record.assetRevision !== LOCAL_RERANKER_ASSET_REVISION ||
    record.assetSha256 !== LOCAL_RERANKER_ASSET_SHA256 || record.assetBytes !== LOCAL_RERANKER_ASSET_BYTES ||
    !states.includes(record.state ?? "") || typeof record.updatedAt !== "string" ||
    !Array.isArray(record.receipts) || record.receipts.length > 64 || !record.receipts.every(isReceipt) ||
    (record.activeRequestId !== undefined && !/^rerankasset_[a-z0-9]{16,64}$/u.test(record.activeRequestId)) ||
    (record.activeJobId !== undefined && !/^job_\d{8}_[a-z0-9]{8,}$/u.test(record.activeJobId)) ||
    active !== (record.activeRequestId !== undefined && record.activeJobId !== undefined)) {
    throw new Error("Invalid reranker state.");
  }
  return record as LocalRerankerRecord;
}

function isReceipt(value: unknown): value is LocalRerankerReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<LocalRerankerReceipt>;
  return typeof receipt.requestId === "string" && /^rerankasset_[a-z0-9]{16,64}$/u.test(receipt.requestId) &&
    ["install", "enable", "disable", "remove"].includes(receipt.action ?? "") &&
    Number.isSafeInteger(receipt.revision) && (receipt.revision ?? -1) >= 0 && typeof receipt.status === "string" &&
    (receipt.jobId === undefined || /^job_\d{8}_[a-z0-9]{8,}$/u.test(receipt.jobId));
}

function sameStat(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function fsyncDirectory(directoryPath: string): void {
  try {
    const descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch {
    if (process.platform !== "win32") throw new Error("Failed to flush local reranker storage.");
  }
}
