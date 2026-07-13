import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`missing contract file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function requireText(relativePath, values) {
  const text = read(relativePath);
  for (const value of values) {
    if (!text.includes(value)) failures.push(`${relativePath} is missing contract marker: ${value}`);
  }
}

function forbid(relativePath, pattern, label) {
  const text = read(relativePath);
  if (pattern.test(text)) failures.push(`${relativePath} contains forbidden ${label}.`);
}

function enumValues(source, exportName) {
  const pattern = new RegExp(`export const ${exportName} = z\\.enum\\(\\[([\\s\\S]*?)\\]\\);`, "u");
  const body = source.match(pattern)?.[1];
  if (!body) {
    failures.push(`packages/schemas/src/index.ts is missing parseable ${exportName}.`);
    return [];
  }
  return [...body.matchAll(/"([a-z0-9_]+)"/gu)].map((match) => match[1]);
}

function requireEnumDocumented(schemaSource, exportName, relativePath) {
  const document = read(relativePath);
  for (const value of enumValues(schemaSource, exportName)) {
    if (!document.includes(`\`${value}\``)) {
      failures.push(`${relativePath} does not document ${exportName} value ${value}.`);
    }
  }
}

function requireEnumLiteralDocumented(schemaSource, exportName, relativePath) {
  const document = read(relativePath);
  for (const value of enumValues(schemaSource, exportName)) {
    if (!document.includes(`\"${value}\"`) && !document.includes(`\`${value}\``)) {
      failures.push(`${relativePath} does not document ${exportName} value ${value}.`);
    }
  }
}

function declaredTypeLines(source, typeName) {
  const pattern = new RegExp(`^type\\s+${typeName}\\s*=`, "gmu");
  return [...source.matchAll(pattern)].map((match) => source.slice(0, match.index).split("\n").length);
}

function enforceTypeOwner(typeName, ownerPath, relativePaths) {
  let ownerDeclarations = 0;
  for (const relativePath of relativePaths) {
    const declarations = declaredTypeLines(read(relativePath), typeName);
    if (relativePath === ownerPath) ownerDeclarations += declarations.length;
    for (const line of declarations) {
      if (relativePath !== ownerPath) {
        failures.push(`${relativePath}:${line} redeclares ${typeName}; its human-readable owner is ${ownerPath}.`);
      }
    }
  }
  if (ownerDeclarations !== 1) {
    failures.push(`${ownerPath} must declare ${typeName} exactly once; found ${ownerDeclarations}.`);
  }
}

function zodObjectKeys(source, declarationPattern, label) {
  const body = source.match(declarationPattern)?.[1];
  if (!body) {
    failures.push(`packages/schemas/src/index.ts is missing parseable ${label}.`);
    return [];
  }
  return [...body.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gmu)].map((match) => match[1]);
}

const schema = read("packages/schemas/src/index.ts");

requireText("packages/schemas/src/index.ts", [
  "export const SourceIdSchema",
  "export const PageIdSchema",
  "export const ConversationEventIdSchema",
  "export const JobIdSchema",
  "export const OperationIdSchema",
  "export const ArtifactIdSchema",
  "export const RootBindingIdSchema",
  "export const PermissionRequestIdSchema",
  "export const PermissionDecisionIdSchema",
  "export const JobClassSchema",
  "export const JobStateSchema",
  "export const OperationRecordSchema",
  "export const BackupManifestSchema",
  "export const ProviderProfileSchema",
  "export const PermissionRequestSchema",
  "export const SourceStorageStrategySchema",
  "export const ModelEgressDecisionSchema",
  "export const PigeErrorDomainSchema",
  "export const PigeErrorActionSchema",
  "export const PigeErrorSchema",
  "export const PigeWarningSchema",
  "export const PigeErrorSummarySchema",
  "export const DiagnosticErrorSchema"
]);

