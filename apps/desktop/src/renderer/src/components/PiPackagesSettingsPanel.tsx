import { useEffect, useRef, useState } from "react";
import type {
  PiPackageCatalogEntry,
  PiPackageCatalogQueryRequest,
  PiPackageCatalogQueryResult,
  PiPackageInstallRequest,
  PiPackageInstallResult,
  PiPackageRegistryQueryResult,
  PiPackageRegistrySummary,
  PiPackageRollbackRequest,
  PiPackageRollbackResult,
  PiPackageUninstallRequest,
  PiPackageUninstallResult,
  PiPackageUpdateRequest,
  PiPackageUpdateResult
} from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

export interface PiPackagesApi {
  summary: () => Promise<PiPackageRegistryQueryResult>;
  catalogQuery: (request: PiPackageCatalogQueryRequest) => Promise<PiPackageCatalogQueryResult>;
  install: (request: PiPackageInstallRequest) => Promise<PiPackageInstallResult>;
  uninstall: (request: PiPackageUninstallRequest) => Promise<PiPackageUninstallResult>;
  update: (request: PiPackageUpdateRequest) => Promise<PiPackageUpdateResult>;
  rollback: (request: PiPackageRollbackRequest) => Promise<PiPackageRollbackResult>;
}

type ReadState = "loading" | "ready" | "failed";
type UpdateDraft = { readonly targetVersion: string; readonly targetIntegrity: string };
type PackageMutationFocus = { readonly packageId: string; readonly action: "update" | "rollback" };

