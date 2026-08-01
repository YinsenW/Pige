import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentConversationHistory } from "../../apps/desktop/src/main/services/agent-conversation-history";
import { AgentTurnConversationStore } from "../../apps/desktop/src/main/services/agent-turn-conversation-store";
import { ConversationTrashService } from "../../apps/desktop/src/main/services/conversation-trash-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ConversationTrashService", () => {
  it("moves exact JSONL bytes to private trash and restores them restart-safely without provider replay", () => {
    const fixture = createFixture();
    const history = new AgentConversationHistory();
    const listed = history.list({ activeVaultId: fixture.vault.vaultId, vaultPath: fixture.vaultPath });
    const summary = listed.conversations[0]!;
    expect(summary.revision).toMatch(/^conversationrev_[a-f0-9]{64}$/u);
    const before = fs.readFileSync(fixture.conversationPath);
    const request = {
      apiVersion: 1 as const,
      requestId: "conversationtrashreq_abcdefghijklmnop",
      activeVaultId: fixture.vault.vaultId,
      conversationId: fixture.conversationId,
      expectedRevision: summary.revision!
    };

    const committed = fixture.service.trash(request);
    expect(committed).toMatchObject({
      status: "committed",
      trashEntryId: expect.stringMatching(/^conversationtrash_[a-f0-9]{32}$/u),
      operationId: expect.stringMatching(/^op_20260731_[a-f0-9]{16}$/u)
    });
    expect(fs.existsSync(fixture.conversationPath)).toBe(false);
    expect(history.list({ activeVaultId: fixture.vault.vaultId, vaultPath: fixture.vaultPath }).conversations).toEqual([]);
    const trashPayloadPath = findTrashPayload(fixture.vaultPath);
    const interruptedQuarantinePath = path.join(path.dirname(trashPayloadPath), `.${path.basename(fixture.conversationPath)}.lifecycle-quarantine`);
    fs.linkSync(trashPayloadPath, interruptedQuarantinePath);

    const restarted = new ConversationTrashService(fixture.vaults, new AgentConversationHistory(), {
      now: () => new Date("2026-07-31T12:30:00.000Z"),
      randomId: () => "must-not-create-another-operation"
    });
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.existsSync(interruptedQuarantinePath)).toBe(false);
    expect(restarted.trash(request)).toEqual(committed);
    const trash = restarted.list({ apiVersion: 1, activeVaultId: fixture.vault.vaultId });
    expect(trash).toMatchObject({ status: "ready", conversations: [{
      conversationId: fixture.conversationId,
      safePreview: "Keep this conversation",
      revision: summary.revision
    }] });
    expect(JSON.stringify(trash)).not.toContain(fixture.vaultPath);
    expect(JSON.stringify(trash)).not.toContain("Provider response must remain only in JSONL");
    if (trash.status !== "ready") throw new Error("Trash inventory was unavailable.");

    const restoreRequest = {
      apiVersion: 1 as const,
      requestId: "conversationtrashreq_restoreabcdefghij",
      activeVaultId: fixture.vault.vaultId,
      trashEntryId: trash.conversations[0]!.trashEntryId,
      conversationId: fixture.conversationId,
      expectedRevision: trash.conversations[0]!.revision
    };
    fs.linkSync(trashPayloadPath, fixture.conversationPath);
    const restored = restarted.restore(restoreRequest);
    expect(restored).toMatchObject({ status: "restored", operationId: expect.stringMatching(/^op_20260731_[a-f0-9]{16}$/u) });
    expect(fs.readFileSync(fixture.conversationPath)).toEqual(before);
    expect(restarted.list({ apiVersion: 1, activeVaultId: fixture.vault.vaultId })).toMatchObject({ status: "ready", conversations: [] });
    fs.linkSync(fixture.conversationPath, trashPayloadPath);
    fs.unlinkSync(fixture.conversationPath);
    const interruptedRestore = new ConversationTrashService(fixture.vaults);
    expect(interruptedRestore.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.existsSync(trashPayloadPath)).toBe(false);
    expect(interruptedRestore.restore(restoreRequest)).toMatchObject({ status: "already_restored" });
    expect(fs.readFileSync(fixture.conversationPath)).toEqual(before);

    const operations = readOperations(fixture.vaultPath);
    expect(operations.map((operation) => operation.kind).sort()).toEqual(["restore_conversation", "trash_conversation"]);
    expect(JSON.stringify(operations)).not.toContain("Provider response must remain only in JSONL");
  });

  it("fails stale without replacing changed or newly occupied conversation history", () => {
    const changed = createFixture();
    const summary = new AgentConversationHistory().list({ activeVaultId: changed.vault.vaultId, vaultPath: changed.vaultPath }).conversations[0]!;
    const changedLines = fs.readFileSync(changed.conversationPath, "utf8").trimEnd().split("\n");
    const changedUser = JSON.parse(changedLines[0]!) as Record<string, unknown>;
    changedUser.text = "Externally changed conversation";
    changedLines[0] = JSON.stringify(changedUser);
    fs.writeFileSync(changed.conversationPath, `${changedLines.join("\n")}\n`, "utf8");
    expect(changed.service.trash({
      apiVersion: 1,
      requestId: "conversationtrashreq_changedabcdefgh",
      activeVaultId: changed.vault.vaultId,
      conversationId: changed.conversationId,
      expectedRevision: summary.revision!
    })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(changed.conversationPath, "utf8")).toContain("Externally changed conversation");

    const occupied = createFixture();
    const occupiedSummary = new AgentConversationHistory().list({ activeVaultId: occupied.vault.vaultId, vaultPath: occupied.vaultPath }).conversations[0]!;
    const trashed = occupied.service.trash({
      apiVersion: 1,
      requestId: "conversationtrashreq_occupiedabcdefgh",
      activeVaultId: occupied.vault.vaultId,
      conversationId: occupied.conversationId,
      expectedRevision: occupiedSummary.revision!
    });
    if (trashed.status !== "committed") throw new Error("Fixture conversation was not trashed.");
    fs.mkdirSync(path.dirname(occupied.conversationPath), { recursive: true });
    fs.writeFileSync(occupied.conversationPath, "Unrelated replacement.\n", "utf8");
    expect(occupied.service.restore({
      apiVersion: 1,
      requestId: "conversationtrashreq_restoreoccupiedx",
      activeVaultId: occupied.vault.vaultId,
      trashEntryId: trashed.trashEntryId,
      conversationId: occupied.conversationId,
      expectedRevision: occupiedSummary.revision!
    })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(occupied.conversationPath, "utf8")).toBe("Unrelated replacement.\n");
    expect(occupied.service.list({ apiVersion: 1, activeVaultId: occupied.vault.vaultId })).toMatchObject({ status: "ready", conversations: [{ conversationId: occupied.conversationId }] });
  });

  it("permanently deletes only exact trashed bytes after durable tombstone and irreversible operation", () => {
    const fixture = createFixture();
    const summary = new AgentConversationHistory()
      .list({ activeVaultId: fixture.vault.vaultId, vaultPath: fixture.vaultPath }).conversations[0]!;
    const trashed = fixture.service.trash({
      apiVersion: 1,
      requestId: "conversationtrashreq_purgefixtureabcd",
      activeVaultId: fixture.vault.vaultId,
      conversationId: fixture.conversationId,
      expectedRevision: summary.revision!
    });
    if (trashed.status !== "committed") throw new Error("Fixture conversation was not trashed.");
    const request = {
      apiVersion: 1 as const,
      requestId: "conversationpurgereq_abcdefghijklmnop",
      activeVaultId: fixture.vault.vaultId,
      trashEntryId: trashed.trashEntryId,
      conversationId: fixture.conversationId,
      expectedRevision: summary.revision!,
      confirmation: "delete_permanently" as const
    };
    const trashPayload = findTrashPayload(fixture.vaultPath);
    const originalUnlink = fs.unlinkSync.bind(fs);
    const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation((filePath) => {
      if (String(filePath).endsWith(".purge-quarantine")) throw new Error("simulated interruption");
      return originalUnlink(filePath);
    });
    expect(fixture.service.purge(request)).toMatchObject({ status: "failed" });
    unlink.mockRestore();
    expect(fs.existsSync(`${trashPayload}.purge-quarantine`)).toBe(true);
    const operationsBeforeRecovery = readOperations(fixture.vaultPath);
    expect(operationsBeforeRecovery.map(({ kind }) => kind)).toContain("purge_conversation");

    const restarted = new ConversationTrashService(fixture.vaults, new AgentConversationHistory());
    expect(restarted.recoverIncompleteOperations()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.existsSync(trashPayload)).toBe(false);
    expect(fs.existsSync(`${trashPayload}.purge-quarantine`)).toBe(false);
    expect(restarted.list({ apiVersion: 1, activeVaultId: fixture.vault.vaultId }))
      .toMatchObject({ status: "ready", conversations: [] });
    const committed = restarted.purge(request);
    expect(committed).toMatchObject({ status: "committed", operationId: expect.stringMatching(/^op_20260731_/u) });
    expect(restarted.restore({
      apiVersion: 1,
      requestId: "conversationtrashreq_restorepurgedabcd",
      activeVaultId: fixture.vault.vaultId,
      trashEntryId: trashed.trashEntryId,
      conversationId: fixture.conversationId,
      expectedRevision: summary.revision!
    })).toMatchObject({ status: "not_found" });
    const durable = JSON.stringify(readOperations(fixture.vaultPath));
    expect(durable).not.toContain("Provider response must remain only in JSONL");
    expect(durable).not.toContain(fixture.vaultPath);
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-conversation-trash-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Conversation Trash",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-31T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Conversation Trash");
  const vault = loadVaultSummary(vaultPath);
  const store = new AgentTurnConversationStore();
  const turn = store.appendUserTurn(
    vaultPath,
    "Keep this conversation",
    { inputKind: "typed_text", locale: "en" },
    { clientTurnId: "turn_20260731_conversationtrash01" }
  );
  store.appendAssistantTurn(vaultPath, turn, "job_20260731_conversationtrash01", "Provider response must remain only in JSONL");
  const conversationId = turn.event.conversationId;
  const conversationPath = path.join(vaultPath, ".pige", "conversations", "2026", "07", `${conversationId}.jsonl`);
  const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
  return {
    vaultPath,
    vault,
    vaults,
    conversationId,
    conversationPath,
    service: new ConversationTrashService(vaults, new AgentConversationHistory(), {
      now: () => new Date("2026-07-31T12:00:00.000Z"),
      randomId: () => "fixed-conversation-random-id"
    })
  };
}

function readOperations(vaultPath: string): Array<{ readonly kind: string }> {
  const root = path.join(vaultPath, ".pige", "operations", "2026", "07");
  return fs.readdirSync(root).sort().map((name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8")) as { kind: string });
}

function findTrashPayload(vaultPath: string): string {
  const root = path.join(vaultPath, ".pige", "trash", "conversations");
  const entry = fs.readdirSync(root)[0];
  if (!entry) throw new Error("Missing conversation trash entry.");
  const payload = fs.readdirSync(path.join(root, entry)).find((name) => name.endsWith(".jsonl"));
  if (!payload) throw new Error("Missing conversation trash payload.");
  return path.join(root, entry, payload);
}
