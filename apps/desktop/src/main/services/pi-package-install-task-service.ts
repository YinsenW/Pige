import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  PiPackageInstallRequest,
  PiPackageInstallResult,
  PiPackageRegistrySummary
} from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import {
  PiPackageInstallRequestSchema,
  PiPackageInstallResultSchema,
  PiPackageInstallTaskIdSchema,
  PiPackageRegistrySummarySchema
} from "@pige/schemas";
import type {
  PermissionedExternalCapabilityRegistry,
  PermissionedExternalTurnContext
} from "./permissioned-external-capability-service";
import type { HighRiskConfirmationService } from "./high-risk-confirmation-service";

const TASK_ROOT_NAME = "pi-package-install-tasks";
const TASK_RECORD_BYTES = 16 * 1024;
const PACKAGE_TOOL_NAME = "pige_install_pi_package";
const activeInstalls = new Map<string, Promise<PiPackageInstallResult>>();

type InstallStatus = PiPackageInstallResult["status"];

interface PiPackageInstallTaskRecord {
  readonly schemaVersion: 1;
  readonly taskId: string;
  readonly request: PiPackageInstallRequest;
  readonly binding: {
    readonly vaultId: string;
    readonly permissionJobId: string;
    readonly policyContextId: string;
    readonly policyHash: string;
    readonly runtimeKind: "desktop_local" | "remote_agent_backend";
    readonly clientCapabilityTier: "desktop_full" | "web_client" | "mobile_lite";
  };
  readonly state: "pending" | InstallStatus;
}

export interface PiPackageInstallTaskRuntimeContext extends Omit<
  PermissionedExternalTurnContext,
  "jobId" | "confirmationOwner"
> {}

export interface PiPackageInstallTaskServiceOptions {
  readonly appDataRoot: string;
  readonly capabilities: Pick<PermissionedExternalCapabilityRegistry, "toolsForTurn">;
  readonly packageRegistry: {
    summary(): PiPackageRegistrySummary;
  };
  readonly confirmations: Pick<HighRiskConfirmationService, "pending" | "withdraw">;
  readonly currentContext: () => PiPackageInstallTaskRuntimeContext;
}

/**
 * Owns the machine-local request/confirmation lifecycle for Settings package installs.
 * Package bytes remain exclusively owned by the permissioned package capability.
 */
export class PiPackageInstallTaskService {
  readonly #root: string;
  readonly #capabilities: PiPackageInstallTaskServiceOptions["capabilities"];
  readonly #packageRegistry: PiPackageInstallTaskServiceOptions["packageRegistry"];
  readonly #confirmations: PiPackageInstallTaskServiceOptions["confirmations"];
  readonly #currentContext: PiPackageInstallTaskServiceOptions["currentContext"];

