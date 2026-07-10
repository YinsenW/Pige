import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const manifestPath = path.join(root, "resources/documentation-quality/documentation-quality.manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const documentMapManifestPath = "resources/documentation-quality/document-map.manifest.json";
const independentReviewPath = path.join(root, "artifacts/documentation-quality/independent-review.json");
if (!fs.existsSync(independentReviewPath)) throw new Error("Run npm run verify:independent-documentation-review before the documentation scorecard.");
const independentReview = JSON.parse(fs.readFileSync(independentReviewPath, "utf8"));
if (independentReview.status !== "passed") throw new Error("The independent documentation review is not passing.");
const independentDimensions = new Map(independentReview.dimensions.map((dimension) => [dimension.id, dimension]));
const commandCache = new Map();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function hasAll(relativePath, values) {
  const text = read(relativePath);
  const missing = values.filter((value) => !text.includes(value));
  return missing.length === 0
    ? { passed: true, detail: `${relativePath} contains the required contract markers.` }
    : { passed: false, detail: `${relativePath} is missing: ${missing.join(", ")}` };
}

function runVerifier(relativePath, args = []) {
  const cacheKey = JSON.stringify([relativePath, ...args]);
  if (commandCache.has(cacheKey)) return commandCache.get(cacheKey);
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    const result = { passed: false, detail: `Missing verifier: ${relativePath}` };
    commandCache.set(cacheKey, result);
    return result;
  }
  const run = spawnSync(process.execPath, [absolutePath, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-4).join(" | ");
  const result = {
    passed: run.status === 0,
    detail: output || `${relativePath} exited with status ${run.status ?? "unknown"}.`
  };
  commandCache.set(cacheKey, result);
  return result;
}

function publicRepositoryLinksMatchOrigin() {
  const remote = spawnSync("git", ["config", "--get", "remote.origin.url"], {
    cwd: root,
    encoding: "utf8"
  });
  const value = String(remote.stdout ?? "").trim();
  const match = value.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/u);
  if (remote.status !== 0 || !match) {
    return { passed: false, detail: "Could not derive the GitHub owner/repository from remote.origin.url." };
  }
  const repository = match[1];
  const config = read(".github/ISSUE_TEMPLATE/config.yml");
  const expected = [
    `https://github.com/${repository}/security/advisories/new`,
    `https://github.com/${repository}/blob/main/SUPPORT.md`,
    `https://github.com/${repository}/blob/main/PRIVACY.md`
  ];
  const missing = expected.filter((url) => !config.includes(url));
  return missing.length === 0
    ? { passed: true, detail: `Public reporting links match ${repository}.` }
    : { passed: false, detail: `Public reporting links do not match origin; missing: ${missing.join(", ")}` };
}

function checkText(label, text, values) {
  const missing = values.filter((value) => !text.includes(value));
  return missing.length === 0
    ? { passed: true, detail: `${label} contains every required field.` }
    : { passed: false, detail: `${label} is missing: ${missing.join(", ")}` };
}

function sectionFromText(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const end = text.indexOf("\n## ", start + heading.length);
  return text.slice(start, end < 0 ? text.length : end);
}

function sectionText(relativePath, heading) {
  return sectionFromText(read(relativePath), heading);
}

function exactIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? "")) return Number.NaN;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : Number.NaN;
}

const handoffOwnerFields = [
  "Implemented:",
  "Files changed:",
  "Agent task/provenance:",
  "Agent role: Project Management | Product Planning | UI Design | Development",
  "Cross-role delegation: None | Delegated by role/task for exact scope",
  "Active phase or slice:",
  "Build IDs:",
  "Exit IDs:",
  "Requirement IDs:",
  "Requirement owner sources:",
  "Tests/evidence:",
  "Known gaps:",
  "Docs updated:",
  "Product Planning design sync: Not required with reason | Pending task | Acknowledged task/snapshot",
  "Planning cost: None | Low | Medium | High",
  "Compatibility or migration impact:",
  "Coordination action: No action | Active-phase follow-up | Future-phase follow-up",
  "Coordination target/status:",
  "Blocking reason, if any:",
  "Next recommended task:"
];

const pullRequestHandoffFields = handoffOwnerFields.filter((field) => ![
  "Implemented:",
  "Files changed:",
  "Next recommended task:"
].includes(field));

