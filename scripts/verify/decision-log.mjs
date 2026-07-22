import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const logPath = path.join(root, "docs/DECISION_LOG.md");
const text = fs.readFileSync(logPath, "utf8");
const acceptedHeading = text.indexOf("## 3. Accepted And Superseded Decisions");
const deferredHeading = text.indexOf("## 4. Deferred Decisions");
const failures = [];

if (acceptedHeading < 0 || deferredHeading < acceptedHeading) {
  console.error("Decision Log must contain ordered Accepted and Deferred sections.");
  process.exit(1);
}

const decisionSource = text.slice(acceptedHeading);
const starts = [...decisionSource.matchAll(/^### (D-[^\n]+)$/gmu)];
const allowedStatuses = new Set(["Accepted", "Superseded", "Deferred"]);
const requiredSections = ["Decision", "Rationale", "Consequences", "References"];
const idPattern = /^D-(\d{8})-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u;
const staleAcceptedPatterns = [
  { pattern: /\bcurrent Phase\s+\d+\b/iu, label: "current Phase" },
  { pattern: /\bremain(?:s|ed)?\s+(?:a\s+|the\s+)?(?:later|Phase\s+\d+)\b/iu, label: "remain later/Phase" },
  { pattern: /\bpending_[a-z0-9_]+\b/iu, label: "pending placeholder" }
];

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? undefined : date;
}

function parseIds(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readMetadata(block, id) {
  const decisionIndex = block.indexOf("\nDecision:");
  if (decisionIndex < 0) return new Map();
  const metadata = new Map();
  for (const line of block.slice(0, decisionIndex).split("\n").slice(1)) {
    if (!line.trim()) continue;
    const match = line.match(/^([^:]+):\s*(.+)$/u);
    if (!match) {
      failures.push(`${id}: malformed metadata line: ${line}`);
      continue;
    }
    const [, key, value] = match;
    if (metadata.has(key)) failures.push(`${id}: duplicate metadata field ${key}`);
    metadata.set(key, value.trim());
  }
  return metadata;
}

function readSections(block, id) {
  const sections = new Map();
  const matches = [...block.matchAll(/^(Decision|Rationale|Consequences|References):\s*$/gmu)];
  const order = matches.map((match) => match[1]);
  if (JSON.stringify(order) !== JSON.stringify(requiredSections)) {
    failures.push(`${id}: sections must appear once in this order: ${requiredSections.join(", ")}`);
  }
  for (let index = 0; index < matches.length; index += 1) {
    const name = matches[index][1];
    if (sections.has(name)) failures.push(`${id}: duplicate ${name} section`);
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? block.length;
    sections.set(name, block.slice(start, end).trim());
  }
  return sections;
}

const decisions = [];
const deferredOffset = deferredHeading - acceptedHeading;
for (let index = 0; index < starts.length; index += 1) {
  const start = starts[index].index;
  let end = starts[index + 1]?.index ?? decisionSource.length;
  if (start < deferredOffset && end > deferredOffset) end = deferredOffset;
  const id = starts[index][1];
  const block = decisionSource.slice(start, end).trim();
  decisions.push({ id, block, absoluteIndex: acceptedHeading + start });
}

const byId = new Map();
for (const decision of decisions) {
  const { id, block, absoluteIndex } = decision;
  if (byId.has(id)) failures.push(`${id}: duplicate decision ID`);
  byId.set(id, decision);

  const idMatch = id.match(idPattern);
  if (!idMatch) failures.push(`${id}: invalid decision ID format`);

  const metadata = readMetadata(block, id);
  const knownMetadata = new Set(["Status", "Date", "Revised", "Supersedes", "Superseded by"]);
  for (const key of metadata.keys()) {
    if (!knownMetadata.has(key)) failures.push(`${id}: unsupported metadata field ${key}`);
  }
  decision.metadata = metadata;
  decision.status = metadata.get("Status");
  decision.supersedes = metadata.has("Supersedes") ? parseIds(metadata.get("Supersedes")) : [];
  decision.supersededBy = metadata.has("Superseded by") ? parseIds(metadata.get("Superseded by")) : [];
  if (new Set(decision.supersedes).size !== decision.supersedes.length) failures.push(`${id}: duplicate ID in Supersedes`);
  if (new Set(decision.supersededBy).size !== decision.supersededBy.length) failures.push(`${id}: duplicate ID in Superseded by`);

  if (!allowedStatuses.has(decision.status)) failures.push(`${id}: invalid or missing Status`);
  const dateValue = metadata.get("Date") ?? "";
  const date = parseDate(dateValue);
  if (!date) failures.push(`${id}: invalid or missing Date ${dateValue}`);
  if (idMatch && dateValue.replaceAll("-", "") !== idMatch[1]) {
    failures.push(`${id}: ID date does not match Date ${dateValue}`);
  }
  if (metadata.has("Revised")) {
    const revised = parseDate(metadata.get("Revised"));
    if (!revised) failures.push(`${id}: invalid Revised date ${metadata.get("Revised")}`);
    if (date && revised && revised < date) failures.push(`${id}: Revised date precedes Date`);
  }

  const expectedStatus = absoluteIndex >= deferredHeading ? "Deferred" : undefined;
  if (expectedStatus === "Deferred" && decision.status !== "Deferred") {
    failures.push(`${id}: decisions under Deferred Decisions must use Deferred status`);
  }
  if (expectedStatus === undefined && decision.status === "Deferred") {
    failures.push(`${id}: Deferred decision is outside the Deferred Decisions section`);
  }

  const sections = readSections(block, id);
  for (const section of requiredSections) {
    if (!sections.get(section)) failures.push(`${id}: missing or empty ${section} section`);
  }
  if (sections.get("Consequences") && !/^\s*-\s+/mu.test(sections.get("Consequences"))) {
    failures.push(`${id}: Consequences must contain at least one list item`);
  }
  if (sections.get("References") && !/^\s*-\s+/mu.test(sections.get("References"))) {
    failures.push(`${id}: References must contain at least one list item`);
  }
  if (sections.get("References") && !/`(?:[A-Z_]+\.md|docs\/[^`]+\.md)`/u.test(sections.get("References"))) {
    failures.push(`${id}: References must name at least one Markdown owner or policy contract`);
  }

  if (decision.status === "Superseded" && decision.supersededBy.length === 0) {
    failures.push(`${id}: Superseded decision is missing Superseded by`);
  }
  if (decision.status === "Accepted" && decision.supersededBy.length > 0) {
    failures.push(`${id}: Accepted decision cannot have Superseded by`);
  }
  if (decision.status !== "Accepted" && decision.supersedes.length > 0) {
    failures.push(`${id}: only Accepted decisions may use Supersedes`);
  }

  if (decision.status === "Accepted") {
    for (const check of staleAcceptedPatterns) {
      if (check.pattern.test(block)) {
        failures.push(`${id}: vague temporal claim (${check.label}); use an explicit scope boundary or supersession`);
      }
    }
  }
}

const historicalImplementationSliceIds = new Set([
  "D-20260709-Phase-1-Vault-Foundation-Slice",
  "D-20260709-Phase-1-Maintenance-Policy-Foundation",
  "D-20260709-Phase-1-Support-Bundle-MVP",
  "D-20260709-Phase-1-Agent-Runtime-Stub",
  "D-20260709-Phase-1-I18N-And-Toolchain-Health-Foundation",
  "D-20260709-Phase-2-Text-Capture-Preservation",
  "D-20260709-Phase-2-Markdown-Txt-File-Capture",
  "D-20260710-Document-And-Image-Capture-Preservation",
  "D-20260709-Phase-2-3-Minimal-Source-Pages",
  "D-20260709-Phase-2-3-Markdown-First-Library-List",
  "D-20260709-Phase-2-3-Minimal-Page-Reader",
  "D-20260709-Phase-3-Basic-Agent-Ingest-Bridge",
  "D-20260710-Phase-3-Change-Proposal-Foundation"
]);
const historicalIndex = text.slice(text.indexOf("### 2.2 Historical Implementation Slice Index"), acceptedHeading);
for (const id of historicalImplementationSliceIds) {
  if (!historicalIndex.includes(`\`${id}\``)) failures.push(`${id}: missing from the historical implementation slice index`);
  if (byId.has(id)) failures.push(`${id}: implementation progress record returned to the active decision ledger`);
}

