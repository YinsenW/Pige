import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type SourceRecord } from "@pige/schemas";
import { verifyReadableSourceFileAsync } from "./source-file-access";

export const EVIDENCE_CONTEXT_CHARACTER_LIMIT = 18_000;
export const EVIDENCE_FILE_READ_LIMIT_BYTES = 96 * 1024;
export const EVIDENCE_FRAGMENT_LIMIT = 24;

type TextArtifact = SourceRecord["artifacts"][number] & {
  readonly kind: "extracted_text" | "ocr";
};

interface LoadedMetadataSidecar {
  readonly artifact: SourceRecord["artifacts"][number];
  readonly value: Readonly<Record<string, unknown>>;
}

interface RawEvidenceFragment {
  readonly artifactId: string;
  readonly artifactKind: EvidenceArtifactKind;
  readonly locator: string;
  readonly parentLocator?: string;
  readonly text: string;
  readonly characterStart: number;
  readonly characterEnd: number;
  readonly confidence?: number;
}

export type EvidenceArtifactKind = "extracted_text" | "ocr" | "managed_source";

export interface EvidenceFragment {
  readonly ref: string;
  readonly artifactId: string;
  readonly artifactKind: EvidenceArtifactKind;
  readonly locator: string;
  readonly citationLocator: string;
  readonly parentLocator?: string;
  readonly text: string;
  readonly characterStart: number;
  readonly characterEnd: number;
  readonly confidence?: number;
}

export interface EvidencePack {
  readonly sourceId: string;
  readonly fragments: readonly EvidenceFragment[];
  readonly artifactIds: readonly string[];
  readonly characterCount: number;
  readonly truncated: boolean;
  readonly warnings: readonly string[];
}

export interface EvidenceAssemblyOptions {
  readonly maxCharacters?: number;
  readonly maxFragments?: number;
  readonly maxReadBytesPerFile?: number;
}

const MAX_METADATA_SIDECAR_BYTES = 16 * 1024 * 1024;

export class EvidenceAssemblyService {
  async assemble(
    vaultPath: string,
    sourceRecord: SourceRecord,
    options: EvidenceAssemblyOptions = {}
  ): Promise<EvidencePack> {
    const parsed = SourceRecordSchema.parse(sourceRecord);
    const maxCharacters = positiveLimit(options.maxCharacters, EVIDENCE_CONTEXT_CHARACTER_LIMIT);
    const maxFragments = positiveLimit(options.maxFragments, EVIDENCE_FRAGMENT_LIMIT);
    const maxReadBytes = positiveLimit(options.maxReadBytesPerFile, EVIDENCE_FILE_READ_LIMIT_BYTES);
    const warnings: string[] = [];
    const textArtifacts = parsed.artifacts
      .filter((artifact): artifact is TextArtifact => artifact.kind === "extracted_text" || artifact.kind === "ocr")
      .sort((left, right) => artifactPriority(left) - artifactPriority(right));

    let rawFragments: RawEvidenceFragment[] = [];
    if (textArtifacts.length > 0) {
      const sidecars = await loadMetadataSidecars(vaultPath, parsed);
      for (const artifact of textArtifacts) {
        const loaded = await readVerifiedArtifact(vaultPath, artifact, maxReadBytes);
        if (loaded.truncated) warnings.push(`evidence_text_read_truncated:${artifact.id}`);
        const pairedSidecars = sidecars.filter((candidate) => sidecarMatchesArtifact(candidate, parsed.id, artifact));
        if (pairedSidecars.length > 1) {
          throw new PigeDomainError(
            "agent_ingest.ambiguous_evidence_metadata",
            "More than one metadata sidecar claims the selected evidence artifact."
          );
        }
        const pairedSidecar = pairedSidecars[0];
        if (!pairedSidecar && parsed.kind !== "url") {
          warnings.push(`evidence_metadata_unpaired:${artifact.id}`);
        }
        rawFragments.push(...createArtifactFragments(artifact, loaded.text, pairedSidecar?.value, parsed.kind));
      }
    } else if (isDirectTextSource(parsed)) {
      const verified = await verifyReadableSourceFileAsync(vaultPath, parsed);
      const loaded = await readVerifiedFile(verified.absolutePath, {
        checksum: verified.checksum,
        size: verified.size
      }, maxReadBytes);
      if (loaded.truncated) warnings.push(`evidence_text_read_truncated:source:${parsed.id}`);
      const text = decodeUtf8Prefix(loaded.bytes);
      rawFragments = [{
        artifactId: `source:${parsed.id}`,
        artifactKind: "managed_source",
        locator: verified.location === "referenced_original" ? "referenced_original_preview" : "managed_source_preview",
        text,
        characterStart: 0,
        characterEnd: text.length
      }];
    }

    const deduplicated = deduplicateFragments(rawFragments);
    const bounded = boundFragments(deduplicated, maxCharacters, maxFragments);
    const artifactIds = Array.from(new Set(bounded.fragments.map((fragment) => fragment.artifactId)));
    return {
      sourceId: parsed.id,
      fragments: bounded.fragments,
      artifactIds,
      characterCount: bounded.fragments.reduce((total, fragment) => total + fragment.text.length, 0),
      truncated: bounded.truncated || warnings.some((warning) => warning.startsWith("evidence_text_read_truncated:")),
      warnings: Array.from(new Set(warnings))
    };
  }
}

