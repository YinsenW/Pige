import type { JobRecord } from "@pige/schemas";
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
  findByRequestId(requestId: string): JobRecord | undefined;
  write(job: JobRecord): void;
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
