import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentConversationExportArtifactSchema } from "@pige/schemas";
import { AgentConversationExportService } from "../../apps/desktop/src/main/services/agent-conversation-export-service";
import { AgentConversationHistory } from "../../apps/desktop/src/main/services/agent-conversation-history";

const roots: string[] = [];
const vaultId = "vault_20260731_export01";
const conversationId = "conv_20260731_export01";
const userEventId = "evt_20260731_user0001";
const sourceEventId = "evt_20260731_source001";
const assistantEventId = "evt_20260731_assistant01";
const request = {
  apiVersion: 1,
  requestId: "conversation_export_request_abcdefghijklmnop",
  activeVaultId: vaultId,
  conversationId,
  expectedTailEventId: assistantEventId
} as const;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AgentConversationExportService", () => {
  it("exports an exact ordered projection while preserving citation and source references", () => {
    const vaultPath = createVault(conversationEvents());
    const destination = exportPath();
    const original = fs.readFileSync(conversationPath(vaultPath), "utf8");
    const service = new AgentConversationExportService(
      undefined,
      () => new Date("2026-07-31T10:05:00.000Z"),
      () => Buffer.from("0123456789abcdef", "hex")
    );

    expect(service.export({ vaultId, vaultPath }, request, destination)).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: vaultId,
      conversationId,
      status: "exported",
      tailEventId: assistantEventId,
      eventCount: 3
    });
    const artifact = AgentConversationExportArtifactSchema.parse(JSON.parse(fs.readFileSync(destination, "utf8")));
    expect(artifact.events.map(({ eventId }) => eventId)).toEqual([userEventId, sourceEventId, assistantEventId]);
    expect(artifact.events.filter(({ kind }) => kind === "message").map(({ role }) => role))
      .toEqual(["user", "assistant"]);
    expect(artifact.events[1]).toMatchObject({
      kind: "source_reference",
      sourceId: "src_20260731_source001",
      displayName: "Quarterly report.pdf",
      sourceKind: "pdf_file"
    });
    expect(artifact.events[2]).toMatchObject({
      kind: "message",
      citations: [{ kind: "page", refId: "citation_1", pageId: "page_20260731_export01" }]
    });
    expect(JSON.stringify(artifact)).not.toMatch(/locator|sourceBody|sourcePath|providerId|rawToolPayload|rawModelPayload/iu);
    expect(fs.readFileSync(conversationPath(vaultPath), "utf8")).toBe(original);
    expect(fs.statSync(destination).mode & 0o777).toBe(0o600);

    expect(new AgentConversationExportService().export({ vaultId, vaultPath }, request, destination))
      .toMatchObject({ status: "exported", eventCount: 3 });
  });

  it("returns stale or not-found without creating an output", () => {
    const vaultPath = createVault(conversationEvents());
    const staleDestination = exportPath();
    expect(new AgentConversationExportService().export({ vaultId, vaultPath }, {
      ...request,
      expectedTailEventId: userEventId
    }, staleDestination)).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: vaultId,
      conversationId,
      status: "stale",
      currentTailEventId: assistantEventId
    });
    expect(fs.existsSync(staleDestination)).toBe(false);

    const missingDestination = exportPath();
    expect(new AgentConversationExportService().export({ vaultId, vaultPath }, {
      ...request,
      conversationId: "conv_20260731_missing01"
    }, missingDestination)).toMatchObject({ status: "not_found" });
    expect(fs.existsSync(missingDestination)).toBe(false);
  });

  it("rechecks the exact durable bytes and tail before creating an output", () => {
    const vaultPath = createVault(conversationEvents());
    const destination = exportPath();
    let reads = 0;
    class MutatingHistory extends AgentConversationHistory {
      override readConversationEvents(input: { readonly vaultPath: string; readonly conversationId: string }) {
        if (reads++ === 1) {
          const events = conversationEvents();
          events.push({
            schemaVersion: 1,
            id: "evt_20260731_newtail01",
            conversationId,
            type: "user_message",
            createdAt: "2026-07-31T10:01:00.000Z",
            parentEventId: assistantEventId,
            text: "A concurrent durable follow-up."
          });
          writeConversation(vaultPath, events);
        }
        return super.readConversationEvents(input);
      }
    }

    expect(new AgentConversationExportService(new MutatingHistory()).export(
      { vaultId, vaultPath },
      request,
      destination
    )).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: vaultId,
      conversationId,
      status: "stale",
      currentTailEventId: "evt_20260731_newtail01"
    });
    expect(fs.existsSync(destination)).toBe(false);
  });

  it("fails closed for restricted content and unsafe destinations without changing history", () => {
    const restrictedEvents = conversationEvents().map((event) => event.id === userEventId
      ? { ...event, text: "api_key=sk-example-secret-value-123456789" }
      : event);
    const vaultPath = createVault(restrictedEvents);
    const destination = exportPath();
    const original = fs.readFileSync(conversationPath(vaultPath), "utf8");
    expect(new AgentConversationExportService().export({ vaultId, vaultPath }, request, destination))
      .toMatchObject({ status: "failed" });
    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.readFileSync(conversationPath(vaultPath), "utf8")).toBe(original);

    writeConversation(vaultPath, conversationEvents());
    const outside = createRoot("pige-conversation-export-outside-");
    const symlink = path.join(outside, "conversation.json");
    fs.symlinkSync(path.join(outside, "missing-target.json"), symlink);
    expect(new AgentConversationExportService().export({ vaultId, vaultPath }, request, symlink))
      .toMatchObject({ status: "failed" });
    expect(fs.lstatSync(symlink).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(conversationPath(vaultPath), "utf8")).toBe(original.replace(
      "api_key=sk-example-secret-value-123456789",
      "Summarize this source."
    ));
  });
});

