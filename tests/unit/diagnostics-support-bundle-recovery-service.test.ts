import { describe, expect, it, vi } from "vitest";
import {
  DiagnosticsSupportBundleRecoveryService,
  type DiagnosticsSupportBundleRecoveryPort
} from "../../apps/desktop/src/main/services/diagnostics-support-bundle-recovery-service";

const request = {
  jobId: "job_20260808_support1234",
  activeVaultId: "vault_20260808_support1234",
  scopeContextId: "machine_support_scope",
  expectedRevision: 4,
  destinationPath: "/private/selected/support.json"
} as const;

function port(overrides: Partial<DiagnosticsSupportBundleRecoveryPort> = {}): DiagnosticsSupportBundleRecoveryPort {
  return {
    read: () => ({
      jobId: request.jobId,
      activeVaultId: request.activeVaultId,
      scopeContextId: request.scopeContextId,
      revision: request.expectedRevision,
      state: "failed_retryable",
      destinationState: "missing"
    }),
    rebindAndResume: vi.fn(() => "resumed"),
    ...overrides
  };
}

describe("DiagnosticsSupportBundleRecoveryService", () => {
  it("resumes the exact failed Job through the Main-only port", () => {
    const recoveryPort = port();
    const result = new DiagnosticsSupportBundleRecoveryService(recoveryPort).reconnect(request);

    expect(result).toEqual({ status: "resumed", jobId: request.jobId });
    expect(recoveryPort.rebindAndResume).toHaveBeenCalledWith(request);
  });

  it("fails closed before the port can mutate on identity drift", () => {
    const recoveryPort = port({
      read: () => ({
        jobId: request.jobId,
        activeVaultId: request.activeVaultId,
        scopeContextId: request.scopeContextId,
        revision: request.expectedRevision + 1,
        state: "failed_retryable",
        destinationState: "missing"
      })
    });

    expect(new DiagnosticsSupportBundleRecoveryService(recoveryPort).reconnect(request)).toEqual({
      status: "stale",
      jobId: request.jobId
    });
    expect(recoveryPort.rebindAndResume).not.toHaveBeenCalled();
  });

  it("does not treat a completed or already-bound Job as repairable", () => {
    const recoveryPort = port({
      read: () => ({
        jobId: request.jobId,
        activeVaultId: request.activeVaultId,
        scopeContextId: request.scopeContextId,
        revision: request.expectedRevision,
        state: "completed",
        destinationState: "exact"
      })
    });

    expect(new DiagnosticsSupportBundleRecoveryService(recoveryPort).reconnect(request)).toEqual({
      status: "ineligible",
      jobId: request.jobId
    });
    expect(recoveryPort.rebindAndResume).not.toHaveBeenCalled();
  });

  it("maps an idempotent adoption and port failure without exposing path details", () => {
    const adoptedPort = port({ rebindAndResume: vi.fn(() => "already_resumed") });
    expect(new DiagnosticsSupportBundleRecoveryService(adoptedPort).reconnect(request)).toEqual({
      status: "resumed",
      jobId: request.jobId
    });

    const failedPort = port({ rebindAndResume: vi.fn(() => { throw new Error("destination drift"); }) });
    const failed = new DiagnosticsSupportBundleRecoveryService(failedPort).reconnect(request);
    expect(failed).toEqual({ status: "failed", jobId: request.jobId });
    expect(JSON.stringify(failed)).not.toContain(request.destinationPath);
  });
});
