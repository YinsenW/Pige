import type { PigeClientCapabilityTier, PigeRuntimeKind } from "@pige/domain";
import type {
  AgentAttachmentCandidate,
  AgentSubmitTurnIpcPayload,
  AgentSubmitTurnRequest,
  BoundaryVerification,
  CaptureFileRejection,
  CaptureFileRejectionReason,
  CloudBoundary,
  CloudSendPolicy,
  ChangeOperation,
  ConfirmationProposal,
  DatasetLogicalType,
  HighRiskConfirmationChangedEvent,
  HighRiskConfirmationPendingResult,
  HighRiskConfirmationResolveRequest,
  HighRiskConfirmationResolveResult,
  Locale,
  JobClass,
  JobRecord,
  JobStage,
  JobState,
  MarkdownPageStatus,
  MarkdownPageType,
  ModelListStrategy,
  NoteRenderContextId,
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult,
  PigeErrorSummary,
  ProposalState,
  ProposalTrustLevel,
  ReaderSelectionActionRequest,
  ReaderSelectionActionResult,
  ReaderSelectionReadAction,
  ReaderSelectionTransformAction,
  ReaderSelectionTransformRequest,
  ReaderSelectionTransformResult,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalDecisionResult,
  ReaderSelectionProposalGetRequest,
  ReaderSelectionProposalGetResult,
  ReaderSelectionProposalPreview,
  ReaderSelectionResolveRequest,
  ReaderSelectionResolveResult,
  ProviderAuthRequirement,
  ProviderEndpointProtocol,
  ProviderKind,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSearchResultItem,
  RetrievalSearchScope,
  SpeechAvailabilityRequest,
  SpeechAvailabilityResult,
  SpeechAssetInstallationId,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  SpeechAssetRequestId,
  SpeechCancelRequest,
  SpeechCancelResult,
  SpeechOpenSystemSettingsResult,
  SpeechSessionEvent,
  SpeechSessionRequest,
  SpeechStartRequest,
  SpeechStartResult,
  SpeechStopResult,
  SkillDisableRequest,
  SkillRegistryQueryResult,
  SkillRegistryMutationResult,
  SkillRegistrySummary,
  SettingApplyBehavior,
  SettingPermissionRequirement,
  SettingScope,
  SourceKind,
  SourceAssetRootKind,
  SourceStorageStrategy,
  VaultRevealResult,
  VaultRevealTarget,
  WindowLayoutMode,
  WindowLayoutRequest,
  WindowLayoutState
} from "@pige/schemas";

export type {
  AgentAttachmentCandidate,
  AgentSubmitTurnIpcPayload,
  AgentSubmitTurnRequest,
  CaptureFileRejection,
  CaptureFileRejectionReason,
  DiagnosticError,
  PigeError,
  PigeErrorAction,
  PigeErrorDomain,
  PigeErrorSeverity,
  PigeErrorSummary,
  PigeWarning,
  HighRiskConfirmationAction,
  HighRiskConfirmationChangedEvent,
  HighRiskConfirmationId,
  HighRiskConfirmationOwner,
  HighRiskConfirmationPendingResult,
  HighRiskConfirmationResolveRequest,
  HighRiskConfirmationResolveResult,
  HighRiskConfirmationSummary,
  HighRiskConfirmationSubject,
  HighRiskConfirmationTarget,
  HighRiskEffect,
  RendererSafeSubjectLabel,
  VaultRevealResult,
  VaultRevealTarget,
  NoteInlineReferenceTarget,
  NoteInlineReferenceRequestId,
  NoteRenderContextId,
  NoteResolveInlineReferenceRequest,
  NoteResolveInlineReferenceResult,
  ReaderSelectionEndpoint,
  ReaderSelectionActionRequest,
  ReaderSelectionActionRequestId,
  ReaderSelectionActionResult,
  ReaderSelectionIdentity,
  ReaderSelectionReadAction,
  ReaderSelectionTransformAction,
  ReaderSelectionTransformRequest,
  ReaderSelectionTransformResult,
  ReaderSelectionProposalDecisionRequest,
  ReaderSelectionProposalDecisionResult,
  ReaderSelectionProposalGetRequest,
  ReaderSelectionProposalGetResult,
  ReaderSelectionProposalPreview,
  ReaderSelectionRequestId,
  ReaderSelectionResolveRequest,
  ReaderSelectionResolveResult,
  ReaderSelectionSegmentId,
  ReaderSelectionUtf8ByteSpan,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSearchResultItem,
  RetrievalSearchScope,
  SpeechAvailabilityRequest,
  SpeechAvailabilityResult,
  SpeechAssetInstallationId,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  SpeechAssetRequestId,
  SpeechCancelRequest,
  SpeechCancelResult,
  SpeechOpenSystemSettingsResult,
  SpeechSessionEvent,
  SpeechSessionRequest,
  SpeechStartRequest,
  SpeechStartResult,
  SpeechStopResult,
  SkillCapability,
  SkillDataBoundary,
  SkillDisableRequest,
  SkillRegistryQueryResult,
  SkillKind,
  SkillRegistryMutationResult,
  SkillRegistrySummary,
  SkillScope,
  SkillSummary,
  SkillTrust,
  WindowLayoutRequest,
  WindowLayoutState
} from "@pige/schemas";

export interface AppHealth {
  readonly status: "ok";
  readonly appVersion: string;
  readonly checkedAt: string;
}

export interface VaultCounts {
  readonly notes: number;
  readonly sources: number;
  readonly managedSourceCopies: number;
  readonly referencedOriginals: number;
}

