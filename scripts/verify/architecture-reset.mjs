import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "resources/architecture-reset.manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];
const knownArguments = new Set(["--post-combined", "--phase-proof=AR1"]);
const unknownArguments = process.argv.slice(2).filter((argument) => !knownArguments.has(argument));
const verificationMode = process.argv.includes("--post-combined") ? "post-combined" : "staged";
const ar1ProofMode = process.argv.includes("--phase-proof=AR1");

if (unknownArguments.length > 0) failures.push(`unknown architecture-reset arguments: ${unknownArguments.join(", ")}`);

if (manifest.schemaVersion !== 1) failures.push("architecture reset manifest must use schemaVersion 1");
if (manifest.status !== "contract_frozen_implementation_pending") failures.push("architecture reset status changed without a reviewed contract transition");
if (manifest.verificationModes?.staged !== "node scripts/verify/architecture-reset.mjs" ||
  manifest.verificationModes?.postCombined !== "node scripts/verify/architecture-reset.mjs --post-combined" ||
  manifest.verificationModes?.ar1RequiredProof !== "node scripts/verify/architecture-reset.mjs --phase-proof=AR1") {
  failures.push("architecture reset must expose exact staged, post-combined and AR1 proof invocations");
}
if (!Array.isArray(manifest.phases) || manifest.phases.map((phase) => phase.id).join(",") !== "AR1,AR2,AR3") {
  failures.push("architecture reset foreground phases must end at AR3");
}
failures.push(...auditTimeboxPolicy(manifest));
if (!Array.isArray(manifest.passThroughSequence) || manifest.passThroughSequence.map((phase) => phase.id).join(",") !== "PT1,PT2,PT3,PT4") {
  failures.push("Pi pass-through remediation must retain the reviewed PT1-PT4 sequence");
}

const sourceRoots = ["apps/desktop/src", "packages"];
const ignoredSourceDirectories = new Set([
  ".git", "artifacts", "build", "coverage", "dist", "node_modules", "out", "test", "tests", "vendor"
]);
const sourceFiles = collectAuthoritativeSourceFiles(root);
failures.push(...auditLegacyMarkers(root, sourceFiles, manifest.legacyMarkers, verificationMode));
failures.push(...auditNoGrowthMarkers(root, sourceFiles, manifest.passThroughNoGrowth, verificationMode));
failures.push(...auditPostCombinedZeroBudgets(manifest));
failures.push(...verifySourceScopeGuard());
failures.push(...verifyAr1ProofGuard());
if (ar1ProofMode) failures.push(...auditAr1RequiredProof(root, manifest.ar1RequiredProof));

if (!Array.isArray(manifest.agentPassThroughInventory) || manifest.agentPassThroughInventory.length < 30) {
  failures.push("agent pass-through production inventory is incomplete");
}
for (const [relativePath, disposition, batch, rationale] of manifest.agentPassThroughInventory ?? []) {
  if (!relativePath || !["DELETE", "REWRITE", "KEEP"].includes(disposition) || !/^PT[1-4]$/u.test(batch) || !rationale) {
    failures.push(`invalid agent pass-through inventory entry for ${relativePath ?? "unknown"}`);
  }
  if (!fs.existsSync(path.join(root, relativePath)) && disposition !== "DELETE") {
    failures.push(`${disposition} pass-through inventory path is missing: ${relativePath}`);
  }
}

for (const disposition of ["DELETE", "REWRITE", "KEEP"]) {
  const entries = manifest.implementationInventory?.[disposition];
  if (!Array.isArray(entries) || entries.length === 0) failures.push(`implementation inventory ${disposition} is empty`);
  for (const [relativePath, phase, owner, rationale] of entries ?? []) {
    if (!relativePath || !phase || !owner || !rationale) failures.push(`invalid ${disposition} inventory entry for ${relativePath ?? "unknown"}`);
    if (!isResetInventoryPhase(phase, manifest.timeboxPolicy?.historicalInventoryTags ?? [])) failures.push(`${relativePath} has invalid phase ${phase}`);
    if (!fs.existsSync(path.join(root, relativePath)) && disposition !== "DELETE") failures.push(`${disposition} inventory path is missing: ${relativePath}`);
  }
}

