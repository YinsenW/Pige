import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CollectionRenameColumnRequest,
  CollectionRenameColumnResult,
  CollectionSnapshot,
  CollectionTrashColumnRequest,
  CollectionTrashColumnResult
} from "@pige/schemas";
import { PigeIcon } from "./PigeIcon";

export type CollectionColumnActionNotice =
  | "column_renamed"
  | "rename_stale"
  | "rename_duplicate"
  | "rename_ineligible"
  | "rename_not_found"
  | "rename_failed"
  | "column_trashed"
  | "column_trash_stale"
  | "column_trash_ineligible"
  | "column_trash_not_found"
  | "column_trash_failed";

type RenameDraft = {
  readonly columnId: string;
  readonly expectedRevisionId: string;
  readonly originalLabel: string;
  readonly label: string;
};

export function ManagedCollectionColumnActions(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly blocked: boolean;
  readonly hasRowActions: boolean;
  readonly requestedFocusColumnId: string | null;
  readonly onFocusHandled: () => void;
  readonly onRenameColumn: (
    request: CollectionRenameColumnRequest
  ) => Promise<CollectionRenameColumnResult>;
  readonly onTrashColumn: (
    request: CollectionTrashColumnRequest
  ) => Promise<CollectionTrashColumnResult>;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string) => boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onNotice: (notice: CollectionColumnActionNotice | null) => void;
  readonly onFallbackFocus: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null);
  const [busyColumnId, setBusyColumnId] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const activeRequestRef = useRef<{ readonly sequence: number; readonly columnId: string } | null>(null);
  const ownerKey = `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
  const ownerKeyRef = useRef(ownerKey);
  const revisionRef = useRef(props.snapshot.revisionId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const headerRefs = useRef(new Map<string, HTMLTableCellElement>());
  const trashTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusRef = useRef<{
    readonly columnId: string | null;
    readonly preferTrash: boolean;
  } | null>(null);
  const pendingEditorFocusRef = useRef(false);
  ownerKeyRef.current = ownerKey;
  revisionRef.current = props.snapshot.revisionId;

  useEffect(() => {
    requestSequence.current += 1;
    activeRequestRef.current = null;
    pendingFocusRef.current = null;
    pendingEditorFocusRef.current = false;
    setRenameDraft(null);
    setBusyColumnId(null);
    props.onBusyChange(false);
    props.onNotice(null);
  }, [ownerKey]);

  useEffect(() => {
    if (renameDraft && !busyColumnId) inputRef.current?.focus();
  }, [renameDraft?.columnId, renameDraft?.expectedRevisionId]);

  useLayoutEffect(() => {
    if (busyColumnId) return;
    if (pendingEditorFocusRef.current && renameDraft) {
      pendingEditorFocusRef.current = false;
      inputRef.current?.focus();
      return;
    }
    if (props.requestedFocusColumnId) {
      const requested = headerRefs.current.get(props.requestedFocusColumnId);
      if (requested) {
        requested.focus();
        props.onFocusHandled();
        return;
      }
    }
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const target = pending.columnId
      ? (pending.preferTrash ? trashTriggerRefs.current.get(pending.columnId) : null) ??
        headerRefs.current.get(pending.columnId)
      : null;
    pendingFocusRef.current = null;
    if (target) target.focus();
    else props.onFallbackFocus();
  }, [busyColumnId, renameDraft, props.requestedFocusColumnId, props.snapshot.revisionId]);

  const beginRequest = (columnId: string): number | null => {
    if (props.blocked || activeRequestRef.current) return null;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    activeRequestRef.current = { sequence, columnId };
    setBusyColumnId(columnId);
    props.onBusyChange(true);
    props.onNotice(null);
    return sequence;
  };

  const finishRequest = (sequence: number, expectedOwnerKey: string): void => {
    if (activeRequestRef.current?.sequence === sequence) activeRequestRef.current = null;
    if (sequence !== requestSequence.current || ownerKeyRef.current !== expectedOwnerKey) return;
    setBusyColumnId(null);
    props.onBusyChange(false);
  };

  const renameColumn = async (): Promise<void> => {
    if (!renameDraft) return;
    const column = props.snapshot.columns.find((candidate) => candidate.columnId === renameDraft.columnId);
    const label = renameDraft.label.trim();
    if (!column?.canRename || label.length === 0 || label === renameDraft.originalLabel) return;
    const sequence = beginRequest(column.columnId);
    if (sequence === null) return;
    const request: CollectionRenameColumnRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId: renameDraft.expectedRevisionId,
      columnId: column.columnId,
      label
    };
    const expectedOwnerKey = ownerKey;
    try {
      const result = await props.onRenameColumn(request);
      if (!isCurrent(sequence, expectedOwnerKey, request.expectedRevisionId) ||
          !columnIdentityMatches(request, result)) return;
      if ("snapshot" in result && !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        pendingFocusRef.current = { columnId: result.columnId, preferTrash: false };
        setRenameDraft(null);
        props.onNotice("column_renamed");
        return;
      }
      pendingEditorFocusRef.current = true;
      if ("snapshot" in result) {
        const currentColumn = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId);
        setRenameDraft((current) => current ? {
          ...current,
          expectedRevisionId: result.snapshot.revisionId,
          originalLabel: currentColumn?.label ?? current.originalLabel
        } : current);
      }
      props.onNotice(result.status === "stale"
        ? "rename_stale"
        : result.status === "duplicate"
          ? "rename_duplicate"
          : result.status === "ineligible"
            ? "rename_ineligible"
            : result.status === "not_found"
              ? "rename_not_found"
              : "rename_failed");
    } catch {
      if (isCurrent(sequence, expectedOwnerKey)) {
        pendingEditorFocusRef.current = true;
        props.onNotice("rename_failed");
      }
    } finally {
      finishRequest(sequence, expectedOwnerKey);
    }
  };

  const trashColumn = async (columnId: string, columnIndex: number): Promise<void> => {
    const column = props.snapshot.columns.find((candidate) => candidate.columnId === columnId);
    if (!column?.canTrash) return;
    const sequence = beginRequest(columnId);
    if (sequence === null) return;
    const request: CollectionTrashColumnRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId: props.snapshot.revisionId,
      columnId
    };
    const expectedOwnerKey = ownerKey;
    try {
      const result = await props.onTrashColumn(request);
      if (!isCurrent(sequence, expectedOwnerKey, request.expectedRevisionId) ||
          !columnIdentityMatches(request, result)) return;
      if ("snapshot" in result && !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        pendingFocusRef.current = {
          columnId: result.snapshot.columns[columnIndex]?.columnId ??
            result.snapshot.columns[columnIndex - 1]?.columnId ?? null,
          preferTrash: false
        };
        props.onNotice("column_trashed");
        return;
      }
      pendingFocusRef.current = { columnId, preferTrash: true };
      props.onNotice(result.status === "stale"
        ? "column_trash_stale"
        : result.status === "ineligible"
          ? "column_trash_ineligible"
          : result.status === "not_found"
            ? "column_trash_not_found"
            : "column_trash_failed");
    } catch {
      if (isCurrent(sequence, expectedOwnerKey)) {
        pendingFocusRef.current = { columnId, preferTrash: true };
        props.onNotice("column_trash_failed");
      }
    } finally {
      finishRequest(sequence, expectedOwnerKey);
    }
  };

  const isCurrent = (sequence: number, expectedOwnerKey: string, expectedRevisionId?: string): boolean =>
    sequence === requestSequence.current &&
    ownerKeyRef.current === expectedOwnerKey &&
    (expectedRevisionId === undefined || revisionRef.current === expectedRevisionId);

  const cancelRename = (): void => {
    if (busyColumnId || !renameDraft) return;
    pendingFocusRef.current = { columnId: renameDraft.columnId, preferTrash: false };
    setRenameDraft(null);
    props.onNotice(null);
  };

  return (
    <tr>{props.snapshot.columns.map((column, columnIndex) => (
      <th
        scope="col"
        key={column.columnId}
        ref={(element) => {
          if (element) headerRefs.current.set(column.columnId, element);
          else headerRefs.current.delete(column.columnId);
        }}
        tabIndex={-1}
        data-collection-column-id={column.columnId}
      >
        {renameDraft?.columnId === column.columnId ? (
          <form onSubmit={(event) => { event.preventDefault(); void renameColumn(); }}>
            <input
              ref={inputRef}
              className="settings-input"
              value={renameDraft.label}
              maxLength={120}
              disabled={busyColumnId !== null}
              aria-label={`${props.t("collection.fieldName")}: ${column.label}`}
              onChange={(event) => {
                setRenameDraft((current) => current ? { ...current, label: event.target.value } : current);
                props.onNotice(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRename();
                }
              }}
            />
            <button
              type="submit"
              className="settings-button"
              disabled={busyColumnId !== null || !column.canRename || renameDraft.label.trim().length === 0 || renameDraft.label.trim() === renameDraft.originalLabel}
            >
              {props.t(busyColumnId === column.columnId ? "collection.renamingField" : "collection.save")}
            </button>
            <button type="button" className="ghost" disabled={busyColumnId !== null} onClick={cancelRename}>
              {props.t("collection.cancel")}
            </button>
          </form>
        ) : (
          <>
            {column.canRename ? (
              <button
                type="button"
                className="ghost"
                aria-label={`${props.t("collection.renameField")}: ${column.label}`}
                disabled={props.blocked || busyColumnId !== null}
                onClick={() => {
                  if (props.blocked || activeRequestRef.current) return;
                  props.onNotice(null);
                  setRenameDraft({
                    columnId: column.columnId,
                    expectedRevisionId: props.snapshot.revisionId,
                    originalLabel: column.label,
                    label: column.label
                  });
                }}
              >
                {column.label}
              </button>
            ) : column.label}
            {column.canTrash ? (
              <button
                type="button"
                className="ghost"
                ref={(element) => {
                  if (element) trashTriggerRefs.current.set(column.columnId, element);
                  else trashTriggerRefs.current.delete(column.columnId);
                }}
                aria-label={`${props.t("collection.trashField")}: ${column.label}`}
                title={props.t("collection.trashField")}
                disabled={props.blocked || busyColumnId !== null}
                onClick={() => void trashColumn(column.columnId, columnIndex)}
              >
                <PigeIcon name="trash" size={13} />
              </button>
            ) : null}
          </>
        )}
      </th>
    ))}{props.hasRowActions ? <th scope="col">{props.t("collection.actions")}</th> : null}</tr>
  );
}

function createCollectionRequestId(): `collection_request_${string}` {
  return `collection_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function columnIdentityMatches(
  request: CollectionRenameColumnRequest | CollectionTrashColumnRequest,
  result: CollectionRenameColumnResult | CollectionTrashColumnResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId &&
    result.tableId === request.tableId &&
    result.columnId === request.columnId;
}
