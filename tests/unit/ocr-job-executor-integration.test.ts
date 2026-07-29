import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, SourceRecordSchema, type JobRecord } from "@pige/schemas";
import { JobsService, type JobsVaultPort } from "../../apps/desktop/src/main/services/jobs-service";
import { OcrArtifactService } from "../../apps/desktop/src/main/services/ocr-artifact-service";
import { OcrService, type NativeImageOcrAdapterPort, type OcrPort } from "../../apps/desktop/src/main/services/ocr-service";
import {
  OcrLanguagePreferenceService,
  type OcrLanguagePreferenceState,
  type OcrLanguagePreferenceStorePort
} from "../../apps/desktop/src/main/services/ocr-language-preference-service";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("OCR executor integration", () => {
  it("uses the durable Job language binding instead of rereading changed settings", async () => {
    const fixture = makeVault("OcrLanguageBinding");
    const captured = await preserveImage(fixture, "bound-language.png");
    const sourcePath = requireValue(findFiles(
      path.join(fixture.vaultPath, ".pige", "source-records"),
      `${captured.sourceId}.json`
    )[0]);
    const source = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(sourcePath, "utf8")));
    const store = new OcrPreferenceStore({ revision: 1, preference: "ko" });
    const preferences = new OcrLanguagePreferenceService(store);
    const queuedPath = jobPath(fixture.vaultPath, captured.ocrJobId);
    const queued = readJob(queuedPath);
    writeJob(queuedPath, JobRecordSchema.parse({
      ...queued,
      inputRefs: preferences.mergeJobRef(queued.inputRefs, source)
    }));
    store.state = { revision: 2, preference: "fr" };
    const adapter = new StaticOcrAdapter();
    const jobs = new JobsService(fixture.vaultPort, undefined, undefined, undefined, new OcrService(adapter));

    expect(await jobs.ocrExecutor().process({ jobIds: [captured.ocrJobId] }))
      .toMatchObject({ processed: 1, completed: 1, failed: 0 });
    expect(adapter.preferredLanguages).toEqual([["ko-KR"]]);
  });

  it("persists Paddle identity and rejects mismatched or unknown OCR identities", async () => {
    const fixture = makeVault("PaddleIdentity");
    const captured = await preserveImage(fixture, "paddle.png");
    const sourceRecordPath = requireValue(findFiles(
      path.join(fixture.vaultPath, ".pige", "source-records"),
      `${captured.sourceId}.json`
    )[0]);
    const sourceRecord = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")));
    const job = readJob(jobPath(fixture.vaultPath, captured.ocrJobId));
    const paddle = ocrResult("paddle");
    const invalidResults = [
      { ...paddle, engine: "macos_vision_document" },
      { ...paddle, adapterId: "unknown_ocr" }
    ] as unknown as readonly NativeOcrResult[];
    for (const invalid of invalidResults) {
      await expect(new OcrArtifactService().persist(
        fixture.vaultPath,
        sourceRecord,
        sourceRecordPath,
        job,
        invalid
      )).rejects.toMatchObject({ code: "ocr.invalid_result" });
    }

    const jobs = new JobsService(
      fixture.vaultPort,
      undefined,
      undefined,
      undefined,
      new OcrService(new StaticOcrAdapter(paddle))
    );
    expect(await jobs.ocrExecutor().process({ jobIds: [captured.ocrJobId] }))
      .toMatchObject({ processed: 1, completed: 1, failed: 0 });
    const finalRecord = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")));
    const metadataArtifact = requireValue(finalRecord.artifacts.find((artifact) => artifact.id.endsWith("_ocr_metadata")));
    const sidecar = JSON.parse(fs.readFileSync(path.join(fixture.vaultPath, metadataArtifact.path), "utf8")) as Record<string, unknown>;

    expect(finalRecord.metadata).toMatchObject({
      ocrAdapterId: "paddleocr_local",
      ocrAdapterVersion: "1.0.0",
      ocrEngine: "Paddle",
      ocrEngineVersion: "3.2.0"
    });
    expect(sidecar).toMatchObject({
      adapter: { id: "paddleocr_local", version: "1.0.0" },
      engine: { id: "Paddle", version: "3.2.0" }
    });
  });

  it("adopts one durable OCR effect into the same Job after settlement CAS contention", async () => {
    const fixture = makeVault("OcrAdoption");
    const captured = await preserveImage(fixture, "adoption.png");
    const ocr = new OcrService(new StaticOcrAdapter());
    let ocrCalls = 0;
    const contendingOcr: OcrPort = {
      canOcr: (kind) => ocr.canOcr(kind),
      inspectSource: (source) => ocr.inspectSource(source),
      ocrSource: async (...args) => {
        ocrCalls += 1;
        const result = await ocr.ocrSource(...args);
        const job = args[3];
        const filePath = jobPath(fixture.vaultPath, job.id);
        const current = readJob(filePath);
        writeJob(filePath, JobRecordSchema.parse({
          ...current,
          state: "failed_retryable",
          updatedAt: "2026-07-26T04:02:00.000Z",
          finishedAt: "2026-07-26T04:02:00.000Z",
          retry: {
            retryCount: current.retry?.retryCount ?? 0,
            maxAutomaticRetries: 0,
            requiresUserAction: true,
            lastRetryReason: "synthetic_settlement_contention"
          },
          message: "Synthetic settlement winner retained the durable OCR effect."
        }));
        return result;
      }
    };
    const jobs = new JobsService(fixture.vaultPort, undefined, undefined, undefined, contendingOcr);

    expect(await jobs.ocrExecutor().process({ jobIds: [captured.ocrJobId] })).toMatchObject({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const completed = readJob(jobPath(fixture.vaultPath, captured.ocrJobId));
    expect(completed).toMatchObject({
      id: captured.ocrJobId,
      state: "completed",
      retry: { retryCount: 1, lastRetryReason: "ocr_durable_output_adoption" },
      cancellation: { safeCheckpointId: "ocr_artifacts_committed", durableWritesApplied: true },
      progress: { completedUnits: 1, totalUnits: 1, unit: "image" }
    });
    expect(completed.outputRefs?.map((ref) => ref.kind)).toEqual(["artifact", "artifact"]);
    expect(completed.outputRefs?.every((ref) => ref.checksum?.startsWith("sha256:") === true)).toBe(true);
    expect(completed.operationIds).toHaveLength(1);
    expect(ocrCalls).toBe(1);
    expect(findFiles(path.join(fixture.vaultPath, ".pige", "operations"), ".json")).toHaveLength(1);
  });

  it("keeps an agent_turn-owned OCR child behind the startup barrier across restart", async () => {
    const fixture = makeVault("OcrRestart");
    const captured = await preserveImage(fixture, "restart.png");
    const parent = JobRecordSchema.parse({
      id: "job_20260726_ocrparent01",
      class: "agent_turn",
      state: "queued",
      childJobIds: [captured.ocrJobId],
      createdAt: "2026-07-26T04:00:00.000Z",
      updatedAt: "2026-07-26T04:00:00.000Z",
      sourceId: captured.sourceId,
      message: "Parent owns OCR execution order."
    });
    writeJob(jobPath(fixture.vaultPath, parent.id), parent);
    const childPath = jobPath(fixture.vaultPath, captured.ocrJobId);
    writeJob(childPath, JobRecordSchema.parse({ ...readJob(childPath), parentJobId: parent.id }));
    const adapter = new StaticOcrAdapter();
    const ocr = new OcrService(adapter);

    const initial = new JobsService(fixture.vaultPort, undefined, undefined, undefined, ocr);
    expect(await initial.ocrExecutor().process({ limit: 20 })).toMatchObject({ processed: 0 });
    const restarted = new JobsService(fixture.vaultPort, undefined, undefined, undefined, ocr);
    expect(await restarted.ocrExecutor().process({ limit: 20 })).toMatchObject({ processed: 0 });
    expect(adapter.calls).toBe(0);
    expect(readJob(childPath).state).toBe("queued");

    expect(await restarted.ocrExecutor().process({ jobIds: [captured.ocrJobId], limit: 1 }))
      .toMatchObject({ processed: 1, completed: 1, failed: 0 });
    expect(adapter.calls).toBe(1);
    expect(readJob(childPath)).toMatchObject({ id: captured.ocrJobId, state: "completed" });
    expect(findFiles(path.join(fixture.vaultPath, ".pige", "jobs"), `${captured.ocrJobId}.json`)).toHaveLength(1);
  });

  it("fails closed when the active vault changes after OCR selection but before begin", async () => {
    const first = makeVault("OcrVaultA");
    const second = makeVault("OcrVaultB");
    const captured = await preserveImage(first, "binding.png");
    let active = first;
    let ocrCalls = 0;
    const vaults: JobsVaultPort = {
      current: () => active.vault,
      activeVaultPath: () => active.vaultPath,
      assertWriterLease: (vaultPath) => {
        if (vaultPath !== active.vaultPath) {
          throw new PigeDomainError("vault.binding_changed", "The active vault changed before OCR execution.");
        }
      }
    };
    const ocr: OcrPort = {
      canOcr: () => {
        active = second;
        return true;
      },
      ocrSource: async () => {
        ocrCalls += 1;
        throw new Error("must not run");
      }
    };
    const jobs = new JobsService(vaults, undefined, undefined, undefined, ocr);

    await expect(jobs.ocrExecutor().process({ jobIds: [captured.ocrJobId] }))
      .rejects.toMatchObject({ code: "vault.binding_changed" });
    expect(ocrCalls).toBe(0);
    expect(readJob(jobPath(first.vaultPath, captured.ocrJobId)).state).toBe("queued");
    expect(findFiles(path.join(second.vaultPath, ".pige", "jobs"), ".json")).toEqual([]);
  });
});

