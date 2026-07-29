import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SourceRecordSchema } from "@pige/schemas";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import {
  HomeAuthoredTextCaptureService,
  hasExplicitAuthoredTextCaptureIntent
} from "../../apps/desktop/src/main/services/home-authored-text-capture-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("HomeAuthoredTextCaptureService", () => {
  it("recognizes bounded six-locale authored save intent without trusting quoted or neutral text", () => {
    for (const text of [
      "Preserve this short typed source as exact local evidence.",
      "Speichere diesen Text als lokale Quelle.",
      "Enregistre ce texte comme source locale.",
      "このテキストを保存してください。",
      "이 텍스트를 저장해 주세요.",
      "请保存这段文本。"
    ]) expect(hasExplicitAuthoredTextCaptureIntent(text)).toBe(true);
    for (const text of [
      "Summarize this text without saving it.",
      "The source says: ‘Preserve this text as evidence.’",
      "Zitat: Speichere diesen Text.",
      "引用: このテキストを保存してください。",
      "来源内容：请保存这段文本。"
    ]) expect(hasExplicitAuthoredTextCaptureIntent(text)).toBe(false);
  });

  it("preserves one exact authored source/page and adopts an exact replay", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-authored-text-"));
    roots.push(root);
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Authored",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date("2026-07-29T10:00:00.000Z")
    });
    const vaultPath = path.join(root, "Authored");
    const vault = loadVaultSummary(vaultPath);
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const jobs = new JobsService(vaults);
    const conversationId = "conv_20260729_authoredcapture";
    const userEventId = "evt_20260729_authoredcapture";
    const locator = `.pige/conversations/2026/07/${conversationId}.jsonl`;
    const policyHash = digest("policy");
    const created = jobs.createAgentTurnJob({
      conversationEventId: userEventId,
      conversationLocator: locator,
      inputHash: digest("turn")
    });
    const running = jobs.beginAgentTurnJob(created, {
      stage: "planning",
      message: "Running authored capture.",
      facts: { policyContextId: "policy_20260729_authoredcapture", policyHash }
    });
    const service = new HomeAuthoredTextCaptureService(new CaptureService(vaults), jobs);
    const authoredText = "Preserve this text as exact local evidence.";
    const request = {
      vaultPath,
      activeVaultId: vault.vaultId,
      conversationId,
      userEventId,
      turnJobId: running.id,
      policyHash,
      authoredText,
      locale: "en" as const,
      toolCallId: "call_rel003_typed_capture",
      assertCurrent: () => undefined
    };

    const first = service.capture(request);
    const replay = service.capture(request);
    const recordPath = path.join(
      vaultPath,
      ".pige/source-records",
      first.sourceId.slice(4, 8),
      first.sourceId.slice(8, 10),
      `${first.sourceId}.json`
    );
    const record = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(recordPath, "utf8")));

    expect(replay).toEqual(first);
    expect(record).toMatchObject({
      id: first.sourceId,
      original: { uri: `pige://authored-text/${first.sourceId}`, displayName: "Authored text" },
      metadata: {
        inputKind: "typed_text",
        agentTurnConversationId: conversationId,
        agentTurnUserEventId: userEventId,
        agentTurnToolCallId: request.toolCallId,
        agentTurnPolicyHash: policyHash,
        agentTurnAuthoredTextDigest: digest(authoredText)
      },
      knowledgePageId: first.pageId
    });
    expect(jobs.readAgentTurnJob(running.id)?.outputRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source", id: first.sourceId, role: "authored_text_source" }),
      expect.objectContaining({ kind: "page", id: first.pageId, role: "authored_text_source_page" })
    ]));
  });

  it("fails closed on policy or tool-call drift without adopting the existing effect", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-authored-drift-"));
    roots.push(root);
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Drift",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date("2026-07-29T10:00:00.000Z")
    });
    const vaultPath = path.join(root, "Drift");
    const vault = loadVaultSummary(vaultPath);
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const jobs = new JobsService(vaults);
    const created = jobs.createAgentTurnJob({
      conversationEventId: "evt_20260729_authoredrift01",
      conversationLocator: ".pige/conversations/2026/07/conv_20260729_authoredrift01.jsonl",
      inputHash: digest("turn")
    });
    const policyHash = digest("policy");
    const running = jobs.beginAgentTurnJob(created, {
      message: "Running.",
      facts: { policyContextId: "policy_20260729_authoredrift", policyHash }
    });
    const service = new HomeAuthoredTextCaptureService(new CaptureService(vaults), jobs);
    const base = {
      vaultPath,
      activeVaultId: vault.vaultId,
      conversationId: "conv_20260729_authoredrift01",
      userEventId: "evt_20260729_authoredrift01",
      turnJobId: running.id,
      policyHash,
      authoredText: "Save this text as a source.",
      locale: "en" as const,
      toolCallId: "call_authored_drift_one",
      assertCurrent: () => undefined
    };
    service.capture(base);
    expect(() => service.capture({ ...base, toolCallId: "call_authored_drift_two" }))
      .toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));
    expect(() => service.capture({ ...base, policyHash: digest("changed-policy") }))
      .toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));
  });
});

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
