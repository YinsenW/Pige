import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSubmitTurnRequest,
  ReaderSelectionActionRequest,
  ReaderSelectionIdentity
} from "@pige/contracts";
import { ReaderSelectionActionService } from "../../apps/desktop/src/main/services/reader-selection-action-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Reader selection action service", () => {
  it("builds a durable current-note intent without copying selected body into the turn text", async () => {
    const fixture = makeFixture("Before. SELECTED_PRIVATE_PASSAGE. After.");
    const submitTurn = vi.fn(async () => ({
      requestId: "job_20260718_action1234",
      jobId: "job_20260718_action1234",
      conversationEventId: "evt_20260718_action1234",
      conversationId: "conv_20260718_action",
      tailEventId: "evt_20260718_answer1234",
      state: "completed" as const,
      modelUsage: "cloud" as const,
      sourceIds: [],
      answer: { answer: "Explanation", grounding: "local_knowledge" as const, citations: [] }
    }));
    const service = new ReaderSelectionActionService(fixture.vaults, { submitTurn });
    const request = actionRequest(fixture.selection, "explain");

    const result = await service.submit(request);
    expect(result).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      status: "completed",
      jobId: "job_20260718_action1234",
      conversationEventId: "evt_20260718_action1234",
      conversationId: "conv_20260718_action",
      tailEventId: "evt_20260718_answer1234"
    });
    const [turn, context] = submitTurn.mock.calls[0]!;
    expect((turn as AgentSubmitTurnRequest).text).toContain("Explain the selected passage");
    expect((turn as AgentSubmitTurnRequest).text).not.toContain("SELECTED_PRIVATE_PASSAGE");
    expect(context).toMatchObject({ currentNoteSelection: fixture.selection });
    expect(JSON.stringify(result)).not.toContain("SELECTED_PRIVATE_PASSAGE");
  });

  it("fails closed before Agent submission when page or selection identity changed", async () => {
    const fixture = makeFixture("Before. SELECTED_PRIVATE_PASSAGE. After.");
    const submitTurn = vi.fn();
    const service = new ReaderSelectionActionService(fixture.vaults, { submitTurn });
    const changedPage = actionRequest({
      ...fixture.selection,
      pageContentHash: `sha256:${"f".repeat(64)}`
    }, "summarize");
    await expect(service.submit(changedPage)).resolves.toMatchObject({
      status: "invalid",
      reason: "page_changed"
    });
    const changedSelection = actionRequest({
      ...fixture.selection,
      selectedContentHash: `sha256:${"e".repeat(64)}`
    }, "summarize");
    await expect(service.submit(changedSelection)).resolves.toMatchObject({
      status: "invalid",
      reason: "selection_changed"
    });
    expect(submitTurn).not.toHaveBeenCalled();
  });

  it("projects waiting Agent state without answer or provider-body fields", async () => {
    const fixture = makeFixture("Before. SELECTED_PRIVATE_PASSAGE. After.");
    const submitTurn = vi.fn(async () => ({
      requestId: "job_20260718_waiting123",
      jobId: "job_20260718_waiting123",
      conversationEventId: "evt_20260718_waiting123",
      conversationId: "conv_20260718_waiting",
      tailEventId: "evt_20260718_waiting123",
      state: "waiting" as const,
      modelUsage: "cloud" as const,
      sourceIds: [],
      error: {
        code: "model_provider.egress_confirmation_required",
        domain: "model_provider",
        messageKey: "errors.model_provider.egress_confirmation_required",
        retryable: false,
        severity: "warning" as const,
        userAction: "confirm_model_egress" as const,
        modelEgressApprovalRequestId: "modegress_20260718_waiting123"
      }
    }));
    const service = new ReaderSelectionActionService(fixture.vaults, { submitTurn });

    const result = await service.submit(actionRequest(fixture.selection, "summarize"));

    expect(result).toMatchObject({
      status: "waiting",
      error: {
        code: "model_provider.egress_confirmation_required",
        messageKey: "errors.model_provider.egress_confirmation_required"
      }
    });
    expect(JSON.stringify(result)).not.toContain("SELECTED_PRIVATE_PASSAGE");
    expect(JSON.stringify(result)).not.toContain("answer");
  });

  it("keeps read-only Agent actions within the current-note model evidence budget", async () => {
    const fixture = makeFixture("small body");
    const submitTurn = vi.fn();
    const service = new ReaderSelectionActionService(fixture.vaults, { submitTurn });
    await expect(service.submit(actionRequest({
      ...fixture.selection,
      span: { unit: "utf8_bytes", start: 1, endExclusive: (8 * 1024) + 2 }
    }, "explain"))).resolves.toMatchObject({
      status: "invalid",
      reason: "selection_too_large"
    });
    expect(submitTurn).not.toHaveBeenCalled();
  });

  it("keeps transform replacement main-owned and returns only its durable Operation identity", async () => {
    const fixture = makeFixture("Before. SELECTED_PRIVATE_PASSAGE. After.");
    const submitTurn = vi.fn(async () => ({
      requestId: "job_20260718_transform12",
      jobId: "job_20260718_transform12",
      conversationEventId: "evt_20260718_transform12",
      conversationId: "conv_20260718_transform",
      tailEventId: "evt_20260718_transformanswer",
      state: "completed" as const,
      modelUsage: "cloud" as const,
      sourceIds: [],
      answer: {
        answer: "MAIN_ONLY_REPLACEMENT",
        grounding: "local_knowledge" as const,
        citations: []
      }
    }));
    const readJob = vi.fn(() => ({
      id: "job_20260718_transform12",
      operationIds: ["op_20260718_transform12"]
    } as never));
    const readAppliedOperationId = vi.fn(() => "op_20260718_transform12");
    const service = new ReaderSelectionActionService(
      fixture.vaults,
      { submitTurn },
      { readJob, readAppliedOperationId }
    );
    const request = {
      ...actionRequest(fixture.selection, "explain"),
      action: "polish" as const
    };

    const result = await service.submitTransform(request);

    expect(result).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      status: "applied",
      jobId: "job_20260718_transform12",
      conversationEventId: "evt_20260718_transform12",
      conversationId: "conv_20260718_transform",
      tailEventId: "evt_20260718_transformanswer",
      operationId: "op_20260718_transform12"
    });
    expect(readAppliedOperationId).toHaveBeenCalledWith(expect.objectContaining({
      action: "polish",
      selection: fixture.selection
    }));
    expect(submitTurn.mock.calls[0]?.[1]).toMatchObject({
      currentNoteSelection: fixture.selection,
      currentNoteTransformAction: "polish"
    });
    expect(JSON.stringify(result)).not.toContain("MAIN_ONLY_REPLACEMENT");
    expect(JSON.stringify(submitTurn.mock.calls[0]?.[0])).not.toContain("SELECTED_PRIVATE_PASSAGE");
  });

  it("projects an ineligible mutation target without exposing the model replacement", async () => {
    const fixture = makeFixture("Before. SELECTED_PRIVATE_PASSAGE. After.");
    const submitTurn = vi.fn(async () => ({
      requestId: "job_20260718_ineligible12",
      jobId: "job_20260718_ineligible12",
      conversationEventId: "evt_20260718_ineligible12",
      conversationId: "conv_20260718_ineligible",
      tailEventId: "evt_20260718_ineligibleanswer",
      state: "completed" as const,
      modelUsage: "cloud" as const,
      sourceIds: [],
      answer: {
        answer: "PRIVATE_MODEL_REPLACEMENT",
        grounding: "local_knowledge" as const,
        citations: []
      }
    }));
    const service = new ReaderSelectionActionService(fixture.vaults, { submitTurn }, {
      readJob: () => ({ id: "job_20260718_ineligible12" } as never),
      readAppliedOperationId: () => undefined
    });
    const result = await service.submitTransform({
      ...actionRequest(fixture.selection, "explain"),
      action: "expand"
    });

    expect(result).toEqual({
      apiVersion: 1,
      requestId: "readerselaction_abcdefgh",
      status: "invalid",
      reason: "mutation_ineligible"
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_MODEL_REPLACEMENT");
  });
});