const oversized = new Map(manifest.oversizedOwners.map(([file, baselineLines, disposition, rationale, phase]) => [file, {
  baselineLines, disposition, rationale, phase
}]));
const ownerFiles = [
  ...walk(path.join(root, "apps/desktop/src/main/services")).filter((file) => file.endsWith(".ts")),
  ...walk(path.join(root, "apps/desktop/src/renderer/src")).filter((file) => file.endsWith(".tsx"))
];
for (const absolutePath of ownerFiles) {
  const relativePath = relative(root, absolutePath);
  const lines = countLines(fs.readFileSync(absolutePath, "utf8"));
  const threshold = relativePath.includes("/renderer/")
    ? manifest.hardLimits.newRendererOwnerLines
    : manifest.hardLimits.newServiceLines;
  const entry = oversized.get(relativePath);
  if (lines > threshold && !entry) failures.push(`${relativePath} exceeds ${threshold} lines without KEEP/REWRITE ownership`);
  if (entry) {
    if (lines > entry.baselineLines) failures.push(`${relativePath} grew above frozen ${entry.baselineLines}-line reset baseline`);
    if (!["KEEP", "REWRITE"].includes(entry.disposition) || !entry.rationale || !isResetInventoryPhase(entry.phase, manifest.timeboxPolicy?.historicalInventoryTags ?? [])) {
      failures.push(`${relativePath} has an invalid reset disposition`);
    }
  }
}
for (const relativePath of oversized.keys()) {
  if (!fs.existsSync(path.join(root, relativePath))) continue;
  if (!ownerFiles.map((file) => relative(root, file)).includes(relativePath)) failures.push(`${relativePath} is not a scanned owner file`);
}

const adapterPath = path.join(root, "apps/desktop/src/main/services/pi-agent-runtime-adapter.ts");
if (countLines(fs.readFileSync(adapterPath, "utf8")) > manifest.hardLimits.piAdapterLines) {
  failures.push("Pi adapter exceeds the 400-line thin-assembly ceiling");
}

const acceptance = JSON.parse(fs.readFileSync(path.join(root, "resources/traceability/acceptance.manifest.json"), "utf8"));
for (const requirementId of ["PIGE-SEC-002", "PIGE-SEC-003", "PIGE-SEC-005", "PIGE-PI-003"]) {
  if (acceptance.requirements?.[requirementId]?.status !== "planned") {
    failures.push(`${requirementId} must remain planned until reset implementation evidence exists`);
  }
}
for (const exitId of ["E3.03", "E8.02", "E8.03"]) {
  if (acceptance.exits?.[exitId]?.status !== "planned") {
    failures.push(`${exitId} must remain planned until reset implementation evidence exists`);
  }
}

