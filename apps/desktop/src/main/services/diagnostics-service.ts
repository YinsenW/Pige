import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiagnosticsHealth, SupportBundleExportResult, SupportBundlePreview } from "@pige/contracts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_APP_EVENT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_EVENT_BYTES = 16 * 1024;
const DEFAULT_MAX_SEGMENT_BYTES = 1024 * 1024;
const DEFAULT_MAX_STRING_BYTES = 2 * 1024;
const MAX_DETAIL_ENTRIES = 32;
const MIN_STORAGE_BUDGET_BYTES = 512;
const NON_ERROR_RETENTION_MS = 14 * DAY_MS;
const ERROR_RETENTION_MS = 30 * DAY_MS;
const TRUNCATED_MARKER = "[TRUNCATED]";
const REDACTED_CONTENT_MARKER = "[REDACTED_CONTENT]";
const maxExportedEvents = 200;

const DIAGNOSTIC_MESSAGE_CATALOG: Readonly<Record<string, string>> = {
  "agent_ingest.background_failed": "Background Agent ingest failed.",
  "agent_ingest.requeue_failed": "Waiting Agent ingest requeue failed.",
  "app.ready": "App ready.",
  "capture.background_failed": "Background capture processing failed.",
  "database.index_rebuild.background_failed": "Background local index rebuild failed.",
  "diagnostics.exportSupportBundle": "Support bundle exported.",
  "diagnostics.previewSupportBundle": "Support bundle preview generated.",
  "jobs.interrupted_reconciled": "Interrupted background jobs reconciled.",
  "jobs.resume_failed": "Durable background job recovery failed.",
  "ocr.image.background_failed": "Background image OCR failed.",
  "parser.document.background_failed": "Background document parsing failed."
};

const SAFE_STRING_DETAIL_KEYS: Readonly<Record<string, string>> = {
  artifactid: "artifactId",
  capability: "capability",
  checksum: "checksum",
  checkpointid: "checkpointId",
  code: "code",
  correlationid: "correlationId",
  domain: "domain",
  engine: "engine",
  errorcode: "errorCode",
  errorid: "errorId",
  eventid: "eventId",
  format: "format",
  hash: "hash",
  health: "health",
  jobclass: "jobClass",
  jobid: "jobId",
  kind: "kind",
  messagekey: "messageKey",
  modelid: "modelId",
  operationid: "operationId",
  pageid: "pageId",
  parser: "parser",
  permissiondecisionid: "permissionDecisionId",
  platform: "platform",
  providerid: "providerId",
  requestid: "requestId",
  safecheckpointid: "safeCheckpointId",
  scope: "scope",
  sourceid: "sourceId",
  stage: "stage",
  state: "state",
  status: "status",
  toolid: "toolId",
  toolname: "toolName",
  type: "type",
  vaultid: "vaultId",
  version: "version",
  warningcode: "warningCode"
};

const SAFE_NUMBER_DETAIL_KEYS: Readonly<Record<string, string>> = {
  attempts: "attempts",
  bytes: "bytes",
  byteswritten: "bytesWritten",
  count: "count",
  durationms: "durationMs",
  elapsedms: "elapsedMs",
  errorcount: "errorCount",
  filecount: "fileCount",
  itemcount: "itemCount",
  maxbytes: "maxBytes",
  pagecount: "pageCount",
  redactedcontentcount: "redactedContentCount",
  redactedprivatecount: "redactedPrivateCount",
  redactedsecretcount: "redactedSecretCount",
  redactedunknowncount: "redactedUnknownCount",
  retryafterms: "retryAfterMs",
  retrycount: "retryCount",
  size: "size",
  total: "total",
  totalbytes: "totalBytes"
};

const SAFE_BOOLEAN_DETAIL_KEYS: Readonly<Record<string, string>> = {
  enabled: "enabled",
  localonly: "localOnly",
  ready: "ready",
  retryable: "retryable"
};

export interface DiagnosticEvent {
  readonly level: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly redactedDetails?: Record<string, string | number | boolean>;
}

interface DiagnosticsServiceOptions {
  readonly now?: () => Date;
  readonly maxAppEventBytes?: number;
  readonly maxEventBytes?: number;
  readonly maxSegmentBytes?: number;
  readonly maxStringBytes?: number;
}

interface PersistedDiagnosticEvent extends DiagnosticEvent {
  readonly recordedAt: string;
}

