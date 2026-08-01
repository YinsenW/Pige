import type { IpcMain, WebContents } from "electron";
import {
  PiPackageCatalogQueryRequestSchema,
  PiPackageCatalogQueryResultSchema,
  PiPackageInstallRequestSchema,
  PiPackageInstallResultSchema,
  PiPackageInspectRequestSchema,
  PiPackageInspectResultSchema,
  PiPackageRegistryQueryResultSchema,
  PiPackageRestoreRequestSchema,
  PiPackageRestoreResultSchema,
  PiPackageRollbackRequestSchema,
  PiPackageRollbackResultSchema,
  PiPackageSetPinnedRequestSchema,
  PiPackageSetPinnedResultSchema,
  PiPackageSetEnabledRequestSchema,
  PiPackageSetEnabledResultSchema,
  PiPackageUninstallRequestSchema,
  PiPackageUninstallResultSchema,
  PiPackageUpdateRequestSchema,
  PiPackageUpdateResultSchema,
  type PiPackageInstallRequest,
  type PiPackageInstallResult,
  type PiPackageInspectRequest,
  type PiPackageInspectResult,
  type PiPackageCatalogQueryRequest,
  type PiPackageCatalogQueryResult,
  type PiPackageRegistrySummary,
  type PiPackageRegistryQueryResult,
  type PiPackageRestoreRequest,
  type PiPackageRestoreResult,
  type PiPackageRollbackRequest,
  type PiPackageRollbackResult,
  type PiPackageSetPinnedRequest,
  type PiPackageSetPinnedResult,
  type PiPackageSetEnabledRequest,
  type PiPackageSetEnabledResult,
  type PiPackageUninstallRequest,
  type PiPackageUninstallResult,
  type PiPackageUpdateRequest,
  type PiPackageUpdateResult
} from "@pige/schemas";

type Awaitable<T> = T | Promise<T>;

export interface RegisterPiPackagesIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly isTrustedSender: (sender: WebContents) => boolean;
  readonly getActiveVaultId: () => string | undefined;
  readonly summary: () => Awaitable<PiPackageRegistryQueryResult>;
  readonly catalogQuery: (request: PiPackageCatalogQueryRequest) => Awaitable<PiPackageCatalogQueryResult>;
  readonly inspect: (request: PiPackageInspectRequest) => Awaitable<PiPackageInspectResult>;
  readonly install: (request: PiPackageInstallRequest) => Awaitable<PiPackageInstallResult>;
  readonly confirmUninstall: (sender: WebContents, request: PiPackageUninstallRequest) => Awaitable<boolean>;
  readonly uninstall: (request: PiPackageUninstallRequest) => Awaitable<PiPackageUninstallResult>;
  readonly restore: (request: PiPackageRestoreRequest) => Awaitable<PiPackageRestoreResult>;
  readonly confirmUpdate: (sender: WebContents, binding: PiPackageUpdateConfirmationBinding) => Awaitable<boolean>;
  readonly update: (request: PiPackageUpdateRequest) => Awaitable<PiPackageUpdateResult>;
  readonly confirmRollback: (sender: WebContents, binding: PiPackageRollbackConfirmationBinding) => Awaitable<boolean>;
  readonly rollback: (request: PiPackageRollbackRequest) => Awaitable<PiPackageRollbackResult>;
  readonly setPinned: (request: PiPackageSetPinnedRequest) => Awaitable<PiPackageSetPinnedResult>;
  readonly setEnabled: (request: PiPackageSetEnabledRequest) => Awaitable<PiPackageSetEnabledResult>;
}

export interface PiPackageUpdateConfirmationBinding {
  readonly request: PiPackageUpdateRequest; readonly packageName: string; readonly currentVersion: string;
}
export interface PiPackageRollbackConfirmationBinding {
  readonly request: PiPackageRollbackRequest; readonly packageName: string; readonly currentVersion: string;
}

