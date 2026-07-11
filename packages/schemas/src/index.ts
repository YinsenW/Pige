import { z } from "zod";
import { PIGE_REQUIREMENT_ID_PATTERN, PIGE_VAULT_ID_PATTERN } from "@pige/domain";

export const RequirementIdSchema = z.string().regex(PIGE_REQUIREMENT_ID_PATTERN);

export const LocaleSchema = z.enum(["zh-Hans", "en", "ja", "ko", "fr", "de"]);

export const VaultIdSchema = z.string().regex(PIGE_VAULT_ID_PATTERN);

// Durable IDs are path-independent vocabulary. Keep these schemas centralized so
// files, jobs, IPC DTOs, migrations, and documentation do not invent aliases.
export const SourceIdSchema = z.string().regex(/^src_\d{8}_[a-z0-9]{8,}$/);
export const PageIdSchema = z.string().regex(/^page_\d{8}_[a-z0-9]{8,}$/);
export const CaptureIdSchema = z.string().regex(/^cap_\d{8}_[a-z0-9]{8,}$/);
export const ConversationIdSchema = z.string().regex(/^conv_\d{8}(?:_[a-z0-9]{4,})?$/);
export const ConversationEventIdSchema = z.string().regex(/^evt_\d{8}_[a-z0-9]{8,}$/);
export const JobIdSchema = z.string().regex(/^job_\d{8}_[a-z0-9]{8,}$/);
export const ProposalIdSchema = z.string().regex(/^proposal_\d{8}_[a-z0-9]{8,}$/);
export const OperationIdSchema = z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/);
export const ArtifactIdSchema = z.string().regex(/^art_[a-z0-9][a-z0-9_]{2,}$/);
export const RootBindingIdSchema = z.string().regex(/^root_[a-z0-9][a-z0-9_]{5,}$/);
export const BackupIdSchema = z.string().regex(/^backup_\d{8}_[a-z0-9]{8,}$/);
export const PermissionRequestIdSchema = z.string().regex(/^permreq_\d{8}_[a-z0-9]{8,}$/);
export const PermissionDecisionIdSchema = z.string().regex(/^permdec_\d{8}_[a-z0-9]{8,}$/);

// Phase 2 URL capture emitted source-derived artifact IDs before `art_` became
// canonical. Sidecar readers retain that legacy identity for compatibility;
// migrations must not silently rename it. New writers use ArtifactIdSchema.
const LegacySourceDerivedArtifactIdSchema = z.string().regex(/^src_\d{8}_[a-z0-9]{8,}_[a-z0-9_]+$/);
const ReadableArtifactIdSchema = z.union([ArtifactIdSchema, LegacySourceDerivedArtifactIdSchema]);

export const SourceStorageStrategySchema = z.enum(["copy_to_source_library", "reference_original"]);

export const SourceAssetRootKindSchema = z.enum(["inside_vault", "external_binding"]);

export const SourceKindSchema = z.enum([
  "text",
  "url",
  "markdown_file",
  "plain_text_file",
  "pdf_file",
  "docx_file",
  "pptx_file",
  "image_file",
  "audio_file",
  "video_file",
  "folder",
  "git_repository",
  "archive",
  "unknown_file"
]);

export const MarkdownPageTypeSchema = z.enum(["source", "note", "concept", "entity", "topic", "claim", "question"]);

export const MarkdownPageStatusSchema = z.enum([
  "active",
  "archived",
  "draft",
  "needs_review",
  "missing_source",
  "conflict"
]);

export const ProviderKindSchema = z.enum([
  "openai",
  "anthropic",
  "openai_compatible",
  "anthropic_compatible",
  "custom"
]);

export const ModelListStrategySchema = z.enum(["list_models", "manual", "failed_then_manual"]);

export const CloudBoundarySchema = z.enum(["cloud", "self_hosted", "local", "unknown"]);

export const BoundaryVerificationSchema = z.enum([
  "builtin_verified",
  "loopback_verified",
  "user_asserted",
  "unknown"
]);

export const CloudSendPolicySchema = z.enum([
  "ordinary_allowed",
  "confirm_private_or_large",
  "confirm_all",
  "local_only"
]);

// API, durable Job, diagnostics, and UI failure surfaces share this vocabulary.
// Keep the safe metadata values scalar so structured errors cannot become an
// accidental path, prompt, provider-response, or source-body transport.
export const PigeErrorDomainSchema = z.enum([
  "vault",
  "capture",
  "source_storage",
  "parser",
  "ocr",
  "rag",
  "model_provider",
  "permission",
  "skill",
  "package",
  "backup",
  "restore",
  "database",
  "settings",
  "update",
  "diagnostics",
  "renderer",
  "release",
  "unknown"
]);

export const PigeErrorActionSchema = z.enum([
  "none",
  "retry",
  "choose_path",
  "repair_tool",
  "download_model",
  "configure_model",
  "grant_permission",
  "review_proposal",
  "rebuild_index",
  "restore_backup",
  "open_settings",
  "contact_support"
]);

export const PigeErrorSeveritySchema = z.enum(["info", "warning", "error", "fatal"]);

export const PigeErrorCodeSchema = z.string()
  .min(3)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,2}$/);

export const PigeMessageKeySchema = z.string()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9_.-]+$/);

const PigeSafeErrorValueSchema = z.union([z.string().max(500), z.number().finite(), z.boolean()]);
export const PigeSafeErrorMetadataSchema = z.record(z.string().min(1).max(80), PigeSafeErrorValueSchema);

const PigeErrorCoreSchema = z.object({
  code: PigeErrorCodeSchema,
  domain: PigeErrorDomainSchema,
  messageKey: PigeMessageKeySchema,
  messageParams: PigeSafeErrorMetadataSchema.optional(),
  retryable: z.boolean(),
  severity: PigeErrorSeveritySchema,
  userAction: PigeErrorActionSchema,
  redactedDetails: PigeSafeErrorMetadataSchema.optional()
});

function requireErrorDomainMatchesCode(
  value: { readonly code: string; readonly domain: string },
  context: z.RefinementCtx
): void {
  const codeDomain = value.code.split(".", 1)[0];
  if (codeDomain !== value.domain) {
    context.addIssue({
      code: "custom",
      message: "Error code namespace must match the declared error domain.",
      path: ["code"]
    });
  }
}