requireEnumDocumented(schema, "JobClassSchema", "docs/JOB_OPERATION_AND_RECOVERY.md");
requireEnumDocumented(schema, "JobStateSchema", "docs/JOB_OPERATION_AND_RECOVERY.md");
requireEnumDocumented(schema, "SourceStorageStrategySchema", "docs/SOURCE_STORAGE_STRATEGY.md");
requireEnumDocumented(schema, "MarkdownPageTypeSchema", "docs/MARKDOWN_SCHEMA.md");
requireEnumDocumented(schema, "MarkdownPageStatusSchema", "docs/MARKDOWN_SCHEMA.md");
requireEnumLiteralDocumented(schema, "PigeErrorDomainSchema", "docs/API_AND_IPC_DESIGN.md");
requireEnumLiteralDocumented(schema, "PigeErrorActionSchema", "docs/API_AND_IPC_DESIGN.md");

requireText("docs/DOMAIN_MODEL.md", [
  "| `page_` | Wiki or source page |",
  "| `art_` | Extracted artifact |",
  "| `evt_` | Conversation event |",
  "| `permreq_` | Permission request |",
  "| `permdec_` | Permission decision |",
  "Retired aliases `pg_`, `artifact_`, and `event_`"
]);
requireText("docs/MARKDOWN_SCHEMA.md", [
  "id: \"page_",
  "schema_version: 1",
  "operational authority",
  "bounded human-readable projection"
]);
requireText("apps/desktop/src/main/services/source-page-service.ts", [
  "source_record_schema_version:",
  "source_record_updated_at:",
  "artifact_ids:",
  "artifact.id"
]);
requireText("docs/JOB_OPERATION_AND_RECOVERY.md", [
  "`JobRecordSchema` in `packages/schemas/src/index.ts` is the executable authority",
  "Durable records use `state`; `status` is not a JobRecord field",
  "`waiting_dependency`"
]);
requireText("packages/schemas/src/index.ts", [
  "warnings: z.array(PigeWarningSchema).optional()",
  "error: PigeErrorSummarySchema.optional()"
]);
requireText("packages/schemas/src/index.ts", [
  "}).strict().superRefine(requireErrorDomainMatchesCode);"
]);
requireText("docs/API_AND_IPC_DESIGN.md", [
  "Shared warning/error objects are strict"
]);
requireText("packages/contracts/src/index.ts", [
  "PigeErrorDomain",
  "PigeErrorAction",
  "PigeErrorSummary",
  "DiagnosticError"
]);
requireText("docs/API_AND_IPC_DESIGN.md", [
  "`PigeErrorDomainSchema`",
  "`PigeErrorSchema`",
  "another process or document must not create a second enum vocabulary"
]);
requireText("docs/PERFORMANCE_AND_RELIABILITY.md", [
  "Canonical job classes, states, and the `state` field are owned by",
  "`waiting_dependency` is a canonical state"
]);

requireText("docs/SOURCE_STORAGE_STRATEGY.md", [
  "`managedCopyRoot`",
  "`artifactRoot`",
  "`sourceAssetRoot` is a compatibility/UI name",
  "`rootId`",
  "explicitly incomplete backup",
  "Root IDs are unique within the registry",
  "external root cannot claim `vault_relative`"
]);
requireText("packages/schemas/src/index.ts", [
  "Each external managed-copy root ID must be unique.",
  "The in-vault managed-copy root must use a vault_relative path.",
  "An external managed-copy root must use a root_relative path."
]);
requireText("docs/DATA_ARCHITECTURE.md", [
  "SOURCE_STORAGE_STRATEGY.md#3-storage-roots",
  "Existing source records keep their prior `rootId`",
  "`replace_existing`",
  "`clone_as_new`",
  "Two simultaneously registered paths must never share one `vault_id`"
]);
requireText("docs/SYNC_CONFLICT_AND_MIGRATION.md", [
  "sidecar remains operational authority",
  "never retarget to the current default root"
]);
requireText("docs/JOB_OPERATION_AND_RECOVERY.md", [
  "Backup creates a durable `backup` job before preflight",
  "`replace_existing` preserves the vault ID",
  "`clone_as_new` mints a vault ID"
]);
requireText("resources/traceability/acceptance.manifest.json", [
  "Durable backup Job/checkpoint resume and external-dependency completeness remain open."
]);