const contextPackOwnerFields = [
  "Task:",
  "Agent role: Project Management | Product Planning | UI Design | Development",
  "Cross-role delegation: None | Delegated by role/task for exact scope",
  "Product Planning design sync: Not required with reason | Pending task | Acknowledged task/snapshot",
  "Active phase or slice:",
  "Build IDs:",
  "Exit IDs:",
  "Requirement source:",
  "Requirement IDs:",
  "Task-specific docs read:",
  "User workflow:",
  "Owning service:",
  "Durable source of truth:",
  "Rebuildable state:",
  "Secrets involved:",
  "Permissions involved:",
  "Backup/restore impact:",
  "Future sync impact:",
  "Future mobile/cloud runtime impact:",
  "Tests/fixtures:",
  "Docs to update:",
  "Out of scope:",
  "Exit condition:"
];

const ownerReferenceRequirements = {
  "docs/START_HERE_FOR_AI_AGENTS.md": [
    "[AI Development Guide section 5](AI_DEVELOPMENT_GUIDE.md#5-context-pack-template)",
    "[section 13](AI_DEVELOPMENT_GUIDE.md#13-handoff-note-template)",
    "resources/documentation-quality/document-map.manifest.json",
    "docs/V0_1_IMPLEMENTATION_PLAYBOOK.md",
    "AGENTS.md"
  ],
  "docs/AI_DEVELOPMENT_GUIDE.md": [
    "docs/START_HERE_FOR_AI_AGENTS.md",
    "resources/documentation-quality/document-map.manifest.json",
    "docs/TECH_ARCHITECTURE.md",
    "docs/REPOSITORY_STRUCTURE.md",
    "docs/QUALITY_AND_TEST_STRATEGY.md",
    "AGENTS.md",
    "docs/V0_1_IMPLEMENTATION_PLAYBOOK.md"
  ],
  "docs/CODING_CONVENTIONS.md": [
    "docs/REPOSITORY_STRUCTURE.md",
    "docs/TECH_ARCHITECTURE.md",
    "docs/QUALITY_AND_TEST_STRATEGY.md",
    "AGENTS.md",
    "resources/documentation-quality/document-map.manifest.json"
  ],
  "docs/CONTRIBUTING_GUIDE.md": [
    "CONTRIBUTING.md",
    "docs/START_HERE_FOR_AI_AGENTS.md",
    ".github/pull_request_template.md",
    "AGENTS.md",
    "resources/documentation-quality/document-map.manifest.json",
    "docs/AI_DEVELOPMENT_GUIDE.md",
    "SECURITY.md",
    "PRIVACY.md",
    "SUPPORT.md"
  ]
};

function evaluateTemplateOwnership(start, guide, pullRequest) {
  const failures = [];
  const contextPack = checkText(
    "AI Development Guide context-pack owner",
    sectionFromText(guide, "## 5. Context Pack Template"),
    ["single owner", ...contextPackOwnerFields]
  );
  if (!contextPack.passed) failures.push(contextPack.detail);
  const handoff = checkText(
    "AI Development Guide handoff owner",
    sectionFromText(guide, "## 13. Handoff Note Template"),
    ["single owner", ...handoffOwnerFields]
  );
  if (!handoff.passed) failures.push(handoff.detail);
  const pullRequestSubset = checkText("pull request handoff subset", pullRequest, pullRequestHandoffFields);
  if (!pullRequestSubset.passed) failures.push(pullRequestSubset.detail);

  const forbiddenFieldLines = [...new Set([...contextPackOwnerFields, ...handoffOwnerFields])];
  for (const field of forbiddenFieldLines) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (new RegExp(`^${escaped}\\s*$`, "mu").test(start)) {
      failures.push(`START duplicates template field line: ${field}`);
    }
  }
  return failures;
}

function templateOwnershipComplete() {
  const start = read("docs/START_HERE_FOR_AI_AGENTS.md");
  const guide = read("docs/AI_DEVELOPMENT_GUIDE.md");
  const pullRequest = read(".github/pull_request_template.md");
  const failures = evaluateTemplateOwnership(start, guide, pullRequest);
  const negativeCases = [
    ["START context-field copy", `${start}\nTask:\n`, guide, pullRequest],
    ["incomplete context owner", start, guide.replace("Exit condition:", "Exit gate:"), pullRequest],
    ["incomplete handoff owner", start, guide.replace("Next recommended task:", "Next task:"), pullRequest],
    ["missing role/delegation intake", start, guide.replace("Agent role: Project Management | Product Planning | UI Design | Development", "Agent role:"), pullRequest],
    ["incomplete PR subset", start, guide, pullRequest.replace("Planning cost: None | Low | Medium | High", "Planning cost:")]
  ];
  for (const [label, mutatedStart, mutatedGuide, mutatedPullRequest] of negativeCases) {
    if (evaluateTemplateOwnership(mutatedStart, mutatedGuide, mutatedPullRequest).length === 0) {
      failures.push(`${label} mutation was not rejected`);
    }
  }
  return failures.length === 0
    ? { passed: true, detail: `AI Development Guide uniquely owns complete role-aware start/handoff templates; START contains references only; the PR keeps the required public subset; ${negativeCases.length} negative cases passed.` }
    : { passed: false, detail: failures.join("; ") };
}