const qualityManifest = JSON.parse(fs.readFileSync(path.join(root, "resources/documentation-quality/documentation-quality.manifest.json"), "utf8"));
const qualityDecision = byId.get("D-20260710-Executable-Documentation-Quality-Gates");
const dimensionCountWords = new Map([[4, "four"], [5, "five"]]);
const expectedDimensionWord = dimensionCountWords.get(qualityManifest.dimensions?.length);
if (!expectedDimensionWord || !qualityDecision?.block.includes(`${expectedDimensionWord} independent dimensions`)) {
  failures.push("D-20260710-Executable-Documentation-Quality-Gates: decision dimension count does not match the quality manifest");
}
if (qualityManifest.dimensions?.some((dimension) => dimension.id === "documentation_leanness_and_maintainability")) {
  if (!qualityDecision?.block.includes("documentation leanness/maintainability")) {
    failures.push("D-20260710-Executable-Documentation-Quality-Gates: leanness dimension is missing from the durable decision");
  }
  const playbook = fs.readFileSync(path.join(root, "docs/V0_1_IMPLEMENTATION_PLAYBOOK.md"), "utf8");
  if (!playbook.includes(`all ${expectedDimensionWord} governed dimensions`)) {
    failures.push("E0.11 documentation dimension count does not match the quality manifest");
  }
}