export interface VaultSummary {
  readonly vaultId: string;
  readonly name: string;
  readonly activeVaultPathDisplay: string;
  readonly knowledgeRootDisplay: string;
  readonly sourceAssetRootDisplay: string;
  readonly sourceAssetRootKind: SourceAssetRootKind;
  readonly defaultSourceStorageStrategy: SourceStorageStrategy;
  readonly schemaVersion: number;
  readonly counts?: VaultCounts;
  readonly lastBackupAt?: string;
}

export interface RecentVaultSummary {
  readonly vaultId: string;
  readonly name: string;
  readonly pathDisplay: string;
  readonly schemaVersion: number;
  readonly lastOpenedAt: string;
}

export interface OnboardingStatus {
  readonly state: "blocked_no_vault" | "ready";
  readonly activeVault?: VaultSummary;
  readonly hasDefaultModel: boolean;
  readonly showFirstHomeGuide: boolean;
  readonly waitingDependencyCounts?: {
    readonly modelProvider: number;
    readonly localTool: number;
    readonly localModel: number;
    readonly runtimeCapability: number;
    readonly vaultBinding: number;
    readonly externalSource: number;
  };
}

export interface AgentRuntimePolicyContext {
  readonly schemaVersion: 1;
  readonly policyContextId: string;
  readonly builtAt: string;
  readonly jobId: string;
  readonly policyHash: string;
  readonly vaultId: string;
  readonly sourceStorage: {
    readonly defaultStrategy: SourceStorageStrategy;
    readonly sourceAssetRootKind: SourceAssetRootKind;
    readonly allowPerCaptureOverride: boolean;
    readonly linkStrategyEnabled: false;
  };
  readonly model: {
    readonly defaultModelProfileId?: string;
    readonly modelConfigured: boolean;
    readonly cloudBoundary: "cloud" | "self_hosted" | "local" | "unknown";
    readonly boundaryVerification: BoundaryVerification;
    readonly cloudSendPolicy: CloudSendPolicy;
    readonly modelRoutingMode: "default_model_only" | "pi_upstream_model_slots" | "pige_model_routing_service";
  };
  readonly language: {
    readonly appLocale: Locale;
    readonly generatedKnowledgeLanguage: "preserve_source" | "follow_query" | "app_locale";
    readonly preserveSourceLanguage: boolean;
    readonly ocrLanguageHints: readonly string[];
    readonly voiceInputLanguage?: string;
  };
  readonly confirmation: {
    readonly safeAutoApplyThreshold: number;
    readonly mutatingReviewThreshold: number;
    readonly riskyChangeRequiresConfirmation: boolean;
  };
  readonly memory: {
    readonly vaultMemoryEnabled: boolean;
    readonly allowedMemoryScopes: readonly ("preference" | "correction" | "workflow_lesson" | "profile")[];
    readonly includeMemoryInBackup: boolean;
  };
  readonly retrieval: {
    readonly lexicalSearchAvailable: boolean;
    readonly vectorSearchAvailable: boolean;
    readonly rerankerAvailable: boolean;
    readonly maxSnippetsForCloudSynthesis: number;
  };
  readonly localCapabilities: {
    readonly localDatabase: "not_initialized" | "ready" | "needs_rebuild" | "error";
    readonly parserToolchainReady: boolean;
    readonly ocrEngines: readonly ("apple_vision" | "windows_ai" | "paddleocr")[];
    readonly speechInputAvailable: boolean;
    readonly embeddingModelInstalled: boolean;
    readonly hiddenDownloadsAllowed: false;
  };
}

export interface AgentRuntimeStatus {
  readonly runtimeKind: PigeRuntimeKind;
  readonly clientCapabilityTier: PigeClientCapabilityTier;
  readonly adapterMode: "phase_1_stub" | "embedded_pi_sdk" | "rpc_json" | "development_cli";
  readonly state: "blocked_no_vault" | "waiting_for_model" | "ready";
  readonly canRunModelJobs: boolean;
  readonly missingDependencies: readonly ("vault" | "default_model")[];
  readonly defaultModelProfileId?: string;
  readonly policySnapshot?: {
    readonly policyContextId: string;
    readonly policyHash: string;
    readonly builtAt: string;
    readonly vaultId: string;
    readonly cloudBoundary: AgentRuntimePolicyContext["model"]["cloudBoundary"];
    readonly boundaryVerification: AgentRuntimePolicyContext["model"]["boundaryVerification"];
    readonly localDatabase: AgentRuntimePolicyContext["localCapabilities"]["localDatabase"];
  };
}

export interface DiagnosticsHealth {
  readonly status: "ok" | "degraded";
  readonly checkedAt: string;
  readonly localOnly: true;
  readonly recentErrorCount: number;
  readonly checks: readonly {
    readonly id: string;
    readonly status: "ok" | "warning" | "error";
    readonly message: string;
  }[];
}

export interface SupportBundleCategory {
  readonly id: string;
  readonly label: string;
  readonly included: boolean;
  readonly reason: string;
}

export interface SupportBundlePreview {
  readonly previewId: string;
  readonly generatedAt: string;
  readonly localOnly: true;
  readonly estimatedBytes: number;
  readonly includedCategories: readonly SupportBundleCategory[];
  readonly excludedCategories: readonly SupportBundleCategory[];
  readonly privacyWarnings: readonly string[];
}

export interface SupportBundleExportResult {
  readonly status: "exported" | "canceled";
  readonly exportedAt?: string;
  readonly outputPath?: string;
  readonly bytesWritten?: number;
}

export interface ExportSupportBundleRequest {
  readonly previewId: string;
  readonly exportRequestId: string;
}

export interface CancelSupportBundleExportRequest {
  readonly exportRequestId: string;
}

