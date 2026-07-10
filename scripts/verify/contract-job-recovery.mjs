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
  "export const JobClassSchema", "export const JobStateSchema", "export const JobRecordSchema",
  "warnings: z.array(PigeWarningSchema).optional()", "error: PigeErrorSummarySchema.optional()",
  "permissionRequestIds: z.array(PermissionRequestIdSchema).optional()",
  "permissionDecisionIds: z.array(PermissionDecisionIdSchema)", "export const OperationRecordSchema",
  "export const PigeErrorSchema", "export const DiagnosticErrorSchema", "export const ModelEgressAuditSchema"
]);
requireAll("packages/contracts/src/index.ts", ["PigeErrorDomain", "PigeErrorAction", "PigeErrorSummary", "DiagnosticError"]);
requireAll("docs/JOB_OPERATION_AND_RECOVERY.md", [
  "`JobRecordSchema` in `packages/schemas/src/index.ts` is the executable authority",
  "Durable records use `state`; `status` is not a JobRecord field", "`waiting_dependency`",
  "`replace_existing` preserves the vault ID", "`clone_as_new` mints a vault ID"
]);
requireAll("docs/API_AND_IPC_DESIGN.md", ["`PigeErrorDomainSchema`", "`PigeErrorSchema`", "must not create a second enum vocabulary"]);
requireAll("tests/unit/error-contract-schemas.test.ts", ["rejects non-namespaced codes and non-scalar redacted metadata"]);
requireAll("tests/unit/durable-contract-schemas.test.ts", [
  "keeps job class, state, and record fields on the shared executable contract",
  "status: \"completed\"", "rawPrompt: \"PRIVATE PROMPT\"",
  "requires typed body-free audit identity for model-egress operations"
]);

const schemas = read("packages/schemas/src/index.ts");
if (/warnings:\s*z\.array\(z\.record/u.test(schemas) || /error:\s*z\.record/u.test(schemas)) {
  failures.push("JobRecord still accepts unstructured warnings or errors.");
}
const jobRecordContractFailures = (source) => {
  const contractFailures = [];
  const start = source.indexOf("export const JobRecordSchema");
  const end = source.indexOf("\nconst AgentIngestStatementSchema", start);
  if (start < 0 || end < 0) return ["JobRecordSchema block could not be isolated."];

  const block = source.slice(start, end);
  if (!block.includes("}).strict().superRefine((job, context) => {")) {
    contractFailures.push("JobRecordSchema must be root-strict before enforcing cross-field lifecycle rules.");
  }
  if (!block.includes("Cancellation requestedAt and requestedBy must both be present or both be absent.")) {
    contractFailures.push("Cancellation request identity must remain paired.");
  }
  if (
    !block.includes('job.state === "cancel_requested"') ||
    !block.includes("A cancel_requested job must include requestedAt and requestedBy.")
  ) {
    contractFailures.push("cancel_requested must require complete request identity.");
  }
  if (
    !block.includes('job.state === "cancelled" && job.cancellation?.durableWritesApplied === true') ||
    !block.includes("A cancelled job cannot have durableWritesApplied set to true.")
  ) {
    contractFailures.push("cancelled must reject a true durable-write action-safety guard.");
  }
  return contractFailures;
};

for (const failure of jobRecordContractFailures(schemas)) failures.push(failure);

const jobRecordNegativeMutations = [
  {
    label: "root strictness removed",
    source: schemas.replace("}).strict().superRefine((job, context) => {", "}).superRefine((job, context) => {")
  },
  {
    label: "cancel request identity rule removed",
    source: schemas.replace('job.state === "cancel_requested"', 'job.state === "running"')
  },
  {
    label: "durable cancelled-state rule removed",
    source: schemas.replace(
      'job.state === "cancelled" && job.cancellation?.durableWritesApplied === true',
      'job.state === "completed" && job.cancellation?.durableWritesApplied === true'
    )
  }
];
for (const mutation of jobRecordNegativeMutations) {
  if (jobRecordContractFailures(mutation.source).length === 0) {
    failures.push(`JobRecord verifier accepted negative mutation: ${mutation.label}.`);
  }
}
const operationBlock = schemas.slice(schemas.indexOf("export const OperationRecordSchema"), schemas.indexOf("export const DurableSchemaVersionRangeSchema"));
if (!operationBlock.includes("}).strict().superRefine")) failures.push("OperationRecordSchema must be strict and enforce kind-specific audit fields.");

const executableContract = spawnSync("npx", ["vitest", "run",
  "tests/unit/durable-contract-schemas.test.ts",
  "tests/unit/error-contract-schemas.test.ts",
  "tests/unit/jobs-service.test.ts",
  "tests/unit/backup-service.test.ts"
], { cwd: root, encoding: "utf8", maxBuffer: 6 * 1024 * 1024 });
if (executableContract.status !== 0) {
  failures.push(`job/recovery executable tests failed: ${(executableContract.stderr || executableContract.stdout).trim()}`);
}

if (failures.length) {
  console.error("Job/recovery contract errors:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`CON-002 OK: Job, error, operation, permission-reference, restore, and recovery contracts are typed and single-owned; ${jobRecordNegativeMutations.length} JobRecord mutations rejected.`);
