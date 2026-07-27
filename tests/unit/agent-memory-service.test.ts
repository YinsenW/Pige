import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMemoryService } from "../../apps/desktop/src/main/services/agent-memory-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AgentMemoryService", () => {
  it("atomically preserves an explicit event and active atom, then disables recall with CAS", () => {
    const vaultPath = createVault();
    const service = new AgentMemoryService();
    const rememberRequest = {
      vaultPath,
      activeVaultId: "vault_20260727_memorytest",
      title: "Concise summaries",
      body: "Prefer concise source summaries unless I ask for detail.",
      sourceConversationId: "conv_20260727_memorytest",
      sourceEventId: "evt_20260727_memoryevent",
      parentJobId: "job_20260727_memoryjob"
    } as const;
    const record = service.rememberPreference(rememberRequest);

    expect(service.recall(vaultPath)).toEqual([expect.objectContaining({ id: record.id, status: "active" })]);
    const summary = service.list(vaultPath, "vault_20260727_memorytest");
    expect(summary.records).toEqual([expect.objectContaining({
      id: record.id,
      provenance: { kind: "explicit_user_request", occurredAt: expect.any(String) }
    })]);
    expect(JSON.stringify(summary)).not.toContain("memoryevent");
    expect(JSON.stringify(summary)).not.toContain("memoryjob");

    const registry = JSON.parse(fs.readFileSync(path.join(vaultPath, ".pige/memory/registry.json"), "utf8")) as {
      events: unknown[];
      records: unknown[];
    };
    expect(registry.events).toHaveLength(1);
    expect(registry.records).toHaveLength(1);
    const atomPath = path.join(vaultPath, ".pige/memory/atoms", `${record.id}.md`);
    fs.rmSync(atomPath);
    expect(service.rememberPreference(rememberRequest).id).toBe(record.id);
    expect(fs.existsSync(atomPath)).toBe(true);
    expect(service.rememberPreference({
      ...rememberRequest,
      title: "Different retry title",
      body: "api_key=sk-retried-secret-value-123456789"
    }).id).toBe(record.id);
    expect(service.list(vaultPath, "vault_20260727_memorytest").records).toHaveLength(1);

    const stale = service.disable(vaultPath, {
      apiVersion: 1,
      requestId: "memory_request_abcdefghijklmnop",
      activeVaultId: "vault_20260727_memorytest",
      memoryId: record.id,
      expectedRevision: 0
    });
    expect(stale.status).toBe("stale");
    const committed = service.disable(vaultPath, {
      apiVersion: 1,
      requestId: "memory_request_qrstuvwxyzabcdef",
      activeVaultId: "vault_20260727_memorytest",
      memoryId: record.id,
      expectedRevision: summary.revision
    });
    expect(committed.status).toBe("committed");
    expect(service.recall(vaultPath)).toEqual([]);
  });

  it("rejects secret-like explicit memory before writing an event or atom", () => {
    const vaultPath = createVault();
    const service = new AgentMemoryService();

    expect(() => service.rememberPreference({
      vaultPath,
      activeVaultId: "vault_20260727_memorytest",
      title: "Credential",
      body: "api_key=sk-example-secret-value-123456789",
      sourceConversationId: "conv_20260727_memorytest",
      sourceEventId: "evt_20260727_memoryevent",
      parentJobId: "job_20260727_memoryjob"
    })).toThrowError(expect.objectContaining({ code: "memory.secret_blocked" }));

    expect(service.list(vaultPath, "vault_20260727_memorytest").records).toEqual([]);
    expect(fs.existsSync(path.join(vaultPath, ".pige/memory/registry.json"))).toBe(false);
  });

  it("rejects mismatched event provenance and ignores a stale fixed temporary file", () => {
    const vaultPath = createVault();
    const service = new AgentMemoryService();
    const memoryRoot = path.join(vaultPath, ".pige/memory");
    fs.mkdirSync(memoryRoot, { recursive: true });
    fs.writeFileSync(path.join(memoryRoot, "registry.json.tmp"), "stale", "utf8");
    service.rememberPreference({
      vaultPath,
      activeVaultId: "vault_20260727_memorytest",
      title: "Stable preference",
      body: "Keep one stable preference.",
      sourceConversationId: "conv_20260727_memorytest",
      sourceEventId: "evt_20260727_memoryevent",
      parentJobId: "job_20260727_memoryjob"
    });
    const registryPath = path.join(memoryRoot, "registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
      records: Array<{ parentJobId: string }>;
    };
    registry.records[0]!.parentJobId = "job_20260727_tampered";
    fs.writeFileSync(registryPath, `${JSON.stringify(registry)}\n`, "utf8");
    expect(() => service.list(vaultPath, "vault_20260727_memorytest"))
      .toThrowError(expect.objectContaining({ code: "memory.registry_invalid" }));
  });
});

function createVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-memory-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".pige"), { recursive: true });
  return root;
}
