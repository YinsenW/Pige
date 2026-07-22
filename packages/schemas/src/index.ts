import { z } from "zod";
import { PIGE_REQUIREMENT_ID_PATTERN, PIGE_VAULT_ID_PATTERN } from "@pige/domain";

export const RequirementIdSchema = z.string().regex(PIGE_REQUIREMENT_ID_PATTERN);

export const LocaleSchema = z.enum(["zh-Hans", "en", "ja", "ko", "fr", "de"]);

export const VaultIdSchema = z.string().regex(PIGE_VAULT_ID_PATTERN);

// Durable IDs are path-independent vocabulary. Keep these schemas centralized so
// files, jobs, IPC DTOs, migrations, and documentation do not invent aliases.
export const SourceIdSchema = z.string().regex(/^src_\d{8}_[a-z0-9]{8,}$/);
export const PageIdSchema = z.string().regex(/^page_\d{8}_[a-z0-9]{8,}$/);
export const NoteInlineReferenceRequestIdSchema = z.string().regex(/^noteref_[a-z0-9]{16,64}$/);
export const NoteRenderContextIdSchema = z.string().regex(/^notectx_[a-z0-9]{32}$/);
const UnsafeInlineReferenceCharacterSchema = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
export const CitationLocatorSchema = z.string()
  .min(1)
  .max(512)
  .refine(
    (value) => !UnsafeInlineReferenceCharacterSchema.test(value),
    "Citation locators must not contain control or bidirectional override characters."
  );
export const NoteInlineReferenceHrefSchema = z.string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      (value.startsWith("#wiki:") || value.startsWith("#source:")) &&
      new TextEncoder().encode(value).byteLength <= 1024 &&
      !UnsafeInlineReferenceCharacterSchema.test(value),
    "Inline note references must use a 1024-byte internal href without control characters."
  );
export const NoteResolveInlineReferenceRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteInlineReferenceRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  href: NoteInlineReferenceHrefSchema
}).strict();
export const NoteInlineReferenceTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("page"),
    pageId: PageIdSchema
  }).strict(),
  z.object({
    kind: z.literal("source"),
    sourceId: SourceIdSchema,
    pageId: PageIdSchema,
    locator: CitationLocatorSchema.max(256).optional()
  }).strict()
]);
export const NoteResolveInlineReferenceResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    requestId: NoteInlineReferenceRequestIdSchema,
    status: z.literal("resolved"),
    target: NoteInlineReferenceTargetSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: NoteInlineReferenceRequestIdSchema,
    status: z.literal("ambiguous")
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: NoteInlineReferenceRequestIdSchema,
    status: z.literal("not_found")
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: NoteInlineReferenceRequestIdSchema,
    status: z.literal("stale"),
    scope: z.enum(["vault", "page", "render_context"])
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: NoteInlineReferenceRequestIdSchema,
    status: z.literal("failed")
  }).strict()
]);
export const ReaderSelectionRequestIdSchema = z.string().regex(/^readerselreq_[a-z0-9]{8,64}$/);
export const ReaderSelectionSegmentIdSchema = z.string().regex(/^readerseg_[a-f0-9]{16}$/);
export const ReaderSelectionEndpointSchema = z.object({
  segmentId: ReaderSelectionSegmentIdSchema,
  utf16Offset: z.number().int().nonnegative().max(4 * 1024 * 1024)
}).strict();
export const ReaderSelectionResolveRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: ReaderSelectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  anchor: ReaderSelectionEndpointSchema,
  focus: ReaderSelectionEndpointSchema
}).strict();
export const ReaderSelectionUtf8ByteSpanSchema = z.object({
  unit: z.literal("utf8_bytes"),
  start: z.number().int().nonnegative().max(4 * 1024 * 1024),
  endExclusive: z.number().int().positive().max(4 * 1024 * 1024)
}).strict().superRefine((span, context) => {
  if (span.endExclusive <= span.start) {
    context.addIssue({
      code: "custom",
      path: ["endExclusive"],
      message: "A Reader selection must be non-empty."
    });
  }
  if (span.endExclusive - span.start > 64 * 1024) {
    context.addIssue({
      code: "custom",
      path: ["endExclusive"],
      message: "A Reader selection cannot exceed 65536 UTF-8 bytes."
    });
  }
});
const ReaderSelectionHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const ReaderSelectionIdentitySchema = z.object({
  pageId: PageIdSchema,
  pageContentHash: ReaderSelectionHashSchema,
  span: ReaderSelectionUtf8ByteSpanSchema,
  selectedContentHash: ReaderSelectionHashSchema
}).strict();
export const ReaderSelectionResolveResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionRequestIdSchema,
    status: z.literal("resolved"),
    selection: ReaderSelectionIdentitySchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionRequestIdSchema,
    status: z.literal("invalid"),
    reason: z.enum([
      "selection_empty",
      "selection_too_large",
      "endpoint_not_found",
      "endpoint_offset_invalid",
      "unsupported_content"
    ])
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionRequestIdSchema,
    status: z.literal("stale"),
    scope: z.enum(["vault", "page", "render_context"])
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionRequestIdSchema,
    status: z.literal("failed")
  }).strict()
]);
export const CaptureIdSchema = z.string().regex(/^cap_\d{8}_[a-z0-9]{8,}$/);
export const ConversationIdSchema = z.string().regex(/^conv_\d{8}(?:_[a-z0-9]{4,})?$/);
export const ConversationEventIdSchema = z.string().regex(/^evt_\d{8}_[a-z0-9]{8,}$/);
export const AgentClientTurnIdSchema = z.string().regex(/^turn_\d{8}_[a-z0-9]{12,64}$/);
export const AgentTurnCurrentNoteScopeSchema = z.object({
  kind: z.literal("current_note"),
  pageId: PageIdSchema
}).strict();
export const JobIdSchema = z.string().regex(/^job_\d{8}_[a-z0-9]{8,}$/);
export const ProposalIdSchema = z.string().regex(/^proposal_\d{8}_[a-z0-9]{8,}$/);
export const OperationIdSchema = z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/);

export const HighRiskConfirmationIdSchema = z.string().regex(/^confirm_\d{8}_[a-z0-9]{16,64}$/);
export const HighRiskEffectSchema = z.enum([
  "irreversible_delete",
  "overwrite_user_original",
  "write_outside_authorized_root",
  "arbitrary_shell",
  "install_unreviewed_package",
  "export_secret",
  "risky_agent_edit",
  "authority_boundary_change"
]);
export const HighRiskConfirmationActionSchema = z.enum([
  "delete_permanently",
  "overwrite_original",
  "write_external_item",
  "run_shell_command",
  "install_package",
  "export_credential",
  "apply_risky_edit",
  "change_authority_boundary"
]);
export const HighRiskConfirmationTargetSchema = z.enum([
  "vault_item",
  "user_owned_original",
  "external_location",
  "local_system",
  "local_toolchain",
  "credential_material",
  "current_note",
  "authority_boundary"
]);
const INTERNAL_DISPLAY_ID_MARKERS = [
  "vault_", "page_", "turn_", "op_", "job_", "confirm_", "secret_", "provider_", "model_"
] as const;
const SECRET_DISPLAY_MARKERS = [
  "sk-", "github_pat_", "xoxb-", "xoxp-", "xoxa-", "token=", "apikey=", "api_key=", "bearer ",
  "access_token", "accesstoken", "refresh_token", "refreshtoken", "client_secret", "clientsecret", "private_key"
] as const;
const COMMAND_DISPLAY_PREFIXES = [
  "rm", "curl", "wget", "sudo", "npm", "npx", "pnpm", "yarn", "bun", "node", "bash", "zsh", "sh",
  "powershell", "cmd", "git", "python", "python3", "pip", "uv", "chmod", "chown", "mv", "cp"
] as const;
const containsUnsafeDisplayIdentity = (lower: string): boolean =>
  INTERNAL_DISPLAY_ID_MARKERS.some((marker) => lower.includes(marker)) ||
  SECRET_DISPLAY_MARKERS.some((marker) => lower.includes(marker));
