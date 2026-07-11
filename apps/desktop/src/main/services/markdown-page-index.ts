import fs from "node:fs";
import path from "node:path";
import type { LibraryPageSummary } from "@pige/contracts";
import { parsePigeFrontmatter, type PigeFrontmatter } from "@pige/markdown";
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
  readonly topics: readonly string[];
}

export interface MarkdownPageScanResult {
  readonly pages: readonly MarkdownPageRecord[];
  readonly invalidPageCount: number;
}

const FRONTMATTER_READ_LIMIT_BYTES = 64 * 1024;
const PAGE_ROOTS = ["sources", "wiki"] as const;

export function scanMarkdownPages(vaultPath: string): MarkdownPageScanResult {
  const pages: MarkdownPageRecord[] = [];
  let invalidPageCount = 0;

  for (const root of PAGE_ROOTS) {
    const rootPath = resolveVaultRelativePath(vaultPath, root);
    if (!fs.existsSync(rootPath)) continue;

    for (const filePath of listMarkdownFiles(rootPath)) {
      const record = readMarkdownPageRecord(vaultPath, filePath);
      if (record) {
        pages.push(record);
      } else {
        invalidPageCount += 1;
      }
    }
  }

  return { pages, invalidPageCount };
}

export function findMarkdownPageById(vaultPath: string, pageId: string): MarkdownPageRecord | undefined {
  if (!/^page_\d{8}_[a-z0-9]{8,}$/u.test(pageId)) return undefined;
  for (const root of PAGE_ROOTS) {
    const rootPath = resolveVaultRelativePath(vaultPath, root);
    if (!fs.existsSync(rootPath)) continue;

    for (const filePath of listMarkdownFiles(rootPath)) {
      const record = readMarkdownPageRecord(vaultPath, filePath);
      if (record?.summary.pageId === pageId) return record;
    }
  }
  return undefined;
}

export function readMarkdownPageBody(filePath: string): string {
  const markdown = fs.readFileSync(filePath, "utf8");
  const parsed = parsePigeFrontmatter(markdown);
  return parsed ? markdown.slice(parsed.bodyStartOffset).trimStart() : markdown;
}

function readMarkdownPageRecord(vaultPath: string, filePath: string): MarkdownPageRecord | undefined {
  const parsed = parsePigeFrontmatter(readFilePrefix(filePath));
  if (!parsed) return undefined;
  const summary = frontmatterToSummary(vaultPath, filePath, parsed.frontmatter);
  return summary ? {
    summary,
    absolutePath: filePath,
    knowledge: {
      aliases: sanitizeKnowledgeRefs(parsed.frontmatter.aliases),
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

function listMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function readFilePrefix(filePath: string): string {
  const size = fs.statSync(filePath).size;
  const bytesToRead = Math.min(size, FRONTMATTER_READ_LIMIT_BYTES);
  const file = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(file, buffer, 0, bytesToRead, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(file);
  }
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