const REQUEST_PREFIX = "pi_package_request_";

export function registerPiPackagesIpc(options: RegisterPiPackagesIpcOptions): void {
  options.ipcMain.handle("piPackages.summary", async (event) => {
    if (!options.isTrustedSender(event.sender)) return failedSummary();
    const result = await readSummary(options);
    return options.isTrustedSender(event.sender) ? result : failedSummary();
  });

  options.ipcMain.handle("piPackages.catalogQuery", async (event, request: unknown) => {
    const parsed = PiPackageCatalogQueryRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender)) return failedCatalogQuery(parsed);
    try {
      const result = PiPackageCatalogQueryResultSchema.parse(await options.catalogQuery(parsed));
      assertCatalogQueryIdentity(parsed, result);
      return options.isTrustedSender(event.sender) ? result : failedCatalogQuery(parsed);
    } catch {
      return failedCatalogQuery(parsed);
    }
  });

  options.ipcMain.handle("piPackages.inspect", async (event, request: unknown) => {
    const parsed = PiPackageInspectRequestSchema.parse(request);
    if (!options.isTrustedSender(event.sender)) return failedInspect(parsed);
    try {
      const result = PiPackageInspectResultSchema.parse(await options.inspect(parsed));
      assertInspectIdentity(parsed, result);
      return options.isTrustedSender(event.sender) ? result : failedInspect(parsed);
    } catch {
      return failedInspect(parsed);
    }
  });

  options.ipcMain.handle("piPackages.install", async (event, request: unknown) => {
    const parsed = PiPackageInstallRequestSchema.parse(request);
    const vaultId = trustedActiveVault(options, event.sender);
    if (!vaultId) return failedInstall(parsed);

    let result: PiPackageInstallResult;
    try {
      result = PiPackageInstallResultSchema.parse(await options.install(parsed));
      assertInstallIdentity(parsed, result);
    } catch {
      return failedInstall(parsed);
    }

    if (trustedActiveVault(options, event.sender) !== vaultId) {
      return failedInstall(parsed, result.taskId);
    }
    return result;
  });

  options.ipcMain.handle("piPackages.uninstall", async (event, request: unknown) => {
    const parsed = PiPackageUninstallRequestSchema.parse(request);
    const vaultId = trustedActiveVault(options, event.sender);
    if (!vaultId) return failedUninstall(parsed);
    let confirmed = false;
    try { confirmed = await options.confirmUninstall(event.sender, parsed); } catch { return failedUninstall(parsed); }
    if (trustedActiveVault(options, event.sender) !== vaultId) return failedUninstall(parsed);
    if (!confirmed) {
      const summary = await readSummary(options);
      return summary.status === "ready" && trustedActiveVault(options, event.sender) === vaultId
        ? uninstallResult(parsed, "denied", summary.registry)
        : failedUninstall(parsed);
    }
    try {
      const result = PiPackageUninstallResultSchema.parse(await options.uninstall(parsed));
      assertUninstallIdentity(parsed, result);
      return trustedActiveVault(options, event.sender) === vaultId ? result : failedUninstall(parsed);
    } catch {
      return failedUninstall(parsed);
    }
  });

  options.ipcMain.handle("piPackages.restore", async (event, request: unknown) => {
    const parsed = PiPackageRestoreRequestSchema.parse(request);
    const vaultId = trustedActiveVault(options, event.sender);
    if (!vaultId) return failedRestore(parsed);
    try {
      const result = PiPackageRestoreResultSchema.parse(await options.restore(parsed));
      assertRestoreIdentity(parsed, result);
      return trustedActiveVault(options, event.sender) === vaultId ? result : failedRestore(parsed);
    } catch {
      return failedRestore(parsed);
    }
  });

  options.ipcMain.handle("piPackages.update", async (event, request: unknown) => {
    const parsed = PiPackageUpdateRequestSchema.parse(request);
    const vaultId = trustedActiveVault(options, event.sender);
    if (!vaultId) return failedUpdate(parsed);
    const before = await readSummary(options);
    const current = before.status === "ready" && before.registry.revision === parsed.expectedRegistryRevision
      ? before.registry.packages.find((entry) => entry.packageId === parsed.packageId)
      : undefined;
    if (!current) return before.status === "ready"
      ? updateResult(parsed, before.registry.revision === parsed.expectedRegistryRevision ? "not_found" : "stale", before.registry)
      : failedUpdate(parsed);
    if (current.pinned || !current.canUpdate) return failedUpdate(parsed);
    let confirmed = false;
    try {
      confirmed = await options.confirmUpdate(event.sender, {
        request: parsed, packageName: current.packageName, currentVersion: current.version
      });
    } catch { return failedUpdate(parsed); }
    if (trustedActiveVault(options, event.sender) !== vaultId) return failedUpdate(parsed);
    if (!confirmed) {
      const summary = await readSummary(options);
      return summary.status === "ready" && trustedActiveVault(options, event.sender) === vaultId
        ? updateResult(parsed, "denied", summary.registry) : failedUpdate(parsed);
    }
    try {
      const result = PiPackageUpdateResultSchema.parse(await options.update(parsed));
      assertUpdateIdentity(parsed, result);
      return trustedActiveVault(options, event.sender) === vaultId ? result : failedUpdate(parsed);
    } catch { return failedUpdate(parsed); }
  });

  options.ipcMain.handle("piPackages.rollback", async (event, request: unknown) => {
    const parsed = PiPackageRollbackRequestSchema.parse(request);
    const vaultId = trustedActiveVault(options, event.sender);
    if (!vaultId) return failedRollback(parsed);
    const before = await readSummary(options);
    const current = before.status === "ready" && before.registry.revision === parsed.expectedRegistryRevision
      ? before.registry.packages.find((entry) => entry.packageId === parsed.packageId)
      : undefined;
    if (current?.pinned) return failedRollback(parsed);
    if (!current || current.rollbackTarget?.rollbackId !== parsed.rollbackId ||
      current.rollbackTarget.targetVersion !== parsed.targetVersion) {
      return before.status === "ready" ? rollbackResult(parsed,
        before.registry.revision === parsed.expectedRegistryRevision && !current ? "not_found" : "stale", before.registry) : failedRollback(parsed);
    }
    if (!current.canRollback) return failedRollback(parsed);
    let confirmed = false;
    try {
      confirmed = await options.confirmRollback(event.sender, {
        request: parsed, packageName: current.packageName, currentVersion: current.version
      });
    } catch { return failedRollback(parsed); }
    if (trustedActiveVault(options, event.sender) !== vaultId) return failedRollback(parsed);
    if (!confirmed) {
      const summary = await readSummary(options);
      return summary.status === "ready" && trustedActiveVault(options, event.sender) === vaultId
        ? rollbackResult(parsed, "denied", summary.registry) : failedRollback(parsed);
    }
    try {
      const result = PiPackageRollbackResultSchema.parse(await options.rollback(parsed));
      assertRollbackIdentity(parsed, result);
      return trustedActiveVault(options, event.sender) === vaultId ? result : failedRollback(parsed);
    } catch { return failedRollback(parsed); }
  });

  options.ipcMain.handle("piPackages.setPinned", async (event, request: unknown) => {
    const parsed = PiPackageSetPinnedRequestSchema.parse(request);
    const vaultId = trustedActiveVault(options, event.sender);
    if (!vaultId) return failedPinned(parsed);
    try {
      const result = PiPackageSetPinnedResultSchema.parse(await options.setPinned(parsed));
      assertPinnedIdentity(parsed, result);
      return trustedActiveVault(options, event.sender) === vaultId ? result : failedPinned(parsed);
    } catch { return failedPinned(parsed); }
  });

  options.ipcMain.handle("piPackages.setEnabled", async (event, request: unknown) => {
    const parsed = PiPackageSetEnabledRequestSchema.parse(request);
    const vaultId = trustedActiveVault(options, event.sender);
    if (!vaultId) return failedEnabled(parsed);
    try {
      const result = PiPackageSetEnabledResultSchema.parse(await options.setEnabled(parsed));
      assertEnabledIdentity(parsed, result);
      return trustedActiveVault(options, event.sender) === vaultId ? result : failedEnabled(parsed);
    } catch { return failedEnabled(parsed); }
  });
}

