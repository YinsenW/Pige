import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";
import {
  KnowledgeActivityService,
  type KnowledgeActivityCollectionPort,
  type KnowledgeActivityMemoryPort,
  type KnowledgeActivityVaultPort
} from "../../apps/desktop/src/main/services/knowledge-activity-service";
import { LocalDatabaseService } from "../../apps/desktop/src/main/services/local-database-service";
import {
  createAgentPageUpdateBeforePath,
  createAgentPageUpdateStagedPath,
  createAgentPageUpdateUndoOperationId
} from "../../apps/desktop/src/main/services/agent-page-update-service";
import {
  AgentPageUpdateRedoService,
  createAgentPageUpdateRedoOperationId
} from "../../apps/desktop/src/main/services/agent-page-update-redo-service";
import { createAgentPageCreateRedoOperationId } from "../../apps/desktop/src/main/services/agent-page-create-redo-service";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Knowledge Activity and Undo", () => {
  it("routes body-free Collection saved-view Activity and forward Undo only through its owner", async () => {
    const fixture = createFixture();
    const operation = OperationRecordSchema.parse({
      id: "op_20260728_createviewactivity",
      schemaVersion: 1,
      createdAt: "2026-07-28T12:00:00.000Z",
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      kind: "trash_collection_view",
      targetRefs: [
        { kind: "dataset", id: "dataset_20260728_activity123456" },
        { kind: "table", id: "table_activity123456" },
        { kind: "view", id: "view_activity123456" }
      ],
      sourceRefs: [{ kind: "dataset_revision", id: "dataset_rev_20260728_before123456" }],
      summary: "Created one saved Collection view.",
      reversible: "yes",
      rollbackHint: "Move the exact saved Collection view to recoverable trash.",
      warnings: []
    });
    writeOperation(fixture.vaultPath, operation);
    const undo = vi.fn(async () => ({
      status: "undone" as const,
      operationId: operation.id,
      undoOperationId: "op_20260728_createviewundo",
      revisionId: "dataset_rev_20260728_viewundo123456"
    }));
    const collections: KnowledgeActivityCollectionPort = {
      activitySummary: (candidate) => candidate.id === operation.id &&
        candidate.targetRefs.some((ref) => ref.kind === "dataset" && ref.id === "dataset_20260728_activity123456") &&
        candidate.targetRefs.some((ref) => ref.kind === "table" && ref.id === "table_activity123456") &&
        candidate.targetRefs.some((ref) => ref.kind === "view" && ref.id === "view_activity123456") ? {
        operationId: candidate.id,
        kind: "trash_collection_view",
        createdAt: candidate.createdAt,
        targetLabel: "Reading list",
        target: {
          kind: "collection",
          datasetId: "dataset_20260728_activity123456",
          tableId: "table_activity123456",
          revisionId: "dataset_rev_20260728_after123456"
        },
        status: "applied",
        canUndo: true
      } : undefined,
      findUndoOperation: () => undefined,
      undo,
      recoverIncompleteOperations: () => ({ recovered: 0, failed: 0 })
    };
    const service = new KnowledgeActivityService(fixture.vaults, collections);

    const listed = service.list({ limit: 20 });
    expect(listed.activities).toContainEqual(expect.objectContaining({
      operationId: operation.id,
      kind: "trash_collection_view",
      targetLabel: "Reading list",
      target: {
        kind: "collection",
        datasetId: "dataset_20260728_activity123456",
        tableId: "table_activity123456",
        revisionId: "dataset_rev_20260728_after123456"
      },
      canUndo: true
    }));
    expect(JSON.stringify(listed)).not.toMatch(/view_activity|before123456|rollbackHint|sourceRefs|targetRefs/u);
    await expect(service.undo({
      operationId: operation.id,
      expectedRevisionId: "dataset_rev_20260728_after123456"
    })).resolves.toEqual({
      status: "undone",
      operationId: operation.id,
      undoOperationId: "op_20260728_createviewundo",
      revisionId: "dataset_rev_20260728_viewundo123456"
    });
    expect(undo).toHaveBeenCalledWith(operation, "dataset_rev_20260728_after123456");

    const tampered = { ...operation, targetRefs: [{ kind: "view", id: "view_attacker123456" }] } as OperationRecord;
    expect(collections.activitySummary(tampered)).toBeUndefined();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("routes relation add and cell edit Activity through exact forward-revision Undo ownership", async () => {
    const fixture = createFixture();
    const operations = ([
      ["add_collection_relation", "op_20260729_relationadd01", "2026-07-29T12:00:00.000Z"],
      ["update_collection_relation_cell", "op_20260729_relationedit1", "2026-07-29T12:01:00.000Z"]
    ] as const).map(([kind, id, createdAt]) => OperationRecordSchema.parse({
      id,
      schemaVersion: 1,
      createdAt,
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      kind,
      targetRefs: [
        { kind: "dataset", id: "dataset_20260729_relationactivity" },
        { kind: "table", id: "table_relationactivity" },
        { kind: "column", id: "column_relationactivity" }
      ],
      sourceRefs: [{ kind: "dataset_revision", id: "dataset_rev_20260729_before123456" }],
      summary: "Changed one Managed Collection relation.",
      reversible: "yes",
      rollbackHint: "Create one forward relation revision.",
      warnings: []
    }));
    for (const operation of operations) writeOperation(fixture.vaultPath, operation);
    const undo = vi.fn(async (operation: OperationRecord) => ({
      status: "undone" as const,
      operationId: operation.id,
      undoOperationId: operation.kind === "add_collection_relation"
        ? "op_20260729_relationaddundo"
        : "op_20260729_relationcellundo",
      revisionId: operation.kind === "add_collection_relation"
        ? "dataset_rev_20260729_relationaddundo"
        : "dataset_rev_20260729_relationcellundo"
    }));
    const collections: KnowledgeActivityCollectionPort = {
      activitySummary: (operation) => operations.some((candidate) => candidate.id === operation.id) ? {
        operationId: operation.id,
        kind: operation.kind as "add_collection_relation" | "update_collection_relation_cell",
        createdAt: operation.createdAt,
        targetLabel: "Related item",
        target: {
          kind: "collection",
          datasetId: "dataset_20260729_relationactivity",
          tableId: "table_relationactivity",
          revisionId: "dataset_rev_20260729_after123456"
        },
        status: "applied",
        canUndo: true
      } : undefined,
      findUndoOperation: () => undefined,
      undo,
      recoverIncompleteOperations: () => ({ recovered: 0, failed: 0 })
    };
    const service = new KnowledgeActivityService(fixture.vaults, collections);

    const listed = service.list({ limit: 20 });
    expect(listed.activities).toEqual(expect.arrayContaining(operations.map((operation) => expect.objectContaining({
      operationId: operation.id,
      kind: operation.kind,
      target: {
        kind: "collection",
        datasetId: "dataset_20260729_relationactivity",
        tableId: "table_relationactivity",
        revisionId: "dataset_rev_20260729_after123456"
      },
      canUndo: true
    }))));
    expect(JSON.stringify(listed)).not.toMatch(/before123456|rollbackHint|sourceRefs|targetRefs/u);

    await expect(service.undo({
      operationId: operations[0]!.id,
      expectedRevisionId: "dataset_rev_20260729_after123456"
    })).resolves.toMatchObject({
      status: "undone",
      operationId: operations[0]!.id,
      revisionId: "dataset_rev_20260729_relationaddundo"
    });
    await expect(service.undo({
      operationId: operations[1]!.id,
      expectedRevisionId: "dataset_rev_20260729_after654321"
    })).resolves.toMatchObject({
      status: "undone",
      operationId: operations[1]!.id,
      revisionId: "dataset_rev_20260729_relationcellundo"
    });
    expect(undo).toHaveBeenNthCalledWith(1, operations[0], "dataset_rev_20260729_after123456");
    expect(undo).toHaveBeenNthCalledWith(2, operations[1], "dataset_rev_20260729_after654321");
  });

  it("rejects malformed renderer requests before reading or changing the vault", () => {
    const fixture = createFixture();
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(() => service.list(null as unknown as {})).toThrowError(PigeDomainError);
    expect(() => service.undo(undefined as unknown as { operationId: string })).toThrowError(PigeDomainError);
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.pageContent);
  });

  it("pages a deterministic Activity snapshot and rejects stale or invented cursors", () => {
    const fixture = createFixture();
    const second = OperationRecordSchema.parse({
      ...fixture.operation,
      id: "op_20260712_activitypage02",
      createdAt: "2026-07-12T12:00:02.000Z"
    });
    const third = OperationRecordSchema.parse({
      ...fixture.operation,
      id: "op_20260712_activitypage03",
      createdAt: "2026-07-12T12:00:03.000Z"
    });
    writeOperation(fixture.vaultPath, second);
    writeOperation(fixture.vaultPath, third);
    const service = new KnowledgeActivityService(fixture.vaults);

    const first = service.list({ limit: 2 });
    expect(first).toMatchObject({
      total: 3,
      hasMore: true,
      activities: [
        { operationId: third.id },
        { operationId: second.id }
      ]
    });
    expect(first.nextCursor).toMatch(/^activity_history_[a-f0-9]{64}$/u);
    expect(first.nextCursor).not.toContain(fixture.vaultPath);
    const secondPage = service.list({ limit: 2, cursor: first.nextCursor! });
    expect(secondPage).toMatchObject({
      total: 3,
      hasMore: false,
      activities: [{ operationId: fixture.operation.id }]
    });
    expect(secondPage).not.toHaveProperty("nextCursor");
    expect(new Set([...first.activities, ...secondPage.activities].map(({ operationId }) => operationId)).size).toBe(3);

    expect(() => service.list({ cursor: `activity_history_${"0".repeat(64)}` })).toThrowError(PigeDomainError);
    expect(() => new KnowledgeActivityService(fixture.vaults).list({ cursor: first.nextCursor! }))
      .toThrowError(PigeDomainError);
    writeOperation(fixture.vaultPath, OperationRecordSchema.parse({
      ...fixture.operation,
      id: "op_20260712_activitypage04",
      createdAt: "2026-07-12T12:00:04.000Z"
    }));
    expect(() => service.list({ cursor: first.nextCursor! })).toThrowError(PigeDomainError);
  });

  it("searches safe summaries across the full Activity history and binds filters into cursors", () => {
    const fixture = createFixture();
    for (const [id, createdAt] of [
      ["op_20260712_activitysearch02", "2026-07-12T12:00:02.000Z"],
      ["op_20260712_activitysearch03", "2026-07-12T12:00:03.000Z"]
    ] as const) {
      writeOperation(fixture.vaultPath, OperationRecordSchema.parse({
        ...fixture.operation,
        id,
        createdAt
      }));
    }
    const service = new KnowledgeActivityService(fixture.vaults);

    const first = service.list({ limit: 1, query: "ＡＣＴＩＶＩＴＹ fixture", status: "applied" });
    expect(first).toMatchObject({ total: 3, hasMore: true });
    expect(first.activities[0]).toMatchObject({ targetLabel: "Activity fixture", status: "applied" });
    expect(service.list({
      limit: 1,
      cursor: first.nextCursor!,
      query: "activity fixture",
      status: "applied"
    }).activities).toHaveLength(1);
    expect(() => service.list({ limit: 1, cursor: first.nextCursor!, query: "create_page", status: "applied" }))
      .toThrowError(PigeDomainError);

    expect(service.undo({ operationId: fixture.operation.id })).toMatchObject({ status: "undone" });
    expect(service.list({ query: "activity fixture", status: "undone" })).toMatchObject({
      total: 1,
      activities: [{ operationId: fixture.operation.id, status: "undone" }]
    });
    expect(service.list({ query: "missing target" })).toMatchObject({
      total: 0,
      activities: [],
      hasMore: false
    });
  });

  it("delegates body-free Memory Activity, Undo, and recovery to the Memory owner", () => {
    const fixture = createFixture();
    const memoryId = "memory_20260712_activitymemory";
    const operation = OperationRecordSchema.parse({
      id: "op_20260712_memorytrash",
      schemaVersion: 1,
      createdAt: "2026-07-12T12:02:00.000Z",
      actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
      kind: "trash_memory",
      targetRefs: [{ kind: "memory", id: memoryId }],
      sourceRefs: [],
      summary: "Moved one vault memory to recoverable trash.",
      reversible: "yes",
      rollbackHint: "Restore the exact receipt through the Memory owner.",
      warnings: []
    });
    writeOperation(fixture.vaultPath, operation);
    const undo = vi.fn(() => ({
      status: "undone" as const,
      operationId: operation.id,
      undoOperationId: "op_20260712_memoryrestore"
    }));
    const memory: KnowledgeActivityMemoryPort = {
      activitySummary: (candidate) => candidate.id === operation.id ? {
        operationId: candidate.id,
        kind: "trash_memory",
        createdAt: candidate.createdAt,
        targetLabel: "Saved preference",
        target: { kind: "memory", memoryId },
        status: "applied",
        canUndo: true
      } : undefined,
      findUndoOperation: () => undefined,
      undo,
      recoverIncompleteOperations: () => ({ recovered: 1, failed: 0 })
    };
    const service = new KnowledgeActivityService(fixture.vaults, undefined, undefined, memory);

    expect(service.list().activities).toContainEqual(expect.objectContaining({
      operationId: operation.id,
      target: { kind: "memory", memoryId },
      canUndo: true
    }));
    expect(service.undo({ operationId: operation.id })).toEqual({
      status: "undone",
      operationId: operation.id,
      undoOperationId: "op_20260712_memoryrestore"
    });
    expect(undo).toHaveBeenCalledWith(operation, undefined);
    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
  });

  it("lists a checksum-bound Agent create, moves it to recoverable trash, and remains idempotent after restart", () => {
    const fixture = createFixture();
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(service.list()).toMatchObject({
      total: 1,
      invalidOperationCount: 0,
      activities: [{
        operationId: fixture.operation.id,
        targetLabel: "Activity fixture",
        target: { kind: "page", pageId: fixture.operation.targetRefs[0]!.id },
        status: "applied",
        canUndo: true
      }]
    });
    expect(JSON.stringify(service.list())).not.toContain("src_20260712_activityfixture");

    const first = service.undo({ operationId: fixture.operation.id });
    expect(first.status).toBe("undone");
    expect(fs.existsSync(fixture.pagePath)).toBe(false);
    expect(fs.readFileSync(fixture.trashPath, "utf8")).toBe(fixture.pageContent);
    expect(fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8"))
      .not.toContain(fixture.pageRelativePath);
    expect(fs.readFileSync(indexBackupPath(fixture), "utf8"))
      .toContain(fixture.pageRelativePath);

    const second = service.undo({ operationId: fixture.operation.id });
    expect(second).toEqual({
      status: "already_undone",
      operationId: fixture.operation.id,
      undoOperationId: first.undoOperationId
    });

    const undoPath = operationPath(fixture.vaultPath, first.undoOperationId);
    const interruptedTemporaryPath = path.join(
      path.dirname(undoPath),
      `.${first.undoOperationId}.9999.1234567890abcdef.tmp`
    );
    fs.linkSync(undoPath, interruptedTemporaryPath);
    const restarted = new KnowledgeActivityService(fixture.vaults).list();
    expect(fs.existsSync(interruptedTemporaryPath)).toBe(false);
    expect(restarted.invalidOperationCount).toBe(0);
    expect(restarted.activities).toMatchObject([{
      operationId: fixture.operation.id,
      status: "undone",
      canUndo: false,
      undoUnavailableReason: "already_undone"
    }]);
    expect(restarted.activities[0]).not.toHaveProperty("target");
    const undoOperation = readOperations(fixture.vaultPath).find((operation) => operation.id === first.undoOperationId);
    expect(undoOperation).toMatchObject({
      kind: "trash_page",
      reversible: "best_effort",
      sourceRefs: expect.arrayContaining([{ kind: "operation", id: fixture.operation.id }]),
      before: { kind: "page", id: hash(fixture.pageContent), path: fixture.pageRelativePath },
      after: { kind: "page", id: hash(fixture.pageContent), path: fixture.trashRelativePath }
    });
  });

  it("redoes an exact Agent-created page from recoverable trash and adopts replay", () => {
    const fixture = createFixture();
    const service = createActivityServiceWithAgentRedo(fixture.vaults);
    const undo = service.undo({ operationId: fixture.operation.id });
    expect(undo).toMatchObject({ status: "undone" });
    expect(service.list().activities[0]).toMatchObject({ status: "undone", canRedo: true });

    const first = service.redo({ operationId: fixture.operation.id });
    expect(first).toMatchObject({
      status: "redone",
      undoOperationId: undo.undoOperationId,
      revisionId: hash(fixture.pageContent)
    });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.pageContent);
    expect(fs.existsSync(fixture.trashPath)).toBe(false);
    expect(fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8"))
      .toContain(fixture.pageRelativePath);

    const restarted = createActivityServiceWithAgentRedo(fixture.vaults);
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    fs.copyFileSync(fixture.pagePath, fixture.trashPath, fs.constants.COPYFILE_EXCL);
    expect(restarted.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.existsSync(fixture.trashPath)).toBe(false);
    expect(restarted.redo({ operationId: fixture.operation.id })).toMatchObject({
      status: "already_redone",
      redoOperationId: first.redoOperationId
    });
    expect(restarted.list().activities[0]).toMatchObject({
      canRedo: false,
      redoUnavailableReason: "already_redone"
    });
  });

  it("does not overwrite an occupied Agent-created page path during Redo", () => {
    const fixture = createFixture();
    const service = createActivityServiceWithAgentRedo(fixture.vaults);
    expect(service.undo({ operationId: fixture.operation.id })).toMatchObject({ status: "undone" });
    fs.mkdirSync(path.dirname(fixture.pagePath), { recursive: true });
    fs.writeFileSync(fixture.pagePath, "External page replacement.\n", "utf8");

    expect(service.list().activities[0]).toMatchObject({
      canRedo: false,
      redoUnavailableReason: "content_changed"
    });
    expect(service.redo({ operationId: fixture.operation.id })).toMatchObject({ status: "stale" });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe("External page replacement.\n");
    expect(fs.readFileSync(fixture.trashPath, "utf8")).toBe(fixture.pageContent);
  });

  it("recovers one Agent create-page Redo after page restoration and before receipt commit", () => {
    const fixture = createFixture();
    const service = createActivityServiceWithAgentRedo(fixture.vaults);
    expect(service.undo({ operationId: fixture.operation.id })).toMatchObject({ status: "undone" });
    fs.mkdirSync(path.dirname(fixture.pagePath), { recursive: true });
    fs.copyFileSync(fixture.trashPath, fixture.pagePath, fs.constants.COPYFILE_EXCL);

    const restarted = createActivityServiceWithAgentRedo(fixture.vaults);
    expect(restarted.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
    const redoId = createAgentPageCreateRedoOperationId(fixture.operation.id);
    expect(requireOperation(fixture.vaultPath, redoId)).toMatchObject({
      kind: "restore_page",
      sourceRefs: [
        { kind: "operation", id: fixture.operation.id },
        { kind: "operation", id: undoOperationId(fixture.operation.id) }
      ]
    });
    expect(fs.existsSync(fixture.trashPath)).toBe(false);
    expect(restarted.recoverIncompleteUndos()).toEqual({ recovered: 0, failed: 0 });
  });

  it("lists a checksum-bound existing-note update and restores exact prior bytes idempotently", () => {
    const fixture = createUpdateFixture();
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(service.list()).toMatchObject({
      total: 1,
      invalidOperationCount: 0,
      activities: [{
        operationId: fixture.operation.id,
        kind: "update_page",
        targetLabel: "Updated Activity fixture",
        target: { kind: "page", pageId: fixture.operation.targetRefs[0]!.id },
        status: "applied",
        canUndo: true
      }]
    });
    const indexedAfter = new LocalDatabaseService();
    expect(indexedAfter.rebuild(fixture.vaultPath)?.pageCount).toBe(1);
    expect(indexedAfter.listPages(fixture.vaultPath)?.pages[0]?.updatedAt)
      .toBe("2026-07-12T12:01:00.000Z");

    const first = service.undo({ operationId: fixture.operation.id });
    expect(first.status).toBe("undone");
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.beforeContent);
    expect(fs.readFileSync(fixture.beforePath, "utf8")).toBe(fixture.beforeContent);
    const undoBeforePath = path.join(
      fixture.vaultPath,
      ...createAgentPageUpdateBeforePath(first.undoOperationId).split("/")
    );
    expect(fs.readFileSync(undoBeforePath, "utf8")).toBe(fixture.afterContent);

    expect(new KnowledgeActivityService(fixture.vaults).undo({ operationId: fixture.operation.id }))
      .toEqual({
        status: "already_undone",
        operationId: fixture.operation.id,
        undoOperationId: first.undoOperationId
      });
    expect(new KnowledgeActivityService(fixture.vaults).list().activities[0]).toMatchObject({
      kind: "update_page",
      status: "undone",
      canUndo: false,
      undoUnavailableReason: "already_undone"
    });
    expect(new KnowledgeActivityService(fixture.vaults).list().activities[0]).not.toHaveProperty("target");
    expect(new LocalDatabaseService().listPages(fixture.vaultPath)?.pages[0]?.updatedAt)
      .toBe("2026-07-12T12:00:00.000Z");
    const undoOperation = requireOperation(fixture.vaultPath, first.undoOperationId);
    expect(undoOperation).toMatchObject({
      kind: "update_page",
      actor: { kind: "user" },
      sourceRefs: [{ kind: "operation", id: fixture.operation.id }],
      before: { kind: "page", id: hash(fixture.afterContent), path: expect.any(String) },
      after: { kind: "page", id: hash(fixture.beforeContent), path: fixture.pageRelativePath }
    });
  });

  it("projects an ordinary current-note target only with exact append provenance", () => {
    const fixture = createUpdateFixture({ currentNoteAppend: true });
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(service.list().activities[0]).toMatchObject({
      operationId: fixture.operation.id,
      kind: "update_page",
      target: { kind: "page", pageId: fixture.operation.targetRefs[0]!.id }
    });
    expect(service.undo({ operationId: fixture.operation.id })).toMatchObject({ status: "undone" });
    expect(new KnowledgeActivityService(fixture.vaults).list().activities[0]).toMatchObject({
      operationId: fixture.operation.id,
      status: "undone"
    });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.beforeContent);

    const mismatched = createUpdateFixture({ currentNoteAppend: true });
    writeOperation(mismatched.vaultPath, OperationRecordSchema.parse({
      ...mismatched.operation,
      sourceRefs: mismatched.operation.sourceRefs.map((ref) => ref.kind === "artifact"
        ? { ...ref, id: "art_reader_selection_0123456789abcdef" }
        : ref)
    }));
    expect(new KnowledgeActivityService(mismatched.vaults).list()).toMatchObject({
      total: 0,
      activities: []
    });
  });

  it.each([false, true])("redoes an exact Agent page update after Undo and adopts replay across restart (current note: %s)", (currentNoteAppend) => {
    const fixture = createUpdateFixture({ currentNoteAppend });
    const service = createActivityServiceWithAgentRedo(fixture.vaults);
    const undo = service.undo({ operationId: fixture.operation.id });
    expect(undo).toMatchObject({ status: "undone" });
    expect(service.list().activities[0]).toMatchObject({
      status: "undone",
      canRedo: true
    });

    const first = service.redo({
      operationId: fixture.operation.id,
      expectedRevisionId: hash(fixture.beforeContent)
    });
    expect(first).toMatchObject({
      status: "redone",
      operationId: fixture.operation.id,
      undoOperationId: undo.undoOperationId,
      revisionId: hash(fixture.afterContent)
    });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.afterContent);
    expect(createActivityServiceWithAgentRedo(fixture.vaults).redo({ operationId: fixture.operation.id }))
      .toMatchObject({ status: "already_redone", redoOperationId: first.redoOperationId });
    expect(createActivityServiceWithAgentRedo(fixture.vaults).list().activities[0]).toMatchObject({
      status: "undone",
      canRedo: false,
      redoUnavailableReason: "already_redone"
    });
  });

  it("keeps an undone Agent update unchanged when the live page drifts before Redo", () => {
    const fixture = createUpdateFixture();
    const service = createActivityServiceWithAgentRedo(fixture.vaults);
    expect(service.undo({ operationId: fixture.operation.id })).toMatchObject({ status: "undone" });
    const external = `${fixture.beforeContent}\nExternal correction after Undo.\n`;
    fs.writeFileSync(fixture.pagePath, external, "utf8");

    expect(service.list().activities[0]).toMatchObject({
      canRedo: false,
      redoUnavailableReason: "content_changed"
    });
    expect(service.redo({ operationId: fixture.operation.id })).toMatchObject({
      status: "stale",
      currentRevisionId: hash(external)
    });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(external);
    expect(fs.existsSync(operationPath(
      fixture.vaultPath,
      createAgentPageUpdateRedoOperationId(fixture.operation.id)
    ))).toBe(false);
  });

  it("withholds Agent Redo when its private after-image is tampered", () => {
    const fixture = createUpdateFixture();
    const service = createActivityServiceWithAgentRedo(fixture.vaults);
    expect(service.undo({ operationId: fixture.operation.id })).toMatchObject({ status: "undone" });
    const undoAfterPath = path.join(
      fixture.vaultPath,
      ...createAgentPageUpdateBeforePath(createAgentPageUpdateUndoOperationId(fixture.operation.id)).split("/")
    );
    fs.writeFileSync(undoAfterPath, `${fixture.afterContent}\nTampered private marker.\n`, "utf8");

    expect(service.list().activities[0]).toMatchObject({
      canRedo: false,
      redoUnavailableReason: "content_changed"
    });
    expect(() => service.redo({ operationId: fixture.operation.id })).toThrowError(PigeDomainError);
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.beforeContent);
  });

  it("recovers one interrupted Agent page Redo after replacement and before Operation commit", () => {
    const fixture = createUpdateFixture();
    const service = createActivityServiceWithAgentRedo(fixture.vaults);
    expect(service.undo({ operationId: fixture.operation.id })).toMatchObject({ status: "undone" });
    const redoId = createAgentPageUpdateRedoOperationId(fixture.operation.id);
    const redoBeforePath = path.join(fixture.vaultPath, ...createAgentPageUpdateBeforePath(redoId).split("/"));
    const redoStagedPath = path.join(fixture.vaultPath, ...createAgentPageUpdateStagedPath(redoId).split("/"));
    fs.mkdirSync(path.dirname(redoBeforePath), { recursive: true });
    fs.writeFileSync(redoBeforePath, fixture.beforeContent, { encoding: "utf8", mode: 0o600 });
    fs.writeFileSync(redoStagedPath, fixture.afterContent, { encoding: "utf8", mode: 0o600 });
    fs.writeFileSync(fixture.pagePath, fixture.afterContent, { encoding: "utf8", mode: 0o600 });

    const restarted = createActivityServiceWithAgentRedo(fixture.vaults);
    expect(restarted.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
    expect(requireOperation(fixture.vaultPath, redoId)).toMatchObject({
      kind: "update_page",
      actor: { kind: "user" },
      sourceRefs: [
        { kind: "operation", id: fixture.operation.id },
        { kind: "operation", id: createAgentPageUpdateUndoOperationId(fixture.operation.id) }
      ]
    });
    expect(fs.existsSync(redoStagedPath)).toBe(false);
    expect(restarted.recoverIncompleteUndos()).toEqual({ recovered: 0, failed: 0 });
  });

  it("recovers an interrupted update Undo from its durable post-update marker", () => {
    const fixture = createUpdateFixture();
    const undoId = createAgentPageUpdateUndoOperationId(fixture.operation.id);
    const markerPath = path.join(
      fixture.vaultPath,
      ...createAgentPageUpdateBeforePath(undoId).split("/")
    );
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, fixture.afterContent, { encoding: "utf8", mode: 0o600 });

    const restarted = new KnowledgeActivityService(fixture.vaults);
    expect(restarted.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.beforeContent);
    expect(requireOperation(fixture.vaultPath, undoId).sourceRefs)
      .toEqual([{ kind: "operation", id: fixture.operation.id }]);
    expect(restarted.list().activities[0]).toMatchObject({ status: "undone", canUndo: false });
  });

  it("does not report a completed update Undo as failed after a later legitimate edit", () => {
    const fixture = createUpdateFixture();
    const service = new KnowledgeActivityService(fixture.vaults);
    expect(service.undo({ operationId: fixture.operation.id }).status).toBe("undone");
    fs.appendFileSync(fixture.pagePath, "\nLater user-authored knowledge.\n", "utf8");

    const restarted = new KnowledgeActivityService(fixture.vaults);
    expect(restarted.recoverIncompleteUndos()).toEqual({ recovered: 0, failed: 0 });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("Later user-authored knowledge.");
    expect(restarted.list().activities[0]).toMatchObject({
      kind: "update_page",
      status: "undone",
      canUndo: false,
      undoUnavailableReason: "already_undone"
    });
  });

  it("does not undo an existing-note update after an external page edit", () => {
    const fixture = createUpdateFixture();
    fs.appendFileSync(fixture.pagePath, "\nExternal correction.\n", "utf8");
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(service.list().activities[0]).toMatchObject({
      kind: "update_page",
      canUndo: false,
      undoUnavailableReason: "content_changed"
    });
    expect(() => service.undo({ operationId: fixture.operation.id })).toThrowError(PigeDomainError);
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("External correction.");
    expect(fs.existsSync(operationPath(
      fixture.vaultPath,
      createAgentPageUpdateUndoOperationId(fixture.operation.id)
    ))).toBe(false);
  });

  it("fails closed instead of reporting already-undone when durable page or trash state drifts", () => {
    const fixture = createFixture();
    const service = new KnowledgeActivityService(fixture.vaults);
    expect(service.undo({ operationId: fixture.operation.id }).status).toBe("undone");
    fs.writeFileSync(fixture.pagePath, "External restored replacement.\n", "utf8");

    try {
      service.undo({ operationId: fixture.operation.id });
      throw new Error("Expected completed Undo state drift to fail closed.");
    } catch (caught) {
      expect(caught).toMatchObject({ code: "activity.undo_conflict" });
    }
    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 0, failed: 1 });
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe("External restored replacement.\n");

    fs.unlinkSync(fixture.pagePath);
    fs.unlinkSync(fixture.trashPath);
    expect(() => service.undo({ operationId: fixture.operation.id })).toThrowError(PigeDomainError);
    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 0, failed: 1 });
  });

  it("fails closed when the generated page changed after its Operation", () => {
    const fixture = createFixture();
    fs.appendFileSync(fixture.pagePath, "\nUser-authored correction.\n", "utf8");
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(service.list().activities[0]).toMatchObject({
      canUndo: false,
      undoUnavailableReason: "content_changed"
    });
    expect(() => service.undo({ operationId: fixture.operation.id })).toThrowError(PigeDomainError);
    try {
      service.undo({ operationId: fixture.operation.id });
    } catch (caught) {
      expect(caught).toMatchObject({ code: "activity.content_changed" });
    }
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toContain("User-authored correction.");
    expect(fs.existsSync(fixture.trashPath)).toBe(false);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page")).toEqual([]);
  });

  it("omits navigation authority when the current page identity no longer matches the Operation", () => {
    const fixture = createFixture();
    fs.writeFileSync(
      fixture.pagePath,
      fixture.pageContent.replace(
        'id: "page_20260712_activityfixture"',
        'id: "page_20260712_otheractivity"'
      ),
      "utf8"
    );

    const activity = new KnowledgeActivityService(fixture.vaults).list().activities[0];
    expect(activity).toMatchObject({
      operationId: fixture.operation.id,
      status: "applied",
      canUndo: false,
      undoUnavailableReason: "content_changed"
    });
    expect(activity).not.toHaveProperty("target");
    expect(JSON.stringify(activity)).not.toContain(fixture.pageRelativePath);
  });

  it("omits navigation authority when the current page is missing", () => {
    const fixture = createFixture();
    fs.unlinkSync(fixture.pagePath);

    const activity = new KnowledgeActivityService(fixture.vaults).list().activities[0];
    expect(activity).toMatchObject({
      operationId: fixture.operation.id,
      status: "applied",
      canUndo: false,
      undoUnavailableReason: "target_missing"
    });
    expect(activity).not.toHaveProperty("target");
  });

  it("keeps legacy create Operations visible but not undoable without a result hash", () => {
    const fixture = createFixture({ includeAfterHash: false });
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(service.list().activities[0]).toMatchObject({
      status: "applied",
      canUndo: false,
      undoUnavailableReason: "legacy_record"
    });
    expect(() => service.undo({ operationId: fixture.operation.id })).toThrowError(PigeDomainError);
    expect(fs.existsSync(fixture.pagePath)).toBe(true);
  });

  it("reconciles a restart after the trash link committed but before the source unlink and Operation", () => {
    const fixture = createFixture();
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    fs.linkSync(fixture.pagePath, fixture.trashPath);
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.existsSync(fixture.pagePath)).toBe(false);
    expect(fs.readFileSync(fixture.trashPath, "utf8")).toBe(fixture.pageContent);
    expect(service.list().activities[0]).toMatchObject({ status: "undone", canUndo: false });
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page"))
      .toHaveLength(1);
  });

  it("reconciles a restart after the source page moved into its private Undo quarantine", () => {
    const fixture = createFixture();
    const quarantinePath = pageQuarantinePath(fixture);
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    fs.linkSync(fixture.pagePath, fixture.trashPath);
    fs.renameSync(fixture.pagePath, quarantinePath);

    const service = new KnowledgeActivityService(fixture.vaults);
    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.existsSync(fixture.pagePath)).toBe(false);
    expect(fs.existsSync(quarantinePath)).toBe(false);
    expect(fs.readFileSync(fixture.trashPath, "utf8")).toBe(fixture.pageContent);
    expect(fs.statSync(fixture.trashPath).nlink).toBe(1);
  });

  it("quarantines and restores a source-path replacement instead of deleting it", () => {
    const fixture = createFixture();
    const replacement = "External replacement committed during Undo.\n";
    const quarantinePath = pageQuarantinePath(fixture);
    const originalRename = fs.renameSync.bind(fs);
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
      if (
        path.resolve(String(oldPath)) === path.resolve(fixture.pagePath) &&
        path.resolve(String(newPath)) === path.resolve(quarantinePath)
      ) {
        fs.unlinkSync(fixture.pagePath);
        fs.writeFileSync(fixture.pagePath, replacement, "utf8");
      }
      return originalRename(oldPath, newPath);
    });

    try {
      expect(() => new KnowledgeActivityService(fixture.vaults).undo({ operationId: fixture.operation.id }))
        .toThrowError(PigeDomainError);
    } finally {
      renameSpy.mockRestore();
    }
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(replacement);
    expect(fs.readFileSync(quarantinePath, "utf8")).toBe(replacement);
    expect(fs.readFileSync(fixture.trashPath, "utf8")).toBe(fixture.pageContent);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page"))
      .toEqual([]);
  });

  it("retains the source page when the recoverable trash link cannot be durably flushed", () => {
    const fixture = createFixture();
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    const fsyncSpy = vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw new Error("synthetic directory fsync failure");
    });

    try {
      expect(() => new KnowledgeActivityService(fixture.vaults).undo({ operationId: fixture.operation.id }))
        .toThrowError(PigeDomainError);
    } finally {
      fsyncSpy.mockRestore();
    }
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.pageContent);
    expect(fs.readFileSync(fixture.trashPath, "utf8")).toBe(fixture.pageContent);
    expect(fs.statSync(fixture.pagePath).ino).toBe(fs.statSync(fixture.trashPath).ino);
    expect(new KnowledgeActivityService(fixture.vaults).recoverIncompleteUndos())
      .toEqual({ recovered: 1, failed: 0 });
    expect(fs.existsSync(fixture.pagePath)).toBe(false);
  });

  it("retains the live index when its preserved backup cannot be durably flushed", () => {
    const fixture = createFixture();
    const indexPath = path.join(fixture.vaultPath, "index.md");
    const originalIndex = fs.readFileSync(indexPath, "utf8");
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    fs.mkdirSync(path.dirname(indexBackupPath(fixture)), { recursive: true });
    const originalFsync = fs.fsyncSync.bind(fs);
    const backupDirectoryStat = fs.statSync(path.dirname(indexBackupPath(fixture)));
    let failedBackupFlush = false;
    const fsyncSpy = vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      const descriptorStat = fs.fstatSync(descriptor);
      if (
        !failedBackupFlush &&
        descriptorStat.dev === backupDirectoryStat.dev &&
        descriptorStat.ino === backupDirectoryStat.ino
      ) {
        failedBackupFlush = true;
        throw new Error("synthetic index-backup fsync failure");
      }
      return originalFsync(descriptor);
    });

    try {
      expect(() => new KnowledgeActivityService(fixture.vaults).undo({ operationId: fixture.operation.id }))
        .toThrowError(PigeDomainError);
    } finally {
      fsyncSpy.mockRestore();
    }
    expect(fs.readFileSync(indexPath, "utf8")).toBe(originalIndex);
    expect(fs.readFileSync(indexBackupPath(fixture), "utf8")).toBe(originalIndex);
    expect(fs.statSync(indexPath).ino).toBe(fs.statSync(indexBackupPath(fixture)).ino);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page"))
      .toEqual([]);
    expect(new KnowledgeActivityService(fixture.vaults).recoverIncompleteUndos())
      .toEqual({ recovered: 1, failed: 0 });
    expect(fs.readFileSync(indexPath, "utf8")).not.toContain(fixture.pageRelativePath);
  });

  it("keeps Undo retryable in the same process when the page moved before index and Operation commit", () => {
    const fixture = createFixture();
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    fs.linkSync(fixture.pagePath, fixture.trashPath);
    fs.unlinkSync(fixture.pagePath);
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(service.list().activities[0]).toMatchObject({
      targetLabel: "Activity fixture",
      status: "applied",
      canUndo: true
    });
    expect(service.undo({ operationId: fixture.operation.id }).status).toBe("undone");
    expect(service.list().activities[0]).toMatchObject({ status: "undone", canUndo: false });
    expect(fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8"))
      .not.toContain(fixture.pageRelativePath);
  });

  it("recovers after the old index was preserved but the replacement and Undo Operation were not committed", () => {
    const fixture = createFixture();
    const originalIndex = fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8");
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    fs.linkSync(fixture.pagePath, fixture.trashPath);
    fs.unlinkSync(fixture.pagePath);
    fs.mkdirSync(path.dirname(indexBackupPath(fixture)), { recursive: true });
    fs.renameSync(path.join(fixture.vaultPath, "index.md"), indexBackupPath(fixture));

    const service = new KnowledgeActivityService(fixture.vaults);
    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.readFileSync(indexBackupPath(fixture), "utf8")).toBe(originalIndex);
    expect(fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8"))
      .not.toContain(fixture.pageRelativePath);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page"))
      .toHaveLength(1);
  });

  it("recovers the exact two-link index backup left before the live index unlink", () => {
    const fixture = createFixture();
    const originalIndex = fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8");
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    fs.linkSync(fixture.pagePath, fixture.trashPath);
    fs.unlinkSync(fixture.pagePath);
    fs.mkdirSync(path.dirname(indexBackupPath(fixture)), { recursive: true });
    fs.linkSync(path.join(fixture.vaultPath, "index.md"), indexBackupPath(fixture));

    const service = new KnowledgeActivityService(fixture.vaults);
    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.statSync(indexBackupPath(fixture)).nlink).toBe(1);
    expect(fs.readFileSync(indexBackupPath(fixture), "utf8")).toBe(originalIndex);
    expect(fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8"))
      .not.toContain(fixture.pageRelativePath);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page"))
      .toHaveLength(1);
  });

  it("recovers the old index after it moved into the operation-private quarantine", () => {
    const fixture = createFixture();
    const indexPath = path.join(fixture.vaultPath, "index.md");
    const originalIndex = fs.readFileSync(indexPath, "utf8");
    const quarantinePath = indexQuarantinePath(fixture);
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    fs.linkSync(fixture.pagePath, fixture.trashPath);
    fs.unlinkSync(fixture.pagePath);
    fs.mkdirSync(path.dirname(indexBackupPath(fixture)), { recursive: true });
    fs.linkSync(indexPath, indexBackupPath(fixture));
    fs.renameSync(indexPath, quarantinePath);

    const service = new KnowledgeActivityService(fixture.vaults);
    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.existsSync(quarantinePath)).toBe(false);
    expect(fs.readFileSync(indexBackupPath(fixture), "utf8")).toBe(originalIndex);
    expect(fs.readFileSync(indexPath, "utf8")).not.toContain(fixture.pageRelativePath);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page"))
      .toHaveLength(1);
  });

  it("recovers the exact two-link replacement index before its temporary cleanup", () => {
    const fixture = createFixture();
    const indexPath = path.join(fixture.vaultPath, "index.md");
    const originalIndex = fs.readFileSync(indexPath, "utf8");
    const replacementIndex = originalIndex
      .split(/(?<=\n)/u)
      .filter((line) => !line.includes(`](${fixture.pageRelativePath})`))
      .join("");
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    fs.linkSync(fixture.pagePath, fixture.trashPath);
    fs.unlinkSync(fixture.pagePath);
    fs.mkdirSync(path.dirname(indexBackupPath(fixture)), { recursive: true });
    fs.linkSync(indexPath, indexBackupPath(fixture));
    fs.unlinkSync(indexPath);
    fs.writeFileSync(indexPath, replacementIndex, "utf8");
    const replacementTemporary = path.join(fixture.vaultPath, ".index.md.9999.1234567890abcdef.tmp");
    fs.linkSync(indexPath, replacementTemporary);

    const service = new KnowledgeActivityService(fixture.vaults);
    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 1, failed: 0 });
    expect(fs.existsSync(replacementTemporary)).toBe(false);
    expect(fs.statSync(indexPath).nlink).toBe(1);
    expect(fs.readFileSync(indexPath, "utf8")).toBe(replacementIndex);
    expect(fs.readFileSync(indexBackupPath(fixture), "utf8")).toBe(originalIndex);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page"))
      .toHaveLength(1);
  });

  it("preserves a concurrent external index and the old index backup instead of overwriting either", () => {
    const fixture = createFixture();
    const originalIndex = fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8");
    const concurrentIndex = "# User index\n\nConcurrent external edit.\n";
    fs.mkdirSync(path.dirname(fixture.trashPath), { recursive: true });
    fs.linkSync(fixture.pagePath, fixture.trashPath);
    fs.unlinkSync(fixture.pagePath);
    fs.mkdirSync(path.dirname(indexBackupPath(fixture)), { recursive: true });
    fs.renameSync(path.join(fixture.vaultPath, "index.md"), indexBackupPath(fixture));
    fs.writeFileSync(path.join(fixture.vaultPath, "index.md"), concurrentIndex, "utf8");

    const service = new KnowledgeActivityService(fixture.vaults);
    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 0, failed: 1 });
    expect(fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8")).toBe(concurrentIndex);
    expect(fs.readFileSync(indexBackupPath(fixture), "utf8")).toBe(originalIndex);
    expect(fs.readFileSync(fixture.trashPath, "utf8")).toBe(fixture.pageContent);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page"))
      .toEqual([]);
  });

  it("fails closed without overwriting an index edited between preflight and exclusive backup", () => {
    const fixture = createFixture();
    const indexPath = path.join(fixture.vaultPath, "index.md");
    const concurrentIndex = "# User index\n\nEdit committed during Undo preflight.\n";
    const originalLink = fs.linkSync.bind(fs);
    const linkSpy = vi.spyOn(fs, "linkSync").mockImplementation((existingPath, newPath) => {
      if (path.resolve(String(existingPath)) === path.resolve(indexPath) &&
        path.resolve(String(newPath)) === path.resolve(indexBackupPath(fixture))) {
        fs.writeFileSync(indexPath, concurrentIndex, "utf8");
      }
      return originalLink(existingPath, newPath);
    });

    const service = new KnowledgeActivityService(fixture.vaults);
    try {
      expect(() => service.undo({ operationId: fixture.operation.id }))
        .toThrowError(PigeDomainError);
    } finally {
      linkSpy.mockRestore();
    }
    expect(fs.readFileSync(indexPath, "utf8")).toBe(concurrentIndex);
    expect(fs.readFileSync(indexBackupPath(fixture), "utf8")).toBe(concurrentIndex);
    expect(fs.readFileSync(fixture.trashPath, "utf8")).toBe(fixture.pageContent);
    expect(service.recoverIncompleteUndos()).toEqual({ recovered: 0, failed: 1 });
    expect(fs.readFileSync(indexPath, "utf8")).toBe(concurrentIndex);
    expect(fs.readFileSync(indexBackupPath(fixture), "utf8")).toBe(concurrentIndex);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page"))
      .toEqual([]);
  });

  it("makes a stale rebuildable database self-heal after a crash before the main-process rebuild", () => {
    const fixture = createFixture();
    const before = new LocalDatabaseService();
    expect(before.rebuild(fixture.vaultPath)?.pageCount).toBe(1);
    expect(before.listPages(fixture.vaultPath)?.pages.map((page) => page.pageId))
      .toContain("page_20260712_activityfixture");

    new KnowledgeActivityService(fixture.vaults).undo({ operationId: fixture.operation.id });

    const restarted = new LocalDatabaseService();
    expect(restarted.listPages(fixture.vaultPath)?.pages).toEqual([]);
  });

  it("rejects a symlinked trash ancestor without touching the external directory", () => {
    const fixture = createFixture();
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "pige-activity-external-"));
    temporaryRoots.push(external);
    const trashRoot = path.join(fixture.vaultPath, ".pige", "trash");
    fs.rmSync(trashRoot, { recursive: true, force: true });
    fs.symlinkSync(external, trashRoot, "dir");
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(() => service.undo({ operationId: fixture.operation.id })).toThrowError(PigeDomainError);
    expect(fs.readdirSync(external)).toEqual([]);
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.pageContent);
  });

  it("preflights an ambiguous durable index before moving the page", () => {
    const fixture = createFixture();
    fs.appendFileSync(
      path.join(fixture.vaultPath, "index.md"),
      `- [Duplicate](${fixture.pageRelativePath}) from \`src_20260712_activityfixture\`\n`,
      "utf8"
    );
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(() => service.undo({ operationId: fixture.operation.id })).toThrowError(PigeDomainError);
    expect(fs.existsSync(fixture.pagePath)).toBe(true);
    expect(fs.existsSync(fixture.trashPath)).toBe(false);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "trash_page"))
      .toEqual([]);
  });

  it("counts malformed Operation records without exposing their content", () => {
    const fixture = createFixture();
    const invalidPath = path.join(fixture.vaultPath, ".pige", "operations", "2026", "07", "op_20260712_invalidrecord.json");
    fs.writeFileSync(invalidPath, '{"private":"opaque body"}\n', "utf8");

    const result = new KnowledgeActivityService(fixture.vaults).list();
    expect(result.invalidOperationCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("opaque body");
    expect(result.activities).toHaveLength(1);
  });

  it("rejects a generated-page Operation whose durable page ID does not match its filename", () => {
    const fixture = createFixture();
    const mismatched = OperationRecordSchema.parse({
      ...fixture.operation,
      targetRefs: [{
        kind: "page",
        id: "page_20260712_otherfixture",
        path: fixture.pageRelativePath
      }]
    });
    writeOperation(fixture.vaultPath, mismatched);
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(service.list().activities).toEqual([]);
    expect(() => service.undo({ operationId: fixture.operation.id })).toThrowError(PigeDomainError);
    expect(fs.readFileSync(fixture.pagePath, "utf8")).toBe(fixture.pageContent);
    expect(fs.existsSync(fixture.trashPath)).toBe(false);
  });

  it("fails closed before reading an Operation store whose candidate records exceed the aggregate byte bound", () => {
    const fixture = createFixture();
    const operationDirectory = path.dirname(operationPath(fixture.vaultPath, fixture.operation.id));
    for (let index = 0; index < 256; index += 1) {
      const suffix = `scanlimit${index.toString(36).padStart(4, "0")}`;
      const candidatePath = path.join(operationDirectory, `op_20260712_${suffix}.json`);
      fs.closeSync(fs.openSync(candidatePath, "w"));
      fs.truncateSync(candidatePath, 256 * 1024);
    }

    try {
      new KnowledgeActivityService(fixture.vaults).list();
      throw new Error("Expected Activity scan to reject the aggregate byte limit.");
    } catch (caught) {
      expect(caught).toMatchObject({ code: "activity.scan_limit" });
    }
  });

  it("does not accept an occupied Undo identity with different durable bindings", () => {
    const fixture = createFixture();
    const occupied = OperationRecordSchema.parse({
      id: undoOperationId(fixture.operation.id),
      schemaVersion: 1,
      jobId: fixture.operation.jobId,
      createdAt: "2026-07-12T12:00:02.000Z",
      actor: {
        kind: "user",
        runtimeKind: "desktop_local",
        clientCapabilityTier: "desktop_full"
      },
      kind: "trash_page",
      targetRefs: [{ kind: "page", id: "page_20260712_otherfixture", path: fixture.trashRelativePath }],
      sourceRefs: [{ kind: "operation", id: fixture.operation.id }],
      summary: "Occupied with different audit facts.",
      reversible: "best_effort",
      warnings: []
    });
    writeOperation(fixture.vaultPath, occupied);
    const service = new KnowledgeActivityService(fixture.vaults);

    expect(service.list().activities[0]).toMatchObject({ status: "applied", canUndo: true });
    expect(() => service.undo({ operationId: fixture.operation.id })).toThrowError(PigeDomainError);
    try {
      service.undo({ operationId: fixture.operation.id });
    } catch (caught) {
      expect(caught).toMatchObject({ code: "activity.operation_conflict" });
    }
    expect(fs.existsSync(fixture.pagePath)).toBe(true);
    expect(fs.existsSync(fixture.trashPath)).toBe(false);
  });

  it("does not write an Undo Operation through a substituted operation directory", () => {
    const fixture = createFixture();
    const operationDirectory = path.dirname(operationPath(fixture.vaultPath, fixture.operation.id));
    const displacedDirectory = `${operationDirectory}.displaced`;
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "pige-activity-operation-external-"));
    temporaryRoots.push(external);
    const expectedUndoId = undoOperationId(fixture.operation.id);
    const originalOpen = fs.openSync.bind(fs);
    const openSpy = vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const descriptor = originalOpen(filePath, flags, mode);
      if (String(filePath).includes(`.${expectedUndoId}.`) && String(filePath).endsWith(".tmp")) {
        fs.renameSync(operationDirectory, displacedDirectory);
        fs.symlinkSync(external, operationDirectory, "dir");
      }
      return descriptor;
    });

    try {
      expect(() => new KnowledgeActivityService(fixture.vaults).undo({ operationId: fixture.operation.id }))
        .toThrowError(PigeDomainError);
    } finally {
      openSpy.mockRestore();
    }
    expect(fs.readdirSync(external)).toEqual([]);
    expect(fs.existsSync(path.join(external, `${expectedUndoId}.json`))).toBe(false);
    expect(fs.readdirSync(displacedDirectory).some((name) => name === `${expectedUndoId}.json`)).toBe(false);
  });
});