interface SerializedEvent {
  readonly event: PersistedDiagnosticEvent;
  readonly line: string;
  readonly bytes: number;
}

export class DiagnosticsService {
  readonly #diagnosticsDir: string;
  readonly #eventsPath: string;
  readonly #now: () => Date;
  readonly #maxAppEventBytes: number;
  readonly #maxEventBytes: number;
  readonly #maxSegmentBytes: number;
  readonly #maxStringBytes: number;
  #currentSegmentBytes: number | undefined;
  #nextExpiryAtMs: number | undefined;
  #storeBytes: number | undefined;

  constructor(userDataPath: string, options: DiagnosticsServiceOptions = {}) {
    this.#diagnosticsDir = path.join(userDataPath, "diagnostics");
    this.#eventsPath = path.join(this.#diagnosticsDir, "app-events.jsonl");
    this.#now = options.now ?? (() => new Date());
    this.#maxAppEventBytes = positiveInteger(
      options.maxAppEventBytes ?? DEFAULT_MAX_APP_EVENT_BYTES,
      "maxAppEventBytes"
    );
    if (this.#maxAppEventBytes < MIN_STORAGE_BUDGET_BYTES) {
      throw new RangeError(`maxAppEventBytes must be at least ${MIN_STORAGE_BUDGET_BYTES}.`);
    }
    this.#maxSegmentBytes = Math.min(
      this.#maxAppEventBytes,
      positiveInteger(
        options.maxSegmentBytes ?? Math.min(DEFAULT_MAX_SEGMENT_BYTES, this.#maxAppEventBytes),
        "maxSegmentBytes"
      )
    );
    this.#maxEventBytes = Math.min(
      this.#maxSegmentBytes,
      positiveInteger(options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES, "maxEventBytes")
    );
    this.#maxStringBytes = positiveInteger(
      options.maxStringBytes ?? DEFAULT_MAX_STRING_BYTES,
      "maxStringBytes"
    );
  }

  health(): DiagnosticsHealth {
    const checkedAt = this.#nowIso();
    const checks: Array<DiagnosticsHealth["checks"][number]> = [];
    let recentErrorCount = 0;

    try {
      fs.mkdirSync(this.#diagnosticsDir, { recursive: true, mode: 0o700 });
      fs.accessSync(this.#diagnosticsDir, fs.constants.R_OK | fs.constants.W_OK);
      checks.push({ id: "diagnostics_store", status: "ok", message: "Local diagnostics store is writable." });
      recentErrorCount = this.#maintainEventStore()
        .filter((event) => event.level === "error")
        .slice(-100)
        .length;
    } catch {
      checks.push({ id: "diagnostics_store", status: "error", message: "Local diagnostics store is unavailable." });
    }

    return {
      status: checks.some((check) => check.status === "error") ? "degraded" : "ok",
      checkedAt,
      localOnly: true,
      recentErrorCount,
      checks
    };
  }

  previewSupportBundle(): SupportBundlePreview {
    const recentEvents = this.#readRecentEvents();
    const preview = buildSupportBundlePreview(estimateBundleBytes(recentEvents), this.#nowIso());
    this.recordEvent({
      level: "info",
      code: "diagnostics.previewSupportBundle",
      message: "Support bundle preview generated."
    });
    return preview;
  }

  exportSupportBundle(outputPath: string, preview: SupportBundlePreview): SupportBundleExportResult {
    const safeOutputPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(safeOutputPath), { recursive: true });
    const bundle = {
      schemaVersion: 1,
      exportedAt: this.#nowIso(),
      localOnly: true,
      preview: {
        previewId: preview.previewId,
        generatedAt: preview.generatedAt,
        includedCategories: preview.includedCategories,
        excludedCategories: preview.excludedCategories,
        privacyWarnings: preview.privacyWarnings
      },
      app: {
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        electron: process.versions.electron ?? "unknown"
      },
      diagnosticsHealth: this.health(),
      recentEvents: this.#readRecentEvents()
    };
    const redacted = `${JSON.stringify(redactDiagnosticValue(bundle), null, 2)}\n`;
    fs.writeFileSync(safeOutputPath, redacted, "utf8");
    const bytesWritten = Buffer.byteLength(redacted);
    this.recordEvent({
      level: "info",
      code: "diagnostics.exportSupportBundle",
      message: "Support bundle exported.",
      redactedDetails: { bytesWritten }
    });
    return {
      status: "exported",
      exportedAt: bundle.exportedAt,
      outputPath: safeOutputPath,
      bytesWritten
    };
  }

  recordEvent(event: DiagnosticEvent): void {
    fs.mkdirSync(this.#diagnosticsDir, { recursive: true, mode: 0o700 });
    const record = buildPersistedEvent(event, this.#nowIso(), {
      maxEventBytes: this.#maxEventBytes,
      maxStringBytes: this.#maxStringBytes
    });
    this.#appendEvent(record);
  }

  #readRecentEvents(): unknown[] {
    return this.#maintainEventStore()
      .slice(-maxExportedEvents)
      .map((event) => redactDiagnosticValue(event));
  }

  #maintainEventStore(newEvent?: PersistedDiagnosticEvent): PersistedDiagnosticEvent[] {
    const nowMs = this.#now().getTime();
    if (!Number.isFinite(nowMs)) {
      throw new TypeError("Diagnostics clock returned an invalid date.");
    }

    const events = this.#readStoredEvents();
    if (newEvent) events.push(newEvent);
    const retained = events.filter((event) => isWithinRetention(event, nowMs));
    const serialized = retained.map(serializeEvent);
    const bounded: SerializedEvent[] = [];
    let totalBytes = 0;

    for (let index = serialized.length - 1; index >= 0; index -= 1) {
      const candidate = serialized[index];
      if (!candidate) continue;
      if (totalBytes + candidate.bytes > this.#maxAppEventBytes) break;
      bounded.push(candidate);
      totalBytes += candidate.bytes;
    }

    bounded.reverse();
    this.#rewriteEventSegments(bounded);
    this.#storeBytes = totalBytes;
    this.#currentSegmentBytes = fs.existsSync(this.#eventsPath) ? fs.statSync(this.#eventsPath).size : 0;
    this.#nextExpiryAtMs = earliestExpiry(bounded.map(({ event }) => event));
    return bounded.map(({ event }) => event);
  }

  #appendEvent(event: PersistedDiagnosticEvent): void {
    const serialized = serializeEvent(event);
    const nowMs = this.#now().getTime();
    if (!Number.isFinite(nowMs)) {
      throw new TypeError("Diagnostics clock returned an invalid date.");
    }

    if (this.#storeBytes === undefined || this.#currentSegmentBytes === undefined) {
      if (this.#listEventFilesNewestFirst().length > 0) {
        this.#maintainEventStore(event);
        return;
      }
      this.#storeBytes = 0;
      this.#currentSegmentBytes = 0;
    }

    const retentionExpired = this.#nextExpiryAtMs !== undefined && nowMs > this.#nextExpiryAtMs;
    if (retentionExpired) {
      this.#maintainEventStore(event);
      return;
    }

    if (!this.#evictOldestSegmentsFor(serialized.bytes)) {
      this.#maintainEventStore(event);
      return;
    }
    if (
      this.#currentSegmentBytes > 0 &&
      this.#currentSegmentBytes + serialized.bytes > this.#maxSegmentBytes
    ) {
      this.#rotateCurrentSegment();
    }

    fs.appendFileSync(this.#eventsPath, serialized.line, { encoding: "utf8", mode: 0o600 });
    this.#currentSegmentBytes += serialized.bytes;
    this.#storeBytes += serialized.bytes;
    this.#nextExpiryAtMs = Math.min(
      this.#nextExpiryAtMs ?? Number.POSITIVE_INFINITY,
      eventExpiryAtMs(event)
    );
  }

  #evictOldestSegmentsFor(incomingBytes: number): boolean {
    const oldestFirst = this.#listEventFilesNewestFirst().reverse();
    for (const filePath of oldestFirst) {
      if ((this.#storeBytes ?? 0) + incomingBytes <= this.#maxAppEventBytes) return true;
      if (filePath === this.#eventsPath) return false;
      const bytes = fs.statSync(filePath).size;
      fs.rmSync(filePath, { force: true });
      this.#storeBytes = Math.max(0, (this.#storeBytes ?? 0) - bytes);
    }
    return (this.#storeBytes ?? 0) + incomingBytes <= this.#maxAppEventBytes;
  }

  #rotateCurrentSegment(): void {
    const files = this.#listEventFilesNewestFirst().reverse();
    for (const filePath of files) {
      const order = eventFileOrder(filePath, this.#eventsPath);
      fs.renameSync(filePath, `${this.#eventsPath}.${order + 1}`);
    }
    this.#currentSegmentBytes = 0;
  }

  #readStoredEvents(): PersistedDiagnosticEvent[] {
    const files = this.#listEventFilesNewestFirst();
    if (files.length === 0) return [];

    const selected: Array<{ filePath: string; readBytes: number }> = [];
    let remainingBytes = this.#maxAppEventBytes;
    for (const filePath of files) {
      if (remainingBytes <= 0) break;
      const size = fs.statSync(filePath).size;
      const readBytes = Math.min(size, remainingBytes);
      selected.push({ filePath, readBytes });
      remainingBytes -= readBytes;
    }

    const events: PersistedDiagnosticEvent[] = [];
    for (const { filePath, readBytes } of selected.reverse()) {
      const text = readFileTail(filePath, readBytes);
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as unknown;
          const event = normalizeStoredEvent(parsed, {
            maxEventBytes: this.#maxEventBytes,
            maxStringBytes: this.#maxStringBytes
          });
          if (event) events.push(event);
        } catch {
          // Corrupt or oversized legacy lines are not useful diagnostic evidence.
        }
      }
    }
    return events;
  }

  #rewriteEventSegments(events: readonly SerializedEvent[]): void {
    const existing = this.#listEventFilesNewestFirst();
    if (events.length === 0) {
      for (const filePath of existing) fs.rmSync(filePath, { force: true });
      return;
    }

    const chronologicalSegments: string[][] = [[]];
    let segmentBytes = 0;
    for (const event of events) {
      if (segmentBytes > 0 && segmentBytes + event.bytes > this.#maxSegmentBytes) {
        chronologicalSegments.push([]);
        segmentBytes = 0;
      }
      chronologicalSegments.at(-1)?.push(event.line);
      segmentBytes += event.bytes;
    }

    const desired = new Set<string>();
    for (let index = 0; index < chronologicalSegments.length; index += 1) {
      const segment = chronologicalSegments[chronologicalSegments.length - 1 - index];
      if (!segment) continue;
      const filePath = index === 0 ? this.#eventsPath : `${this.#eventsPath}.${index}`;
      desired.add(filePath);
      writeFileAtomic(filePath, segment.join(""));
    }
    for (const filePath of existing) {
      if (!desired.has(filePath)) fs.rmSync(filePath, { force: true });
    }
  }

  #listEventFilesNewestFirst(): string[] {
    if (!fs.existsSync(this.#diagnosticsDir)) return [];
    const baseName = path.basename(this.#eventsPath);
    return fs
      .readdirSync(this.#diagnosticsDir)
      .flatMap((name) => {
        if (name === baseName) return [{ order: 0, filePath: path.join(this.#diagnosticsDir, name) }];
        const match = name.match(new RegExp(`^${escapeRegExp(baseName)}\\.(\\d+)$`));
        if (!match) return [];
        return [{ order: Number(match[1]), filePath: path.join(this.#diagnosticsDir, name) }];
      })
      .filter(({ order }) => Number.isSafeInteger(order) && order >= 0)
      .sort((left, right) => left.order - right.order)
      .map(({ filePath }) => filePath);
  }

  #nowIso(): string {
    const now = this.#now();
    if (!Number.isFinite(now.getTime())) {
      throw new TypeError("Diagnostics clock returned an invalid date.");
    }
    return now.toISOString();
  }
}

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

function buildSupportBundlePreview(estimatedBytes: number, generatedAt: string): SupportBundlePreview {
  return {
    previewId: `support_${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`,
    generatedAt,
    localOnly: true,
    estimatedBytes,
    includedCategories: [
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
    ],
    excludedCategories: [
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
    ],
    privacyWarnings: [
      "The bundle is created locally and is not uploaded automatically.",
      "Paths, emails, and common secret patterns are redacted by default.",
      "Review the preview before exporting."
    ]
  };
}

function estimateBundleBytes(recentEvents: unknown[]): number {
  return Buffer.byteLength(JSON.stringify({ recentEvents }, null, 2)) + 4096;
}

function buildPersistedEvent(
  event: DiagnosticEvent,
  recordedAt: string,
  limits: { maxEventBytes: number; maxStringBytes: number }
): PersistedDiagnosticEvent {
  const redactedDetails = sanitizeDetails(event.redactedDetails, limits.maxStringBytes);
  const code = sanitizeToken(sanitizeStoredString(event.code, 80));
  let record: PersistedDiagnosticEvent = {
    recordedAt,
    level: normalizeLevel(event.level),
    code,
    message: resolveDiagnosticMessage(event.code, code, limits.maxStringBytes),
    ...(redactedDetails ? { redactedDetails } : {})
  };

  if (serializeEvent(record).bytes <= limits.maxEventBytes) return record;
  record = {
    ...record,
    redactedDetails: { truncated: TRUNCATED_MARKER }
  };
  if (serializeEvent(record).bytes <= limits.maxEventBytes) return record;
  record = {
    recordedAt,
    level: record.level,
    code: record.code,
    message: TRUNCATED_MARKER
  };
  if (serializeEvent(record).bytes > limits.maxEventBytes) {
    throw new RangeError("maxEventBytes is too small for a bounded diagnostic record.");
  }
  return record;
}

function normalizeStoredEvent(
  value: unknown,
  limits: { maxEventBytes: number; maxStringBytes: number }
): PersistedDiagnosticEvent | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.recordedAt !== "string" || !Number.isFinite(Date.parse(value.recordedAt))) return undefined;
  if (!isDiagnosticLevel(value.level) || typeof value.code !== "string" || typeof value.message !== "string") {
    return undefined;
  }
  return buildPersistedEvent(
    {
      level: value.level,
      code: value.code,
      message: value.message,
      ...(isRecord(value.redactedDetails)
        ? { redactedDetails: value.redactedDetails as Record<string, string | number | boolean> }
        : {})
    },
    new Date(value.recordedAt).toISOString(),
    limits
  );
}

function sanitizeDetails(
  details: Record<string, string | number | boolean> | undefined,
  maxStringBytes: number
): Record<string, string | number | boolean> | undefined {
  if (!isRecord(details)) return undefined;
  const safe: Record<string, string | number | boolean> = {};
  let inspectedEntries = 0;
  let redactedContentCount = 0;
  let redactedPrivateCount = 0;
  let redactedSecretCount = 0;
  let redactedUnknownCount = 0;
  for (const rawKey in details) {
    if (inspectedEntries >= MAX_DETAIL_ENTRIES) break;
    if (!Object.hasOwn(details, rawKey)) continue;
    inspectedEntries += 1;
    const rawValue = details[rawKey];
    const normalizedKey = normalizeDetailKey(rawKey);
    const safeStringKey = SAFE_STRING_DETAIL_KEYS[normalizedKey];
    const safeNumberKey = SAFE_NUMBER_DETAIL_KEYS[normalizedKey];
    const safeBooleanKey = SAFE_BOOLEAN_DETAIL_KEYS[normalizedKey];

    if (safeStringKey && typeof rawValue === "string") {
      if (!Object.hasOwn(safe, safeStringKey)) {
        safe[safeStringKey] = sanitizeSafeDetailToken(rawValue, maxStringBytes);
      }
      continue;
    }
    if (safeNumberKey && typeof rawValue === "number" && Number.isFinite(rawValue)) {
      if (!Object.hasOwn(safe, safeNumberKey)) safe[safeNumberKey] = rawValue;
      continue;
    }
    if (safeBooleanKey && typeof rawValue === "boolean") {
      if (!Object.hasOwn(safe, safeBooleanKey)) safe[safeBooleanKey] = rawValue;
      continue;
    }

    if (isSecretDetailKey(normalizedKey)) {
      redactedSecretCount += 1;
    } else if (isContentDetailKey(normalizedKey)) {
      redactedContentCount += 1;
    } else if (isPrivateDetailKey(normalizedKey)) {
      redactedPrivateCount += 1;
    } else {
      redactedUnknownCount += 1;
    }
  }

  if (redactedSecretCount > 0) safe.redactedSecretCount = redactedSecretCount;
  if (redactedContentCount > 0) safe.redactedContentCount = redactedContentCount;
  if (redactedPrivateCount > 0) safe.redactedPrivateCount = redactedPrivateCount;
  if (redactedUnknownCount > 0) safe.redactedUnknownCount = redactedUnknownCount;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function sanitizeStoredString(input: string, maxBytes: number): string {
  if (Buffer.byteLength(input) > maxBytes) return TRUNCATED_MARKER;
  const redacted = redactPaths(redactDiagnosticText(input));
  return Buffer.byteLength(redacted) <= maxBytes ? redacted : TRUNCATED_MARKER;
}

function resolveDiagnosticMessage(rawCode: string, persistedCode: string, maxBytes: number): string {
  const fixedSummary = rawCode === persistedCode ? DIAGNOSTIC_MESSAGE_CATALOG[persistedCode] : undefined;
  return sanitizeStoredString(fixedSummary ?? REDACTED_CONTENT_MARKER, maxBytes);
}

function sanitizeSafeDetailToken(input: string, maxBytes: number): string {
  const redacted = sanitizeStoredString(input, maxBytes);
  if (redacted !== input) return REDACTED_CONTENT_MARKER;
  const token = sanitizeToken(input);
  return token.length > 0 && token === input ? token : REDACTED_CONTENT_MARKER;
}

function normalizeDetailKey(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isSecretDetailKey(normalized: string): boolean {
  return [
    "apikey",
    "authorization",
    "cookie",
    "credential",
    "password",
    "privatekey",
    "secret",
    "session",
    "signingkey",
    "token"
  ].some((part) => normalized.includes(part));
}

function isContentDetailKey(normalized: string): boolean {
  return [
    "body",
    "content",
    "conversation",
    "excerpt",
    "memory",
    "message",
    "note",
    "output",
    "payload",
    "prompt",
    "query",
    "response",
    "source",
    "stderr",
    "stdout",
    "text",
    "toolresult",
    "transcript"
  ].some((part) => normalized.includes(part));
}

function isPrivateDetailKey(normalized: string): boolean {
  return ["address", "email", "filename", "filepath", "path", "username"].some((part) =>
    normalized.includes(part)
  );
}

function isWithinRetention(event: PersistedDiagnosticEvent, nowMs: number): boolean {
  const recordedAtMs = Date.parse(event.recordedAt);
  if (!Number.isFinite(recordedAtMs)) return false;
  const ageMs = nowMs - recordedAtMs;
  if (ageMs < 0) return true;
  return ageMs <= (event.level === "error" ? ERROR_RETENTION_MS : NON_ERROR_RETENTION_MS);
}

function eventExpiryAtMs(event: PersistedDiagnosticEvent): number {
  return Date.parse(event.recordedAt) +
    (event.level === "error" ? ERROR_RETENTION_MS : NON_ERROR_RETENTION_MS);
}

function earliestExpiry(events: readonly PersistedDiagnosticEvent[]): number | undefined {
  let earliest: number | undefined;
  for (const event of events) {
    const expiry = eventExpiryAtMs(event);
    if (!Number.isFinite(expiry)) continue;
    earliest = Math.min(earliest ?? Number.POSITIVE_INFINITY, expiry);
  }
  return earliest;
}

function serializeEvent(event: PersistedDiagnosticEvent): SerializedEvent {
  const line = `${JSON.stringify(event)}\n`;
  return { event, line, bytes: Buffer.byteLength(line) };
}

function readFileTail(filePath: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const size = fs.statSync(filePath).size;
  const readBytes = Math.min(size, maxBytes);
  const start = size - readBytes;
  const buffer = Buffer.allocUnsafe(readBytes);
  const file = fs.openSync(filePath, "r");
  try {
    fs.readSync(file, buffer, 0, readBytes, start);
  } finally {
    fs.closeSync(file);
  }
  let text = buffer.toString("utf8");
  if (start > 0) {
    const firstNewline = text.indexOf("\n");
    text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
  }
  return text;
}

function eventFileOrder(filePath: string, eventsPath: string): number {
  if (filePath === eventsPath) return 0;
  const suffix = filePath.slice(`${eventsPath}.`.length);
  const order = Number(suffix);
  if (!Number.isSafeInteger(order) || order < 1) {
    throw new Error("Diagnostics segment has an invalid rotation suffix.");
  }
  return order;
}

function writeFileAtomic(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, filePath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(tempPath, { force: true });
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function normalizeLevel(value: DiagnosticEvent["level"]): DiagnosticEvent["level"] {
  return isDiagnosticLevel(value) ? value : "warning";
}

function isDiagnosticLevel(value: unknown): value is DiagnosticEvent["level"] {
  return value === "info" || value === "warning" || value === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeToken(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeStoredString(value, DEFAULT_MAX_STRING_BYTES);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactDiagnosticValue(entry)])
    );
  }
  return value;
}