interface VaultFixture {
  readonly root: string;
  readonly vaultPath: string;
  readonly vault: VaultSummary;
  readonly vaultPort: JobsVaultPort;
}

class StaticOcrAdapter implements NativeImageOcrAdapterPort {
  calls = 0;
  readonly preferredLanguages: string[][] = [];

  constructor(readonly result: NativeOcrResult = ocrResult("macos")) {}

  isAvailable(): boolean {
    return true;
  }

  async recognize(_inputPath: string, preferredLanguages: readonly string[]): Promise<NativeOcrResult> {
    this.calls += 1;
    this.preferredLanguages.push([...preferredLanguages]);
    return this.result;
  }
}

class OcrPreferenceStore implements OcrLanguagePreferenceStorePort {
  constructor(public state: OcrLanguagePreferenceState) {}

  read(): OcrLanguagePreferenceState {
    return this.state;
  }

  mutate(): { readonly status: "stale"; readonly state: OcrLanguagePreferenceState } {
    return { status: "stale", state: this.state };
  }
}

function ocrResult(adapter: "macos" | "paddle"): NativeOcrResult {
  return {
      ...(adapter === "paddle"
        ? { adapterId: "paddleocr_local", adapterVersion: "1.0.0", engine: "Paddle", engineVersion: "3.2.0" }
        : { adapterId: "macos_vision_ocr", adapterVersion: "1.0.0", engine: "macos_vision_document", engineVersion: "synthetic-1" }),
      text: "Durable OCR evidence.",
      blocks: [{
        text: "Durable OCR evidence.",
        kind: "line",
        confidence: 0.94,
        boundingBox: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
        languageHints: ["en"],
        isTitle: false
      }],
      languageHints: ["en"],
      confidence: 0.94,
      warnings: [],
      image: {
        typeIdentifier: "public.png",
        frameCount: 1,
        sourceWidth: 100,
        sourceHeight: 100,
        decodedWidth: 100,
        decodedHeight: 100,
        downsampled: false
      }
    };
}