function createFixture(options: { readonly includeAfterHash?: boolean } = {}): {
  readonly vaultPath: string;
  readonly vaults: KnowledgeActivityVaultPort;
  readonly operation: OperationRecord;
  readonly pageContent: string;
  readonly pageRelativePath: string;
  readonly pagePath: string;
  readonly trashRelativePath: string;
  readonly trashPath: string;
} {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-activity-"));
  temporaryRoots.push(vaultPath);
  const pageId = "page_20260712_activityfixture";
  const pageRelativePath = `wiki/generated/2026/${pageId}.md`;
  const pagePath = path.join(vaultPath, ...pageRelativePath.split("/"));
  const pageContent = `---\nid: "${pageId}"\nschema_version: 1\ntitle: "Activity fixture"\ntype: "note"\ncreated_at: "2026-07-12T12:00:00.000Z"\nupdated_at: "2026-07-12T12:00:00.000Z"\nstatus: "active"\nlanguage: "en"\naliases: []\ntags: []\ntopics: []\nentities: []\nsource_ids: ["src_20260712_activityfixture"]\nrelated_page_ids: []\nprovenance:\n  generated_by: "pige"\n  last_job_id: "job_20260712_activityfixture"\n  model_profile_id: "model_activityfixture"\n  confidence: "high"\nnote:\n  note_kind: "summary"\n  review_state: "clean"\n---\n\n# Activity fixture\n\nGrounded content.\n`;
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, ".pige", "trash"), { recursive: true });
  fs.writeFileSync(pagePath, pageContent, "utf8");
  fs.writeFileSync(
    path.join(vaultPath, "index.md"),
    `# Index\n\n## Generated Notes\n\n- [Activity fixture](${pageRelativePath}) from \`src_20260712_activityfixture\`\n`,
    "utf8"
  );
  const operation = OperationRecordSchema.parse({
    id: "op_20260712_activityfixture",
    schemaVersion: 1,
    jobId: "job_20260712_activityfixture",
    createdAt: "2026-07-12T12:00:01.000Z",
    actor: {
      kind: "pige_agent",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    modelProfileId: "model_activityfixture",
    kind: "create_page",
    targetRefs: [{ kind: "page", id: pageId, path: pageRelativePath }],
    sourceRefs: [
      { kind: "job", id: "job_20260712_activityfixture" },
      { kind: "source", id: "src_20260712_activityfixture" }
    ],
    ...(options.includeAfterHash === false ? {} : {
      after: { kind: "page", id: hash(pageContent), path: pageRelativePath }
    }),
    summary: "Created wiki note Activity fixture from preserved source.",
    reversible: "best_effort",
    rollbackHint: "Move the generated wiki page to trash after checking that it has not been edited.",
    warnings: []
  });
  writeOperation(vaultPath, operation);
  const trashRelativePath = `.pige/trash/pages/${operation.id}/${pageId}.md`;
  return {
    vaultPath,
    vaults: {
      current: () => ({
        vaultId: "vault_20260712_activityfixture",
        name: "Activity Vault",
        activeVaultPathDisplay: "Activity Vault",
        knowledgeRootDisplay: "Activity Vault",
        sourceAssetRootDisplay: "Activity Vault sources",
        sourceAssetRootKind: "vault_internal",
        defaultSourceStorageStrategy: "managed_copy",
        schemaVersion: 1
      }),
      activeVaultPath: () => vaultPath
    },
    operation,
    pageContent,
    pageRelativePath,
    pagePath,
    trashRelativePath,
    trashPath: path.join(vaultPath, ...trashRelativePath.split("/"))
  };
}

