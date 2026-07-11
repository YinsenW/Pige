import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateAgentIngestFixture,
  type AgentIngestGoldenFixture
} from "@pige/test-fixtures";
import type { JobRecord, SourceRecord } from "@pige/schemas";
import type { VaultSummary } from "@pige/contracts";
import {
  AgentIngestService,
  type AgentIngestModelConfigPort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { ScriptedAgentIngestRuntime } from "../helpers/scripted-agent-ingest-runtime";

const roots: string[] = [];
const golden = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), "tests/fixtures/evals/agent-ingest/multilingual-golden.v3.json"),
  "utf8"
)) as { readonly schemaVersion: 3; readonly fixtures: readonly AgentIngestGoldenFixture[] };

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent ingest multilingual golden evaluation", () => {
  it("passes deterministic citation, support, recall, language, and review gates", async () => {
    expect(golden.schemaVersion).toBe(3);
    expect(golden.fixtures).toHaveLength(7);
    expect(new Set(golden.fixtures.map((fixture) => fixture.input.kind))).toEqual(new Set([
      "text",
      "url",
      "pdf",
      "pptx",
      "ocr"
    ]));
    expect(new Set(golden.fixtures.map((fixture) => fixture.locale))).toEqual(new Set([
      "en",
      "zh-Hans",
      "ja",
      "ko",
      "fr",
      "de"
    ]));

    for (const fixture of golden.fixtures) {
      const evaluation = evaluateAgentIngestFixture(fixture);
      expect(evaluation.errors, fixture.id).toEqual([]);
      expect(evaluation.metrics, fixture.id).toEqual({
        schemaValidRate: 1,
        citationCoverage: 1,
        unsupportedClaimCount: 0,
        expectedClaimRecall: 1,
        languagePolicyMatch: 1
      });

      const { vaultPath, vault } = makeVault(fixture.id);
      const { sourceRecord, job } = await createFixtureSource(vaultPath, vault, fixture);
      const service = new AgentIngestService(modelPort, new StaticFixtureModelClient(fixture.modelOutput));
      const result = await service.ingestSource(vaultPath, sourceRecord, job);
      const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");

      expect(result.reviewRequired, fixture.id).toBe(fixture.expected.reviewRequired);
      for (const locator of fixture.expected.citationLocators) {
        expect(note, fixture.id).toContain(`[source:${sourceRecord.id}#${locator}]`);
      }
      expect(note, fixture.id).toContain(fixture.expected.reviewRequired
        ? 'review_state: "needs_review"'
        : 'review_state: "clean"');
    }
  });

  it("detects an invented claim even when it reuses a valid evidence ref", () => {
    const fixture = requireFixture("agent-ingest-en-direct-text-v1");
    const base = fixture.modelOutput as Record<string, unknown>;
    const candidate = {
      ...base,
      summary: { text: "The source guarantees automatic cloud synchronization.", evidenceRefs: ["ev_01"] }
    };

    const result = evaluateAgentIngestFixture(fixture, candidate);

    expect(result.metrics.schemaValidRate).toBe(1);
    expect(result.metrics.citationCoverage).toBe(1);
    expect(result.metrics.unsupportedClaimCount).toBe(1);
    expect(result.metrics.expectedClaimRecall).toBe(0.5);
  });

  it("does not resolve contradictory PDF evidence by inventing a third date", () => {
    const fixture = requireFixture("agent-ingest-ja-pdf-contradiction-v1");
    const base = fixture.modelOutput as Record<string, unknown>;
    const candidate = {
      ...base,
      summary: { text: "資料の公開日は2026年6月20日で確定している。", evidenceRefs: ["ev_01", "ev_02"] }
    };

    const result = evaluateAgentIngestFixture(fixture, candidate);

    expect(result.metrics.schemaValidRate).toBe(1);
    expect(result.metrics.citationCoverage).toBe(1);
    expect(result.metrics.unsupportedClaimCount).toBe(1);
    expect(result.metrics.expectedClaimRecall).toBe(0.5);
  });

  it("rejects a known claim when its cited evidence lacks the required support terms", () => {
    const fixture = requireFixture("agent-ingest-en-direct-text-v1");
    const evidenceMismatch: AgentIngestGoldenFixture = {
      ...fixture,
      input: {
        ...fixture.input,
        evidence: [{ ref: "ev_01", text: "Derived indexes remain rebuildable." }]
      }
    };

    const result = evaluateAgentIngestFixture(evidenceMismatch);

    expect(result.metrics.schemaValidRate).toBe(1);
    expect(result.metrics.citationCoverage).toBe(1);
    expect(result.metrics.unsupportedClaimCount).toBe(1);
  });

  it("reports missing and unavailable refs independently from semantic support", () => {
    const fixture = requireFixture("agent-ingest-en-direct-text-v1");
    const base = fixture.modelOutput as Record<string, unknown>;
    const summary = (base.summary ?? {}) as Record<string, unknown>;
    const withoutCitation = evaluateAgentIngestFixture(fixture, {
      ...base,
      summary: { ...summary, evidenceRefs: [] }
    });
    const unknownCitation = evaluateAgentIngestFixture(fixture, {
      ...base,
      summary: { ...summary, evidenceRefs: ["ev_99"] }
    });

    expect(withoutCitation.metrics.citationCoverage).toBe(0.5);
    expect(withoutCitation.metrics.unsupportedClaimCount).toBe(1);
    expect(unknownCitation.metrics.citationCoverage).toBe(0.5);
    expect(unknownCitation.metrics.unsupportedClaimCount).toBe(1);
  });
});

