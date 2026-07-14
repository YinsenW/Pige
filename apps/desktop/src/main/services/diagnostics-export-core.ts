import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { containsRestrictedModelContent } from "./model-egress-content";
import { DIAGNOSTICS_EXPORT_MAX_BYTES } from "./diagnostics-export-types";

export class DiagnosticsExportBlockedError extends Error {}

export type DiagnosticsExportDestinationBinding =
  | { readonly kind: "absent" }
  | {
      readonly kind: "held_descriptor";
      readonly descriptor: number;
      readonly device: number;
      readonly inode: number;
    }
  | {
      readonly kind: "content_digest";
      readonly device: number;
      readonly inode: number;
      readonly size: number;
      readonly modifiedAtMs: number;
      readonly changedAtMs: number;
      readonly sha256: string;
    };

export interface PreparedDiagnosticsExportFile {
  readonly outputPath: string;
  readonly destination: string;
  readonly parentRealPath: string;
  readonly parentDevice: number;
  readonly parentInode: number;
  readonly destinationBinding: DiagnosticsExportDestinationBinding;
  readonly temporaryPath: string;
  readonly temporaryDescriptor: number;
  readonly temporaryDevice: number;
  readonly temporaryInode: number;
}

const INCLUDED_CATEGORIES = [
  {
    id: "app_runtime",
    label: "App version, platform, and architecture",
    included: true,
    reason: "Needed to diagnose platform-specific failures."
  },
  {
    id: "diagnostics_health",
    label: "Diagnostics health summary",
    included: true,
    reason: "Redacted operational status only."
  },
  {
    id: "recent_errors",
    label: "Recent redacted diagnostic events",
    included: true,
    reason: "Bounded and redacted event summaries."
  }
] as const;

const EXCLUDED_CATEGORIES = [
  {
    id: "secrets",
    label: "API keys, tokens, cookies, and credentials",
    included: false,
    reason: "Secrets are never exported by default."
  },
  {
    id: "content",
    label: "Full notes, source files, conversations, memory, prompts, and model responses",
    included: false,
    reason: "Support bundles must not duplicate private knowledge content by default."
  },
  {
    id: "binaries",
    label: "Local models, parser binaries, packages, and source artifacts",
    included: false,
    reason: "Large binaries and artifacts are excluded."
  }
] as const;

const PRIVACY_WARNINGS = [
  "The bundle is created locally and is not uploaded automatically.",
  "Paths, emails, and common secret patterns are redacted by default.",
  "Review the preview before exporting."
] as const;

const DIAGNOSTIC_MESSAGES = new Set([
  "Background Agent ingest failed.",
  "Waiting Agent ingest requeue failed.",
  "App ready.",
  "Background capture processing failed.",
  "Background local index rebuild failed.",
  "Support bundle exported.",
  "Support bundle preview generated.",
  "Interrupted background jobs reconciled.",
  "Durable background job recovery failed.",
  "Background image OCR failed.",
  "Background document parsing failed.",
  "[REDACTED_CONTENT]",
  "[TRUNCATED]"
]);

const SAFE_STRING_DETAIL_KEYS = new Set([
  "artifactId", "capability", "checksum", "checkpointId", "code", "correlationId",
  "domain", "engine", "errorCode", "errorId", "eventId", "format", "hash", "health",
  "jobClass", "jobId", "kind", "messageKey", "modelId", "operationId", "pageId", "parser",
  "permissionDecisionId", "platform", "providerId", "requestId", "safeCheckpointId", "scope",
  "sourceId", "stage", "state", "status", "toolId", "toolName", "type", "vaultId", "version",
  "warningCode", "truncated"
]);
const SAFE_NUMBER_DETAIL_KEYS = new Set([
  "attempts", "bytes", "bytesWritten", "count", "durationMs", "elapsedMs", "errorCount",
  "fileCount", "itemCount", "maxBytes", "pageCount", "redactedContentCount",
  "redactedPrivateCount", "redactedSecretCount", "redactedUnknownCount", "retryAfterMs",
  "retryCount", "size", "total", "totalBytes"
]);
const SAFE_BOOLEAN_DETAIL_KEYS = new Set(["enabled", "localOnly", "ready", "retryable"]);