function evaluateOwnerReferences(texts) {
  const failures = [];
  for (const [relativePath, required] of Object.entries(ownerReferenceRequirements)) {
    const text = texts[relativePath] ?? "";
    for (const reference of required) {
      if (!text.includes(reference)) failures.push(`${relativePath} is missing owner reference ${reference}`);
    }
  }
  return failures;
}

function ownerReferencesComplete() {
  const texts = Object.fromEntries(Object.keys(ownerReferenceRequirements).map((relativePath) => [relativePath, read(relativePath)]));
  const failures = evaluateOwnerReferences(texts);
  for (const [relativePath, [reference]] of Object.entries(ownerReferenceRequirements)) {
    const mutated = { ...texts, [relativePath]: texts[relativePath].replaceAll(reference, "removed-owner-reference") };
    if (evaluateOwnerReferences(mutated).length === 0) failures.push(`${relativePath} missing-owner-reference mutation was not rejected`);
  }
  return failures.length === 0
    ? { passed: true, detail: "Routing and workflow summaries reference their canonical owners; 4 missing-reference negative cases passed." }
    : { passed: false, detail: failures.join("; ") };
}

function implementationRoutingComplete() {
  const start = read("docs/START_HERE_FOR_AI_AGENTS.md");
  const normalWork = sectionText("docs/START_HERE_FOR_AI_AGENTS.md", "## 3. Minimal First Read");
  const ocrRow = start.split("\n").find((line) => line.startsWith("| PDF/DOCX/PPTX/image/OCR |")) ?? "";
  const normal = checkText("normal implementation routing", normalWork, [
    "Every implementation slice",
    "docs/V0_1_IMPLEMENTATION_PLAYBOOK.md",
    "docs/SPEC_TRACEABILITY.md",
    "Build/Exit IDs",
    "requirement IDs"
  ]);
  const ocr = checkText("OCR task-pack routing", ocrRow, [
    "P5 section",
    "docs/V0_1_IMPLEMENTATION_PLAYBOOK.md",
    "matching P5 rows",
    "docs/SPEC_TRACEABILITY.md"
  ]);
  return normal.passed && ocr.passed
    ? { passed: true, detail: "Normal implementation and OCR task packs route to only the relevant Playbook phase and Spec rows." }
    : { passed: false, detail: `${normal.detail}; ${ocr.detail}` };
}

