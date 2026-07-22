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
  "export const OperationRecordSchema", "export const PigeErrorSchema", "export const DiagnosticErrorSchema"
]);
requireAll("packages/contracts/src/index.ts", ["PigeErrorDomain", "PigeErrorAction", "PigeErrorSummary", "DiagnosticError"]);
requireAll("docs/JOB_OPERATION_AND_RECOVERY.md", [
  "`JobRecordSchema` in `packages/schemas/src/index.ts` is the executable authority",
  "Durable records use `state`; `status` is not a JobRecord field",
  "`waiting_dependency`",
  "High-Risk Decisions Are Not Job States",
  "`replace_existing` preserves the vault ID",
  "`clone_as_new` mints a vault ID"
]);
requireAll("docs/API_AND_IPC_DESIGN.md", ["`PigeErrorDomainSchema`", "`PigeErrorSchema`", "must not create a second enum vocabulary"]);

const schemas = read("packages/schemas/src/index.ts");
if (/warnings:\s*z\.array\(z\.record/u.test(schemas) || /error:\s*z\.record/u.test(schemas)) {
  failures.push("JobRecord still accepts unstructured warnings or errors.");
}
const start = schemas.indexOf("export const JobRecordSchema");
const end = schemas.indexOf("\nconst AgentIngestStatementSchema", start);
const block = start >= 0 && end >= 0 ? schemas.slice(start, end) : "";
for (const value of [
  "}).strict().superRefine((job, context) => {",
  "Cancellation requestedAt and requestedBy must both be present or both be absent.",
  "A cancel_requested job must include requestedAt and requestedBy.",
  "A cancelled job cannot have durableWritesApplied set to true."
]) if (!block.includes(value)) failures.push(`JobRecord lifecycle rule missing: ${value}`);

const executable = spawnSync("npx", ["vitest", "run",
  "tests/unit/error-contract-schemas.test.ts",
  "tests/unit/jobs-service.test.ts",
  "tests/unit/backup-service.test.ts"
], { cwd: root, encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
if (executable.status !== 0) failures.push(`job/recovery focused tests failed: ${(executable.stderr || executable.stdout).trim()}`);

if (failures.length) {
  console.error("Job/recovery contract errors:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("CON-002 OK: Job reliability, cancellation, recovery and Operation records remain typed; ordinary authority and Provider-send decisions are not new Job states.");