const acceptanceManifest = JSON.parse(fs.readFileSync(path.join(root, "resources/traceability/acceptance.manifest.json"), "utf8"));
const semanticClaimsManifest = JSON.parse(fs.readFileSync(path.join(root, "resources/traceability/semantic-claims.manifest.json"), "utf8"));
const traceLockDecision = byId.get("D-20260710-Semantic-Traceability-Lock-And-Executable-Evidence");
for (const [label, version] of [
  ["acceptance manifest", acceptanceManifest.schemaVersion],
  ["semantic-claims lock", semanticClaimsManifest.schemaVersion]
]) {
  if (!traceLockDecision?.block.includes(`${label} uses schema version ${version}`)) {
    failures.push(`D-20260710-Semantic-Traceability-Lock-And-Executable-Evidence: ${label} version does not match its manifest`);
  }
}

for (const decision of decisions) {
  for (const targetId of decision.supersedes) {
    if (!idPattern.test(targetId)) failures.push(`${decision.id}: invalid Supersedes ID: ${targetId}`);
    const target = byId.get(targetId);
    if (!target) {
      failures.push(`${decision.id}: Supersedes target does not exist: ${targetId}`);
      continue;
    }
    if (targetId === decision.id) failures.push(`${decision.id}: decision cannot supersede itself`);
    if (target.status !== "Superseded") failures.push(`${decision.id}: Supersedes target is not Superseded: ${targetId}`);
    if (!target.supersededBy.includes(decision.id)) failures.push(`${decision.id}: missing inverse Superseded by on ${targetId}`);
  }
  for (const replacementId of decision.supersededBy) {
    if (!idPattern.test(replacementId)) failures.push(`${decision.id}: invalid Superseded by ID: ${replacementId}`);
    const replacement = byId.get(replacementId);
    if (!replacement) {
      failures.push(`${decision.id}: Superseded by target does not exist: ${replacementId}`);
      continue;
    }
    if (replacementId === decision.id) failures.push(`${decision.id}: decision cannot be superseded by itself`);
    if (replacement.status !== "Accepted") failures.push(`${decision.id}: replacement is not Accepted: ${replacementId}`);
    if (!replacement.supersedes.includes(decision.id)) failures.push(`${decision.id}: missing inverse Supersedes on ${replacementId}`);
    const originalDate = parseDate(decision.metadata.get("Date") ?? "");
    const replacementDate = parseDate(replacement.metadata.get("Date") ?? "");
    if (originalDate && replacementDate && replacementDate < originalDate) {
      failures.push(`${decision.id}: replacement ${replacementId} predates the original decision`);
    }
  }
}

