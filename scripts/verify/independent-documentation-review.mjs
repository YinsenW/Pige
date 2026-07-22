import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const recipeRelative = "resources/documentation-quality/independent-review.recipe.json";
const recipeAbsolute = path.join(root, recipeRelative);
const artifactRelative = "artifacts/documentation-quality/independent-review.json";
const artifactAbsolute = path.join(root, artifactRelative);
const allowedExtensions = new Set([".md", ".json", ".mjs", ".js", ".ts", ".tsx", ".yml", ".yaml"]);
const expectedDimensions = new Set([
  "navigation_and_resource_lifecycle",
  "cross_document_contract_consistency",
  "continuous_traceability_and_acceptance",
  "ongoing_development_support",
  "documentation_leanness_and_maintainability"
]);
const requiredSnapshotRoots = new Set([
  ".github/workflows/ci.yml",
  ".github/workflows/packageability.yml",
  "AGENTS.md",
  "SECURITY.md",
  "PRIVACY.md",
  "docs/AI_DEVELOPMENT_GUIDE.md",
  "docs/TECH_ARCHITECTURE.md",
  "docs/PI_AGENT_AND_MODEL_PROVIDER_INTEGRATION.md",
  "docs/JOB_OPERATION_AND_RECOVERY.md",
  "docs/QUALITY_AND_TEST_STRATEGY.md",
  "docs/V0_1_IMPLEMENTATION_PLAYBOOK.md",
  "docs/DECISION_LOG.md",
  "resources/architecture-reset.manifest.json",
  "resources/traceability/acceptance.manifest.json",
  "resources/traceability/semantic-claims.manifest.json",
  "scripts/verify/architecture-reset.mjs",
  "package.json"
]);

const recipeBytes = fs.readFileSync(recipeAbsolute);
const recipe = JSON.parse(recipeBytes.toString("utf8"));

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function collect(directory, result) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute, result);
    else if (entry.isFile() && allowedExtensions.has(path.extname(entry.name))) result.add(relative(absolute));
  }
}

const reviewedFiles = new Set();
for (const configured of recipe.snapshot?.roots ?? []) {
  const absolute = path.join(root, configured);
  if (!fs.existsSync(absolute)) throw new Error(`Independent review snapshot path does not exist: ${configured}`);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) collect(absolute, reviewedFiles);
  else reviewedFiles.add(relative(absolute));
}
for (const excluded of recipe.snapshot?.exclude ?? []) reviewedFiles.delete(excluded);

const fileDigests = [...reviewedFiles].sort().map((file) => ({
  file,
  sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")
}));
const reviewedSnapshotSha256 = crypto.createHash("sha256")
  .update(fileDigests.map((entry) => `${entry.file}\0${entry.sha256}\n`).join(""))
  .digest("hex");

if (process.argv.includes("--print-snapshot")) {
  console.log(JSON.stringify({ reviewedSnapshotSha256, fileCount: fileDigests.length }, null, 2));
  process.exit(0);
}

const errors = [];
if (recipe.schemaVersion !== 1 || recipe.status !== "passed") errors.push("recipe must use schemaVersion 1 and status passed");
if (recipeBytes.length > 12_000) errors.push(`current independent-review recipe exceeds 12000 bytes: ${recipeBytes.length}`);
const configuredSnapshotRoots = new Set(recipe.snapshot?.roots ?? []);
for (const required of requiredSnapshotRoots) {
  if (!configuredSnapshotRoots.has(required)) errors.push(`independent review snapshot is missing governed root ${required}`);
}
if (!Number.isFinite(Date.parse(recipe.reviewedAt ?? ""))) errors.push("reviewedAt must be a valid timestamp");
const reviewAgeDays = (Date.now() - Date.parse(recipe.reviewedAt ?? "")) / 86_400_000;
if (!Number.isFinite(reviewAgeDays) || reviewAgeDays < -1 || reviewAgeDays > recipe.maxAgeDays) errors.push("independent review is stale or future-dated");
if (!/^[a-f0-9]{64}$/u.test(recipe.snapshot?.reviewedSha256 ?? "") || recipe.snapshot.reviewedSha256 !== reviewedSnapshotSha256) {
  errors.push(`reviewed snapshot hash is stale: expected ${reviewedSnapshotSha256}`);
}
if (!Number.isInteger(recipe.snapshot?.minimumFileCount) || fileDigests.length < recipe.snapshot.minimumFileCount) {
  errors.push(`reviewed snapshot covers only ${fileDigests.length} files; minimum is ${recipe.snapshot?.minimumFileCount ?? "missing"}`);
}

