import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalMutationIntentStore } from "../../apps/desktop/src/main/services/external-mutation-intent-store";
import { ExternalOperationRecordStore } from "../../apps/desktop/src/main/services/external-operation-record-store";
import { hashExternalTarget } from "../../apps/desktop/src/main/services/external-file-publication-protocol";
import {
  ExternalMutationIntentSchema,
  OperationRecordSchema,
  OperationRefSchema,
  type ExternalMutationIntent,
  type OperationRecord
} from "@pige/schemas";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe("external mutation durable foundation", () => {
  it("uses immutable monotonic revisions and preserves the winning transition", () => {
    const root = tempRoot();
    const storeA = new ExternalMutationIntentStore(root);
    const storeB = new ExternalMutationIntentStore(root);
    const planned = intentFixture(root);

    expect(storeA.create(planned).revision).toBe(1);
    expect(storeB.create(planned).revision).toBe(1);
    expect(storeA.transition(planned.id, "planned", "published")).toMatchObject({ revision: 2, state: "published" });
    expect(storeB.transition(planned.id, "planned", "published")).toMatchObject({ revision: 2, state: "published" });
    expect(() => storeB.transition(planned.id, "planned", "failed_uncertain")).toThrowError(
      expect.objectContaining({ code: "external_mutation.intent_conflict" })
    );
    expect(storeA.read(planned.id)).toMatchObject({ revision: 2, state: "published" });
    expect(fs.readdirSync(path.join(root, "external-mutation-intents", planned.id))).toEqual([
      "00000001.json",
      "00000002.json"
    ]);
  });

  it("rejects non-private or hard-linked intent revisions", () => {
    const root = tempRoot();
    const store = new ExternalMutationIntentStore(root);
    const intent = intentFixture(root);
    store.create(intent);
    const revisionPath = path.join(root, "external-mutation-intents", intent.id, "00000001.json");
    fs.chmodSync(revisionPath, 0o644);
    expect(() => store.read(intent.id)).toThrowError(expect.objectContaining({ code: "external_mutation.intent_invalid" }));

    fs.chmodSync(revisionPath, 0o600);
    fs.linkSync(revisionPath, path.join(root, "hardlink.json"));
    expect(() => store.read(intent.id)).toThrowError(expect.objectContaining({ code: "external_mutation.intent_invalid" }));
  });

  it("rejects path-bearing external references and incomplete external-file Operations", () => {
    expect(() => OperationRefSchema.parse({
      kind: "external_resource",
      id: `sha256:${"a".repeat(64)}`,
      path: "/private/tmp/secret"
    })).toThrow();
    expect(() => OperationRecordSchema.parse({
      ...operationFixture(),
      permissionDecisionIds: [],
      policyAudit: undefined
    })).toThrow();
    expect(() => OperationRecordSchema.parse({
      ...operationFixture(),
      after: undefined
    })).toThrow();
  });

  it("writes identical Operations idempotently and rejects content conflicts", () => {
    const root = tempRoot();
    const vaultPath = path.join(root, "vault");
    fs.mkdirSync(path.join(vaultPath, ".pige"), { recursive: true });
    const store = new ExternalOperationRecordStore();
    const operation = operationFixture();

    expect(store.write(vaultPath, operation, () => undefined)).toEqual(operation);
    expect(store.write(vaultPath, operation, () => undefined)).toEqual(operation);
    expect(() => store.write(vaultPath, { ...operation, summary: "different" }, () => undefined)).toThrowError(
      expect.objectContaining({ code: "external_mutation.operation_conflict" })
    );
  });

  it("rejects symlinked Operation ancestors and hard-linked Operation files", () => {
    const root = tempRoot();
    const vaultPath = path.join(root, "vault");
    const external = path.join(root, "external");
    fs.mkdirSync(path.join(vaultPath, ".pige"), { recursive: true });
    fs.mkdirSync(external);
    fs.symlinkSync(external, path.join(vaultPath, ".pige", "operations"), process.platform === "win32" ? "junction" : "dir");
    const store = new ExternalOperationRecordStore();
    expect(() => store.write(vaultPath, operationFixture(), () => undefined)).toThrowError(
      expect.objectContaining({ code: "external_mutation.operation_invalid" })
    );

    fs.unlinkSync(path.join(vaultPath, ".pige", "operations"));
    store.write(vaultPath, operationFixture(), () => undefined);
    const operationPath = path.join(vaultPath, ".pige", "operations", "2026", "07", `${operationFixture().id}.json`);
    fs.linkSync(operationPath, path.join(root, "operation-hardlink.json"));
    expect(() => store.write(vaultPath, operationFixture(), () => undefined)).toThrowError(
      expect.objectContaining({ code: "external_mutation.operation_invalid" })
    );
  });

  it("rejects forged intent path/hash bindings", () => {
    const root = tempRoot();
    const store = new ExternalMutationIntentStore(root);
    const intent = intentFixture(root);
    expect(() => store.create({ ...intent, stagePath: path.join(root, "other", "stage") })).toThrowError(
      expect.objectContaining({ code: "external_mutation.intent_invalid" })
    );
    expect(() => store.create({ ...intent, targetResourceHash: `sha256:${"f".repeat(64)}` })).toThrowError(
      expect.objectContaining({ code: "external_mutation.intent_invalid" })
    );
    expect(() => store.create({ ...intent, targetLeafName: "different.txt" })).toThrowError(
      expect.objectContaining({ code: "external_mutation.intent_invalid" })
    );
    expect(() => store.create({ ...intent, parentIdentityHash: `sha256:${"f".repeat(64)}` })).toThrowError(
      expect.objectContaining({ code: "external_mutation.intent_invalid" })
    );
    expect(() => ExternalMutationIntentSchema.parse({ ...intent, schemaVersion: 1 })).toThrow();
    expect(() => ExternalMutationIntentSchema.parse({ ...intent, targetPath: `${intent.targetPath}\nforge` })).toThrow();
  });

  it("rejects the unregistered schema-v1 development record instead of guessing a parent identity", () => {
    const root = tempRoot();
    const store = new ExternalMutationIntentStore(root);
    const intent = intentFixture(root);
    const directory = path.join(root, "external-mutation-intents", intent.id);
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(
      path.join(directory, "00000001.json"),
      `${JSON.stringify({
        ...intent,
        schemaVersion: 1,
        targetLeafName: undefined,
        parentIdentityHash: undefined
      })}\n`,
      { encoding: "utf8", mode: 0o600 }
    );

    expect(() => store.read(intent.id)).toThrowError(expect.objectContaining({ code: "external_mutation.intent_invalid" }));
  });
});