const startsLikeCommand = (lower: string): boolean => COMMAND_DISPLAY_PREFIXES.some(
  (command) => lower === command || lower.startsWith(`${command} `) || lower.startsWith(`${command}\t`)
);
const hasSafeDisplayCharacters = (value: string): boolean => {
  if (value !== value.trim() || value.length < 1 || value.length > 80) return false;
  if (value.includes("://") || value.includes(":")) return false;
  const forbidden = new Set(["/", "\\", "|", ";", "&", ">", "<", "$", "`", "=", "\n", "\r", "\t"]);
  for (const character of value) {
    if (forbidden.has(character) || character.charCodeAt(0) < 32) return false;
  }
  const lower = value.toLowerCase();
  if (["http:", "https:", "file:", "ssh:"].some((prefix) => lower.startsWith(prefix))) return false;
  return !containsUnsafeDisplayIdentity(lower) && !startsLikeCommand(lower);
};
const isPackageSegment = (value: string): boolean => {
  if (value.length < 1 || value.length > 64 || value === "." || value === "..") return false;
  for (const character of value) {
    const lower = character.toLowerCase();
    if (!((lower >= "a" && lower <= "z") || (character >= "0" && character <= "9") || ".-_".includes(character))) {
      return false;
    }
  }
  return true;
};
const isSafePackageName = (value: string): boolean => {
  if (value !== value.trim() || value.length > 100 || value.includes("://") || value.includes("\\")) return false;
  if (containsUnsafeDisplayIdentity(value.toLowerCase())) return false;
  if (value.startsWith("@")) {
    const parts = value.slice(1).split("/");
    return parts.length === 2 && parts.every(isPackageSegment);
  }
  return !value.includes("/") && isPackageSegment(value);
};
const EXACT_PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const isSafePackageSpec = (value: string): boolean => {
  if (value !== value.trim() || value.length > 165) return false;
  const separator = value.lastIndexOf("@");
  if (separator < 1) return false;
  return isSafePackageName(value.slice(0, separator)) && EXACT_PACKAGE_VERSION_PATTERN.test(value.slice(separator + 1));
};
const isSafeExecutableName = (value: string): boolean => {
  if (value !== value.trim() || value.length < 1 || value.length > 64) return false;
  for (const character of value) {
    const lower = character.toLowerCase();
    if (!((lower >= "a" && lower <= "z") || (character >= "0" && character <= "9") || ".-_+".includes(character))) {
      return false;
    }
  }
  return !value.startsWith(".") && !value.includes("..") && !containsUnsafeDisplayIdentity(value.toLowerCase());
};
export const RendererSafeSubjectLabelSchema = z.string().refine(hasSafeDisplayCharacters);
export const HighRiskConfirmationSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item_count"), count: z.number().int().min(1).max(8) }).strict(),
  z.object({ kind: z.literal("display_name"), value: RendererSafeSubjectLabelSchema }).strict(),
  z.object({ kind: z.literal("package_name"), value: z.string().refine(isSafePackageSpec) }).strict(),
  z.object({ kind: z.literal("executable_name"), value: z.string().refine(isSafeExecutableName) }).strict()
]);
const HighRiskDisplayNameSubjectSchema = z.object({
  kind: z.literal("display_name"),
  value: RendererSafeSubjectLabelSchema
}).strict();
const HighRiskItemCountSubjectSchema = z.object({
  kind: z.literal("item_count"),
  count: z.number().int().min(1).max(8)
}).strict();
export const HighRiskConfirmationOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent_turn"),
    clientTurnId: AgentClientTurnIdSchema
  }).strict(),
  z.object({
    kind: z.literal("operation"),
    operationId: OperationIdSchema
  }).strict()
]);
const HighRiskConfirmationSummaryBaseSchema = z.object({
  apiVersion: z.literal(1),
  confirmationId: HighRiskConfirmationIdSchema
});
const HighRiskOperationOwnerSchema = z.object({
  kind: z.literal("operation"),
  operationId: OperationIdSchema
}).strict();
export const HighRiskConfirmationSummarySchema = z.discriminatedUnion("effect", [
  HighRiskConfirmationSummaryBaseSchema.extend({
    effect: z.literal("irreversible_delete"),
    presentation: z.object({
      action: z.literal("delete_permanently"), target: z.literal("vault_item"),
      subject: z.union([
        HighRiskItemCountSubjectSchema,
        HighRiskDisplayNameSubjectSchema
      ])
    }).strict(),
    owner: HighRiskConfirmationOwnerSchema
  }).strict(),
  HighRiskConfirmationSummaryBaseSchema.extend({
    effect: z.literal("overwrite_user_original"),
    presentation: z.object({ action: z.literal("overwrite_original"), target: z.literal("user_owned_original"), subject: HighRiskDisplayNameSubjectSchema }).strict(),
    owner: HighRiskConfirmationOwnerSchema
  }).strict(),
  HighRiskConfirmationSummaryBaseSchema.extend({
    effect: z.literal("write_outside_authorized_root"),
    presentation: z.object({ action: z.literal("write_external_item"), target: z.literal("external_location"), subject: HighRiskDisplayNameSubjectSchema }).strict(),
    owner: HighRiskConfirmationOwnerSchema
  }).strict(),
  HighRiskConfirmationSummaryBaseSchema.extend({
    effect: z.literal("arbitrary_shell"),
    presentation: z.object({
      action: z.literal("run_shell_command"), target: z.literal("local_system"),
      subject: z.object({ kind: z.literal("executable_name"), value: z.string().refine(isSafeExecutableName) }).strict()
    }).strict(),
    owner: HighRiskConfirmationOwnerSchema
  }).strict(),
  HighRiskConfirmationSummaryBaseSchema.extend({
    effect: z.literal("install_unreviewed_package"),
    presentation: z.object({
      action: z.literal("install_package"), target: z.literal("local_toolchain"),
      subject: z.object({ kind: z.literal("package_name"), value: z.string().refine(isSafePackageSpec) }).strict()
    }).strict(),
    owner: HighRiskConfirmationOwnerSchema
  }).strict(),
  HighRiskConfirmationSummaryBaseSchema.extend({
    effect: z.literal("export_secret"),
    presentation: z.object({ action: z.literal("export_credential"), target: z.literal("credential_material"), subject: HighRiskDisplayNameSubjectSchema }).strict(),
    owner: HighRiskConfirmationOwnerSchema
  }).strict(),
  HighRiskConfirmationSummaryBaseSchema.extend({
    effect: z.literal("risky_agent_edit"),
    presentation: z.object({
      action: z.literal("apply_risky_edit"), target: z.literal("current_note"),
      subject: z.union([HighRiskItemCountSubjectSchema, HighRiskDisplayNameSubjectSchema])
    }).strict(),
    owner: HighRiskOperationOwnerSchema
  }).strict(),
  HighRiskConfirmationSummaryBaseSchema.extend({
    effect: z.literal("authority_boundary_change"),
    presentation: z.object({ action: z.literal("change_authority_boundary"), target: z.literal("authority_boundary"), subject: HighRiskDisplayNameSubjectSchema }).strict(),
    owner: HighRiskConfirmationOwnerSchema
  }).strict()
]);
export const HighRiskConfirmationPendingResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("pending"),
    revision: z.number().int().positive(),
    confirmation: HighRiskConfirmationSummarySchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("none"),
    revision: z.number().int().nonnegative()
  }).strict()
]);
export const HighRiskConfirmationResolveRequestSchema = z.object({
  apiVersion: z.literal(1),
  confirmationId: HighRiskConfirmationIdSchema,
  expectedRevision: z.number().int().positive(),
  decision: z.enum(["allow", "deny"])
}).strict();
export const HighRiskConfirmationResolveResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("committed"),
    confirmationId: HighRiskConfirmationIdSchema,
    revision: z.number().int().positive(),
    decision: z.enum(["allow", "deny"])
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("already_resolved"),
    confirmationId: HighRiskConfirmationIdSchema,
    revision: z.number().int().positive(),
    decision: z.enum(["allow", "deny"])
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("stale"),
    current: HighRiskConfirmationPendingResultSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("not_found"),
    revision: z.number().int().nonnegative()
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("failed"),
    confirmationId: HighRiskConfirmationIdSchema,
    revision: z.number().int().positive()
  }).strict()
]);
export const HighRiskConfirmationChangedEventSchema = HighRiskConfirmationPendingResultSchema;

export const KnowledgeActivityPageTargetSchema = z.object({
  kind: z.literal("page"),
  pageId: PageIdSchema
}).strict();

export const KnowledgeActivityListRequestSchema = z.object({
  limit: z.number().int().min(1).max(20).optional()
}).strict();

export const KnowledgeActivitySummarySchema = z.object({
  operationId: OperationIdSchema,
  kind: z.enum(["create_page", "update_page"]),
  createdAt: z.string().datetime({ offset: true }),
  targetLabel: z.string().min(1).max(120).optional(),
  target: KnowledgeActivityPageTargetSchema.optional(),
  status: z.enum(["applied", "undone"]),
  canUndo: z.boolean(),
  undoUnavailableReason: z.enum([
    "already_undone",
    "content_changed",
    "legacy_record",
    "target_missing"
  ]).optional()
}).strict();

export const KnowledgeActivityListResultSchema = z.object({
  scannedAt: z.string().datetime({ offset: true }),
  activeVaultId: VaultIdSchema,
  total: z.number().int().nonnegative(),
  invalidOperationCount: z.number().int().nonnegative(),
  activities: z.array(KnowledgeActivitySummarySchema).max(20)
}).strict();
export const ArtifactIdSchema = z.string().regex(/^art_[a-z0-9][a-z0-9_]{2,}$/);
export const RootBindingIdSchema = z.string().regex(/^root_[a-z0-9][a-z0-9_]{5,}$/);
export const BackupIdSchema = z.string().regex(/^backup_\d{8}_[a-z0-9]{8,}$/);
export const DatasetIdSchema = z.string().regex(/^dataset_\d{8}_[a-z0-9]{12,}$/);
export const DatasetRevisionIdSchema = z.string().regex(/^dataset_rev_\d{8}_[a-z0-9]{12,}$/);
export const TableIdSchema = z.string().regex(/^table_[a-z0-9]{12,}$/);
export const ColumnIdSchema = z.string().regex(/^column_[a-z0-9]{12,}$/);
export const RowIdSchema = z.string().regex(/^row_[a-z0-9]{12,}$/);
export const ViewIdSchema = z.string().regex(/^view_[a-z0-9]{12,}$/);

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
  "csv_file",
  "xlsx_file",
  "sqlite_file",
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

export const ProviderEndpointProtocolSchema = z.enum([
  "openai_responses",
  "openai_chat_completions",
  "anthropic_messages"
]);

export const ProviderAuthRequirementSchema = z.enum(["api_key", "optional_api_key", "none"]);

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
  "speech",
  "rag",
  "model_provider",
  "agent_runtime",
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

export const SkillIdSchema = z.string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/)
  .refine((value) => !value.endsWith("."), "Skill IDs must be portable directory names.")
  .refine(
    (value) => !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value),
    "Skill IDs must not use reserved Windows device names."
  );

export const SkillVersionSchema = z.union([
  z.string().min(1).max(80).regex(/^[0-9A-Za-z][0-9A-Za-z._+-]*$/),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform((value) => String(value))
]);

export const SkillKindSchema = z.enum(["pure", "external_web", "package_provided"]);
export const SkillScopeSchema = z.enum(["built_in", "vault", "machine_local"]);
export const SkillTrustSchema = z.enum(["built_in", "user_confirmed", "package_managed"]);
export const SkillWorkflowCapabilitySchema = z.enum([
  "read_current_source",
  "suggest_note",
  "create_review_proposal"
]);
export const SkillCapabilitySchema = z.union([
  SkillWorkflowCapabilitySchema,
  PermissionCapabilitySchema
]);
export const SkillDataBoundarySchema = z.enum([
  "local",
  "filesystem",
  "network",
  "cloud",
  "brokered_credential",
  "destructive"
]);

const SkillCapabilityListSchema = z.array(SkillCapabilitySchema).min(1).max(32)
  .refine((values) => new Set(values).size === values.length, "Skill capabilities must be unique.");
const SkillDataBoundaryListSchema = z.array(SkillDataBoundarySchema).min(1).max(6)
  .refine((values) => new Set(values).size === values.length, "Skill data boundaries must be unique.");

export const SkillManifestSchema = z.object({
  id: SkillIdSchema,
  name: z.string().trim().min(1).max(120),
  version: SkillVersionSchema,
  description: z.string().trim().min(1).max(500),
  scope: SkillScopeSchema,
  kind: SkillKindSchema.default("pure"),
  capabilities: SkillCapabilityListSchema,
  triggers: z.array(z.string().trim().min(1).max(120)).max(32).optional(),
  author: z.string().trim().min(1).max(120).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
  license: z.string().trim().min(1).max(120).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  dataBoundary: SkillDataBoundaryListSchema.optional(),
  permissionSummary: z.string().trim().min(1).max(500).optional()
}).strict().superRefine((manifest, context) => {
  const permissionCapabilities = manifest.capabilities.filter((capability) =>
    PermissionCapabilitySchema.safeParse(capability).success
  );
  if (manifest.kind === "pure" && permissionCapabilities.length > 0) {
    context.addIssue({
      code: "custom",
      message: "Pure Skills cannot declare permission-mediated runtime capabilities.",
      path: ["capabilities"]
    });
  }
  if (manifest.kind === "external_web" && permissionCapabilities.length === 0) {
    context.addIssue({
      code: "custom",
      message: "External/Web Skills must declare at least one permission-mediated capability.",
      path: ["capabilities"]
    });
  }
});