async function loadMetadataSidecars(
  vaultPath: string,
  sourceRecord: SourceRecord
): Promise<LoadedMetadataSidecar[]> {
  const loaded: LoadedMetadataSidecar[] = [];
  for (const artifact of sourceRecord.artifacts) {
    if (artifact.kind !== "metadata") continue;
    const absolutePath = resolveVaultRelativePath(vaultPath, artifact.path);
    const verified = await readVerifiedFile(
      absolutePath,
      { checksum: artifact.checksum, size: artifact.size },
      MAX_METADATA_SIDECAR_BYTES,
      vaultPath,
      MAX_METADATA_SIDECAR_BYTES
    );
    if (verified.skipped) continue;
    try {
      const value = JSON.parse(decodeUtf8Prefix(verified.bytes)) as unknown;
      if (isRecord(value)) loaded.push({ artifact, value });
    } catch {
      // A malformed, unrelated metadata artifact must not become evidence.
    }
  }
  return loaded;
}

async function readVerifiedArtifact(
  vaultPath: string,
  artifact: TextArtifact,
  maxReadBytes: number
): Promise<{ readonly text: string; readonly truncated: boolean }> {
  const absolutePath = resolveVaultRelativePath(vaultPath, artifact.path);
  const verified = await readVerifiedFile(
    absolutePath,
    { checksum: artifact.checksum, size: artifact.size },
    maxReadBytes,
    vaultPath
  );
  return { text: decodeUtf8Prefix(verified.bytes), truncated: verified.truncated };
}

interface ExpectedFileIntegrity {
  readonly checksum: string | undefined;
  readonly size: number | undefined;
}

interface VerifiedFileRead {
  readonly bytes: Buffer;
  readonly truncated: boolean;
  readonly skipped: boolean;
}

async function readVerifiedFile(
  filePath: string,
  expected: ExpectedFileIntegrity,
  captureLimit: number,
  containmentRoot?: string,
  hardSizeLimit?: number
): Promise<VerifiedFileRead> {
  const realPath = await resolveRealFilePath(filePath);
  if (containmentRoot) await assertRealPathContained(realPath, containmentRoot);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let file: fs.promises.FileHandle;
  try {
    file = await fs.promises.open(filePath, flags);
  } catch {
    throw new PigeDomainError("agent_ingest.source_integrity_failed", "The selected evidence artifact is unavailable.");
  }
  try {
    const before = await file.stat();
    if (!before.isFile()) {
      throw new PigeDomainError("agent_ingest.source_integrity_failed", "The selected evidence artifact is not a regular file.");
    }
    if (hardSizeLimit !== undefined && before.size > hardSizeLimit) {
      return { bytes: Buffer.alloc(0), truncated: true, skipped: true };
    }
    if (expected.size !== undefined && before.size !== expected.size) {
      throw new PigeDomainError("agent_ingest.source_integrity_failed", "The selected source text no longer matches its recorded size.");
    }
    const capture = Buffer.alloc(Math.min(before.size, captureLimit));
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const hash = createHash("sha256");
    let position = 0;
    let captured = 0;
    while (position < before.size) {
      const result = await file.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (result.bytesRead === 0) break;
      const chunk = buffer.subarray(0, result.bytesRead);
      hash.update(chunk);
      if (captured < capture.length) {
        const copyLength = Math.min(chunk.length, capture.length - captured);
        chunk.copy(capture, captured, 0, copyLength);
        captured += copyLength;
      }
      position += result.bytesRead;
    }
    const after = await file.stat();
    if (
      position !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new PigeDomainError("agent_ingest.source_integrity_failed", "The selected evidence artifact changed while it was being read.");
    }
    const checksum = `sha256:${hash.digest("hex")}`;
    if (expected.checksum && checksum !== expected.checksum) {
      throw new PigeDomainError("agent_ingest.source_integrity_failed", "The selected source text no longer matches its recorded checksum.");
    }
    const realPathAfter = await resolveRealFilePath(filePath);
    if (realPathAfter !== realPath) {
      throw new PigeDomainError("agent_ingest.source_integrity_failed", "The selected evidence artifact path changed while it was being read.");
    }
    return {
      bytes: capture.subarray(0, captured),
      truncated: before.size > captured,
      skipped: false
    };
  } finally {
    await file.close();
  }
}

