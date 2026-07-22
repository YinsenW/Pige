import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = "resources/large-paste-boundary.manifest.json";
const errors = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`missing large-paste contract file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function validate(candidate, report) {
  const exact = [
    [candidate.schemaVersion, 1, "schemaVersion"],
    [candidate.status, "implementation_bound_product_status_unchanged", "status"],
    [candidate.canonicalSchemaOwner, "packages/schemas/src/index.ts", "canonicalSchemaOwner"],
    [candidate.limits?.ordinaryTextMaxCodePoints, 8000, "ordinaryTextMaxCodePoints"],
    [candidate.limits?.stagedItemMaxCount, 8, "stagedItemMaxCount"],
    [candidate.limits?.largePasteItemMaxUtf8Bytes, 4 * 1024 * 1024, "largePasteItemMaxUtf8Bytes"],
    [candidate.limits?.largePasteAggregateMaxUtf8Bytes, 8 * 1024 * 1024, "largePasteAggregateMaxUtf8Bytes"],
    [candidate.measurement?.authoredText, "unicode_code_points", "authoredText measurement"],
    [candidate.measurement?.preservedPaste, "utf8_bytes", "preservedPaste measurement"],
    [candidate.measurement?.normalization, "none", "normalization"],
    [candidate.measurement?.trimming, "none", "trimming"],
    [candidate.implementationBinding, "bound", "implementationBinding"],
    [candidate.implementationEvidence?.strictRequestSchema, "AgentSubmitTurnRequestSchema", "strictRequestSchema"],
    [candidate.implementationEvidence?.strictStagedResultSchema, "AgentStagedSubmitTurnResultSchema", "strictStagedResultSchema"],
    [candidate.implementationEvidence?.earlyDurableReceiptSchema, "AgentSubmitTurnAcceptedResultSchema", "earlyDurableReceiptSchema"],
    [candidate.implementationEvidence?.preloadResultValidation, "AgentSubmitTurnIpcResultSchema", "preloadResultValidation"]
  ];
  for (const [actual, expected, label] of exact) {
    if (actual !== expected) report.push(`${label} must equal ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`);
  }
  if (JSON.stringify(candidate.stagedItemKinds) !== JSON.stringify(["file", "large_paste"])) {
    report.push("stagedItemKinds must be the ordered file/large_paste union");
  }
  if (JSON.stringify(candidate.rejectionReasons) !== JSON.stringify(["item_limit", "item_too_large", "aggregate_too_large"])) {
    report.push("rejectionReasons must retain the official three-value structural enum");
  }
  const exports = candidate.implementationExports ?? {};
  const constants = [
    "AGENT_AUTHORED_TEXT_MAX_CODE_POINTS",
    "AGENT_STAGED_ITEM_MAX_COUNT",
    "AGENT_LARGE_PASTE_ITEM_MAX_UTF8_BYTES",
    "AGENT_LARGE_PASTE_AGGREGATE_MAX_UTF8_BYTES"
  ];
  const types = ["AgentStagedItem", "AgentStagedLargePasteItem", "AgentStagedItemRejectionReason"];
  if (exports.module !== "@pige/schemas") report.push("implementation exports must be owned by @pige/schemas");
  if (JSON.stringify(exports.constants) !== JSON.stringify(constants)) report.push("implementation constants export list drifted");
  if (JSON.stringify(exports.types) !== JSON.stringify(types)) report.push("implementation types export list drifted");
  if (exports.consumersImportWithoutHardcoding !== true) report.push("UI/preload/service consumers must import shared exports without hardcoding");
  const safe = ["localizedLabel", "ordinal", "unicodeCodePointCount", "utf8ByteSize"];
  if (JSON.stringify(candidate.safePendingProjection) !== JSON.stringify(safe)) {
    report.push("safePendingProjection must contain only the four safe identity fields");
  }
  if ((candidate.preSubmitSideEffects ?? []).length !== 0) report.push("preSubmitSideEffects must remain empty");
  for (const key of ["oneClientTurnId", "oneParentJob", "orderedMixedItems", "preserveEachLargePasteExactlyOnce", "conversationStoresReferencesOnly"]) {
    if (candidate.submission?.[key] !== true) report.push(`submission.${key} must remain true`);
  }
  for (const key of ["preserveExactComposerText", "preserveItemsAndOrder", "preserveClientTurnId", "retryAdoptsWithoutDuplicate", "partialAcceptanceNeverClearsRejectedItems", "rejectedItemRemainsLocalAndBlocksSend"]) {
    if (candidate.failure?.[key] !== true) report.push(`failure.${key} must remain true`);
  }
  if (candidate.implementationEvidence?.mainReceiptBeforeScheduling !== true) report.push("mainReceiptBeforeScheduling must remain true");
  if (candidate.implementationEvidence?.productStatusPromotion !== false) report.push("implementation binding must not promote product status");
}

function requireSource(source, marker, label, report) {
  if (!source.includes(marker)) report.push(`implemented binding is missing ${label}`);
}

function validateImplementation(sources, report) {
  const { schema, contracts, main, preload } = sources;
  const constants = [
    ["AGENT_AUTHORED_TEXT_MAX_CODE_POINTS", "8_000"],
    ["AGENT_STAGED_ITEM_MAX_COUNT", "8"],
    ["AGENT_LARGE_PASTE_ITEM_MAX_UTF8_BYTES", "4_194_304"],
    ["AGENT_LARGE_PASTE_AGGREGATE_MAX_UTF8_BYTES", "8_388_608"]
  ];
  for (const [name, value] of constants) {
    requireSource(schema, `export const ${name} = ${value};`, `${name}=${value}`, report);
  }
  for (const name of ["AgentStagedItem", "AgentStagedLargePasteItem", "AgentStagedItemRejectionReason"]) {
    requireSource(schema, `export type ${name} =`, `${name} schema export`, report);
    requireSource(contracts, name, `${name} contracts projection`, report);
  }
  const schemaMarkers = [
    ["(value) => [...value].length <= AGENT_AUTHORED_TEXT_MAX_CODE_POINTS", "Unicode code-point text validation"],
    ["new TextEncoder().encode(item.text).byteLength !== item.utf8ByteSize", "exact UTF-8 byte validation"],
    ["stagedItems: z.array(AgentStagedItemSchema).max(AGENT_STAGED_ITEM_MAX_COUNT).readonly().optional()", "strict shared staged-item count"],
    ["if (item.ordinal !== index)", "strict ordered mixed items"],
    ["aggregatePasteBytes > AGENT_LARGE_PASTE_AGGREGATE_MAX_UTF8_BYTES", "aggregate paste byte validation"],
    ["export const AgentSubmitTurnAcceptedResultSchema", "early durable-acceptance receipt"],
    ["state: z.literal(\"accepted\")", "accepted receipt discriminator"],
    ["AgentStagedSubmitTurnResultSchema = z.union([", "strict staged submit result"],
    ["result.acceptedItems.length !== result.sourceIds.length", "accepted source-reference parity"]
  ];
  for (const [marker, label] of schemaMarkers) requireSource(schema, marker, label, report);
  for (const reason of ["item_limit", "item_too_large", "aggregate_too_large"]) {
    requireSource(schema, `\"${reason}\"`, `${reason} rejection value`, report);
  }
  requireSource(contracts, "readonly stagedItems?: readonly AgentStagedItem[]", "typed staged request projection", report);
  requireSource(preload, "AgentSubmitTurnIpcResultSchema.parse(", "preload result validation", report);
  const receipt = main.indexOf("const receipt = home.acceptPreparedSourceTurn(prepared)");
  const schedule = main.indexOf("scheduleAcceptedAgentTurn(() =>");
  const run = main.indexOf("home.runAcceptedPreparedSourceTurn(prepared, draftContext)");
  if (receipt < 0 || schedule <= receipt || run <= schedule) {
    report.push("main must durably accept the staged turn before scheduling model execution");
  }
}

