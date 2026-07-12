import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTurnConversationStore } from "../../apps/desktop/src/main/services/agent-turn-conversation-store";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent turn conversation store", () => {
  it("persists and reads back a user turn bound to its domain-separated hash", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const text = "  Synthetic user turn for a general Agent conversation.  ";

    const preserved = service.appendUserTurn(vaultPath, text);
    const resumed = service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      preserved.inputHash
    );
    const events = readEvents(vaultPath, preserved.locator);

    expect(preserved.event).toMatchObject({
      type: "user_message",
      text: text.trim()
    });
    expect(preserved.locator).toMatch(
      /^\.pige\/conversations\/\d{4}\/\d{2}\/conv_\d{8}\.jsonl$/u
    );
    expect(preserved.inputHash).toBe(hashValue(`pige.agent_turn.user.v1\0${text.trim()}\0null`));
    expect(resumed).toEqual(preserved);
    expect(events).toEqual([preserved.event]);
  });

  it("appends a bounded assistant event without duplicating the user or source-like body", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const syntheticBody = `SYNTHETIC_SOURCE_BODY_${"x".repeat(32 * 1024)}`;
    const userText = `Analyze the already-preserved source reference. ${syntheticBody}`;
    const userTurn = service.appendUserTurn(vaultPath, userText);

    const assistant = service.appendAssistantTurn(
      vaultPath,
      userTurn,
      "job_20260712_abcdef123456",
      "Synthetic concise answer based on the referenced source."
    );
    const events = readEvents(vaultPath, userTurn.locator);
    const fileText = readConversationFile(vaultPath, userTurn.locator);

    expect(events).toHaveLength(2);
    expect(events[1]).toEqual(assistant);
    expect(events[1]).toMatchObject({
      conversationId: userTurn.event.conversationId,
      type: "assistant_message",
      jobId: "job_20260712_abcdef123456",
      text: "Synthetic concise answer based on the referenced source."
    });
    expect(events[1]).not.toHaveProperty("sourceId");
    expect(events[1]).not.toHaveProperty("captureId");
    expect(JSON.stringify(events[1])).not.toContain("SYNTHETIC_SOURCE_BODY_");
    expect(fileText.split(syntheticBody)).toHaveLength(2);
  });

  it("stores only a neutral marker for restricted input while retaining its opaque hash binding", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const opaqueOriginal = "Synthetic private memory with opaque credential zebra-frost-91.";

    const preserved = service.appendBlockedTurnMarker(vaultPath, opaqueOriginal);
    const fileText = readConversationFile(vaultPath, preserved.locator);

    expect(preserved.event).toMatchObject({
      type: "error",
      text: "Restricted content was blocked before Agent ingress."
    });
    expect(preserved.inputHash).toBe(hashValue(`pige.agent_turn.blocked.v1\0${opaqueOriginal}\0null`));
    expect(preserved.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(fileText).not.toContain(opaqueOriginal);
    expect(fileText).not.toContain("zebra-frost-91");
    expect(fileText).not.toContain("private memory");
  });

  it("fails closed for a mismatched expected hash and a tampered stored user turn", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const preserved = service.appendUserTurn(vaultPath, "Original synthetic turn.");
    const otherHash = hashValue("pige.agent_turn.user.v1\0Different synthetic turn.");

    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      otherHash
    ))).toMatchObject({ code: "agent_runtime.turn_changed" });

    const events = readEvents(vaultPath, preserved.locator);
    events[0] = { ...events[0], text: "Tampered synthetic turn." };
    fs.writeFileSync(
      conversationPath(vaultPath, preserved.locator),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    );

    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      preserved.inputHash
    ))).toMatchObject({ code: "agent_runtime.turn_changed" });
  });

  it("rejects malformed hashes, locators, missing events, and non-user assistant bindings", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const preserved = service.appendUserTurn(vaultPath, "Synthetic binding checks.");
    const blocked = service.appendBlockedTurnMarker(vaultPath, "Synthetic blocked binding.");

    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      "sha256:not-a-checksum"
    ))).toMatchObject({ code: "agent_runtime.turn_binding_invalid" });
    expect(captureError(() => service.readUserTurn(
      vaultPath,
      "../outside.jsonl",
      preserved.event.id,
      preserved.inputHash
    ))).toMatchObject({ code: "agent_runtime.turn_binding_invalid" });
    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      "evt_20260712_missing12",
      preserved.inputHash
    ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });
    expect(captureError(() => service.appendAssistantTurn(
      vaultPath,
      blocked,
      "job_20260712_abcdef123456",
      "This must not append."
    ))).toMatchObject({ code: "agent_runtime.turn_binding_invalid" });
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked conversation directory without writing outside the vault",
    () => {
      const vaultPath = makeVault();
      const outside = makeTempRoot("pige-agent-turn-outside-dir-");
      fs.mkdirSync(path.join(vaultPath, ".pige"), { recursive: true });
      fs.symlinkSync(outside, path.join(vaultPath, ".pige", "conversations"), "dir");

      expect(captureError(() => new AgentTurnConversationStore().appendUserTurn(
        vaultPath,
        "Synthetic turn must remain confined."
      ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });
      expect(fs.readdirSync(outside)).toEqual([]);
    }
  );

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked conversation file for read and append without changing its target",
    () => {
      const vaultPath = makeVault();
      const service = new AgentTurnConversationStore();
      const preserved = service.appendUserTurn(vaultPath, "Synthetic turn before file substitution.");
      const filePath = conversationPath(vaultPath, preserved.locator);
      const outsideRoot = makeTempRoot("pige-agent-turn-outside-file-");
      const outsideFile = path.join(outsideRoot, "external.jsonl");
      fs.writeFileSync(outsideFile, "SYNTHETIC_EXTERNAL_CONTENT\n", "utf8");
      fs.rmSync(filePath);
      fs.symlinkSync(outsideFile, filePath, "file");

      expect(captureError(() => service.readUserTurn(
        vaultPath,
        preserved.locator,
        preserved.event.id,
        preserved.inputHash
      ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });
      expect(captureError(() => service.appendAssistantTurn(
        vaultPath,
        preserved,
        "job_20260712_abcdef123456",
        "This must not reach the external file."
      ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });
      expect(fs.readFileSync(outsideFile, "utf8")).toBe("SYNTHETIC_EXTERNAL_CONTENT\n");
    }
  );

  it("rejects empty, null-containing, and oversized turn text before persistence", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();

    for (const text of ["   ", "synthetic\0turn", "x".repeat(64 * 1024 + 1)]) {
      expect(captureError(() => service.appendUserTurn(vaultPath, text))).toMatchObject({
        code: "agent_runtime.turn_invalid"
      });
    }
    expect(fs.existsSync(path.join(vaultPath, ".pige", "conversations"))).toBe(false);
  });

  it("rejects an oversized or invalid conversation file during resume", () => {
    const vaultPath = makeVault();
    const service = new AgentTurnConversationStore();
    const preserved = service.appendUserTurn(vaultPath, "Synthetic turn for file-bound checks.");
    const filePath = conversationPath(vaultPath, preserved.locator);

    fs.writeFileSync(filePath, "{not-json}\n", "utf8");
    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      preserved.inputHash
    ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });

    fs.truncateSync(filePath, 8 * 1024 * 1024 + 1);
    expect(captureError(() => service.readUserTurn(
      vaultPath,
      preserved.locator,
      preserved.event.id,
      preserved.inputHash
    ))).toMatchObject({ code: "agent_runtime.turn_unavailable" });
  });
});

function makeVault(): string {
  const root = makeTempRoot("pige-agent-turn-store-");
  const vaultPath = path.join(root, "Vault");
  fs.mkdirSync(vaultPath, { recursive: true });
  return vaultPath;
}

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function conversationPath(vaultPath: string, locator: string): string {
  return path.join(vaultPath, ...locator.split("/"));
}

function readConversationFile(vaultPath: string, locator: string): string {
  return fs.readFileSync(conversationPath(vaultPath, locator), "utf8");
}

function readEvents(vaultPath: string, locator: string): Array<Record<string, unknown>> {
  return readConversationFile(vaultPath, locator)
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (caught) {
    return caught;
  }
  throw new Error("Expected action to throw.");
}
