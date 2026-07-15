import fs from "node:fs";
import path from "node:path";
import type { LibraryPageSummary } from "@pige/contracts";
import {
  createPigeTagKey,
  normalizePigeTag,
  normalizePigeTags,
  parsePigeFrontmatter,
  type PigeFrontmatter
} from "@pige/markdown";
import {
  MarkdownPageStatusSchema,
  MarkdownPageTypeSchema,
  type MarkdownPageType
} from "@pige/schemas";

export interface MarkdownPageRecord {
  readonly summary: LibraryPageSummary;
  readonly absolutePath: string;
  readonly knowledge: MarkdownPageKnowledgeFields;
}

export interface MarkdownPageKnowledgeFields {
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly topics: readonly string[];
}

export interface MarkdownPageScanResult {
  readonly pages: readonly MarkdownPageRecord[];
  readonly invalidPageCount: number;
  readonly files: readonly MarkdownFileSignatureRecord[];
}

export interface MarkdownFileSignatureRecord {
  readonly absolutePath: string;
  readonly pagePath: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly deviceId: string;
  readonly fileId: string;
}

export const MARKDOWN_FRONTMATTER_READ_LIMIT_BYTES = 64 * 1024;
const PAGE_ROOTS = ["sources", "wiki"] as const;

export function scanMarkdownPages(vaultPath: string): MarkdownPageScanResult {
  const pages: MarkdownPageRecord[] = [];
  let invalidPageCount = 0;
  const files = scanMarkdownFileSignatures(vaultPath);

  for (const file of files) {
    assertMarkdownPagePathConfined(vaultPath, file.absolutePath);
    const record = readMarkdownPageRecord(vaultPath, file.absolutePath, file);
    if (record) {
      pages.push(record);
    } else {
      invalidPageCount += 1;
    }
  }

  return { pages, invalidPageCount, files };
}

export function scanMarkdownFileSignatures(vaultPath: string): readonly MarkdownFileSignatureRecord[] {
  const files: MarkdownFileSignatureRecord[] = [];
  const canonicalVault = fs.realpathSync.native(path.resolve(vaultPath));
  for (const root of PAGE_ROOTS) {
    const rootPath = resolveVaultRelativePath(vaultPath, root);
    if (!fs.existsSync(rootPath)) continue;
    const canonicalRoot = assertRealConfinedDirectory(rootPath, canonicalVault);
    for (const absolutePath of listMarkdownFiles(rootPath, canonicalRoot)) {
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      files.push({
        absolutePath,
        pagePath: toVaultRelativePath(vaultPath, absolutePath),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        deviceId: String(stat.dev),
        fileId: String(stat.ino)
      });
    }
  }
  return files.sort((left, right) => left.pagePath.localeCompare(right.pagePath, "en-US"));
}

export function assertMarkdownPagePathConfined(vaultPath: string, filePath: string): void {
  const pagePath = toVaultRelativePath(vaultPath, filePath);
  const rootName = pagePath.split("/", 1)[0];
  if (!rootName || !PAGE_ROOTS.includes(rootName as (typeof PAGE_ROOTS)[number])) {
    throw new Error("Markdown file is outside a governed page root.");
  }
  const canonicalVault = fs.realpathSync.native(path.resolve(vaultPath));
  const rootPath = resolveVaultRelativePath(vaultPath, rootName);
  const canonicalRoot = assertRealConfinedDirectory(rootPath, canonicalVault);
  assertRealParentChain(rootPath, path.dirname(filePath), canonicalRoot);
}

export function findMarkdownPageById(vaultPath: string, pageId: string): MarkdownPageRecord | undefined {
  if (!/^page_\d{8}_[a-z0-9]{8,}$/u.test(pageId)) return undefined;
  for (const file of scanMarkdownFileSignatures(vaultPath)) {
    assertMarkdownPagePathConfined(vaultPath, file.absolutePath);
    const record = readMarkdownPageRecord(vaultPath, file.absolutePath, file);
    if (record?.summary.pageId === pageId) return record;
  }
  return undefined;
}

export function listMarkdownTagCatalog(vaultPath: string): readonly string[] {
  const tags = new Map<string, string>();
  for (const page of scanMarkdownPages(vaultPath).pages) {
    for (const tag of page.knowledge.tags) {
      const key = createPigeTagKey(tag);
      if (key && !tags.has(key)) tags.set(key, tag);
    }
  }
  return Array.from(tags.entries())
    .sort(([left], [right]) => left.localeCompare(right, "en-US"))
    .map(([, tag]) => tag);
}