function createUpdateFixture(options: { readonly currentNoteAppend?: boolean } = {}): {
  readonly vaultPath: string;
  readonly vaults: KnowledgeActivityVaultPort;
  readonly operation: OperationRecord;
  readonly beforeContent: string;
  readonly afterContent: string;
  readonly beforePath: string;
  readonly pageRelativePath: string;
  readonly pagePath: string;
} {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pige-update-activity-"));
  temporaryRoots.push(vaultPath);
  const pageId = "page_20260712_updateactivity";
  const pageRelativePath = options.currentNoteAppend ? "wiki/current-note.md" : `wiki/generated/2026/${pageId}.md`;
  const pagePath = path.join(vaultPath, ...pageRelativePath.split("/"));
  const operationId = "op_20260712_updateactivity";
  const beforeRelativePath = createAgentPageUpdateBeforePath(operationId);
  const beforePath = path.join(vaultPath, ...beforeRelativePath.split("/"));
  const beforeContent = `---
id: "${pageId}"
schema_version: 1
title: "Updated Activity fixture"
type: "note"
created_at: "2026-07-12T12:00:00.000Z"
updated_at: "2026-07-12T12:00:00.000Z"
status: "active"
language: "en"
aliases: []
tags: []
topics: []
entities: []
source_ids: ["src_20260712_activityfixture"]
related_page_ids: []
provenance:
  generated_by: "pige"
  last_job_id: "job_20260712_activityfixture"
  model_profile_id: "model_activityfixture"
  confidence: "high"
note:
  note_kind: "summary"
  review_state: "clean"
---

# Updated Activity fixture

Original user-authored body.
`;
  const afterContent = beforeContent
    .replace('updated_at: "2026-07-12T12:00:00.000Z"', 'updated_at: "2026-07-12T12:01:00.000Z"')
    .replace('last_job_id: "job_20260712_activityfixture"', 'last_job_id: "job_20260712_updateactivity"') +
    `
<!-- pige:managed:start agent-update ${operationId} -->
## Knowledge update

Grounded additive change. [source:src_20260712_updateactivity#source]
<!-- pige:managed:end -->
`;
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.mkdirSync(path.dirname(beforePath), { recursive: true });
  fs.writeFileSync(pagePath, afterContent, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(beforePath, beforeContent, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(path.join(vaultPath, "index.md"), "# Index\n", "utf8");
  const operation = OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: "job_20260712_updateactivity",
    createdAt: "2026-07-12T12:01:00.000Z",
    actor: {
      kind: "pige_agent",
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full"
    },
    modelProfileId: "model_activityfixture",
    kind: "update_page",
    targetRefs: [{ kind: "page", id: pageId, path: pageRelativePath }],
    sourceRefs: options.currentNoteAppend ? [
      { kind: "job", id: "job_20260712_updateactivity" },
      { kind: "artifact", id: "art_current_note_append_0123456789abcdef", checksum: hash("append intent") }
    ] : [
      { kind: "job", id: "job_20260712_updateactivity" },
      { kind: "source", id: "src_20260712_updateactivity" }
    ],
    before: { kind: "page", id: hash(beforeContent), path: beforeRelativePath },
    after: { kind: "page", id: hash(afterContent), path: pageRelativePath },
    summary: "Updated existing Pige-managed note from preserved source.",
    reversible: "yes",
    rollbackHint: "Restore the exact private before-image while the live after hash matches.",
    warnings: []
  });
  writeOperation(vaultPath, operation);
  return {
    vaultPath,
    vaults: {
      current: () => ({
        vaultId: "vault_20260712_updateactivity",
        name: "Update Activity Vault",
        activeVaultPathDisplay: "Update Activity Vault",
        knowledgeRootDisplay: "Update Activity Vault",
        sourceAssetRootDisplay: "Update Activity Vault sources",
        sourceAssetRootKind: "vault_internal",
        defaultSourceStorageStrategy: "managed_copy",
        schemaVersion: 1
      }),
      activeVaultPath: () => vaultPath
    },
    operation,
    beforeContent,
    afterContent,
    beforePath,
    pageRelativePath,
    pagePath
  };
}

