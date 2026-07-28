import { useEffect, useRef, useState } from "react";
import type {
  PiPackageInstallRequest,
  PiPackageInstallResult,
  PiPackageRegistryQueryResult,
  PiPackageRegistrySummary
} from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

export interface PiPackagesApi {
  summary: () => Promise<PiPackageRegistryQueryResult>;
  install: (request: PiPackageInstallRequest) => Promise<PiPackageInstallResult>;
}

type ReadState = "loading" | "ready" | "failed";

export function PiPackagesSettingsPanel(props: {
  readonly api: PiPackagesApi;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [registry, setRegistry] = useState<PiPackageRegistrySummary | null>(null);
  const [readState, setReadState] = useState<ReadState>("loading");
  const [reloadSequence, setReloadSequence] = useState(0);
  const [packageName, setPackageName] = useState("");
  const [version, setVersion] = useState("");
  const [installing, setInstalling] = useState(false);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  const summarySequenceRef = useRef(0);
  const installSequenceRef = useRef(0);
  const installActiveRef = useRef(false);
  const pendingPackageFocusRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      summarySequenceRef.current += 1;
      installSequenceRef.current += 1;
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

  useEffect(() => {
    const packageId = pendingPackageFocusRef.current;
    if (!packageId || installing) return;
    pendingPackageFocusRef.current = null;
    pageRef.current?.querySelector<HTMLElement>(`[data-package-id="${packageId}"]`)?.focus();
  }, [installing, registry]);

  const installPackage = async (): Promise<void> => {
    if (installActiveRef.current || !registry || packageName.length === 0 || version.length === 0) return;
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
        setStatusKey("packages.status.installed");
        pendingPackageFocusRef.current = result.registry.packages.find(
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

  return (
    <section ref={pageRef} className="settings-page settings-packages" aria-labelledby="settings-packages-title">
      <header className="settings-panel-header">
        <h1 id="settings-packages-title">{props.t("packages.title")}</h1>
        <p>{props.t("packages.subtitle")}</p>
      </header>

      <section className="settings-section" role="group" aria-labelledby="packages-registry-title">
        <h2 className="settings-section-title" id="packages-registry-title">{props.t("packages.registryTitle")}</h2>
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
            {registry.packages.map((item) => (
              <div className="settings-row tall" data-package-id={item.packageId} key={item.packageId} tabIndex={-1}>
                <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="package" size={17} /></span>
                <div className="settings-row-copy">
                  <strong>{item.packageName}</strong>
                  <span>{`v${item.version}`}</span>
                  <div className="skill-registry-meta" aria-label={props.t("packages.details")}>
                    <span>{props.t("packages.state.installed_disabled")}</span>
                    <span>{props.t("packages.trust.community")}</span>
                    {item.packageTypes.map((type) => <span key={type}>{props.t(`packages.type.${type}`)}</span>)}
                  </div>
                </div>
              </div>
            ))}
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
              disabled={installing || readState !== "ready"}
              onInput={(event) => {
                setPackageName(event.currentTarget.value);
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
              disabled={installing || readState !== "ready"}
              onInput={(event) => {
                setVersion(event.currentTarget.value);
                setStatusKey(null);
              }}
            />
          </div>
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <strong>{props.t("packages.confirmationTitle")}</strong>
              <span>{props.t("packages.confirmationDescription")}</span>
            </div>
            <div className="settings-row-control">
              <button
                className="settings-button primary"
                type="submit"
                disabled={installing || readState !== "ready" || packageName.length === 0 || version.length === 0}
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
