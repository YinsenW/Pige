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
const jobRecordBlock = schemas.slice(schemas.indexOf("export const JobRecordSchema"), schemas.indexOf("export const AgentIngestOutputSchema"));
if (!jobRecordBlock.includes("}).strict();")) failures.push("JobRecordSchema must reject undeclared root fields, including status.");
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
console.log("CON-002 OK: Job, error, operation, permission-reference, restore, and recovery contracts are typed and single-owned.");