function requireOperation(vaultPath: string, operationId: string): OperationRecord {
  const operation = readOperations(vaultPath).find((candidate) => candidate.id === operationId);
  if (!operation) throw new Error(`Expected Operation ${operationId}.`);
  return operation;
}

function createActivityServiceWithAgentRedo(vaults: KnowledgeActivityVaultPort): KnowledgeActivityService {
  return new KnowledgeActivityService(
    vaults,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new AgentPageUpdateRedoService()
  );
}

function writeOperation(vaultPath: string, operation: OperationRecord): void {
  const filePath = operationPath(vaultPath, operation.id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(operation, null, 2)}\n`, "utf8");
}

function operationPath(vaultPath: string, operationId: string): string {
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1];
  if (!dateKey) throw new Error("Invalid fixture Operation ID.");
  return path.join(
    vaultPath,
    ".pige",
    "operations",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${operationId}.json`
  );
}

function readOperations(vaultPath: string): OperationRecord[] {
  const root = path.join(vaultPath, ".pige", "operations");
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
    }
  };
  visit(root);
  return files.map((filePath) => OperationRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8"))));
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function undoOperationId(operationId: string): string {
  return `op_20260712_${createHash("sha256")
    .update("pige.activity.undo.create-page.v1\0", "utf8")
    .update(operationId, "utf8")
    .digest("hex")
    .slice(0, 16)}`;
}

function indexBackupPath(fixture: { readonly vaultPath: string; readonly operation: OperationRecord }): string {
  return path.join(
    fixture.vaultPath,
    ".pige",
    "trash",
    "index",
    fixture.operation.id,
    "index.md.before"
  );
}

function pageQuarantinePath(fixture: { readonly pagePath: string; readonly trashPath: string }): string {
  return path.join(path.dirname(fixture.trashPath), `.${path.basename(fixture.pagePath)}.source-quarantine`);
}

function indexQuarantinePath(fixture: { readonly vaultPath: string; readonly operation: OperationRecord }): string {
  return path.join(path.dirname(indexBackupPath(fixture)), ".index.md.source-quarantine");
}