export const SkillRegistryRecordSchema = z.object({
  id: SkillIdSchema,
  version: z.string().min(1).max(80).regex(/^[0-9A-Za-z][0-9A-Za-z._+-]*$/),
  manifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  enabled: z.boolean(),
  trust: SkillTrustSchema,
  installedAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export const SkillRegistryFileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  skills: z.array(SkillRegistryRecordSchema).max(512)
}).strict().superRefine((registry, context) => {
  const ids = new Set<string>();
  for (const [index, skill] of registry.skills.entries()) {
    if (ids.has(skill.id)) {
      context.addIssue({ code: "custom", message: "Skill IDs must be unique.", path: ["skills", index, "id"] });
    }
    ids.add(skill.id);
  }
});

export const SkillSummarySchema = z.object({
  id: SkillIdSchema,
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  scope: SkillScopeSchema,
  kind: SkillKindSchema,
  enabled: z.boolean(),
  trust: SkillTrustSchema,
  capabilities: SkillCapabilityListSchema,
  dataBoundaries: SkillDataBoundaryListSchema,
  author: z.string().min(1).max(120).optional(),
  license: z.string().min(1).max(120).optional()
}).strict();

export const SkillRegistrySummarySchema = z.object({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  invalidManifestCount: z.number().int().nonnegative().max(512),
  skills: z.array(SkillSummarySchema).max(512)
}).strict();

export const SkillDisableRequestSchema = z.object({
  apiVersion: z.literal(1),
  skillId: SkillIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();

const SkillRegistryErrorSummarySchema = PigeErrorCoreSchema.strict()
  .superRefine(requireErrorDomainMatchesCode);

export const SkillRegistryQueryResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), registry: SkillRegistrySummarySchema }).strict(),
  z.object({ status: z.literal("failed"), error: SkillRegistryErrorSummarySchema }).strict()
]);

export const SkillRegistryMutationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("committed"), registry: SkillRegistrySummarySchema }).strict(),
  z.object({ status: z.literal("stale"), registry: SkillRegistrySummarySchema }).strict(),
  z.object({ status: z.literal("not_found"), registry: SkillRegistrySummarySchema }).strict(),
  z.object({ status: z.literal("failed"), error: SkillRegistryErrorSummarySchema }).strict()
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

export const PermissionDataBoundarySchema = z.enum([
  "local",
  "filesystem",
  "network",
  "cloud",
  "brokered_credential",
  "destructive"
]);

const PermissionSha256HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const PermissionStableIdSchema = z.string()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]+$/);
const PermissionVersionSchema = z.string()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const PermissionPolicyContextIdSchema = z.string()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]+$/);
export const PermissionActionBindingSchema = z.object({
  vaultId: VaultIdSchema,
  jobId: JobIdSchema,
  actorType: PermissionActorTypeSchema,
  actorId: PermissionStableIdSchema,
  actorVersion: PermissionVersionSchema,
  actorDigest: PermissionSha256HashSchema,
  actionId: PermissionStableIdSchema,
  actionVersion: PermissionVersionSchema,
  actionInputHash: PermissionSha256HashSchema,
  capability: PermissionCapabilitySchema,
  dataBoundary: PermissionDataBoundarySchema,
  resourceScope: PermissionResourceScopeSchema,
  resourceIdentityHash: PermissionSha256HashSchema,
  policyContextId: PermissionPolicyContextIdSchema,
  policyHash: PermissionSha256HashSchema,
  runtimeKind: z.enum(["desktop_local", "remote_agent_backend"]),
  clientCapabilityTier: z.enum(["desktop_full", "web_client", "mobile_lite"]),
  bindingHash: PermissionSha256HashSchema
}).strict();

export const ExternalMutationIntentIdSchema = z.string().regex(/^extmut_\d{8}_[a-z0-9]{12,}$/);
export const ExternalMutationIntentSchema = z.object({
  id: ExternalMutationIntentIdSchema,
  schemaVersion: z.literal(2),
  revision: z.number().int().positive(),
  state: z.enum([
    "planned",
    "published",
    "operation_committed",
    "completed",
    "failed_no_effect",
    "cancelled",
    "failed_uncertain"
  ]),
  vaultId: VaultIdSchema,
  jobId: JobIdSchema,
  toolCallId: z.string().min(1).max(256),
  bindingHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  policyContextId: z.string().min(1),
  policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  targetPath: z.string().min(1),
  targetLeafName: z.string().min(1).max(255),
  parentIdentityHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  stagePath: z.string().min(1),
  targetResourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  byteLength: z.number().int().nonnegative().max(48 * 1_024),
  operationId: OperationIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict().superRefine((intent, context) => {
  if (Date.parse(intent.updatedAt) < Date.parse(intent.createdAt)) {
    context.addIssue({
      code: "custom",
      path: ["updatedAt"],
      message: "An external mutation intent cannot be updated before it is created."
    });
  }
  for (const key of ["targetPath", "stagePath"] as const) {
    const value = intent[key];
    if (value.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(value)) {
      context.addIssue({
        code: "custom",
        path: [key],
        message: "An external mutation intent path is invalid."
      });
    }
  }
  if (
    intent.targetLeafName === "." || intent.targetLeafName === ".." ||
    /[\\/\u0000-\u001f\u007f]/u.test(intent.targetLeafName)
  ) {
    context.addIssue({
      code: "custom",
      path: ["targetLeafName"],
      message: "An external mutation target leaf is invalid."
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

export const ModelEgressOutcomeSchema = z.enum(["allow", "block"]);

export const ModelEgressReasonCodeSchema = z.enum([
  "verified_local",
  "ordinary_external_allowed",
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
  policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
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
  let expectedOutcome: "allow" | "block";
  let expectedReason:
    | "verified_local"
    | "ordinary_external_allowed"
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
  } else if (
    decision.cloudBoundary === "local" ||
    (decision.cloudBoundary === "unknown" && decision.boundaryVerification !== "user_asserted")
  ) {
    expectedOutcome = "block";
    expectedReason = "unknown_boundary_confirmation";
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

export const WindowLayoutSurfaceSchema = z.enum(["home", "reader"]);

export const WindowPanePresentationSchema = z.enum(["closed", "resident", "overlay"]);

export const WindowLayoutRequestSchema = z.object({
  apiVersion: z.literal(1),
  surface: WindowLayoutSurfaceSchema,
  sidebarOpen: z.boolean(),
  noteAgentOpen: z.boolean()
}).strict().superRefine((request, context) => {
  if (request.surface === "home" && request.noteAgentOpen) {
    context.addIssue({
      code: "custom",
      path: ["noteAgentOpen"],
      message: "The current-note Agent pane requires the reader surface."
    });
  }
});

export const WindowLayoutStateSchema = z.object({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  surface: WindowLayoutSurfaceSchema,
  sidebarOpen: z.boolean(),
  noteAgentOpen: z.boolean(),
  sidebarPresentation: WindowPanePresentationSchema,
  noteAgentPresentation: WindowPanePresentationSchema,
  autoExpanded: z.boolean(),
  isMaximized: z.boolean(),
  isFullScreen: z.boolean()
}).strict().superRefine((state, context) => {
  if (state.surface === "home" && state.noteAgentOpen) {
    context.addIssue({
      code: "custom",
      path: ["noteAgentOpen"],
      message: "The current-note Agent pane requires the reader surface."
    });
  }
  if (!state.sidebarOpen && state.sidebarPresentation !== "closed") {
    context.addIssue({
      code: "custom",
      path: ["sidebarPresentation"],
      message: "A closed Library pane cannot have a resident or overlay presentation."
    });
  }
  if (state.sidebarOpen && state.sidebarPresentation === "closed") {
    context.addIssue({
      code: "custom",
      path: ["sidebarPresentation"],
      message: "An open Library pane requires a resident or overlay presentation."
    });
  }
  if (!state.noteAgentOpen && state.noteAgentPresentation !== "closed") {
    context.addIssue({
      code: "custom",
      path: ["noteAgentPresentation"],
      message: "A closed Note Agent pane cannot have a resident or overlay presentation."
    });
  }
  if (state.noteAgentOpen && state.noteAgentPresentation === "closed") {
    context.addIssue({
      code: "custom",
      path: ["noteAgentPresentation"],
      message: "An open Note Agent pane requires a resident or overlay presentation."
    });
  }
  if (
    state.sidebarOpen &&
    state.noteAgentOpen &&
    state.sidebarPresentation === "overlay" &&
    state.noteAgentPresentation === "resident"
  ) {
    context.addIssue({
      code: "custom",
      path: ["noteAgentPresentation"],
      message: "A constrained layout must fall back the Note Agent before the Library."
    });
  }
});

export const WindowSizeSchema = z.object({
  width: z.number().int().min(320).max(4096),
  height: z.number().int().min(420).max(4096)
});

export const WindowPreferencesSchema = z.object({
  mode: WindowLayoutModeSchema,
  alwaysOnTop: z.boolean(),
  sidebarOpen: z.boolean(),
  noteAgentOpen: z.boolean().optional(),
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

export const InVaultSourceAssetRootSchema = z.string()
  .min(1)
  .max(240)
  .superRefine((value, context) => {
    const segments = value.split("/");
    if (
      value !== value.trim() ||
      value === "." ||
      value === ".." ||
      value.startsWith("/") ||
      value.includes("\\") ||
      /^[A-Za-z]:/u.test(value) ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      context.addIssue({
        code: "custom",
        message: "The in-vault source asset root must be a canonical portable relative path."
      });
    }
  });

export const VaultRevealTargetSchema = z.enum(["knowledge_root", "source_asset_root"]);

export const VaultConfigSchema = z.object({
  schemaVersion: z.literal(1),
  sourceStorage: z.object({
    defaultStrategy: SourceStorageStrategySchema,
    sourceAssetRootKind: SourceAssetRootKindSchema,
    inVaultSourceAssetRoot: InVaultSourceAssetRootSchema
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

export const UpdateChannelSchema = z.literal("alpha");
export const UpdateCapabilitySchema = z.enum([
  "development",
  "unsupported_platform",
  "packaged_ready"
]);
export const UpdatePhaseSchema = z.enum([
  "idle",
  "checking",
  "up_to_date",
  "available",
  "failed"
]);
export const UpdateCheckRequestIdSchema = z.string().regex(/^updatereq_[a-z0-9]{16,64}$/u);
export const UpdateVersionSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u);

const UpdateTerminalStateSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("up_to_date"),
    checkedAt: z.string().datetime({ offset: true })
  }).strict(),
  z.object({
    phase: z.literal("available"),
    availableVersion: UpdateVersionSchema,
    checkedAt: z.string().datetime({ offset: true })
  }).strict(),
  z.object({
    phase: z.literal("failed"),
    checkedAt: z.string().datetime({ offset: true })
  }).strict()
]);

export const UpdateMachineSettingsSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  channel: UpdateChannelSchema,
  lastCheck: UpdateTerminalStateSchema.optional()
}).strict();

const UpdateSummaryBaseSchema = z.object({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  channel: UpdateChannelSchema,
  capability: UpdateCapabilitySchema,
  currentVersion: UpdateVersionSchema
}).strict();

export const UpdateSummarySchema = z.discriminatedUnion("phase", [
  UpdateSummaryBaseSchema.extend({ phase: z.literal("idle") }).strict(),
  UpdateSummaryBaseSchema.extend({ phase: z.literal("checking") }).strict(),
  UpdateSummaryBaseSchema.extend({
    phase: z.literal("up_to_date"),
    checkedAt: z.string().datetime({ offset: true })
  }).strict(),
  UpdateSummaryBaseSchema.extend({
    phase: z.literal("available"),
    availableVersion: UpdateVersionSchema,
    checkedAt: z.string().datetime({ offset: true })
  }).strict(),
  UpdateSummaryBaseSchema.extend({
    phase: z.literal("failed"),
    checkedAt: z.string().datetime({ offset: true })
  }).strict()
]);

export const UpdateCheckRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: UpdateCheckRequestIdSchema
}).strict();

export const UpdateCheckResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("checked"),
    requestId: UpdateCheckRequestIdSchema,
    summary: UpdateSummarySchema
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    requestId: UpdateCheckRequestIdSchema,
    summary: UpdateSummarySchema
  }).strict(),
  z.object({
    status: z.literal("busy"),
    requestId: UpdateCheckRequestIdSchema,
    summary: UpdateSummarySchema
  }).strict(),
  z.object({
    status: z.literal("stale"),
    requestId: UpdateCheckRequestIdSchema,
    summary: UpdateSummarySchema
  }).strict()
]);

export const UpdateStatusEventSchema = z.object({
  apiVersion: z.literal(1),
  requestId: UpdateCheckRequestIdSchema,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  summary: UpdateSummarySchema
}).strict();

export const MachineLocalSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  activeVaultPath: z.string().min(1).optional(),
  appLocale: LocaleSchema.optional(),
  window: WindowPreferencesSchema.optional(),
  updates: UpdateMachineSettingsSchema.optional(),
  dismissedFirstHomeVaultIds: z.array(VaultIdSchema).max(32).optional(),
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

export const OpenRecentVaultRequestSchema = z.object({
  vaultId: VaultIdSchema
}).strict();

const VaultCountsProjectionSchema = z.object({
  notes: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
  managedSourceCopies: z.number().int().nonnegative(),
  referencedOriginals: z.number().int().nonnegative()
}).strict();

export const VaultSummaryProjectionSchema = z.object({
  vaultId: VaultIdSchema,
  name: z.string().min(1),
  activeVaultPathDisplay: z.string().min(1),
  knowledgeRootDisplay: z.string().min(1),
  sourceAssetRootDisplay: z.string().min(1),
  sourceAssetRootKind: SourceAssetRootKindSchema,
  defaultSourceStorageStrategy: SourceStorageStrategySchema,
  schemaVersion: z.number().int().positive(),
  counts: VaultCountsProjectionSchema.optional(),
  lastBackupAt: z.string().datetime({ offset: true }).optional()
}).strict();

const WaitingDependencyCountsProjectionSchema = z.object({
  modelProvider: z.number().int().nonnegative(),
  localTool: z.number().int().nonnegative(),
  localModel: z.number().int().nonnegative(),
  runtimeCapability: z.number().int().nonnegative(),
  vaultBinding: z.number().int().nonnegative(),
  externalSource: z.number().int().nonnegative()
}).strict();

export const OnboardingStatusProjectionSchema = z.object({
  state: z.enum(["blocked_no_vault", "ready"]),
  activeVault: VaultSummaryProjectionSchema.optional(),
  hasDefaultModel: z.boolean(),
  showFirstHomeGuide: z.boolean(),
  waitingDependencyCounts: WaitingDependencyCountsProjectionSchema.optional()
}).strict();

export const VaultActionResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    vault: VaultSummaryProjectionSchema,
    onboarding: OnboardingStatusProjectionSchema
  }).strict(),
  z.object({ status: z.literal("canceled") }).strict()
]);

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

