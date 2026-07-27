import { useEffect, useRef, useState } from "react";
import type {
  MemoryLifecycleMutationResult,
  MemoryRecordSummary,
  MemorySummary,
} from "@pige/schemas";
import { PigeIcon } from "./PigeIcon";

type Translate = (key: string) => string;
type PendingAction =
  | {
      readonly kind: "disable" | "enable" | "delete";
      readonly memoryId: string;
    }
  | { readonly kind: "export" | "reset" };

function createMemoryRequestId(): string {
  return `memory_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

export interface AgentMemorySettingsPanelProps {
  readonly activeVaultId: string | null;
  readonly t: Translate;
}

export function AgentMemorySettingsPanel(
  props: AgentMemorySettingsPanelProps,
): React.JSX.Element {
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [readState, setReadState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle");
  const [reloadSequence, setReloadSequence] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const operationSequenceRef = useRef(0);
  const operationActiveRef = useRef(false);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const resetConfirmRef = useRef<HTMLButtonElement>(null);
  activeVaultIdRef.current = props.activeVaultId;

  useEffect(() => {
    mountedRef.current = true;
    operationSequenceRef.current += 1;
    operationActiveRef.current = false;
    const requestedVaultId = props.activeVaultId;
    let current = true;
    setSummary(null);
    setStatusKey(null);
    setPendingAction(null);
    setResetConfirmationOpen(false);
    if (!requestedVaultId) {
      setReadState("idle");
      return () => {
        current = false;
        mountedRef.current = false;
      };
    }
    const memoryApi = window.pige.memory;
    if (!memoryApi) {
      setReadState("failed");
      return () => {
        current = false;
        mountedRef.current = false;
      };
    }

    setReadState("loading");
    void memoryApi
      .list({ apiVersion: 1, activeVaultId: requestedVaultId })
      .then((next) => {
        if (
          !current ||
          activeVaultIdRef.current !== requestedVaultId ||
          next.activeVaultId !== requestedVaultId
        )
          return;
        setSummary(next);
        setReadState("ready");
      })
      .catch(() => {
        if (current && activeVaultIdRef.current === requestedVaultId)
          setReadState("failed");
      });
    return () => {
      current = false;
      mountedRef.current = false;
    };
  }, [props.activeVaultId, reloadSequence]);

  useEffect(() => {
    if (resetConfirmationOpen) resetConfirmRef.current?.focus();
  }, [resetConfirmationOpen]);

  const beginAction = (action: PendingAction): number | null => {
    if (operationActiveRef.current) return null;
    const sequence = operationSequenceRef.current + 1;
    operationSequenceRef.current = sequence;
    operationActiveRef.current = true;
    setPendingAction(action);
    setStatusKey(null);
    return sequence;
  };

  const isCurrentAction = (sequence: number, vaultId: string): boolean =>
    mountedRef.current &&
    operationSequenceRef.current === sequence &&
    activeVaultIdRef.current === vaultId;

  const finishAction = (sequence: number, vaultId: string): void => {
    if (isCurrentAction(sequence, vaultId)) {
      operationActiveRef.current = false;
      setPendingAction(null);
    }
  };

  const adoptLifecycleResult = (
    result: MemoryLifecycleMutationResult,
    requestId: string,
    vaultId: string,
    sequence: number,
    completedKey: string,
  ): void => {
    if (!isCurrentAction(sequence, vaultId)) return;
    if (
      result.requestId !== requestId ||
      result.activeVaultId !== vaultId ||
      result.summary.activeVaultId !== vaultId
    ) {
      setStatusKey("memory.changeFailed");
      return;
    }
    setSummary(result.summary);
    setReadState("ready");
    setStatusKey(
      result.status === "committed"
        ? completedKey
        : result.status === "stale"
          ? "memory.changeStale"
          : "memory.changeNotFound",
    );
  };

  const mutateRecord = async (
    record: MemoryRecordSummary,
    kind: "disable" | "enable" | "delete",
  ): Promise<void> => {
    const requestedSummary = summary;
    const memoryApi = window.pige.memory;
    if (!memoryApi || !requestedSummary) return;
    if (
      (kind === "disable" && record.status !== "active") ||
      (kind === "enable" && record.status !== "disabled")
    )
      return;
    const sequence = beginAction({ kind, memoryId: record.id });
    if (sequence === null) return;
    const requestedVaultId = requestedSummary.activeVaultId;
    const requestId = createMemoryRequestId();
    try {
      const request = {
        apiVersion: 1 as const,
        requestId,
        activeVaultId: requestedVaultId,
        memoryId: record.id,
        expectedRevision: requestedSummary.revision,
      };
      if (kind === "disable") {
        const result = await memoryApi.disable(request);
        if (!isCurrentAction(sequence, requestedVaultId)) return;
        if (result.summary.activeVaultId !== requestedVaultId) {
          setStatusKey("memory.changeFailed");
          return;
        }
        setSummary(result.summary);
        setReadState("ready");
        setStatusKey(
          result.status === "committed"
            ? "memory.disableCompleted"
            : result.status === "stale"
              ? "memory.changeStale"
              : "memory.changeNotFound",
        );
      } else {
        const result =
          kind === "enable"
            ? await memoryApi.enable(request)
            : await memoryApi.delete(request);
        adoptLifecycleResult(
          result,
          requestId,
          requestedVaultId,
          sequence,
          kind === "enable"
            ? "memory.enableCompleted"
            : "memory.deleteCompleted",
        );
      }
    } catch {
      if (isCurrentAction(sequence, requestedVaultId))
        setStatusKey("memory.changeFailed");
    } finally {
      finishAction(sequence, requestedVaultId);
    }
  };

  const exportMemory = async (): Promise<void> => {
    const requestedSummary = summary;
    const memoryApi = window.pige.memory;
    if (!memoryApi || !requestedSummary) return;
    const sequence = beginAction({ kind: "export" });
    if (sequence === null) return;
    const requestedVaultId = requestedSummary.activeVaultId;
    const requestId = createMemoryRequestId();
    try {
      const result = await memoryApi.export({
        apiVersion: 1,
        requestId,
        activeVaultId: requestedVaultId,
        expectedRevision: requestedSummary.revision,
      });
      if (!isCurrentAction(sequence, requestedVaultId)) return;
      if (
        result.requestId !== requestId ||
        result.activeVaultId !== requestedVaultId
      ) {
        setStatusKey("memory.exportFailed");
      } else if (result.status === "exported" && result.revision === requestedSummary.revision) {
        setStatusKey("memory.exportCompleted");
      } else if (result.status === "stale") {
        setStatusKey("memory.exportStale");
        const current = await memoryApi.list({
          apiVersion: 1,
          activeVaultId: requestedVaultId,
        });
        if (
          isCurrentAction(sequence, requestedVaultId) &&
          current.activeVaultId === requestedVaultId
        ) {
          setSummary(current);
          setReadState("ready");
        }
      } else if (result.status === "failed" || result.status === "exported") {
        setStatusKey("memory.exportFailed");
      }
    } catch {
      if (isCurrentAction(sequence, requestedVaultId))
        setStatusKey("memory.exportFailed");
    } finally {
      finishAction(sequence, requestedVaultId);
    }
  };

  const resetMemory = async (): Promise<void> => {
    const requestedSummary = summary;
    const memoryApi = window.pige.memory;
    if (!memoryApi || !requestedSummary) return;
    const sequence = beginAction({ kind: "reset" });
    if (sequence === null) return;
    const requestedVaultId = requestedSummary.activeVaultId;
    const requestId = createMemoryRequestId();
    setResetConfirmationOpen(false);
    try {
      const result = await memoryApi.reset({
        apiVersion: 1,
        requestId,
        activeVaultId: requestedVaultId,
        expectedRevision: requestedSummary.revision,
      });
      adoptLifecycleResult(
        result,
        requestId,
        requestedVaultId,
        sequence,
        "memory.resetCompleted",
      );
    } catch {
      if (isCurrentAction(sequence, requestedVaultId))
        setStatusKey("memory.changeFailed");
    } finally {
      finishAction(sequence, requestedVaultId);
    }
  };

  const closeResetConfirmation = (): void => {
    setResetConfirmationOpen(false);
    window.setTimeout(() => resetTriggerRef.current?.focus(), 0);
  };

  const busy = pendingAction !== null;

  return (
    <section
      className="settings-page memory-settings-page"
      aria-labelledby="settings-memory-title"
    >
      <header className="settings-panel-header">
        <h1 id="settings-memory-title">{props.t("memory.title")}</h1>
        <p>{props.t("memory.subtitle")}</p>
      </header>

      <section
        className="settings-section"
        role="group"
        aria-labelledby="memory-records-title"
      >
        <h2 className="settings-section-title" id="memory-records-title">
          {props.t("memory.savedMemories")}
        </h2>
        {!props.activeVaultId ? (
          <MemoryStateCard
            icon="folder"
            title={props.t("memory.noVaultTitle")}
            description={props.t("memory.noVaultDescription")}
          />
        ) : readState === "loading" ? (
          <MemoryStateCard
            icon="loading"
            title={props.t("memory.loadingTitle")}
            description={props.t("memory.loadingDescription")}
            loading
          />
        ) : readState === "failed" ? (
          <div className="settings-card memory-empty-card" role="alert">
            <PigeIcon name="shield" size={20} aria-hidden="true" />
            <div className="settings-row-copy">
              <strong>{props.t("memory.loadFailedTitle")}</strong>
              <span>{props.t("memory.loadFailedDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              onClick={() => setReloadSequence((value) => value + 1)}
            >
              {props.t("memory.retryLoad")}
            </button>
          </div>
        ) : summary && summary.records.length > 0 ? (
          <div
            className="settings-card"
            data-memory-revision={summary.revision}
          >
            {summary.records.map((record) => (
              <div
                className="settings-row tall"
                data-memory-id={record.id}
                key={record.id}
              >
                <span
                  className={`settings-list-icon ${record.status === "active" ? "is-enabled" : "neutral"}`}
                  aria-hidden="true"
                >
                  <PigeIcon name="memory" size={17} />
                </span>
                <div className="settings-row-copy">
                  <strong>{record.title}</strong>
                  <span>{record.body}</span>
                  <div
                    className="skill-registry-meta"
                    aria-label={props.t("memory.recordDetails")}
                  >
                    <span>{props.t(`memory.kind.${record.kind}`)}</span>
                    <span>{props.t(`memory.status.${record.status}`)}</span>
                    <span>
                      {props.t("memory.provenance")}:{" "}
                      {props.t("memory.provenance.explicitUserRequest")}
                    </span>
                    <time dateTime={record.provenance.occurredAt}>
                      {record.provenance.occurredAt}
                    </time>
                    <time dateTime={record.updatedAt}>
                      {props.t("memory.updated")}: {record.updatedAt}
                    </time>
                  </div>
                </div>
                <div className="settings-row-control">
                  <span
                    className={`settings-status ${record.status === "active" ? "is-enabled" : "neutral"}`}
                  >
                    {props.t(`memory.status.${record.status}`)}
                  </span>
                  <button
                    className="settings-button"
                    type="button"
                    aria-label={`${props.t(record.status === "active" ? "memory.disable" : "memory.enable")}: ${record.title}`}
                    disabled={busy}
                    title={props.t(
                      record.status === "active"
                        ? "memory.disableDescription"
                        : "memory.enableDescription",
                    )}
                    onClick={() =>
                      void mutateRecord(
                        record,
                        record.status === "active" ? "disable" : "enable",
                      )
                    }
                  >
                    {pendingAction &&
                    "memoryId" in pendingAction &&
                    pendingAction.memoryId === record.id &&
                    pendingAction.kind !== "delete"
                      ? props.t(
                          record.status === "active"
                            ? "memory.disabling"
                            : "memory.enabling",
                        )
                      : props.t(
                          record.status === "active"
                            ? "memory.disable"
                            : "memory.enable",
                        )}
                  </button>
                  <button
                    className="settings-button"
                    type="button"
                    aria-label={`${props.t("memory.delete")}: ${record.title}`}
                    disabled={busy}
                    title={props.t("memory.deleteDescription")}
                    onClick={() => void mutateRecord(record, "delete")}
                  >
                    {pendingAction?.kind === "delete" &&
                    pendingAction.memoryId === record.id
                      ? props.t("memory.deleting")
                      : props.t("memory.delete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : readState === "ready" ? (
          <MemoryStateCard
            icon="memory"
            title={props.t("memory.emptyTitle")}
            description={props.t("memory.emptyDescription")}
          />
        ) : null}
        {summary ? (
          <div className="settings-inline-actions">
            <button
              className="settings-button settings-action"
              type="button"
              disabled={busy}
              onClick={() => void exportMemory()}
            >
              {pendingAction?.kind === "export"
                ? props.t("memory.exporting")
                : props.t("memory.export")}
            </button>
            <button
              ref={resetTriggerRef}
              className="settings-button settings-action"
              type="button"
              disabled={busy}
              aria-expanded={resetConfirmationOpen}
              aria-controls="memory-reset-confirmation"
              onClick={() => {
                setResetConfirmationOpen(true);
                setStatusKey(null);
              }}
            >
              {props.t("memory.reset")}
            </button>
          </div>
        ) : null}
        {resetConfirmationOpen ? (
          <div
            className="settings-card"
            id="memory-reset-confirmation"
            role="alertdialog"
            aria-labelledby="memory-reset-title"
            aria-describedby="memory-reset-description"
            onKeyDown={(event) => {
              if (event.key === "Escape") closeResetConfirmation();
            }}
          >
            <div className="settings-row-copy">
              <strong id="memory-reset-title">
                {props.t("memory.resetConfirmTitle")}
              </strong>
              <span id="memory-reset-description">
                {props.t("memory.resetConfirmDescription")}
              </span>
            </div>
            <div className="settings-inline-actions">
              <button
                className="settings-button"
                type="button"
                onClick={closeResetConfirmation}
              >
                {props.t("memory.cancel")}
              </button>
              <button
                ref={resetConfirmRef}
                className="settings-button primary"
                type="button"
                onClick={() => void resetMemory()}
              >
                {props.t("memory.resetConfirm")}
              </button>
            </div>
          </div>
        ) : null}
        {statusKey ? (
          <p className="settings-note" role="status" aria-live="polite">
            {props.t(statusKey)}
          </p>
        ) : null}
      </section>
    </section>
  );
}

function MemoryStateCard(props: {
  readonly icon: "folder" | "loading" | "memory";
  readonly title: string;
  readonly description: string;
  readonly loading?: boolean;
}): React.JSX.Element {
  return (
    <div
      className="settings-card memory-empty-card"
      role="status"
      aria-live="polite"
    >
      <PigeIcon
        name={props.icon}
        size={20}
        className={props.loading ? "spinning" : undefined}
        aria-hidden="true"
      />
      <div className="settings-row-copy">
        <strong>{props.title}</strong>
        <span>{props.description}</span>
      </div>
    </div>
  );
}