export function redactDiagnosticText(input: string): string {
  return input
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_SECRET]")
    .replace(/\b(?:sk|rk)-(?:proj-|ant-api\d*-)?[A-Za-z0-9_-]{12,}/g, "[REDACTED_SECRET]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED_SECRET]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_SECRET]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{12,}\b/g, "[REDACTED_SECRET]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED_SECRET]")
    .replace(/\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED_SECRET]@")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(Authorization|Cookie):\s*[^\n\r]+/gi, "$1: [REDACTED_SECRET]")
    .replace(/(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)=([^&\s]+)/gi, "$1=[REDACTED_SECRET]")
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)["']?\s*:\s*)["'][^"'\n\r]+["']/gi,
      "$1\"[REDACTED_SECRET]\""
    );
}

export function redactPaths(input: string): string {
  const home = os.homedir();
  const escapedHome = escapeRegExp(home);
  const homeRedacted = input
    .replace(new RegExp(escapedHome, "g"), "<home>")
    .replace(/\/Users\/[^/\n\r"]+/g, "<home>")
    .replace(/\/home\/[^/\n\r"]+/g, "<home>");
  return homeRedacted.replace(/[A-Z]:\\Users\\[^"\n\r]+/gi, (match) => {
    const parts = match.split("\\");
    return ["<home>", ...parts.slice(3)].join("\\");
  });
}

export function assertSafeDiagnosticExportText(content: string): void {
  const bytes = Buffer.byteLength(content);
  if (
    bytes === 0 ||
    bytes > DIAGNOSTICS_EXPORT_MAX_BYTES ||
    !content.endsWith("\n") ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(content) ||
    redactDiagnosticText(content) !== content ||
    redactPaths(content) !== content ||
    containsRestrictedModelContent(content)
  ) {
    throw new DiagnosticsExportBlockedError("Support bundle content did not pass the export boundary.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new DiagnosticsExportBlockedError("Support bundle content is not valid JSON.");
  }
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, [
      "schemaVersion",
      "exportedAt",
      "localOnly",
      "preview",
      "app",
      "diagnosticsHealth",
      "recentEvents"
    ]) ||
    parsed.schemaVersion !== 1 ||
    parsed.localOnly !== true ||
    typeof parsed.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.exportedAt)) ||
    !isSupportBundlePreview(parsed.preview) ||
    !isSupportBundleApp(parsed.app) ||
    !isDiagnosticsHealth(parsed.diagnosticsHealth) ||
    !isRecentEvents(parsed.recentEvents)
  ) {
    throw new DiagnosticsExportBlockedError("Support bundle content has an invalid envelope.");
  }
}

export function prepareDiagnosticsExportFile(
  outputPath: string,
  generation = randomUUID(),
  platform: NodeJS.Platform = process.platform
): PreparedDiagnosticsExportFile {
  if (
    !path.isAbsolute(outputPath) ||
    outputPath.length > 32_768 ||
    outputPath.includes("\u0000") ||
    !/^[a-f0-9-]{16,64}$/u.test(generation)
  ) {
    throw new DiagnosticsExportBlockedError("Support bundle destination is invalid.");
  }

  const parent = path.dirname(outputPath);
  const parentRealPath = fs.realpathSync(parent);
  const parentIdentity = fs.statSync(parentRealPath);
  if (!parentIdentity.isDirectory()) {
    throw new DiagnosticsExportBlockedError("Support bundle destination parent is invalid.");
  }
  const destination = path.join(parentRealPath, path.basename(outputPath));
  const initialDestinationIdentity = readDestinationIdentity(destination);
  if (initialDestinationIdentity?.isSymbolicLink()) {
    throw new DiagnosticsExportBlockedError("Support bundle destination is a symbolic link.");
  }
  if (initialDestinationIdentity && !initialDestinationIdentity.isFile()) {
    throw new DiagnosticsExportBlockedError("Support bundle destination is not a regular file.");
  }

  const temporaryPath = path.join(parentRealPath, `.pige-support-${generation}.tmp`);
  let destinationBinding: DiagnosticsExportDestinationBinding = { kind: "absent" };
  let temporaryDescriptor: number | undefined;
  try {
    if (initialDestinationIdentity) {
      destinationBinding = platform === "win32"
        ? captureDigestDestinationBinding(destination, initialDestinationIdentity)
        : captureHeldDestinationBinding(destination, initialDestinationIdentity);
    }

    temporaryDescriptor = fs.openSync(temporaryPath, "wx", 0o600);
    const temporaryIdentity = fs.fstatSync(temporaryDescriptor);
    if (!temporaryIdentity.isFile()) {
      throw new DiagnosticsExportBlockedError("Support bundle temporary file is invalid.");
    }
    return {
      outputPath,
      destination,
      parentRealPath,
      parentDevice: parentIdentity.dev,
      parentInode: parentIdentity.ino,
      destinationBinding,
      temporaryPath,
      temporaryDescriptor,
      temporaryDevice: temporaryIdentity.dev,
      temporaryInode: temporaryIdentity.ino
    };
  } catch (caught) {
    try {
      try {
        if (temporaryDescriptor !== undefined) fs.closeSync(temporaryDescriptor);
      } finally {
        if (destinationBinding.kind === "held_descriptor") fs.closeSync(destinationBinding.descriptor);
      }
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
    throw caught;
  }
}

export function commitPreparedDiagnosticsExportFile(
  prepared: PreparedDiagnosticsExportFile,
  content: string
): number {
  assertSafeDiagnosticExportText(content);
  const expectedBytes = Buffer.byteLength(content);
  const expectedIdentity = identityFromPreparedTemporary(prepared);
  const beforeWriteIdentity = fs.fstatSync(prepared.temporaryDescriptor);
  if (!beforeWriteIdentity.isFile() || beforeWriteIdentity.size !== 0 ||
    !sameIdentity(expectedIdentity, beforeWriteIdentity)) {
    throw new DiagnosticsExportBlockedError("Support bundle temporary file changed before export.");
  }
  const buffer = Buffer.from(content);
  let offset = 0;
  while (offset < buffer.length) {
    const written = fs.writeSync(
      prepared.temporaryDescriptor,
      buffer,
      offset,
      buffer.length - offset,
      offset
    );
    if (written <= 0) throw new DiagnosticsExportBlockedError("Support bundle write did not advance.");
    offset += written;
  }
  fs.ftruncateSync(prepared.temporaryDescriptor, expectedBytes);
  fs.fsyncSync(prepared.temporaryDescriptor);
  const afterWriteIdentity = fs.fstatSync(prepared.temporaryDescriptor);
  if (!afterWriteIdentity.isFile() || afterWriteIdentity.size !== expectedBytes ||
    !sameIdentity(expectedIdentity, afterWriteIdentity)) {
    throw new DiagnosticsExportBlockedError("Support bundle temporary file is invalid.");
  }

  const currentParentRealPath = fs.realpathSync(path.dirname(prepared.outputPath));
  const currentParentIdentity = fs.statSync(currentParentRealPath);
  if (currentParentRealPath !== prepared.parentRealPath ||
    currentParentIdentity.dev !== prepared.parentDevice ||
    currentParentIdentity.ino !== prepared.parentInode) {
    throw new DiagnosticsExportBlockedError("Support bundle destination changed during export.");
  }
  const currentTemporaryIdentity = fs.lstatSync(prepared.temporaryPath);
  if (!currentTemporaryIdentity.isFile() || currentTemporaryIdentity.isSymbolicLink() ||
    !sameIdentity(expectedIdentity, currentTemporaryIdentity) ||
    !reconcileDiagnosticsExportFile(prepared.temporaryPath, content)) {
    throw new DiagnosticsExportBlockedError("Support bundle temporary file changed during export.");
  }
  if (!matchesPreparedDestination(prepared, readDestinationIdentity(prepared.destination))) {
    throw new DiagnosticsExportBlockedError("Support bundle destination changed during export.");
  }
  fs.renameSync(prepared.temporaryPath, prepared.destination);
  const publishedIdentity = fs.lstatSync(prepared.destination);
  if (!publishedIdentity.isFile() || publishedIdentity.isSymbolicLink() ||
    !sameIdentity(expectedIdentity, publishedIdentity) ||
    !reconcileDiagnosticsExportFile(prepared.destination, content)) {
    throw new DiagnosticsExportBlockedError("Support bundle publication could not be verified.");
  }
  syncParentDirectory(prepared.parentRealPath);
  return expectedBytes;
}

export function releasePreparedDiagnosticsExportFile(prepared: PreparedDiagnosticsExportFile): void {
  const expectedIdentity = identityFromPreparedTemporary(prepared);
  try {
    const current = fs.lstatSync(prepared.temporaryPath);
    if (current.isFile() && !current.isSymbolicLink() && sameIdentity(expectedIdentity, current)) {
      fs.rmSync(prepared.temporaryPath);
    }
  } catch {
    // A committed or externally removed temporary file needs no cleanup.
  } finally {
    try {
      fs.closeSync(prepared.temporaryDescriptor);
    } finally {
      if (prepared.destinationBinding.kind === "held_descriptor") {
        fs.closeSync(prepared.destinationBinding.descriptor);
      }
    }
  }
}

export function writeDiagnosticsExportFile(outputPath: string, content: string): number {
  assertSafeDiagnosticExportText(content);
  const prepared = prepareDiagnosticsExportFile(outputPath);
  try {
    return commitPreparedDiagnosticsExportFile(prepared, content);
  } finally {
    releasePreparedDiagnosticsExportFile(prepared);
  }
}

export function reconcileDiagnosticsExportFile(
  outputPath: string,
  expectedContent: string
): { readonly bytesWritten: number } | undefined {
  try {
    assertSafeDiagnosticExportText(expectedContent);
    if (!path.isAbsolute(outputPath) || outputPath.includes("\u0000")) return undefined;
    const expectedBytes = Buffer.byteLength(expectedContent);
    const descriptor = fs.openSync(
      outputPath,
      fs.constants.O_RDONLY |
        (fs.constants.O_NONBLOCK ?? 0) |
        (fs.constants.O_NOFOLLOW ?? 0)
    );
    try {
      const openedIdentity = fs.fstatSync(descriptor);
      if (!openedIdentity.isFile() || openedIdentity.size !== expectedBytes ||
        (process.platform !== "win32" && (openedIdentity.mode & 0o077) !== 0)) return undefined;
      const buffer = Buffer.alloc(expectedBytes);
      let offset = 0;
      while (offset < expectedBytes) {
        const read = fs.readSync(descriptor, buffer, offset, expectedBytes - offset, offset);
        if (read <= 0) return undefined;
        offset += read;
      }
      const afterReadIdentity = fs.fstatSync(descriptor);
      const namedIdentity = fs.lstatSync(outputPath);
      if (
        !afterReadIdentity.isFile() ||
        afterReadIdentity.size !== expectedBytes ||
        !sameIdentity(openedIdentity, afterReadIdentity) ||
        !namedIdentity.isFile() ||
        namedIdentity.isSymbolicLink() ||
        !sameIdentity(openedIdentity, namedIdentity) ||
        !buffer.equals(Buffer.from(expectedContent))
      ) {
        return undefined;
      }
      return { bytesWritten: expectedBytes };
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return undefined;
  }
}

function readDestinationIdentity(destination: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(destination);
  } catch (caught) {
    if (isNodeError(caught) && caught.code === "ENOENT") return undefined;
    throw caught;
  }
}

function syncParentDirectory(parentRealPath: string): void {
  if (process.platform === "win32") return;
  const parentDescriptor = fs.openSync(parentRealPath, "r");
  try {
    fs.fsyncSync(parentDescriptor);
  } finally {
    fs.closeSync(parentDescriptor);
  }
}

function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function identityFromPreparedTemporary(prepared: PreparedDiagnosticsExportFile): fs.Stats {
  return { dev: prepared.temporaryDevice, ino: prepared.temporaryInode } as fs.Stats;
}

function matchesPreparedDestination(
  prepared: PreparedDiagnosticsExportFile,
  current: fs.Stats | undefined
): boolean {
  if (prepared.destinationBinding.kind === "absent") return current === undefined;
  if (!current?.isFile() || current.isSymbolicLink()) return false;
  if (prepared.destinationBinding.kind === "content_digest") {
    try {
      const currentBinding = captureDigestDestinationBinding(prepared.destination, current);
      return currentBinding.size === prepared.destinationBinding.size &&
        currentBinding.sha256 === prepared.destinationBinding.sha256;
    } catch {
      return false;
    }
  }
  try {
    const held = fs.fstatSync(prepared.destinationBinding.descriptor);
    return held.isFile() &&
      held.dev === prepared.destinationBinding.device &&
      held.ino === prepared.destinationBinding.inode &&
      sameIdentity(held, current);
  } catch {
    return false;
  }
}

function captureHeldDestinationBinding(
  destination: string,
  initialIdentity: fs.Stats
): DiagnosticsExportDestinationBinding {
  const descriptor = openDestinationForRead(destination);
  try {
    const opened = fs.fstatSync(descriptor);
    const named = fs.lstatSync(destination);
    if (!isStableNamedFile(initialIdentity, opened, named)) {
      throw new DiagnosticsExportBlockedError("Support bundle destination changed during preparation.");
    }
    return { kind: "held_descriptor", descriptor, device: opened.dev, inode: opened.ino };
  } catch (caught) {
    fs.closeSync(descriptor);
    throw caught;
  }
}

function captureDigestDestinationBinding(
  destination: string,
  initialIdentity: fs.Stats
): Extract<DiagnosticsExportDestinationBinding, { readonly kind: "content_digest" }> {
  if (initialIdentity.size < 0 || initialIdentity.size > DIAGNOSTICS_EXPORT_MAX_BYTES) {
    throw new DiagnosticsExportBlockedError("Support bundle destination is outside the replacement bound.");
  }
  const descriptor = openDestinationForRead(destination);
  try {
    const before = fs.fstatSync(descriptor);
    const namedBefore = fs.lstatSync(destination);
    if (!isStableNamedFile(initialIdentity, before, namedBefore) || before.size > DIAGNOSTICS_EXPORT_MAX_BYTES) {
      throw new DiagnosticsExportBlockedError("Support bundle destination changed during preparation.");
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (read <= 0) {
        throw new DiagnosticsExportBlockedError("Support bundle destination could not be read exactly.");
      }
      offset += read;
    }
    const after = fs.fstatSync(descriptor);
    const namedAfter = fs.lstatSync(destination);
    if (!sameStableGeneration(before, after) || !isStableNamedFile(after, after, namedAfter)) {
      throw new DiagnosticsExportBlockedError("Support bundle destination changed during readback.");
    }
    return {
      kind: "content_digest",
      device: after.dev,
      inode: after.ino,
      size: after.size,
      modifiedAtMs: after.mtimeMs,
      changedAtMs: after.ctimeMs,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function openDestinationForRead(destination: string): number {
  return fs.openSync(
    destination,
    fs.constants.O_RDONLY |
      (fs.constants.O_NONBLOCK ?? 0) |
      (fs.constants.O_NOFOLLOW ?? 0)
  );
}

function isStableNamedFile(initial: fs.Stats, opened: fs.Stats, named: fs.Stats): boolean {
  return opened.isFile() && named.isFile() && !named.isSymbolicLink() &&
    sameIdentity(initial, opened) && sameIdentity(opened, named) &&
    sameStableGeneration(initial, opened);
}

function sameStableGeneration(left: fs.Stats, right: fs.Stats): boolean {
  return sameIdentity(left, right) && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportBundlePreview(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    "previewId", "generatedAt", "includedCategories", "excludedCategories", "privacyWarnings"
  ])) return false;
  return typeof value.previewId === "string" && /^support_[0-9]{14}$/u.test(value.previewId) &&
    isIsoDate(value.generatedAt) &&
    matchesExactRecords(value.includedCategories, INCLUDED_CATEGORIES) &&
    matchesExactRecords(value.excludedCategories, EXCLUDED_CATEGORIES) &&
    matchesExactStrings(value.privacyWarnings, PRIVACY_WARNINGS);
}

function isSupportBundleApp(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["platform", "arch", "node", "electron"])) return false;
  return [value.platform, value.arch, value.node, value.electron].every(isSafeToken);
}

function isDiagnosticsHealth(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    "status", "checkedAt", "localOnly", "recentErrorCount", "checks"
  ])) return false;
  if ((value.status !== "ok" && value.status !== "degraded") || value.localOnly !== true ||
    !isIsoDate(value.checkedAt) || !isBoundedCount(value.recentErrorCount, 100) ||
    !Array.isArray(value.checks) || value.checks.length !== 1) return false;
  const check = value.checks[0];
  return isRecord(check) && hasExactKeys(check, ["id", "status", "message"]) &&
    check.id === "diagnostics_store" &&
    ((check.status === "ok" && check.message === "Local diagnostics store is writable.") ||
      (check.status === "error" && check.message === "Local diagnostics store is unavailable."));
}