export function readMarkdownPageByRelativePath(
  vaultPath: string,
  pagePath: string
): MarkdownPageRecord | undefined {
  if (
    path.isAbsolute(pagePath) ||
    pagePath.includes("\\") ||
    pagePath.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !PAGE_ROOTS.some((root) => pagePath.startsWith(`${root}/`)) ||
    !pagePath.toLowerCase().endsWith(".md")
  ) {
    return undefined;
  }
  const filePath = resolveVaultRelativePath(vaultPath, pagePath);
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
    const pageRoot = path.resolve(vaultPath, pagePath.split("/", 1)[0] ?? "");
    let parentPath = path.dirname(filePath);
    while (true) {
      const parentStat = fs.lstatSync(parentPath);
      if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) return undefined;
      if (parentPath === pageRoot) break;
      const nextParent = path.dirname(parentPath);
      if (nextParent === parentPath) return undefined;
      parentPath = nextParent;
    }
    const realRoot = fs.realpathSync(pageRoot);
    const realFile = fs.realpathSync(filePath);
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) return undefined;
    return readMarkdownPageRecord(vaultPath, filePath);
  } catch {
    return undefined;
  }
}

export function readMarkdownPageBody(filePath: string | number, maxBytes?: number): string {
  const markdown = maxBytes === undefined
    ? fs.readFileSync(filePath, "utf8")
    : readBoundedUtf8(filePath, maxBytes);
  const parsed = parsePigeFrontmatter(markdown);
  return parsed ? markdown.slice(parsed.bodyStartOffset).trimStart() : markdown;
}

export function readMarkdownPageBodyAtSignature(
  vaultPath: string,
  expected: MarkdownFileSignatureRecord,
  maxBytes: number
): string {
  let descriptor: number | undefined;
  try {
    assertMarkdownPagePathConfined(vaultPath, expected.absolutePath);
    descriptor = fs.openSync(
      expected.absolutePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const before = fs.fstatSync(descriptor);
    if (before.isSymbolicLink() || !before.isFile() || !matchesSignature(before, expected)) {
      throw new Error("Markdown file changed before its body was read.");
    }
    const body = readMarkdownPageBody(descriptor, maxBytes);
    const after = fs.fstatSync(descriptor);
    const named = fs.lstatSync(expected.absolutePath);
    assertMarkdownPagePathConfined(vaultPath, expected.absolutePath);
    if (
      !sameFileIdentity(before, after) ||
      named.isSymbolicLink() ||
      !named.isFile() ||
      !sameFileIdentity(before, named) ||
      !matchesSignature(after, expected)
    ) {
      throw new Error("Markdown file changed while its body was read.");
    }
    return body;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readMarkdownPageRecord(
  vaultPath: string,
  filePath: string,
  expected?: MarkdownFileSignatureRecord
): MarkdownPageRecord | undefined {
  const parsed = parsePigeFrontmatter(readFilePrefix(filePath, expected));
  if (!parsed) return undefined;
  const hasTagsField = parsed.raw.split(/\r?\n/u).some((line) => line.startsWith("tags:"));
  const rawTags = parsed.frontmatter.tags;
  if (
    (hasTagsField && !Array.isArray(rawTags)) ||
    (rawTags && (rawTags.length > 12 || rawTags.some((tag) => normalizePigeTag(tag) === undefined)))
  ) {
    return undefined;
  }
  const summary = frontmatterToSummary(vaultPath, filePath, parsed.frontmatter);
  return summary ? {
    summary,
    absolutePath: filePath,
    knowledge: {
      aliases: sanitizeKnowledgeRefs(parsed.frontmatter.aliases),
      tags: normalizePigeTags(rawTags ?? [], rawTags?.length ?? 12),
      topics: sanitizeKnowledgeRefs(parsed.frontmatter.topics)
    }
  } : undefined;
}

function frontmatterToSummary(
  vaultPath: string,
  filePath: string,
  frontmatter: PigeFrontmatter
): LibraryPageSummary | undefined {
  if (frontmatter.schema_version !== 1) return undefined;
  if (!frontmatter.id || !frontmatter.title || !frontmatter.created_at || !frontmatter.updated_at) return undefined;
  if (!isIsoDateTime(frontmatter.created_at) || !isIsoDateTime(frontmatter.updated_at)) return undefined;

  const pageType = MarkdownPageTypeSchema.safeParse(frontmatter.type);
  const status = MarkdownPageStatusSchema.safeParse(frontmatter.status);
  if (!pageType.success || !status.success) return undefined;

  const title = normalizeTitle(frontmatter.title);
  if (!title) return undefined;

  return {
    pageId: frontmatter.id,
    title,
    pageType: pageType.data,
    status: status.data,
    pagePath: toVaultRelativePath(vaultPath, filePath),
    createdAt: frontmatter.created_at,
    updatedAt: frontmatter.updated_at,
    ...(frontmatter.language ? { language: frontmatter.language } : {}),
    sourceIds: sanitizeSourceIds(frontmatter.source_ids ?? [])
  };
}

function listMarkdownFiles(root: string, canonicalRoot: string): string[] {
  const before = fs.lstatSync(root);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error("Markdown root descendants must remain real directories.");
  }
  const canonicalDirectory = fs.realpathSync.native(root);
  if (!isWithinRoot(canonicalRoot, canonicalDirectory, true)) {
    throw new Error("Markdown directory escaped its canonical vault root.");
  }
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath, canonicalRoot));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }
  const after = fs.lstatSync(root);
  if (
    after.isSymbolicLink() ||
    !after.isDirectory() ||
    !sameFileIdentity(before, after) ||
    fs.realpathSync.native(root) !== canonicalDirectory
  ) {
    throw new Error("Markdown directory changed while it was scanned.");
  }
  return files;
}

