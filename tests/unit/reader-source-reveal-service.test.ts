import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { NoteRevealSourceRequest } from "@pige/contracts";
import type { SourceRecord } from "@pige/schemas";
import { ReaderSourceRevealService } from "../../apps/desktop/src/main/services/reader-source-reveal-service";

const request: NoteRevealSourceRequest = {
  apiVersion: 1,
  requestId: "notesourcereveal_abcdefghijklmnop",
  activeVaultId: "vault_20260729_abcdefgh",
  currentPageId: "page_20260729_reader1234",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  sourceId: "src_20260729_reveal123"
};

describe("ReaderSourceRevealService", () => {
  it("reveals only the exact current verified source asset", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-reader-reveal-"));
    const asset = path.join(root, "source.txt");
    fs.writeFileSync(asset, "exact source\n");
    const record = sourceRecord(asset, "sha256:38acfbda5a960552aa8cdbedc03a706b3d2adcd03b044d628b0cbe88c7273108");
    const assertCurrent = vi.fn(() => true);
    const revealFile = vi.fn(() => "revealed" as const);
    const openWebUrl = vi.fn();
    const service = new ReaderSourceRevealService({
      resolveSourceReveal: vi.fn(() => ({ status: "ready", vaultPath: root, sourceRecord: record, assertCurrent }))
    }, { revealFile, openWebUrl });

    await expect(service.reveal("owner_reader", request)).resolves.toEqual({ ...request, status: "revealed" });
    expect(revealFile).toHaveBeenCalledWith(asset);
    expect(openWebUrl).not.toHaveBeenCalled();
    expect(assertCurrent).toHaveBeenCalledOnce();
  });

  it("fails closed before registrar invocation on stale binding or asset drift", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-reader-reveal-"));
    const asset = path.join(root, "source.txt");
    fs.writeFileSync(asset, "changed\n");
    const revealFile = vi.fn();
    const openWebUrl = vi.fn();
    const stale = new ReaderSourceRevealService({
      resolveSourceReveal: vi.fn(() => ({ status: "stale" as const }))
    }, { revealFile, openWebUrl });
    await expect(stale.reveal("owner_reader", request)).resolves.toEqual({ ...request, status: "stale" });

    const unavailable = new ReaderSourceRevealService({
      resolveSourceReveal: vi.fn(() => ({
        status: "ready" as const,
        vaultPath: root,
        sourceRecord: sourceRecord(asset, `sha256:${"0".repeat(64)}`),
        assertCurrent: () => true
      }))
    }, { revealFile, openWebUrl });
    await expect(unavailable.reveal("owner_reader", request)).resolves.toEqual({ ...request, status: "unavailable" });
    expect(revealFile).not.toHaveBeenCalled();
    expect(openWebUrl).not.toHaveBeenCalled();
  });

  it("projects registrar failure without exposing its private error", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-reader-reveal-"));
    const asset = path.join(root, "source.txt");
    fs.writeFileSync(asset, "exact source\n");
    const service = new ReaderSourceRevealService({
      resolveSourceReveal: vi.fn(() => ({
        status: "ready" as const,
        vaultPath: root,
        sourceRecord: sourceRecord(
          asset,
          "sha256:38acfbda5a960552aa8cdbedc03a706b3d2adcd03b044d628b0cbe88c7273108"
        ),
        assertCurrent: () => true
      }))
    }, { revealFile: () => { throw new Error(`/private/${asset}`); }, openWebUrl: vi.fn() });

    await expect(service.reveal("owner_reader", request)).resolves.toEqual({ ...request, status: "failed" });
  });

  it("opens only the exact current HTTP(S) original in the system browser", async () => {
    const assertCurrent = vi.fn(() => true);
    const revealFile = vi.fn();
    const openWebUrl = vi.fn(async () => undefined);
    const service = new ReaderSourceRevealService({
      resolveSourceReveal: vi.fn(() => ({
        status: "ready" as const,
        vaultPath: "/private/vault",
        sourceRecord: webSourceRecord("https://example.com/article?q=reader#source"),
        assertCurrent
      }))
    }, { revealFile, openWebUrl });

    await expect(service.reveal("owner_reader", request)).resolves.toEqual({ ...request, status: "revealed" });
    expect(openWebUrl).toHaveBeenCalledWith("https://example.com/article?q=reader#source");
    expect(revealFile).not.toHaveBeenCalled();
    expect(assertCurrent).toHaveBeenCalledOnce();
  });

  it("rejects unsafe web origins and source drift before opening a browser", async () => {
    const openWebUrl = vi.fn();
    const revealFile = vi.fn();
    const unsafe = new ReaderSourceRevealService({
      resolveSourceReveal: vi.fn(() => ({
        status: "ready" as const, vaultPath: "/private/vault",
        sourceRecord: webSourceRecord("https://user:secret@example.com/article"), assertCurrent: () => true
      }))
    }, { revealFile, openWebUrl });
    await expect(unsafe.reveal("owner_reader", request)).resolves.toEqual({ ...request, status: "unavailable" });

    const stale = new ReaderSourceRevealService({
      resolveSourceReveal: vi.fn(() => ({
        status: "ready" as const, vaultPath: "/private/vault",
        sourceRecord: webSourceRecord("https://example.com/current"), assertCurrent: () => false
      }))
    }, { revealFile, openWebUrl });
    await expect(stale.reveal("owner_reader", request)).resolves.toEqual({ ...request, status: "stale" });
    expect(openWebUrl).not.toHaveBeenCalled();
    expect(revealFile).not.toHaveBeenCalled();
  });
});

function sourceRecord(asset: string, checksum: string): SourceRecord {
  return {
    schemaVersion: 1,
    id: request.sourceId,
    kind: "plain_text_file",
    storageStrategy: "reference_original",
    semanticOrchestration: "agent_turn",
    original: {
      uri: `file://${asset}`,
      path: asset,
      displayName: "source.txt",
      checksum,
      lastKnownSize: fs.statSync(asset).size,
      lastKnownMtime: fs.statSync(asset).mtime.toISOString()
    },
    metadata: {},
    artifacts: [],
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z"
  } as SourceRecord;
}

function webSourceRecord(uri: string): SourceRecord {
  return {
    schemaVersion: 1,
    id: request.sourceId,
    kind: "url",
    storageStrategy: "copy_to_source_library",
    semanticOrchestration: "agent_turn",
    original: { uri, displayName: "Example article" },
    managedCopy: {
      path: ".pige/sources/example.html",
      checksum: `sha256:${"1".repeat(64)}`,
      size: 128
    },
    metadata: {},
    artifacts: [],
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z"
  } as SourceRecord;
}