let manifest = {};
try {
  manifest = JSON.parse(read(manifestPath));
} catch (error) {
  errors.push(`${manifestPath} is not valid JSON: ${error.message}`);
}
validate(manifest, errors);

const ownerMarkers = new Map([
  ["docs/PRD.md", [manifestPath, "Unicode code points", "staged-item list"]],
  ["docs/UI_PROTOTYPE.md", [manifestPath, "Pasted text", "composer text remains unchanged"]],
  ["docs/API_AND_IPC_DESIGN.md", [manifestPath, "large_paste", "4 MiB", "8 MiB"]],
  ["docs/DATA_ARCHITECTURE.md", [manifestPath, "managed text source", "references only"]],
  ["docs/SOURCE_STORAGE_STRATEGY.md", [manifestPath, "exact UTF-8", "copy_to_source_library"]],
  ["docs/JOB_OPERATION_AND_RECOVERY.md", [manifestPath, "ordered mixed staged items", "exactly once"]],
  ["docs/QUALITY_AND_TEST_STRATEGY.md", [manifestPath, "Unicode code-point", "partial acceptance"]],
  ["docs/V0_1_IMPLEMENTATION_PLAYBOOK.md", [manifestPath, "large-paste"]],
  ["docs/SPEC_TRACEABILITY.md", [manifestPath, "PIGE-CAP-002"]]
]);
for (const [relativePath, markers] of ownerMarkers) {
  const source = read(relativePath);
  for (const marker of markers) if (!source.includes(marker)) errors.push(`${relativePath} is missing large-paste marker: ${marker}`);
}