async function resolveRealFilePath(filePath: string): Promise<string> {
  try {
    return await fs.promises.realpath(filePath);
  } catch {
    throw new PigeDomainError("agent_ingest.source_integrity_failed", "The selected evidence artifact is unavailable.");
  }
}

async function assertRealPathContained(realPath: string, rootPath: string): Promise<void> {
  const realRoot = await fs.promises.realpath(rootPath);
  if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) {
    throw new PigeDomainError("source.path_outside_vault", "The evidence artifact resolves outside the active vault.");
  }
}

function decodeUtf8Prefix(bytes: Buffer): string {
  return bytes.subarray(0, completeUtf8PrefixLength(bytes)).toString("utf8");
}

function completeUtf8PrefixLength(bytes: Buffer): number {
  if (bytes.length === 0) return 0;
  let leadIndex = bytes.length - 1;
  while (leadIndex >= 0 && (bytes[leadIndex]! & 0xc0) === 0x80) leadIndex -= 1;
  if (leadIndex < 0) return 0;
  const lead = bytes[leadIndex]!;
  const expectedLength = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : lead < 0xf8 ? 4 : 1;
  return bytes.length - leadIndex < expectedLength ? leadIndex : bytes.length;
}

function sidecarMatchesArtifact(
  sidecar: LoadedMetadataSidecar,
  sourceId: string,
  artifact: TextArtifact
): boolean {
  const value = sidecar.value;
  if (value.schemaVersion !== 1 || value.sourceId !== sourceId || value.artifactId !== sidecar.artifact.id) return false;
  if (artifact.kind === "extracted_text") {
    return typeof value.kind === "string" && value.kind.endsWith("_parse_metadata") &&
      Boolean(artifact.checksum) && value.extractedTextChecksum === artifact.checksum;
  }
  return (
    value.kind === "image_ocr_metadata" ||
    value.kind === "pdf_page_ocr_metadata" ||
    value.kind === "pptx_media_ocr_metadata"
  ) &&
    Boolean(artifact.checksum) && value.ocrTextChecksum === artifact.checksum;
}

function createArtifactFragments(
  artifact: TextArtifact,
  text: string,
  sidecar: Readonly<Record<string, unknown>> | undefined,
  sourceKind: SourceRecord["kind"]
): RawEvidenceFragment[] {
  const unitFragments = createUnitFragments(artifact, text, sidecar?.units);
  if (unitFragments.length > 0) return unitFragments;
  const pageFragments = createPdfPageFragments(artifact, text, sidecar?.pages);
  if (pageFragments.length > 0) return pageFragments;
  const locator = sourceKind === "url" && artifact.kind === "extracted_text" && sidecar === undefined
    ? "url"
    : "artifact_preview";
  return [{
    artifactId: artifact.id,
    artifactKind: artifact.kind,
    locator,
    text,
    characterStart: 0,
    characterEnd: text.length
  }];
}

function createUnitFragments(
  artifact: TextArtifact,
  text: string,
  unitsValue: unknown
): RawEvidenceFragment[] {
  if (!Array.isArray(unitsValue)) return [];
  const fragments: RawEvidenceFragment[] = [];
  for (const value of unitsValue) {
    if (!isRecord(value) || typeof value.locator !== "string") continue;
    const start = nonNegativeInteger(value.characterStart);
    const end = nonNegativeInteger(value.characterEnd);
    if (start === undefined || end === undefined || end <= start || end > text.length) continue;
    const confidence = normalizedConfidence(value.confidence);
    const parentLocator = typeof value.parentLocator === "string" ? value.parentLocator : undefined;
    fragments.push({
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      locator: value.locator,
      ...(parentLocator ? { parentLocator } : {}),
      text: text.slice(start, end),
      characterStart: start,
      characterEnd: end,
      ...(confidence !== undefined ? { confidence } : {})
    });
  }
  return fragments;
}