export const SourceSemanticOrchestrationSchema = z.enum([
  "legacy_agent_ingest",
  "capture_only",
  "agent_turn"
]);

const CurrentSourceSemanticOrchestrationSchema = z.literal("agent_turn");

const SourceRecordObjectSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: SourceIdSchema,
  kind: SourceKindSchema,
  storageStrategy: SourceStorageStrategySchema,
  semanticOrchestration: SourceSemanticOrchestrationSchema,
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
}).passthrough();

function refineSourceRecord(
  record: z.infer<typeof SourceRecordObjectSchema>,
  context: z.RefinementCtx
): void {
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
}

const ParsedSourceRecordSchema = SourceRecordObjectSchema.superRefine(refineSourceRecord);

/**
 * Reads durable v1 SourceRecords. Records created before semantic-orchestration
 * ownership was explicit are normalized to the historical compatibility lane.
 */
export const SourceRecordSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.semanticOrchestration !== undefined) return value;
  return { ...record, semanticOrchestration: "legacy_agent_ingest" };
}, ParsedSourceRecordSchema);

/** New SourceRecord writes must never enter the historical compatibility lane. */
export const CurrentSourceRecordSchema = SourceRecordObjectSchema.extend({
  semanticOrchestration: CurrentSourceSemanticOrchestrationSchema
}).superRefine(refineSourceRecord);

export const DatasetLogicalTypeSchema = z.enum([
  "string",
  "integer",
  "number",
  "boolean",
  "date",
  "datetime",
  "binary",
  "unknown"
]);

export const DatasetColumnSchema = z.object({
  id: ColumnIdSchema,
  name: z.string().min(1).max(512),
  sourceName: z.string().max(512).optional(),
  ordinal: z.number().int().nonnegative(),
  sourceType: z.string().min(1).max(160),
  sourceTypes: z.array(z.string().min(1).max(160)).max(64).optional(),
  sourceMetadata: z.record(
    z.string().min(1).max(120),
    z.union([z.string().max(4096), z.number().finite(), z.boolean()])
  ).optional(),
  logicalType: DatasetLogicalTypeSchema,
  nullable: z.boolean(),
  stats: z.object({
    missing: z.number().int().nonnegative(),
    empty: z.number().int().nonnegative(),
    null: z.number().int().nonnegative(),
    value: z.number().int().nonnegative()
  }).strict().optional()
}).strict();

export const DatasetTableSchema = z.object({
  id: TableIdSchema,
  name: z.string().min(1).max(512),
  sourceLocator: z.string().min(1).max(1024),
  sourceMetadata: z.record(
    z.string().min(1).max(120),
    z.union([z.string().max(4096), z.number().finite(), z.boolean()])
  ).optional(),
  header: z.object({
    mode: z.enum(["auto", "present", "absent"]),
    used: z.boolean(),
    sourceRow: z.number().int().positive().optional()
  }).strict().optional(),
  ordinal: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  columns: z.array(DatasetColumnSchema).max(4096)
}).strict().superRefine((table, context) => {
  if (table.columnCount !== table.columns.length) {
    context.addIssue({
      code: "custom",
      path: ["columnCount"],
      message: "Dataset table columnCount must match the number of declared columns."
    });
  }
  const ordinals = new Set(table.columns.map((column) => column.ordinal));
  if (ordinals.size !== table.columns.length) {
    context.addIssue({ code: "custom", path: ["columns"], message: "Dataset column ordinals must be unique." });
  }
});

export const DatasetSchemaRecordSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: DatasetIdSchema,
  revisionId: DatasetRevisionIdSchema,
  tables: z.array(DatasetTableSchema).min(1).max(1024),
  createdAt: z.string().datetime({ offset: true })
}).passthrough();

const DatasetFileRefSchema = z.object({
  path: z.string().min(1).max(1024),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  size: z.number().int().nonnegative()
}).strict();

export const DatasetRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  id: DatasetRevisionIdSchema,
  datasetId: DatasetIdSchema,
  parentRevisionId: DatasetRevisionIdSchema.nullable(),
  source: z.object({
    sourceId: SourceIdSchema,
    sourceKind: z.enum(["csv_file", "xlsx_file", "sqlite_file"]),
    sourceRecordHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sourceAssetChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    sourceAssetSize: z.number().int().nonnegative()
  }).strict(),
  schema: DatasetFileRefSchema,
  payload: DatasetFileRefSchema.extend({ format: z.literal("sqlite") }).strict(),
  adapter: z.object({ id: z.string().min(1).max(120), version: z.string().min(1).max(80) }).strict(),
  writer: z.object({ id: z.string().min(1).max(120), version: z.string().min(1).max(80) }).strict(),
  stats: z.object({
    tableCount: z.number().int().nonnegative(),
    rowCount: z.number().int().nonnegative(),
    columnCount: z.number().int().nonnegative(),
    cellCount: z.number().int().nonnegative(),
    retainedValueBytes: z.number().int().nonnegative()
  }).strict(),
  warnings: z.array(z.string().min(1).max(160)).max(64),
  operationId: OperationIdSchema,
  createdAt: z.string().datetime({ offset: true })
}).passthrough();