export const PermissionDefaultModeSchema = z.enum([
  "ask_every_time",
  "remember_scoped_grants",
  "yolo_full_access"
]);

export const PermissionActorTypeSchema = z.enum([
  "agent",
  "skill",
  "package",
  "local_tool",
  "model_provider"
]);

export const PermissionCapabilitySchema = z.enum([
  "read_vault",
  "write_vault",
  "delete_vault",
  "external_filesystem",
  "external_network",
  "run_shell",
  "install_package",
  "install_local_tool",
  "call_cloud_model_with_private_or_large_source",
  "use_brokered_credential",
  "change_settings",
  "change_pige_schema",
  "spawn_agent"
]);

export const PermissionResourceScopeSchema = z.enum([
  "current_action",
  "current_source",
  "current_note",
  "current_url",
  "current_domain",
  "current_file",
  "current_folder",
  "current_vault",
  "actor_version",
  "provider_profile",
  "all_declared"
]);

export const PermissionDecisionScopeSchema = z.enum([
  "once",
  "actor_version",
  "resource_scope",
  "profile_default",
  "never"
]);

export const PermissionDataBoundarySchema = z.enum([
  "local",
  "filesystem",
  "network",
  "cloud",
  "brokered_credential",
  "destructive"
]);

export const PermissionRequestSchema = z.object({
  id: PermissionRequestIdSchema,
  schemaVersion: z.literal(1),
  authorizationLayer: z.literal("permission_broker"),
  actorType: PermissionActorTypeSchema,
  actorId: z.string().min(1),
  actorVersion: z.string().min(1).optional(),
  capability: PermissionCapabilitySchema,
  resourceScope: PermissionResourceScopeSchema,
  dataBoundary: PermissionDataBoundarySchema,
  duration: PermissionDecisionScopeSchema,
  jobId: JobIdSchema.optional(),
  runtimeKind: z.enum(["desktop_local", "remote_agent_backend"]),
  clientCapabilityTier: z.enum(["desktop_full", "web_client", "mobile_lite"]),
  requiresExplicitConfirmation: z.boolean(),
  yoloEligible: z.boolean(),
  reason: z.string().min(1),
  commandPreview: z.string().min(1).optional(),
  affectedPaths: z.array(z.string().min(1)).optional(),
  createdAt: z.string().datetime({ offset: true }),
  defaultModeAtRequest: PermissionDefaultModeSchema
}).superRefine((request, context) => {
  if (request.requiresExplicitConfirmation && request.yoloEligible) {
    context.addIssue({
      code: "custom",
      message: "An always-confirmed action cannot be YOLO eligible.",
      path: ["yoloEligible"]
    });
  }
});

export const PermissionDecisionRecordSchema = z.object({
  id: PermissionDecisionIdSchema,
  schemaVersion: z.literal(1),
  authorizationLayer: z.literal("permission_broker"),
  permissionRequestId: PermissionRequestIdSchema,
  decision: z.enum(["deny", "allow_once", "allow_scoped"]),
  scope: PermissionDecisionScopeSchema,
  resourceScope: PermissionResourceScopeSchema,
  decidedBy: z.enum(["user", "system"]),
  autoAllowedBy: z.enum(["none", "saved_grant", "yolo_full_access"]),
  decidedAt: z.string().datetime({ offset: true }),
  reason: z.string().min(1).optional()
}).superRefine((decision, context) => {
  if (decision.decision === "deny" && decision.autoAllowedBy !== "none") {
    context.addIssue({
      code: "custom",
      message: "A denial cannot be auto-allowed.",
      path: ["autoAllowedBy"]
    });
  }
  if (decision.decision === "deny" && decision.scope !== "never") {
    context.addIssue({
      code: "custom",
      message: "A denial must use the never decision scope.",
      path: ["scope"]
    });
  }
  if (decision.decision === "allow_once" && decision.scope !== "once") {
    context.addIssue({
      code: "custom",
      message: "An allow-once decision must use the once decision scope.",
      path: ["scope"]
    });
  }
  if (decision.decision === "allow_scoped" && (decision.scope === "once" || decision.scope === "never")) {
    context.addIssue({
      code: "custom",
      message: "A scoped allow must use actor_version, resource_scope, or profile_default scope.",
      path: ["scope"]
    });
  }
  if (decision.decision === "allow_scoped" && decision.resourceScope === "current_action") {
    context.addIssue({
      code: "custom",
      message: "A persistent scoped allow cannot target only the current action.",
      path: ["resourceScope"]
    });
  }
  if (decision.autoAllowedBy !== "none" && decision.decidedBy !== "system") {
    context.addIssue({
      code: "custom",
      message: "A saved-grant or YOLO auto-allow must be recorded as a system decision.",
      path: ["decidedBy"]
    });
  }
  if (decision.autoAllowedBy !== "none" && decision.decision !== "allow_once") {
    context.addIssue({
      code: "custom",
      message: "An automatic grant authorizes the current request; it must not create another persistent scoped grant.",
      path: ["decision"]
    });
  }
  if (decision.decidedBy === "system" && decision.decision !== "deny" && decision.autoAllowedBy === "none") {
    context.addIssue({
      code: "custom",
      message: "A system allow must identify the saved grant or YOLO mode that authorized it.",
      path: ["autoAllowedBy"]
    });
  }
});

export const ModelEgressContentClassSchema = z.enum([
  "ordinary",
  "private",
  "large",
  "sensitive",
  "restricted"
]);

export const ModelEgressOutcomeSchema = z.enum(["allow", "confirm", "block"]);

export const ModelEgressReasonCodeSchema = z.enum([
  "verified_local",
  "ordinary_external_allowed",
  "private_or_large_confirmation",
  "sensitive_confirmation",
  "confirm_all",
  "unknown_boundary_confirmation",
  "local_only_block",
  "restricted_content_block"
]);