function createPdfPageFragments(
  artifact: TextArtifact,
  text: string,
  pagesValue: unknown
): RawEvidenceFragment[] {
  if (!Array.isArray(pagesValue)) return [];
  const offsetFragments = pagesValue.flatMap((value): RawEvidenceFragment[] => {
    if (!isRecord(value) || typeof value.locator !== "string") return [];
    const start = nonNegativeInteger(value.characterStart);
    const end = nonNegativeInteger(value.characterEnd);
    if (start === undefined || end === undefined || end <= start || end > text.length) return [];
    return [{
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      locator: value.locator,
      text: text.slice(start, end),
      characterStart: start,
      characterEnd: end
    }];
  });
  if (offsetFragments.length > 0) return offsetFragments;
  const targets = pagesValue
    .map((value) => isRecord(value) && typeof value.locator === "string" ? value.locator : undefined)
    .filter((locator): locator is string => typeof locator === "string" && /^page:\d+$/u.test(locator));
  if (targets.length === 1 && !text.includes("--- Page ")) {
    const locator = targets[0];
    return locator ? [{
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      locator,
      text,
      characterStart: 0,
      characterEnd: text.length
    }] : [];
  }
  const fragments: RawEvidenceFragment[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const locator = targets[index];
    if (!locator) continue;
    const page = /^page:(\d+)$/u.exec(locator)?.[1];
    if (!page) continue;
    const marker = `--- Page ${page} ---\n`;
    const markerStart = text.indexOf(marker);
    if (markerStart < 0) continue;
    const start = markerStart + marker.length;
    const nextTarget = targets.slice(index + 1)
      .map((candidate) => /^page:(\d+)$/u.exec(candidate)?.[1])
      .filter((candidate): candidate is string => Boolean(candidate))
      .map((candidate) => text.indexOf(`--- Page ${candidate} ---\n`, start))
      .find((candidate) => candidate >= 0);
    const end = nextTarget ?? text.length;
    if (end <= start) continue;
    fragments.push({
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      locator,
      text: text.slice(start, end),
      characterStart: start,
      characterEnd: end
    });
  }
  return fragments;
}

function deduplicateFragments(fragments: readonly RawEvidenceFragment[]): RawEvidenceFragment[] {
  const selected: RawEvidenceFragment[] = [];
  for (const fragment of fragments) {
    const normalized = normalizeEvidenceText(fragment.text);
    if (!normalized) continue;
    const parent = fragment.parentLocator ?? fragment.locator;
    const duplicate = selected.some((candidate) => {
      if ((candidate.parentLocator ?? candidate.locator) !== parent) return false;
      if (candidate.artifactKind !== "extracted_text" || fragment.artifactKind !== "ocr") return false;
      const existing = normalizeEvidenceText(candidate.text);
      return existing === normalized || existing.includes(normalized);
    });
    if (!duplicate) selected.push(fragment);
  }
  return selected;
}

function boundFragments(
  fragments: readonly RawEvidenceFragment[],
  maxCharacters: number,
  maxFragments: number
): { readonly fragments: EvidenceFragment[]; readonly truncated: boolean } {
  const selected: EvidenceFragment[] = [];
  const primary = fragments.filter((fragment) => fragment.artifactKind !== "ocr");
  const ocr = fragments.filter((fragment) => fragment.artifactKind === "ocr");
  const hasMixedEvidence = primary.length > 0 && ocr.length > 0;
  const reservedOcrFragments = hasMixedEvidence
    ? Math.min(ocr.length, Math.max(1, Math.floor(maxFragments / 4)))
    : 0;
  const ocrCharacters = ocr.reduce((total, fragment) => total + fragment.text.trim().length, 0);
  const reservedOcrCharacters = hasMixedEvidence
    ? Math.min(ocrCharacters, Math.max(1, Math.floor(maxCharacters / 4)))
    : 0;
  let truncated = false;
  let usedCharacters = 0;

  const appendGroup = (group: readonly RawEvidenceFragment[], characterLimit: number, fragmentLimit: number): void => {
    let groupCharacters = 0;
    let visited = 0;
    for (const raw of group) {
      if (selected.length >= maxFragments || visited >= fragmentLimit) break;
      const leftTrimmed = raw.text.trimStart();
      const leadingCharacters = raw.text.length - leftTrimmed.length;
      const trimmed = leftTrimmed.trimEnd();
      visited += 1;
      if (!trimmed) continue;
      const remaining = Math.min(maxCharacters - usedCharacters, characterLimit - groupCharacters);
      if (remaining <= 0) break;
      const text = truncateAtCodePoint(trimmed, remaining);
      if (!text) {
        truncated = true;
        break;
      }
      if (text.length < trimmed.length) truncated = true;
      const characterStart = raw.characterStart + leadingCharacters;
      const characterEnd = characterStart + text.length;
      const ref = `ev_${String(selected.length + 1).padStart(2, "0")}`;
      selected.push({
        ref,
        artifactId: raw.artifactId,
        artifactKind: raw.artifactKind,
        locator: raw.locator,
        citationLocator: citationLocator(raw.locator, raw.artifactId),
        ...(raw.parentLocator ? { parentLocator: raw.parentLocator } : {}),
        text,
        characterStart,
        characterEnd,
        ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {})
      });
      usedCharacters += text.length;
      groupCharacters += text.length;
    }
  };

  appendGroup(
    primary,
    hasMixedEvidence ? maxCharacters - reservedOcrCharacters : maxCharacters,
    hasMixedEvidence ? maxFragments - reservedOcrFragments : maxFragments
  );
  appendGroup(ocr, maxCharacters - usedCharacters, maxFragments - selected.length);
  const nonEmptyFragmentCount = fragments.filter((fragment) => fragment.text.trim().length > 0).length;
  if (selected.length < nonEmptyFragmentCount) truncated = true;
  return { fragments: disambiguateCitationLocators(selected), truncated };
}

