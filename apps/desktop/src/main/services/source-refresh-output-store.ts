import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { OperationRecordSchema, type SourceRecord } from "@pige/schemas";

export interface SourceRefreshReceiptFile {
  readonly path: string;
  readonly beforeBackup?: string;
  readonly beforeChecksum?: string;
  readonly afterBackup?: string;
  readonly afterChecksum?: string;
}

export function snapshotSourceRefreshBeforeFiles(
  vaultPath: string,
  receiptRoot: string,
  record: SourceRecord
): readonly SourceRefreshReceiptFile[] {
  return refreshOutputPaths(vaultPath, record).map((relativePath) => {
    const absolute = resolveSourceRefreshVaultFile(vaultPath, relativePath);
    if (!fs.existsSync(absolute)) return { path: relativePath };
    const checksum = hashSourceRefreshFile(absolute);
    const backup = backupPath(receiptRoot, "before", relativePath);
    fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
    fs.copyFileSync(absolute, backup, fs.constants.COPYFILE_EXCL);
    return { path: relativePath, beforeBackup: toSourceRefreshVaultRelative(vaultPath, backup), beforeChecksum: checksum };
  });
}

export function snapshotSourceRefreshAfterFiles(
  vaultPath: string,
  receiptRoot: string,
  files: readonly SourceRefreshReceiptFile[],
  published: SourceRecord
): readonly SourceRefreshReceiptFile[] {
  return includeCurrentRefreshOutputs(vaultPath, files, published).map((file) => {
    const absolute = resolveSourceRefreshVaultFile(vaultPath, file.path);
    if (!fs.existsSync(absolute)) return file;
    const checksum = hashSourceRefreshFile(absolute);
    const backup = backupPath(receiptRoot, "after", file.path);
    fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
    fs.copyFileSync(absolute, backup, fs.constants.COPYFILE_EXCL);
    return { ...file, afterBackup: toSourceRefreshVaultRelative(vaultPath, backup), afterChecksum: checksum };
  });
}

export function includeCurrentRefreshOutputs(
  vaultPath: string,
  files: readonly SourceRefreshReceiptFile[],
  record: SourceRecord
): readonly SourceRefreshReceiptFile[] {
  const existing = new Set(files.map((file) => file.path));
  return [
    ...files,
    ...refreshOutputPaths(vaultPath, record)
      .filter((relativePath) => !existing.has(relativePath))
      .map((relativePath): SourceRefreshReceiptFile => ({ path: relativePath }))
  ];
}

