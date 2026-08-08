import { useEffect, useRef, useState } from "react";
import type { ModelProfileSummary } from "@pige/contracts";

export function ModelInventoryRow(props: {
  readonly model: ModelProfileSummary;
  readonly busy: boolean;
  readonly onDeleteManual: (modelProfileId: string) => Promise<boolean>;
  readonly onSetEnabled: (modelProfileId: string, enabled: boolean) => Promise<void>;
  readonly onSetDisplayName: (modelProfileId: string, displayName: string | null) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const initialName = props.model.displayName && props.model.displayName !== props.model.modelId
    ? props.model.displayName
    : "";
  const [displayName, setDisplayName] = useState(initialName);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const removeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const keepButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmRemoveButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingFocusRef = useRef<"keep" | "remove" | "confirm" | null>(null);

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    const target = pendingFocus === "keep"
      ? keepButtonRef.current
      : pendingFocus === "confirm"
        ? confirmRemoveButtonRef.current
        : pendingFocus === "remove"
          ? removeTriggerRef.current
          : null;
    if (!target) return;
    pendingFocusRef.current = null;
    target.focus();
  }, [confirmingRemoval, removeFailed]);

  const removeManualModel = async (): Promise<void> => {
    setRemoveFailed(false);
    if (await props.onDeleteManual(props.model.id)) {
      pendingFocusRef.current = "remove";
      setConfirmingRemoval(false);
      return;
    }
    pendingFocusRef.current = "confirm";
    setRemoveFailed(true);
  };
  return (
    <div className="settings-row model-row">
      <span className="settings-row-copy">
        <strong>{props.model.displayName ?? props.model.modelId}</strong>
        <span>{props.model.source === "manual" ? props.t("models.manual") : props.model.modelId}</span>
      </span>
      <div className="settings-row-control model-row-controls">
        <details className="model-name-editor">
          <summary className="settings-button">{props.t("models.editDisplayName")}</summary>
          <div className="model-name-fields">
            <label htmlFor={`model-display-name-${props.model.id}`}>{props.t("models.displayName")}</label>
            <input
              className="settings-input"
              id={`model-display-name-${props.model.id}`}
              value={displayName}
              placeholder={props.model.modelId}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <button
              type="button"
              className="settings-button"
              disabled={props.busy}
              onClick={() => void props.onSetDisplayName(props.model.id, displayName.trim() || null)}
            >
              {props.t("models.saveDisplayName")}
            </button>
          </div>
        </details>
        <button
          type="button"
          className="settings-switch"
          role="switch"
          aria-checked={props.model.enabled}
          disabled={props.busy || props.model.isDefault}
          aria-label={`${props.t("models.enabled")}: ${props.model.displayName ?? props.model.modelId}`}
          title={props.model.isDefault ? props.t("models.default") : props.t("models.enabled")}
          onClick={() => void props.onSetEnabled(props.model.id, !props.model.enabled)}
        />
        {props.model.source === "manual" && !confirmingRemoval ? (
          <button
            ref={removeTriggerRef}
            data-model-remove-trigger="true"
            type="button"
            className="settings-button"
            disabled={props.busy}
            onClick={() => {
              setRemoveFailed(false);
              pendingFocusRef.current = "keep";
              setConfirmingRemoval(true);
            }}
          >
            {props.t("models.removeManualModel")}
          </button>
        ) : null}
      </div>
      {props.model.source === "manual" && confirmingRemoval ? (
        <div className="settings-row-control model-row-confirmation" role="group" aria-label={props.t("models.confirmRemoveManualModel")}>
          <span className="settings-row-copy">
            <strong>{props.t("models.confirmRemoveManualModel")}</strong>
            <span>{props.t("models.confirmRemoveManualModelDescription")}</span>
          </span>
          <button
            ref={keepButtonRef}
            type="button"
            className="settings-button"
            disabled={props.busy}
            onClick={() => {
              setRemoveFailed(false);
              pendingFocusRef.current = "remove";
              setConfirmingRemoval(false);
            }}
          >
            {props.t("models.keepManualModel")}
          </button>
          <button
            ref={confirmRemoveButtonRef}
            type="button"
            className="settings-button"
            disabled={props.busy}
            onClick={() => void removeManualModel()}
          >
            {props.t("models.removeManualModel")}
          </button>
        </div>
      ) : null}
      {removeFailed ? (
        <div className="settings-warning model-settings-error" role="alert">{props.t("models.manualModelDeleteFailed")}</div>
      ) : null}
    </div>
  );
}