export const DatasetManifestSchema = z.object({
  format: z.literal("pige-dataset"),
  formatVersion: z.literal(1),
  datasetId: DatasetIdSchema,
  profile: z.literal("managed_collection"),
  title: z.string().min(1).max(240),
  sourceId: SourceIdSchema,
  activeRevision: DatasetRevisionIdSchema,
  revision: DatasetFileRefSchema,
  schema: DatasetFileRefSchema,
  payload: DatasetFileRefSchema.extend({ format: z.literal("sqlite") }).strict(),
  compatibility: z.object({
    minReaderFormatVersion: z.literal(1),
    maxReaderFormatVersion: z.literal(1)
  }).strict(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).passthrough();

const Sha256HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const DatasetQueryCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const DatasetCitationRefIdSchema = z.string().min(1).max(64);
const DatasetQueryDatasetIdSchema = DatasetIdSchema.max(128);
const DatasetQueryRevisionIdSchema = DatasetRevisionIdSchema.max(128);
const DatasetQueryTableIdSchema = TableIdSchema.max(128);
const DatasetQueryColumnIdSchema = ColumnIdSchema.max(128);
const DatasetQueryRowIdSchema = RowIdSchema.max(128);
const DatasetQuerySourceIdSchema = SourceIdSchema.max(128);
const DatasetQueryTextSchema = z.string().max(4096).refine(
  (value) => new TextEncoder().encode(value).byteLength <= 4096,
  "Dataset query text must not exceed 4096 UTF-8 bytes."
);

export const DatasetQueryScalarSchema = z.union([
  DatasetQueryTextSchema,
  z.number().finite(),
  z.boolean(),
  z.null()
]);

const DatasetEvidenceRangeSchema = z.object({
  startRow: DatasetQueryCountSchema,
  endRow: DatasetQueryCountSchema
}).strict().superRefine((range, context) => {
  if (range.endRow < range.startRow) {
    context.addIssue({
      code: "custom",
      path: ["endRow"],
      message: "Dataset evidence range endRow must not precede startRow."
    });
  }
});

export const DatasetEvidenceRefSchema = z.object({
  datasetId: DatasetQueryDatasetIdSchema,
  revisionId: DatasetQueryRevisionIdSchema,
  tableId: DatasetQueryTableIdSchema,
  schemaId: Sha256HashSchema,
  columnIds: z.array(DatasetQueryColumnIdSchema).min(1).max(24),
  rowIds: z.array(DatasetQueryRowIdSchema).min(1).max(50).optional(),
  range: DatasetEvidenceRangeSchema.optional(),
  queryPlanHash: Sha256HashSchema,
  resultHash: Sha256HashSchema,
  sourceId: DatasetQuerySourceIdSchema,
  sourceRevisionHash: Sha256HashSchema
}).strict().superRefine((evidence, context) => {
  if (new Set(evidence.columnIds).size !== evidence.columnIds.length) {
    context.addIssue({
      code: "custom",
      path: ["columnIds"],
      message: "Dataset evidence column IDs must be unique."
    });
  }
  if (evidence.rowIds && new Set(evidence.rowIds).size !== evidence.rowIds.length) {
    context.addIssue({
      code: "custom",
      path: ["rowIds"],
      message: "Dataset evidence row IDs must be unique."
    });
  }
});

const RetrievalVaultIdSchema = VaultIdSchema.max(128);
const RetrievalPageIdSchema = PageIdSchema.max(128);
const RetrievalSourceIdSchema = SourceIdSchema.max(128);
const RetrievalRelativePagePathSchema = z.string().min(1).max(1_024).refine((value) => {
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  const segments = value.split("/");
  return (
    (segments[0] === "wiki" || segments[0] === "sources") &&
    segments.length >= 2 &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..") &&
    (segments.at(-1)?.toLocaleLowerCase("en-US").endsWith(".md") ?? false)
  );
}, "Retrieval page paths must identify a vault Markdown page.");

export const RetrievalSearchScopeSchema = z.object({
  kind: z.literal("active_vault"),
  vaultId: RetrievalVaultIdSchema
}).strict();

export const RetrievalSearchRequestSchema = z.object({
  scope: RetrievalSearchScopeSchema,
  query: z.string().trim().min(1).refine(
    (value) => Array.from(value).length <= 320,
    "Retrieval queries must contain at most 320 Unicode characters."
  ),
  limit: z.number().int().min(1).max(20).optional(),
  pageTypes: z.array(MarkdownPageTypeSchema).max(7).readonly().optional()
}).strict();

export const RetrievalSearchPageSummarySchema = z.object({
  pageId: RetrievalPageIdSchema,
  title: z.string().min(1).max(240),
  pageType: MarkdownPageTypeSchema,
  status: MarkdownPageStatusSchema,
  pagePath: RetrievalRelativePagePathSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  language: z.string().min(1).max(64).optional(),
  sourceIds: z.array(RetrievalSourceIdSchema).max(128).readonly()
}).strict().transform((summary) => {
  if (summary.language !== undefined) return { ...summary, language: summary.language };
  const { language: _language, ...withoutLanguage } = summary;
  return withoutLanguage;
});

export const RetrievalSearchResultItemSchema = z.object({
  summary: RetrievalSearchPageSummarySchema,
  score: z.number().finite(),
  snippets: z.array(z.string().max(260)).max(3).readonly(),
  matchReasons: z.array(z.string().min(1).max(80)).max(8).readonly()
}).strict();

export const RetrievalSearchResultSchema = z.object({
  searchedAt: z.string().datetime({ offset: true }),
  activeVaultId: RetrievalVaultIdSchema,
  query: z.string().trim().min(1).refine(
    (value) => Array.from(value).length <= 320,
    "Retrieval queries must contain at most 320 Unicode characters."
  ),
  mode: z.enum(["lexical_markdown_scan", "lexical_sqlite_fts"]),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  invalidPageCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  degraded: z.boolean(),
  degradedReason: z.enum(["local_database_not_ready", "local_rag_not_installed"]).optional(),
  results: z.array(RetrievalSearchResultItemSchema).max(20).readonly()
}).strict();

export const RetrievalAnswerCitationSchema = z.object({
  refId: z.string().min(1).max(64),
  label: z.string().min(1).max(160),
  pageId: PageIdSchema,
  title: z.string().min(1).max(240),
  pageType: MarkdownPageTypeSchema,
  locator: CitationLocatorSchema
}).strict();

export const DatasetAnswerCitationSchema = z.object({
  kind: z.literal("dataset"),
  refId: DatasetCitationRefIdSchema,
  label: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  locator: CitationLocatorSchema,
  evidence: DatasetEvidenceRefSchema
}).strict();

export const AgentAnswerCitationSchema = z.union([
  RetrievalAnswerCitationSchema,
  DatasetAnswerCitationSchema
]);

const AgentAnswerCitationsSchema = z.array(AgentAnswerCitationSchema).max(8);

export const DatasetQueryPreviewColumnSchema = z.object({
  key: z.string().min(1).max(120),
  label: z.string().min(1).max(512),
  logicalType: DatasetLogicalTypeSchema,
  sourceColumnId: DatasetQueryColumnIdSchema.optional(),
  aggregate: z.string().min(1).max(120).optional()
}).strict();

export const DatasetQueryPreviewRowSchema = z.object({
  rowId: DatasetQueryRowIdSchema.optional(),
  values: z.array(DatasetQueryScalarSchema).max(32)
}).strict();

export const DatasetQueryPreviewSchema = z.object({
  datasetId: DatasetQueryDatasetIdSchema,
  revisionId: DatasetQueryRevisionIdSchema,
  tableId: DatasetQueryTableIdSchema,
  tableName: z.string().min(1).max(512),
  planHash: Sha256HashSchema,
  resultHash: Sha256HashSchema,
  columns: z.array(DatasetQueryPreviewColumnSchema).min(1).max(32),
  rows: z.array(DatasetQueryPreviewRowSchema).max(50),
  matchedRowCount: DatasetQueryCountSchema,
  returnedRowCount: DatasetQueryCountSchema,
  truncated: z.boolean(),
  citationRefs: z.array(DatasetCitationRefIdSchema).min(1).max(8)
}).strict().superRefine((preview, context) => {
  if (preview.returnedRowCount !== preview.rows.length) {
    context.addIssue({
      code: "custom",
      path: ["returnedRowCount"],
      message: "Dataset preview returnedRowCount must match the number of rows."
    });
  }
  if (preview.matchedRowCount < preview.returnedRowCount) {
    context.addIssue({
      code: "custom",
      path: ["matchedRowCount"],
      message: "Dataset preview matchedRowCount must include every returned row."
    });
  }
  if (preview.truncated !== (preview.matchedRowCount > preview.returnedRowCount)) {
    context.addIssue({
      code: "custom",
      path: ["truncated"],
      message: "Dataset preview truncation must agree with matched and returned row counts."
    });
  }
  if (new Set(preview.columns.map((column) => column.key)).size !== preview.columns.length) {
    context.addIssue({
      code: "custom",
      path: ["columns"],
      message: "Dataset preview column keys must be unique."
    });
  }
  const rowIds = preview.rows.flatMap((row) => row.rowId === undefined ? [] : [row.rowId]);
  if (new Set(rowIds).size !== rowIds.length) {
    context.addIssue({
      code: "custom",
      path: ["rows"],
      message: "Dataset preview row IDs must be unique when present."
    });
  }
  if (new Set(preview.citationRefs).size !== preview.citationRefs.length) {
    context.addIssue({
      code: "custom",
      path: ["citationRefs"],
      message: "Dataset preview citation refs must be unique."
    });
  }
  if (new TextEncoder().encode(JSON.stringify(preview)).byteLength > 64 * 1024) {
    context.addIssue({
      code: "custom",
      path: [],
      message: "Dataset preview must not exceed 65536 UTF-8 bytes."
    });
  }
  preview.rows.forEach((row, index) => {
    if (row.values.length !== preview.columns.length) {
      context.addIssue({
        code: "custom",
        path: ["rows", index, "values"],
        message: "Dataset preview row width must match the declared columns."
      });
    }
  });
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
    "error"
  ]),
  createdAt: z.string().datetime({ offset: true }),
  clientTurnId: AgentClientTurnIdSchema.optional(),
  parentEventId: ConversationEventIdSchema.optional(),
  inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  scope: AgentTurnCurrentNoteScopeSchema.optional(),
  inputPresentation: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("reader_selection_action"),
      action: z.enum(["explain", "summarize"])
    }).strict(),
    z.object({
      kind: z.literal("reader_selection_transform"),
      action: z.enum(["translate", "polish", "expand"])
    }).strict()
  ]).optional(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  sourceId: SourceIdSchema.optional(),
  captureId: CaptureIdSchema.optional(),
  jobId: JobIdSchema.optional(),
  operationId: OperationIdSchema.optional(),
  proposalId: ProposalIdSchema.optional(),
  displayName: z.string().min(1).optional(),
  sourceKind: SourceKindSchema.optional(),
  text: z.string().optional(),
  textPreview: z.string().optional(),
  answerGrounding: z.enum([
    "general",
    "local_knowledge",
    "source",
    "insufficient_evidence"
  ]).optional(),
  answerCitations: AgentAnswerCitationsSchema.optional(),
  answerDatasetResult: DatasetQueryPreviewSchema.optional()
}).passthrough().superRefine((event, context) => {
  const citations = event.answerCitations ?? [];
  const citationRefIds = citations.map((citation) => citation.refId);
  if (new Set(citationRefIds).size !== citationRefIds.length) {
    context.addIssue({
      code: "custom",
      path: ["answerCitations"],
      message: "Assistant answer citation refs must be unique."
    });
  }

  const preview = event.answerDatasetResult;
  if (!preview) return;
  const datasetCitations = citations.filter(
    (citation): citation is z.infer<typeof DatasetAnswerCitationSchema> =>
      "kind" in citation && citation.kind === "dataset"
  );
  const datasetCitationsByRef = new Map(datasetCitations.map((citation) => [citation.refId, citation]));
  for (const [index, refId] of preview.citationRefs.entries()) {
    const citation = datasetCitationsByRef.get(refId);
    if (!citation) {
      context.addIssue({
        code: "custom",
        path: ["answerDatasetResult", "citationRefs", index],
        message: "Dataset preview citation refs must resolve to Dataset answer citations."
      });
      continue;
    }
    const evidence = citation.evidence;
    if (
      evidence.datasetId !== preview.datasetId ||
      evidence.revisionId !== preview.revisionId ||
      evidence.tableId !== preview.tableId ||
      evidence.queryPlanHash !== preview.planHash ||
      evidence.resultHash !== preview.resultHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["answerCitations", citations.indexOf(citation), "evidence"],
        message: "Dataset citation evidence must match the persisted preview identity and hashes."
      });
    }
  }
  if (datasetCitations.some((citation) => !preview.citationRefs.includes(citation.refId))) {
    context.addIssue({
      code: "custom",
      path: ["answerDatasetResult", "citationRefs"],
      message: "Every Dataset answer citation must be referenced by the persisted preview."
    });
  }
});

