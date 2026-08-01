import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface CrashRecoverySummary {
  readonly status: "recovering" | "recovered" | "needs_attention";
  readonly detectedAt: string;
  readonly completedAt?: string;
  readonly capturesPreserved: number;
  readonly jobsRecovered: number;
  readonly jobsNeedRetry: number;
  readonly proposalsRecovered: number;
  readonly proposalsAwaitingReview: number;
  readonly sourcesNeedRepair: number;
  readonly indexRebuildRunning: boolean;
}

export interface CrashRecoveryObservation {
  readonly capturesPreserved?: number;
  readonly jobsRecovered?: number;
  readonly jobsNeedRetry?: number;
  readonly proposalsRecovered?: number;
  readonly proposalsAwaitingReview?: number;
  readonly sourcesNeedRepair?: number;
  readonly indexRebuildRunning?: boolean;
}

interface SessionMarker {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly startedAt: string;
}

interface StoredSummary extends CrashRecoverySummary {
  readonly schemaVersion: 1;
}

const MAX_COUNT = 1_000_000;

export class CrashRecoveryService {
  readonly #root: string;
  readonly #markerPath: string;
  readonly #summaryPath: string;
  readonly #now: () => Date;
  #summary: CrashRecoverySummary | undefined;

  constructor(userDataPath: string, now: () => Date = () => new Date()) {
    this.#root = path.join(userDataPath, "diagnostics", "crash-recovery");
    this.#markerPath = path.join(this.#root, "active-session.json");
    this.#summaryPath = path.join(this.#root, "latest-summary.json");
    this.#now = now;
  }

  beginSession(): CrashRecoverySummary | undefined {
    fs.mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    const previous = readMarker(this.#markerPath);
    const markerPresent = fs.existsSync(this.#markerPath);
    this.#summary = readSummary(this.#summaryPath);
    const startedAt = this.#nowIso();
    if (previous || markerPresent) {
      this.#summary = {
        status: "recovering",
        detectedAt: startedAt,
        capturesPreserved: 0,
        jobsRecovered: 0,
        jobsNeedRetry: 0,
        proposalsRecovered: 0,
        proposalsAwaitingReview: 0,
        sourcesNeedRepair: 0,
        indexRebuildRunning: false
      };
      this.#writeSummary();
    }
    writeJsonAtomic(this.#markerPath, {
      schemaVersion: 1,
      sessionId: `crashsession_${randomUUID().replaceAll("-", "")}`,
      startedAt
    } satisfies SessionMarker);
    return this.#summary;
  }

  observe(observation: CrashRecoveryObservation): CrashRecoverySummary | undefined {
    if (this.#summary?.status !== "recovering") return this.#summary;
    this.#summary = {
      ...this.#summary,
      capturesPreserved: add(this.#summary.capturesPreserved, observation.capturesPreserved),
      jobsRecovered: add(this.#summary.jobsRecovered, observation.jobsRecovered),
      jobsNeedRetry: add(this.#summary.jobsNeedRetry, observation.jobsNeedRetry),
      proposalsRecovered: add(this.#summary.proposalsRecovered, observation.proposalsRecovered),
      proposalsAwaitingReview: observation.proposalsAwaitingReview ?? this.#summary.proposalsAwaitingReview,
      sourcesNeedRepair: add(this.#summary.sourcesNeedRepair, observation.sourcesNeedRepair),
      indexRebuildRunning: this.#summary.indexRebuildRunning || observation.indexRebuildRunning === true
    };
    this.#writeSummary();
    return this.#summary;
  }

  complete(): CrashRecoverySummary | undefined {
    if (this.#summary?.status !== "recovering") return undefined;
    this.#summary = {
      ...this.#summary,
      status: this.#summary.jobsNeedRetry > 0 || this.#summary.sourcesNeedRepair > 0
        ? "needs_attention"
        : "recovered",
      completedAt: this.#nowIso()
    };
    this.#writeSummary();
    return this.#summary;
  }

  summary(): CrashRecoverySummary | undefined {
    return this.#summary ?? readSummary(this.#summaryPath);
  }

  markClean(): void {
    fs.rmSync(this.#markerPath, { force: true });
  }

  clearSummary(): void {
    fs.rmSync(this.#summaryPath, { force: true });
    this.#summary = undefined;
  }

  #writeSummary(): void {
    if (this.#summary) writeJsonAtomic(this.#summaryPath, { schemaVersion: 1, ...this.#summary });
  }

  #nowIso(): string {
    const value = this.#now();
    if (!Number.isFinite(value.getTime())) throw new TypeError("Crash recovery clock returned an invalid date.");
    return value.toISOString();
  }
}

function add(current: number, value: number | undefined): number {
  if (value === undefined) return current;
  if (!Number.isInteger(value) || value < 0) throw new TypeError("Crash recovery counts must be non-negative integers.");
  return Math.min(MAX_COUNT, current + value);
}

function readMarker(filePath: string): SessionMarker | undefined {
  const value = readJson(filePath);
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.sessionId !== "string" || !isDate(value.startedAt)) return undefined;
  return value as unknown as SessionMarker;
}

function readSummary(filePath: string): CrashRecoverySummary | undefined {
  const value = readJson(filePath);
  if (!isRecord(value) || value.schemaVersion !== 1 || !["recovering", "recovered", "needs_attention"].includes(String(value.status)) ||
    !isDate(value.detectedAt) || (value.completedAt !== undefined && !isDate(value.completedAt)) ||
    !validCount(value.capturesPreserved) || !validCount(value.jobsRecovered) || !validCount(value.jobsNeedRetry) ||
    !validCount(value.proposalsRecovered) || !validCount(value.proposalsAwaitingReview) ||
    !validCount(value.sourcesNeedRepair) || typeof value.indexRebuildRunning !== "boolean") return undefined;
  const { schemaVersion: _schemaVersion, ...summary } = value as unknown as StoredSummary;
  return summary;
}

function readJson(filePath: string): unknown {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) return undefined;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch { return undefined; }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  try {
    fs.renameSync(temporary, filePath);
    const directory = fs.openSync(path.dirname(filePath), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally { fs.rmSync(temporary, { force: true }); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validCount(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= MAX_COUNT; }
