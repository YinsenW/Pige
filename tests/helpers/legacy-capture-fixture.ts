import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  CaptureFilesSubmitResult,
  CaptureUserIntent,
  Locale,
  SubmitFilesCaptureRequest
} from "@pige/contracts";
import {
  ConversationEventSchema,
  JobRecordSchema,
  SourceRecordSchema,
  type SourceKind
} from "@pige/schemas";
import {
  CaptureService,
  type CaptureVaultPort,
  type SourceFetchPort
} from "../../apps/desktop/src/main/services/capture-service";
import { redactSensitiveUrl } from "../../apps/desktop/src/main/services/source-fetch-service";

interface LegacyCaptureSubmitResult {
  readonly status: "queued";
  readonly captureId: string;
  readonly sourceId: string;
  readonly jobId: string;
  readonly conversationEventId: string;
  readonly preservedAt: string;
}

interface LegacyTextCaptureRequest {
  readonly text: string;
  readonly inputKind: "typed_text";
  readonly userIntent: CaptureUserIntent;
  readonly locale: Locale;
}

interface LegacyUrlCaptureRequest {
  readonly url: string;
  readonly inputKind: "pasted_url";
  readonly userIntent: CaptureUserIntent;
  readonly locale: Locale;
}

export class LegacyCaptureFixture {
  readonly #vaults: CaptureVaultPort;
  readonly #vaultPath: string;
  readonly #current: CaptureService;

  constructor(vaults: CaptureVaultPort, vaultPath: string, sourceFetch?: SourceFetchPort) {
    this.#vaults = vaults;
    this.#vaultPath = vaultPath;
    this.#current = new CaptureService(vaults, sourceFetch);
  }

  submitText(request: LegacyTextCaptureRequest): LegacyCaptureSubmitResult {
    if (!request.text.trim()) throw new Error("Legacy text fixture requires content.");
    const identities = createLegacyIdentities();
    const bytes = Buffer.from(request.text, "utf8");
    const managedPath = path.join("raw", "text", identities.year, identities.month, `${identities.sourceId}.txt`);
    writeFile(this.#vaultPath, managedPath, request.text);
    writeJson(this.#vaultPath, sourceRecordPath(identities), SourceRecordSchema.parse({
      id: identities.sourceId,
      kind: "text",
      storageStrategy: "copy_to_source_library",
      managedCopy: {
        path: managedPath.split(path.sep).join("/"),
        checksum: checksum(bytes),
        size: bytes.byteLength
      },
      artifacts: [],
      metadata: {
        inputKind: request.inputKind,
        userIntent: request.userIntent,
        locale: request.locale,
        captureId: identities.captureId
      },
      createdAt: identities.timestamp,
      updatedAt: identities.timestamp
    }));
    this.#writeEnvelope(identities, "text");
    return toSubmitResult(identities);
  }

  async submitUrl(request: LegacyUrlCaptureRequest): Promise<LegacyCaptureSubmitResult> {
    const identities = createLegacyIdentities();
    const safeInputUrl = redactSensitiveUrl(request.url);
    await this.#current.preserveUrlForAgentTurn(request, {
      jobId: identities.jobId,
      sourceId: identities.sourceId,
      inputHash: checksum(Buffer.from(safeInputUrl, "utf8"))
    });
    this.#makeSourceLegacy(identities.sourceId, identities.captureId);
    this.#writeEnvelope(identities, "url");
    return toSubmitResult(identities);
  }

  async submitFiles(request: SubmitFilesCaptureRequest): Promise<CaptureFilesSubmitResult> {
    const accepted: LegacyIdentities[] = [];
    const rejectedFiles: CaptureFilesSubmitResult["rejectedFiles"] = [];
    for (const filePath of request.filePaths) {
      const identities = createLegacyIdentities();
      const result = await this.#current.preserveFilesForAgentTurn(
        { ...request, filePaths: [filePath] },
        { jobId: identities.jobId, sourceId: identities.sourceId }
      );
      rejectedFiles.push(...result.rejectedFiles);
      if (result.sourceIds.length === 0) continue;
      this.#makeSourceLegacy(identities.sourceId, identities.captureId);
      const source = readSource(this.#vaultPath, identities.sourceId);
      this.#writeEnvelope(identities, source.kind, source.original?.displayName);
      accepted.push(identities);
    }
    const first = accepted[0] ?? createLegacyIdentities();
    return {
      status: accepted.length === 0 ? "rejected" : rejectedFiles.length > 0 ? "partially_queued" : "queued",
      captureId: first.captureId,
      sourceIds: accepted.map((item) => item.sourceId),
      jobIds: accepted.map((item) => item.jobId),
      conversationEventIds: accepted.map((item) => item.eventId),
      rejectedFiles,
      preservedAt: first.timestamp
    };
  }

  #makeSourceLegacy(sourceId: string, captureId: string): void {
    const sourcePath = findRecord(this.#vaultPath, ".pige/source-records", `${sourceId}.json`);
    const source = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as Record<string, unknown> & {
      metadata: Record<string, unknown>;
    };
    delete source.semanticOrchestration;
    delete source.metadata.agentTurnJobId;
    delete source.metadata.agentTurnInputHash;
    source.metadata.captureId = captureId;
    fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  }

  #writeEnvelope(identities: LegacyIdentities, sourceKind: SourceKind, displayName?: string): void {
    const event = ConversationEventSchema.parse({
      id: identities.eventId,
      conversationId: identities.conversationId,
      type: "capture_reference",
      createdAt: identities.timestamp,
      sourceId: identities.sourceId,
      captureId: identities.captureId,
      ...(displayName ? { displayName } : {}),
      sourceKind
    });
    const conversationPath = path.join(
      ".pige",
      "conversations",
      identities.year,
      identities.month,
      `${identities.conversationId}.jsonl`
    );
    appendLine(this.#vaultPath, conversationPath, event);
    writeJson(this.#vaultPath, jobRecordPath(identities), JobRecordSchema.parse({
      id: identities.jobId,
      class: "capture",
      state: "queued",
      createdAt: identities.timestamp,
      updatedAt: identities.timestamp,
      sourceId: identities.sourceId,
      captureId: identities.captureId,
      conversationEventId: identities.eventId,
      message: "Historical capture fixture queued for compatibility processing."
    }));
  }
}