const schema = read("packages/schemas/src/index.ts");
const implementationSources = {
  schema,
  contracts: read("packages/contracts/src/index.ts"),
  main: read("apps/desktop/src/main/index.ts"),
  preload: read("apps/desktop/src/preload/index.ts")
};
validateImplementation(implementationSources, errors);

const acceptance = JSON.parse(read("resources/traceability/acceptance.manifest.json") || "{}");
if (acceptance.requirements?.["PIGE-CAP-002"]?.status !== "planned") errors.push("PIGE-CAP-002 must remain planned");
if (acceptance.exits?.["E2.02"]?.status !== "planned") errors.push("E2.02 must remain planned");

const mutations = [
  ["ordinaryTextMaxCodePoints", (copy) => { copy.limits.ordinaryTextMaxCodePoints = 8001; }],
  ["stagedItemMaxCount", (copy) => { copy.limits.stagedItemMaxCount = 9; }],
  ["largePasteItemMaxUtf8Bytes", (copy) => { copy.limits.largePasteItemMaxUtf8Bytes -= 1; }],
  ["largePasteAggregateMaxUtf8Bytes", (copy) => { copy.limits.largePasteAggregateMaxUtf8Bytes -= 1; }],
  ["normalization", (copy) => { copy.measurement.normalization = "NFC"; }],
  ["preSubmitSideEffects", (copy) => { copy.preSubmitSideEffects = ["job"]; }],
  ["retryAdoptsWithoutDuplicate", (copy) => { copy.failure.retryAdoptsWithoutDuplicate = false; }],
  ["rejection enum", (copy) => { copy.rejectionReasons[0] = "too_many_items"; }],
  ["binding status", (copy) => { copy.implementationBinding = "pending"; }],
  ["consumer hardcoding", (copy) => { copy.implementationExports.consumersImportWithoutHardcoding = false; }]
];
for (const [label, mutate] of mutations) {
  const copy = structuredClone(manifest);
  mutate(copy);
  const mutationErrors = [];
  validate(copy, mutationErrors);
  if (mutationErrors.length === 0) errors.push(`large-paste verifier mutation did not fail: ${label}`);
}

const sourceMutations = [
  ["constant", { ...implementationSources, schema: implementationSources.schema.replace("AGENT_AUTHORED_TEXT_MAX_CODE_POINTS = 8_000", "AGENT_AUTHORED_TEXT_MAX_CODE_POINTS = 8_001") }],
  ["order", { ...implementationSources, schema: implementationSources.schema.replace("if (item.ordinal !== index)", "if (false)") }],
  ["receipt", { ...implementationSources, main: implementationSources.main.replace("const receipt = home.acceptPreparedSourceTurn(prepared)", "const receipt = undefined") }],
  ["preload", { ...implementationSources, preload: implementationSources.preload.replace("AgentSubmitTurnIpcResultSchema.parse(", "unvalidatedResult(") }]
];
for (const [label, sources] of sourceMutations) {
  const mutationErrors = [];
  validateImplementation(sources, mutationErrors);
  if (mutationErrors.length === 0) errors.push(`implemented-binding source mutation did not fail: ${label}`);
}

if (errors.length > 0) {
  console.error("Large-paste boundary contract errors:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Large-paste boundary contract OK: canonical limits, owners, planned status and mutation controls pass.");
