import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SettingsProfileDocumentSchema,
  SettingsProfileExportResultSchema,
  SettingsProfileImportApplyResultSchema,
  SettingsProfileImportPreviewResultSchema,
  type Locale,
  type SettingsProfileExportRequest,
  type SettingsProfileExportResult,
  type SettingsProfileImportApplyRequest,
  type SettingsProfileImportApplyResult,
  type SettingsProfileImportPreviewRequest,
  type SettingsProfileImportPreviewResult,
  type SettingsProfilePreferences,
  type SettingsProfileTransferKey
} from "@pige/schemas";
import { LocalSettingsStore, digestSettingsProfilePreferences } from "./local-settings";

const MAX_PROFILE_BYTES = 64 * 1024;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const TRANSFER_KEYS = [
  "app_locale",
  "appearance",
  "startup_destination",
  "update_channel",
  "ocr_engine",
  "ocr_language",
  "dictation_language"
] as const satisfies readonly SettingsProfileTransferKey[];

interface PendingPreview {
  readonly preferences: SettingsProfilePreferences;
  readonly expectedDigest: string;
  readonly expiresAt: number;
}

export class SettingsProfileTransferService {
  readonly #settings: LocalSettingsStore;
  readonly #fallbackLocale: Locale;
  readonly #onApplied: () => void;
  readonly #previews = new Map<string, PendingPreview>();

  constructor(input: {
    readonly settings: LocalSettingsStore;
    readonly fallbackLocale: Locale;
    readonly onApplied: () => void;
  }) {
    this.#settings = input.settings;
    this.#fallbackLocale = input.fallbackLocale;
    this.#onApplied = input.onApplied;
  }

  export(request: SettingsProfileExportRequest, destinationPath: string): SettingsProfileExportResult {
    try {
      const preferences = this.#settings.getSettingsProfilePreferences(this.#fallbackLocale);
      const body = `${JSON.stringify({
        schemaVersion: 1,
        kind: "pige_preferences",
        preferences
      }, null, 2)}\n`;
      writePrivateAtomic(destinationPath, body);
      return SettingsProfileExportResultSchema.parse({
        ...request,
        status: "exported",
        keys: TRANSFER_KEYS
      });
    } catch {
      return SettingsProfileExportResultSchema.parse({ ...request, status: "failed" });
    }
  }

  preview(
    request: SettingsProfileImportPreviewRequest,
    sourcePath: string
  ): SettingsProfileImportPreviewResult {
    try {
      this.#prune();
      const document = SettingsProfileDocumentSchema.parse(JSON.parse(readBoundedNoFollow(sourcePath)));
      const previewId = `settingspreview_${randomBytes(16).toString("hex")}`;
      const current = this.#settings.getSettingsProfilePreferences(this.#fallbackLocale);
      this.#previews.set(previewId, {
        preferences: document.preferences,
        expectedDigest: digestSettingsProfilePreferences(current),
        expiresAt: Date.now() + PREVIEW_TTL_MS
      });
      return SettingsProfileImportPreviewResultSchema.parse({
        ...request,
        status: "ready",
        previewId,
        keys: TRANSFER_KEYS
      });
    } catch {
      return SettingsProfileImportPreviewResultSchema.parse({ ...request, status: "failed" });
    }
  }

  hasCurrentPreview(previewId: string): boolean {
    this.#prune();
    return this.#previews.has(previewId);
  }

  apply(request: SettingsProfileImportApplyRequest): SettingsProfileImportApplyResult {
    try {
      this.#prune();
      const preview = this.#previews.get(request.previewId);
      if (!preview) {
        return SettingsProfileImportApplyResultSchema.parse({ ...request, status: "not_found" });
      }
      const result = this.#settings.applySettingsProfilePreferences(
        preview.expectedDigest,
        this.#fallbackLocale,
        preview.preferences
      );
      if (result.status === "stale") {
        this.#previews.delete(request.previewId);
        return SettingsProfileImportApplyResultSchema.parse({ ...request, status: "stale" });
      }
      this.#previews.delete(request.previewId);
      this.#onApplied();
      return SettingsProfileImportApplyResultSchema.parse({
        ...request,
        status: "committed",
        keys: TRANSFER_KEYS
      });
    } catch {
      return SettingsProfileImportApplyResultSchema.parse({ ...request, status: "failed" });
    }
  }

  #prune(): void {
    const now = Date.now();
    for (const [previewId, preview] of this.#previews) {
      if (preview.expiresAt <= now) this.#previews.delete(previewId);
    }
  }
}

function readBoundedNoFollow(filePath: string): string {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_PROFILE_BYTES) throw new Error("Invalid preferences profile.");
    const body = Buffer.alloc(stat.size);
    const bytesRead = fs.readSync(descriptor, body, 0, stat.size, 0);
    if (bytesRead !== stat.size) throw new Error("Preferences profile changed while reading.");
    return body.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function writePrivateAtomic(filePath: string, body: string): void {
  const destination = path.resolve(filePath);
  const parent = path.dirname(destination);
  const parentReal = fs.realpathSync.native(parent);
  if (parentReal !== parent) throw new Error("Export parent must not traverse links.");
  const before = fs.statSync(parentReal);
  const existing = safeLstat(destination);
  if (existing?.isSymbolicLink()) throw new Error("Export target must not be a symbolic link.");
  const temporary = path.join(parentReal, `.${path.basename(destination)}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600
    );
    fs.writeFileSync(descriptor, body, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const after = fs.statSync(parentReal);
    if (before.dev !== after.dev || before.ino !== after.ino) throw new Error("Export parent changed.");
    fs.renameSync(temporary, destination);
    const parentDescriptor = fs.openSync(parentReal, fs.constants.O_RDONLY);
    try { fs.fsyncSync(parentDescriptor); } finally { fs.closeSync(parentDescriptor); }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* already committed or never created */ }
  }
}

function safeLstat(filePath: string): fs.Stats | undefined {
  try { return fs.lstatSync(filePath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