interface LegacyIdentities {
  readonly timestamp: string;
  readonly year: string;
  readonly month: string;
  readonly captureId: string;
  readonly sourceId: string;
  readonly jobId: string;
  readonly eventId: string;
  readonly conversationId: string;
}

function createLegacyIdentities(): LegacyIdentities {
  const timestamp = new Date().toISOString();
  const dateKey = timestamp.slice(0, 10).replaceAll("-", "");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  return {
    timestamp,
    year: dateKey.slice(0, 4),
    month: dateKey.slice(4, 6),
    captureId: `cap_${dateKey}_${suffix}`,
    sourceId: `src_${dateKey}_${suffix}`,
    jobId: `job_${dateKey}_${suffix}`,
    eventId: `evt_${dateKey}_${suffix}`,
    conversationId: `conv_${dateKey}_${suffix}`
  };
}

function toSubmitResult(identities: LegacyIdentities): LegacyCaptureSubmitResult {
  return {
    status: "queued",
    captureId: identities.captureId,
    sourceId: identities.sourceId,
    jobId: identities.jobId,
    conversationEventId: identities.eventId,
    preservedAt: identities.timestamp
  };
}

function sourceRecordPath(identities: LegacyIdentities): string {
  return path.join(".pige", "source-records", identities.year, identities.month, `${identities.sourceId}.json`);
}

function jobRecordPath(identities: LegacyIdentities): string {
  return path.join(".pige", "jobs", identities.year, identities.month, `${identities.jobId}.json`);
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeFile(vaultPath: string, relativePath: string, body: string): void {
  const target = path.join(vaultPath, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
}

function writeJson(vaultPath: string, relativePath: string, value: unknown): void {
  writeFile(vaultPath, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function appendLine(vaultPath: string, relativePath: string, value: unknown): void {
  const target = path.join(vaultPath, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(value)}\n`, "utf8");
}

function findRecord(vaultPath: string, relativeRoot: string, name: string): string {
  const pending = [path.join(vaultPath, ...relativeRoot.split("/"))];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory || !fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name === name) return candidate;
    }
  }
  throw new Error(`Missing legacy fixture record ${name}.`);
}

function readSource(vaultPath: string, sourceId: string): ReturnType<typeof SourceRecordSchema.parse> {
  return SourceRecordSchema.parse(JSON.parse(fs.readFileSync(
    findRecord(vaultPath, ".pige/source-records", `${sourceId}.json`),
    "utf8"
  )));
}