export const ModelEgressDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  outcome: ModelEgressOutcomeSchema,
  reasonCode: ModelEgressReasonCodeSchema,
  providerProfileId: z.string().regex(/^provider_[a-z0-9_]+$/),
  cloudBoundary: CloudBoundarySchema,
  boundaryVerification: BoundaryVerificationSchema,
  cloudSendPolicy: CloudSendPolicySchema,
  contentClasses: z.array(ModelEgressContentClassSchema).min(1).refine(
    (values) => new Set(values).size === values.length,
    "Model egress content classes must be unique."
  ),
  payloadCharacters: z.number().int().nonnegative(),
  estimatedPayloadTokens: z.number().int().nonnegative(),
  normalPayloadCharacterLimit: z.number().int().positive(),
  policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  permissionDecisionId: PermissionDecisionIdSchema.optional()
}).superRefine((decision, context) => {
  const classes = new Set(decision.contentClasses);
  if (classes.has("ordinary") && classes.size > 1) {
    context.addIssue({
      code: "custom",
      message: "ordinary is mutually exclusive with private, large, sensitive, and restricted content.",
      path: ["contentClasses"]
    });
  }
  if (decision.payloadCharacters > decision.normalPayloadCharacterLimit && !classes.has("large")) {
    context.addIssue({
      code: "custom",
      message: "Payloads above the recorded normal character limit must be classified as large.",
      path: ["contentClasses"]
    });
  }
  const verifiedLocal = decision.cloudBoundary === "local" && decision.boundaryVerification === "loopback_verified";
  let expectedOutcome: "allow" | "confirm" | "block";
  let expectedReason:
    | "verified_local"
    | "ordinary_external_allowed"
    | "private_or_large_confirmation"
    | "sensitive_confirmation"
    | "confirm_all"
    | "unknown_boundary_confirmation"
    | "local_only_block"
    | "restricted_content_block";

  if (classes.has("restricted")) {
    expectedOutcome = "block";
    expectedReason = "restricted_content_block";
  } else if (verifiedLocal) {
    expectedOutcome = "allow";
    expectedReason = "verified_local";
  } else if (decision.cloudSendPolicy === "local_only") {
    expectedOutcome = "block";
    expectedReason = "local_only_block";
  } else if (decision.cloudBoundary === "unknown" || decision.cloudBoundary === "local") {
    expectedOutcome = "confirm";
    expectedReason = "unknown_boundary_confirmation";
  } else if (decision.cloudSendPolicy === "confirm_all") {
    expectedOutcome = "confirm";
    expectedReason = "confirm_all";
  } else if (classes.has("sensitive")) {
    expectedOutcome = "confirm";
    expectedReason = "sensitive_confirmation";
  } else if (
    decision.cloudSendPolicy === "confirm_private_or_large" &&
    (classes.has("private") || classes.has("large"))
  ) {
    expectedOutcome = "confirm";
    expectedReason = "private_or_large_confirmation";
  } else {
    expectedOutcome = "allow";
    expectedReason = "ordinary_external_allowed";
  }

  if (decision.outcome !== expectedOutcome) {
    context.addIssue({
      code: "custom",
      message: `Model egress outcome must be ${expectedOutcome} for this boundary and policy.`,
      path: ["outcome"]
    });
  }
  if (decision.reasonCode !== expectedReason) {
    context.addIssue({
      code: "custom",
      message: `Model egress reason must be ${expectedReason} for this boundary and policy.`,
      path: ["reasonCode"]
    });
  }
});

export const WindowLayoutModeSchema = z.enum(["compact", "expanded", "fullscreen"]);

export const WindowSizeSchema = z.object({
  width: z.number().int().min(320).max(4096),
  height: z.number().int().min(420).max(4096)
});

export const WindowPreferencesSchema = z.object({
  mode: WindowLayoutModeSchema,
  alwaysOnTop: z.boolean(),
  sidebarOpen: z.boolean(),
  compactSize: WindowSizeSchema.optional(),
  expandedSize: WindowSizeSchema.optional()
});

export const SettingScopeSchema = z.enum([
  "vault_portable",
  "vault_identity",
  "machine_local",
  "machine_vault_binding",
  "secret",
  "permission_grant",
  "derived_status",
  "runtime_transient"
]);

export const SettingApplyBehaviorSchema = z.enum([
  "immediate",
  "new_jobs",
  "next_launch",
  "requires_coordination",
  "requires_confirmation",
  "recomputed"
]);

export const SettingPermissionRequirementSchema = z.enum([
  "none",
  "os_permission",
  "permission_broker",
  "explicit_confirmation",
  "permission_and_confirmation",
  "explicit_warning"
]);

export const VaultManifestSchema = z.object({
  vault_id: VaultIdSchema,
  vault_schema_version: z.literal(1),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  app_min_version: z.string().min(1),
  default_locale: LocaleSchema,
  durable_roots: z.array(z.string().min(1)),
  rebuildable_roots: z.array(z.string().min(1)),
  origin_vault_id: VaultIdSchema.optional(),
  restored_from_backup_id: BackupIdSchema.optional()
}).passthrough();

export const VaultConfigSchema = z.object({
  schemaVersion: z.literal(1),
  sourceStorage: z.object({
    defaultStrategy: SourceStorageStrategySchema,
    sourceAssetRootKind: SourceAssetRootKindSchema,
    inVaultSourceAssetRoot: z.string().min(1)
  }),
  backup: z.object({
    includeConversations: z.boolean(),
    includeVaultMemory: z.boolean(),
    includeTrash: z.boolean()
  }),
  memory: z.object({
    vaultMemoryEnabled: z.boolean()
  })
});

export const MachineLocalSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  activeVaultPath: z.string().min(1).optional(),
  appLocale: LocaleSchema.optional(),
  window: WindowPreferencesSchema.optional(),
  recentVaults: z.array(
    z.object({
      vaultId: VaultIdSchema,
      name: z.string().min(1),
      path: z.string().min(1),
      schemaVersion: z.number().int().positive(),
      lastOpenedAt: z.string().datetime({ offset: true })
    })
  )
});