const requiredSemanticDecisionIds = new Set([
  "D-20260709-Durable-Jobs-Before-Work",
  "D-20260709-Error-Taxonomy-Is-Shared",
  "D-20260709-Phase-1-Provider-And-Settings-Registry",
  "D-20260710-File-Capture-Storage-Strategy-Enforcement"
]);
const semanticStart = "<!-- decision-contract-map:start -->";
const semanticEnd = "<!-- decision-contract-map:end -->";
const semanticBlockStart = text.indexOf(semanticStart);
const semanticBlockEnd = text.indexOf(semanticEnd);
let semanticMap;
if (semanticBlockStart < 0 || semanticBlockEnd <= semanticBlockStart) {
  failures.push("Decision Log is missing the bounded machine-checked semantic contract map.");
} else {
  const semanticBlock = text.slice(semanticBlockStart + semanticStart.length, semanticBlockEnd);
  const jsonSource = semanticBlock.match(/```json\s*([\s\S]*?)\s*```/u)?.[1];
  if (!jsonSource) {
    failures.push("Decision semantic contract map must contain one JSON code block.");
  } else {
    try {
      semanticMap = JSON.parse(jsonSource);
    } catch (error) {
      failures.push(`Decision semantic contract map is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const mappedDecisionIds = new Set();
const mappedTestPaths = new Set();
if (semanticMap) {
  if (semanticMap.schemaVersion !== 1 || !Array.isArray(semanticMap.contracts)) {
    failures.push("Decision semantic contract map must use schemaVersion 1 and a contracts array.");
  } else {
    for (const contract of semanticMap.contracts) {
      const decisionId = typeof contract?.decisionId === "string" ? contract.decisionId : "<missing>";
      if (mappedDecisionIds.has(decisionId)) failures.push(`${decisionId}: duplicate semantic contract mapping`);
      mappedDecisionIds.add(decisionId);
      const decision = byId.get(decisionId);
      if (!decision) {
        failures.push(`${decisionId}: semantic contract map targets a missing decision`);
      } else {
        if (decision.status !== "Accepted") failures.push(`${decisionId}: semantic contract mapping must target an Accepted decision`);
        if (typeof contract.owner?.path === "string" && !decision.block.includes(`\`${contract.owner.path}\``)) {
          failures.push(`${decisionId}: References does not name mapped owner ${contract.owner.path}`);
        }
      }
      validateSemanticAnchor(decisionId, "owner", contract.owner, { requireMarkdown: true });
      if (!Array.isArray(contract.code) || contract.code.length === 0) {
        failures.push(`${decisionId}: semantic contract mapping needs executable code anchors`);
      } else {
        for (const anchor of contract.code) validateSemanticAnchor(decisionId, "code", anchor);
      }
      if (!Array.isArray(contract.tests) || contract.tests.length === 0) {
        failures.push(`${decisionId}: semantic contract mapping needs executable test anchors`);
      } else {
        for (const anchor of contract.tests) {
          validateSemanticAnchor(decisionId, "test", anchor, { requireTest: true });
          if (typeof anchor?.path === "string") mappedTestPaths.add(anchor.path);
        }
      }
    }
  }
}

for (const decisionId of requiredSemanticDecisionIds) {
  if (!mappedDecisionIds.has(decisionId)) failures.push(`${decisionId}: missing required owner/code/test semantic mapping`);
}

if (mappedTestPaths.size > 0) {
  const executableSemanticProof = spawnSync("npx", ["vitest", "run", ...mappedTestPaths], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
  if (executableSemanticProof.status !== 0) {
    failures.push(`Decision semantic proof tests failed: ${(executableSemanticProof.stderr || executableSemanticProof.stdout).trim()}`);
  }
}

function validateSemanticAnchor(decisionId, role, anchor, options = {}) {
  if (!anchor || typeof anchor.path !== "string" || !Array.isArray(anchor.markers) || anchor.markers.length === 0) {
    failures.push(`${decisionId}: invalid ${role} semantic anchor shape`);
    return;
  }
  if (path.isAbsolute(anchor.path) || anchor.path.split("/").includes("..")) {
    failures.push(`${decisionId}: ${role} anchor path must stay repository-relative: ${anchor.path}`);
    return;
  }
  if (options.requireMarkdown && (!anchor.path.startsWith("docs/") || !anchor.path.endsWith(".md"))) {
    failures.push(`${decisionId}: owner anchor must be a docs Markdown contract: ${anchor.path}`);
  }
  if (options.requireTest && (!anchor.path.startsWith("tests/") || !anchor.path.endsWith(".test.ts"))) {
    failures.push(`${decisionId}: test anchor must be an executable Vitest file: ${anchor.path}`);
  }
  const absolutePath = path.join(root, anchor.path);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    failures.push(`${decisionId}: missing ${role} anchor file ${anchor.path}`);
    return;
  }
  const source = fs.readFileSync(absolutePath, "utf8");
  for (const marker of anchor.markers) {
    if (typeof marker !== "string" || marker.length === 0 || !source.includes(marker)) {
      failures.push(`${decisionId}: ${role} anchor ${anchor.path} is missing marker ${JSON.stringify(marker)}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Invalid Decision Log:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const counts = Object.fromEntries([...allowedStatuses].map((status) => [status, decisions.filter((item) => item.status === status).length]));
console.log(
  `Decision Log OK: ${decisions.length} unique decisions (${counts.Accepted} accepted, ${counts.Superseded} superseded, ${counts.Deferred} deferred).`
);
