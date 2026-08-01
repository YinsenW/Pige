import { describe, expect, it } from "vitest";
import type { DatasetSchemaRecord } from "@pige/schemas";
import {
  assertFormulaGraph,
  formulaOperandWouldRemainAcyclic,
  isEligibleFormulaOperand
} from "../../apps/desktop/src/main/services/managed-collection-formula-graph";

describe("managed Collection formula graph", () => {
  it("orders formula dependencies deterministically and rejects an indirect cycle", () => {
    const table = formulaTable();
    expect(assertFormulaGraph({ table }).map((column) => column.id)).toEqual([
      "column_formula00001",
      "column_formula00002"
    ]);
    expect(isEligibleFormulaOperand(table.columns[0]!)).toBe(true);
    expect(isEligibleFormulaOperand(table.columns[1]!)).toBe(true);
    expect(formulaOperandWouldRemainAcyclic({
      table,
      targetColumnId: "column_formula00001",
      expression: {
        kind: "binary",
        operator: "add",
        left: { kind: "column", columnId: "column_formula00002" },
        right: { kind: "literal", value: 1 }
      }
    })).toBe(false);
  });
});

function formulaTable(): DatasetSchemaRecord["tables"][number] {
  return {
    id: "table_formula000001",
    name: "Items",
    sourceLocator: "table:items",
    ordinal: 0,
    rowCount: 1,
    columnCount: 3,
    columns: [{
      id: "column_input0000001",
      name: "Amount",
      ordinal: 0,
      sourceType: "sqlite.integer",
      logicalType: "integer",
      nullable: true
    }, {
      id: "column_formula00001",
      name: "Double",
      ordinal: 1,
      sourceType: "pige_numeric_formula_v1",
      logicalType: "number",
      nullable: true,
      calculation: { kind: "pige_numeric_formula", schemaVersion: 1, expression: {
        kind: "binary", operator: "multiply", left: { kind: "column", columnId: "column_input0000001" },
        right: { kind: "literal", value: 2 }
      } }
    }, {
      id: "column_formula00002",
      name: "Plus one",
      ordinal: 2,
      sourceType: "pige_numeric_formula_v1",
      logicalType: "number",
      nullable: true,
      calculation: { kind: "pige_numeric_formula", schemaVersion: 1, expression: {
        kind: "binary", operator: "add", left: { kind: "column", columnId: "column_formula00001" },
        right: { kind: "literal", value: 1 }
      } }
    }]
  };
}