export const ExternalManagedCopyRootBindingSchema = z.object({
  rootId: RootBindingIdSchema,
  vaultId: VaultIdSchema,
  purpose: z.literal("managed_copy"),
  absolutePath: z.string().min(1),
  availability: z.enum(["available", "missing", "permission_needed"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).passthrough();

export const DefaultManagedCopyRootSelectionSchema = z.object({
  vaultId: VaultIdSchema,
  rootId: RootBindingIdSchema
});

export const VaultBindingsFileSchema = z.object({
  schemaVersion: z.literal(1),
  roots: z.array(ExternalManagedCopyRootBindingSchema),
  defaults: z.array(DefaultManagedCopyRootSelectionSchema).default([])
}).passthrough().superRefine((bindings, context) => {
  const rootsById = new Map<string, z.infer<typeof ExternalManagedCopyRootBindingSchema>>();
  for (const [index, root] of bindings.roots.entries()) {
    if (rootsById.has(root.rootId)) {
      context.addIssue({
        code: "custom",
        message: "Each external managed-copy root ID must be unique.",
        path: ["roots", index, "rootId"]
      });
    } else {
      rootsById.set(root.rootId, root);
    }
  }
  const selectedVaultIds = new Set<string>();
  for (const selection of bindings.defaults) {
    if (selectedVaultIds.has(selection.vaultId)) {
      context.addIssue({
        code: "custom",
        message: "Each vault may select only one default external managed-copy root.",
        path: ["defaults"]
      });
    }
    selectedVaultIds.add(selection.vaultId);
    const root = rootsById.get(selection.rootId);
    if (!root || root.vaultId !== selection.vaultId) {
      context.addIssue({
        code: "custom",
        message: "A default managed-copy root must resolve to a root binding for the same vault.",
        path: ["defaults"]
      });
    }
  }
});

export const ToolchainManifestSchema = z.object({
  schemaVersion: z.literal(1),
  tools: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      required: z.boolean(),
      bundledPath: z.string().min(1).optional(),
      bundledModule: z.string().min(1).optional(),
      repairHint: z.string().min(1).optional()
    }).refine((tool) => Boolean(tool.bundledPath || tool.bundledModule), {
      message: "A tool must declare a bundled path or module."
    })
  )
});

export const SourceRecordSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: SourceIdSchema,
  kind: SourceKindSchema,
  storageStrategy: SourceStorageStrategySchema,
  knowledgePageId: PageIdSchema.optional(),
  knowledgePagePath: z.string().min(1).optional(),
  original: z.object({
    uri: z.string().min(1),
    path: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    lastKnownMtime: z.string().datetime({ offset: true }).optional(),
    lastKnownSize: z.number().int().nonnegative().optional(),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional()
  }).optional(),
  managedCopy: z.object({
    path: z.string().min(1),
    rootId: RootBindingIdSchema.optional(),
    pathBasis: z.enum(["vault_relative", "root_relative"]).optional(),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    size: z.number().int().nonnegative()
  }).optional(),
  artifacts: z.array(
    z.object({
      id: ReadableArtifactIdSchema,
      kind: z.enum(["extracted_text", "ocr", "rendered_page", "thumbnail", "metadata"]),
      path: z.string().min(1),
      checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
      size: z.number().int().nonnegative().optional()
    })
  ),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).passthrough().superRefine((record, context) => {
  const managedCopy = record.managedCopy;
  if (managedCopy && Boolean(managedCopy.rootId) !== Boolean(managedCopy.pathBasis)) {
    context.addIssue({
      code: "custom",
      path: ["managedCopy"],
      message: "rootId and pathBasis must be supplied together; omit both only for a legacy vault-relative locator."
    });
  }
  if (managedCopy?.rootId === "root_vault_managed" && managedCopy.pathBasis !== "vault_relative") {
    context.addIssue({
      code: "custom",
      path: ["managedCopy", "pathBasis"],
      message: "The in-vault managed-copy root must use a vault_relative path."
    });
  }
  if (managedCopy?.rootId && managedCopy.rootId !== "root_vault_managed" && managedCopy.pathBasis !== "root_relative") {
    context.addIssue({
      code: "custom",
      path: ["managedCopy", "pathBasis"],
      message: "An external managed-copy root must use a root_relative path."
    });
  }
  if (record.storageStrategy === "copy_to_source_library" && !managedCopy) {
    context.addIssue({ code: "custom", path: ["managedCopy"], message: "Managed-copy storage requires managedCopy." });
  }
  if (record.storageStrategy === "reference_original" && managedCopy) {
    context.addIssue({
      code: "custom",
      path: ["managedCopy"],
      message: "Referenced-original storage must not contain a managedCopy locator."
    });
  }
  if (record.storageStrategy === "reference_original" && !record.original) {
    context.addIssue({ code: "custom", path: ["original"], message: "Referenced storage requires original metadata." });
  }
});

export const ConversationEventSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: ConversationEventIdSchema,
  conversationId: ConversationIdSchema,
  type: z.enum([
    "user_message",
    "assistant_message",
    "capture_reference",
    "attachment_reference",
    "source_reference",
    "operation_reference",
    "review_reference",
    "model_call_summary",
    "permission_decision",
    "error"
  ]),
  createdAt: z.string().datetime({ offset: true }),
  sourceId: SourceIdSchema.optional(),
  captureId: CaptureIdSchema.optional(),
  jobId: JobIdSchema.optional(),
  operationId: OperationIdSchema.optional(),
  proposalId: ProposalIdSchema.optional(),
  permissionDecisionId: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  sourceKind: SourceKindSchema.optional(),
  text: z.string().optional(),
  textPreview: z.string().optional()
}).passthrough();

export const JobClassSchema = z.enum([
  "capture_batch",
  "capture",
  "parse",
  "ocr",
  "agent_ingest",
  "retrieval_query",
  "index_rebuild",
  "backup",
  "restore",
  "permissioned_skill",
  "tool_install",
  "migration",
  "maintenance"
]);

export const JobStateSchema = z.enum([
  "queued",
  "running",
  "waiting_dependency",
  "waiting_permission",
  "awaiting_review",
  "cancel_requested",
  "completed",
  "completed_with_warnings",
  "failed_retryable",
  "failed_final",
  "cancelled",
  "compacted"
]);

export const JobStageSchema = z.enum([
  "capturing_source",
  "fetching",
  "parsing",
  "ocr",
  "embedding",
  "retrieving",
  "planning",
  "compiling",
  "waiting_for_model",
  "waiting_for_tool",
  "waiting_for_path",
  "writing",
  "indexing",
  "backing_up",
  "restoring",
  "repairing"
]);

export const JobPrioritySchema = z.enum(["interactive", "capture", "normal", "background", "maintenance"]);
export const JobScopeSchema = z.enum(["vault", "machine_local"]);

export const JobActorSchema = z.object({
  kind: z.enum(["user", "system", "pige_agent", "skill", "package", "migration"]),
  runtimeKind: z.enum(["desktop_local", "remote_agent_backend"]),
  clientCapabilityTier: z.enum(["desktop_full", "web_client", "mobile_lite"])
});

