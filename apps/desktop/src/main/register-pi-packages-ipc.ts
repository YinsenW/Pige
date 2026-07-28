import type { IpcMain, WebContents } from "electron";
import {
  PiPackageInstallRequestSchema,
  PiPackageInstallResultSchema,
  PiPackageRegistryQueryResultSchema,
  PiPackageUninstallRequestSchema,
  PiPackageUninstallResultSchema,
  type PiPackageInstallRequest,
  type PiPackageInstallResult,
  type PiPackageRegistrySummary,
  type PiPackageRegistryQueryResult,
  type PiPackageUninstallRequest,
  type PiPackageUninstallResult
} from "@pige/schemas";

type Awaitable<T> = T | Promise<T>;

export interface RegisterPiPackagesIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly isTrustedSender: (sender: WebContents) => boolean;
  readonly getActiveVaultId: () => string | undefined;
  readonly summary: () => Awaitable<PiPackageRegistryQueryResult>;
  readonly install: (request: PiPackageInstallRequest) => Awaitable<PiPackageInstallResult>;
  readonly confirmUninstall: (sender: WebContents, request: PiPackageUninstallRequest) => Awaitable<boolean>;
  readonly uninstall: (request: PiPackageUninstallRequest) => Awaitable<PiPackageUninstallResult>;
}

const REQUEST_PREFIX = "pi_package_request_";

export function registerPiPackagesIpc(options: RegisterPiPackagesIpcOptions): void {
  options.ipcMain.handle("piPackages.summary", async (event) => {
    if (!options.isTrustedSender(event.sender)) return failedSummary();
    const result = await readSummary(options);
    return options.isTrustedSender(event.sender) ? result : failedSummary();
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
