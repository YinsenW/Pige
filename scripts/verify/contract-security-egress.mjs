import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const requireAll = (relativePath, values) => {
  const text = read(relativePath);
  for (const value of values) if (!text.includes(value)) failures.push(`${relativePath} is missing ${value}`);
};

requireAll("packages/schemas/src/index.ts", [
  "export const ProviderBaseUrlSchema", "export const ProviderProfileSchema", "export const PermissionRequestSchema",
  "export const PermissionDecisionRecordSchema", "export const ModelEgressDecisionSchema",
  "ordinary is mutually exclusive", "must be classified as large", "export const ModelEgressAuditSchema"
]);
for (const service of [
  "apps/desktop/src/main/services/model-provider-connection.ts",
  "apps/desktop/src/main/services/model-provider-registry.ts",
  "apps/desktop/src/main/services/pi-agent-runtime-adapter.ts"
]) requireAll(service, ["normalizeProviderBaseUrl"]);
requireAll("packages/contracts/src/index.ts", [
  "readonly permissionRequirement: SettingPermissionRequirement", "readonly defaultMode:", "readonly yoloEnabled:",
  "readonly generatedKnowledgeLanguage:", "readonly maxSnippetsForCloudSynthesis:"
]);
requireAll("apps/desktop/src/main/services/settings-registry.ts", ["permissionRequirement:"]);
requireAll("apps/desktop/src/main/services/setting-action-guard.ts", [
  "entry.permissionRequirement", "permission.broker_required", "permission.user_denied"
]);
requireAll("apps/desktop/src/main/services/agent-policy-context.ts", ["policyHash: `sha256:${policyDigest}`"]);
requireAll("docs/SETTINGS_AND_PREFERENCES.md", ["| Permission requirement |", "SettingPermissionRequirementSchema"]);
requireAll("docs/AGENT_RUNTIME_POLICY_CONTEXT.md", [
  "type ModelEgressDecision", "Decision matrix:", "before that evidence is rendered into a provider prompt or any provider credential is requested"
]);
requireAll("tests/unit/security-contract-schemas.test.ts", [
  "rejects contradictory or understated model-egress classifications",
  "require builtin_verified"
]);
requireAll("tests/unit/agent-ingest-service.test.ts", ["requires an egress decision before credential lookup or model invocation"]);
requireAll("tests/unit/agent-ingest-service.test.ts", ["blocks unredacted restricted material and records the decision before provider access"]);
requireAll("tests/unit/agent-ingest-service.test.ts", [
  "rejects a same-ID provider endpoint change before prompt rendering or credential lookup",
  "rejects a same-ID runtime endpoint or model change before model invocation",
  "redacts bounded prompt metadata before egress classification and prompt rendering",
  "blocks restricted dynamic prompt metadata before provider credential lookup"
]);
requireAll("tests/unit/agent-ingest-service.test.ts", [
  "evidenceSummaryHash", "decisionHash",
  "expect(classificationOperations).toHaveLength(2)",
  "new Set(classificationOperations.map((operation) => operation.modelEgressAudit.payloadHash)).size).toBe(1)",
  "new Set(classificationOperations.map((operation) => operation.modelEgressAudit.decisionHash)).size).toBe(2)",
  "new Set(egressOperations.map((operation) => operation.modelEgressAudit.payloadHash))"
]);
requireAll("tests/unit/setting-action-guard.test.ts", ["consumes the registry and requires confirmation for database reset"]);
requireAll("tests/unit/desktop-shell-contract.test.ts", ["guards sensitive settings in the main process before mutation"]);
requireAll("apps/desktop/src/main/services/jobs-service.ts", [
  "onPolicyResolved", "policyContextId", "policyHash", "onEgressRecorded"
]);
requireAll("docs/JOB_OPERATION_AND_RECOVERY.md", ["`model_egress_decision` operation"]);
requireAll("apps/desktop/src/main/services/agent-ingest-service.ts", [
  "createModelEgressPayloadHash", "createModelEgressEvidenceSummaryHash", "createModelEgressDecisionHash",
  "evidenceSummaryHash}:${decisionHash}", "modelEgressAudit: {"
]);

