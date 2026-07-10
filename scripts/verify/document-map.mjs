import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "resources/documentation-quality/document-map.manifest.json");
const ignoredDirectories = new Set([".git", "node_modules", "artifacts", "coverage", "dist"]);
const expectedColumns = ["path", "tier", "ownerRole", "defaultReadBehavior", "lifecycleDisposition"];
const allowedTiers = new Set(["Entry", "Owner contract", "Specialized contract", "Routing/control", "Historical/research", "Resource"]);
const allowedLifecycles = new Set(["Maintain", "Public workflow", "Historical", "Prototype evidence", "Phase-gated resource"]);
const lifecyclePolicyFields = ["reviewTrigger", "minimumCheckFrequency", "reclamationAction"];

function walkMarkdown(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function countWords(text) {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateDocumentMap(value, expectedFiles, fileExists = (relativePath) => {
  const absolute = path.join(root, relativePath);
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
}, readFile = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8")) {
  const failures = [];
  if (!value || value.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (JSON.stringify(value?.columns) !== JSON.stringify(expectedColumns)) {
    failures.push(`columns must be exactly: ${expectedColumns.join(", ")}`);
  }

  const policies = value?.lifecyclePolicies ?? {};
  for (const lifecycle of allowedLifecycles) {
    const policy = policies[lifecycle];
    if (!policy) {
      failures.push(`missing lifecycle policy: ${lifecycle}`);
      continue;
    }
    for (const field of lifecyclePolicyFields) {
      if (typeof policy[field] !== "string" || !policy[field].trim()) {
        failures.push(`lifecycle policy ${lifecycle} has no ${field}`);
      }
    }
  }
  for (const lifecycle of Object.keys(policies)) {
    if (!allowedLifecycles.has(lifecycle)) failures.push(`unexpected lifecycle policy: ${lifecycle}`);
  }

  const registrations = new Map();
  if (!Array.isArray(value?.documents)) failures.push("documents must be an array");
  for (const row of value?.documents ?? []) {
    if (!Array.isArray(row) || row.length !== expectedColumns.length) {
      failures.push(`document row must have ${expectedColumns.length} columns: ${JSON.stringify(row)}`);
      continue;
    }
    const [document, tier, ownerRole, readBehavior, lifecycle] = row;
    if (typeof document !== "string" || !document.trim()) {
      failures.push(`document path is missing: ${JSON.stringify(row)}`);
      continue;
    }
    if (registrations.has(document)) failures.push(`duplicate document registration: ${document}`);
    registrations.set(document, { tier, ownerRole, readBehavior, lifecycle });
    if (!fileExists(document)) failures.push(`mapped path is not a file: ${document}`);
    if (!allowedTiers.has(tier)) failures.push(`invalid tier for ${document}: ${tier}`);
    if (typeof ownerRole !== "string" || !ownerRole.trim()) failures.push(`missing owner role for ${document}`);
    if (typeof readBehavior !== "string" || !readBehavior.trim()) failures.push(`missing default read behavior for ${document}`);
    if (!allowedLifecycles.has(lifecycle)) failures.push(`invalid lifecycle disposition for ${document}: ${lifecycle}`);
  }

  for (const file of expectedFiles) {
    if (!registrations.has(file)) failures.push(`missing document registration: ${file}`);
  }
  for (const file of registrations.keys()) {
    if (!expectedFiles.includes(file)) failures.push(`unexpected document registration: ${file}`);
  }

  const entryBudget = value?.entryBudget;
  if (!entryBudget || !Number.isInteger(entryBudget.maximumWords) || entryBudget.maximumWords <= 0) {
    failures.push("entryBudget.maximumWords must be a positive integer");
  }
  const budgetPaths = entryBudget?.paths ?? [];
  if (!Array.isArray(budgetPaths) || budgetPaths.length === 0 || new Set(budgetPaths).size !== budgetPaths.length) {
    failures.push("entryBudget.paths must be a non-empty unique array");
  }
  const registeredEntryPaths = [...registrations.entries()].filter(([, record]) => record.tier === "Entry").map(([file]) => file).sort();
  const declaredEntryPaths = [...budgetPaths].sort();
  if (JSON.stringify(registeredEntryPaths) !== JSON.stringify(declaredEntryPaths)) {
    failures.push(`entryBudget.paths must exactly match Entry documents: ${registeredEntryPaths.join(", ")}`);
  }
  let entryWords = 0;
  for (const file of budgetPaths) {
    if (!fileExists(file)) continue;
    entryWords += countWords(readFile(file));
  }
  if (Number.isInteger(entryBudget?.maximumWords) && entryWords > entryBudget.maximumWords) {
    failures.push(`default entry is ${entryWords} words; budget is ${entryBudget.maximumWords}`);
  }

  return { failures, entryWords, registrations };
}

function verifyNegativeCases(manifest, expectedFiles) {
  const failures = [];
  const cases = [
    {
      label: "duplicate registration",
      mutate(value) { value.documents.push([...value.documents[0]]); },
      expected: "duplicate document registration"
    },
    {
      label: "missing registration",
      mutate(value) { value.documents = value.documents.slice(1); },
      expected: "missing document registration"
    },
    {
      label: "invalid lifecycle",
      mutate(value) { value.documents[0][4] = "Forever"; },
      expected: "invalid lifecycle disposition"
    },
    {
      label: "missing lifecycle policy",
      mutate(value) { delete value.lifecyclePolicies.Maintain; },
      expected: "missing lifecycle policy"
    },
    {
      label: "entry budget overflow",
      mutate(value) { value.entryBudget.maximumWords = 1; },
      expected: "default entry is"
    }
  ];
  for (const testCase of cases) {
    const mutated = clone(manifest);
    testCase.mutate(mutated);
    const result = validateDocumentMap(mutated, expectedFiles);
    if (!result.failures.some((failure) => failure.includes(testCase.expected))) {
      failures.push(`${testCase.label} mutation was not rejected`);
    }
  }
  return failures;
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`Document map manifest is unreadable: ${error.message}`);
  process.exit(1);
}

const markdownFiles = walkMarkdown(root);
const expectedFiles = [...markdownFiles, "LICENSE", "NOTICE"].filter((file) => fs.existsSync(path.join(root, file))).sort();
const result = validateDocumentMap(manifest, expectedFiles);
const negativeFailures = verifyNegativeCases(manifest, expectedFiles);
const failures = [...result.failures, ...negativeFailures];

if (failures.length > 0) {
  console.error("Invalid document map:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Document map OK: ${markdownFiles.length} Markdown files plus ${expectedFiles.length - markdownFiles.length} distribution files are uniquely governed; default entry ${result.entryWords}/${manifest.entryBudget.maximumWords} words; 5 negative cases passed.`
);
