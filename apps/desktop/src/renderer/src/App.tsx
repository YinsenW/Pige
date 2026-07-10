import { useEffect, useRef, useState, type DragEvent } from "react";
import deMessages from "./locales/de/messages.json";
import enMessages from "./locales/en/messages.json";
import frMessages from "./locales/fr/messages.json";
import jaMessages from "./locales/ja/messages.json";
import koMessages from "./locales/ko/messages.json";
import zhHansMessages from "./locales/zh-Hans/messages.json";
import type {
  AgentRuntimeStatus,
  AppHealth,
  BackupRestoreStatus,
  DiagnosticsHealth,
  JobSummary,
  LibraryListResult,
  LibraryPageSummary,
  LibraryRelatedPage,
  LibraryRelatedResult,
  LocalDatabaseStatus,
  ModelProviderSettingsSummary,
  NoteRenderResult,
  OnboardingStatus,
  RecentVaultSummary,
  RetrievalAskResult,
  RetrievalSearchResultItem,
  RestorePreviewResult,
  SupportBundlePreview,
  ToolchainHealth,
  VaultSummary,
  WindowState
} from "@pige/contracts";
import type { CloudBoundary, JobState, Locale, ProviderKind, SourceStorageStrategy, WindowLayoutMode } from "@pige/schemas";

type View = "home" | "library" | "settings" | "models";
type CaptureToast = { readonly kind: "success" | "error"; readonly message: string };
type NoteRelatedState = LibraryRelatedResult | "loading" | "unavailable" | null;