function makeFixture(body: string): {
  readonly vaults: {
    readonly current: () => ReturnType<typeof loadVaultSummary>;
    readonly activeVaultPath: () => string;
  };
  readonly selection: ReaderSelectionIdentity;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-reader-action-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Reader Action",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-18T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Reader Action");
  const pagePath = path.join(vaultPath, "wiki", "selection.md");
  const markdown = `---\nid: "page_20260718_action1234"\nschema_version: 1\ntitle: "Action"\ntype: "note"\ncreated_at: "2026-07-18T12:00:00.000Z"\nupdated_at: "2026-07-18T12:00:00.000Z"\nstatus: "active"\n---\n\n${body}\n`;
  fs.writeFileSync(pagePath, markdown, "utf8");
  const selected = body.includes("SELECTED_PRIVATE_PASSAGE")
    ? "SELECTED_PRIVATE_PASSAGE"
    : "small";
  const startCharacter = markdown.indexOf(selected);
  const start = Buffer.byteLength(markdown.slice(0, startCharacter), "utf8");
  const selectedBytes = Buffer.from(selected, "utf8");
  const vault = loadVaultSummary(vaultPath);
  return {
    vaults: { current: () => vault, activeVaultPath: () => vaultPath },
    selection: {
      pageId: "page_20260718_action1234",
      pageContentHash: hash(Buffer.from(markdown, "utf8")),
      span: { unit: "utf8_bytes", start, endExclusive: start + selectedBytes.length },
      selectedContentHash: hash(selectedBytes)
    }
  };
}

function actionRequest(
  selection: ReaderSelectionIdentity,
  action: ReaderSelectionActionRequest["action"]
): ReaderSelectionActionRequest {
  return {
    apiVersion: 1,
    requestId: "readerselaction_abcdefgh",
    action,
    selection,
    locale: "en",
    clientTurnId: "turn_20260718_abcdefghijkl"
  };
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
