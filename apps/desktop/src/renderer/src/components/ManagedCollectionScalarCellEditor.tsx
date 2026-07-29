import type { KeyboardEvent as ReactKeyboardEvent, Ref } from "react";
import type { CollectionCellValue, CollectionScalarValue, DatasetLogicalType } from "@pige/schemas";

export function ManagedCollectionScalarCellEditor(props: {
  readonly inputRef: Ref<HTMLInputElement | HTMLSelectElement>;
  readonly draft: string;
  readonly logicalType: DatasetLogicalType;
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (draft: string) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
}): React.JSX.Element {
  if (props.logicalType === "boolean") {
    return (
      <select
        ref={props.inputRef as Ref<HTMLSelectElement>}
        aria-label={props.label}
        value={props.draft}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={props.onKeyDown}
      >
        <option value="">-</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return (
    <input
      ref={props.inputRef as Ref<HTMLInputElement>}
      type={props.logicalType === "date" ? "date" : props.logicalType === "datetime" ? "datetime-local" : "text"}
      inputMode={props.logicalType === "integer" || props.logicalType === "number" ? "decimal" : undefined}
      aria-label={props.label}
      value={props.draft}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={props.onKeyDown}
    />
  );
}

export function parseCollectionScalar(
  draft: string,
  logicalType: DatasetLogicalType,
  originalValue: CollectionScalarValue
): CollectionScalarValue | undefined {
  if (draft === "" && originalValue === null) return null;
  if (logicalType === "boolean") {
    if (draft === "") return null;
    if (draft === "true") return true;
    if (draft === "false") return false;
    return undefined;
  }
  if (logicalType === "integer") {
    if (!/^-?\d+$/u.test(draft)) return undefined;
    const value = Number(draft);
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (logicalType === "number") {
    if (draft.trim() === "") return undefined;
    const value = Number(draft);
    return Number.isFinite(value) ? value : undefined;
  }
  if (logicalType === "binary" || logicalType === "unknown") return undefined;
  return new TextEncoder().encode(draft).byteLength <= 4096 ? draft : undefined;
}

export function formatCollectionCellValue(value: CollectionCellValue): string {
  if (value === null) return "";
  if (typeof value === "object") return value.displayLabel ?? "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function isCollectionScalarValue(value: CollectionCellValue): value is CollectionScalarValue {
  return value === null || typeof value !== "object";
}
