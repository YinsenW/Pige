import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CollectionTrashRowResultSchema,
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  JobRecordSchema,
  OperationRecordSchema,
  SourceRecordSchema
} from "@pige/schemas";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { DatasetService } from "../../apps/desktop/src/main/services/dataset-service";
import type { DatasetIngestPlan } from "../../apps/desktop/src/main/services/dataset-ingest-types";
import { KnowledgeActivityService } from "../../apps/desktop/src/main/services/knowledge-activity-service";
import { ManagedCollectionService } from "../../apps/desktop/src/main/services/managed-collection-service";
import {
  readBundle,
  readCollectionSnapshot,
  readImmutableCollectionRevision
} from "../../apps/desktop/src/main/services/managed-collection-storage";
import {
  createVaultOnDisk,
  loadVaultSummary
} from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ManagedCollectionService", () => {
  it("trashes one row immutably, adopts replay, fails closed, and restores it through Activity", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionService(port);
    const initialManifest = readManifest(fixture.bundlePath);
    const initialRevision = DatasetRevisionSchema.parse(
      readJson(path.join(fixture.bundlePath, initialManifest.revision.path))
    );
    const schema = DatasetSchemaRecordSchema.parse(
      readJson(path.join(fixture.bundlePath, initialManifest.schema.path))
    );
    const table = required(schema.tables[0]);
    const opened = await service.open({
      apiVersion: 1,
      requestId: "collection_request_trashopenabcdefg",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(opened).toMatchObject({
      status: "ready",
      snapshot: { rows: [{ canTrash: true }, { canTrash: true }] }
    });
    if (opened.status !== "ready") throw new Error("Collection did not open");
    const trashedRow = required(opened.snapshot.rows[0]);
    const priorPayloadBytes = fs.readFileSync(path.join(fixture.bundlePath, initialRevision.payload.path));
    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_trashrowabcdefgh",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      expectedRevisionId: initialManifest.activeRevision,
      rowId: trashedRow.rowId
    };

    const committed = await service.trashRow(request);
    expect(committed).toMatchObject({
      status: "committed",
      rowId: trashedRow.rowId,
      snapshot: {
        revisionId: expect.any(String),
        totalRowCount: 1,
        returnedRowCount: 1,
        rows: [expect.objectContaining({ canTrash: true })]
      }
    });
    if (committed.status !== "committed") throw new Error("Collection row trash did not commit");
    expect(committed.snapshot.rows.some((row) => row.rowId === trashedRow.rowId)).toBe(false);
    expect(readRowIds(path.join(fixture.bundlePath, initialRevision.payload.path)))
      .toContain(trashedRow.rowId);
    expect(fs.readFileSync(path.join(fixture.bundlePath, initialRevision.payload.path)))
      .toEqual(priorPayloadBytes);

    const committedManifest = readManifest(fixture.bundlePath);
    const committedRevision = DatasetRevisionSchema.parse(
      readJson(path.join(fixture.bundlePath, committedManifest.revision.path))
    );
    expect(committedRevision).toMatchObject({
      id: committed.snapshot.revisionId,
      parentRevisionId: initialManifest.activeRevision,
      operationId: committed.operationId,
      change: {
        kind: "collection_row_trash",
        tableId: table.id,
        rowId: trashedRow.rowId
      }
    });
    expect(readRowIds(path.join(fixture.bundlePath, committedRevision.payload.path)))
      .not.toContain(trashedRow.rowId);

    const operationPath = findFile(
      path.join(fixture.vaultPath, ".pige/operations"),
      `${committed.operationId}.json`
    );
    const operationBytes = fs.readFileSync(operationPath);
    expect(OperationRecordSchema.parse(readJson(operationPath))).toMatchObject({
      id: committed.operationId,
      kind: "trash_collection_row",
      reversible: "yes",
      targetRefs: expect.arrayContaining([
        expect.objectContaining({ kind: "dataset", id: initialManifest.datasetId }),
        expect.objectContaining({ kind: "table", id: table.id }),
        expect.objectContaining({ kind: "row", id: trashedRow.rowId })
      ])
    });
    await expect(service.trashRow(request)).resolves.toEqual(committed);

    const tampered = readJson(operationPath) as Record<string, unknown>;
    fs.writeFileSync(operationPath, `${JSON.stringify({ ...tampered, summary: "tampered" }, null, 2)}\n`);
    await expect(service.trashRow(request)).rejects.toMatchObject({ code: "collection.request_conflict" });
    expect(readManifest(fixture.bundlePath).activeRevision).toBe(committed.snapshot.revisionId);
    fs.writeFileSync(operationPath, operationBytes);

    await expect(service.trashRow({
      ...request,
      requestId: "collection_request_trashstaleabcdef"
    })).resolves.toMatchObject({
      status: "stale",
      snapshot: { revisionId: committed.snapshot.revisionId }
    });
    const removed = await service.trashRow({
      ...request,
      requestId: "collection_request_trashineligiblea",
      expectedRevisionId: committed.snapshot.revisionId
    });
    expect(removed).toEqual({
      apiVersion: 1,
      requestId: "collection_request_trashineligiblea",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      rowId: trashedRow.rowId,
      status: "not_found"
    });
    const ineligible = CollectionTrashRowResultSchema.parse({
      apiVersion: 1,
      requestId: "collection_request_trashblockedabcdef",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      rowId: trashedRow.rowId,
      status: "ineligible"
    });
    const notFound = await service.trashRow({
      ...request,
      requestId: "collection_request_trashnotfoundabc",
      datasetId: "dataset_20260728_missing123456",
      expectedRevisionId: committed.snapshot.revisionId
    });
    expect(notFound).toEqual({
      apiVersion: 1,
      requestId: "collection_request_trashnotfoundabc",
      activeVaultId: vault.vaultId,
      datasetId: "dataset_20260728_missing123456",
      tableId: table.id,
      rowId: trashedRow.rowId,
      status: "not_found"
    });
    expect(JSON.stringify([removed, ineligible, notFound]))
      .not.toMatch(/Ada|Grace|private|sqlite|path|body|sql/u);

    const activity = new KnowledgeActivityService(port, service);
    const rowActivity = activity.list({ limit: 20 }).activities.find(
      (entry) => entry.kind === "trash_collection_row"
    );
    expect(rowActivity).toMatchObject({
      operationId: committed.operationId,
      status: "applied",
      canUndo: true,
      target: {
        kind: "collection",
        datasetId: initialManifest.datasetId,
        tableId: table.id,
        revisionId: committed.snapshot.revisionId
      }
    });
    const undone = await activity.undo({
      operationId: required(rowActivity).operationId,
      expectedRevisionId: committed.snapshot.revisionId
    });
    expect(undone).toMatchObject({ status: "undone" });
    if (undone.status !== "undone") throw new Error("Collection row trash was not undone");
    const restored = await service.open({
      apiVersion: 1,
      requestId: "collection_request_trashundoabcdefg",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(restored).toMatchObject({
      status: "ready",
      snapshot: {
        revisionId: undone.revisionId,
        totalRowCount: 2,
        returnedRowCount: 2
      }
    });
    if (restored.status !== "ready") throw new Error("Collection did not reopen after Undo");
    expect(restored.snapshot.rows.find((row) => row.rowId === trashedRow.rowId)).toEqual(trashedRow);
    const undoManifest = readManifest(fixture.bundlePath);
    const undoRevision = DatasetRevisionSchema.parse(
      readJson(path.join(fixture.bundlePath, undoManifest.revision.path))
    );
    expect(undoRevision).toMatchObject({
      id: undone.revisionId,
      parentRevisionId: committed.snapshot.revisionId,
      change: {
        kind: "collection_row_trash_undo",
        tableId: table.id,
        rowId: trashedRow.rowId,
        undoOfOperationId: committed.operationId
      }
    });
  });

  it("creates a numeric formula column, recomputes edits and rows atomically, and preserves column Undo policy", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionService(port);
    const initial = required(readBundle(fixture.vaultPath, readManifest(fixture.bundlePath).datasetId));
    const table = required(initial.schema.tables[0]);
    const countColumn = required(table.columns.find((column) => column.logicalType === "integer"));
    const firstRowId = readFirstRowId(initial.payloadPath);
    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_formulaaddabcdef",
      activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId,
      tableId: table.id,
      expectedRevisionId: initial.revision.id,
      label: "Double count",
      expression: {
        kind: "binary" as const,
        operator: "multiply" as const,
        left: { kind: "column" as const, columnId: countColumn.id },
        right: { kind: "literal" as const, value: 2 }
      }
    };

    const added = await service.addFormulaColumn(request);
    expect(added).toMatchObject({
      status: "committed",
      snapshot: {
        canAppendDefaultRow: true,
        canAddFormulaColumn: true,
        columns: expect.arrayContaining([
          expect.objectContaining({ columnId: countColumn.id, canTrash: false, canUseAsFormulaOperand: true }),
          expect.objectContaining({
            columnId: expect.any(String), label: "Double count", logicalType: "number",
            canRename: true, canTrash: true, canUseAsFormulaOperand: false,
            calculation: { kind: "pige_numeric_formula", schemaVersion: 1, expression: request.expression }
          })
        ])
      }
    });
    if (added.status !== "committed") throw new Error("Formula column did not commit");
    expect(required(added.snapshot.rows.find((row) => row.rowId === firstRowId)).cells)
      .toContainEqual({ columnId: added.columnId, value: 6, editable: false, readOnlyReason: "formula" });
    await expect(service.addFormulaColumn(request)).resolves.toEqual(added);
    await expect(service.addFormulaColumn({ ...request, expression: { kind: "literal", value: 1 } }))
      .rejects.toMatchObject({ code: "collection.request_conflict" });

    const edited = await service.editCell({
      apiVersion: 1,
      requestId: "collection_request_formulaeditabcdef",
      activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId,
      tableId: table.id,
      rowId: firstRowId,
      columnId: countColumn.id,
      expectedRevisionId: added.snapshot.revisionId,
      value: 4
    });
    expect(edited.status).toBe("committed");
    if (edited.status !== "committed") throw new Error("Formula source edit did not commit");
    const afterEdit = await service.open({
      apiVersion: 1, requestId: "collection_request_formulaopenabcdef",
      activeVaultId: vault.vaultId, datasetId: initial.manifest.datasetId, tableId: table.id
    });
    expect(afterEdit).toMatchObject({ status: "ready", snapshot: { revisionId: edited.revisionId } });
    if (afterEdit.status !== "ready") throw new Error("Formula Collection did not reopen");
    expect(required(afterEdit.snapshot.rows.find((row) => row.rowId === firstRowId)).cells)
      .toContainEqual({ columnId: added.columnId, value: 8, editable: false, readOnlyReason: "formula" });

    const appended = await service.appendDefaultRow({
      apiVersion: 1, requestId: "collection_request_formulaappendabc",
      activeVaultId: vault.vaultId, datasetId: initial.manifest.datasetId,
      tableId: table.id, expectedRevisionId: edited.revisionId
    });
    expect(appended).toMatchObject({ status: "committed", snapshot: { canAppendDefaultRow: true } });
    if (appended.status !== "committed") throw new Error("Formula row append did not commit");
    expect(required(appended.snapshot.rows.find((row) => row.rowId === appended.rowId)).cells)
      .toContainEqual({ columnId: added.columnId, value: null, editable: false, readOnlyReason: "formula" });

    await expect(service.trashColumn({
      apiVersion: 1, requestId: "collection_request_formulaguardabcd",
      activeVaultId: vault.vaultId, datasetId: initial.manifest.datasetId, tableId: table.id,
      expectedRevisionId: appended.snapshot.revisionId, columnId: countColumn.id
    })).resolves.toMatchObject({ status: "ineligible", snapshot: { revisionId: appended.snapshot.revisionId } });
    const renamed = await service.renameColumn({
      apiVersion: 1, requestId: "collection_request_formularenameabcd",
      activeVaultId: vault.vaultId, datasetId: initial.manifest.datasetId, tableId: table.id,
      expectedRevisionId: appended.snapshot.revisionId, columnId: added.columnId, label: "Twice count"
    });
    expect(renamed).toMatchObject({ status: "committed", snapshot: { columns: expect.arrayContaining([
      expect.objectContaining({ columnId: added.columnId, label: "Twice count" })
    ]) } });
    if (renamed.status !== "committed") throw new Error("Formula column rename did not commit");

    const activity = new KnowledgeActivityService(port, service);
    const renameActivity = required(activity.list({ limit: 20 }).activities.find(
      (entry) => entry.kind === "rename_collection_column" && entry.target.revisionId === renamed.snapshot.revisionId
    ));
    const renameUndo = await activity.undo({ operationId: renameActivity.operationId, expectedRevisionId: renamed.snapshot.revisionId });
    expect(renameUndo.status).toBe("undone");
    if (renameUndo.status !== "undone") throw new Error("Formula rename Undo failed");
    const trashed = await service.trashColumn({
      apiVersion: 1, requestId: "collection_request_formulatrashabcd",
      activeVaultId: vault.vaultId, datasetId: initial.manifest.datasetId, tableId: table.id,
      expectedRevisionId: renameUndo.revisionId, columnId: added.columnId
    });
    expect(trashed).toMatchObject({ status: "committed" });
    if (trashed.status !== "committed") throw new Error("Formula column trash did not commit");
    const trashActivity = required(activity.list({ limit: 20 }).activities.find(
      (entry) => entry.kind === "trash_collection_column" && entry.target.revisionId === trashed.snapshot.revisionId
    ));
    const trashUndo = await activity.undo({ operationId: trashActivity.operationId, expectedRevisionId: trashed.snapshot.revisionId });
    expect(trashUndo.status).toBe("undone");
    if (trashUndo.status !== "undone") throw new Error("Formula trash Undo failed");
    const restored = required(readBundle(fixture.vaultPath, initial.manifest.datasetId));
    expect(required(restored.schema.tables[0]).columns).toContainEqual(expect.objectContaining({
      id: added.columnId, name: "Double count", calculation: expect.objectContaining({ kind: "pige_numeric_formula" })
    }));
  });

  it("updates one Pige formula idempotently and restores its exact prior revision through Activity Undo", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionService(port);
    const initial = required(readBundle(fixture.vaultPath, readManifest(fixture.bundlePath).datasetId));
    const table = required(initial.schema.tables[0]);
    const countColumn = required(table.columns.find((column) => column.logicalType === "integer"));
    const added = await service.addFormulaColumn({
      apiVersion: 1, requestId: "collection_request_formulaupdateadd1", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id, expectedRevisionId: initial.revision.id,
      label: "Scaled count",
      expression: { kind: "binary", operator: "multiply", left: { kind: "column", columnId: countColumn.id }, right: { kind: "literal", value: 2 } }
    });
    if (added.status !== "committed") throw new Error("Formula setup did not commit");
    const request = {
      apiVersion: 1 as const, requestId: "collection_request_formulaupdateone", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id, columnId: added.columnId,
      expectedRevisionId: added.snapshot.revisionId,
      expression: { kind: "binary" as const, operator: "multiply" as const,
        left: { kind: "column" as const, columnId: countColumn.id }, right: { kind: "literal" as const, value: 3 } }
    };
    const updated = await service.updateFormulaColumn(request);
    expect(updated).toMatchObject({
      status: "committed",
      columnId: added.columnId,
      snapshot: { columns: expect.arrayContaining([expect.objectContaining({
        columnId: added.columnId, canEditFormula: true,
        calculation: { kind: "pige_numeric_formula", schemaVersion: 1, expression: request.expression }
      })]) }
    });
    if (updated.status !== "committed") throw new Error("Formula update did not commit");
    expect(updated.snapshot.rows[0]?.cells).toContainEqual({
      columnId: added.columnId, value: 9, editable: false, readOnlyReason: "formula"
    });
    await expect(new ManagedCollectionService(port).updateFormulaColumn(request)).resolves.toEqual(updated);
    await expect(service.updateFormulaColumn({ ...request, expression: { ...request.expression,
      right: { kind: "literal", value: 4 } } })).rejects.toMatchObject({ code: "collection.request_conflict" });
    await expect(service.updateFormulaColumn({
      ...request, requestId: "collection_request_formulanochangeone", expectedRevisionId: updated.snapshot.revisionId
    })).resolves.toMatchObject({ status: "invalid", reason: "no_change" });
    await expect(service.updateFormulaColumn({
      ...request, requestId: "collection_request_formulastaleone1"
    })).resolves.toMatchObject({ status: "stale", snapshot: { revisionId: updated.snapshot.revisionId } });

    const activity = new KnowledgeActivityService(port, service);
    const entry = required(activity.list({ limit: 20 }).activities.find((candidate) =>
      candidate.kind === "update_collection_formula" && candidate.operationId === updated.operationId));
    expect(entry).toMatchObject({ canUndo: true, target: { revisionId: updated.snapshot.revisionId } });
    const undone = await activity.undo({ operationId: entry.operationId, expectedRevisionId: updated.snapshot.revisionId });
    expect(undone.status).toBe("undone");
    if (undone.status !== "undone") throw new Error("Formula update Undo did not commit");
    const restored = await service.open({
      apiVersion: 1, requestId: "collection_request_formulaafterundo", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id
    });
    expect(restored).toMatchObject({ status: "ready", snapshot: { revisionId: undone.revisionId } });
    if (restored.status !== "ready") throw new Error("Restored formula did not reopen");
    expect(restored.snapshot.columns).toContainEqual(expect.objectContaining({
      columnId: added.columnId,
      calculation: { kind: "pige_numeric_formula", schemaVersion: 1, expression: {
        kind: "binary", operator: "multiply", left: { kind: "column", columnId: countColumn.id },
        right: { kind: "literal", value: 2 }
      } }
    }));
    expect(restored.snapshot.rows[0]?.cells).toContainEqual({
      columnId: added.columnId, value: 6, editable: false, readOnlyReason: "formula"
    });
    const undoRevision = DatasetRevisionSchema.parse(readJson(path.join(
      fixture.bundlePath, readManifest(fixture.bundlePath).revision.path
    )));
    expect(undoRevision.change).toEqual({
      kind: "collection_formula_update_undo", tableId: table.id, columnId: added.columnId,
      undoOfOperationId: updated.operationId
    });
  });

  it("adds nullable columns across all editable types, adopts replay, and restores the prior schema through Activity", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionService(port);
    const initialManifest = readManifest(fixture.bundlePath);
    const initialSchemaPath = path.join(fixture.bundlePath, initialManifest.schema.path);
    const initialPayloadPath = path.join(fixture.bundlePath, initialManifest.payload.path);
    const initialSchemaBytes = fs.readFileSync(initialSchemaPath);
    const initialPayloadBytes = fs.readFileSync(initialPayloadPath);
    const initialSchema = DatasetSchemaRecordSchema.parse(readJson(initialSchemaPath));
    const table = required(initialSchema.tables[0]);
    const initialOpen = await service.open({
      apiVersion: 1,
      requestId: "collection_request_columnopenabcdef",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(initialOpen).toMatchObject({
      status: "ready",
      snapshot: { canAddColumn: true, columns: expect.any(Array), rows: expect.any(Array) }
    });
    if (initialOpen.status !== "ready") throw new Error("Collection did not open");
    const initialColumns = initialOpen.snapshot.columns;
    const initialRows = initialOpen.snapshot.rows;

    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_columnaddabcdefg",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      expectedRevisionId: initialManifest.activeRevision,
      label: "Notes",
      logicalType: "string" as const
    };
    const committed = await service.addNullableColumn(request);
    expect(committed).toMatchObject({
      status: "committed",
      snapshot: {
        revisionId: expect.any(String),
        columns: expect.arrayContaining([
          expect.objectContaining({
            columnId: expect.any(String), label: "Notes", logicalType: "string",
            canRename: true, canTrash: true, canUseAsFormulaOperand: false
          })
        ]),
        totalRowCount: initialRows.length,
        returnedRowCount: initialRows.length,
        canAddColumn: true
      }
    });
    if (committed.status !== "committed") throw new Error("Collection column add did not commit");
    expect(committed.snapshot.revisionId).not.toBe(initialManifest.activeRevision);
    expect(committed.snapshot.columns).toHaveLength(initialColumns.length + 1);
    expect(committed.snapshot.rows).toHaveLength(initialRows.length);
    for (const row of committed.snapshot.rows) {
      expect(row.cells.find((cell) => cell.columnId === committed.columnId)).toEqual({
        columnId: committed.columnId,
        value: null,
        editable: true
      });
    }

    const committedManifest = readManifest(fixture.bundlePath);
    const committedRevision = DatasetRevisionSchema.parse(
      readJson(path.join(fixture.bundlePath, committedManifest.revision.path))
    );
    expect(committedManifest.activeRevision).toBe(committed.snapshot.revisionId);
    expect(committedManifest.initialRevision).toBe(initialManifest.activeRevision);
    expect(committedRevision).toMatchObject({
      id: committed.snapshot.revisionId,
      parentRevisionId: initialManifest.activeRevision,
      operationId: committed.operationId,
      change: {
        kind: "collection_column_add",
        tableId: table.id,
        columnId: committed.columnId
      }
    });
    expect(committedRevision.payload.path).toBe(`data/revisions/${committedRevision.id}.sqlite`);
    expect(fs.readFileSync(initialSchemaPath)).toEqual(initialSchemaBytes);
    expect(fs.readFileSync(initialPayloadPath)).toEqual(initialPayloadBytes);

    const operationPath = findFile(
      path.join(fixture.vaultPath, ".pige/operations"),
      `${committed.operationId}.json`
    );
    const operationBytes = fs.readFileSync(operationPath);
    const operation = OperationRecordSchema.parse(readJson(operationPath));
    expect(operation).toMatchObject({
      id: committed.operationId,
      kind: "add_collection_column",
      reversible: "yes"
    });
    expect(operation.targetRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "dataset", id: initialManifest.datasetId }),
      expect.objectContaining({ kind: "table", id: table.id }),
      expect.objectContaining({ kind: "column", id: committed.columnId })
    ]));

    await expect(service.addNullableColumn(request)).resolves.toEqual(committed);
    expect(readManifest(fixture.bundlePath).activeRevision).toBe(committed.snapshot.revisionId);
    expect(readManifest(fixture.bundlePath).schema.path).toBe(committedManifest.schema.path);
    const tamperedOperation = readJson(operationPath) as Record<string, unknown>;
    fs.writeFileSync(operationPath, `${JSON.stringify({ ...tamperedOperation, summary: "tampered" }, null, 2)}\n`);
    await expect(service.addNullableColumn(request)).rejects.toMatchObject({
      code: "collection.request_conflict"
    });
    expect(readManifest(fixture.bundlePath).activeRevision).toBe(committed.snapshot.revisionId);
    fs.writeFileSync(operationPath, operationBytes);

    await expect(service.addNullableColumn({
      ...request,
      requestId: "collection_request_columnstaleabcde"
    })).resolves.toMatchObject({
      status: "stale",
      snapshot: { revisionId: committed.snapshot.revisionId }
    });
    await expect(service.addNullableColumn({
      ...request,
      requestId: "collection_request_columnduplicatea",
      expectedRevisionId: committed.snapshot.revisionId,
      label: " Notes "
    })).resolves.toMatchObject({ status: "invalid", reason: "duplicate_label" });

    const activity = new KnowledgeActivityService(port, service);
    const columnActivity = activity.list({ limit: 20 }).activities.find(
      (entry) => entry.kind === "add_collection_column"
    );
    expect(columnActivity).toMatchObject({
      operationId: committed.operationId,
      status: "applied",
      canUndo: true,
      target: {
        kind: "collection",
        datasetId: initialManifest.datasetId,
        tableId: table.id,
        revisionId: committed.snapshot.revisionId
      }
    });
    const undone = await activity.undo({
      operationId: required(columnActivity).operationId,
      expectedRevisionId: committed.snapshot.revisionId
    });
    expect(undone).toMatchObject({ status: "undone" });
    if (undone.status !== "undone") throw new Error("Collection column add was not undone");
    const afterUndo = await service.open({
      apiVersion: 1,
      requestId: "collection_request_columnundoabcdef",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(afterUndo).toMatchObject({
      status: "ready",
      snapshot: {
        revisionId: undone.revisionId,
        columns: initialColumns,
        rows: initialRows,
        canAddColumn: true
      }
    });
    expect(undone.revisionId).not.toBe(initialManifest.activeRevision);
    expect(undone.revisionId).not.toBe(committed.snapshot.revisionId);
    const undoManifest = readManifest(fixture.bundlePath);
    const undoRevision = DatasetRevisionSchema.parse(
      readJson(path.join(fixture.bundlePath, undoManifest.revision.path))
    );
    expect(undoRevision).toMatchObject({
      id: undone.revisionId,
      parentRevisionId: committed.snapshot.revisionId,
      change: {
        kind: "collection_column_add_undo",
        tableId: table.id,
        columnId: committed.columnId,
        undoOfOperationId: committed.operationId
      }
    });
    expect(undoRevision.payload.path).toBe(`data/revisions/${undoRevision.id}.sqlite`);
    expect(fs.readFileSync(initialSchemaPath)).toEqual(initialSchemaBytes);
    expect(fs.readFileSync(initialPayloadPath)).toEqual(initialPayloadBytes);

    let currentRevisionId = undone.revisionId;
    const remainingTypes = ["integer", "number", "boolean", "date", "datetime"] as const;
    for (const [index, logicalType] of remainingTypes.entries()) {
      const added = await service.addNullableColumn({
        ...request,
        requestId: `collection_request_columntype${String(index).padStart(12, "0")}`,
        expectedRevisionId: currentRevisionId,
        label: `${logicalType} value`,
        logicalType
      });
      expect(added).toMatchObject({ status: "committed", snapshot: { canAddColumn: true } });
      if (added.status !== "committed") throw new Error(`Collection ${logicalType} column did not commit`);
      expect(added.snapshot.columns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          columnId: expect.any(String), label: `${logicalType} value`, logicalType,
          canRename: true, canTrash: true,
          canUseAsFormulaOperand: logicalType === "integer" || logicalType === "number"
        })
      ]));
      for (const row of added.snapshot.rows) {
        expect(row.cells.find((cell) => cell.columnId === added.columnId)).toEqual({
          columnId: added.columnId,
          value: null,
          editable: true
        });
      }
      currentRevisionId = added.snapshot.revisionId;
    }

    for (let index = initialColumns.length + remainingTypes.length; index < 32; index += 1) {
      const added = await service.addNullableColumn({
        ...request,
        requestId: `collection_request_columnfill${String(index).padStart(10, "0")}`,
        expectedRevisionId: currentRevisionId,
        label: `Optional ${index}`,
        logicalType: "string"
      });
      expect(added.status).toBe("committed");
      if (added.status !== "committed") throw new Error("Collection column limit setup did not commit");
      currentRevisionId = added.snapshot.revisionId;
    }
    const full = await service.open({
      apiVersion: 1,
      requestId: "collection_request_columnfullabcdef",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(full).toMatchObject({
      status: "ready",
      snapshot: { revisionId: currentRevisionId, columns: expect.any(Array), canAddColumn: false }
    });
    if (full.status !== "ready") throw new Error("Full Collection did not open");
    expect(full.snapshot.columns).toHaveLength(32);
    await expect(service.addNullableColumn({
      ...request,
      requestId: "collection_request_columnlimitabcde",
      expectedRevisionId: currentRevisionId,
      label: "One too many"
    })).resolves.toMatchObject({ status: "invalid", reason: "column_limit" });
  });

  it("renames one stable column immutably, adopts exact replay, and restores the prior label through forward Undo", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionService(port);
    const manifestPath = path.join(fixture.bundlePath, "dataset.json");
    const initialManifestBytes = fs.readFileSync(manifestPath);
    const initialManifest = readManifest(fixture.bundlePath);
    const initialSchemaPath = path.join(fixture.bundlePath, initialManifest.schema.path);
    const initialPayloadPath = path.join(fixture.bundlePath, initialManifest.payload.path);
    const initialSchemaBytes = fs.readFileSync(initialSchemaPath);
    const initialPayloadBytes = fs.readFileSync(initialPayloadPath);
    const initialSchema = DatasetSchemaRecordSchema.parse(readJson(initialSchemaPath));
    const table = required(initialSchema.tables[0]);
    const column = required(table.columns[0]);
    const opened = await service.open({
      apiVersion: 1,
      requestId: "collection_request_renameopenabcdef",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(opened.status).toBe("ready");
    if (opened.status !== "ready") throw new Error("Collection did not open for rename");
    expect(opened.snapshot.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnId: column.id, canRename: true })
    ]));
    const initialRows = opened.snapshot.rows;
    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_renamecolumnabcd",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      expectedRevisionId: initialManifest.activeRevision,
      columnId: column.id,
      label: "Display name"
    };

    const committed = await service.renameColumn(request);
    expect(committed).toMatchObject({
      status: "committed",
      columnId: column.id,
      snapshot: {
        revisionId: expect.any(String),
        columns: expect.arrayContaining([expect.objectContaining({
          columnId: column.id,
          label: "Display name",
          logicalType: column.logicalType,
          canRename: true,
          canTrash: true,
          canUseAsFormulaOperand: false
        })]),
        rows: initialRows
      }
    });
    if (committed.status !== "committed") throw new Error("Collection column rename did not commit");
    expect(committed.snapshot.columns.map((entry) => entry.columnId)).toEqual(opened.snapshot.columns.map((entry) => entry.columnId));
    expect(committed.snapshot.columns.map((entry) => entry.logicalType)).toEqual(opened.snapshot.columns.map((entry) => entry.logicalType));
    expect(committed.snapshot.revisionId).not.toBe(initialManifest.activeRevision);
    const committedManifest = readManifest(fixture.bundlePath);
    const committedRevision = DatasetRevisionSchema.parse(readJson(path.join(fixture.bundlePath, committedManifest.revision.path)));
    expect(committedRevision).toMatchObject({
      parentRevisionId: initialManifest.activeRevision,
      operationId: committed.operationId,
      change: { kind: "collection_column_rename", tableId: table.id, columnId: column.id }
    });
    const committedSchema = DatasetSchemaRecordSchema.parse(readJson(path.join(fixture.bundlePath, committedManifest.schema.path)));
    expect(required(committedSchema.tables[0]).columns.find((entry) => entry.id === column.id)).toEqual({
      ...column,
      name: "Display name"
    });
    const database = new DatabaseSync(path.join(fixture.bundlePath, committedManifest.payload.path), { readOnly: true });
    try {
      expect(database.prepare(
        "SELECT name, ordinal, projected_type FROM pige_dataset_columns WHERE table_id = ? AND column_id = ?"
      ).get(table.id, column.id)).toEqual({ name: "Display name", ordinal: column.ordinal, projected_type: "text" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM pige_dataset_cells WHERE column_id = ?")
        .get(column.id)).toEqual({ count: table.rowCount });
    } finally {
      database.close();
    }
    expect(fs.readFileSync(initialSchemaPath)).toEqual(initialSchemaBytes);
    expect(fs.readFileSync(initialPayloadPath)).toEqual(initialPayloadBytes);

    const operationPath = findFile(path.join(fixture.vaultPath, ".pige/operations"), `${committed.operationId}.json`);
    const operationBytes = fs.readFileSync(operationPath);
    const operation = OperationRecordSchema.parse(readJson(operationPath));
    expect(operation).toMatchObject({ id: committed.operationId, kind: "rename_collection_column", reversible: "yes" });
    expect(operation.targetRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "column", id: column.id })
    ]));

    fs.writeFileSync(manifestPath, initialManifestBytes);
    fs.rmSync(operationPath);
    await expect(new ManagedCollectionService(port).renameColumn(request)).resolves.toEqual(committed);
    expect(readManifest(fixture.bundlePath).activeRevision).toBe(committed.snapshot.revisionId);
    const revisionCount = fs.readdirSync(path.join(fixture.bundlePath, "revisions")).length;
    await expect(service.renameColumn(request)).resolves.toEqual(committed);
    expect(fs.readdirSync(path.join(fixture.bundlePath, "revisions"))).toHaveLength(revisionCount);
    fs.writeFileSync(operationPath, `${JSON.stringify({ ...readJson(operationPath) as object, summary: "tampered" }, null, 2)}\n`);
    await expect(service.renameColumn(request)).rejects.toMatchObject({ code: "collection.request_conflict" });
    fs.writeFileSync(operationPath, operationBytes);

    await expect(service.renameColumn({
      ...request,
      requestId: "collection_request_renamestaleabcde"
    })).resolves.toMatchObject({ status: "stale", snapshot: { revisionId: committed.snapshot.revisionId } });
    await expect(service.renameColumn({
      ...request,
      requestId: "collection_request_renameduplicatea",
      expectedRevisionId: committed.snapshot.revisionId,
      label: " COUNT "
    })).resolves.toMatchObject({ status: "duplicate", snapshot: { revisionId: committed.snapshot.revisionId } });
    await expect(service.renameColumn({
      ...request,
      requestId: "collection_request_renamemissingabc",
      expectedRevisionId: committed.snapshot.revisionId,
      columnId: "column_missing123456"
    })).resolves.toMatchObject({ status: "not_found" });

    const undone = await service.undo(operation, committed.snapshot.revisionId);
    expect(undone).toMatchObject({ status: "undone", revisionId: expect.any(String) });
    if (undone.status !== "undone") throw new Error("Collection column rename was not undone");
    expect(undone.revisionId).not.toBe(initialManifest.activeRevision);
    expect(undone.revisionId).not.toBe(committed.snapshot.revisionId);
    const restored = await service.open({
      apiVersion: 1,
      requestId: "collection_request_renameundoabcdef",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(restored).toMatchObject({ status: "ready", snapshot: { revisionId: undone.revisionId, rows: initialRows } });
    if (restored.status !== "ready") throw new Error("Collection did not reopen after rename Undo");
    expect(restored.snapshot.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnId: column.id, label: column.name, canRename: true })
    ]));
    const undoManifest = readManifest(fixture.bundlePath);
    const undoRevision = DatasetRevisionSchema.parse(readJson(path.join(fixture.bundlePath, undoManifest.revision.path)));
    expect(undoRevision).toMatchObject({
      parentRevisionId: committed.snapshot.revisionId,
      change: {
        kind: "collection_column_rename_undo",
        tableId: table.id,
        columnId: column.id,
        undoOfOperationId: committed.operationId
      }
    });
  });

  it("trashes one eligible column immutably, adopts exact replay, and restores its definition and cells through forward Undo", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionService(port);
    const manifestPath = path.join(fixture.bundlePath, "dataset.json");
    const initialManifestBytes = fs.readFileSync(manifestPath);
    const initialManifest = readManifest(fixture.bundlePath);
    const initialSchemaPath = path.join(fixture.bundlePath, initialManifest.schema.path);
    const initialPayloadPath = path.join(fixture.bundlePath, initialManifest.payload.path);
    const initialSchemaBytes = fs.readFileSync(initialSchemaPath);
    const initialPayloadBytes = fs.readFileSync(initialPayloadPath);
    const initialSchema = DatasetSchemaRecordSchema.parse(readJson(initialSchemaPath));
    const table = required(initialSchema.tables[0]);
    const trashedColumn = required(table.columns[0]);
    const retainedColumn = required(table.columns[1]);
    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_trashcolumnabcdefgh",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      expectedRevisionId: initialManifest.activeRevision,
      columnId: trashedColumn.id
    };

    const committed = await service.trashColumn(request);
    expect(committed).toMatchObject({
      status: "committed",
      columnId: trashedColumn.id,
      snapshot: {
        revisionId: expect.any(String),
        columns: [{ columnId: retainedColumn.id, label: retainedColumn.name, canTrash: false }],
        rows: expect.arrayContaining([expect.objectContaining({ cells: [expect.objectContaining({ columnId: retainedColumn.id })] })])
      }
    });
    if (committed.status !== "committed") throw new Error("Collection column trash did not commit");
    expect(fs.readFileSync(initialSchemaPath)).toEqual(initialSchemaBytes);
    expect(fs.readFileSync(initialPayloadPath)).toEqual(initialPayloadBytes);
    const committedManifest = readManifest(fixture.bundlePath);
    const committedRevision = DatasetRevisionSchema.parse(readJson(path.join(fixture.bundlePath, committedManifest.revision.path)));
    expect(committedRevision).toMatchObject({
      parentRevisionId: initialManifest.activeRevision,
      operationId: committed.operationId,
      stats: { columnCount: 1, cellCount: table.rowCount },
      change: { kind: "collection_column_trash", tableId: table.id, columnId: trashedColumn.id }
    });
    const committedSchema = DatasetSchemaRecordSchema.parse(readJson(path.join(fixture.bundlePath, committedManifest.schema.path)));
    expect(required(committedSchema.tables[0])).toMatchObject({
      columnCount: 1,
      columns: [{ ...retainedColumn, ordinal: 0 }]
    });
    const database = new DatabaseSync(path.join(fixture.bundlePath, committedManifest.payload.path), { readOnly: true });
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM pige_dataset_columns WHERE column_id = ?")
        .get(trashedColumn.id)).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM pige_dataset_cells WHERE column_id = ?")
        .get(trashedColumn.id)).toEqual({ count: 0 });
      expect(database.prepare("SELECT ordinal FROM pige_dataset_columns WHERE column_id = ?")
        .get(retainedColumn.id)).toEqual({ ordinal: 0 });
    } finally {
      database.close();
    }
    const operationPath = findFile(path.join(fixture.vaultPath, ".pige/operations"), `${committed.operationId}.json`);
    const operationBytes = fs.readFileSync(operationPath);
    const operation = OperationRecordSchema.parse(readJson(operationPath));
    expect(operation).toMatchObject({
      id: committed.operationId,
      kind: "trash_collection_column",
      reversible: "yes",
      targetRefs: expect.arrayContaining([expect.objectContaining({ kind: "column", id: trashedColumn.id })])
    });

    fs.writeFileSync(manifestPath, initialManifestBytes);
    fs.rmSync(operationPath);
    await expect(new ManagedCollectionService(port).trashColumn(request)).resolves.toEqual(committed);
    const revisionCount = fs.readdirSync(path.join(fixture.bundlePath, "revisions")).length;
    await expect(service.trashColumn(request)).resolves.toEqual(committed);
    expect(fs.readdirSync(path.join(fixture.bundlePath, "revisions"))).toHaveLength(revisionCount);
    fs.writeFileSync(operationPath, `${JSON.stringify({ ...readJson(operationPath) as object, summary: "tampered" }, null, 2)}\n`);
    await expect(service.trashColumn(request)).rejects.toMatchObject({ code: "collection.request_conflict" });
    fs.writeFileSync(operationPath, operationBytes);

    await expect(service.trashColumn({
      ...request,
      requestId: "collection_request_trashcolstaleabcdefgh",
      columnId: retainedColumn.id
    })).resolves.toMatchObject({ status: "stale", snapshot: { revisionId: committed.snapshot.revisionId } });
    await expect(service.trashColumn({
      ...request,
      requestId: "collection_request_trashcolineligibleabc",
      expectedRevisionId: committed.snapshot.revisionId,
      columnId: retainedColumn.id
    })).resolves.toMatchObject({ status: "ineligible", snapshot: { columns: [{ canTrash: false }] } });
    await expect(service.trashColumn({
      ...request,
      requestId: "collection_request_trashcolmissingabcdef",
      expectedRevisionId: committed.snapshot.revisionId,
      columnId: "column_missing123456"
    })).resolves.toMatchObject({ status: "not_found" });

    const undone = await service.undo(operation, committed.snapshot.revisionId);
    expect(undone).toMatchObject({ status: "undone", revisionId: expect.any(String) });
    if (undone.status !== "undone") throw new Error("Collection column trash was not undone");
    const restored = await service.open({
      apiVersion: 1,
      requestId: "collection_request_trashcolundoabcdefgh",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(restored).toMatchObject({
      status: "ready",
      snapshot: { revisionId: undone.revisionId, columns: expect.arrayContaining([
        expect.objectContaining({ columnId: trashedColumn.id, label: trashedColumn.name })
      ]) }
    });
    const undoManifest = readManifest(fixture.bundlePath);
    const undoRevision = DatasetRevisionSchema.parse(readJson(path.join(fixture.bundlePath, undoManifest.revision.path)));
    expect(undoRevision).toMatchObject({
      parentRevisionId: committed.snapshot.revisionId,
      stats: { columnCount: table.columnCount, cellCount: table.rowCount * table.columnCount },
      change: {
        kind: "collection_column_trash_undo",
        tableId: table.id,
        columnId: trashedColumn.id,
        undoOfOperationId: committed.operationId
      }
    });
    expect(fs.readFileSync(path.join(fixture.bundlePath, undoRevision.payload.path))).not.toEqual(initialPayloadBytes);
    expect(readCollectionColumnIds(path.join(fixture.bundlePath, undoRevision.payload.path))).toEqual(
      table.columns.map((column) => column.id)
    );
  });

  it("appends one authoritative default row, adopts replay, and undoes the exact revision", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionService(port);
    const initialManifest = readManifest(fixture.bundlePath);
    const schema = DatasetSchemaRecordSchema.parse(readJson(path.join(fixture.bundlePath, initialManifest.schema.path)));
    const table = required(schema.tables[0]);
    const opened = await service.open({
      apiVersion: 1,
      requestId: "collection_request_appendopenabcdef",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(opened).toMatchObject({ status: "ready", snapshot: { canAppendDefaultRow: true } });
    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_appendrowabcdefg",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      expectedRevisionId: initialManifest.activeRevision
    };
    const committed = await service.appendDefaultRow(request);
    expect(committed).toMatchObject({
      status: "committed",
      snapshot: { totalRowCount: 3, returnedRowCount: 3, canAppendDefaultRow: true }
    });
    if (committed.status !== "committed") throw new Error("Collection row append did not commit");
    expect(committed.snapshot.rows.find((row) => row.rowId === committed.rowId)?.cells)
      .toEqual(table.columns.map((column) => ({ columnId: column.id, value: null, editable: true })));
    await expect(service.appendDefaultRow(request)).resolves.toEqual(committed);
    const operationPath = findFile(
      path.join(fixture.vaultPath, ".pige/operations"),
      `${committed.operationId}.json`
    );
    const operationBytes = fs.readFileSync(operationPath);
    const tamperedOperation = readJson(operationPath) as Record<string, unknown>;
    fs.writeFileSync(operationPath, `${JSON.stringify({ ...tamperedOperation, summary: "tampered" }, null, 2)}\n`);
    await expect(service.appendDefaultRow(request)).rejects.toMatchObject({
      code: "collection.request_conflict"
    });
    fs.writeFileSync(operationPath, operationBytes);
    await expect(service.appendDefaultRow({
      ...request,
      requestId: "collection_request_appendstaleabcdef"
    })).resolves.toMatchObject({
      status: "stale",
      snapshot: { revisionId: committed.snapshot.revisionId, totalRowCount: 3 }
    });

    const activity = new KnowledgeActivityService(port, service);
    const rowActivity = activity.list({ limit: 20 }).activities.find((entry) => entry.kind === "add_collection_row");
    expect(rowActivity).toMatchObject({ status: "applied", canUndo: true });
    const undone = await activity.undo({
      operationId: required(rowActivity).operationId,
      expectedRevisionId: committed.snapshot.revisionId
    });
    expect(undone).toMatchObject({ status: "undone" });
    const afterUndo = await service.open({
      apiVersion: 1,
      requestId: "collection_request_appendundoabcdef",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(afterUndo).toMatchObject({ status: "ready", snapshot: { totalRowCount: 2 } });
  });

  it("commits one immutable cell revision, adopts replay, and undoes through Activity", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = {
      current: () => vault,
      activeVaultPath: () => fixture.vaultPath
    };
    const service = new ManagedCollectionService(port);
    const initialManifest = readManifest(fixture.bundlePath);
    const initialSchema = DatasetSchemaRecordSchema.parse(
      readJson(path.join(fixture.bundlePath, initialManifest.schema.path))
    );
    const table = required(initialSchema.tables[0]);
    const nameColumn = required(table.columns[0]);
    const rowId = readFirstRowId(path.join(fixture.bundlePath, initialManifest.payload.path));
    const initialPayloadBytes = fs.readFileSync(path.join(fixture.bundlePath, initialManifest.payload.path));
    const initialSourceBytes = fs.readFileSync(fixture.sourceRecordPath);

    const opened = await service.open({
      apiVersion: 1,
      requestId: "collection_request_openabcdefghijkl",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(opened.status).toBe("ready");
    if (opened.status !== "ready") throw new Error("Collection did not open");
    expect(opened.snapshot.revisionId).toBe(initialManifest.activeRevision);
    expect(opened.snapshot.rows[0]).toMatchObject({ rowId });
    expect(opened.snapshot.rows[0]?.cells[0]).toEqual({
      columnId: nameColumn.id,
      value: "Ada",
      editable: true
    });

    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_editabcdefghijkl",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      rowId,
      columnId: nameColumn.id,
      expectedRevisionId: initialManifest.activeRevision,
      value: "Ada Lovelace"
    };
    const committed = await service.editCell(request);
    expect(committed.status).toBe("committed");
    const replay = await service.editCell(request);
    expect(replay).toEqual(committed);

    const editedManifest = readManifest(fixture.bundlePath);
    expect(editedManifest.initialRevision).toBe(initialManifest.activeRevision);
    expect(editedManifest.activeRevision).not.toBe(initialManifest.activeRevision);
    expect(fs.readFileSync(path.join(fixture.bundlePath, initialManifest.payload.path)))
      .toEqual(initialPayloadBytes);
    expect(fs.readFileSync(fixture.sourceRecordPath)).toEqual(initialSourceBytes);

    await expect(service.editCell({
      ...request,
      requestId: "collection_request_staleabcdefghijk",
      value: "Stale write"
    })).resolves.toMatchObject({
      status: "stale",
      currentRevisionId: editedManifest.activeRevision
    });

    const activity = new KnowledgeActivityService(port, service);
    const listed = activity.list({ limit: 20 });
    const editActivity = listed.activities.find((entry) => entry.kind === "update_collection_cell");
    expect(editActivity).toMatchObject({
      status: "applied",
      canUndo: true,
      target: {
        kind: "collection",
        datasetId: initialManifest.datasetId,
        tableId: table.id,
        revisionId: editedManifest.activeRevision
      }
    });
    const undone = await activity.undo({
      operationId: required(editActivity).operationId,
      expectedRevisionId: editedManifest.activeRevision
    });
    expect(undone).toMatchObject({ status: "undone" });
    const afterUndoActivity = activity.list({ limit: 20 }).activities.find(
      (entry) => entry.operationId === required(editActivity).operationId
    );
    expect(afterUndoActivity).toMatchObject({
      status: "undone",
      canUndo: false,
      undoUnavailableReason: "already_undone",
      target: { kind: "collection", revisionId: undone.revisionId }
    });

    const afterUndo = await service.open({
      apiVersion: 1,
      requestId: "collection_request_afterundoabcdefgh",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(afterUndo.status).toBe("ready");
    if (afterUndo.status !== "ready") throw new Error("Collection did not reopen");
    expect(afterUndo.snapshot.rows[0]?.cells[0]?.value).toBe("Ada");
    expect(readManifest(fixture.bundlePath).activeRevision)
      .not.toBe(editedManifest.activeRevision);
  });

  it("adopts an exact request after immutable files publish before the manifest switch", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionService(port);
    const initialManifestPath = path.join(fixture.bundlePath, "dataset.json");
    const initialManifestBytes = fs.readFileSync(initialManifestPath);
    const initialManifest = readManifest(fixture.bundlePath);
    const schema = DatasetSchemaRecordSchema.parse(
      readJson(path.join(fixture.bundlePath, initialManifest.schema.path))
    );
    const table = required(schema.tables[0]);
    const column = required(table.columns[0]);
    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_crashadoptionabcd",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      rowId: readFirstRowId(path.join(fixture.bundlePath, initialManifest.payload.path)),
      columnId: column.id,
      expectedRevisionId: initialManifest.activeRevision,
      value: "Adopted"
    };
    const first = await service.editCell(request);
    expect(first.status).toBe("committed");
    if (first.status !== "committed") throw new Error("Collection edit did not commit");
    fs.writeFileSync(initialManifestPath, initialManifestBytes);
    fs.rmSync(findFile(path.join(fixture.vaultPath, ".pige/operations"), `${first.operationId}.json`));

    const adopted = await new ManagedCollectionService(port).editCell(request);
    expect(adopted).toEqual(first);
    expect(readManifest(fixture.bundlePath).activeRevision).toBe(first.revisionId);
    expect(findFile(path.join(fixture.vaultPath, ".pige/operations"), `${first.operationId}.json`))
      .toContain(first.operationId);
  });

  it("reopens an immutable historical revision after the active Collection advances", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const service = new ManagedCollectionService({
      current: () => vault,
      activeVaultPath: () => fixture.vaultPath
    });
    const initial = required(readBundle(fixture.vaultPath, readManifest(fixture.bundlePath).datasetId));
    const initialSnapshot = required(readCollectionSnapshot(initial, required(initial.schema.tables[0]).id));
    const row = required(initialSnapshot.rows[0]);
    const column = required(initialSnapshot.columns[0]);
    const originalValue = required(row.cells.find((cell) => cell.columnId === column.columnId)).value;
    const committed = await service.editCell({
      apiVersion: 1,
      requestId: "collection_request_historicalopenabc",
      activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId,
      tableId: initialSnapshot.tableId,
      rowId: row.rowId,
      columnId: column.columnId,
      expectedRevisionId: initial.revision.id,
      value: "Current value"
    });
    expect(committed.status).toBe("committed");
    const active = required(readBundle(fixture.vaultPath, initial.manifest.datasetId));
    expect(active.revision.id).not.toBe(initial.revision.id);

    const historical = readImmutableCollectionRevision(active, initial.revision.id);
    const historicalSnapshot = required(readCollectionSnapshot(historical, initialSnapshot.tableId, {
      rowIds: [row.rowId]
    }));
    expect(historicalSnapshot.revisionId).toBe(initial.revision.id);
    expect(required(historicalSnapshot.rows[0]).cells).toContainEqual(expect.objectContaining({
      columnId: column.columnId,
      value: originalValue
    }));
    expect(readManifest(fixture.bundlePath).activeRevision).toBe(active.revision.id);
  });

  it("commits one same-Dataset relation with safe labels, guards, restart adoption, and Undo", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionService(port);
    const initial = required(readBundle(fixture.vaultPath, readManifest(fixture.bundlePath).datasetId));
    const table = required(initial.schema.tables[0]);
    const display = required(table.columns[0]);
    const [targetRowId, sourceRowId] = readRowIds(initial.payloadPath);
    if (!targetRowId || !sourceRowId) throw new Error("Missing relation rows");
    const added = await service.addRelationColumn({
      apiVersion: 1, requestId: "collection_request_relationaddabcde", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id, expectedRevisionId: initial.revision.id,
      label: "Person", targetTableId: table.id, targetDisplayColumnId: display.id
    });
    expect(added.status).toBe("committed");
    if (added.status !== "committed") throw new Error("Relation column was not added");
    expect(added.snapshot.columns.find((column) => column.columnId === display.id)).toMatchObject({
      canTrash: false, hasInboundRelationDescriptors: true
    });
    expect(added.snapshot.columns.find((column) => column.columnId === added.columnId)).toMatchObject({
      canEditRelation: true, canTrash: true, relation: {
        kind: "pige_single_relation", targetTableId: table.id, targetDisplayColumnId: display.id
      }
    });
    const edited = await service.editRelationCell({
      apiVersion: 1, requestId: "collection_request_relationeditabcd", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id, expectedRevisionId: added.snapshot.revisionId,
      rowId: sourceRowId, columnId: added.columnId, targetRowId
    });
    expect(edited).toMatchObject({ status: "committed", snapshot: { rows: expect.arrayContaining([
      expect.objectContaining({ rowId: targetRowId, canTrash: false }),
      expect.objectContaining({ rowId: sourceRowId, cells: expect.arrayContaining([expect.objectContaining({
        columnId: added.columnId, value: { kind: "relation", targetRowId, displayLabel: "Ada" }, editable: true
      })]) })
    ]) } });
    if (edited.status !== "committed") throw new Error("Relation cell was not edited");
    expect(required(readBundle(fixture.vaultPath, initial.manifest.datasetId)).schema.tables
      .find((candidate) => candidate.id === table.id)?.columns
      .find((candidate) => candidate.id === added.columnId)?.stats)
      .toEqual({ missing: 0, empty: 0, null: 1, value: 1 });
    await expect(service.editRelationCell({
      apiVersion: 1, requestId: "collection_request_relationnochangea", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id, expectedRevisionId: edited.snapshot.revisionId,
      rowId: sourceRowId, columnId: added.columnId, targetRowId
    })).resolves.toMatchObject({ status: "ineligible" });
    expect(readManifest(fixture.bundlePath).activeRevision).toBe(edited.snapshot.revisionId);
    await expect(service.trashRow({
      apiVersion: 1, requestId: "collection_request_relationrowguard", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id,
      expectedRevisionId: edited.snapshot.revisionId, rowId: targetRowId
    })).resolves.toMatchObject({ status: "ineligible" });
    await expect(service.trashColumn({
      apiVersion: 1, requestId: "collection_request_relationcolguard", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id,
      expectedRevisionId: edited.snapshot.revisionId, columnId: display.id
    })).resolves.toMatchObject({ status: "ineligible" });
    const restarted = new ManagedCollectionService(port);
    await expect(restarted.open({
      apiVersion: 1, requestId: "collection_request_relationrestartx", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id
    })).resolves.toMatchObject({ status: "ready", snapshot: { revisionId: edited.snapshot.revisionId } });
    const activity = new KnowledgeActivityService(port, restarted);
    const entry = required(activity.list({ limit: 20 }).activities.find(
      (candidate) => candidate.kind === "update_collection_relation_cell"
    ));
    const undone = await activity.undo({ operationId: entry.operationId, expectedRevisionId: edited.snapshot.revisionId });
    expect(undone).toMatchObject({ status: "undone" });
    if (undone.status !== "undone") throw new Error("Relation cell was not undone");
    const afterUndo = await restarted.open({
      apiVersion: 1, requestId: "collection_request_relationundoopenx", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id
    });
    expect(afterUndo).toMatchObject({ status: "ready", snapshot: { rows: expect.arrayContaining([
      expect.objectContaining({ rowId: sourceRowId, cells: expect.arrayContaining([expect.objectContaining({
        columnId: added.columnId, value: { kind: "relation", targetRowId: null, displayLabel: null }
      })]) })
    ]) } });
    if (afterUndo.status !== "ready") throw new Error("Relation Undo did not reopen");
    const restoredTarget = await restarted.editRelationCell({
      apiVersion: 1, requestId: "collection_request_relationrestoreab", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id, expectedRevisionId: afterUndo.snapshot.revisionId,
      rowId: sourceRowId, columnId: added.columnId, targetRowId
    });
    if (restoredTarget.status !== "committed") throw new Error("Relation target was not restored");
    const trashedColumn = await restarted.trashColumn({
      apiVersion: 1, requestId: "collection_request_relationtrashcol", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id,
      expectedRevisionId: restoredTarget.snapshot.revisionId, columnId: added.columnId
    });
    expect(trashedColumn).toMatchObject({ status: "committed" });
    if (trashedColumn.status !== "committed") throw new Error("Relation source column was not trashed");
    const trashActivity = required(activity.list({ limit: 20 }).activities.find(
      (candidate) => candidate.kind === "trash_collection_column" && candidate.operationId === trashedColumn.operationId
    ));
    const restoredColumn = await activity.undo({
      operationId: trashActivity.operationId, expectedRevisionId: trashedColumn.snapshot.revisionId
    });
    expect(restoredColumn).toMatchObject({ status: "undone" });
    if (restoredColumn.status !== "undone") throw new Error("Relation source column was not restored");
    const appended = await restarted.appendDefaultRow({
      apiVersion: 1, requestId: "collection_request_relationappendrow", activeVaultId: vault.vaultId,
      datasetId: initial.manifest.datasetId, tableId: table.id, expectedRevisionId: restoredColumn.revisionId
    });
    expect(appended).toMatchObject({ status: "committed" });
    if (appended.status !== "committed") throw new Error("Relation default row was not appended");
    expect(appended.snapshot.rows.find((row) => row.rowId === appended.rowId)?.cells.find(
      (cell) => cell.columnId === added.columnId
    )?.value).toEqual({ kind: "relation", targetRowId: null, displayLabel: null });
  });
});