const initialVaultName = "Pige Vault";
const localeLabels: Record<Locale, string> = {
  "zh-Hans": "中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch"
};
const messageCatalogs: Record<Locale, Record<string, string>> = {
  "zh-Hans": zhHansMessages,
  en: enMessages,
  ja: jaMessages,
  ko: koMessages,
  fr: frMessages,
  de: deMessages
};

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [recentVaults, setRecentVaults] = useState<readonly RecentVaultSummary[]>([]);
  const [vaultName, setVaultName] = useState(initialVaultName);
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [view, setView] = useState<View>("home");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnosticsHealth, setDiagnosticsHealth] = useState<DiagnosticsHealth | null>(null);
  const [localDatabaseStatus, setLocalDatabaseStatus] = useState<LocalDatabaseStatus | null>(null);
  const [supportBundlePreview, setSupportBundlePreview] = useState<SupportBundlePreview | null>(null);
  const [modelSummary, setModelSummary] = useState<ModelProviderSettingsSummary | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupRestoreStatus | null>(null);
  const [agentRuntimeStatus, setAgentRuntimeStatus] = useState<AgentRuntimeStatus | null>(null);
  const [locale, setLocale] = useState<Locale>("zh-Hans");
  const [availableLocales, setAvailableLocales] = useState<readonly Locale[]>(["zh-Hans", "en", "ja", "ko", "fr", "de"]);
  const [toolchainHealth, setToolchainHealth] = useState<ToolchainHealth | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [captureToast, setCaptureToast] = useState<CaptureToast | null>(null);
  const [recentJobs, setRecentJobs] = useState<readonly JobSummary[]>([]);
  const [libraryList, setLibraryList] = useState<LibraryListResult | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<NoteRenderResult | null>(null);
  const [selectedNoteRelated, setSelectedNoteRelated] = useState<NoteRelatedState>(null);
  const [noteLoadingPageId, setNoteLoadingPageId] = useState<string | null>(null);
  const noteOpenSequence = useRef(0);

  useEffect(() => {
    void window.pige.getHealth().then(setHealth);
    void window.pige.window.current().then(setWindowState);
    void window.pige.settings.appearance().then((appearance) => {
      setLocale(appearance.locale);
      setAvailableLocales(appearance.availableLocales);
    });
    void window.pige.system.toolchainHealth().then(setToolchainHealth);
    void refreshVaultState();
  }, []);

  useEffect(() => {
    if (!recentJobs.some((job) => job.state === "queued" || job.state === "running")) return;
    const timer = window.setTimeout(() => void refreshVaultState(), 1_200);
    return () => window.clearTimeout(timer);
  }, [recentJobs]);

  const t = (key: string): string => messageCatalogs[locale][key] ?? messageCatalogs.en[key] ?? key;

  const refreshVaultState = async (): Promise<void> => {
    const nextOnboarding = await window.pige.vault.onboardingStatus();
    const [nextRecentVaults, nextBackupStatus, nextAgentRuntimeStatus] = await Promise.all([
      window.pige.vault.recent(),
      window.pige.backup.status(),
      window.pige.agent.runtimeStatus()
    ]);
    const nextJobs = nextOnboarding.activeVault
      ? await window.pige.jobs.list({
        limit: 6,
        classes: ["capture", "parse", "ocr", "agent_ingest", "index_rebuild"],
        states: ["queued", "running", "waiting_dependency", "failed_retryable", "failed_final"]
      }).catch(() => undefined)
      : undefined;
    setOnboarding(nextOnboarding);
    setRecentVaults(nextRecentVaults);
    setBackupStatus(nextBackupStatus);
    setAgentRuntimeStatus(nextAgentRuntimeStatus);
    setRecentJobs(nextJobs?.jobs ?? []);
  };

  const runVaultAction = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refreshVaultState();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const createVault = (): Promise<void> =>
    runVaultAction(async () => {
      const result = await window.pige.vault.create({ vaultName });
      if (result.status === "completed") setView("home");
    });

  const openVault = (): Promise<void> =>
    runVaultAction(async () => {
      const result = await window.pige.vault.open();
      if (result.status === "completed") setView("home");
    });

  const removeRecent = (vaultId: string): Promise<void> =>
    runVaultAction(async () => {
      setRecentVaults(await window.pige.vault.removeRecent(vaultId));
    });

  const refreshDiagnostics = async (): Promise<void> => {
    const [nextDiagnostics, nextDatabaseStatus, nextToolchainHealth] = await Promise.all([
      window.pige.diagnostics.health(),
      window.pige.maintenance.localDatabaseStatus(),
      window.pige.system.toolchainHealth()
    ]);
    setDiagnosticsHealth(nextDiagnostics);
    setLocalDatabaseStatus(nextDatabaseStatus);
    setToolchainHealth(nextToolchainHealth);
  };

  const refreshModels = async (): Promise<void> => {
    setModelSummary(await window.pige.models.summary());
  };

  const refreshLibrary = async (): Promise<void> => {
    setLibraryError(null);
    try {
      setLibraryList(await window.pige.library.list({ limit: 50 }));
    } catch (caught) {
      setLibraryError(caught instanceof Error ? caught.message : t("error.generic"));
    }
  };

  const openNote = async (pageId: string): Promise<void> => {
    const requestId = noteOpenSequence.current + 1;
    noteOpenSequence.current = requestId;
    setLibraryError(null);
    setSelectedNoteRelated("loading");
    setNoteLoadingPageId(pageId);
    try {
      const note = await window.pige.notes.render({ pageId });
      if (requestId !== noteOpenSequence.current) return;
      setSelectedNote(note);
      void loadNoteRelated(pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
    } catch (caught) {
      if (requestId !== noteOpenSequence.current) return;
      setLibraryError(caught instanceof Error ? caught.message : t("error.generic"));
    } finally {
      if (requestId === noteOpenSequence.current) setNoteLoadingPageId(null);
    }
  };

  const toggleSidebar = async (): Promise<void> => {
    const nextSidebarOpen = !(windowState?.sidebarOpen ?? false);
    setWindowState(await window.pige.window.setSidebarOpen({ sidebarOpen: nextSidebarOpen }));
  };

  const setWindowMode = async (mode: WindowLayoutMode): Promise<void> => {
    setWindowState(await window.pige.window.setMode({ mode }));
  };

  const toggleAlwaysOnTop = async (): Promise<void> => {
    setWindowState(await window.pige.window.setAlwaysOnTop({ alwaysOnTop: !(windowState?.alwaysOnTop ?? false) }));
  };

  const updateLocale = async (nextLocale: Locale): Promise<void> => {
    const appearance = await window.pige.settings.setLocale({ locale: nextLocale });
    setLocale(appearance.locale);
    setAvailableLocales(appearance.availableLocales);
  };

  const submitFiles = async (files: readonly File[], inputKind: "file_drop" | "file_picker"): Promise<void> => {
    if (files.length === 0) return;
    if (!onboarding?.activeVault) {
      setCaptureToast({ kind: "error", message: t("home.createVaultBeforeDrop") });
      return;
    }

    try {
      const result = await window.pige.capture.submitDroppedFiles(files, {
        inputKind,
        userIntent: "capture",
        locale
      });
      if (result.status === "rejected") {
        setCaptureToast({ kind: "error", message: `${t("home.filesRejected")}: ${result.rejectedFiles.length}` });
        return;
      }
      const statusKey = result.status === "partially_queued" ? "home.filesPartiallyQueued" : "home.filesQueued";
      setCaptureToast({ kind: "success", message: `${t(statusKey)}: ${result.sourceIds.length}` });
      await refreshVaultState();
    } catch (caught) {
      setCaptureToast({ kind: "error", message: caught instanceof Error ? caught.message : t("error.generic") });
    }
  };

  const cancelJob = async (jobId: string): Promise<void> => {
    const result = await window.pige.jobs.cancel({ jobId });
    if (result.status === "cancelled") {
      setCaptureToast({ kind: "success", message: t("home.jobCancelled") });
      await refreshVaultState();
      return;
    }
    setCaptureToast({ kind: "error", message: result.reason ?? t("error.generic") });
  };

  const retryJob = async (jobId: string): Promise<void> => {
    const result = await window.pige.jobs.retry({ jobId });
    if (result.status === "requeued") {
      setCaptureToast({ kind: "success", message: t("home.jobRequeued") });
      await refreshVaultState();
      return;
    }
    setCaptureToast({ kind: "error", message: result.reason ?? t("error.generic") });
  };

  const handleDragEnter = (event: DragEvent<HTMLElement>): void => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    setDropActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>): void => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setDropActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    setDropActive(false);
    void submitFiles(Array.from(event.dataTransfer.files), "file_drop");
  };

  const activeVault = onboarding?.activeVault;
  const blocked = !onboarding || onboarding.state === "blocked_no_vault";
  const sidebarOpen = windowState?.sidebarOpen ?? false;

  return (
    <main
      className={`shell mode-${windowState?.mode ?? "compact"}${dropActive ? " drop-active" : ""}`}
      aria-label="Pige"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="topbar">
        <button
          className="icon-button"
          type="button"
          aria-label={sidebarOpen ? t("topbar.collapseSidebar") : t("topbar.expandSidebar")}
          onClick={() => void toggleSidebar()}
        >
          =
        </button>
        <span>Pige</span>
        <div className="topbar-actions">
          <span className="status">{health?.status === "ok" ? t("status.ready") : t("status.starting")}</span>
          <select
            className="locale-select"
            aria-label={t("language.label")}
            value={locale}
            onChange={(event) => void updateLocale(event.target.value as Locale)}
          >
            {availableLocales.map((availableLocale) => (
              <option key={availableLocale} value={availableLocale}>
                {localeLabels[availableLocale]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={windowState?.alwaysOnTop ? "topbar-button active" : "topbar-button"}
            aria-label={t("topbar.pin")}
            title={t("topbar.pin")}
            aria-pressed={windowState?.alwaysOnTop ?? false}
            onClick={() => void toggleAlwaysOnTop()}
          >
            {t("topbar.pinShort")}
          </button>
          <button
            type="button"
            className={windowState?.mode === "compact" ? "topbar-button active" : "topbar-button"}
            aria-label={t("topbar.compact")}
            title={t("topbar.compact")}
            aria-pressed={windowState?.mode === "compact"}
            onClick={() => void setWindowMode("compact")}
          >
            C
          </button>
          <button
            type="button"
            className={windowState?.mode === "expanded" ? "topbar-button active" : "topbar-button"}
            aria-label={t("topbar.expanded")}
            title={t("topbar.expanded")}
            aria-pressed={windowState?.mode === "expanded"}
            onClick={() => void setWindowMode("expanded")}
          >
            W
          </button>
          <button
            type="button"
            className={windowState?.mode === "fullscreen" ? "topbar-button active" : "topbar-button"}
            aria-label={t("topbar.fullscreen")}
            title={t("topbar.fullscreen")}
            aria-pressed={windowState?.mode === "fullscreen"}
            onClick={() => void setWindowMode("fullscreen")}
          >
            F
          </button>
        </div>
      </header>

      <div className="workspace">
        {sidebarOpen ? (
          <aside className="sidebar">
            <button className={view === "home" ? "nav-item active" : "nav-item"} type="button" onClick={() => setView("home")}>
              {t("nav.home")}
            </button>
            <button
              className={view === "library" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => {
                setView("library");
                void refreshLibrary();
              }}
            >
              {t("nav.library")}
            </button>
            <button
              className={view === "settings" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => setView("settings")}
            >
              {t("nav.vaultSettings")}
            </button>
            <button
              className={view === "models" ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => {
                setView("models");
                void refreshModels();
              }}
            >
              {t("nav.models")}
            </button>
          </aside>
        ) : null}

        {blocked ? (
          <FirstRunPanel
            busy={busy}
            error={error}
            recentVaults={recentVaults}
            vaultName={vaultName}
            onCreate={createVault}
            onOpen={openVault}
            onRemoveRecent={removeRecent}
            onRestoreCompleted={async () => {
              await refreshVaultState();
              setView("home");
            }}
            onVaultNameChange={setVaultName}
            onError={setError}
            t={t}
          />
        ) : view === "library" && activeVault ? (
          <LibraryPanel
            libraryList={libraryList}
            selectedNote={selectedNote}
            selectedNoteRelated={selectedNoteRelated}
            noteLoadingPageId={noteLoadingPageId}
            error={libraryError}
            onRefresh={refreshLibrary}
            onOpenNote={openNote}
            onCloseNote={() => {
              noteOpenSequence.current += 1;
              setSelectedNote(null);
              setSelectedNoteRelated(null);
            }}
            t={t}
          />
        ) : view === "settings" && activeVault ? (
          <VaultSettingsPanel
            busy={busy}
            error={error}
            vault={activeVault}
            diagnosticsHealth={diagnosticsHealth}
            localDatabaseStatus={localDatabaseStatus}
            supportBundlePreview={supportBundlePreview}
            backupStatus={backupStatus}
            toolchainHealth={toolchainHealth}
            recentVaults={recentVaults}
            onOpen={openVault}
            onCreate={createVault}
            onRefresh={refreshVaultState}
            onRefreshDiagnostics={refreshDiagnostics}
            onSupportBundlePreviewChange={setSupportBundlePreview}
            onRemoveRecent={removeRecent}
            onError={setError}
            t={t}
          />
        ) : view === "models" ? (
          <ModelSettingsPanel
            busy={busy}
            error={error}
            modelSummary={modelSummary}
            onRefreshModels={refreshModels}
            onRefreshVaultState={refreshVaultState}
            onError={setError}
            onBusy={setBusy}
            t={t}
          />
        ) : (
          <HomeComposer
            activeVault={activeVault}
            captureOnly={onboarding?.state === "capture_only"}
            agentRuntimeStatus={agentRuntimeStatus}
            recentJobs={recentJobs}
            locale={locale}
            onFilesSelected={(files) => submitFiles(files, "file_picker")}
            onCancelJob={cancelJob}
            onRetryJob={retryJob}
            t={t}
          />
        )}
      </div>
      {dropActive ? <div className="drop-overlay">{t("home.dropToCapture")}</div> : null}
      {captureToast ? <div className={`capture-toast ${captureToast.kind}`}>{captureToast.message}</div> : null}
    </main>
  );
}

function LibraryPanel(props: {
  readonly libraryList: LibraryListResult | null;
  readonly selectedNote: NoteRenderResult | null;
  readonly selectedNoteRelated: NoteRelatedState;
  readonly noteLoadingPageId: string | null;
  readonly error: string | null;
  readonly onRefresh: () => Promise<void>;
  readonly onOpenNote: (pageId: string) => Promise<void>;
  readonly onCloseNote: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const pages = props.libraryList?.pages ?? [];

  if (props.selectedNote) {
    return (
      <section className="library-page reader-page" aria-label={props.t("note.reader")}>
        <button type="button" className="ghost back-button" onClick={props.onCloseNote}>
          {props.t("note.backToLibrary")}
        </button>
        <NoteReader
          note={props.selectedNote}
          related={props.selectedNoteRelated}
          relatedLoadingPageId={props.noteLoadingPageId}
          onOpenRelated={props.onOpenNote}
          t={props.t}
        />
        {props.error ? <p className="error">{props.error}</p> : null}
      </section>
    );
  }

  return (
    <section className="library-page" aria-label={props.t("nav.library")}>
      <header className="library-header">
        <div>
          <h1>{props.t("library.title")}</h1>
          <p className="muted">{props.t("library.subtitle")}</p>
        </div>
        <button type="button" className="secondary" onClick={() => void props.onRefresh()}>
          {props.t("library.refresh")}
        </button>
      </header>

      <div className="library-meta">
        <span>
          {props.t("library.total")}: {props.libraryList?.total ?? 0}
        </span>
        {props.libraryList && props.libraryList.invalidPageCount > 0 ? (
          <span>
            {props.t("library.invalid")}: {props.libraryList.invalidPageCount}
          </span>
        ) : null}
      </div>

      {props.error ? <p className="error">{props.error}</p> : null}
      {!props.libraryList && !props.error ? (
        <p className="library-empty">{props.t("library.loading")}</p>
      ) : pages.length === 0 ? (
        <p className="library-empty">{props.t("library.empty")}</p>
      ) : (
        <div className="library-list">
          {pages.map((page) => (
            <LibraryPageRow
              key={page.pageId}
              page={page}
              loading={props.noteLoadingPageId === page.pageId}
              onOpen={props.onOpenNote}
              t={props.t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LibraryPageRow(props: {
  readonly page: LibraryPageSummary;
  readonly loading: boolean;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const typeLabel = props.t(`library.type.${props.page.pageType}`);
  return (
    <article className="library-row">
      <div className="library-row-main">
        <strong>{props.page.title}</strong>
        <span>{props.page.pagePath}</span>
      </div>
      <div className="library-row-meta">
        <span>{typeLabel}</span>
        <span>{props.page.status}</span>
        {props.page.language ? <span>{props.page.language}</span> : null}
        {props.page.sourceIds.length > 0 ? (
          <span>
            {props.t("library.sources")}: {props.page.sourceIds.length}
          </span>
        ) : null}
        <button type="button" className="ghost" disabled={props.loading} onClick={() => void props.onOpen(props.page.pageId)}>
          {props.loading ? props.t("note.opening") : props.t("note.open")}
        </button>
      </div>
    </article>
  );
}

async function loadNoteRelated(
  pageId: string,
  requestId: number,
  sequence: { readonly current: number },
  setRelated: (related: NoteRelatedState) => void
): Promise<void> {
  try {
    const related = await window.pige.library.related({ pageId, limit: 8 });
    if (requestId === sequence.current) setRelated(related);
  } catch {
    if (requestId === sequence.current) setRelated("unavailable");
  }
}

function NoteReader(props: {
  readonly note: NoteRenderResult;
  readonly related: NoteRelatedState;
  readonly relatedLoadingPageId: string | null;
  readonly onOpenRelated: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const summary = props.note.summary;

  return (
    <article className="note-reader">
      <header className="note-header">
        <div>
          <p className="note-kicker">{props.t(`library.type.${summary.pageType}`)}</p>
          <h1>{summary.title}</h1>
        </div>
        <div className="note-meta" aria-label={props.t("note.metadata")}>
          <span>{summary.status}</span>
          {summary.language ? <span>{summary.language}</span> : null}
          <span>{summary.pagePath}</span>
          <span>
            {props.t("note.size")}: {Math.ceil(props.note.byteSize / 1024)} KB
          </span>
          {summary.sourceIds.length > 0 ? (
            <span>
              {props.t("library.sources")}: {summary.sourceIds.length}
            </span>
          ) : null}
        </div>
      </header>
      <div
        className="markdown-body"
        // HTML is produced by the main-process Markdown renderer after sanitization.
        dangerouslySetInnerHTML={{ __html: props.note.html }}
      />
      <NoteRelatedPanel
        related={props.related}
        loadingPageId={props.relatedLoadingPageId}
        onOpen={props.onOpenRelated}
        t={props.t}
      />
    </article>
  );
}

function NoteRelatedPanel(props: {
  readonly related: NoteRelatedState;
  readonly loadingPageId: string | null;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  if (props.related === "loading" || props.related === "unavailable") {
    return (
      <aside className="note-related" aria-label={props.t("note.related")}>
        <h2>{props.t("note.related")}</h2>
        <p className="related-empty">
          {props.related === "loading" ? props.t("note.relatedLoading") : props.t("note.relatedUnavailable")}
        </p>
      </aside>
    );
  }

  const outgoing = props.related?.outgoing ?? [];
  const backlinks = props.related?.backlinks ?? [];
  const total = (props.related?.totalOutgoing ?? 0) + (props.related?.totalBacklinks ?? 0);

  if (!props.related || total === 0) {
    return (
      <aside className="note-related" aria-label={props.t("note.related")}>
        <h2>{props.t("note.related")}</h2>
        <p className="related-empty">{props.related?.degraded ? props.t("note.relatedUnavailable") : props.t("note.relatedEmpty")}</p>
      </aside>
    );
  }

  return (
    <aside className="note-related" aria-label={props.t("note.related")}>
      <h2>{props.t("note.related")}</h2>
      <RelatedGroup
        title={props.t("note.outgoingLinks")}
        pages={outgoing}
        loadingPageId={props.loadingPageId}
        onOpen={props.onOpen}
        t={props.t}
      />
      <RelatedGroup
        title={props.t("note.backlinks")}
        pages={backlinks}
        loadingPageId={props.loadingPageId}
        onOpen={props.onOpen}
        t={props.t}
      />
    </aside>
  );
}

function RelatedGroup(props: {
  readonly title: string;
  readonly pages: readonly LibraryRelatedPage[];
  readonly loadingPageId: string | null;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (props.pages.length === 0) return null;

  return (
    <section className="related-group">
      <h3>{props.title}</h3>
      <div className="related-list">
        {props.pages.map((page) => (
          <article className="related-row" key={`${page.relation}:${page.summary.pageId}`}>
            <div>
              <strong>{page.summary.title}</strong>
              <span>{page.target || page.summary.pagePath}</span>
            </div>
            <button
              type="button"
              className="ghost"
              aria-label={`${props.t("note.open")}: ${page.summary.title}`}
              disabled={props.loadingPageId === page.summary.pageId}
              onClick={() => void props.onOpen(page.summary.pageId)}
            >
              {props.loadingPageId === page.summary.pageId ? props.t("note.opening") : props.t("note.open")}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function dragEventHasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

interface FirstRunPanelProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly recentVaults: readonly RecentVaultSummary[];
  readonly vaultName: string;
  readonly onCreate: () => Promise<void>;
  readonly onOpen: () => Promise<void>;
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly onRestoreCompleted: () => Promise<void>;
  readonly onVaultNameChange: (value: string) => void;
  readonly onError: (error: string | null) => void;
  readonly t: (key: string) => string;
}

function FirstRunPanel(props: FirstRunPanelProps): React.JSX.Element {
  const [restorePreview, setRestorePreview] = useState<RestorePreviewResult | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const previewRestore = async (): Promise<void> => {
    props.onError(null);
    setRestoreBusy(true);
    try {
      const result = await window.pige.backup.previewRestore();
      if (result.status === "ready") setRestorePreview(result);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setRestoreBusy(false);
    }
  };

  const applyRestore = async (): Promise<void> => {
    if (!restorePreview?.backupPath) return;
    props.onError(null);
    setRestoreBusy(true);
    try {
      const result = await window.pige.backup.applyRestore({ backupPath: restorePreview.backupPath });
      if (result.status === "restored") {
        setRestorePreview(null);
        await props.onRestoreCompleted();
      }
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setRestoreBusy(false);
    }
  };

  return (
    <section className="first-run" aria-label={props.t("firstRun.aria")}>
      <div className="first-run-copy">
        <h1>Pige</h1>
        <p>{props.t("firstRun.subtitle")}</p>
      </div>

      <div className="vault-create">
        <label htmlFor="vault-name">{props.t("firstRun.vaultName")}</label>
        <input
          id="vault-name"
          value={props.vaultName}
          onChange={(event) => props.onVaultNameChange(event.target.value)}
          disabled={props.busy}
        />
        <button type="button" onClick={props.onCreate} disabled={props.busy}>
          {props.t("firstRun.createVault")}
        </button>
        <button type="button" className="secondary" onClick={props.onOpen} disabled={props.busy}>
          {props.t("firstRun.openExisting")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={props.busy || restoreBusy}
          title={props.t("firstRun.restoreHint")}
          onClick={() => void previewRestore()}
        >
          {props.t("firstRun.restoreBackup")}
        </button>
      </div>

      {restorePreview?.manifest ? (
        <div className="support-preview">
          <strong>{props.t("backup.restorePreview")}</strong>
          <span>{props.t("backup.vault")}: {restorePreview.manifest.vaultName}</span>
          <span>{props.t("backup.createdAt")}: {restorePreview.manifest.createdAt}</span>
          <span>{props.t("counts.notes")}: {restorePreview.manifest.noteCount}</span>
          <span>{props.t("counts.sources")}: {restorePreview.manifest.sourceCount}</span>
          <span>{props.t("backup.invalidFiles")}: {restorePreview.invalidFileCount ?? 0}</span>
          <button
            type="button"
            className="secondary"
            disabled={restoreBusy || (restorePreview.invalidFileCount ?? 0) > 0}
            onClick={() => void applyRestore()}
          >
            {props.t("backup.restoreApply")}
          </button>
        </div>
      ) : null}

      <RecentVaults recentVaults={props.recentVaults} onRemoveRecent={props.onRemoveRecent} t={props.t} />
      {props.error ? <p className="error">{props.error}</p> : null}
    </section>
  );
}

function HomeComposer(props: {
  readonly activeVault: VaultSummary | undefined;
  readonly captureOnly: boolean;
  readonly agentRuntimeStatus: AgentRuntimeStatus | null;
  readonly recentJobs: readonly JobSummary[];
  readonly locale: Locale;
  readonly onFilesSelected: (files: readonly File[]) => Promise<void>;
  readonly onCancelJob: (jobId: string) => Promise<void>;
  readonly onRetryJob: (jobId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [retrievalResult, setRetrievalResult] = useState<RetrievalAskResult | null>(null);
  const [retrievalLoading, setRetrievalLoading] = useState(false);
  const [selectedNote, setSelectedNote] = useState<NoteRenderResult | null>(null);
  const [selectedNoteRelated, setSelectedNoteRelated] = useState<NoteRelatedState>(null);
  const [noteLoadingPageId, setNoteLoadingPageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const noteOpenSequence = useRef(0);
  const agentStatusLabel = props.agentRuntimeStatus?.state === "ready" ? props.t("home.agentReady") : props.t("home.captureOnly");
  const submitHomeInput = async (): Promise<void> => {
    if (!text.trim()) return;
    setCaptureError(null);
    setCaptureStatus(null);
    noteOpenSequence.current += 1;
    setSelectedNote(null);
    setSelectedNoteRelated(null);
    const captureUrl = extractSingleCaptureUrl(text);
    if (captureUrl) {
      await submitUrlCapture(captureUrl);
      return;
    }
    if (isLikelyQuestion(text)) {
      await submitRetrieval();
      return;
    }

    try {
      const result = await window.pige.capture.submitText({
        text,
        inputKind: "typed_text",
        userIntent: "capture",
        locale: props.locale
      });
      setCaptureStatus(`${props.t("home.captureQueued")}: ${result.sourceId}`);
      setRetrievalResult(null);
      setText("");
    } catch (caught) {
      setCaptureError(caught instanceof Error ? caught.message : props.t("error.generic"));
    }
  };

  const submitUrlCapture = async (url: string): Promise<void> => {
    try {
      const result = await window.pige.capture.submitUrl({
        url,
        inputKind: "pasted_url",
        userIntent: "capture",
        locale: props.locale
      });
      setCaptureStatus(`${props.t("home.urlQueued")}: ${result.sourceId}`);
      setRetrievalResult(null);
      setText("");
    } catch (caught) {
      setCaptureError(caught instanceof Error ? caught.message : props.t("error.generic"));
    }
  };

  const submitRetrieval = async (): Promise<void> => {
    setRetrievalLoading(true);
    try {
      const result = await window.pige.retrieval.ask({ query: text, limit: 8, locale: props.locale });
      setRetrievalResult(result);
      setText("");
    } catch (caught) {
      setCaptureError(caught instanceof Error ? caught.message : props.t("error.generic"));
    } finally {
      setRetrievalLoading(false);
    }
  };

  const openResult = async (pageId: string): Promise<void> => {
    const requestId = noteOpenSequence.current + 1;
    noteOpenSequence.current = requestId;
    setCaptureError(null);
    setSelectedNoteRelated("loading");
    setNoteLoadingPageId(pageId);
    try {
      const note = await window.pige.notes.render({ pageId });
      if (requestId !== noteOpenSequence.current) return;
      setSelectedNote(note);
      void loadNoteRelated(pageId, requestId, noteOpenSequence, setSelectedNoteRelated);
    } catch (caught) {
      if (requestId !== noteOpenSequence.current) return;
      setCaptureError(caught instanceof Error ? caught.message : props.t("error.generic"));
    } finally {
      if (requestId === noteOpenSequence.current) setNoteLoadingPageId(null);
    }
  };

  return (
    <section className="home" aria-label={props.t("nav.home")}>
      <div className="home-center">
        <span className="vault-chip">{props.activeVault?.name ?? props.t("home.noVault")}</span>
        {props.captureOnly || props.agentRuntimeStatus ? <span className="mode-chip">{agentStatusLabel}</span> : null}
      </div>
      {props.recentJobs.length > 0 ? (
        <section className="job-strip" aria-label={props.t("home.recentCaptures")}>
          <span className="job-strip-title">
            {props.t("home.processing")}
          </span>
          {props.recentJobs.slice(0, 3).map((job) => (
            <div className="job-pill" key={job.id}>
              <span
                className={`job-state-dot state-${job.state}`}
                title={props.t(jobStateMessageKey(job.state))}
                aria-label={props.t(jobStateMessageKey(job.state))}
              />
              <span>{job.sourceDisplayName ?? job.sourceId ?? job.id}</span>
              {job.state === "queued" ? (
                <button
                  className="job-action"
                  type="button"
                  title={props.t("home.cancelJob")}
                  aria-label={props.t("home.cancelJob")}
                  onClick={() => void props.onCancelJob(job.id)}
                >
                  {props.t("home.cancelJob")}
                </button>
              ) : job.state === "failed_retryable" ? (
                <button
                  className="job-action"
                  type="button"
                  title={props.t("home.retryJob")}
                  aria-label={props.t("home.retryJob")}
                  onClick={() => void props.onRetryJob(job.id)}
                >
                  {props.t("home.retryJob")}
                </button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {selectedNote ? (
        <section className="home-reader">
          <button
            type="button"
            className="ghost back-button"
            onClick={() => {
              noteOpenSequence.current += 1;
              setSelectedNote(null);
              setSelectedNoteRelated(null);
            }}
          >
            {props.t("retrieval.backToResults")}
          </button>
          <NoteReader
            note={selectedNote}
            related={selectedNoteRelated}
            relatedLoadingPageId={noteLoadingPageId}
            onOpenRelated={openResult}
            t={props.t}
          />
        </section>
      ) : retrievalResult ? (
        <RetrievalResults
          result={retrievalResult}
          noteLoadingPageId={noteLoadingPageId}
          onOpen={openResult}
          t={props.t}
        />
      ) : null}
      <section className="composer">
        <textarea
          aria-label={props.t("home.composerAria")}
          placeholder={props.t("home.placeholder")}
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="toolbar">
          <span>{props.t("home.toolbarHint")}</span>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".md,.markdown,.txt,text/plain,text/markdown"
            multiple
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void props.onFilesSelected(files);
            }}
          />
          <button
            className="round-button"
            type="button"
            aria-label={props.t("home.attachFile")}
            onClick={() => fileInputRef.current?.click()}
          >
            +
          </button>
          <button type="button" aria-label={props.t("home.send")} disabled={!text.trim() || retrievalLoading} onClick={() => void submitHomeInput()}>
            {retrievalLoading ? props.t("retrieval.searching") : props.t("home.send")}
          </button>
        </div>
        {captureStatus ? <p className="capture-status">{captureStatus}</p> : null}
        {captureError ? <p className="error">{captureError}</p> : null}
      </section>
    </section>
  );
}

function jobStateMessageKey(state: JobState): string {
  if (state === "queued") return "home.jobQueued";
  if (state === "running") return "home.jobRunning";
  if (state === "waiting_dependency") return "home.jobWaiting";
  return "home.jobFailed";
}

function RetrievalResults(props: {
  readonly result: RetrievalAskResult;
  readonly noteLoadingPageId: string | null;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <section className="retrieval-results" aria-label={props.t("retrieval.results")}>
      <section className="retrieval-answer" aria-label={props.t("retrieval.summary")}>
        <p className="retrieval-eyebrow">{props.t("retrieval.summary")}</p>
        <p className="retrieval-answer-text">{props.result.answer}</p>
        {props.result.citations.length > 0 ? (
          <div className="retrieval-citations" aria-label={props.t("retrieval.citations")}>
            {props.result.citations.map((citation) => (
              <button
                type="button"
                className="ghost"
                key={citation.refId}
                disabled={props.noteLoadingPageId === citation.pageId}
                onClick={() => void props.onOpen(citation.pageId)}
              >
                {citation.label} {citation.title}
              </button>
            ))}
          </div>
        ) : null}
        {props.result.warnings.includes("limited_evidence") ? (
          <p className="muted retrieval-warning">{props.t("retrieval.limitedEvidence")}</p>
        ) : null}
        {props.result.degraded ? (
          <p className="muted retrieval-warning">{props.t("retrieval.degraded")}</p>
        ) : null}
      </section>
      <header className="retrieval-header">
        <div>
          <h2>{props.t("retrieval.results")}</h2>
          <p className="muted">
            {props.t("retrieval.localOnly")} · {props.t("retrieval.total")}: {props.result.total}
          </p>
        </div>
      </header>
      {props.result.results.length === 0 ? (
        <p className="library-empty">{props.t("retrieval.empty")}</p>
      ) : (
        <div className="retrieval-list">
          {props.result.results.map((item) => (
            <RetrievalResultRow
              key={item.summary.pageId}
              item={item}
              loading={props.noteLoadingPageId === item.summary.pageId}
              citationLabel={props.result.citations.find((citation) => citation.pageId === item.summary.pageId)?.label}
              onOpen={props.onOpen}
              t={props.t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RetrievalResultRow(props: {
  readonly item: RetrievalSearchResultItem;
  readonly loading: boolean;
  readonly citationLabel: string | undefined;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <article className="retrieval-row">
      <div className="retrieval-row-main">
        <strong>{props.item.summary.title}</strong>
        <span>{props.item.snippets[0] ?? props.item.summary.pagePath}</span>
      </div>
      <div className="retrieval-row-meta">
        {props.citationLabel ? <span>{props.citationLabel}</span> : null}
        <span>{props.t(`library.type.${props.item.summary.pageType}`)}</span>
        <button type="button" className="ghost" disabled={props.loading} onClick={() => void props.onOpen(props.item.summary.pageId)}>
          {props.loading ? props.t("note.opening") : props.t("note.open")}
        </button>
      </div>
    </article>
  );
}

function isLikelyQuestion(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/[?？]$/u.test(text)) return true;
  const normalized = text.toLocaleLowerCase();
  return (
    /^(what|why|how|who|where|when|which|find|search|show|tell me|summarize|explain|où|pourquoi|comment|was|warum|wie)\b/iu.test(normalized) ||
    /^(什么|为什么|为何|怎么|如何|谁|哪里|哪|请问|找|搜索|总结|解释|教えて|なぜ|どう|どこ|무엇|왜|어떻게)/u.test(normalized)
  );
}

function extractSingleCaptureUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (/\s/u.test(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

interface VaultSettingsPanelProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly vault: VaultSummary;
  readonly diagnosticsHealth: DiagnosticsHealth | null;
  readonly localDatabaseStatus: LocalDatabaseStatus | null;
  readonly supportBundlePreview: SupportBundlePreview | null;
  readonly backupStatus: BackupRestoreStatus | null;
  readonly toolchainHealth: ToolchainHealth | null;
  readonly recentVaults: readonly RecentVaultSummary[];
  readonly onOpen: () => Promise<void>;
  readonly onCreate: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshDiagnostics: () => Promise<void>;
  readonly onSupportBundlePreviewChange: (preview: SupportBundlePreview | null) => void;
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly onError: (error: string | null) => void;
  readonly t: (key: string) => string;
}

function VaultSettingsPanel(props: VaultSettingsPanelProps): React.JSX.Element {
  const [restorePreview, setRestorePreview] = useState<RestorePreviewResult | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const runBackupAction = async (action: () => Promise<void>): Promise<void> => {
    props.onError(null);
    setBackupNotice(null);
    setBackupBusy(true);
    try {
      await action();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBackupBusy(false);
    }
  };

  const createBackup = async (): Promise<void> =>
    runBackupAction(async () => {
      const result = await window.pige.backup.create();
      if (result.status === "created" && result.manifest) {
        setBackupNotice(`${props.t("backup.created")}: ${result.manifest.fileCount}`);
        await props.onRefresh();
      }
    });

  const previewRestore = async (): Promise<void> =>
    runBackupAction(async () => {
      const result = await window.pige.backup.previewRestore();
      if (result.status === "ready") {
        setRestorePreview(result);
      }
    });

  const applyRestore = async (): Promise<void> => {
    if (!restorePreview?.backupPath) return;
    await runBackupAction(async () => {
      const result = await window.pige.backup.applyRestore({ backupPath: restorePreview.backupPath! });
      if (result.status === "restored") {
        setRestorePreview(null);
        setBackupNotice(props.t("backup.restored"));
        await props.onRefresh();
        await props.onRefreshDiagnostics();
      }
    });
  };

  const updatePolicy = async (defaultStrategy: SourceStorageStrategy): Promise<void> => {
    props.onError(null);
    try {
      await window.pige.vault.updateSourceStoragePolicy({ defaultStrategy });
      await props.onRefresh();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  const resetLocalDatabase = async (): Promise<void> => {
    props.onError(null);
    try {
      await window.pige.maintenance.resetLocalDatabase();
      await props.onRefresh();
      await props.onRefreshDiagnostics();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  const rebuildLocalDatabase = async (): Promise<void> => {
    props.onError(null);
    try {
      await window.pige.maintenance.rebuildLocalDatabase();
      await props.onRefresh();
      await props.onRefreshDiagnostics();
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  const previewSupportBundle = async (): Promise<void> => {
    props.onError(null);
    try {
      props.onSupportBundlePreviewChange(await window.pige.diagnostics.previewSupportBundle());
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  const exportSupportBundle = async (): Promise<void> => {
    if (!props.supportBundlePreview) return;
    props.onError(null);
    try {
      const result = await window.pige.diagnostics.exportSupportBundle({
        previewId: props.supportBundlePreview.previewId
      });
      if (result.status === "exported") {
        props.onSupportBundlePreviewChange(null);
        await props.onRefreshDiagnostics();
      }
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    }
  };

  return (
    <section className="settings-page" aria-label={props.t("nav.vaultSettings")}>
      <div>
        <h1>{props.t("vaultSettings.title")}</h1>
        <p className="muted">{props.t("vaultSettings.subtitle")}</p>
      </div>

      <InfoGroup
        title={props.t("vaultSettings.currentVault")}
        rows={[
          [props.t("field.name"), props.vault.name],
          [props.t("field.vaultPath"), props.vault.activeVaultPathDisplay],
          [props.t("field.noteStorage"), props.vault.knowledgeRootDisplay],
          [props.t("field.sourceAssets"), props.vault.sourceAssetRootDisplay],
          [props.t("field.schema"), String(props.vault.schemaVersion)]
        ]}
      />

      <section className="settings-group">
        <h2>{props.t("sourceStorage.title")}</h2>
        <select
          value={props.vault.defaultSourceStorageStrategy}
          disabled={props.busy}
          onChange={(event) => void updatePolicy(event.target.value as SourceStorageStrategy)}
        >
          <option value="copy_to_source_library">{props.t("sourceStorage.copy")}</option>
          <option value="reference_original">{props.t("sourceStorage.reference")}</option>
        </select>
      </section>

      <section className="settings-actions">
        <button type="button" onClick={() => void window.pige.vault.revealKnowledgeRoot()}>
          {props.t("vaultSettings.openInFinder")}
        </button>
        <button type="button" className="secondary" onClick={() => void window.pige.vault.revealSourceAssetRoot()}>
          {props.t("vaultSettings.openSourceAssets")}
        </button>
        <button type="button" className="secondary" onClick={props.onOpen} disabled={props.busy}>
          {props.t("vaultSettings.openAnother")}
        </button>
        <button type="button" className="secondary" onClick={props.onCreate} disabled={props.busy}>
          {props.t("vaultSettings.createNew")}
        </button>
      </section>

      <InfoGroup
        title={props.t("counts.title")}
        rows={[
          [props.t("counts.notes"), String(props.vault.counts?.notes ?? 0)],
          [props.t("counts.sources"), String(props.vault.counts?.sources ?? 0)],
          [props.t("counts.managedCopies"), String(props.vault.counts?.managedSourceCopies ?? 0)],
          [props.t("counts.referencedOriginals"), String(props.vault.counts?.referencedOriginals ?? 0)]
        ]}
      />

      <section className="settings-group">
        <h2>{props.t("backup.title")}</h2>
        <dl>
          <div className="info-row">
            <dt>{props.t("backup.lastBackup")}</dt>
            <dd>{props.backupStatus?.lastBackupAt ?? props.t("backup.never")}</dd>
          </div>
        </dl>
        <p className="muted">
          {props.backupStatus?.messageKey ? props.t(props.backupStatus.messageKey) : props.t("backup.loading")}
        </p>
        <div className="settings-actions">
          <button
            type="button"
            disabled={backupBusy || !props.backupStatus?.createAvailable}
            onClick={() => void createBackup()}
          >
            {props.t("backup.create")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={backupBusy || !props.backupStatus?.restoreAvailable}
            onClick={() => void previewRestore()}
          >
            {props.t("backup.restore")}
          </button>
        </div>
        {backupNotice ? <p className="muted">{backupNotice}</p> : null}
        {restorePreview?.manifest ? (
          <div className="support-preview">
            <strong>{props.t("backup.restorePreview")}</strong>
            <span>{props.t("backup.vault")}: {restorePreview.manifest.vaultName}</span>
            <span>{props.t("backup.createdAt")}: {restorePreview.manifest.createdAt}</span>
            <span>{props.t("counts.notes")}: {restorePreview.manifest.noteCount}</span>
            <span>{props.t("counts.sources")}: {restorePreview.manifest.sourceCount}</span>
            <span>{props.t("backup.conversations")}: {restorePreview.manifest.conversationCount}</span>
            <span>{props.t("backup.memories")}: {restorePreview.manifest.memoryCount}</span>
            <span>{props.t("backup.invalidFiles")}: {restorePreview.invalidFileCount ?? 0}</span>
            <button
              type="button"
              className="secondary"
              disabled={backupBusy || (restorePreview.invalidFileCount ?? 0) > 0}
              onClick={() => void applyRestore()}
            >
              {props.t("backup.restoreApply")}
            </button>
          </div>
        ) : null}
      </section>

      <section className="settings-group">
        <h2>{props.t("maintenance.title")}</h2>
        <p className="muted">
          {props.t("maintenance.resetCopy")}
        </p>
        <div className="settings-actions">
          <button type="button" className="secondary" onClick={() => void rebuildLocalDatabase()}>
            {props.t("maintenance.rebuildIndex")}
          </button>
          <button type="button" className="secondary" onClick={() => void resetLocalDatabase()}>
            {props.t("maintenance.resetDatabase")}
          </button>
          <button type="button" className="secondary" onClick={() => void props.onRefreshDiagnostics()}>
            {props.t("maintenance.checkDiagnostics")}
          </button>
          <button type="button" className="secondary" onClick={() => void previewSupportBundle()}>
            {props.t("maintenance.previewSupport")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!props.supportBundlePreview}
            onClick={() => void exportSupportBundle()}
          >
            {props.t("maintenance.exportSupport")}
          </button>
        </div>
        {props.diagnosticsHealth ? (
          <p className="muted">
            {props.t("maintenance.diagnostics")}: {props.diagnosticsHealth.status}; {props.t("maintenance.recentErrors")}: {props.diagnosticsHealth.recentErrorCount}
          </p>
        ) : null}
        {props.localDatabaseStatus ? (
          <p className="muted">
            {props.t("maintenance.localDb")}: {props.localDatabaseStatus.status}; {props.t("maintenance.migrations")}: {props.localDatabaseStatus.appliedMigrationCount}
          </p>
        ) : null}
        {props.toolchainHealth ? (
          <p className="muted">
            {props.t("maintenance.toolchain")}: {props.toolchainHealth.status}; {props.t("maintenance.missingTools")}:{" "}
            {props.toolchainHealth.tools.filter((tool) => tool.status === "missing").length}
          </p>
        ) : null}
        {props.supportBundlePreview ? (
          <div className="support-preview">
            <strong>{props.t("support.previewReady")}</strong>
            <span>{props.t("support.estimatedSize")}: {Math.ceil(props.supportBundlePreview.estimatedBytes / 1024)} KB</span>
            <span>{props.t("support.included")}: {props.supportBundlePreview.includedCategories.map((category) => category.label).join(", ")}</span>
            <span>{props.t("support.excluded")}: {props.supportBundlePreview.excludedCategories.map((category) => category.label).join(", ")}</span>
          </div>
        ) : null}
      </section>

      <RecentVaults recentVaults={props.recentVaults} onRemoveRecent={props.onRemoveRecent} t={props.t} />
      {props.error ? <p className="error">{props.error}</p> : null}
    </section>
  );
}

interface ModelSettingsPanelProps {
  readonly busy: boolean;
  readonly error: string | null;
  readonly modelSummary: ModelProviderSettingsSummary | null;
  readonly onRefreshModels: () => Promise<void>;
  readonly onRefreshVaultState: () => Promise<void>;
  readonly onError: (error: string | null) => void;
  readonly onBusy: (busy: boolean) => void;
  readonly t: (key: string) => string;
}

function ModelSettingsPanel(props: ModelSettingsPanelProps): React.JSX.Element {
  const [displayName, setDisplayName] = useState("OpenAI");
  const [providerKind, setProviderKind] = useState<ProviderKind>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [manualModelId, setManualModelId] = useState("gpt-4.1");
  const [cloudBoundary, setCloudBoundary] = useState<CloudBoundary>("cloud");

  useEffect(() => {
    void props.onRefreshModels();
  }, []);

  const saveProvider = async (): Promise<void> => {
    props.onBusy(true);
    props.onError(null);
    try {
      await window.pige.models.addManualProvider({
        displayName,
        providerKind,
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        apiKey,
        manualModelId,
        cloudBoundary
      });
      setApiKey("");
      await Promise.all([props.onRefreshModels(), props.onRefreshVaultState()]);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      props.onBusy(false);
    }
  };

  const setDefaultModel = async (modelProfileId: string): Promise<void> => {
    props.onBusy(true);
    props.onError(null);
    try {
      await window.pige.models.setDefaultModel({ modelProfileId });
      await Promise.all([props.onRefreshModels(), props.onRefreshVaultState()]);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      props.onBusy(false);
    }
  };

  const summary = props.modelSummary;

  return (
    <section className="settings-page" aria-label={props.t("nav.models")}>
      <div>
        <h1>{props.t("models.title")}</h1>
        <p className="muted">{props.t("models.subtitle")}</p>
      </div>

      <section className="settings-group">
        <h2>{props.t("models.addProvider")}</h2>
        <label htmlFor="provider-name">{props.t("field.name")}</label>
        <input id="provider-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />

        <label htmlFor="provider-kind">{props.t("models.serviceType")}</label>
        <select
          id="provider-kind"
          value={providerKind}
          onChange={(event) => setProviderKind(event.target.value as ProviderKind)}
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="openai_compatible">OpenAI-compatible</option>
          <option value="anthropic_compatible">Anthropic-compatible</option>
          <option value="custom">{props.t("models.customEndpoint")}</option>
        </select>

        <label htmlFor="provider-base-url">{props.t("models.baseUrl")}</label>
        <input
          id="provider-base-url"
          value={baseUrl}
          placeholder={props.t("models.optional")}
          onChange={(event) => setBaseUrl(event.target.value)}
        />

        <label htmlFor="provider-key">{props.t("models.apiKey")}</label>
        <input
          id="provider-key"
          value={apiKey}
          type="password"
          onChange={(event) => setApiKey(event.target.value)}
        />

        <label htmlFor="provider-model">{props.t("models.modelId")}</label>
        <input id="provider-model" value={manualModelId} onChange={(event) => setManualModelId(event.target.value)} />

        <label htmlFor="cloud-boundary">{props.t("models.boundary")}</label>
        <select
          id="cloud-boundary"
          value={cloudBoundary}
          onChange={(event) => setCloudBoundary(event.target.value as CloudBoundary)}
        >
          <option value="cloud">{props.t("models.cloud")}</option>
          <option value="self_hosted">{props.t("models.selfHosted")}</option>
          <option value="local">{props.t("models.local")}</option>
          <option value="unknown">{props.t("models.unknown")}</option>
        </select>

        <button type="button" onClick={() => void saveProvider()} disabled={props.busy}>
          {props.t("models.testAndSave")}
        </button>
      </section>

      <section className="settings-group">
        <h2>{props.t("models.defaultModel")}</h2>
        {summary && summary.models.length > 0 ? (
          <div className="model-list">
            {summary.models.map((model) => (
              <div className="model-row" key={model.id}>
                <div>
                  <strong>{model.displayName ?? model.modelId}</strong>
                  <span>{model.isDefault ? props.t("models.default") : props.t("models.manual")}</span>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={model.isDefault || props.busy}
                  onClick={() => void setDefaultModel(model.id)}
                >
                  {props.t("models.setDefault")}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{props.t("models.noModel")}</p>
        )}
      </section>

      {summary && summary.providers.length > 0 ? (
        <InfoGroup
          title={props.t("models.currentProvider")}
          rows={[
            [props.t("field.name"), summary.providers[0]?.displayName ?? ""],
            [props.t("models.type"), summary.providers[0]?.providerKind ?? ""],
            [props.t("models.boundary"), summary.providers[0]?.cloudBoundary ?? ""]
          ]}
        />
      ) : null}

      {props.error ? <p className="error">{props.error}</p> : null}
    </section>
  );
}

function InfoGroup(props: { readonly title: string; readonly rows: readonly (readonly [string, string])[] }): React.JSX.Element {
  return (
    <section className="settings-group">
      <h2>{props.title}</h2>
      <dl>
        {props.rows.map(([label, value]) => (
          <div className="info-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RecentVaults(props: {
  readonly recentVaults: readonly RecentVaultSummary[];
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (props.recentVaults.length === 0) return null;

  return (
    <section className="settings-group recent-list">
      <h2>{props.t("recent.title")}</h2>
      {props.recentVaults.map((recent) => (
        <div className="recent-item" key={recent.vaultId}>
          <div>
            <strong>{recent.name}</strong>
            <span>{recent.pathDisplay}</span>
          </div>
          <button type="button" className="ghost" onClick={() => void props.onRemoveRecent(recent.vaultId)}>
            {props.t("recent.remove")}
          </button>
        </div>
      ))}
    </section>
  );
}
