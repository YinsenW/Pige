import { useLayoutEffect, useState, type ReactNode } from "react";
import type { MemoryRecordSummary } from "@pige/schemas";
import { PigeIcon } from "./PigeIcon";

type MemoryRecordStatusFilter = "all" | MemoryRecordSummary["status"];

export function AgentMemoryRecordBrowser(props: {
  readonly ownerIdentity: string;
  readonly records: readonly MemoryRecordSummary[];
  readonly pinnedRecordId?: string;
  readonly t: (key: string) => string;
  readonly children: (records: readonly MemoryRecordSummary[]) => ReactNode;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MemoryRecordStatusFilter>("all");

  useLayoutEffect(() => {
    setQuery("");
    setStatus("all");
  }, [props.ownerIdentity]);

  const normalizedQuery = normalizeQuery(query);
  const visibleRecords = props.records.filter(
    (record) =>
      record.id === props.pinnedRecordId ||
      ((status === "all" || record.status === status) &&
        (!normalizedQuery ||
          normalizeQuery(`${record.title}\n${record.body}`).includes(
            normalizedQuery,
          ))),
  );

  return (
    <div className="memory-record-browser">
      <div
        className="settings-inline-actions"
        role="search"
        aria-label={props.t("memory.filter.title")}
      >
        <label className="settings-search-wrap">
          <PigeIcon name="search" size={14} aria-hidden="true" />
          <input
            className="settings-search"
            type="search"
            maxLength={200}
            value={query}
            placeholder={props.t("memory.filter.search")}
            aria-label={props.t("memory.filter.search")}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <select
          className="settings-select"
          value={status}
          aria-label={props.t("memory.filter.status")}
          onChange={(event) =>
            setStatus(event.currentTarget.value as MemoryRecordStatusFilter)
          }
        >
          <option value="all">{props.t("memory.filter.all")}</option>
          <option value="active">{props.t("memory.status.active")}</option>
          <option value="disabled">{props.t("memory.status.disabled")}</option>
        </select>
      </div>
      <p className="settings-note">
        {props
          .t("memory.filter.count")
          .replace("{visible}", String(visibleRecords.length))
          .replace("{total}", String(props.records.length))}
      </p>
      {visibleRecords.length > 0 ? (
        props.children(visibleRecords)
      ) : (
        <p className="settings-note" data-memory-filter-empty="true">
          {props.t("memory.filter.empty")}
        </p>
      )}
    </div>
  );
}

function normalizeQuery(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
}