export const JobRefSchema = z.object({
  kind: z.enum([
    "source",
    "source_asset",
    "artifact",
    "page",
    "conversation",
    "proposal",
    "operation",
    "memory",
    "skill",
    "package",
    "tool",
    "backup",
    "external_uri"
  ]),
  id: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  uri: z.string().min(1).optional(),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  locator: z.string().min(1).optional(),
  role: z.string().min(1).optional()
}).passthrough();

export const JobCheckpointSchema = z.object({
  id: z.string().min(1),
  step: z.string().min(1),
  state: z.enum(["not_started", "running", "done", "skipped", "failed"]),
  startedAt: z.string().datetime({ offset: true }).optional(),
  finishedAt: z.string().datetime({ offset: true }).optional(),
  inputRefs: z.array(JobRefSchema),
  outputRefs: z.array(JobRefSchema),
  operationId: OperationIdSchema.optional(),
  checksumBefore: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  checksumAfter: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  resumeHint: z.string().min(1).optional()
}).passthrough();

export const PigeWarningSchema = z.object({
  code: PigeErrorCodeSchema,
  domain: PigeErrorDomainSchema,
  messageKey: PigeMessageKeySchema,
  messageParams: PigeSafeErrorMetadataSchema.optional(),
  sourceRef: JobRefSchema.optional(),
  redactedDetails: PigeSafeErrorMetadataSchema.optional()
}).strict().superRefine(requireErrorDomainMatchesCode);

export const PigeErrorSummarySchema = PigeErrorCoreSchema.extend({
  diagnosticErrorId: z.string().min(1).max(120).optional()
}).strict().superRefine(requireErrorDomainMatchesCode);

export const PigeErrorSchema = PigeErrorCoreSchema.extend({
  jobId: JobIdSchema.optional(),
  permissionRequestId: PermissionRequestIdSchema.optional(),
  diagnosticErrorId: z.string().min(1).max(120).optional()
}).strict().superRefine(requireErrorDomainMatchesCode);

export const DiagnosticErrorSchema = PigeErrorCoreSchema.extend({
  errorId: z.string().min(1).max(120),
  jobId: JobIdSchema.optional(),
  operationId: OperationIdSchema.optional(),
  sourceId: SourceIdSchema.optional(),
  vaultIdHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  createdAt: z.string().datetime({ offset: true })
}).strict().superRefine(requireErrorDomainMatchesCode);

export const WaitingDependencySummarySchema = z.object({
  dependencyKind: z.enum([
    "model_provider",
    "local_tool",
    "local_model",
    "runtime_capability",
    "vault_binding",
    "external_source"
  ]),
  dependencyId: z.string().min(1).optional(),
  requiredAction: z.enum([
    "configure_model",
    "repair_tool",
    "download_model",
    "enable_capability",
    "reconnect_path"
  ]),
  messageKey: z.string().min(1)
});

export const JobRecordSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: JobIdSchema,
  class: JobClassSchema,
  state: JobStateSchema,
  stage: JobStageSchema.optional(),
  priority: JobPrioritySchema.optional(),
  scope: JobScopeSchema.optional(),
  parentJobId: JobIdSchema.optional(),
  childJobIds: z.array(JobIdSchema).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).optional(),
  finishedAt: z.string().datetime({ offset: true }).optional(),
  activeVaultId: VaultIdSchema.optional(),
  actor: JobActorSchema.optional(),
  sourceId: SourceIdSchema.optional(),
  captureId: CaptureIdSchema.optional(),
  conversationEventId: ConversationEventIdSchema.optional(),
  policyContextId: z.string().min(1).optional(),
  policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  inputRefs: z.array(JobRefSchema).optional(),
  outputRefs: z.array(JobRefSchema).optional(),
  permissionRequestIds: z.array(PermissionRequestIdSchema).optional(),
  proposalIds: z.array(ProposalIdSchema).optional(),
  operationIds: z.array(OperationIdSchema).optional(),
  checkpoints: z.array(JobCheckpointSchema).optional(),
  progress: z.object({
    completedUnits: z.number().nonnegative(),
    totalUnits: z.number().positive().optional(),
    unit: z.string().min(1).optional(),
    messageKey: z.string().min(1).optional()
  }).optional(),
  warnings: z.array(PigeWarningSchema).optional(),
  error: PigeErrorSummarySchema.optional(),
  waitingDependency: WaitingDependencySummarySchema.optional(),
  retry: z.object({
    retryCount: z.number().int().nonnegative(),
    maxAutomaticRetries: z.number().int().nonnegative(),
    nextRetryAt: z.string().datetime({ offset: true }).optional(),
    lastRetryReason: z.string().min(1).optional(),
    requiresUserAction: z.boolean().optional()
  }).optional(),
  cancellation: z.object({
    requestedAt: z.string().datetime({ offset: true }).optional(),
    requestedBy: z.enum(["user", "system"]).optional(),
    safeCheckpointId: z.string().min(1).optional(),
    durableWritesApplied: z.boolean().optional()
  }).refine(
    (cancellation) => (cancellation.requestedAt === undefined) === (cancellation.requestedBy === undefined),
    { message: "Cancellation requestedAt and requestedBy must both be present or both be absent." }
  ).optional(),
  privacy: z.object({
    usedCloudModel: z.boolean(),
    usedNetwork: z.boolean(),
    usedShell: z.boolean(),
    accessedExternalFiles: z.boolean(),
    permissionDecisionIds: z.array(PermissionDecisionIdSchema)
  }).optional(),
  message: z.string().min(1)
}).strict().superRefine((job, context) => {
  if (
    job.state === "cancel_requested" &&
    (!job.cancellation?.requestedAt || !job.cancellation.requestedBy)
  ) {
    context.addIssue({
      code: "custom",
      path: ["cancellation"],
      message: "A cancel_requested job must include requestedAt and requestedBy."
    });
  }
  if (job.state === "cancelled" && job.cancellation?.durableWritesApplied === true) {
    context.addIssue({
      code: "custom",
      path: ["cancellation", "durableWritesApplied"],
      message: "A cancelled job cannot have durableWritesApplied set to true."
    });
  }
});

const AgentIngestStatementSchema = z.object({
  text: z.string().trim().min(1).max(1600),
  evidenceRefs: z.array(z.string().regex(/^ev_\d{2}$/)).max(8)
}).strict();

export const AgentIngestOutputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: AgentIngestStatementSchema,
  keyPoints: z.array(AgentIngestStatementSchema.extend({
    text: z.string().trim().min(1).max(320)
  })).max(8).default([]),
  tags: z.array(z.string().trim().min(1).max(48)).max(12).default([]),
  topics: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  entities: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  warnings: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
  confidence: z.enum(["low", "medium", "high"])
}).strict();

