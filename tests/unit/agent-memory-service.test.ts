import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMemoryService } from "../../apps/desktop/src/main/services/agent-memory-service";
import type { OperationRecord } from "@pige/schemas";

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

  it("enables a disabled record with CAS and adopts only an exact request replay", () => {
    const vaultPath = createVault();
    const service = new AgentMemoryService({ now: fixedClock() });
    const record = remember(service, vaultPath, "enable");
    const disabled = service.disable(vaultPath, {
      apiVersion: 1,
      requestId: "memory_request_aaaaaaaaaaaaaaaa",
      activeVaultId: VAULT_ID,
      memoryId: record.id,
      expectedRevision: 1
    });
    expect(disabled.status).toBe("committed");

    const request = {
      apiVersion: 1,
      requestId: "memory_request_bbbbbbbbbbbbbbbb",
      activeVaultId: VAULT_ID,
      memoryId: record.id,
      expectedRevision: 2
    } as const;
    const committed = service.enable(vaultPath, request);
    expect(committed).toMatchObject({ status: "committed", operationId: expect.stringMatching(/^op_20260727_/) });
    expect(committed.summary.records[0]?.status).toBe("active");
    expect(service.enable(vaultPath, request)).toEqual(committed);

    expect(() => service.enable(vaultPath, { ...request, memoryId: "memory_20260727_changedbinding" }))
      .toThrowError(expect.objectContaining({ code: "memory.lifecycle_conflict" }));
    expect(service.enable(vaultPath, {
      ...request,
      requestId: "memory_request_cccccccccccccccc",
      expectedRevision: 1
    }).status).toBe("stale");
    expect(service.enable(vaultPath, {
      ...request,
      requestId: "memory_request_dddddddddddddddd",
      memoryId: "memory_20260727_missingrecord",
      expectedRevision: 3
    }).status).toBe("not_found");

    const operation = readOperation(vaultPath, committed.operationId!);
    expect(operation).toMatchObject({ kind: "update_memory", actor: { kind: "user" }, reversible: "yes" });
    expect(service.activitySummary(operation)).toMatchObject({
      kind: "update_memory",
      target: { kind: "memory", memoryId: record.id },
      canUndo: true
    });
  });

  it("deletes trash-first, recovers a missing Operation, and restores private provenance through Undo", () => {
    const vaultPath = createVault();
    const service = new AgentMemoryService({ now: fixedClock(), activeVaultPath: () => vaultPath });
    const record = remember(service, vaultPath, "delete");
    const request = {
      apiVersion: 1,
      requestId: "memory_request_eeeeeeeeeeeeeeee",
      activeVaultId: VAULT_ID,
      memoryId: record.id,
      expectedRevision: 1
    } as const;
    const committed = service.delete(vaultPath, request);
    expect(committed.status).toBe("committed");
    expect(committed.summary.records).toEqual([]);
    expect(service.recall(vaultPath)).toEqual([]);

    const receiptPath = path.join(vaultPath, ".pige/trash/memory", `${request.requestId}.json`);
    const receiptText = fs.readFileSync(receiptPath, "utf8");
    expect(receiptText).toContain("conversationId");
    expect(receiptText).toContain("parentJobId");
    expect(JSON.stringify(committed)).not.toContain("parentJobId");

    const operationPath = findOperationPath(vaultPath, committed.operationId!);
    fs.rmSync(operationPath);
    expect(service.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    const operation = readOperation(vaultPath, committed.operationId!);
    expect(operation.before?.path).toBe(`.pige/trash/memory/${request.requestId}.json`);

    const undone = service.undo(operation, String(committed.summary.revision));
    expect(undone).toMatchObject({ status: "undone", operationId: operation.id, undoOperationId: expect.any(String) });
    expect(service.list(vaultPath, VAULT_ID).records).toEqual([expect.objectContaining({ id: record.id })]);
    const undoOperation = readOperation(vaultPath, undone.undoOperationId!);
    expect(service.findUndoOperation(operation, [operation, undoOperation])).toEqual(undoOperation);
    expect(service.activitySummary(operation, undoOperation)).toMatchObject({ status: "undone", canUndo: false });
  });

  it("undoes one reset by merging exact removed records without deleting later memory", () => {
    const vaultPath = createVault();
    const service = new AgentMemoryService({ now: advancingClock(), activeVaultPath: () => vaultPath });
    const first = remember(service, vaultPath, "resetfirst");
    const second = remember(service, vaultPath, "resetsecond");
    const reset = service.reset(vaultPath, {
      apiVersion: 1,
      requestId: "memory_request_ffffffffffffffff",
      activeVaultId: VAULT_ID,
      expectedRevision: 2
    });
    expect(reset).toMatchObject({ status: "committed", summary: { revision: 3, records: [] } });
    const later = remember(service, vaultPath, "resetlater");
    const operation = readOperation(vaultPath, reset.operationId!);
    expect(service.activitySummary(operation)).toMatchObject({ kind: "trash_memory", canUndo: true });

    const undone = service.undo(operation, "3");
    expect(undone.status).toBe("undone");
    const summary = service.list(vaultPath, VAULT_ID);
    expect(summary.revision).toBe(5);
    expect(new Set(summary.records.map((entry) => entry.id))).toEqual(new Set([first.id, second.id, later.id]));
    expect(service.reset(vaultPath, {
      apiVersion: 1,
      requestId: "memory_request_gggggggggggggggg",
      activeVaultId: VAULT_ID,
      expectedRevision: summary.revision
    }).status).toBe("committed");
  });

  it("exports only safe summaries after revision proof and rejects symlink destinations", () => {
    const vaultPath = createVault();
    const service = new AgentMemoryService({ now: fixedClock() });
    remember(service, vaultPath, "export");
    const canonicalVaultPath = fs.realpathSync.native(vaultPath);
    const destination = path.join(canonicalVaultPath, "memory-export.json");
    const request = {
      apiVersion: 1,
      requestId: "memory_request_hhhhhhhhhhhhhhhh",
      activeVaultId: VAULT_ID,
      expectedRevision: 1
    } as const;
    expect(service.export(vaultPath, request, destination)).toEqual({
      apiVersion: 1,
      status: "exported",
      requestId: request.requestId,
      activeVaultId: VAULT_ID,
      revision: 1
    });
    const exported = fs.readFileSync(destination, "utf8");
    expect(exported).toContain('"scope": "vault"');
    expect(exported).toContain('"provenance"');
    expect(exported).not.toContain("conversationId");
    expect(exported).not.toContain("userEventId");
    expect(exported).not.toContain("parentJobId");
    expect(fs.statSync(destination).mode & 0o777).toBe(0o600);

    const staleDestination = path.join(canonicalVaultPath, "stale.json");
    expect(service.export(vaultPath, { ...request, expectedRevision: 0 }, staleDestination).status).toBe("stale");
    expect(fs.existsSync(staleDestination)).toBe(false);
    const symlinkTarget = path.join(canonicalVaultPath, "existing.json");
    const symlinkDestination = path.join(canonicalVaultPath, "unsafe.json");
    fs.writeFileSync(symlinkTarget, "sentinel", "utf8");
    fs.symlinkSync(symlinkTarget, symlinkDestination);
    expect(service.export(vaultPath, { ...request, requestId: "memory_request_iiiiiiiiiiiiiiii" }, symlinkDestination).status)
      .toBe("failed");
    expect(fs.readFileSync(symlinkTarget, "utf8")).toBe("sentinel");
  });
});

