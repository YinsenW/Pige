import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentFileIngressRecoveryService } from "../../apps/desktop/src/main/services/agent-file-ingress-recovery-service";
import { AcceptedFileIngressService } from "../../apps/desktop/src/main/services/accepted-file-ingress-service";
import { AgentTurnConversationStore } from "../../apps/desktop/src/main/services/agent-turn-conversation-store";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AgentFileIngressRecoveryService", () => {
  it("publishes an accepted file from its immutable snapshot after the original path disappears", async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-ingress-recovery-")));
    roots.push(root);
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Recovery",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date("2026-08-01T00:00:00.000Z")
    });
    const vaultPath = path.join(root, "Recovery");
    const vault = loadVaultSummary(vaultPath);
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const conversations = new AgentTurnConversationStore();
    const turn = conversations.appendUserTurn(vaultPath, "Use the accepted file.", {
      inputKind: "file_picker",
      locale: "en",
      authoredTaskIntent: "explicit_user_task"
    }, { clientTurnId: "turn_20260801_ingressrecover" });
    const sourcePath = path.join(root, "accepted.md");
    const sourceBytes = Buffer.from("# Accepted before restart\n", "utf8");
    fs.writeFileSync(sourcePath, sourceBytes);
    const checksum = `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`;
    const attachmentSetHash = `sha256:${"a".repeat(64)}`;
    const jobs = new JobsService(vaults);
    const job = jobs.createAgentTurnJob({
      conversationEventId: turn.event.id,
      conversationLocator: turn.locator,
      inputHash: turn.inputHash,
      sourceExpected: true,
      attachmentCount: 1,
      attachmentSetHash,
      sourceChecksums: [checksum]
    });
    const sourceId = job.inputRefs?.find((ref) => ref.role === "agent_turn_source")?.id;
    expect(sourceId).toBeTruthy();
    const capture = new CaptureService(vaults);
    await new AcceptedFileIngressService(vaults).freeze(sourcePath, {
      jobId: job.id,
      sourceId: sourceId!,
      inputChecksum: checksum,
      ordinal: 0,
      snapshotOrdinal: 0,
      attachmentSetHash
    });
    fs.rmSync(sourcePath);

    const result = await new AgentFileIngressRecoveryService(
      vaults,
      jobs,
      capture,
      conversations
    ).recover();

    expect(result).toEqual({ recovered: 1, retained: 0, failed: 0 });
    expect(jobs.readAgentTurnJob(job.id)).toMatchObject({ state: "queued", sourceId });
    const sourceRecordPath = path.join(
      vaultPath,
      ".pige",
      "source-records",
      sourceId!.slice(4, 8),
      sourceId!.slice(8, 10),
      `${sourceId}.json`
    );
    const record = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      managedCopy: { path: string; checksum: string };
    };
    expect(record.managedCopy.checksum).toBe(checksum);
    expect(fs.readFileSync(path.join(vaultPath, record.managedCopy.path))).toEqual(sourceBytes);
  });
});