function trustedActiveVault(
  options: Pick<RegisterPiPackagesIpcOptions, "isTrustedSender" | "getActiveVaultId">,
  sender: WebContents
): string | undefined {
  if (!options.isTrustedSender(sender)) return undefined;
  const vaultId = options.getActiveVaultId();
  return vaultId && vaultId.length > 0 ? vaultId : undefined;
}

async function readSummary(
  options: Pick<RegisterPiPackagesIpcOptions, "summary">
): Promise<PiPackageRegistryQueryResult> {
  try {
    return PiPackageRegistryQueryResultSchema.parse(await options.summary());
  } catch {
    return failedSummary();
  }
}

function failedSummary(): PiPackageRegistryQueryResult {
  return PiPackageRegistryQueryResultSchema.parse({ status: "failed" });
}

function failedCatalogQuery(request: PiPackageCatalogQueryRequest): PiPackageCatalogQueryResult {
  return PiPackageCatalogQueryResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    status: "failed"
  });
}

function assertCatalogQueryIdentity(
  request: PiPackageCatalogQueryRequest,
  result: PiPackageCatalogQueryResult
): void {
  if (result.apiVersion !== request.apiVersion || result.requestId !== request.requestId) {
    throw new Error("Pi package catalog response identity did not match the request.");
  }
}

