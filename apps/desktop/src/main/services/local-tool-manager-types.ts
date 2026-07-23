import { createHash, randomUUID } from "node:crypto";
import { PigeDomainError } from "@pige/domain";
import type { JobRecord, JobRef } from "@pige/schemas";
import type { JobRecordSnapshot } from "./job-record-store";
import type {
  LocalToolLicenseIdentity,
  LocalToolPackageIdentity,
  LocalToolPackageManifest
} from "./local-tool-package";

export type LocalToolInstallState =
  | "available"
  | "installed"
  | "needs_update"
  | "repair_needed"
  | "unsupported"
  | "error";

export type LocalToolHealthState = "pass" | "fail" | "unknown";
export type LocalToolLifecycleAction =
  | "install"
  | "test"
  | "update"
  | "set_enabled"
  | "remove"
  | "repair"
  | "recover_staging";

export type LocalToolFailurePoint =
  | "copy"
  | "verify"
  | "test"
  | "publish"
  | "record_precommit";

export interface LocalToolAssetDefinition extends LocalToolPackageIdentity {
  readonly assetId: string;
}

export interface LocalToolDefinition extends LocalToolPackageIdentity {
  readonly label: string;
  readonly kind: "ocr" | "runtime" | "document_parser" | "speech" | "utility";
  readonly assets?: readonly LocalToolAssetDefinition[];
}

export interface LocalToolCatalog {
  readonly tools: readonly LocalToolDefinition[];
}

export interface LocalToolInstalledTargetRecord {
  readonly installState: "installed" | "repair_needed" | "error" | "available";
  readonly enabled: boolean;
  readonly activeVersion?: string;
  readonly activeManifestSha256?: string;
  readonly activeRelativePath?: string;
  readonly platform: "macos" | "windows" | "linux";
  readonly architecture: "arm64" | "x64";
  readonly capabilities: readonly string[];
  readonly license: LocalToolLicenseIdentity;
  readonly sizeBytes?: number;
  readonly health: LocalToolHealthState;
}

export interface LocalToolAssetRecord extends LocalToolInstalledTargetRecord {
  readonly assetId: string;
}

export interface LocalToolLifecycleRecord extends LocalToolInstalledTargetRecord {
  readonly schemaVersion: 1;
  readonly toolId: string;
  readonly assets: readonly LocalToolAssetRecord[];
  readonly cleanupPendingRelativePaths?: readonly string[];
  readonly updatedAt: string;
  readonly lastLifecycleJobId: string;
}

export interface LocalToolTargetInspection {
  readonly toolId: string;
  readonly assetId?: string;
  readonly label: string;
  readonly installState: LocalToolInstallState;
  readonly enabled: boolean;
  readonly healthy: boolean;
  readonly routable: boolean;
  readonly activeVersion?: string;
  readonly desiredVersion: string;
  readonly manifestSha256?: string;
  readonly platform: "macos" | "windows" | "linux";
  readonly architecture: "arm64" | "x64";
  readonly capabilities: readonly string[];
  readonly license: LocalToolLicenseIdentity;
  readonly sizeBytes?: number;
}

export interface LocalToolInspection extends LocalToolTargetInspection {
  readonly assets: readonly LocalToolTargetInspection[];
  readonly routedCapabilities: readonly string[];
}

export interface LocalToolHealthResult {
  readonly toolId: string;
  readonly installState: LocalToolInstallState;
  readonly enabled: boolean;
  readonly healthy: boolean;
  readonly routable: boolean;
  readonly assets: readonly Pick<
    LocalToolTargetInspection,
    "assetId" | "installState" | "enabled" | "healthy" | "routable" | "activeVersion"
  >[];
}

export interface LocalToolAuthorityRequest {
  readonly requestId: string;
  readonly userOrigin: string;
  readonly actorType: "local_tool";
  readonly action: LocalToolLifecycleAction;
  readonly toolId: string;
  readonly assetId?: string;
  readonly version?: string;
  readonly enabled?: boolean;
  readonly capability: "install_local_tool";
  readonly resourceScope: "current_action";
}

export interface LocalToolAuthorityPort {
  assertAuthorized(request: LocalToolAuthorityRequest): void;
}

export interface LocalToolLifecycleJobRecorder {
  findByRequestId(requestId: string): JobRecordSnapshot | undefined;
  claimByRequestId(job: JobRecord): {
    readonly snapshot: JobRecordSnapshot;
    readonly created: boolean;
  };
  compareAndSwap(snapshot: JobRecordSnapshot, next: JobRecord): JobRecordSnapshot;
}