const reviewers = new Map();
const reviewerTasks = new Set();
if ((recipe.reviewers ?? []).length > 3) errors.push("current independent-review recipe retains more than three reviewers");
for (const reviewer of recipe.reviewers ?? []) {
  if (!reviewer.reviewerId || reviewers.has(reviewer.reviewerId)) errors.push(`duplicate or missing reviewer ID: ${reviewer.reviewerId ?? "missing"}`);
  reviewers.set(reviewer.reviewerId, reviewer);
  if (!reviewer.task || !Array.isArray(reviewer.independentDimensions) || reviewer.independentDimensions.length === 0) errors.push(`reviewer ${reviewer.reviewerId} has no independent scope`);
  if (reviewerTasks.has(reviewer.task)) errors.push(`reviewer task is duplicated: ${reviewer.task}`);
  reviewerTasks.add(reviewer.task);
  for (const id of reviewer.independentDimensions ?? []) if (!expectedDimensions.has(id)) errors.push(`reviewer ${reviewer.reviewerId} claims unknown dimension ${id}`);
  if (typeof reviewer.independence !== "string" || reviewer.independence.length < 24) errors.push(`reviewer ${reviewer.reviewerId} has no independence rationale`);
}

const dimensionIds = new Set();
const dimensions = recipe.dimensions ?? [];
if (dimensions.length !== expectedDimensions.size) errors.push(`independent review must contain exactly ${expectedDimensions.size} dimension rows`);
for (const dimension of dimensions) {
  dimensionIds.add(dimension.id);
  if (!expectedDimensions.has(dimension.id)) errors.push(`unknown independent-review dimension ${dimension.id}`);
  const reviewer = reviewers.get(dimension.reviewerId);
  if (!reviewer?.independentDimensions.includes(dimension.id)) errors.push(`${dimension.id} is not covered by an independent reviewer`);
  const scorePasses = recipe.strictlyAboveMinimum
    ? dimension.score > recipe.minimumDimensionScore
    : dimension.score >= recipe.minimumDimensionScore;
  if (!Number.isFinite(dimension.score) || dimension.score > 10 || !scorePasses) errors.push(`${dimension.id} score ${dimension.score} does not pass the independent threshold`);
  if (dimension.blockerCount !== 0) errors.push(`${dimension.id} still has ${dimension.blockerCount} blockers`);
  if (typeof dimension.summary !== "string" || dimension.summary.length < 24) errors.push(`${dimension.id} has no evidence summary`);
}
for (const id of expectedDimensions) if (!dimensionIds.has(id)) errors.push(`missing independent-review dimension ${id}`);
if (dimensionIds.size !== expectedDimensions.size) errors.push("independent-review dimensions are duplicated");

for (const verification of recipe.verification ?? []) {
  if (!verification.command || verification.status !== "passed" || typeof verification.evidence !== "string" || verification.evidence.length < 24) {
    errors.push(`invalid verification record for ${verification.command ?? "missing command"}`);
  }
}
if ((recipe.verification ?? []).length < 3) errors.push("independent review must name at least three verification commands");
if ((recipe.resolvedBlockers ?? []).length !== 0) errors.push("resolved blockers belong in Git/CI history, not the current independent-review recipe");
if ((recipe.nonBlockingRisks ?? []).length > 8) errors.push("current independent-review recipe retains more than eight non-blocking risks");

const coordination = recipe.coordination ?? {};
if (coordination.status !== "acknowledged" || coordination.planningCost !== "Medium" || coordination.action !== "Active-phase follow-up") {
  errors.push("active-development coordination lacks acknowledged Medium/Active-phase evidence");
}
for (const field of ["taskId", "taskTitle", "compatibility", "acknowledgement"]) {
  if (typeof coordination[field] !== "string" || coordination[field].length < 4) errors.push(`coordination field ${field} is missing`);
}

if (errors.length) {
  console.error("Independent documentation review errors:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

const recipeSha256 = crypto.createHash("sha256").update(recipeBytes).digest("hex");
const artifact = {
  schemaVersion: 1,
  status: "passed",
  generatedAt: new Date().toISOString(),
  recipe: recipeRelative,
  recipeSha256,
  reviewedAt: recipe.reviewedAt,
  reviewedSnapshotSha256,
  reviewedFileCount: fileDigests.length,
  minimumDimensionScore: recipe.minimumDimensionScore,
  strictlyAboveMinimum: recipe.strictlyAboveMinimum,
  dimensions: recipe.dimensions,
  reviewers: recipe.reviewers,
  verification: recipe.verification,
  coordination: recipe.coordination,
  resolvedBlockers: recipe.resolvedBlockers,
  nonBlockingRisks: recipe.nonBlockingRisks
};

fs.mkdirSync(path.dirname(artifactAbsolute), { recursive: true });
fs.writeFileSync(artifactAbsolute, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(`Independent documentation review OK: ${expectedDimensions.size} dimensions above ${recipe.minimumDimensionScore.toFixed(1)}, ${fileDigests.length} reviewed files, acknowledged active-development coordination.`);
