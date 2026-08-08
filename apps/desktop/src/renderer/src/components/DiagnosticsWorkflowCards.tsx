import type { DiagnosticsSupportBundleJobSummary, SupportBundlePreview } from "@pige/contracts";

type Translate = (key: string) => string;
type CategoryProjection = { readonly titleKey: string; readonly descriptionKey: string };

const CATEGORY_PROJECTIONS: Readonly<Record<string, CategoryProjection>> = {
  app_runtime: { titleKey: "support.category.appRuntime", descriptionKey: "support.category.appRuntimeDescription" },
  diagnostics_health: { titleKey: "support.category.diagnosticsHealth", descriptionKey: "support.category.diagnosticsHealthDescription" },
  recent_errors: { titleKey: "support.category.recentErrors", descriptionKey: "support.category.recentErrorsDescription" },
  provider_metadata: { titleKey: "support.category.providerMetadata", descriptionKey: "support.category.providerMetadataDescription" },
  private_excerpt: { titleKey: "support.category.privateExcerpt", descriptionKey: "support.category.privateExcerptDescription" },
  secrets: { titleKey: "support.category.secrets", descriptionKey: "support.category.secretsDescription" },
  content: { titleKey: "support.category.privateContent", descriptionKey: "support.category.privateContentDescription" },
  binaries: { titleKey: "support.category.binaries", descriptionKey: "support.category.binariesDescription" }
};
const WARNING_PROJECTIONS: Readonly<Record<string, string>> = {
  "The bundle is created locally and is not uploaded automatically.": "support.warning.localOnly",
  "Paths, emails, and common secret patterns are redacted by default.": "support.warning.redacted",
  "Review the preview before exporting.": "support.warning.review",
  "The optional excerpt shown below is the exact redacted text that will be exported.": "support.warning.privateExcerpt"
};

export function supportBundlePreviewIsFullyProjected(preview: SupportBundlePreview): boolean {
  return preview.includedCategories.every((category) => CATEGORY_PROJECTIONS[category.id]) &&
    preview.excludedCategories.every((category) => CATEGORY_PROJECTIONS[category.id]) &&
    preview.privacyWarnings.every((warning) => WARNING_PROJECTIONS[warning]);
}

export function DiagnosticsJobCard(props: {
  readonly job: DiagnosticsSupportBundleJobSummary;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onChooseDestination: () => void;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <div className="settings-card settings-diagnostics-job" aria-live="polite" data-diagnostics-job-id={props.job.jobId}>
      <div className="settings-row tall">
        <div className="settings-row-copy">
          <strong>{props.t("system.supportJobTitle")}</strong>
          <span>{props.t(`system.supportJobState.${props.job.state}`)}</span>
          <span>{`${props.t("system.supportJobProgress")} ${props.job.progress.percent}%`}</span>
          <span>{props.job.jobId}</span>
        </div>
        <div className="settings-row-control">
          {props.job.canCancel ? <button className="settings-button" type="button" disabled={props.busy} onClick={props.onCancel}>{props.t("maintenance.cancelSupportExport")}</button> : null}
          {props.job.canRetry ? <button className="settings-button primary" type="button" disabled={props.busy} onClick={props.onRetry}>{props.t("system.retrySupportExport")}</button> : null}
          {props.job.repairAction === "choose_destination" ? <button className="settings-button primary" type="button" disabled={props.busy} onClick={props.onChooseDestination}>{props.t("system.chooseNewSupportDestination")}</button> : null}
        </div>
      </div>
    </div>
  );
}

export function ProviderMetadataSupportOption(props: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly t: Translate;
}): React.JSX.Element {
  return <div className="settings-row">
    <div className="settings-row-copy">
      <strong>{props.t("support.includeProviderMetadata")}</strong>
      <span id="support-provider-metadata-description">{props.t("support.includeProviderMetadataDescription")}</span>
    </div>
    <input type="checkbox" checked={props.checked} disabled={props.disabled}
      aria-label={props.t("support.includeProviderMetadata")}
      aria-describedby="support-provider-metadata-description"
      onChange={(event) => props.onChange(event.currentTarget.checked)} />
  </div>;
}