async function createFixtureSource(
  vaultPath: string,
  vault: VaultSummary,
  fixture: AgentIngestGoldenFixture
): Promise<{ readonly sourceRecord: SourceRecord; readonly job: JobRecord }> {
  const vaultPort = { current: () => vault, activeVaultPath: () => vaultPath };
  const capture = new CaptureService(vaultPort);
  if (fixture.input.kind === "text") {
    const captured = capture.submitText({
      text: fixture.input.text,
      inputKind: "typed_text",
      userIntent: "capture",
      locale: fixture.locale
    });
    return {
      sourceRecord: readJson(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`)),
      job: readJson(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`))
    };
  }

  if (fixture.input.kind === "url") {
    const urlCapture = new CaptureService(vaultPort, {
      fetchSnapshot: async () => ({
        originalUrl: "https://example.com/multilingual-golden",
        finalUrl: "https://example.com/multilingual-golden",
        contentType: "text/html",
        language: fixture.locale,
        title: fixture.id,
        extraction: {
          parserId: "mozilla_readability",
          engine: "@mozilla/readability+jsdom",
          version: "0.6.0+29.1.1",
          mode: "readability",
          textCharacterCount: fixture.input.text.length,
          truncated: false
        },
        rawContent: `<html><body><article>${fixture.input.text}</article></body></html>`,
        extractedText: fixture.input.text,
        warnings: []
      })
    });
    const captured = await urlCapture.submitUrl({
      url: "https://example.com/multilingual-golden",
      inputKind: "pasted_url",
      userIntent: "capture",
      locale: fixture.locale
    });
    return {
      sourceRecord: readJson(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`)),
      job: readJson(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`))
    };
  }

  const extension = fixture.input.kind === "pdf" ? "pdf" : fixture.input.kind === "pptx" ? "pptx" : "png";
  const sourcePath = path.join(path.dirname(vaultPath), `${fixture.id}.${extension}`);
  fs.writeFileSync(sourcePath, fixture.input.kind === "ocr"
    ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
    : Buffer.from(`synthetic-${fixture.input.kind}-source`, "utf8"));
  const captured = await capture.submitFiles({
    filePaths: [sourcePath],
    inputKind: "file_drop",
    userIntent: "capture",
    locale: fixture.locale
  });
  const sourceId = requireFirst(captured.sourceIds);
  const jobId = requireFirst(captured.jobIds);
  const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
  const sourceRecord = readJson<SourceRecord>(sourceRecordPath);
  const artifactKind = fixture.input.kind === "ocr" ? "ocr" : "extracted_text";
  const artifactId = `art_${sourceId.replace(/^src_/u, "")}_${fixture.input.kind}_text`;
  const metadataId = `art_${sourceId.replace(/^src_/u, "")}_${fixture.input.kind}_metadata`;
  const artifactDirectory = artifactKind === "ocr" ? "ocr" : "extracted-text";
  const artifactPath = `artifacts/${artifactDirectory}/2026/07/${sourceId}.txt`;
  const metadataPath = `artifacts/metadata/2026/07/${sourceId}.${fixture.input.kind}.json`;
  const artifactChecksum = checksum(fixture.input.text);
  const units = createFixtureUnits(fixture);
  const sidecar = {
    schemaVersion: 1,
    artifactId: metadataId,
    sourceId,
    kind: fixture.input.kind === "ocr" ? "image_ocr_metadata" : `${fixture.input.kind}_parse_metadata`,
    ...(artifactKind === "ocr"
      ? { ocrTextChecksum: artifactChecksum }
      : { extractedTextChecksum: artifactChecksum }),
    ...(fixture.input.kind === "pdf" ? { pages: units } : { units })
  };
  const sidecarText = JSON.stringify(sidecar);
  write(vaultPath, artifactPath, fixture.input.text);
  write(vaultPath, metadataPath, sidecarText);
  const updated: SourceRecord = {
    ...sourceRecord,
    artifacts: [{
      id: artifactId,
      kind: artifactKind,
      path: artifactPath,
      checksum: artifactChecksum,
      size: Buffer.byteLength(fixture.input.text)
    }, {
      id: metadataId,
      kind: "metadata",
      path: metadataPath,
      checksum: checksum(sidecarText),
      size: Buffer.byteLength(sidecarText)
    }],
    metadata: {
      ...sourceRecord.metadata,
      ...(fixture.input.kind === "ocr" ? {
        needsOcr: false,
        ocrEngine: "macos_vision_document",
        ocrConfidence: fixture.input.quality?.ocrConfidence ?? 1,
        ocrWarnings: []
      } : {
        parserFormat: fixture.input.kind,
        textCoverage: "full",
        parserTruncated: false,
        parserWarnings: []
      })
    }
  };
  fs.writeFileSync(sourceRecordPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return { sourceRecord: updated, job: readJson(findFile(path.join(vaultPath, ".pige/jobs"), `${jobId}.json`)) };
}