async function makeCollectionFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-managed-collection-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Collections",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-27T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "Collections");
  const vault = loadVaultSummary(vaultPath);
  const sourceBytes = Buffer.from("name,count\nAda,3\nGrace,5\n", "utf8");
  const sourcePath = path.join(root, "records.csv");
  fs.writeFileSync(sourcePath, sourceBytes);
  const capture = await new LegacyCaptureFixture({
    current: () => vault,
    activeVaultPath: () => vaultPath
  }, vaultPath).submitFiles({
    filePaths: [sourcePath],
    inputKind: "file_picker",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = required(capture.sourceIds[0]);
  const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
  const sourceRecord = SourceRecordSchema.parse(readJson(sourceRecordPath));
  const job = JobRecordSchema.parse({
    id: "job_20260727_collection01",
    class: "dataset_import",
    state: "running",
    sourceId,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    policyContextId: "policy_collection_test",
    policyHash: `sha256:${"c".repeat(64)}`,
    message: "Dataset import running."
  });
  await new DatasetService({ plan: async () => csvPlan(sourceBytes) }).materializeSource(
    vaultPath,
    sourceRecord,
    sourceRecordPath,
    job
  );
  return {
    vaultPath,
    sourceRecordPath,
    bundlePath: required(fs.readdirSync(path.join(vaultPath, "datasets")).map(
      (entry) => path.join(vaultPath, "datasets", entry)
    )[0])
  };
}

function csvPlan(sourceBytes: Buffer): DatasetIngestPlan {
  const valueCell = (
    columnOrdinal: number,
    text: string,
    sourceType: string,
    projection: DatasetIngestPlan["tables"][number]["rows"][number]["cells"][number]["projection"]
  ) => ({
    columnOrdinal,
    state: "value" as const,
    sourceType,
    lexical: { raw: text, text, quoted: false },
    projection
  });
  const nullCell = (columnOrdinal: number, sourceType: string) => ({
    columnOrdinal,
    state: "null" as const,
    sourceType,
    lexical: { raw: "NULL", text: "NULL", quoted: false },
    projection: { kind: "null" as const }
  });
  const rows = [
    [valueCell(0, "Ada", "text", { kind: "text", value: "Ada" }), valueCell(1, "3", "integer", { kind: "integer", value: "3" })],
    [nullCell(0, "text"), nullCell(1, "integer")]
  ];
  return {
    schemaVersion: 1,
    planner: { id: "dataset_ingest", version: "1" },
    source: {
      kind: "csv_file",
      byteLength: sourceBytes.length,
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      encoding: "utf-8",
      bom: false,
      delimiter: ",",
      quote: "\"",
      nullTokens: ["NULL", "\\N"],
      lineEndings: ["lf"]
    },
    target: { profile: "managed_collection", owner: "dataset_service", sourceDisposition: "preserve_as_evidence" },
    limits: {
      maxSourceBytes: 1024 * 1024,
      maxRows: 100,
      maxColumns: 10,
      maxCells: 1000,
      maxCellBytes: 1024,
      maxPlanValueBytes: 1024 * 1024,
      maxTables: 10,
      maxArchiveEntries: 100,
      maxArchiveUncompressedBytes: 1024 * 1024,
      maxXmlEntryBytes: 1024 * 1024,
      maxSelectedXmlBytes: 1024 * 1024
    },
    stats: { tableCount: 1, rowCount: 2, columnCount: 2, cellCount: 4, retainedValueBytes: 10 },
    tables: [{
      ordinal: 0,
      sourceName: "records",
      sourceLocator: "csv:records",
      sourceMetadata: { delimiter: "," },
      header: {
        mode: "auto",
        used: true,
        sourceRow: {
          ordinal: 0,
          sourceRow: 1,
          cells: [
            valueCell(0, "name", "text", { kind: "text", value: "name" }),
            valueCell(1, "count", "text", { kind: "text", value: "count" })
          ]
        }
      },
      columns: [
        { ordinal: 0, sourceName: "name", suggestedName: "name", projectedType: "text", sourceTypes: ["text"], stats: { missing: 0, empty: 0, null: 1, value: 1 } },
        { ordinal: 1, sourceName: "count", suggestedName: "count", projectedType: "integer", sourceTypes: ["integer"], stats: { missing: 0, empty: 0, null: 1, value: 1 } }
      ],
      rows: rows.map((cells, index) => ({ ordinal: index, sourceRow: index + 2, cells }))
    }],
    warnings: []
  };
}

function readManifest(bundlePath: string) {
  return DatasetManifestSchema.parse(readJson(path.join(bundlePath, "dataset.json")));
}

function readFirstRowId(payloadPath: string): string {
  const database = new DatabaseSync(payloadPath, { readOnly: true });
  try {
    const row = database.prepare("SELECT row_id FROM pige_dataset_rows ORDER BY ordinal LIMIT 1").get() as {
      row_id?: unknown;
    } | undefined;
    if (typeof row?.row_id !== "string") throw new Error("Missing Dataset row");
    return row.row_id;
  } finally {
    database.close();
  }
}

function readRowIds(payloadPath: string): string[] {
  const database = new DatabaseSync(payloadPath, { readOnly: true });
  try {
    return (database.prepare("SELECT row_id FROM pige_dataset_rows ORDER BY ordinal").all() as Array<{
      row_id?: unknown;
    }>).map((row) => {
      if (typeof row.row_id !== "string") throw new Error("Missing Dataset row");
      return row.row_id;
    });
  } finally {
    database.close();
  }
}

function readCollectionColumnIds(payloadPath: string): string[] {
  const database = new DatabaseSync(payloadPath, { readOnly: true });
  try {
    return (database.prepare("SELECT column_id FROM pige_dataset_columns ORDER BY ordinal").all() as Array<{
      column_id?: unknown;
    }>).map((row) => {
      if (typeof row.column_id !== "string") throw new Error("Missing Dataset column");
      return row.column_id;
    });
  } finally {
    database.close();
  }
}

function findFile(root: string, suffix: string): string {
  const match = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name.endsWith(suffix));
  if (!match) throw new Error(`Missing file ending ${suffix}`);
  return path.join(match.parentPath, match.name);
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value");
  return value;
}