export const OperationRefSchema = z.object({
  kind: z.enum([
    "vault",
    "job",
    "source",
    "page",
    "artifact",
    "asset",
    "memory",
    "skill",
    "package",
    "setting",
    "model",
    "permission",
    "root_binding",
    "backup",
    "operation",
    "proposal"
  ]),
  id: z.string().min(1),
  path: z.string().min(1).optional()
}).strict();

export const ModelEgressAuditSchema = z.object({
  payloadHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  evidenceSummaryHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  decisionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  payloadCharacters: z.number().int().nonnegative(),
  estimatedPayloadTokens: z.number().int().nonnegative(),
  normalPayloadCharacterLimit: z.number().int().positive(),
  contentClasses: z.array(ModelEgressContentClassSchema).min(1).refine(
    (values) => new Set(values).size === values.length,
    "Model egress audit content classes must be unique."
  ),
  outcome: ModelEgressOutcomeSchema,
  reasonCode: ModelEgressReasonCodeSchema
}).strict();

export const ChangeOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    path: z.string().min(1),
    content: z.string()
  }),
  z.object({
    kind: z.literal("update"),
    path: z.string().min(1),
    beforeSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    content: z.string()
  }),
  z.object({
    kind: z.literal("rename"),
    from: z.string().min(1),
    to: z.string().min(1)
  }),
  z.object({
    kind: z.literal("delete"),
    path: z.string().min(1),
    beforeSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  })
]);

export const ProposalStateSchema = z.enum([
  "draft",
  "ready",
  "approved",
  "rejected",
  "superseded",
  "conflicted",
  "expired",
  "applied"
]);

export const ProposalTrustLevelSchema = z.enum(["review_required", "explicit_confirmation"]);

export const ConfirmationProposalSchema = z.object({
  id: ProposalIdSchema,
  schemaVersion: z.literal(1),
  jobId: JobIdSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  state: ProposalStateSchema,
  trustLevel: ProposalTrustLevelSchema,
  summary: z.string().min(1),
  reason: z.string().min(1),
  sourceRefs: z.array(OperationRefSchema),
  targetRefs: z.array(OperationRefSchema),
  proposedOperations: z.array(ChangeOperationSchema),
  diffRefs: z.array(OperationRefSchema),
  warnings: z.array(z.string().min(1)),
  baseHashes: z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/)),
  requiredPermissionIds: z.array(z.union([PermissionRequestIdSchema, PermissionDecisionIdSchema])),
  decision: z.object({
    decidedAt: z.string().datetime({ offset: true }),
    decidedBy: z.enum(["user", "system"]),
    reason: z.string().min(1).optional()
  }).optional()
}).passthrough();

export const OperationRecordSchema = z.object({
  id: OperationIdSchema,
  schemaVersion: z.literal(1),
  jobId: JobIdSchema.optional(),
  proposalId: ProposalIdSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  actor: JobActorSchema,
  modelProfileId: z.string().regex(/^model_[a-z0-9_]+$/).optional(),
  skillId: z.string().regex(/^skill_[a-z0-9_]+$/).optional(),
  packageId: z.string().regex(/^pkg_[a-z0-9_]+$/).optional(),
  permissionDecisionIds: z.array(PermissionDecisionIdSchema),
  policyAudit: z.object({
    policyContextId: z.string().min(1),
    policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    enforcementOwners: z.array(z.string().min(1)).min(1)
  }).strict().optional(),
  modelEgressAudit: ModelEgressAuditSchema.optional(),
  kind: z.enum([
    "create_source_record",
    "update_source_record",
    "relink_source",
    "copy_source_asset",
    "move_source_asset",
    "trash_source_asset",
    "restore_source_asset",
    "create_artifact",
    "trash_artifact",
    "restore_artifact",
    "create_page",
    "update_page",
    "rename_page",
    "archive_page",
    "trash_page",
    "restore_page",
    "update_index",
    "create_memory",
    "update_memory",
    "trash_memory",
    "restore_memory",
    "install_skill",
    "disable_skill",
    "uninstall_skill",
    "install_package",
    "disable_package",
    "uninstall_package",
    "change_setting",
    "model_egress_decision",
    "compact_job",
    "repair_record",
    "backup_created",
    "restore_applied",
    "migration_applied"
  ]),
  targetRefs: z.array(OperationRefSchema),
  sourceRefs: z.array(OperationRefSchema),
  before: OperationRefSchema.optional(),
  after: OperationRefSchema.optional(),
  patchRef: OperationRefSchema.optional(),
  summary: z.string().min(1),
  reversible: z.enum(["yes", "best_effort", "no"]),
  rollbackHint: z.string().min(1).optional(),
  warnings: z.array(z.string().min(1))
}).strict().superRefine((operation, context) => {
  if (operation.kind === "model_egress_decision" && !operation.modelEgressAudit) {
    context.addIssue({
      code: "custom",
      path: ["modelEgressAudit"],
      message: "A model-egress decision operation requires a typed payload and evidence audit summary."
    });
  }
  if (operation.kind !== "model_egress_decision" && operation.modelEgressAudit) {
    context.addIssue({
      code: "custom",
      path: ["modelEgressAudit"],
      message: "Only a model-egress decision operation may contain modelEgressAudit."
    });
  }
});

export const DurableSchemaVersionRangeSchema = z.object({
  min: z.number().int().positive(),
  max: z.number().int().positive()
}).refine((range) => range.min <= range.max, {
  message: "A durable schema version range must have min <= max."
});

export const BackupDomainSchemaVersionsSchema = z.object({
  markdownPages: DurableSchemaVersionRangeSchema,
  sourceRecords: DurableSchemaVersionRangeSchema,
  conversationEvents: DurableSchemaVersionRangeSchema,
  jobs: DurableSchemaVersionRangeSchema,
  proposals: DurableSchemaVersionRangeSchema,
  operations: DurableSchemaVersionRangeSchema,
  memory: DurableSchemaVersionRangeSchema,
  skills: DurableSchemaVersionRangeSchema
});