export function localToolRequestIdFromJob(job: JobRecord): string {
  const requestId = job.inputRefs?.find((ref) => ref.role === "local_tool_request")?.id;
  if (!requestId || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/u.test(requestId)) {
    throw new PigeDomainError("job.record_invalid", "The Local Tool Job request identity is missing or invalid.");
  }
  return requestId;
}

export function localToolTargetRefId(toolId: string, assetId?: string, version?: string): string {
  return [toolId, assetId ?? "engine", version ?? "active"].join(":");
}

export function localToolRequestFingerprint(
  action: LocalToolLifecycleAction,
  request: LocalToolMutationIdentity
): string {
  const extended = request as LocalToolMutationIdentity & {
    readonly enabled?: boolean;
    readonly expectedSha256?: string;
  };
  const payload = JSON.stringify({
    action,
    toolId: request.toolId,
    assetId: request.assetId ?? null,
    version: request.version ?? null,
    enabled: extended.enabled ?? null,
    expectedSha256: extended.expectedSha256 ?? null
  });
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

export function localToolJobInputRefs(
  action: LocalToolLifecycleAction,
  request: LocalToolMutationIdentity
): JobRef[] {
  return [
    { kind: "tool", id: request.requestId, role: "local_tool_request" },
    { kind: "tool", id: action, role: "local_tool_action" },
    { kind: "tool", id: localToolTargetRefId(request.toolId, request.assetId, request.version), role: "local_tool_target" },
    { kind: "tool", id: localToolRequestFingerprint(action, request), role: "local_tool_parameters" }
  ];
}

export function localToolEffectRef(
  action: LocalToolLifecycleAction,
  request: LocalToolMutationIdentity
): JobRef {
  return {
    kind: "tool",
    id: localToolTargetRefId(request.toolId, request.assetId, request.version),
    checksum: localToolRequestFingerprint(action, request),
    role: `local_tool_${action}_effect`
  };
}

export function hasExactLocalToolJobRef(refs: readonly JobRef[] | undefined, expected: JobRef): boolean {
  return refs?.some((ref) => ref.kind === expected.kind && ref.id === expected.id &&
    ref.checksum === expected.checksum && ref.role === expected.role) === true;
}

export function localToolRequestEnabledValue(request: LocalToolMutationIdentity): boolean | undefined {
  const value = (request as LocalToolMutationIdentity & { readonly enabled?: boolean }).enabled;
  return typeof value === "boolean" ? value : undefined;
}

export function localToolOutputRef(request: LocalToolMutationIdentity, checksum: string): JobRef {
  return {
    kind: "tool",
    id: localToolTargetRefId(request.toolId, request.assetId, request.version),
    checksum,
    role: "local_tool_active_version"
  };
}

export function localToolCleanupPendingWarning() {
  return {
    code: "settings.local_tool_cleanup_pending",
    domain: "settings" as const,
    messageKey: "error.settings.local_tool_cleanup_pending"
  };
}

export function createLocalToolJobId(now: string): string {
  return `job_${now.slice(0, 10).replaceAll("-", "")}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function localToolUserActor() {
  return {
    kind: "user" as const,
    runtimeKind: "desktop_local" as const,
    clientCapabilityTier: "desktop_full" as const
  };
}

export interface LocalToolSelfTestRequest {
  readonly toolId: string;
  readonly assetId?: string;
  readonly version: string;
  readonly stagedRootPath: string;
  readonly manifest: LocalToolPackageManifest;
  readonly networkAllowed: false;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface LocalToolSelfTestResult {
  readonly schemaVersion: 1;
  readonly passed: boolean;
  readonly outputBytes: number;
  readonly messageCode: string;
}

export interface LocalToolSelfTestPort {
  run(request: LocalToolSelfTestRequest): Promise<LocalToolSelfTestResult>;
}

export interface LocalToolFaultInjector {
  (point: LocalToolFailurePoint): void;
}

export interface LocalToolMutationIdentity {
  readonly requestId: string;
  readonly userOrigin: string;
  readonly toolId: string;
  readonly assetId?: string;
  readonly version?: string;
}

export interface LocalToolCandidateActionRequest extends LocalToolMutationIdentity {
  readonly version: string;
  readonly candidatePath: string;
  readonly expectedSha256: string;
}

export interface LocalToolSetEnabledRequest extends LocalToolMutationIdentity {
  readonly enabled: boolean;
}

export type LocalToolTargetActionRequest = LocalToolMutationIdentity;

export interface LocalToolRecoveryRequest {
  readonly requestId: string;
  readonly userOrigin: string;
}

export interface LocalToolLifecycleResult {
  readonly job: JobRecord;
  readonly inspection?: LocalToolInspection;
  readonly idempotent: boolean;
}

export interface LocalToolRecoveryResult extends LocalToolLifecycleResult {
  readonly recoveredEntries: number;
}
