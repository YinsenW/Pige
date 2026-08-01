import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OperationRecordSchema } from "@pige/schemas";
import {
  PigePolicyService,
  readPigePolicyForAgent,
  type PigePolicyPreparedUpdate
} from "../../apps/desktop/src/main/services/pige-policy-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-policy-"));
  roots.push(root);
  const vaultPath = path.join(root, "Vault");
  createVaultOnDisk({ parentDirectory: root, vaultName: "Vault", appDataPath: path.join(root, "app-data"), tempPath: path.join(root, "temp") });
  const vault = loadVaultSummary(vaultPath);
  let active = true;
  const service = () => new PigePolicyService({
    current: () => active ? vault : undefined,
    activeVaultPath: () => active ? vaultPath : undefined,
    assertWriterLease: (candidate) => { if (!active || candidate !== vaultPath) throw new Error("stale binding"); }
  }, () => "2026-08-01T01:00:00.000Z");
  return { root, vaultPath, vault, service, deactivate: () => { active = false; } };
}

function operation(vaultPath: string) {
  const directory = path.join(vaultPath, ".pige", "operations", "2026", "08");
  const file = fs.readdirSync(directory).find((entry) => entry.endsWith(".json"))!;
  return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")));
}

describe("PigePolicyService", () => {
  it("exposes only an exact validated policy snapshot to the Agent owner", () => {
    const value = fixture();
    const snapshot = readPigePolicyForAgent(value.vaultPath);
    expect(snapshot).toMatchObject({ markdown: value.service().summary().markdown });
    expect(snapshot.revision).toMatch(/^pigepolicyrev_[a-f0-9]{64}$/u);
    fs.appendFileSync(path.join(value.vaultPath, "PIGE.md"), "\napi_key=sk_abcdefghijklmnopqrstuv\n");
    expect(() => readPigePolicyForAgent(value.vaultPath)).toThrowError(
      expect.objectContaining({ code: "agent_runtime.policy_invalid" })
    );
  });

  it("validates, confirms through a prepared boundary, commits once, and replays exactly", () => {
    const value = fixture();
    const before = value.service().summary();
    const markdown = before.markdown.replace("## Agent Review Rules", "## Agent Review Rules\n\n- Keep changes concise.");
    const request = {
      apiVersion: 1 as const,
      requestId: "pigepolicyreq_abcdefghijklmnop",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      markdown
    };
    const prepared = value.service().prepare(request);
    expect(prepared.status).toBe("ready");
    const committed = value.service().commit(prepared as PigePolicyPreparedUpdate);
    expect(committed).toMatchObject({ status: "updated", summary: { markdown } });
    expect(fs.readFileSync(path.join(value.vaultPath, "PIGE.md"), "utf8")).toBe(markdown);
    expect(value.service().prepare(request)).toEqual(committed);
    expect(JSON.stringify(operation(value.vaultPath))).not.toContain(markdown);
    expect(JSON.stringify(operation(value.vaultPath))).not.toContain(value.root);
  });

  it("rejects missing sections and secret-like values before any durable effect", () => {
    const value = fixture();
    const before = value.service().summary();
    const request = (suffix: string, markdown: string) => ({
      apiVersion: 1 as const,
      requestId: `pigepolicyreq_${suffix}`,
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      markdown
    });
    expect(value.service().prepare(request("missingsectionabcd", before.markdown.replace("## Link Rules", ""))))
      .toMatchObject({ status: "invalid", issues: ["missing_required_section"] });
    expect(value.service().prepare(request("secretvalueabcdef", `${before.markdown}\napi_key = sk_abcdefghijklmnopqrstuv\n`)))
      .toMatchObject({ status: "invalid", issues: ["secret_like_content"] });
    expect(value.service().summary()).toEqual(before);
    expect(fs.existsSync(path.join(value.vaultPath, ".pige", "pige-policy-receipts"))).toBe(false);
  });

  it("publishes Activity, restores exact prior bytes through Undo, and recovers an interrupted operation", () => {
    const value = fixture();
    const before = value.service().summary();
    const request = {
      apiVersion: 1 as const,
      requestId: "pigepolicyreq_undoabcdefghijkl",
      activeVaultId: value.vault.vaultId,
      expectedRevision: before.revision,
      markdown: before.markdown.replace("## Naming Rules", "## Naming Rules\n\n- Prefer descriptive titles.")
    };
    const prepared = value.service().prepare(request) as PigePolicyPreparedUpdate;
    value.service().commit(prepared);
    const committed = operation(value.vaultPath);
    expect(value.service().activitySummary(committed)).toMatchObject({ status: "applied", canUndo: true });
    const operationFile = path.join(value.vaultPath, ".pige", "operations", "2026", "08", `${committed.id}.json`);
    fs.rmSync(operationFile);
    expect(value.service().recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    const recovered = operation(value.vaultPath);
    expect(recovered.id).toBe(committed.id);
    expect(value.service().undo(recovered).status).toBe("undone");
    expect(value.service().summary()).toEqual(before);
    const operations = fs.readdirSync(path.dirname(operationFile)).map((file) =>
      OperationRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(path.dirname(operationFile), file), "utf8"))));
    expect(value.service().activitySummary(recovered, value.service().findUndoOperation(recovered, operations)))
      .toMatchObject({ status: "undone", canUndo: false });
  });

  it("fails stale vault, revision, and external file changes closed", () => {
    const value = fixture();
    const before = value.service().summary();
    const stale = {
      apiVersion: 1 as const,
      requestId: "pigepolicyreq_staleabcdefghijklmnop",
      activeVaultId: value.vault.vaultId,
      expectedRevision: `pigepolicyrev_${"0".repeat(64)}`,
      markdown: before.markdown
    };
    expect(value.service().prepare(stale).status).toBe("stale");
    const valid = { ...stale, requestId: "pigepolicyreq_currentabcdefghijkl", expectedRevision: before.revision,
      markdown: before.markdown.replace("## Page Types", "## Page Types\n\n- Keep typed pages valid.") };
    const prepared = value.service().prepare(valid) as PigePolicyPreparedUpdate;
    fs.appendFileSync(path.join(value.vaultPath, "PIGE.md"), "\nexternal change\n");
    expect(value.service().commit(prepared).status).toBe("stale");
    value.deactivate();
    expect(() => value.service().summary()).toThrow();
  });
});