function failedInspect(request: PiPackageInspectRequest): PiPackageInspectResult {
  return PiPackageInspectResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    packageId: request.packageId,
    status: "failed"
  });
}

function assertInspectIdentity(request: PiPackageInspectRequest, result: PiPackageInspectResult): void {
  if (result.apiVersion !== request.apiVersion || result.requestId !== request.requestId ||
    result.packageId !== request.packageId) {
    throw new Error("Pi package inspection response identity did not match the request.");
  }
}

function failedInstall(
  request: PiPackageInstallRequest,
  taskId = fallbackTaskId(request)
): PiPackageInstallResult {
  return PiPackageInstallResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    taskId,
    status: "failed"
  });
}

function fallbackTaskId(request: PiPackageInstallRequest): string {
  return `pi_package_task_${request.requestId.slice(REQUEST_PREFIX.length)}`;
}

function assertInstallIdentity(
  request: PiPackageInstallRequest,
  result: PiPackageInstallResult
): void {
  if (result.apiVersion !== request.apiVersion || result.requestId !== request.requestId) {
    throw new Error("Pi package install response identity did not match the request.");
  }
}

function failedUninstall(request: PiPackageUninstallRequest): PiPackageUninstallResult {
  return uninstallResult(request, "failed");
}

function uninstallResult(
  request: PiPackageUninstallRequest,
  status: "denied" | "failed",
  registry?: PiPackageRegistrySummary
): PiPackageUninstallResult {
  return PiPackageUninstallResultSchema.parse({
    apiVersion: request.apiVersion, requestId: request.requestId, packageId: request.packageId, status,
    ...(registry ? { registry } : {})
  });
}

function assertUninstallIdentity(request: PiPackageUninstallRequest, result: PiPackageUninstallResult): void {
  if (result.apiVersion !== request.apiVersion || result.requestId !== request.requestId || result.packageId !== request.packageId) {
    throw new Error("Pi package uninstall response identity did not match the request.");
  }
}

