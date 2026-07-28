import type { IpcMain, WebContents } from "electron";
import {
  PiPackageInstallRequestSchema,
  PiPackageInstallResultSchema,
  PiPackageRegistryQueryResultSchema,
  PiPackageRegistrySummarySchema,
  type PiPackageInstallRequest,
  type PiPackageInstallResult,
  type PiPackageRegistryQueryResult,
  type PiPackageRegistrySummary
} from "@pige/schemas";

type Awaitable<T> = T | Promise<T>;

export interface RegisterPiPackagesIpcOptions {
  readonly ipcMain: Pick<IpcMain, "handle">;
  readonly isTrustedSender: (sender: WebContents) => boolean;
  readonly getActiveVaultId: () => string | undefined;
  readonly summary: () => Awaitable<PiPackageRegistryQueryResult>;
  readonly install: (request: PiPackageInstallRequest) => Awaitable<PiPackageInstallResult>;
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
    if (!vaultId) return failedInstallWithoutOwner(parsed);

    let result: PiPackageInstallResult;
    try {
      result = PiPackageInstallResultSchema.parse(await options.install(parsed));
      assertInstallIdentity(parsed, result);
    } catch {
      return failedInstall(options, parsed);
    }

    if (trustedActiveVault(options, event.sender) !== vaultId) {
      return failedInstall(options, parsed, result.taskId, result.registry);
    }
    return result;
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

async function failedInstall(
  options: Pick<RegisterPiPackagesIpcOptions, "summary">,
  request: PiPackageInstallRequest,
  taskId = fallbackTaskId(request),
  knownRegistry?: PiPackageRegistrySummary
): Promise<PiPackageInstallResult> {
  const registry = knownRegistry ?? await fallbackRegistry(options, request.expectedRegistryRevision);
  return failedInstallResult(request, taskId, registry);
}

function failedInstallWithoutOwner(request: PiPackageInstallRequest): PiPackageInstallResult {
  return failedInstallResult(
    request,
    fallbackTaskId(request),
    emptyRegistry(request.expectedRegistryRevision)
  );
}

function failedInstallResult(
  request: PiPackageInstallRequest,
  taskId: string,
  registry: PiPackageRegistrySummary
): PiPackageInstallResult {
  return PiPackageInstallResultSchema.parse({
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    taskId,
    registry,
    status: "failed"
  });
}

async function fallbackRegistry(
  options: Pick<RegisterPiPackagesIpcOptions, "summary">,
  expectedRevision: number
): Promise<PiPackageRegistrySummary> {
  const summary = await readSummary(options);
  return summary.status === "ready"
    ? summary.registry
    : emptyRegistry(expectedRevision);
}

function emptyRegistry(expectedRevision: number): PiPackageRegistrySummary {
  return PiPackageRegistrySummarySchema.parse({
    apiVersion: 1,
    revision: expectedRevision,
    packages: []
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
