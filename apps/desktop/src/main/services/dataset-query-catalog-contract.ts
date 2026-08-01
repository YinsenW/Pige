import type { DatasetLogicalType } from "@pige/schemas";
import type { ColumnOpaqueRef, DatasetOpaqueRef, TableOpaqueRef } from "./dataset-query-types";

export interface DatasetQueryCatalogEnvelope {
  readonly schemaVersion: 1;
  readonly status: "ready" | "empty";
  readonly datasets: readonly {
    readonly datasetRef: DatasetOpaqueRef;
    readonly title: string;
    readonly tables: readonly {
      readonly tableRef: TableOpaqueRef;
      readonly name: string;
      readonly columns: readonly {
        readonly columnRef: ColumnOpaqueRef;
        readonly name: string;
        readonly logicalType: DatasetLogicalType;
        readonly relationJoin?: {
          readonly targetTableRef: TableOpaqueRef;
          readonly targetDisplayColumnRef: ColumnOpaqueRef;
        };
      }[];
    }[];
  }[];
  readonly queryContract: {
    readonly action: "query";
    readonly filterOperators: readonly string[];
    readonly aggregateOperators: readonly string[];
    readonly orderDirections: readonly string[];
    readonly aggregateRefs: string;
    readonly relationJoin: string;
    readonly limits: {
      readonly selectedColumns: number;
      readonly filters: number;
      readonly groupByColumns: number;
      readonly aggregates: number;
      readonly orderBy: number;
      readonly rows: number;
    };
  };
  readonly omitted: { readonly datasets: number; readonly tables: number; readonly columns: number };
}