const VAULT_ID = "vault_20260727_memorytest";

function remember(service: AgentMemoryService, vaultPath: string, suffix: string) {
  return service.rememberPreference({
    vaultPath,
    activeVaultId: VAULT_ID,
    title: `Preference ${suffix}`,
    body: `Remember the bounded ${suffix} preference.`,
    sourceConversationId: `conv_20260727_${suffix}conversation`,
    sourceEventId: `evt_20260727_${suffix}event0000`,
    parentJobId: `job_20260727_${suffix}job000000`
  });
}

function fixedClock(): () => Date {
  return () => new Date("2026-07-27T12:00:00.000Z");
}

function advancingClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.parse("2026-07-27T12:00:00.000Z") + tick++ * 1_000);
}

function findOperationPath(vaultPath: string, operationId: string): string {
  const date = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!date) throw new Error("Invalid operation identity.");
  return path.join(vaultPath, ".pige/operations", date.slice(0, 4), date.slice(4, 6), `${operationId}.json`);
}

function readOperation(vaultPath: string, operationId: string): OperationRecord {
  return JSON.parse(fs.readFileSync(findOperationPath(vaultPath, operationId), "utf8")) as OperationRecord;
}

function createVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-memory-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, ".pige"), { recursive: true });
  return root;
}
