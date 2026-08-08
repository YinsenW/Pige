import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PreparedSourceAgentTurn } from "../../apps/desktop/src/main/services/home-agent-service";
import { HomeAgentMediaCaptureService } from "../../apps/desktop/src/main/services/home-agent-media-capture-service";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("HomeAgentMediaCaptureService", () => {
  it("preserves local media, creates its Source Page, and settles without a model runtime", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-media-capture-"));
    roots.push(root);
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Media",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date("2026-08-08T00:00:00.000Z")
    });
    const vaultPath = path.join(root, "Media");
    const vault = loadVaultSummary(vaultPath);
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const jobs = new JobsService(vaults);
    const conversationEventId = "evt_20260808_mediacapture01";
    const job = jobs.createAgentTurnJob({
      conversationEventId,
      conversationLocator: ".pige/conversations/2026/08/conv_20260808_mediacapture01.jsonl",
      inputHash: digest("media-turn"),
      sourceExpected: true
    });
    const mediaPath = path.join(root, "meeting.m4a");
    fs.writeFileSync(mediaPath, "local media fixture", "utf8");
    const checksum = digest("local media fixture");
    await new CaptureService(vaults).preserveFilesForAgentTurn({
      filePaths: [mediaPath], inputKind: "file_picker", userIntent: "unknown", locale: "en"
    }, {
      jobId: job.id, sourceId: job.sourceId!, inputChecksum: checksum, ordinal: 0, attachmentSetHash: digest("attachments")
    });
    const queued = jobs.attachAgentTurnSource(job.id, job.sourceId!);
    const prepared = {
      request: { schemaVersion: 1, inputKind: "file_picker", locale: "en", clientTurnId: "turn_20260808_mediacapture01" },
      preservedTurn: { event: { id: conversationEventId, conversationId: "conv_20260808_mediacapture01" } },
      jobId: queued.id,
      sourceId: queued.sourceId!,
      sourceIds: [queued.sourceId!],
      activeVaultId: vault.vaultId
    } as unknown as PreparedSourceAgentTurn;

    const result = new HomeAgentMediaCaptureService(vaults, jobs).defer(prepared);
    const settled = jobs.readAgentTurnJob(job.id)!;

    expect(result).toMatchObject({
      state: "waiting",
      modelUsage: "none",
      sourceIds: [job.sourceId!],
      error: { code: "capture.media_transcription_unavailable" }
    });
    expect(settled).toMatchObject({
      state: "waiting_dependency",
      stage: "waiting_for_tool",
      privacy: { usedCloudModel: false, usedNetwork: false, usedShell: false, accessedExternalFiles: false },
      waitingDependency: {
        dependencyKind: "runtime_capability",
        dependencyId: "media_transcription",
        requiredAction: "unavailable"
      }
    });
    const pageId = job.sourceId!.replace(/^src_/u, "page_");
    const sourcePage = findFile(path.join(vaultPath, "Knowledge"), `${pageId}.md`);
    expect(fs.readFileSync(sourcePage, "utf8")).toContain("Pige did not send it to a model.");
  });
});

function findFile(root: string, suffix: string): string {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      try { return findFile(candidate, suffix); } catch { continue; }
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) return candidate;
  }
  throw new Error(`Missing ${suffix}`);
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
