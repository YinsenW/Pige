import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationEventSchema, JobRecordSchema, SourceRecordSchema } from "@pige/schemas";
import { assertAgentIngestPublicationAuthorityCurrent } from "../../apps/desktop/src/main/services/agent-ingest-publication-authority";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent ingest publication authority", () => {
  it("accepts only the exact active Vault, running Job, source, and durable capture turn", () => {
    const fixture = createFixture();
    const input = {
      vaultPath: fixture.vaultPath,
      activeVaultPath: fixture.vaultPath,
      activeVault: fixture.vault,
      expectedJob: fixture.job,
      currentJob: fixture.job,
      sourceRecord: fixture.source
    };

    expect(() => assertAgentIngestPublicationAuthorityCurrent(input)).not.toThrow();
    expect(() => assertAgentIngestPublicationAuthorityCurrent({
      ...input,
      activeVaultPath: path.join(fixture.vaultPath, "other")
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));
    expect(() => assertAgentIngestPublicationAuthorityCurrent({
      ...input,
      currentJob: JobRecordSchema.parse({ ...fixture.job, captureId: "cap_20260709_changed123456" })
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));

    fs.appendFileSync(fixture.conversationPath, `${JSON.stringify(fixture.event)}\n`, "utf8");
    expect(() => assertAgentIngestPublicationAuthorityCurrent(input))
      .toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));
  });

  it.skipIf(process.platform === "win32")("does not follow a replaced conversation file", () => {
    const fixture = createFixture();
    const outside = path.join(path.dirname(fixture.vaultPath), "outside.jsonl");
    fs.writeFileSync(outside, `${JSON.stringify(fixture.event)}\n`, "utf8");
    fs.rmSync(fixture.conversationPath);
    fs.symlinkSync(outside, fixture.conversationPath);

    expect(() => assertAgentIngestPublicationAuthorityCurrent({
      vaultPath: fixture.vaultPath,
      activeVaultPath: fixture.vaultPath,
      activeVault: fixture.vault,
      expectedJob: fixture.job,
      currentJob: fixture.job,
      sourceRecord: fixture.source
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-publication-authority-"));
  tempRoots.push(root);
  const vaultPath = path.join(root, "Vault");
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const source = SourceRecordSchema.parse({
    id: "src_20260709_abcdef123456",
    kind: "text",
    storageStrategy: "copy_to_source_library",
    managedCopy: {
      path: "raw/text/2026/07/src_20260709_abcdef123456.txt",
      checksum: `sha256:${"a".repeat(64)}`,
      size: 12
    },
    artifacts: [],
    metadata: { captureId: "cap_20260709_abcdef123456" },
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z"
  });
  const event = ConversationEventSchema.parse({
    id: "evt_20260709_abcdef123456",
    conversationId: "conv_20260709",
    type: "capture_reference",
    createdAt: "2026-07-09T12:00:00.000Z",
    sourceId: source.id,
    captureId: "cap_20260709_abcdef123456",
    text: "Bound source"
  });
  const conversationPath = path.join(vaultPath, ".pige", "conversations", "2026", "07", "conv_20260709.jsonl");
  fs.mkdirSync(path.dirname(conversationPath), { recursive: true });
  fs.writeFileSync(conversationPath, `${JSON.stringify(event)}\n`, "utf8");
  const vault = loadVaultSummary(vaultPath);
  const job = JobRecordSchema.parse({
    id: "job_20260709_abcdef123456ag",
    class: "agent_ingest",
    state: "running",
    parentJobId: "job_20260709_parent123456",
    activeVaultId: vault.vaultId,
    sourceId: source.id,
    captureId: "cap_20260709_abcdef123456",
    conversationEventId: event.id,
    createdAt: "2026-07-09T12:01:00.000Z",
    updatedAt: "2026-07-09T12:01:00.000Z",
    message: "Running"
  });
  return { vaultPath, vault, source, event, job, conversationPath };
}