function disambiguateCitationLocators(fragments: readonly EvidenceFragment[]): EvidenceFragment[] {
  const artifactsByLocator = new Map<string, Set<string>>();
  for (const fragment of fragments) {
    const artifactIds = artifactsByLocator.get(fragment.citationLocator) ?? new Set<string>();
    artifactIds.add(fragment.artifactId);
    artifactsByLocator.set(fragment.citationLocator, artifactIds);
  }
  return fragments.map((fragment) => {
    if ((artifactsByLocator.get(fragment.citationLocator)?.size ?? 0) < 2) return fragment;
    const artifactSuffix = createHash("sha256").update(fragment.artifactId).digest("hex").slice(0, 8);
    return { ...fragment, citationLocator: `${fragment.citationLocator}-art-${artifactSuffix}` };
  });
}

function citationLocator(locator: string, artifactId: string): string {
  const slideMediaOcr = /^slide:(\d+)\/media:(\d+)\/ocr:block:(\d+)$/u.exec(locator);
  if (slideMediaOcr) return `slide${slideMediaOcr[1]}-media${slideMediaOcr[2]}-ocr${slideMediaOcr[3]}`;
  const pageOcr = /^page:(\d+)\/ocr:block:(\d+)$/u.exec(locator);
  if (pageOcr) return `p${pageOcr[1]}-ocr${pageOcr[2]}`;
  const page = /^page:(\d+)$/u.exec(locator);
  if (page) return `p${page[1]}`;
  const slide = /^slide:(\d+)$/u.exec(locator);
  if (slide) return `slide${slide[1]}`;
  const block = /^block:(\d+)$/u.exec(locator);
  if (block) return `block${block[1]}`;
  const ocrBlock = /^ocr:block:(\d+)$/u.exec(locator);
  if (ocrBlock) return `ocr${ocrBlock[1]}`;
  if (locator === "url") return "url";
  if (locator === "managed_source_preview") return "source";
  if (locator === "referenced_original_preview") return "original";
  const suffix = createHash("sha256").update(`${artifactId}:${locator}`).digest("hex").slice(0, 10);
  return `span_${suffix}`;
}

function artifactPriority(artifact: TextArtifact): number {
  return artifact.kind === "extracted_text" ? 0 : 1;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fallback;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

function normalizedConfidence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function normalizeEvidenceText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

function truncateAtCodePoint(value: string, limit: number): string {
  let result = value.slice(0, limit);
  const last = result.charCodeAt(result.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) result = result.slice(0, -1);
  return result;
}

function isDirectTextSource(sourceRecord: SourceRecord): boolean {
  return sourceRecord.kind === "text" || sourceRecord.kind === "markdown_file" || sourceRecord.kind === "plain_text_file";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveVaultRelativePath(vaultPath: string, relativePath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(vaultPath, ...relativePath.split("/"));
  if (resolvedPath !== resolvedVault && !resolvedPath.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new PigeDomainError("source.path_outside_vault", "The evidence artifact path escapes the active vault.");
  }
  return resolvedPath;
}
