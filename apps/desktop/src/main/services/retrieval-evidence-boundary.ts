import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import type {
  LibraryPageSummary,
  ReaderSelectionIdentity,
  RetrievalSearchResultItem
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import { PageIdSchema, SourceRecordSchema } from "@pige/schemas";
import {
  assertMarkdownPagePathConfined,
  readMarkdownPageByRelativePath,
  scanMarkdownPages,
  type MarkdownFileSignatureRecord
} from "./markdown-page-index";
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

export interface CurrentRetrievalPageMutationBinding {
  readonly item: RetrievalSearchResultItem;
  readonly page: RetrievalEvidencePrivacySnapshot["pages"][number];
  readonly markdown: string;
  readonly absolutePath: string;
}

export interface CurrentNoteEvidenceBinding {
  readonly page: Pick<
    LibraryPageSummary,
    "pageId" | "title" | "pageType" | "status" | "updatedAt" | "sourceIds"
  >;
  readonly modelText: string;
  readonly snapshot: RetrievalEvidencePrivacySnapshot;
  readonly contentHash: string;
  readonly bindingHash: string;
  readonly modelSuppliedRange: {
    readonly unit: "utf8_bytes";
    readonly start: 0;
    readonly endExclusive: number;
    readonly total: number;
    readonly truncated: boolean;
  };
  readonly durableBodyRange: {
    readonly locator: string;
    readonly start: number;
    readonly endExclusive: number;
  };
  readonly durableBodyText: string;
}

const MAX_RETRIEVAL_SOURCE_REFS = 64;
const MAX_RETRIEVAL_MARKDOWN_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_RECORD_BYTES = 1024 * 1024;
const MAX_CURRENT_NOTE_MODEL_BYTES = 8 * 1024;
const MAX_CURRENT_NOTE_TITLE_BYTES = 512;

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

export function readCurrentRetrievalPageForMutation(
  vaultPath: string,
  indexedItem: RetrievalSearchResultItem
): CurrentRetrievalPageMutationBinding {
  return readCurrentRetrievalPageBinding(vaultPath, indexedItem);
}

export function readCurrentNoteEvidenceBinding(
  vaultPath: string,
  pageId: string
): CurrentNoteEvidenceBinding {
  try {
    if (!PageIdSchema.safeParse(pageId).success) throw evidencePrivacyUnavailableError();
    const scan = scanMarkdownPages(vaultPath);
    const matches = scan.pages.filter((page) => page.summary.pageId === pageId);
    if (matches.length !== 1) throw evidencePrivacyUnavailableError();
    const page = matches[0];
    if (!page) throw evidencePrivacyUnavailableError();
    const signature = scan.files.find((file) => file.pagePath === page.summary.pagePath);
    if (!signature) throw evidencePrivacyUnavailableError();
    const binding = readCurrentRetrievalPageBinding(vaultPath, {
      summary: page.summary,
      score: 1,
      snippets: [],
      matchReasons: ["current_note"]
    }, undefined, signature);
    const parsed = parsePigeFrontmatter(binding.markdown);
    if (!parsed) throw evidencePrivacyUnavailableError();
    const durableBodyText = binding.markdown.slice(parsed.bodyStartOffset);
    const durableBodyStart = Buffer.byteLength(
      binding.markdown.slice(0, parsed.bodyStartOffset),
      "utf8"
    );
    const durableBodyEnd = durableBodyStart + Buffer.byteLength(durableBodyText, "utf8");
    const body = sanitizeSearchBody(durableBodyText.trimStart());
    const boundedBody = truncateUtf8(body, MAX_CURRENT_NOTE_MODEL_BYTES);
    const snapshot = createPrivacySnapshot(vaultPath, [binding.page]);
    return {
      page: {
        pageId: binding.item.summary.pageId,
        title: truncateUtf8(binding.item.summary.title, MAX_CURRENT_NOTE_TITLE_BYTES).value,
        pageType: binding.item.summary.pageType,
        status: binding.item.summary.status,
        updatedAt: binding.item.summary.updatedAt,
        sourceIds: binding.item.summary.sourceIds
      },
      modelText: boundedBody.value,
      snapshot,
      contentHash: binding.page.contentHash,
      bindingHash: createRetrievalEvidencePrivacyHash(snapshot),
      modelSuppliedRange: {
        unit: "utf8_bytes",
        start: 0,
        endExclusive: boundedBody.suppliedBytes,
        total: boundedBody.totalBytes,
        truncated: boundedBody.truncated
      },
      durableBodyRange: {
        locator: `utf8_bytes:${durableBodyStart}:${durableBodyEnd}`,
        start: durableBodyStart,
        endExclusive: durableBodyEnd
      },
      durableBodyText
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "rag.evidence_privacy_unavailable") {
      throw caught;
    }
    throw evidencePrivacyUnavailableError();
  }
}

export function readCurrentNotePageForMutation(
  vaultPath: string,
  pageId: string
): CurrentRetrievalPageMutationBinding {
  try {
    if (!PageIdSchema.safeParse(pageId).success) throw evidencePrivacyUnavailableError();
    const scan = scanMarkdownPages(vaultPath);
    const matches = scan.pages.filter((page) => page.summary.pageId === pageId);
    if (matches.length !== 1) throw evidencePrivacyUnavailableError();
    const page = matches[0];
    if (!page) throw evidencePrivacyUnavailableError();
    const signature = scan.files.find((file) => file.pagePath === page.summary.pagePath);
    if (!signature) throw evidencePrivacyUnavailableError();
    return readCurrentRetrievalPageBinding(vaultPath, {
      summary: page.summary,
      score: 1,
      snippets: [],
      matchReasons: ["current_note"]
    }, undefined, signature);
  } catch (caught) {
    if (caught instanceof PigeDomainError && caught.code === "rag.evidence_privacy_unavailable") {
      throw caught;
    }
    throw evidencePrivacyUnavailableError();
  }
}

export function readCurrentNoteSelectionEvidenceBinding(
  vaultPath: string,
  selection: ReaderSelectionIdentity
): CurrentNoteEvidenceBinding {
  const current = readCurrentNoteEvidenceBinding(vaultPath, selection.pageId);
  if (current.contentHash !== selection.pageContentHash) throw evidencePrivacyUnavailableError();
  const relativeStart = selection.span.start - current.durableBodyRange.start;
  const relativeEnd = selection.span.endExclusive - current.durableBodyRange.start;
  const bodyBytes = Buffer.from(current.durableBodyText, "utf8");
  if (
    selection.span.unit !== "utf8_bytes" ||
    relativeStart < 0 ||
    relativeEnd <= relativeStart ||
    relativeEnd > bodyBytes.length ||
    relativeEnd - relativeStart > MAX_CURRENT_NOTE_MODEL_BYTES ||
    !isUtf8Boundary(bodyBytes, relativeStart) ||
    !isUtf8Boundary(bodyBytes, relativeEnd)
  ) {
    throw evidencePrivacyUnavailableError();
  }
  const selectedBytes = bodyBytes.subarray(relativeStart, relativeEnd);
  if (`sha256:${createHash("sha256").update(selectedBytes).digest("hex")}` !== selection.selectedContentHash) {
    throw evidencePrivacyUnavailableError();
  }
  const selectedText = new TextDecoder("utf-8", { fatal: true }).decode(selectedBytes);
  const modelText = sanitizeSearchBody(selectedText);
  const suppliedBytes = Buffer.byteLength(modelText, "utf8");
  const selectionBindingHash = hashValue(JSON.stringify({
    schemaVersion: 1,
    pageBindingHash: current.bindingHash,
    pageContentHash: selection.pageContentHash,
    span: selection.span,
    selectedContentHash: selection.selectedContentHash
  }));
  return {
    ...current,
    modelText,
    bindingHash: selectionBindingHash,
    modelSuppliedRange: {
      unit: "utf8_bytes",
      start: 0,
      endExclusive: suppliedBytes,
      total: suppliedBytes,
      truncated: false
    },
    durableBodyRange: {
      locator: `utf8_bytes:${selection.span.start}:${selection.span.endExclusive}`,
      start: selection.span.start,
      endExclusive: selection.span.endExclusive
    },
    durableBodyText: selectedText
  };
}

export function resolveCurrentNoteEvidenceQuoteLocator(
  binding: CurrentNoteEvidenceBinding,
  quote: string
): string | undefined {
  if (!quote || quote.includes("[redacted-secret]")) return undefined;
  const characterOffset = binding.durableBodyText.indexOf(quote);
  if (characterOffset < 0) return undefined;
  const start = binding.durableBodyRange.start + Buffer.byteLength(
    binding.durableBodyText.slice(0, characterOffset),
    "utf8"
  );
  const endExclusive = start + Buffer.byteLength(quote, "utf8");
  return `utf8_bytes:${start}:${endExclusive}`;
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
  queryTerms?: ReturnType<typeof createQueryTerms>,
  expectedSignature?: MarkdownFileSignatureRecord
): CurrentRetrievalPageMutationBinding {
  if (!PageIdSchema.safeParse(indexedItem.summary.pageId).success) {
    throw evidencePrivacyUnavailableError();
  }
  const currentPage = readMarkdownPageByRelativePath(vaultPath, indexedItem.summary.pagePath);
  if (!currentPage) throw evidencePrivacyUnavailableError();
  if (
    expectedSignature &&
    (
      expectedSignature.pagePath !== currentPage.summary.pagePath ||
      path.resolve(expectedSignature.absolutePath) !== path.resolve(currentPage.absolutePath)
    )
  ) {
    throw evidencePrivacyUnavailableError();
  }
  const boundedPage = readBoundedMarkdownPage(vaultPath, currentPage.absolutePath, expectedSignature);
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
    },
    markdown: boundedPage.markdown,
    absolutePath: currentPage.absolutePath
  };
}

