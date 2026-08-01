import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMemoryService } from "../../apps/desktop/src/main/services/agent-memory-service";
import { AgentMemoryTrashService } from "../../apps/desktop/src/main/services/agent-memory-trash-service";

const roots: string[] = [];
const VAULT_ID = "vault_20260802_memorytrash";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AgentMemoryTrashService", () => {
  it("lists body-free exact delete receipts and restores through the durable Activity owner after restart", () => {
    const vaultPath = createVault();
    const memory = new AgentMemoryService({ now: advancingClock(), activeVaultPath: () => vaultPath });
    const deleted = remember(memory, vaultPath, "deleted");
    const deletion = memory.delete(vaultPath, {
      apiVersion: 1,
      requestId: "memory_request_deletedmemory000",
      activeVaultId: VAULT_ID,
      memoryId: deleted.id,
      expectedRevision: 1
    });
    expect(deletion.status).toBe("committed");

    const restartedMemory = new AgentMemoryService({ now: advancingClock(), activeVaultPath: () => vaultPath });
    const trashService = new AgentMemoryTrashService(restartedMemory);
    const trash = trashService.list(vaultPath, { apiVersion: 1, activeVaultId: VAULT_ID });
    expect(trash).toMatchObject({
      activeVaultId: VAULT_ID,
      revision: 2,
      records: [{
        memoryId: deleted.id,
        trashOperationId: deletion.operationId,
        kind: "preference",
        title: "Preference deleted"
      }]
    });
    expect(JSON.stringify(trash)).not.toContain(deleted.body);
    expect(JSON.stringify(trash)).not.toContain("conversation");

    remember(restartedMemory, vaultPath, "unrelated");
    const stale = trashService.restore(vaultPath, {
      apiVersion: 1,
      requestId: "memory_request_restorestale0000",
      activeVaultId: VAULT_ID,
      memoryId: deleted.id,
      trashOperationId: deletion.operationId!,
      expectedRevision: trash.revision
    });
    expect(stale).toMatchObject({ status: "stale", summary: { revision: 3 }, trash: { revision: 3 } });

    const restored = trashService.restore(vaultPath, {
      apiVersion: 1,
      requestId: "memory_request_restorecurrent00",
      activeVaultId: VAULT_ID,
      memoryId: deleted.id,
      trashOperationId: deletion.operationId!,
      expectedRevision: stale.summary.revision
    });
    expect(restored).toMatchObject({
      status: "committed",
      operationId: expect.stringMatching(/^op_/u),
      summary: { revision: 4, records: expect.arrayContaining([
        expect.objectContaining({ id: deleted.id, body: deleted.body }),
        expect.objectContaining({ title: "Preference unrelated" })
      ]) },
      trash: { revision: 4, records: [] }
    });

    const afterRestart = new AgentMemoryTrashService(
      new AgentMemoryService({ activeVaultPath: () => vaultPath })
    );
    expect(afterRestart.list(vaultPath, { apiVersion: 1, activeVaultId: VAULT_ID }).records).toEqual([]);
  });

  it("fails closed when the memory trash parent is replaced by a symlink", () => {
    const vaultPath = createVault();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pige-memory-trash-outside-"));
    roots.push(outside);
    fs.mkdirSync(path.join(vaultPath, ".pige"), { recursive: true });
    fs.symlinkSync(outside, path.join(vaultPath, ".pige", "trash"));
    const memory = new AgentMemoryService({ activeVaultPath: () => vaultPath });
    const service = new AgentMemoryTrashService(memory);
    expect(() => service.list(vaultPath, { apiVersion: 1, activeVaultId: VAULT_ID }))
      .toThrowError(expect.objectContaining({ code: "memory.lifecycle_conflict" }));
  });
});

function remember(memory: AgentMemoryService, vaultPath: string, suffix: string) {
  return memory.rememberPreference({
    vaultPath,
    activeVaultId: VAULT_ID,
    title: `Preference ${suffix}`,
    body: `Remember the bounded ${suffix} preference.`,
    sourceConversationId: `conv_20260802_${suffix}conversation`,
    sourceEventId: `evt_20260802_${suffix}event0000`,
    parentJobId: `job_20260802_${suffix}job000000`
  });
}

function advancingClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.parse("2026-08-02T00:00:00.000Z") + tick++ * 1_000);
}

function createVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-memory-trash-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".pige"), { recursive: true });
  return root;
}
