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
const enumValues = (source, exportName) => {
  const body = source.match(new RegExp(`export const ${exportName} = z\\.enum\\(\\[([\\s\\S]*?)\\]\\);`, "u"))?.[1] ?? "";
  return [...body.matchAll(/"([a-z0-9_]+)"/gu)].map((match) => match[1]);
};

const domain = read("packages/domain/src/index.ts");
const schemas = read("packages/schemas/src/index.ts");
if (!domain.includes("PIGE_REQUIREMENT_ID_PATTERN = /^PIGE-([A-Z][A-Z0-9]*)-")) {
  failures.push("Requirement ID grammar is not owned by packages/domain.");
}
if (!schemas.includes("PIGE_REQUIREMENT_ID_PATTERN") || !schemas.includes("RequirementIdSchema = z.string().regex(PIGE_REQUIREMENT_ID_PATTERN)")) {
  failures.push("RequirementIdSchema does not consume the domain-owned grammar.");
}

requireAll("packages/schemas/src/index.ts", [
  "export const SourceIdSchema", "export const PageIdSchema", "export const ConversationEventIdSchema",
  "export const ArtifactIdSchema", "export const JobIdSchema", "export const OperationIdSchema",
  "export const PermissionRequestIdSchema", "export const PermissionDecisionIdSchema"
]);
requireAll("docs/DOMAIN_MODEL.md", [
  "| `page_` | Wiki or source page |", "| `art_` | Extracted artifact |", "| `evt_` | Conversation event |",
  "| `permreq_` | Permission request |", "| `permdec_` | Permission decision |",
  "Retired aliases `pg_`, `artifact_`, and `event_`"
]);
for (const [schemaName, document] of [
  ["MarkdownPageTypeSchema", "docs/MARKDOWN_SCHEMA.md"],
  ["MarkdownPageStatusSchema", "docs/MARKDOWN_SCHEMA.md"],
  ["SourceKindSchema", "docs/SOURCE_STORAGE_STRATEGY.md"]
]) {
  const text = read(document);
  for (const value of enumValues(schemas, schemaName)) {
    if (!text.includes(`\`${value}\``) && !text.includes(`"${value}"`)) failures.push(`${document} omits ${schemaName}.${value}`);
  }
}
requireAll("tests/unit/durable-contract-schemas.test.ts", ["uses one stable ID vocabulary and rejects retired aliases"]);

const executableContract = spawnSync("npx", ["vitest", "run", "tests/unit/durable-contract-schemas.test.ts"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024
});
if (executableContract.status !== 0) {
  failures.push(`stable-vocabulary executable tests failed: ${(executableContract.stderr || executableContract.stdout).trim()}`);
}

if (failures.length) {
  console.error("Stable-vocabulary contract errors:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("CON-001 OK: stable IDs, requirement grammar, page/source vocabularies, and schema ownership are executable and single-owned.");