if (failures.length > 0) {
  console.error("Architecture reset contract failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

const inventoryCount = Object.values(manifest.implementationInventory).reduce((total, entries) => total + entries.length, 0);
console.log(`Architecture reset contract OK (${ar1ProofMode ? "AR1-required-proof" : verificationMode}): ${manifest.legacyMarkers.length} legacy guards, ${manifest.passThroughNoGrowth.length} pass-through no-growth guards, ${manifest.agentPassThroughInventory.length} production call sites, ${inventoryCount} DELETE/REWRITE/KEEP entries, ${oversized.size} oversized owners, authoritative-source/post-combined regressions passed, AR1-AR3 timeboxed without status promotion.`);

function auditTimeboxPolicy(candidate) {
  const diagnostics = [];
  const policy = candidate.timeboxPolicy ?? {};
  if (JSON.stringify(policy.foregroundPhaseIds) !== JSON.stringify(["AR1", "AR2", "AR3"])) diagnostics.push("foreground AR sequence must end at AR3");
  if (JSON.stringify(policy.historicalInventoryTags) !== JSON.stringify(["AR4"])) diagnostics.push("AR4 must remain historical inventory only");
  if (policy.calendarDays !== 14 || policy.requiredProofDay !== 10) diagnostics.push("AR timebox must use Day 10 proof and Day 14 expiry");
  if (policy.day14Disposition !== "normal_p0_p9_priority" || policy.featurePauseAfterExpiry !== false || policy.futureArchitectureQueue !== "P0-P9") {
    diagnostics.push("expired or future architecture work must use normal P0-P9 priority without a global pause");
  }
  const evidence = candidate.governanceEfficacyEvidence ?? {};
  if (evidence.definitionOwner !== "Product Planning" || evidence.collectionOwner !== "Project Management" || evidence.phase1Document !== "not_created" || evidence.statusImpact !== "none") {
    diagnostics.push("Phase 0 governance-efficacy ownership must remain bounded and status-neutral");
  }
  const sample = evidence.initialPullRequestSample ?? {};
  if (sample.pullRequests !== "114-123" || JSON.stringify(sample.existingFullGatePullRequests) !== JSON.stringify([114, 115, 116, 117, 118, 122, 123]) ||
    JSON.stringify(sample.backfilledFullGateRuns) !== JSON.stringify({"119": 29975503573, "120": 29975505581, "121": 29975507916}) ||
    sample.exactHeadFullGateCoverage !== "10/10" ||
    sample.knownTruePositive?.pullRequest !== 117 || sample.knownTruePositive?.run !== 29933636527 ||
    sample.knownTruePositive?.resolutionPullRequest !== 118 || sample.governanceBlocks !== 1 || sample.truePositives !== 1 ||
    sample.humanOverrides !== 0 || sample.falsePositives !== 0 || sample.falsePositiveRateAmongBlocks !== 0 ||
    JSON.stringify(sample.excludedFailureClasses) !== JSON.stringify(["packageability", "stale_synthetic_smoke", "environment_lock", "resource_timeout"])) {
    diagnostics.push("Phase 0 governance-efficacy initial PR sample drifted or changed classification scope");
  }
  return diagnostics;
}

function isResetInventoryPhase(value, historicalTags) {
  const allowed = new Set(["AR1", "AR2", "AR3", ...historicalTags]);
  return typeof value === "string" && value.split("/").every((part) => allowed.has(part));
}

function auditAr1RequiredProof(baseRoot, proof) {
  const diagnostics = [];
  if (proof?.owner !== "Product Planning" || proof?.pattern !== "YOLO|saved.grant|permission_lifecycle|waiting_permission|waiting_model_egress" || proof?.maximumMatches !== 0) {
    return ["AR1 Required Proof owner/pattern/zero budget drifted"];
  }
  if (JSON.stringify(proof.sourceRoots) !== JSON.stringify(["apps", "packages"]) ||
    JSON.stringify(proof.includedExtensions) !== JSON.stringify([".js", ".mjs", ".ts", ".tsx"]) ||
    JSON.stringify(proof.excludedDirectories) !== JSON.stringify([...ignoredSourceDirectories])) {
    return ["AR1 Required Proof roots/exclusions drifted"];
  }
  if (proof.humanShorthandKnownFalsePositive?.count !== 1 ||
    proof.humanShorthandKnownFalsePositive?.path !== "apps/desktop/src/renderer/src/locales/en/messages.json" ||
    proof.humanShorthandKnownFalsePositive?.kind !== "negative_truth_copy_not_authority") {
    return ["AR1 human shorthand deny-copy false-positive record drifted"];
  }
  const expression = new RegExp(proof.pattern, "gu");
  let total = 0;
  for (const sourceRoot of proof.sourceRoots) {
    for (const absolutePath of walk(path.join(baseRoot, sourceRoot))) {
      if (!proof.includedExtensions.includes(path.extname(absolutePath))) continue;
      const relativePath = relative(baseRoot, absolutePath);
      const count = [...fs.readFileSync(absolutePath, "utf8").matchAll(expression)].length;
      if (count === 0) continue;
      total += count;
      diagnostics.push(`AR1 Required Proof found ${count} current production match(es) in ${relativePath}`);
    }
  }
  if (total > proof.maximumMatches) diagnostics.push(`AR1 Required Proof found ${total} matches; maximum is ${proof.maximumMatches}`);
  return diagnostics;
}

function verifyAr1ProofGuard() {
  const clean = auditAr1RequiredProofFixture([{ path: "apps/desktop/src/main/clean.ts", source: "const safe = true;" }]);
  const mutated = auditAr1RequiredProofFixture([{ path: "packages/contracts/src/index.ts", source: "waiting_permission" }]);
  const excluded = auditAr1RequiredProofFixture([{ path: "packages/contracts/dist/index.js", source: "waiting_permission" }]);
  const denyCopy = auditAr1RequiredProofFixture([{
    path: "apps/desktop/src/renderer/src/locales/en/messages.json",
    source: "Pige does not offer a default permission mode, saved grants, or a blanket full-access switch."
  }]);
  const diagnostics = [];
  if (clean !== 0 || mutated !== 1 || excluded !== 0 || denyCopy !== 0) diagnostics.push("AR1 Required Proof authority/deny-copy/excluded-source self-test failed");
  return diagnostics;
}

function auditAr1RequiredProofFixture(entries) {
  const expression = /YOLO|saved.grant|permission_lifecycle|waiting_permission|waiting_model_egress/gu;
  return entries.reduce((total, entry) => {
    if (entry.path.split("/").some((part) => ignoredSourceDirectories.has(part))) return total;
    if (![".js", ".mjs", ".ts", ".tsx"].includes(path.extname(entry.path))) return total;
    return total + [...entry.source.matchAll(expression)].length;
  }, 0);
}

function collectAuthoritativeSourceFiles(baseRoot) {
  return sourceRoots.flatMap((relativeRoot) => walk(path.join(baseRoot, relativeRoot)))
    .filter((file) => /\.(?:ts|tsx|json)$/u.test(file))
    .map((file) => relative(baseRoot, file));
}

function auditLegacyMarkers(baseRoot, relativePaths, markers, mode = "staged") {
  const diagnostics = [];
  for (const marker of markers) {
    const budget = markerBudget(marker, mode);
    const allowed = new Set(budget.allowedPaths);
    let matches = 0;
    for (const relativePath of relativePaths) {
      const source = fs.readFileSync(path.join(baseRoot, relativePath), "utf8");
      const count = source.split(marker.token).length - 1;
      if (count === 0) continue;
      matches += count;
      if (!allowed.has(relativePath)) diagnostics.push(`${marker.id} appeared in new path ${relativePath}`);
    }
    if (matches > budget.maximumMatches) diagnostics.push(`${marker.id} exceeded ${mode} budget ${budget.maximumMatches} with ${matches} matches`);
    if (!["DELETE", "REWRITE"].includes(marker.disposition)) diagnostics.push(`${marker.id} must be DELETE or REWRITE during reset`);
  }
  return diagnostics;
}

function auditNoGrowthMarkers(baseRoot, relativePaths, markers, mode = "staged") {
  const diagnostics = [];
  if (!Array.isArray(markers) || markers.length === 0) return ["pass-through no-growth markers are missing"];
  for (const marker of markers) {
    const budget = markerBudget(marker, mode);
    const allowed = new Set(budget.allowedPaths);
    const compatibility = new Map((budget.compatibilityPaths ?? []).map((entry) => [entry.path, entry.maximumMatches]));
    let matches = 0;
    for (const relativePath of relativePaths) {
      const source = fs.readFileSync(path.join(baseRoot, relativePath), "utf8");
      const count = source.split(marker.token).length - 1;
      if (count === 0) continue;
      if (compatibility.has(relativePath)) {
        const maximumMatches = compatibility.get(relativePath);
        if (!Number.isInteger(maximumMatches) || maximumMatches < 0 || count > maximumMatches) {
          diagnostics.push(`${marker.id} exceeded compatibility budget ${maximumMatches} in ${relativePath} with ${count} matches`);
        }
        continue;
      }
      matches += count;
      if (!allowed.has(relativePath)) diagnostics.push(`${marker.id} appeared in new path ${relativePath}`);
    }
    if (matches > budget.maximumMatches) diagnostics.push(`${marker.id} exceeded ${mode} budget ${budget.maximumMatches} with ${matches} matches`);
  }
  return diagnostics;
}

function markerBudget(marker, mode) {
  if (mode === "post-combined" && Object.hasOwn(marker, "postCombinedMaximumMatches")) {
    return {
      allowedPaths: marker.postCombinedAllowedPaths ?? [],
      maximumMatches: marker.postCombinedMaximumMatches,
      compatibilityPaths: marker.postCombinedCompatibilityPaths ?? []
    };
  }
  return { allowedPaths: marker.allowedPaths ?? [], maximumMatches: marker.maximumMatches };
}

function auditPostCombinedZeroBudgets(contract) {
  const diagnostics = [];
  const requiredNoGrowthIds = new Set([
    "terminal.finish_tool", "completion.policy", "semantic.repair", "completion.missing",
    "answer.schema", "answer.evidence_quotes", "answer.output_invalid",
    "answer.completion_invalid", "turn.objective", "egress.content_classes",
    "egress.audit", "egress.decision", "ui.egress_confirmation"
  ]);
  const markers = new Map((contract.passThroughNoGrowth ?? []).map((marker) => [marker.id, marker]));
  for (const id of requiredNoGrowthIds) {
    const marker = markers.get(id);
    if (!marker || marker.postCombinedMaximumMatches !== 0 || marker.postCombinedAllowedPaths?.length !== 0) {
      diagnostics.push(`${id} must have an exact zero-match/no-path post-combined budget`);
    }
  }
  const objective = markers.get("turn.objective");
  const objectiveCompatibility = objective?.postCombinedCompatibilityPaths ?? [];
  if (objectiveCompatibility.length !== 1 ||
    objectiveCompatibility[0]?.path !== "apps/desktop/src/main/services/agent-turn-conversation-store.ts" ||
    objectiveCompatibility[0]?.maximumMatches !== 3) {
    diagnostics.push("turn.objective must exempt only the bounded read-only legacy conversation hash compatibility owner");
  }
  const modelEgress = contract.legacyMarkers?.find((marker) => marker.id === "model.egress_approval");
  if (!modelEgress || modelEgress.postCombinedMaximumMatches !== 0 || modelEgress.postCombinedAllowedPaths?.length !== 0) {
    diagnostics.push("model.egress_approval must have an exact zero-match/no-path post-combined budget");
  }
  return diagnostics;
}

function verifySourceScopeGuard() {
  const diagnostics = [];
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-architecture-reset-scope-"));
  const generatedTokenBody = [...manifest.legacyMarkers, ...manifest.passThroughNoGrowth]
    .map((marker) => marker.token).join("\n");
  const generatedPaths = [
    "packages/contracts/dist/index.d.ts",
    "packages/contracts/build/index.ts",
    "packages/contracts/out/index.ts",
    "packages/contracts/artifacts/index.ts",
    "packages/contracts/node_modules/example/index.ts",
    "packages/contracts/coverage/index.ts",
    "packages/contracts/vendor/index.ts"
  ];
  const sourceMutationPath = "apps/desktop/src/main/services/architecture-reset-source-mutation.ts";
  const historicalPath = "docs/DECISION_LOG.md";

  try {
    writeFixture(fixtureRoot, "packages/contracts/src/index.ts", "export const clean = true;\n");
    for (const generatedPath of generatedPaths) writeFixture(fixtureRoot, generatedPath, generatedTokenBody);
    writeFixture(fixtureRoot, historicalPath, generatedTokenBody);
    writeFixture(fixtureRoot, sourceMutationPath, "export const forbidden = 'capture_only';\n");

    const fixtureSources = collectAuthoritativeSourceFiles(fixtureRoot);
    for (const generatedPath of generatedPaths) {
      if (fixtureSources.includes(generatedPath)) diagnostics.push(`generated directory was scanned as source: ${generatedPath}`);
    }
    if (!fixtureSources.includes(sourceMutationPath)) diagnostics.push("authoritative source mutation was not scanned");
    if (fixtureSources.includes(historicalPath)) diagnostics.push("historical Decision Log was scanned as production source");

    const captureOnly = manifest.legacyMarkers.find((marker) => marker.id === "onboarding.capture_only");
    const mutationDiagnostics = captureOnly
      ? auditLegacyMarkers(fixtureRoot, fixtureSources, [captureOnly])
      : ["capture_only legacy marker is missing"];
    if (!mutationDiagnostics.some((failure) => failure.includes(`appeared in new path ${sourceMutationPath}`))) {
      diagnostics.push("authoritative source mutation was not rejected");
    }
    const finishTool = manifest.passThroughNoGrowth.find((marker) => marker.id === "terminal.finish_tool");
    writeFixture(fixtureRoot, sourceMutationPath, "export const forbidden = 'pige_finish_home_turn';\n");
    const passThroughMutationDiagnostics = finishTool
      ? auditNoGrowthMarkers(fixtureRoot, collectAuthoritativeSourceFiles(fixtureRoot), [finishTool])
      : ["terminal finish-tool no-growth marker is missing"];
    if (!passThroughMutationDiagnostics.some((failure) => failure.includes(`appeared in new path ${sourceMutationPath}`))) {
      diagnostics.push("pass-through authoritative source mutation was not rejected");
    }

    const postCombinedMarkers = [
      ...manifest.passThroughNoGrowth.filter((marker) => marker.postCombinedMaximumMatches === 0),
      ...manifest.legacyMarkers.filter((marker) => marker.postCombinedMaximumMatches === 0)
    ];
    writeFixture(fixtureRoot, sourceMutationPath, "export const cleanAgain = true;\n");
    const cleanPostCombinedSources = collectAuthoritativeSourceFiles(fixtureRoot);
    const cleanPostCombinedDiagnostics = [
      ...auditNoGrowthMarkers(fixtureRoot, cleanPostCombinedSources, postCombinedMarkers.filter((marker) => !marker.disposition), "post-combined"),
      ...auditLegacyMarkers(fixtureRoot, cleanPostCombinedSources, postCombinedMarkers.filter((marker) => marker.disposition), "post-combined")
    ];
    if (cleanPostCombinedDiagnostics.length > 0) {
      diagnostics.push("excluded generated/historical post-combined fixtures affected zero counts");
    }
    for (const marker of postCombinedMarkers) {
      writeFixture(fixtureRoot, sourceMutationPath, `export const forbidden = ${JSON.stringify(marker.token)};\n`);
      const mutatedSources = collectAuthoritativeSourceFiles(fixtureRoot);
      const markerDiagnostics = marker.disposition
        ? auditLegacyMarkers(fixtureRoot, mutatedSources, [marker], "post-combined")
        : auditNoGrowthMarkers(fixtureRoot, mutatedSources, [marker], "post-combined");
      if (!markerDiagnostics.some((failure) => failure.includes(marker.id))) {
        diagnostics.push(`post-combined zero guard did not reject authoritative source token for ${marker.id}`);
      }
      for (const compatibility of marker.postCombinedCompatibilityPaths ?? []) {
        writeFixture(
          fixtureRoot,
          compatibility.path,
          Array.from({ length: compatibility.maximumMatches + 1 }, () => marker.token).join("\n")
        );
        const compatibilityDiagnostics = auditNoGrowthMarkers(
          fixtureRoot,
          collectAuthoritativeSourceFiles(fixtureRoot),
          [marker],
          "post-combined"
        );
        if (!compatibilityDiagnostics.some((failure) => failure.includes("exceeded compatibility budget"))) {
          diagnostics.push(`post-combined compatibility budget did not reject excess token for ${marker.id}`);
        }
        fs.rmSync(path.join(fixtureRoot, compatibility.path), { force: true });
      }
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  return diagnostics;
}

function writeFixture(baseRoot, relativePath, body) {
  const target = path.join(baseRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && ignoredSourceDirectories.has(entry.name)) return [];
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function relative(baseRoot, target) {
  return path.relative(baseRoot, target).split(path.sep).join("/");
}

function countLines(source) {
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}