export interface CancelSupportBundleExportResult {
  readonly status: "cancel_requested" | "not_found";
}

export interface LocalDatabaseResetResult {
  readonly resetAt: string;
  readonly removedRoots: readonly string[];
  readonly recreatedRoots: readonly string[];
}

export interface LocalDatabaseRebuildResult {
  readonly rebuiltAt: string;
  readonly pageCount: number;
  readonly invalidPageCount: number;
  readonly jobId?: string;
  readonly state?: JobState;
}

export interface LocalDatabaseStatus {
  readonly driver: "pending_sqlite_driver" | "better_sqlite3" | "node_sqlite";
  readonly appSchemaVersion: number;
  readonly appliedMigrationCount: number;
  readonly status: "not_initialized" | "ready" | "needs_rebuild" | "error";
  readonly updatedAt: string;
}

export interface ProviderProfileSummary {
  readonly id: string;
  readonly presetId?: string;
  readonly displayName: string;
  readonly providerKind: ProviderKind;
  readonly endpointProtocol: ProviderEndpointProtocol;
  readonly authRequirement: ProviderAuthRequirement;
  readonly baseUrl?: string;
  readonly modelListStrategy: ModelListStrategy;
  readonly cloudBoundary: CloudBoundary;
  readonly boundaryVerification?: BoundaryVerification;
  readonly runtimeStatus?: ProviderRuntimeStatusSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProviderRuntimeStatusSummary {
  readonly discovery: "not_checked" | "verified";
  readonly generation: "not_checked" | "verified" | "failed";
  readonly updatedAt?: string;
}

export interface ProviderPresetSummary {
  readonly presetId: string;
  readonly displayName: string;
  readonly providerKind: ProviderKind;
  readonly endpointProtocol: ProviderEndpointProtocol;
  readonly authRequirement: ProviderAuthRequirement;
  readonly fixedBaseUrl: string;
  readonly modelListStrategy: ModelListStrategy;
  readonly cloudBoundary: CloudBoundary;
  readonly apiKeyManagementUrl?: string;
}

export interface ModelProfileSummary {
  readonly id: string;
  readonly providerProfileId: string;
  readonly modelId: string;
  readonly displayName?: string;
  readonly source: "provider_list" | "manual";
  readonly enabled: boolean;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ModelProviderSettingsSummary {
  readonly revision?: string;
  readonly presets: readonly ProviderPresetSummary[];
  readonly providers: readonly ProviderProfileSummary[];
  readonly models: readonly ModelProfileSummary[];
  readonly defaultModelProfileId?: string;
  readonly hasDefaultModel: boolean;
  readonly defaultBinding: DefaultModelBindingSummary;
}

export interface ProviderConnectNeedsManualModel {
  readonly status: "needs_manual_model";
  readonly reason: "select_bootstrap_model" | "discovery_unavailable" | "discovery_failed";
  readonly discoveredModels: readonly {
    readonly modelId: string;
    readonly displayName?: string;
  }[];
  readonly error?: PigeErrorSummary;
}

export type ProviderConnectResult = ModelProviderSettingsSummary | ProviderConnectNeedsManualModel;

export type DefaultModelBindingSummary =
  | { readonly state: "not_configured" }
  | {
      readonly state: "ready";
      readonly providerProfileId: string;
      readonly modelProfileId: string;
    }
  | {
      readonly state: "configured_unusable";
      readonly providerProfileId?: string;
      readonly modelProfileId?: string;
      readonly error: PigeErrorSummary;
    };

export interface AddPresetProviderRequest {
  readonly presetId: string;
  readonly apiKey?: string;
}

export interface AddManualProviderRequest {
  readonly displayName: string;
  readonly providerKind: ProviderKind;
  readonly endpointProtocol: ProviderEndpointProtocol;
  readonly baseUrl?: string;
  readonly apiKey: string;
  readonly manualModelId?: string;
  readonly cloudBoundary: CloudBoundary;
}

export interface SetDefaultModelRequest {
  readonly modelProfileId: string;
}

export interface RefreshProviderModelsRequest {
  readonly providerProfileId: string;
}

export interface UpdateProviderCredentialRequest {
  readonly providerProfileId: string;
  readonly expectedRevision: string;
  readonly apiKey: string;
}

export interface DeleteProviderRequest {
  readonly providerProfileId: string;
  readonly expectedRevision: string;
}

export interface AddManualModelRequest {
  readonly providerProfileId: string;
  readonly modelId: string;
  readonly displayName?: string;
}

export interface UpdateModelRequest {
  readonly modelProfileId: string;
  readonly enabled?: boolean;
  readonly displayName?: string | null;
}

export interface SettingRegistryEntry {
  readonly key: string;
  readonly page: string;
  readonly scope: SettingScope;
  readonly owner: string;
  readonly storage: string;
  readonly backedUpByDefault: boolean;
  readonly applyBehavior: SettingApplyBehavior;
  readonly permissionRequirement: SettingPermissionRequirement;
  readonly agentPolicyEffect?: string;
}

export interface SettingsRegistrySummary {
  readonly entries: readonly SettingRegistryEntry[];
}

export interface AppearanceSettingsSummary {
  readonly locale: Locale;
  readonly availableLocales: readonly Locale[];
}

export interface SetLocaleRequest {
  readonly locale: Locale;
}

export type UpdateChannel = "alpha";
export type UpdateCapability = "development" | "unsupported_platform" | "packaged_ready";
export type UpdatePhase = "idle" | "checking" | "up_to_date" | "available" | "failed";

export type UpdateSummary = {
  readonly apiVersion: 1;
  readonly revision: number;
  readonly channel: UpdateChannel;
  readonly capability: UpdateCapability;
  readonly currentVersion: string;
} & (
  | { readonly phase: "idle" | "checking" }
  | { readonly phase: "up_to_date" | "failed"; readonly checkedAt: string }
  | { readonly phase: "available"; readonly availableVersion: string; readonly checkedAt: string }
);

export interface UpdateCheckRequest {
  readonly apiVersion: 1;
  readonly requestId: string;
}

export interface UpdateCheckResult {
  readonly status: "checked" | "unavailable" | "busy" | "stale";
  readonly requestId: string;
  readonly summary: UpdateSummary;
}

export interface UpdateStatusEvent {
  readonly apiVersion: 1;
  readonly requestId: string;
  readonly sequence: number;
  readonly summary: UpdateSummary;
}

export type CaptureUserIntent = "capture" | "ask" | "unknown";

export interface SubmitFilesCaptureRequest {
  readonly filePaths: readonly string[];
  readonly inputKind: "file_drop" | "file_picker";
  readonly userIntent: CaptureUserIntent;
  readonly locale: Locale;
}

export interface CaptureFilesSubmitResult {
  readonly status: "queued" | "partially_queued" | "rejected";
  readonly captureId: string;
  readonly sourceIds: readonly string[];
  readonly jobIds: readonly string[];
  readonly conversationEventIds: readonly string[];
  readonly rejectedFiles: readonly CaptureFileRejection[];
  readonly preservedAt: string;
}

export interface JobsListRequest {
  readonly limit?: number;
  readonly states?: readonly JobState[];
  readonly classes?: readonly JobClass[];
}

export interface JobSummary {
  readonly id: string;
  readonly class: JobClass;
  readonly state: JobState;
  readonly stage?: JobStage;
  readonly progress?: JobRecord["progress"];
  readonly sourceId?: string;
  readonly captureId?: string;
  readonly conversationEventId?: string;
  readonly sourceDisplayName?: string;
  readonly sourceKind?: SourceKind;
  readonly backupKind?: "user_backup" | "restore_rollback";
  readonly error?: PigeErrorSummary;
  readonly message: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JobsListResult {
  readonly scannedAt: string;
  readonly activeVaultId: string;
  readonly total: number;
  readonly invalidJobCount: number;
  readonly jobs: readonly JobSummary[];
}

export interface JobActionRequest {
  readonly jobId: string;
}

export interface JobActionResult {
  readonly status: "cancel_requested" | "cancelled" | "requeued" | "not_found" | "not_allowed";
  readonly reason?: string;
  readonly job?: JobSummary;
}

export interface KnowledgeActivityListRequest {
  readonly limit?: number;
}

export type KnowledgeActivityUndoUnavailableReason =
  | "already_undone"
  | "content_changed"
  | "legacy_record"
  | "target_missing";

export interface KnowledgeActivityPageTarget {
  readonly kind: "page";
  readonly pageId: string;
}

export interface KnowledgeActivitySummary {
  readonly operationId: string;
  readonly kind: "create_page" | "update_page";
  readonly createdAt: string;
  readonly targetLabel?: string;
  readonly target?: KnowledgeActivityPageTarget;
  readonly status: "applied" | "undone";
  readonly canUndo: boolean;
  readonly undoUnavailableReason?: KnowledgeActivityUndoUnavailableReason;
}

export interface KnowledgeActivityListResult {
  readonly scannedAt: string;
  readonly activeVaultId: string;
  readonly total: number;
  readonly invalidOperationCount: number;
  readonly activities: readonly KnowledgeActivitySummary[];
}

export interface KnowledgeActivityUndoRequest {
  readonly operationId: string;
}

export interface KnowledgeActivityUndoResult {
  readonly status: "undone" | "already_undone";
  readonly operationId: string;
  readonly undoOperationId: string;
}

export interface ProposalsListRequest {
  readonly limit?: number;
  readonly states?: readonly ProposalState[];
}

export interface ProposalSummary {
  readonly id: string;
  readonly state: ProposalState;
  readonly trustLevel: ProposalTrustLevel;
  readonly jobId?: string;
  readonly summary: string;
  readonly reason: string;
  readonly operationCount: number;
  readonly warningCount: number;
  readonly targetCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProposalsListResult {
  readonly scannedAt: string;
  readonly activeVaultId: string;
  readonly total: number;
  readonly invalidProposalCount: number;
  readonly proposals: readonly ProposalSummary[];
}

export interface ProposalGetRequest {
  readonly proposalId: string;
}

export interface ProposalGetResult {
  readonly proposal: ConfirmationProposal;
}

export interface StageProposalRequest {
  readonly jobId?: string;
  readonly trustLevel: ProposalTrustLevel;
  readonly summary: string;
  readonly reason: string;
  readonly sourceRefs?: ConfirmationProposal["sourceRefs"];
  readonly targetRefs?: ConfirmationProposal["targetRefs"];
  readonly proposedOperations: readonly ChangeOperation[];
  readonly diffRefs?: ConfirmationProposal["diffRefs"];
  readonly warnings?: readonly string[];
  readonly baseHashes?: Record<string, string>;
}

export interface StageProposalResult {
  readonly proposal: ConfirmationProposal;
}

export interface ProposalDecisionRequest {
  readonly proposalId: string;
  readonly reason?: string;
}

export interface ProposalDecisionResult {
  readonly status: "approved" | "applied" | "rejected" | "conflicted" | "not_found" | "not_allowed";
  readonly reason?: string;
  readonly proposal?: ConfirmationProposal;
}

export interface LibraryListRequest {
  readonly limit?: number;
  readonly pageTypes?: readonly MarkdownPageType[];
}

export interface LibraryPageSummary {
  readonly pageId: string;
  readonly title: string;
  readonly pageType: MarkdownPageType;
  readonly status: MarkdownPageStatus;
  readonly pagePath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly language?: string;
  readonly sourceIds: readonly string[];
}

export interface LibraryListResult {
  readonly scannedAt: string;
  readonly activeVaultId: string;
  readonly total: number;
  readonly invalidPageCount: number;
  readonly pages: readonly LibraryPageSummary[];
}

export type KnowledgeTreeNodeKind = "domain" | "topic" | "concept" | "source";

export interface KnowledgeTreeNavigation {
  readonly pageId: string;
  readonly pagePath: string;
}

export interface KnowledgeTreePageRef extends KnowledgeTreeNavigation {
  readonly title: string;
  readonly pageType: LibraryPageSummary["pageType"];
  readonly status: LibraryPageSummary["status"];
  readonly sourceIds: readonly string[];
}

export interface KnowledgeTreeMetrics {
  readonly structuralPageCount: number;
  readonly fragmentPageCount: number;
  readonly sourceCount: number;
  readonly leafCount: number;
  readonly weight: number;
}

export interface KnowledgeTreeNode {
  readonly id: string;
  readonly kind: KnowledgeTreeNodeKind;
  readonly title: string;
  readonly synthetic?: true;
  readonly pageType?: LibraryPageSummary["pageType"];
  readonly status?: LibraryPageSummary["status"];
  readonly navigation?: KnowledgeTreeNavigation;
  readonly sourceId?: string;
  readonly relatedParentPageIds: readonly string[];
  readonly pageRefs: readonly KnowledgeTreePageRef[];
  readonly sourceRefs: readonly string[];
  readonly metrics: KnowledgeTreeMetrics;
  readonly children: readonly KnowledgeTreeNode[];
}

export interface KnowledgeTreeSnapshot {
  readonly schemaVersion: 1;
  readonly state: "empty" | "ready";
  readonly invalidPageCount: number;
  readonly totals: {
    readonly pageCount: number;
    readonly topicCount: number;
    readonly conceptCount: number;
    readonly fragmentPageCount: number;
    readonly sourceCount: number;
    readonly leafCount: number;
  };
  readonly roots: readonly KnowledgeTreeNode[];
}

export interface KnowledgeTreeResult extends KnowledgeTreeSnapshot {
  readonly queriedAt: string;
  readonly activeVaultId: string;
  readonly degraded: boolean;
  readonly degradedReason?: "local_database_not_ready";
}

export interface LibraryRelatedRequest {
  readonly pageId: string;
  readonly limit?: number;
}

export interface LibraryRelatedPage {
  readonly summary: LibraryPageSummary;
  readonly relation: "outgoing" | "backlink";
  readonly target: string;
}

export interface LibraryRelatedResult {
  readonly queriedAt: string;
  readonly activeVaultId: string;
  readonly pageId: string;
  readonly totalOutgoing: number;
  readonly totalBacklinks: number;
  readonly invalidPageCount: number;
  readonly outgoing: readonly LibraryRelatedPage[];
  readonly backlinks: readonly LibraryRelatedPage[];
  readonly degraded: boolean;
  readonly degradedReason?: "local_database_not_ready";
}

export interface NoteGetRequest {
  readonly pageId: string;
}

export type NoteRenderRequest = NoteGetRequest;

export interface NoteDocument {
  readonly summary: LibraryPageSummary;
  readonly markdownBody: string;
  readonly byteSize: number;
}

export interface NoteRenderResult {
  readonly summary: LibraryPageSummary;
  readonly html: string;
  readonly byteSize: number;
  readonly renderContextId?: NoteRenderContextId;
}

export type RetrievalAnswerWarning =
  | "insufficient_evidence"
  | "limited_evidence"
  | "local_extractive_only"
  | "search_degraded";

export interface RetrievalAnswerCitation {
  readonly refId: string;
  readonly label: string;
  readonly pageId: string;
  readonly title: string;
  readonly pageType: MarkdownPageType;
  readonly locator: string;
}

export type DatasetQueryScalar = string | number | boolean | null;

export interface DatasetEvidenceRef {
  readonly datasetId: string;
  readonly revisionId: string;
  readonly tableId: string;
  readonly schemaId: string;
  readonly columnIds: readonly string[];
  readonly rowIds?: readonly string[] | undefined;
  readonly range?: {
    readonly startRow: number;
    readonly endRow: number;
  } | undefined;
  readonly queryPlanHash: string;
  readonly resultHash: string;
  readonly sourceId: string;
  readonly sourceRevisionHash: string;
}

export interface DatasetAnswerCitation {
  readonly kind: "dataset";
  readonly refId: string;
  readonly label: string;
  readonly title: string;
  readonly locator: string;
  readonly evidence: DatasetEvidenceRef;
}

export type AgentAnswerCitation = RetrievalAnswerCitation | DatasetAnswerCitation;

export interface DatasetQueryPreviewColumn {
  readonly key: string;
  readonly label: string;
  readonly logicalType: DatasetLogicalType;
  readonly sourceColumnId?: string | undefined;
  readonly aggregate?: string | undefined;
}

export interface DatasetQueryPreviewRow {
  readonly rowId?: string | undefined;
  readonly values: readonly DatasetQueryScalar[];
}

export interface DatasetQueryPreview {
  readonly datasetId: string;
  readonly revisionId: string;
  readonly tableId: string;
  readonly tableName: string;
  readonly planHash: string;
  readonly resultHash: string;
  readonly columns: readonly DatasetQueryPreviewColumn[];
  readonly rows: readonly DatasetQueryPreviewRow[];
  readonly matchedRowCount: number;
  readonly returnedRowCount: number;
  readonly truncated: boolean;
  readonly citationRefs: readonly string[];
}

export interface RetrievalAskResult extends RetrievalSearchResult {
  readonly answeredAt: string;
  readonly answer: string;
  readonly answerMode: "local_extractive" | "model_grounded";
  readonly confidence: "grounded" | "limited" | "insufficient";
  readonly citations: readonly RetrievalAnswerCitation[];
  readonly warnings: readonly RetrievalAnswerWarning[];
}

export type HomeAgentModelUsage = "none" | "local" | "cloud";

export type AgentTurnInputKind =
  | "typed_text"
  | "pasted_text"
  | "typed_url"
  | "pasted_url"
  | "file_drop"
  | "file_picker"
  | "follow_up";

export type AgentTurnObjective = "auto" | "capture" | "vault_only";

export interface AgentTurnCurrentNoteScope {
  readonly kind: "current_note";
  readonly pageId: string;
}

export type AgentTurnScope = AgentTurnCurrentNoteScope;

export interface AgentTurnAnswer {
  readonly answer: string;
  readonly grounding: "general" | "local_knowledge" | "source" | "insufficient_evidence";
  readonly citations: readonly AgentAnswerCitation[];
  readonly retrieval?: RetrievalSearchResult;
  readonly datasetResult?: DatasetQueryPreview | undefined;
}

export type AgentSubmitTurnResult =
  | {
      readonly requestId: string;
      readonly jobId: string;
      readonly conversationEventId: string;
      readonly conversationId: string;
      readonly tailEventId: string;
      readonly state: "completed";
      readonly modelUsage: HomeAgentModelUsage;
      readonly sourceIds: readonly string[];
      readonly rejectedFiles?: readonly CaptureFileRejection[];
      readonly answer: AgentTurnAnswer;
    }
  | {
      readonly requestId: string;
      readonly jobId: string;
      readonly conversationEventId: string;
      readonly conversationId: string;
      readonly tailEventId: string;
      readonly state: "waiting";
      readonly modelUsage: HomeAgentModelUsage;
      readonly sourceIds: readonly string[];
      readonly rejectedFiles?: readonly CaptureFileRejection[];
      readonly error: PigeErrorSummary;
    }
  | {
      readonly requestId: string;
      readonly jobId?: string;
      readonly conversationEventId?: string;
      readonly conversationId?: string;
      readonly tailEventId?: string;
      readonly state: "failed";
      readonly modelUsage: HomeAgentModelUsage;
      readonly sourceIds: readonly string[];
      readonly rejectedFiles?: readonly CaptureFileRejection[];
      readonly error: PigeErrorSummary;
    };

export interface AgentConversationRequest {
  readonly conversationId?: string;
  readonly scope?: AgentTurnScope;
  readonly limit?: number;
}

export interface AgentConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly createdAt: string;
  readonly text: string;
  readonly jobId?: string;
  readonly answer?: AgentTurnAnswer;
  readonly inputPresentation?: AgentConversationInputPresentation;
}

export type AgentConversationInputPresentation =
  | {
      readonly kind: "reader_selection_action";
      readonly action: ReaderSelectionReadAction;
    }
  | {
      readonly kind: "reader_selection_transform";
      readonly action: ReaderSelectionTransformAction;
    };

export interface AgentConversationTurnSummary {
  readonly jobId: string;
  readonly userEventId: string;
  readonly state: JobState;
  readonly error?: PigeErrorSummary;
}

export interface AgentConversationTimeline {
  readonly conversationId: string;
  readonly tailEventId: string;
  readonly canFollowUp: boolean;
  readonly messages: readonly AgentConversationMessage[];
  readonly latestTurn?: AgentConversationTurnSummary;
}

export interface AgentTurnDraftEvent {
  readonly apiVersion: 1;
  readonly kind: "draft_replace";
  readonly requestId: string;
  readonly clientTurnId: string;
  readonly jobId: string;
  readonly conversationId: string;
  readonly conversationEventId: string;
  readonly sequence: number;
  readonly text: string;
}

export interface ToolchainToolStatus {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly status: "ready" | "missing";
  readonly resolvedPath?: string;
  readonly repairHint?: string;
}

export interface ToolchainHealth {
  readonly status: "ready" | "needs_repair";
  readonly checkedAt: string;
  readonly tools: readonly ToolchainToolStatus[];
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export interface WindowState {
  readonly mode: WindowLayoutMode;
  readonly alwaysOnTop: boolean;
  readonly sidebarOpen: boolean;
  readonly isFullScreen: boolean;
  readonly size: WindowSize;
}

export interface SetWindowModeRequest {
  readonly mode: WindowLayoutMode;
}

export interface SetAlwaysOnTopRequest {
  readonly alwaysOnTop: boolean;
}

export interface SetSidebarOpenRequest {
  readonly sidebarOpen: boolean;
}

export interface BackupRestoreStatus {
  readonly phase: "entry_point_only" | "available";
  readonly createAvailable: boolean;
  readonly restoreAvailable: boolean;
  readonly lastBackupAt?: string;
  readonly messageKey: "backup.statusEntryOnly" | "backup.statusReady" | "backup.statusNoVault";
  readonly defaultIncludes: {
    readonly markdownKnowledge: boolean;
    readonly sourceRecords: boolean;
    readonly managedSourceCopies: boolean;
    readonly conversations: boolean;
    readonly vaultMemory: boolean;
    readonly trash: boolean;
    readonly rebuildableDatabaseCache: boolean;
    readonly secrets: boolean;
  };
}

export interface BackupManifestSummary {
  readonly formatVersion: 1;
  readonly format: "pige-backup";
  readonly appVersion: string;
  readonly vaultId: string;
  readonly vaultName: string;
  readonly vaultSchemaVersion: number;
  readonly createdAt: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly noteCount: number;
  readonly sourceCount: number;
  readonly conversationCount: number;
  readonly memoryCount: number;
  readonly includesSecrets: false;
  readonly includes: BackupRestoreStatus["defaultIncludes"];
}

export interface BackupCreateResult {
  readonly status: "created" | "canceled";
  readonly backupPath?: string;
  readonly manifest?: BackupManifestSummary;
}

export type RestoreMode = "clone_as_new" | "replace_existing";

export type RestorePreviewWarning =
  | {
      readonly code: "invalid_archive_entries";
      readonly count: number;
    }
  | {
      readonly code: "excluded_rebuildable_roots";
      readonly count: number;
    }
  | {
      readonly code: "external_originals_not_included";
      readonly count: number;
    };

export type RestorePreviewResult =
  | {
      readonly status: "ready";
      readonly previewId: string;
      readonly manifest: BackupManifestSummary;
      readonly invalidFileCount: number;
      readonly warnings: readonly RestorePreviewWarning[];
      readonly permittedModes: readonly RestoreMode[];
      readonly defaultMode: RestoreMode;
    }
  | {
      readonly status: "canceled";
      readonly previewId?: never;
      readonly manifest?: never;
      readonly invalidFileCount?: never;
      readonly warnings?: never;
      readonly permittedModes?: never;
      readonly defaultMode?: never;
    };

export interface RestoreApplyRequest {
  readonly previewId: string;
  readonly mode: RestoreMode;
}

export type RestoreApplyResult =
  | {
      readonly status: "restored";
      readonly jobId: string;
    }
  | {
      readonly status: "canceled";
      readonly jobId?: never;
    };

export interface CreateVaultRequest {
  readonly vaultName: string;
}

export interface OpenRecentVaultRequest {
  readonly vaultId: string;
}

export interface UpdateSourceStoragePolicyRequest {
  readonly defaultStrategy: SourceStorageStrategy;
}

export type VaultActionResult =
  | {
      readonly status: "completed";
      readonly vault: VaultSummary;
      readonly onboarding: OnboardingStatus;
    }
  | {
      readonly status: "canceled";
    };

export interface PigeDesktopApi {
  readonly getHealth: () => Promise<AppHealth>;
  readonly window: {
    readonly current: () => Promise<WindowState>;
    readonly currentLayout: () => Promise<WindowLayoutState>;
    readonly setLayout: (request: WindowLayoutRequest) => Promise<WindowLayoutState>;
    readonly onLayoutChanged: (listener: (state: WindowLayoutState) => void) => () => void;
    readonly setMode: (request: SetWindowModeRequest) => Promise<WindowState>;
    readonly setAlwaysOnTop: (request: SetAlwaysOnTopRequest) => Promise<WindowState>;
    readonly setSidebarOpen: (request: SetSidebarOpenRequest) => Promise<WindowState>;
  };
  readonly agent: {
    readonly runtimeStatus: () => Promise<AgentRuntimeStatus>;
    readonly submitTurn: (
      request: AgentSubmitTurnRequest,
      files?: readonly File[]
    ) => Promise<AgentSubmitTurnResult>;
    readonly conversation: (
      request?: AgentConversationRequest
    ) => Promise<AgentConversationTimeline | undefined>;
    readonly onTurnDraft: (listener: (event: AgentTurnDraftEvent) => void) => () => void;
  };
  readonly jobs: {
    readonly list: (request?: JobsListRequest) => Promise<JobsListResult>;
    readonly cancel: (request: JobActionRequest) => Promise<JobActionResult>;
    readonly retry: (request: JobActionRequest) => Promise<JobActionResult>;
  };
  readonly confirmations: {
    readonly pending: () => Promise<HighRiskConfirmationPendingResult>;
    readonly resolve: (
      request: HighRiskConfirmationResolveRequest
    ) => Promise<HighRiskConfirmationResolveResult>;
    readonly onChanged: (
      listener: (event: HighRiskConfirmationChangedEvent) => void
    ) => () => void;
  };
  readonly skills: {
    readonly summary: () => Promise<SkillRegistryQueryResult>;
    readonly disable: (request: SkillDisableRequest) => Promise<SkillRegistryMutationResult>;
    readonly onChanged: (listener: (summary: SkillRegistrySummary) => void) => () => void;
  };
  readonly activity: {
    readonly list: (request?: KnowledgeActivityListRequest) => Promise<KnowledgeActivityListResult>;
    readonly undo: (request: KnowledgeActivityUndoRequest) => Promise<KnowledgeActivityUndoResult>;
  };
  readonly proposals: {
    readonly list: (request?: ProposalsListRequest) => Promise<ProposalsListResult>;
    readonly get: (request: ProposalGetRequest) => Promise<ProposalGetResult>;
    readonly approve: (request: ProposalDecisionRequest) => Promise<ProposalDecisionResult>;
    readonly reject: (request: ProposalDecisionRequest) => Promise<ProposalDecisionResult>;
  };
  readonly readerSelection: {
    readonly resolve: (
      request: ReaderSelectionResolveRequest
    ) => Promise<ReaderSelectionResolveResult>;
    readonly submitAction: (
      request: ReaderSelectionActionRequest
    ) => Promise<ReaderSelectionActionResult>;
    readonly submitTransform: (
      request: ReaderSelectionTransformRequest
    ) => Promise<ReaderSelectionTransformResult>;
    readonly currentProposal: (
      request: ReaderSelectionProposalGetRequest
    ) => Promise<ReaderSelectionProposalGetResult>;
    readonly decideProposal: (
      request: ReaderSelectionProposalDecisionRequest
    ) => Promise<ReaderSelectionProposalDecisionResult>;
  };
  readonly library: {
    readonly list: (request?: LibraryListRequest) => Promise<LibraryListResult>;
    readonly tree: () => Promise<KnowledgeTreeResult>;
    readonly related: (request: LibraryRelatedRequest) => Promise<LibraryRelatedResult>;
  };
  readonly notes: {
    readonly get: (request: NoteGetRequest) => Promise<NoteDocument>;
    readonly render: (request: NoteRenderRequest) => Promise<NoteRenderResult>;
    readonly resolveInlineReference: (
      request: NoteResolveInlineReferenceRequest
    ) => Promise<NoteResolveInlineReferenceResult>;
  };
  readonly retrieval: {
    readonly search: (request: RetrievalSearchRequest) => Promise<RetrievalSearchResult>;
  };
  readonly vault: {
    readonly current: () => Promise<VaultSummary | undefined>;
    readonly recent: () => Promise<readonly RecentVaultSummary[]>;
    readonly onboardingStatus: () => Promise<OnboardingStatus>;
    readonly dismissFirstHomeGuide: () => Promise<OnboardingStatus>;
    readonly create: (request: CreateVaultRequest) => Promise<VaultActionResult>;
    readonly open: () => Promise<VaultActionResult>;
    readonly openRecent: (request: OpenRecentVaultRequest) => Promise<VaultActionResult>;
    readonly revealKnowledgeRoot: () => Promise<VaultRevealResult>;
    readonly revealSourceAssetRoot: () => Promise<VaultRevealResult>;
    readonly updateSourceStoragePolicy: (request: UpdateSourceStoragePolicyRequest) => Promise<VaultSummary>;
    readonly removeRecent: (vaultId: string) => Promise<readonly RecentVaultSummary[]>;
  };
  readonly maintenance: {
    readonly rebuildLocalDatabase: () => Promise<LocalDatabaseRebuildResult>;
    readonly resetLocalDatabase: () => Promise<LocalDatabaseResetResult>;
    readonly localDatabaseStatus: () => Promise<LocalDatabaseStatus>;
  };
  readonly diagnostics: {
    readonly health: () => Promise<DiagnosticsHealth>;
    readonly previewSupportBundle: () => Promise<SupportBundlePreview>;
    readonly exportSupportBundle: (request: ExportSupportBundleRequest) => Promise<SupportBundleExportResult>;
    readonly cancelSupportBundleExport: (
      request: CancelSupportBundleExportRequest
    ) => Promise<CancelSupportBundleExportResult>;
  };
  readonly models: {
    readonly summary: () => Promise<ModelProviderSettingsSummary>;
    readonly addPresetProvider: (request: AddPresetProviderRequest) => Promise<ProviderConnectResult>;
    readonly addManualProvider: (request: AddManualProviderRequest) => Promise<ProviderConnectResult>;
    readonly refreshProviderModels: (request: RefreshProviderModelsRequest) => Promise<ModelProviderSettingsSummary>;
    readonly updateProviderCredential: (
      request: UpdateProviderCredentialRequest
    ) => Promise<ModelProviderSettingsSummary>;
    readonly deleteProvider: (request: DeleteProviderRequest) => Promise<ModelProviderSettingsSummary>;
    readonly addManualModel: (request: AddManualModelRequest) => Promise<ModelProviderSettingsSummary>;
    readonly updateModel: (request: UpdateModelRequest) => Promise<ModelProviderSettingsSummary>;
    readonly setDefaultModel: (request: SetDefaultModelRequest) => Promise<ModelProviderSettingsSummary>;
  };
  readonly settings: {
    readonly appearance: () => Promise<AppearanceSettingsSummary>;
    readonly setLocale: (request: SetLocaleRequest) => Promise<AppearanceSettingsSummary>;
    readonly registry: () => Promise<SettingsRegistrySummary>;
  };
  readonly updates: {
    readonly summary: () => Promise<UpdateSummary>;
    readonly check: (request: UpdateCheckRequest) => Promise<UpdateCheckResult>;
    readonly onStatusChanged: (listener: (event: UpdateStatusEvent) => void) => () => void;
  };
  readonly backup: {
    readonly status: () => Promise<BackupRestoreStatus>;
    readonly create: () => Promise<BackupCreateResult>;
    readonly previewRestore: () => Promise<RestorePreviewResult>;
    readonly applyRestore: (request: RestoreApplyRequest) => Promise<RestoreApplyResult>;
  };
  readonly system: {
    readonly toolchainHealth: () => Promise<ToolchainHealth>;
  };
  readonly speech: {
    readonly availability: (request: SpeechAvailabilityRequest) => Promise<SpeechAvailabilityResult>;
    readonly installLanguageAsset: (request: SpeechAssetInstallRequest) => Promise<SpeechAssetInstallResult>;
    readonly start: (request: SpeechStartRequest) => Promise<SpeechStartResult>;
    readonly stop: (request: SpeechSessionRequest) => Promise<SpeechStopResult>;
    readonly cancel: (request: SpeechCancelRequest) => Promise<SpeechCancelResult>;
    readonly openSystemSettings: () => Promise<SpeechOpenSystemSettingsResult>;
    readonly onAssetInstallEvent: (listener: (event: SpeechAssetInstallEvent) => void) => () => void;
    readonly onSessionEvent: (listener: (event: SpeechSessionEvent) => void) => () => void;
  };
}

export interface RuntimeCapabilities {
  readonly runtimeKind: PigeRuntimeKind;
  readonly clientCapabilityTier: PigeClientCapabilityTier;
}