function createFixtureUnits(fixture: AgentIngestGoldenFixture): readonly Record<string, unknown>[] {
  let searchFrom = 0;
  return fixture.input.evidence.map((evidence, index) => {
    const characterStart = fixture.input.text.indexOf(evidence.text, searchFrom);
    if (characterStart < 0) throw new Error(`Fixture ${fixture.id} evidence ${evidence.ref} is absent from its source text.`);
    const characterEnd = characterStart + evidence.text.length;
    searchFrom = characterEnd;
    return {
      locator: evidence.locator ?? defaultFixtureLocator(fixture.input.kind, index),
      characterStart,
      characterEnd,
      ...(evidence.confidence !== undefined ? { confidence: evidence.confidence } : {})
    };
  });
}

function defaultFixtureLocator(kind: AgentIngestGoldenFixture["input"]["kind"], index: number): string {
  if (kind === "pdf") return `page:${index + 1}`;
  if (kind === "pptx") return `slide:${index + 1}`;
  if (kind === "ocr") return `ocr:block:${index + 1}`;
  return "managed_source_preview";
}

function makeVault(name: string): { readonly vaultPath: string; readonly vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-eval-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: name,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-10T05:00:00.000Z")
  });
  const vaultPath = path.join(root, name);
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_eval_local",
    displayName: "Eval Local",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    authSecretRef: "provider_secret_eval_local",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-10T05:00:00.000Z",
    updatedAt: "2026-07-10T05:00:00.000Z"
  },
  model: {
    id: "model_eval_local",
    providerProfileId: "provider_eval_local",
    modelId: "eval-model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-10T05:00:00.000Z",
    updatedAt: "2026-07-10T05:00:00.000Z"
  },
  apiKey: "synthetic-eval-key"
};

const modelPort: AgentIngestModelConfigPort = {
  getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
  getDefaultProvider: () => runtimeConfig.provider,
  hasDefaultRuntimeBinding: () => true,
  getDefaultRuntimeConfig: () => runtimeConfig
};

class StaticFixtureModelClient extends ScriptedAgentIngestRuntime {}

function requireFixture(id: string): AgentIngestGoldenFixture {
  const fixture = golden.fixtures.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Missing fixture ${id}.`);
  return fixture;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function findFile(root: string, suffix: string): string {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(filePath, suffix);
      if (found) return found;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return filePath;
    }
  }
  throw new Error(`Missing file ending with ${suffix}.`);
}

function findFileOptional(root: string, suffix: string): string | undefined {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(filePath, suffix);
      if (found) return found;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return filePath;
    }
  }
  return undefined;
}

function write(vaultPath: string, relativePath: string, value: string): void {
  const filePath = path.join(vaultPath, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function checksum(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireFirst(values: readonly string[]): string {
  const first = values[0];
  if (!first) throw new Error("Expected at least one value.");
  return first;
}