export function PrivateExcerptSupportOption(props: {
  readonly checked: boolean;
  readonly value: string;
  readonly disabled: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly onValueChange: (value: string) => void;
  readonly t: Translate;
}): React.JSX.Element {
  return <div className="settings-row tall">
    <div className="settings-row-copy">
      <strong>{props.t("support.includePrivateExcerpt")}</strong>
      <span id="support-private-excerpt-description">{props.t("support.includePrivateExcerptDescription")}</span>
      {props.checked ? <textarea value={props.value} maxLength={2048} disabled={props.disabled}
        aria-label={props.t("support.privateExcerptInput")}
        aria-describedby="support-private-excerpt-description"
        placeholder={props.t("support.privateExcerptPlaceholder")}
        onInput={(event) => props.onValueChange(event.currentTarget.value)} /> : null}
    </div>
    <input type="checkbox" checked={props.checked} disabled={props.disabled}
      aria-label={props.t("support.includePrivateExcerpt")}
      aria-describedby="support-private-excerpt-description"
      onChange={(event) => props.onCheckedChange(event.currentTarget.checked)} />
  </div>;
}

export function SupportBundlePreviewTrigger(props: {
  readonly disabled: boolean;
  readonly onPreview: () => void;
  readonly triggerRef?: React.Ref<HTMLButtonElement>;
  readonly t: Translate;
}): React.JSX.Element {
  return <div className="settings-row tall">
    <div className="settings-row-copy">
      <strong>{props.t("system.supportBundle")}</strong>
      <span>{props.t("system.supportBundleDescription")}</span>
    </div>
    <button ref={props.triggerRef} className="settings-button" type="button" disabled={props.disabled} onClick={props.onPreview}>
      {props.t("system.previewSupport")}
    </button>
  </div>;
}

export function SupportBundlePreviewCard(props: {
  readonly preview: SupportBundlePreview;
  readonly busy: boolean;
  readonly exportBlocked: boolean;
  readonly onExport: () => void;
  readonly exportTriggerRef?: React.Ref<HTMLButtonElement>;
  readonly t: Translate;
}): React.JSX.Element {
  const included = props.preview.includedCategories.map((category) => CATEGORY_PROJECTIONS[category.id]);
  const excluded = props.preview.excludedCategories.map((category) => CATEGORY_PROJECTIONS[category.id]);
  const warnings = props.preview.privacyWarnings.map((warning) => WARNING_PROJECTIONS[warning]);
  const complete = supportBundlePreviewIsFullyProjected(props.preview);
  return (
    <div className="support-preview system-support-preview" aria-label={props.t("support.previewReady")}>
      <strong>{props.t("support.previewReady")}</strong>
      <span>{props.t("support.estimatedSize")}: {Math.ceil(props.preview.estimatedBytes / 1024)} KB</span>
      <section className="support-preview-section" aria-labelledby="support-preview-included">
        <h3 id="support-preview-included">{props.t("support.included")}</h3>
        <ul className="support-preview-list">{included.map((projection, index) => projection ? <li key={props.preview.includedCategories[index]?.id ?? `included-${index}`}><strong>{props.t(projection.titleKey)}</strong><span>{props.t(projection.descriptionKey)}</span></li> : null)}</ul>
      </section>
      <section className="support-preview-section" aria-labelledby="support-preview-excluded">
        <h3 id="support-preview-excluded">{props.t("support.excluded")}</h3>
        <ul className="support-preview-list">{excluded.map((projection, index) => projection ? <li key={props.preview.excludedCategories[index]?.id ?? `excluded-${index}`}><strong>{props.t(projection.titleKey)}</strong><span>{props.t(projection.descriptionKey)}</span></li> : null)}</ul>
      </section>
      <section className="support-preview-section" aria-labelledby="support-preview-warnings">
        <h3 id="support-preview-warnings">{props.t("system.privacyWarnings")}</h3>
        <ul className="support-preview-list warnings">{warnings.map((warningKey) => warningKey ? <li key={warningKey}>{props.t(warningKey)}</li> : null)}</ul>
      </section>
      {props.preview.reviewedPrivateExcerpt ? <section className="support-preview-section" aria-labelledby="support-preview-private-excerpt">
        <h3 id="support-preview-private-excerpt">{props.t("support.reviewedPrivateExcerpt")}</h3>
        <pre>{props.preview.reviewedPrivateExcerpt.text}</pre>
        <span>{props.t(props.preview.reviewedPrivateExcerpt.redactionApplied
          ? "support.privateExcerptRedacted" : "support.privateExcerptUnchanged")}</span>
      </section> : null}
      {!complete ? <p className="error" role="alert">{props.t("support.previewUnsafe")}</p> : null}
      <div className="settings-inline-actions"><button ref={props.exportTriggerRef} className="settings-button primary" type="button" disabled={!complete || props.busy || props.exportBlocked} onClick={props.onExport}>{props.t("maintenance.exportSupport")}</button></div>
    </div>
  );
}
