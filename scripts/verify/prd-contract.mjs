import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PRD_PATH = "docs/PRD.md";
const SPEC_PATH = "docs/SPEC_TRACEABILITY.md";
const P0_COVERAGE_PATH = "resources/traceability/p0-coverage.manifest.json";
const ACCEPTANCE_PATH = "resources/traceability/acceptance.manifest.json";
const PLAYBOOK_PATH = "docs/V0_1_IMPLEMENTATION_PLAYBOOK.md";
const MILESTONES_PATH = "docs/MILESTONES.md";

const controlledBaseline = Object.freeze({
  p0Items: 151,
  p1Items: 9,
  p2Items: 10,
  requirements: 99,
  capabilities: 99,
  builds: 141,
  exits: 97,
  deferred: 32
});

const requiredSections = [
  ["contract authority", "## 0. Contract Authority And AI Use", "## 1. Summary"],
  ["product optimization order", "## 5. Product Optimization Order", "## 6. Default User Model And Product Concepts"],
  ["default user model", "Default user model:", "### 6.1 Home Composer"],
  ["observable state contract", "## 7. Core User Jobs And Observable State Contract", "## 8. v0.1 Public Alpha Scope"],
  ["P1 scope", "### 8.2 P1 Should Have", "### 8.3 P2 Later"],
  ["P2 scope", "### 8.3 P2 Later", "## 9. Explicit Non-Goals For v0.1"],
  ["non-goals", "## 9. Explicit Non-Goals For v0.1", "## 10. Input Handling Requirements"],
  ["acceptance scenarios", "## 23. Product Acceptance Scenarios", "## 24. Risks"],
  ["risks", "## 24. Risks", "## 25. Resolved v0.1 Decisions"]
];