export const BackupExternalDependencySchema = z.object({
  kind: z.enum(["external_managed_copy_root", "external_original"]),
  rootId: RootBindingIdSchema.optional(),
  sourceId: SourceIdSchema.optional(),
  included: z.boolean(),
  requiredForCompleteRestore: z.boolean(),
  displayName: z.string().min(1).optional()
}).passthrough();

export const BackupManifestSchema = z.object({
  format: z.literal("pige-backup"),
  formatVersion: z.literal(1),
  backupId: BackupIdSchema.optional(),
  appVersion: z.string().min(1),
  vaultId: VaultIdSchema,
  vaultName: z.string().min(1),
  vaultSchemaVersion: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  noteCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  conversationCount: z.number().int().nonnegative(),
  memoryCount: z.number().int().nonnegative(),
  includesSecrets: z.literal(false),
  includes: z.object({
    markdownKnowledge: z.boolean(),
    sourceRecords: z.boolean(),
    managedSourceCopies: z.boolean(),
    conversations: z.boolean(),
    vaultMemory: z.boolean(),
    trash: z.boolean(),
    rebuildableDatabaseCache: z.boolean(),
    secrets: z.literal(false)
  }),
  domainSchemaVersions: BackupDomainSchemaVersionsSchema.optional(),
  excludedRoots: z.array(z.string().min(1)),
  externalDependencies: z.array(z.union([z.string().min(1), BackupExternalDependencySchema])),
  files: z.array(z.object({
    path: z.string().min(1),
    size: z.number().int().nonnegative(),
    checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  }))
}).passthrough();

export function isProviderLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase("en-US");
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1";
}

export function isBuiltInProviderKind(providerKind: z.infer<typeof ProviderKindSchema>): boolean {
  return providerKind === "openai" || providerKind === "anthropic";
}

export const ProviderBaseUrlSchema = z.string()
  .trim()
  .min(1, { message: "Provider base URL cannot be empty." })
  .url({ message: "Provider base URL must be a valid URL." })
  .superRefine((value, context) => {
    const parsed = new URL(value);
    const secureProtocol = parsed.protocol === "https:";
    const localHttp = parsed.protocol === "http:" && isProviderLoopbackHostname(parsed.hostname);
    if (!secureProtocol && !localHttp) {
      context.addIssue({
        code: "custom",
        message: "Provider base URL must use HTTPS unless it is local loopback HTTP.",
        params: { pigeErrorCode: "model_provider.base_url_insecure" }
      });
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      context.addIssue({
        code: "custom",
        message: "Provider base URL cannot contain credentials, query parameters, or fragments.",
        params: { pigeErrorCode: "model_provider.base_url_sensitive_components" }
      });
    }
  })
  .transform((value) => {
    const parsed = new URL(value);
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
    const normalized = parsed.toString();
    return parsed.pathname === "/" ? normalized.slice(0, -1) : normalized;
  });

export const AddPresetProviderRequestSchema = z.object({
  presetId: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/u),
  apiKey: z.string().trim().min(1).max(16_384)
}).strict();

export const AddManualProviderRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  providerKind: ProviderKindSchema,
  baseUrl: ProviderBaseUrlSchema.optional(),
  apiKey: z.string().trim().min(1).max(16_384),
  manualModelId: z.string().trim().min(1).max(200),
  cloudBoundary: CloudBoundarySchema
}).strict();

export const SetDefaultModelRequestSchema = z.object({
  modelProfileId: z.string().regex(/^model_[a-z0-9_]+$/)
}).strict();

export const ProviderProfileSchema = z.object({
  id: z.string().regex(/^provider_[a-z0-9_]+$/),
  displayName: z.string().min(1),
  providerKind: ProviderKindSchema,
  baseUrl: ProviderBaseUrlSchema.optional(),
  authSecretRef: z.string().regex(/^provider_secret_[a-z0-9_]+$/),
  modelListStrategy: ModelListStrategySchema,
  cloudBoundary: CloudBoundarySchema,
  boundaryVerification: BoundaryVerificationSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).superRefine((profile, context) => {
  const builtIn = isBuiltInProviderKind(profile.providerKind);
  const loopback = profile.baseUrl !== undefined && isProviderLoopbackHostname(new URL(profile.baseUrl).hostname);

  if (builtIn) {
    if (profile.baseUrl !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Built-in OpenAI and Anthropic profiles use their fixed official endpoint; custom base URLs require a compatible provider kind.",
        path: ["baseUrl"]
      });
    }
    if (profile.cloudBoundary !== "cloud") {
      context.addIssue({
        code: "custom",
        message: "Built-in OpenAI and Anthropic profiles must use the cloud boundary.",
        path: ["cloudBoundary"]
      });
    }
    if (profile.boundaryVerification !== "builtin_verified") {
      context.addIssue({
        code: "custom",
        message: "Built-in OpenAI and Anthropic profiles require builtin_verified boundary metadata.",
        path: ["boundaryVerification"]
      });
    }
    return;
  }

  if (loopback) {
    if (profile.cloudBoundary !== "local" || profile.boundaryVerification !== "loopback_verified") {
      context.addIssue({
        code: "custom",
        message: "A loopback compatible provider must use local and loopback_verified boundary metadata.",
        path: ["cloudBoundary"]
      });
    }
    return;
  }

  if (profile.cloudBoundary === "local" || profile.boundaryVerification === "loopback_verified") {
    context.addIssue({
      code: "custom",
      message: "Only a canonical loopback provider URL may use local or loopback_verified boundary metadata.",
      path: ["boundaryVerification"]
    });
  }
  if (profile.boundaryVerification === "builtin_verified") {
    context.addIssue({
      code: "custom",
      message: "Compatible and custom provider profiles cannot claim builtin_verified boundary metadata.",
      path: ["boundaryVerification"]
    });
  }
});

export const ModelProfileSchema = z.object({
  id: z.string().regex(/^model_[a-z0-9_]+$/),
  providerProfileId: z.string().regex(/^provider_[a-z0-9_]+$/),
  modelId: z.string().min(1),
  displayName: z.string().min(1).optional(),
  source: z.enum(["provider_list", "manual"]),
  supportsTools: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  contextWindowTokens: z.number().int().positive().optional(),
  defaultThinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  enabled: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
});

export const ModelProviderStateSchema = z.object({
  schemaVersion: z.literal(1),
  defaultModelProfileId: z.string().regex(/^model_[a-z0-9_]+$/).optional(),
  providers: z.array(ProviderProfileSchema),
  models: z.array(ModelProfileSchema)
});

