import path from "node:path";
import type { JobRecordSnapshot } from "./job-record-store";

export interface DiagnosticsRegistry {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly machineScopeId: string;
  readonly jobIds: readonly string[];
}

export interface SupportBundleBinding {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly requestId: string;
  readonly previewId: string;
  readonly scopeContextId: string;
  readonly activeVaultId: string | null;
  readonly expectedRevision: number;
  readonly eventSelectionRevision?: string;
  readonly selectedDiagnosticEventIds?: readonly string[];
  readonly destinationPath: string;
  readonly contentSha256: string;
  readonly contentBytes: number;
  readonly createdAt: string;
  readonly state: "prepared" | "published";
  readonly publishedAt?: string;
}

/**
 * Keeps the explicit destination-repair gesture separate from the durable
 * diagnostics lifecycle owner. The port is Main-only: it rechecks the private
 * binding and confines the selected destination immediately before resuming.
 */
export interface DiagnosticsSupportBundleRecoveryRequest {
  readonly jobId: string;
  readonly activeVaultId: string | null;
  readonly scopeContextId: string;
  readonly expectedRevision: number;
  readonly destinationPath: string;
}

export interface DiagnosticsSupportBundleRecoverySnapshot {
  readonly jobId: string;
  readonly activeVaultId: string | null;
  readonly scopeContextId: string;
  readonly revision: number;
  readonly state: string;
  readonly destinationState: "missing" | "changed" | "exact";
}

export interface DiagnosticsSupportBundleRecoveryPort {
  read(jobId: string): DiagnosticsSupportBundleRecoverySnapshot | undefined;
  rebindAndResume(
    request: DiagnosticsSupportBundleRecoveryRequest
  ): "resumed" | "already_resumed" | "stale" | "not_found" | "ineligible";
}

export interface DiagnosticsSupportBundleRecoveryStore {
  readRegistry(): DiagnosticsRegistry;
  readJob(jobId: string): JobRecordSnapshot | undefined;
  readBinding(jobId: string): SupportBundleBinding;
  currentContext(registry: DiagnosticsRegistry): { readonly activeVaultId: string | null; readonly scopeContextId: string };
  destinationState(binding: SupportBundleBinding): "missing" | "changed" | "exact";
  assertHeld(): void;
  writeBinding(binding: SupportBundleBinding): void;
  prepareRetry(snapshot: JobRecordSnapshot): void;
  bumpRegistry(registry: DiagnosticsRegistry): void;
  schedule(jobId: string): void;
}

export function createDiagnosticsSupportBundleRecoveryPort(
  store: DiagnosticsSupportBundleRecoveryStore
): DiagnosticsSupportBundleRecoveryPort {
  return {
    read: (jobId) => {
      try {
        const registry = store.readRegistry();
        if (!registry.jobIds.includes(jobId)) return undefined;
        const snapshot = store.readJob(jobId);
        if (!snapshot) return undefined;
        const binding = store.readBinding(jobId);
        const context = store.currentContext(registry);
        return {
          jobId,
          activeVaultId: context.activeVaultId,
          scopeContextId: context.scopeContextId,
          revision: registry.revision,
          state: snapshot.job.state,
          destinationState: store.destinationState(binding)
        };
      } catch {
        return undefined;
      }
    },
    rebindAndResume: (request) => {
      store.assertHeld();
      const registry = store.readRegistry();
      const context = store.currentContext(registry);
      if (request.expectedRevision !== registry.revision || request.scopeContextId !== context.scopeContextId ||
        request.activeVaultId !== context.activeVaultId) return "stale";
      const snapshot = store.readJob(request.jobId);
      if (!snapshot || !registry.jobIds.includes(request.jobId)) return "not_found";
      const binding = store.readBinding(request.jobId);
      if (binding.activeVaultId !== context.activeVaultId || binding.scopeContextId !== request.scopeContextId ||
        snapshot.job.state !== "failed_retryable") return "ineligible";
      if (store.destinationState(binding) === "exact") return "already_resumed";
      const { publishedAt: _publishedAt, ...bindingWithoutPublication } = binding;
      store.writeBinding({
        ...bindingWithoutPublication,
        destinationPath: path.resolve(request.destinationPath),
        state: "prepared"
      });
      store.prepareRetry(snapshot);
      store.bumpRegistry(registry);
      store.schedule(request.jobId);
      return "resumed";
    }
  };
}

export type DiagnosticsSupportBundleRecoveryResult =
  | { readonly status: "resumed"; readonly jobId: string }
  | { readonly status: "stale" | "not_found" | "ineligible" | "failed"; readonly jobId: string };

export class DiagnosticsSupportBundleRecoveryService {
  readonly #port: DiagnosticsSupportBundleRecoveryPort;

  constructor(port: DiagnosticsSupportBundleRecoveryPort) {
    this.#port = port;
  }

  reconnect(request: DiagnosticsSupportBundleRecoveryRequest): DiagnosticsSupportBundleRecoveryResult {
    const snapshot = this.#port.read(request.jobId);
    if (!snapshot || snapshot.jobId !== request.jobId) {
      return { status: "not_found", jobId: request.jobId };
    }
    if (
      snapshot.activeVaultId !== request.activeVaultId ||
      snapshot.scopeContextId !== request.scopeContextId ||
      snapshot.revision !== request.expectedRevision
    ) {
      return { status: "stale", jobId: request.jobId };
    }
    if (
      snapshot.state !== "failed_retryable" ||
      (snapshot.destinationState !== "missing" && snapshot.destinationState !== "changed")
    ) {
      return { status: "ineligible", jobId: request.jobId };
    }
    try {
      const outcome = this.#port.rebindAndResume(request);
      if (outcome === "resumed" || outcome === "already_resumed") {
        return { status: "resumed", jobId: request.jobId };
      }
      return { status: outcome, jobId: request.jobId };
    } catch {
      return { status: "failed", jobId: request.jobId };
    }
  }
}
