import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SKILL_ZIP_STAGE_MAX_ARCHIVE_BYTES,
  SKILL_ZIP_STAGE_MAX_COMPRESSION_RATIO,
  SKILL_ZIP_STAGE_MAX_EXPANDED_BYTES,
  SKILL_ZIP_STAGE_MAX_FILE_BYTES,
  SKILL_ZIP_STAGE_MAX_FILES,
  SkillStagedRelativePathSchema,
  type SkillZipStageInvalidReason
} from "@pige/schemas";
import { openPromise, validateFileName, type Entry } from "yauzl";
import { containsRestrictedModelContent } from "./model-egress-content";

export interface SkillBundleFile {
  readonly relativePath: string;
  readonly bytes: Buffer;
  readonly sha256: `sha256:${string}`;
}

export interface SkillZipBundle {
  readonly files: readonly SkillBundleFile[];
  readonly manifestBytes: Buffer;
  readonly manifestSha256: `sha256:${string}`;
  readonly bundleSha256: `sha256:${string}`;
}

export class SkillZipStageError extends Error {
  readonly reason: SkillZipStageInvalidReason;

  constructor(reason: SkillZipStageInvalidReason) {
    super(`skill.zip_stage.${reason}`);
    this.name = "SkillZipStageError";
    this.reason = reason;
  }
}

export class SkillZipStageService {
  readonly #temporaryRoot: string;

