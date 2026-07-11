import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { RetrievalSearchResultItem } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import { PageIdSchema, SourceRecordSchema } from "@pige/schemas";
import { readMarkdownPageByRelativePath } from "./markdown-page-index";
import { createQueryTerms, createSnippet, sanitizeSearchBody } from "./search-text-utils";

export interface RetrievalEvidencePrivacySourceFact {
  readonly sourceId: string;
  readonly revisionHash: string;
  readonly updatedAt: string;
  readonly private: boolean;
  readonly sensitive: boolean;
}

export interface RetrievalEvidencePrivacySnapshot {
  readonly privateContent: boolean;
  readonly sensitiveContent: boolean;
  readonly pages: readonly {
    readonly pageId: string;
    readonly updatedAt: string;
    readonly sourceIds: readonly string[];
    readonly contentHash: string;
  }[];
  readonly sources: readonly RetrievalEvidencePrivacySourceFact[];
}

export interface CurrentRetrievalEvidenceBinding {
  readonly items: readonly RetrievalSearchResultItem[];
  readonly snapshot: RetrievalEvidencePrivacySnapshot;
}

export interface RetrievalEvidenceAuditSnapshot {
  readonly available: boolean;
  readonly snapshot: RetrievalEvidencePrivacySnapshot;
}

interface CurrentRetrievalPageBinding {
  readonly item: RetrievalSearchResultItem;
  readonly page: RetrievalEvidencePrivacySnapshot["pages"][number];
}

const MAX_RETRIEVAL_SOURCE_REFS = 64;
const MAX_RETRIEVAL_MARKDOWN_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_RECORD_BYTES = 1024 * 1024;

export function readRetrievalEvidencePrivacySnapshot(
  vaultPath: string,
  selectedItems: readonly RetrievalSearchResultItem[]
): RetrievalEvidencePrivacySnapshot {
  return createPrivacySnapshot(
    vaultPath,
    selectedItems.map((item) => readCurrentRetrievalPageBinding(vaultPath, item)).map(({ page }) => page)
  );
}

export function bindRetrievalEvidenceToCurrentMarkdown(
  vaultPath: string,
  selectedItems: readonly RetrievalSearchResultItem[],
  query: string
): CurrentRetrievalEvidenceBinding {
  const queryTerms = createQueryTerms(query);
  const bindings = selectedItems.map((item) =>
    readCurrentRetrievalPageBinding(vaultPath, item, queryTerms)
  );
  return {
    items: bindings.map(({ item }) => item),
    snapshot: createPrivacySnapshot(vaultPath, bindings.map(({ page }) => page))
  };
}

export function readRetrievalEvidenceAuditSnapshot(
  vaultPath: string,
  selectedItems: readonly RetrievalSearchResultItem[]
): RetrievalEvidenceAuditSnapshot {
  try {
    return {
      available: true,
      snapshot: readRetrievalEvidencePrivacySnapshot(vaultPath, selectedItems)
    };
  } catch {
    return {
      available: false,
      snapshot: {
        privateContent: false,
        sensitiveContent: false,
        pages: selectedItems.map((item) => ({
          pageId: PageIdSchema.safeParse(item.summary.pageId).success
            ? item.summary.pageId
            : "page_19700101_unavailable",
          updatedAt: item.summary.updatedAt,
          sourceIds: [],
          contentHash: "unavailable"
        })),
        sources: []
      }
    };
  }
}

function createPrivacySnapshot(
  vaultPath: string,
  pages: RetrievalEvidencePrivacySnapshot["pages"]
): RetrievalEvidencePrivacySnapshot {
  const sourceIds = Array.from(new Set(pages.flatMap((page) => page.sourceIds))).sort();
  if (sourceIds.length > MAX_RETRIEVAL_SOURCE_REFS) {
    throw evidencePrivacyUnavailableError();
  }
  const sources = sourceIds.map((sourceId) => readCurrentSourcePrivacyFact(vaultPath, sourceId));
  return {
    privateContent: sources.some((source) => source.private),
    sensitiveContent: sources.some((source) => source.sensitive),
    pages,
    sources
  };
}

export function createRetrievalEvidencePrivacyHash(snapshot: RetrievalEvidencePrivacySnapshot): string {
  return hashValue(JSON.stringify({
    pages: snapshot.pages,
    sources: snapshot.sources
  }));
}