  constructor(options: PiPackageInstallTaskServiceOptions) {
    if (!options || !path.isAbsolute(options.appDataRoot)) throw taskStoreInvalid();
    fs.mkdirSync(options.appDataRoot, { recursive: true, mode: 0o700 });
    const appDataRoot = fs.realpathSync.native(options.appDataRoot);
    this.#root = path.join(appDataRoot, TASK_ROOT_NAME);
    fs.mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    if (fs.realpathSync.native(this.#root) !== this.#root) throw taskStoreInvalid();
    this.#capabilities = options.capabilities;
    this.#packageRegistry = options.packageRegistry;
    this.#confirmations = options.confirmations;
    this.#currentContext = options.currentContext;
  }

  install(
    request: PiPackageInstallRequest,
    signal: AbortSignal = new AbortController().signal
  ): Promise<PiPackageInstallResult> {
    const parsed = PiPackageInstallRequestSchema.parse(request);
    const taskId = taskIdFor(parsed.requestId);
    const active = activeInstalls.get(this.#taskPath(taskId));
    if (active) return active;
    const operation = this.#install(parsed, taskId, signal);
    activeInstalls.set(this.#taskPath(taskId), operation);
    return operation.finally(() => {
      if (activeInstalls.get(this.#taskPath(taskId)) === operation) {
        activeInstalls.delete(this.#taskPath(taskId));
      }
    });
  }

  async #install(
    request: PiPackageInstallRequest,
    taskId: string,
    signal: AbortSignal
  ): Promise<PiPackageInstallResult> {
    const currentContext = this.#currentContext();
    try {
      currentContext.assertCurrent();
    } catch {
      return this.#result(request.requestId, taskId, "failed");
    }

    const existing = this.#readTask(taskId);
    if (existing) {
      if (!sameRequest(existing.request, request) || !sameContext(existing.binding, currentContext)) {
        return this.#result(request.requestId, taskId, "failed");
      }
      if (existing.state !== "pending") {
        return this.#result(request.requestId, taskId, existing.state);
      }
    } else {
      const registry = this.#registry();
      const record: PiPackageInstallTaskRecord = {
        schemaVersion: 1,
        taskId,
        request,
        binding: {
          vaultId: currentContext.vaultId,
          permissionJobId: permissionJobIdFor(taskId),
          policyContextId: currentContext.policyContextId,
          policyHash: currentContext.policyHash,
          runtimeKind: currentContext.runtimeKind,
          clientCapabilityTier: currentContext.clientCapabilityTier
        },
        state: request.expectedRegistryRevision === registry.revision ? "pending" : "stale"
      };
      this.#writeTask(record);
      if (record.state === "stale") return this.#result(request.requestId, taskId, "stale", registry);
    }

    const record = this.#readTask(taskId);
    if (!record || record.state !== "pending") {
      return this.#result(request.requestId, taskId, "failed");
    }
    try {
      signal.throwIfAborted();
      const assertTaskCurrent = (): void => {
        const latest = this.#currentContext();
        latest.assertCurrent();
        if (!sameContext(record.binding, latest)) throw taskBindingChanged();
      };
      const turn: PermissionedExternalTurnContext = {
        ...currentContext,
        jobId: record.binding.permissionJobId,
        confirmationOwner: { kind: "pi_package_install_task", taskId },
        assertCurrent: assertTaskCurrent
      };
      const tool = this.#capabilities.toolsForTurn(turn).find((candidate) => candidate.name === PACKAGE_TOOL_NAME);
      if (!tool) throw taskCapabilityUnavailable();
      const toolCallId = toolCallIdFor(taskId);
      const context = { toolCallId, signal };
      const input = {
        request_id: request.requestId,
        package_name: request.packageName,
        version: request.version
      };
      if (tool.authorize && !(await tool.authorize(input, context))) throw taskCapabilityUnavailable();
      await tool.execute(input, signal, context);
      this.#settle(record, "installed_disabled");
      return this.#result(request.requestId, taskId, "installed_disabled");
    } catch (caught) {
      const status: InstallStatus = caught instanceof PigeDomainError && caught.code === "permission.denied"
        ? "denied"
        : "failed";
      if (status === "failed") await this.#withdrawPending(taskId);
      try {
        this.#settle(record, status);
      } catch {
        return this.#result(request.requestId, taskId, "failed");
      }
      return this.#result(request.requestId, taskId, status);
    }
  }

  async #withdrawPending(taskId: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pending = this.#confirmations.pending();
      if (
        pending.status !== "pending" ||
        pending.confirmation.owner.kind !== "pi_package_install_task" ||
        pending.confirmation.owner.taskId !== taskId
      ) return;
      const outcome = this.#confirmations.withdraw({
        confirmationId: pending.confirmation.confirmationId,
        expectedRevision: pending.revision,
        owner: pending.confirmation.owner
      });
      if (outcome !== "resolving") return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  #settle(record: PiPackageInstallTaskRecord, state: InstallStatus): void {
    const current = this.#readTask(record.taskId);
    if (!current || !sameRequest(current.request, record.request) || !sameBinding(current.binding, record.binding)) {
      throw taskBindingChanged();
    }
    if (current.state === state) return;
    if (current.state !== "pending") throw taskBindingChanged();
    this.#writeTask({ ...current, state });
  }

  #result(
    requestId: string,
    taskId: string,
    status: InstallStatus,
    registry: PiPackageRegistrySummary = this.#registry()
  ): PiPackageInstallResult {
    return PiPackageInstallResultSchema.parse({ apiVersion: 1, requestId, taskId, status, registry });
  }

  #registry(): PiPackageRegistrySummary {
    return PiPackageRegistrySummarySchema.parse(this.#packageRegistry.summary());
  }

  #taskPath(taskId: string): string {
    return path.join(this.#root, `${PiPackageInstallTaskIdSchema.parse(taskId)}.json`);
  }

  #readTask(taskId: string): PiPackageInstallTaskRecord | undefined {
    const filePath = this.#taskPath(taskId);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const stats = fs.fstatSync(descriptor);
      if (!stats.isFile() || stats.size > TASK_RECORD_BYTES) throw taskStoreInvalid();
      return parseTaskRecord(JSON.parse(fs.readFileSync(descriptor, "utf8")));
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
      if (caught instanceof PigeDomainError) throw caught;
      throw taskStoreInvalid();
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  #writeTask(record: PiPackageInstallTaskRecord): void {
    const validated = parseTaskRecord(record);
    const destination = this.#taskPath(validated.taskId);
    const temporary = path.join(this.#root, `.${validated.taskId}.${process.pid}.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(
        temporary,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
        0o600
      );
      fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, destination);
      fsyncDirectory(this.#root);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      fs.rmSync(temporary, { force: true });
    }
  }
}