  constructor(appDataRoot: string) {
    if (!path.isAbsolute(appDataRoot)) throw zipError("archive_unsafe");
    const root = fs.realpathSync.native(appDataRoot);
    this.#temporaryRoot = path.join(root, "skills", "zip-import");
    fs.mkdirSync(this.#temporaryRoot, { recursive: true, mode: 0o700 });
    assertPrivateDirectory(this.#temporaryRoot);
  }

  async readSelectedArchive(sourcePath: string): Promise<SkillZipBundle> {
    const snapshotPath = path.join(this.#temporaryRoot, `.archive.${randomUUID()}.zip`);
    try {
      snapshotSelectedArchive(sourcePath, snapshotPath);
      return await readArchiveSnapshot(snapshotPath);
    } finally {
      fs.rmSync(snapshotPath, { force: true });
    }
  }
}

export function singleManifestBundle(bytes: Buffer): SkillZipBundle {
  const sha256 = digest(bytes);
  const files = [{ relativePath: "SKILL.md", bytes, sha256 }] as const;
  return { files, manifestBytes: bytes, manifestSha256: sha256, bundleSha256: sha256 };
}

export function skillBundleSha256(files: readonly SkillBundleFile[]): `sha256:${string}` {
  const normalized = normalizeBundleFiles(files);
  if (normalized.length === 1 && normalized[0]!.relativePath === "SKILL.md") return normalized[0]!.sha256;
  const hash = createHash("sha256").update("pige.skill.bundle.v1\0", "utf8");
  for (const file of normalized) {
    hash.update(file.relativePath.normalize("NFC"), "utf8").update("\0", "utf8")
      .update(String(file.bytes.length), "utf8").update("\0", "utf8")
      .update(file.sha256, "utf8").update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function normalizeBundleFiles(files: readonly SkillBundleFile[]): readonly SkillBundleFile[] {
  if (files.length < 1 || files.length > SKILL_ZIP_STAGE_MAX_FILES) throw zipError("archive_invalid");
  const canonicalPaths = new Set<string>();
  let totalBytes = 0;
  let manifestCount = 0;
  const normalized = files.map((file) => {
    const relativePath = SkillStagedRelativePathSchema.parse(file.relativePath);
    const canonicalPath = relativePath.normalize("NFC").toLocaleLowerCase("en-US");
    if (canonicalPaths.has(canonicalPath)) throw zipError("archive_unsafe");
    canonicalPaths.add(canonicalPath);
    if (!Buffer.isBuffer(file.bytes) || file.bytes.length < 1 || file.bytes.length > SKILL_ZIP_STAGE_MAX_FILE_BYTES ||
      digest(file.bytes) !== file.sha256) throw zipError("archive_invalid");
    totalBytes += file.bytes.length;
    if (totalBytes > SKILL_ZIP_STAGE_MAX_EXPANDED_BYTES) throw zipError("archive_too_large");
    if (relativePath === "SKILL.md") manifestCount += 1;
    return { relativePath, bytes: file.bytes, sha256: file.sha256 };
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  if (manifestCount !== 1) throw zipError("skill_root_invalid");
  return normalized;
}

async function readArchiveSnapshot(snapshotPath: string): Promise<SkillZipBundle> {
  let archive: Awaited<ReturnType<typeof openPromise>>;
  try {
    archive = await openPromise(snapshotPath, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true
    });
  } catch {
    throw zipError("archive_invalid");
  }
  try {
    if (archive.entryCount < 1 || archive.entryCount > SKILL_ZIP_STAGE_MAX_FILES * 2) throw zipError("archive_too_large");
    const entries: { readonly name: string; readonly entry: Entry }[] = [];
    const archiveNames: string[] = [];
    const archivePaths = new Set<string>();
    for await (const entry of archive.eachEntry()) {
      const name = validateEntry(entry);
      const canonicalPath = name.normalize("NFC").toLocaleLowerCase("en-US");
      if (archivePaths.has(canonicalPath)) throw zipError("archive_unsafe");
      archivePaths.add(canonicalPath);
      archiveNames.push(name);
      if (!name.endsWith("/")) entries.push({ name, entry });
    }
    if (entries.length < 1 || entries.length > SKILL_ZIP_STAGE_MAX_FILES) throw zipError("archive_too_large");
    const manifestEntries = entries.filter(({ name }) => path.posix.basename(name) === "SKILL.md");
    if (manifestEntries.length !== 1) throw zipError("skill_root_invalid");
    const root = path.posix.dirname(manifestEntries[0]!.name);
    const rootPrefix = root === "." ? "" : `${root}/`;
    if (rootPrefix && archiveNames.some((name) => name !== rootPrefix && !name.startsWith(rootPrefix))) {
      throw zipError("skill_root_invalid");
    }
    const files: SkillBundleFile[] = [];
    let expandedBytes = 0;
    for (const { name, entry } of entries) {
      if (rootPrefix && !name.startsWith(rootPrefix)) throw zipError("skill_root_invalid");
      const relativePath = rootPrefix ? name.slice(rootPrefix.length) : name;
      if (!relativePath || relativePath.includes("/../") || !SkillStagedRelativePathSchema.safeParse(relativePath).success) {
        throw zipError("unsupported_content");
      }
      expandedBytes += entry.uncompressedSize;
      if (expandedBytes > SKILL_ZIP_STAGE_MAX_EXPANDED_BYTES) throw zipError("archive_too_large");
      const bytes = await readEntry(archive, entry);
      const source = decodeUtf8(bytes);
      if (containsRestrictedModelContent(source)) throw zipError("unsupported_content");
      if (relativePath.toLocaleLowerCase("en-US").endsWith(".json")) {
        try { JSON.parse(source); } catch { throw zipError("unsupported_content"); }
      }
      files.push({ relativePath, bytes, sha256: digest(bytes) });
    }
    const normalized = normalizeBundleFiles(files);
    const manifest = normalized.find((file) => file.relativePath === "SKILL.md");
    if (!manifest) throw zipError("skill_root_invalid");
    return {
      files: normalized,
      manifestBytes: manifest.bytes,
      manifestSha256: manifest.sha256,
      bundleSha256: skillBundleSha256(normalized)
    };
  } finally {
    archive.close();
  }
}

function validateEntry(entry: Entry): string {
  const name = entry.fileName;
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0o170000;
  const directory = name.endsWith("/");
  const allowedType = fileType === 0 || fileType === (directory ? 0o040000 : 0o100000);
  const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
  if (validateFileName(name) || name.includes("\\") || name.includes("\0") || name.startsWith("/") ||
    /^[A-Za-z]:/u.test(name) || entry.isEncrypted() || !entry.canDecodeFileData() || !allowedType ||
    !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
    !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0 ||
    entry.uncompressedSize > SKILL_ZIP_STAGE_MAX_FILE_BYTES || ratio > SKILL_ZIP_STAGE_MAX_COMPRESSION_RATIO) {
    throw zipError("archive_unsafe");
  }
  return name;
}

async function readEntry(archive: Awaited<ReturnType<typeof openPromise>>, entry: Entry): Promise<Buffer> {
  const stream = await archive.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += bytes.length;
    if (total > SKILL_ZIP_STAGE_MAX_FILE_BYTES || total > entry.uncompressedSize) throw zipError("archive_too_large");
    chunks.push(bytes);
  }
  if (total !== entry.uncompressedSize || total < 1) throw zipError("archive_invalid");
  return Buffer.concat(chunks);
}

function snapshotSelectedArchive(sourcePath: string, destinationPath: string): void {
  if (!path.isAbsolute(sourcePath) || path.extname(sourcePath).toLocaleLowerCase("en-US") !== ".zip") {
    throw zipError("archive_unsafe");
  }
  const resolvedSource = path.resolve(sourcePath);
  const parent = path.dirname(resolvedSource);
  const parentStats = fs.lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || fs.realpathSync.native(parent) !== parent ||
    fs.realpathSync.native(resolvedSource) !== resolvedSource) throw zipError("archive_unsafe");
  let sourceDescriptor: number | undefined;
  let destinationDescriptor: number | undefined;
  try {
    sourceDescriptor = fs.openSync(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(sourceDescriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw zipError("archive_unsafe");
    if (before.size < 1 || before.size > SKILL_ZIP_STAGE_MAX_ARCHIVE_BYTES) throw zipError("archive_too_large");
    const bytes = fs.readFileSync(sourceDescriptor);
    const after = fs.fstatSync(sourceDescriptor);
    if (!sameIdentity(before, after) || bytes.length !== before.size) throw zipError("archive_unsafe");
    destinationDescriptor = fs.openSync(
      destinationPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(destinationDescriptor, bytes);
    fs.fsyncSync(destinationDescriptor);
  } finally {
    if (sourceDescriptor !== undefined) fs.closeSync(sourceDescriptor);
    if (destinationDescriptor !== undefined) fs.closeSync(destinationDescriptor);
  }
}

function assertPrivateDirectory(directory: string): void {
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync.native(directory) !== directory) {
    throw zipError("archive_unsafe");
  }
}

function decodeUtf8(bytes: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw zipError("unsupported_content"); }
}

function digest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function zipError(reason: SkillZipStageInvalidReason): SkillZipStageError {
  return new SkillZipStageError(reason);
}