export const ProviderProfilesFileSchema = z.object({
  schemaVersion: z.literal(1),
  providers: z.array(ProviderProfileSchema)
});

export const ModelProfilesFileSchema = z.object({
  schemaVersion: z.literal(1),
  defaultModelProfileId: z.string().regex(/^model_[a-z0-9_]+$/).optional(),
  models: z.array(ModelProfileSchema)
});

export const LocalDatabaseSchemaStateSchema = z.object({
  schemaVersion: z.literal(1),
  driver: z.enum(["pending_sqlite_driver", "better_sqlite3", "node_sqlite"]),
  appSchemaVersion: z.number().int().nonnegative(),
  appliedMigrations: z.array(
    z.object({
      id: z.string().min(1),
      appliedAt: z.string().datetime({ offset: true })
    })
  ),
  updatedAt: z.string().datetime({ offset: true })
});

export const FixtureManifestSchema = z.object({
  schemaVersion: z.literal(1),
  fixtures: z.array(
    z.object({
      id: z.string().min(1),
      path: z.string().min(1),
      kind: z.string().min(1),
      license: z.string().min(1),
      expectedOutputRefs: z.array(z.string().min(1)).min(1),
      redactionStatus: z.enum(["synthetic_no_sensitive_data", "redacted", "not_applicable"]),
      sizeClass: z.enum(["small", "medium", "large"]),
      requiredPlatformCapabilities: z.array(z.string().min(1)),
      owner: z.string().min(1),
      updatePolicy: z.string().min(1)
    }).strict()
  )
});

export type FixtureManifest = z.infer<typeof FixtureManifestSchema>;
export type BackupManifest = z.infer<typeof BackupManifestSchema>;
export type BackupDomainSchemaVersions = z.infer<typeof BackupDomainSchemaVersionsSchema>;
export type ExternalManagedCopyRootBinding = z.infer<typeof ExternalManagedCopyRootBindingSchema>;
export type DefaultManagedCopyRootSelection = z.infer<typeof DefaultManagedCopyRootSelectionSchema>;
export type VaultBindingsFile = z.infer<typeof VaultBindingsFileSchema>;
export type AgentIngestOutput = z.infer<typeof AgentIngestOutputSchema>;
export type ChangeOperation = z.infer<typeof ChangeOperationSchema>;
export type BoundaryVerification = z.infer<typeof BoundaryVerificationSchema>;
export type CloudBoundary = z.infer<typeof CloudBoundarySchema>;
export type CloudSendPolicy = z.infer<typeof CloudSendPolicySchema>;
export type ConfirmationProposal = z.infer<typeof ConfirmationProposalSchema>;
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;
export type JobClass = z.infer<typeof JobClassSchema>;
export type JobCheckpoint = z.infer<typeof JobCheckpointSchema>;
export type JobRef = z.infer<typeof JobRefSchema>;
export type JobRecord = z.infer<typeof JobRecordSchema>;
export type JobStage = z.infer<typeof JobStageSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type MachineLocalSettings = z.infer<typeof MachineLocalSettingsSchema>;
export type MarkdownPageStatus = z.infer<typeof MarkdownPageStatusSchema>;
export type MarkdownPageType = z.infer<typeof MarkdownPageTypeSchema>;
export type ModelListStrategy = z.infer<typeof ModelListStrategySchema>;
export type ModelEgressContentClass = z.infer<typeof ModelEgressContentClassSchema>;
export type ModelEgressDecision = z.infer<typeof ModelEgressDecisionSchema>;
export type ModelEgressAudit = z.infer<typeof ModelEgressAuditSchema>;
export type ModelEgressOutcome = z.infer<typeof ModelEgressOutcomeSchema>;
export type ModelEgressReasonCode = z.infer<typeof ModelEgressReasonCodeSchema>;
export type ModelProfilesFile = z.infer<typeof ModelProfilesFileSchema>;
export type ModelProfile = z.infer<typeof ModelProfileSchema>;
export type ModelProviderState = z.infer<typeof ModelProviderStateSchema>;
export type DiagnosticError = z.infer<typeof DiagnosticErrorSchema>;
export type OperationRecord = z.infer<typeof OperationRecordSchema>;
export type PigeError = z.infer<typeof PigeErrorSchema>;
export type PigeErrorAction = z.infer<typeof PigeErrorActionSchema>;
export type PigeErrorDomain = z.infer<typeof PigeErrorDomainSchema>;
export type PigeErrorSeverity = z.infer<typeof PigeErrorSeveritySchema>;
export type PigeErrorSummary = z.infer<typeof PigeErrorSummarySchema>;
export type PigeWarning = z.infer<typeof PigeWarningSchema>;
export type PermissionCapability = z.infer<typeof PermissionCapabilitySchema>;
export type PermissionDecisionRecord = z.infer<typeof PermissionDecisionRecordSchema>;
export type PermissionDefaultMode = z.infer<typeof PermissionDefaultModeSchema>;
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;
export type ProposalState = z.infer<typeof ProposalStateSchema>;
export type ProposalTrustLevel = z.infer<typeof ProposalTrustLevelSchema>;
export type ProviderKind = z.infer<typeof ProviderKindSchema>;
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;
export type ProviderProfilesFile = z.infer<typeof ProviderProfilesFileSchema>;
export type SettingApplyBehavior = z.infer<typeof SettingApplyBehaviorSchema>;
export type SettingPermissionRequirement = z.infer<typeof SettingPermissionRequirementSchema>;
export type SettingScope = z.infer<typeof SettingScopeSchema>;
export type LocalDatabaseSchemaState = z.infer<typeof LocalDatabaseSchemaStateSchema>;
export type Locale = z.infer<typeof LocaleSchema>;
export type SourceAssetRootKind = z.infer<typeof SourceAssetRootKindSchema>;
export type SourceKind = z.infer<typeof SourceKindSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type SourceStorageStrategy = z.infer<typeof SourceStorageStrategySchema>;
export type ToolchainManifest = z.infer<typeof ToolchainManifestSchema>;
export type VaultConfig = z.infer<typeof VaultConfigSchema>;
export type VaultManifest = z.infer<typeof VaultManifestSchema>;
export type WindowLayoutMode = z.infer<typeof WindowLayoutModeSchema>;
export type WindowPreferences = z.infer<typeof WindowPreferencesSchema>;
export type WindowSize = z.infer<typeof WindowSizeSchema>;
