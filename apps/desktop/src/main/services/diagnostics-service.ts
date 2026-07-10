import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiagnosticsHealth, SupportBundleExportResult, SupportBundlePreview } from "@pige/contracts";

const maxLogBytes = 25 * 1024 * 1024;
const maxExportedEvents = 200;

export interface DiagnosticEvent {
  readonly level: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly redactedDetails?: Record<string, string | number | boolean>;
}

export class DiagnosticsService {
  readonly #diagnosticsDir: string;
  readonly #eventsPath: string;

  constructor(userDataPath: string) {
    this.#diagnosticsDir = path.join(userDataPath, "diagnostics");
    this.#eventsPath = path.join(this.#diagnosticsDir, "app-events.jsonl");
  }

  health(): DiagnosticsHealth {
    const checkedAt = new Date().toISOString();
    const checks: Array<DiagnosticsHealth["checks"][number]> = [];
    let recentErrorCount = 0;

    try {
      fs.mkdirSync(this.#diagnosticsDir, { recursive: true });
      fs.accessSync(this.#diagnosticsDir, fs.constants.R_OK | fs.constants.W_OK);
      checks.push({ id: "diagnostics_store", status: "ok", message: "Local diagnostics store is writable." });
      recentErrorCount = this.#countRecentErrors();
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
    const preview = buildSupportBundlePreview(estimateBundleBytes(recentEvents));
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
      exportedAt: new Date().toISOString(),
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
    fs.mkdirSync(this.#diagnosticsDir, { recursive: true });
    this.#rotateIfNeeded();
    const record = {
      recordedAt: new Date().toISOString(),
      level: event.level,
      code: sanitizeToken(event.code),
      message: redactDiagnosticText(event.message),
      redactedDetails: event.redactedDetails
    };
    fs.appendFileSync(this.#eventsPath, `${JSON.stringify(record)}\n`, "utf8");
  }

  #countRecentErrors(): number {
    if (!fs.existsSync(this.#eventsPath)) return 0;
    const text = fs.readFileSync(this.#eventsPath, "utf8");
    return text
      .split("\n")
      .filter((line) => line.includes('"level":"error"'))
      .slice(-100)
      .length;
  }

  #readRecentEvents(): unknown[] {
    if (!fs.existsSync(this.#eventsPath)) return [];
    return fs
      .readFileSync(this.#eventsPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-maxExportedEvents)
      .map((line) => {
        try {
          return redactDiagnosticValue(JSON.parse(line) as unknown);
        } catch {
          return { level: "warning", code: "diagnostics.unreadable_event", message: "A diagnostic event was unreadable." };
        }
      });
  }

  #rotateIfNeeded(): void {
    if (!fs.existsSync(this.#eventsPath)) return;
    const stat = fs.statSync(this.#eventsPath);
    if (stat.size <= maxLogBytes) return;
    fs.renameSync(this.#eventsPath, `${this.#eventsPath}.1`);
  }
}

export function redactDiagnosticText(input: string): string {
  return input
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_SECRET]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(Authorization|Cookie):\s*[^\n\r]+/gi, "$1: [REDACTED_SECRET]")
    .replace(/(api[_-]?key|token|secret)=([^&\s]+)/gi, "$1=[REDACTED_SECRET]");
}

export function redactPaths(input: string): string {
  const home = os.homedir();
  const escapedHome = escapeRegExp(home);
  const homeRedacted = input
    .replace(new RegExp(escapedHome, "g"), "<home>")
    .replace(/\/Users\/[^/\n\r"]+/g, "<home>");
  return homeRedacted.replace(/[A-Z]:\\Users\\[^"\n\r]+/gi, (match) => {
    const parts = match.split("\\");
    return ["<home>", ...parts.slice(3)].join("\\");
  });
}

function buildSupportBundlePreview(estimatedBytes: number): SupportBundlePreview {
  const generatedAt = new Date().toISOString();
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

function sanitizeToken(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactDiagnosticText(redactPaths(value));
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