export const JobClassSchema = z.enum([
  "capture_batch",
  "capture",
  "parse",
  "ocr",
  "dataset_import",
  "agent_turn",
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
  "importing",
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
    "dataset",
    "dataset_revision",
    "table",
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

export const ReaderSelectionActionRequestIdSchema = z.string()
  .regex(/^readerselaction_[a-z0-9]{8,64}$/);
export const ReaderSelectionReadActionSchema = z.enum(["explain", "summarize"]);
export const ReaderSelectionActionRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: ReaderSelectionActionRequestIdSchema,
  action: ReaderSelectionReadActionSchema,
  selection: ReaderSelectionIdentitySchema,
  locale: LocaleSchema,
  clientTurnId: AgentClientTurnIdSchema
}).strict();
export const ReaderSelectionActionResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionActionRequestIdSchema,
    status: z.literal("completed"),
    jobId: JobIdSchema,
    conversationEventId: ConversationEventIdSchema,
    conversationId: ConversationIdSchema,
    tailEventId: ConversationEventIdSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionActionRequestIdSchema,
    status: z.literal("waiting"),
    jobId: JobIdSchema,
    conversationEventId: ConversationEventIdSchema,
    conversationId: ConversationIdSchema,
    tailEventId: ConversationEventIdSchema,
    error: PigeErrorSummarySchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionActionRequestIdSchema,
    status: z.literal("failed"),
    jobId: JobIdSchema.optional(),
    conversationEventId: ConversationEventIdSchema.optional(),
    conversationId: ConversationIdSchema.optional(),
    tailEventId: ConversationEventIdSchema.optional(),
    error: PigeErrorSummarySchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionActionRequestIdSchema,
    status: z.literal("invalid"),
    reason: z.enum([
      "vault_unavailable",
      "page_changed",
      "selection_changed",
      "selection_too_large"
    ])
  }).strict()
]);

export const ReaderSelectionTransformActionSchema = z.enum(["translate", "polish", "expand"]);
export const ReaderSelectionProposalIdSchema = ProposalIdSchema;
export const ReaderSelectionProposalStateSchema = z.enum([
  "ready",
  "resolving",
  "applied",
  "rejected",
  "conflicted"
]);
export const ReaderSelectionProposalLineSchema = z.object({
  kind: z.enum(["context", "removed", "added"]),
  text: z.string().min(1).max(160)
}).strict();
export const ReaderSelectionProposalPreviewSchema = z.object({
  proposalId: ReaderSelectionProposalIdSchema,
  action: ReaderSelectionTransformActionSchema,
  state: ReaderSelectionProposalStateSchema,
  revision: z.number().int().min(1),
  lines: z.array(ReaderSelectionProposalLineSchema).max(8)
}).strict();
export const ReaderSelectionTransformRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: ReaderSelectionActionRequestIdSchema,
  action: ReaderSelectionTransformActionSchema,
  selection: ReaderSelectionIdentitySchema,
  locale: LocaleSchema,
  clientTurnId: AgentClientTurnIdSchema
}).strict();
export const ReaderSelectionTransformResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionActionRequestIdSchema,
    status: z.literal("applied"),
    jobId: JobIdSchema,
    conversationEventId: ConversationEventIdSchema,
    conversationId: ConversationIdSchema,
    tailEventId: ConversationEventIdSchema,
    operationId: OperationIdSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionActionRequestIdSchema,
    status: z.literal("review_required"),
    jobId: JobIdSchema,
    conversationEventId: ConversationEventIdSchema,
    conversationId: ConversationIdSchema,
    tailEventId: ConversationEventIdSchema,
    proposal: ReaderSelectionProposalPreviewSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionActionRequestIdSchema,
    status: z.literal("waiting"),
    jobId: JobIdSchema,
    conversationEventId: ConversationEventIdSchema,
    conversationId: ConversationIdSchema,
    tailEventId: ConversationEventIdSchema,
    error: PigeErrorSummarySchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionActionRequestIdSchema,
    status: z.literal("failed"),
    jobId: JobIdSchema.optional(),
    conversationEventId: ConversationEventIdSchema.optional(),
    conversationId: ConversationIdSchema.optional(),
    tailEventId: ConversationEventIdSchema.optional(),
    error: PigeErrorSummarySchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionActionRequestIdSchema,
    status: z.literal("invalid"),
    reason: z.enum([
      "vault_unavailable",
      "page_changed",
      "selection_changed",
      "selection_too_large",
      "mutation_ineligible",
      "replacement_invalid"
    ])
  }).strict()
]);

export const ReaderSelectionProposalGetRequestSchema = z.object({
  apiVersion: z.literal(1),
  proposalId: ReaderSelectionProposalIdSchema
}).strict();
export const ReaderSelectionProposalGetResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("available"),
    proposal: ReaderSelectionProposalPreviewSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("unavailable"),
    reason: z.enum(["not_found", "vault_changed", "record_invalid"])
  }).strict()
]);
export const ReaderSelectionProposalDecisionRequestSchema = z.object({
  apiVersion: z.literal(1),
  proposalId: ReaderSelectionProposalIdSchema,
  expectedRevision: z.number().int().min(1),
  decision: z.enum(["approve", "reject"])
}).strict();
export const ReaderSelectionProposalDecisionResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("applied"),
    proposal: ReaderSelectionProposalPreviewSchema,
    operationId: OperationIdSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("rejected"),
    proposal: ReaderSelectionProposalPreviewSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("conflicted"),
    proposal: ReaderSelectionProposalPreviewSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("stale"),
    proposal: ReaderSelectionProposalPreviewSchema.optional()
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("failed"),
    error: PigeErrorSummarySchema
  }).strict()
]);

export const VaultRevealResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("revealed"),
    target: VaultRevealTargetSchema
  }).strict(),
  z.object({
    status: z.literal("failed"),
    target: VaultRevealTargetSchema,
    error: z.object({
      code: z.literal("vault.reveal_failed"),
      domain: z.literal("vault"),
      messageKey: z.literal("errors.vault.reveal_failed"),
      retryable: z.literal(true),
      severity: z.literal("warning"),
      userAction: z.literal("retry")
    }).strict()
  }).strict()
]);

export const SpeechRequestIdSchema = z.string().regex(/^speechreq_[a-z0-9]{16,64}$/);
export const SpeechSessionIdSchema = z.string().regex(/^speech_[a-z0-9]{16,64}$/);
export const SpeechAssetRequestIdSchema = z.string().regex(/^speechasset_[a-z0-9]{16,64}$/);
export const SpeechAssetInstallationIdSchema = z.string().regex(/^speechinstall_[a-z0-9]{16,64}$/);
export const SpeechLanguageTagSchema = z.string()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/);
export const SpeechPermissionStateSchema = z.enum([
  "not-determined",
  "granted",
  "denied",
  "restricted"
]);
export const SpeechUnavailableReasonSchema = z.enum([
  "unsupported_platform",
  "unsupported_os_version",
  "language_unavailable",
  "assets_unavailable",
  "service_unavailable"
]);

const SpeechErrorSummarySchema = z.object({
  code: PigeErrorCodeSchema.refine((code) => code.startsWith("speech.")),
  domain: z.literal("speech"),
  messageKey: PigeMessageKeySchema,
  retryable: z.boolean(),
  severity: PigeErrorSeveritySchema,
  userAction: PigeErrorActionSchema
}).strict();

export const SpeechAvailabilityRequestSchema = z.object({
  languageTag: SpeechLanguageTagSchema
}).strict();

export const SpeechAvailabilityResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("supported"),
    languageTag: SpeechLanguageTagSchema,
    permission: SpeechPermissionStateSchema,
    canOpenSystemSettings: z.boolean()
  }).strict(),
  z.object({
    status: z.literal("unsupported"),
    reason: SpeechUnavailableReasonSchema,
    canOpenSystemSettings: z.literal(false)
  }).strict(),
  z.object({
    status: z.literal("failed"),
    error: SpeechErrorSummarySchema
  }).strict()
]);

export const SpeechStartRequestSchema = z.object({
  requestId: SpeechRequestIdSchema,
  languageTag: SpeechLanguageTagSchema
}).strict();

export const SpeechAssetInstallRequestSchema = z.object({
  requestId: SpeechAssetRequestIdSchema,
  languageTag: SpeechLanguageTagSchema
}).strict();

export const SpeechAssetInstallResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("started"),
    requestId: SpeechAssetRequestIdSchema,
    installationId: SpeechAssetInstallationIdSchema,
    languageTag: SpeechLanguageTagSchema,
    metering: z.enum(["available", "unavailable"])
  }).strict(),
  z.object({
    status: z.literal("blocked"),
    requestId: SpeechAssetRequestIdSchema,
    error: SpeechErrorSummarySchema
  }).strict()
]);

const SpeechAssetInstallEventIdentitySchema = z.object({
  apiVersion: z.literal(1),
  installationId: SpeechAssetInstallationIdSchema,
  sequence: z.number().int().positive()
}).strict();

export const SpeechAssetInstallEventSchema = z.discriminatedUnion("kind", [
  SpeechAssetInstallEventIdentitySchema.extend({
    kind: z.literal("progress"),
    completedFraction: z.number().min(0).max(1)
  }).strict(),
  SpeechAssetInstallEventIdentitySchema.extend({
    kind: z.literal("installed"),
    languageTag: SpeechLanguageTagSchema
  }).strict(),
  SpeechAssetInstallEventIdentitySchema.extend({
    kind: z.literal("failed"),
    error: SpeechErrorSummarySchema
  }).strict()
]);

export const SpeechStartResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("started"),
    requestId: SpeechRequestIdSchema,
    sessionId: SpeechSessionIdSchema,
    languageTag: SpeechLanguageTagSchema,
    metering: z.enum(["available", "unavailable"])
  }).strict(),
  z.object({
    status: z.literal("blocked"),
    requestId: SpeechRequestIdSchema,
    error: SpeechErrorSummarySchema
  }).strict()
]);

export const SpeechSessionRequestSchema = z.object({
  sessionId: SpeechSessionIdSchema
}).strict();

export const SpeechCancelRequestSchema = z.union([
  z.object({ requestId: SpeechRequestIdSchema }).strict(),
  SpeechSessionRequestSchema
]);

