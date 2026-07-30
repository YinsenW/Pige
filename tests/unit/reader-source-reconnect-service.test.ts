import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SourceRecordSchema } from "@pige/schemas";
import { ReaderSourceReconnectService } from "../../apps/desktop/src/main/services/reader-source-reconnect-service";

const request = {
  apiVersion: 1,
  requestId: "notesourcereconnect_abcdefghijklmnop",
  activeVaultId: "vault_20260730_abcdefgh",
  currentPageId: "page_20260730_current1234",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  sourceId: "src_20260730_source1234"
} as const;

const body = Buffer.from("exact referenced bytes\n", "utf8");
const sourceRecord = SourceRecordSchema.parse({
  schemaVersion: 1,
  id: request.sourceId,
  kind: "plain_text_file",
  storageStrategy: "reference_original",
  semanticOrchestration: "agent_turn",
  original: {
    uri: "file:///private/missing.txt",
    path: path.join(path.sep, "private", "missing.txt"),
    displayName: "missing.txt",
    lastKnownSize: body.byteLength,
    checksum: `sha256:${createHash("sha256").update(body).digest("hex")}`
  },
  artifacts: [],
  metadata: {},
  createdAt: "2026-07-30T08:00:00.000Z",
  updatedAt: "2026-07-30T08:00:00.000Z"
});

const refreshedRender = {
  summary: {
    pageId: request.currentPageId,
    title: "Current",
    pageType: "note" as const,
    status: "active" as const,
    pagePath: "wiki/current.md",
    createdAt: "2026-07-30T08:00:00.000Z",
    updatedAt: "2026-07-30T08:00:00.000Z",
    sourceIds: [request.sourceId]
  },
  html: "<p>Current</p>",
  byteSize: 7,
  renderContextId: "notectx_fedcba9876543210fedcba9876543210"
};

describe("reader source reconnect service", () => {
  it("reconnects one exact missing original and returns a newly authoritative Reader", async () => {
    const assertCurrent = vi.fn(() => true);
    const resolveSourceReveal = vi.fn(() => ({
      status: "ready" as const,
      vaultPath: path.join(path.sep, "private", "vault"),
      sourceRecord,
      assertCurrent
    }));
    const render = vi.fn(async () => refreshedRender);
    const reconnect = vi.fn(async (_binding, _selectedPath, current: () => boolean) =>
      current() ? "reconnected" as const : "stale" as const);
    const pick = vi.fn(async () => path.join(path.sep, "private", "replacement.txt"));
    const service = new ReaderSourceReconnectService(
      { resolveSourceReveal, render } as never,
      { reconnect }
    );

    await expect(service.reconnect("notes_owner_exact", request, { pick })).resolves.toEqual({
      ...request,
      status: "reconnected",
      render: refreshedRender
    });
    expect(resolveSourceReveal).toHaveBeenCalledWith("notes_owner_exact", request);
    expect(reconnect).toHaveBeenCalledWith(
      { activeVaultId: request.activeVaultId, sourceId: request.sourceId },
      path.join(path.sep, "private", "replacement.txt"),
      assertCurrent
    );
    expect(render).toHaveBeenCalledWith({ pageId: request.currentPageId }, "notes_owner_exact");
  });

  it("fails closed before mutation for cancellation, ineligible sources, or render drift", async () => {
    const reconnect = vi.fn();
    const render = vi.fn();
    const ready = {
      status: "ready" as const,
      vaultPath: path.join(path.sep, "private", "vault"),
      sourceRecord,
      assertCurrent: vi.fn(() => false)
    };
    const service = new ReaderSourceReconnectService(
      { resolveSourceReveal: vi.fn(() => ready), render } as never,
      { reconnect }
    );

    await expect(service.reconnect("notes_owner_exact", request, { pick: async () => undefined }))
      .resolves.toEqual({ ...request, status: "cancelled" });
    await expect(service.reconnect("notes_owner_exact", request, {
      pick: async () => path.join(path.sep, "private", "replacement.txt")
    })).resolves.toEqual({ ...request, status: "stale" });
    expect(reconnect).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    const ineligible = new ReaderSourceReconnectService({
      resolveSourceReveal: vi.fn(() => ({
        ...ready,
        sourceRecord: SourceRecordSchema.parse({
          ...sourceRecord,
          storageStrategy: "copy_to_source_library",
          original: undefined,
          managedCopy: {
            uri: "pige://source/file",
            path: "sources/file.txt",
            displayName: "file.txt",
            checksum: sourceRecord.original!.checksum,
            size: body.byteLength
          }
        })
      })),
      render
    } as never, { reconnect });
    const pick = vi.fn();
    await expect(ineligible.reconnect("notes_owner_exact", request, { pick }))
      .resolves.toEqual({ ...request, status: "ineligible" });
    expect(pick).not.toHaveBeenCalled();
  });
});