export function PiPackagesSettingsPanel(props: {
  readonly api: PiPackagesApi;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [registry, setRegistry] = useState<PiPackageRegistrySummary | null>(null);
  const [readState, setReadState] = useState<ReadState>("loading");
  const [reloadSequence, setReloadSequence] = useState(0);
  const [packageName, setPackageName] = useState("");
  const [version, setVersion] = useState("");
  const [integrity, setIntegrity] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [submittedCatalogQuery, setSubmittedCatalogQuery] = useState("");
  const [catalogEntries, setCatalogEntries] = useState<readonly PiPackageCatalogEntry[]>([]);
  const [catalogState, setCatalogState] = useState<ReadState>("loading");
  const [installing, setInstalling] = useState(false);
  const [uninstallingPackageId, setUninstallingPackageId] = useState<string | null>(null);
  const [updatingPackageId, setUpdatingPackageId] = useState<string | null>(null);
  const [rollingBackPackageId, setRollingBackPackageId] = useState<string | null>(null);
  const [updateDrafts, setUpdateDrafts] = useState<Readonly<Record<string, UpdateDraft>>>({});
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const [maintenanceStatusKey, setMaintenanceStatusKey] = useState<string | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  const summarySequenceRef = useRef(0);
  const catalogSequenceRef = useRef(0);
  const installSequenceRef = useRef(0);
  const installActiveRef = useRef(false);
  const uninstallSequenceRef = useRef(0);
  const uninstallActiveRef = useRef(false);
  const updateSequenceRef = useRef(0);
  const updateActiveRef = useRef(false);
  const rollbackSequenceRef = useRef(0);
  const rollbackActiveRef = useRef(false);
  const pendingInstalledPackageFocusRef = useRef<string | null>(null);
  const pendingPackageFocusRef = useRef<string | null>(null);
  const pendingRegistryFocusRef = useRef(false);
  const pendingMutationFocusRef = useRef<PackageMutationFocus | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      summarySequenceRef.current += 1;
      catalogSequenceRef.current += 1;
      installSequenceRef.current += 1;
      uninstallSequenceRef.current += 1;
      updateSequenceRef.current += 1;
      rollbackSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const sequence = ++summarySequenceRef.current;
    setReadState("loading");
    props.api.summary()
      .then((result) => {
        if (!mountedRef.current || sequence !== summarySequenceRef.current) return;
        if (result.status === "ready") {
          setRegistry(result.registry);
          setReadState("ready");
          return;
        }
        setReadState("failed");
      })
      .catch(() => {
        if (!mountedRef.current || sequence !== summarySequenceRef.current) return;
        setReadState("failed");
      });
  }, [props.api, reloadSequence]);

  const queryCatalog = async (query: string): Promise<void> => {
    const sequence = ++catalogSequenceRef.current;
    const request: PiPackageCatalogQueryRequest = {
      apiVersion: 1,
      requestId: createPiPackageCatalogQueryRequestId(),
      query
    };
    setSubmittedCatalogQuery(query);
    setCatalogState("loading");
    try {
      const result = await props.api.catalogQuery(request);
      if (!mountedRef.current || sequence !== catalogSequenceRef.current) return;
      if (result.requestId !== request.requestId || result.status !== "ready") {
        setCatalogState("failed");
        return;
      }
      setCatalogEntries(result.entries);
      setCatalogState("ready");
    } catch {
      if (mountedRef.current && sequence === catalogSequenceRef.current) {
        setCatalogState("failed");
      }
    }
  };

  useEffect(() => {
    void queryCatalog("");
  }, [props.api]);

  useEffect(() => {
    const installedPackageId = pendingInstalledPackageFocusRef.current;
    const packageId = pendingPackageFocusRef.current;
    const mutationFocus = pendingMutationFocusRef.current;
    if (installing || uninstallingPackageId || updatingPackageId || rollingBackPackageId) return;
    if (mutationFocus) {
      pendingMutationFocusRef.current = null;
      const selector = mutationFocus.action === "update"
        ? `[data-package-update-version-id="${mutationFocus.packageId}"]`
        : `[data-package-rollback-id="${mutationFocus.packageId}"]`;
      const packageAction = pageRef.current?.querySelector<HTMLElement>(selector);
      if (packageAction) {
        packageAction.focus();
        return;
      }
      const packageRow = pageRef.current?.querySelector<HTMLElement>(`[data-package-id="${mutationFocus.packageId}"]`);
      if (packageRow) {
        packageRow.focus();
        return;
      }
      pendingRegistryFocusRef.current = true;
    }
    if (installedPackageId) {
      pendingInstalledPackageFocusRef.current = null;
      const packageRow = pageRef.current?.querySelector<HTMLElement>(`[data-package-id="${installedPackageId}"]`);
      if (packageRow) {
        packageRow.focus();
        return;
      }
    }
    if (packageId) {
      pendingPackageFocusRef.current = null;
      const packageAction = pageRef.current?.querySelector<HTMLElement>(`[data-package-remove-id="${packageId}"]`);
      if (packageAction) {
        packageAction.focus();
        return;
      }
    }
    if (pendingRegistryFocusRef.current) {
      pendingRegistryFocusRef.current = false;
      pageRef.current?.querySelector<HTMLElement>("#packages-registry-title")?.focus();
    }
  }, [installing, registry, rollingBackPackageId, uninstallingPackageId, updatingPackageId]);

  const installPackage = async (): Promise<void> => {
    if (installActiveRef.current || uninstallActiveRef.current || updateActiveRef.current || rollbackActiveRef.current || !registry || packageName.length === 0 || version.length === 0) return;
    const sequence = ++installSequenceRef.current;
    const request: PiPackageInstallRequest = {
      apiVersion: 1,
      requestId: createPiPackageInstallRequestId(),
      expectedRegistryRevision: registry.revision,
      packageName,
      version
    };
    installActiveRef.current = true;
    setInstalling(true);
    setStatusKey(null);
    try {
      const result = await props.api.install(request);
      if (!mountedRef.current || sequence !== installSequenceRef.current) return;
      if (result.requestId !== request.requestId) {
        setStatusKey("packages.status.failed");
        return;
      }
      if (result.status === "installed_disabled") {
        setRegistry(result.registry);
        setPackageName("");
        setVersion("");
        setIntegrity("");
        setStatusKey("packages.status.installed");
        pendingInstalledPackageFocusRef.current = result.registry.packages.find(
          (item) => item.packageName === request.packageName && item.version === request.version
        )?.packageId ?? null;
      } else if (result.status === "stale") {
        setRegistry(result.registry);
        setStatusKey("packages.status.stale");
      } else if (result.status === "denied") {
        setRegistry(result.registry);
        setStatusKey("packages.status.denied");
      } else {
        setStatusKey("packages.status.failed");
      }
    } catch {
      if (mountedRef.current && sequence === installSequenceRef.current) {
        setStatusKey("packages.status.failed");
      }
    } finally {
      if (mountedRef.current && sequence === installSequenceRef.current) {
        installActiveRef.current = false;
        setInstalling(false);
      }
    }
  };

  const uninstallPackage = async (packageId: string): Promise<void> => {
    if (installActiveRef.current || uninstallActiveRef.current || updateActiveRef.current || rollbackActiveRef.current || !registry || readState !== "ready") return;
    const installedPackage = registry.packages.find((item) => item.packageId === packageId);
    if (!installedPackage) return;
    const sequence = ++uninstallSequenceRef.current;
    const request: PiPackageUninstallRequest = {
      apiVersion: 1,
      requestId: createPiPackageUninstallRequestId(),
      expectedRegistryRevision: registry.revision,
      packageId: installedPackage.packageId
    };
    uninstallActiveRef.current = true;
    setUninstallingPackageId(packageId);
    setStatusKey(null);
    setMaintenanceStatusKey(null);
    pendingPackageFocusRef.current = packageId;
    pendingRegistryFocusRef.current = false;
    try {
      const result = await props.api.uninstall(request);
      if (!mountedRef.current || sequence !== uninstallSequenceRef.current) return;
      if (result.requestId !== request.requestId || result.packageId !== request.packageId) {
        setMaintenanceStatusKey("packages.removeStatus.failed");
        return;
      }
      if (result.status === "failed") {
        setMaintenanceStatusKey("packages.removeStatus.failed");
        return;
      }
      setRegistry(result.registry);
      setMaintenanceStatusKey(`packages.removeStatus.${result.status}`);
      if (!result.registry.packages.some((item) => item.packageId === request.packageId)) {
        pendingPackageFocusRef.current = result.registry.packages[0]?.packageId ?? null;
        pendingRegistryFocusRef.current = result.registry.packages.length === 0;
      }
    } catch {
      if (mountedRef.current && sequence === uninstallSequenceRef.current) {
        setMaintenanceStatusKey("packages.removeStatus.failed");
      }
    } finally {
      if (mountedRef.current && sequence === uninstallSequenceRef.current) {
        uninstallActiveRef.current = false;
        setUninstallingPackageId(null);
      }
    }
  };

  const updatePackage = async (packageId: string): Promise<void> => {
    if (installActiveRef.current || uninstallActiveRef.current || updateActiveRef.current || rollbackActiveRef.current || !registry || readState !== "ready") return;
    const installedPackage = registry.packages.find((item) => item.packageId === packageId);
    const draft = updateDrafts[packageId];
    if (!installedPackage?.canUpdate || !draft || draft.targetVersion.length === 0 || draft.targetIntegrity.length === 0) return;
    const sequence = ++updateSequenceRef.current;
    const request: PiPackageUpdateRequest = {
      apiVersion: 1,
      requestId: createPiPackageUpdateRequestId(),
      packageId: installedPackage.packageId,
      expectedRegistryRevision: registry.revision,
      targetVersion: draft.targetVersion,
      targetIntegrity: draft.targetIntegrity
    };
    updateActiveRef.current = true;
    setUpdatingPackageId(packageId);
    setStatusKey(null);
    setMaintenanceStatusKey(null);
    pendingMutationFocusRef.current = { packageId, action: "update" };
    pendingRegistryFocusRef.current = false;
    try {
      const result = await props.api.update(request);
      if (!mountedRef.current || sequence !== updateSequenceRef.current) return;
      if (
        result.requestId !== request.requestId ||
        result.packageId !== request.packageId ||
        result.targetVersion !== request.targetVersion ||
        result.targetIntegrity !== request.targetIntegrity
      ) {
        setMaintenanceStatusKey("packages.updateStatus.failed");
        return;
      }
      if (result.status === "failed") {
        setMaintenanceStatusKey("packages.updateStatus.failed");
        return;
      }
      setRegistry(result.registry);
      setMaintenanceStatusKey(`packages.updateStatus.${result.status}`);
      if (result.status === "committed") {
        setUpdateDrafts((current) => {
          const next = { ...current };
          delete next[packageId];
          return next;
        });
      }
    } catch {
      if (mountedRef.current && sequence === updateSequenceRef.current) {
        setMaintenanceStatusKey("packages.updateStatus.failed");
      }
    } finally {
      if (mountedRef.current && sequence === updateSequenceRef.current) {
        updateActiveRef.current = false;
        setUpdatingPackageId(null);
      }
    }
  };

  const rollbackPackage = async (packageId: string): Promise<void> => {
    if (installActiveRef.current || uninstallActiveRef.current || updateActiveRef.current || rollbackActiveRef.current || !registry || readState !== "ready") return;
    const installedPackage = registry.packages.find((item) => item.packageId === packageId);
    const rollbackTarget = installedPackage?.canRollback ? installedPackage.rollbackTarget : null;
    if (!installedPackage || !rollbackTarget) return;
    const sequence = ++rollbackSequenceRef.current;
    const request: PiPackageRollbackRequest = {
      apiVersion: 1,
      requestId: createPiPackageRollbackRequestId(),
      packageId: installedPackage.packageId,
      expectedRegistryRevision: registry.revision,
      rollbackId: rollbackTarget.rollbackId,
      targetVersion: rollbackTarget.targetVersion
    };
    rollbackActiveRef.current = true;
    setRollingBackPackageId(packageId);
    setStatusKey(null);
    setMaintenanceStatusKey(null);
    pendingMutationFocusRef.current = { packageId, action: "rollback" };
    pendingRegistryFocusRef.current = false;
    try {
      const result = await props.api.rollback(request);
      if (!mountedRef.current || sequence !== rollbackSequenceRef.current) return;
      if (
        result.requestId !== request.requestId ||
        result.packageId !== request.packageId ||
        result.rollbackId !== request.rollbackId ||
        result.targetVersion !== request.targetVersion
      ) {
        setMaintenanceStatusKey("packages.rollbackStatus.failed");
        return;
      }
      if (result.status === "failed") {
        setMaintenanceStatusKey("packages.rollbackStatus.failed");
        return;
      }
      setRegistry(result.registry);
      setMaintenanceStatusKey(`packages.rollbackStatus.${result.status}`);
    } catch {
      if (mountedRef.current && sequence === rollbackSequenceRef.current) {
        setMaintenanceStatusKey("packages.rollbackStatus.failed");
      }
    } finally {
      if (mountedRef.current && sequence === rollbackSequenceRef.current) {
        rollbackActiveRef.current = false;
        setRollingBackPackageId(null);
      }
    }
  };

  const mutationBusy = installing || uninstallingPackageId !== null || updatingPackageId !== null || rollingBackPackageId !== null;

  return (
    <section ref={pageRef} className="settings-page settings-packages" aria-labelledby="settings-packages-title">
      <header className="settings-panel-header">
        <h1 id="settings-packages-title">{props.t("packages.title")}</h1>
        <p>{props.t("packages.subtitle")}</p>
      </header>

      <section className="settings-section" role="group" aria-labelledby="packages-catalog-title">
        <h2 className="settings-section-title" id="packages-catalog-title">{props.t("packages.catalogTitle")}</h2>
        <form
          className="settings-card"
          onSubmit={(event) => {
            event.preventDefault();
            void queryCatalog(catalogQuery.trim());
          }}
        >
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <label htmlFor="pi-package-catalog-query"><strong>{props.t("packages.catalogSearch")}</strong></label>
              <span>{props.t("packages.catalogSearchDescription")}</span>
            </div>
            <div className="settings-row-control">
              <input
                className="settings-input"
                id="pi-package-catalog-query"
                value={catalogQuery}
                maxLength={120}
                placeholder={props.t("packages.catalogSearchPlaceholder")}
                disabled={catalogState === "loading"}
                onInput={(event) => setCatalogQuery(event.currentTarget.value)}
              />
              <button className="settings-button" type="submit" disabled={catalogState === "loading"}>
                {props.t("packages.catalogSearchAction")}
              </button>
            </div>
          </div>
        </form>
        {catalogState === "loading" ? (
          <div className="settings-card skills-empty-card" role="status" aria-live="polite">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="loading" size={19} className="spinning" /></span>
            <div className="settings-row-copy"><strong>{props.t("packages.catalogLoading")}</strong></div>
          </div>
        ) : catalogState === "failed" ? (
          <div className="settings-card skills-empty-card" role="status" aria-live="polite">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="package" size={19} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("packages.catalogFailed")}</strong>
              <span>{props.t("packages.catalogFailedDescription")}</span>
            </div>
            <button className="settings-button" type="button" onClick={() => void queryCatalog(submittedCatalogQuery)}>
              {props.t("packages.retry")}
            </button>
          </div>
        ) : catalogEntries.length === 0 ? (
          <div className="settings-card skills-empty-card" role="status">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="package" size={19} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("packages.catalogEmpty")}</strong>
              <span>{props.t("packages.catalogEmptyDescription")}</span>
            </div>
          </div>
        ) : (
          <div className="settings-card" data-package-catalog-count={catalogEntries.length}>
            {catalogEntries.map((entry) => (
              <div className="settings-row tall" data-package-catalog-id={entry.catalogId} key={entry.catalogId}>
                <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="package" size={17} /></span>
                <div className="settings-row-copy">
                  <strong>{entry.displayName}</strong>
                  <span>{entry.purpose}</span>
                  <details>
                    <summary>{props.t("packages.catalogDetails")}</summary>
                    <div className="skill-registry-meta" aria-label={props.t("packages.catalogDetails") }>
                      <span>{entry.packageName}</span>
                      <span>{`v${entry.version}`}</span>
                      <span>{entry.license}</span>
                      {entry.packageTypes.map((type) => <span key={type}>{props.t(`packages.type.${type}`)}</span>)}
                    </div>
                    <span>{`${props.t("packages.catalogCapabilities")}: ${entry.capabilities.join(", ")}`}</span>
                    <span>{`${props.t("packages.catalogDataBoundaries")}: ${entry.dataBoundaries.join(", ")}`}</span>
                    <span>{`${props.t("packages.catalogIntegrity")}: ${entry.integrity}`}</span>
                    <span>{props.t("packages.catalogTrustNotice")}</span>
                  </details>
                </div>
                <div className="settings-row-control">
                  <button
                    className="settings-button"
                    type="button"
                    disabled={mutationBusy || readState !== "ready"}
                    onClick={() => {
                      setPackageName(entry.packageName);
                      setVersion(entry.version);
                      setIntegrity(entry.integrity);
                      setStatusKey(null);
                      pageRef.current?.querySelector<HTMLInputElement>("#pi-package-name")?.focus();
                    }}
                  >
                    {props.t("packages.catalogSelect")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section" role="group" aria-labelledby="packages-registry-title">
        <h2 className="settings-section-title" id="packages-registry-title" tabIndex={-1}>{props.t("packages.registryTitle")}</h2>
        {readState === "loading" ? (
          <div className="settings-card skills-empty-card" role="status" aria-live="polite">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="package" size={19} /></span>
            <div className="settings-row-copy"><strong>{props.t("packages.loading")}</strong></div>
          </div>
        ) : readState === "failed" ? (
          <div className="settings-card skills-empty-card" role="status" aria-live="polite">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="package" size={19} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("packages.loadFailed")}</strong>
              <span>{props.t("packages.loadFailedDescription")}</span>
            </div>
            <button className="settings-button" type="button" onClick={() => setReloadSequence((value) => value + 1)}>
              {props.t("packages.retry")}
            </button>
          </div>
        ) : registry && registry.packages.length > 0 ? (
          <div className="settings-card" data-package-registry-revision={registry.revision}>
            {registry.packages.map((item) => {
              const updateDraft = updateDrafts[item.packageId] ?? { targetVersion: "", targetIntegrity: "" };
              return (
              <form
                className="settings-row tall"
                data-package-id={item.packageId}
                key={item.packageId}
                tabIndex={-1}
                onSubmit={(event) => {
                  event.preventDefault();
                  void updatePackage(item.packageId);
                }}
              >
                <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="package" size={17} /></span>
                <div className="settings-row-copy">
                  <strong>{item.packageName}</strong>
                  <span>{`v${item.version}`}</span>
                  <div className="skill-registry-meta" aria-label={props.t("packages.details")}>
                    <span>{props.t("packages.state.installed_disabled")}</span>
                    <span>{props.t("packages.trust.community")}</span>
                    {item.packageTypes.map((type) => <span key={type}>{props.t(`packages.type.${type}`)}</span>)}
                  </div>
                  {item.canUpdate ? (
                    <>
                      <label htmlFor={`pi-package-update-version-${item.packageId}`}><strong>{props.t("packages.updateVersion")}</strong></label>
                      <span>{props.t("packages.updateVersionDescription")}</span>
                      <input
                        className="settings-input"
                        id={`pi-package-update-version-${item.packageId}`}
                        data-package-update-version-id={item.packageId}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={updateDraft.targetVersion}
                        placeholder={props.t("packages.versionPlaceholder")}
                        disabled={mutationBusy || readState !== "ready"}
                        onInput={(event) => {
                          const targetVersion = event.currentTarget.value;
                          setUpdateDrafts((current) => ({
                            ...current,
                            [item.packageId]: {
                              ...(current[item.packageId] ?? { targetVersion: "", targetIntegrity: "" }),
                              targetVersion
                            }
                          }));
                          setMaintenanceStatusKey(null);
                        }}
                      />
                      <label htmlFor={`pi-package-update-integrity-${item.packageId}`}><strong>{props.t("packages.updateIntegrity")}</strong></label>
                      <span>{props.t("packages.updateIntegrityDescription")}</span>
                      <input
                        className="settings-input"
                        id={`pi-package-update-integrity-${item.packageId}`}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={updateDraft.targetIntegrity}
                        placeholder="sha512-..."
                        disabled={mutationBusy || readState !== "ready"}
                        onInput={(event) => {
                          const targetIntegrity = event.currentTarget.value;
                          setUpdateDrafts((current) => ({
                            ...current,
                            [item.packageId]: {
                              ...(current[item.packageId] ?? { targetVersion: "", targetIntegrity: "" }),
                              targetIntegrity
                            }
                          }));
                          setMaintenanceStatusKey(null);
                        }}
                      />
                    </>
                  ) : null}
                </div>
                <div className="settings-row-control">
                  {item.canUpdate ? (
                    <button
                      className="settings-button"
                      type="submit"
                      disabled={mutationBusy || readState !== "ready" || updateDraft.targetVersion.length === 0 || updateDraft.targetIntegrity.length === 0}
                    >
                      {props.t(updatingPackageId === item.packageId ? "packages.updating" : "packages.update")}
                    </button>
                  ) : null}
                  {item.canRollback && item.rollbackTarget ? (
                    <button
                      className="settings-button"
                      type="button"
                      data-package-rollback-id={item.packageId}
                      disabled={mutationBusy || readState !== "ready"}
                      onClick={() => void rollbackPackage(item.packageId)}
                    >
                      {props.t(rollingBackPackageId === item.packageId ? "packages.rollingBack" : "packages.rollback")}
                      {rollingBackPackageId === item.packageId ? null : ` v${item.rollbackTarget.targetVersion}`}
                    </button>
                  ) : null}
                  <button
                    className="settings-button"
                    type="button"
                    data-package-remove-id={item.packageId}
                    disabled={mutationBusy || readState !== "ready"}
                    onClick={() => void uninstallPackage(item.packageId)}
                  >
                    {props.t(uninstallingPackageId === item.packageId ? "packages.removing" : "packages.remove")}
                  </button>
                </div>
              </form>
              );
            })}
          </div>
        ) : (
          <div className="settings-card skills-empty-card">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="package" size={19} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("packages.emptyTitle")}</strong>
              <span>{props.t("packages.emptyDescription")}</span>
            </div>
          </div>
        )}
        {maintenanceStatusKey ? <p className="settings-note" role="status" aria-live="polite">{props.t(maintenanceStatusKey)}</p> : null}
      </section>

      <section className="settings-section" role="group" aria-labelledby="packages-install-title">
        <h2 className="settings-section-title" id="packages-install-title">{props.t("packages.installTitle")}</h2>
        <form
          className="settings-card"
          onSubmit={(event) => {
            event.preventDefault();
            void installPackage();
          }}
        >
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <label htmlFor="pi-package-name"><strong>{props.t("packages.packageName")}</strong></label>
              <span>{props.t("packages.packageNameDescription")}</span>
            </div>
            <input
              className="settings-input"
              id="pi-package-name"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={packageName}
              placeholder={props.t("packages.packageNamePlaceholder")}
              disabled={mutationBusy || readState !== "ready"}
              onInput={(event) => {
                setPackageName(event.currentTarget.value);
                setIntegrity("");
                setStatusKey(null);
              }}
            />
          </div>
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <label htmlFor="pi-package-version"><strong>{props.t("packages.version")}</strong></label>
              <span>{props.t("packages.versionDescription")}</span>
            </div>
            <input
              className="settings-input"
              id="pi-package-version"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={version}
              placeholder={props.t("packages.versionPlaceholder")}
              disabled={mutationBusy || readState !== "ready"}
              onInput={(event) => {
                setVersion(event.currentTarget.value);
                setIntegrity("");
                setStatusKey(null);
              }}
            />
          </div>
          {integrity ? (
            <div className="settings-row tall">
              <div className="settings-row-copy">
                <label htmlFor="pi-package-integrity"><strong>{props.t("packages.catalogIntegrity")}</strong></label>
                <span>{props.t("packages.catalogIntegrityDescription")}</span>
              </div>
              <input className="settings-input" id="pi-package-integrity" readOnly value={integrity} />
            </div>
          ) : null}
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <strong>{props.t("packages.confirmationTitle")}</strong>
              <span>{props.t("packages.confirmationDescription")}</span>
            </div>
            <div className="settings-row-control">
              <button
                className="settings-button primary"
                type="submit"
                disabled={mutationBusy || readState !== "ready" || packageName.length === 0 || version.length === 0}
              >
                {props.t(installing ? "packages.installing" : "packages.install")}
              </button>
            </div>
          </div>
        </form>
        {statusKey ? <p className="settings-note" role="status" aria-live="polite">{props.t(statusKey)}</p> : null}
      </section>
    </section>
  );
}

function createPiPackageInstallRequestId(): `pi_package_request_${string}` {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `pi_package_request_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function createPiPackageUninstallRequestId(): `pi_package_uninstall_request_${string}` {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `pi_package_uninstall_request_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function createPiPackageCatalogQueryRequestId(): `pi_package_catalog_request_${string}` {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `pi_package_catalog_request_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function createPiPackageUpdateRequestId(): `pi_package_update_request_${string}` {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `pi_package_update_request_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function createPiPackageRollbackRequestId(): `pi_package_rollback_request_${string}` {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `pi_package_rollback_request_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}