export function restoreSourceRefreshBeforeFiles(
  vaultPath: string,
  files: readonly SourceRefreshReceiptFile[],
  beforeRecord: SourceRecord,
  current: SourceRecord
): void {
  for (const file of files) {
    const target = resolveSourceRefreshVaultFile(vaultPath, file.path);
    const isPage = current.knowledgePagePath === file.path || beforeRecord.knowledgePagePath === file.path;
    if (isPage && fs.existsSync(target)) {
      const currentHash = hashSourceRefreshFile(target);
      const ownedHash = typeof current.metadata.knowledgePageChecksum === "string" ? current.metadata.knowledgePageChecksum : undefined;
      if (currentHash !== file.beforeChecksum && currentHash !== file.afterChecksum && currentHash !== ownedHash) continue;
    }
    if (file.beforeBackup && file.beforeChecksum) {
      const backup = resolveSourceRefreshVaultFile(vaultPath, file.beforeBackup);
      if (hashSourceRefreshFile(backup) !== file.beforeChecksum) {
        throw new PigeDomainError("source.refresh_receipt_changed", "The rollback evidence changed.");
      }
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.restore`);
      fs.copyFileSync(backup, temporary, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temporary, target);
    } else if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
  }
}

export function removeSourceRefreshChildOperations(vaultPath: string, jobId: string, sourceId: string): void {
  const date = /^job_(\d{8})_/u.exec(jobId)?.[1];
  if (!date) throw new PigeDomainError("source.refresh_invalid", "The source refresh Job identity is invalid.");
  const root = path.join(vaultPath, ".pige", "operations", date.slice(0, 4), date.slice(4, 6));
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const target = path.join(root, entry.name);
    const operation = OperationRecordSchema.parse(JSON.parse(fs.readFileSync(target, "utf8")));
    if (operation.jobId !== jobId) continue;
    if (operation.kind !== "create_artifact" || !operation.sourceRefs.some((ref) => ref.kind === "source" && ref.id === sourceId)) {
      throw new PigeDomainError("source.refresh_invalid", "Source refresh created an unexpected child Operation.");
    }
    fs.rmSync(target, { force: true });
  }
}

export function hashSourceRefreshFile(filePath: string): string {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new PigeDomainError("source.refresh_file_unsafe", "A refresh-owned file is unsafe.");
  }
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    do {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read > 0) hash.update(buffer.subarray(0, read));
    } while (read > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
}

export function resolveSourceRefreshVaultFile(vaultPath: string, relativePath: string): string {
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new PigeDomainError("source.refresh_path_unsafe", "A refresh receipt path escaped the vault.");
  }
  return resolved;
}

export function toSourceRefreshVaultRelative(vaultPath: string, absolutePath: string): string {
  return path.relative(path.resolve(vaultPath), path.resolve(absolutePath)).split(path.sep).join("/");
}

function refreshOutputPaths(vaultPath: string, record: SourceRecord): readonly string[] {
  const paths = new Set(record.artifacts.map((artifact) => artifact.path));
  if (record.knowledgePagePath) paths.add(record.knowledgePagePath);
  const date = /^src_(\d{8})_/u.exec(record.id)?.[1];
  if (!date) return [...paths].sort();
  const year = date.slice(0, 4);
  const month = date.slice(4, 6);
  if (record.kind === "pdf_file" || record.kind === "docx_file" || record.kind === "pptx_file") {
    const format = record.kind.replace("_file", "");
    paths.add(`artifacts/extracted-text/${year}/${month}/${record.id}.txt`);
    paths.add(`artifacts/metadata/${year}/${month}/${record.id}.${format}.json`);
  }
  if (record.kind === "pdf_file") {
    paths.add(`artifacts/metadata/${year}/${month}/${record.id}.pdf-render.json`);
    paths.add(`artifacts/ocr/${year}/${month}/${record.id}.pdf.txt`);
    paths.add(`artifacts/metadata/${year}/${month}/${record.id}.pdf-ocr.json`);
    for (const relativePath of listPdfRenderedPagePaths(vaultPath, record.id, year, month)) paths.add(relativePath);
  }
  return [...paths].sort();
}

function listPdfRenderedPagePaths(vaultPath: string, sourceId: string, year: string, month: string): readonly string[] {
  const relativeRoot = `artifacts/rendered-pages/${year}/${month}/${sourceId}`;
  const absoluteRoot = resolveSourceRefreshVaultFile(vaultPath, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const root = fs.lstatSync(absoluteRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new PigeDomainError("source.refresh_path_unsafe", "A PDF refresh artifact directory is unsafe.");
  }
  const paths: string[] = [];
  const visit = (absoluteDirectory: string, relativeDirectory: string): void => {
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const absolute = path.join(absoluteDirectory, entry.name);
      const relative = `${relativeDirectory}/${entry.name}`;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new PigeDomainError("source.refresh_path_unsafe", "A PDF refresh artifact is a symbolic link.");
      }
      if (stat.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1) {
        throw new PigeDomainError("source.refresh_path_unsafe", "A PDF refresh artifact is not a regular file.");
      }
      paths.push(relative);
    }
  };
  visit(absoluteRoot, relativeRoot);
  return paths.sort();
}

function backupPath(receiptRoot: string, lane: "before" | "after", relativePath: string): string {
  const digest = createHash("sha256").update(relativePath).digest("hex");
  return path.join(receiptRoot, lane, `${digest}.bin`);
}