function intentFixture(root: string): ExternalMutationIntent {
  const id = "extmut_20260718_abcdefabcdefabcdefab";
  const targetPath = path.join(root, "external", "created.txt");
  const targetLeafName = path.basename(targetPath);
  const parentIdentityHash = `sha256:${"e".repeat(64)}` as const;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const now = "2026-07-18T06:00:00.000Z";
  return ExternalMutationIntentSchema.parse({
    id,
    schemaVersion: 2,
    revision: 1,
    state: "planned",
    vaultId: "vault_20260718_external01",
    jobId: "job_20260718_external01",
    toolCallId: "call_external_create_01",
    permissionRequestId: "permreq_20260718_external01",
    permissionDecisionId: "permdec_20260718_external01",
    bindingHash: `sha256:${"a".repeat(64)}`,
    policyContextId: "policy_external_create_01",
    policyHash: `sha256:${"b".repeat(64)}`,
    targetPath,
    targetLeafName,
    parentIdentityHash,
    stagePath: path.join(path.dirname(targetPath), `.pige-${id}.stage`),
    targetResourceHash: hashExternalTarget(parentIdentityHash, targetLeafName),
    contentHash: `sha256:${"c".repeat(64)}`,
    byteLength: 4,
    operationId: "op_20260718_abcdefabcdefabcdefab",
    createdAt: now,
    updatedAt: now
  });
}

function operationFixture(): OperationRecord {
  const resourceHash = `sha256:${"d".repeat(64)}`;
  return OperationRecordSchema.parse({
    id: "op_20260718_abcdefabcdefabcdefab",
    schemaVersion: 1,
    jobId: "job_20260718_external01",
    createdAt: "2026-07-18T06:00:00.000Z",
    actor: { kind: "pige_agent", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    permissionDecisionIds: ["permdec_20260718_external01"],
    policyAudit: {
      policyContextId: "policy_external_create_01",
      policyHash: `sha256:${"b".repeat(64)}`,
      enforcementOwners: ["Permission Broker", "External Filesystem Mutation Service"]
    },
    kind: "create_external_file",
    targetRefs: [{ kind: "external_resource", id: resourceHash }],
    sourceRefs: [],
    after: { kind: "external_resource", id: resourceHash, checksum: `sha256:${"c".repeat(64)}` },
    summary: "Created one permission-approved external UTF-8 file.",
    reversible: "no",
    warnings: []
  });
}

function tempRoot(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-ext-foundation-")));
  roots.push(root);
  return root;
}