function resourceLifecycleComplete() {
  const lifecycle = sectionText("docs/START_HERE_FOR_AI_AGENTS.md", "### 5.2 Lifecycle Disposition And Resource Reclamation");
  const failures = [];
  const lifecycleContract = checkText("lifecycle contract", lifecycle, [
    documentMapManifestPath,
    "review trigger",
    "frequency",
    "reclamation action"
  ]);
  if (!lifecycleContract.passed) failures.push(lifecycleContract.detail);

  const documentMap = JSON.parse(read(documentMapManifestPath));
  const mappedDocuments = new Map((documentMap.documents ?? []).map((row) => [row[0], {
    tier: row[1],
    ownerRole: row[2],
    readBehavior: row[3],
    lifecycle: row[4]
  }]));
  for (const lifecycleName of ["Maintain", "Public workflow", "Historical", "Prototype evidence", "Phase-gated resource"]) {
    const policy = documentMap.lifecyclePolicies?.[lifecycleName];
    const policyCheck = checkText(`document map ${lifecycleName} policy`, JSON.stringify(policy ?? {}), [
      "reviewTrigger",
      "minimumCheckFrequency",
      "reclamationAction"
    ]);
    if (!policyCheck.passed) failures.push(policyCheck.detail);
  }

  const resources = [
    ["docs/prototypes/README.md", "Prototype evidence"],
    ["resources/curated-packages/README.md", "Phase-gated resource"],
    ["resources/documentation-quality/README.md", "Maintain"],
    ["resources/parser-manifests/README.md", "Maintain"],
    ["resources/traceability/README.md", "Maintain"],
    ["resources/prompts/ingest/README.md", "Phase-gated resource"],
    ["resources/prompts/retrieval/README.md", "Phase-gated resource"],
    ["resources/skill-templates/README.md", "Phase-gated resource"]
  ];
  const now = Date.now();
  for (const [relativePath, expectedDisposition] of resources) {
    const text = read(relativePath);
    const metadata = checkText(relativePath, text, ["Status:", "Last reviewed:", "Review trigger:"]);
    if (!metadata.passed) failures.push(metadata.detail);
    const reviewed = text.match(/^Last reviewed: (\d{4}-\d{2}-\d{2})$/mu)?.[1];
    const reviewedAt = exactIsoDate(reviewed);
    const ageDays = (now - reviewedAt) / 86_400_000;
    if (!Number.isFinite(reviewedAt) || ageDays < -1 || ageDays > 100) {
      failures.push(`${relativePath} has no valid review within the quarterly inventory window.`);
    }
    if (mappedDocuments.get(relativePath)?.lifecycle !== expectedDisposition) {
      failures.push(`${relativePath} is not mapped with lifecycle disposition ${expectedDisposition}.`);
    }
  }

  for (const relativeDirectory of [
    "resources/curated-packages",
    "resources/prompts/ingest",
    "resources/prompts/retrieval",
    "resources/skill-templates"
  ]) {
    const files = fs.readdirSync(path.join(root, relativeDirectory)).filter((name) => name !== ".DS_Store");
    if (files.some((name) => name !== "README.md")) {
      failures.push(`${relativeDirectory} is still labeled as a placeholder but contains active resources.`);
    }
  }

  const parserDirectory = path.join(root, "resources/parser-manifests");
  const actualManifests = fs.readdirSync(parserDirectory).filter((name) => name.endsWith(".json")).sort();
  const indexedManifests = [...read("resources/parser-manifests/README.md").matchAll(/`([^`]+\.json)`/gu)]
    .map((match) => match[1])
    .sort();
  if (JSON.stringify(actualManifests) !== JSON.stringify(indexedManifests)) {
    failures.push(`Parser manifest index mismatch: files=${actualManifests.join(", ")}; index=${indexedManifests.join(", ")}.`);
  }

  const alignment = runVerifier("scripts/verify/parser-manifest-alignment.mjs");
  if (!alignment.passed) failures.push(alignment.detail);

  const providerCatalog = path.join(root, "resources/provider-catalog");
  if (fs.existsSync(providerCatalog)) {
    const readmePath = path.join(providerCatalog, "README.md");
    const manifests = fs.readdirSync(providerCatalog).filter((name) => name.endsWith(".json"));
    const populated = manifests.some((name) => {
      try {
        const value = JSON.parse(fs.readFileSync(path.join(providerCatalog, name), "utf8"));
        return Array.isArray(value.providers) && value.providers.length > 0;
      } catch {
        return false;
      }
    });
    if (!fs.existsSync(readmePath) || !populated) {
      failures.push("resources/provider-catalog must remain absent until it has populated metadata, an owner README, review metadata, and a real consumer.");
    }
  }

  return failures.length === 0
    ? { passed: true, detail: "Resource indexes, placeholder state, review freshness, triggers, and lifecycle dispositions are current and exact." }
    : { passed: false, detail: failures.join("; ") };
}

function currentStatusComplete() {
  const failures = [];
  const readme = checkText("README current status", read("README.md"), [
    "active pre-alpha development",
    "Today, the pre-alpha can:"
  ]);
  if (!readme.passed) failures.push(readme.detail);

  const playbook = read("docs/V0_1_IMPLEMENTATION_PLAYBOOK.md");
  const reconciled = playbook.match(/Current implementation state, last reconciled (\d{4}-\d{2}-\d{2}):/u)?.[1];
  const reconciledAt = exactIsoDate(reconciled);
  const ageDays = (Date.now() - reconciledAt) / 86_400_000;
  if (!Number.isFinite(reconciledAt) || ageDays < -1 || ageDays > 30) {
    failures.push("Playbook current implementation state was not reconciled within 30 days.");
  }

  const stateBlock = playbook.match(/\| Phase \| State \| Interpretation \|\n\| --- \| --- \| --- \|\n([\s\S]*?)\n\n/u)?.[1] ?? "";
  const phaseCoverage = Array.from({ length: 10 }, () => 0);
  for (const match of stateBlock.matchAll(/^\| P(\d)(?:-P(\d))? \| (in progress|planned|complete) \| ([^|]+) \|$/gmu)) {
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    for (let phase = first; phase <= last && phase <= 9; phase += 1) phaseCoverage[phase] += 1;
    if (match[3] === "in progress" && !/(?:open|remain|not .*claim)/iu.test(match[4])) {
      failures.push(`In-progress P${first}${last === first ? "" : `-P${last}`} does not state remaining or unclaimed work.`);
    }
  }
  for (let phase = 0; phase <= 9; phase += 1) {
    if (phaseCoverage[phase] !== 1) failures.push(`Playbook current-state table covers P${phase} ${phaseCoverage[phase]} times; expected exactly once.`);
  }
  const specStatus = checkText("Spec status rules", sectionText("docs/SPEC_TRACEABILITY.md", "## 1. Purpose And Authority"), [
    "`verified`:",
    "`partial`:",
    "`planned`:"
  ]);
  if (!specStatus.passed) failures.push(specStatus.detail);

  return failures.length === 0
    ? { passed: true, detail: "README, complete P0-P9 state coverage, reconciliation freshness, and requirement-status semantics are current and discoverable." }
    : { passed: false, detail: failures.join("; ") };
}

const roleRoutingRequirements = {
  "AGENTS.md": [
    "This synchronization duty is not universal edit authority.",
    "Product Planning synchronizes affected design documents",
    "only under explicit, scoped delegation"
  ],
  "docs/AI_DEVELOPMENT_GUIDE.md": [
    "Role ownership governs every “update” instruction below.",
    "Product Planning design sync:",
    "Cross-role delegation:",
    "Planning registers an accepted choice before implementation"
  ],
  "CONTRIBUTING.md": ["design changes to Product Planning", "detailed visual guidance to UI Design"],
  "docs/CONTRIBUTING_GUIDE.md": ["Product Planning design-sync status", "detailed visual guidance"]
};

function evaluateRoleRouting(texts) {
  const failures = [];
  for (const [relativePath, markers] of Object.entries(roleRoutingRequirements)) {
    const text = texts[relativePath] ?? "";
    for (const marker of markers) if (!text.includes(marker)) failures.push(`${relativePath} is missing role-routing marker ${marker}`);
  }
  return failures;
}

function roleRoutingComplete() {
  const texts = Object.fromEntries(Object.keys(roleRoutingRequirements).map((relativePath) => [relativePath, read(relativePath)]));
  const failures = evaluateRoleRouting(texts);
  for (const [relativePath, [first]] of Object.entries(roleRoutingRequirements)) {
    const mutated = { ...texts, [relativePath]: texts[relativePath].replace(first, "removed-role-routing-marker") };
    if (evaluateRoleRouting(mutated).length === 0) failures.push(`${relativePath} missing-role-routing mutation was accepted.`);
  }
  return failures.length === 0
    ? { passed: true, detail: "Role-owned edits, scoped delegation, PR/handoff intake, and Product Planning synchronization are explicit across repository instructions and contribution workflow." }
    : { passed: false, detail: failures.join("; ") };
}

function coordinationProtocolComplete() {
  const handoffs = templateOwnershipComplete();
  const roles = roleRoutingComplete();
  const playbook = checkText(
    "Playbook coordination protocol",
    sectionText("docs/V0_1_IMPLEMENTATION_PLAYBOOK.md", "## 3.2 In-Flight Coordination And Adoption Cost"),
    [
      "Send one concise coordination notice",
      "Let an active task finish its current bounded slice",
      "Do not interrupt an active task solely",
      "at the next natural handoff",
      "security, privacy, durable-data, migration, or incompatible-contract risk",
      "Recommended coordination notice:"
    ]
  );
  const impact = checkText(
    "START active-development routing",
    sectionText("docs/START_HERE_FOR_AI_AGENTS.md", "### 5.1 Current State, History, And Active Development"),
    [
      "[handoff template](AI_DEVELOPMENT_GUIDE.md#13-handoff-note-template)",
      "Playbook section 3.2",
      "Interrupt unrelated work only for security, privacy, durable-data, migration, or incompatible-contract risk"
    ]
  );
  return handoffs.passed && roles.passed && playbook.passed && impact.passed
    ? { passed: true, detail: "Concurrent work uses role-owned edits, explicit delegation and Planning sync, the single-owner handoff, Playbook delta notice, and a safety-only interruption threshold." }
    : { passed: false, detail: `${handoffs.detail}; ${roles.detail}; ${playbook.detail}; ${impact.detail}` };
}

function normalVerificationWiringComplete() {
  const pkg = JSON.parse(read("package.json"));
  const requiredVerifyScripts = [
    "verify:docs",
    "verify:decisions",
    "verify:traceability",
    "verify:contracts",
    "verify:documentation-leanness",
    "verify:documentation-quality"
  ];
  const verify = pkg.scripts?.verify ?? "";
  const missing = requiredVerifyScripts.filter((name) => !verify.includes(`npm run ${name}`));
  if (pkg.scripts?.["verify:independent-documentation-review"] !== "node scripts/verify/independent-documentation-review.mjs") {
    missing.push("exact verify:independent-documentation-review command");
  }
  if (pkg.scripts?.["verify:documentation-quality"] !== "npm run verify:independent-documentation-review && node scripts/verify/documentation-quality.mjs") {
    missing.push("exact verify:documentation-quality command");
  }
  if (pkg.scripts?.["verify:documentation-leanness"] !== "node scripts/verify/documentation-leanness.mjs") {
    missing.push("exact verify:documentation-leanness command");
  }
  if (!String(pkg.scripts?.["verify:traceability"] ?? "").includes("traceability-negative-cases.mjs")) {
    missing.push("traceability negative/mutation cases");
  }
  if (!String(pkg.scripts?.["verify:docs"] ?? "").includes("npm run verify:parser-manifests")) {
    missing.push("parser/OCR manifest alignment in verify:docs");
  }
  if (pkg.scripts?.["verify:prd-contract"] !== "node scripts/verify/prd-contract.mjs && node scripts/verify/prd-contract-negative-cases.mjs") {
    missing.push("exact PRD contract and mutation command");
  }
  if (!String(pkg.scripts?.["verify:docs"] ?? "").includes("npm run verify:prd-contract")) {
    missing.push("PRD contract and mutation gates in verify:docs");
  }
  const ci = read(".github/workflows/ci.yml");
  for (const command of ["npm run verify", "npm run typecheck", "npm test", "npm run build"]) {
    if (!ci.includes(`run: ${command}`)) missing.push(`CI ${command}`);
  }
  return missing.length === 0
    ? { passed: true, detail: "Root verification invokes every documentation gate, and CI invokes verification, type-check, tests, and build." }
    : { passed: false, detail: `Normal verification is missing: ${missing.join(", ")}.` };
}

function scoreInfrastructureComplete() {
  const failures = [];
  const expectedDimensions = new Set([
    "navigation_and_resource_lifecycle",
    "cross_document_contract_consistency",
    "continuous_traceability_and_acceptance",
    "ongoing_development_support",
    "documentation_leanness_and_maintainability"
  ]);
  const dimensionIds = manifest.dimensions.map((dimension) => dimension.id);
  if (dimensionIds.length !== expectedDimensions.size || new Set(dimensionIds).size !== dimensionIds.length) {
    failures.push("documentation-quality dimensions are missing or duplicated");
  }
  for (const expected of expectedDimensions) {
    if (!dimensionIds.includes(expected)) failures.push(`missing dimension ${expected}`);
  }
  if (manifest.minimumDimensionScore < 9.5 || manifest.minimumDimensionScore > 10) {
    failures.push("minimumDimensionScore must be between 9.5 and 10");
  }
  const checkIds = manifest.dimensions.flatMap((dimension) => dimension.checks.map((check) => check.id));
  if (new Set(checkIds).size !== checkIds.length) failures.push("documentation-quality check IDs are duplicated");
  for (const dimension of manifest.dimensions) {
    const total = dimension.checks.reduce((sum, check) => sum + check.weight, 0);
    if (Math.abs(total - 10) > Number.EPSILON) failures.push(`${dimension.id} weight is ${total}, not 10`);
  }
  const pkg = JSON.parse(read("package.json"));
  if (pkg.scripts?.["verify:independent-documentation-review"] !== "node scripts/verify/independent-documentation-review.mjs") {
    failures.push("the independent review has no exact root command");
  }
  if (pkg.scripts?.["verify:documentation-quality"] !== "npm run verify:independent-documentation-review && node scripts/verify/documentation-quality.mjs") {
    failures.push("the scorecard has no exact independent-review command");
  }
  if (pkg.scripts?.["verify:documentation-leanness"] !== "node scripts/verify/documentation-leanness.mjs") {
    failures.push("the leanness score has no exact root command");
  }
  if (!/^artifacts\/$/mu.test(read(".gitignore"))) failures.push("generated score reports are not gitignored");
  const strategy = checkText("quality strategy score contract", sectionText("docs/QUALITY_AND_TEST_STRATEGY.md", "### 12.1 Documentation System Scorecard"), [
    "at least `9.5`",
    "lower of its automated weighted-gate score and its current independent-review score",
    "An average above `9.5` does not compensate"
  ]);
  if (!strategy.passed) failures.push(strategy.detail);
  const traceability = read("scripts/verify/documentation-quality.mjs");
  for (const id of ["TRC-001", "TRC-002", "TRC-003", "TRC-004", "TRC-005"]) {
    if (!traceability.includes(`runVerifier("scripts/verify/traceability.mjs", ["--check", "${id}"])`)) {
      failures.push(`${id} does not have an independent traceability invocation`);
    }
  }
  const contractInvocations = {
    "CON-001": "contract-stable-vocabulary.mjs",
    "CON-002": "contract-job-recovery.mjs",
    "CON-003": "contract-source-lifecycle.mjs",
    "CON-004": "contract-security-egress.mjs"
  };
  for (const [id, verifier] of Object.entries(contractInvocations)) {
    if (!traceability.includes(`"${id}": () => runVerifier("scripts/verify/${verifier}")`)) {
      failures.push(`${id} does not have its own contract verifier`);
    }
  }
  if (!fs.existsSync(path.join(root, "scripts/verify/traceability-negative-cases.mjs"))) {
    failures.push("traceability negative/mutation verifier is missing");
  }
  for (const id of ["LEN-001", "LEN-002", "LEN-003", "LEN-004", "LEN-005"]) {
    if (!traceability.includes(`runVerifier("scripts/verify/documentation-leanness.mjs", ["--check", "${id}"])`)) {
      failures.push(`${id} does not have an independent leanness invocation`);
    }
  }
  return failures.length === 0
    ? { passed: true, detail: "The five unique dimensions, threshold, weights, root commands, generated-report boundary, and independent-threshold rule are reproducible." }
    : { passed: false, detail: failures.join("; ") };
}

const checks = {
  "NAV-001": () => runVerifier("scripts/verify/document-map.mjs"),
  "NAV-002": () => runVerifier("scripts/verify/markdown-links.mjs"),
  "NAV-003": () => {
    const authority = hasAll("docs/START_HERE_FOR_AI_AGENTS.md", [
      "## 4. Document Authority And Conflict Rules",
      "### 5.1 Current State, History, And Active Development",
      "latest non-superseded Accepted",
      "Historical/research"
    ]);
    const publicLinks = publicRepositoryLinksMatchOrigin();
    return authority.passed && publicLinks.passed
      ? { passed: true, detail: `${authority.detail} ${publicLinks.detail}` }
      : { passed: false, detail: `${authority.detail}; ${publicLinks.detail}` };
  },
  "NAV-004": () => resourceLifecycleComplete(),
  "NAV-005": () => {
    const routing = implementationRoutingComplete();
    const coordination = coordinationProtocolComplete();
    return routing.passed && coordination.passed
      ? { passed: true, detail: `${routing.detail} ${coordination.detail}` }
      : { passed: false, detail: `${routing.detail}; ${coordination.detail}` };
  },
  "CON-001": () => runVerifier("scripts/verify/contract-stable-vocabulary.mjs"),
  "CON-002": () => runVerifier("scripts/verify/contract-job-recovery.mjs"),
  "CON-003": () => runVerifier("scripts/verify/contract-source-lifecycle.mjs"),
  "CON-004": () => runVerifier("scripts/verify/contract-security-egress.mjs"),
  "CON-005": () => runVerifier("scripts/verify/decision-log.mjs"),
  "TRC-001": () => runVerifier("scripts/verify/traceability.mjs", ["--check", "TRC-001"]),
  "TRC-002": () => runVerifier("scripts/verify/traceability.mjs", ["--check", "TRC-002"]),
  "TRC-003": () => runVerifier("scripts/verify/traceability.mjs", ["--check", "TRC-003"]),
  "TRC-004": () => runVerifier("scripts/verify/traceability.mjs", ["--check", "TRC-004"]),
  "TRC-005": () => runVerifier("scripts/verify/traceability.mjs", ["--check", "TRC-005"]),
  "DEV-001": () => currentStatusComplete(),
  "DEV-002": () => {
    const templates = templateOwnershipComplete();
    const roles = roleRoutingComplete();
    const ownerReferences = ownerReferencesComplete();
    const routing = implementationRoutingComplete();
    const prdContract = runVerifier("scripts/verify/prd-contract.mjs");
    const prdMutations = runVerifier("scripts/verify/prd-contract-negative-cases.mjs");
    return templates.passed && roles.passed && ownerReferences.passed && routing.passed && prdContract.passed && prdMutations.passed
      ? { passed: true, detail: `${templates.detail} ${roles.detail} ${ownerReferences.detail} ${routing.detail} ${prdContract.detail} ${prdMutations.detail}` }
      : { passed: false, detail: `${templates.detail}; ${roles.detail}; ${ownerReferences.detail}; ${routing.detail}; ${prdContract.detail}; ${prdMutations.detail}` };
  },
  "DEV-003": () => coordinationProtocolComplete(),
  "DEV-004": () => normalVerificationWiringComplete(),
  "DEV-005": () => scoreInfrastructureComplete(),
  "LEN-001": () => runVerifier("scripts/verify/documentation-leanness.mjs", ["--check", "LEN-001"]),
  "LEN-002": () => runVerifier("scripts/verify/documentation-leanness.mjs", ["--check", "LEN-002"]),
  "LEN-003": () => runVerifier("scripts/verify/documentation-leanness.mjs", ["--check", "LEN-003"]),
  "LEN-004": () => runVerifier("scripts/verify/documentation-leanness.mjs", ["--check", "LEN-004"]),
  "LEN-005": () => runVerifier("scripts/verify/documentation-leanness.mjs", ["--check", "LEN-005"])
};

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.dimensions)) {
  throw new Error("Documentation quality manifest must use schemaVersion 1 and a dimensions array.");
}

const seenIds = new Set();
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  minimumDimensionScore: manifest.minimumDimensionScore,
  independentReview: {
    path: "artifacts/documentation-quality/independent-review.json",
    recipeSha256: independentReview.recipeSha256,
    reviewedAt: independentReview.reviewedAt,
    reviewedSnapshotSha256: independentReview.reviewedSnapshotSha256
  },
  dimensions: []
};

for (const dimension of manifest.dimensions) {
  const totalWeight = dimension.checks.reduce((sum, check) => sum + check.weight, 0);
  if (Math.abs(totalWeight - 10) > Number.EPSILON) {
    throw new Error(`${dimension.id} must assign exactly 10.0 total weight; found ${totalWeight}.`);
  }

  const checkResults = dimension.checks.map((check) => {
    if (seenIds.has(check.id)) throw new Error(`Duplicate documentation quality check: ${check.id}`);
    seenIds.add(check.id);
    const evaluate = checks[check.id];
    if (!evaluate) throw new Error(`No executable evaluator for documentation quality check ${check.id}.`);
    const result = evaluate();
    return { ...check, ...result };
  });
  const passedWeight = checkResults.filter((check) => check.passed).reduce((sum, check) => sum + check.weight, 0);
  const automatedScore = Number(passedWeight.toFixed(2));
  const independent = independentDimensions.get(dimension.id);
  if (!independent || !Number.isFinite(independent.score)) throw new Error(`Missing independent score for ${dimension.id}.`);
  const independentScore = Number(independent.score.toFixed(2));
  const score = Number(Math.min(automatedScore, independentScore).toFixed(2));
  report.dimensions.push({
    id: dimension.id,
    label: dimension.label,
    automatedScore,
    independentScore,
    score,
    thresholdPassed: score >= manifest.minimumDimensionScore,
    checks: checkResults
  });
}

const reportDirectory = path.join(root, "artifacts/documentation-quality");
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(path.join(reportDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

let failed = false;
for (const dimension of report.dimensions) {
  const status = dimension.thresholdPassed ? "PASS" : "FAIL";
  console.log(`${status} ${dimension.label}: ${dimension.score.toFixed(1)}/10 (automated ${dimension.automatedScore.toFixed(1)}, independent ${dimension.independentScore.toFixed(1)}, minimum ${manifest.minimumDimensionScore.toFixed(1)})`);
  for (const check of dimension.checks.filter((item) => !item.passed)) {
    console.error(`- ${check.id} ${check.title}: ${check.detail}`);
  }
  failed ||= !dimension.thresholdPassed;
}

if (failed) process.exit(1);
console.log("Documentation quality scorecard passed in every dimension.");