function conversationEvents(): Record<string, unknown>[] {
  return [
    {
      schemaVersion: 1,
      id: userEventId,
      conversationId,
      type: "user_message",
      createdAt: "2026-07-31T09:59:00.000Z",
      text: "Summarize this source.",
      providerId: "private-provider",
      rawToolPayload: { sourcePath: "/private/vault/report.pdf" }
    },
    {
      schemaVersion: 1,
      id: sourceEventId,
      conversationId,
      type: "source_reference",
      createdAt: "2026-07-31T09:59:01.000Z",
      parentEventId: userEventId,
      sourceId: "src_20260731_source001",
      displayName: "Quarterly report.pdf",
      sourceKind: "pdf_file",
      sourceBody: "private source body",
      sourcePath: "/private/vault/report.pdf"
    },
    {
      schemaVersion: 1,
      id: assistantEventId,
      conversationId,
      type: "assistant_message",
      createdAt: "2026-07-31T10:00:00.000Z",
      parentEventId: userEventId,
      text: "The report is grounded in one local page.",
      answerCitations: [{
        refId: "citation_1",
        label: "[1]",
        pageId: "page_20260731_export01",
        title: "Quarterly report",
        pageType: "source",
        locator: "paragraph:1"
      }],
      rawModelPayload: { internal: true }
    },
    {
      schemaVersion: 1,
      id: "evt_20260731_modelcall1",
      conversationId,
      type: "model_call_summary",
      createdAt: "2026-07-31T10:00:01.000Z",
      textPreview: "internal model call",
      rawModelPayload: { internal: true }
    }
  ];
}

function createVault(events: readonly Record<string, unknown>[]): string {
  const root = createRoot("pige-conversation-export-vault-");
  writeConversation(root, events);
  return root;
}

function writeConversation(vaultPath: string, events: readonly Record<string, unknown>[]): void {
  const filePath = conversationPath(vaultPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, { mode: 0o600 });
}

function conversationPath(vaultPath: string): string {
  return path.join(vaultPath, ".pige/conversations/2026/07", `${conversationId}.jsonl`);
}

function exportPath(): string {
  return path.join(fs.realpathSync.native(createRoot("pige-conversation-export-output-")), "conversation.json");
}

function createRoot(prefix: string): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}
