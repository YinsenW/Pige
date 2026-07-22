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
    [candidate.status, "contract_frozen_implementation_pending", "status"],
    [candidate.canonicalSchemaOwner, "packages/schemas/src/index.ts", "canonicalSchemaOwner"],
    [candidate.limits?.ordinaryTextMaxCodePoints, 8000, "ordinaryTextMaxCodePoints"],
    [candidate.limits?.stagedItemMaxCount, 8, "stagedItemMaxCount"],
    [candidate.limits?.largePasteItemMaxUtf8Bytes, 4 * 1024 * 1024, "largePasteItemMaxUtf8Bytes"],
    [candidate.limits?.largePasteAggregateMaxUtf8Bytes, 8 * 1024 * 1024, "largePasteAggregateMaxUtf8Bytes"],
    [candidate.measurement?.authoredText, "unicode_code_points", "authoredText measurement"],
    [candidate.measurement?.preservedPaste, "utf8_bytes", "preservedPaste measurement"],
    [candidate.measurement?.normalization, "none", "normalization"],
    [candidate.measurement?.trimming, "none", "trimming"],
    [candidate.implementationBinding, "pending", "implementationBinding"]
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
if (!/AgentSubmitTurnRequestSchema[\s\S]*?text:\s*z\.string\(\)\.max\(8_000\)\.optional\(\)/u.test(schema)) {
  errors.push("AgentSubmitTurnRequestSchema must retain the current 8,000-code-point text boundary until the staged-item implementation binds the canonical manifest");
}

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
  ["consumer hardcoding", (copy) => { copy.implementationExports.consumersImportWithoutHardcoding = false; }]
];
for (const [label, mutate] of mutations) {
  const copy = structuredClone(manifest);
  mutate(copy);
  const mutationErrors = [];
  validate(copy, mutationErrors);
  if (mutationErrors.length === 0) errors.push(`large-paste verifier mutation did not fail: ${label}`);
}

if (errors.length > 0) {
  console.error("Large-paste boundary contract errors:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Large-paste boundary contract OK: canonical limits, owners, planned status and mutation controls pass.");
