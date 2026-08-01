import { useRef, useState } from "react";
import type {
  PiPackageInspectRequest,
  PiPackageInspectResult,
  PiPackageInstalledInspection,
  PiPackageInstalledSummary,
  PiPackageRegistrySummary
} from "@pige/contracts";

export function PiPackageInstalledDetails(props: {
  readonly inspect: (request: PiPackageInspectRequest) => Promise<PiPackageInspectResult>;
  readonly item: PiPackageInstalledSummary;
  readonly registryRevision: number;
  readonly disabled: boolean;
  readonly onRegistry: (registry: PiPackageRegistrySummary) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inspection, setInspection] = useState<PiPackageInstalledInspection | null>(null);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const sequenceRef = useRef(0);

  const load = async (): Promise<void> => {
    const sequence = ++sequenceRef.current;
    const request: PiPackageInspectRequest = {
      apiVersion: 1,
      requestId: createRequestId(),
      expectedRegistryRevision: props.registryRevision,
      packageId: props.item.packageId
    };
    setLoading(true);
    setStatusKey(null);
    try {
      const result = await props.inspect(request);
      if (sequence !== sequenceRef.current) return;
      if (result.requestId !== request.requestId || result.packageId !== request.packageId) {
        setStatusKey("packages.inspectionFailed");
        return;
      }
      if (result.status === "ready") {
        if (result.registryRevision !== request.expectedRegistryRevision ||
          result.inspection.packageId !== props.item.packageId ||
          result.inspection.packageName !== props.item.packageName ||
          result.inspection.version !== props.item.version) {
          setStatusKey("packages.inspectionStale");
          return;
        }
        setInspection(result.inspection);
        return;
      }
      if (result.status === "stale" || result.status === "not_found") {
        props.onRegistry(result.registry);
        setStatusKey("packages.inspectionStale");
        return;
      }
      setStatusKey("packages.inspectionFailed");
    } catch {
      if (sequence === sequenceRef.current) setStatusKey("packages.inspectionFailed");
    } finally {
      if (sequence === sequenceRef.current) setLoading(false);
    }
  };

  return (
    <div>
      <button
        className="settings-button"
        type="button"
        data-package-inspect-id={props.item.packageId}
        aria-expanded={expanded}
        disabled={props.disabled}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next) void load();
        }}
      >
        {props.t(loading ? "packages.inspecting" : "packages.inspect")}
      </button>
      {expanded ? (
        <div className="settings-row-copy" role="group" aria-label={props.t("packages.inspectionTitle")}>
          {inspection ? (
            <>
              <span>{`${props.t("packages.catalogIntegrity")}: ${inspection.integrity}`}</span>
              <span>{props.t("packages.integrityVerified")}</span>
              <span>{`${props.t("packages.installedAt")}: ${new Date(inspection.installedAt).toLocaleString()}`}</span>
              <span>{`${props.t("packages.source")}: ${props.t("packages.sourceNpm")}`}</span>
              <span>{`${props.t("packages.dependencies")}: ${inspection.dependencyCount}`}</span>
              {inspection.catalogDisclosure.status === "reviewed" ? (
                <>
                  <strong>{props.t("packages.catalogReviewed")}</strong>
                  <span>{inspection.catalogDisclosure.entry.displayName}</span>
                  <span>{inspection.catalogDisclosure.entry.purpose}</span>
                  <span>{inspection.catalogDisclosure.entry.license}</span>
                  <span>{`${props.t("packages.catalogCapabilities")}: ${inspection.catalogDisclosure.entry.capabilities.join(", ")}`}</span>
                  <span>{`${props.t("packages.catalogDataBoundaries")}: ${inspection.catalogDisclosure.entry.dataBoundaries.join(", ")}`}</span>
                </>
              ) : <strong>{props.t("packages.catalogUnknown")}</strong>}
            </>
          ) : loading ? <span role="status">{props.t("packages.inspecting")}</span> : null}
          {statusKey ? <span role="status">{props.t(statusKey)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function createRequestId(): `pi_package_inspect_request_${string}` {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `pi_package_inspect_request_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}