const technicalOwnerLeakPatterns = [
  [/\bnode:sqlite\b/iu, "node:sqlite driver choice"],
  [/\bbetter-sqlite3\b/iu, "better-sqlite3 driver choice"],
  [/\bQwen3(?:[-\s][A-Za-z0-9_.-]+)?\b/iu, "concrete Qwen model identity"],
  [/\bGGUF\b|\.gguf\b/iu, "concrete model format or file"],
  [/\bllama\.cpp\b/iu, "concrete local-model runtime"],
  [/\bPaddleOCR\b|\bPP-OCR[A-Za-z0-9.-]*\b/iu, "concrete OCR package or model pack"],
  [/\bSpeechAnalyzer\b|\bSpeechTranscriber\b/iu, "concrete speech API"],
  [/\bWindows AI APIs?\b|\bWindows\.Media\.Ocr\b/iu, "concrete Windows OCR API"],
  [/\bApple Vision\b|\bRecognizeDocumentsRequest\b/iu, "concrete Apple OCR API"],
  [/\bTypeScript\s+[0-9]+(?:\.[0-9]+)?\b/iu, "compiler version"],
  [/using\s+`fetch`\s+as\s+the\s+first\s+implementation\s+path/iu, "URL-fetch implementation choice"],
  [/\bcopy_to_source_library\b|\breference_original\b/iu, "executable source-storage enum"],
  [/\bSQLite\b/iu, "concrete database technology"],
  [/\bvector index(?:ing)?\b/iu, "concrete retrieval-index implementation"],
  [/\bRAG chunk(?:s| metadata)?\b/iu, "internal retrieval-chunk implementation"],
  [/\bdatabase driver\b/iu, "database-driver implementation boundary"],
  [/https?:\/\//iu, "external technical URL"],
  [/```(?:ts|typescript|json)\b/iu, "executable or schema code block"],
  [/^\s*(?:export\s+)?(?:type|interface)\s+[A-Z][A-Za-z0-9_]*/gmu, "executable type declaration"],
  [/\bz\.(?:object|enum|union|discriminatedUnion)\s*\(/iu, "Zod schema declaration"]
];

const implementationStateLeakPatterns = [
  [/\bCurrent implementation note\b/iu, "current implementation note"],
  [/\bImplementation status\s*:/iu, "implementation status field"],
  [/\b(?:already|currently|not yet) implemented\b/iu, "temporal implementation claim"],
  [/\bEV-[A-Z0-9-]+\b/u, "evidence ID"],
  [/\b[BE][0-9]\.\d{2}\b/u, "Build or Exit ID"],
  [/`(?:apps|packages|tests|artifacts|scripts)\/[A-Za-z0-9_.@/-]+`/u, "implementation, test, generated-artifact, or verifier path"]
];

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(root, relativePath) {
  return JSON.parse(read(root, relativePath));
}

function add(errors, message) {
  errors.push(message);
}

function sliceBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = start < 0 ? -1 : text.indexOf(endMarker, start + startMarker.length);
  return start < 0 || end < 0 ? "" : text.slice(start, end);
}

function lineNumber(text, index) {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

function topLevelBullets(section) {
  return section.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
}

function parseP0Categories(prd, p0Coverage) {
  const section = sliceBetween(prd, p0Coverage.source.startHeading, p0Coverage.source.endHeading);
  const categories = new Map();
  let category;
  for (const line of section.split("\n")) {
    const categoryMatch = line.match(/^([A-Z][^:]+):$/u);
    if (categoryMatch) {
      category = categoryMatch[1];
      if (!categories.has(category)) categories.set(category, []);
    } else if (line.startsWith("- ") && category) {
      categories.get(category).push(line.slice(2));
    }
  }
  return { section, categories };
}

function expandCoverageGroup(group) {
  if (Array.isArray(group.items)) return group.items;
  if (!Array.isArray(group.range) || group.range.length !== 2) return [];
  return Array.from({ length: group.range[1] - group.range[0] + 1 }, (_, index) => group.range[0] + index);
}

function buildModel(root) {
  return {
    root,
    prd: read(root, PRD_PATH),
    spec: read(root, SPEC_PATH),
    p0Coverage: readJson(root, P0_COVERAGE_PATH),
    acceptance: readJson(root, ACCEPTANCE_PATH),
    playbook: read(root, PLAYBOOK_PATH),
    milestones: read(root, MILESTONES_PATH)
  };
}

function checkRequiredStructure(model, errors) {
  const requiredAuthorityMarkers = [
    "Status: Active product contract",
    "normative product contract, not a marketing narrative, implementation-status report",
    "This document does not own executable types, schemas, internal paths, dependency",
    "Current status and evidence are owned by",
    "current implementation notes MUST",
    "NOT be maintained in this PRD"
  ];
  for (const marker of requiredAuthorityMarkers) {
    if (!model.prd.includes(marker)) add(errors, `PRD contract authority is missing: ${marker}`);
  }
  for (const [label, startMarker, endMarker] of requiredSections) {
    const section = sliceBetween(model.prd, startMarker, endMarker);
    if (section.trim().length < 80) add(errors, `PRD ${label} section is missing, reordered beyond its stable boundary, or empty.`);
  }
  for (const marker of [
    "### 5.1 Preserve Data, Ownership, And Trust",
    "### 5.2 Keep The Default Product Simple And Useful",
    "### 5.3 Hide Runtime Complexity Behind Effective Defaults",
    "### 5.4 Extend Vertically Without Turning Pige Into A Platform Console",
    "User-facing state names are product copy, not a competing executable Job vocabulary.",
    "docs/JOB_OPERATION_AND_RECOVERY.md",
    "docs/API_AND_IPC_DESIGN.md",
    "## 26. Owner Reference Index"
  ]) {
    if (!model.prd.includes(marker)) add(errors, `PRD AI-execution structure is missing: ${marker}`);
  }
}

function checkScopeBaseline(model, errors) {
  const parsed = parseP0Categories(model.prd, model.p0Coverage);
  if (!parsed.section) {
    add(errors, "PRD P0 source section cannot be located from the coverage manifest.");
    return;
  }
  const declaredP0Total = (model.p0Coverage.categories ?? []).reduce((sum, category) => sum + category.expectedItems, 0);
  const actualP0Total = [...parsed.categories.values()].reduce((sum, items) => sum + items.length, 0);
  if (declaredP0Total !== controlledBaseline.p0Items) add(errors, `P0 coverage baseline drifted: manifest declares ${declaredP0Total}; controlled baseline is ${controlledBaseline.p0Items}.`);
  if (actualP0Total !== controlledBaseline.p0Items) add(errors, `PRD P0 item count drifted: found ${actualP0Total}; expected ${controlledBaseline.p0Items}.`);

  const coverageCategoryNames = new Set();
  for (const category of model.p0Coverage.categories ?? []) {
    if (coverageCategoryNames.has(category.name)) add(errors, `P0 coverage contains duplicate category ${category.name}.`);
    coverageCategoryNames.add(category.name);
    const items = parsed.categories.get(category.name);
    if (!items) {
      add(errors, `PRD P0 category is missing: ${category.name}.`);
      continue;
    }
    if (items.length !== category.expectedItems) add(errors, `PRD P0 category ${category.name} contains ${items.length} items; expected ${category.expectedItems}.`);
    const counts = new Map();
    for (const group of category.coverage ?? []) {
      for (const ordinal of expandCoverageGroup(group)) counts.set(ordinal, (counts.get(ordinal) ?? 0) + 1);
    }
    for (let ordinal = 1; ordinal <= category.expectedItems; ordinal += 1) {
      if ((counts.get(ordinal) ?? 0) !== 1) add(errors, `P0-${category.key}-${String(ordinal).padStart(3, "0")} has ${(counts.get(ordinal) ?? 0)} coverage groups; expected exactly one.`);
    }
  }
  for (const categoryName of parsed.categories.keys()) {
    if (!coverageCategoryNames.has(categoryName)) add(errors, `PRD P0 category is not controlled by the coverage manifest: ${categoryName}.`);
  }

  const p1 = topLevelBullets(sliceBetween(model.prd, "### 8.2 P1 Should Have", "### 8.3 P2 Later"));
  const p2 = topLevelBullets(sliceBetween(model.prd, "### 8.3 P2 Later", "## 9. Explicit Non-Goals For v0.1"));
  if (p1.length !== controlledBaseline.p1Items) add(errors, `PRD P1 item count drifted: found ${p1.length}; expected ${controlledBaseline.p1Items}.`);
  if (p2.length !== controlledBaseline.p2Items) add(errors, `PRD P2 item count drifted: found ${p2.length}; expected ${controlledBaseline.p2Items}.`);
}

function checkTraceBaseline(model, errors) {
  const requirementIds = [...model.spec.matchAll(/^\| (PIGE-[A-Z][A-Z0-9]*-\d{3}) \|/gmu)].map((match) => match[1]);
  const requirementSet = new Set(requirementIds);
  if (requirementIds.length !== controlledBaseline.requirements || requirementSet.size !== controlledBaseline.requirements) {
    add(errors, `Requirement register baseline drifted: rows=${requirementIds.length}, unique=${requirementSet.size}, expected=${controlledBaseline.requirements}.`);
  }
  const capabilities = Object.keys(model.acceptance.capabilities ?? {});
  const acceptanceRequirements = Object.keys(model.acceptance.requirements ?? {});
  if (capabilities.length !== controlledBaseline.capabilities) add(errors, `Capability baseline drifted: found ${capabilities.length}; expected ${controlledBaseline.capabilities}.`);
  if (acceptanceRequirements.length !== controlledBaseline.requirements) add(errors, `Acceptance Requirement baseline drifted: found ${acceptanceRequirements.length}; expected ${controlledBaseline.requirements}.`);

  for (const id of new Set(model.prd.match(/PIGE-[A-Z][A-Z0-9]*-\d{3}/gu) ?? [])) {
    if (!requirementSet.has(id)) add(errors, `PRD references undefined Requirement ${id}.`);
  }

  const buildCount = (model.playbook.match(/^- \[B[0-9]\.\d{2} -> E[0-9]\.\d{2}\] /gmu) ?? []).length;
  const exitCount = (model.playbook.match(/^- \[E[0-9]\.\d{2}\] /gmu) ?? []).length;
  const deferredCount = (model.playbook.match(/^- \[D[0-9]\.\d{2}\] /gmu) ?? []).length;
  if (buildCount !== controlledBaseline.builds) add(errors, `Build baseline drifted: found ${buildCount}; expected ${controlledBaseline.builds}.`);
  if (exitCount !== controlledBaseline.exits) add(errors, `Exit baseline drifted: found ${exitCount}; expected ${controlledBaseline.exits}.`);
  if (deferredCount !== controlledBaseline.deferred) add(errors, `Deferred baseline drifted: found ${deferredCount}; expected ${controlledBaseline.deferred}.`);

  const phases = new Set([...model.playbook.matchAll(/^## \d+\. Phase ([0-9]):/gmu)].map((match) => `P${match[1]}`));
  const milestones = new Set([...model.milestones.matchAll(/^### (M[0-7]):/gmu)].map((match) => match[1]));
  const expectedPhases = Array.from({ length: 10 }, (_, index) => `P${index}`);
  const expectedMilestones = Array.from({ length: 8 }, (_, index) => `M${index}`);
  if (expectedPhases.some((id) => !phases.has(id)) || phases.size !== expectedPhases.length) add(errors, `Phase identity baseline drifted: found ${[...phases].sort().join(", ")}.`);
  if (expectedMilestones.some((id) => !milestones.has(id)) || milestones.size !== expectedMilestones.length) add(errors, `Milestone identity baseline drifted: found ${[...milestones].sort().join(", ")}.`);
}

function checkOwnerAndEvidenceBoundary(model, errors) {
  for (const [evidenceId, evidence] of Object.entries(model.acceptance.evidenceCatalog ?? {})) {
    if (String(evidence?.path ?? "").replace(/^\.\//u, "") === PRD_PATH) add(errors, `${evidenceId} incorrectly uses the PRD as implementation evidence.`);
  }
  for (const match of model.prd.matchAll(/`((?:docs|resources)\/[A-Za-z0-9_.@/#-]+)`/gu)) {
    const relativePath = match[1].split("#")[0];
    if (!fs.existsSync(path.join(model.root, relativePath))) add(errors, `PRD references missing owner/control path ${relativePath}.`);
  }
}

function checkNoImplementationOrTechnicalLeakage(model, errors) {
  const authorityEnd = model.prd.indexOf("## 1. Summary");
  const normativeBody = authorityEnd < 0 ? model.prd : model.prd.slice(authorityEnd);
  for (const [pattern, label] of implementationStateLeakPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(normativeBody);
    if (match) add(errors, `PRD contains ${label} at line ${lineNumber(model.prd, authorityEnd + match.index)}; current status/evidence belongs to acceptance and implementation owners.`);
  }
  for (const [pattern, label] of technicalOwnerLeakPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(model.prd);
    if (match) add(errors, `PRD contains ${label} at line ${lineNumber(model.prd, match.index)}; keep only the product outcome and reference the technical owner.`);
  }
}

export function evaluatePrdContract(model) {
  const errors = [];
  checkRequiredStructure(model, errors);
  checkScopeBaseline(model, errors);
  checkTraceBaseline(model, errors);
  checkOwnerAndEvidenceBoundary(model, errors);
  checkNoImplementationOrTechnicalLeakage(model, errors);
  return errors;
}

export function runPrdContract(root, mutate) {
  const model = buildModel(root);
  if (mutate) mutate(model);
  return { model, errors: evaluatePrdContract(model) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const result = runPrdContract(process.cwd());
    if (result.errors.length > 0) {
      console.error("PRD contract errors:");
      for (const error of result.errors) console.error(`- ${error}`);
      process.exit(1);
    }
    console.log(
      `PRD contract OK: ${controlledBaseline.p0Items}/${controlledBaseline.p1Items}/${controlledBaseline.p2Items} P0/P1/P2 items, ` +
      `${controlledBaseline.requirements} Requirements/capabilities, ${controlledBaseline.builds} Builds, ${controlledBaseline.exits} Exits, and ${controlledBaseline.deferred} Deferred entries remain controlled; implementation status and known implementation-only identities are absent.`
    );
  } catch (error) {
    console.error(`PRD contract fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