function failedRestore(request: PiPackageRestoreRequest): PiPackageRestoreResult {
  const { expectedRegistryRevision: _expectedRegistryRevision, ...identity } = request;
  return PiPackageRestoreResultSchema.parse({ ...identity, status: "failed" });
}

function assertRestoreIdentity(request: PiPackageRestoreRequest, result: PiPackageRestoreResult): void {
  if (result.requestId !== request.requestId || result.restoreContextId !== request.restoreContextId ||
    result.packageId !== request.packageId || result.version !== request.version || result.integrity !== request.integrity ||
    result.pinned !== request.pinned || JSON.stringify(result.rollbackTarget) !== JSON.stringify(request.rollbackTarget)) {
    throw new Error("Pi package restore result identity changed.");
  }
}

function failedUpdate(request: PiPackageUpdateRequest): PiPackageUpdateResult { return updateResult(request, "failed"); }
function updateResult(
  request: PiPackageUpdateRequest, status: "denied" | "stale" | "not_found" | "failed", registry?: PiPackageRegistrySummary
): PiPackageUpdateResult {
  return PiPackageUpdateResultSchema.parse({ apiVersion: request.apiVersion, requestId: request.requestId,
    packageId: request.packageId, targetVersion: request.targetVersion, targetIntegrity: request.targetIntegrity,
    status, ...(registry ? { registry } : {}) });
}
function assertUpdateIdentity(request: PiPackageUpdateRequest, result: PiPackageUpdateResult): void {
  if (result.apiVersion !== request.apiVersion || result.requestId !== request.requestId ||
    result.packageId !== request.packageId || result.targetVersion !== request.targetVersion ||
    result.targetIntegrity !== request.targetIntegrity) throw new Error("Pi package update response identity did not match the request.");
}
function failedRollback(request: PiPackageRollbackRequest): PiPackageRollbackResult { return rollbackResult(request, "failed"); }
function rollbackResult(
  request: PiPackageRollbackRequest, status: "denied" | "stale" | "not_found" | "failed", registry?: PiPackageRegistrySummary
): PiPackageRollbackResult {
  return PiPackageRollbackResultSchema.parse({ apiVersion: request.apiVersion, requestId: request.requestId,
    packageId: request.packageId, rollbackId: request.rollbackId, targetVersion: request.targetVersion,
    status, ...(registry ? { registry } : {}) });
}
function assertRollbackIdentity(request: PiPackageRollbackRequest, result: PiPackageRollbackResult): void {
  if (result.apiVersion !== request.apiVersion || result.requestId !== request.requestId ||
    result.packageId !== request.packageId || result.rollbackId !== request.rollbackId ||
    result.targetVersion !== request.targetVersion) throw new Error("Pi package rollback response identity did not match the request.");
}
function failedPinned(request: PiPackageSetPinnedRequest): PiPackageSetPinnedResult {
  return PiPackageSetPinnedResultSchema.parse({ apiVersion: request.apiVersion, requestId: request.requestId,
    packageId: request.packageId, pinned: request.pinned, status: "failed" });
}
function assertPinnedIdentity(request: PiPackageSetPinnedRequest, result: PiPackageSetPinnedResult): void {
  if (result.requestId !== request.requestId || result.packageId !== request.packageId || result.pinned !== request.pinned) {
    throw new Error("Pi package pin result identity changed.");
  }
}
function failedEnabled(request: PiPackageSetEnabledRequest): PiPackageSetEnabledResult {
  return PiPackageSetEnabledResultSchema.parse({ apiVersion: request.apiVersion, requestId: request.requestId,
    packageId: request.packageId, enabled: request.enabled, status: "failed" });
}
function assertEnabledIdentity(request: PiPackageSetEnabledRequest, result: PiPackageSetEnabledResult): void {
  if (result.requestId !== request.requestId || result.packageId !== request.packageId || result.enabled !== request.enabled) {
    throw new Error("Pi package runtime result identity changed.");
  }
}