function readCurrentRetrievalPageBinding(
  vaultPath: string,
  indexedItem: RetrievalSearchResultItem,
  queryTerms?: ReturnType<typeof createQueryTerms>
): CurrentRetrievalPageBinding {
  if (!PageIdSchema.safeParse(indexedItem.summary.pageId).success) {
    throw evidencePrivacyUnavailableError();
  }
  const currentPage = readMarkdownPageByRelativePath(vaultPath, indexedItem.summary.pagePath);
  if (!currentPage) throw evidencePrivacyUnavailableError();
  const boundedPage = readBoundedMarkdownPage(currentPage.absolutePath);
  const parsed = parsePigeFrontmatter(boundedPage.markdown);
  if (!parsed) throw evidencePrivacyUnavailableError();
  const sourceIds = [...new Set(
    (parsed.frontmatter.source_ids ?? [])
      .filter((sourceId) => /^src_\d{8}_[a-z0-9]{8,}$/u.test(sourceId))
  )].sort();
  const expectedSourceIds = [...new Set(indexedItem.summary.sourceIds)].sort();
  const title = normalizeTitle(parsed.frontmatter.title ?? "");
  if (
    !title ||
    parsed.frontmatter.id !== currentPage.summary.pageId ||
    parsed.frontmatter.type !== currentPage.summary.pageType ||
    parsed.frontmatter.status !== currentPage.summary.status ||
    parsed.frontmatter.updated_at !== currentPage.summary.updatedAt ||
    currentPage.summary.title !== title ||
    currentPage.summary.pageId !== indexedItem.summary.pageId ||
    currentPage.summary.pagePath !== indexedItem.summary.pagePath ||
    currentPage.summary.pageType !== indexedItem.summary.pageType ||
    currentPage.summary.status !== indexedItem.summary.status ||
    currentPage.summary.updatedAt !== indexedItem.summary.updatedAt ||
    JSON.stringify(sourceIds) !== JSON.stringify(expectedSourceIds)
  ) {
    throw evidencePrivacyUnavailableError();
  }
  const body = boundedPage.markdown.slice(parsed.bodyStartOffset).trimStart();
  return {
    item: {
      ...indexedItem,
      summary: { ...currentPage.summary, title },
      ...(queryTerms
        ? { snippets: [createSnippet(sanitizeSearchBody(body), queryTerms)] }
        : {})
    },
    page: {
      pageId: currentPage.summary.pageId,
      updatedAt: currentPage.summary.updatedAt,
      sourceIds,
      contentHash: boundedPage.contentHash
    }
  };
}

function readBoundedMarkdownPage(filePath: string): {
  readonly markdown: string;
  readonly contentHash: string;
} {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, "r");
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size > MAX_RETRIEVAL_MARKDOWN_PAGE_BYTES) {
      throw evidencePrivacyUnavailableError();
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const bytesRead = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (bytesRead <= 0) throw evidencePrivacyUnavailableError();
      offset += bytesRead;
    }
    const after = fs.fstatSync(descriptor);
    const currentPath = fs.lstatSync(filePath);
    if (
      currentPath.isSymbolicLink() ||
      !currentPath.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      currentPath.dev !== after.dev ||
      currentPath.ino !== after.ino ||
      currentPath.size !== after.size ||
      currentPath.mtimeMs !== after.mtimeMs ||
      currentPath.ctimeMs !== after.ctimeMs
    ) {
      throw evidencePrivacyUnavailableError();
    }
    return {
      markdown: bytes.toString("utf8"),
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw evidencePrivacyUnavailableError();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function readCurrentSourcePrivacyFact(
  vaultPath: string,
  sourceId: string
): RetrievalEvidencePrivacySourceFact {
  const match = /^src_(\d{8})_[a-z0-9]{8,}$/u.exec(sourceId);
  if (!match) throw evidencePrivacyUnavailableError();
  const dateKey = match[1];
  if (!dateKey) throw evidencePrivacyUnavailableError();
  const pigeRoot = path.resolve(vaultPath, ".pige");
  const sourceRoot = path.resolve(pigeRoot, "source-records");
  const yearRoot = path.resolve(sourceRoot, dateKey.slice(0, 4));
  const monthRoot = path.resolve(yearRoot, dateKey.slice(4, 6));
  const sourcePath = path.resolve(
    monthRoot,
    `${sourceId}.json`
  );
  if (!sourcePath.startsWith(`${sourceRoot}${path.sep}`)) throw evidencePrivacyUnavailableError();
  try {
    for (const directoryPath of [pigeRoot, sourceRoot, yearRoot, monthRoot]) {
      const directory = fs.lstatSync(directoryPath);
      if (directory.isSymbolicLink() || !directory.isDirectory()) {
        throw evidencePrivacyUnavailableError();
      }
    }
    const stat = fs.lstatSync(sourcePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_SOURCE_RECORD_BYTES) {
      throw evidencePrivacyUnavailableError();
    }
    const realVaultRoot = fs.realpathSync(path.resolve(vaultPath));
    const realPigeRoot = fs.realpathSync(pigeRoot);
    const realRoot = fs.realpathSync(sourceRoot);
    const realPath = fs.realpathSync(sourcePath);
    if (!realPigeRoot.startsWith(`${realVaultRoot}${path.sep}`)) throw evidencePrivacyUnavailableError();
    if (!realRoot.startsWith(`${realPigeRoot}${path.sep}`)) throw evidencePrivacyUnavailableError();
    if (!realPath.startsWith(`${realRoot}${path.sep}`)) throw evidencePrivacyUnavailableError();
    const record = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(realPath, "utf8")));
    if (record.id !== sourceId) throw evidencePrivacyUnavailableError();
    return {
      sourceId,
      revisionHash: hashValue(JSON.stringify(record)),
      updatedAt: record.updatedAt,
      private: record.metadata.private === true || record.metadata.privacy === "private",
      sensitive: record.metadata.sensitive === true
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw evidencePrivacyUnavailableError();
  }
}

function evidencePrivacyUnavailableError(): PigeDomainError {
  return new PigeDomainError(
    "rag.evidence_privacy_unavailable",
    "Current evidence privacy metadata could not be verified."
  );
}

function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