requireText("docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md", [
  "`ProviderProfileSchema` in `packages/schemas/src/index.ts` is the executable profile contract",
  "`ProviderBaseUrlSchema` is the single persisted and runtime-call URL contract",
  "use their fixed built-in endpoints, do not persist `baseUrl`",
  "rejects both directions of a mismatch",
  "cannot persist arbitrary `defaultHeaders`",
  "Authentication, network, timeout, invalid payload, and official-provider list failures remain failures"
]);
requireText("docs/SECURITY_THREAT_MODEL.md", [
  "Authorization and confirmation are separate gates",
  "raw-secret read is never an extension capability",
  "Model Egress Decision",
  "A `confirm` or `block` result is not weakened by YOLO"
]);
requireText("docs/AGENT_RUNTIME_POLICY_CONTEXT.md", [
  "type ModelEgressDecision",
  "Decision matrix:",
  "`unknown`, or `local` without loopback verification",
  "It is always blocked and cannot be overridden by YOLO"
]);
requireText("docs/CONTEXT_ASSEMBLY_AND_RETRIEVAL_POLICY.md", [
  "type UserTaskEnvelope",
  "Pasted or attached evidence",
  "before prompt rendering or provider credential lookup"
]);
requireText("docs/TECH_ARCHITECTURE.md", [
  "only owner of implementation Phase numbers",
  "intentionally does not redefine them",
  "sole human-readable owner of channel names",
  "storage-root model",
  "`SourceStorageStrategySchema`",
  "Security Threat Model permission model",
  "`PermissionRequestSchema`",
  "sole human-readable owner of provider/profile semantics",
  "internal routing extension point"
]);
requireText("docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md", [
  "Settings, Providers, and Tools API domain",
  "Jobs API domain",
  "not a second IPC vocabulary"
]);
requireText("docs/ONBOARDING_AND_FIRST_RUN.md", [
  "Vault and onboarding",
  "Settings, Providers, and Tools",
  "does not define channel aliases or a second `OnboardingStatus` shape"
]);
requireText("docs/DIAGNOSTICS_AND_OBSERVABILITY.md", [
  "type DiagnosticError = Pick<",
  "common API error envelope",
  "Diagnostics API domain",
  "sole owner of diagnostics channel names"
]);
requireText("packages/schemas/src/index.ts", [
  "export const ProviderBaseUrlSchema",
  "isBuiltInProviderKind",
  "isProviderLoopbackHostname",
  "Only a canonical loopback provider URL may use local or loopback_verified boundary metadata.",
  "A denial must use the never decision scope.",
  "An allow-once decision must use the once decision scope.",
  "A saved-grant or YOLO auto-allow must be recorded as a system decision."
]);
requireText("packages/schemas/src/index.ts", [
  "permissionRequestIds: z.array(PermissionRequestIdSchema).optional()",
  "permissionDecisionIds: z.array(PermissionDecisionIdSchema)",
  "requiredPermissionIds: z.array(z.union([PermissionRequestIdSchema, PermissionDecisionIdSchema]))"
]);
requireText("docs/JOB_OPERATION_AND_RECOVERY.md", [
  "`requiredPermissionIds` is a compatibility field",
  "canonical `permreq_` request IDs or `permdec_` decision IDs"
]);
requireText("apps/desktop/src/main/services/model-provider-connection.ts", ["normalizeProviderBaseUrl"]);
requireText("apps/desktop/src/main/services/pi-agent-runtime-adapter.ts", ["normalizeProviderBaseUrl"]);
requireText("apps/desktop/src/main/services/model-provider-registry.ts", [
  "normalizeProviderBaseUrl",
  "isProviderLoopbackHostname"
]);
requireText("packages/domain/src/index.ts", [
  "export const PIGE_REQUIREMENT_ID_PATTERN = /^PIGE-([A-Z][A-Z0-9]*)-(\\d{3})$/;"
]);