export const SpeechStopResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("stopped"),
    sessionId: SpeechSessionIdSchema,
    sequence: z.number().int().nonnegative(),
    transcript: z.string().max(32_000)
  }).strict(),
  z.object({
    status: z.literal("stale_session"),
    sessionId: SpeechSessionIdSchema
  }).strict(),
  z.object({
    status: z.literal("failed"),
    sessionId: SpeechSessionIdSchema,
    error: SpeechErrorSummarySchema
  }).strict()
]);

export const SpeechCancelResultSchema = z.union([
  z.object({
    status: z.literal("canceled"),
    sessionId: SpeechSessionIdSchema
  }).strict(),
  z.object({
    status: z.literal("canceled"),
    requestId: SpeechRequestIdSchema
  }).strict(),
  z.object({
    status: z.literal("stale_session"),
    sessionId: SpeechSessionIdSchema
  }).strict(),
  z.object({
    status: z.literal("stale_request"),
    requestId: SpeechRequestIdSchema
  }).strict()
]);

export const SpeechOpenSystemSettingsResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("opened") }).strict(),
  z.object({ status: z.literal("unavailable") }).strict()
]);

export const SpeechTranscriptEventSchema = z.object({
  apiVersion: z.literal(1),
  kind: z.literal("transcript_replace"),
  sessionId: SpeechSessionIdSchema,
  sequence: z.number().int().positive(),
  transcript: z.string().max(32_000),
  final: z.boolean()
}).strict();

export const SpeechSessionFailureEventSchema = z.object({
  apiVersion: z.literal(1),
  kind: z.literal("session_failed"),
  sessionId: SpeechSessionIdSchema,
  sequence: z.number().int().positive(),
  error: SpeechErrorSummarySchema
}).strict();

export const SpeechMeterEventSchema = z.object({
  apiVersion: z.literal(1),
  kind: z.literal("meter"),
  sessionId: SpeechSessionIdSchema,
  sequence: z.number().int().positive(),
  elapsedMs: z.number().int().nonnegative().max(86_400_000),
  level: z.number().min(0).max(1)
}).strict();

export const SpeechSessionEventSchema = z.discriminatedUnion("kind", [
  SpeechTranscriptEventSchema,
  SpeechMeterEventSchema,
  SpeechSessionFailureEventSchema
]);

export const PigeErrorSchema = PigeErrorCoreSchema.extend({
  jobId: JobIdSchema.optional(),
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
    accessedExternalFiles: z.boolean()
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
    "dataset",
    "dataset_revision",
    "table",
    "asset",
    "memory",
    "skill",
    "package",
    "setting",
    "model",
    "permission",
    "root_binding",
    "external_resource",
    "backup",
    "operation",
    "proposal"
  ]),
  id: z.string().min(1),
  path: z.string().min(1).optional(),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional()
}).strict().superRefine((reference, context) => {
  if (reference.kind === "external_resource" && reference.path !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["path"],
      message: "External resource references must never persist machine paths."
    });
  }
});

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
    "create_dataset_revision",
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
    "migration_applied",
    "create_external_file"
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
  if (operation.kind === "create_external_file") {
    const target = operation.targetRefs[0];
    if (
      !operation.jobId ||
      !operation.policyAudit ||
      operation.targetRefs.length !== 1 ||
      target?.kind !== "external_resource" ||
      !/^sha256:[a-f0-9]{64}$/u.test(target.id) ||
      operation.sourceRefs.length !== 0 ||
      operation.before !== undefined ||
      operation.patchRef !== undefined ||
      operation.after?.kind !== "external_resource" ||
      operation.after.id !== target.id ||
      operation.after.checksum === undefined ||
      operation.reversible !== "no"
    ) {
      context.addIssue({
        code: "custom",
        path: ["kind"],
        message: "An external-file creation Operation requires one path-free audited target and checksum."
      });
    }
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
  skills: DurableSchemaVersionRangeSchema,
  datasets: DurableSchemaVersionRangeSchema.optional()
});

export const BackupExternalDependencySchema = z.object({
  kind: z.enum(["external_managed_copy_root", "external_original"]),
  rootId: RootBindingIdSchema.optional(),
  sourceId: SourceIdSchema.optional(),
  included: z.boolean(),
  requiredForCompleteRestore: z.boolean(),
  displayName: z.string().min(1).optional()
}).passthrough();

export const BackupExternalManagedCopyMappingSchema = z.object({
  sourceId: SourceIdSchema,
  rootId: RootBindingIdSchema.refine((rootId) => rootId !== "root_vault_managed", {
    message: "An external managed-copy mapping requires an external root ID."
  }),
  sourceRecordPath: z.string().min(1),
  archivePath: z.string().min(1),
  restorePath: z.string().min(1),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  restoredSourceRecordChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  restoredSourceRecordSize: z.number().int().nonnegative()
}).strict();

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
  externalManagedCopies: z.array(BackupExternalManagedCopyMappingSchema).optional(),
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
  apiKey: z.string().trim().min(1).max(16_384).optional()
}).strict();

export const AddManualProviderRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  providerKind: ProviderKindSchema,
  endpointProtocol: ProviderEndpointProtocolSchema,
  baseUrl: ProviderBaseUrlSchema.optional(),
  apiKey: z.string().trim().min(1).max(16_384),
  manualModelId: z.string().trim().min(1).max(200).optional(),
  cloudBoundary: CloudBoundarySchema
}).strict().superRefine((request, context) => {
  if (!isBuiltInProviderKind(request.providerKind) && request.baseUrl === undefined) {
    context.addIssue({
      code: "custom",
      message: "Compatible and custom providers require an explicit base URL.",
      path: ["baseUrl"],
      params: { pigeErrorCode: "model_provider.base_url_missing" }
    });
  }
});

export const SetDefaultModelRequestSchema = z.object({
  modelProfileId: z.string().regex(/^model_[a-z0-9_]+$/)
}).strict();

export const RefreshProviderModelsRequestSchema = z.object({
  providerProfileId: z.string().regex(/^provider_[a-z0-9_]+$/)
}).strict();

export const UpdateProviderCredentialRequestSchema = z.object({
  providerProfileId: z.string().regex(/^provider_[a-z0-9_]+$/),
  expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  apiKey: z.string().trim().min(1).max(16_384)
}).strict();

export const DeleteProviderRequestSchema = z.object({
  providerProfileId: z.string().regex(/^provider_[a-z0-9_]+$/),
  expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/)
}).strict();

export const AddManualModelRequestSchema = z.object({
  providerProfileId: z.string().regex(/^provider_[a-z0-9_]+$/),
  modelId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u),
  displayName: z.string().trim().min(1).max(200).optional()
}).strict();

export const UpdateModelRequestSchema = z.object({
  modelProfileId: z.string().regex(/^model_[a-z0-9_]+$/),
  enabled: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(200).nullable().optional()
}).strict().refine(
  (request) => request.enabled !== undefined || request.displayName !== undefined,
  { message: "Model update requires an enabled state or display name." }
);