function makeVault(name: string): VaultFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-ocr-executor-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: name,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-26T04:00:00.000Z")
  });
  const vaultPath = path.join(root, name);
  const vault = loadVaultSummary(vaultPath);
  return {
    root,
    vaultPath,
    vault,
    vaultPort: { current: () => vault, activeVaultPath: () => vaultPath }
  };
}

async function preserveImage(
  fixture: VaultFixture,
  fileName: string
): Promise<{ readonly sourceId: string; readonly ocrJobId: string }> {
  const sourcePath = path.join(fixture.root, fileName);
  fs.writeFileSync(sourcePath, Buffer.from("synthetic image bytes"));
  const capture = new LegacyCaptureFixture(fixture.vaultPort, fixture.vaultPath);
  const jobs = new JobsService(fixture.vaultPort);
  const accepted = await capture.submitFiles({
    filePaths: [sourcePath],
    inputKind: "file_drop",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = requireValue(accepted.sourceIds[0]);
  jobs.processQueuedCaptures({ jobIds: accepted.jobIds });
  return { sourceId, ocrJobId: seedOcrJob(fixture.vaultPath, sourceId).id };
}

function seedOcrJob(vaultPath: string, sourceId: string): JobRecord {
  const suffix = sourceId.replace(/^src_\d{8}_/u, "").slice(0, 10);
  const child = JobRecordSchema.parse({
    id: `job_20260726_${suffix}oc`,
    class: "ocr",
    state: "queued",
    createdAt: "2026-07-26T04:01:00.000Z",
    updatedAt: "2026-07-26T04:01:00.000Z",
    sourceId,
    message: "OCR executor fixture queued."
  });
  writeJob(jobPath(vaultPath, child.id), child);
  return child;
}

function jobPath(vaultPath: string, jobId: string): string {
  const date = requireValue(/^job_(\d{8})_/u.exec(jobId)?.[1]);
  return path.join(vaultPath, ".pige", "jobs", date.slice(0, 4), date.slice(4, 6), `${jobId}.json`);
}

function writeJob(filePath: string, job: JobRecord): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

function readJob(filePath: string): JobRecord {
  return JobRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function findFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? findFiles(target, suffix) : target.endsWith(suffix) ? [target] : [];
  });
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}