forbid("docs/TECH_ARCHITECTURE.md", /^Phase 0: Design baseline\.$/mu, "alternate implementation phase plan");
forbid("docs/TECH_ARCHITECTURE.md", /type ProviderProfile\s*=/u, "duplicate ProviderProfile type");
forbid("docs/TECH_ARCHITECTURE.md", /type SourceRoots\s*=/u, "duplicate source-root type");
forbid("docs/TECH_ARCHITECTURE.md", /type Permission(?:DefaultMode|DecisionScope|ResourceScope|Request)\s*=/u, "duplicate permission type");
forbid("docs/DIAGNOSTICS_AND_OBSERVABILITY.md", /type DiagnosticError\s*=\s*\{/u, "copied DiagnosticError core");
forbid("docs/DATA_ARCHITECTURE.md", /unless the user explicitly creates a redacted support bundle/iu, "secret-export exception");
forbid(
  "apps/desktop/src/main/services/source-page-service.ts",
  /managed_copy_path:|artifact_paths:|- Managed copy:/u,
  "new source-page compatibility locator emission"
);
forbid(
  "packages/schemas/src/index.ts",
  /warnings:\s*z\.array\(z\.record\(z\.string\(\), z\.unknown\(\)\)\)/u,
  "unstructured durable Job warnings"
);
forbid(
  "packages/schemas/src/index.ts",
  /error:\s*z\.record\(z\.string\(\), z\.unknown\(\)\)\.optional\(\)/u,
  "unstructured durable Job error"
);
forbid(
  "apps/desktop/src/main/services/model-provider-connection.ts",
  /function normalizeBaseUrl/u,
  "provider-connection-only base URL validator"
);
forbid(
  "apps/desktop/src/main/services/pi-agent-runtime-adapter.ts",
  /function normalizeBaseUrl/u,
  "Pi-adapter-only base URL validator"
);

const normativeFiles = [
  "AGENTS.md",
  "README.md",
  ...fs.readdirSync(path.join(root, "docs"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => `docs/${entry.name}`)
    .filter((file) => ![
      "docs/DECISION_LOG.md",
      "docs/PI_PACKAGE_RESEARCH.md"
    ].includes(file))
];

for (const [typeName, ownerPath] of [
  ["SourceStorageStrategy", "docs/SOURCE_STORAGE_STRATEGY.md"],
  ["ModelTaskClass", "docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md"],
  ["ProviderProfile", "docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md"],
  ["ModelProfile", "docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md"],
  ["OnboardingStatus", "docs/API_AND_IPC_DESIGN.md"],
  ["PigeError", "docs/API_AND_IPC_DESIGN.md"],
  ["DiagnosticError", "docs/DIAGNOSTICS_AND_OBSERVABILITY.md"]
]) {
  enforceTypeOwner(typeName, ownerPath, normativeFiles);
}

const diagnosticDocument = read("docs/DIAGNOSTICS_AND_OBSERVABILITY.md");
const errorCoreFields = zodObjectKeys(
  schema,
  /const PigeErrorCoreSchema = z\.object\(\{([\s\S]*?)\n\}\);/u,
  "PigeErrorCoreSchema"
);
for (const field of errorCoreFields) {
  if (!diagnosticDocument.includes(`| "${field}"`)) {
    failures.push(`docs/DIAGNOSTICS_AND_OBSERVABILITY.md DiagnosticError delta is missing shared core field ${field}.`);
  }
}
const diagnosticDeltaFields = zodObjectKeys(
  schema,
  /export const DiagnosticErrorSchema = PigeErrorCoreSchema\.extend\(\{([\s\S]*?)\n\}\)\.strict/u,
  "DiagnosticErrorSchema delta"
);
for (const field of diagnosticDeltaFields) {
  if (!new RegExp(`^\\s*${field}\\??:`, "mu").test(diagnosticDocument)) {
    failures.push(`docs/DIAGNOSTICS_AND_OBSERVABILITY.md DiagnosticError delta is missing extension field ${field}.`);
  }
}

const apiDocument = read("docs/API_AND_IPC_DESIGN.md");
const mainProcessSource = read("apps/desktop/src/main/index.ts");
for (const match of mainProcessSource.matchAll(/ipcMain\.handle\("([a-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*)"/gu)) {
  const channel = match[1];
  if (!apiDocument.includes(`\`${channel}\``)) {
    failures.push(`docs/API_AND_IPC_DESIGN.md does not own implemented IPC channel ${channel}.`);
  }
}

const staleChannelAliases = [
  "capture.startVoiceInput",
  "capture.stopVoiceInput",
  "capture.inspectDroppedFiles",
  "vault.switch",
  "vault.getOverview",
  "notes.list",
  "notes.read",
  "conversations.list",
  "conversations.read",
  "conversations.pruneMetadataOnly",
  "permissions.list",
  "permissions.decide",
  "permissions.revoke",
  "retrieval.openResult",
  "noteAgent.ask",
  "noteAgent.suggestLinks",
  "selection.runAction",
  "settings.get",
  "settings.updateProvider",
  "backup.restore",
  "models.setDefault",
  "models.list",
  "agent.runJob",
  "agent.cancelJob",
  "agent.retryJob",
  "providers.add",
  "providers.test",
  "providers.refreshModels",
  "providers.addManualModel",
  "diagnostics.healthChanged",
  "diagnostics.exportProgress"
];

const currentSourceStrategyBranch = /^\s*\|\s*"link_to_original"/mu;
for (const relativePath of normativeFiles) {
  const document = read(relativePath);
  if (currentSourceStrategyBranch.test(document)) {
    failures.push(`${relativePath} promotes future link_to_original into a current SourceStorageStrategy union.`);
  }
  for (const alias of staleChannelAliases) {
    if (document.includes(`\`${alias}\``)) {
      failures.push(`${relativePath} uses stale or unowned IPC channel alias ${alias}.`);
    }
  }
}

// In-memory negative fixtures keep these owner-only detectors from silently weakening.
const ownerOnlyNegativeFixtures = [
  {
    label: "duplicate type",
    rejected: declaredTypeLines('type SourceStorageStrategy = "link_to_original";', "SourceStorageStrategy").length === 1
  },
  {
    label: "current source-strategy branch",
    rejected: currentSourceStrategyBranch.test('  | "link_to_original";')
  },
  {
    label: "stale IPC channel",
    rejected: staleChannelAliases.some((alias) => `Use \`${alias}\``.includes("`models.setDefault`"))
  },
  {
    label: "incomplete diagnostic error delta",
    rejected: ["code", "messageParams"].some((field) => !'| "code"'.includes(`| "${field}"`))
  }
];
for (const fixture of ownerOnlyNegativeFixtures) {
  if (!fixture.rejected) failures.push(`owner-only verifier negative fixture was accepted: ${fixture.label}.`);
}

const legacyPatterns = [
  { pattern: /\bpg_\d/iu, label: "emitted pg_ page ID" },
  { pattern: /\bevent_\d/iu, label: "emitted event_ conversation ID" },
  { pattern: /\bartifact_\d/iu, label: "emitted artifact_ artifact ID" },
  { pattern: /\bask_each_time\b/iu, label: "ask_each_time permission alias" },
  { pattern: /["`]access_secret["`]/iu, label: "raw-secret capability alias" },
  { pattern: /defaultHeaders\?\s*:/u, label: "persisted arbitrary provider headers" }
];
const migrationLanguage = /legacy|retired|compatib|migration|must not|do not|never|forbid|reject|cannot|does not|instead|example of invalid/iu;
for (const relativePath of normativeFiles) {
  const lines = read(relativePath).split("\n");
  lines.forEach((line, index) => {
    for (const legacy of legacyPatterns) {
      if (legacy.pattern.test(line) && !migrationLanguage.test(line)) {
        failures.push(`${relativePath}:${index + 1} contains ${legacy.label} outside an explicit compatibility/rejection rule.`);
      }
    }
  });
}

const obsoleteJobAliases = /`(?:capture_preserve|web_fetch|parse_source|backup_create|restore_validate)`/u;
for (const relativePath of [
  "docs/DOMAIN_MODEL.md",
  "docs/PERFORMANCE_AND_RELIABILITY.md",
  "docs/API_AND_IPC_DESIGN.md",
  "docs/TECH_ARCHITECTURE.md"
]) {
  const lines = read(relativePath).split("\n");
  lines.forEach((line, index) => {
    if (obsoleteJobAliases.test(line) && !migrationLanguage.test(line)) {
      failures.push(`${relativePath}:${index + 1} uses an obsolete Job class without identifying it as an invalid alias.`);
    }
  });
}

if (failures.length > 0) {
  console.error("Cross-document contract consistency errors:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Owner-only negative fixtures OK: rejected ${ownerOnlyNegativeFixtures.length} duplicate-type, stale-channel, error-delta, and source-strategy mutations.`
);
console.log(
  "Cross-document contracts OK: owner-only types, implemented IPC channels, shared error delta, source strategy, stable IDs, Job lifecycle, backup/restore, provider, permission, secret-use, and model-egress contracts are single-owned and compatibility-explicit."
);
