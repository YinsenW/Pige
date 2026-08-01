import { PigeDomainError } from "@pige/domain";
import type {
  DatasetColumn,
  DatasetPigeFormulaExpression,
  DatasetSchemaRecord
} from "@pige/schemas";

type DatasetTable = DatasetSchemaRecord["tables"][number];

export type PigeFormulaColumn = DatasetColumn & {
  readonly calculation: {
    readonly kind: "pige_numeric_formula";
    readonly schemaVersion: 1;
    readonly expression: DatasetPigeFormulaExpression;
  };
};

export function formulaReferencedColumnIds(
  expression: DatasetPigeFormulaExpression
): readonly string[] {
  const found = new Set<string>();
  const pending: DatasetPigeFormulaExpression[] = [expression];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.kind === "column") found.add(node.columnId);
    if (node.kind === "binary") pending.push(node.right, node.left);
  }
  return [...found].sort((left, right) => left.localeCompare(right));
}

export function isPigeFormulaColumn(column: DatasetColumn): column is PigeFormulaColumn {
  return column.calculation?.kind === "pige_numeric_formula";
}

export function isEligibleFormulaOperand(column: DatasetColumn): boolean {
  if (column.relation !== undefined) return false;
  if (column.logicalType !== "integer" && column.logicalType !== "number") return false;
  if (column.lookup !== undefined || column.rollup !== undefined) return true;
  if (isPigeFormulaColumn(column)) return true;
  return column.calculation === undefined && ![column.sourceType, ...(column.sourceTypes ?? [])]
    .some((value) => value.toLocaleLowerCase("en-US").includes("formula"));
}

export function assertFormulaGraph(input: {
  readonly table: DatasetTable;
  readonly targetColumnId?: string;
  readonly expression?: DatasetPigeFormulaExpression;
}): readonly PigeFormulaColumn[] {
  const columns = new Map(input.table.columns.map((column) => [column.id, column]));
  const formulaColumns = input.table.columns
    .filter(isPigeFormulaColumn)
    .map((column) => input.targetColumnId === column.id && input.expression
      ? { ...column, calculation: { ...column.calculation, expression: input.expression } }
      : column);
  const formulas = new Map(formulaColumns.map((column) => [column.id, column]));
  for (const formula of formulaColumns) {
    for (const operandId of formulaReferencedColumnIds(formula.calculation.expression)) {
      const operand = columns.get(operandId);
      if (!operand || !isEligibleFormulaOperand(operand)) throw ineligibleOperand();
    }
  }

  const indegree = new Map(formulaColumns.map((column) => [column.id, 0]));
  const downstream = new Map(formulaColumns.map((column) => [column.id, new Set<string>()]));
  for (const formula of formulaColumns) {
    for (const operandId of formulaReferencedColumnIds(formula.calculation.expression)) {
      if (!formulas.has(operandId)) continue;
      indegree.set(formula.id, indegree.get(formula.id)! + 1);
      downstream.get(operandId)!.add(formula.id);
    }
  }

  const compare = (left: string, right: string): number => {
    const leftColumn = formulas.get(left)!;
    const rightColumn = formulas.get(right)!;
    return leftColumn.ordinal - rightColumn.ordinal || left.localeCompare(right);
  };
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort(compare);
  const ordered: PigeFormulaColumn[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(formulas.get(id)!);
    for (const dependentId of [...downstream.get(id)!].sort(compare)) {
      const next = indegree.get(dependentId)! - 1;
      indegree.set(dependentId, next);
      if (next === 0) {
        ready.push(dependentId);
        ready.sort(compare);
      }
    }
  }
  if (ordered.length !== formulaColumns.length) {
    throw new PigeDomainError("collection.formula_cycle", "The Collection formula would create a dependency cycle.");
  }
  return ordered;
}

export function formulaOperandWouldRemainAcyclic(input: {
  readonly table: DatasetTable;
  readonly targetColumnId: string;
  readonly expression: DatasetPigeFormulaExpression;
}): boolean {
  try {
    assertFormulaGraph(input);
    return true;
  } catch {
    return false;
  }
}

function ineligibleOperand(): PigeDomainError {
  return new PigeDomainError(
    "collection.formula_operand_ineligible",
    "The Collection formula operand is unavailable."
  );
}
