import { useEffect, useRef, useState } from "react";
import type {
  DiagnosticsEventSelection as DiagnosticsEventSelectionSummary,
  DiagnosticsWorkflowSummary,
  SupportBundlePreview
} from "@pige/contracts";
import {
  PrivateExcerptSupportOption,
  ProviderMetadataSupportOption,
  SupportBundlePreviewTrigger
} from "./DiagnosticsWorkflowCards";

interface DiagnosticsEventSelectionProps {
  readonly selection: DiagnosticsEventSelectionSummary | undefined;
  readonly selectedEventIds: readonly string[];
  readonly disabled: boolean;
  readonly onToggle: (eventId: string) => void;
  readonly t: (key: string) => string;
}

export function DiagnosticsEventSelection(props: DiagnosticsEventSelectionProps): React.JSX.Element | null {
  const selection = props.selection;
  if (!selection) return null;

  const selected = new Set(props.selectedEventIds);
  return (
    <fieldset className="settings-row tall" data-diagnostics-event-selection disabled={props.disabled} aria-describedby="diagnostics-event-selection-description">
      <legend className="settings-row-copy">
        <strong>{props.t("system.selectDiagnosticEvents")}</strong>
        <span id="diagnostics-event-selection-description">{props.t("system.selectDiagnosticEventsDescription")}</span>
      </legend>
      {selection.events.length === 0 ? (
        <p className="muted">{props.t("system.noDiagnosticEvents")}</p>
      ) : (
        <div className="settings-row-copy" data-diagnostics-event-selection-revision={selection.revision}>
          <span>{props.t("system.diagnosticEventSelectionCount")} {selected.size}/{selection.events.length}</span>
          {selection.events.map((event) => {
            const checked = selected.has(event.eventId);
            return (
              <label key={event.eventId} className="settings-row">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={props.disabled || (!checked && selected.size >= 32)}
                  onChange={() => props.onToggle(event.eventId)}
                />
                <span>{props.t(`system.diagnosticEventLevel.${event.level}`)}</span>
                <code>{event.code}</code>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

export function DiagnosticsEventExportComposer(props: {
  readonly workflow: DiagnosticsWorkflowSummary | null;
  readonly recommendedEventIds: readonly string[] | undefined;
  readonly disabled: boolean;
  readonly onPreviewReady: (preview: SupportBundlePreview | null) => void;
  readonly previewRequestRef?: { current: (() => Promise<void>) | null };
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [includeProviderMetadata, setIncludeProviderMetadata] = useState(false);
  const [includePrivateExcerpt, setIncludePrivateExcerpt] = useState(false);
  const [privateExcerpt, setPrivateExcerpt] = useState("");
  const [selectedEventIds, setSelectedEventIds] = useState<readonly string[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [restorePreviewFocus, setRestorePreviewFocus] = useState(false);
  const [notice, setNotice] = useState<"system.diagnosticEventSelectionStale" | "system.previewFailed" | null>(null);
  const previewInFlightRef = useRef(false);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selection = props.workflow?.eventSelection;
  const disabled = props.disabled || previewBusy;

  useEffect(() => {
    if (!restorePreviewFocus || previewBusy) return;
    setRestorePreviewFocus(false);
    previewTriggerRef.current?.focus();
  }, [previewBusy, restorePreviewFocus]);

  useEffect(() => {
    if (!props.recommendedEventIds || !selection) return;
    const available = new Set(selection.events.map((event) => event.eventId));
    const next = props.recommendedEventIds.filter((eventId) => available.has(eventId)).slice(0, 32);
    setSelectedEventIds(next);
    props.onPreviewReady(null);
    setNotice(null);
  }, [props.recommendedEventIds, selection, props.onPreviewReady]);

  const invalidatePreview = (): void => {
    props.onPreviewReady(null);
    setNotice(null);
  };

  const toggleEvent = (eventId: string): void => {
    setSelectedEventIds((current) => current.includes(eventId)
      ? current.filter((candidate) => candidate !== eventId)
      : current.length < 32 ? [...current, eventId] : current);
    invalidatePreview();
  };

  const preview = async (): Promise<void> => {
    if (disabled || previewInFlightRef.current) return;
    if (!selection || selectedEventIds.length === 0 ||
      selectedEventIds.some((eventId) => !selection.events.some((event) => event.eventId === eventId))) {
      setNotice("system.diagnosticEventSelectionStale");
      setRestorePreviewFocus(true);
      return;
    }
    previewInFlightRef.current = true;
    setPreviewBusy(true);
    setNotice(null);
    try {
      const requestId = `diagpreviewreq_${crypto.randomUUID().replaceAll("-", "")}`;
      const optionalCategories = [
        ...(includeProviderMetadata ? ["provider_metadata" as const] : []),
        ...(includePrivateExcerpt ? ["private_excerpt" as const] : [])
      ];
      const preview = await window.pige.diagnostics.previewSupportBundle({
        apiVersion: 1,
        requestId,
        eventSelectionRevision: selection.revision,
        selectedDiagnosticEventIds: [...selectedEventIds],
        optionalCategories,
        ...(includePrivateExcerpt ? { privateExcerpt } : {})
      });
      if (preview.requestId !== requestId || preview.eventSelectionRevision !== selection.revision ||
        !sameStringArray(preview.selectedDiagnosticEventIds, selectedEventIds) ||
        !sameStringArray(preview.selectedOptionalCategories, optionalCategories)) {
        throw new Error("diagnostics_preview_identity_mismatch");
      }
      props.onPreviewReady(preview);
    } catch {
      setNotice("system.previewFailed");
      setRestorePreviewFocus(true);
    } finally {
      previewInFlightRef.current = false;
      setPreviewBusy(false);
    }
  };

  useEffect(() => {
    const previewRequestRef = props.previewRequestRef;
    if (!previewRequestRef) return;
    previewRequestRef.current = preview;
    return () => {
      previewRequestRef.current = null;
    };
  }, [preview, props.previewRequestRef]);

  return <>
    <DiagnosticsEventSelection
      selection={selection}
      selectedEventIds={selectedEventIds}
      disabled={disabled || props.workflow?.job?.canCancel === true}
      onToggle={toggleEvent}
      t={props.t}
    />
    <SupportBundlePreviewTrigger
      disabled={disabled || !selection || selectedEventIds.length === 0 ||
        (includePrivateExcerpt && privateExcerpt.trim().length === 0)}
      onPreview={() => void preview()}
      triggerRef={previewTriggerRef}
      t={props.t}
    />
    <ProviderMetadataSupportOption
      checked={includeProviderMetadata}
      disabled={disabled || props.workflow?.job?.canCancel === true}
      onChange={(checked) => { setIncludeProviderMetadata(checked); invalidatePreview(); }}
      t={props.t}
    />
    <PrivateExcerptSupportOption
      checked={includePrivateExcerpt}
      value={privateExcerpt}
      disabled={disabled || props.workflow?.job?.canCancel === true}
      onCheckedChange={(checked) => { setIncludePrivateExcerpt(checked); invalidatePreview(); }}
      onValueChange={(value) => { setPrivateExcerpt(value); invalidatePreview(); }}
      t={props.t}
    />
    {notice ? <p className="error" role="alert">{props.t(notice)}</p> : null}
  </>;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