function taskIdFor(requestId: string): string {
  return PiPackageInstallTaskIdSchema.parse(
    `pi_package_task_${digest("pige.pi_package_install_task.v1", requestId).slice(0, 32)}`
  );
}

function permissionJobIdFor(taskId: string): string {
  return `job_19700101_${digest("pige.pi_package_install_permission_job.v1", taskId).slice(0, 24)}`;
}

function toolCallIdFor(taskId: string): string {
  return `tool_call_pi_package_${digest("pige.pi_package_install_tool_call.v1", taskId).slice(0, 32)}`;
}

function digest(domain: string, value: string): string {
  return createHash("sha256").update(domain, "utf8").update("\0", "utf8").update(value, "utf8").digest("hex");
}

function sameRequest(left: PiPackageInstallRequest, right: PiPackageInstallRequest): boolean {
  return left.apiVersion === right.apiVersion &&
    left.requestId === right.requestId &&
    left.expectedRegistryRevision === right.expectedRegistryRevision &&
    left.packageName === right.packageName &&
    left.version === right.version;
}

function sameContext(
  binding: PiPackageInstallTaskRecord["binding"],
  context: PiPackageInstallTaskRuntimeContext
): boolean {
  return binding.vaultId === context.vaultId &&
    binding.policyContextId === context.policyContextId &&
    binding.policyHash === context.policyHash &&
    binding.runtimeKind === context.runtimeKind &&
    binding.clientCapabilityTier === context.clientCapabilityTier;
}

function sameBinding(
  left: PiPackageInstallTaskRecord["binding"],
  right: PiPackageInstallTaskRecord["binding"]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseTaskRecord(input: unknown): PiPackageInstallTaskRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw taskStoreInvalid();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "binding,request,schemaVersion,state,taskId") throw taskStoreInvalid();
  if (
    value.schemaVersion !== 1 ||
    typeof value.state !== "string" ||
    !["pending", "installed_disabled", "denied", "stale", "failed"].includes(value.state)
  ) {
    throw taskStoreInvalid();
  }
  const taskId = PiPackageInstallTaskIdSchema.parse(value.taskId);
  const request = PiPackageInstallRequestSchema.parse(value.request);
  if (taskId !== taskIdFor(request.requestId)) throw taskStoreInvalid();
  if (!value.binding || typeof value.binding !== "object" || Array.isArray(value.binding)) throw taskStoreInvalid();
  const binding = value.binding as Record<string, unknown>;
  if (Object.keys(binding).sort().join(",") !== "clientCapabilityTier,permissionJobId,policyContextId,policyHash,runtimeKind,vaultId") {
    throw taskStoreInvalid();
  }
  if (
    typeof binding.vaultId !== "string" ||
    binding.permissionJobId !== permissionJobIdFor(taskId) ||
    typeof binding.policyContextId !== "string" ||
    typeof binding.policyHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(binding.policyHash) ||
    !["desktop_local", "remote_agent_backend"].includes(String(binding.runtimeKind)) ||
    !["desktop_full", "web_client", "mobile_lite"].includes(String(binding.clientCapabilityTier))
  ) throw taskStoreInvalid();
  return {
    schemaVersion: 1,
    taskId,
    request,
    binding: {
      vaultId: binding.vaultId,
      permissionJobId: binding.permissionJobId,
      policyContextId: binding.policyContextId,
      policyHash: binding.policyHash,
      runtimeKind: binding.runtimeKind,
      clientCapabilityTier: binding.clientCapabilityTier
    },
    state: value.state
  } as PiPackageInstallTaskRecord;
}

function fsyncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (process.platform !== "win32") throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function taskStoreInvalid(): PigeDomainError {
  return new PigeDomainError("package.install_task_invalid", "The package install task is unavailable.");
}

function taskBindingChanged(): PigeDomainError {
  return new PigeDomainError("package.install_task_changed", "The exact package install task changed.");
}

function taskCapabilityUnavailable(): PigeDomainError {
  return new PigeDomainError("package.install_capability_unavailable", "The package install capability is unavailable.");
}
