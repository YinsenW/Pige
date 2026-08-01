import { z } from "zod";
import { PIGE_REQUIREMENT_ID_PATTERN, PIGE_VAULT_ID_PATTERN } from "@pige/domain";

export const RequirementIdSchema = z.string().regex(PIGE_REQUIREMENT_ID_PATTERN);

export const LocaleSchema = z.enum(["zh-Hans", "en", "ja", "ko", "fr", "de"]);

export const AppearanceThemePreferenceSchema = z.enum(["system", "light", "dark"]);
export const GeneratedKnowledgeLanguageSchema = z.enum(["preserve_source", "follow_query", "app_locale"]);

export const EffectiveAppearanceThemeSchema = z.enum(["light", "dark"]);

export const AppearanceSettingsRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const AppearanceMachineSettingsSchema = z.object({
  revision: AppearanceSettingsRevisionSchema,
  themePreference: AppearanceThemePreferenceSchema,
  generatedKnowledgeLanguage: GeneratedKnowledgeLanguageSchema.optional()
}).strict();

export const AppearanceSettingsSummarySchema = z.object({
  apiVersion: z.literal(1),
  locale: LocaleSchema,
  availableLocales: z.array(LocaleSchema).min(1),
  themePreference: AppearanceThemePreferenceSchema,
  effectiveTheme: EffectiveAppearanceThemeSchema,
  generatedKnowledgeLanguage: GeneratedKnowledgeLanguageSchema,
  revision: AppearanceSettingsRevisionSchema
}).strict();

export const SetLocaleRequestSchema = z.object({
  locale: LocaleSchema
}).strict();

export const SetThemeRequestSchema = z.object({
  themePreference: AppearanceThemePreferenceSchema,
  expectedRevision: AppearanceSettingsRevisionSchema
}).strict();

export const AppearanceThemeMutationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("committed"), settings: AppearanceSettingsSummarySchema }).strict(),
  z.object({ status: z.literal("stale"), settings: AppearanceSettingsSummarySchema }).strict(),
  z.object({ status: z.literal("failed"), settings: AppearanceSettingsSummarySchema }).strict()
]);

export const SetKnowledgeLanguageRequestSchema = z.object({
  generatedKnowledgeLanguage: GeneratedKnowledgeLanguageSchema,
  expectedRevision: AppearanceSettingsRevisionSchema
}).strict();

export const KnowledgeLanguageMutationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("committed"), settings: AppearanceSettingsSummarySchema }).strict(),
  z.object({ status: z.literal("stale"), settings: AppearanceSettingsSummarySchema }).strict(),
  z.object({ status: z.literal("failed"), settings: AppearanceSettingsSummarySchema }).strict()
]);

export const StartupDestinationSchema = z.enum(["home", "library"]);
export const StartupDestinationRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const StartupDestinationSummarySchema = z.object({
  apiVersion: z.literal(1),
  destination: StartupDestinationSchema,
  revision: StartupDestinationRevisionSchema
}).strict();
export const SetStartupDestinationRequestSchema = z.object({
  destination: StartupDestinationSchema,
  expectedRevision: StartupDestinationRevisionSchema
}).strict();
export const StartupDestinationMutationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("committed"), summary: StartupDestinationSummarySchema }).strict(),
  z.object({ status: z.literal("stale"), summary: StartupDestinationSummarySchema }).strict(),
  z.object({ status: z.literal("failed"), summary: StartupDestinationSummarySchema.optional() }).strict()
]);
const StartupDestinationMachineSettingsSchema = z.object({
  revision: StartupDestinationRevisionSchema,
  destination: StartupDestinationSchema
}).strict();

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
export const NoteSourceReferenceRequestIdSchema = NoteInlineReferenceRequestIdSchema;
export const NoteOpenSourceReferenceRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteSourceReferenceRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  sourceId: SourceIdSchema
}).strict();
export const NoteOpenSourceReferenceResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    requestId: NoteSourceReferenceRequestIdSchema,
    status: z.literal("resolved"),
    target: z.object({ pageId: PageIdSchema }).strict()
  }).strict(),
  ...(["unresolved", "not_found", "stale", "mismatch", "changed"] as const).map((status) =>
    z.object({
      apiVersion: z.literal(1),
      requestId: NoteSourceReferenceRequestIdSchema,
      status: z.literal(status)
    }).strict()
  )
]);
export const NOTE_REVEAL_SOURCE_CHANNEL = "notes.revealSource" as const;
export const NoteRevealSourceRequestIdSchema = z.string()
  .regex(/^notesourcereveal_[a-z0-9]{16,64}$/);
export const NoteRevealSourceRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteRevealSourceRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  sourceId: SourceIdSchema
}).strict();
const NoteRevealSourceResultIdentitySchema = NoteRevealSourceRequestSchema;
export const NoteRevealSourceResultSchema = z.discriminatedUnion("status", [
  NoteRevealSourceResultIdentitySchema.extend({ status: z.literal("revealed") }).strict(),
  NoteRevealSourceResultIdentitySchema.extend({ status: z.literal("cancelled") }).strict(),
  NoteRevealSourceResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  NoteRevealSourceResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  NoteRevealSourceResultIdentitySchema.extend({ status: z.literal("unavailable") }).strict(),
  NoteRevealSourceResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const SOURCE_REFRESH_PREVIEW_CHANNEL = "source.refresh.preview" as const;
export const SOURCE_REFRESH_CONFIRM_CHANNEL = "source.refresh.confirm" as const;
export const SourceRefreshRequestIdSchema = z.string().regex(/^sourcerefreshreq_[a-z0-9]{16,64}$/);
export const SourceRefreshPreviewIdSchema = z.string().regex(/^sourcerefreshpreview_[a-f0-9]{32}$/);
export const SourceRefreshRevisionSchema = z.string().regex(/^sourcerefreshrev_[a-f0-9]{64}$/);
export const SourceRefreshIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: SourceRefreshRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  sourceId: SourceIdSchema
}).strict();
export const SourceRefreshPreviewRequestSchema = SourceRefreshIdentitySchema;
const SourceRefreshPreviewResultIdentitySchema = SourceRefreshIdentitySchema;
export const SourceRefreshPreviewResultSchema = z.discriminatedUnion("status", [
  SourceRefreshPreviewResultIdentitySchema.extend({
    status: z.literal("changed"),
    preview: z.object({
      previewId: SourceRefreshPreviewIdSchema,
      expectedSourceRevision: SourceRefreshRevisionSchema,
      displayName: z.string().min(1).max(160),
      sourceKind: z.enum(["url", "markdown_file", "plain_text_file", "pdf_file", "docx_file", "pptx_file", "image_file"]),
      previousSize: z.number().int().nonnegative(),
      currentSize: z.number().int().nonnegative(),
      sizeDelta: z.number().int(),
      affectedArtifactCount: z.number().int().nonnegative().max(10_000),
      refreshesSourcePage: z.boolean()
    }).strict()
  }).strict(),
  ...(["unchanged", "stale", "not_found", "ineligible", "unavailable", "failed"] as const).map((status) =>
    SourceRefreshPreviewResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const SourceRefreshConfirmRequestSchema = SourceRefreshIdentitySchema.extend({
  previewId: SourceRefreshPreviewIdSchema,
  expectedSourceRevision: SourceRefreshRevisionSchema
}).strict();
const SourceRefreshConfirmResultIdentitySchema = SourceRefreshConfirmRequestSchema;
export const SourceRefreshConfirmResultSchema = z.discriminatedUnion("status", [
  SourceRefreshConfirmResultIdentitySchema.extend({
    status: z.literal("refreshed"),
    operationId: z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/),
    jobId: z.string().regex(/^job_\d{8}_[a-z0-9]{8,}$/),
    sourceRevision: SourceRefreshRevisionSchema,
    sourcePageConflict: z.boolean()
  }).strict(),
  ...(["stale", "not_found", "ineligible", "unavailable", "failed"] as const).map((status) =>
    SourceRefreshConfirmResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
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
export const AGENT_AUTHORED_TEXT_MAX_CODE_POINTS = 8_000;
export const AGENT_STAGED_ITEM_MAX_COUNT = 8;
export const AGENT_LARGE_PASTE_ITEM_MAX_UTF8_BYTES = 4_194_304;
export const AGENT_LARGE_PASTE_AGGREGATE_MAX_UTF8_BYTES = 8_388_608;
const AgentStagedItemOrdinalSchema = z.number().int().min(0).max(AGENT_STAGED_ITEM_MAX_COUNT - 1);
const AgentStagedItemDisplayNameSchema = z.string().min(1).max(160);
export const AgentStagedFileItemSchema = z.object({
  kind: z.literal("file"),
  ordinal: AgentStagedItemOrdinalSchema,
  displayName: AgentStagedItemDisplayNameSchema
}).strict();
export const AgentStagedLargePasteItemSchema = z.object({
  kind: z.literal("large_paste"),
  ordinal: AgentStagedItemOrdinalSchema,
  text: z.string().min(1).max(AGENT_LARGE_PASTE_ITEM_MAX_UTF8_BYTES),
  unicodeCodePointCount: z.number().int().positive(),
  utf8ByteSize: z.number().int().positive().max(AGENT_LARGE_PASTE_ITEM_MAX_UTF8_BYTES)
}).strict().superRefine((item, context) => {
  if ([...item.text].length !== item.unicodeCodePointCount) {
    context.addIssue({ code: "custom", path: ["unicodeCodePointCount"], message: "The paste character count is invalid." });
  }
  if (new TextEncoder().encode(item.text).byteLength !== item.utf8ByteSize) {
    context.addIssue({ code: "custom", path: ["utf8ByteSize"], message: "The paste byte size is invalid." });
  }
});
export const AgentStagedItemSchema = z.union([
  AgentStagedFileItemSchema,
  AgentStagedLargePasteItemSchema
]);
export const AgentStagedItemRejectionReasonSchema = z.enum([
  "item_limit",
  "item_too_large",
  "aggregate_too_large"
]);
export const AgentTurnCurrentNoteScopeSchema = z.object({
  kind: z.literal("current_note"),
  pageId: PageIdSchema
}).strict();
export const AgentConversationInputPresentationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reader_selection_action"),
    action: z.enum(["explain", "summarize", "link"])
  }).strict(),
  z.object({
    kind: z.literal("reader_selection_transform"),
    action: z.enum(["translate", "polish", "expand", "shorten"])
  }).strict()
]);
export const AgentSubmitTurnRequestSchema = z.object({
  schemaVersion: z.literal(1).optional().default(1),
  text: z.string().refine(
    (value) => [...value].length <= AGENT_AUTHORED_TEXT_MAX_CODE_POINTS,
    "Agent authored text exceeds the Unicode code-point limit."
  ).optional(),
  inputKind: z.enum([
    "typed_text",
    "pasted_text",
    "typed_url",
    "pasted_url",
    "file_drop",
    "file_picker",
    "follow_up"
  ]),
  scope: AgentTurnCurrentNoteScopeSchema.optional(),
  locale: LocaleSchema,
  stagedItems: z.array(AgentStagedItemSchema).max(AGENT_STAGED_ITEM_MAX_COUNT).readonly().optional(),
  clientTurnId: AgentClientTurnIdSchema.optional(),
  conversationId: ConversationIdSchema.optional(),
  expectedTailEventId: ConversationEventIdSchema.optional()
}).strict().superRefine((request, context) => {
  const stagedItems = request.stagedItems ?? [];
  for (const [index, item] of stagedItems.entries()) {
    if (item.ordinal !== index) {
      context.addIssue({ code: "custom", path: ["stagedItems", index, "ordinal"], message: "Staged item order is invalid." });
    }
  }
  const aggregatePasteBytes = stagedItems.reduce(
    (total, item) => total + (item.kind === "large_paste" ? item.utf8ByteSize : 0),
    0
  );
  if (aggregatePasteBytes > AGENT_LARGE_PASTE_AGGREGATE_MAX_UTF8_BYTES) {
    context.addIssue({ code: "custom", path: ["stagedItems"], message: "The aggregate paste byte limit was exceeded." });
  }
  const fileInput = request.inputKind === "file_drop" || request.inputKind === "file_picker";
  const hasAuthoredText = request.text !== undefined && request.text.trim().length > 0;
  if (!fileInput && !hasAuthoredText && stagedItems.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["text"],
      message: "A text Agent turn requires bounded non-empty text."
    });
  }
  const hasConversation = request.conversationId !== undefined;
  const hasExpectedTail = request.expectedTailEventId !== undefined;
  if (hasConversation !== hasExpectedTail) {
    context.addIssue({
      code: "custom",
      path: [hasConversation ? "expectedTailEventId" : "conversationId"],
      message: "A conversation continuation requires an exact conversation and tail pair."
    });
  }
  if (request.inputKind === "follow_up") {
    if (!request.clientTurnId) {
      context.addIssue({
        code: "custom",
        path: ["clientTurnId"],
        message: "A follow-up requires a stable client turn identity."
      });
    }
    if (!hasConversation || !hasExpectedTail) {
      context.addIssue({
        code: "custom",
        path: ["conversationId"],
        message: "A follow-up requires an exact conversation tail binding."
      });
    }
  } else if (request.inputKind === "file_picker" && hasConversation && !request.clientTurnId) {
    context.addIssue({
      code: "custom",
      path: ["clientTurnId"],
      message: "A file picker continuation requires a stable client turn identity."
    });
  } else if (request.inputKind !== "file_picker" && (hasConversation || hasExpectedTail)) {
    context.addIssue({
      code: "custom",
      path: ["conversationId"],
      message: "Only a follow-up or file picker may continue an existing conversation."
    });
  }
  if (request.scope && request.inputKind === "file_drop") {
    context.addIssue({
      code: "custom",
      path: ["scope"],
      message: "A whole-window file drop cannot claim current-note scope."
    });
  }
  if (stagedItems.length > 0 && !fileInput) {
    context.addIssue({ code: "custom", path: ["stagedItems"], message: "Staged sources require a file input turn." });
  }
});
const AgentAttachmentInternalPathSchema = z.string()
  .max(4_096)
  .refine((value) => !value.includes("\0"), "Attachment paths must not contain null bytes.");
export const AgentAttachmentCandidateSchema = z.object({
  ordinal: AgentStagedItemOrdinalSchema.optional(),
  displayName: z.string().max(512),
  internalPath: AgentAttachmentInternalPathSchema
}).strict();
export const AgentSubmitTurnIpcPayloadSchema = z.object({
  request: AgentSubmitTurnRequestSchema,
  attachments: z.array(AgentAttachmentCandidateSchema).max(64).readonly()
}).strict().superRefine((payload, context) => {
  const fileItems = payload.request.stagedItems?.filter((item) => item.kind === "file");
  if (payload.request.stagedItems === undefined && payload.attachments.some((item) => item.ordinal !== undefined)) {
    context.addIssue({ code: "custom", path: ["attachments"], message: "Legacy file candidates cannot assert staged order." });
  }
  if (fileItems && (fileItems.length !== payload.attachments.length || fileItems.some((item, index) => (
    item.ordinal !== (payload.attachments[index]?.ordinal ?? index) || item.displayName !== payload.attachments[index]?.displayName
  )))) {
    context.addIssue({ code: "custom", path: ["attachments"], message: "File candidates do not match the ordered staged items." });
  }
  const fileInput = payload.request.inputKind === "file_drop" || payload.request.inputKind === "file_picker";
  if (fileInput && payload.attachments.length === 0 && (payload.request.stagedItems?.length ?? 0) === 0) {
    context.addIssue({
      code: "custom",
      path: ["attachments"],
      message: "A file Agent turn requires at least one attachment candidate."
    });
  }
  if (!fileInput && payload.attachments.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["attachments"],
      message: "Only file-drop and file-picker Agent turns may carry attachment candidates."
    });
  }
});
export const JobIdSchema = z.string().regex(/^job_\d{8}_[a-z0-9]{8,}$/);
export const ProposalIdSchema = z.string().regex(/^proposal_\d{8}_[a-z0-9]{8,}$/);
export const OperationIdSchema = z.string().regex(/^op_\d{8}_[a-z0-9]{8,}$/);

export const HighRiskConfirmationIdSchema = z.string().regex(/^confirm_\d{8}_[a-z0-9]{16,64}$/);
export const PermissionRequestIdSchema = z.string().regex(/^permreq_\d{8}_[a-z0-9]{16,64}$/);
export const PermissionDecisionIdSchema = z.string().regex(/^permdec_\d{8}_[a-z0-9]{16,64}$/);
export const PermissionGrantContextIdSchema = z.string().regex(/^grantctx_[a-z0-9]{16,64}$/);
export const PermissionGrantIdSchema = z.string().regex(/^grant_\d{8}_[a-z0-9]{16,64}$/);
export const PermissionPolicyRequestIdSchema = z.string().regex(/^permissionpolicyreq_[a-z0-9]{16,64}$/);
export const PiPackageInstallTaskIdSchema = z.string()
  .regex(/^pi_package_task_[a-z0-9]{16,64}$/u);
export const TaskExecutionPlanIdSchema = z.string()
  .regex(/^plan_[a-f0-9]{32}$/u);
export const TaskInteractionIdSchema = z.string()
  .regex(/^interaction_[a-f0-9]{32}$/u);

const TaskExecutionDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const TaskExecutionIdentifierSchema = z.string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/u);
const TaskExecutionComponentVersionSchema = z.string()
  .regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/u);
const TaskExecutionVersionSchema = z.string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
const TaskExecutionSafeLabelSchema = z.string()
  .min(1)
  .max(192)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._+()@-]*$/u)
  .refine((value) => value === value.trim());
const TaskExecutionOriginSchema = z.string().url().max(255).refine((value) => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" &&
    parsed.origin === value &&
    parsed.username === "" &&
    parsed.password === "";
});
const TaskExecutionIntegritySchema = z.string().max(160).refine((value) =>
  /^sha256:[a-f0-9]{64}$/u.test(value)
);

export const TaskExecutionPlanSummarySchema = z.object({
  planId: TaskExecutionPlanIdSchema,
  toolLabel: TaskExecutionSafeLabelSchema,
  resolvedVersion: TaskExecutionVersionSchema,
  sourceOrigin: TaskExecutionOriginSchema,
  integrities: z.array(TaskExecutionIntegritySchema).min(1).max(16),
  stepCount: z.number().int().min(1).max(8),
  destinationRoots: z.array(TaskExecutionSafeLabelSchema).max(32),
  skillCount: z.number().int().min(0).max(512),
  targetAgents: z.array(TaskExecutionSafeLabelSchema).max(32),
  requiresBrowserOAuth: z.boolean()
}).strict();

export const TaskExecutionPlanStepSchema = z.object({
  ordinal: z.number().int().min(1).max(8),
  adapterId: TaskExecutionIdentifierSchema,
  adapterVersion: TaskExecutionComponentVersionSchema,
  adapterDigest: TaskExecutionDigestSchema,
  actionId: TaskExecutionIdentifierSchema,
  normalizedExecutableIdentity: z.string().min(1).max(1024),
  argv: z.array(z.string().max(4096)).max(64),
  canonicalWorkingDirectory: z.string().min(1).max(4096),
  environmentProfileHash: TaskExecutionDigestSchema,
  networkOrigins: z.array(TaskExecutionOriginSchema).max(4),
  destinations: z.array(z.string().min(1).max(4096)).max(4),
  interactionProtocol: z.enum(["none", "browser_oauth"]),
  timeoutMs: z.number().int().min(1).max(600_000),
  inputHash: TaskExecutionDigestSchema,
  postconditionProbeId: TaskExecutionIdentifierSchema,
  recoveryMode: z.enum(["probe_then_adopt", "fail_closed"])
}).strict();

const TaskExecutionPlanEnvironmentSchema = z.object({
  controlledHomeRoot: z.string().min(1).max(4096),
  configRoot: z.string().min(1).max(4096),
  sanitizedPathEntries: z.array(z.string().min(1).max(4096)).max(64),
  descendantExecutableIdentities: z.array(z.string().min(1).max(1024)).max(64),
  canonicalWorkingDirectory: z.string().min(1).max(4096),
  temporaryDirectoryPolicy: TaskExecutionIdentifierSchema,
  localeProfile: TaskExecutionIdentifierSchema,
  npmRegistry: TaskExecutionOriginSchema,
  npmPrefix: z.string().min(1).max(4096),
  npmCache: z.string().min(1).max(4096),
  npmConfigProvenance: z.string().min(1).max(4096),
  targetAgentRoots: z.array(z.string().min(1).max(4096)).max(32),
  networkOrigins: z.array(TaskExecutionOriginSchema).max(32),
  destinations: z.array(z.string().min(1).max(4096)).max(32),
  secretHandleVersions: z.record(
    TaskExecutionIdentifierSchema,
    TaskExecutionComponentVersionSchema
  )
}).strict();

export const TaskExecutionPlanSchema = z.object({
  planId: TaskExecutionPlanIdSchema,
  vaultId: VaultIdSchema,
  jobId: JobIdSchema,
  clientTurnId: AgentClientTurnIdSchema,
  authoredTaskIntent: z.enum(["neutral_attachment", "explicit_user_task"]),
  policyHash: TaskExecutionDigestSchema,
  toolCatalogHash: TaskExecutionDigestSchema,
  recipeId: TaskExecutionIdentifierSchema,
  recipeVersion: TaskExecutionComponentVersionSchema,
  recipeDigest: TaskExecutionDigestSchema,
  actorId: TaskExecutionIdentifierSchema,
  actorVersion: TaskExecutionComponentVersionSchema,
  actorDigest: TaskExecutionDigestSchema,
  environment: TaskExecutionPlanEnvironmentSchema,
  planDigest: TaskExecutionDigestSchema,
  summary: TaskExecutionPlanSummarySchema,
  steps: z.array(TaskExecutionPlanStepSchema).min(1).max(8)
}).strict().superRefine((plan, context) => {
  if (plan.steps.some((step, index) => step.ordinal !== index + 1)) {
    context.addIssue({
      code: "custom",
      path: ["steps"],
      message: "Task execution plan step ordinals must be contiguous and ordered."
    });
  }
  if (plan.summary.planId !== plan.planId || plan.summary.stepCount !== plan.steps.length) {
    context.addIssue({
      code: "custom",
      path: ["summary"],
      message: "Task execution plan summary must match the private plan identity and step count."
    });
  }
});

const TaskInteractionIdentitySchema = z.object({
  interactionId: TaskInteractionIdSchema,
  planId: TaskExecutionPlanIdSchema,
  jobId: JobIdSchema,
  stepOrdinal: z.number().int().min(1).max(8),
  origin: TaskExecutionOriginSchema
});

export const TaskInteractionPendingResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("none")
  }).strict(),
  TaskInteractionIdentitySchema.extend({
    status: z.literal("browser_oauth"),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  }).strict()
]);

export const TaskInteractionOpenRequestSchema = TaskInteractionIdentitySchema.omit({
  origin: true
}).extend({
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
}).strict();

const TaskInteractionRevisionResultSchema = z.object({
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
});
export const TaskInteractionOpenResultSchema = z.discriminatedUnion("status", [
  TaskInteractionRevisionResultSchema.extend({ status: z.literal("opened") }).strict(),
  TaskInteractionRevisionResultSchema.extend({ status: z.literal("stale") }).strict(),
  z.object({ status: z.literal("not_found") }).strict(),
  TaskInteractionRevisionResultSchema.extend({ status: z.literal("failed") }).strict()
]);
export const TaskInteractionChangedEventSchema = TaskInteractionPendingResultSchema;

export const HighRiskEffectSchema = z.enum([
  "irreversible_delete",
  "overwrite_user_original",
  "write_outside_authorized_root",
  "arbitrary_shell",
  "install_unreviewed_package",
  "reviewed_execution_plan",
  "export_secret",
  "risky_agent_edit",
  "external_web_skill_https_read",
  "authority_boundary_change"
]);
export const HighRiskConfirmationActionSchema = z.enum([
  "delete_permanently",
  "overwrite_original",
  "write_external_item",
  "run_shell_command",
  "install_package",
  "execute_reviewed_plan",
  "export_credential",
  "apply_risky_edit",
  "read_external_web",
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
  "reviewed_https_origin",
  "authority_boundary"
]);
export const ExternalWebSkillHttpsOriginSchema = z.string().max(2048).refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" &&
      parsed.pathname === "/" && parsed.search === "" && parsed.hash === "" && parsed.origin === value;
  } catch {
    return false;
  }
}, "External/Web Skill origins must be exact canonical HTTPS origins.");
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
export const PiPackageInstallRequestIdSchema = z.string()
  .regex(/^pi_package_request_[a-z0-9]{16,64}$/u);
export const PiPackageUninstallRequestIdSchema = z.string()
  .regex(/^pi_package_uninstall_request_[a-z0-9]{16,64}$/u);
export const PiPackageUpdateRequestIdSchema = z.string()
  .regex(/^pi_package_update_request_[a-z0-9]{16,64}$/u);
export const PiPackageRollbackRequestIdSchema = z.string()
  .regex(/^pi_package_rollback_request_[a-z0-9]{16,64}$/u);
export const PiPackageSetPinnedRequestIdSchema = z.string()
  .regex(/^pi_package_pin_request_[a-z0-9]{16,64}$/u);
export const PiPackageSetEnabledRequestIdSchema = z.string()
  .regex(/^pi_package_enable_request_[a-z0-9]{16,64}$/u);
export const PiPackageRestoreRequestIdSchema = z.string()
  .regex(/^pi_package_restore_request_[a-z0-9]{16,64}$/u);
export const PiPackageRestoreContextIdSchema = z.string()
  .regex(/^pi_package_restore_context_v1_[a-f0-9]{32,64}$/u);
export const PiPackageRollbackIdSchema = z.string()
  .regex(/^pi_package_rollback_[a-z0-9]{16,64}$/u);
export const PiPackageCatalogQueryRequestIdSchema = z.string()
  .regex(/^pi_package_catalog_request_[a-z0-9]{16,64}$/u);
export const PiPackageCatalogIdSchema = z.string()
  .regex(/^pi_catalog_[a-z0-9][a-z0-9._-]{2,63}$/u);
export const PiPackageIntegritySchema = z.string()
  .regex(/^sha512-[A-Za-z0-9+/]{86}==$/u);
export const PiPackageNameSchema = z.string().refine(isSafePackageName);
export const PiPackageVersionSchema = z.string().refine((value) =>
  value === value.trim() && value.length <= 64 && EXACT_PACKAGE_VERSION_PATTERN.test(value)
);
export const PiPackageTypeSchema = z.enum(["extension", "skill", "prompt", "theme"]);
export const PiPackageIdSchema = z.string().regex(/^pkg_[a-f0-9]{24}$/u);
export const PiPackageInstalledSummarySchema = z.object({
  packageId: PiPackageIdSchema,
  packageName: PiPackageNameSchema,
  version: PiPackageVersionSchema,
  state: z.enum(["installed_disabled", "installed_enabled"]),
  packageTypes: z.array(PiPackageTypeSchema).min(1).max(4).readonly(),
  dependencyCount: z.number().int().min(0).max(256),
  enabled: z.boolean(),
  canEnable: z.boolean(),
  trust: z.literal("community"),
  pinned: z.boolean().default(false),
  canUpdate: z.boolean(),
  canRollback: z.boolean(),
  rollbackTarget: z.object({
    rollbackId: PiPackageRollbackIdSchema,
    targetVersion: PiPackageVersionSchema
  }).strict().nullable()
}).strict().superRefine((summary, context) => {
  if (summary.enabled !== (summary.state === "installed_enabled")) {
    context.addIssue({ code: "custom", path: ["state"], message: "Package state must match its enabled projection." });
  }
  if (summary.enabled && !summary.canEnable) {
    context.addIssue({ code: "custom", path: ["canEnable"], message: "Enabled packages must retain exact runtime eligibility." });
  }
  if (summary.canRollback !== (summary.rollbackTarget !== null)) {
    context.addIssue({
      code: "custom",
      path: ["rollbackTarget"],
      message: "Rollback availability must match one exact renderer-safe target."
    });
  }
  if (summary.pinned && (summary.canUpdate || summary.canRollback || summary.rollbackTarget !== null)) {
    context.addIssue({
      code: "custom",
      path: ["pinned"],
      message: "Pinned packages must fail closed for update and rollback."
    });
  }
});
export const PiPackageRestorableSummarySchema = z.object({
  restoreContextId: PiPackageRestoreContextIdSchema,
  packageId: PiPackageIdSchema,
  packageName: PiPackageNameSchema,
  version: PiPackageVersionSchema,
  integrity: PiPackageIntegritySchema,
  packageTypes: z.array(PiPackageTypeSchema).min(1).max(4).readonly(),
  dependencyCount: z.number().int().min(0).max(256),
  pinned: z.boolean(),
  rollbackTarget: z.object({
    rollbackId: PiPackageRollbackIdSchema,
    targetVersion: PiPackageVersionSchema
  }).strict().nullable(),
  uninstalledAt: z.string().datetime(),
  canRestore: z.literal(true)
}).strict();
export const PiPackageRegistrySummarySchema = z.object({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  packages: z.array(PiPackageInstalledSummarySchema).max(1_000).readonly(),
  restorablePackages: z.array(PiPackageRestorableSummarySchema).max(1_000).readonly().optional()
}).strict().superRefine((registry, context) => {
  const installed = new Set(registry.packages.map((entry) => entry.packageId));
  const restoreContexts = new Set<string>();
  for (const [index, entry] of (registry.restorablePackages ?? []).entries()) {
    if (installed.has(entry.packageId)) {
      context.addIssue({ code: "custom", path: ["restorablePackages", index, "packageId"], message: "Installed packages cannot also be restorable." });
    }
    if (restoreContexts.has(entry.restoreContextId)) {
      context.addIssue({ code: "custom", path: ["restorablePackages", index, "restoreContextId"], message: "Restore contexts must be unique." });
    }
    restoreContexts.add(entry.restoreContextId);
  }
});
export const PiPackageRegistryQueryResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), registry: PiPackageRegistrySummarySchema }).strict(),
  z.object({ status: z.literal("failed") }).strict()
]);
export const PiPackageInstallRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageInstallRequestIdSchema,
  expectedRegistryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  packageName: PiPackageNameSchema,
  version: PiPackageVersionSchema
}).strict();
const PiPackageInstallResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageInstallRequestIdSchema,
  taskId: PiPackageInstallTaskIdSchema
});
const PiPackageInstallAuthoritativeResultIdentitySchema =
  PiPackageInstallResultIdentitySchema.extend({ registry: PiPackageRegistrySummarySchema });
export const PiPackageInstallResultSchema = z.discriminatedUnion("status", [
  PiPackageInstallAuthoritativeResultIdentitySchema.extend({ status: z.literal("installed_disabled") }).strict(),
  PiPackageInstallAuthoritativeResultIdentitySchema.extend({ status: z.literal("denied") }).strict(),
  PiPackageInstallAuthoritativeResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  PiPackageInstallResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const PiPackageUninstallRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageUninstallRequestIdSchema,
  expectedRegistryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  packageId: PiPackageIdSchema
}).strict();
const PiPackageUninstallResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageUninstallRequestIdSchema,
  packageId: PiPackageIdSchema
}).strict();
const PiPackageUninstallAuthoritativeResultIdentitySchema =
  PiPackageUninstallResultIdentitySchema.extend({ registry: PiPackageRegistrySummarySchema });
export const PiPackageUninstallResultSchema = z.discriminatedUnion("status", [
  PiPackageUninstallAuthoritativeResultIdentitySchema.extend({ status: z.literal("removed") }).strict(),
  PiPackageUninstallAuthoritativeResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  PiPackageUninstallAuthoritativeResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  PiPackageUninstallAuthoritativeResultIdentitySchema.extend({ status: z.literal("denied") }).strict(),
  PiPackageUninstallResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const PiPackageUpdateRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageUpdateRequestIdSchema,
  packageId: PiPackageIdSchema,
  expectedRegistryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  targetVersion: PiPackageVersionSchema,
  targetIntegrity: PiPackageIntegritySchema
}).strict();
const PiPackageUpdateResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageUpdateRequestIdSchema,
  packageId: PiPackageIdSchema,
  targetVersion: PiPackageVersionSchema,
  targetIntegrity: PiPackageIntegritySchema
}).strict();
const PiPackageUpdateAuthoritativeResultIdentitySchema =
  PiPackageUpdateResultIdentitySchema.extend({ registry: PiPackageRegistrySummarySchema });
export const PiPackageUpdateResultSchema = z.discriminatedUnion("status", [
  PiPackageUpdateAuthoritativeResultIdentitySchema.extend({ status: z.literal("committed") }).strict(),
  PiPackageUpdateAuthoritativeResultIdentitySchema.extend({ status: z.literal("denied") }).strict(),
  PiPackageUpdateAuthoritativeResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  PiPackageUpdateAuthoritativeResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  PiPackageUpdateResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const PiPackageRollbackRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageRollbackRequestIdSchema,
  packageId: PiPackageIdSchema,
  expectedRegistryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  rollbackId: PiPackageRollbackIdSchema,
  targetVersion: PiPackageVersionSchema
}).strict();
const PiPackageRollbackResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageRollbackRequestIdSchema,
  packageId: PiPackageIdSchema,
  rollbackId: PiPackageRollbackIdSchema,
  targetVersion: PiPackageVersionSchema
}).strict();
const PiPackageRollbackAuthoritativeResultIdentitySchema =
  PiPackageRollbackResultIdentitySchema.extend({ registry: PiPackageRegistrySummarySchema });
export const PiPackageRollbackResultSchema = z.discriminatedUnion("status", [
  PiPackageRollbackAuthoritativeResultIdentitySchema.extend({ status: z.literal("committed") }).strict(),
  PiPackageRollbackAuthoritativeResultIdentitySchema.extend({ status: z.literal("denied") }).strict(),
  PiPackageRollbackAuthoritativeResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  PiPackageRollbackAuthoritativeResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  PiPackageRollbackResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const PiPackageSetPinnedRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageSetPinnedRequestIdSchema,
  packageId: PiPackageIdSchema,
  expectedRegistryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pinned: z.boolean()
}).strict();
const PiPackageSetPinnedResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageSetPinnedRequestIdSchema,
  packageId: PiPackageIdSchema,
  pinned: z.boolean()
}).strict();
const PiPackageSetPinnedAuthoritativeResultIdentitySchema =
  PiPackageSetPinnedResultIdentitySchema.extend({ registry: PiPackageRegistrySummarySchema });
export const PiPackageSetPinnedResultSchema = z.discriminatedUnion("status", [
  PiPackageSetPinnedAuthoritativeResultIdentitySchema.extend({ status: z.literal("committed") }).strict(),
  PiPackageSetPinnedAuthoritativeResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  PiPackageSetPinnedAuthoritativeResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  PiPackageSetPinnedResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const PiPackageSetEnabledRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageSetEnabledRequestIdSchema,
  packageId: PiPackageIdSchema,
  expectedRegistryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  enabled: z.boolean()
}).strict();
const PiPackageSetEnabledResultIdentitySchema = PiPackageSetEnabledRequestSchema.omit({ expectedRegistryRevision: true });
const PiPackageSetEnabledAuthoritativeResultIdentitySchema =
  PiPackageSetEnabledResultIdentitySchema.extend({ registry: PiPackageRegistrySummarySchema });
export const PiPackageSetEnabledResultSchema = z.discriminatedUnion("status", [
  PiPackageSetEnabledAuthoritativeResultIdentitySchema.extend({ status: z.literal("committed") }).strict(),
  PiPackageSetEnabledAuthoritativeResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  PiPackageSetEnabledAuthoritativeResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  PiPackageSetEnabledAuthoritativeResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  PiPackageSetEnabledResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const PiPackageRestoreRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageRestoreRequestIdSchema,
  expectedRegistryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  restoreContextId: PiPackageRestoreContextIdSchema,
  packageId: PiPackageIdSchema,
  version: PiPackageVersionSchema,
  integrity: PiPackageIntegritySchema,
  pinned: z.boolean(),
  rollbackTarget: z.object({
    rollbackId: PiPackageRollbackIdSchema,
    targetVersion: PiPackageVersionSchema
  }).strict().nullable()
}).strict();
const PiPackageRestoreResultIdentitySchema = PiPackageRestoreRequestSchema.omit({ expectedRegistryRevision: true });
const PiPackageRestoreAuthoritativeResultIdentitySchema =
  PiPackageRestoreResultIdentitySchema.extend({ registry: PiPackageRegistrySummarySchema });
export const PiPackageRestoreResultSchema = z.discriminatedUnion("status", [
  PiPackageRestoreAuthoritativeResultIdentitySchema.extend({ status: z.literal("committed") }).strict(),
  PiPackageRestoreAuthoritativeResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  PiPackageRestoreAuthoritativeResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  PiPackageRestoreAuthoritativeResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  PiPackageRestoreResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
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
  z.object({ kind: z.literal("executable_name"), value: z.string().refine(isSafeExecutableName) }).strict(),
  z.object({
    kind: z.literal("external_web_skill"),
    value: RendererSafeSubjectLabelSchema,
    version: z.string().min(1).max(80).regex(/^[0-9A-Za-z][0-9A-Za-z._+-]*$/u),
    origin: ExternalWebSkillHttpsOriginSchema,
    capability: z.literal("external_network"),
    dataBoundary: z.literal("network")
  }).strict(),
  z.object({
    kind: z.literal("reviewed_execution_plan"),
    value: RendererSafeSubjectLabelSchema,
    plan: TaskExecutionPlanSummarySchema
  }).strict()
]);
const HighRiskDisplayNameSubjectSchema = z.object({
  kind: z.literal("display_name"),
  value: RendererSafeSubjectLabelSchema
}).strict();
const HighRiskItemCountSubjectSchema = z.object({
  kind: z.literal("item_count"),
  count: z.number().int().min(1).max(8)
}).strict();
const HighRiskExternalWebSkillSubjectSchema = z.object({
  kind: z.literal("external_web_skill"),
  value: RendererSafeSubjectLabelSchema,
  version: z.string().min(1).max(80).regex(/^[0-9A-Za-z][0-9A-Za-z._+-]*$/u),
  origin: ExternalWebSkillHttpsOriginSchema,
  capability: z.literal("external_network"),
  dataBoundary: z.literal("network")
}).strict();
export const HighRiskConfirmationOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent_turn"),
    clientTurnId: AgentClientTurnIdSchema
  }).strict(),
  z.object({
    kind: z.literal("operation"),
    operationId: OperationIdSchema
  }).strict(),
  z.object({
    kind: z.literal("pi_package_install_task"),
    taskId: PiPackageInstallTaskIdSchema
  }).strict(),
  z.object({
    kind: z.literal("permission_policy"),
    policyRequestId: PermissionPolicyRequestIdSchema
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
    effect: z.literal("reviewed_execution_plan"),
    presentation: z.object({
      action: z.literal("execute_reviewed_plan"),
      target: z.literal("local_toolchain"),
      subject: z.object({
        kind: z.literal("reviewed_execution_plan"),
        value: RendererSafeSubjectLabelSchema,
        plan: TaskExecutionPlanSummarySchema
      }).strict()
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
    effect: z.literal("external_web_skill_https_read"),
    presentation: z.object({
      action: z.literal("read_external_web"),
      target: z.literal("reviewed_https_origin"),
      subject: HighRiskExternalWebSkillSubjectSchema
    }).strict(),
    owner: z.object({
      kind: z.literal("agent_turn"),
      clientTurnId: AgentClientTurnIdSchema
    }).strict()
  }).strict(),
  HighRiskConfirmationSummaryBaseSchema.extend({
    effect: z.literal("authority_boundary_change"),
    presentation: z.object({ action: z.literal("change_authority_boundary"), target: z.literal("authority_boundary"), subject: HighRiskDisplayNameSubjectSchema }).strict(),
    owner: HighRiskConfirmationOwnerSchema
  }).strict()
]).superRefine((summary, context) => {
  if (summary.owner.kind === "pi_package_install_task" && summary.effect !== "install_unreviewed_package") {
    context.addIssue({
      code: "custom",
      message: "Pi package install tasks may own only exact package-install confirmation.",
      path: ["owner"]
    });
  }
  if (summary.owner.kind === "permission_policy" && summary.effect !== "authority_boundary_change") {
    context.addIssue({
      code: "custom",
      message: "Permission policy requests may own only exact authority-boundary confirmation.",
      path: ["owner"]
    });
  }
});
export const HighRiskConfirmationPendingResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("pending"),
    revision: z.number().int().positive(),
    confirmation: HighRiskConfirmationSummarySchema,
    rememberScopedGrant: z.object({
      grantContextId: PermissionGrantContextIdSchema,
      scope: z.enum(["actor_version", "resource_scope"]),
      safeScopeLabel: RendererSafeSubjectLabelSchema,
      expiresAt: z.string().datetime({ offset: true })
    }).strict().optional()
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
  decision: z.enum(["allow", "deny"]),
  rememberScopedGrant: z.object({
    decision: z.literal("allow_scoped"),
    grantContextId: PermissionGrantContextIdSchema
  }).strict().optional()
}).strict().superRefine((request, context) => {
  if (request.decision === "deny" && request.rememberScopedGrant !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["rememberScopedGrant"],
      message: "A denial cannot create a remembered scoped grant."
    });
  }
});
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

export const KnowledgeActivityCollectionTargetSchema = z.object({
  kind: z.literal("collection"),
  datasetId: z.string().regex(/^dataset_\d{8}_[a-z0-9]{12,}$/),
  tableId: z.string().regex(/^table_[a-z0-9]{12,}$/),
  revisionId: z.string().regex(/^dataset_rev_\d{8}_[a-z0-9]{12,}$/)
}).strict();

export const MemoryRecordIdSchema = z.string().regex(/^memory_\d{8}_[a-z0-9]{12,}$/);
export const KnowledgeActivityMemoryTargetSchema = z.object({
  kind: z.literal("memory"),
  memoryId: MemoryRecordIdSchema.optional()
}).strict();
export const KnowledgeActivityTargetSchema = z.union([
  KnowledgeActivityPageTargetSchema,
  KnowledgeActivityCollectionTargetSchema,
  KnowledgeActivityMemoryTargetSchema
]);

export const KnowledgeActivityCursorSchema = z.string()
  .regex(/^activity_history_[a-f0-9]{64}$/u);

export const KnowledgeActivityListRequestSchema = z.object({
  limit: z.number().int().min(1).max(20).optional(),
  cursor: KnowledgeActivityCursorSchema.optional()
}).strict();

export const KnowledgeActivitySummarySchema = z.object({
  operationId: OperationIdSchema,
  kind: z.enum([
    "create_page",
    "update_page",
    "rename_page",
    "archive_page",
    "restore_page",
    "trash_page",
    "update_collection_cell",
    "add_collection_row",
    "add_collection_column",
    "update_collection_formula",
    "add_collection_relation",
    "update_collection_relation",
    "update_collection_relation_cell",
    "add_collection_lookup",
    "update_collection_lookup",
    "add_collection_rollup",
    "update_collection_rollup",
    "rename_collection_column",
    "create_collection_view",
    "update_collection_view",
    "rename_collection_view",
    "trash_collection_view",
    "restore_collection_view",
    "trash_collection_column",
    "trash_collection_row",
    "trash_dataset",
    "restore_dataset",
    "create_memory",
    "update_memory",
    "trash_memory",
    "restore_memory",
    "update_source_record",
    "change_setting"
  ]),
  createdAt: z.string().datetime({ offset: true }),
  targetLabel: z.string().min(1).max(120).optional(),
  target: KnowledgeActivityTargetSchema.optional(),
  status: z.enum(["applied", "undone"]),
  canUndo: z.boolean(),
  canRedo: z.boolean().optional(),
  undoUnavailableReason: z.enum([
    "already_undone",
    "content_changed",
    "revision_changed",
    "legacy_record",
    "target_missing"
  ]).optional(),
  redoUnavailableReason: z.enum([
    "already_redone",
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
  activities: z.array(KnowledgeActivitySummarySchema).max(20),
  hasMore: z.boolean(),
  nextCursor: KnowledgeActivityCursorSchema.optional()
}).strict().superRefine((result, context) => {
  if (result.hasMore !== (result.nextCursor !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextCursor"], message: "Activity continuation must match hasMore." });
  }
});

export const KNOWLEDGE_HEALTH_MAX_ISSUE_SUMMARIES = 100;
export const KNOWLEDGE_HEALTH_MAX_DUPLICATE_TOPIC_PAGES = 8;
export const KNOWLEDGE_HEALTH_MAX_BROKEN_LINK_OCCURRENCES = 32;
export const KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES = 128 * 1024;
export const KnowledgeHealthRequestIdSchema = z.string()
  .regex(/^knowledge_health_request_[a-z0-9]{16,64}$/);
export const KnowledgeHealthRepairRequestIdSchema = z.string()
  .regex(/^knowledge_health_repair_request_[a-z0-9]{16,64}$/);
export const KnowledgeHealthTargetSearchRequestIdSchema = z.string()
  .regex(/^knowledge_health_target_search_[a-z0-9]{16,64}$/);
export const KnowledgeHealthOrphanParentSearchRequestIdSchema = z.string()
  .regex(/^knowledge_health_orphan_parent_search_[a-z0-9]{16,64}$/);
export const KnowledgeHealthOrphanRepairRequestIdSchema = z.string()
  .regex(/^knowledge_health_orphan_repair_request_[a-z0-9]{16,64}$/);
export const KnowledgeHealthClaimSourceSearchRequestIdSchema = z.string()
  .regex(/^knowledge_health_claim_source_search_[a-z0-9]{16,64}$/);
export const KnowledgeHealthClaimSourceRepairRequestIdSchema = z.string()
  .regex(/^knowledge_health_claim_source_repair_[a-z0-9]{16,64}$/);
export const KnowledgeHealthRepairContextIdSchema = z.string()
  .regex(/^knowledge_health_repair_context_[a-z0-9]{32,64}$/);
export const KnowledgeHealthTargetContextIdSchema = z.string()
  .regex(/^knowledge_health_target_context_[a-z0-9]{32,64}$/);
export const KnowledgeHealthOrphanParentContextIdSchema = z.string()
  .regex(/^knowledge_health_orphan_parent_context_[a-z0-9]{32,64}$/);
export const KnowledgeHealthClaimSourceContextIdSchema = z.string()
  .regex(/^knowledge_health_claim_source_context_[a-z0-9]{32,64}$/);
export const KnowledgeHealthOccurrenceIdSchema = z.string()
  .regex(/^knowledge_health_occurrence_[a-f0-9]{64}$/);
export const KnowledgeHealthRenderProofSchema = z.string()
  .regex(/^knowledge_health_render_[a-f0-9]{64}$/);
export const KnowledgeHealthPageRevisionSchema = z.string()
  .regex(/^noteeditrev_[a-f0-9]{64}$/);
export const KnowledgeHealthRepairActionSchema = z.enum([
  "unlink_broken_reference",
  "retarget_broken_reference"
]);
export const KnowledgeHealthIndexGenerationSchema = z.string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9:._+#-]+$/);
export const KnowledgeHealthPageRefSchema = z.object({
  pageId: PageIdSchema,
  title: z.string().min(1).max(512)
}).strict();
export const KnowledgeHealthIssueKindSchema = z.enum([
  "broken_link",
  "orphan_page",
  "duplicate_topic",
  "unsourced_claim"
]);
const KnowledgeHealthBrokenLinkOccurrenceSchema = z.object({
  ordinal: z.number().int().min(1).max(KNOWLEDGE_HEALTH_MAX_BROKEN_LINK_OCCURRENCES),
  displayLabel: z.string().min(1).max(256).refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value),
    "Broken-link labels contain unsafe control text."
  ),
  repairContextId: KnowledgeHealthRepairContextIdSchema,
  sourceRevision: KnowledgeHealthPageRevisionSchema,
  sourceRenderProof: KnowledgeHealthRenderProofSchema,
  occurrenceId: KnowledgeHealthOccurrenceIdSchema
}).strict();
const KnowledgeHealthBrokenLinkIssueSchema = z.object({
  kind: z.literal("broken_link"),
  page: KnowledgeHealthPageRefSchema,
  unresolvedLinkCount: z.number().int().min(1).max(10_000_000),
  repairContextId: KnowledgeHealthRepairContextIdSchema.optional(),
  sourceRevision: KnowledgeHealthPageRevisionSchema.optional(),
  sourceRenderProof: KnowledgeHealthRenderProofSchema.optional(),
  occurrenceId: KnowledgeHealthOccurrenceIdSchema.optional(),
  repairableOccurrences: z.array(KnowledgeHealthBrokenLinkOccurrenceSchema)
    .max(KNOWLEDGE_HEALTH_MAX_BROKEN_LINK_OCCURRENCES)
    .optional()
}).strict().superRefine((issue, context) => {
  const legacyProof = [issue.repairContextId, issue.sourceRevision, issue.sourceRenderProof, issue.occurrenceId];
  if (legacyProof.some((value) => value !== undefined) && legacyProof.some((value) => value === undefined)) {
    context.addIssue({ code: "custom", path: ["repairContextId"], message: "Broken-link repair proof must be complete." });
  }
  const occurrences = issue.repairableOccurrences ?? [];
  if (occurrences.length === 0 && issue.repairableOccurrences !== undefined) {
    context.addIssue({ code: "custom", path: ["repairableOccurrences"], message: "Repairable occurrences cannot be empty." });
  }
  if (occurrences.some((occurrence, index) => occurrence.ordinal !== index + 1) ||
    new Set(occurrences.map(({ repairContextId }) => repairContextId)).size !== occurrences.length ||
    new Set(occurrences.map(({ occurrenceId }) => occurrenceId)).size !== occurrences.length) {
    context.addIssue({ code: "custom", path: ["repairableOccurrences"], message: "Broken-link occurrences must be unique and ordered." });
  }
  if (occurrences.some((occurrence) => occurrence.sourceRevision !== occurrences[0]?.sourceRevision ||
    occurrence.sourceRenderProof !== occurrences[0]?.sourceRenderProof)) {
    context.addIssue({ code: "custom", path: ["repairableOccurrences"], message: "Broken-link source proofs must agree." });
  }
});
const KnowledgeHealthOrphanPageIssueSchema = z.object({
  kind: z.literal("orphan_page"),
  page: KnowledgeHealthPageRefSchema,
  repairContextId: KnowledgeHealthRepairContextIdSchema.optional(),
  targetRevision: KnowledgeHealthPageRevisionSchema.optional(),
  targetRenderProof: KnowledgeHealthRenderProofSchema.optional()
}).strict();
const KnowledgeHealthDuplicateTopicIssueSchema = z.object({
  kind: z.literal("duplicate_topic"),
  candidatePageCount: z.number().int().min(2).max(10_000_000),
  pages: z.array(KnowledgeHealthPageRefSchema)
    .min(2)
    .max(KNOWLEDGE_HEALTH_MAX_DUPLICATE_TOPIC_PAGES),
  repairContextId: KnowledgeHealthRepairContextIdSchema.optional(),
  pageProofs: z.array(z.object({
    pageId: PageIdSchema,
    revision: KnowledgeHealthPageRevisionSchema,
    renderProof: KnowledgeHealthRenderProofSchema
  }).strict()).length(2).optional()
}).strict();
const KnowledgeHealthUnsourcedClaimIssueSchema = z.object({
  kind: z.literal("unsourced_claim"),
  page: KnowledgeHealthPageRefSchema,
  repairContextId: KnowledgeHealthRepairContextIdSchema.optional(),
  claimRevision: KnowledgeHealthPageRevisionSchema.optional(),
  claimRenderProof: KnowledgeHealthRenderProofSchema.optional()
}).strict();
export const KnowledgeHealthIssueSummarySchema = z.discriminatedUnion("kind", [
  KnowledgeHealthBrokenLinkIssueSchema,
  KnowledgeHealthOrphanPageIssueSchema,
  KnowledgeHealthDuplicateTopicIssueSchema,
  KnowledgeHealthUnsourcedClaimIssueSchema
]).superRefine((issue, context) => {
  if (issue.kind === "orphan_page") {
    const proofs = [issue.repairContextId, issue.targetRevision, issue.targetRenderProof];
    if (proofs.some((value) => value !== undefined) && proofs.some((value) => value === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["repairContextId"],
        message: "An orphan repair context requires complete target proof."
      });
    }
  }
  if (issue.kind === "duplicate_topic") {
    const pageIds = issue.pages.map(({ pageId }) => pageId);
    if (pageIds.some((pageId, index) => index > 0 && pageId <= pageIds[index - 1]!)) {
      context.addIssue({
        code: "custom",
        path: ["pages"],
        message: "Duplicate-topic page identities must be unique and ordered."
      });
    }
    if (issue.candidatePageCount < issue.pages.length) {
      context.addIssue({
        code: "custom",
        path: ["candidatePageCount"],
        message: "Duplicate-topic candidate totals must include every projected page."
      });
    }
    if ((issue.repairContextId === undefined) !== (issue.pageProofs === undefined)) {
      context.addIssue({ code: "custom", path: ["repairContextId"], message: "Duplicate-topic repair proof must be complete." });
    }
    if (issue.pageProofs) {
      const proofIds = issue.pageProofs.map(({ pageId }) => pageId);
      if (issue.candidatePageCount !== 2 || issue.pages.length !== 2 ||
        proofIds.some((pageId, index) => pageId !== issue.pages[index]?.pageId)) {
        context.addIssue({ code: "custom", path: ["pageProofs"], message: "Duplicate-topic repair requires two ordered current page proofs." });
      }
    }
  }
  if (issue.kind === "unsourced_claim") {
    const proofs = [issue.repairContextId, issue.claimRevision, issue.claimRenderProof];
    if (proofs.some((value) => value !== undefined) && proofs.some((value) => value === undefined)) {
      context.addIssue({ code: "custom", path: ["repairContextId"], message: "Claim repair proof must be complete." });
    }
  }
});
const KnowledgeHealthCountSchema = z.number().int().nonnegative().max(10_000_000);
export const KnowledgeHealthCountsSchema = z.object({
  totalIssueCount: KnowledgeHealthCountSchema,
  brokenLinkPageCount: KnowledgeHealthCountSchema,
  unresolvedLinkCount: KnowledgeHealthCountSchema,
  orphanPageCount: KnowledgeHealthCountSchema,
  duplicateTopicGroupCount: KnowledgeHealthCountSchema,
  unsourcedClaimCount: KnowledgeHealthCountSchema
}).strict().superRefine((counts, context) => {
  if (counts.totalIssueCount !== counts.brokenLinkPageCount + counts.orphanPageCount +
    counts.duplicateTopicGroupCount + counts.unsourcedClaimCount) {
    context.addIssue({ code: "custom", path: ["totalIssueCount"], message: "Knowledge Health totals disagree." });
  }
  if (counts.unresolvedLinkCount < counts.brokenLinkPageCount) {
    context.addIssue({ code: "custom", path: ["unresolvedLinkCount"], message: "Broken-link totals disagree." });
  }
});
export const KnowledgeHealthRunRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: KnowledgeHealthRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();
const KnowledgeHealthResultIdentitySchema = KnowledgeHealthRunRequestSchema;
const KnowledgeHealthReadyResultSchema = KnowledgeHealthResultIdentitySchema.extend({
  status: z.literal("ready"),
  checkedAt: z.string().datetime({ offset: true }),
  indexGeneration: KnowledgeHealthIndexGenerationSchema,
  coverage: z.enum(["complete", "partial"]),
  invalidPageCount: KnowledgeHealthCountSchema,
  counts: KnowledgeHealthCountsSchema,
  issues: z.array(KnowledgeHealthIssueSummarySchema).max(KNOWLEDGE_HEALTH_MAX_ISSUE_SUMMARIES),
  truncated: z.boolean()
}).strict();
export const KnowledgeHealthRunResultSchema = z.discriminatedUnion("status", [
  KnowledgeHealthReadyResultSchema,
  KnowledgeHealthResultIdentitySchema.extend({ status: z.literal("unavailable") }).strict(),
  KnowledgeHealthResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "ready") return;
  if (result.coverage !== "complete" && result.issues.some((issue) =>
    issue.kind === "broken_link" &&
      (issue.repairContextId !== undefined || issue.repairableOccurrences !== undefined)
  )) {
    context.addIssue({
      code: "custom",
      path: ["issues"],
      message: "A repair context requires complete report coverage."
    });
  }
  const keys = result.issues.map((issue) => {
    switch (issue.kind) {
      case "broken_link": return `0:${issue.page.pageId}`;
      case "orphan_page": return `1:${issue.page.pageId}`;
      case "duplicate_topic": return `2:${issue.pages.map(({ pageId }) => pageId).join(":")}`;
      case "unsourced_claim": return `3:${issue.page.pageId}`;
    }
  });
  if (keys.some((key, index) => index > 0 && key <= keys[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["issues"], message: "Knowledge Health issues must be unique and stably ordered." });
  }
  const duplicateGroupTruncated = result.issues.some((issue) =>
    issue.kind === "duplicate_topic" && issue.candidatePageCount > issue.pages.length
  );
  if (result.truncated !== (result.counts.totalIssueCount > result.issues.length || duplicateGroupTruncated)) {
    context.addIssue({ code: "custom", path: ["truncated"], message: "Knowledge Health truncation disagrees with complete counts." });
  }
  if ((result.coverage === "complete") !== (result.invalidPageCount === 0)) {
    context.addIssue({ code: "custom", path: ["coverage"], message: "Knowledge Health coverage disagrees with invalid-page count." });
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > KNOWLEDGE_HEALTH_MAX_RESULT_UTF8_BYTES) {
    context.addIssue({ code: "custom", path: [], message: "Knowledge Health result exceeds its UTF-8 byte bound." });
  }
});

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

export const NOTE_RECONNECT_ORIGINAL_SOURCE_CHANNEL = "notes.reconnectOriginalSource" as const;
export const SOURCE_RECONNECTABLE_ORIGINALS_CHANNEL = "sources.reconnectableOriginals" as const;
export const SOURCE_RECONNECT_ORIGINAL_CHANNEL = "sources.reconnectOriginal" as const;
export const NoteReconnectOriginalSourceRequestIdSchema = z.string()
  .regex(/^notesourcereconnect_[a-z0-9]{16,64}$/);
export const SourceReconnectListRequestIdSchema = z.string()
  .regex(/^sourcereconnectlist_[a-z0-9]{16,64}$/);
export const SourceReconnectRequestIdSchema = z.string()
  .regex(/^sourcereconnectdirect_[a-z0-9]{16,64}$/);
export const SourceRelinkPreviewIdSchema = z.string().regex(/^sourcerelinkpreview_[a-f0-9]{32}$/);
export const SourceRecordRevisionSchema = z.string().regex(/^sourcerev_[a-f0-9]{64}$/);
export const SourceFormatIdentitySchema = z.string().regex(/^sourcefmt_[a-f0-9]{64}$/);
export const SourceContentChecksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const ReferencedOriginalReconnectProofSchema = z.object({
  sourceId: SourceIdSchema,
  sourceKind: SourceKindSchema,
  sourceRevision: SourceRecordRevisionSchema,
  expectedAvailability: z.literal("unavailable"),
  expectedChecksum: SourceContentChecksumSchema,
  expectedSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  formatIdentity: SourceFormatIdentitySchema
}).strict();
export const ReferencedOriginalReconnectCandidateSchema = ReferencedOriginalReconnectProofSchema.extend({
  displayName: z.string().min(1).max(512)
}).strict();
export const ReferencedOriginalChangedPreviewSchema = z.object({
  previewId: SourceRelinkPreviewIdSchema,
  expectedSourceRevision: SourceRecordRevisionSchema,
  displayName: z.string().min(1).max(512),
  sourceKind: SourceKindSchema,
  previousSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currentSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  affectedArtifactCount: z.number().int().nonnegative().max(10_000),
  refreshesSourcePage: z.boolean()
}).strict();
export const NoteReconnectOriginalSourceRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteReconnectOriginalSourceRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  ...ReferencedOriginalReconnectProofSchema.shape,
  previewId: SourceRelinkPreviewIdSchema.optional()
}).strict();
export const SourceReconnectListRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: SourceReconnectListRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();
const SourceReconnectListIdentitySchema = SourceReconnectListRequestSchema;
export const SourceReconnectListResultSchema = z.discriminatedUnion("status", [
  SourceReconnectListIdentitySchema.extend({
    status: z.literal("ready"),
    sources: z.array(ReferencedOriginalReconnectCandidateSchema).max(20),
    truncated: z.boolean()
  }).strict(),
  SourceReconnectListIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  SourceReconnectListIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "ready") return;
  const sourceIds = result.sources.map((source) => source.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({ code: "custom", path: ["sources"], message: "Reconnectable sources must be unique." });
  }
});
export const SourceReconnectRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: SourceReconnectRequestIdSchema,
  activeVaultId: VaultIdSchema,
  ...ReferencedOriginalReconnectProofSchema.shape,
  previewId: SourceRelinkPreviewIdSchema.optional()
}).strict();
const SourceReconnectIdentitySchema = SourceReconnectRequestSchema;
export const SourceReconnectResultSchema = z.discriminatedUnion("status", [
  SourceReconnectIdentitySchema.extend({
    status: z.literal("reconnected"),
    operationId: OperationIdSchema,
    contentState: z.enum(["current", "changed"]),
    resumedJobCount: z.number().int().nonnegative().max(1_000)
  }).strict(),
  SourceReconnectIdentitySchema.extend({
    status: z.literal("changed"),
    preview: ReferencedOriginalChangedPreviewSchema
  }).strict(),
  ...(["cancelled", "stale", "not_found", "ineligible", "mismatch", "failed"] as const).map((status) =>
    SourceReconnectIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
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

export const NOTE_EDITOR_MAX_MARKDOWN_UTF8_BYTES = 4 * 1024 * 1024;
export const NOTE_EDITOR_MAX_RENDERED_HTML_UTF8_BYTES = 8 * 1024 * 1024;
export const NoteEditorRequestIdSchema = z.string().regex(/^noteeditreq_[a-z0-9]{8,64}$/);
export const NoteEditorRevisionSchema = z.string().regex(/^noteeditrev_[a-z0-9]{32,64}$/);
export const NOTE_REVEAL_GENERATED_CHANNEL = "notes.revealGenerated" as const;
export const NoteRevealGeneratedRequestIdSchema = z.string().regex(/^notegeneratedreveal_[a-z0-9]{16,64}$/);
export const NoteRevealGeneratedRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteRevealGeneratedRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema
}).strict();
const NoteRevealGeneratedResultIdentitySchema = NoteRevealGeneratedRequestSchema;
export const NoteRevealGeneratedResultSchema = z.discriminatedUnion("status", [
  NoteRevealGeneratedResultIdentitySchema.extend({ status: z.literal("revealed") }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteRevealGeneratedResultIdentitySchema.extend({ status: z.literal(status) }).strict())
]);
export const NoteTrashCurrentRequestIdSchema = z.string().regex(/^notetrashreq_[a-z0-9]{16,64}$/);
export const NoteTrashListRequestIdSchema = z.string().regex(/^notetrashlistreq_[a-z0-9]{16,64}$/);
export const NoteTrashRestoreRequestIdSchema = z.string().regex(/^notetrashrestorereq_[a-z0-9]{16,64}$/);
export const NoteTrashRevisionSchema = z.string().regex(/^notetrashrev_[a-f0-9]{64}$/);
export const NoteRevisionHistoryRequestIdSchema = z.string().regex(/^notehistoryreq_[a-z0-9]{16,64}$/);
export const NoteRevisionHistoryRevisionIdSchema = z.string().regex(/^notehistoryrev_[a-f0-9]{64}$/);
export const NoteArchiveCurrentRequestIdSchema = z.string().regex(/^notearchivereq_[a-z0-9]{16,64}$/);
export const NoteRestoreArchivedRequestIdSchema = z.string().regex(/^noterestorereq_[a-z0-9]{16,64}$/);
export const NoteQuestionStateRequestIdSchema = z.string().regex(/^notequestionreq_[a-z0-9]{16,64}$/);
export const NoteQuestionAnswerRequestIdSchema = z.string().regex(/^questionanswerreq_[a-z0-9]{16,64}$/);
export const NoteClaimContradictionRequestIdSchema = z.string().regex(/^claimcontradictionreq_[a-z0-9]{16,64}$/);
export const NoteConceptParentRequestIdSchema = z.string().regex(/^conceptparentreq_[a-z0-9]{16,64}$/);
export const NoteAddTagRequestIdSchema = z.string().regex(/^noteaddtagreq_[a-z0-9]{16,64}$/);
export const NoteEditTaxonomyRequestIdSchema = z.string().regex(/^notetaxonomyreq_[a-z0-9]{16,64}$/);
export const NoteRenameRequestIdSchema = z.string().regex(/^noterenamereq_[a-z0-9]{16,64}$/);
export const NoteAliasChangeRequestIdSchema = z.string().regex(/^notealiasreq_[a-z0-9]{16,64}$/);
export const NoteCanonicalTitleSchema = z.string().min(1).max(120).refine(
  (value) => !/[\u0000-\u001f\u007f]/u.test(value) &&
    value === value.normalize("NFKC").replace(/\s+/gu, " ").trim(),
  "Note titles must use the canonical Markdown title representation."
);
export const NoteCanonicalAliasSchema = z.string().min(1).max(120).refine(
  (value) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value) &&
    value === value.normalize("NFKC").replace(/\s+/gu, " ").trim(),
  "Note aliases must use the canonical Markdown alias representation."
);
export const NoteRemoveTagRequestIdSchema = z.string().regex(/^noteremovetagreq_[a-z0-9]{16,64}$/);
export const NoteCanonicalTagSchema = z.string().min(1).max(48).refine(
  (value) => !/[\u0000-\u001f\u007f]/u.test(value) &&
    value === value.normalize("NFKC").replace(/\s+/gu, " ").trim(),
  "Note tags must use the canonical Markdown tag representation."
);
export const NoteCanonicalTopicSchema = z.string().min(1).max(80).refine(
  (value) => !/[\u0000-\u001f\u007f]/u.test(value) &&
    value === value.normalize("NFKC").replace(/\s+/gu, " ").trim(),
  "Note topics must use the canonical Markdown topic representation."
);
export const NoteTrashEligibilitySchema = z.object({
  canTrash: z.boolean(),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteArchiveEligibilitySchema = z.object({
  canArchive: z.boolean(),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteRestoreEligibilitySchema = z.object({
  canRestore: z.boolean(),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteRenameEligibilitySchema = z.object({
  canRename: z.boolean(),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteAliasingSummarySchema = z.object({
  aliases: z.array(NoteCanonicalAliasSchema).max(64).readonly(),
  canAdd: z.boolean(),
  canRemove: z.boolean(),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteTaggingSummarySchema = z.object({
  tags: z.array(NoteCanonicalTagSchema).max(12).readonly(),
  topics: z.array(NoteCanonicalTopicSchema).max(8).readonly().default([]),
  canAdd: z.boolean(),
  canEdit: z.boolean().default(false),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteRevisionHistoryEligibilitySchema = z.object({
  canBrowse: z.boolean(),
  revision: NoteEditorRevisionSchema
}).strict();
export const TopicRenameEligibilitySchema = z.object({
  canRename: z.boolean(),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteEditorPortableMarkdownSchema = z.string()
  .max(NOTE_EDITOR_MAX_MARKDOWN_UTF8_BYTES)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= NOTE_EDITOR_MAX_MARKDOWN_UTF8_BYTES,
    "Editable Markdown exceeds the UTF-8 byte limit."
  )
  .refine((value) => !value.includes("\0"), "Editable Markdown must not contain null bytes.");
const NoteRenderedHtmlSchema = z.string()
  .max(NOTE_EDITOR_MAX_RENDERED_HTML_UTF8_BYTES)
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= NOTE_EDITOR_MAX_RENDERED_HTML_UTF8_BYTES,
    "Rendered note HTML exceeds the UTF-8 byte limit."
  );
export const NoteRenderPageSummarySchema = z.object({
  pageId: PageIdSchema,
  title: z.string().min(1).max(512),
  pageType: MarkdownPageTypeSchema,
  status: MarkdownPageStatusSchema,
  pagePath: z.string().min(1).max(4_096).refine((value) => !value.includes("\0")),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  language: z.string().min(1).max(64).optional(),
  sourceIds: z.array(SourceIdSchema).max(1_000)
}).strict();
const NOTE_SOURCE_DISPLAY_NAME_UNSAFE_CHARACTER_PATTERN =
  /[\\/\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
const NOTE_SOURCE_DISPLAY_NAME_URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;
export const NoteSourceDisplayNameSchema = z.string().trim().min(1).max(160)
  .refine((value) => !NOTE_SOURCE_DISPLAY_NAME_UNSAFE_CHARACTER_PATTERN.test(value))
  .refine((value) => !NOTE_SOURCE_DISPLAY_NAME_URI_SCHEME_PATTERN.test(value));
export const NoteSourceMetadataItemSchema = z.discriminatedUnion("status", [
  z.object({
    sourceId: SourceIdSchema,
    status: z.literal("current"),
    displayName: NoteSourceDisplayNameSchema.optional(),
    category: z.enum(["text", "web", "document", "image", "data"]),
    storage: z.enum(["managed_copy", "reference_original"]),
    extraction: z.enum(["none", "text", "ocr"])
  }).strict(),
  z.object({ sourceId: SourceIdSchema, status: z.literal("unavailable") }).strict()
]);
export const NoteSourceMetadataSummarySchema = z.object({
  items: z.array(NoteSourceMetadataItemSchema).max(5),
  remainingCount: z.number().int().nonnegative().max(995)
}).strict();
export const NoteQuestionStateSchema = z.enum(["open", "partially_answered", "answered", "stale"]);
export const NoteQuestionAnswerItemSchema = z.object({
  pageId: PageIdSchema,
  title: z.string().min(1).max(240),
  pageType: z.enum(["note", "claim"]),
  updatedAt: z.string().datetime({ offset: true })
}).strict();
export const NoteQuestionAnswersSummarySchema = z.object({
  canEdit: z.boolean(),
  revision: NoteEditorRevisionSchema,
  items: z.array(NoteQuestionAnswerItemSchema).max(32)
}).strict();
export const NoteQuestionStateSummarySchema = z.object({
  state: NoteQuestionStateSchema,
  canChange: z.boolean(),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteClaimContradictionItemSchema = z.object({
  pageId: PageIdSchema,
  title: z.string().min(1).max(512),
  updatedAt: z.string().datetime({ offset: true })
}).strict();
export const NoteClaimContradictionsSummarySchema = z.object({
  items: z.array(NoteClaimContradictionItemSchema).max(32),
  canEdit: z.boolean(),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteConceptParentItemSchema = z.object({
  pageId: PageIdSchema,
  title: z.string().min(1).max(512),
  updatedAt: z.string().datetime({ offset: true })
}).strict();
export const NoteConceptParentsSummarySchema = z.object({
  items: z.array(NoteConceptParentItemSchema).max(32),
  canEdit: z.boolean(),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteRevealGeneratedEligibilitySchema = z.object({
  canReveal: z.literal(true),
  revision: NoteEditorRevisionSchema
}).strict();
export const NoteRenderResultSchema = z.object({
  summary: NoteRenderPageSummarySchema,
  html: NoteRenderedHtmlSchema,
  byteSize: z.number().int().nonnegative().max(NOTE_EDITOR_MAX_MARKDOWN_UTF8_BYTES),
  renderContextId: NoteRenderContextIdSchema.optional(),
  trashEligibility: NoteTrashEligibilitySchema.optional(),
  archiveEligibility: NoteArchiveEligibilitySchema.optional(),
  restoreEligibility: NoteRestoreEligibilitySchema.optional(),
  historyEligibility: NoteRevisionHistoryEligibilitySchema.optional(),
  revealGeneratedEligibility: NoteRevealGeneratedEligibilitySchema.optional(),
  renameEligibility: NoteRenameEligibilitySchema.optional(),
  aliasing: NoteAliasingSummarySchema.optional(),
  tagging: NoteTaggingSummarySchema.optional(),
  topicRenameEligibility: TopicRenameEligibilitySchema.optional(),
  sourceMetadata: NoteSourceMetadataSummarySchema.optional(),
  questionState: NoteQuestionStateSummarySchema.optional(),
  questionAnswers: NoteQuestionAnswersSummarySchema.optional(),
  claimContradictions: NoteClaimContradictionsSummarySchema.optional(),
  conceptParents: NoteConceptParentsSummarySchema.optional(),
  refreshableSourceIds: z.array(SourceIdSchema).max(1_000).optional(),
  reconnectOriginalSourceIds: z.array(SourceIdSchema).max(5).optional(),
  reconnectOriginalSources: z.array(ReferencedOriginalReconnectCandidateSchema).max(5).optional()
}).strict();
export const NOTE_OPEN_SEARCH_MATCH_CHANNEL = "notes.openSearchMatch" as const;
export const NoteOpenSearchMatchRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: z.string().regex(/^notesearch_[a-z0-9]{16,64}$/u),
  activeVaultId: VaultIdSchema,
  pageId: PageIdSchema,
  query: z.string().trim().min(1).refine(
    (value) => Array.from(value).length <= 320,
    "Search focus queries must contain at most 320 Unicode characters."
  )
}).strict();
const NoteOpenSearchMatchResultIdentitySchema = NoteOpenSearchMatchRequestSchema.omit({ query: true });
export const NoteOpenSearchMatchResultSchema = z.discriminatedUnion("status", [
  NoteOpenSearchMatchResultIdentitySchema.extend({
    status: z.literal("ready"),
    render: NoteRenderResultSchema,
    focusSegmentId: ReaderSelectionSegmentIdSchema.optional()
  }).strict(),
  NoteOpenSearchMatchResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  NoteOpenSearchMatchResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  NoteOpenSearchMatchResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
const NoteReconnectOriginalSourceResultIdentitySchema = NoteReconnectOriginalSourceRequestSchema;
export const NoteReconnectOriginalSourceResultSchema = z.discriminatedUnion("status", [
  NoteReconnectOriginalSourceResultIdentitySchema.extend({
    status: z.literal("reconnected"),
    render: NoteRenderResultSchema,
    operationId: OperationIdSchema,
    contentState: z.enum(["current", "changed"]),
    resumedJobCount: z.number().int().nonnegative().max(1_000)
  }).strict(),
  NoteReconnectOriginalSourceResultIdentitySchema.extend({
    status: z.literal("changed"),
    preview: ReferencedOriginalChangedPreviewSchema
  }).strict(),
  ...(["cancelled", "stale", "not_found", "ineligible", "mismatch", "failed"] as const).map((status) =>
    NoteReconnectOriginalSourceResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
const NoteEditorResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteEditorRequestIdSchema,
  activeVaultId: VaultIdSchema,
  pageId: PageIdSchema
});
export const NoteEditorOpenRequestSchema = NoteEditorResultIdentitySchema.extend({
  renderContextId: NoteRenderContextIdSchema
}).strict();
export const NoteEditorOpenResultSchema = z.discriminatedUnion("status", [
  NoteEditorResultIdentitySchema.extend({
    status: z.literal("ready"),
    renderContextId: NoteRenderContextIdSchema,
    revision: NoteEditorRevisionSchema,
    markdown: NoteEditorPortableMarkdownSchema
  }).strict(),
  NoteEditorResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  NoteEditorResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  NoteEditorResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const NoteEditorInvalidReasonSchema = z.enum([
  "markdown_too_large",
  "invalid_frontmatter",
  "page_id_changed",
  "unsupported_page_type",
  "invalid_wiki_link",
  "invalid_citation"
]);
export const NoteEditorSaveRequestSchema = NoteEditorResultIdentitySchema.extend({
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  markdown: NoteEditorPortableMarkdownSchema
}).strict();
export const NoteEditorSaveResultSchema = z.discriminatedUnion("status", [
  NoteEditorResultIdentitySchema.extend({
    status: z.literal("committed"),
    revision: NoteEditorRevisionSchema,
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema.extend({ renderContextId: NoteRenderContextIdSchema }).strict()
  }).strict(),
  NoteEditorResultIdentitySchema.extend({
    status: z.literal("stale"),
    revision: NoteEditorRevisionSchema
  }).strict(),
  NoteEditorResultIdentitySchema.extend({
    status: z.literal("invalid"),
    reason: NoteEditorInvalidReasonSchema
  }).strict(),
  NoteEditorResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  NoteEditorResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const NOTE_TRASH_CURRENT_CHANNEL = "notes.trashCurrent" as const;
export const NOTE_TRASH_LIST_CHANNEL = "notes.listTrash" as const;
export const NOTE_TRASH_RESTORE_CHANNEL = "notes.restoreTrash" as const;
export const NOTE_ARCHIVE_CURRENT_CHANNEL = "notes.archiveCurrent" as const;
export const NOTE_RESTORE_ARCHIVED_CHANNEL = "notes.restoreArchived" as const;
export const NOTE_SET_QUESTION_STATE_CHANNEL = "notes.setQuestionState" as const;
export const NOTE_SEARCH_QUESTION_ANSWERS_CHANNEL = "notes.searchQuestionAnswers" as const;
export const NOTE_CHANGE_QUESTION_ANSWER_CHANNEL = "notes.changeQuestionAnswer" as const;
export const NOTE_SEARCH_CLAIM_CONTRADICTIONS_CHANNEL = "notes.searchClaimContradictions" as const;
export const NOTE_CHANGE_CLAIM_CONTRADICTION_CHANNEL = "notes.changeClaimContradiction" as const;
export const NOTE_SEARCH_CONCEPT_PARENTS_CHANNEL = "notes.searchConceptParents" as const;
export const NOTE_CHANGE_CONCEPT_PARENT_CHANNEL = "notes.changeConceptParent" as const;
export const NOTE_ADD_TAG_CHANNEL = "notes.addTag" as const;
export const NOTE_EDIT_TAXONOMY_CHANNEL = "notes.editTaxonomy" as const;
export const NOTE_RENAME_CHANNEL = "notes.rename" as const;
export const NOTE_CHANGE_ALIAS_CHANNEL = "notes.changeAlias" as const;
export const NOTE_REMOVE_TAG_CHANNEL = "notes.removeTag" as const;
export const NOTE_IMPORT_MARKDOWN_CHANNEL = "notes.importMarkdown" as const;
export const NoteImportMarkdownRequestIdSchema = z.string()
  .regex(/^noteimport_[a-z0-9]{16,64}$/u);
export const NoteImportMarkdownRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteImportMarkdownRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();
const NoteImportMarkdownResultIdentitySchema = NoteImportMarkdownRequestSchema;
export const NoteImportMarkdownResultSchema = z.discriminatedUnion("status", [
  NoteImportMarkdownResultIdentitySchema.extend({
    status: z.literal("imported"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema
  }).strict(),
  ...(["cancelled", "stale", "invalid", "failed"] as const).map((status) =>
    NoteImportMarkdownResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteArchiveCurrentRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteArchiveCurrentRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema
}).strict();
const NoteArchiveCurrentResultIdentitySchema = NoteArchiveCurrentRequestSchema;
export const NoteArchiveCurrentResultSchema = z.discriminatedUnion("status", [
  NoteArchiveCurrentResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteArchiveCurrentResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteRestoreArchivedRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteRestoreArchivedRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema
}).strict();
const NoteRestoreArchivedResultIdentitySchema = NoteRestoreArchivedRequestSchema;
export const NoteRestoreArchivedResultSchema = z.discriminatedUnion("status", [
  NoteRestoreArchivedResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteRestoreArchivedResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteSetQuestionStateRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteQuestionStateRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  state: NoteQuestionStateSchema
}).strict();
const NoteSetQuestionStateResultIdentitySchema = NoteSetQuestionStateRequestSchema;
export const NoteSetQuestionStateResultSchema = z.discriminatedUnion("status", [
  NoteSetQuestionStateResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema.extend({ renderContextId: NoteRenderContextIdSchema }).strict()
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteSetQuestionStateResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
const NoteQuestionAnswerOwnerSchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema
}).strict();
export const NoteSearchQuestionAnswersRequestSchema = NoteQuestionAnswerOwnerSchema.extend({
  requestId: NoteQuestionAnswerRequestIdSchema,
  query: z.string().trim().min(1).max(160)
}).strict();
export const NoteSearchQuestionAnswersResultSchema = z.discriminatedUnion("status", [
  NoteSearchQuestionAnswersRequestSchema.extend({
    status: z.literal("ready"),
    candidates: z.array(NoteQuestionAnswerItemSchema).max(20)
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteSearchQuestionAnswersRequestSchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteChangeQuestionAnswerRequestSchema = NoteQuestionAnswerOwnerSchema.extend({
  requestId: NoteQuestionAnswerRequestIdSchema,
  action: z.enum(["add", "remove"]),
  targetPageId: PageIdSchema,
  expectedTargetUpdatedAt: z.string().datetime({ offset: true }).optional()
}).strict().superRefine((request, context) => {
  if (request.action === "add" && !request.expectedTargetUpdatedAt) context.addIssue({
    code: "custom", path: ["expectedTargetUpdatedAt"], message: "Adding an answer requires current target identity."
  });
});
export const NoteChangeQuestionAnswerResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1), requestId: NoteQuestionAnswerRequestIdSchema, activeVaultId: VaultIdSchema,
    currentPageId: PageIdSchema, renderContextId: NoteRenderContextIdSchema,
    expectedRevision: NoteEditorRevisionSchema, action: z.enum(["add", "remove"]), targetPageId: PageIdSchema,
    expectedTargetUpdatedAt: z.string().datetime({ offset: true }).optional(), status: z.literal("committed"),
    operationId: OperationIdSchema, render: NoteRenderResultSchema.extend({ renderContextId: NoteRenderContextIdSchema }).strict()
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) => z.object({
    apiVersion: z.literal(1), requestId: NoteQuestionAnswerRequestIdSchema, activeVaultId: VaultIdSchema,
    currentPageId: PageIdSchema, renderContextId: NoteRenderContextIdSchema,
    expectedRevision: NoteEditorRevisionSchema, action: z.enum(["add", "remove"]), targetPageId: PageIdSchema,
    expectedTargetUpdatedAt: z.string().datetime({ offset: true }).optional(), status: z.literal(status)
  }).strict())
]);
const NoteClaimContradictionIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteClaimContradictionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema
}).strict();
export const NoteSearchClaimContradictionsRequestSchema = NoteClaimContradictionIdentitySchema.extend({
  query: z.string().trim().min(1).max(160)
}).strict();
export const NoteSearchClaimContradictionsResultSchema = z.discriminatedUnion("status", [
  NoteSearchClaimContradictionsRequestSchema.extend({
    status: z.literal("ready"),
    candidates: z.array(NoteClaimContradictionItemSchema).max(20)
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteSearchClaimContradictionsRequestSchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteChangeClaimContradictionRequestSchema = NoteClaimContradictionIdentitySchema.extend({
  action: z.enum(["add", "remove"]),
  targetPageId: PageIdSchema,
  expectedTargetUpdatedAt: z.string().datetime({ offset: true }).optional()
}).superRefine((value, context) => {
  if (value.action === "add" && !value.expectedTargetUpdatedAt) {
    context.addIssue({ code: "custom", path: ["expectedTargetUpdatedAt"], message: "Adding a contradiction requires the current target identity." });
  }
  if (value.action === "remove" && value.expectedTargetUpdatedAt !== undefined) {
    context.addIssue({ code: "custom", path: ["expectedTargetUpdatedAt"], message: "Removing a contradiction must not accept renderer target authority." });
  }
});
const NoteChangeClaimContradictionResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteClaimContradictionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  action: z.enum(["add", "remove"]),
  targetPageId: PageIdSchema,
  expectedTargetUpdatedAt: z.string().datetime({ offset: true }).optional()
}).strict();
export const NoteChangeClaimContradictionResultSchema = z.discriminatedUnion("status", [
  NoteChangeClaimContradictionResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema.extend({ renderContextId: NoteRenderContextIdSchema }).strict()
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteChangeClaimContradictionResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
const NoteConceptParentIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteConceptParentRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema
}).strict();
export const NoteSearchConceptParentsRequestSchema = NoteConceptParentIdentitySchema.extend({
  query: z.string().trim().min(1).max(160)
}).strict();
export const NoteSearchConceptParentsResultSchema = z.discriminatedUnion("status", [
  NoteSearchConceptParentsRequestSchema.extend({
    status: z.literal("ready"),
    candidates: z.array(NoteConceptParentItemSchema).max(20)
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteSearchConceptParentsRequestSchema.extend({ status: z.literal(status) }).strict())
]);
export const NoteChangeConceptParentRequestSchema = NoteConceptParentIdentitySchema.extend({
  action: z.enum(["add", "remove"]),
  targetPageId: PageIdSchema,
  expectedTargetUpdatedAt: z.string().datetime({ offset: true }).optional()
}).superRefine((value, context) => {
  if (value.action === "add" && !value.expectedTargetUpdatedAt) context.addIssue({
    code: "custom", path: ["expectedTargetUpdatedAt"], message: "Adding a concept parent requires current target identity."
  });
  if (value.action === "remove" && value.expectedTargetUpdatedAt !== undefined) context.addIssue({
    code: "custom", path: ["expectedTargetUpdatedAt"], message: "Removing a concept parent must not accept renderer target authority."
  });
});
const NoteChangeConceptParentResultIdentitySchema = z.object({
  apiVersion: z.literal(1), requestId: NoteConceptParentRequestIdSchema, activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema, renderContextId: NoteRenderContextIdSchema, expectedRevision: NoteEditorRevisionSchema,
  action: z.enum(["add", "remove"]), targetPageId: PageIdSchema,
  expectedTargetUpdatedAt: z.string().datetime({ offset: true }).optional()
}).strict();
export const NoteChangeConceptParentResultSchema = z.discriminatedUnion("status", [
  NoteChangeConceptParentResultIdentitySchema.extend({
    status: z.literal("committed"), operationId: OperationIdSchema,
    render: NoteRenderResultSchema.extend({ renderContextId: NoteRenderContextIdSchema }).strict()
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteChangeConceptParentResultIdentitySchema.extend({ status: z.literal(status) }).strict())
]);
export const NoteAddTagRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteAddTagRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  tag: NoteCanonicalTagSchema
}).strict();
const NoteAddTagResultIdentitySchema = NoteAddTagRequestSchema;
export const NoteAddTagResultSchema = z.discriminatedUnion("status", [
  NoteAddTagResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteAddTagResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
const NoteEditTaxonomyIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteEditTaxonomyRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  tags: z.array(NoteCanonicalTagSchema).max(12).readonly(),
  topics: z.array(NoteCanonicalTopicSchema).max(8).readonly()
}).strict();
export const NoteEditTaxonomyRequestSchema = NoteEditTaxonomyIdentitySchema.superRefine((value, context) => {
  for (const [field, values] of [["tags", value.tags], ["topics", value.topics]] as const) {
    const keys = values.map((entry) => entry.normalize("NFKC").toLocaleLowerCase("en-US"));
    if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: [field], message: `${field} must be unique.` });
  }
});
const NoteEditTaxonomyResultIdentitySchema = NoteEditTaxonomyIdentitySchema;
export const NoteEditTaxonomyResultSchema = z.discriminatedUnion("status", [
  NoteEditTaxonomyResultIdentitySchema.extend({
    status: z.literal("committed"), operationId: OperationIdSchema, render: NoteRenderResultSchema
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteEditTaxonomyResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteRenameRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteRenameRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  title: NoteCanonicalTitleSchema
}).strict();
const NoteRenameResultIdentitySchema = NoteRenameRequestSchema;
export const NoteRenameResultSchema = z.discriminatedUnion("status", [
  NoteRenameResultIdentitySchema.extend({
    status: z.literal("committed"), operationId: OperationIdSchema, render: NoteRenderResultSchema
  }).strict(),
  ...(["stale", "not_found", "ineligible", "conflict", "failed"] as const).map((status) =>
    NoteRenameResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteAliasChangeRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteAliasChangeRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  action: z.enum(["add", "remove"]),
  alias: NoteCanonicalAliasSchema
}).strict();
const NoteAliasChangeResultIdentitySchema = NoteAliasChangeRequestSchema;
export const NoteAliasChangeResultSchema = z.discriminatedUnion("status", [
  NoteAliasChangeResultIdentitySchema.extend({
    status: z.literal("committed"), operationId: OperationIdSchema, render: NoteRenderResultSchema
  }).strict(),
  ...(["stale", "not_found", "ineligible", "conflict", "failed"] as const).map((status) =>
    NoteAliasChangeResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteRemoveTagRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteRemoveTagRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  tag: NoteCanonicalTagSchema
}).strict();
const NoteRemoveTagResultIdentitySchema = NoteRemoveTagRequestSchema;
export const NoteRemoveTagResultSchema = z.discriminatedUnion("status", [
  NoteRemoveTagResultIdentitySchema.extend({ status: z.literal("committed"), operationId: OperationIdSchema, render: NoteRenderResultSchema }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteRemoveTagResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteTrashCurrentRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteTrashCurrentRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema
}).strict();
const NoteTrashCurrentResultIdentitySchema = NoteTrashCurrentRequestSchema;
const NoteTrashCurrentCommittedAuthoritySchema = z.object({
  pageId: PageIdSchema,
  pageState: z.literal("trashed"),
  readerState: z.literal("closed"),
  libraryPresence: z.literal("absent"),
  canTrash: z.literal(false)
}).strict();
const NoteTrashCurrentStaleAuthoritySchema = z.object({
  pageId: PageIdSchema,
  pageState: z.literal("present"),
  readerState: z.literal("refresh_required"),
  libraryPresence: z.literal("present"),
  canTrash: z.literal(false)
}).strict();
const NoteTrashCurrentIneligibleAuthoritySchema = z.object({
  pageId: PageIdSchema,
  pageState: z.literal("present"),
  readerState: z.literal("preserved"),
  libraryPresence: z.literal("present"),
  canTrash: z.literal(false)
}).strict();
const NoteTrashCurrentMissingAuthoritySchema = z.object({
  pageId: PageIdSchema,
  pageState: z.literal("missing"),
  readerState: z.literal("closed"),
  libraryPresence: z.literal("absent"),
  canTrash: z.literal(false)
}).strict();
export const NoteTrashCurrentResultSchema = z.discriminatedUnion("status", [
  NoteTrashCurrentResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    authority: NoteTrashCurrentCommittedAuthoritySchema
  }).strict(),
  NoteTrashCurrentResultIdentitySchema.extend({
    status: z.literal("stale"),
    authority: NoteTrashCurrentStaleAuthoritySchema
  }).strict(),
  NoteTrashCurrentResultIdentitySchema.extend({
    status: z.literal("not_found"),
    authority: NoteTrashCurrentMissingAuthoritySchema
  }).strict(),
  NoteTrashCurrentResultIdentitySchema.extend({
    status: z.literal("ineligible"),
    authority: NoteTrashCurrentIneligibleAuthoritySchema
  }).strict(),
  NoteTrashCurrentResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status === "failed") return;
  if (result.authority.pageId !== result.currentPageId) {
    context.addIssue({
      code: "custom",
      path: ["authority", "pageId"],
      message: "Note trash authority must match the requested current page."
    });
  }
});

export const NoteTrashSummarySchema = z.object({
  trashOperationId: OperationIdSchema,
  expectedTrashRevision: NoteTrashRevisionSchema,
  pageId: PageIdSchema,
  title: z.string().min(1).max(120),
  trashedAt: z.string().datetime({ offset: true }),
  canRestore: z.literal(true)
}).strict();
export const NoteTrashListRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteTrashListRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();
const NoteTrashListResultIdentitySchema = NoteTrashListRequestSchema;
export const NoteTrashListResultSchema = z.discriminatedUnion("status", [
  NoteTrashListResultIdentitySchema.extend({
    status: z.literal("ready"),
    notes: z.array(NoteTrashSummarySchema).max(10_000).readonly()
  }).strict(),
  NoteTrashListResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const NoteTrashRestoreRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteTrashRestoreRequestIdSchema,
  activeVaultId: VaultIdSchema,
  pageId: PageIdSchema,
  trashOperationId: OperationIdSchema,
  expectedTrashRevision: NoteTrashRevisionSchema
}).strict();
const NoteTrashRestoreResultIdentitySchema = NoteTrashRestoreRequestSchema;
export const NoteTrashRestoreResultSchema = z.discriminatedUnion("status", [
  NoteTrashRestoreResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema
  }).strict(),
  ...(["stale", "not_found", "failed"] as const).map((status) =>
    NoteTrashRestoreResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);

export const NOTE_REVISION_HISTORY_LIST_CHANNEL = "notes.listRevisionHistory" as const;
export const NOTE_REVISION_HISTORY_OPEN_CHANNEL = "notes.openRevisionHistory" as const;
export const NOTE_REVISION_HISTORY_RESTORE_CHANNEL = "notes.restoreRevisionHistory" as const;
export const NoteRevisionHistorySummarySchema = z.object({
  revisionId: NoteRevisionHistoryRevisionIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  origin: z.enum(["current", "user", "agent", "restore"]),
  isCurrent: z.boolean(),
  canOpen: z.literal(true)
}).strict();
const NoteRevisionHistoryIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteRevisionHistoryRequestIdSchema,
  activeVaultId: VaultIdSchema,
  pageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema
}).strict();
export const NoteRevisionHistoryListRequestSchema = NoteRevisionHistoryIdentitySchema;
export const NoteRevisionHistoryListResultSchema = z.discriminatedUnion("status", [
  NoteRevisionHistoryIdentitySchema.extend({
    status: z.literal("ready"),
    currentRevision: NoteEditorRevisionSchema,
    revisions: z.array(NoteRevisionHistorySummarySchema).max(100).readonly()
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteRevisionHistoryIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteRevisionHistoryOpenRequestSchema = NoteRevisionHistoryIdentitySchema.extend({
  revisionId: NoteRevisionHistoryRevisionIdSchema
}).strict();
export const NoteRevisionHistoryOpenResultSchema = z.discriminatedUnion("status", [
  NoteRevisionHistoryOpenRequestSchema.extend({
    status: z.literal("opened"),
    revision: NoteRevisionHistorySummarySchema,
    currentRevision: NoteEditorRevisionSchema,
    html: NoteRenderedHtmlSchema,
    byteSize: z.number().int().nonnegative().max(NOTE_EDITOR_MAX_MARKDOWN_UTF8_BYTES)
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteRevisionHistoryOpenRequestSchema.extend({ status: z.literal(status) }).strict()
  )
]);
export const NoteRevisionHistoryRestoreRequestSchema = NoteRevisionHistoryOpenRequestSchema;
export const NoteRevisionHistoryRestoreResultSchema = z.discriminatedUnion("status", [
  NoteRevisionHistoryRestoreRequestSchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    revision: NoteEditorRevisionSchema,
    render: NoteRenderResultSchema.extend({ renderContextId: NoteRenderContextIdSchema }).strict()
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteRevisionHistoryRestoreRequestSchema.extend({ status: z.literal(status) }).strict()
  )
]);

export const NOTE_MERGE_CHANNEL = "notes.merge" as const;
export const NoteMergeRequestIdSchema = z.string().regex(/^notemergereq_[a-z0-9]{16,64}$/u);
export const NoteMergeRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteMergeRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  targetPageId: PageIdSchema,
  expectedTargetUpdatedAt: z.string().datetime({ offset: true })
}).strict().superRefine((request, context) => {
  if (request.currentPageId === request.targetPageId) {
    context.addIssue({ code: "custom", path: ["targetPageId"], message: "A note cannot be merged into itself." });
  }
});
const NoteMergeResultIdentitySchema = NoteMergeRequestSchema;
export const NoteMergeResultSchema = z.discriminatedUnion("status", [
  NoteMergeResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema.extend({ renderContextId: NoteRenderContextIdSchema }).strict()
  }).strict(),
  NoteMergeResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  NoteMergeResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  NoteMergeResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  NoteMergeResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const NOTE_RELATE_CHANNEL = "notes.relate" as const;
export const NoteRelateRequestIdSchema = z.string().regex(/^noterelatereq_[a-z0-9]{16,64}$/u);
export const NoteRelateRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteRelateRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  targetPageId: PageIdSchema,
  expectedTargetUpdatedAt: z.string().datetime({ offset: true })
}).strict().superRefine((request, context) => {
  if (request.currentPageId === request.targetPageId) {
    context.addIssue({ code: "custom", path: ["targetPageId"], message: "A note cannot relate to itself." });
  }
});
const NoteRelateResultIdentitySchema = NoteRelateRequestSchema;
export const NoteRelateResultSchema = z.discriminatedUnion("status", [
  NoteRelateResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema.extend({ renderContextId: NoteRenderContextIdSchema }).strict()
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteRelateResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);

export const NOTE_UNLINK_RELATION_CHANNEL = "notes.unlinkRelation" as const;
export const NoteUnlinkRelationRequestIdSchema = z.string().regex(/^noteunlinkreq_[a-z0-9]{16,64}$/u);
export const NoteUnlinkRelationRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: NoteUnlinkRelationRequestIdSchema,
  activeVaultId: VaultIdSchema,
  currentPageId: PageIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  expectedRevision: NoteEditorRevisionSchema,
  targetPageId: PageIdSchema,
  expectedTargetUpdatedAt: z.string().datetime({ offset: true })
}).strict().superRefine((request, context) => {
  if (request.currentPageId === request.targetPageId) {
    context.addIssue({ code: "custom", path: ["targetPageId"], message: "A note cannot unlink itself." });
  }
});
const NoteUnlinkRelationResultIdentitySchema = NoteUnlinkRelationRequestSchema;
export const NoteUnlinkRelationResultSchema = z.discriminatedUnion("status", [
  NoteUnlinkRelationResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema.extend({ renderContextId: NoteRenderContextIdSchema }).strict()
  }).strict(),
  ...(["stale", "not_found", "ineligible", "failed"] as const).map((status) =>
    NoteUnlinkRelationResultIdentitySchema.extend({ status: z.literal(status) }).strict()
  )
]);

export const KNOWLEDGE_HEALTH_MAX_TARGET_CANDIDATES = 20;
const KnowledgeHealthRepairProofFields = {
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  reportRequestId: KnowledgeHealthRequestIdSchema,
  indexGeneration: KnowledgeHealthIndexGenerationSchema,
  issueKind: z.literal("broken_link"),
  pageId: PageIdSchema,
  repairContextId: KnowledgeHealthRepairContextIdSchema,
  sourceRevision: KnowledgeHealthPageRevisionSchema,
  sourceRenderProof: KnowledgeHealthRenderProofSchema,
  occurrenceId: KnowledgeHealthOccurrenceIdSchema
} as const;

export const KNOWLEDGE_HEALTH_MAX_ORPHAN_PARENT_CANDIDATES = 20;
const KnowledgeHealthOrphanTargetProofFields = {
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  reportRequestId: KnowledgeHealthRequestIdSchema,
  indexGeneration: KnowledgeHealthIndexGenerationSchema,
  issueKind: z.literal("orphan_page"),
  pageId: PageIdSchema,
  repairContextId: KnowledgeHealthRepairContextIdSchema,
  targetRevision: KnowledgeHealthPageRevisionSchema,
  targetRenderProof: KnowledgeHealthRenderProofSchema
} as const;
export const KnowledgeHealthOrphanParentCandidateSchema = z.object({
  page: KnowledgeHealthPageRefSchema,
  pageType: z.literal("note"),
  sourceContextId: KnowledgeHealthOrphanParentContextIdSchema,
  sourceRevision: KnowledgeHealthPageRevisionSchema,
  sourceRenderProof: KnowledgeHealthRenderProofSchema
}).strict();
export const KnowledgeHealthOrphanParentSearchRequestSchema = z.object({
  ...KnowledgeHealthOrphanTargetProofFields,
  requestId: KnowledgeHealthOrphanParentSearchRequestIdSchema,
  query: z.string().max(120).refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value),
    "Knowledge Health parent search contains unsafe control text."
  )
}).strict();
const KnowledgeHealthOrphanParentSearchIdentitySchema = KnowledgeHealthOrphanParentSearchRequestSchema;
export const KnowledgeHealthOrphanParentSearchResultSchema = z.discriminatedUnion("status", [
  KnowledgeHealthOrphanParentSearchIdentitySchema.extend({
    status: z.literal("ready"),
    parents: z.array(KnowledgeHealthOrphanParentCandidateSchema)
      .max(KNOWLEDGE_HEALTH_MAX_ORPHAN_PARENT_CANDIDATES),
    truncated: z.boolean()
  }).strict(),
  KnowledgeHealthOrphanParentSearchIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  KnowledgeHealthOrphanParentSearchIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  KnowledgeHealthOrphanParentSearchIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "ready") return;
  const pageIds = result.parents.map((parent) => parent.page.pageId);
  const contextIds = result.parents.map((parent) => parent.sourceContextId);
  if (new Set(pageIds).size !== pageIds.length || new Set(contextIds).size !== contextIds.length ||
    pageIds.includes(result.pageId)) {
    context.addIssue({ code: "custom", path: ["parents"], message: "Orphan parent choices must be distinct." });
  }
});
const KnowledgeHealthOrphanRepairIdentitySchema = z.object({
  ...KnowledgeHealthOrphanTargetProofFields,
  requestId: KnowledgeHealthOrphanRepairRequestIdSchema,
  action: z.literal("connect_orphan_to_parent"),
  sourcePageId: PageIdSchema,
  sourceContextId: KnowledgeHealthOrphanParentContextIdSchema,
  sourceRevision: KnowledgeHealthPageRevisionSchema,
  sourceRenderProof: KnowledgeHealthRenderProofSchema
}).strict();
function validateKnowledgeHealthOrphanRepair(
  request: z.infer<typeof KnowledgeHealthOrphanRepairIdentitySchema>,
  context: z.RefinementCtx
): void {
  if (request.sourcePageId === request.pageId) {
    context.addIssue({ code: "custom", path: ["sourcePageId"], message: "An orphan cannot parent itself." });
  }
}
export const KnowledgeHealthOrphanRepairRequestSchema = KnowledgeHealthOrphanRepairIdentitySchema
  .superRefine(validateKnowledgeHealthOrphanRepair);
export const KnowledgeHealthOrphanRepairResultSchema = z.discriminatedUnion("status", [
  KnowledgeHealthOrphanRepairIdentitySchema.extend({
    status: z.literal("committed"),
    revision: NoteEditorRevisionSchema,
    operationId: OperationIdSchema
  }).strict(),
  KnowledgeHealthOrphanRepairIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  KnowledgeHealthOrphanRepairIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  KnowledgeHealthOrphanRepairIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  KnowledgeHealthOrphanRepairIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => validateKnowledgeHealthOrphanRepair(result, context));
export const KnowledgeHealthTargetCandidateSchema = z.object({
  page: KnowledgeHealthPageRefSchema,
  pageType: z.literal("note"),
  targetContextId: KnowledgeHealthTargetContextIdSchema,
  targetRevision: KnowledgeHealthPageRevisionSchema,
  targetRenderProof: KnowledgeHealthRenderProofSchema
}).strict();
export const KnowledgeHealthTargetSearchRequestSchema = z.object({
  ...KnowledgeHealthRepairProofFields,
  requestId: KnowledgeHealthTargetSearchRequestIdSchema,
  query: z.string().max(120).refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value),
    "Knowledge Health target search contains unsafe control text."
  )
}).strict();
const KnowledgeHealthTargetSearchIdentitySchema = KnowledgeHealthTargetSearchRequestSchema;
export const KnowledgeHealthTargetSearchResultSchema = z.discriminatedUnion("status", [
  KnowledgeHealthTargetSearchIdentitySchema.extend({
    status: z.literal("ready"),
    targets: z.array(KnowledgeHealthTargetCandidateSchema).max(KNOWLEDGE_HEALTH_MAX_TARGET_CANDIDATES),
    truncated: z.boolean()
  }).strict(),
  KnowledgeHealthTargetSearchIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  KnowledgeHealthTargetSearchIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  KnowledgeHealthTargetSearchIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

const KnowledgeHealthRepairIdentitySchema = z.object({
  ...KnowledgeHealthRepairProofFields,
  requestId: KnowledgeHealthRepairRequestIdSchema,
  action: KnowledgeHealthRepairActionSchema,
  targetPageId: PageIdSchema.optional(),
  targetContextId: KnowledgeHealthTargetContextIdSchema.optional(),
  targetRevision: KnowledgeHealthPageRevisionSchema.optional(),
  targetRenderProof: KnowledgeHealthRenderProofSchema.optional()
}).strict();
function validateKnowledgeHealthRepairTarget(
  request: z.infer<typeof KnowledgeHealthRepairIdentitySchema>,
  context: z.RefinementCtx
): void {
  const target = [request.targetPageId, request.targetContextId, request.targetRevision, request.targetRenderProof];
  const expectsTarget = request.action === "retarget_broken_reference";
  if ((expectsTarget && target.some((value) => value === undefined)) ||
    (!expectsTarget && target.some((value) => value !== undefined))) {
    context.addIssue({ code: "custom", path: ["targetPageId"], message: "Retarget proof does not match the repair action." });
  }
  if (expectsTarget && request.targetPageId === request.pageId) {
    context.addIssue({ code: "custom", path: ["targetPageId"], message: "A broken link cannot target its own page." });
  }
}
export const KnowledgeHealthRepairRequestSchema = KnowledgeHealthRepairIdentitySchema
  .superRefine(validateKnowledgeHealthRepairTarget);
export const KnowledgeHealthRepairResultSchema = z.discriminatedUnion("status", [
  KnowledgeHealthRepairIdentitySchema.extend({
    status: z.literal("committed"),
    revision: NoteEditorRevisionSchema,
    operationId: OperationIdSchema
  }).strict(),
  KnowledgeHealthRepairIdentitySchema.extend({
    status: z.literal("stale"),
    revision: NoteEditorRevisionSchema
  }).strict(),
  KnowledgeHealthRepairIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  KnowledgeHealthRepairIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  KnowledgeHealthRepairIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => validateKnowledgeHealthRepairTarget(result, context));

export const KnowledgeHealthDuplicateTopicRepairRequestIdSchema = z.string()
  .regex(/^knowledge_health_duplicate_topic_repair_request_[a-z0-9]{16,64}$/u);
const KnowledgeHealthDuplicateTopicRepairIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: KnowledgeHealthDuplicateTopicRepairRequestIdSchema,
  activeVaultId: VaultIdSchema,
  reportRequestId: KnowledgeHealthRequestIdSchema,
  indexGeneration: KnowledgeHealthIndexGenerationSchema,
  issueKind: z.literal("duplicate_topic"),
  repairContextId: KnowledgeHealthRepairContextIdSchema,
  survivorPageId: PageIdSchema,
  survivorRevision: KnowledgeHealthPageRevisionSchema,
  survivorRenderProof: KnowledgeHealthRenderProofSchema,
  absorbedPageId: PageIdSchema,
  absorbedRevision: KnowledgeHealthPageRevisionSchema,
  absorbedRenderProof: KnowledgeHealthRenderProofSchema
}).strict().refine((request) => request.survivorPageId !== request.absorbedPageId, {
  path: ["absorbedPageId"], message: "Duplicate-topic repair pages must be distinct."
});
export const KnowledgeHealthDuplicateTopicRepairRequestSchema = KnowledgeHealthDuplicateTopicRepairIdentitySchema;
export const KnowledgeHealthDuplicateTopicRepairResultSchema = z.discriminatedUnion("status", [
  KnowledgeHealthDuplicateTopicRepairIdentitySchema.extend({
    status: z.literal("committed"), operationId: OperationIdSchema
  }).strict(),
  KnowledgeHealthDuplicateTopicRepairIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  KnowledgeHealthDuplicateTopicRepairIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  KnowledgeHealthDuplicateTopicRepairIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  KnowledgeHealthDuplicateTopicRepairIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const KNOWLEDGE_HEALTH_MAX_CLAIM_SOURCE_CANDIDATES = 20;
const KnowledgeHealthClaimProofFields = {
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  reportRequestId: KnowledgeHealthRequestIdSchema,
  indexGeneration: KnowledgeHealthIndexGenerationSchema,
  issueKind: z.literal("unsourced_claim"),
  pageId: PageIdSchema,
  repairContextId: KnowledgeHealthRepairContextIdSchema,
  claimRevision: KnowledgeHealthPageRevisionSchema,
  claimRenderProof: KnowledgeHealthRenderProofSchema
} as const;
export const KnowledgeHealthClaimSourceCandidateSchema = z.object({
  sourceContextId: KnowledgeHealthClaimSourceContextIdSchema,
  page: KnowledgeHealthPageRefSchema
}).strict();
export const KnowledgeHealthClaimSourceSearchRequestSchema = z.object({
  ...KnowledgeHealthClaimProofFields,
  requestId: KnowledgeHealthClaimSourceSearchRequestIdSchema,
  query: z.string().max(120).refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value),
    "Knowledge Health source search contains unsafe control text."
  )
}).strict();
const KnowledgeHealthClaimSourceSearchIdentitySchema = KnowledgeHealthClaimSourceSearchRequestSchema;
export const KnowledgeHealthClaimSourceSearchResultSchema = z.discriminatedUnion("status", [
  KnowledgeHealthClaimSourceSearchIdentitySchema.extend({
    status: z.literal("ready"),
    sources: z.array(KnowledgeHealthClaimSourceCandidateSchema)
      .max(KNOWLEDGE_HEALTH_MAX_CLAIM_SOURCE_CANDIDATES),
    truncated: z.boolean()
  }).strict(),
  KnowledgeHealthClaimSourceSearchIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  KnowledgeHealthClaimSourceSearchIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  KnowledgeHealthClaimSourceSearchIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
const KnowledgeHealthClaimSourceRepairIdentitySchema = z.object({
  ...KnowledgeHealthClaimProofFields,
  requestId: KnowledgeHealthClaimSourceRepairRequestIdSchema,
  action: z.literal("bind_claim_source"),
  sourceContextId: KnowledgeHealthClaimSourceContextIdSchema
}).strict();
export const KnowledgeHealthClaimSourceRepairRequestSchema = KnowledgeHealthClaimSourceRepairIdentitySchema;
export const KnowledgeHealthClaimSourceRepairResultSchema = z.discriminatedUnion("status", [
  KnowledgeHealthClaimSourceRepairIdentitySchema.extend({
    status: z.literal("committed"),
    revision: NoteEditorRevisionSchema,
    operationId: OperationIdSchema
  }).strict(),
  KnowledgeHealthClaimSourceRepairIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  KnowledgeHealthClaimSourceRepairIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  KnowledgeHealthClaimSourceRepairIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  KnowledgeHealthClaimSourceRepairIdentitySchema.extend({ status: z.literal("failed") }).strict()
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
  "agent_ingest",
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

export const SkillCapabilityListSchema = z.array(SkillCapabilitySchema).min(1).max(32)
  .refine((values) => new Set(values).size === values.length, "Skill capabilities must be unique.");
export const SkillDataBoundaryListSchema = z.array(SkillDataBoundarySchema).min(1).max(6)
  .refine((values) => new Set(values).size === values.length, "Skill data boundaries must be unique.");
const SKILL_DATA_BOUNDARY_ORDER = [
  "local", "filesystem", "network", "cloud", "brokered_credential", "destructive"
] as const satisfies readonly z.infer<typeof SkillDataBoundarySchema>[];

export function deriveSkillDataBoundaries(
  capabilities: readonly z.infer<typeof SkillCapabilitySchema>[]
): readonly z.infer<typeof SkillDataBoundarySchema>[] {
  const boundaries = new Set<z.infer<typeof SkillDataBoundarySchema>>();
  for (const capability of capabilities) {
    if (!PermissionCapabilitySchema.safeParse(capability).success) {
      boundaries.add("local");
      continue;
    }
    switch (capability) {
      case "read_vault":
      case "write_vault":
      case "change_settings":
      case "spawn_agent":
        boundaries.add("local");
        break;
      case "delete_vault":
      case "change_pige_schema":
        boundaries.add("destructive");
        break;
      case "external_filesystem":
        boundaries.add("filesystem");
        break;
      case "run_shell":
        boundaries.add("filesystem");
        boundaries.add("network");
        boundaries.add("destructive");
        break;
      case "install_local_tool":
        boundaries.add("filesystem");
        boundaries.add("network");
        break;
      case "external_network":
        boundaries.add("network");
        break;
      case "install_package":
        boundaries.add("filesystem");
        boundaries.add("network");
        break;
      case "call_cloud_model_with_private_or_large_source":
        boundaries.add("cloud");
        break;
      case "use_brokered_credential":
        boundaries.add("brokered_credential");
        break;
    }
  }
  return SKILL_DATA_BOUNDARY_ORDER.filter((boundary) => boundaries.has(boundary));
}

export const SkillInstallSourceKindSchema = z.enum(["https", "local_markdown", "local_zip"]);
export const ExternalWebSkillRuntimeAdapterSchema = z.literal("pige_readonly_https_v1");
export const ExternalWebSkillRuntimeToolNameSchema = z.literal("pige_external_web_read");
export const ExternalWebSkillRuntimeDeclarationSchema = z.object({
  adapter: ExternalWebSkillRuntimeAdapterSchema,
  origin: ExternalWebSkillHttpsOriginSchema
}).strict();

function hasSupportedExternalWebRuntime(
  capabilities: readonly z.infer<typeof SkillCapabilitySchema>[],
  runtime: z.infer<typeof ExternalWebSkillRuntimeDeclarationSchema> | undefined
): boolean {
  if (!runtime) return false;
  const permissionCapabilities = capabilities.filter((capability) =>
    PermissionCapabilitySchema.safeParse(capability).success
  );
  return permissionCapabilities.length === 1 && permissionCapabilities[0] === "external_network";
}

function hasExactOrderedValues(left: readonly string[] | undefined, right: readonly string[]): boolean {
  return left !== undefined && left.length === right.length && left.every((value, index) => value === right[index]);
}

export const PiPackageCatalogQueryRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageCatalogQueryRequestIdSchema,
  query: z.string()
    .refine((value) => Array.from(value).length <= 120, "Pi package catalog queries must contain at most 120 Unicode characters.")
    .refine(
      (value) => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value),
      "Pi package catalog queries must be trimmed and contain no control characters."
    )
}).strict();
export const PiPackageCatalogEntrySchema = z.object({
  catalogId: PiPackageCatalogIdSchema,
  packageName: PiPackageNameSchema,
  version: PiPackageVersionSchema,
  integrity: PiPackageIntegritySchema,
  displayName: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(240),
  license: z.string().trim().min(1).max(160),
  packageTypes: z.array(PiPackageTypeSchema).min(1).max(4).readonly(),
  capabilities: SkillCapabilityListSchema.readonly(),
  dataBoundaries: SkillDataBoundaryListSchema.readonly(),
  trust: z.literal("curated"),
  source: z.literal("npm")
}).strict();
const PiPackageCatalogQueryResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: PiPackageCatalogQueryRequestIdSchema
}).strict();
export const PiPackageCatalogQueryResultSchema = z.discriminatedUnion("status", [
  PiPackageCatalogQueryResultIdentitySchema.extend({
    status: z.literal("ready"),
    entries: z.array(PiPackageCatalogEntrySchema).max(100).readonly(),
    total: z.number().int().nonnegative().max(100)
  }).strict(),
  PiPackageCatalogQueryResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "ready") return;
  if (result.total !== result.entries.length) {
    context.addIssue({ code: "custom", path: ["total"], message: "Catalog total must match the complete filtered entry set." });
  }
  for (let index = 1; index < result.entries.length; index += 1) {
    if (result.entries[index - 1]!.catalogId >= result.entries[index]!.catalogId) {
      context.addIssue({ code: "custom", path: ["entries", index, "catalogId"], message: "Catalog entries must use unique ascending IDs." });
    }
  }
});

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
  runtime: ExternalWebSkillRuntimeDeclarationSchema.optional(),
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
  if (manifest.kind !== "external_web" && manifest.runtime !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Only External/Web Skills may declare a runtime adapter.",
      path: ["runtime"]
    });
  }
  if (manifest.kind === "external_web" && permissionCapabilities.length === 0) {
    context.addIssue({
      code: "custom",
      message: "External/Web Skills must declare at least one permission-mediated capability.",
      path: ["capabilities"]
    });
  }
  if (manifest.kind === "external_web") {
    const expectedBoundaries = deriveSkillDataBoundaries(manifest.capabilities);
    if (!hasExactOrderedValues(manifest.dataBoundary, expectedBoundaries)) {
      context.addIssue({
        code: "custom",
        message: "External/Web Skill data boundaries must exactly match declared capabilities.",
        path: ["dataBoundary"]
      });
    }
    if (manifest.sourceUrl !== undefined && !SkillInstallUrlSchema.safeParse(manifest.sourceUrl).success) {
      context.addIssue({ code: "custom", message: "External/Web Skill source URL is unsafe.", path: ["sourceUrl"] });
    }
    if (manifest.runtime !== undefined && !hasSupportedExternalWebRuntime(manifest.capabilities, manifest.runtime)) {
      context.addIssue({
        code: "custom",
        message: "The reviewed HTTPS runtime supports only external_network.",
        path: ["runtime"]
      });
    }
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

export const SkillRestoreContextIdSchema = z.string()
  .regex(/^skill_restore_context_v2_[a-f0-9]{32,64}$/u);

export const SkillRestorableSummarySchema = z.object({
  restoreContextId: SkillRestoreContextIdSchema,
  skillId: SkillIdSchema,
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(80),
  kind: z.literal("pure"),
  scope: z.enum(["machine_local", "vault"]),
  uninstalledAt: z.string().datetime({ offset: true }),
  canRestore: z.literal(true)
}).strict();

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
  license: z.string().min(1).max(120).optional(),
  canEnable: z.boolean(),
  canUninstall: z.boolean(),
  canExport: z.boolean(),
  canUpdate: z.boolean(),
  source: SkillInstallSourceKindSchema.optional(),
  sourceUrl: z.lazy(() => SkillInstallUrlSchema).optional(),
  runtime: ExternalWebSkillRuntimeDeclarationSchema.optional(),
  manifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u).optional(),
  bundleSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u).optional(),
  files: z.lazy(() => z.array(SkillStagedFileSummarySchema).min(1).max(SKILL_ZIP_STAGE_MAX_FILES)).optional(),
  warnings: z.lazy(() => z.array(SkillStageWarningSchema).max(2)
    .refine((values) => new Set(values).size === values.length, "Skill warnings must be unique.")).optional()
}).strict().superRefine((skill, context) => {
  const userManaged = ["machine_local", "vault"].includes(skill.scope) && skill.trust === "user_confirmed";
  const pureLifecycle = userManaged && skill.kind === "pure";
  const externalRuntime = skill.scope === "machine_local" && userManaged && skill.kind === "external_web" &&
    hasSupportedExternalWebRuntime(skill.capabilities, skill.runtime);
  if (skill.canEnable && ((!pureLifecycle && !externalRuntime) || skill.enabled)) {
    context.addIssue({ code: "custom", path: ["canEnable"], message: "Skill enable eligibility is invalid." });
  }
  if (skill.canUninstall && !pureLifecycle) {
    context.addIssue({ code: "custom", path: ["canUninstall"], message: "Skill uninstall eligibility is invalid." });
  }
  if (skill.canExport && !pureLifecycle) {
    context.addIssue({ code: "custom", path: ["canExport"], message: "Skill export eligibility is invalid." });
  }
  const externalSourceUpdate = userManaged && skill.kind === "external_web" && skill.source === "https" && skill.sourceUrl !== undefined &&
    skill.manifestSha256 !== undefined && skill.bundleSha256 !== undefined && skill.files !== undefined &&
    skill.warnings !== undefined;
  if (skill.canUpdate && !pureLifecycle && !externalSourceUpdate) {
    context.addIssue({ code: "custom", path: ["canUpdate"], message: "Skill update eligibility is invalid." });
  }
  const requiredDisclosure = [skill.source, skill.manifestSha256, skill.bundleSha256, skill.files, skill.warnings];
  const anyDisclosure = [...requiredDisclosure, skill.sourceUrl, skill.runtime];
  if (skill.kind !== "external_web" && anyDisclosure.some((value) => value !== undefined)) {
    context.addIssue({ code: "custom", path: ["source"], message: "Only External/Web Skills expose installed review disclosure." });
  }
  if (skill.kind === "external_web") {
    if (skill.enabled && !externalRuntime) {
      context.addIssue({ code: "custom", path: ["enabled"], message: "Unsupported External/Web Skills must remain disabled." });
    }
    if (requiredDisclosure.some((value) => value === undefined)) {
      context.addIssue({ code: "custom", path: ["source"], message: "External/Web Skill disclosure is incomplete." });
    }
    if (!hasExactOrderedValues(skill.dataBoundaries, deriveSkillDataBoundaries(skill.capabilities))) {
      context.addIssue({ code: "custom", path: ["dataBoundaries"], message: "External/Web Skill boundaries are ambiguous." });
    }
    const remoteSource = skill.source === "https";
    if (remoteSource !== Boolean(skill.sourceUrl) ||
      (remoteSource && skill.sourceUrl !== undefined && !skill.warnings?.includes("untrusted_remote_source")) ||
      (!remoteSource && skill.warnings?.includes("untrusted_remote_source"))) {
      context.addIssue({ code: "custom", path: ["source"], message: "External/Web Skill source disclosure is inconsistent." });
    }
  }
});

export const SkillRegistrySummarySchema = z.object({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  invalidManifestCount: z.number().int().nonnegative().max(512),
  skills: z.array(SkillSummarySchema).max(512),
  restorableSkills: z.array(SkillRestorableSummarySchema).max(512)
}).strict().superRefine((registry, context) => {
  const installedIds = new Set(registry.skills.map((skill) => skill.id));
  if (installedIds.size !== registry.skills.length) {
    context.addIssue({ code: "custom", path: ["skills"], message: "Scoped Skill identities must be unique." });
  }
  const restoreContexts = new Set<string>();
  const restorableIds = new Set<string>();
  for (const [index, restorable] of registry.restorableSkills.entries()) {
    const scopedId = restorable.skillId;
    if (installedIds.has(scopedId) || restorableIds.has(scopedId)) {
      context.addIssue({
        code: "custom",
        path: ["restorableSkills", index, "skillId"],
        message: "Restorable Skill IDs must be absent from the installed registry and unique."
      });
    }
    if (restoreContexts.has(restorable.restoreContextId)) {
      context.addIssue({
        code: "custom",
        path: ["restorableSkills", index, "restoreContextId"],
        message: "Skill restore contexts must be unique."
      });
    }
    restorableIds.add(scopedId);
    restoreContexts.add(restorable.restoreContextId);
  }
});

export const SkillDisableRequestSchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  scope: z.enum(["machine_local", "vault"]),
  skillId: SkillIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();

export const SKILL_URL_STAGE_MAX_UTF8_BYTES = 256 * 1024;
export const SKILL_MARKDOWN_STAGE_MAX_UTF8_BYTES = SKILL_URL_STAGE_MAX_UTF8_BYTES;
export const SKILL_ZIP_STAGE_MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
export const SKILL_ZIP_STAGE_MAX_EXPANDED_BYTES = 4 * 1024 * 1024;
export const SKILL_ZIP_STAGE_MAX_FILE_BYTES = SKILL_MARKDOWN_STAGE_MAX_UTF8_BYTES;
export const SKILL_ZIP_STAGE_MAX_FILES = 64;
export const SKILL_ZIP_STAGE_MAX_PATH_DEPTH = 8;
export const SKILL_ZIP_STAGE_MAX_PATH_LENGTH = 512;
export const SKILL_ZIP_STAGE_MAX_COMPRESSION_RATIO = 100;
export const SKILL_PENDING_STAGED_REVIEWS_MAX_ITEMS = 32;
export const SkillInstallRequestIdSchema = z.string()
  .regex(/^skillreq_[a-z0-9]{16,64}$/u);
export const SkillLifecycleRequestIdSchema = z.string()
  .regex(/^skill_lifecycle_request_[a-z0-9]{16,64}$/u);
export const SkillStagingIdSchema = z.string()
  .regex(/^skillstage_[a-f0-9]{32}$/u);
export const SkillInstallUrlSchema = z.string().url().max(2048).superRefine((value, context) => {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    context.addIssue({
      code: "custom",
      message: "Skill install URLs must use HTTPS without credentials, query parameters, or fragments."
    });
  }
});
export const ExternalWebSkillReadRequestSchema = z.object({
  url: SkillInstallUrlSchema
}).strict();
export const ExternalWebSkillReadResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    origin: ExternalWebSkillHttpsOriginSchema,
    contentType: z.string().trim().min(1).max(160),
    byteLength: z.number().int().nonnegative().max(16 * 1024 * 1024),
    truncated: z.boolean(),
    warningCount: z.number().int().nonnegative().max(32)
  }).strict(),
  z.object({ status: z.literal("denied") }).strict(),
  z.object({ status: z.literal("stale") }).strict(),
  z.object({ status: z.literal("failed") }).strict()
]);
export const SkillStageInvalidReasonSchema = z.enum([
  "source_too_large",
  "manifest_invalid",
  "unsupported_kind",
  "unsupported_scope",
  "unsafe_content"
]);
export const SkillStageWarningSchema = z.enum([
  "untrusted_remote_source",
  "trigger_overlap"
]);
export const SkillZipStageInvalidReasonSchema = z.enum([
  "archive_too_large",
  "archive_invalid",
  "archive_unsafe",
  "skill_root_invalid",
  "manifest_invalid",
  "unsupported_content"
]);
export const SkillStagedRelativePathSchema = z.string()
  .min(1)
  .max(SKILL_ZIP_STAGE_MAX_PATH_LENGTH)
  .refine((value) => {
    const segments = value.split("/");
    return !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") &&
      segments.length <= SKILL_ZIP_STAGE_MAX_PATH_DEPTH &&
      segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..") &&
      (value === "SKILL.md" || /\.(?:json|md)$/iu.test(value));
  }, "Staged Skill file paths must be bounded relative Markdown or JSON paths.");
export const SkillStagedFileSummarySchema = z.object({
  relativePath: SkillStagedRelativePathSchema,
  utf8ByteSize: z.number().int().positive().max(SKILL_ZIP_STAGE_MAX_FILE_BYTES),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
}).strict();
export const SkillExternalUpdateReviewSchema = z.object({
  kind: z.literal("external_web"),
  previousVersion: z.string().min(1).max(80),
  previousManifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  previousBundleSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  addedCapabilities: z.array(SkillCapabilitySchema).max(32)
    .refine((values) => new Set(values).size === values.length, "Added capabilities must be unique."),
  removedCapabilities: z.array(SkillCapabilitySchema).max(32)
    .refine((values) => new Set(values).size === values.length, "Removed capabilities must be unique."),
  addedDataBoundaries: z.array(SkillDataBoundarySchema).max(6)
    .refine((values) => new Set(values).size === values.length, "Added data boundaries must be unique."),
  removedDataBoundaries: z.array(SkillDataBoundarySchema).max(6)
    .refine((values) => new Set(values).size === values.length, "Removed data boundaries must be unique."),
  finalEnabled: z.literal(false)
}).strict().superRefine((review, context) => {
  if (review.addedCapabilities.some((value) => review.removedCapabilities.includes(value))) {
    context.addIssue({ code: "custom", path: ["addedCapabilities"], message: "Capability changes must not overlap." });
  }
  if (review.addedDataBoundaries.some((value) => review.removedDataBoundaries.includes(value))) {
    context.addIssue({ code: "custom", path: ["addedDataBoundaries"], message: "Data-boundary changes must not overlap." });
  }
});
export const SkillPureUpdateReviewSchema = z.object({
  kind: z.literal("pure"),
  previousVersion: z.string().min(1).max(80),
  previousManifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  previousBundleSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  addedFiles: z.array(SkillStagedRelativePathSchema).max(SKILL_ZIP_STAGE_MAX_FILES),
  removedFiles: z.array(SkillStagedRelativePathSchema).max(SKILL_ZIP_STAGE_MAX_FILES),
  changedFiles: z.array(SkillStagedRelativePathSchema).max(SKILL_ZIP_STAGE_MAX_FILES),
  finalEnabled: z.boolean()
}).strict().superRefine((review, context) => {
  const values = [...review.addedFiles, ...review.removedFiles, ...review.changedFiles];
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", path: ["changedFiles"], message: "Pure Skill file changes must not overlap." });
  }
});
export const SkillStagedSummarySchema = z.object({
  stagingId: SkillStagingIdSchema,
  manifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  bundleSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  registryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.string().datetime({ offset: true }),
  sourceUrl: SkillInstallUrlSchema.optional(),
  id: SkillIdSchema,
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  scope: z.enum(["machine_local", "vault"]),
  kind: z.enum(["pure", "external_web"]),
  capabilities: SkillCapabilityListSchema,
  dataBoundaries: SkillDataBoundaryListSchema,
  source: SkillInstallSourceKindSchema.optional(),
  runtime: ExternalWebSkillRuntimeDeclarationSchema.optional(),
  author: z.string().min(1).max(120).optional(),
  license: z.string().min(1).max(120).optional(),
  files: z.array(SkillStagedFileSummarySchema).min(1).max(SKILL_ZIP_STAGE_MAX_FILES),
  externalUpdateReview: SkillExternalUpdateReviewSchema.optional(),
  pureUpdateReview: SkillPureUpdateReviewSchema.optional(),
  warnings: z.array(SkillStageWarningSchema).max(2)
    .refine((values) => new Set(values).size === values.length, "Skill stage warnings must be unique.")
}).strict().superRefine((staged, context) => {
  const hasRemoteWarning = staged.warnings.includes("untrusted_remote_source");
  if (Boolean(staged.sourceUrl) !== hasRemoteWarning) {
    context.addIssue({
      code: "custom",
      path: ["warnings"],
      message: "Remote Skill stages require one matching remote-source warning."
    });
  }
  const permissionCapabilities = staged.capabilities.filter((capability) =>
    PermissionCapabilitySchema.safeParse(capability).success
  );
  if (staged.kind === "pure") {
    if (permissionCapabilities.length > 0 || staged.source !== undefined || staged.runtime !== undefined ||
      !hasExactOrderedValues(staged.dataBoundaries, ["local"])) {
      context.addIssue({ code: "custom", path: ["kind"], message: "Pure Skill review disclosure is invalid." });
    }
  } else {
    if (staged.scope !== "machine_local" || permissionCapabilities.length === 0 || staged.source === undefined ||
      !hasExactOrderedValues(staged.dataBoundaries, deriveSkillDataBoundaries(staged.capabilities))) {
      context.addIssue({ code: "custom", path: ["dataBoundaries"], message: "External/Web Skill review disclosure is incomplete." });
    }
    if (staged.runtime !== undefined && !hasSupportedExternalWebRuntime(staged.capabilities, staged.runtime)) {
      context.addIssue({ code: "custom", path: ["runtime"], message: "External/Web Skill runtime declaration is unsupported." });
    }
    const remoteSource = staged.source === "https";
    if (remoteSource !== Boolean(staged.sourceUrl)) {
      context.addIssue({ code: "custom", path: ["source"], message: "External/Web Skill review source is inconsistent." });
    }
  }
  if (staged.externalUpdateReview !== undefined &&
    (staged.kind !== "external_web" || staged.source !== "https" || staged.sourceUrl === undefined)) {
    context.addIssue({ code: "custom", path: ["externalUpdateReview"], message: "External update review identity is invalid." });
  }
  if (staged.pureUpdateReview !== undefined && staged.kind !== "pure") {
    context.addIssue({ code: "custom", path: ["pureUpdateReview"], message: "Pure update review identity is invalid." });
  }
  const canonicalPaths = new Set<string>();
  let totalBytes = 0;
  let manifestCount = 0;
  for (const [index, file] of staged.files.entries()) {
    const canonicalPath = file.relativePath.normalize("NFC").toLocaleLowerCase("en-US");
    if (canonicalPaths.has(canonicalPath)) {
      context.addIssue({ code: "custom", path: ["files", index, "relativePath"], message: "Staged Skill file paths must be unique." });
    }
    canonicalPaths.add(canonicalPath);
    totalBytes += file.utf8ByteSize;
    if (file.relativePath === "SKILL.md") manifestCount += 1;
  }
  if (manifestCount !== 1) {
    context.addIssue({ code: "custom", path: ["files"], message: "A staged Skill requires exactly one root SKILL.md." });
  }
  if (totalBytes > SKILL_ZIP_STAGE_MAX_EXPANDED_BYTES) {
    context.addIssue({ code: "custom", path: ["files"], message: "Staged Skill files exceed the expanded-byte limit." });
  }
});
export const SkillStageFromUrlRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillInstallRequestIdSchema,
  activeVaultId: VaultIdSchema,
  sourceUrl: SkillInstallUrlSchema
}).strict();
export const SkillStageFromMarkdownRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillInstallRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();
export const SkillStageFromZipRequestSchema = SkillStageFromMarkdownRequestSchema;
export const SkillInstallStagedRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillInstallRequestIdSchema,
  activeVaultId: VaultIdSchema,
  scope: z.enum(["machine_local", "vault"]),
  stagingId: SkillStagingIdSchema,
  manifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  bundleSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  expectedRegistryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  enabled: z.boolean()
}).strict();
export const SkillDiscardStagedRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillInstallRequestIdSchema,
  activeVaultId: VaultIdSchema,
  scope: z.enum(["machine_local", "vault"]),
  stagingId: SkillStagingIdSchema,
  manifestSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  bundleSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
}).strict();

const SkillInstalledLifecycleRequestIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillLifecycleRequestIdSchema,
  activeVaultId: VaultIdSchema,
  scope: z.enum(["machine_local", "vault"]),
  skillId: SkillIdSchema,
  expectedRegistryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const SkillEnableRequestSchema = SkillInstalledLifecycleRequestIdentitySchema;
export const SkillUninstallRequestSchema = SkillInstalledLifecycleRequestIdentitySchema;
export const SkillExportRequestSchema = SkillInstalledLifecycleRequestIdentitySchema;
export const SkillStageUpdateRequestSchema = SkillInstalledLifecycleRequestIdentitySchema;
export const SkillRestoreRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillLifecycleRequestIdSchema,
  activeVaultId: VaultIdSchema,
  scope: z.enum(["machine_local", "vault"]),
  restoreContextId: SkillRestoreContextIdSchema,
  skillId: SkillIdSchema,
  expectedRegistryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();

const SkillInstalledLifecycleResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillLifecycleRequestIdSchema,
  activeVaultId: VaultIdSchema,
  scope: z.enum(["machine_local", "vault"]),
  skillId: SkillIdSchema
}).strict();

const SkillRegistryErrorSummarySchema = PigeErrorCoreSchema.strict()
  .superRefine(requireErrorDomainMatchesCode);

const SkillInstallResultIdentitySchema = z.object({
  requestId: SkillInstallRequestIdSchema,
  activeVaultId: VaultIdSchema.optional()
}).strict();

export const SkillStageFromUrlResultSchema = z.discriminatedUnion("status", [
  SkillInstallResultIdentitySchema.extend({
    status: z.literal("ready"),
    staged: SkillStagedSummarySchema
  }).strict(),
  SkillInstallResultIdentitySchema.extend({
    status: z.literal("invalid"),
    reason: SkillStageInvalidReasonSchema
  }).strict(),
  SkillInstallResultIdentitySchema.extend({
    status: z.literal("failed"),
    error: SkillRegistryErrorSummarySchema
  }).strict()
]).superRefine((result, context) => {
  if (result.status === "ready" && !result.staged.sourceUrl) {
    context.addIssue({ code: "custom", path: ["staged", "sourceUrl"], message: "URL stages require a source URL." });
  }
});

const SkillStageFromMarkdownResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillInstallRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();
export const SkillStageFromMarkdownResultSchema = z.discriminatedUnion("status", [
  SkillStageFromMarkdownResultIdentitySchema.extend({
    status: z.literal("ready"),
    staged: SkillStagedSummarySchema
  }).strict(),
  SkillStageFromMarkdownResultIdentitySchema.extend({ status: z.literal("cancelled") }).strict(),
  SkillStageFromMarkdownResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status === "ready" && result.staged.sourceUrl !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["staged", "sourceUrl"],
      message: "Local Markdown stages cannot expose a source URL."
    });
  }
});

export const SkillStageFromZipResultSchema = z.discriminatedUnion("status", [
  SkillStageFromMarkdownResultIdentitySchema.extend({
    status: z.literal("ready"),
    staged: SkillStagedSummarySchema
  }).strict(),
  SkillStageFromMarkdownResultIdentitySchema.extend({ status: z.literal("cancelled") }).strict(),
  SkillStageFromMarkdownResultIdentitySchema.extend({
    status: z.literal("invalid"),
    reason: SkillZipStageInvalidReasonSchema
  }).strict(),
  SkillStageFromMarkdownResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status === "ready" && result.staged.sourceUrl !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["staged", "sourceUrl"],
      message: "Local ZIP stages cannot expose a source URL."
    });
  }
});

export const SkillPendingStagedReviewsRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillLifecycleRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();
const SkillPendingStagedReviewsResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillLifecycleRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();
export const SkillPendingStagedReviewsResultSchema = z.discriminatedUnion("status", [
  SkillPendingStagedReviewsResultIdentitySchema.extend({
    status: z.literal("ready"),
    staged: z.array(SkillStagedSummarySchema).max(SKILL_PENDING_STAGED_REVIEWS_MAX_ITEMS).readonly()
  }).strict(),
  SkillPendingStagedReviewsResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "ready") return;
  for (const [index, staged] of result.staged.entries()) {
    if (staged.sourceUrl === undefined) {
      context.addIssue({
        code: "custom",
        path: ["staged", index, "sourceUrl"],
        message: "Pending chat Skill reviews must originate from HTTPS staging."
      });
    }
    if (index > 0 && result.staged[index - 1]!.stagingId >= staged.stagingId) {
      context.addIssue({
        code: "custom",
        path: ["staged", index, "stagingId"],
        message: "Pending chat Skill reviews must use unique ascending staging IDs."
      });
    }
  }
});

export const SkillStageUpdateResultSchema = z.discriminatedUnion("status", [
  SkillInstalledLifecycleResultIdentitySchema.extend({
    status: z.literal("ready"),
    staged: SkillStagedSummarySchema
  }).strict(),
  SkillInstalledLifecycleResultIdentitySchema.extend({
    status: z.literal("current"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillInstalledLifecycleResultIdentitySchema.extend({
    status: z.literal("stale"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillInstalledLifecycleResultIdentitySchema.extend({
    status: z.literal("not_found"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillInstalledLifecycleResultIdentitySchema.extend({ status: z.literal("cancelled") }).strict(),
  SkillInstalledLifecycleResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status === "ready" && result.staged.id !== result.skillId) {
    context.addIssue({ code: "custom", path: ["staged", "id"], message: "Staged update Skill identity must match." });
  }
  if (result.status === "ready" && result.staged.kind === "external_web" && result.staged.externalUpdateReview === undefined) {
    context.addIssue({ code: "custom", path: ["staged", "externalUpdateReview"], message: "External updates require an exact review diff." });
  }
  if (result.status === "ready" && result.staged.kind === "pure" && result.staged.externalUpdateReview !== undefined) {
    context.addIssue({ code: "custom", path: ["staged", "externalUpdateReview"], message: "Pure updates cannot expose an External/Web diff." });
  }
  if (result.status === "ready" && result.staged.kind === "external_web" && result.staged.pureUpdateReview !== undefined) {
    context.addIssue({ code: "custom", path: ["staged", "pureUpdateReview"], message: "External updates cannot expose a pure diff." });
  }
});

export const SkillInstallStagedResultSchema = z.discriminatedUnion("status", [
  SkillInstallResultIdentitySchema.extend({
    status: z.literal("committed"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillInstallResultIdentitySchema.extend({
    status: z.literal("stale"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillInstallResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  SkillInstallResultIdentitySchema.extend({
    status: z.literal("failed"),
    error: SkillRegistryErrorSummarySchema
  }).strict()
]);

export const SkillDiscardStagedResultSchema = z.discriminatedUnion("status", [
  SkillInstallResultIdentitySchema.extend({ status: z.literal("discarded") }).strict(),
  SkillInstallResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  SkillInstallResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  SkillInstallResultIdentitySchema.extend({
    status: z.literal("failed"),
    error: SkillRegistryErrorSummarySchema
  }).strict()
]);

export const SkillRegistryQueryRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillLifecycleRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();
const SkillRegistryQueryResultIdentitySchema = z.object({
  apiVersion: z.literal(1).optional(),
  requestId: SkillLifecycleRequestIdSchema.optional(),
  activeVaultId: VaultIdSchema.optional()
}).strict();
export const SkillRegistryQueryResultSchema = z.discriminatedUnion("status", [
  SkillRegistryQueryResultIdentitySchema.extend({ status: z.literal("ready"), registry: SkillRegistrySummarySchema }).strict(),
  SkillRegistryQueryResultIdentitySchema.extend({ status: z.literal("failed"), error: SkillRegistryErrorSummarySchema }).strict()
]);

export const SkillRegistryMutationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("committed"), registry: SkillRegistrySummarySchema }).strict(),
  z.object({ status: z.literal("stale"), registry: SkillRegistrySummarySchema }).strict(),
  z.object({ status: z.literal("not_found"), registry: SkillRegistrySummarySchema }).strict(),
  z.object({ status: z.literal("failed"), error: SkillRegistryErrorSummarySchema }).strict()
]);

export const SkillLifecycleMutationResultSchema = z.discriminatedUnion("status", [
  SkillInstalledLifecycleResultIdentitySchema.extend({
    status: z.literal("committed"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillInstalledLifecycleResultIdentitySchema.extend({
    status: z.literal("stale"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillInstalledLifecycleResultIdentitySchema.extend({
    status: z.literal("not_found"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillInstalledLifecycleResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

const SkillRestoreResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: SkillLifecycleRequestIdSchema,
  activeVaultId: VaultIdSchema,
  scope: z.enum(["machine_local", "vault"]),
  restoreContextId: SkillRestoreContextIdSchema,
  skillId: SkillIdSchema
}).strict();
export const SkillRestoreResultSchema = z.discriminatedUnion("status", [
  SkillRestoreResultIdentitySchema.extend({
    status: z.literal("committed"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillRestoreResultIdentitySchema.extend({
    status: z.literal("stale"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillRestoreResultIdentitySchema.extend({
    status: z.literal("not_found"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillRestoreResultIdentitySchema.extend({
    status: z.literal("ineligible"),
    registry: SkillRegistrySummarySchema
  }).strict(),
  SkillRestoreResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

const SkillExportResultIdentitySchema = SkillInstalledLifecycleResultIdentitySchema.extend({
  registryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const SkillExportResultSchema = z.discriminatedUnion("status", [
  SkillExportResultIdentitySchema.extend({ status: z.literal("exported") }).strict(),
  SkillExportResultIdentitySchema.extend({ status: z.literal("cancelled") }).strict(),
  SkillExportResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  SkillExportResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  SkillExportResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const MemoryKindSchema = z.enum(["preference", "correction", "workflow_lesson", "profile"]);
export const MemoryStatusSchema = z.enum(["active", "disabled"]);

export const MemoryRecordSummarySchema = z.object({
  id: MemoryRecordIdSchema,
  kind: MemoryKindSchema,
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2_000),
  status: MemoryStatusSchema,
  provenance: z.object({
    kind: z.enum(["explicit_user_request", "authored_user_statement"]),
    occurredAt: z.string().datetime({ offset: true })
  }).strict(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export const MemorySummarySchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  records: z.array(MemoryRecordSummarySchema).max(1_000)
}).strict();

export const MemoryListRequestSchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema
}).strict();

export const MemoryRequestIdSchema = z.string().regex(/^memory_request_[a-z0-9]{16,64}$/);
const MemoryRecordMutationRequestIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: MemoryRequestIdSchema,
  activeVaultId: VaultIdSchema,
  memoryId: MemoryRecordIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
});

export const MemoryDisableRequestSchema = MemoryRecordMutationRequestIdentitySchema.strict();
export const MemoryEnableRequestSchema = MemoryRecordMutationRequestIdentitySchema.strict();
export const MemoryDeleteRequestSchema = MemoryRecordMutationRequestIdentitySchema.strict();
export const MemoryEditRequestSchema = MemoryRecordMutationRequestIdentitySchema.extend({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2_000)
}).strict();

export const MemoryResetRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: MemoryRequestIdSchema,
  activeVaultId: VaultIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();

export const MemoryExportRequestSchema = MemoryResetRequestSchema;

export const MemoryMutationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("committed"), summary: MemorySummarySchema }).strict(),
  z.object({ status: z.literal("stale"), summary: MemorySummarySchema }).strict(),
  z.object({ status: z.literal("not_found"), summary: MemorySummarySchema }).strict()
]);

export const MemoryLifecycleMutationResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("committed"),
    requestId: MemoryRequestIdSchema,
    activeVaultId: VaultIdSchema,
    operationId: OperationIdSchema,
    summary: MemorySummarySchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("stale"),
    requestId: MemoryRequestIdSchema,
    activeVaultId: VaultIdSchema,
    summary: MemorySummarySchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("not_found"),
    requestId: MemoryRequestIdSchema,
    activeVaultId: VaultIdSchema,
    summary: MemorySummarySchema
  }).strict()
]);

const MemoryExportResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: MemoryRequestIdSchema,
  activeVaultId: VaultIdSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
});

export const MemoryExportResultSchema = z.discriminatedUnion("status", [
  MemoryExportResultIdentitySchema.extend({ status: z.literal("exported") }).strict(),
  MemoryExportResultIdentitySchema.extend({ status: z.literal("cancelled") }).strict(),
  MemoryExportResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  MemoryExportResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
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

export const PermissionDecisionScopeSchema = z.enum([
  "once",
  "actor_version",
  "resource_scope",
  "profile_default",
  "never"
]);

export const PermissionDecisionRecordSchema = z.object({
  id: PermissionDecisionIdSchema,
  schemaVersion: z.literal(1),
  permissionRequestId: PermissionRequestIdSchema,
  confirmationId: HighRiskConfirmationIdSchema,
  confirmationRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  bindingHash: PermissionSha256HashSchema,
  decision: z.enum(["deny", "allow_once", "allow_scoped"]),
  scope: PermissionDecisionScopeSchema,
  decidedBy: z.enum(["user", "system"]),
  autoAllowedBy: z.enum(["none", "saved_grant", "yolo_full_access"]),
  jobId: JobIdSchema.optional(),
  operationId: OperationIdSchema.optional(),
  decidedAt: z.string().datetime({ offset: true })
}).strict().superRefine((decision, context) => {
  if (decision.decision === "deny" && decision.scope !== "never") {
    context.addIssue({
      code: "custom",
      path: ["scope"],
      message: "A denial must use the never decision scope."
    });
  }
  if (decision.decision === "allow_once" && decision.scope !== "once") {
    context.addIssue({
      code: "custom",
      path: ["scope"],
      message: "An allow-once decision must use the once decision scope."
    });
  }
  if (decision.decision === "allow_scoped" && ["once", "never"].includes(decision.scope)) {
    context.addIssue({
      code: "custom",
      path: ["scope"],
      message: "A scoped allow must use actor_version, resource_scope, or profile_default scope."
    });
  }
  if (decision.decision === "deny" && decision.autoAllowedBy !== "none") {
    context.addIssue({
      code: "custom",
      path: ["autoAllowedBy"],
      message: "A denial cannot be auto-allowed."
    });
  }
  if (decision.autoAllowedBy !== "none" && (
    decision.decidedBy !== "system" || decision.decision !== "allow_once"
  )) {
    context.addIssue({
      code: "custom",
      path: ["autoAllowedBy"],
      message: "Saved grants and YOLO may authorize only one system-recorded action."
    });
  }
  if (decision.decidedBy === "system" && decision.decision !== "deny" && decision.autoAllowedBy === "none") {
    context.addIssue({
      code: "custom",
      path: ["autoAllowedBy"],
      message: "A system allow must identify the saved grant or YOLO mode that authorized it."
    });
  }
});

export const PERMISSIONS_SUMMARY_CHANNEL = "permissions.summary" as const;
export const PERMISSIONS_SET_DEFAULT_MODE_CHANNEL = "permissions.setDefaultMode" as const;
export const PERMISSIONS_REVOKE_GRANT_CHANNEL = "permissions.revokeGrant" as const;
export const PERMISSIONS_CHANGED_CHANNEL = "permissions.changed" as const;

export const PermissionDefaultModeSchema = z.enum([
  "ask_every_time",
  "remember_scoped_grants",
  "yolo_full_access"
]);

export const AgentRuntimePolicyContextSchema = z.object({
  schemaVersion: z.literal(1),
  policyContextId: z.string().regex(/^policy_[a-f0-9]{16}$/),
  builtAt: z.string().datetime({ offset: true }),
  jobId: z.string().min(1).max(160),
  policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  vaultId: VaultIdSchema,
  sourceStorage: z.object({
    defaultStrategy: SourceStorageStrategySchema,
    sourceAssetRootKind: SourceAssetRootKindSchema,
    allowPerCaptureOverride: z.boolean(),
    linkStrategyEnabled: z.literal(false)
  }).strict(),
  model: z.object({
    defaultModelProfileId: z.string().min(1).optional(),
    modelConfigured: z.boolean(),
    cloudBoundary: CloudBoundarySchema,
    boundaryVerification: BoundaryVerificationSchema,
    cloudSendPolicy: CloudSendPolicySchema,
    modelRoutingMode: z.enum([
      "default_model_only",
      "pi_upstream_model_slots",
      "pige_model_routing_service"
    ])
  }).strict(),
  authority: z.object({
    firstPartyTurnAuthority: z.literal(true),
    highRiskConfirmation: z.literal("closed_list"),
    permissionMode: PermissionDefaultModeSchema,
    permissionPolicyRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    thirdPartyInheritance: z.literal(false)
  }).strict(),
  language: z.object({
    appLocale: LocaleSchema,
    generatedKnowledgeLanguage: GeneratedKnowledgeLanguageSchema,
    preserveSourceLanguage: z.boolean(),
    ocrLanguageHints: z.array(z.string().min(1).max(64)).max(32),
    voiceInputLanguage: z.string().min(1).max(64).optional()
  }).strict(),
  confirmation: z.object({
    safeAutoApplyThreshold: z.number().min(0).max(1),
    mutatingReviewThreshold: z.number().min(0).max(1),
    riskyChangeRequiresConfirmation: z.boolean()
  }).strict(),
  memory: z.object({
    vaultMemoryEnabled: z.boolean(),
    allowedMemoryScopes: z.array(z.enum([
      "preference",
      "correction",
      "workflow_lesson",
      "profile"
    ])).max(4),
    includeMemoryInBackup: z.boolean()
  }).strict(),
  retrieval: z.object({
    lexicalSearchAvailable: z.boolean(),
    vectorSearchAvailable: z.boolean(),
    rerankerAvailable: z.boolean(),
    maxSnippetsForCloudSynthesis: z.number().int().positive().max(64)
  }).strict(),
  localCapabilities: z.object({
    localDatabase: z.enum(["not_initialized", "ready", "needs_rebuild", "error"]),
    parserToolchainReady: z.boolean(),
    ocrEngines: z.array(z.enum(["apple_vision", "windows_ai", "paddleocr_local"])).max(3),
    speechInputAvailable: z.boolean(),
    embeddingModelInstalled: z.boolean(),
    hiddenDownloadsAllowed: z.literal(false),
    excludeLowConfidenceOcrFromSummaries: z.boolean()
  }).strict()
}).strict();

export type AgentRuntimePolicyContext = z.infer<typeof AgentRuntimePolicyContextSchema>;

export const PERMISSION_YOLO_HARD_BOUNDARIES = [
  "permanent_delete",
  "overwrite_user_original",
  "raw_credential_export",
  "risky_agent_edit",
  "protected_authority_change",
  "os_permission",
  "ssrf_private_network",
  "signature_verification",
  "filesystem_safety"
] as const;

export const PermissionYoloHardBoundarySchema = z.enum(PERMISSION_YOLO_HARD_BOUNDARIES);
const PermissionYoloHardBoundariesSchema = z.tuple([
  z.literal("permanent_delete"),
  z.literal("overwrite_user_original"),
  z.literal("raw_credential_export"),
  z.literal("risky_agent_edit"),
  z.literal("protected_authority_change"),
  z.literal("os_permission"),
  z.literal("ssrf_private_network"),
  z.literal("signature_verification"),
  z.literal("filesystem_safety")
]);

export const PermissionFullAccessSummarySchema = z.discriminatedUnion("enabled", [
  z.object({
    enabled: z.literal(false),
    canEnable: z.boolean(),
    hardBoundaries: PermissionYoloHardBoundariesSchema
  }).strict(),
  z.object({
    enabled: z.literal(true),
    enabledAt: z.string().datetime({ offset: true }),
    canDisable: z.literal(true),
    hardBoundaries: PermissionYoloHardBoundariesSchema
  }).strict()
]);

export const PermissionGrantSummarySchema = z.object({
  grantId: PermissionGrantIdSchema,
  actorType: PermissionActorTypeSchema,
  actorLabel: RendererSafeSubjectLabelSchema,
  actorVersion: PermissionVersionSchema,
  capability: PermissionCapabilitySchema,
  dataBoundary: PermissionDataBoundarySchema,
  scope: z.enum(["actor_version", "resource_scope"]),
  resourceScope: PermissionResourceScopeSchema,
  resourceLabel: RendererSafeSubjectLabelSchema,
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  canRevoke: z.literal(true)
}).strict();

export const PermissionPolicySummarySchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  defaultMode: PermissionDefaultModeSchema,
  fullAccess: PermissionFullAccessSummarySchema,
  grants: z.array(PermissionGrantSummarySchema).max(64).refine(
    (grants) => new Set(grants.map((grant) => grant.grantId)).size === grants.length,
    "Permission grant IDs must be unique."
  ),
  invalidGrantCount: z.number().int().nonnegative().max(10_000)
}).strict().superRefine((summary, context) => {
  if ((summary.defaultMode === "yolo_full_access") !== summary.fullAccess.enabled) {
    context.addIssue({
      code: "custom",
      path: ["fullAccess", "enabled"],
      message: "Full Access enabled state must exactly match the default permission mode."
    });
  }
});

const PermissionPolicyRequestIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: PermissionPolicyRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();

export const PermissionPolicySummaryRequestSchema = PermissionPolicyRequestIdentitySchema;
export const PermissionPolicySummaryResultSchema = z.discriminatedUnion("status", [
  PermissionPolicyRequestIdentitySchema.extend({
    status: z.literal("ready"),
    summary: PermissionPolicySummarySchema
  }).strict(),
  PermissionPolicyRequestIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const PermissionSetDefaultModeRequestSchema = PermissionPolicyRequestIdentitySchema.extend({
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  mode: PermissionDefaultModeSchema,
  fullAccessAcknowledgement: z.object({
    kind: z.literal("yolo_full_access"),
    explicitUserAction: z.literal(true),
    hardBoundariesAcknowledged: z.literal(true)
  }).strict().optional()
}).strict().superRefine((request, context) => {
  if ((request.mode === "yolo_full_access") !== (request.fullAccessAcknowledgement !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["fullAccessAcknowledgement"],
      message: "YOLO Full Access requires one exact explicit user acknowledgement."
    });
  }
});
export const PermissionSetDefaultModeResultSchema = z.discriminatedUnion("status", [
  PermissionPolicyRequestIdentitySchema.extend({
    status: z.enum(["committed", "stale"]),
    summary: PermissionPolicySummarySchema
  }).strict(),
  PermissionPolicyRequestIdentitySchema.extend({
    status: z.literal("confirmation_required"),
    confirmationId: HighRiskConfirmationIdSchema,
    confirmationRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    summary: PermissionPolicySummarySchema
  }).strict(),
  PermissionPolicyRequestIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const PermissionRevokeGrantRequestSchema = PermissionPolicyRequestIdentitySchema.extend({
  grantId: PermissionGrantIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const PermissionRevokeGrantResultSchema = z.discriminatedUnion("status", [
  PermissionPolicyRequestIdentitySchema.extend({
    status: z.enum(["committed", "stale", "not_found"]),
    summary: PermissionPolicySummarySchema
  }).strict(),
  PermissionPolicyRequestIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const PermissionPolicyChangedEventSchema = PermissionPolicySummarySchema;

export const ExternalWebSkillRuntimeIdentitySchema = z.object({
  kind: z.literal("external_web"),
  scope: z.literal("machine_local"),
  trust: z.literal("user_confirmed"),
  enabled: z.literal(true),
  skillId: SkillIdSchema,
  skillVersion: z.string().min(1).max(80).regex(/^[0-9A-Za-z][0-9A-Za-z._+-]*$/u),
  manifestSha256: PermissionSha256HashSchema,
  bundleSha256: PermissionSha256HashSchema,
  registryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  runtime: ExternalWebSkillRuntimeDeclarationSchema,
  runtimeIdentityHash: PermissionSha256HashSchema
}).strict();

export const ExternalWebSkillRuntimeTurnBindingSchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  jobId: JobIdSchema,
  clientTurnId: AgentClientTurnIdSchema,
  authoredTaskIntent: z.literal("explicit_user_task"),
  policyContextId: PermissionPolicyContextIdSchema,
  policyHash: PermissionSha256HashSchema,
  networkPolicy: z.literal("public_https_only"),
  runtimeKind: z.literal("desktop_local"),
  clientCapabilityTier: z.literal("desktop_full"),
  identity: ExternalWebSkillRuntimeIdentitySchema,
  permissionBinding: PermissionActionBindingSchema
}).strict().superRefine((binding, context) => {
  const permission = binding.permissionBinding;
  const expected = {
    vaultId: binding.activeVaultId,
    jobId: binding.jobId,
    actorType: "skill",
    actorId: `skill:${binding.identity.skillId}`,
    actorVersion: "1",
    actorDigest: binding.identity.runtimeIdentityHash,
    actionId: "external_web.read_https",
    actionVersion: "1",
    capability: "external_network",
    dataBoundary: "network",
    resourceScope: "current_url",
    policyContextId: binding.policyContextId,
    policyHash: binding.policyHash,
    runtimeKind: binding.runtimeKind,
    clientCapabilityTier: binding.clientCapabilityTier
  } as const;
  for (const [key, value] of Object.entries(expected)) {
    if (permission[key as keyof typeof permission] !== value) {
      context.addIssue({
        code: "custom",
        path: ["permissionBinding", key],
        message: "External/Web Skill authority must match the exact runtime turn binding."
      });
    }
  }
});

export const ExternalWebSkillRuntimeCallSchema = z.object({
  toolName: ExternalWebSkillRuntimeToolNameSchema,
  turn: ExternalWebSkillRuntimeTurnBindingSchema,
  request: ExternalWebSkillReadRequestSchema
}).strict().superRefine((call, context) => {
  if (new URL(call.request.url).origin !== call.turn.identity.runtime.origin) {
    context.addIssue({
      code: "custom",
      path: ["request", "url"],
      message: "External/Web Skill reads must stay on the exact reviewed HTTPS origin."
    });
  }
});

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

export const DIAGNOSTICS_CLEAR_LOCAL_CHANNEL = "diagnostics.clearLocalDiagnostics" as const;
export const DIAGNOSTICS_WORKFLOW_SUMMARY_CHANNEL = "diagnostics.workflowSummary" as const;
export const DIAGNOSTICS_PREVIEW_SUPPORT_BUNDLE_CHANNEL = "diagnostics.previewSupportBundle" as const;
export const DIAGNOSTICS_EXPORT_SUPPORT_BUNDLE_CHANNEL = "diagnostics.exportSupportBundle" as const;
export const DIAGNOSTICS_CANCEL_SUPPORT_BUNDLE_CHANNEL = "diagnostics.cancelSupportBundleExport" as const;
export const DIAGNOSTICS_RETRY_SUPPORT_BUNDLE_CHANNEL = "diagnostics.retrySupportBundleExport" as const;
export const DiagnosticsClearRequestIdSchema = z.string()
  .regex(/^diagclearreq_[a-z0-9]{16,64}$/u);
export const DiagnosticsWorkflowRequestIdSchema = z.string()
  .regex(/^diag(?:preview|export|cancel|retry)req_[a-z0-9]{16,64}$/u);
export const DiagnosticsPreviewRequestIdSchema = z.string()
  .regex(/^diagpreviewreq_[a-z0-9]{16,64}$/u);
export const DiagnosticsExportRequestIdSchema = z.string()
  .regex(/^diagexportreq_[a-z0-9]{16,64}$/u);
export const DiagnosticsMutationRequestIdSchema = z.string()
  .regex(/^diag(?:cancel|retry)req_[a-z0-9]{16,64}$/u);
export const DiagnosticsScopeContextIdSchema = z.string()
  .regex(/^diagctx_[a-f0-9]{32,64}$/u);
export const SupportBundlePreviewIdSchema = z.string()
  .regex(/^supportpreview_[a-f0-9]{32,64}$/u);
export const CrashRecoverySummarySchema = z.object({
  recoveryId: z.string().regex(/^crashrecovery_[a-f0-9]{32}$/u),
  status: z.enum(["recovering", "recovered", "needs_attention"]),
  detectedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
  capturesPreserved: z.number().int().nonnegative().max(1_000_000),
  jobsRecovered: z.number().int().nonnegative().max(1_000_000),
  jobsNeedRetry: z.number().int().nonnegative().max(1_000_000),
  proposalsRecovered: z.number().int().nonnegative().max(1_000_000),
  proposalsAwaitingReview: z.number().int().nonnegative().max(1_000_000),
  sourcesNeedRepair: z.number().int().nonnegative().max(1_000_000),
  indexRebuildRunning: z.boolean()
}).strict();
export const DiagnosticsHealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  checkedAt: z.string().datetime({ offset: true }),
  localOnly: z.literal(true),
  recentErrorCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  checks: z.array(z.object({
    id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/u),
    status: z.enum(["ok", "warning", "error"]),
    message: z.string().min(1).max(240)
  }).strict()).max(32),
  crashRecovery: CrashRecoverySummarySchema.optional(),
  crashRecoveryHistory: z.array(CrashRecoverySummarySchema.extend({
    status: z.enum(["recovered", "needs_attention"]),
    completedAt: z.string().datetime({ offset: true })
  }).strict()).max(10).optional()
}).strict();
export const DiagnosticsSupportBundleJobSummarySchema = z.object({
  jobId: JobIdSchema,
  state: z.enum([
    "queued", "running", "cancel_requested", "completed", "completed_with_warnings",
    "failed_retryable", "failed_final", "cancelled"
  ]),
  progress: z.object({
    completedUnits: z.number().int().min(0).max(3),
    totalUnits: z.literal(3),
    percent: z.number().int().min(0).max(100),
    messageKey: z.string().min(1).max(120)
  }).strict(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }).optional(),
  canCancel: z.boolean(),
  canRetry: z.boolean(),
  repairAction: z.enum(["none", "retry", "choose_destination", "clear"]),
  error: z.lazy(() => PigeErrorSummarySchema).optional()
}).strict();
export const DiagnosticsWorkflowSummarySchema = z.object({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  scopeContextId: DiagnosticsScopeContextIdSchema,
  activeVaultId: VaultIdSchema.nullable(),
  localOnly: z.literal(true),
  ownedArtifactCount: z.number().int().nonnegative().max(10_000),
  job: DiagnosticsSupportBundleJobSummarySchema.optional()
}).strict();
export const SupportBundleCategorySchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/u),
  label: z.string().min(1).max(240),
  included: z.boolean(),
  reason: z.string().min(1).max(320)
}).strict();
export const SupportBundlePreviewSchema = z.object({
  apiVersion: z.literal(1),
  requestId: DiagnosticsPreviewRequestIdSchema,
  previewId: SupportBundlePreviewIdSchema,
  generatedAt: z.string().datetime({ offset: true }),
  localOnly: z.literal(true),
  estimatedBytes: z.number().int().nonnegative().max(2 * 1024 * 1024),
  scopeContextId: DiagnosticsScopeContextIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  activeVaultId: VaultIdSchema.nullable(),
  includedCategories: z.array(SupportBundleCategorySchema).min(1).max(32),
  excludedCategories: z.array(SupportBundleCategorySchema).min(1).max(32),
  privacyWarnings: z.array(z.string().min(1).max(320)).min(1).max(16)
}).strict();
export const DiagnosticsPreviewSupportBundleRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: DiagnosticsPreviewRequestIdSchema
}).strict();
export const DiagnosticsExportSupportBundleRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: DiagnosticsExportRequestIdSchema,
  previewId: SupportBundlePreviewIdSchema,
  scopeContextId: DiagnosticsScopeContextIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
const DiagnosticsExportSupportBundleIdentitySchema = DiagnosticsExportSupportBundleRequestSchema;
export const DiagnosticsExportSupportBundleResultSchema = z.discriminatedUnion("status", [
  DiagnosticsExportSupportBundleIdentitySchema.extend({ status: z.literal("started"), workflow: DiagnosticsWorkflowSummarySchema }).strict(),
  DiagnosticsExportSupportBundleIdentitySchema.extend({ status: z.literal("canceled"), workflow: DiagnosticsWorkflowSummarySchema }).strict(),
  DiagnosticsExportSupportBundleIdentitySchema.extend({ status: z.literal("stale"), workflow: DiagnosticsWorkflowSummarySchema }).strict(),
  DiagnosticsExportSupportBundleIdentitySchema.extend({ status: z.literal("busy"), workflow: DiagnosticsWorkflowSummarySchema }).strict(),
  DiagnosticsExportSupportBundleIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const DiagnosticsSupportBundleMutationRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: DiagnosticsMutationRequestIdSchema,
  scopeContextId: DiagnosticsScopeContextIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  jobId: JobIdSchema
}).strict();
const DiagnosticsSupportBundleMutationIdentitySchema = DiagnosticsSupportBundleMutationRequestSchema;
export const DiagnosticsSupportBundleMutationResultSchema = z.discriminatedUnion("status", [
  DiagnosticsSupportBundleMutationIdentitySchema.extend({ status: z.literal("accepted"), workflow: DiagnosticsWorkflowSummarySchema }).strict(),
  DiagnosticsSupportBundleMutationIdentitySchema.extend({ status: z.literal("completed"), workflow: DiagnosticsWorkflowSummarySchema }).strict(),
  DiagnosticsSupportBundleMutationIdentitySchema.extend({ status: z.literal("stale"), workflow: DiagnosticsWorkflowSummarySchema }).strict(),
  DiagnosticsSupportBundleMutationIdentitySchema.extend({ status: z.literal("not_found"), workflow: DiagnosticsWorkflowSummarySchema }).strict(),
  DiagnosticsSupportBundleMutationIdentitySchema.extend({ status: z.literal("ineligible"), workflow: DiagnosticsWorkflowSummarySchema }).strict(),
  DiagnosticsSupportBundleMutationIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const DiagnosticsClearLocalRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: DiagnosticsClearRequestIdSchema,
  scopeContextId: DiagnosticsScopeContextIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
const DiagnosticsClearLocalIdentitySchema = DiagnosticsClearLocalRequestSchema;
export const DiagnosticsClearLocalResultSchema = z.discriminatedUnion("status", [
  DiagnosticsClearLocalIdentitySchema.extend({
    status: z.literal("cleared"),
    health: DiagnosticsHealthSchema,
    workflow: DiagnosticsWorkflowSummarySchema,
    clearedArtifactCount: z.number().int().nonnegative().max(10_000)
  }).strict(),
  DiagnosticsClearLocalIdentitySchema.extend({
    status: z.literal("busy"),
    health: DiagnosticsHealthSchema,
    workflow: DiagnosticsWorkflowSummarySchema
  }).strict(),
  DiagnosticsClearLocalIdentitySchema.extend({
    status: z.literal("stale"),
    health: DiagnosticsHealthSchema,
    workflow: DiagnosticsWorkflowSummarySchema
  }).strict(),
  DiagnosticsClearLocalIdentitySchema.extend({
    status: z.literal("failed")
  }).strict()
]);

function isCanonicalBcp47Tag(value: string): boolean {
  if (value === "unknown") {
    return false;
  }
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

export const Bcp47LanguageTagSchema = z.string()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u)
  .refine(isCanonicalBcp47Tag, {
    message: "Language tags must be canonical BCP 47 values."
  });
export const DurableLanguageSchema = z.union([
  z.literal("unknown"),
  Bcp47LanguageTagSchema
]);
export const DurableLanguageDomainSchema = z.enum([
  "source_record",
  "markdown_page",
  "ocr_artifact",
  "chunk",
  "memory",
  "query",
  "response"
]);
export const DurableLanguageBasisSchema = z.enum([
  "explicit_source",
  "ocr_observed",
  "page_inherited",
  "source_inherited",
  "memory_derived",
  "query_detected",
  "response_policy",
  "legacy_missing",
  "unavailable"
]);
const DurableLanguageFactObjectSchema = z.object({
  domain: DurableLanguageDomainSchema,
  language: DurableLanguageSchema,
  basis: DurableLanguageBasisSchema
}).strict();
function refineDurableLanguageFact(
  fact: z.infer<typeof DurableLanguageFactObjectSchema>,
  context: z.RefinementCtx
): void {
  const unknownBasis = fact.basis === "legacy_missing" || fact.basis === "unavailable";
  if ((fact.language === "unknown") !== unknownBasis) {
    context.addIssue({
      code: "custom",
      path: ["language"],
      message: "Unknown language is valid only for missing or unavailable evidence."
    });
  }
}
export const DurableLanguageFactSchema = DurableLanguageFactObjectSchema
  .superRefine(refineDurableLanguageFact);
export const SourceRecordLanguageFactSchema = DurableLanguageFactObjectSchema.extend({
  domain: z.literal("source_record")
}).superRefine(refineDurableLanguageFact);
export const MarkdownPageLanguageFactSchema = DurableLanguageFactObjectSchema.extend({
  domain: z.literal("markdown_page")
}).superRefine(refineDurableLanguageFact);
export const OcrArtifactLanguageFactSchema = DurableLanguageFactObjectSchema.extend({
  domain: z.literal("ocr_artifact")
}).superRefine(refineDurableLanguageFact);
export const ChunkLanguageFactSchema = DurableLanguageFactObjectSchema.extend({
  domain: z.literal("chunk")
}).superRefine(refineDurableLanguageFact);
export const MemoryLanguageFactSchema = DurableLanguageFactObjectSchema.extend({
  domain: z.literal("memory")
}).superRefine(refineDurableLanguageFact);
export const QueryLanguageFactSchema = DurableLanguageFactObjectSchema.extend({
  domain: z.literal("query")
}).superRefine(refineDurableLanguageFact);
export const ResponseLanguageFactSchema = DurableLanguageFactObjectSchema.extend({
  domain: z.literal("response")
}).superRefine(refineDurableLanguageFact);
export const ConversationLanguageContinuitySchema = z.object({
  queryLanguage: QueryLanguageFactSchema,
  responseLanguage: ResponseLanguageFactSchema
}).strict();

export const VaultDisplayNameSchema = z.string()
  .min(1)
  .max(80)
  .superRefine((value, context) => {
    if (
      value !== value.trim() ||
      value === "." ||
      value === ".." ||
      /[\\/\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) ||
      /^[A-Za-z]:/u.test(value) ||
      /^file:/iu.test(value)
    ) {
      context.addIssue({
        code: "custom",
        message: "A Vault display name must be a bounded safe label, not a path or URI."
      });
    }
  });

const VaultManifestBaseSchema = z.object({
  vault_id: VaultIdSchema,
  display_name: VaultDisplayNameSchema.optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  app_min_version: z.string().min(1),
  default_locale: LocaleSchema,
  durable_roots: z.array(z.string().min(1)),
  rebuildable_roots: z.array(z.string().min(1)),
  origin_vault_id: VaultIdSchema.optional(),
  restored_from_backup_id: BackupIdSchema.optional()
});
export const VaultDurableDomainVersionsV2Schema = z.object({
  markdownPages: z.literal(2),
  sourceRecords: z.literal(2),
  ocrArtifacts: z.literal(2),
  conversationEvents: z.literal(2),
  memory: z.literal(2),
  datasets: z.literal(1),
  jobs: z.literal(1),
  proposals: z.literal(1),
  operations: z.literal(1),
  skills: z.literal(1),
  vaultConfig: z.literal(1)
}).strict();
export const VaultManifestV1Schema = VaultManifestBaseSchema.extend({
  vault_schema_version: z.literal(1)
}).passthrough();
export const VaultManifestV2Schema = VaultManifestBaseSchema.extend({
  vault_schema_version: z.literal(2),
  durable_domain_versions: VaultDurableDomainVersionsV2Schema
}).passthrough();
export const VaultManifestSchema = z.discriminatedUnion("vault_schema_version", [
  VaultManifestV1Schema,
  VaultManifestV2Schema
]);
export const CurrentVaultManifestSchema = VaultManifestV2Schema;
export const VaultManifestCompatibilityHeaderSchema = z.object({
  vault_id: VaultIdSchema,
  vault_schema_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
}).passthrough();

export const VAULT_APPLY_MIGRATION_CHANNEL = "vault.applyMigration" as const;
export const VAULT_RENAME_DISPLAY_NAME_CHANNEL = "vault.renameDisplayName" as const;
export const VaultMetadataRevisionSchema = z.string().regex(/^vaultmeta_[a-f0-9]{64}$/u);
export const VaultRenameDisplayNameRequestIdSchema = z.string()
  .regex(/^vaultrenamereq_[a-z0-9]{16,64}$/u);
export const VaultRenameDisplayNameRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: VaultRenameDisplayNameRequestIdSchema,
  activeVaultId: VaultIdSchema,
  expectedMetadataRevision: VaultMetadataRevisionSchema,
  displayName: VaultDisplayNameSchema
}).strict();
export const VaultMetadataSummarySchema = z.object({
  activeVaultId: VaultIdSchema,
  displayName: VaultDisplayNameSchema,
  revision: VaultMetadataRevisionSchema
}).strict();
export const VaultRenameDisplayNameResultSchema = z.discriminatedUnion("status", [
  VaultRenameDisplayNameRequestSchema.extend({
    status: z.literal("renamed"),
    metadata: VaultMetadataSummarySchema
  }).strict(),
  VaultRenameDisplayNameRequestSchema.extend({
    status: z.literal("stale"),
    metadata: VaultMetadataSummarySchema
  }).strict(),
  VaultRenameDisplayNameRequestSchema.extend({ status: z.literal("not_found") }).strict(),
  VaultRenameDisplayNameRequestSchema.extend({ status: z.literal("failed") }).strict()
]);

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
  "downloading",
  "ready_to_restart",
  "applying",
  "failed"
]);
export const UpdateCheckRequestIdSchema = z.string().regex(/^updatereq_[a-z0-9]{16,64}$/u);
export const UpdateDownloadRequestIdSchema = z.string().regex(/^updatedownloadreq_[a-z0-9]{16,64}$/u);
export const UpdateApplyRequestIdSchema = z.string().regex(/^updateapplyreq_[a-z0-9]{16,64}$/u);
export const UpdateRequestIdSchema = z.union([
  UpdateCheckRequestIdSchema,
  UpdateDownloadRequestIdSchema,
  UpdateApplyRequestIdSchema
]);
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

export const UpdateLifecycleStateSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("downloading"),
    version: UpdateVersionSchema,
    startedAt: z.string().datetime({ offset: true })
  }).strict(),
  z.object({
    phase: z.literal("ready_to_restart"),
    version: UpdateVersionSchema,
    readyAt: z.string().datetime({ offset: true })
  }).strict(),
  z.object({
    phase: z.literal("applying"),
    version: UpdateVersionSchema,
    readyAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true })
  }).strict()
]);

export const UpdateMachineSettingsSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  channel: UpdateChannelSchema,
  lastCheck: UpdateTerminalStateSchema.optional(),
  lifecycle: UpdateLifecycleStateSchema.optional()
}).strict().superRefine((settings, context) => {
  if (
    settings.lifecycle &&
    (settings.lastCheck?.phase !== "available" ||
      settings.lastCheck.availableVersion !== settings.lifecycle.version)
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Update lifecycle must bind the checked version." });
  }
});

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
    phase: z.literal("downloading"),
    availableVersion: UpdateVersionSchema,
    checkedAt: z.string().datetime({ offset: true }),
    progressPercent: z.number().finite().min(0).max(100)
  }).strict(),
  UpdateSummaryBaseSchema.extend({
    phase: z.literal("ready_to_restart"),
    availableVersion: UpdateVersionSchema,
    checkedAt: z.string().datetime({ offset: true }),
    readyAt: z.string().datetime({ offset: true })
  }).strict(),
  UpdateSummaryBaseSchema.extend({
    phase: z.literal("applying"),
    availableVersion: UpdateVersionSchema,
    checkedAt: z.string().datetime({ offset: true }),
    readyAt: z.string().datetime({ offset: true })
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

export const UpdateDownloadRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: UpdateDownloadRequestIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  version: UpdateVersionSchema
}).strict();

export const UpdateDownloadResultSchema = z.object({
  status: z.enum(["started", "already_ready", "blocked", "busy", "stale", "unavailable", "failed"]),
  requestId: UpdateDownloadRequestIdSchema,
  version: UpdateVersionSchema,
  summary: UpdateSummarySchema
}).strict();

export const UpdateApplyRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: UpdateApplyRequestIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  version: UpdateVersionSchema
}).strict();

export const UpdateApplyResultSchema = z.object({
  status: z.enum(["restarting", "blocked", "busy", "stale", "unavailable", "failed"]),
  requestId: UpdateApplyRequestIdSchema,
  version: UpdateVersionSchema,
  summary: UpdateSummarySchema
}).strict();

export const UpdateStatusEventSchema = z.object({
  apiVersion: z.literal(1),
  requestId: UpdateRequestIdSchema,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  summary: UpdateSummarySchema
}).strict();

export const OCR_LANGUAGE_PREFERENCE_CHANNEL =
  "localCapabilities.ocrLanguagePreference" as const;
export const SET_OCR_LANGUAGE_PREFERENCE_CHANNEL =
  "localCapabilities.setOcrLanguagePreference" as const;
export const OCR_ENGINE_PREFERENCE_CHANNEL =
  "localCapabilities.ocrEnginePreference" as const;
export const SET_OCR_ENGINE_PREFERENCE_CHANNEL =
  "localCapabilities.setOcrEnginePreference" as const;
export const OCR_SUMMARY_PREFERENCE_CHANNEL =
  "localCapabilities.ocrSummaryPreference" as const;
export const SET_OCR_SUMMARY_PREFERENCE_CHANNEL =
  "localCapabilities.setOcrSummaryPreference" as const;
export const OCR_IMAGE_TEST_CHANNEL = "localCapabilities.testOcrImage" as const;
export const OcrImageTestRequestIdSchema = z.string()
  .regex(/^ocrimagetest_[a-z0-9]{16,64}$/u);
export const OcrImageTestRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: OcrImageTestRequestIdSchema
}).strict();
const OcrImageTestResultIdentitySchema = OcrImageTestRequestSchema;
export const OcrImageTestPreviewSchema = z.object({
  adapterId: z.enum(["macos_vision_ocr", "paddleocr_local"]),
  engine: z.enum(["macos_vision_document", "macos_vision_text", "Paddle"]),
  engineVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/u),
  text: z.string().max(4_096),
  truncated: z.boolean(),
  blockCount: z.number().int().nonnegative().max(10_000),
  confidence: z.number().min(0).max(1).optional(),
  languageHints: z.array(z.string().min(2).max(35)).max(8),
  warnings: z.array(z.string().min(1).max(160)).max(8)
}).strict();
export const OcrImageTestResultSchema = z.discriminatedUnion("status", [
  OcrImageTestResultIdentitySchema.extend({
    status: z.literal("ready"),
    preview: OcrImageTestPreviewSchema
  }).strict(),
  OcrImageTestResultIdentitySchema.extend({ status: z.literal("cancelled") }).strict(),
  OcrImageTestResultIdentitySchema.extend({ status: z.literal("unavailable") }).strict(),
  OcrImageTestResultIdentitySchema.extend({ status: z.literal("busy") }).strict(),
  OcrImageTestResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const OcrEnginePreferenceRequestIdSchema = z.string()
  .regex(/^ocrenginereq_[a-z0-9]{16,64}$/u);
export const OcrEnginePreferenceSchema = z.enum(["automatic", "platform_native", "paddleocr_local"]);
export const OcrEnginePreferenceMachineSettingsSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  preference: OcrEnginePreferenceSchema
}).strict();
export const OcrEnginePreferenceSummarySchema = OcrEnginePreferenceMachineSettingsSchema.extend({
  apiVersion: z.literal(1),
  appliesTo: z.literal("new_ocr_jobs")
}).strict();
export const OcrEnginePreferenceRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: OcrEnginePreferenceRequestIdSchema
}).strict();
const OcrEnginePreferenceResultIdentitySchema = OcrEnginePreferenceRequestSchema;
export const OcrEnginePreferenceResultSchema = z.discriminatedUnion("status", [
  OcrEnginePreferenceResultIdentitySchema.extend({
    status: z.literal("ready"),
    summary: OcrEnginePreferenceSummarySchema
  }).strict(),
  OcrEnginePreferenceResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const SetOcrEnginePreferenceRequestSchema = OcrEnginePreferenceRequestSchema.extend({
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  preference: OcrEnginePreferenceSchema
}).strict();
const OcrEnginePreferenceAuthoritativeResultSchema = OcrEnginePreferenceResultIdentitySchema.extend({
  summary: OcrEnginePreferenceSummarySchema
}).strict();
export const SetOcrEnginePreferenceResultSchema = z.discriminatedUnion("status", [
  OcrEnginePreferenceAuthoritativeResultSchema.extend({ status: z.literal("committed") }).strict(),
  OcrEnginePreferenceAuthoritativeResultSchema.extend({ status: z.literal("stale") }).strict(),
  OcrEnginePreferenceResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const OcrSummaryPreferenceRequestIdSchema = z.string()
  .regex(/^ocrsummaryreq_[a-z0-9]{16,64}$/u);
export const OcrSummaryPreferenceSummarySchema = z.object({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  excludeLowConfidenceOcr: z.boolean(),
  appliesTo: z.literal("new_agent_jobs")
}).strict();
export const OcrSummaryPreferenceRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: OcrSummaryPreferenceRequestIdSchema
}).strict();
const OcrSummaryPreferenceResultIdentitySchema = OcrSummaryPreferenceRequestSchema;
export const OcrSummaryPreferenceResultSchema = z.discriminatedUnion("status", [
  OcrSummaryPreferenceResultIdentitySchema.extend({
    status: z.literal("ready"),
    summary: OcrSummaryPreferenceSummarySchema
  }).strict(),
  OcrSummaryPreferenceResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const SetOcrSummaryPreferenceRequestSchema = OcrSummaryPreferenceRequestSchema.extend({
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  excludeLowConfidenceOcr: z.boolean()
}).strict();
const OcrSummaryPreferenceAuthoritativeResultSchema = OcrSummaryPreferenceResultIdentitySchema.extend({
  summary: OcrSummaryPreferenceSummarySchema
}).strict();
export const SetOcrSummaryPreferenceResultSchema = z.discriminatedUnion("status", [
  OcrSummaryPreferenceAuthoritativeResultSchema.extend({ status: z.literal("committed") }).strict(),
  OcrSummaryPreferenceAuthoritativeResultSchema.extend({ status: z.literal("stale") }).strict(),
  OcrSummaryPreferenceResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const OcrLanguagePreferenceRequestIdSchema = z.string()
  .regex(/^ocrlangreq_[a-z0-9]{16,64}$/u);
export const OcrLanguagePreferenceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("automatic") }).strict(),
  z.object({
    mode: z.literal("preferred"),
    language: LocaleSchema
  }).strict()
]);
export const OcrLanguagePreferenceMachineSettingsSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  preference: OcrLanguagePreferenceSchema
}).strict();
export const OcrLanguagePreferenceSummarySchema =
  OcrLanguagePreferenceMachineSettingsSchema.extend({
    apiVersion: z.literal(1),
    appliesTo: z.literal("new_ocr_jobs")
  }).strict();
export const OcrLanguagePreferenceRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: OcrLanguagePreferenceRequestIdSchema
}).strict();
const OcrLanguagePreferenceResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: OcrLanguagePreferenceRequestIdSchema
}).strict();
export const OcrLanguagePreferenceResultSchema = z.discriminatedUnion("status", [
  OcrLanguagePreferenceResultIdentitySchema.extend({
    status: z.literal("ready"),
    summary: OcrLanguagePreferenceSummarySchema
  }).strict(),
  OcrLanguagePreferenceResultIdentitySchema.extend({
    status: z.literal("failed")
  }).strict()
]);
export const SetOcrLanguagePreferenceRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: OcrLanguagePreferenceRequestIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  preference: OcrLanguagePreferenceSchema
}).strict();
const OcrLanguagePreferenceAuthoritativeResultSchema =
  OcrLanguagePreferenceResultIdentitySchema.extend({
    summary: OcrLanguagePreferenceSummarySchema
  }).strict();
export const SetOcrLanguagePreferenceResultSchema = z.discriminatedUnion("status", [
  OcrLanguagePreferenceAuthoritativeResultSchema.extend({
    status: z.literal("committed")
  }).strict(),
  OcrLanguagePreferenceAuthoritativeResultSchema.extend({
    status: z.literal("stale")
  }).strict(),
  OcrLanguagePreferenceResultIdentitySchema.extend({
    status: z.literal("failed")
  }).strict()
]);

export const DICTATION_LANGUAGE_PREFERENCE_CHANNEL =
  "localCapabilities.dictationLanguagePreference" as const;
export const SET_DICTATION_LANGUAGE_PREFERENCE_CHANNEL =
  "localCapabilities.setDictationLanguagePreference" as const;
export const DictationLanguagePreferenceRequestIdSchema = z.string()
  .regex(/^dictlangreq_[a-z0-9]{16,64}$/u);
export const DictationLanguagePreferenceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("automatic") }).strict(),
  z.object({
    mode: z.literal("preferred"),
    language: LocaleSchema
  }).strict()
]);
export const DictationLanguagePreferenceMachineSettingsSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  preference: DictationLanguagePreferenceSchema
}).strict();
export const DictationLanguagePreferenceSummarySchema =
  DictationLanguagePreferenceMachineSettingsSchema.extend({
    apiVersion: z.literal(1),
    appliesTo: z.literal("new_speech_sessions")
  }).strict();
export const DictationLanguagePreferenceRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: DictationLanguagePreferenceRequestIdSchema
}).strict();
const DictationLanguagePreferenceResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: DictationLanguagePreferenceRequestIdSchema
}).strict();
export const DictationLanguagePreferenceResultSchema = z.discriminatedUnion("status", [
  DictationLanguagePreferenceResultIdentitySchema.extend({
    status: z.literal("ready"),
    summary: DictationLanguagePreferenceSummarySchema
  }).strict(),
  DictationLanguagePreferenceResultIdentitySchema.extend({
    status: z.literal("failed")
  }).strict()
]);
export const SetDictationLanguagePreferenceRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: DictationLanguagePreferenceRequestIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  preference: DictationLanguagePreferenceSchema
}).strict();
const DictationLanguagePreferenceAuthoritativeResultSchema =
  DictationLanguagePreferenceResultIdentitySchema.extend({
    summary: DictationLanguagePreferenceSummarySchema
  }).strict();
export const SetDictationLanguagePreferenceResultSchema = z.discriminatedUnion("status", [
  DictationLanguagePreferenceAuthoritativeResultSchema.extend({
    status: z.literal("committed")
  }).strict(),
  DictationLanguagePreferenceAuthoritativeResultSchema.extend({
    status: z.literal("stale")
  }).strict(),
  DictationLanguagePreferenceResultIdentitySchema.extend({
    status: z.literal("failed")
  }).strict()
]);

export const MachineLocalSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  activeVaultPath: z.string().min(1).optional(),
  appLocale: LocaleSchema.optional(),
  appearance: AppearanceMachineSettingsSchema.optional(),
  startupDestination: StartupDestinationMachineSettingsSchema.optional(),
  window: WindowPreferencesSchema.optional(),
  updates: UpdateMachineSettingsSchema.optional(),
  ocrEnginePreference: OcrEnginePreferenceMachineSettingsSchema.optional(),
  ocrLanguagePreference: OcrLanguagePreferenceMachineSettingsSchema.optional(),
  dictationLanguagePreference: DictationLanguagePreferenceMachineSettingsSchema.optional(),
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

export const RecentVaultRevisionSchema = z.string()
  .regex(/^recentvaultrev_[a-f0-9]{64}$/u);
export const RecentVaultSummaryProjectionSchema = z.object({
  vaultId: VaultIdSchema,
  name: z.string().min(1),
  pathDisplay: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  lastOpenedAt: z.string().datetime({ offset: true }),
  revision: RecentVaultRevisionSchema
}).strict();

export const OpenRecentVaultRequestSchema = z.object({
  vaultId: VaultIdSchema
}).strict();

export const VAULT_FORGET_RECENT_CHANNEL = "vault.forgetRecent" as const;
export const VAULT_RECONNECT_RECENT_CHANNEL = "vault.reconnectRecent" as const;
export const RecentVaultForgetRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: z.string().regex(/^recentvaultforgetreq_[a-z0-9]{16,64}$/u),
  vaultId: VaultIdSchema,
  expectedRevision: RecentVaultRevisionSchema
}).strict();
export const RecentVaultForgetResultSchema = z.discriminatedUnion("status", [
  RecentVaultForgetRequestSchema.extend({ status: z.literal("forgotten") }).strict(),
  RecentVaultForgetRequestSchema.extend({
    status: z.literal("stale"), currentRevision: RecentVaultRevisionSchema
  }).strict(),
  RecentVaultForgetRequestSchema.extend({
    status: z.literal("active"), currentRevision: RecentVaultRevisionSchema
  }).strict(),
  RecentVaultForgetRequestSchema.extend({ status: z.literal("not_found") }).strict(),
  RecentVaultForgetRequestSchema.extend({ status: z.literal("failed") }).strict()
]);
export const RecentVaultReconnectRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: z.string().regex(/^recentvaultreconnectreq_[a-z0-9]{16,64}$/u),
  vaultId: VaultIdSchema,
  expectedRevision: RecentVaultRevisionSchema
}).strict();
export const RecentVaultReconnectResultSchema = z.discriminatedUnion("status", [
  RecentVaultReconnectRequestSchema.extend({
    status: z.literal("reconnected"), revision: RecentVaultRevisionSchema
  }).strict(),
  RecentVaultReconnectRequestSchema.extend({
    status: z.literal("cancelled"), currentRevision: RecentVaultRevisionSchema
  }).strict(),
  RecentVaultReconnectRequestSchema.extend({
    status: z.literal("stale"), currentRevision: RecentVaultRevisionSchema
  }).strict(),
  RecentVaultReconnectRequestSchema.extend({
    status: z.literal("active"), currentRevision: RecentVaultRevisionSchema
  }).strict(),
  RecentVaultReconnectRequestSchema.extend({ status: z.literal("not_found") }).strict(),
  RecentVaultReconnectRequestSchema.extend({ status: z.literal("mismatch") }).strict(),
  RecentVaultReconnectRequestSchema.extend({ status: z.literal("failed") }).strict()
]);

const VaultCountsProjectionSchema = z.object({
  notes: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
  managedSourceCopies: z.number().int().nonnegative(),
  referencedOriginals: z.number().int().nonnegative()
}).strict();

export const SourceStorageRevisionSchema = z.string()
  .regex(/^ssrev_[a-f0-9]{64}$/u);
export const ManagedCopyRootSummarySchema = z.object({
  activeVaultId: VaultIdSchema,
  sourceStorageRevision: SourceStorageRevisionSchema,
  mode: SourceAssetRootKindSchema,
  availability: z.enum(["available", "missing", "permission_needed"]),
  canConfigure: z.boolean()
}).strict().superRefine((summary, context) => {
  if (summary.mode === "inside_vault" && summary.availability !== "available") {
    context.addIssue({
      code: "custom",
      path: ["availability"],
      message: "The in-vault managed-copy root must be available."
    });
  }
});

const ExternalManagedCopyRootDisplayLabelSchema = z.string()
  .min(1)
  .max(160)
  .refine(
    (value) => !/[\\/\u0000-\u001f\u007f-\u009f]/u.test(value),
    "An external managed-copy root display value must be a safe label, not a path."
  )
  .refine(
    (value) => !/^[A-Za-z]:/u.test(value) && !/^file:/iu.test(value),
    "An external managed-copy root display value must not expose a path or URI."
  );

export const VaultSummaryProjectionSchema = z.object({
  vaultId: VaultIdSchema,
  name: VaultDisplayNameSchema,
  metadataRevision: VaultMetadataRevisionSchema.optional(),
  activeVaultPathDisplay: z.string().min(1),
  knowledgeRootDisplay: z.string().min(1),
  sourceAssetRootDisplay: z.string().min(1),
  sourceAssetRootKind: SourceAssetRootKindSchema,
  managedCopyRoot: ManagedCopyRootSummarySchema,
  defaultSourceStorageStrategy: SourceStorageStrategySchema,
  schemaVersion: z.number().int().positive(),
  counts: VaultCountsProjectionSchema.optional(),
  lastBackupAt: z.string().datetime({ offset: true }).optional()
}).strict().superRefine((summary, context) => {
  if (
    summary.managedCopyRoot.activeVaultId !== summary.vaultId ||
    summary.managedCopyRoot.mode !== summary.sourceAssetRootKind
  ) {
    context.addIssue({
      code: "custom",
      path: ["managedCopyRoot"],
      message: "Managed-copy root summary identity must match its Vault summary."
    });
  }
  if (
    summary.sourceAssetRootKind === "external_binding" &&
    !ExternalManagedCopyRootDisplayLabelSchema.safeParse(summary.sourceAssetRootDisplay).success
  ) {
    context.addIssue({
      code: "custom",
      path: ["sourceAssetRootDisplay"],
      message: "An external managed-copy root must project a safe label, never its path."
    });
  }
});

export const MANAGED_COPY_ROOT_CONFIGURE_CHANNEL = "vault.configureManagedCopyRoot" as const;
export const ManagedCopyRootConfigureRequestIdSchema = z.string()
  .regex(/^rootconfigreq_[a-z0-9]{8,64}$/u);
export const ManagedCopyRootConfigureRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: ManagedCopyRootConfigureRequestIdSchema,
  activeVaultId: VaultIdSchema,
  expectedSourceStorageRevision: SourceStorageRevisionSchema
}).strict();
const ManagedCopyRootConfigureResultIdentitySchema = ManagedCopyRootConfigureRequestSchema;
export const ManagedCopyRootConfigureResultSchema = z.discriminatedUnion("status", [
  ManagedCopyRootConfigureResultIdentitySchema.extend({
    status: z.literal("configured"),
    summary: ManagedCopyRootSummarySchema
  }).strict(),
  ManagedCopyRootConfigureResultIdentitySchema.extend({ status: z.literal("cancelled") }).strict(),
  ManagedCopyRootConfigureResultIdentitySchema.extend({
    status: z.literal("stale"),
    summary: ManagedCopyRootSummarySchema
  }).strict(),
  ManagedCopyRootConfigureResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  ManagedCopyRootConfigureResultIdentitySchema.extend({
    status: z.literal("ineligible"),
    summary: ManagedCopyRootSummarySchema
  }).strict(),
  ManagedCopyRootConfigureResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const VAULT_STORAGE_RELOCATION_STATUS_CHANNEL = "vault.storageRelocationStatus" as const;
export const VAULT_STORAGE_RELOCATE_CHANNEL = "vault.relocateStorage" as const;
export const VaultStorageRelocationRevisionSchema = z.string()
  .regex(/^vaultrelocationrev_[a-f0-9]{64}$/u);
export const VaultStorageRelocationRequestIdSchema = z.string()
  .regex(/^vaultrelocatereq_[a-z0-9]{16,64}$/u);
export const VaultStorageRelocationStatusSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("ready"),
    activeVaultId: VaultIdSchema,
    revision: VaultStorageRelocationRevisionSchema
  }).strict(),
  z.object({ apiVersion: z.literal(1), status: z.literal("unavailable") }).strict()
]);
export const VaultStorageRelocationRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: VaultStorageRelocationRequestIdSchema,
  activeVaultId: VaultIdSchema,
  expectedRevision: VaultStorageRelocationRevisionSchema
}).strict();
const VaultStorageRelocationResultIdentitySchema = VaultStorageRelocationRequestSchema;
export const VaultStorageRelocationResultSchema = z.discriminatedUnion("status", [
  VaultStorageRelocationResultIdentitySchema.extend({
    status: z.literal("relocated"),
    revision: VaultStorageRelocationRevisionSchema
  }).strict(),
  VaultStorageRelocationResultIdentitySchema.extend({
    status: z.enum(["cancelled", "stale", "blocked_active_work", "destination_exists"]),
    currentRevision: VaultStorageRelocationRevisionSchema
  }).strict(),
  VaultStorageRelocationResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

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

export const VaultMigrationRequestIdSchema = z.string()
  .regex(/^vaultmigrationreq_[a-z0-9]{16,64}$/u);
export const VaultMigrationPreviewIdSchema = z.string()
  .regex(/^vaultmigration_[a-z0-9]{32,96}$/u);
export const VaultMigrationClassSchema = z.literal("transform");
export const VaultMigrationAffectedDomainSchema = z.enum([
  "vault_manifest",
  "source_records",
  "markdown_pages",
  "ocr_artifacts",
  "conversation_events",
  "memory",
  "rebuildable_chunks"
]);
export const VaultMigrationWarningSchema = z.enum([
  "pre_migration_backup_required",
  "unknown_language_preserved",
  "rebuildable_indexes_after_commit"
]);
const VaultMigrationAffectedDomainCountSchema = z.object({
  domain: VaultMigrationAffectedDomainSchema,
  count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const VaultMigrationPreviewSchema = z.object({
  apiVersion: z.literal(1),
  previewId: VaultMigrationPreviewIdSchema,
  vaultId: VaultIdSchema,
  fromVersion: z.literal(1),
  toVersion: z.literal(2),
  migrationClass: VaultMigrationClassSchema,
  requiresBackup: z.literal(true),
  languagePolicy: z.literal("preserve_or_unknown"),
  affectedDomains: z.array(VaultMigrationAffectedDomainCountSchema).length(7),
  warnings: z.array(VaultMigrationWarningSchema).min(1).max(3)
}).strict().superRefine((preview, context) => {
  const expected = VaultMigrationAffectedDomainSchema.options;
  const actual = preview.affectedDomains.map(({ domain }) => domain);
  if (actual.length !== new Set(actual).size || actual.some((domain, index) => domain !== expected[index])) {
    context.addIssue({
      code: "custom",
      path: ["affectedDomains"],
      message: "Migration domain counts must contain every domain once in canonical order."
    });
  }
});
export const VaultOpenInvalidReasonSchema = z.enum([
  "manifest_unreadable",
  "manifest_malformed",
  "identity_invalid",
  "domain_versions_invalid"
]);
export const VaultMigrationCheckpointSchema = z.enum([
  "compatibility_revalidated",
  "pre_backup_completed",
  "durable_domains_staged",
  "staged_validation_completed",
  "durable_domains_committed",
  "manifest_committed",
  "operation_recorded",
  "indexes_rebuilt"
]);
export const VaultActionResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    compatibility: z.literal("current").default("current"),
    vault: VaultSummaryProjectionSchema,
    onboarding: OnboardingStatusProjectionSchema
  }).strict(),
  z.object({ status: z.literal("canceled") }).strict(),
  z.object({
    status: z.literal("needs_migration"),
    preview: VaultMigrationPreviewSchema
  }).strict(),
  z.object({
    status: z.literal("unsupported_newer"),
    vaultId: VaultIdSchema,
    foundVersion: z.number().int().min(3).max(Number.MAX_SAFE_INTEGER),
    supportedVersion: z.literal(2)
  }).strict(),
  z.object({
    status: z.literal("invalid"),
    reason: VaultOpenInvalidReasonSchema
  }).strict()
]);
export const VaultMigrationApplyRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: VaultMigrationRequestIdSchema,
  vaultId: VaultIdSchema,
  previewId: VaultMigrationPreviewIdSchema
}).strict();
const VaultMigrationApplyIdentitySchema = VaultMigrationApplyRequestSchema;
export const VaultMigrationApplyResultSchema = z.discriminatedUnion("status", [
  VaultMigrationApplyIdentitySchema.extend({
    status: z.literal("completed"),
    jobId: JobIdSchema,
    operationId: OperationIdSchema,
    vault: VaultSummaryProjectionSchema,
    onboarding: OnboardingStatusProjectionSchema
  }).strict(),
  VaultMigrationApplyIdentitySchema.extend({
    status: z.literal("stale"),
    current: z.enum(["needs_migration", "current", "unsupported_newer", "invalid"])
  }).strict(),
  VaultMigrationApplyIdentitySchema.extend({
    status: z.literal("failed"),
    jobId: JobIdSchema.optional(),
    repair: z.enum(["retry", "restore_pre_migration_backup", "open_read_only"])
  }).strict()
]);

export const BackupReconnectDependencyRequestIdSchema = z.string()
  .regex(/^backupreconnectreq_[a-z0-9]{8,64}$/);
export const BackupReconnectDependencyRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: BackupReconnectDependencyRequestIdSchema,
  activeVaultId: VaultIdSchema,
  waitingJobId: JobIdSchema
}).strict();
export const BackupReconnectDependencyResultSchema = z.object({
  apiVersion: z.literal(1),
  requestId: BackupReconnectDependencyRequestIdSchema,
  activeVaultId: VaultIdSchema,
  waitingJobId: JobIdSchema,
  status: z.enum(["resolved", "cancelled", "stale", "not_found", "failed"])
}).strict();

export const BACKUP_RECONNECT_DESTINATION_CHANNEL = "backup.reconnectDestination" as const;
export const BackupReconnectDestinationRequestIdSchema = z.string()
  .regex(/^backupdestinationreconnectreq_[a-z0-9]{8,64}$/);
export const BackupReconnectDestinationRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: BackupReconnectDestinationRequestIdSchema,
  activeVaultId: VaultIdSchema,
  waitingJobId: JobIdSchema,
  expectedJobUpdatedAt: z.string().datetime({ offset: true })
}).strict();
export const BackupReconnectDestinationResultSchema = BackupReconnectDestinationRequestSchema.extend({
  status: z.enum(["reconnected", "cancelled", "stale", "not_found", "ineligible", "failed"])
}).strict();

export const BACKUP_CONTINUE_INCOMPLETE_CHANNEL = "backup.continueIncomplete" as const;
export const BackupContinueIncompleteRequestIdSchema = z.string()
  .regex(/^backupcontinuereq_[a-z0-9]{8,64}$/);
export const BackupContinueIncompleteRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: BackupContinueIncompleteRequestIdSchema,
  activeVaultId: VaultIdSchema,
  waitingJobId: JobIdSchema,
  expectedJobUpdatedAt: z.string().datetime({ offset: true })
}).strict();
export const BackupContinueIncompleteResultSchema = BackupContinueIncompleteRequestSchema.extend({
  status: z.enum(["continued", "cancelled", "stale", "not_found", "ineligible", "failed"])
}).strict();

export const BACKUP_MEMORY_PREFERENCE_STATUS_CHANNEL = "backup.memoryPreferenceStatus" as const;
export const BACKUP_SET_MEMORY_PREFERENCE_CHANNEL = "backup.setMemoryPreference" as const;
export const BackupMemoryPreferenceRevisionSchema = z.string()
  .regex(/^backupmemoryrev_[a-f0-9]{64}$/u);
export const BackupMemoryPreferenceSummarySchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  revision: BackupMemoryPreferenceRevisionSchema,
  includeVaultMemory: z.boolean(),
  canUpdate: z.boolean()
}).strict();
export const BackupMemoryPreferenceRequestIdSchema = z.string()
  .regex(/^backupmemoryreq_[a-z0-9]{16,64}$/u);
export const BackupMemoryPreferenceUpdateRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: BackupMemoryPreferenceRequestIdSchema,
  activeVaultId: VaultIdSchema,
  expectedRevision: BackupMemoryPreferenceRevisionSchema,
  includeVaultMemory: z.boolean()
}).strict();
export const BackupMemoryPreferenceUpdateResultSchema = z.discriminatedUnion("status", [
  BackupMemoryPreferenceUpdateRequestSchema.pick({
    apiVersion: true,
    requestId: true,
    activeVaultId: true
  }).extend({
    status: z.literal("updated"),
    summary: BackupMemoryPreferenceSummarySchema
  }).strict(),
  BackupMemoryPreferenceUpdateRequestSchema.pick({
    apiVersion: true,
    requestId: true,
    activeVaultId: true
  }).extend({
    status: z.enum(["stale", "blocked"]),
    summary: BackupMemoryPreferenceSummarySchema
  }).strict()
]);

export const BACKUP_CONVERSATION_PREFERENCE_STATUS_CHANNEL = "backup.conversationPreferenceStatus" as const;
export const BACKUP_SET_CONVERSATION_PREFERENCE_CHANNEL = "backup.setConversationPreference" as const;
export const BackupConversationPreferenceRevisionSchema = z.string()
  .regex(/^backupconversationrev_[a-f0-9]{64}$/u);
export const BackupConversationPreferenceSummarySchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  revision: BackupConversationPreferenceRevisionSchema,
  includeConversations: z.boolean(),
  canUpdate: z.boolean()
}).strict();
export const BackupConversationPreferenceRequestIdSchema = z.string()
  .regex(/^backupconversationreq_[a-z0-9]{16,64}$/u);
export const BackupConversationPreferenceUpdateRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: BackupConversationPreferenceRequestIdSchema,
  activeVaultId: VaultIdSchema,
  expectedRevision: BackupConversationPreferenceRevisionSchema,
  includeConversations: z.boolean()
}).strict();
export const BackupConversationPreferenceUpdateResultSchema = z.discriminatedUnion("status", [
  BackupConversationPreferenceUpdateRequestSchema.pick({ apiVersion: true, requestId: true, activeVaultId: true })
    .extend({ status: z.literal("updated"), summary: BackupConversationPreferenceSummarySchema }).strict(),
  BackupConversationPreferenceUpdateRequestSchema.pick({ apiVersion: true, requestId: true, activeVaultId: true })
    .extend({ status: z.enum(["stale", "blocked"]), summary: BackupConversationPreferenceSummarySchema }).strict()
]);

export const PIGE_POLICY_STATUS_CHANNEL = "settings.pigePolicy" as const;
export const PIGE_POLICY_UPDATE_CHANNEL = "settings.updatePigePolicy" as const;
export const PigePolicyRevisionSchema = z.string().regex(/^pigepolicyrev_[a-f0-9]{64}$/u);
export const PigePolicyMarkdownSchema = z.string().min(1).max(65_536);
export const PigePolicyValidationIssueSchema = z.enum([
  "invalid_heading_structure",
  "missing_required_section",
  "duplicate_required_section",
  "secret_like_content"
]);
export const PigePolicySummarySchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  revision: PigePolicyRevisionSchema,
  markdown: PigePolicyMarkdownSchema,
  requiredSections: z.array(z.string().min(1).max(64)).length(8),
  canEdit: z.literal(true)
}).strict();
export const PigePolicyUpdateRequestIdSchema = z.string().regex(/^pigepolicyreq_[a-z0-9]{16,64}$/u);
export const PigePolicyUpdateRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: PigePolicyUpdateRequestIdSchema,
  activeVaultId: VaultIdSchema,
  expectedRevision: PigePolicyRevisionSchema,
  markdown: PigePolicyMarkdownSchema
}).strict();
const PigePolicyUpdateIdentitySchema = PigePolicyUpdateRequestSchema.pick({
  apiVersion: true,
  requestId: true,
  activeVaultId: true
});
export const PigePolicyUpdateResultSchema = z.discriminatedUnion("status", [
  PigePolicyUpdateIdentitySchema.extend({
    status: z.literal("updated"),
    summary: PigePolicySummarySchema,
    operationId: OperationIdSchema.optional()
  }).strict(),
  PigePolicyUpdateIdentitySchema.extend({
    status: z.enum(["stale", "denied"]),
    summary: PigePolicySummarySchema
  }).strict(),
  PigePolicyUpdateIdentitySchema.extend({
    status: z.literal("invalid"),
    summary: PigePolicySummarySchema,
    issues: z.array(PigePolicyValidationIssueSchema).min(1).max(16)
  }).strict(),
  PigePolicyUpdateIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const BACKUP_TRASH_PREFERENCE_STATUS_CHANNEL = "backup.trashPreferenceStatus" as const;
export const BACKUP_SET_TRASH_PREFERENCE_CHANNEL = "backup.setTrashPreference" as const;
export const BackupTrashPreferenceRevisionSchema = z.string()
  .regex(/^backuptrashrev_[a-f0-9]{64}$/u);
export const BackupTrashPreferenceSummarySchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  revision: BackupTrashPreferenceRevisionSchema,
  includeTrash: z.boolean(),
  canUpdate: z.boolean()
}).strict();
export const BackupTrashPreferenceRequestIdSchema = z.string()
  .regex(/^backuptrashreq_[a-z0-9]{16,64}$/u);
export const BackupTrashPreferenceUpdateRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: BackupTrashPreferenceRequestIdSchema,
  activeVaultId: VaultIdSchema,
  expectedRevision: BackupTrashPreferenceRevisionSchema,
  includeTrash: z.boolean()
}).strict();
export const BackupTrashPreferenceUpdateResultSchema = z.discriminatedUnion("status", [
  BackupTrashPreferenceUpdateRequestSchema.pick({ apiVersion: true, requestId: true, activeVaultId: true })
    .extend({ status: z.literal("updated"), summary: BackupTrashPreferenceSummarySchema }).strict(),
  BackupTrashPreferenceUpdateRequestSchema.pick({ apiVersion: true, requestId: true, activeVaultId: true })
    .extend({ status: z.enum(["stale", "blocked"]), summary: BackupTrashPreferenceSummarySchema }).strict()
]);

export const RESTORE_CANCEL_CHANNEL = "restore.cancel" as const;
export const RestoreCancelRequestIdSchema = z.string()
  .regex(/^restorecancelreq_[a-z0-9]{8,64}$/);
export const RestoreCancelRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: RestoreCancelRequestIdSchema,
  previewId: z.string().min(1).max(256),
  mode: z.enum(["clone_as_new", "replace_existing"])
}).strict();
export const RestoreCancelResultSchema = RestoreCancelRequestSchema.extend({
  status: z.enum(["cancel_requested", "cancelled", "too_late", "stale", "not_found", "failed"])
}).strict();

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

export const TOOLCHAIN_REPAIR_CHANNEL = "system.repairToolchain" as const;
export const TOOLCHAIN_REPAIR_MAX_MISSING_TOOLS = 32;
export const ToolchainToolIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
export const ToolchainRepairRequestIdSchema = z.string().regex(
  /^toolchain_repair_request_[a-z0-9]{16,64}$/
);
export const ToolchainHealthIdSchema = z.string().regex(/^toolchain_health_[a-f0-9]{64}$/);
export const ToolchainMissingRequiredToolIdsSchema = z.array(ToolchainToolIdSchema)
  .min(1)
  .max(TOOLCHAIN_REPAIR_MAX_MISSING_TOOLS)
  .readonly()
  .superRefine((toolIds, context) => {
    for (let index = 1; index < toolIds.length; index += 1) {
      if (toolIds[index - 1]! >= toolIds[index]!) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Required missing tool IDs must be unique and sorted in ascending order."
        });
      }
    }
  });

export const ToolchainRepairEligibilitySchema = z.object({
  healthId: ToolchainHealthIdSchema,
  missingRequiredToolIds: ToolchainMissingRequiredToolIdsSchema
}).strict();

const ToolchainRepairIdentityShape = {
  apiVersion: z.literal(1),
  requestId: ToolchainRepairRequestIdSchema,
  expectedHealthId: ToolchainHealthIdSchema,
  expectedMissingRequiredToolIds: ToolchainMissingRequiredToolIdsSchema
} as const;

export const ToolchainRepairRequestSchema = z.object(ToolchainRepairIdentityShape).strict();

export const ToolchainRepairResultSchema = z.object({
  ...ToolchainRepairIdentityShape,
  status: z.enum(["opened", "stale", "not_needed", "failed"])
}).strict();

export const SourceSemanticOrchestrationSchema = z.enum([
  "legacy_agent_ingest",
  "agent_turn"
]);

const CurrentSourceSemanticOrchestrationSchema = z.literal("agent_turn");

const SourceRecordObjectSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: SourceIdSchema,
  language: SourceRecordLanguageFactSchema.default({
    domain: "source_record",
    language: "unknown",
    basis: "legacy_missing"
  }),
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

export const DATASET_PIGE_FORMULA_MAX_DEPTH = 8;
export const DATASET_PIGE_FORMULA_MAX_NODES = 31;
export const DatasetPigeFormulaOperatorSchema = z.enum([
  "add",
  "subtract",
  "multiply",
  "divide"
]);

type DatasetPigeFormulaExpressionNode =
  | { kind: "column"; columnId: string }
  | { kind: "literal"; value: number }
  | {
      kind: "binary";
      operator: "add" | "subtract" | "multiply" | "divide";
      left: DatasetPigeFormulaExpressionNode;
      right: DatasetPigeFormulaExpressionNode;
    };

const DatasetPigeFormulaColumnExpressionSchema = z.object({
  kind: z.literal("column"),
  columnId: ColumnIdSchema
}).strict();

const DatasetPigeFormulaLiteralExpressionSchema = z.object({
  kind: z.literal("literal"),
  value: z.number().finite()
}).strict();

function datasetPigeFormulaExpressionSchema(
  remainingDepth: number
): z.ZodType<DatasetPigeFormulaExpressionNode> {
  if (remainingDepth <= 1) {
    return z.discriminatedUnion("kind", [
      DatasetPigeFormulaColumnExpressionSchema,
      DatasetPigeFormulaLiteralExpressionSchema
    ]);
  }
  const child = datasetPigeFormulaExpressionSchema(remainingDepth - 1);
  return z.discriminatedUnion("kind", [
    DatasetPigeFormulaColumnExpressionSchema,
    DatasetPigeFormulaLiteralExpressionSchema,
    z.object({
      kind: z.literal("binary"),
      operator: DatasetPigeFormulaOperatorSchema,
      left: child,
      right: child
    }).strict()
  ]);
}

export const DatasetPigeFormulaExpressionSchema = datasetPigeFormulaExpressionSchema(
  DATASET_PIGE_FORMULA_MAX_DEPTH
).superRefine((expression, context) => {
  let nodeCount = 0;
  const pending = [expression];
  while (pending.length > 0) {
    const node = pending.pop()!;
    nodeCount += 1;
    if (nodeCount > DATASET_PIGE_FORMULA_MAX_NODES) {
      context.addIssue({
        code: "custom",
        message: `Pige Dataset formulas must not exceed ${DATASET_PIGE_FORMULA_MAX_NODES} nodes.`
      });
      return;
    }
    if (node.kind === "binary") pending.push(node.left, node.right);
  }
});

/**
 * Pige numeric formula v1 evaluates finite IEEE-754 numbers deterministically.
 * Missing/null/empty operands, division by zero, and non-finite intermediates or
 * results produce null; negative zero is persisted as positive zero.
 */
export const DatasetPigeCalculationSchema = z.object({
  kind: z.literal("pige_numeric_formula"),
  schemaVersion: z.literal(1),
  expression: DatasetPigeFormulaExpressionSchema
}).strict();

/**
 * Pige relation v1 stores exactly one stable target row ID per source cell. The
 * target table and display column are schema truth; paths, queries, and display
 * text are never durable relation authority.
 */
export const DatasetPigeRelationSchema = z.object({
  kind: z.literal("pige_single_relation"),
  schemaVersion: z.literal(1),
  targetTableId: TableIdSchema,
  targetDisplayColumnId: ColumnIdSchema
}).strict();

/**
 * Pige lookup v1 follows exactly one same-table single-value relation and
 * projects one scalar field from that relation's target table. Values remain
 * derived; the descriptor, stable IDs and immutable Dataset revision are truth.
 */
export const DatasetPigeLookupSchema = z.object({
  kind: z.literal("pige_single_lookup"),
  schemaVersion: z.literal(1),
  relationColumnId: ColumnIdSchema,
  targetColumnId: ColumnIdSchema
}).strict();

/**
 * Pige rollup v1 follows one source-table single-value relation. Count returns
 * 0/1 for a missing/current target; sum projects one nullable numeric target.
 * Values are derived from the immutable revision and never durable authority.
 */
export const DatasetPigeRollupSchema = z.object({
  kind: z.literal("pige_single_rollup"),
  schemaVersion: z.literal(1),
  relationColumnId: ColumnIdSchema,
  aggregation: z.enum(["count", "sum"]),
  targetColumnId: ColumnIdSchema.optional()
}).strict().superRefine((rollup, context) => {
  if ((rollup.aggregation === "sum") !== (rollup.targetColumnId !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["targetColumnId"],
      message: "A sum rollup requires one numeric target while count accepts none."
    });
  }
});

/** Canonical SQLite projection_json encoding; clear is represented by JSON null. */
export const DatasetPigeRelationCellSchema = z.object({
  kind: z.literal("pige_relation_target"),
  schemaVersion: z.literal(1),
  targetRowId: RowIdSchema
}).strict().nullable();

function datasetPigeFormulaColumnRefs(expression: DatasetPigeFormulaExpressionNode): string[] {
  const refs: string[] = [];
  const pending = [expression];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.kind === "column") refs.push(node.columnId);
    if (node.kind === "binary") pending.push(node.left, node.right);
  }
  return refs;
}

function datasetColumnContainsImportedFormula(column: {
  sourceType: string;
  sourceTypes?: string[] | undefined;
}): boolean {
  return [column.sourceType, ...(column.sourceTypes ?? [])]
    .some((sourceType) => sourceType.toLocaleLowerCase("en-US").includes("formula"));
}

function datasetColumnIsPigeFormulaOperand(column: z.infer<typeof DatasetColumnSchema>): boolean {
  return column.relation === undefined &&
    (column.logicalType === "integer" || column.logicalType === "number") &&
    (column.lookup !== undefined || column.rollup !== undefined ||
      column.calculation?.kind === "pige_numeric_formula" ||
      (column.calculation === undefined && !datasetColumnContainsImportedFormula(column)));
}

function datasetPigeFormulaGraphIsAcyclic(columns: readonly z.infer<typeof DatasetColumnSchema>[]): boolean {
  const formulas = new Map(columns
    .filter((column) => column.calculation?.kind === "pige_numeric_formula")
    .map((column) => [column.id, column]));
  const indegree = new Map([...formulas].map(([id]) => [id, 0]));
  const downstream = new Map([...formulas].map(([id]) => [id, new Set<string>()]));
  for (const [id, column] of formulas) {
    for (const operandId of datasetPigeFormulaColumnRefs(column.calculation!.expression)) {
      if (!formulas.has(operandId)) continue;
      indegree.set(id, indegree.get(id)! + 1);
      downstream.get(operandId)!.add(id);
    }
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort();
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift()!;
    visited += 1;
    for (const dependentId of [...downstream.get(id)!].sort()) {
      const next = indegree.get(dependentId)! - 1;
      indegree.set(dependentId, next);
      if (next === 0) {
        ready.push(dependentId);
        ready.sort();
      }
    }
  }
  return visited === formulas.size;
}

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
  calculation: DatasetPigeCalculationSchema.optional(),
  relation: DatasetPigeRelationSchema.optional(),
  lookup: DatasetPigeLookupSchema.optional(),
  rollup: DatasetPigeRollupSchema.optional(),
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
  const columnsById = new Map(table.columns.map((column) => [column.id, column]));
  for (const [index, column] of table.columns.entries()) {
    if ([column.calculation, column.relation, column.lookup, column.rollup].filter((value) => value !== undefined).length > 1) {
      context.addIssue({
        code: "custom",
        path: ["columns", index],
        message: "Dataset columns cannot combine formula, relation, lookup, and rollup descriptors."
      });
    }
    if (column.relation !== undefined &&
        (column.logicalType !== "string" || !column.nullable ||
         column.sourceType !== "pige.relation.single")) {
      context.addIssue({
        code: "custom",
        path: ["columns", index, "relation"],
        message: "Pige relation columns must be nullable string-backed Pige columns."
      });
    }
    if (column.lookup !== undefined &&
        (!column.nullable || column.sourceType !== "pige.lookup.single" ||
         !["string", "integer", "number", "boolean", "date", "datetime"].includes(column.logicalType))) {
      context.addIssue({
        code: "custom",
        path: ["columns", index, "lookup"],
        message: "Pige lookup columns must be nullable scalar Pige columns."
      });
    }
    if (column.rollup !== undefined &&
        (column.logicalType !== "number" || !column.nullable || column.sourceType !== "pige.rollup.single")) {
      context.addIssue({
        code: "custom",
        path: ["columns", index, "rollup"],
        message: "Pige rollup columns must be nullable numeric Pige columns."
      });
    }
    if (!column.calculation) continue;
    if (column.logicalType !== "number" || !column.nullable) {
      context.addIssue({
        code: "custom",
        path: ["columns", index, "calculation"],
        message: "Pige Dataset formula columns must be nullable numbers."
      });
    }
    for (const columnId of datasetPigeFormulaColumnRefs(column.calculation.expression)) {
      const operand = columnsById.get(columnId);
      if (
        !operand ||
        !datasetColumnIsPigeFormulaOperand(operand)
      ) {
        context.addIssue({
          code: "custom",
          path: ["columns", index, "calculation", "expression"],
          message: "Pige Dataset formulas may reference only same-table numeric scalar or acyclic Pige formula columns, including numeric derived lookup/rollup columns."
        });
        break;
      }
    }
  }
  if (!datasetPigeFormulaGraphIsAcyclic(table.columns)) {
    context.addIssue({
      code: "custom",
      path: ["columns"],
      message: "Pige Dataset formula dependencies must form an acyclic graph."
    });
  }
});

export const DatasetSchemaRecordSchema = z.object({
  schemaVersion: z.literal(1),
  datasetId: DatasetIdSchema,
  revisionId: DatasetRevisionIdSchema,
  tables: z.array(DatasetTableSchema).min(1).max(1024),
  createdAt: z.string().datetime({ offset: true })
}).passthrough().superRefine((schema, context) => {
  const tablesById = new Map(schema.tables.map((table) => [table.id, table]));
  const scalarDisplayTypes = new Set(["string", "integer", "number", "boolean", "date", "datetime"]);
  for (const [tableIndex, table] of schema.tables.entries()) {
    for (const [columnIndex, column] of table.columns.entries()) {
      if (column.relation !== undefined) {
        const targetTable = tablesById.get(column.relation.targetTableId);
        const targetColumn = targetTable?.columns.find(
          (candidate) => candidate.id === column.relation?.targetDisplayColumnId
        );
        if (
          targetTable === undefined || targetColumn === undefined ||
          targetColumn.calculation !== undefined || targetColumn.relation !== undefined ||
          targetColumn.lookup !== undefined || targetColumn.rollup !== undefined || datasetColumnContainsImportedFormula(targetColumn) ||
          !scalarDisplayTypes.has(targetColumn.logicalType)
        ) {
          context.addIssue({
            code: "custom",
            path: ["tables", tableIndex, "columns", columnIndex, "relation"],
            message: "Pige relations require one current same-Dataset scalar display column."
          });
        }
      }
      if (column.lookup !== undefined) {
        const relationColumn = table.columns.find((candidate) => candidate.id === column.lookup?.relationColumnId);
        const targetTable = relationColumn?.relation
          ? tablesById.get(relationColumn.relation.targetTableId)
          : undefined;
        const targetColumn = targetTable?.columns.find((candidate) => candidate.id === column.lookup?.targetColumnId);
        if (!relationColumn?.relation || !targetTable || !targetColumn ||
            targetColumn.calculation !== undefined || targetColumn.relation !== undefined ||
            targetColumn.lookup !== undefined || targetColumn.rollup !== undefined || datasetColumnContainsImportedFormula(targetColumn) ||
            !scalarDisplayTypes.has(targetColumn.logicalType) || column.logicalType !== targetColumn.logicalType) {
          context.addIssue({
            code: "custom",
            path: ["tables", tableIndex, "columns", columnIndex, "lookup"],
            message: "Pige lookups require one same-table single relation and one scalar field from its target table."
          });
        }
      }
      if (column.rollup !== undefined) {
        const relationColumn = table.columns.find((candidate) => candidate.id === column.rollup?.relationColumnId);
        const targetTable = relationColumn?.relation
          ? tablesById.get(relationColumn.relation.targetTableId)
          : undefined;
        const targetColumn = column.rollup.targetColumnId === undefined
          ? undefined
          : targetTable?.columns.find((candidate) => candidate.id === column.rollup?.targetColumnId);
        const invalidSumTarget = column.rollup.aggregation === "sum" &&
          (!targetColumn || targetColumn.calculation !== undefined || targetColumn.relation !== undefined ||
           targetColumn.lookup !== undefined || targetColumn.rollup !== undefined ||
           datasetColumnContainsImportedFormula(targetColumn) ||
           (targetColumn.logicalType !== "integer" && targetColumn.logicalType !== "number"));
        if (!relationColumn?.relation || !targetTable || invalidSumTarget) {
          context.addIssue({
            code: "custom",
            path: ["tables", tableIndex, "columns", columnIndex, "rollup"],
            message: "Pige rollups require one source-table single relation and an eligible numeric target for sum."
          });
        }
      }
    }
  }
});

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
  change: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("initial_import") }).strict(),
    z.object({
      kind: z.literal("collection_cell_edit"),
      tableId: TableIdSchema,
      rowId: RowIdSchema,
      columnId: ColumnIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_cell_undo"),
      tableId: TableIdSchema,
      rowId: RowIdSchema,
      columnId: ColumnIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_row_add"),
      tableId: TableIdSchema,
      rowId: RowIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_row_add_undo"),
      tableId: TableIdSchema,
      rowId: RowIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_column_add"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_column_add_undo"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_formula_update"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_formula_update_undo"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_relation_add"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      targetTableId: TableIdSchema,
      targetDisplayColumnId: ColumnIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_relation_add_undo"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      targetTableId: TableIdSchema,
      targetDisplayColumnId: ColumnIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_relation_update"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      targetTableId: TableIdSchema,
      targetDisplayColumnId: ColumnIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_relation_update_undo"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      targetTableId: TableIdSchema,
      targetDisplayColumnId: ColumnIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_relation_cell_edit"),
      tableId: TableIdSchema,
      rowId: RowIdSchema,
      columnId: ColumnIdSchema,
      targetTableId: TableIdSchema,
      targetRowId: RowIdSchema.nullable()
    }).strict(),
    z.object({
      kind: z.literal("collection_relation_cell_edit_undo"),
      tableId: TableIdSchema,
      rowId: RowIdSchema,
      columnId: ColumnIdSchema,
      targetTableId: TableIdSchema,
      targetRowId: RowIdSchema.nullable(),
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_lookup_add"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      relationColumnId: ColumnIdSchema,
      targetColumnId: ColumnIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_lookup_add_undo"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      relationColumnId: ColumnIdSchema,
      targetColumnId: ColumnIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_lookup_update"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      relationColumnId: ColumnIdSchema,
      targetColumnId: ColumnIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_lookup_update_undo"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      relationColumnId: ColumnIdSchema,
      targetColumnId: ColumnIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_rollup_add"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      relationColumnId: ColumnIdSchema,
      aggregation: z.enum(["count", "sum"]),
      targetColumnId: ColumnIdSchema.optional()
    }).strict(),
    z.object({
      kind: z.literal("collection_rollup_add_undo"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      relationColumnId: ColumnIdSchema,
      aggregation: z.enum(["count", "sum"]),
      targetColumnId: ColumnIdSchema.optional(),
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_rollup_update"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      relationColumnId: ColumnIdSchema,
      aggregation: z.enum(["count", "sum"]),
      targetColumnId: ColumnIdSchema.optional()
    }).strict(),
    z.object({
      kind: z.literal("collection_rollup_update_undo"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      relationColumnId: ColumnIdSchema,
      aggregation: z.enum(["count", "sum"]),
      targetColumnId: ColumnIdSchema.optional(),
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_column_rename"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_column_rename_undo"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_column_trash"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_column_trash_undo"),
      tableId: TableIdSchema,
      columnId: ColumnIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_row_trash"),
      tableId: TableIdSchema,
      rowId: RowIdSchema
    }).strict(),
    z.object({
      kind: z.literal("collection_row_trash_undo"),
      tableId: TableIdSchema,
      rowId: RowIdSchema,
      undoOfOperationId: OperationIdSchema
    }).strict()
  ]).optional(),
  createdAt: z.string().datetime({ offset: true })
}).passthrough().superRefine((revision, context) => {
  if (
    revision.change?.kind !== undefined &&
    revision.change.kind !== "initial_import" &&
    revision.payload.path !== `data/revisions/${revision.id}.sqlite`
  ) {
    context.addIssue({
      code: "custom",
      path: ["payload", "path"],
      message: "Collection mutations require a unique revision-bound SQLite payload."
    });
  }
});

export const DatasetManifestSchema = z.object({
  format: z.literal("pige-dataset"),
  formatVersion: z.literal(1),
  datasetId: DatasetIdSchema,
  profile: z.literal("managed_collection"),
  title: z.string().min(1).max(240),
  sourceId: SourceIdSchema,
  initialRevision: DatasetRevisionIdSchema.optional(),
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

export const LIBRARY_TAGS_CHANNEL = "library.tags" as const;
export const LIBRARY_BROWSE_CHANNEL = "library.browse" as const;
export const LIBRARY_RENAME_TAG_CHANNEL = "library.renameTag" as const;
export const LIBRARY_MERGE_TAG_CHANNEL = "library.mergeTag" as const;
export const LIBRARY_REMOVE_TAG_CHANNEL = "library.removeTag" as const;
export const LIBRARY_REMOVE_PAGE_TAG_CHANNEL = "library.removePageTag" as const;
export const LIBRARY_RENAME_TOPIC_CHANNEL = "library.renameTopic" as const;
export const LIBRARY_TAGS_PAGE_SIZE_MAX = 50;
export const LIBRARY_BROWSE_PAGE_SIZE_MAX = 50;
export const LibraryBrowseRequestIdSchema = z.string().regex(
  /^library_browse_request_[a-z0-9]{16,64}$/
);
export const LibraryBrowseSnapshotIdSchema = z.string().regex(
  /^library_browse_snapshot_[a-f0-9]{64}$/
);
export const LibraryBrowseCursorSchema = z.string().regex(
  /^library_browse_cursor_[a-f0-9]{64}$/
);
export const LibraryBrowseRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: LibraryBrowseRequestIdSchema,
  activeVaultId: VaultIdSchema,
  limit: z.number().int().min(1).max(LIBRARY_BROWSE_PAGE_SIZE_MAX),
  snapshotId: LibraryBrowseSnapshotIdSchema.optional(),
  cursor: LibraryBrowseCursorSchema.optional()
}).strict().superRefine((request, context) => {
  if ((request.snapshotId === undefined) !== (request.cursor === undefined)) {
    context.addIssue({
      code: "custom",
      path: [request.snapshotId === undefined ? "snapshotId" : "cursor"],
      message: "Library continuation requires both its snapshot and cursor."
    });
  }
});
const LibraryRelativePagePathSchema = z.string().min(1).max(1_024).refine((value) => {
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  const segments = value.split("/");
  return (segments[0] === "wiki" || segments[0] === "sources") && segments.length >= 2 &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..") &&
    (segments.at(-1)?.toLocaleLowerCase("en-US").endsWith(".md") ?? false);
}, "Library page paths must identify a vault Markdown page.");
export const LibraryPageSummarySchema = z.object({
  pageId: PageIdSchema,
  title: z.string().min(1).max(512),
  pageType: MarkdownPageTypeSchema,
  status: MarkdownPageStatusSchema,
  pagePath: LibraryRelativePagePathSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  language: z.string().min(1).max(64).optional(),
  sourceIds: z.array(SourceIdSchema).max(1_000).readonly()
}).strict();
const LibraryBrowseResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: LibraryBrowseRequestIdSchema,
  activeVaultId: VaultIdSchema
}).strict();
export const LibraryBrowseResultSchema = z.discriminatedUnion("status", [
  LibraryBrowseResultIdentitySchema.extend({
    status: z.literal("ready"),
    snapshotId: LibraryBrowseSnapshotIdSchema,
    scannedAt: z.string().datetime({ offset: true }),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    invalidPageCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    pages: z.array(LibraryPageSummarySchema).max(LIBRARY_BROWSE_PAGE_SIZE_MAX).readonly(),
    nextCursor: LibraryBrowseCursorSchema.optional()
  }).strict(),
  LibraryBrowseResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  LibraryBrowseResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "ready") return;
  if (result.total < result.pages.length) {
    context.addIssue({ code: "custom", path: ["total"], message: "Library totals must include every returned page." });
  }
  if (new Set(result.pages.map((page) => page.pageId)).size !== result.pages.length) {
    context.addIssue({ code: "custom", path: ["pages"], message: "Library page identities must be unique." });
  }
  for (let index = 1; index < result.pages.length; index += 1) {
    const previous = result.pages[index - 1]!, current = result.pages[index]!;
    if (previous.updatedAt < current.updatedAt ||
      (previous.updatedAt === current.updatedAt && previous.pagePath >= current.pagePath)) {
      context.addIssue({ code: "custom", path: ["pages", index], message: "Library pages must use stable browse order." });
    }
  }
});
export const LibraryTagsRequestIdSchema = z.string().regex(
  /^library_tags_request_[a-z0-9]{16,64}$/
);
export const LibraryTagsSnapshotIdSchema = z.string().regex(
  /^library_tags_snapshot_[a-f0-9]{64}$/
);
export const LibraryTagsCursorSchema = z.string().regex(
  /^library_tags_cursor_[a-f0-9]{64}$/
);
export const LibraryCanonicalTagSchema = NoteCanonicalTagSchema;
export const LibraryRenameTagRequestIdSchema = z.string().regex(
  /^library_tag_rename_request_[a-z0-9]{16,64}$/
);
export const LibraryMergeTagRequestIdSchema = z.string().regex(
  /^library_tag_merge_request_[a-z0-9]{16,64}$/
);
export const LibraryRemoveTagRequestIdSchema = z.string().regex(
  /^library_tag_remove_request_[a-z0-9]{16,64}$/
);
export const LibraryRemovePageTagRequestIdSchema = z.string().regex(
  /^library_page_tag_remove_request_[a-z0-9]{16,64}$/
);
export const LibraryRenameTopicRequestIdSchema = z.string().regex(
  /^library_topic_rename_request_[a-z0-9]{16,64}$/
);

const LibraryTagsRequestBaseShape = {
  apiVersion: z.literal(1),
  requestId: LibraryTagsRequestIdSchema,
  activeVaultId: VaultIdSchema,
  limit: z.number().int().min(1).max(LIBRARY_TAGS_PAGE_SIZE_MAX),
  snapshotId: LibraryTagsSnapshotIdSchema.optional(),
  cursor: LibraryTagsCursorSchema.optional()
} as const;

export const LibraryTagsRequestSchema = z.union([
  z.object({
    ...LibraryTagsRequestBaseShape,
    mode: z.literal("list_tags")
  }).strict(),
  z.object({
    ...LibraryTagsRequestBaseShape,
    mode: z.literal("list_pages_for_tag"),
    tag: LibraryCanonicalTagSchema
  }).strict()
]).superRefine((request, context) => {
  if ((request.snapshotId === undefined) !== (request.cursor === undefined)) {
    context.addIssue({
      code: "custom",
      path: [request.snapshotId === undefined ? "snapshotId" : "cursor"],
      message: "Library tag continuation requires both its snapshot and cursor."
    });
  }
});

export const LibraryTagFacetSchema = z.object({
  tag: LibraryCanonicalTagSchema,
  pageCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();

export const LibraryTaggedPageSummarySchema = z.object({
  pageId: PageIdSchema,
  title: z.string().trim().min(1).max(240),
  pageType: MarkdownPageTypeSchema,
  status: MarkdownPageStatusSchema,
  updatedAt: z.string().datetime({ offset: true })
}).strict();

const LibraryTagsListIdentityShape = {
  apiVersion: z.literal(1),
  requestId: LibraryTagsRequestIdSchema,
  activeVaultId: VaultIdSchema,
  mode: z.literal("list_tags")
} as const;

const LibraryTagPagesIdentityShape = {
  apiVersion: z.literal(1),
  requestId: LibraryTagsRequestIdSchema,
  activeVaultId: VaultIdSchema,
  mode: z.literal("list_pages_for_tag"),
  tag: LibraryCanonicalTagSchema
} as const;

export const LibraryTagsResultSchema = z.union([
  z.object({
    ...LibraryTagsListIdentityShape,
    status: z.literal("ready"),
    snapshotId: LibraryTagsSnapshotIdSchema,
    tags: z.array(LibraryTagFacetSchema).max(LIBRARY_TAGS_PAGE_SIZE_MAX).readonly(),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    nextCursor: LibraryTagsCursorSchema.optional()
  }).strict(),
  z.object({ ...LibraryTagsListIdentityShape, status: z.literal("stale") }).strict(),
  z.object({ ...LibraryTagsListIdentityShape, status: z.literal("failed") }).strict(),
  z.object({
    ...LibraryTagPagesIdentityShape,
    status: z.literal("ready"),
    snapshotId: LibraryTagsSnapshotIdSchema,
    pages: z.array(LibraryTaggedPageSummarySchema).max(LIBRARY_TAGS_PAGE_SIZE_MAX).readonly(),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    nextCursor: LibraryTagsCursorSchema.optional()
  }).strict(),
  z.object({ ...LibraryTagPagesIdentityShape, status: z.literal("stale") }).strict(),
  z.object({ ...LibraryTagPagesIdentityShape, status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "ready") return;
  const items = result.mode === "list_tags" ? result.tags : result.pages;
  if (result.total < items.length) {
    context.addIssue({
      code: "custom",
      path: ["total"],
      message: "Library tag browse totals must include every projected item."
    });
  }
  if (result.mode === "list_tags") {
    const keys = result.tags.map(({ tag }) => tag.toLocaleLowerCase("en-US"));
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["tags"],
        message: "Library tag facets must have unique canonical keys."
      });
    }
    for (let index = 1; index < keys.length; index += 1) {
      if (keys[index - 1]! >= keys[index]!) {
        context.addIssue({
          code: "custom",
          path: ["tags", index],
          message: "Library tag facets must use canonical tag-key order."
        });
        break;
      }
    }
    return;
  }
  if (new Set(result.pages.map(({ pageId }) => pageId)).size !== result.pages.length) {
    context.addIssue({
      code: "custom",
      path: ["pages"],
      message: "Library tagged page summaries must have unique stable page IDs."
    });
  }
  for (let index = 1; index < result.pages.length; index += 1) {
    const previous = result.pages[index - 1]!;
    const current = result.pages[index]!;
    if (previous.updatedAt < current.updatedAt ||
        (previous.updatedAt === current.updatedAt && previous.pageId >= current.pageId)) {
      context.addIssue({
        code: "custom",
        path: ["pages", index],
        message: "Library tagged pages must use updatedAt-descending then page-ID order."
      });
      break;
    }
  }
});

const LibraryRenameTagIdentityShape = {
  apiVersion: z.literal(1),
  requestId: LibraryRenameTagRequestIdSchema,
  activeVaultId: VaultIdSchema,
  tag: LibraryCanonicalTagSchema,
  replacementTag: LibraryCanonicalTagSchema,
  expectedSnapshotId: LibraryTagsSnapshotIdSchema,
  expectedPageCount: z.number().int().positive().max(1_000)
} as const;

export const LibraryRenameTagRequestSchema = z.object(LibraryRenameTagIdentityShape).strict()
  .refine((request) => request.tag.toLocaleLowerCase("en-US") !== request.replacementTag.toLocaleLowerCase("en-US"), {
    path: ["replacementTag"],
    message: "A Library tag rename must change the canonical tag key."
  });

export const LibraryRenameTagResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...LibraryRenameTagIdentityShape,
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    renamedPageCount: z.number().int().positive().max(1_000)
  }).strict(),
  z.object({ ...LibraryRenameTagIdentityShape, status: z.enum(["stale", "not_found", "ineligible", "failed"]) }).strict()
]);

const LibraryMergeTagIdentityShape = {
  apiVersion: z.literal(1),
  requestId: LibraryMergeTagRequestIdSchema,
  activeVaultId: VaultIdSchema,
  sourceTag: LibraryCanonicalTagSchema,
  targetTag: LibraryCanonicalTagSchema,
  expectedSnapshotId: LibraryTagsSnapshotIdSchema,
  expectedSourcePageCount: z.number().int().positive().max(1_000),
  expectedTargetPageCount: z.number().int().positive().max(1_000)
} as const;

export const LibraryMergeTagRequestSchema = z.object(LibraryMergeTagIdentityShape).strict()
  .refine((request) => request.sourceTag.toLocaleLowerCase("en-US") !== request.targetTag.toLocaleLowerCase("en-US"), {
    path: ["targetTag"],
    message: "A Library tag merge requires distinct canonical tag keys."
  });

export const LibraryMergeTagResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...LibraryMergeTagIdentityShape,
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    mergedPageCount: z.number().int().positive().max(1_000)
  }).strict(),
  z.object({ ...LibraryMergeTagIdentityShape, status: z.enum(["stale", "not_found", "ineligible", "failed"]) }).strict()
]);

const LibraryRemoveTagIdentityShape = {
  apiVersion: z.literal(1),
  requestId: LibraryRemoveTagRequestIdSchema,
  activeVaultId: VaultIdSchema,
  tag: LibraryCanonicalTagSchema,
  expectedSnapshotId: LibraryTagsSnapshotIdSchema,
  expectedPageCount: z.number().int().positive().max(1_000)
} as const;

export const LibraryRemoveTagRequestSchema = z.object(LibraryRemoveTagIdentityShape).strict();

export const LibraryRemoveTagResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...LibraryRemoveTagIdentityShape,
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    removedPageCount: z.number().int().positive().max(1_000)
  }).strict(),
  z.object({ ...LibraryRemoveTagIdentityShape, status: z.enum(["stale", "not_found", "ineligible", "failed"]) }).strict()
]);

const LibraryRemovePageTagIdentityShape = {
  apiVersion: z.literal(1),
  requestId: LibraryRemovePageTagRequestIdSchema,
  activeVaultId: VaultIdSchema,
  tag: LibraryCanonicalTagSchema,
  pageId: PageIdSchema,
  expectedSnapshotId: LibraryTagsSnapshotIdSchema,
  expectedPageUpdatedAt: z.string().datetime({ offset: true })
} as const;

export const LibraryRemovePageTagRequestSchema = z.object(LibraryRemovePageTagIdentityShape).strict();

export const LibraryRemovePageTagResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...LibraryRemovePageTagIdentityShape,
    status: z.literal("committed"),
    operationId: OperationIdSchema
  }).strict(),
  z.object({ ...LibraryRemovePageTagIdentityShape, status: z.enum(["stale", "not_found", "ineligible", "failed"]) }).strict()
]);

const LibraryRenameTopicIdentityShape = {
  apiVersion: z.literal(1),
  requestId: LibraryRenameTopicRequestIdSchema,
  activeVaultId: VaultIdSchema,
  pageId: PageIdSchema,
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  expectedRevision: NoteEditorRevisionSchema,
  expectedTitle: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(240)
} as const;

export const LibraryRenameTopicRequestSchema = z.object(LibraryRenameTopicIdentityShape).strict()
  .refine((request) => request.expectedTitle !== request.title, {
    path: ["title"],
    message: "A Topic rename must change the title."
  });

export const LibraryRenameTopicResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...LibraryRenameTopicIdentityShape,
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    render: NoteRenderResultSchema.extend({ renderContextId: NoteRenderContextIdSchema }).strict()
  }).strict(),
  z.object({
    ...LibraryRenameTopicIdentityShape,
    status: z.enum(["stale", "not_found", "ineligible", "conflict", "failed"])
  }).strict()
]);

export const CollectionRequestIdSchema = z.string().regex(/^collection_request_[a-z0-9]{16,64}$/);
export const CollectionCatalogCursorSchema = z.string().regex(/^collection_catalog_[a-f0-9]{64}$/);
export const CollectionRowCursorSchema = z.string().regex(/^collection_rows_[a-f0-9]{64}$/);
export const COLLECTION_LIST_CHANNEL = "collections.list" as const;
export const COLLECTION_OPEN_CITATION_CHANNEL = "collections.openCitation" as const;
export const COLLECTION_ADD_FORMULA_COLUMN_CHANNEL = "collections.addFormulaColumn" as const;
export const COLLECTION_UPDATE_FORMULA_COLUMN_CHANNEL = "collections.updateFormulaColumn" as const;
export const COLLECTION_ADD_RELATION_COLUMN_CHANNEL = "collections.addRelationColumn" as const;
export const COLLECTION_UPDATE_RELATION_COLUMN_CHANNEL = "collections.updateRelationColumn" as const;
export const COLLECTION_EDIT_RELATION_CELL_CHANNEL = "collections.editRelationCell" as const;
export const COLLECTION_ADD_LOOKUP_COLUMN_CHANNEL = "collections.addLookupColumn" as const;
export const COLLECTION_UPDATE_LOOKUP_COLUMN_CHANNEL = "collections.updateLookupColumn" as const;
export const COLLECTION_UPDATE_VIEW_CHANNEL = "collections.updateView" as const;
export const COLLECTION_ADD_ROLLUP_COLUMN_CHANNEL = "collections.addRollupColumn" as const;
export const COLLECTION_UPDATE_ROLLUP_COLUMN_CHANNEL = "collections.updateRollupColumn" as const;
export const COLLECTION_RENAME_VIEW_CHANNEL = "collections.renameView" as const;
export const COLLECTION_TRASH_VIEW_CHANNEL = "collections.trashView" as const;
export const COLLECTION_TRASH_DATASET_CHANNEL = "collections.trashDataset" as const;
export const COLLECTION_LIST_MAX_LIMIT = 50;
export const COLLECTION_ROW_PAGE_MAX_LIMIT = 50;
export const CollectionScalarValueSchema = DatasetQueryScalarSchema;
export const CollectionCellReadOnlyReasonSchema = z.enum(["formula", "lookup", "rollup", "unsupported_type"]);
export const COLLECTION_COLUMN_LABEL_MAX_UTF8_BYTES = 256;
export const COLLECTION_VIEW_NAME_MAX_UTF8_BYTES = 256;
export const CollectionEditableLogicalTypeSchema = z.enum([
  "string",
  "integer",
  "number",
  "boolean",
  "date",
  "datetime"
]);
export const CollectionNewColumnLabelSchema = z.string().trim().min(1).max(120).refine(
  (value) => new TextEncoder().encode(value).byteLength <= COLLECTION_COLUMN_LABEL_MAX_UTF8_BYTES,
  `Collection column labels must not exceed ${COLLECTION_COLUMN_LABEL_MAX_UTF8_BYTES} UTF-8 bytes.`
);

export const CollectionViewNameSchema = z.string().trim().min(1).max(120).refine(
  (value) => new TextEncoder().encode(value).byteLength <= COLLECTION_VIEW_NAME_MAX_UTF8_BYTES,
  `Collection view names must not exceed ${COLLECTION_VIEW_NAME_MAX_UTF8_BYTES} UTF-8 bytes.`
);

const CollectionViewEqualityValueSchema = z.union([
  DatasetQueryTextSchema,
  z.number().finite(),
  z.boolean()
]);

export const CollectionViewFilterSchema = z.discriminatedUnion("operator", [
  z.object({
    operator: z.literal("eq"),
    columnId: DatasetQueryColumnIdSchema,
    value: CollectionViewEqualityValueSchema
  }).strict(),
  z.object({
    operator: z.literal("is_null"),
    columnId: DatasetQueryColumnIdSchema
  }).strict()
]);

export const CollectionViewSortSchema = z.object({
  columnId: DatasetQueryColumnIdSchema,
  direction: z.enum(["asc", "desc"])
}).strict();

export const CollectionViewSummarySchema = z.object({
  viewId: ViewIdSchema,
  viewRevision: z.number().int().positive(),
  name: CollectionViewNameSchema,
  canEdit: z.boolean().default(false),
  canRename: z.boolean().default(false),
  canTrash: z.boolean().default(false),
  filter: CollectionViewFilterSchema.optional(),
  sort: CollectionViewSortSchema.optional()
}).strict();

export const CollectionColumnCalculationSummarySchema = z.discriminatedUnion("kind", [
  DatasetPigeCalculationSchema,
  z.object({ kind: z.literal("imported_cached_formula") }).strict()
]);

export const CollectionColumnRelationSummarySchema = DatasetPigeRelationSchema;
export const CollectionColumnLookupSummarySchema = DatasetPigeLookupSchema;
export const CollectionColumnRollupSummarySchema = DatasetPigeRollupSchema;

/**
 * Relation source columns may project canTrash only when the existing forward
 * Undo owner can restore the exact descriptor and every target-row cell. Main
 * must reprove inbound display-column and row guards immediately before trash.
 */
export const CollectionColumnSummarySchema = z.object({
  columnId: DatasetQueryColumnIdSchema,
  label: z.string().min(1).max(512),
  logicalType: DatasetLogicalTypeSchema,
  canRename: z.boolean(),
  canTrash: z.boolean(),
  canUseAsFormulaOperand: z.boolean(),
  canEditFormula: z.boolean(),
  canUseAsRelationDisplay: z.boolean().default(false),
  canEditRelationDefinition: z.boolean().default(false),
  canEditRelation: z.boolean().default(false),
  canUseAsLookupTarget: z.boolean().default(false),
  canEditLookup: z.boolean().default(false),
  canUseAsRollupTarget: z.boolean().default(false),
  canEditRollup: z.boolean().default(false),
  hasInboundRelationDescriptors: z.boolean().default(false),
  calculation: CollectionColumnCalculationSummarySchema.optional(),
  relation: CollectionColumnRelationSummarySchema.optional(),
  lookup: CollectionColumnLookupSummarySchema.optional(),
  rollup: CollectionColumnRollupSummarySchema.optional()
}).strict().superRefine((column, context) => {
  if ([column.calculation, column.relation, column.lookup, column.rollup].filter((value) => value !== undefined).length > 1) {
    context.addIssue({
      code: "custom",
      path: ["relation"],
      message: "Collection columns cannot combine formula, relation, lookup, and rollup descriptors."
    });
  }
  if (
    column.canUseAsFormulaOperand &&
    ((column.calculation !== undefined && column.calculation.kind !== "pige_numeric_formula") ||
      column.relation !== undefined ||
      (column.logicalType !== "integer" && column.logicalType !== "number"))
  ) {
    context.addIssue({
      code: "custom",
      path: ["canUseAsFormulaOperand"],
      message: "Only numeric scalar, derived lookup/rollup, or Pige numeric formula columns may be projected as formula operands."
    });
  }
  if (column.calculation?.kind === "pige_numeric_formula" && column.logicalType !== "number") {
    context.addIssue({
      code: "custom",
      path: ["calculation"],
      message: "Pige formula summaries must project a numeric result column."
    });
  }
  if (column.canEditFormula && column.calculation?.kind !== "pige_numeric_formula") {
    context.addIssue({
      code: "custom",
      path: ["canEditFormula"],
      message: "Only a current losslessly representable Pige formula may be editable."
    });
  }
  if (column.canEditRelation !== (column.relation?.kind === "pige_single_relation")) {
    context.addIssue({
      code: "custom",
      path: ["canEditRelation"],
      message: "Only current Pige relation columns may expose relation-cell edit authority."
    });
  }
  if (column.canEditRelationDefinition && column.relation?.kind !== "pige_single_relation") {
    context.addIssue({
      code: "custom",
      path: ["canEditRelationDefinition"],
      message: "Only current unreferenced Pige relation columns may expose descriptor edit authority."
    });
  }
  if (column.canEditRollup !== (column.rollup?.kind === "pige_single_rollup")) {
    context.addIssue({
      code: "custom",
      path: ["canEditRollup"],
      message: "Only a current Pige rollup may be editable."
    });
  }
  if (column.canEditLookup !== (column.lookup?.kind === "pige_single_lookup")) {
    context.addIssue({
      code: "custom",
      path: ["canEditLookup"],
      message: "Only a current Pige lookup may be editable."
    });
  }
  if (column.relation !== undefined &&
      (column.logicalType !== "string" || column.canUseAsRelationDisplay)) {
    context.addIssue({
      code: "custom",
      path: ["relation"],
      message: "Relation columns are string-backed targets and cannot be display columns."
    });
  }
  if (column.canUseAsRelationDisplay &&
      (column.calculation !== undefined || column.relation !== undefined || column.lookup !== undefined || column.rollup !== undefined ||
       !["string", "integer", "number", "boolean", "date", "datetime"].includes(column.logicalType))) {
    context.addIssue({
      code: "custom",
      path: ["canUseAsRelationDisplay"],
      message: "Only current scalar non-formula columns may label relation targets."
    });
  }
  if (column.lookup !== undefined &&
      (column.canUseAsLookupTarget || column.canEditRelation ||
       (column.canUseAsFormulaOperand && column.logicalType !== "integer" && column.logicalType !== "number"))) {
    context.addIssue({ code: "custom", path: ["lookup"], message: "Lookup columns must remain derived and read-only." });
  }
  if (column.rollup !== undefined &&
      (column.logicalType !== "number" || !column.canUseAsFormulaOperand || column.canUseAsLookupTarget ||
       column.canUseAsRollupTarget || column.canEditRelation)) {
    context.addIssue({ code: "custom", path: ["rollup"], message: "Rollup columns must remain derived numeric fields." });
  }
  if (column.canUseAsLookupTarget &&
      (column.calculation !== undefined || column.relation !== undefined || column.lookup !== undefined || column.rollup !== undefined ||
       !["string", "integer", "number", "boolean", "date", "datetime"].includes(column.logicalType))) {
    context.addIssue({ code: "custom", path: ["canUseAsLookupTarget"], message: "Only current scalar fields may be lookup targets." });
  }
  if (column.canUseAsRollupTarget &&
      (column.calculation !== undefined || column.relation !== undefined || column.lookup !== undefined || column.rollup !== undefined ||
       (column.logicalType !== "integer" && column.logicalType !== "number"))) {
    context.addIssue({ code: "custom", path: ["canUseAsRollupTarget"], message: "Only current scalar numeric fields may be rollup targets." });
  }
  if (column.hasInboundRelationDescriptors && column.canTrash) {
    context.addIssue({
      code: "custom",
      path: ["canTrash"],
      message: "Relation display columns with inbound descriptors must fail closed for trash."
    });
  }
  if (
    column.calculation?.kind === "imported_cached_formula" &&
    (column.canRename || column.canTrash || column.canUseAsFormulaOperand || column.canEditFormula)
  ) {
    context.addIssue({
      code: "custom",
      path: ["calculation"],
      message: "Imported cached formulas must remain read-only and ineligible."
    });
  }
});

export const COLLECTION_RELATION_DISPLAY_LABEL_MAX_UTF8_BYTES = 512;
export const CollectionRelationDisplayLabelSchema = z.string().max(160).refine(
  (value) => new TextEncoder().encode(value).byteLength <= COLLECTION_RELATION_DISPLAY_LABEL_MAX_UTF8_BYTES,
  `Collection relation labels must not exceed ${COLLECTION_RELATION_DISPLAY_LABEL_MAX_UTF8_BYTES} UTF-8 bytes.`
);

/**
 * Main derives displayLabel from the descriptor-owned scalar: null/empty becomes
 * null; booleans are lowercase; finite numbers use String(value) with -0 as 0;
 * strings/date/datetime retain their value and are UTF-8 truncated with an ellipsis.
 */
export const CollectionRelationCellValueSchema = z.object({
  kind: z.literal("relation"),
  targetRowId: DatasetQueryRowIdSchema.nullable(),
  displayLabel: CollectionRelationDisplayLabelSchema.nullable()
}).strict().superRefine((value, context) => {
  if (value.targetRowId === null && value.displayLabel !== null) {
    context.addIssue({
      code: "custom",
      path: ["displayLabel"],
      message: "Cleared relation cells cannot project a display label."
    });
  }
});

export const CollectionCellValueSchema = z.union([
  CollectionScalarValueSchema,
  CollectionRelationCellValueSchema
]);

export const CollectionCellSchema = z.object({
  columnId: DatasetQueryColumnIdSchema,
  value: CollectionCellValueSchema,
  editable: z.boolean(),
  readOnlyReason: CollectionCellReadOnlyReasonSchema.optional()
}).strict().superRefine((cell, context) => {
  if (cell.editable === (cell.readOnlyReason !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["readOnlyReason"],
      message: "Collection cells require a read-only reason exactly when they are not editable."
    });
  }
});

export const CollectionRowSchema = z.object({
  rowId: DatasetQueryRowIdSchema,
  cells: z.array(CollectionCellSchema).max(32),
  canTrash: z.boolean(),
  hasInboundRelationReferences: z.boolean().default(false)
}).strict().superRefine((row, context) => {
  if (row.hasInboundRelationReferences && row.canTrash) {
    context.addIssue({
      code: "custom",
      path: ["canTrash"],
      message: "Rows with inbound relation references must fail closed for trash."
    });
  }
});

export const CollectionDatasetTableSummarySchema = z.object({
  tableId: DatasetQueryTableIdSchema,
  tableName: z.string().trim().min(1).max(512),
  columnCount: DatasetQueryCountSchema.max(32),
  rowCount: DatasetQueryCountSchema,
  canOpen: z.boolean()
}).strict();

export const CollectionDatasetSummarySchema = z.object({
  datasetId: DatasetQueryDatasetIdSchema,
  title: z.string().trim().min(1).max(240),
  activeRevisionId: DatasetQueryRevisionIdSchema,
  canTrash: z.boolean().default(false),
  tableCount: DatasetQueryCountSchema,
  tables: z.array(CollectionDatasetTableSummarySchema).max(32),
  tablesTruncated: z.boolean()
}).strict().superRefine((summary, context) => {
  if (summary.tableCount < summary.tables.length) {
    context.addIssue({
      code: "custom",
      path: ["tableCount"],
      message: "Collection Dataset tableCount must include every projected table."
    });
  }
  if (summary.tablesTruncated !== (summary.tableCount > summary.tables.length)) {
    context.addIssue({
      code: "custom",
      path: ["tablesTruncated"],
      message: "Collection Dataset table truncation must agree with the projected table count."
    });
  }
  if (new Set(summary.tables.map(({ tableId }) => tableId)).size !== summary.tables.length) {
    context.addIssue({
      code: "custom",
      path: ["tables"],
      message: "Collection Dataset table summaries must have unique stable IDs."
    });
  }
});

function normalizeCollectionCatalogTitle(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export const CollectionListRequestSchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  limit: z.number().int().min(1).max(COLLECTION_LIST_MAX_LIMIT),
  cursor: CollectionCatalogCursorSchema.optional()
}).strict();

const CollectionListIdentitySchema = CollectionListRequestSchema.pick({
  apiVersion: true,
  activeVaultId: true
});

export const CollectionListResultSchema = z.discriminatedUnion("status", [
  CollectionListIdentitySchema.extend({
    status: z.literal("ready"),
    datasets: z.array(CollectionDatasetSummarySchema).max(COLLECTION_LIST_MAX_LIMIT),
    totalDatasetCount: DatasetQueryCountSchema,
    hasMore: z.boolean(),
    nextCursor: CollectionCatalogCursorSchema.optional()
  }).strict(),
  CollectionListIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "ready") return;
  if (result.totalDatasetCount < result.datasets.length) {
    context.addIssue({
      code: "custom",
      path: ["totalDatasetCount"],
      message: "Collection catalog totalDatasetCount must include every projected Dataset."
    });
  }
  if (result.hasMore !== (result.nextCursor !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["nextCursor"],
      message: "Collection catalog continuation must agree with hasMore."
    });
  }
  if (new Set(result.datasets.map(({ datasetId }) => datasetId)).size !== result.datasets.length) {
    context.addIssue({
      code: "custom",
      path: ["datasets"],
      message: "Collection catalog summaries must have unique stable Dataset IDs."
    });
  }
  for (let index = 1; index < result.datasets.length; index += 1) {
    const previous = result.datasets[index - 1]!;
    const current = result.datasets[index]!;
    const previousTitle = normalizeCollectionCatalogTitle(previous.title);
    const currentTitle = normalizeCollectionCatalogTitle(current.title);
    if (previousTitle > currentTitle ||
        (previousTitle === currentTitle && previous.datasetId >= current.datasetId)) {
      context.addIssue({
        code: "custom",
        path: ["datasets", index],
        message: "Collection catalog summaries must use normalized title then Dataset ID order."
      });
      break;
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 64 * 1024) {
    context.addIssue({
      code: "custom",
      message: "Collection catalog results must not exceed 64 KiB."
    });
  }
});

export const CollectionSnapshotSchema = z.object({
  datasetId: DatasetQueryDatasetIdSchema,
  revisionId: DatasetQueryRevisionIdSchema,
  title: z.string().min(1).max(240),
  tableId: DatasetQueryTableIdSchema,
  tableName: z.string().min(1).max(512),
  columns: z.array(CollectionColumnSummarySchema).min(1).max(32),
  rows: z.array(CollectionRowSchema).max(50),
  totalRowCount: DatasetQueryCountSchema,
  returnedRowCount: DatasetQueryCountSchema,
  truncated: z.boolean(),
  canAppendDefaultRow: z.boolean(),
  canAddColumn: z.boolean(),
  canAddFormulaColumn: z.boolean(),
  canAddRelationColumn: z.boolean().default(false),
  canAddLookupColumn: z.boolean().default(false),
  canAddRollupColumn: z.boolean().default(false),
  views: z.array(CollectionViewSummarySchema).max(32),
  activeViewId: ViewIdSchema.optional()
}).strict().superRefine((snapshot, context) => {
  if (snapshot.returnedRowCount !== snapshot.rows.length) {
    context.addIssue({
      code: "custom",
      path: ["returnedRowCount"],
      message: "Collection returnedRowCount must match the number of projected rows."
    });
  }
  if (snapshot.totalRowCount < snapshot.returnedRowCount) {
    context.addIssue({
      code: "custom",
      path: ["totalRowCount"],
      message: "Collection totalRowCount must include every projected row."
    });
  }
  const columnIds = new Set(snapshot.columns.map(({ columnId }) => columnId));
  const columnsById = new Map(snapshot.columns.map((column) => [column.columnId, column]));
  if (snapshot.canAddLookupColumn && !snapshot.columns.some((column) => column.relation?.kind === "pige_single_relation")) {
    context.addIssue({ code: "custom", path: ["canAddLookupColumn"], message: "Lookup creation requires a current relation field." });
  }
  if (snapshot.canAddRollupColumn && !snapshot.columns.some((column) => column.relation?.kind === "pige_single_relation")) {
    context.addIssue({ code: "custom", path: ["canAddRollupColumn"], message: "Rollup creation requires a current relation field." });
  }
  for (const [index, column] of snapshot.columns.entries()) {
    if (column.canEditRelationDefinition && snapshot.columns.some((candidate) =>
      candidate.lookup?.relationColumnId === column.columnId || candidate.rollup?.relationColumnId === column.columnId)) {
      context.addIssue({
        code: "custom", path: ["columns", index, "canEditRelationDefinition"],
        message: "Relations referenced by derived fields cannot expose descriptor edit authority."
      });
    }
    if (!column.lookup) continue;
    const relationColumn = columnsById.get(column.lookup.relationColumnId);
    if (!relationColumn?.relation || relationColumn.canTrash) {
      context.addIssue({
        code: "custom", path: ["columns", index, "lookup", "relationColumnId"],
        message: "Lookup fields require one guarded current relation field."
      });
      continue;
    }
    if (relationColumn.relation.targetTableId === snapshot.tableId) {
      const targetColumn = columnsById.get(column.lookup.targetColumnId);
      if (!targetColumn?.canUseAsLookupTarget || targetColumn.canTrash) {
        context.addIssue({
          code: "custom", path: ["columns", index, "lookup", "targetColumnId"],
          message: "Same-table lookup targets must project lookup and trash guards."
        });
      }
    }
  }
  const formulaIndegree = new Map(snapshot.columns
    .filter((column) => column.calculation?.kind === "pige_numeric_formula")
    .map((column) => [column.columnId, 0]));
  const formulaDownstream = new Map([...formulaIndegree].map(([id]) => [id, new Set<string>()]));
  for (const column of snapshot.columns) {
    if (column.calculation?.kind !== "pige_numeric_formula") continue;
    for (const operandId of datasetPigeFormulaColumnRefs(column.calculation.expression)) {
      if (!formulaIndegree.has(operandId)) continue;
      formulaIndegree.set(column.columnId, formulaIndegree.get(column.columnId)! + 1);
      formulaDownstream.get(operandId)!.add(column.columnId);
    }
  }
  const formulaReady = [...formulaIndegree].filter(([, count]) => count === 0).map(([id]) => id).sort();
  let formulaVisited = 0;
  while (formulaReady.length > 0) {
    const id = formulaReady.shift()!;
    formulaVisited += 1;
    for (const dependentId of [...formulaDownstream.get(id)!].sort()) {
      const next = formulaIndegree.get(dependentId)! - 1;
      formulaIndegree.set(dependentId, next);
      if (next === 0) {
        formulaReady.push(dependentId);
        formulaReady.sort();
      }
    }
  }
  if (formulaVisited !== formulaIndegree.size) {
    context.addIssue({ code: "custom", path: ["columns"], message: "Projected Pige formula dependencies must be acyclic." });
  }
  for (const [index, column] of snapshot.columns.entries()) {
    if (!column.rollup) continue;
    const relationColumn = columnsById.get(column.rollup.relationColumnId);
    if (!relationColumn?.relation || relationColumn.canTrash) {
      context.addIssue({ code: "custom", path: ["columns", index, "rollup", "relationColumnId"], message: "Rollups require one guarded current relation field." });
      continue;
    }
    if (column.rollup.aggregation === "sum" && relationColumn.relation.targetTableId === snapshot.tableId) {
      const targetColumn = columnsById.get(column.rollup.targetColumnId!);
      if (!targetColumn?.canUseAsRollupTarget || targetColumn.canTrash) {
        context.addIssue({ code: "custom", path: ["columns", index, "rollup", "targetColumnId"], message: "Same-table sum targets must project rollup and trash guards." });
      }
    }
  }
  const referencedFormulaOperands = new Set<string>();
  for (const [index, column] of snapshot.columns.entries()) {
    if (column.calculation?.kind !== "pige_numeric_formula") continue;
    for (const columnId of datasetPigeFormulaColumnRefs(column.calculation.expression)) {
      const operand = columnsById.get(columnId);
      if (!operand?.canUseAsFormulaOperand) {
        context.addIssue({
          code: "custom",
          path: ["columns", index, "calculation", "expression"],
          message: "Projected Pige formulas may reference only eligible current columns."
        });
      } else {
        referencedFormulaOperands.add(columnId);
      }
    }
  }
  for (const [index, column] of snapshot.columns.entries()) {
    if (referencedFormulaOperands.has(column.columnId) && column.canTrash) {
      context.addIssue({
        code: "custom",
        path: ["columns", index, "canTrash"],
        message: "Columns referenced by a Pige formula must fail closed for trash."
      });
    }
  }
  for (const [columnIndex, column] of snapshot.columns.entries()) {
    if (column.relation?.targetTableId !== snapshot.tableId) continue;
    const displayColumn = columnsById.get(column.relation.targetDisplayColumnId);
    if (displayColumn?.hasInboundRelationDescriptors !== true || displayColumn.canTrash) {
      context.addIssue({
        code: "custom",
        path: ["columns", columnIndex, "relation", "targetDisplayColumnId"],
        message: "Same-table relation display columns must project the inbound trash guard."
      });
    }
  }
  for (const [rowIndex, row] of snapshot.rows.entries()) {
    for (const [cellIndex, cell] of row.cells.entries()) {
      const column = columnsById.get(cell.columnId);
      if ((column?.lookup !== undefined) !== (cell.readOnlyReason === "lookup" && !cell.editable)) {
        context.addIssue({
          code: "custom", path: ["rows", rowIndex, "cells", cellIndex, "readOnlyReason"],
          message: "Lookup cells must project the strict lookup read-only reason."
        });
      }
      if ((column?.rollup !== undefined) !== (cell.readOnlyReason === "rollup" && !cell.editable)) {
        context.addIssue({ code: "custom", path: ["rows", rowIndex, "cells", cellIndex, "readOnlyReason"], message: "Rollup cells must project the strict rollup read-only reason." });
      }
      const relationValue = typeof cell.value === "object" && cell.value !== null &&
        "kind" in cell.value && cell.value.kind === "relation" ? cell.value : undefined;
      if ((column?.relation !== undefined) !== (relationValue !== undefined)) {
        context.addIssue({
          code: "custom",
          path: ["rows", rowIndex, "cells", cellIndex, "value"],
          message: "Relation columns and cells must use the strict relation projection together."
        });
      }
      if (relationValue === undefined || relationValue.targetRowId === null ||
          column?.relation?.targetTableId !== snapshot.tableId) continue;
      const target = snapshot.rows.find((candidate) => candidate.rowId === relationValue.targetRowId);
      if (target !== undefined && !target.hasInboundRelationReferences) {
        context.addIssue({
          code: "custom",
          path: ["rows", rowIndex, "cells", cellIndex, "value", "targetRowId"],
          message: "Visible relation targets must project the inbound row-trash guard."
        });
      }
    }
  }
  const viewIds = new Set<string>();
  for (const [index, view] of snapshot.views.entries()) {
    if (viewIds.has(view.viewId)) {
      context.addIssue({
        code: "custom",
        path: ["views", index, "viewId"],
        message: "Collection view summaries must have unique stable IDs."
      });
    }
    viewIds.add(view.viewId);
    for (const [owner, columnId] of [
      ["filter", view.filter?.columnId],
      ["sort", view.sort?.columnId]
    ] as const) {
      if (columnId !== undefined && !columnIds.has(columnId)) {
        context.addIssue({
          code: "custom",
          path: ["views", index, owner, "columnId"],
          message: "Collection views may reference only current stable columns."
        });
      }
    }
  }
  if (snapshot.activeViewId !== undefined && !viewIds.has(snapshot.activeViewId)) {
    context.addIssue({
      code: "custom",
      path: ["activeViewId"],
      message: "The active Collection view must appear in the authoritative view summaries."
    });
  }
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 64 * 1024) {
    context.addIssue({
      code: "custom",
      message: "Collection snapshots must not exceed 64 KiB."
    });
  }
});

export const CollectionOpenRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  viewId: ViewIdSchema.optional(),
  limit: z.number().int().min(1).max(COLLECTION_ROW_PAGE_MAX_LIMIT).optional(),
  rowCursor: CollectionRowCursorSchema.optional()
}).strict();

export const COLLECTION_REVEAL_CHANNEL = "collections.reveal" as const;
export const CollectionRevealRequestIdSchema = z.string()
  .regex(/^collection_reveal_[a-z0-9]{16,64}$/u);
export const CollectionRevealRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRevealRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  revisionId: DatasetQueryRevisionIdSchema,
  tableId: DatasetQueryTableIdSchema
}).strict();
const CollectionRevealResultIdentitySchema = CollectionRevealRequestSchema;
export const CollectionRevealResultSchema = z.discriminatedUnion("status", [
  CollectionRevealResultIdentitySchema.extend({ status: z.literal("revealed") }).strict(),
  ...(["stale", "not_found", "failed"] as const).map((status) =>
    CollectionRevealResultIdentitySchema.extend({ status: z.literal(status) }).strict())
]);

const CollectionTrashDatasetIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema
}).strict();

export const CollectionTrashDatasetRequestSchema = CollectionTrashDatasetIdentitySchema;
export const CollectionTrashDatasetResultSchema = z.discriminatedUnion("status", [
  CollectionTrashDatasetIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema
  }).strict(),
  CollectionTrashDatasetIdentitySchema.extend({
    status: z.enum(["stale", "not_found", "ineligible", "failed"])
  }).strict()
]);

const CollectionResultIdentitySchema = CollectionOpenRequestSchema.pick({
  apiVersion: true,
  requestId: true,
  activeVaultId: true,
  datasetId: true,
  tableId: true
});

export const CollectionOpenResultSchema = z.discriminatedUnion("status", [
  CollectionResultIdentitySchema.extend({
    status: z.literal("ready"),
    snapshot: CollectionSnapshotSchema,
    nextRowCursor: CollectionRowCursorSchema.optional()
  }).strict(),
  CollectionResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  CollectionResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status === "ready" &&
      result.snapshot.truncated !== (result.nextRowCursor !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["nextRowCursor"],
      message: "Collection row continuation must agree with snapshot truncation."
    });
  }
});

export const CollectionCellEditRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  tableId: DatasetQueryTableIdSchema,
  rowId: DatasetQueryRowIdSchema,
  columnId: DatasetQueryColumnIdSchema,
  value: CollectionScalarValueSchema
}).strict().superRefine((request, context) => {
  if (typeof request.value === "string" && new TextEncoder().encode(request.value).byteLength > 4096) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "Collection string values must not exceed 4 KiB."
    });
  }
});

export const CollectionAppendDefaultRowRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema
}).strict();

export const CollectionTrashRowRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  rowId: DatasetQueryRowIdSchema
}).strict();

export const CollectionAddNullableColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  label: CollectionNewColumnLabelSchema,
  logicalType: CollectionEditableLogicalTypeSchema
}).strict();

export const CollectionAddFormulaColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  label: CollectionNewColumnLabelSchema,
  expression: DatasetPigeFormulaExpressionSchema
}).strict();

export const CollectionUpdateFormulaColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  columnId: DatasetQueryColumnIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  expression: DatasetPigeFormulaExpressionSchema
}).strict();

/**
 * Main derives column/revision/Operation IDs from requestId plus this canonical
 * same-Dataset descriptor. The target table is browsed only through collections.open.
 */
export const CollectionAddRelationColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  label: CollectionNewColumnLabelSchema,
  targetTableId: DatasetQueryTableIdSchema,
  targetDisplayColumnId: DatasetQueryColumnIdSchema
}).strict();

/** Replaces the target table/display descriptor of one current Pige relation. */
export const CollectionUpdateRelationColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  columnId: DatasetQueryColumnIdSchema,
  targetTableId: DatasetQueryTableIdSchema,
  targetDisplayColumnId: DatasetQueryColumnIdSchema
}).strict();

/**
 * A null targetRowId is the only clear intent. Main binds requestId to the
 * canonical descriptor/cell intent and derives every revision and Operation ID.
 */
export const CollectionEditRelationCellRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  rowId: DatasetQueryRowIdSchema,
  columnId: DatasetQueryColumnIdSchema,
  targetRowId: DatasetQueryRowIdSchema.nullable()
}).strict();

/** Creates one read-only scalar lookup over an existing same-table relation. */
export const CollectionAddLookupColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  label: CollectionNewColumnLabelSchema,
  relationColumnId: DatasetQueryColumnIdSchema,
  targetColumnId: DatasetQueryColumnIdSchema
}).strict();

/** Replaces the descriptor of one current Pige-owned lookup column. */
export const CollectionUpdateLookupColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  columnId: DatasetQueryColumnIdSchema,
  relationColumnId: DatasetQueryColumnIdSchema,
  targetColumnId: DatasetQueryColumnIdSchema
}).strict();

/** Creates one read-only count or sum rollup over an existing source-table relation. */
export const CollectionAddRollupColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  label: CollectionNewColumnLabelSchema,
  relationColumnId: DatasetQueryColumnIdSchema,
  aggregation: z.enum(["count", "sum"]),
  targetColumnId: DatasetQueryColumnIdSchema.optional()
}).strict().superRefine((request, context) => {
  if ((request.aggregation === "sum") !== (request.targetColumnId !== undefined)) {
    context.addIssue({ code: "custom", path: ["targetColumnId"], message: "A sum rollup requires one numeric target while count accepts none." });
  }
});

/** Replaces the descriptor of one current Pige-owned rollup column. */
export const CollectionUpdateRollupColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  columnId: DatasetQueryColumnIdSchema,
  relationColumnId: DatasetQueryColumnIdSchema,
  aggregation: z.enum(["count", "sum"]),
  targetColumnId: DatasetQueryColumnIdSchema.optional()
}).strict().superRefine((request, context) => {
  if ((request.aggregation === "sum") !== (request.targetColumnId !== undefined)) {
    context.addIssue({ code: "custom", path: ["targetColumnId"], message: "A sum rollup requires one numeric target while count accepts none." });
  }
});

export const CollectionRenameColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  columnId: DatasetQueryColumnIdSchema,
  label: CollectionNewColumnLabelSchema
}).strict();

export const CollectionTrashColumnRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  columnId: DatasetQueryColumnIdSchema
}).strict();

export const CollectionCreateViewRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  name: CollectionViewNameSchema,
  filter: CollectionViewFilterSchema.optional(),
  sort: CollectionViewSortSchema.optional()
}).strict();

const CollectionViewMutationIdentityShape = {
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  viewId: ViewIdSchema
} as const;

export const CollectionRenameViewRequestSchema = z.object({
  ...CollectionViewMutationIdentityShape,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  expectedViewRevision: z.number().int().positive(),
  name: CollectionViewNameSchema
}).strict();

export const CollectionUpdateViewRequestSchema = z.object({
  ...CollectionViewMutationIdentityShape,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  expectedViewRevision: z.number().int().positive(),
  filter: CollectionViewFilterSchema.optional(),
  sort: CollectionViewSortSchema.optional()
}).strict();

export const CollectionTrashViewRequestSchema = z.object({
  ...CollectionViewMutationIdentityShape,
  expectedRevisionId: DatasetQueryRevisionIdSchema,
  expectedViewRevision: z.number().int().positive()
}).strict();

const CollectionEditResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  datasetId: DatasetQueryDatasetIdSchema,
  tableId: DatasetQueryTableIdSchema,
  rowId: DatasetQueryRowIdSchema,
  columnId: DatasetQueryColumnIdSchema
}).strict();

export const CollectionCellEditResultSchema = z.discriminatedUnion("status", [
  CollectionEditResultIdentitySchema.extend({
    status: z.literal("committed"),
    revisionId: DatasetQueryRevisionIdSchema,
    operationId: OperationIdSchema
  }).strict(),
  CollectionEditResultIdentitySchema.extend({
    status: z.literal("stale"),
    currentRevisionId: DatasetQueryRevisionIdSchema
  }).strict(),
  CollectionEditResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionEditResultIdentitySchema.extend({
    status: z.literal("not_editable"),
    reason: CollectionCellReadOnlyReasonSchema
  }).strict(),
  CollectionEditResultIdentitySchema.extend({
    status: z.literal("invalid"),
    reason: z.enum(["type_mismatch", "value_too_large"])
  }).strict(),
  CollectionEditResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const CollectionAppendDefaultRowResultSchema = z.discriminatedUnion("status", [
  CollectionResultIdentitySchema.extend({
    status: z.literal("committed"),
    rowId: DatasetQueryRowIdSchema,
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionResultIdentitySchema.extend({
    status: z.literal("stale"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionResultIdentitySchema.extend({ status: z.literal("not_found") }).strict()
]).superRefine((result, context) => {
  if (result.status === "not_found") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({
      code: "custom",
      path: ["snapshot"],
      message: "Collection default-row append snapshots must match the request identity."
    });
  }
});

export const CollectionAddNullableColumnResultSchema = z.discriminatedUnion("status", [
  CollectionResultIdentitySchema.extend({
    status: z.literal("committed"),
    columnId: DatasetQueryColumnIdSchema,
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionResultIdentitySchema.extend({
    status: z.literal("stale"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionResultIdentitySchema.extend({
    status: z.literal("invalid"),
    reason: z.enum(["duplicate_label", "column_limit", "type_mismatch"])
  }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({
      code: "custom",
      path: ["snapshot"],
      message: "Collection nullable-column snapshots must match the request identity."
    });
  }
  if (
    result.status === "committed" &&
    !result.snapshot.columns.some((column) => column.columnId === result.columnId)
  ) {
    context.addIssue({
      code: "custom",
      path: ["columnId"],
      message: "Committed Collection columns must appear in the authoritative snapshot."
    });
  }
});

export const CollectionAddFormulaColumnResultSchema = z.discriminatedUnion("status", [
  CollectionResultIdentitySchema.extend({
    status: z.literal("committed"),
    columnId: DatasetQueryColumnIdSchema,
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionResultIdentitySchema.extend({
    status: z.literal("stale"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionResultIdentitySchema.extend({
    status: z.literal("invalid"),
    reason: z.enum(["duplicate_label", "column_limit", "ineligible_operand"])
  }).strict(),
  CollectionResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({
      code: "custom",
      path: ["snapshot"],
      message: "Collection formula-column snapshots must match the request identity."
    });
  }
  if (result.status !== "committed") return;
  const column = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId);
  if (column?.calculation?.kind !== "pige_numeric_formula") {
    context.addIssue({
      code: "custom",
      path: ["columnId"],
      message: "Committed Collection formula columns must appear in the authoritative snapshot."
    });
  }
});

const CollectionUpdateFormulaColumnResultIdentitySchema = CollectionResultIdentitySchema.extend({
  columnId: DatasetQueryColumnIdSchema
}).strict();

export const CollectionUpdateFormulaColumnResultSchema = z.discriminatedUnion("status", [
  CollectionUpdateFormulaColumnResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionUpdateFormulaColumnResultIdentitySchema.extend({
    status: z.literal("stale"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionUpdateFormulaColumnResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionUpdateFormulaColumnResultIdentitySchema.extend({
    status: z.literal("invalid"),
    reason: z.enum(["not_pige_formula", "imported_formula", "ineligible_operand", "no_change"])
  }).strict(),
  CollectionUpdateFormulaColumnResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({
      code: "custom",
      path: ["snapshot"],
      message: "Collection formula-update snapshots must match the request identity."
    });
  }
  if (result.status !== "committed") return;
  const column = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId);
  if (column?.calculation?.kind !== "pige_numeric_formula") {
    context.addIssue({
      code: "custom",
      path: ["columnId"],
      message: "Committed formula updates must project the current Pige formula column."
    });
  }
});

const CollectionAddRelationColumnResultIdentitySchema = CollectionResultIdentitySchema.extend({
  targetTableId: DatasetQueryTableIdSchema,
  targetDisplayColumnId: DatasetQueryColumnIdSchema
}).strict();

export const CollectionAddRelationColumnResultSchema = z.discriminatedUnion("status", [
  CollectionAddRelationColumnResultIdentitySchema.extend({
    status: z.literal("committed"),
    columnId: DatasetQueryColumnIdSchema,
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionAddRelationColumnResultIdentitySchema.extend({
    status: z.literal("stale"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionAddRelationColumnResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionAddRelationColumnResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  CollectionAddRelationColumnResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({
      code: "custom",
      path: ["snapshot"],
      message: "Collection relation-column snapshots must match the request identity."
    });
  }
  if (result.status !== "committed") return;
  const column = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId);
  if (column?.relation?.targetTableId !== result.targetTableId ||
      column.relation.targetDisplayColumnId !== result.targetDisplayColumnId) {
    context.addIssue({
      code: "custom",
      path: ["columnId"],
      message: "Committed relation columns must project the exact descriptor."
    });
  }
});

const CollectionUpdateRelationColumnResultIdentitySchema = CollectionResultIdentitySchema.extend({
  columnId: DatasetQueryColumnIdSchema,
  targetTableId: DatasetQueryTableIdSchema,
  targetDisplayColumnId: DatasetQueryColumnIdSchema
}).strict();

export const CollectionUpdateRelationColumnResultSchema = z.discriminatedUnion("status", [
  CollectionUpdateRelationColumnResultIdentitySchema.extend({
    status: z.literal("committed"), operationId: OperationIdSchema, snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionUpdateRelationColumnResultIdentitySchema.extend({
    status: z.literal("stale"), snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionUpdateRelationColumnResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionUpdateRelationColumnResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  CollectionUpdateRelationColumnResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({ code: "custom", path: ["snapshot"], message: "Collection relation-update snapshots must match the request identity." });
  }
  if (result.status !== "committed") return;
  const descriptor = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId)?.relation;
  if (descriptor?.targetTableId !== result.targetTableId || descriptor.targetDisplayColumnId !== result.targetDisplayColumnId) {
    context.addIssue({ code: "custom", path: ["columnId"], message: "Committed relation updates must project the exact descriptor." });
  }
});

const CollectionEditRelationCellResultIdentitySchema = CollectionResultIdentitySchema.extend({
  rowId: DatasetQueryRowIdSchema,
  columnId: DatasetQueryColumnIdSchema,
  targetRowId: DatasetQueryRowIdSchema.nullable()
}).strict();

export const CollectionEditRelationCellResultSchema = z.discriminatedUnion("status", [
  CollectionEditRelationCellResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionEditRelationCellResultIdentitySchema.extend({
    status: z.literal("stale"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionEditRelationCellResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionEditRelationCellResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  CollectionEditRelationCellResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({
      code: "custom",
      path: ["snapshot"],
      message: "Collection relation-cell snapshots must match the request identity."
    });
  }
  const column = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId);
  if (column?.relation?.kind !== "pige_single_relation") {
    context.addIssue({
      code: "custom",
      path: ["columnId"],
      message: "Relation-cell snapshots must retain the current relation descriptor."
    });
  }
  if (result.status !== "committed") return;
  const row = result.snapshot.rows.find((candidate) => candidate.rowId === result.rowId);
  const cell = row?.cells.find((candidate) => candidate.columnId === result.columnId);
  if (cell !== undefined) {
    const value = typeof cell.value === "object" && cell.value !== null &&
      "kind" in cell.value && cell.value.kind === "relation" ? cell.value : undefined;
    if (value?.targetRowId !== result.targetRowId) {
      context.addIssue({
        code: "custom",
        path: ["snapshot", "rows"],
        message: "Visible committed relation cells must match the requested target identity."
      });
    }
  }
});

const CollectionAddLookupColumnResultIdentitySchema = CollectionResultIdentitySchema.extend({
  relationColumnId: DatasetQueryColumnIdSchema,
  targetColumnId: DatasetQueryColumnIdSchema
}).strict();

export const CollectionAddLookupColumnResultSchema = z.discriminatedUnion("status", [
  CollectionAddLookupColumnResultIdentitySchema.extend({
    status: z.literal("committed"), columnId: DatasetQueryColumnIdSchema,
    operationId: OperationIdSchema, snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionAddLookupColumnResultIdentitySchema.extend({
    status: z.literal("stale"), snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionAddLookupColumnResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionAddLookupColumnResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  CollectionAddLookupColumnResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({ code: "custom", path: ["snapshot"], message: "Collection lookup snapshots must match the request identity." });
  }
  if (result.status !== "committed") return;
  const column = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId);
  if (column?.lookup?.relationColumnId !== result.relationColumnId ||
      column.lookup.targetColumnId !== result.targetColumnId) {
    context.addIssue({ code: "custom", path: ["columnId"], message: "Committed lookup columns must project the exact descriptor." });
  }
});

const CollectionUpdateLookupColumnResultIdentitySchema = CollectionResultIdentitySchema.extend({
  columnId: DatasetQueryColumnIdSchema,
  relationColumnId: DatasetQueryColumnIdSchema,
  targetColumnId: DatasetQueryColumnIdSchema
}).strict();

export const CollectionUpdateLookupColumnResultSchema = z.discriminatedUnion("status", [
  CollectionUpdateLookupColumnResultIdentitySchema.extend({
    status: z.literal("committed"), operationId: OperationIdSchema, snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionUpdateLookupColumnResultIdentitySchema.extend({
    status: z.literal("stale"), snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionUpdateLookupColumnResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionUpdateLookupColumnResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  CollectionUpdateLookupColumnResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({ code: "custom", path: ["snapshot"], message: "Collection lookup-update snapshots must match the request identity." });
  }
  if (result.status !== "committed") return;
  const descriptor = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId)?.lookup;
  if (descriptor?.relationColumnId !== result.relationColumnId || descriptor.targetColumnId !== result.targetColumnId) {
    context.addIssue({ code: "custom", path: ["columnId"], message: "Committed lookup updates must project the exact descriptor." });
  }
});

const CollectionAddRollupColumnResultIdentitySchema = CollectionResultIdentitySchema.extend({
  relationColumnId: DatasetQueryColumnIdSchema,
  aggregation: z.enum(["count", "sum"]),
  targetColumnId: DatasetQueryColumnIdSchema.optional()
}).strict();

export const CollectionAddRollupColumnResultSchema = z.discriminatedUnion("status", [
  CollectionAddRollupColumnResultIdentitySchema.extend({
    status: z.literal("committed"), columnId: DatasetQueryColumnIdSchema,
    operationId: OperationIdSchema, snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionAddRollupColumnResultIdentitySchema.extend({
    status: z.literal("stale"), snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionAddRollupColumnResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionAddRollupColumnResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  CollectionAddRollupColumnResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({ code: "custom", path: ["snapshot"], message: "Collection rollup snapshots must match the request identity." });
  }
  if (result.status !== "committed") return;
  const descriptor = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId)?.rollup;
  if (descriptor?.relationColumnId !== result.relationColumnId || descriptor.aggregation !== result.aggregation ||
      descriptor.targetColumnId !== result.targetColumnId) {
    context.addIssue({ code: "custom", path: ["columnId"], message: "Committed rollup columns must project the exact descriptor." });
  }
});

const CollectionUpdateRollupColumnResultIdentitySchema = CollectionResultIdentitySchema.extend({
  columnId: DatasetQueryColumnIdSchema,
  relationColumnId: DatasetQueryColumnIdSchema,
  aggregation: z.enum(["count", "sum"]),
  targetColumnId: DatasetQueryColumnIdSchema.optional()
}).strict();

export const CollectionUpdateRollupColumnResultSchema = z.discriminatedUnion("status", [
  CollectionUpdateRollupColumnResultIdentitySchema.extend({
    status: z.literal("committed"), operationId: OperationIdSchema, snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionUpdateRollupColumnResultIdentitySchema.extend({
    status: z.literal("stale"), snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionUpdateRollupColumnResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionUpdateRollupColumnResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  CollectionUpdateRollupColumnResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({ code: "custom", path: ["snapshot"], message: "Collection rollup-update snapshots must match the request identity." });
  }
  if (result.status !== "committed") return;
  const descriptor = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId)?.rollup;
  if (descriptor?.relationColumnId !== result.relationColumnId || descriptor.aggregation !== result.aggregation ||
      descriptor.targetColumnId !== result.targetColumnId) {
    context.addIssue({ code: "custom", path: ["columnId"], message: "Committed rollup updates must project the exact descriptor." });
  }
});

const CollectionRenameColumnResultIdentitySchema = CollectionResultIdentitySchema.extend({
  columnId: DatasetQueryColumnIdSchema
}).strict();

export const CollectionRenameColumnResultSchema = z.discriminatedUnion("status", [
  CollectionRenameColumnResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionRenameColumnResultIdentitySchema.extend({
    status: z.literal("stale"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionRenameColumnResultIdentitySchema.extend({
    status: z.literal("duplicate"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionRenameColumnResultIdentitySchema.extend({
    status: z.literal("ineligible"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionRenameColumnResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionRenameColumnResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (!("snapshot" in result)) return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({
      code: "custom",
      path: ["snapshot"],
      message: "Collection column-rename snapshots must match the request identity."
    });
  }
  if (!result.snapshot.columns.some((column) => column.columnId === result.columnId)) {
    context.addIssue({
      code: "custom",
      path: ["columnId"],
      message: "Collection column-rename snapshots must retain the stable column identity."
    });
  }
  const column = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId);
  if (result.status === "ineligible" && column?.canRename !== false) {
    context.addIssue({
      code: "custom",
      path: ["snapshot", "columns"],
      message: "Ineligible Collection column renames must fail closed in the authoritative snapshot."
    });
  }
});

const CollectionTrashColumnResultIdentitySchema = CollectionResultIdentitySchema.extend({
  columnId: DatasetQueryColumnIdSchema
}).strict();

export const CollectionTrashColumnResultSchema = z.discriminatedUnion("status", [
  CollectionTrashColumnResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionTrashColumnResultIdentitySchema.extend({
    status: z.literal("stale"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionTrashColumnResultIdentitySchema.extend({
    status: z.literal("ineligible"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionTrashColumnResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionTrashColumnResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (!("snapshot" in result)) return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({
      code: "custom",
      path: ["snapshot"],
      message: "Collection column-trash snapshots must match the request identity."
    });
  }
  const column = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId);
  if (result.status === "committed" && column !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["columnId"],
      message: "A committed Collection column trash must remove the column from the current snapshot."
    });
  }
  if (result.status === "stale" && column === undefined) {
    context.addIssue({
      code: "custom",
      path: ["columnId"],
      message: "A stale Collection column-trash snapshot must retain the stable column identity."
    });
  }
  if (result.status === "ineligible" && column?.canTrash !== false) {
    context.addIssue({
      code: "custom",
      path: ["snapshot", "columns"],
      message: "Ineligible Collection column trash must fail closed in the authoritative snapshot."
    });
  }
});

export const CollectionCreateViewResultSchema = z.discriminatedUnion("status", [
  CollectionResultIdentitySchema.extend({
    status: z.literal("committed"),
    viewId: ViewIdSchema,
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionResultIdentitySchema.extend({
    status: z.literal("stale"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionResultIdentitySchema.extend({
    status: z.literal("duplicate"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionResultIdentitySchema.extend({
    status: z.literal("ineligible"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (!("snapshot" in result)) return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({
      code: "custom",
      path: ["snapshot"],
      message: "Collection view-creation snapshots must match the request identity."
    });
  }
  if (result.status === "committed") {
    const created = result.snapshot.views.find(({ viewId }) => viewId === result.viewId);
    if (created === undefined || result.snapshot.activeViewId !== result.viewId) {
      context.addIssue({
        code: "custom",
        path: ["viewId"],
        message: "Committed Collection views must be present and active in the authoritative snapshot."
      });
    }
  }
});

const CollectionViewMutationResultIdentitySchema = z.object(CollectionViewMutationIdentityShape).strict();

export const CollectionRenameViewResultSchema = z.discriminatedUnion("status", [
  CollectionViewMutationResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({
    status: z.literal("stale"),
    currentViewRevision: z.number().int().positive(),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({ status: z.literal("duplicate"), snapshot: CollectionSnapshotSchema }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({ status: z.literal("ineligible"), snapshot: CollectionSnapshotSchema }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => validateCollectionViewMutationResult(result, context, "rename"));

export const CollectionUpdateViewResultSchema = z.discriminatedUnion("status", [
  CollectionViewMutationResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({
    status: z.literal("stale"),
    currentViewRevision: z.number().int().positive(),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({ status: z.literal("ineligible"), snapshot: CollectionSnapshotSchema }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => validateCollectionViewMutationResult(result, context, "update"));

export const CollectionTrashViewResultSchema = z.discriminatedUnion("status", [
  CollectionViewMutationResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({
    status: z.literal("stale"),
    currentViewRevision: z.number().int().positive(),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({ status: z.literal("ineligible"), snapshot: CollectionSnapshotSchema }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionViewMutationResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => validateCollectionViewMutationResult(result, context, "trash"));

function validateCollectionViewMutationResult(
  result: { readonly status: string; readonly datasetId: string; readonly tableId: string; readonly viewId: string; readonly currentViewRevision?: number; readonly snapshot?: z.infer<typeof CollectionSnapshotSchema> },
  context: z.RefinementCtx,
  action: "rename" | "update" | "trash"
): void {
  if (!result.snapshot) return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({ code: "custom", path: ["snapshot"], message: "Collection view mutation snapshots must match the request identity." });
    return;
  }
  const view = result.snapshot.views.find((candidate) => candidate.viewId === result.viewId);
  if (result.status === "committed" && action === "trash" && (view || result.snapshot.activeViewId === result.viewId)) {
    context.addIssue({ code: "custom", path: ["viewId"], message: "A trashed Collection view must fall back to All Rows." });
  }
  if (result.status === "committed" && action === "rename" && (!view || view.viewRevision <= 1)) {
    context.addIssue({ code: "custom", path: ["viewId"], message: "A renamed Collection view must retain its stable identity at a later revision." });
  }
  if (result.status === "committed" && action === "update" && (!view || view.viewRevision <= 1)) {
    context.addIssue({ code: "custom", path: ["viewId"], message: "An updated Collection view must retain its stable identity at a later revision." });
  }
  if (result.status === "stale" && view && view.viewRevision !== result.currentViewRevision) {
    context.addIssue({ code: "custom", path: ["currentViewRevision"], message: "Stale Collection view snapshots must expose current immutable view identity." });
  }
  if (result.status === "ineligible" && action !== "update" && view && (action === "rename" ? view.canRename : view.canTrash)) {
    context.addIssue({ code: "custom", path: ["snapshot", "views"], message: "Ineligible Collection view actions must fail closed." });
  }
}

const CollectionTrashRowResultIdentitySchema = CollectionResultIdentitySchema.extend({
  rowId: DatasetQueryRowIdSchema
}).strict();

export const CollectionTrashRowResultSchema = z.discriminatedUnion("status", [
  CollectionTrashRowResultIdentitySchema.extend({
    status: z.literal("committed"),
    operationId: OperationIdSchema,
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionTrashRowResultIdentitySchema.extend({
    status: z.literal("stale"),
    snapshot: CollectionSnapshotSchema
  }).strict(),
  CollectionTrashRowResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionTrashRowResultIdentitySchema.extend({ status: z.literal("ineligible") }).strict(),
  CollectionTrashRowResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "committed" && result.status !== "stale") return;
  if (result.snapshot.datasetId !== result.datasetId || result.snapshot.tableId !== result.tableId) {
    context.addIssue({
      code: "custom",
      path: ["snapshot"],
      message: "Collection row-trash snapshots must match the request identity."
    });
  }
  if (result.status === "committed" && result.snapshot.rows.some((row) => row.rowId === result.rowId)) {
    context.addIssue({
      code: "custom",
      path: ["rowId"],
      message: "A committed Collection row trash must remove the row from the authoritative snapshot."
    });
  }
});

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
  mode: z.enum(["lexical_markdown_scan", "lexical_sqlite_fts", "semantic_hybrid"]),
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  invalidPageCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  degraded: z.boolean(),
  degradedReason: z.enum([
    "local_database_not_ready",
    "local_rag_not_installed",
    "local_rag_unavailable"
  ]).optional(),
  results: z.array(RetrievalSearchResultItemSchema).max(20).readonly()
}).strict();

export const LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID = "qwen3_embedding_0_6b_q8_0" as const;
export const LOCAL_SEMANTIC_RETRIEVAL_ASSET_REVISION =
  "c2602621d50895a7b8277ddd4a8c31e699c9d002" as const;
export const LOCAL_SEMANTIC_RETRIEVAL_ASSET_SHA256 =
  "sha256:06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439" as const;
export const LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES = 639_150_592 as const;

export const LocalSemanticRetrievalRequestIdSchema = z.string()
  .regex(/^ragasset_[a-z0-9]{16,64}$/u);
export const LocalSemanticRetrievalAssetStateSchema = z.enum([
  "not_installed",
  "installing",
  "verifying",
  "ready",
  "disabled",
  "needs_repair"
]);
export const LocalSemanticRetrievalStatusRequestSchema = z.object({
  apiVersion: z.literal(1)
}).strict();
export const LocalSemanticRetrievalStatusSchema = z.object({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  assetId: z.literal(LOCAL_SEMANTIC_RETRIEVAL_ASSET_ID),
  assetState: LocalSemanticRetrievalAssetStateSchema,
  downloadSizeBytes: z.literal(LOCAL_SEMANTIC_RETRIEVAL_ASSET_BYTES),
  lexicalSearchRemainsAvailable: z.literal(true),
  activeJobId: JobIdSchema.optional()
}).strict().superRefine((status, context) => {
  const jobActive = status.assetState === "installing" || status.assetState === "verifying";
  if (jobActive !== (status.activeJobId !== undefined)) {
    context.addIssue({
      code: "custom",
      message: "Only an active install or verification may expose an active Job identity.",
      path: ["activeJobId"]
    });
  }
});

const LocalSemanticRetrievalMutationRequestIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: LocalSemanticRetrievalRequestIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const LocalSemanticRetrievalInstallRequestSchema =
  LocalSemanticRetrievalMutationRequestIdentitySchema;
export const LocalSemanticRetrievalEnableRequestSchema =
  LocalSemanticRetrievalMutationRequestIdentitySchema;
export const LocalSemanticRetrievalDisableRequestSchema =
  LocalSemanticRetrievalMutationRequestIdentitySchema;
export const LocalSemanticRetrievalRemoveRequestSchema =
  LocalSemanticRetrievalMutationRequestIdentitySchema;

const LocalSemanticRetrievalMutationResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: LocalSemanticRetrievalRequestIdSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const LocalSemanticRetrievalInstallResultSchema = z.discriminatedUnion("status", [
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("accepted"),
    jobId: JobIdSchema
  }).strict(),
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("already_installed")
  }).strict(),
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("stale")
  }).strict(),
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("failed")
  }).strict()
]);
export const LocalSemanticRetrievalEnableResultSchema = z.discriminatedUnion("status", [
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("committed")
  }).strict(),
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("already_enabled")
  }).strict(),
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("stale")
  }).strict(),
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("not_found")
  }).strict(),
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("failed")
  }).strict()
]);
export const LocalSemanticRetrievalMutationResultSchema = z.discriminatedUnion("status", [
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("committed")
  }).strict(),
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("stale")
  }).strict(),
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("not_found")
  }).strict(),
  LocalSemanticRetrievalMutationResultIdentitySchema.extend({
    status: z.literal("failed")
  }).strict()
]);
export const LocalSemanticRetrievalDisableResultSchema =
  LocalSemanticRetrievalMutationResultSchema;
export const LocalSemanticRetrievalRemoveResultSchema =
  LocalSemanticRetrievalMutationResultSchema;

export const LOCAL_RERANKER_ASSET_ID = "qwen3_reranker_0_6b_q3_k_m" as const;
export const LOCAL_RERANKER_ASSET_REVISION =
  "tensorblock-4bf3a1660c61f2754fc18035fb1d728d9b8735fc-q3_k_m" as const;
export const LOCAL_RERANKER_ASSET_SHA256 =
  "sha256:6e60eb5e4bcb695ff3f0e164b542dfaae90d7311845f434a451daa55e6a93c77" as const;
export const LOCAL_RERANKER_ASSET_BYTES = 346_896_352 as const;

export const LocalRerankerRequestIdSchema = z.string()
  .regex(/^rerankasset_[a-z0-9]{16,64}$/u);
export const LocalRerankerStatusRequestSchema = z.object({ apiVersion: z.literal(1) }).strict();
export const LocalRerankerStatusSchema = z.object({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  assetId: z.literal(LOCAL_RERANKER_ASSET_ID),
  assetState: LocalSemanticRetrievalAssetStateSchema,
  downloadSizeBytes: z.literal(LOCAL_RERANKER_ASSET_BYTES),
  hybridSearchRemainsAvailable: z.literal(true),
  activeJobId: JobIdSchema.optional()
}).strict().superRefine((status, context) => {
  const active = status.assetState === "installing" || status.assetState === "verifying";
  if (active !== (status.activeJobId !== undefined)) {
    context.addIssue({ code: "custom", message: "Only an active reranker install may expose a Job.", path: ["activeJobId"] });
  }
});

const LocalRerankerMutationRequestIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: LocalRerankerRequestIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const LocalRerankerInstallRequestSchema = LocalRerankerMutationRequestIdentitySchema;
export const LocalRerankerEnableRequestSchema = LocalRerankerMutationRequestIdentitySchema;
export const LocalRerankerDisableRequestSchema = LocalRerankerMutationRequestIdentitySchema;
export const LocalRerankerRemoveRequestSchema = LocalRerankerMutationRequestIdentitySchema;

const LocalRerankerMutationResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: LocalRerankerRequestIdSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const LocalRerankerInstallResultSchema = z.discriminatedUnion("status", [
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("accepted"), jobId: JobIdSchema }).strict(),
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("already_installed") }).strict(),
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const LocalRerankerEnableResultSchema = z.discriminatedUnion("status", [
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("committed") }).strict(),
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("already_enabled") }).strict(),
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const LocalRerankerMutationResultSchema = z.discriminatedUnion("status", [
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("committed") }).strict(),
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  LocalRerankerMutationResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const LocalRerankerDisableResultSchema = LocalRerankerMutationResultSchema;
export const LocalRerankerRemoveResultSchema = LocalRerankerMutationResultSchema;

export const PADDLE_OCR_ENGINE_ID = "paddleocr_local" as const;
export const PaddleOcrRequestIdSchema = z.string()
  .regex(/^paddleocr_[a-z0-9]{16,64}$/u);
export const PaddleOcrLifecycleStateSchema = z.enum([
  "not_installed",
  "ready",
  "disabled",
  "needs_repair",
  "unsupported"
]);
export const PaddleOcrLifecycleActionSchema = z.enum([
  "install",
  "enable",
  "test",
  "disable",
  "remove"
]);
export const PaddleOcrCatalogComponentSchema = z.object({
  componentId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u),
  kind: z.enum(["python_runtime", "engine", "model", "language_pack"]),
  label: z.string().trim().min(1).max(80),
  version: z.string().trim().min(1).max(64),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const PaddleOcrSummaryRequestSchema = z.object({
  apiVersion: z.literal(1)
}).strict();
export const PaddleOcrSummarySchema = z.object({
  apiVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  engineId: z.literal(PADDLE_OCR_ENGINE_ID),
  state: PaddleOcrLifecycleStateSchema,
  catalogVersion: z.string().trim().min(1).max(64),
  components: z.array(PaddleOcrCatalogComponentSchema).min(1).max(16).readonly(),
  downloadSizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  nativeOcrPreferred: z.literal(true),
  hiddenDownloadsAllowed: z.literal(false),
  activeAction: PaddleOcrLifecycleActionSchema.optional(),
  activeJobId: JobIdSchema.optional(),
  canInstall: z.boolean(),
  canEnable: z.boolean(),
  canTest: z.boolean(),
  canDisable: z.boolean(),
  canRemove: z.boolean()
}).strict().superRefine((summary, context) => {
  if ((summary.activeAction === undefined) !== (summary.activeJobId === undefined)) {
    context.addIssue({
      code: "custom",
      message: "PaddleOCR active action and Job identity must be projected together.",
      path: ["activeJobId"]
    });
  }
  const expectedActions = summary.activeAction
    ? [false, false, false, false, false]
    : summary.state === "not_installed"
      ? [true, false, false, false, false]
      : summary.state === "ready"
        ? [false, false, true, true, true]
        : summary.state === "disabled"
          ? [false, true, true, false, true]
          : summary.state === "needs_repair"
            ? [false, false, false, false, true]
            : [false, false, false, false, false];
  const actualActions = [
    summary.canInstall,
    summary.canEnable,
    summary.canTest,
    summary.canDisable,
    summary.canRemove
  ];
  if (!actualActions.every((value, index) => value === expectedActions[index])) {
    context.addIssue({
      code: "custom",
      message: "PaddleOCR actions must fail closed for the authoritative lifecycle state.",
      path: ["canInstall"]
    });
  }
});

const PaddleOcrMutationRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: PaddleOcrRequestIdSchema,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const PaddleOcrInstallRequestSchema = PaddleOcrMutationRequestSchema;
export const PaddleOcrEnableRequestSchema = PaddleOcrMutationRequestSchema;
export const PaddleOcrTestRequestSchema = PaddleOcrMutationRequestSchema;
export const PaddleOcrDisableRequestSchema = PaddleOcrMutationRequestSchema;
export const PaddleOcrRemoveRequestSchema = PaddleOcrMutationRequestSchema;

const PaddleOcrResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: PaddleOcrRequestIdSchema,
  engineId: z.literal(PADDLE_OCR_ENGINE_ID)
}).strict();
const PaddleOcrAuthoritativeResultSchema = PaddleOcrResultIdentitySchema.extend({
  summary: PaddleOcrSummarySchema
}).strict();
export const PaddleOcrInstallResultSchema = z.discriminatedUnion("status", [
  PaddleOcrAuthoritativeResultSchema.extend({
    status: z.literal("accepted"),
    jobId: JobIdSchema
  }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("already_installed") }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("denied") }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("stale") }).strict(),
  PaddleOcrResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const PaddleOcrEnableResultSchema = z.discriminatedUnion("status", [
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("committed") }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("already_enabled") }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("stale") }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("not_found") }).strict(),
  PaddleOcrResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const PaddleOcrTestResultSchema = z.discriminatedUnion("status", [
  PaddleOcrAuthoritativeResultSchema.extend({
    status: z.literal("accepted"),
    jobId: JobIdSchema
  }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("cancelled") }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("stale") }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("not_found") }).strict(),
  PaddleOcrResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
const PaddleOcrLifecycleMutationResultSchema = z.discriminatedUnion("status", [
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("committed") }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("already_current") }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("stale") }).strict(),
  PaddleOcrAuthoritativeResultSchema.extend({ status: z.literal("not_found") }).strict(),
  PaddleOcrResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const PaddleOcrDisableResultSchema = PaddleOcrLifecycleMutationResultSchema;
export const PaddleOcrRemoveResultSchema = PaddleOcrLifecycleMutationResultSchema;

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

const CollectionCitationAggregateKeySchema = z.string().min(1).max(120);

export const CollectionCitationHighlightSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rows"),
    rowIds: z.array(DatasetQueryRowIdSchema).min(1).max(50)
  }).strict(),
  z.object({
    kind: z.literal("range"),
    range: DatasetEvidenceRangeSchema
  }).strict(),
  z.object({
    kind: z.literal("columns"),
    columnIds: z.array(DatasetQueryColumnIdSchema).min(1).max(24)
  }).strict(),
  z.object({
    kind: z.literal("aggregate"),
    aggregateKeys: z.array(CollectionCitationAggregateKeySchema).min(1).max(32),
    groupKeys: z.array(CollectionCitationAggregateKeySchema).max(32)
  }).strict()
]).superRefine((highlight, context) => {
  const values = highlight.kind === "rows"
    ? highlight.rowIds
    : highlight.kind === "columns"
      ? highlight.columnIds
      : highlight.kind === "aggregate"
        ? [...highlight.aggregateKeys, ...highlight.groupKeys]
        : [];
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      message: "Collection citation highlight identities must be unique."
    });
  }
});

export const CollectionOpenCitationRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: CollectionRequestIdSchema,
  activeVaultId: VaultIdSchema,
  conversationId: ConversationIdSchema,
  assistantEventId: ConversationEventIdSchema,
  citationRef: DatasetCitationRefIdSchema
}).strict();

const CollectionOpenCitationIdentitySchema = CollectionOpenCitationRequestSchema.pick({
  apiVersion: true,
  requestId: true,
  activeVaultId: true,
  conversationId: true,
  assistantEventId: true,
  citationRef: true
});

export const CollectionOpenCitationResultSchema = z.discriminatedUnion("status", [
  CollectionOpenCitationIdentitySchema.extend({
    status: z.literal("ready"),
    mode: z.literal("citation_readonly"),
    preview: DatasetQueryPreviewSchema,
    highlights: z.array(CollectionCitationHighlightSchema).min(1).max(4)
  }).strict(),
  CollectionOpenCitationIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  CollectionOpenCitationIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  CollectionOpenCitationIdentitySchema.extend({ status: z.literal("failed") }).strict()
]).superRefine((result, context) => {
  if (result.status !== "ready") return;
  if (!result.preview.citationRefs.includes(result.citationRef)) {
    context.addIssue({
      code: "custom",
      path: ["preview", "citationRefs"],
      message: "Collection citation preview must contain the requested durable citation ref."
    });
  }
  const kinds = result.highlights.map(({ kind }) => kind);
  if (new Set(kinds).size !== kinds.length) {
    context.addIssue({
      code: "custom",
      path: ["highlights"],
      message: "Collection citation highlights must contain at most one target of each kind."
    });
  }
  if (!kinds.includes("columns")) {
    context.addIssue({
      code: "custom",
      path: ["highlights"],
      message: "Collection citation highlights must include the durable column identities."
    });
  }
});

export const ConversationEventSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: ConversationEventIdSchema,
  conversationId: ConversationIdSchema,
  languageContinuity: ConversationLanguageContinuitySchema.default({
    queryLanguage: { domain: "query", language: "unknown", basis: "legacy_missing" },
    responseLanguage: { domain: "response", language: "unknown", basis: "legacy_missing" }
  }),
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
  inputPresentation: AgentConversationInputPresentationSchema.optional(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  sourceId: SourceIdSchema.optional(),
  captureId: CaptureIdSchema.optional(),
  pageId: PageIdSchema.optional(),
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

export const JOB_RECONNECT_ORIGINAL_SOURCE_CHANNEL = "jobs.reconnectOriginalSource" as const;
export const ReferencedOriginalReconnectRequestIdSchema = z.string()
  .regex(/^sourcereconnectreq_[a-z0-9]{8,64}$/);
export const ReferencedOriginalReconnectRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: ReferencedOriginalReconnectRequestIdSchema,
  activeVaultId: VaultIdSchema,
  waitingJobId: JobIdSchema,
  expectedJobUpdatedAt: z.string().datetime({ offset: true }),
  previewId: SourceRelinkPreviewIdSchema.optional()
}).strict();
export const ReferencedOriginalReconnectJobProjectionSchema = z.object({
  id: JobIdSchema,
  class: JobClassSchema,
  state: JobStateSchema,
  stage: JobStageSchema.optional(),
  sourceId: SourceIdSchema,
  sourceDisplayName: z.string().min(1).max(512).optional(),
  sourceKind: SourceKindSchema.optional(),
  canReconnectDependency: z.literal(false),
  message: z.string().min(1).max(512),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();
const ReferencedOriginalReconnectResultIdentitySchema = ReferencedOriginalReconnectRequestSchema;
export const ReferencedOriginalReconnectResultSchema = z.discriminatedUnion("status", [
  ReferencedOriginalReconnectResultIdentitySchema.extend({
    status: z.literal("reconnected"),
    job: ReferencedOriginalReconnectJobProjectionSchema,
    operationId: OperationIdSchema,
    contentState: z.enum(["current", "changed"])
  }).strict(),
  ReferencedOriginalReconnectResultIdentitySchema.extend({
    status: z.literal("changed"),
    preview: ReferencedOriginalChangedPreviewSchema
  }).strict(),
  ReferencedOriginalReconnectResultIdentitySchema.extend({ status: z.literal("cancelled") }).strict(),
  ReferencedOriginalReconnectResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  ReferencedOriginalReconnectResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  ReferencedOriginalReconnectResultIdentitySchema.extend({ status: z.literal("mismatch") }).strict(),
  ReferencedOriginalReconnectResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
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
    "row",
    "column",
    "page",
    "conversation",
    "proposal",
    "operation",
    "memory",
    "skill",
    "package",
    "tool",
    "backup",
    "root_binding",
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

const SafeAttachmentDisplayNameSchema = z.string()
  .min(1)
  .max(160)
  .refine((value) => value.trim().length > 0, "Attachment display names must not be empty.")
  .refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value),
    "Attachment display names must not contain control or bidirectional override characters."
  )
  .refine(
    (value) => !/[\\/]/u.test(value),
    "Attachment display names must not contain path separators."
  );
export const CaptureFileRejectionReasonSchema = z.enum([
  "empty_path",
  "missing",
  "not_regular_file",
  "unsupported_type",
  "duplicate",
  "too_many_files",
  "file_too_large",
  "total_size_exceeded",
  "copy_failed"
]);
export const CaptureFileRejectionSchema = z.object({
  displayName: SafeAttachmentDisplayNameSchema,
  reason: CaptureFileRejectionReasonSchema
}).strict();
export const AgentStagedItemAcceptedRefSchema = z.object({
  ordinal: AgentStagedItemOrdinalSchema,
  kind: z.enum(["file", "large_paste"]),
  sourceId: SourceIdSchema
}).strict();
export const AgentStagedItemRejectedRefSchema = z.object({
  ordinal: AgentStagedItemOrdinalSchema,
  kind: z.literal("file"),
  displayName: SafeAttachmentDisplayNameSchema,
  reason: CaptureFileRejectionReasonSchema
}).strict();
export const AgentTurnAnswerSchema = z.object({
  answer: z.string().max(8_000),
  grounding: z.enum(["general", "local_knowledge", "source", "insufficient_evidence"]),
  citations: AgentAnswerCitationsSchema,
  retrieval: RetrievalSearchResultSchema.optional(),
  datasetResult: DatasetQueryPreviewSchema.optional()
}).strict();
export const AgentConversationCursorSchema = z.string()
  .regex(/^timeline_[a-f0-9]{32}$/)
  .max(80);
export const AGENT_CONVERSATION_HISTORY_PAGE_SIZE_MAX = 50;
export const AGENT_CONVERSATION_HISTORY_PREVIEW_MAX_CODE_POINTS = 240;
export const AGENT_CONVERSATION_HISTORY_QUERY_MAX_CODE_POINTS = 120;
export const AGENT_CONVERSATION_TITLE_MAX_CODE_POINTS = 120;
export const AgentConversationHistoryCursorSchema = z.string()
  .regex(/^conversation_history_[a-f0-9]{64}$/)
  .max(96);
export const ConversationRevisionSchema = z.string().regex(/^conversationrev_[a-f0-9]{64}$/);
export const ConversationTrashRequestIdSchema = z.string().regex(/^conversationtrashreq_[a-z0-9]{16,64}$/);
export const ConversationTrashEntryIdSchema = z.string().regex(/^conversationtrash_[a-f0-9]{32}$/);
export const AgentConversationHistoryQuerySchema = z.string()
  .min(1)
  .max(480)
  .refine((value) => value === value.trim(), "Conversation history queries must not have surrounding whitespace.")
  .refine(
    (value) => [...value].length <= AGENT_CONVERSATION_HISTORY_QUERY_MAX_CODE_POINTS,
    "Conversation history query exceeds the code-point limit."
  )
  .refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value),
    "Conversation history queries must be one safe display line."
  );
export const AgentConversationHistoryListRequestSchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  limit: z.number().int().min(1).max(AGENT_CONVERSATION_HISTORY_PAGE_SIZE_MAX).optional(),
  cursor: AgentConversationHistoryCursorSchema.optional(),
  query: AgentConversationHistoryQuerySchema.optional()
}).strict();
const AgentConversationHistoryPreviewSchema = z.string()
  .min(1)
  .refine(
    (value) => [...value].length <= AGENT_CONVERSATION_HISTORY_PREVIEW_MAX_CODE_POINTS,
    "Conversation history preview exceeds the code-point limit."
  )
  .refine(
    (value) => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value),
    "Conversation history preview must be one safe display line."
  );
export const AgentConversationHistorySearchMatchSchema = z.object({
  eventId: ConversationEventIdSchema,
  role: z.enum(["user", "assistant"]),
  createdAt: z.string().datetime({ offset: true }),
  safeExcerpt: AgentConversationHistoryPreviewSchema
}).strict();
export const AgentConversationTitleSchema = z.string()
  .min(1)
  .max(480)
  .refine((value) => value === value.trim(), "Conversation titles must not have surrounding whitespace.")
  .refine((value) => [...value].length <= AGENT_CONVERSATION_TITLE_MAX_CODE_POINTS,
    "Conversation title exceeds the code-point limit.")
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value),
    "Conversation titles must be one safe display line.");
const AgentConversationHistorySummaryBaseSchema = z.object({
  conversationId: ConversationIdSchema,
  updatedAt: z.string().datetime({ offset: true }),
  safePreview: AgentConversationHistoryPreviewSchema,
  tailEventId: ConversationEventIdSchema,
  revision: ConversationRevisionSchema.optional(),
  scope: AgentTurnCurrentNoteScopeSchema.optional(),
  inputPresentation: AgentConversationInputPresentationSchema.optional(),
  latestTurnState: JobStateSchema.optional(),
  searchMatch: AgentConversationHistorySearchMatchSchema.optional(),
  title: AgentConversationTitleSchema.optional(),
  titleRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
}).strict();
export const AgentConversationHistorySummarySchema = AgentConversationHistorySummaryBaseSchema.superRefine((summary, context) => {
  if (summary.title !== undefined && summary.titleRevision === undefined) {
    context.addIssue({ code: "custom", path: ["titleRevision"], message: "Conversation titles require a metadata revision." });
  }
});
const AgentConversationHistoryResultIdentitySchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  query: AgentConversationHistoryQuerySchema.optional()
});
export const AgentConversationHistoryReadyResultSchema = AgentConversationHistoryResultIdentitySchema.extend({
  status: z.literal("ready"),
  currentConversationId: ConversationIdSchema.optional(),
  conversations: z.array(AgentConversationHistorySummarySchema)
    .max(AGENT_CONVERSATION_HISTORY_PAGE_SIZE_MAX)
    .readonly(),
  hasMore: z.boolean(),
  nextCursor: AgentConversationHistoryCursorSchema.optional()
}).strict().superRefine((result, context) => {
  if (result.hasMore !== (result.nextCursor !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["nextCursor"],
      message: "Conversation history pagination truth is inconsistent."
    });
  }
  if ((result.conversations.length > 0 && result.currentConversationId === undefined) ||
    (result.query === undefined && result.conversations.length === 0 && result.currentConversationId !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["currentConversationId"],
      message: "Current conversation identity must exactly match non-empty history."
    });
  }
  if (new Set(result.conversations.map((summary) => summary.conversationId)).size !== result.conversations.length) {
    context.addIssue({
      code: "custom",
      path: ["conversations"],
      message: "Conversation history identities must be unique."
    });
  }
  if (result.query === undefined && result.conversations.some((summary) => summary.searchMatch !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["conversations"],
      message: "Conversation search matches require an exact query binding."
    });
  }
  for (let index = 1; index < result.conversations.length; index += 1) {
    const previous = result.conversations[index - 1]!;
    const current = result.conversations[index]!;
    const previousTime = Date.parse(previous.updatedAt);
    const currentTime = Date.parse(current.updatedAt);
    if (previousTime < currentTime ||
      (previousTime === currentTime && previous.conversationId.localeCompare(current.conversationId, "en") > 0)) {
      context.addIssue({
        code: "custom",
        path: ["conversations", index],
        message: "Conversation history must be ordered by updatedAt descending then conversationId."
      });
    }
  }
});
export const AgentConversationHistoryFailedResultSchema = AgentConversationHistoryResultIdentitySchema.extend({
  status: z.literal("failed")
}).strict();
export const AgentConversationHistoryListResultSchema = z.discriminatedUnion("status", [
  AgentConversationHistoryReadyResultSchema,
  AgentConversationHistoryFailedResultSchema
]);
export const ConversationTrashRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: ConversationTrashRequestIdSchema,
  activeVaultId: VaultIdSchema,
  conversationId: ConversationIdSchema,
  expectedRevision: ConversationRevisionSchema
}).strict();
const ConversationTrashResultIdentitySchema = ConversationTrashRequestSchema;
export const ConversationTrashResultSchema = z.discriminatedUnion("status", [
  ConversationTrashResultIdentitySchema.extend({
    status: z.literal("committed"),
    trashEntryId: ConversationTrashEntryIdSchema,
    operationId: OperationIdSchema
  }).strict(),
  ConversationTrashResultIdentitySchema.extend({ status: z.enum(["stale", "not_found", "failed"]) }).strict()
]);
export const ConversationTrashListRequestSchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema
}).strict();
export const ConversationTrashSummarySchema = z.object({
  trashEntryId: ConversationTrashEntryIdSchema,
  conversationId: ConversationIdSchema,
  safePreview: AgentConversationHistoryPreviewSchema,
  updatedAt: z.string().datetime({ offset: true }),
  trashedAt: z.string().datetime({ offset: true }),
  revision: ConversationRevisionSchema
}).strict();
export const ConversationTrashListResultSchema = z.discriminatedUnion("status", [
  ConversationTrashListRequestSchema.extend({
    status: z.literal("ready"),
    conversations: z.array(ConversationTrashSummarySchema).max(256).readonly()
  }).strict(),
  ConversationTrashListRequestSchema.extend({ status: z.literal("failed") }).strict()
]);
export const ConversationRestoreRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: ConversationTrashRequestIdSchema,
  activeVaultId: VaultIdSchema,
  trashEntryId: ConversationTrashEntryIdSchema,
  conversationId: ConversationIdSchema,
  expectedRevision: ConversationRevisionSchema
}).strict();
const ConversationRestoreResultIdentitySchema = ConversationRestoreRequestSchema;
export const ConversationRestoreResultSchema = z.discriminatedUnion("status", [
  ConversationRestoreResultIdentitySchema.extend({
    status: z.enum(["restored", "already_restored"]),
    operationId: OperationIdSchema
  }).strict(),
  ConversationRestoreResultIdentitySchema.extend({ status: z.enum(["stale", "not_found", "failed"]) }).strict()
]);
export const AGENT_CONVERSATION_EXPORT_CHANNEL = "agent.exportConversation" as const;
export const AGENT_CONVERSATION_EXPORT_EVENT_MAX = 4_096;
export const AGENT_CONVERSATION_EXPORT_MAX_UTF8_BYTES = 8 * 1024 * 1024;
export const AgentConversationExportRequestIdSchema = z.string()
  .regex(/^conversation_export_request_[a-z0-9]{16,64}$/u);
export const AgentConversationExportRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: AgentConversationExportRequestIdSchema,
  activeVaultId: VaultIdSchema,
  conversationId: ConversationIdSchema,
  expectedTailEventId: ConversationEventIdSchema
}).strict();
const AgentConversationExportIdentitySchema = AgentConversationExportRequestSchema.omit({
  expectedTailEventId: true
});
export const AgentConversationExportResultSchema = z.discriminatedUnion("status", [
  AgentConversationExportIdentitySchema.extend({
    status: z.literal("exported"),
    tailEventId: ConversationEventIdSchema,
    eventCount: z.number().int().positive().max(AGENT_CONVERSATION_EXPORT_EVENT_MAX)
  }).strict(),
  AgentConversationExportIdentitySchema.extend({
    status: z.literal("cancelled"),
    tailEventId: ConversationEventIdSchema
  }).strict(),
  AgentConversationExportIdentitySchema.extend({
    status: z.literal("stale"),
    currentTailEventId: ConversationEventIdSchema
  }).strict(),
  AgentConversationExportIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  AgentConversationExportIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
const AgentConversationExportPageCitationSchema = RetrievalAnswerCitationSchema.omit({ locator: true })
  .extend({ kind: z.literal("page") }).strict();
const AgentConversationExportDatasetCitationSchema = DatasetAnswerCitationSchema.omit({ locator: true }).strict();
export const AgentConversationExportCitationSchema = z.discriminatedUnion("kind", [
  AgentConversationExportPageCitationSchema,
  AgentConversationExportDatasetCitationSchema
]);
export const AgentConversationExportEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message"),
    eventId: ConversationEventIdSchema,
    role: z.enum(["user", "assistant"]),
    createdAt: z.string().datetime({ offset: true }),
    text: z.string().max(64 * 1024),
    citations: z.array(AgentConversationExportCitationSchema).max(8).readonly()
  }).strict(),
  z.object({
    kind: z.literal("source_reference"),
    eventId: ConversationEventIdSchema,
    eventType: z.enum(["capture_reference", "attachment_reference", "source_reference"]),
    createdAt: z.string().datetime({ offset: true }),
    parentEventId: ConversationEventIdSchema.optional(),
    sourceId: SourceIdSchema,
    displayName: SafeAttachmentDisplayNameSchema.optional(),
    sourceKind: SourceKindSchema.optional()
  }).strict()
]);
export const AgentConversationExportArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("pige_conversation"),
  conversationId: ConversationIdSchema,
  tailEventId: ConversationEventIdSchema,
  exportedAt: z.string().datetime({ offset: true }),
  events: z.array(AgentConversationExportEventSchema)
    .min(1)
    .max(AGENT_CONVERSATION_EXPORT_EVENT_MAX)
    .readonly()
}).strict().superRefine((artifact, context) => {
  const ids = artifact.events.map(({ eventId }) => eventId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["events"], message: "Conversation export event identities must be unique." });
  }
  const tail = [...artifact.events].reverse().find(({ kind }) => kind === "message");
  if (tail?.eventId !== artifact.tailEventId) {
    context.addIssue({ code: "custom", path: ["tailEventId"], message: "Conversation export tail must match the final message." });
  }
  if (new TextEncoder().encode(JSON.stringify(artifact)).byteLength > AGENT_CONVERSATION_EXPORT_MAX_UTF8_BYTES) {
    context.addIssue({ code: "custom", path: [], message: "Conversation export exceeds the bounded UTF-8 size." });
  }
});
export const AgentConversationTitleRequestIdSchema = z.string()
  .regex(/^conversation_title_request_[a-z0-9]{16,64}$/u);
export const AgentConversationSetTitleRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: AgentConversationTitleRequestIdSchema,
  activeVaultId: VaultIdSchema,
  conversationId: ConversationIdSchema,
  expectedTailEventId: ConversationEventIdSchema,
  expectedTitleRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  title: AgentConversationTitleSchema.nullable()
}).strict();
const AgentConversationTitleMutationIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: AgentConversationTitleRequestIdSchema,
  activeVaultId: VaultIdSchema,
  conversationId: ConversationIdSchema
}).strict();
const AgentConversationTitleMutationSummarySchema = AgentConversationHistorySummaryBaseSchema.extend({
  titleRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict();
export const AgentConversationSetTitleResultSchema = z.discriminatedUnion("status", [
  AgentConversationTitleMutationIdentitySchema.extend({
    status: z.literal("committed"), summary: AgentConversationTitleMutationSummarySchema
  }).strict(),
  AgentConversationTitleMutationIdentitySchema.extend({
    status: z.literal("stale"), summary: AgentConversationTitleMutationSummarySchema
  }).strict(),
  AgentConversationTitleMutationIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  AgentConversationTitleMutationIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);

export const AGENT_SAVE_ANSWER_AS_NOTE_CHANNEL = "agent.saveAnswerAsNote" as const;
export const AgentSaveAnswerAsNoteRequestIdSchema = z.string()
  .regex(/^answersavereq_[a-z0-9]{16,64}$/u);
export const AgentSaveAnswerAsNoteRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: AgentSaveAnswerAsNoteRequestIdSchema,
  activeVaultId: VaultIdSchema,
  conversationId: ConversationIdSchema,
  assistantEventId: ConversationEventIdSchema
}).strict();
const AgentSaveAnswerAsNoteResultIdentitySchema = AgentSaveAnswerAsNoteRequestSchema;
export const AgentSaveAnswerAsNoteResultSchema = z.discriminatedUnion("status", [
  AgentSaveAnswerAsNoteResultIdentitySchema.extend({
    status: z.literal("saved"),
    pageId: PageIdSchema,
    operationId: OperationIdSchema,
    title: z.string().min(1).max(120)
  }).strict(),
  AgentSaveAnswerAsNoteResultIdentitySchema.extend({ status: z.literal("stale") }).strict(),
  AgentSaveAnswerAsNoteResultIdentitySchema.extend({ status: z.literal("not_found") }).strict(),
  AgentSaveAnswerAsNoteResultIdentitySchema.extend({ status: z.literal("failed") }).strict()
]);
export const AgentConversationMetadataManifestSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  conversations: z.array(z.object({
    conversationId: ConversationIdSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    title: AgentConversationTitleSchema.nullable(),
    tailEventId: ConversationEventIdSchema,
    updatedAt: z.string().datetime({ offset: true }),
    lastRequestId: AgentConversationTitleRequestIdSchema
  }).strict()).max(512)
}).strict().superRefine((manifest, context) => {
  const ids = manifest.conversations.map((entry) => entry.conversationId);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && ids[index - 1]!.localeCompare(id, "en") >= 0)) {
    context.addIssue({ code: "custom", path: ["conversations"], message: "Conversation metadata must use unique sorted IDs." });
  }
});
export const AgentConversationMessageSchema = z.object({
  id: ConversationEventIdSchema,
  role: z.enum(["user", "assistant"]),
  createdAt: z.string().datetime({ offset: true }),
  text: z.string(),
  jobId: JobIdSchema.optional(),
  answer: AgentTurnAnswerSchema.optional(),
  inputPresentation: AgentConversationInputPresentationSchema.optional(),
  captureReferences: z.array(z.object({
    eventId: ConversationEventIdSchema,
    sourceId: SourceIdSchema,
    captureId: CaptureIdSchema,
    jobId: JobIdSchema,
    displayName: z.string().min(1).max(512),
    sourceKind: SourceKindSchema,
    pageId: PageIdSchema.optional()
  }).strict()).max(8).readonly().optional()
}).strict();
export const AgentConversationTurnSummarySchema = z.object({
  jobId: JobIdSchema,
  userEventId: ConversationEventIdSchema,
  state: JobStateSchema,
  proposalId: ProposalIdSchema.optional(),
  currentNoteAppendApplied: z.literal(true).optional(),
  error: PigeErrorSummarySchema.optional()
}).strict().superRefine((value, context) => {
  const ownsReview = value.state === "awaiting_review";
  if (ownsReview !== (value.proposalId !== undefined)) {
    context.addIssue({ code: "custom", path: ["proposalId"], message: "proposalId must exactly match awaiting_review ownership." });
  }
  if (value.currentNoteAppendApplied && value.state !== "completed" && value.state !== "completed_with_warnings") {
    context.addIssue({ code: "custom", path: ["currentNoteAppendApplied"], message: "A current-note append projection requires a completed turn." });
  }
});
export const AgentConversationInitialRequestSchema = z.object({
  conversationId: ConversationIdSchema.optional(),
  scope: AgentTurnCurrentNoteScopeSchema.optional(),
  limit: z.number().int().min(1).max(100).optional()
}).strict();
export const AgentConversationEarlierRequestSchema = z.object({
  conversationId: ConversationIdSchema,
  scope: AgentTurnCurrentNoteScopeSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  snapshotTailEventId: ConversationEventIdSchema,
  earlierCursor: AgentConversationCursorSchema
}).strict();
export const AgentConversationRequestSchema = z.union([
  AgentConversationEarlierRequestSchema,
  AgentConversationInitialRequestSchema
]);

function requireConversationPageConsistency(
  page: {
    readonly messages: readonly { readonly id: string }[];
    readonly hasEarlier: boolean;
    readonly nextEarlierCursor?: string | undefined;
  },
  context: z.RefinementCtx
): void {
  if (new Set(page.messages.map((message) => message.id)).size !== page.messages.length) {
    context.addIssue({ code: "custom", path: ["messages"], message: "Conversation page message ids must be unique." });
  }
  if (page.hasEarlier !== (page.nextEarlierCursor !== undefined)) {
    context.addIssue({ code: "custom", path: ["nextEarlierCursor"], message: "Conversation pagination truth is inconsistent." });
  }
}

export const AgentConversationInitialTimelineSchema = z.object({
  kind: z.literal("initial"),
  conversationId: ConversationIdSchema,
  snapshotTailEventId: ConversationEventIdSchema,
  tailEventId: ConversationEventIdSchema,
  canFollowUp: z.boolean(),
  messages: z.array(AgentConversationMessageSchema).max(100).readonly(),
  hasEarlier: z.boolean(),
  nextEarlierCursor: AgentConversationCursorSchema.optional(),
  latestTurn: AgentConversationTurnSummarySchema.optional()
}).strict().superRefine(requireConversationPageConsistency);
export const AgentConversationEarlierPageSchema = z.object({
  kind: z.literal("earlier"),
  conversationId: ConversationIdSchema,
  snapshotTailEventId: ConversationEventIdSchema,
  messages: z.array(AgentConversationMessageSchema).max(100).readonly(),
  hasEarlier: z.boolean(),
  nextEarlierCursor: AgentConversationCursorSchema.optional()
}).strict().superRefine(requireConversationPageConsistency);
export const AgentConversationResultSchema = z.discriminatedUnion("kind", [
  AgentConversationInitialTimelineSchema,
  AgentConversationEarlierPageSchema
]);
const AgentSubmitTurnResultBaseSchema = z.object({
  requestId: z.string().min(1).max(120),
  modelUsage: z.enum(["none", "local", "cloud"]),
  sourceIds: z.array(SourceIdSchema).max(8).readonly(),
  rejectedFiles: z.array(CaptureFileRejectionSchema).max(64).readonly().optional(),
  acceptedItems: z.array(AgentStagedItemAcceptedRefSchema).max(AGENT_STAGED_ITEM_MAX_COUNT).readonly().optional(),
  rejectedItems: z.array(AgentStagedItemRejectedRefSchema).max(64).readonly().optional()
});
export const AgentSubmitTurnAcceptedResultSchema = AgentSubmitTurnResultBaseSchema.extend({
  jobId: JobIdSchema,
  conversationEventId: ConversationEventIdSchema,
  conversationId: ConversationIdSchema,
  tailEventId: ConversationEventIdSchema,
  state: z.literal("accepted")
}).strict().superRefine((result, context) => {
  if (result.acceptedItems && (
    result.acceptedItems.length !== result.sourceIds.length ||
    result.acceptedItems.some((item, index) => item.sourceId !== result.sourceIds[index])
  )) {
    context.addIssue({ code: "custom", path: ["acceptedItems"], message: "Accepted item refs must match source order." });
  }
  const acceptedOrdinals = new Set(result.acceptedItems?.map((item) => item.ordinal) ?? []);
  if (acceptedOrdinals.size !== (result.acceptedItems?.length ?? 0)) {
    context.addIssue({ code: "custom", path: ["acceptedItems"], message: "Accepted item ordinals must be unique." });
  }
  const rejectedOrdinals = new Set(result.rejectedItems?.map((item) => item.ordinal) ?? []);
  if (rejectedOrdinals.size !== (result.rejectedItems?.length ?? 0)) {
    context.addIssue({ code: "custom", path: ["rejectedItems"], message: "Rejected item ordinals must be unique." });
  }
  if (result.rejectedItems?.some((item) => acceptedOrdinals.has(item.ordinal))) {
    context.addIssue({ code: "custom", path: ["rejectedItems"], message: "One staged item cannot be both accepted and rejected." });
  }
});
export const AgentSubmitTurnFailedResultSchema = AgentSubmitTurnResultBaseSchema.extend({
  jobId: JobIdSchema.optional(),
  conversationEventId: ConversationEventIdSchema.optional(),
  conversationId: ConversationIdSchema.optional(),
  tailEventId: ConversationEventIdSchema.optional(),
  state: z.literal("failed"),
  error: PigeErrorSummarySchema
}).strict();
export const AgentSubmitTurnResultSchema = z.discriminatedUnion("state", [
  AgentSubmitTurnResultBaseSchema.extend({
    jobId: JobIdSchema,
    conversationEventId: ConversationEventIdSchema,
    conversationId: ConversationIdSchema,
    tailEventId: ConversationEventIdSchema,
    state: z.literal("completed"),
    currentNoteAppendApplied: z.literal(true).optional(),
    answer: AgentTurnAnswerSchema
  }).strict(),
  AgentSubmitTurnResultBaseSchema.extend({
    jobId: JobIdSchema,
    conversationEventId: ConversationEventIdSchema,
    conversationId: ConversationIdSchema,
    tailEventId: ConversationEventIdSchema,
    state: z.literal("waiting"),
    proposalId: ProposalIdSchema.optional(),
    error: PigeErrorSummarySchema
  }).strict().superRefine((value, context) => {
    const ownsReview = value.error.code === "agent_runtime.review_required";
    if (ownsReview !== (value.proposalId !== undefined)) {
      context.addIssue({ code: "custom", path: ["proposalId"], message: "proposalId must exactly match review_required ownership." });
    }
  }),
  AgentSubmitTurnFailedResultSchema
]);
export const AgentStagedSubmitTurnResultSchema = z.union([
  AgentSubmitTurnAcceptedResultSchema,
  AgentSubmitTurnFailedResultSchema
]);
export const AgentSubmitTurnIpcResultSchema = z.union([
  AgentSubmitTurnAcceptedResultSchema,
  AgentSubmitTurnResultSchema
]);

export const CurrentNoteAppendProposalIdSchema = ProposalIdSchema;
export const CurrentNoteAppendProposalStateSchema = z.enum([
  "ready",
  "resolving",
  "applied",
  "rejected",
  "conflicted"
]);
export const CurrentNoteAppendProposalLineSchema = z.object({
  kind: z.enum(["context", "removed", "added"]),
  text: z.string().min(1).max(160)
}).strict();
export const CurrentNoteAppendProposalPreviewSchema = z.object({
  proposalId: CurrentNoteAppendProposalIdSchema,
  kind: z.literal("append_current_note"),
  state: CurrentNoteAppendProposalStateSchema,
  revision: z.number().int().min(1),
  activeVaultId: VaultIdSchema,
  pageId: PageIdSchema,
  jobId: JobIdSchema,
  currentRevision: NoteEditorRevisionSchema.optional(),
  lines: z.array(CurrentNoteAppendProposalLineSchema).max(8)
}).strict();
export const CurrentNoteAppendProposalGetRequestSchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  pageId: PageIdSchema,
  jobId: JobIdSchema,
  proposalId: CurrentNoteAppendProposalIdSchema
}).strict();
export const CurrentNoteAppendProposalGetResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("available"),
    proposal: CurrentNoteAppendProposalPreviewSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("unavailable"),
    reason: z.enum(["not_found", "vault_changed", "binding_changed", "record_invalid"])
  }).strict()
]);
export const CurrentNoteAppendProposalDecisionRequestSchema = CurrentNoteAppendProposalGetRequestSchema.extend({
  expectedRevision: z.number().int().min(1),
  decision: z.enum(["approve", "reject", "keep_current", "apply_proposed", "save_proposed_as_new_page"]),
  expectedCurrentRevision: NoteEditorRevisionSchema.optional()
}).strict().superRefine((value, context) => {
  if ((value.decision === "keep_current" || value.decision === "apply_proposed" || value.decision === "save_proposed_as_new_page") !== (value.expectedCurrentRevision !== undefined)) {
    context.addIssue({ code: "custom", path: ["expectedCurrentRevision"], message: "Conflict resolution requires the exact reviewed note revision." });
  }
});
export const CurrentNoteAppendProposalDecisionResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("applied"),
    proposal: CurrentNoteAppendProposalPreviewSchema.extend({ state: z.literal("applied") }),
    operationId: OperationIdSchema,
    createdPageId: PageIdSchema.optional()
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("rejected"),
    proposal: CurrentNoteAppendProposalPreviewSchema.extend({ state: z.literal("rejected") })
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("conflicted"),
    proposal: CurrentNoteAppendProposalPreviewSchema.extend({ state: z.literal("conflicted") })
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("stale"),
    proposal: CurrentNoteAppendProposalPreviewSchema.optional()
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("failed"),
    error: PigeErrorSummarySchema
  }).strict()
]);

export const CurrentNoteReplaceProposalIdSchema = ProposalIdSchema;
export const CurrentNoteReplaceProposalStateSchema = z.enum([
  "ready",
  "resolving",
  "applied",
  "rejected",
  "conflicted"
]);
export const CurrentNoteReplaceProposalLineSchema = z.object({
  kind: z.enum(["context", "removed", "added"]),
  text: z.string().min(1).max(160)
}).strict();
export const CurrentNoteReplaceProposalPreviewSchema = z.object({
  proposalId: CurrentNoteReplaceProposalIdSchema,
  kind: z.literal("replace_current_note"),
  state: CurrentNoteReplaceProposalStateSchema,
  revision: z.number().int().min(1),
  activeVaultId: VaultIdSchema,
  jobId: JobIdSchema,
  currentRevision: NoteEditorRevisionSchema.optional(),
  lines: z.array(CurrentNoteReplaceProposalLineSchema).max(8)
}).strict();
export const CurrentNoteReplaceProposalGetRequestSchema = z.object({
  apiVersion: z.literal(1),
  activeVaultId: VaultIdSchema,
  jobId: JobIdSchema,
  proposalId: CurrentNoteReplaceProposalIdSchema
}).strict();
export const CurrentNoteReplaceProposalGetResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("available"),
    proposal: CurrentNoteReplaceProposalPreviewSchema
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("stale")
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("not_found")
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("failed"),
    error: PigeErrorSummarySchema
  }).strict()
]);
export const CurrentNoteReplaceProposalDecisionRequestSchema = CurrentNoteReplaceProposalGetRequestSchema.extend({
  expectedRevision: z.number().int().min(1),
  decision: z.enum(["approve", "reject", "keep_current", "apply_proposed", "save_proposed_as_new_page"]),
  expectedCurrentRevision: NoteEditorRevisionSchema.optional()
}).strict().superRefine((value, context) => {
  if ((value.decision === "keep_current" || value.decision === "apply_proposed" || value.decision === "save_proposed_as_new_page") !== (value.expectedCurrentRevision !== undefined)) {
    context.addIssue({ code: "custom", path: ["expectedCurrentRevision"], message: "Conflict resolution requires the exact reviewed note revision." });
  }
});
export const CurrentNoteReplaceProposalDecisionResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("applied"),
    proposal: CurrentNoteReplaceProposalPreviewSchema.extend({ state: z.literal("applied") }),
    operationId: OperationIdSchema,
    createdPageId: PageIdSchema.optional()
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("rejected"),
    proposal: CurrentNoteReplaceProposalPreviewSchema.extend({ state: z.literal("rejected") })
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("conflicted"),
    proposal: CurrentNoteReplaceProposalPreviewSchema.extend({ state: z.literal("conflicted") })
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("stale"),
    proposal: CurrentNoteReplaceProposalPreviewSchema.optional()
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("not_found")
  }).strict(),
  z.object({
    apiVersion: z.literal(1),
    status: z.literal("failed"),
    error: PigeErrorSummarySchema
  }).strict()
]);

export const ReaderSelectionActionRequestIdSchema = z.string()
  .regex(/^readerselaction_[a-z0-9]{8,64}$/);
export const READER_SELECTION_ASK_QUESTION_MAX_CODE_POINTS = 4_000;
export const READER_SELECTION_ASK_QUESTION_MAX_UTF8_BYTES =
  READER_SELECTION_ASK_QUESTION_MAX_CODE_POINTS * 4;
export const ReaderSelectionAskQuestionSchema = z.string()
  .trim()
  .min(1)
  .refine(
    (value) => Array.from(value).length <= READER_SELECTION_ASK_QUESTION_MAX_CODE_POINTS,
    "Reader selection questions must contain at most 4000 Unicode characters."
  )
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= READER_SELECTION_ASK_QUESTION_MAX_UTF8_BYTES,
    "Reader selection questions exceed the UTF-8 byte bound."
  );
export const ReaderSelectionReadActionSchema = z.enum(["explain", "summarize", "ask"]);
const ReaderSelectionActionRequestIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: ReaderSelectionActionRequestIdSchema,
  selection: ReaderSelectionIdentitySchema,
  locale: LocaleSchema,
  clientTurnId: AgentClientTurnIdSchema
}).strict();
export const ReaderSelectionActionRequestSchema = z.discriminatedUnion("action", [
  ReaderSelectionActionRequestIdentitySchema.extend({ action: z.literal("explain") }).strict(),
  ReaderSelectionActionRequestIdentitySchema.extend({ action: z.literal("summarize") }).strict(),
  ReaderSelectionActionRequestIdentitySchema.extend({
    action: z.literal("ask"),
    question: ReaderSelectionAskQuestionSchema
  }).strict()
]);
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

export const ReaderSelectionLinkRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: ReaderSelectionActionRequestIdSchema,
  action: z.literal("link"),
  activeVaultId: VaultIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  selection: ReaderSelectionIdentitySchema,
  locale: LocaleSchema,
  clientTurnId: AgentClientTurnIdSchema
}).strict();
export const ReaderSelectionLinkResultSchema = z.discriminatedUnion("status", [
  z.object({
    apiVersion: z.literal(1),
    requestId: ReaderSelectionActionRequestIdSchema,
    status: z.literal("applied"),
    jobId: JobIdSchema,
    conversationEventId: ConversationEventIdSchema,
    conversationId: ConversationIdSchema,
    tailEventId: ConversationEventIdSchema,
    operationId: OperationIdSchema,
    currentPageId: PageIdSchema,
    targetPageId: PageIdSchema
  }).strict().superRefine((result, context) => {
    if (result.currentPageId === result.targetPageId) {
      context.addIssue({
        code: "custom",
        message: "A Reader selection link target must differ from the current page.",
        path: ["targetPageId"]
      });
    }
  }),
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
      "render_context_changed",
      "selection_changed",
      "selection_too_large",
      "mutation_ineligible",
      "target_not_found",
      "target_ambiguous",
      "target_self",
      "target_already_linked",
      "target_changed"
    ])
  }).strict()
]);

export const ReaderSelectionTransformActionSchema = z.enum(["translate", "polish", "expand", "shorten"]);
export const ReaderSelectionCreatePageActionSchema = z.enum([
  "create_note",
  "create_claim",
  "create_question",
  "create_concept",
  "create_entity",
  "create_topic"
]);
export const ReaderSelectionProposalActionSchema = z.union([
  ReaderSelectionTransformActionSchema,
  ReaderSelectionCreatePageActionSchema
]);
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
  action: ReaderSelectionProposalActionSchema,
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

export const ReaderSelectionCreateNoteRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: ReaderSelectionActionRequestIdSchema,
  action: ReaderSelectionCreatePageActionSchema,
  activeVaultId: VaultIdSchema,
  renderContextId: NoteRenderContextIdSchema,
  selection: ReaderSelectionIdentitySchema,
  locale: LocaleSchema,
  clientTurnId: AgentClientTurnIdSchema
}).strict();
export const ReaderSelectionCreateNoteResultSchema = z.discriminatedUnion("status", [
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
      "render_context_changed",
      "selection_changed",
      "selection_too_large",
      "mutation_ineligible",
      "generated_note_invalid"
    ])
  }).strict()
]).superRefine((result, context) => {
  if (result.status === "review_required" && !ReaderSelectionCreatePageActionSchema.safeParse(result.proposal.action).success) {
    context.addIssue({
      code: "custom",
      path: ["proposal", "action"],
      message: "A Reader create-page review must own a create-page proposal."
    });
  }
});

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
    operationId: OperationIdSchema,
    createdPageId: PageIdSchema.optional()
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
]).superRefine((result, context) => {
  if (result.status !== "applied") {
    return;
  }
  const expectsCreatedPage = ReaderSelectionCreatePageActionSchema.safeParse(result.proposal.action).success;
  if (expectsCreatedPage !== (result.createdPageId !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["createdPageId"],
      message: "Only an applied create-page proposal must return its created page identity."
    });
  }
});

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
    "external_source",
    "external_destination"
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

export const JobCompactionSummarySchema = z.object({
  schemaVersion: z.literal(1),
  compactedAt: z.string().datetime({ offset: true }),
  retentionCutoff: z.string().datetime({ offset: true }),
  previousState: z.enum(["completed", "completed_with_warnings"]),
  detailSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  removedCheckpointCount: z.number().int().nonnegative(),
  retainedReferenceCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional()
}).strict();

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
  permissionRequestIds: z.array(PermissionRequestIdSchema).max(32).refine(
    (ids) => new Set(ids).size === ids.length,
    "Permission request IDs must be unique."
  ).optional(),
  permissionDecisionIds: z.array(PermissionDecisionIdSchema).max(32).refine(
    (ids) => new Set(ids).size === ids.length,
    "Permission decision IDs must be unique."
  ).optional(),
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
  compaction: JobCompactionSummarySchema.optional(),
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
  if ((job.state === "compacted") !== (job.compaction !== undefined)) {
    context.addIssue({
      code: "custom",
      path: ["compaction"],
      message: "A compacted Job must include exactly one compaction summary."
    });
  }
});

export const JOB_CHANGED_EVENT_CHANNEL = "jobs.changed" as const;
export const JobChangedSummarySchema = z.object({
  id: JobIdSchema,
  class: JobClassSchema,
  state: JobStateSchema,
  stage: JobStageSchema.optional(),
  progress: z.object({
    completedUnits: z.number().nonnegative(),
    totalUnits: z.number().positive().optional(),
    unit: z.string().min(1).optional(),
    messageKey: z.string().min(1).optional()
  }).optional(),
  sourceId: SourceIdSchema.optional(),
  captureId: CaptureIdSchema.optional(),
  conversationEventId: ConversationEventIdSchema.optional(),
  sourceDisplayName: z.string().min(1).max(512).optional(),
  sourceKind: SourceKindSchema.optional(),
  backupKind: z.enum(["user_backup", "restore_rollback"]).optional(),
  canReconnectDependency: z.boolean(),
  canReconnectBackupDestination: z.boolean(),
  canContinueIncomplete: z.boolean(),
  canCancel: z.boolean(),
  canRetry: z.boolean(),
  error: PigeErrorSummarySchema.optional(),
  message: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true })
}).strict();
export const JobChangedEventSchema = z.object({
  apiVersion: z.literal(1),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  activeVaultId: VaultIdSchema,
  job: JobChangedSummarySchema
}).strict();

const AgentIngestStatementSchema = z.object({
  text: z.string().trim().min(1).max(1600),
  evidenceRefs: z.array(z.string().regex(/^ev_\d{2}$/)).max(8)
}).strict();

export const AgentIngestOutputSchema = z.object({
  pageType: MarkdownPageTypeSchema.exclude(["source"]).optional(),
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
    "row",
    "column",
    "view",
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
    "conversation",
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

export const ProposalReviewRequestIdSchema = z.string().regex(/^proposalreq_[a-z0-9]{16,64}$/);
export const ProposalReviewPreviewSchema = z.object({
  proposalId: ProposalIdSchema,
  jobId: JobIdSchema,
  revision: z.string().datetime({ offset: true }),
  state: z.enum(["ready", "approved", "applied", "rejected", "conflicted"]),
  trustLevel: ProposalTrustLevelSchema,
  summary: z.string().min(1).max(600),
  reason: z.string().min(1).max(1200),
  operationKinds: z.array(z.enum(["create", "update", "rename", "delete"])).max(32),
  warnings: z.array(z.string().min(1).max(600)).max(16)
}).strict();
const ProposalReviewIdentitySchema = z.object({
  apiVersion: z.literal(1),
  requestId: ProposalReviewRequestIdSchema,
  activeVaultId: VaultIdSchema,
  jobId: JobIdSchema,
  proposalId: ProposalIdSchema
}).strict();
export const ProposalReviewRequestSchema = ProposalReviewIdentitySchema;
export const ProposalReviewResultSchema = z.discriminatedUnion("status", [
  ProposalReviewIdentitySchema.extend({
    status: z.literal("available"),
    preview: ProposalReviewPreviewSchema
  }).strict(),
  ProposalReviewIdentitySchema.extend({
    status: z.enum(["not_found", "stale", "failed"])
  }).strict()
]);
export const ProposalReviewDecisionRequestSchema = ProposalReviewIdentitySchema.extend({
  expectedRevision: z.string().datetime({ offset: true }),
  decision: z.enum(["approve", "reject"])
}).strict();
export const ProposalReviewDecisionResultSchema = z.discriminatedUnion("status", [
  ProposalReviewIdentitySchema.extend({
    status: z.enum(["applied", "rejected"]),
    preview: ProposalReviewPreviewSchema
  }).strict(),
  ProposalReviewIdentitySchema.extend({
    status: z.enum(["not_found", "stale", "conflicted", "failed"]),
    preview: ProposalReviewPreviewSchema.optional()
  }).strict()
]);

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
  permissionDecisionIds: z.array(PermissionDecisionIdSchema).max(32).refine(
    (ids) => new Set(ids).size === ids.length,
    "Permission decision IDs must be unique."
  ).optional(),
  policyAudit: z.object({
    policyContextId: z.string().min(1),
    policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    enforcementOwners: z.array(z.string().min(1)).min(1)
  }).strict().optional(),
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
    "update_collection_cell",
    "add_collection_row",
    "add_collection_column",
    "update_collection_formula",
    "add_collection_relation",
    "update_collection_relation",
    "update_collection_relation_cell",
    "add_collection_lookup",
    "update_collection_lookup",
    "add_collection_rollup",
    "update_collection_rollup",
    "rename_collection_column",
    "create_collection_view",
    "update_collection_view",
    "rename_collection_view",
    "trash_collection_view",
    "restore_collection_view",
    "trash_collection_column",
    "trash_collection_row",
    "trash_dataset",
    "restore_dataset",
    "trash_artifact",
    "restore_artifact",
    "create_page",
    "update_page",
    "rename_page",
    "archive_page",
    "trash_page",
    "restore_page",
    "trash_conversation",
    "restore_conversation",
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

export const BackupMemoryIntegritySchema = z.object({
  schemaVersion: z.literal(1),
  sourceVaultId: VaultIdSchema,
  registryRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  registryChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  eventCount: z.number().int().nonnegative().max(1_000),
  recordCount: z.number().int().nonnegative().max(1_000),
  lifecycleReceiptCount: z.number().int().nonnegative(),
  restoreIntentCount: z.number().int().nonnegative(),
  operationCount: z.number().int().nonnegative()
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
  memoryIntegrity: BackupMemoryIntegritySchema.optional(),
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

export const MODEL_OPEN_API_KEY_MANAGEMENT_CHANNEL = "models.openApiKeyManagement" as const;
export const ProviderApiKeyManagementRequestSchema = z.object({
  apiVersion: z.literal(1),
  requestId: z.string().regex(/^providerhelp_[a-z0-9]{16,64}$/u),
  presetId: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/u)
}).strict();
export const ProviderApiKeyManagementResultSchema = z.discriminatedUnion("status", [
  ProviderApiKeyManagementRequestSchema.extend({ status: z.literal("opened") }).strict(),
  ProviderApiKeyManagementRequestSchema.extend({ status: z.literal("unavailable") }).strict(),
  ProviderApiKeyManagementRequestSchema.extend({ status: z.literal("failed") }).strict()
]);

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
  modelProfileId: z.string().regex(/^model_[a-z0-9_]+$/),
  expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/)
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
export type ProposalReviewPreview = z.infer<typeof ProposalReviewPreviewSchema>;
export type ProposalReviewRequest = z.infer<typeof ProposalReviewRequestSchema>;
export type ProposalReviewResult = z.infer<typeof ProposalReviewResultSchema>;
export type ProposalReviewDecisionRequest = z.infer<typeof ProposalReviewDecisionRequestSchema>;
export type ProposalReviewDecisionResult = z.infer<typeof ProposalReviewDecisionResultSchema>;
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;
export type AgentConversationInputPresentation = z.output<typeof AgentConversationInputPresentationSchema>;
export type AgentConversationHistoryCursor = z.output<typeof AgentConversationHistoryCursorSchema>;
export type AgentConversationHistoryQuery = z.output<typeof AgentConversationHistoryQuerySchema>;
export type AgentConversationHistoryListRequest = z.input<typeof AgentConversationHistoryListRequestSchema>;
export type AgentConversationHistorySummary = z.output<typeof AgentConversationHistorySummarySchema>;
export type AgentConversationHistorySearchMatch = z.output<typeof AgentConversationHistorySearchMatchSchema>;
export type AgentConversationHistoryListResult = z.output<typeof AgentConversationHistoryListResultSchema>;
export type AgentConversationExportRequestId = z.output<typeof AgentConversationExportRequestIdSchema>;
export type AgentConversationExportRequest = z.input<typeof AgentConversationExportRequestSchema>;
export type AgentConversationExportResult = z.output<typeof AgentConversationExportResultSchema>;
export type AgentConversationExportCitation = z.output<typeof AgentConversationExportCitationSchema>;
export type AgentConversationExportEvent = z.output<typeof AgentConversationExportEventSchema>;
export type AgentConversationExportArtifact = z.output<typeof AgentConversationExportArtifactSchema>;
export type ConversationRevision = z.output<typeof ConversationRevisionSchema>;
export type ConversationTrashRequestId = z.output<typeof ConversationTrashRequestIdSchema>;
export type ConversationTrashEntryId = z.output<typeof ConversationTrashEntryIdSchema>;
export type ConversationTrashRequest = z.input<typeof ConversationTrashRequestSchema>;
export type ConversationTrashResult = z.output<typeof ConversationTrashResultSchema>;
export type ConversationTrashListRequest = z.input<typeof ConversationTrashListRequestSchema>;
export type ConversationTrashSummary = z.output<typeof ConversationTrashSummarySchema>;
export type ConversationTrashListResult = z.output<typeof ConversationTrashListResultSchema>;
export type ConversationRestoreRequest = z.input<typeof ConversationRestoreRequestSchema>;
export type ConversationRestoreResult = z.output<typeof ConversationRestoreResultSchema>;
export type AgentConversationTitle = z.output<typeof AgentConversationTitleSchema>;
export type AgentConversationSetTitleRequest = z.input<typeof AgentConversationSetTitleRequestSchema>;
export type AgentConversationSetTitleResult = z.output<typeof AgentConversationSetTitleResultSchema>;
export type AgentSaveAnswerAsNoteRequestId = z.output<typeof AgentSaveAnswerAsNoteRequestIdSchema>;
export type AgentSaveAnswerAsNoteRequest = z.input<typeof AgentSaveAnswerAsNoteRequestSchema>;
export type AgentSaveAnswerAsNoteResult = z.output<typeof AgentSaveAnswerAsNoteResultSchema>;
export type AgentConversationMetadataManifest = z.output<typeof AgentConversationMetadataManifestSchema>;
export type AgentConversationMessage = z.output<typeof AgentConversationMessageSchema>;
export type AgentConversationTurnSummary = z.output<typeof AgentConversationTurnSummarySchema>;
export type AgentConversationInitialRequest = z.input<typeof AgentConversationInitialRequestSchema>;
export type AgentConversationEarlierRequest = z.input<typeof AgentConversationEarlierRequestSchema>;
export type AgentConversationRequest = z.input<typeof AgentConversationRequestSchema>;
export type AgentConversationInitialTimeline = z.output<typeof AgentConversationInitialTimelineSchema>;
export type AgentConversationEarlierPage = z.output<typeof AgentConversationEarlierPageSchema>;
export type AgentConversationResult = z.output<typeof AgentConversationResultSchema>;
export type AgentSubmitTurnRequest = z.input<typeof AgentSubmitTurnRequestSchema>;
export type AgentStagedItem = z.input<typeof AgentStagedItemSchema>;
export type AgentStagedLargePasteItem = z.input<typeof AgentStagedLargePasteItemSchema>;
export type AgentStagedItemRejectionReason = z.output<typeof AgentStagedItemRejectionReasonSchema>;
export type AgentStagedItemAcceptedRef = z.output<typeof AgentStagedItemAcceptedRefSchema>;
export type AgentStagedItemRejectedRef = z.output<typeof AgentStagedItemRejectedRefSchema>;
export type AgentAttachmentCandidate = z.output<typeof AgentAttachmentCandidateSchema>;
export type AgentSubmitTurnIpcPayload = z.output<typeof AgentSubmitTurnIpcPayloadSchema>;
export type AgentSubmitTurnResult = z.output<typeof AgentSubmitTurnResultSchema>;
export type AgentSubmitTurnAcceptedResult = z.output<typeof AgentSubmitTurnAcceptedResultSchema>;
export type AgentStagedSubmitTurnResult = z.output<typeof AgentStagedSubmitTurnResultSchema>;
export type AgentSubmitTurnIpcResult = z.output<typeof AgentSubmitTurnIpcResultSchema>;
export type CurrentNoteAppendProposalId = z.infer<typeof CurrentNoteAppendProposalIdSchema>;
export type CurrentNoteAppendProposalState = z.infer<typeof CurrentNoteAppendProposalStateSchema>;
export type CurrentNoteAppendProposalLine = z.infer<typeof CurrentNoteAppendProposalLineSchema>;
export type CurrentNoteAppendProposalPreview = z.infer<typeof CurrentNoteAppendProposalPreviewSchema>;
export type CurrentNoteAppendProposalGetRequest = z.infer<typeof CurrentNoteAppendProposalGetRequestSchema>;
export type CurrentNoteAppendProposalGetResult = z.infer<typeof CurrentNoteAppendProposalGetResultSchema>;
export type CurrentNoteAppendProposalDecisionRequest = z.infer<typeof CurrentNoteAppendProposalDecisionRequestSchema>;
export type CurrentNoteAppendProposalDecisionResult = z.infer<typeof CurrentNoteAppendProposalDecisionResultSchema>;
export type CurrentNoteReplaceProposalId = z.infer<typeof CurrentNoteReplaceProposalIdSchema>;
export type CurrentNoteReplaceProposalState = z.infer<typeof CurrentNoteReplaceProposalStateSchema>;
export type CurrentNoteReplaceProposalLine = z.infer<typeof CurrentNoteReplaceProposalLineSchema>;
export type CurrentNoteReplaceProposalPreview = z.infer<typeof CurrentNoteReplaceProposalPreviewSchema>;
export type CurrentNoteReplaceProposalGetRequest = z.infer<typeof CurrentNoteReplaceProposalGetRequestSchema>;
export type CurrentNoteReplaceProposalGetResult = z.infer<typeof CurrentNoteReplaceProposalGetResultSchema>;
export type CurrentNoteReplaceProposalDecisionRequest = z.infer<typeof CurrentNoteReplaceProposalDecisionRequestSchema>;
export type CurrentNoteReplaceProposalDecisionResult = z.infer<typeof CurrentNoteReplaceProposalDecisionResultSchema>;
export type CaptureFileRejection = z.output<typeof CaptureFileRejectionSchema>;
export type CaptureFileRejectionReason = z.output<typeof CaptureFileRejectionReasonSchema>;
export type AgentAnswerCitation = z.infer<typeof AgentAnswerCitationSchema>;
export type DatasetAnswerCitation = z.infer<typeof DatasetAnswerCitationSchema>;
export type DatasetColumn = z.infer<typeof DatasetColumnSchema>;
export type DatasetPigeCalculation = z.infer<typeof DatasetPigeCalculationSchema>;
export type DatasetPigeFormulaExpression = z.infer<typeof DatasetPigeFormulaExpressionSchema>;
export type DatasetPigeFormulaOperator = z.infer<typeof DatasetPigeFormulaOperatorSchema>;
export type DatasetPigeRelation = z.infer<typeof DatasetPigeRelationSchema>;
export type DatasetPigeRelationCell = z.infer<typeof DatasetPigeRelationCellSchema>;
export type DatasetPigeLookup = z.infer<typeof DatasetPigeLookupSchema>;
export type DatasetPigeRollup = z.infer<typeof DatasetPigeRollupSchema>;
export type CollectionCell = z.infer<typeof CollectionCellSchema>;
export type CollectionCellValue = z.infer<typeof CollectionCellValueSchema>;
export type CollectionCatalogCursor = z.infer<typeof CollectionCatalogCursorSchema>;
export type CollectionCellEditRequest = z.infer<typeof CollectionCellEditRequestSchema>;
export type CollectionCellEditResult = z.infer<typeof CollectionCellEditResultSchema>;
export type CollectionDatasetSummary = z.infer<typeof CollectionDatasetSummarySchema>;
export type CollectionDatasetTableSummary = z.infer<typeof CollectionDatasetTableSummarySchema>;
export type CollectionListRequest = z.infer<typeof CollectionListRequestSchema>;
export type CollectionListResult = z.infer<typeof CollectionListResultSchema>;
export type CollectionTrashDatasetRequest = z.infer<typeof CollectionTrashDatasetRequestSchema>;
export type CollectionTrashDatasetResult = z.infer<typeof CollectionTrashDatasetResultSchema>;
export type LibraryBrowseRequestId = z.infer<typeof LibraryBrowseRequestIdSchema>;
export type LibraryBrowseSnapshotId = z.infer<typeof LibraryBrowseSnapshotIdSchema>;
export type LibraryBrowseCursor = z.infer<typeof LibraryBrowseCursorSchema>;
export type LibraryPageSummary = z.infer<typeof LibraryPageSummarySchema>;
export type LibraryBrowseRequest = z.infer<typeof LibraryBrowseRequestSchema>;
export type LibraryBrowseResult = z.infer<typeof LibraryBrowseResultSchema>;
export type LibraryTagsRequestId = z.infer<typeof LibraryTagsRequestIdSchema>;
export type LibraryTagsSnapshotId = z.infer<typeof LibraryTagsSnapshotIdSchema>;
export type LibraryTagsCursor = z.infer<typeof LibraryTagsCursorSchema>;
export type LibraryCanonicalTag = z.infer<typeof LibraryCanonicalTagSchema>;
export type LibraryTagFacet = z.infer<typeof LibraryTagFacetSchema>;
export type LibraryTaggedPageSummary = z.infer<typeof LibraryTaggedPageSummarySchema>;
export type LibraryTagsRequest = z.infer<typeof LibraryTagsRequestSchema>;
export type LibraryTagsResult = z.infer<typeof LibraryTagsResultSchema>;
export type LibraryRenameTagRequestId = z.infer<typeof LibraryRenameTagRequestIdSchema>;
export type LibraryRenameTagRequest = z.infer<typeof LibraryRenameTagRequestSchema>;
export type LibraryRenameTagResult = z.infer<typeof LibraryRenameTagResultSchema>;
export type LibraryRenameTopicRequestId = z.infer<typeof LibraryRenameTopicRequestIdSchema>;
export type LibraryRenameTopicRequest = z.infer<typeof LibraryRenameTopicRequestSchema>;
export type LibraryRenameTopicResult = z.infer<typeof LibraryRenameTopicResultSchema>;
export type LibraryMergeTagRequestId = z.infer<typeof LibraryMergeTagRequestIdSchema>;
export type LibraryMergeTagRequest = z.infer<typeof LibraryMergeTagRequestSchema>;
export type LibraryMergeTagResult = z.infer<typeof LibraryMergeTagResultSchema>;
export type LibraryRemoveTagRequestId = z.infer<typeof LibraryRemoveTagRequestIdSchema>;
export type LibraryRemoveTagRequest = z.infer<typeof LibraryRemoveTagRequestSchema>;
export type LibraryRemoveTagResult = z.infer<typeof LibraryRemoveTagResultSchema>;
export type LibraryRemovePageTagRequestId = z.infer<typeof LibraryRemovePageTagRequestIdSchema>;
export type LibraryRemovePageTagRequest = z.infer<typeof LibraryRemovePageTagRequestSchema>;
export type LibraryRemovePageTagResult = z.infer<typeof LibraryRemovePageTagResultSchema>;
export type CollectionAppendDefaultRowRequest = z.infer<typeof CollectionAppendDefaultRowRequestSchema>;
export type CollectionAppendDefaultRowResult = z.infer<typeof CollectionAppendDefaultRowResultSchema>;
export type CollectionAddNullableColumnRequest = z.infer<typeof CollectionAddNullableColumnRequestSchema>;
export type CollectionAddNullableColumnResult = z.infer<typeof CollectionAddNullableColumnResultSchema>;
export type CollectionAddFormulaColumnRequest = z.infer<typeof CollectionAddFormulaColumnRequestSchema>;
export type CollectionAddFormulaColumnResult = z.infer<typeof CollectionAddFormulaColumnResultSchema>;
export type CollectionUpdateFormulaColumnRequest = z.infer<typeof CollectionUpdateFormulaColumnRequestSchema>;
export type CollectionUpdateFormulaColumnResult = z.infer<typeof CollectionUpdateFormulaColumnResultSchema>;
export type CollectionAddRelationColumnRequest = z.infer<typeof CollectionAddRelationColumnRequestSchema>;
export type CollectionAddRelationColumnResult = z.infer<typeof CollectionAddRelationColumnResultSchema>;
export type CollectionUpdateRelationColumnRequest = z.infer<typeof CollectionUpdateRelationColumnRequestSchema>;
export type CollectionUpdateRelationColumnResult = z.infer<typeof CollectionUpdateRelationColumnResultSchema>;
export type CollectionEditRelationCellRequest = z.infer<typeof CollectionEditRelationCellRequestSchema>;
export type CollectionEditRelationCellResult = z.infer<typeof CollectionEditRelationCellResultSchema>;
export type CollectionAddLookupColumnRequest = z.infer<typeof CollectionAddLookupColumnRequestSchema>;
export type CollectionAddLookupColumnResult = z.infer<typeof CollectionAddLookupColumnResultSchema>;
export type CollectionUpdateLookupColumnRequest = z.infer<typeof CollectionUpdateLookupColumnRequestSchema>;
export type CollectionUpdateLookupColumnResult = z.infer<typeof CollectionUpdateLookupColumnResultSchema>;
export type CollectionAddRollupColumnRequest = z.infer<typeof CollectionAddRollupColumnRequestSchema>;
export type CollectionAddRollupColumnResult = z.infer<typeof CollectionAddRollupColumnResultSchema>;
export type CollectionUpdateRollupColumnRequest = z.infer<typeof CollectionUpdateRollupColumnRequestSchema>;
export type CollectionUpdateRollupColumnResult = z.infer<typeof CollectionUpdateRollupColumnResultSchema>;
export type CollectionRenameColumnRequest = z.infer<typeof CollectionRenameColumnRequestSchema>;
export type CollectionRenameColumnResult = z.infer<typeof CollectionRenameColumnResultSchema>;
export type CollectionCreateViewRequest = z.infer<typeof CollectionCreateViewRequestSchema>;
export type CollectionCreateViewResult = z.infer<typeof CollectionCreateViewResultSchema>;
export type CollectionUpdateViewRequest = z.infer<typeof CollectionUpdateViewRequestSchema>;
export type CollectionUpdateViewResult = z.infer<typeof CollectionUpdateViewResultSchema>;
export type CollectionRenameViewRequest = z.infer<typeof CollectionRenameViewRequestSchema>;
export type CollectionRenameViewResult = z.infer<typeof CollectionRenameViewResultSchema>;
export type CollectionTrashViewRequest = z.infer<typeof CollectionTrashViewRequestSchema>;
export type CollectionTrashViewResult = z.infer<typeof CollectionTrashViewResultSchema>;
export type CollectionTrashColumnRequest = z.infer<typeof CollectionTrashColumnRequestSchema>;
export type CollectionTrashColumnResult = z.infer<typeof CollectionTrashColumnResultSchema>;
export type CollectionTrashRowRequest = z.infer<typeof CollectionTrashRowRequestSchema>;
export type CollectionTrashRowResult = z.infer<typeof CollectionTrashRowResultSchema>;
export type CollectionCellReadOnlyReason = z.infer<typeof CollectionCellReadOnlyReasonSchema>;
export type CollectionColumnSummary = z.infer<typeof CollectionColumnSummarySchema>;
export type CollectionColumnCalculationSummary = z.infer<typeof CollectionColumnCalculationSummarySchema>;
export type CollectionColumnRelationSummary = z.infer<typeof CollectionColumnRelationSummarySchema>;
export type CollectionColumnLookupSummary = z.infer<typeof CollectionColumnLookupSummarySchema>;
export type CollectionColumnRollupSummary = z.infer<typeof CollectionColumnRollupSummarySchema>;
export type CollectionRelationCellValue = z.infer<typeof CollectionRelationCellValueSchema>;
export type CollectionCitationHighlight = z.infer<typeof CollectionCitationHighlightSchema>;
export type CollectionOpenCitationRequest = z.infer<typeof CollectionOpenCitationRequestSchema>;
export type CollectionOpenCitationResult = z.infer<typeof CollectionOpenCitationResultSchema>;
export type CollectionOpenRequest = z.infer<typeof CollectionOpenRequestSchema>;
export type CollectionOpenResult = z.infer<typeof CollectionOpenResultSchema>;
export type CollectionRevealRequest = z.infer<typeof CollectionRevealRequestSchema>;
export type CollectionRevealResult = z.infer<typeof CollectionRevealResultSchema>;
export type CollectionRequestId = z.infer<typeof CollectionRequestIdSchema>;
export type CollectionRowCursor = z.infer<typeof CollectionRowCursorSchema>;
export type CollectionRow = z.infer<typeof CollectionRowSchema>;
export type CollectionScalarValue = z.infer<typeof CollectionScalarValueSchema>;
export type CollectionSnapshot = z.infer<typeof CollectionSnapshotSchema>;
export type CollectionViewFilter = z.infer<typeof CollectionViewFilterSchema>;
export type CollectionViewSort = z.infer<typeof CollectionViewSortSchema>;
export type CollectionViewSummary = z.infer<typeof CollectionViewSummarySchema>;
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
export type TaskExecutionPlan = z.infer<typeof TaskExecutionPlanSchema>;
export type TaskExecutionPlanStep = z.infer<typeof TaskExecutionPlanStepSchema>;
export type TaskExecutionPlanSummary = z.infer<typeof TaskExecutionPlanSummarySchema>;
export type TaskInteractionChangedEvent = z.infer<typeof TaskInteractionChangedEventSchema>;
export type TaskInteractionOpenRequest = z.infer<typeof TaskInteractionOpenRequestSchema>;
export type TaskInteractionOpenResult = z.infer<typeof TaskInteractionOpenResultSchema>;
export type TaskInteractionPendingResult = z.infer<typeof TaskInteractionPendingResultSchema>;
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
export type ExternalWebSkillHttpsOrigin = z.infer<typeof ExternalWebSkillHttpsOriginSchema>;
export type PiPackageInstallRequestId = z.infer<typeof PiPackageInstallRequestIdSchema>;
export type PiPackageInstallTaskId = z.infer<typeof PiPackageInstallTaskIdSchema>;
export type PiPackageUninstallRequestId = z.infer<typeof PiPackageUninstallRequestIdSchema>;
export type PiPackageUpdateRequestId = z.infer<typeof PiPackageUpdateRequestIdSchema>;
export type PiPackageRollbackRequestId = z.infer<typeof PiPackageRollbackRequestIdSchema>;
export type PiPackageSetPinnedRequestId = z.infer<typeof PiPackageSetPinnedRequestIdSchema>;
export type PiPackageSetEnabledRequestId = z.infer<typeof PiPackageSetEnabledRequestIdSchema>;
export type PiPackageRestoreRequestId = z.infer<typeof PiPackageRestoreRequestIdSchema>;
export type PiPackageRestoreContextId = z.infer<typeof PiPackageRestoreContextIdSchema>;
export type PiPackageRollbackId = z.infer<typeof PiPackageRollbackIdSchema>;
export type PiPackageCatalogQueryRequestId = z.infer<typeof PiPackageCatalogQueryRequestIdSchema>;
export type PiPackageCatalogId = z.infer<typeof PiPackageCatalogIdSchema>;
export type PiPackageId = z.infer<typeof PiPackageIdSchema>;
export type PiPackageIntegrity = z.infer<typeof PiPackageIntegritySchema>;
export type PiPackageName = z.infer<typeof PiPackageNameSchema>;
export type PiPackageVersion = z.infer<typeof PiPackageVersionSchema>;
export type PiPackageType = z.infer<typeof PiPackageTypeSchema>;
export type PiPackageInstalledSummary = z.infer<typeof PiPackageInstalledSummarySchema>;
export type PiPackageRestorableSummary = z.infer<typeof PiPackageRestorableSummarySchema>;
export type PiPackageRegistrySummary = z.infer<typeof PiPackageRegistrySummarySchema>;
export type PiPackageRegistryQueryResult = z.infer<typeof PiPackageRegistryQueryResultSchema>;
export type PiPackageInstallRequest = z.infer<typeof PiPackageInstallRequestSchema>;
export type PiPackageInstallResult = z.infer<typeof PiPackageInstallResultSchema>;
export type PiPackageUninstallRequest = z.infer<typeof PiPackageUninstallRequestSchema>;
export type PiPackageUninstallResult = z.infer<typeof PiPackageUninstallResultSchema>;
export type PiPackageUpdateRequest = z.infer<typeof PiPackageUpdateRequestSchema>;
export type PiPackageUpdateResult = z.infer<typeof PiPackageUpdateResultSchema>;
export type PiPackageRollbackRequest = z.infer<typeof PiPackageRollbackRequestSchema>;
export type PiPackageRollbackResult = z.infer<typeof PiPackageRollbackResultSchema>;
export type PiPackageSetPinnedRequest = z.infer<typeof PiPackageSetPinnedRequestSchema>;
export type PiPackageSetPinnedResult = z.infer<typeof PiPackageSetPinnedResultSchema>;
export type PiPackageSetEnabledRequest = z.infer<typeof PiPackageSetEnabledRequestSchema>;
export type PiPackageSetEnabledResult = z.infer<typeof PiPackageSetEnabledResultSchema>;
export type PiPackageRestoreRequest = z.infer<typeof PiPackageRestoreRequestSchema>;
export type PiPackageRestoreResult = z.infer<typeof PiPackageRestoreResultSchema>;
export type PiPackageCatalogEntry = z.infer<typeof PiPackageCatalogEntrySchema>;
export type PiPackageCatalogQueryRequest = z.infer<typeof PiPackageCatalogQueryRequestSchema>;
export type PiPackageCatalogQueryResult = z.infer<typeof PiPackageCatalogQueryResultSchema>;
export type KnowledgeActivityPageTarget = z.infer<typeof KnowledgeActivityPageTargetSchema>;
export type KnowledgeActivityCollectionTarget = z.infer<typeof KnowledgeActivityCollectionTargetSchema>;
export type KnowledgeActivityTarget = z.infer<typeof KnowledgeActivityTargetSchema>;
export type KnowledgeActivitySummary = z.infer<typeof KnowledgeActivitySummarySchema>;
export type KnowledgeActivityListRequest = z.infer<typeof KnowledgeActivityListRequestSchema>;
export type KnowledgeActivityListResult = z.infer<typeof KnowledgeActivityListResultSchema>;
export type KnowledgeHealthRequestId = z.infer<typeof KnowledgeHealthRequestIdSchema>;
export type KnowledgeHealthRepairRequestId = z.infer<typeof KnowledgeHealthRepairRequestIdSchema>;
export type KnowledgeHealthDuplicateTopicRepairRequestId = z.infer<typeof KnowledgeHealthDuplicateTopicRepairRequestIdSchema>;
export type KnowledgeHealthTargetSearchRequestId = z.infer<typeof KnowledgeHealthTargetSearchRequestIdSchema>;
export type KnowledgeHealthOrphanParentSearchRequestId = z.infer<typeof KnowledgeHealthOrphanParentSearchRequestIdSchema>;
export type KnowledgeHealthOrphanRepairRequestId = z.infer<typeof KnowledgeHealthOrphanRepairRequestIdSchema>;
export type KnowledgeHealthRepairContextId = z.infer<typeof KnowledgeHealthRepairContextIdSchema>;
export type KnowledgeHealthTargetContextId = z.infer<typeof KnowledgeHealthTargetContextIdSchema>;
export type KnowledgeHealthOrphanParentContextId = z.infer<typeof KnowledgeHealthOrphanParentContextIdSchema>;
export type KnowledgeHealthOccurrenceId = z.infer<typeof KnowledgeHealthOccurrenceIdSchema>;
export type KnowledgeHealthRenderProof = z.infer<typeof KnowledgeHealthRenderProofSchema>;
export type KnowledgeHealthPageRevision = z.infer<typeof KnowledgeHealthPageRevisionSchema>;
export type KnowledgeHealthRepairAction = z.infer<typeof KnowledgeHealthRepairActionSchema>;
export type KnowledgeHealthIndexGeneration = z.infer<typeof KnowledgeHealthIndexGenerationSchema>;
export type KnowledgeHealthPageRef = z.infer<typeof KnowledgeHealthPageRefSchema>;
export type KnowledgeHealthIssueKind = z.infer<typeof KnowledgeHealthIssueKindSchema>;
export type KnowledgeHealthIssueSummary = z.infer<typeof KnowledgeHealthIssueSummarySchema>;
export type KnowledgeHealthCounts = z.infer<typeof KnowledgeHealthCountsSchema>;
export type KnowledgeHealthRunRequest = z.infer<typeof KnowledgeHealthRunRequestSchema>;
export type KnowledgeHealthRunResult = z.infer<typeof KnowledgeHealthRunResultSchema>;
export type KnowledgeHealthTargetCandidate = z.infer<typeof KnowledgeHealthTargetCandidateSchema>;
export type KnowledgeHealthTargetSearchRequest = z.infer<typeof KnowledgeHealthTargetSearchRequestSchema>;
export type KnowledgeHealthTargetSearchResult = z.infer<typeof KnowledgeHealthTargetSearchResultSchema>;
export type KnowledgeHealthOrphanParentCandidate = z.infer<typeof KnowledgeHealthOrphanParentCandidateSchema>;
export type KnowledgeHealthOrphanParentSearchRequest = z.infer<typeof KnowledgeHealthOrphanParentSearchRequestSchema>;
export type KnowledgeHealthOrphanParentSearchResult = z.infer<typeof KnowledgeHealthOrphanParentSearchResultSchema>;
export type KnowledgeHealthOrphanRepairRequest = z.infer<typeof KnowledgeHealthOrphanRepairRequestSchema>;
export type KnowledgeHealthOrphanRepairResult = z.infer<typeof KnowledgeHealthOrphanRepairResultSchema>;
export type KnowledgeHealthRepairRequest = z.infer<typeof KnowledgeHealthRepairRequestSchema>;
export type KnowledgeHealthRepairResult = z.infer<typeof KnowledgeHealthRepairResultSchema>;
export type KnowledgeHealthDuplicateTopicRepairRequest = z.infer<typeof KnowledgeHealthDuplicateTopicRepairRequestSchema>;
export type KnowledgeHealthDuplicateTopicRepairResult = z.infer<typeof KnowledgeHealthDuplicateTopicRepairResultSchema>;
export type KnowledgeHealthClaimSourceCandidate = z.infer<typeof KnowledgeHealthClaimSourceCandidateSchema>;
export type KnowledgeHealthClaimSourceSearchRequest = z.infer<typeof KnowledgeHealthClaimSourceSearchRequestSchema>;
export type KnowledgeHealthClaimSourceSearchResult = z.infer<typeof KnowledgeHealthClaimSourceSearchResultSchema>;
export type KnowledgeHealthClaimSourceRepairRequest = z.infer<typeof KnowledgeHealthClaimSourceRepairRequestSchema>;
export type KnowledgeHealthClaimSourceRepairResult = z.infer<typeof KnowledgeHealthClaimSourceRepairResultSchema>;
export type JobCheckpoint = z.infer<typeof JobCheckpointSchema>;
export type JobRef = z.infer<typeof JobRefSchema>;
export type JobRecord = z.infer<typeof JobRecordSchema>;
export type JobChangedEvent = z.infer<typeof JobChangedEventSchema>;
export type JobStage = z.infer<typeof JobStageSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type BackupReconnectDependencyRequest = z.infer<typeof BackupReconnectDependencyRequestSchema>;
export type BackupReconnectDependencyResult = z.infer<typeof BackupReconnectDependencyResultSchema>;
export type BackupReconnectDestinationRequestId = z.infer<typeof BackupReconnectDestinationRequestIdSchema>;
export type BackupReconnectDestinationRequest = z.infer<typeof BackupReconnectDestinationRequestSchema>;
export type BackupReconnectDestinationResult = z.infer<typeof BackupReconnectDestinationResultSchema>;
export type BackupContinueIncompleteRequestId = z.infer<typeof BackupContinueIncompleteRequestIdSchema>;
export type BackupContinueIncompleteRequest = z.infer<typeof BackupContinueIncompleteRequestSchema>;
export type BackupContinueIncompleteResult = z.infer<typeof BackupContinueIncompleteResultSchema>;
export type BackupMemoryPreferenceRevision = z.infer<typeof BackupMemoryPreferenceRevisionSchema>;
export type BackupMemoryPreferenceSummary = z.infer<typeof BackupMemoryPreferenceSummarySchema>;
export type BackupMemoryPreferenceUpdateRequest = z.infer<typeof BackupMemoryPreferenceUpdateRequestSchema>;
export type BackupMemoryPreferenceUpdateResult = z.infer<typeof BackupMemoryPreferenceUpdateResultSchema>;
export type BackupConversationPreferenceRevision = z.infer<typeof BackupConversationPreferenceRevisionSchema>;
export type BackupConversationPreferenceSummary = z.infer<typeof BackupConversationPreferenceSummarySchema>;
export type BackupConversationPreferenceUpdateRequest = z.infer<typeof BackupConversationPreferenceUpdateRequestSchema>;
export type BackupConversationPreferenceUpdateResult = z.infer<typeof BackupConversationPreferenceUpdateResultSchema>;
export type PigePolicyRevision = z.infer<typeof PigePolicyRevisionSchema>;
export type PigePolicyMarkdown = z.infer<typeof PigePolicyMarkdownSchema>;
export type PigePolicyValidationIssue = z.infer<typeof PigePolicyValidationIssueSchema>;
export type PigePolicySummary = z.infer<typeof PigePolicySummarySchema>;
export type PigePolicyUpdateRequest = z.infer<typeof PigePolicyUpdateRequestSchema>;
export type PigePolicyUpdateResult = z.infer<typeof PigePolicyUpdateResultSchema>;
export type BackupTrashPreferenceRevision = z.infer<typeof BackupTrashPreferenceRevisionSchema>;
export type BackupTrashPreferenceSummary = z.infer<typeof BackupTrashPreferenceSummarySchema>;
export type BackupTrashPreferenceUpdateRequest = z.infer<typeof BackupTrashPreferenceUpdateRequestSchema>;
export type BackupTrashPreferenceUpdateResult = z.infer<typeof BackupTrashPreferenceUpdateResultSchema>;
export type RestoreCancelRequestId = z.infer<typeof RestoreCancelRequestIdSchema>;
export type RestoreCancelRequest = z.infer<typeof RestoreCancelRequestSchema>;
export type RestoreCancelResult = z.infer<typeof RestoreCancelResultSchema>;
export type ReferencedOriginalReconnectRequestId = z.infer<typeof ReferencedOriginalReconnectRequestIdSchema>;
export type ReferencedOriginalReconnectRequest = z.infer<typeof ReferencedOriginalReconnectRequestSchema>;
export type ReferencedOriginalReconnectJobProjection = z.infer<
  typeof ReferencedOriginalReconnectJobProjectionSchema
>;
export type ReferencedOriginalReconnectResult = z.infer<typeof ReferencedOriginalReconnectResultSchema>;
export type MachineLocalSettings = z.infer<typeof MachineLocalSettingsSchema>;
export type DiagnosticsWorkflowRequestId = z.infer<typeof DiagnosticsWorkflowRequestIdSchema>;
export type DiagnosticsScopeContextId = z.infer<typeof DiagnosticsScopeContextIdSchema>;
export type DiagnosticsSupportBundleJobSummary = z.infer<typeof DiagnosticsSupportBundleJobSummarySchema>;
export type DiagnosticsWorkflowSummary = z.infer<typeof DiagnosticsWorkflowSummarySchema>;
export type SupportBundleCategory = z.infer<typeof SupportBundleCategorySchema>;
export type SupportBundlePreview = z.infer<typeof SupportBundlePreviewSchema>;
export type DiagnosticsPreviewSupportBundleRequest = z.infer<typeof DiagnosticsPreviewSupportBundleRequestSchema>;
export type DiagnosticsExportSupportBundleRequest = z.infer<typeof DiagnosticsExportSupportBundleRequestSchema>;
export type DiagnosticsExportSupportBundleResult = z.infer<typeof DiagnosticsExportSupportBundleResultSchema>;
export type DiagnosticsSupportBundleMutationRequest = z.infer<typeof DiagnosticsSupportBundleMutationRequestSchema>;
export type DiagnosticsSupportBundleMutationResult = z.infer<typeof DiagnosticsSupportBundleMutationResultSchema>;
export type UpdateCapability = z.infer<typeof UpdateCapabilitySchema>;
export type UpdateChannel = z.infer<typeof UpdateChannelSchema>;
export type UpdateCheckRequest = z.infer<typeof UpdateCheckRequestSchema>;
export type UpdateCheckResult = z.infer<typeof UpdateCheckResultSchema>;
export type UpdateDownloadRequestId = z.infer<typeof UpdateDownloadRequestIdSchema>;
export type UpdateDownloadRequest = z.infer<typeof UpdateDownloadRequestSchema>;
export type UpdateDownloadResult = z.infer<typeof UpdateDownloadResultSchema>;
export type UpdateApplyRequestId = z.infer<typeof UpdateApplyRequestIdSchema>;
export type UpdateApplyRequest = z.infer<typeof UpdateApplyRequestSchema>;
export type UpdateApplyResult = z.infer<typeof UpdateApplyResultSchema>;
export type UpdateMachineSettings = z.infer<typeof UpdateMachineSettingsSchema>;
export type AppearanceThemePreference = z.infer<typeof AppearanceThemePreferenceSchema>;
export type GeneratedKnowledgeLanguage = z.infer<typeof GeneratedKnowledgeLanguageSchema>;
export type EffectiveAppearanceTheme = z.infer<typeof EffectiveAppearanceThemeSchema>;
export type AppearanceMachineSettings = z.infer<typeof AppearanceMachineSettingsSchema>;
export type AppearanceSettingsSummary = z.infer<typeof AppearanceSettingsSummarySchema>;
export type SetLocaleRequest = z.infer<typeof SetLocaleRequestSchema>;
export type SetThemeRequest = z.infer<typeof SetThemeRequestSchema>;
export type AppearanceThemeMutationResult = z.infer<typeof AppearanceThemeMutationResultSchema>;
export type SetKnowledgeLanguageRequest = z.infer<typeof SetKnowledgeLanguageRequestSchema>;
export type KnowledgeLanguageMutationResult = z.infer<typeof KnowledgeLanguageMutationResultSchema>;
export type StartupDestination = z.infer<typeof StartupDestinationSchema>;
export type StartupDestinationRevision = z.infer<typeof StartupDestinationRevisionSchema>;
export type StartupDestinationSummary = z.infer<typeof StartupDestinationSummarySchema>;
export type SetStartupDestinationRequest = z.infer<typeof SetStartupDestinationRequestSchema>;
export type StartupDestinationMutationResult = z.infer<typeof StartupDestinationMutationResultSchema>;
export type UpdatePhase = z.infer<typeof UpdatePhaseSchema>;
export type UpdateStatusEvent = z.infer<typeof UpdateStatusEventSchema>;
export type UpdateSummary = z.infer<typeof UpdateSummarySchema>;
export type MarkdownPageStatus = z.infer<typeof MarkdownPageStatusSchema>;
export type MarkdownPageType = z.infer<typeof MarkdownPageTypeSchema>;
export type NoteInlineReferenceTarget = z.infer<typeof NoteInlineReferenceTargetSchema>;
export type NoteInlineReferenceRequestId = z.infer<typeof NoteInlineReferenceRequestIdSchema>;
export type NoteRenderContextId = z.infer<typeof NoteRenderContextIdSchema>;
export type NoteRenderPageSummary = z.infer<typeof NoteRenderPageSummarySchema>;
export type NoteSourceMetadataItem = z.infer<typeof NoteSourceMetadataItemSchema>;
export type NoteSourceMetadataSummary = z.infer<typeof NoteSourceMetadataSummarySchema>;
export type NoteQuestionState = z.infer<typeof NoteQuestionStateSchema>;
export type NoteQuestionStateSummary = z.infer<typeof NoteQuestionStateSummarySchema>;
export type NoteQuestionAnswerItem = z.infer<typeof NoteQuestionAnswerItemSchema>;
export type NoteQuestionAnswersSummary = z.infer<typeof NoteQuestionAnswersSummarySchema>;
export type NoteClaimContradictionItem = z.infer<typeof NoteClaimContradictionItemSchema>;
export type NoteClaimContradictionsSummary = z.infer<typeof NoteClaimContradictionsSummarySchema>;
export type NoteConceptParentItem = z.infer<typeof NoteConceptParentItemSchema>;
export type NoteConceptParentsSummary = z.infer<typeof NoteConceptParentsSummarySchema>;
export type NoteRenderResult = z.infer<typeof NoteRenderResultSchema>;
export type NoteRevealGeneratedRequest = z.infer<typeof NoteRevealGeneratedRequestSchema>;
export type NoteRevealGeneratedResult = z.infer<typeof NoteRevealGeneratedResultSchema>;
export type NoteRevealGeneratedEligibility = z.infer<typeof NoteRevealGeneratedEligibilitySchema>;
export type NoteOpenSearchMatchRequest = z.infer<typeof NoteOpenSearchMatchRequestSchema>;
export type NoteOpenSearchMatchResult = z.infer<typeof NoteOpenSearchMatchResultSchema>;
export type NoteImportMarkdownRequest = z.infer<typeof NoteImportMarkdownRequestSchema>;
export type NoteImportMarkdownResult = z.infer<typeof NoteImportMarkdownResultSchema>;
export type NoteEditorRequestId = z.infer<typeof NoteEditorRequestIdSchema>;
export type NoteEditorRevision = z.infer<typeof NoteEditorRevisionSchema>;
export type NoteEditorPortableMarkdown = z.infer<typeof NoteEditorPortableMarkdownSchema>;
export type NoteEditorInvalidReason = z.infer<typeof NoteEditorInvalidReasonSchema>;
export type NoteEditorOpenRequest = z.infer<typeof NoteEditorOpenRequestSchema>;
export type NoteEditorOpenResult = z.infer<typeof NoteEditorOpenResultSchema>;
export type NoteEditorSaveRequest = z.infer<typeof NoteEditorSaveRequestSchema>;
export type NoteEditorSaveResult = z.infer<typeof NoteEditorSaveResultSchema>;
export type NoteTrashCurrentRequestId = z.infer<typeof NoteTrashCurrentRequestIdSchema>;
export type NoteTrashListRequestId = z.infer<typeof NoteTrashListRequestIdSchema>;
export type NoteTrashRestoreRequestId = z.infer<typeof NoteTrashRestoreRequestIdSchema>;
export type NoteTrashRevision = z.infer<typeof NoteTrashRevisionSchema>;
export type NoteArchiveCurrentRequestId = z.infer<typeof NoteArchiveCurrentRequestIdSchema>;
export type NoteArchiveCurrentRequest = z.infer<typeof NoteArchiveCurrentRequestSchema>;
export type NoteArchiveCurrentResult = z.infer<typeof NoteArchiveCurrentResultSchema>;
export type NoteRestoreArchivedRequestId = z.infer<typeof NoteRestoreArchivedRequestIdSchema>;
export type NoteRestoreArchivedRequest = z.infer<typeof NoteRestoreArchivedRequestSchema>;
export type NoteRestoreArchivedResult = z.infer<typeof NoteRestoreArchivedResultSchema>;
export type NoteQuestionStateRequestId = z.infer<typeof NoteQuestionStateRequestIdSchema>;
export type NoteSetQuestionStateRequest = z.infer<typeof NoteSetQuestionStateRequestSchema>;
export type NoteSetQuestionStateResult = z.infer<typeof NoteSetQuestionStateResultSchema>;
export type NoteSearchQuestionAnswersRequest = z.infer<typeof NoteSearchQuestionAnswersRequestSchema>;
export type NoteSearchQuestionAnswersResult = z.infer<typeof NoteSearchQuestionAnswersResultSchema>;
export type NoteChangeQuestionAnswerRequest = z.infer<typeof NoteChangeQuestionAnswerRequestSchema>;
export type NoteChangeQuestionAnswerResult = z.infer<typeof NoteChangeQuestionAnswerResultSchema>;
export type NoteSearchClaimContradictionsRequest = z.infer<typeof NoteSearchClaimContradictionsRequestSchema>;
export type NoteSearchClaimContradictionsResult = z.infer<typeof NoteSearchClaimContradictionsResultSchema>;
export type NoteChangeClaimContradictionRequest = z.infer<typeof NoteChangeClaimContradictionRequestSchema>;
export type NoteChangeClaimContradictionResult = z.infer<typeof NoteChangeClaimContradictionResultSchema>;
export type NoteSearchConceptParentsRequest = z.infer<typeof NoteSearchConceptParentsRequestSchema>;
export type NoteSearchConceptParentsResult = z.infer<typeof NoteSearchConceptParentsResultSchema>;
export type NoteChangeConceptParentRequest = z.infer<typeof NoteChangeConceptParentRequestSchema>;
export type NoteChangeConceptParentResult = z.infer<typeof NoteChangeConceptParentResultSchema>;
export type NoteRestoreEligibility = z.infer<typeof NoteRestoreEligibilitySchema>;
export type NoteAddTagRequestId = z.infer<typeof NoteAddTagRequestIdSchema>;
export type NoteCanonicalTag = z.infer<typeof NoteCanonicalTagSchema>;
export type NoteCanonicalTopic = z.infer<typeof NoteCanonicalTopicSchema>;
export type NoteTaggingSummary = z.infer<typeof NoteTaggingSummarySchema>;
export type NoteAddTagRequest = z.infer<typeof NoteAddTagRequestSchema>;
export type NoteAddTagResult = z.infer<typeof NoteAddTagResultSchema>;
export type NoteEditTaxonomyRequestId = z.infer<typeof NoteEditTaxonomyRequestIdSchema>;
export type NoteEditTaxonomyRequest = z.infer<typeof NoteEditTaxonomyRequestSchema>;
export type NoteEditTaxonomyResult = z.infer<typeof NoteEditTaxonomyResultSchema>;
export type NoteRenameRequestId = z.infer<typeof NoteRenameRequestIdSchema>;
export type NoteCanonicalTitle = z.infer<typeof NoteCanonicalTitleSchema>;
export type NoteRenameEligibility = z.infer<typeof NoteRenameEligibilitySchema>;
export type NoteRenameRequest = z.infer<typeof NoteRenameRequestSchema>;
export type NoteRenameResult = z.infer<typeof NoteRenameResultSchema>;
export type NoteAliasChangeRequestId = z.infer<typeof NoteAliasChangeRequestIdSchema>;
export type NoteCanonicalAlias = z.infer<typeof NoteCanonicalAliasSchema>;
export type NoteAliasingSummary = z.infer<typeof NoteAliasingSummarySchema>;
export type NoteAliasChangeRequest = z.infer<typeof NoteAliasChangeRequestSchema>;
export type NoteAliasChangeResult = z.infer<typeof NoteAliasChangeResultSchema>;
export type NoteRemoveTagRequestId = z.infer<typeof NoteRemoveTagRequestIdSchema>;
export type NoteRemoveTagRequest = z.infer<typeof NoteRemoveTagRequestSchema>;
export type NoteRemoveTagResult = z.infer<typeof NoteRemoveTagResultSchema>;
export type NoteTrashEligibility = z.infer<typeof NoteTrashEligibilitySchema>;
export type NoteTrashCurrentRequest = z.infer<typeof NoteTrashCurrentRequestSchema>;
export type NoteTrashCurrentResult = z.infer<typeof NoteTrashCurrentResultSchema>;
export type NoteTrashSummary = z.infer<typeof NoteTrashSummarySchema>;
export type NoteTrashListRequest = z.infer<typeof NoteTrashListRequestSchema>;
export type NoteTrashListResult = z.infer<typeof NoteTrashListResultSchema>;
export type NoteTrashRestoreRequest = z.infer<typeof NoteTrashRestoreRequestSchema>;
export type NoteTrashRestoreResult = z.infer<typeof NoteTrashRestoreResultSchema>;
export type NoteRevisionHistoryRequestId = z.infer<typeof NoteRevisionHistoryRequestIdSchema>;
export type NoteRevisionHistoryRevisionId = z.infer<typeof NoteRevisionHistoryRevisionIdSchema>;
export type NoteRevisionHistoryEligibility = z.infer<typeof NoteRevisionHistoryEligibilitySchema>;
export type NoteRevisionHistorySummary = z.infer<typeof NoteRevisionHistorySummarySchema>;
export type NoteRevisionHistoryListRequest = z.infer<typeof NoteRevisionHistoryListRequestSchema>;
export type NoteRevisionHistoryListResult = z.infer<typeof NoteRevisionHistoryListResultSchema>;
export type NoteRevisionHistoryOpenRequest = z.infer<typeof NoteRevisionHistoryOpenRequestSchema>;
export type NoteRevisionHistoryOpenResult = z.infer<typeof NoteRevisionHistoryOpenResultSchema>;
export type NoteRevisionHistoryRestoreRequest = z.infer<typeof NoteRevisionHistoryRestoreRequestSchema>;
export type NoteRevisionHistoryRestoreResult = z.infer<typeof NoteRevisionHistoryRestoreResultSchema>;
export type NoteMergeRequestId = z.infer<typeof NoteMergeRequestIdSchema>;
export type NoteMergeRequest = z.infer<typeof NoteMergeRequestSchema>;
export type NoteMergeResult = z.infer<typeof NoteMergeResultSchema>;
export type NoteRelateRequestId = z.infer<typeof NoteRelateRequestIdSchema>;
export type NoteRelateRequest = z.infer<typeof NoteRelateRequestSchema>;
export type NoteRelateResult = z.infer<typeof NoteRelateResultSchema>;
export type NoteUnlinkRelationRequestId = z.infer<typeof NoteUnlinkRelationRequestIdSchema>;
export type NoteUnlinkRelationRequest = z.infer<typeof NoteUnlinkRelationRequestSchema>;
export type NoteUnlinkRelationResult = z.infer<typeof NoteUnlinkRelationResultSchema>;
export type NoteResolveInlineReferenceRequest = z.infer<typeof NoteResolveInlineReferenceRequestSchema>;
export type NoteResolveInlineReferenceResult = z.infer<typeof NoteResolveInlineReferenceResultSchema>;
export type NoteSourceReferenceRequestId = z.infer<typeof NoteSourceReferenceRequestIdSchema>;
export type NoteOpenSourceReferenceRequest = z.infer<typeof NoteOpenSourceReferenceRequestSchema>;
export type NoteOpenSourceReferenceResult = z.infer<typeof NoteOpenSourceReferenceResultSchema>;
export type NoteRevealSourceRequestId = z.infer<typeof NoteRevealSourceRequestIdSchema>;
export type NoteRevealSourceRequest = z.infer<typeof NoteRevealSourceRequestSchema>;
export type NoteRevealSourceResult = z.infer<typeof NoteRevealSourceResultSchema>;
export type NoteReconnectOriginalSourceRequestId = z.infer<typeof NoteReconnectOriginalSourceRequestIdSchema>;
export type NoteReconnectOriginalSourceRequest = z.infer<typeof NoteReconnectOriginalSourceRequestSchema>;
export type NoteReconnectOriginalSourceResult = z.infer<typeof NoteReconnectOriginalSourceResultSchema>;
export type SourceRefreshRequestId = z.infer<typeof SourceRefreshRequestIdSchema>;
export type SourceRefreshPreviewId = z.infer<typeof SourceRefreshPreviewIdSchema>;
export type SourceRefreshRevision = z.infer<typeof SourceRefreshRevisionSchema>;
export type SourceRefreshPreviewRequest = z.infer<typeof SourceRefreshPreviewRequestSchema>;
export type SourceRefreshPreviewResult = z.infer<typeof SourceRefreshPreviewResultSchema>;
export type SourceRefreshConfirmRequest = z.infer<typeof SourceRefreshConfirmRequestSchema>;
export type SourceRefreshConfirmResult = z.infer<typeof SourceRefreshConfirmResultSchema>;
export type SourceRelinkPreviewId = z.infer<typeof SourceRelinkPreviewIdSchema>;
export type ReferencedOriginalChangedPreview = z.infer<typeof ReferencedOriginalChangedPreviewSchema>;
export type SourceReconnectListRequest = z.infer<typeof SourceReconnectListRequestSchema>;
export type SourceReconnectListResult = z.infer<typeof SourceReconnectListResultSchema>;
export type SourceReconnectRequest = z.infer<typeof SourceReconnectRequestSchema>;
export type SourceReconnectResult = z.infer<typeof SourceReconnectResultSchema>;
export type SourceRecordRevision = z.infer<typeof SourceRecordRevisionSchema>;
export type SourceFormatIdentity = z.infer<typeof SourceFormatIdentitySchema>;
export type ReferencedOriginalReconnectProof = z.infer<typeof ReferencedOriginalReconnectProofSchema>;
export type ReferencedOriginalReconnectCandidate = z.infer<typeof ReferencedOriginalReconnectCandidateSchema>;
export type ReaderSelectionEndpoint = z.infer<typeof ReaderSelectionEndpointSchema>;
export type ReaderSelectionActionRequestId = z.infer<typeof ReaderSelectionActionRequestIdSchema>;
export type ReaderSelectionActionRequest = z.infer<typeof ReaderSelectionActionRequestSchema>;
export type ReaderSelectionActionResult = z.infer<typeof ReaderSelectionActionResultSchema>;
export type ReaderSelectionLinkRequest = z.infer<typeof ReaderSelectionLinkRequestSchema>;
export type ReaderSelectionLinkResult = z.infer<typeof ReaderSelectionLinkResultSchema>;
export type ReaderSelectionIdentity = z.infer<typeof ReaderSelectionIdentitySchema>;
export type ReaderSelectionReadAction = z.infer<typeof ReaderSelectionReadActionSchema>;
export type ReaderSelectionTransformAction = z.infer<typeof ReaderSelectionTransformActionSchema>;
export type ReaderSelectionCreatePageAction = z.infer<typeof ReaderSelectionCreatePageActionSchema>;
export type ReaderSelectionProposalAction = z.infer<typeof ReaderSelectionProposalActionSchema>;
export type ReaderSelectionTransformRequest = z.infer<typeof ReaderSelectionTransformRequestSchema>;
export type ReaderSelectionTransformResult = z.infer<typeof ReaderSelectionTransformResultSchema>;
export type ReaderSelectionCreateNoteRequest = z.infer<typeof ReaderSelectionCreateNoteRequestSchema>;
export type ReaderSelectionCreateNoteResult = z.infer<typeof ReaderSelectionCreateNoteResultSchema>;
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
export type ProviderApiKeyManagementRequest = z.infer<typeof ProviderApiKeyManagementRequestSchema>;
export type ProviderApiKeyManagementResult = z.infer<typeof ProviderApiKeyManagementResultSchema>;
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
export type PermissionDecisionId = z.infer<typeof PermissionDecisionIdSchema>;
export type PermissionDecisionRecord = z.infer<typeof PermissionDecisionRecordSchema>;
export type PermissionDecisionScope = z.infer<typeof PermissionDecisionScopeSchema>;
export type PermissionDefaultMode = z.infer<typeof PermissionDefaultModeSchema>;
export type PermissionFullAccessSummary = z.infer<typeof PermissionFullAccessSummarySchema>;
export type PermissionGrantContextId = z.infer<typeof PermissionGrantContextIdSchema>;
export type PermissionGrantId = z.infer<typeof PermissionGrantIdSchema>;
export type PermissionGrantSummary = z.infer<typeof PermissionGrantSummarySchema>;
export type PermissionPolicyChangedEvent = z.infer<typeof PermissionPolicyChangedEventSchema>;
export type PermissionPolicySummary = z.infer<typeof PermissionPolicySummarySchema>;
export type PermissionPolicySummaryRequest = z.infer<typeof PermissionPolicySummaryRequestSchema>;
export type PermissionPolicySummaryResult = z.infer<typeof PermissionPolicySummaryResultSchema>;
export type PermissionRevokeGrantRequest = z.infer<typeof PermissionRevokeGrantRequestSchema>;
export type PermissionRevokeGrantResult = z.infer<typeof PermissionRevokeGrantResultSchema>;
export type PermissionRequestId = z.infer<typeof PermissionRequestIdSchema>;
export type PermissionSetDefaultModeRequest = z.infer<typeof PermissionSetDefaultModeRequestSchema>;
export type PermissionSetDefaultModeResult = z.infer<typeof PermissionSetDefaultModeResultSchema>;
export type PermissionYoloHardBoundary = z.infer<typeof PermissionYoloHardBoundarySchema>;
export type ExternalWebSkillRuntimeIdentity = z.infer<typeof ExternalWebSkillRuntimeIdentitySchema>;
export type ExternalWebSkillRuntimeTurnBinding = z.infer<typeof ExternalWebSkillRuntimeTurnBindingSchema>;
export type ExternalWebSkillRuntimeCall = z.infer<typeof ExternalWebSkillRuntimeCallSchema>;
export type SkillId = z.infer<typeof SkillIdSchema>;
export type SkillVersion = z.infer<typeof SkillVersionSchema>;
export type SkillKind = z.infer<typeof SkillKindSchema>;
export type SkillScope = z.infer<typeof SkillScopeSchema>;
export type SkillTrust = z.infer<typeof SkillTrustSchema>;
export type SkillCapability = z.infer<typeof SkillCapabilitySchema>;
export type SkillDataBoundary = z.infer<typeof SkillDataBoundarySchema>;
export type SkillInstallSourceKind = z.infer<typeof SkillInstallSourceKindSchema>;
export type ExternalWebSkillRuntimeAdapter = z.infer<typeof ExternalWebSkillRuntimeAdapterSchema>;
export type ExternalWebSkillRuntimeToolName = z.infer<typeof ExternalWebSkillRuntimeToolNameSchema>;
export type ExternalWebSkillRuntimeDeclaration = z.infer<typeof ExternalWebSkillRuntimeDeclarationSchema>;
export type ExternalWebSkillReadRequest = z.infer<typeof ExternalWebSkillReadRequestSchema>;
export type ExternalWebSkillReadResult = z.infer<typeof ExternalWebSkillReadResultSchema>;
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type SkillRegistryRecord = z.infer<typeof SkillRegistryRecordSchema>;
export type SkillRegistryFile = z.infer<typeof SkillRegistryFileSchema>;
export type SkillSummary = z.infer<typeof SkillSummarySchema>;
export type SkillRestorableSummary = z.infer<typeof SkillRestorableSummarySchema>;
export type SkillRegistrySummary = z.infer<typeof SkillRegistrySummarySchema>;
export type SkillRegistryQueryRequest = z.infer<typeof SkillRegistryQueryRequestSchema>;
export type SkillRegistryQueryResult = z.infer<typeof SkillRegistryQueryResultSchema>;
export type SkillDisableRequest = z.infer<typeof SkillDisableRequestSchema>;
export type SkillRegistryMutationResult = z.infer<typeof SkillRegistryMutationResultSchema>;
export type SkillInstallRequestId = z.infer<typeof SkillInstallRequestIdSchema>;
export type SkillLifecycleRequestId = z.infer<typeof SkillLifecycleRequestIdSchema>;
export type SkillEnableRequest = z.infer<typeof SkillEnableRequestSchema>;
export type SkillUninstallRequest = z.infer<typeof SkillUninstallRequestSchema>;
export type SkillRestoreContextId = z.infer<typeof SkillRestoreContextIdSchema>;
export type SkillRestoreRequest = z.infer<typeof SkillRestoreRequestSchema>;
export type SkillRestoreResult = z.infer<typeof SkillRestoreResultSchema>;
export type SkillExportRequest = z.infer<typeof SkillExportRequestSchema>;
export type SkillLifecycleMutationResult = z.infer<typeof SkillLifecycleMutationResultSchema>;
export type SkillExportResult = z.infer<typeof SkillExportResultSchema>;
export type SkillStageUpdateRequest = z.infer<typeof SkillStageUpdateRequestSchema>;
export type SkillStageUpdateResult = z.infer<typeof SkillStageUpdateResultSchema>;
export type SkillStagingId = z.infer<typeof SkillStagingIdSchema>;
export type SkillInstallUrl = z.infer<typeof SkillInstallUrlSchema>;
export type SkillStageInvalidReason = z.infer<typeof SkillStageInvalidReasonSchema>;
export type SkillZipStageInvalidReason = z.infer<typeof SkillZipStageInvalidReasonSchema>;
export type SkillStageWarning = z.infer<typeof SkillStageWarningSchema>;
export type SkillStagedFileSummary = z.infer<typeof SkillStagedFileSummarySchema>;
export type SkillStagedSummary = z.infer<typeof SkillStagedSummarySchema>;
export type SkillStageFromUrlRequest = z.infer<typeof SkillStageFromUrlRequestSchema>;
export type SkillStageFromUrlResult = z.infer<typeof SkillStageFromUrlResultSchema>;
export type SkillStageFromMarkdownRequest = z.infer<typeof SkillStageFromMarkdownRequestSchema>;
export type SkillStageFromMarkdownResult = z.infer<typeof SkillStageFromMarkdownResultSchema>;
export type SkillStageFromZipRequest = z.infer<typeof SkillStageFromZipRequestSchema>;
export type SkillStageFromZipResult = z.infer<typeof SkillStageFromZipResultSchema>;
export type SkillPendingStagedReviewsRequest = z.infer<typeof SkillPendingStagedReviewsRequestSchema>;
export type SkillPendingStagedReviewsResult = z.infer<typeof SkillPendingStagedReviewsResultSchema>;
export type SkillInstallStagedRequest = z.infer<typeof SkillInstallStagedRequestSchema>;
export type SkillInstallStagedResult = z.infer<typeof SkillInstallStagedResultSchema>;
export type SkillDiscardStagedRequest = z.infer<typeof SkillDiscardStagedRequestSchema>;
export type SkillDiscardStagedResult = z.infer<typeof SkillDiscardStagedResultSchema>;
export type MemoryKind = z.infer<typeof MemoryKindSchema>;
export type MemoryRecordId = z.infer<typeof MemoryRecordIdSchema>;
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;
export type MemoryRecordSummary = z.infer<typeof MemoryRecordSummarySchema>;
export type MemorySummary = z.infer<typeof MemorySummarySchema>;
export type MemoryListRequest = z.infer<typeof MemoryListRequestSchema>;
export type MemoryRequestId = z.infer<typeof MemoryRequestIdSchema>;
export type MemoryDisableRequest = z.infer<typeof MemoryDisableRequestSchema>;
export type MemoryEnableRequest = z.infer<typeof MemoryEnableRequestSchema>;
export type MemoryDeleteRequest = z.infer<typeof MemoryDeleteRequestSchema>;
export type MemoryEditRequest = z.infer<typeof MemoryEditRequestSchema>;
export type MemoryResetRequest = z.infer<typeof MemoryResetRequestSchema>;
export type MemoryExportRequest = z.infer<typeof MemoryExportRequestSchema>;
export type MemoryMutationResult = z.infer<typeof MemoryMutationResultSchema>;
export type MemoryLifecycleMutationResult = z.infer<typeof MemoryLifecycleMutationResultSchema>;
export type MemoryExportResult = z.infer<typeof MemoryExportResultSchema>;
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
export type LocalSemanticRetrievalRequestId = z.infer<typeof LocalSemanticRetrievalRequestIdSchema>;
export type LocalSemanticRetrievalAssetState = z.infer<typeof LocalSemanticRetrievalAssetStateSchema>;
export type LocalSemanticRetrievalStatusRequest = z.infer<typeof LocalSemanticRetrievalStatusRequestSchema>;
export type LocalSemanticRetrievalStatus = z.infer<typeof LocalSemanticRetrievalStatusSchema>;
export type LocalSemanticRetrievalInstallRequest = z.infer<typeof LocalSemanticRetrievalInstallRequestSchema>;
export type LocalSemanticRetrievalEnableRequest = z.infer<typeof LocalSemanticRetrievalEnableRequestSchema>;
export type LocalSemanticRetrievalDisableRequest = z.infer<typeof LocalSemanticRetrievalDisableRequestSchema>;
export type LocalSemanticRetrievalRemoveRequest = z.infer<typeof LocalSemanticRetrievalRemoveRequestSchema>;
export type LocalSemanticRetrievalInstallResult = z.infer<typeof LocalSemanticRetrievalInstallResultSchema>;
export type LocalSemanticRetrievalEnableResult = z.infer<typeof LocalSemanticRetrievalEnableResultSchema>;
export type LocalSemanticRetrievalMutationResult = z.infer<typeof LocalSemanticRetrievalMutationResultSchema>;
export type LocalSemanticRetrievalDisableResult = z.infer<typeof LocalSemanticRetrievalDisableResultSchema>;
export type LocalSemanticRetrievalRemoveResult = z.infer<typeof LocalSemanticRetrievalRemoveResultSchema>;
export type LocalRerankerRequestId = z.infer<typeof LocalRerankerRequestIdSchema>;
export type LocalRerankerStatusRequest = z.infer<typeof LocalRerankerStatusRequestSchema>;
export type LocalRerankerStatus = z.infer<typeof LocalRerankerStatusSchema>;
export type LocalRerankerInstallRequest = z.infer<typeof LocalRerankerInstallRequestSchema>;
export type LocalRerankerEnableRequest = z.infer<typeof LocalRerankerEnableRequestSchema>;
export type LocalRerankerDisableRequest = z.infer<typeof LocalRerankerDisableRequestSchema>;
export type LocalRerankerRemoveRequest = z.infer<typeof LocalRerankerRemoveRequestSchema>;
export type LocalRerankerInstallResult = z.infer<typeof LocalRerankerInstallResultSchema>;
export type LocalRerankerEnableResult = z.infer<typeof LocalRerankerEnableResultSchema>;
export type LocalRerankerMutationResult = z.infer<typeof LocalRerankerMutationResultSchema>;
export type LocalRerankerDisableResult = z.infer<typeof LocalRerankerDisableResultSchema>;
export type LocalRerankerRemoveResult = z.infer<typeof LocalRerankerRemoveResultSchema>;
export type OcrLanguagePreferenceRequestId = z.infer<typeof OcrLanguagePreferenceRequestIdSchema>;
export type OcrEnginePreferenceRequestId = z.infer<typeof OcrEnginePreferenceRequestIdSchema>;
export type OcrImageTestRequestId = z.infer<typeof OcrImageTestRequestIdSchema>;
export type OcrImageTestRequest = z.infer<typeof OcrImageTestRequestSchema>;
export type OcrImageTestPreview = z.infer<typeof OcrImageTestPreviewSchema>;
export type OcrImageTestResult = z.infer<typeof OcrImageTestResultSchema>;
export type OcrEnginePreference = z.infer<typeof OcrEnginePreferenceSchema>;
export type OcrEnginePreferenceMachineSettings = z.infer<typeof OcrEnginePreferenceMachineSettingsSchema>;
export type OcrEnginePreferenceSummary = z.infer<typeof OcrEnginePreferenceSummarySchema>;
export type OcrEnginePreferenceRequest = z.infer<typeof OcrEnginePreferenceRequestSchema>;
export type OcrEnginePreferenceResult = z.infer<typeof OcrEnginePreferenceResultSchema>;
export type SetOcrEnginePreferenceRequest = z.infer<typeof SetOcrEnginePreferenceRequestSchema>;
export type SetOcrEnginePreferenceResult = z.infer<typeof SetOcrEnginePreferenceResultSchema>;
export type OcrSummaryPreferenceRequestId = z.infer<typeof OcrSummaryPreferenceRequestIdSchema>;
export type OcrSummaryPreferenceSummary = z.infer<typeof OcrSummaryPreferenceSummarySchema>;
export type OcrSummaryPreferenceRequest = z.infer<typeof OcrSummaryPreferenceRequestSchema>;
export type OcrSummaryPreferenceResult = z.infer<typeof OcrSummaryPreferenceResultSchema>;
export type SetOcrSummaryPreferenceRequest = z.infer<typeof SetOcrSummaryPreferenceRequestSchema>;
export type SetOcrSummaryPreferenceResult = z.infer<typeof SetOcrSummaryPreferenceResultSchema>;
export type OcrLanguagePreference = z.infer<typeof OcrLanguagePreferenceSchema>;
export type OcrLanguagePreferenceMachineSettings = z.infer<typeof OcrLanguagePreferenceMachineSettingsSchema>;
export type OcrLanguagePreferenceSummary = z.infer<typeof OcrLanguagePreferenceSummarySchema>;
export type OcrLanguagePreferenceRequest = z.infer<typeof OcrLanguagePreferenceRequestSchema>;
export type OcrLanguagePreferenceResult = z.infer<typeof OcrLanguagePreferenceResultSchema>;
export type SetOcrLanguagePreferenceRequest = z.infer<typeof SetOcrLanguagePreferenceRequestSchema>;
export type SetOcrLanguagePreferenceResult = z.infer<typeof SetOcrLanguagePreferenceResultSchema>;
export type DictationLanguagePreferenceRequestId = z.infer<typeof DictationLanguagePreferenceRequestIdSchema>;
export type DictationLanguagePreference = z.infer<typeof DictationLanguagePreferenceSchema>;
export type DictationLanguagePreferenceMachineSettings = z.infer<typeof DictationLanguagePreferenceMachineSettingsSchema>;
export type DictationLanguagePreferenceSummary = z.infer<typeof DictationLanguagePreferenceSummarySchema>;
export type DictationLanguagePreferenceRequest = z.infer<typeof DictationLanguagePreferenceRequestSchema>;
export type DictationLanguagePreferenceResult = z.infer<typeof DictationLanguagePreferenceResultSchema>;
export type SetDictationLanguagePreferenceRequest = z.infer<typeof SetDictationLanguagePreferenceRequestSchema>;
export type SetDictationLanguagePreferenceResult = z.infer<typeof SetDictationLanguagePreferenceResultSchema>;
export type PaddleOcrRequestId = z.infer<typeof PaddleOcrRequestIdSchema>;
export type PaddleOcrLifecycleState = z.infer<typeof PaddleOcrLifecycleStateSchema>;
export type PaddleOcrLifecycleAction = z.infer<typeof PaddleOcrLifecycleActionSchema>;
export type PaddleOcrCatalogComponent = z.infer<typeof PaddleOcrCatalogComponentSchema>;
export type PaddleOcrSummaryRequest = z.infer<typeof PaddleOcrSummaryRequestSchema>;
export type PaddleOcrSummary = z.infer<typeof PaddleOcrSummarySchema>;
export type PaddleOcrInstallRequest = z.infer<typeof PaddleOcrInstallRequestSchema>;
export type PaddleOcrInstallResult = z.infer<typeof PaddleOcrInstallResultSchema>;
export type PaddleOcrEnableRequest = z.infer<typeof PaddleOcrEnableRequestSchema>;
export type PaddleOcrEnableResult = z.infer<typeof PaddleOcrEnableResultSchema>;
export type PaddleOcrTestRequest = z.infer<typeof PaddleOcrTestRequestSchema>;
export type PaddleOcrTestResult = z.infer<typeof PaddleOcrTestResultSchema>;
export type PaddleOcrDisableRequest = z.infer<typeof PaddleOcrDisableRequestSchema>;
export type PaddleOcrDisableResult = z.infer<typeof PaddleOcrDisableResultSchema>;
export type PaddleOcrRemoveRequest = z.infer<typeof PaddleOcrRemoveRequestSchema>;
export type PaddleOcrRemoveResult = z.infer<typeof PaddleOcrRemoveResultSchema>;
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
export type DiagnosticsClearRequestId = z.infer<typeof DiagnosticsClearRequestIdSchema>;
export type DiagnosticsClearLocalRequest = z.infer<typeof DiagnosticsClearLocalRequestSchema>;
export type DiagnosticsClearLocalResult = z.infer<typeof DiagnosticsClearLocalResultSchema>;
export type SettingApplyBehavior = z.infer<typeof SettingApplyBehaviorSchema>;
export type SettingPermissionRequirement = z.infer<typeof SettingPermissionRequirementSchema>;
export type SettingScope = z.infer<typeof SettingScopeSchema>;
export type Bcp47LanguageTag = z.infer<typeof Bcp47LanguageTagSchema>;
export type DurableLanguage = z.infer<typeof DurableLanguageSchema>;
export type DurableLanguageDomain = z.infer<typeof DurableLanguageDomainSchema>;
export type DurableLanguageBasis = z.infer<typeof DurableLanguageBasisSchema>;
export type DurableLanguageFact = z.infer<typeof DurableLanguageFactSchema>;
export type SourceRecordLanguageFact = z.infer<typeof SourceRecordLanguageFactSchema>;
export type MarkdownPageLanguageFact = z.infer<typeof MarkdownPageLanguageFactSchema>;
export type OcrArtifactLanguageFact = z.infer<typeof OcrArtifactLanguageFactSchema>;
export type ChunkLanguageFact = z.infer<typeof ChunkLanguageFactSchema>;
export type MemoryLanguageFact = z.infer<typeof MemoryLanguageFactSchema>;
export type QueryLanguageFact = z.infer<typeof QueryLanguageFactSchema>;
export type ResponseLanguageFact = z.infer<typeof ResponseLanguageFactSchema>;
export type ConversationLanguageContinuity = z.infer<typeof ConversationLanguageContinuitySchema>;
export type LocalDatabaseSchemaState = z.infer<typeof LocalDatabaseSchemaStateSchema>;
export type Locale = z.infer<typeof LocaleSchema>;
export type SourceAssetRootKind = z.infer<typeof SourceAssetRootKindSchema>;
export type SourceKind = z.infer<typeof SourceKindSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type SourceStorageStrategy = z.infer<typeof SourceStorageStrategySchema>;
export type ToolchainManifest = z.infer<typeof ToolchainManifestSchema>;
export type ToolchainToolId = z.infer<typeof ToolchainToolIdSchema>;
export type ToolchainRepairRequestId = z.infer<typeof ToolchainRepairRequestIdSchema>;
export type ToolchainHealthId = z.infer<typeof ToolchainHealthIdSchema>;
export type ToolchainRepairEligibility = z.infer<typeof ToolchainRepairEligibilitySchema>;
export type ToolchainRepairRequest = z.infer<typeof ToolchainRepairRequestSchema>;
export type ToolchainRepairResult = z.infer<typeof ToolchainRepairResultSchema>;
export type VaultConfig = z.infer<typeof VaultConfigSchema>;
export type VaultManifest = z.infer<typeof VaultManifestSchema>;
export type VaultManifestV1 = z.infer<typeof VaultManifestV1Schema>;
export type VaultManifestV2 = z.infer<typeof VaultManifestV2Schema>;
export type VaultDurableDomainVersionsV2 = z.infer<typeof VaultDurableDomainVersionsV2Schema>;
export type VaultManifestCompatibilityHeader = z.infer<typeof VaultManifestCompatibilityHeaderSchema>;
export type VaultMigrationRequestId = z.infer<typeof VaultMigrationRequestIdSchema>;
export type VaultMigrationPreviewId = z.infer<typeof VaultMigrationPreviewIdSchema>;
export type VaultMigrationClass = z.infer<typeof VaultMigrationClassSchema>;
export type VaultMigrationAffectedDomain = z.infer<typeof VaultMigrationAffectedDomainSchema>;
export type VaultMigrationWarning = z.infer<typeof VaultMigrationWarningSchema>;
export type VaultMigrationPreview = z.infer<typeof VaultMigrationPreviewSchema>;
export type VaultOpenInvalidReason = z.infer<typeof VaultOpenInvalidReasonSchema>;
export type VaultMigrationCheckpoint = z.infer<typeof VaultMigrationCheckpointSchema>;
export type VaultMigrationApplyRequest = z.infer<typeof VaultMigrationApplyRequestSchema>;
export type VaultMigrationApplyResult = z.infer<typeof VaultMigrationApplyResultSchema>;
export type VaultDisplayName = z.infer<typeof VaultDisplayNameSchema>;
export type VaultMetadataRevision = z.infer<typeof VaultMetadataRevisionSchema>;
export type VaultMetadataSummary = z.infer<typeof VaultMetadataSummarySchema>;
export type VaultRenameDisplayNameRequestId = z.infer<typeof VaultRenameDisplayNameRequestIdSchema>;
export type VaultRenameDisplayNameRequest = z.infer<typeof VaultRenameDisplayNameRequestSchema>;
export type VaultRenameDisplayNameResult = z.infer<typeof VaultRenameDisplayNameResultSchema>;
export type RecentVaultRevision = z.infer<typeof RecentVaultRevisionSchema>;
export type RecentVaultForgetRequest = z.infer<typeof RecentVaultForgetRequestSchema>;
export type RecentVaultForgetResult = z.infer<typeof RecentVaultForgetResultSchema>;
export type RecentVaultReconnectRequest = z.infer<typeof RecentVaultReconnectRequestSchema>;
export type RecentVaultReconnectResult = z.infer<typeof RecentVaultReconnectResultSchema>;
export type SourceStorageRevision = z.infer<typeof SourceStorageRevisionSchema>;
export type ManagedCopyRootSummary = z.infer<typeof ManagedCopyRootSummarySchema>;
export type ManagedCopyRootConfigureRequestId = z.infer<typeof ManagedCopyRootConfigureRequestIdSchema>;
export type ManagedCopyRootConfigureRequest = z.infer<typeof ManagedCopyRootConfigureRequestSchema>;
export type ManagedCopyRootConfigureResult = z.infer<typeof ManagedCopyRootConfigureResultSchema>;
export type VaultStorageRelocationRevision = z.infer<typeof VaultStorageRelocationRevisionSchema>;
export type VaultStorageRelocationStatus = z.infer<typeof VaultStorageRelocationStatusSchema>;
export type VaultStorageRelocationRequestId = z.infer<typeof VaultStorageRelocationRequestIdSchema>;
export type VaultStorageRelocationRequest = z.infer<typeof VaultStorageRelocationRequestSchema>;
export type VaultStorageRelocationResult = z.infer<typeof VaultStorageRelocationResultSchema>;
export type WindowLayoutMode = z.infer<typeof WindowLayoutModeSchema>;
export type WindowLayoutRequest = z.infer<typeof WindowLayoutRequestSchema>;
export type WindowLayoutState = z.infer<typeof WindowLayoutStateSchema>;
export type WindowLayoutSurface = z.infer<typeof WindowLayoutSurfaceSchema>;
export type WindowPanePresentation = z.infer<typeof WindowPanePresentationSchema>;
export type WindowPreferences = z.infer<typeof WindowPreferencesSchema>;
export type WindowSize = z.infer<typeof WindowSizeSchema>;