function readBoundedMarkdownPage(
  vaultPath: string,
  filePath: string,
  expectedSignature?: MarkdownFileSignatureRecord
): {
  readonly markdown: string;
  readonly contentHash: string;
} {
  let descriptor: number | undefined;
  try {
    assertMarkdownPagePathConfined(vaultPath, filePath);
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.size > MAX_RETRIEVAL_MARKDOWN_PAGE_BYTES ||
      (expectedSignature && !matchesMarkdownSignature(before, expectedSignature))
    ) {
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
    assertMarkdownPagePathConfined(vaultPath, filePath);
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
      currentPath.ctimeMs !== after.ctimeMs ||
      (expectedSignature && !matchesMarkdownSignature(after, expectedSignature))
    ) {
      throw evidencePrivacyUnavailableError();
    }
    const markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      markdown,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw evidencePrivacyUnavailableError();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function matchesMarkdownSignature(stat: fs.Stats, expected: MarkdownFileSignatureRecord): boolean {
  return stat.size === expected.sizeBytes &&
    stat.mtimeMs === expected.mtimeMs &&
    stat.ctimeMs === expected.ctimeMs &&
    String(stat.dev) === expected.deviceId &&
    String(stat.ino) === expected.fileId;
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

function isUtf8Boundary(bytes: Uint8Array, offset: number): boolean {
  return offset === 0 || offset === bytes.length || (bytes[offset]! & 0xc0) !== 0x80;
}

function truncateUtf8(value: string, maxBytes: number): {
  readonly value: string;
  readonly suppliedBytes: number;
  readonly totalBytes: number;
  readonly truncated: boolean;
} {
  const totalBytes = Buffer.byteLength(value, "utf8");
  if (totalBytes <= maxBytes) {
    return { value, suppliedBytes: totalBytes, totalBytes, truncated: false };
  }
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return { value: result, suppliedBytes: bytes, totalBytes, truncated: true };
}