const ProviderProfileCurrentSchema = z.object({
  id: z.string().regex(/^provider_[a-z0-9_]+$/),
  presetId: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/u).optional(),
  displayName: z.string().min(1),
  providerKind: ProviderKindSchema,
  endpointProtocol: ProviderEndpointProtocolSchema,
  baseUrl: ProviderBaseUrlSchema.optional(),
  authRequirement: ProviderAuthRequirementSchema,
  authSecretRef: z.string().regex(/^provider_secret_[a-z0-9_]+$/).optional(),
  modelListStrategy: ModelListStrategySchema,
  cloudBoundary: CloudBoundarySchema,
  boundaryVerification: BoundaryVerificationSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).superRefine((profile, context) => {
  if (profile.authRequirement === "api_key" && profile.authSecretRef === undefined) {
    context.addIssue({
      code: "custom",
      message: "API-key Provider Profiles require a secret reference.",
      path: ["authSecretRef"]
    });
  }
  if (profile.authRequirement === "none" && profile.authSecretRef !== undefined) {
    context.addIssue({
      code: "custom",
      message: "No-auth Provider Profiles cannot persist a secret reference.",
      path: ["authSecretRef"]
    });
  }
  const builtIn = isBuiltInProviderKind(profile.providerKind);
  const loopback = profile.baseUrl !== undefined && isProviderLoopbackHostname(new URL(profile.baseUrl).hostname);

  const requiredBuiltInProtocol = profile.providerKind === "openai"
    ? "openai_responses"
    : profile.providerKind === "anthropic"
      ? "anthropic_messages"
      : undefined;
  if (requiredBuiltInProtocol && profile.endpointProtocol !== requiredBuiltInProtocol) {
    context.addIssue({
      code: "custom",
      message: "The built-in provider protocol does not match its reviewed endpoint.",
      path: ["endpointProtocol"],
      params: { pigeErrorCode: "model_provider.protocol_mismatch" }
    });
  }

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

  if (profile.baseUrl === undefined) {
    context.addIssue({
      code: "custom",
      message: "Compatible and custom provider profiles require an explicit base URL.",
      path: ["baseUrl"],
      params: { pigeErrorCode: "model_provider.base_url_missing" }
    });
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

export const ProviderProfileSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const providerKind = "providerKind" in value ? value.providerKind : undefined;
  const endpointProtocol = "endpointProtocol" in value
    ? value.endpointProtocol
    : providerKind === "openai"
      ? "openai_responses"
      : providerKind === "anthropic" || providerKind === "anthropic_compatible"
        ? "anthropic_messages"
        : "openai_chat_completions";
  return {
    ...value,
    endpointProtocol,
    authRequirement: "authRequirement" in value ? value.authRequirement : "api_key"
  };
}, ProviderProfileCurrentSchema);

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
export type AgentAnswerCitation = z.infer<typeof AgentAnswerCitationSchema>;
export type DatasetAnswerCitation = z.infer<typeof DatasetAnswerCitationSchema>;
export type DatasetColumn = z.infer<typeof DatasetColumnSchema>;
export type DatasetEvidenceRef = z.infer<typeof DatasetEvidenceRefSchema>;
export type DatasetLogicalType = z.infer<typeof DatasetLogicalTypeSchema>;
export type DatasetManifest = z.infer<typeof DatasetManifestSchema>;
export type DatasetQueryPreview = z.infer<typeof DatasetQueryPreviewSchema>;
export type DatasetQueryPreviewColumn = z.infer<typeof DatasetQueryPreviewColumnSchema>;
export type DatasetQueryPreviewRow = z.infer<typeof DatasetQueryPreviewRowSchema>;
export type DatasetQueryScalar = z.infer<typeof DatasetQueryScalarSchema>;
export type DatasetRevision = z.infer<typeof DatasetRevisionSchema>;
export type DatasetSchemaRecord = z.infer<typeof DatasetSchemaRecordSchema>;
export type DatasetTable = z.infer<typeof DatasetTableSchema>;
export type JobClass = z.infer<typeof JobClassSchema>;
export type HighRiskConfirmationAction = z.infer<typeof HighRiskConfirmationActionSchema>;
export type HighRiskConfirmationChangedEvent = z.infer<typeof HighRiskConfirmationChangedEventSchema>;
export type HighRiskConfirmationId = z.infer<typeof HighRiskConfirmationIdSchema>;
export type HighRiskConfirmationOwner = z.infer<typeof HighRiskConfirmationOwnerSchema>;
export type HighRiskConfirmationPendingResult = z.infer<typeof HighRiskConfirmationPendingResultSchema>;
export type HighRiskConfirmationResolveRequest = z.infer<typeof HighRiskConfirmationResolveRequestSchema>;
export type HighRiskConfirmationResolveResult = z.infer<typeof HighRiskConfirmationResolveResultSchema>;
export type HighRiskConfirmationSummary = z.infer<typeof HighRiskConfirmationSummarySchema>;
export type HighRiskConfirmationSubject = z.infer<typeof HighRiskConfirmationSubjectSchema>;
export type HighRiskConfirmationTarget = z.infer<typeof HighRiskConfirmationTargetSchema>;
export type HighRiskEffect = z.infer<typeof HighRiskEffectSchema>;
export type RendererSafeSubjectLabel = z.infer<typeof RendererSafeSubjectLabelSchema>;
export type KnowledgeActivityPageTarget = z.infer<typeof KnowledgeActivityPageTargetSchema>;
export type KnowledgeActivitySummary = z.infer<typeof KnowledgeActivitySummarySchema>;
export type KnowledgeActivityListRequest = z.infer<typeof KnowledgeActivityListRequestSchema>;
export type KnowledgeActivityListResult = z.infer<typeof KnowledgeActivityListResultSchema>;
export type JobCheckpoint = z.infer<typeof JobCheckpointSchema>;
export type JobRef = z.infer<typeof JobRefSchema>;
export type JobRecord = z.infer<typeof JobRecordSchema>;
export type JobStage = z.infer<typeof JobStageSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type MachineLocalSettings = z.infer<typeof MachineLocalSettingsSchema>;
export type UpdateCapability = z.infer<typeof UpdateCapabilitySchema>;
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;
export type UpdateCheckRequest = z.infer<typeof UpdateCheckRequestSchema>;
export type UpdateCheckResult = z.infer<typeof UpdateCheckResultSchema>;
export type UpdateMachineSettings = z.infer<typeof UpdateMachineSettingsSchema>;
export type UpdatePhase = z.infer<typeof UpdatePhaseSchema>;
export type UpdateStatusEvent = z.infer<typeof UpdateStatusEventSchema>;
export type UpdateSummary = z.infer<typeof UpdateSummarySchema>;
export type MarkdownPageStatus = z.infer<typeof MarkdownPageStatusSchema>;
export type MarkdownPageType = z.infer<typeof MarkdownPageTypeSchema>;
export type NoteInlineReferenceTarget = z.infer<typeof NoteInlineReferenceTargetSchema>;
export type NoteInlineReferenceRequestId = z.infer<typeof NoteInlineReferenceRequestIdSchema>;
export type NoteRenderContextId = z.infer<typeof NoteRenderContextIdSchema>;
export type NoteResolveInlineReferenceRequest = z.infer<typeof NoteResolveInlineReferenceRequestSchema>;
export type NoteResolveInlineReferenceResult = z.infer<typeof NoteResolveInlineReferenceResultSchema>;
export type ReaderSelectionEndpoint = z.infer<typeof ReaderSelectionEndpointSchema>;
export type ReaderSelectionActionRequestId = z.infer<typeof ReaderSelectionActionRequestIdSchema>;
export type ReaderSelectionActionRequest = z.infer<typeof ReaderSelectionActionRequestSchema>;
export type ReaderSelectionActionResult = z.infer<typeof ReaderSelectionActionResultSchema>;
export type ReaderSelectionIdentity = z.infer<typeof ReaderSelectionIdentitySchema>;
export type ReaderSelectionReadAction = z.infer<typeof ReaderSelectionReadActionSchema>;
export type ReaderSelectionTransformAction = z.infer<typeof ReaderSelectionTransformActionSchema>;
export type ReaderSelectionTransformRequest = z.infer<typeof ReaderSelectionTransformRequestSchema>;
export type ReaderSelectionTransformResult = z.infer<typeof ReaderSelectionTransformResultSchema>;
export type ReaderSelectionProposalId = z.infer<typeof ReaderSelectionProposalIdSchema>;
export type ReaderSelectionProposalState = z.infer<typeof ReaderSelectionProposalStateSchema>;
export type ReaderSelectionProposalLine = z.infer<typeof ReaderSelectionProposalLineSchema>;
export type ReaderSelectionProposalPreview = z.infer<typeof ReaderSelectionProposalPreviewSchema>;
export type ReaderSelectionProposalGetRequest = z.infer<typeof ReaderSelectionProposalGetRequestSchema>;
export type ReaderSelectionProposalGetResult = z.infer<typeof ReaderSelectionProposalGetResultSchema>;
export type ReaderSelectionProposalDecisionRequest = z.infer<typeof ReaderSelectionProposalDecisionRequestSchema>;
export type ReaderSelectionProposalDecisionResult = z.infer<typeof ReaderSelectionProposalDecisionResultSchema>;
export type ReaderSelectionRequestId = z.infer<typeof ReaderSelectionRequestIdSchema>;
export type ReaderSelectionResolveRequest = z.infer<typeof ReaderSelectionResolveRequestSchema>;
export type ReaderSelectionResolveResult = z.infer<typeof ReaderSelectionResolveResultSchema>;
export type ReaderSelectionSegmentId = z.infer<typeof ReaderSelectionSegmentIdSchema>;
export type ReaderSelectionUtf8ByteSpan = z.infer<typeof ReaderSelectionUtf8ByteSpanSchema>;
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
export type VaultRevealResult = z.infer<typeof VaultRevealResultSchema>;
export type VaultRevealTarget = z.infer<typeof VaultRevealTargetSchema>;
export type PigeWarning = z.infer<typeof PigeWarningSchema>;
export type PermissionActionBinding = z.infer<typeof PermissionActionBindingSchema>;
export type PermissionActorType = z.infer<typeof PermissionActorTypeSchema>;
export type PermissionCapability = z.infer<typeof PermissionCapabilitySchema>;
export type SkillId = z.infer<typeof SkillIdSchema>;
export type SkillVersion = z.infer<typeof SkillVersionSchema>;
export type SkillKind = z.infer<typeof SkillKindSchema>;
export type SkillScope = z.infer<typeof SkillScopeSchema>;
export type SkillTrust = z.infer<typeof SkillTrustSchema>;
export type SkillCapability = z.infer<typeof SkillCapabilitySchema>;
export type SkillDataBoundary = z.infer<typeof SkillDataBoundarySchema>;
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type SkillRegistryRecord = z.infer<typeof SkillRegistryRecordSchema>;
export type SkillRegistryFile = z.infer<typeof SkillRegistryFileSchema>;
export type SkillSummary = z.infer<typeof SkillSummarySchema>;
export type SkillRegistrySummary = z.infer<typeof SkillRegistrySummarySchema>;
export type SkillRegistryQueryResult = z.infer<typeof SkillRegistryQueryResultSchema>;
export type SkillDisableRequest = z.infer<typeof SkillDisableRequestSchema>;
export type SkillRegistryMutationResult = z.infer<typeof SkillRegistryMutationResultSchema>;
export type PermissionDataBoundary = z.infer<typeof PermissionDataBoundarySchema>;
export type PermissionResourceScope = z.infer<typeof PermissionResourceScopeSchema>;
export type ExternalMutationIntent = z.infer<typeof ExternalMutationIntentSchema>;
export type ProposalState = z.infer<typeof ProposalStateSchema>;
export type ProposalTrustLevel = z.infer<typeof ProposalTrustLevelSchema>;
export type ProviderKind = z.infer<typeof ProviderKindSchema>;
export type ProviderEndpointProtocol = z.infer<typeof ProviderEndpointProtocolSchema>;
export type ProviderAuthRequirement = z.infer<typeof ProviderAuthRequirementSchema>;
export type UpdateProviderCredentialRequest = z.infer<typeof UpdateProviderCredentialRequestSchema>;
export type DeleteProviderRequest = z.infer<typeof DeleteProviderRequestSchema>;
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;
export type ProviderProfilesFile = z.infer<typeof ProviderProfilesFileSchema>;
export type RetrievalSearchRequest = z.infer<typeof RetrievalSearchRequestSchema>;
export type RetrievalSearchResult = z.infer<typeof RetrievalSearchResultSchema>;
export type RetrievalSearchResultItem = z.infer<typeof RetrievalSearchResultItemSchema>;
export type RetrievalSearchScope = z.infer<typeof RetrievalSearchScopeSchema>;
export type SpeechAvailabilityRequest = z.infer<typeof SpeechAvailabilityRequestSchema>;
export type SpeechAvailabilityResult = z.infer<typeof SpeechAvailabilityResultSchema>;
export type SpeechAssetInstallationId = z.infer<typeof SpeechAssetInstallationIdSchema>;
export type SpeechAssetInstallEvent = z.infer<typeof SpeechAssetInstallEventSchema>;
export type SpeechAssetInstallRequest = z.infer<typeof SpeechAssetInstallRequestSchema>;
export type SpeechAssetInstallResult = z.infer<typeof SpeechAssetInstallResultSchema>;
export type SpeechAssetRequestId = z.infer<typeof SpeechAssetRequestIdSchema>;
export type SpeechCancelRequest = z.infer<typeof SpeechCancelRequestSchema>;
export type SpeechCancelResult = z.infer<typeof SpeechCancelResultSchema>;
export type SpeechOpenSystemSettingsResult = z.infer<typeof SpeechOpenSystemSettingsResultSchema>;
export type SpeechPermissionState = z.infer<typeof SpeechPermissionStateSchema>;
export type SpeechSessionEvent = z.infer<typeof SpeechSessionEventSchema>;
export type SpeechSessionRequest = z.infer<typeof SpeechSessionRequestSchema>;
export type SpeechStartRequest = z.infer<typeof SpeechStartRequestSchema>;
export type SpeechStartResult = z.infer<typeof SpeechStartResultSchema>;
export type SpeechStopResult = z.infer<typeof SpeechStopResultSchema>;
export type SpeechUnavailableReason = z.infer<typeof SpeechUnavailableReasonSchema>;
export type RetrievalAnswerCitation = z.infer<typeof RetrievalAnswerCitationSchema>;
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
export type WindowLayoutRequest = z.infer<typeof WindowLayoutRequestSchema>;
export type WindowLayoutState = z.infer<typeof WindowLayoutStateSchema>;
export type WindowLayoutSurface = z.infer<typeof WindowLayoutSurfaceSchema>;
export type WindowPanePresentation = z.infer<typeof WindowPanePresentationSchema>;
export type WindowPreferences = z.infer<typeof WindowPreferencesSchema>;
export type WindowSize = z.infer<typeof WindowSizeSchema>;