function isRecentEvents(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 200) return false;
  return value.every((event) => {
    if (!isRecord(event)) return false;
    const keys = event.redactedDetails === undefined
      ? ["recordedAt", "level", "code", "message"]
      : ["recordedAt", "level", "code", "message", "redactedDetails"];
    return hasExactKeys(event, keys) && isIsoDate(event.recordedAt) &&
      (event.level === "info" || event.level === "warning" || event.level === "error") &&
      isSafeToken(event.code) && DIAGNOSTIC_MESSAGES.has(String(event.message)) &&
      (event.redactedDetails === undefined || isSafeDetails(event.redactedDetails));
  });
}

function isSafeDetails(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length > 32) return false;
  return Object.entries(value).every(([key, detail]) => {
    if (SAFE_STRING_DETAIL_KEYS.has(key)) return typeof detail === "string" && isSafeToken(detail);
    if (SAFE_NUMBER_DETAIL_KEYS.has(key)) return typeof detail === "number" && Number.isFinite(detail);
    if (SAFE_BOOLEAN_DETAIL_KEYS.has(key)) return typeof detail === "boolean";
    return false;
  });
}

function matchesExactRecords(value: unknown, expected: readonly Record<string, unknown>[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => {
    const expectedEntry = expected[index];
    return expectedEntry !== undefined && isRecord(entry) && hasExactKeys(entry, Object.keys(expectedEntry)) &&
      Object.entries(expectedEntry).every(([key, expectedValue]) => entry[key] === expectedValue);
  });
}

function matchesExactStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((entry, index) => entry === expected[index]);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function isSafeToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 80 &&
    /^[a-zA-Z0-9_.:\[\]-]+$/u.test(value);
}

function isBoundedCount(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}