const ingest = read("apps/desktop/src/main/services/agent-ingest-service.ts");
const method = ingest.slice(ingest.indexOf("async ingestSource"), ingest.indexOf("const unavailableCapabilityPort"));
const decision = method.indexOf("createModelEgressDecision");
const durableDecision = method.indexOf("writeModelEgressDecisionOperation");
const prompt = method.indexOf("createSystemPrompt(");
const credential = method.indexOf("getDefaultRuntimeConfig()");
if (!(decision >= 0 && durableDecision > decision && prompt > durableDecision && credential > prompt)) {
  failures.push("Agent ingest must decide and durably record model egress before prompt rendering and credential lookup.");
}
if (
  method.includes("restrictedContent: false") ||
  !/createAgentIngestPromptContext\((?:currentSourceRecord|sourceRecord),\s*redaction\.pack,\s*policy\)/u.test(method) ||
  !method.includes("createModelEgressEvidencePayload(promptContextResult.context.evidence)") ||
  !method.includes("containsRestrictedModelContent(evidencePayload) || containsRestrictedModelContent(promptMetadataPayload)")
) {
  failures.push("Agent ingest must derive restricted-content classification from the selected evidence and bounded dynamic prompt metadata.");
}
const settingsEntries = read("apps/desktop/src/main/services/settings-registry.ts");
const keyCount = (settingsEntries.match(/\bkey:/gu) ?? []).length;
const permissionCount = (settingsEntries.match(/\bpermissionRequirement:/gu) ?? []).length;
if (keyCount === 0 || keyCount !== permissionCount) failures.push(`Settings registry has ${keyCount} keys but ${permissionCount} permission declarations.`);

const registryPermissions = new Map([...settingsEntries.matchAll(/key:\s*"([^"]+)"[\s\S]*?permissionRequirement:\s*"([^"]+)"/gu)]
  .map((match) => [match[1], match[2]]));
const documentedPermissions = new Map([...read("docs/SETTINGS_AND_PREFERENCES.md").matchAll(/^\| `([^`]+)` \| `([^`]+)` \|/gmu)]
  .map((match) => [match[1], match[2]]));
for (const [key, requirement] of registryPermissions) {
  if (documentedPermissions.get(key) !== requirement) {
    failures.push(`Implemented setting ${key} is ${requirement} in code but ${documentedPermissions.get(key) ?? "missing"} in the enforcement index.`);
  }
}

const main = read("apps/desktop/src/main/index.ts");
for (const [startMarker, endMarker, mutationMarker] of [
  ['ipcMain.handle("maintenance.resetLocalDatabase"', 'ipcMain.handle("maintenance.localDatabaseStatus"', "getVaultService().resetLocalDatabase()"],
  ['ipcMain.handle("models.addManualProvider"', 'ipcMain.handle("models.setDefaultModel"', "getModelProviderRegistry().addManualProvider(validatedRequest)"]
]) {
  const block = main.slice(main.indexOf(startMarker), main.indexOf(endMarker));
  if (!(block.indexOf("confirmSettingAction") >= 0 && block.indexOf("confirmSettingAction") < block.indexOf(mutationMarker))) {
    failures.push(`${startMarker} does not enforce the registry-driven confirmation before mutation.`);
  }
}
requireAll("apps/desktop/src/main/index.ts", [
  "const getAgentCapabilitySnapshot", "parserToolchainReady:", "ocrEngines:", "lexicalSearchAvailable:",
  "{ snapshot: getAgentCapabilitySnapshot }"
]);

const integration = spawnSync("npx", ["vitest", "run",
  "tests/unit/durable-contract-schemas.test.ts",
  "tests/unit/security-contract-schemas.test.ts",
  "tests/unit/setting-action-guard.test.ts",
  "tests/unit/agent-policy-context.test.ts",
  "tests/unit/agent-ingest-service.test.ts",
  "tests/unit/pi-agent-runtime-adapter.test.ts",
  "tests/unit/desktop-shell-contract.test.ts",
  "tests/unit/model-provider-connection.test.ts",
  "tests/unit/model-provider-registry.test.ts"
], { cwd: root, encoding: "utf8", maxBuffer: 6 * 1024 * 1024 });
if (integration.status !== 0) failures.push(`security/egress integration tests failed: ${(integration.stderr || integration.stdout).trim()}`);

if (failures.length) {
  console.error("Security/egress contract errors:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("CON-004 OK: provider URL, permission, setting, runtime-policy, secret-use, and model-egress contracts fail closed.");
