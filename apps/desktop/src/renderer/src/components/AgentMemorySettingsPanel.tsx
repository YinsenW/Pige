import { useEffect, useRef, useState } from "react";
import type {
  MemoryRecordSummary,
  MemorySummary
} from "@pige/schemas";
import { PigeIcon } from "./PigeIcon";

type Translate = (key: string) => string;

function createMemoryRequestId(): string {
  return `memory_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

export interface AgentMemorySettingsPanelProps {
  readonly activeVaultId: string | null;
  readonly t: Translate;
}

export function AgentMemorySettingsPanel(props: AgentMemorySettingsPanelProps): React.JSX.Element {
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [readState, setReadState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [reloadSequence, setReloadSequence] = useState(0);
  const [disablingMemoryId, setDisablingMemoryId] = useState<string | null>(null);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const activeVaultIdRef = useRef(props.activeVaultId);
  activeVaultIdRef.current = props.activeVaultId;

  useEffect(() => {
    mountedRef.current = true;
    const requestedVaultId = props.activeVaultId;
    let current = true;
    setSummary(null);
    setStatusKey(null);
    setDisablingMemoryId(null);
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
    void memoryApi.list({ apiVersion: 1, activeVaultId: requestedVaultId }).then((next) => {
      if (!current || activeVaultIdRef.current !== requestedVaultId || next.activeVaultId !== requestedVaultId) return;
      setSummary(next);
      setReadState("ready");
    }).catch(() => {
      if (current && activeVaultIdRef.current === requestedVaultId) setReadState("failed");
    });
    return () => {
      current = false;
      mountedRef.current = false;
    };
  }, [props.activeVaultId, reloadSequence]);

  const disableMemory = async (record: MemoryRecordSummary): Promise<void> => {
    const requestedSummary = summary;
    const memoryApi = window.pige.memory;
    if (!memoryApi || !requestedSummary || record.status !== "active" || disablingMemoryId) return;
    const requestedVaultId = requestedSummary.activeVaultId;
    setDisablingMemoryId(record.id);
    setStatusKey(null);
    try {
      const result = await memoryApi.disable({
        apiVersion: 1,
        requestId: createMemoryRequestId(),
        activeVaultId: requestedVaultId,
        memoryId: record.id,
        expectedRevision: requestedSummary.revision
      });
      if (!mountedRef.current || activeVaultIdRef.current !== requestedVaultId) return;
      if (result.summary.activeVaultId !== requestedVaultId) {
        setStatusKey("memory.disableFailed");
        return;
      }
      setSummary(result.summary);
      setReadState("ready");
      setStatusKey(result.status === "committed"
        ? "memory.disableCompleted"
        : result.status === "stale"
          ? "memory.disableStale"
          : "memory.disableNotFound");
    } catch {
      if (mountedRef.current && activeVaultIdRef.current === requestedVaultId) {
        setStatusKey("memory.disableFailed");
      }
    } finally {
      if (mountedRef.current && activeVaultIdRef.current === requestedVaultId) setDisablingMemoryId(null);
    }
  };

  return (
    <section className="settings-page memory-settings-page" aria-labelledby="settings-memory-title">
      <header className="settings-panel-header">
        <h1 id="settings-memory-title">{props.t("memory.title")}</h1>
        <p>{props.t("memory.subtitle")}</p>
      </header>

      <section className="settings-section" role="group" aria-labelledby="memory-records-title">
        <h2 className="settings-section-title" id="memory-records-title">{props.t("memory.savedMemories")}</h2>
        {!props.activeVaultId ? (
          <MemoryStateCard icon="folder" title={props.t("memory.noVaultTitle")} description={props.t("memory.noVaultDescription")} />
        ) : readState === "loading" ? (
          <MemoryStateCard icon="loading" title={props.t("memory.loadingTitle")} description={props.t("memory.loadingDescription")} loading />
        ) : readState === "failed" ? (
          <div className="settings-card memory-empty-card" role="alert">
            <PigeIcon name="shield" size={20} aria-hidden="true" />
            <div className="settings-row-copy">
              <strong>{props.t("memory.loadFailedTitle")}</strong>
              <span>{props.t("memory.loadFailedDescription")}</span>
            </div>
            <button className="settings-button" type="button" onClick={() => setReloadSequence((value) => value + 1)}>
              {props.t("memory.retryLoad")}
            </button>
          </div>
        ) : summary && summary.records.length > 0 ? (
          <div className="settings-card" data-memory-revision={summary.revision}>
            {summary.records.map((record) => (
              <div className="settings-row tall" data-memory-id={record.id} key={record.id}>
                <span className={`settings-list-icon ${record.status === "active" ? "is-enabled" : "neutral"}`} aria-hidden="true">
                  <PigeIcon name="memory" size={17} />
                </span>
                <div className="settings-row-copy">
                  <strong>{record.title}</strong>
                  <span>{record.body}</span>
                  <div className="skill-registry-meta" aria-label={props.t("memory.recordDetails")}>
                    <span>{props.t(`memory.kind.${record.kind}`)}</span>
                    <span>{props.t(`memory.status.${record.status}`)}</span>
                    <span>{props.t("memory.provenance")}: {props.t("memory.provenance.explicitUserRequest")}</span>
                    <time dateTime={record.provenance.occurredAt}>{record.provenance.occurredAt}</time>
                    <time dateTime={record.updatedAt}>{props.t("memory.updated")}: {record.updatedAt}</time>
                  </div>
                </div>
                <div className="settings-row-control">
                  <span className={`settings-status ${record.status === "active" ? "is-enabled" : "neutral"}`}>
                    {props.t(`memory.status.${record.status}`)}
                  </span>
                  <button
                    className="settings-button"
                    type="button"
                    aria-label={`${props.t("memory.disable")}: ${record.title}`}
                    disabled={record.status !== "active" || disablingMemoryId !== null}
                    title={record.status === "active" ? props.t("memory.disableDescription") : props.t("memory.disabledDescription")}
                    onClick={() => void disableMemory(record)}
                  >
                    {disablingMemoryId === record.id ? props.t("memory.disabling") : props.t("memory.disable")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : readState === "ready" ? (
          <MemoryStateCard icon="memory" title={props.t("memory.emptyTitle")} description={props.t("memory.emptyDescription")} />
        ) : null}
        {statusKey ? <p className="settings-note" role="status" aria-live="polite">{props.t(statusKey)}</p> : null}
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
    <div className="settings-card memory-empty-card" role="status" aria-live="polite">
      <PigeIcon name={props.icon} size={20} className={props.loading ? "spinning" : undefined} aria-hidden="true" />
      <div className="settings-row-copy">
        <strong>{props.title}</strong>
        <span>{props.description}</span>
      </div>
    </div>
  );
}