function readFilePrefix(filePath: string, expected?: MarkdownFileSignatureRecord): string {
  const file = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  );
  try {
    const before = fs.fstatSync(file);
    if (before.isSymbolicLink() || !before.isFile() || (expected && !matchesSignature(before, expected))) {
      throw new Error("Markdown file changed before its frontmatter was read.");
    }
    const bytesToRead = Math.min(before.size, MARKDOWN_FRONTMATTER_READ_LIMIT_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(file, buffer, 0, bytesToRead, 0);
    const after = fs.fstatSync(file);
    const named = fs.lstatSync(filePath);
    if (
      !sameFileIdentity(before, after) ||
      named.isSymbolicLink() ||
      !named.isFile() ||
      !sameFileIdentity(before, named) ||
      (expected && !matchesSignature(after, expected))
    ) {
      throw new Error("Markdown file changed while its frontmatter was read.");
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(file);
  }
}

function readBoundedUtf8(filePath: string | number, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Markdown read bound must be a positive safe integer.");
  }
  const descriptor = typeof filePath === "number"
    ? filePath
    : fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Markdown body must remain a regular file.");
    }
    const bytesToRead = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(descriptor, buffer, 0, bytesToRead, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    if (typeof filePath !== "number") fs.closeSync(descriptor);
  }
}

function assertRealConfinedDirectory(directoryPath: string, canonicalParent: string): string {
  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Markdown roots must be real directories.");
  }
  const canonical = fs.realpathSync.native(directoryPath);
  if (!isWithinRoot(canonicalParent, canonical)) {
    throw new Error("Markdown root escaped the active vault.");
  }
  return canonical;
}

function assertRealParentChain(rootPath: string, parentPath: string, canonicalRoot: string): void {
  let current = parentPath;
  while (true) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Markdown parent paths must remain real directories.");
    }
    const canonical = fs.realpathSync.native(current);
    if (!isWithinRoot(canonicalRoot, canonical, true)) {
      throw new Error("Markdown parent escaped its canonical vault root.");
    }
    if (path.resolve(current) === path.resolve(rootPath)) return;
    const next = path.dirname(current);
    if (next === current) throw new Error("Markdown parent chain did not reach its vault root.");
    current = next;
  }
}

function isWithinRoot(root: string, candidate: string, allowRoot = false): boolean {
  const relative = path.relative(root, candidate);
  return (allowRoot && relative === "") || (relative !== "" && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function matchesSignature(stat: fs.Stats, expected: MarkdownFileSignatureRecord): boolean {
  return (
    stat.size === expected.sizeBytes &&
    stat.mtimeMs === expected.mtimeMs &&
    stat.ctimeMs === expected.ctimeMs &&
    String(stat.dev) === expected.deviceId &&
    String(stat.ino) === expected.fileId
  );
}

function sanitizeSourceIds(sourceIds: readonly string[]): readonly string[] {
  return sourceIds.filter((sourceId) => /^src_\d{8}_[a-z0-9]{8,}$/u.test(sourceId));
}

function sanitizeKnowledgeRefs(values: readonly string[] | undefined): readonly string[] {
  const normalized = (values ?? [])
    .map(normalizeTitle)
    .filter((value) => value.length > 0 && value.length <= 256);
  return Array.from(new Set(normalized)).slice(0, 64);
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/gu, " ").trim();
}

function isIsoDateTime(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function resolveVaultRelativePath(vaultPath: string, relativePath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(vaultPath, ...relativePath.split("/"));
  const allowedPrefix = `${resolvedVault}${path.sep}`;
  if (resolvedPath !== resolvedVault && !resolvedPath.startsWith(allowedPrefix)) {
    throw new Error("Path escapes the active vault.");
  }
  return resolvedPath;
}

function toVaultRelativePath(vaultPath: string, filePath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedFile = path.resolve(filePath);
  const allowedPrefix = `${resolvedVault}${path.sep}`;
  if (!resolvedFile.startsWith(allowedPrefix)) {
    throw new Error("Path escapes the active vault.");
  }
  return path.relative(resolvedVault, resolvedFile).split(path.sep).join("/");
}

export function compareMarkdownPageRecords(left: LibraryPageSummary, right: LibraryPageSummary): number {
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  return updated === 0 ? left.pagePath.localeCompare(right.pagePath) : updated;
}
