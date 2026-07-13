import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CHECK_IDS = ["TRC-001", "TRC-002", "TRC-003", "TRC-004", "TRC-005"];
const verificationClasses = new Set(["contract", "unit", "integration", "smoke", "eval", "release", "manual"]);
const requirementStatuses = new Set(["verified", "partial", "planned"]);
const exitStatuses = new Set(["verified", "partial", "planned"]);
const phaseStates = new Set(["complete", "in_progress", "planned"]);
const evidenceKinds = new Set(["test", "verifier", "implementation", "contract", "generated-report", "manual-report"]);
const ignoredDirectories = new Set([".git", "node_modules", "artifacts", "dist", "build", "out", "coverage"]);
const executableEvidenceCache = new Map();

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(root, relativePath) {
  return JSON.parse(read(root, relativePath));
}

function readJsonIfPresent(root, relativePath) {
  const absolute = path.join(root, relativePath);
  return fs.existsSync(absolute) ? JSON.parse(fs.readFileSync(absolute, "utf8")) : undefined;
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function walk(root, dir = root) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...walk(root, full));
    } else if (entry.isFile() && /\.(md|yml|yaml|json|ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function parseDomainRequirementPattern(root) {
  const domainPath = "packages/domain/src/index.ts";
  const domain = read(root, domainPath);
  const match = domain.match(/PIGE_REQUIREMENT_ID_PATTERN\s*=\s*\/([^/]+)\/([a-z]*)/);
  if (!match) throw new Error(`Cannot derive PIGE_REQUIREMENT_ID_PATTERN from ${domainPath}.`);
  const exact = new RegExp(match[1], match[2].replace("g", ""));
  const source = match[1].replace(/^\^/, "").replace(/\$$/, "");
  return { exact, global: new RegExp(source, "g") };
}

function codePaths(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function add(errors, message) {
  errors.push(message);
}

function parseDefinitions(spec, requirementPattern) {
  const definitions = new Map();
  const parseErrors = [];
  for (const [index, line] of spec.split("\n").entries()) {
    if (!/^\| PIGE-/.test(line)) continue;
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.length !== 6) {
      add(parseErrors, `docs/SPEC_TRACEABILITY.md:${index + 1} must contain exactly 6 requirement-owner columns; found ${cells.length}.`);
      continue;
    }
    const [id, requirement, ownerCell, phase, milestone, verification] = cells;
    if (!requirementPattern.exact.test(id)) {
      add(parseErrors, `docs/SPEC_TRACEABILITY.md:${index + 1} has an ID that violates the domain pattern: ${id}.`);
      continue;
    }
    if (definitions.has(id)) {
      add(parseErrors, `Duplicate requirement definition: ${id}.`);
      continue;
    }
    const parts = id.split("-");
    definitions.set(id, {
      id,
      area: parts[1],
      requirement,
      ownerCell,
      owners: codePaths(ownerCell),
      phase,
      milestone,
      verification,
      line: index + 1
    });
  }
  return { definitions, parseErrors };
}

function parseAllowedAreas(spec) {
  const section = spec.match(/Allowed areas \(machine checked\):\n\n([\s\S]*?)\n\nAllowed verification classes/);
  return new Set([...(section?.[1] ?? "").matchAll(/^- `([A-Z][A-Z0-9]*)`$/gm)].map((match) => match[1]));
}

function parseMarkdownListItems(block) {
  const items = [];
  let current;
  const finish = () => {
    if (!current) return;
    items.push({
      firstLine: current[0],
      line: current.join("\n"),
      text: current.map((line, index) => index === 0 ? line : line.trim()).join(" ").replace(/\s+/gu, " ")
    });
    current = undefined;
  };
  for (const line of block.split("\n")) {
    if (line.startsWith("- ")) {
      finish();
      current = [line];
    } else if (current && /^\s{2,}\S/u.test(line)) {
      current.push(line);
    } else {
      finish();
    }
  }
  finish();
  return items;
}

function parsePhaseSections(playbook) {
  const sections = new Map();
  const headings = [...playbook.matchAll(/^## \d+\. Phase ([0-9]):.*$/gm)];
  for (const [index, heading] of headings.entries()) {
    const number = heading[1];
    const start = heading.index;
    const end = headings[index + 1]?.index ?? playbook.length;
    const text = playbook.slice(start, end);
    const buildBlock = text.match(/Build:\n\n([\s\S]*?)\n\nDeferred from this phase:/)?.[1] ?? "";
    const deferredBlock = text.match(/Deferred from this phase:\n\n([\s\S]*?)\n\nExit criteria:/)?.[1] ?? "";
    const exitBlock = text.match(/Exit criteria:\n\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
    const builds = new Map();
    const exits = new Map();
    const deferred = new Map();
    for (const item of parseMarkdownListItems(buildBlock)) {
      const match = item.text.match(/^- \[B([0-9])\.(\d{2}) -> E([0-9])\.(\d{2})\] (.+)$/);
      if (match) builds.set(`B${match[1]}.${match[2]}`, { id: `B${match[1]}.${match[2]}`, phase: `P${number}`, exit: `E${match[3]}.${match[4]}`, text: match[5], line: item.line });
      else builds.set(`INVALID-BUILD-${builds.size}`, { phase: `P${number}`, line: item.line });
    }
    for (const item of parseMarkdownListItems(exitBlock)) {
      const match = item.text.match(/^- \[E([0-9])\.(\d{2})\] (.+)$/);
      if (match) exits.set(`E${match[1]}.${match[2]}`, { id: `E${match[1]}.${match[2]}`, phase: `P${number}`, text: match[3], line: item.line });
      else exits.set(`INVALID-EXIT-${exits.size}`, { phase: `P${number}`, line: item.line });
    }
    for (const item of parseMarkdownListItems(deferredBlock)) {
      const match = item.text.match(/^- \[D([0-9])\.(\d{2})\] (.+)$/);
      if (match) deferred.set(`D${match[1]}.${match[2]}`, { id: `D${match[1]}.${match[2]}`, phase: `P${number}`, text: match[3], line: item.line });
      else deferred.set(`INVALID-DEFERRED-${deferred.size}`, { phase: `P${number}`, line: item.line });
    }
    sections.set(`P${number}`, { number, text, buildBlock, deferredBlock, exitBlock, builds, exits, deferred });
  }
  return sections;
}

function parsePhaseStateTable(playbook) {
  const states = new Map();
  for (const match of playbook.matchAll(/^\| (P[0-9]) \| (complete|in progress|planned) \|/gm)) {
    states.set(match[1], match[2].replace(" ", "_"));
  }
  return states;
}

function parsePhaseStateRows(playbook) {
  const rows = new Map();
  for (const match of playbook.matchAll(/^\| (P[0-9]) \| (complete|in progress|planned) \| ([^|]+) \|$/gm)) {
    rows.set(match[1], {
      state: match[2].replace(" ", "_"),
      interpretation: match[3].trim(),
      row: match[0]
    });
  }
  return rows;
}

function parseCrosswalk(milestones) {
  const pairs = new Set();
  const phases = new Map();
  for (const match of milestones.matchAll(/^\| (P[0-9]) \| (M[0-7](?:, M[0-7])*) \|/gm)) {
    const values = match[2].split(", ");
    phases.set(match[1], values);
    for (const milestone of values) pairs.add(`${match[1]}:${milestone}`);
  }
  return { pairs, phases };
}

function parseP0Items(prd, manifest) {
  const start = prd.indexOf(manifest.source.startHeading);
  const end = prd.indexOf(manifest.source.endHeading, start + 1);
  if (start < 0 || end < 0) return { categories: new Map(), error: "Cannot locate the PRD P0 source section." };
  const categories = new Map();
  let category;
  for (const line of prd.slice(start, end).split("\n")) {
    const categoryMatch = line.match(/^([A-Z][^:]+):$/);
    if (categoryMatch) {
      category = categoryMatch[1];
      if (!categories.has(category)) categories.set(category, []);
    } else if (line.startsWith("- ") && category) {
      categories.get(category).push(line.slice(2));
    }
  }
  return { categories };
}

function parseHistoricalPaths(startHere) {
  const paths = new Set(["docs/PI_PACKAGE_RESEARCH.md"]);
  for (const line of startHere.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    const document = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    const tier = cells[1];
    if (document && tier === "Historical/research") paths.add(document);
  }
  return paths;
}

function expandSemanticCapabilities(manifest) {
  const capabilities = new Map(Object.entries(manifest.capabilities ?? {}).map(([id, capability]) => [id, {
    requirement: capability.requirement,
    requirements: capability.requirement ? [capability.requirement] : [],
    builds: [...(capability.builds ?? [])],
    exits: [...(capability.exits ?? [])]
  }]));
  const byRequirement = new Map();
  const byBuild = new Map();
  const byExit = new Map();
  for (const [capabilityId, capability] of capabilities) {
    for (const requirementId of capability.requirements ?? []) {
      if (!byRequirement.has(requirementId)) byRequirement.set(requirementId, []);
      byRequirement.get(requirementId).push(capabilityId);
    }
    for (const buildId of capability.builds ?? []) {
      if (!byBuild.has(buildId)) byBuild.set(buildId, []);
      byBuild.get(buildId).push(capabilityId);
    }
    for (const exitId of capability.exits ?? []) {
      if (!byExit.has(exitId)) byExit.set(exitId, []);
      byExit.get(exitId).push(capabilityId);
    }
  }
  return { capabilities, byRequirement, byBuild, byExit };
}

function expandRequirementLinks(manifest, semanticCapabilities) {
  const links = new Map();
  for (const [id, acceptance] of Object.entries(manifest.requirements ?? {})) {
    const capabilityId = semanticCapabilities.byRequirement.get(id)?.[0];
    const capability = capabilityId ? semanticCapabilities.capabilities.get(capabilityId) : undefined;
    links.set(id, {
      requirements: [id],
      capabilityId,
      builds: [...(capability?.builds ?? [])],
      exits: [...(capability?.exits ?? [])],
      status: acceptance.status,
      ...(acceptance.evidence ? { evidence: [...acceptance.evidence] } : {}),
      ...(acceptance.open ? { open: structuredClone(acceptance.open) } : {}),
      ...(acceptance.plannedTarget ? { plannedTarget: acceptance.plannedTarget } : {})
    });
  }
  return { links, duplicates: [] };
}

function expandExitAcceptance(manifest) {
  const exits = new Map(Object.entries(manifest.exits ?? {}).map(([id, acceptance]) => [id, {
    exits: [id],
    status: acceptance.status,
    ...(acceptance.evidence ? { evidence: [...acceptance.evidence] } : {}),
    ...(acceptance.open ? { open: structuredClone(acceptance.open) } : {}),
    ...(acceptance.plannedTarget ? { plannedTarget: acceptance.plannedTarget } : {})
  }]));
  return { exits, duplicates: [] };
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameValues(left, right) {
  return JSON.stringify(sortedUnique(left ?? [])) === JSON.stringify(sortedUnique(right ?? []));
}

function exactObjectKeys(value, allowed, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add(errors, `${label} must be an object.`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) add(errors, `${label} contains unsupported field ${key}.`);
  }
}

function requireObjectFields(value, required, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of required) {
    if (!Object.hasOwn(value, key)) add(errors, `${label} is missing required field ${key}.`);
  }
}

function checkAcceptanceShape(model, errors) {
  const manifest = model.acceptance;
  if (manifest.schemaVersion !== 3) add(errors, "Acceptance manifest must use schemaVersion 3.");
  const topFields = new Set(["schemaVersion", "phaseStates", "capabilities", "requirements", "exits", "evidenceCatalog"]);
  exactObjectKeys(manifest, topFields, "Acceptance manifest", errors);
  requireObjectFields(manifest, topFields, "Acceptance manifest", errors);
  for (const field of ["phaseStates", "capabilities", "requirements", "exits", "evidenceCatalog"]) {
    if (!manifest[field] || typeof manifest[field] !== "object" || Array.isArray(manifest[field])) add(errors, `Acceptance manifest ${field} must be an object.`);
  }
  for (const [id, capability] of Object.entries(manifest.capabilities ?? {})) {
    const fields = new Set(["requirement", "builds", "exits"]);
    exactObjectKeys(capability, fields, `Capability ${id}`, errors);
    requireObjectFields(capability, fields, `Capability ${id}`, errors);
    if (typeof capability.requirement !== "string") add(errors, `Capability ${id} must name one requirement.`);
    if (!Array.isArray(capability.builds) || !Array.isArray(capability.exits)) add(errors, `Capability ${id} must declare Build and Exit arrays.`);
  }
  for (const [id, acceptance] of Object.entries(manifest.requirements ?? {})) {
    exactObjectKeys(acceptance, new Set(["status", "evidence", "open", "plannedTarget"]), `Requirement acceptance ${id}`, errors);
    requireObjectFields(acceptance, new Set(["status"]), `Requirement acceptance ${id}`, errors);
    if (acceptance.evidence !== undefined && !Array.isArray(acceptance.evidence)) add(errors, `Requirement acceptance ${id} evidence must be an array.`);
  }
  for (const [id, acceptance] of Object.entries(manifest.exits ?? {})) {
    exactObjectKeys(acceptance, new Set(["status", "evidence", "open", "plannedTarget"]), `Exit acceptance ${id}`, errors);
    requireObjectFields(acceptance, new Set(["status"]), `Exit acceptance ${id}`, errors);
    if (acceptance.evidence !== undefined && !Array.isArray(acceptance.evidence)) add(errors, `Exit acceptance ${id} evidence must be an array.`);
  }
  for (const [id, evidence] of Object.entries(manifest.evidenceCatalog ?? {})) {
    exactObjectKeys(evidence, new Set(["kind", "path", "selector", "recipe"]), `Evidence ${id}`, errors);
    requireObjectFields(evidence, new Set(["kind", "path", "selector"]), `Evidence ${id}`, errors);
  }
}

function normalizeClaimText(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function claimHash(value) {
  const canonical = typeof value === "string" ? normalizeClaimText(value) : JSON.stringify(value);
  return `sha256:${crypto.createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function compactClaimDigest(value) {
  const canonical = typeof value === "string" ? normalizeClaimText(value) : JSON.stringify(value);
  return `b64u:${crypto.createHash("sha256").update(canonical, "utf8").digest("base64url")}`;
}

function claimId(kind, id) {
  return `CLM-${kind}-${id.toUpperCase().replace(/[^A-Z0-9]+/gu, "-")}`;
}

function openClaim(open, ownerKind, ownerId) {
  if (!open || typeof open !== "object" || Array.isArray(open)) return null;
  return {
    claimId: claimId("OPEN", `${ownerKind}-${ownerId}`),
    id: open.id,
    descriptionHash: claimHash(open.description),
    targetBuildClaims: sortedUnique(open.targetBuilds ?? []).map((id) => claimId("BLD", id)),
    targetExitClaims: sortedUnique(open.targetExits ?? []).map((id) => claimId("EXT", id))
  };
}

function collectDelivery(model) {
  const builds = new Map();
  const exits = new Map();
  for (const section of model.phaseSections.values()) {
    for (const [id, build] of section.builds) if (!id.startsWith("INVALID")) builds.set(id, build);
    for (const [id, exit] of section.exits) if (!id.startsWith("INVALID")) exits.set(id, exit);
  }
  return { builds, exits };
}

function p0CoverageClaimRows(model) {
  const rows = new Map();
  for (const category of model.p0Coverage.categories ?? []) {
    const sourceItems = model.p0Items.categories.get(category.name) ?? [];
    for (const group of category.coverage ?? []) {
      const numbers = group.items ?? (group.range
        ? Array.from({ length: group.range[1] - group.range[0] + 1 }, (_, index) => group.range[0] + index)
        : []);
      for (const number of numbers) {
        const itemId = `P0-${category.key}-${String(number).padStart(3, "0")}`;
        rows.set(itemId, {
          claimId: claimId("P0", itemId),
          textHash: claimHash(sourceItems[number - 1] ?? ""),
          requirementClaims: sortedUnique(group.requirements ?? []).map((id) => claimId("REQ", id)),
          capabilityClaims: sortedUnique(group.capabilities ?? []).map((id) => claimId("CAP", id))
        });
      }
    }
  }
  return Object.fromEntries([...rows.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

const prdContractSections = [
  ["contract-authority", "## 0. Contract Authority And AI Use", "## 1. Summary"],
  ["product-definition", "## 1. Summary", "## 5. Product Optimization Order"],
  ["product-optimization-order", "## 5. Product Optimization Order", "## 6. Default User Model And Product Concepts"],
  ["default-user-model", "## 6. Default User Model And Product Concepts", "## 7. Core User Jobs And Observable State Contract"],
  ["observable-state-contract", "## 7. Core User Jobs And Observable State Contract", "## 8. v0.1 Public Alpha Scope"],
  ["scope-interpretation", "## 8. v0.1 Public Alpha Scope", "### 8.1 P0 Must Have"],
  ["p1-scope", "### 8.2 P1 Should Have", "### 8.3 P2 Later"],
  ["p2-scope", "### 8.3 P2 Later", "## 9. Explicit Non-Goals For v0.1"],
  ["non-goals", "## 9. Explicit Non-Goals For v0.1", "## 10. Input Handling Requirements"],
  ["input-and-agent-workflows", "## 10. Input Handling Requirements", "## 12. Markdown Page Requirements"],
  ["knowledge-output-contracts", "## 12. Markdown Page Requirements", "## 17. Skill Extension Requirements"],
  ["extensions-and-localization", "## 17. Skill Extension Requirements", "## 20. BYOK Model Requirements"],
  ["model-backup-and-trust", "## 20. BYOK Model Requirements", "## 23. Product Acceptance Scenarios"],
  ["acceptance-scenarios", "## 23. Product Acceptance Scenarios", "## 24. Risks"],
  ["risks", "## 24. Risks", "## 25. Resolved v0.1 Decisions"]
];

function prdContractClaimRows(model) {
  const rows = {};
  for (const [key, startMarker, endMarker] of prdContractSections) {
    const start = model.prd.indexOf(startMarker);
    const end = start < 0 ? -1 : model.prd.indexOf(endMarker, start + startMarker.length);
    const text = start < 0 || end < 0 ? "" : model.prd.slice(start, end);
    rows[key] = {
      claimId: claimId("PRD", key),
      textHash: claimHash(text)
    };
  }
  return rows;
}

function buildSemanticClaimPreimages(model) {
  const { builds, exits } = collectDelivery(model);
  const catalog = model.acceptance.evidenceCatalog ?? {};
  const capabilitySemantics = {};
  const capabilityDelivery = {};
  for (const [id, capability] of [...model.semanticCapabilities.capabilities].sort(([left], [right]) => left.localeCompare(right))) {
    capabilitySemantics[id] = {
      claimId: claimId("CAP", id),
      requirementClaims: sortedUnique(capability.requirements ?? []).map((value) => claimId("REQ", value))
    };
    capabilityDelivery[id] = {
      claimId: claimId("CAP-DELIVERY", id),
      buildClaims: sortedUnique(capability.builds ?? []).map((value) => claimId("BLD", value)),
      exitClaims: sortedUnique(capability.exits ?? []).map((value) => claimId("EXT", value))
    };
  }

  const requirements = {};
  const requirementAcceptance = {};
  for (const [id, definition] of [...model.definitions].sort(([left], [right]) => left.localeCompare(right))) {
    const link = model.requirementLinks.get(id);
    requirements[id] = {
      claimId: claimId("REQ", id),
      textHash: claimHash(definition.requirement),
      ownerPaths: sortedUnique(definition.owners),
      phase: definition.phase,
      milestone: definition.milestone,
      verification: definition.verification
    };
    requirementAcceptance[id] = {
      claimId: claimId("REQ-ACCEPT", id),
      status: definition.status,
      evidenceClaims: sortedUnique(link?.evidence ?? []).map((value) => claimId("EV", value)),
      openClaim: openClaim(link?.open, "REQ", id),
      plannedTargetHash: typeof link?.plannedTarget === "string" ? claimHash(link.plannedTarget) : null
    };
  }

  const buildClaims = {};
  for (const [id, build] of [...builds].sort(([left], [right]) => left.localeCompare(right))) {
    buildClaims[id] = {
      claimId: claimId("BLD", id),
      textHash: claimHash(build.text),
      phase: build.phase,
      exitClaim: claimId("EXT", build.exit)
    };
  }
  const exitClaims = {};
  const exitAcceptance = {};
  for (const [id, exit] of [...exits].sort(([left], [right]) => left.localeCompare(right))) {
    const acceptance = model.exitAcceptance.get(id);
    exitClaims[id] = {
      claimId: claimId("EXT", id),
      textHash: claimHash(exit.text),
      phase: exit.phase
    };
    exitAcceptance[id] = {
      claimId: claimId("EXT-ACCEPT", id),
      status: acceptance?.status ?? null,
      evidenceClaims: sortedUnique(acceptance?.evidence ?? []).map((value) => claimId("EV", value)),
      openClaim: openClaim(acceptance?.open, "EXIT", id),
      plannedTargetHash: typeof acceptance?.plannedTarget === "string" ? claimHash(acceptance.plannedTarget) : null
    };
  }

  const deferred = {};
  for (const [phase, section] of [...model.phaseSections].sort(([left], [right]) => left.localeCompare(right))) {
    const itemClaims = [];
    for (const [id, item] of [...section.deferred].filter(([id]) => !id.startsWith("INVALID")).sort(([left], [right]) => left.localeCompare(right))) {
      const itemClaimId = claimId("DFR", id);
      itemClaims.push(itemClaimId);
      deferred[id] = {
        claimId: itemClaimId,
        phase,
        textHash: claimHash(item.text)
      };
    }
    deferred[`BLOCK-${phase}`] = {
      claimId: claimId("DFR-BLOCK", phase),
      phase,
      blockHash: claimHash(section.deferredBlock),
      itemClaims
    };
  }

  const evidence = {};
  for (const [id, entry] of Object.entries(catalog).sort(([left], [right]) => left.localeCompare(right))) {
    evidence[id] = {
      claimId: claimId("EV", id),
      kind: entry.kind,
      path: entry.path,
      selectorHash: claimHash(entry.selector),
      recipe: entry.recipe ?? null,
      anchorHash: claimHash({ kind: entry.kind, path: entry.path, selector: entry.selector, recipe: entry.recipe ?? null })
    };
  }

  const phaseStates = {};
  for (let number = 0; number <= 9; number += 1) {
    const phase = `P${number}`;
    const row = model.playbookPhaseStateRows.get(phase);
    phaseStates[phase] = {
      claimId: claimId("PHASE-STATE", phase),
      acceptanceState: model.acceptance.phaseStates?.[phase] ?? null,
      playbookState: model.playbookPhaseStates.get(phase) ?? null,
      interpretationHash: claimHash(row?.interpretation ?? ""),
      rowHash: claimHash(row?.row ?? "")
    };
  }

  return {
    normalization: "NFKC + trim + collapse-whitespace; structured anchors use canonical JSON field order",
    claims: {
      prdContracts: prdContractClaimRows(model),
      capabilitySemantics,
      capabilityDelivery,
      requirements,
      builds: buildClaims,
      exits: exitClaims,
      deferred,
      p0Items: p0CoverageClaimRows(model),
      evidence,
      requirementAcceptance,
      exitAcceptance,
      phaseStates
    }
  };
}

function buildSemanticClaimLedger(model) {
  const preimages = buildSemanticClaimPreimages(model);
  const claims = {};
  const claimIds = new Set();
  let claimCount = 0;
  for (const [section, entries] of Object.entries(preimages.claims)) {
    claims[section] = {};
    for (const [key, value] of Object.entries(entries)) {
      if (claimIds.has(value.claimId)) throw new Error(`Duplicate canonical semantic claim ID ${value.claimId}.`);
      claimIds.add(value.claimId);
      claimCount += 1;
      claims[section][value.claimId] = compactClaimDigest({ section, key, value });
    }
  }
  return {
    schemaVersion: 3,
    normalization: preimages.normalization,
    algorithm: "sha256-base64url(canonical claim JSON)",
    claimCount,
    claims
  };
}

function checkLockedClaimSections(model, sections, errors) {
  const locked = model.semanticClaims;
  if (!locked || locked.schemaVersion !== 3 || !locked.claims) {
    add(errors, "Independent semantic-claims manifest is missing or invalid.");
    return;
  }
  const current = buildSemanticClaimLedger(model);
  if (locked.normalization !== current.normalization) add(errors, "Semantic-claim normalization contract drifted.");
  if (locked.algorithm !== current.algorithm) add(errors, "Semantic-claim digest algorithm drifted.");
  if (!sameValues(Object.keys(locked.claims), Object.keys(current.claims))) add(errors, "Semantic-claim sections contain missing or extra entries.");
  const lockedActualCount = Object.values(locked.claims).reduce((sum, entries) => sum + Object.keys(entries ?? {}).length, 0);
  if (lockedActualCount !== locked.claimCount) add(errors, `Semantic-claim declared count ${locked.claimCount} does not match ${lockedActualCount} stored digests.`);
  if (locked.claimCount !== current.claimCount) add(errors, `Semantic-claim count drifted: locked=${locked.claimCount}; current=${current.claimCount}.`);
  for (const section of sections) {
    const expected = locked.claims[section] ?? {};
    const actual = current.claims[section] ?? {};
    for (const claimId of sortedUnique([...Object.keys(expected), ...Object.keys(actual)])) {
      if (expected[claimId] !== actual[claimId]) {
        add(errors, `Independent ${section} claim drift: ${claimId}.`);
      }
    }
  }
}

function buildModel(root) {
  const requirementPattern = parseDomainRequirementPattern(root);
  const spec = read(root, "docs/SPEC_TRACEABILITY.md");
  const playbook = read(root, "docs/V0_1_IMPLEMENTATION_PLAYBOOK.md");
  const milestones = read(root, "docs/MILESTONES.md");
  const prd = read(root, "docs/PRD.md");
  const startHere = read(root, "docs/START_HERE_FOR_AI_AGENTS.md");
  const acceptance = readJson(root, "resources/traceability/acceptance.manifest.json");
  const p0Coverage = readJson(root, "resources/traceability/p0-coverage.manifest.json");
  const semanticClaims = readJsonIfPresent(root, "resources/traceability/semantic-claims.manifest.json");
  const parsedDefinitions = parseDefinitions(spec, requirementPattern);
  const semanticCapabilities = expandSemanticCapabilities(acceptance);
  const requirementLinks = expandRequirementLinks(acceptance, semanticCapabilities);
  const exitAcceptance = expandExitAcceptance(acceptance);
  for (const [id, definition] of parsedDefinitions.definitions) {
    definition.status = requirementLinks.links.get(id)?.status;
  }
  return {
    root,
    requirementPattern,
    spec,
    playbook,
    milestones,
    prd,
    startHere,
    acceptance,
    p0Coverage,
    semanticClaims,
    definitions: parsedDefinitions.definitions,
    definitionParseErrors: parsedDefinitions.parseErrors,
    allowedAreas: parseAllowedAreas(spec),
    phaseSections: parsePhaseSections(playbook),
    playbookPhaseStates: parsePhaseStateTable(playbook),
    playbookPhaseStateRows: parsePhaseStateRows(playbook),
    crosswalk: parseCrosswalk(milestones),
    p0Items: parseP0Items(prd, p0Coverage),
    historicalPaths: parseHistoricalPaths(startHere),
    requirementLinks: requirementLinks.links,
    duplicateRequirementLinks: requirementLinks.duplicates,
    exitAcceptance: exitAcceptance.exits,
    duplicateExitAcceptance: exitAcceptance.duplicates,
    semanticCapabilities
  };
}

function isHistorical(model, relativePath) {
  if (relativePath.startsWith("docs/prototypes/")) return true;
  return model.historicalPaths.has(relativePath);
}

function enumValuesFromSchema(source, ownerStart, fieldPattern, label, errors) {
  const ownerIndex = source.indexOf(ownerStart);
  if (ownerIndex < 0) {
    add(errors, `Executable vocabulary owner is missing: ${ownerStart}.`);
    return [];
  }
  const body = source.slice(ownerIndex).match(fieldPattern)?.[1];
  if (!body) {
    add(errors, `Cannot parse executable vocabulary for ${label}.`);
    return [];
  }
  return [...body.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
}

function exactVocabulary(label, executableValues, documentedValues, errors) {
  const executable = sortedUnique(executableValues);
  const documented = sortedUnique(documentedValues);
  if (!sameValues(executable, documented)) {
    add(errors, `${label} executable/documented vocabulary mismatch: executable=${executable.join(", ")}; documented=${documented.join(", ")}.`);
  }
}

function checkDurableVocabularyParity(model, errors) {
  const schemas = read(model.root, "packages/schemas/src/index.ts");
  const jobOwner = read(model.root, "docs/JOB_OPERATION_AND_RECOVERY.md");
  const dataOwner = read(model.root, "docs/DATA_ARCHITECTURE.md");

  const conversationValues = enumValuesFromSchema(
    schemas,
    "export const ConversationEventSchema",
    /type:\s*z\.enum\(\[([\s\S]*?)\]\),/,
    "ConversationEventSchema.type",
    errors
  );
  const operationValues = enumValuesFromSchema(
    schemas,
    "export const OperationRecordSchema",
    /kind:\s*z\.enum\(\[([\s\S]*?)\]\),/,
    "OperationRecordSchema.kind",
    errors
  );

  const dataEventBlock = dataOwner.match(/Event types:\n\n([\s\S]*?)\n\nRules:/)?.[1] ?? "";
  const operationBlock = jobOwner.match(/Executable operation-kind vocabulary \(machine checked\):\n\n([\s\S]*?)\n\nLifecycle coverage:/)?.[1] ?? "";
  exactVocabulary("Conversation events in DATA_ARCHITECTURE", conversationValues, [...dataEventBlock.matchAll(/`([a-z0-9_]+)`/g)].map((match) => match[1]), errors);
  exactVocabulary("Operation kinds in JOB_OPERATION_AND_RECOVERY", operationValues, [...operationBlock.matchAll(/`([a-z0-9_]+)`/g)].map((match) => match[1]), errors);
}

function checkTrc001(model) {
  const errors = [...model.definitionParseErrors];
  if (model.allowedAreas.size === 0) add(errors, "Requirement area allowlist is empty or unparseable.");
  for (const definition of model.definitions.values()) {
    if (!model.allowedAreas.has(definition.area)) add(errors, `${definition.id} uses unlisted area ${definition.area}.`);
    if (!definition.requirement) add(errors, `${definition.id} has an empty requirement statement.`);
    if (!/^P[0-9]$/.test(definition.phase)) add(errors, `${definition.id} has invalid phase ${definition.phase}.`);
    if (!/^M[0-7]$/.test(definition.milestone)) add(errors, `${definition.id} has invalid milestone ${definition.milestone}.`);
    if (!verificationClasses.has(definition.verification)) add(errors, `${definition.id} has invalid verification class ${definition.verification}.`);
    if (!requirementStatuses.has(definition.status)) add(errors, `${definition.id} has invalid status ${definition.status}.`);
    if (definition.owners.length === 0) add(errors, `${definition.id} has no owner path.`);
    for (const owner of definition.owners) {
      if (!fs.existsSync(path.join(model.root, owner))) add(errors, `${definition.id} owner does not exist: ${owner}.`);
      if (isHistorical(model, owner)) add(errors, `${definition.id} cannot be owned by historical material: ${owner}.`);
    }
  }
  for (const area of model.allowedAreas) {
    if (![...model.definitions.values()].some((definition) => definition.area === area)) add(errors, `Allowed area ${area} has no requirement definition.`);
  }

  const refs = new Map();
  for (const file of walk(model.root)) {
    const fileRelative = relative(model.root, file);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(model.requirementPattern.global)) {
      const id = match[0];
      if (!refs.has(id)) refs.set(id, new Set());
      refs.get(id).add(fileRelative);
    }
  }
  const undefinedRefs = [...refs.keys()].filter((id) => !model.definitions.has(id)).sort();
  if (undefinedRefs.length) add(errors, `Undefined requirement refs: ${undefinedRefs.join(", ")}.`);
  for (const id of model.definitions.keys()) {
    const external = [...(refs.get(id) ?? [])].filter((file) => file !== "docs/SPEC_TRACEABILITY.md" && !isHistorical(model, file));
    if (external.length === 0) add(errors, `${id} is referenced only by its definition or historical material.`);
  }
  checkDurableVocabularyParity(model, errors);
  return errors;
}

function checkTrc002(model) {
  const errors = [];
  checkAcceptanceShape(model, errors);
  if (model.p0Coverage.schemaVersion !== 1) add(errors, "P0 coverage manifest must use schemaVersion 1.");
  if (model.p0Items.error) add(errors, model.p0Items.error);
  const capabilityIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
  for (const [capabilityId, capability] of model.semanticCapabilities.capabilities) {
    if (!capabilityIdPattern.test(capabilityId)) add(errors, `Semantic capability has invalid ID ${capabilityId}.`);
    if (!Array.isArray(capability.requirements) || capability.requirements.length !== 1) add(errors, `${capabilityId} must own exactly one stable requirement.`);
    if (!Array.isArray(capability.builds) || capability.builds.length === 0) add(errors, `${capabilityId} has no controlled Build assignment.`);
    if (!Array.isArray(capability.exits) || capability.exits.length === 0) add(errors, `${capabilityId} has no controlled Exit assignment.`);
    for (const id of capability.requirements ?? []) if (!model.definitions.has(id)) add(errors, `${capabilityId} references undefined requirement ${id}.`);
    for (const [field, values] of [["requirements", capability.requirements], ["builds", capability.builds], ["exits", capability.exits]]) {
      if ((values?.length ?? 0) !== new Set(values ?? []).size) add(errors, `${capabilityId} contains duplicate ${field}.`);
    }
  }
  for (const id of model.definitions.keys()) {
    const capabilities = model.semanticCapabilities.byRequirement.get(id) ?? [];
    if (capabilities.length !== 1) add(errors, `${id} must own exactly one controlled semantic capability; found ${capabilities.join(", ") || "none"}.`);
  }
  for (const id of model.semanticCapabilities.byRequirement.keys()) if (!model.definitions.has(id)) add(errors, `Semantic capability maps undefined requirement ${id}.`);
  const manifestCategoryNames = new Set();
  for (const category of model.p0Coverage.categories ?? []) {
    if (manifestCategoryNames.has(category.name)) add(errors, `Duplicate P0 coverage category: ${category.name}.`);
    manifestCategoryNames.add(category.name);
    const sourceItems = model.p0Items.categories.get(category.name) ?? [];
    if (sourceItems.length !== category.expectedItems) {
      add(errors, `P0 category ${category.name} expected ${category.expectedItems} items but PRD contains ${sourceItems.length}.`);
    }
    const coverageCounts = new Map();
    for (const group of category.coverage ?? []) {
      const numbers = group.items ?? (group.range ? Array.from({ length: group.range[1] - group.range[0] + 1 }, (_, index) => group.range[0] + index) : []);
      if (!Array.isArray(group.requirements) || group.requirements.length === 0) add(errors, `P0 ${category.name} coverage group has no requirements.`);
      for (const id of group.requirements ?? []) if (!model.definitions.has(id)) add(errors, `P0 ${category.name} references undefined requirement ${id}.`);
      if (!Array.isArray(group.capabilities) || group.capabilities.length === 0) add(errors, `P0 ${category.name} coverage group has no controlled semantic capabilities.`);
      for (const capabilityId of group.capabilities ?? []) if (!model.semanticCapabilities.capabilities.has(capabilityId)) add(errors, `P0 ${category.name} references undefined semantic capability ${capabilityId}.`);
      const expectedCapabilities = sortedUnique((group.requirements ?? []).flatMap((id) => model.semanticCapabilities.byRequirement.get(id) ?? []));
      if (!sameValues(group.capabilities, expectedCapabilities)) {
        add(errors, `P0 ${category.name} semantic mapping disagrees with its requirements: declared=${sortedUnique(group.capabilities ?? []).join(", ") || "none"}; expected=${expectedCapabilities.join(", ") || "none"}.`);
      }
      for (const number of numbers) coverageCounts.set(number, (coverageCounts.get(number) ?? 0) + 1);
    }
    for (let number = 1; number <= sourceItems.length; number += 1) {
      const count = coverageCounts.get(number) ?? 0;
      const itemId = `P0-${category.key}-${String(number).padStart(3, "0")}`;
      if (count !== 1) add(errors, `${itemId} must have exactly one coverage group; found ${count}.`);
    }
    for (const number of coverageCounts.keys()) if (number < 1 || number > sourceItems.length) add(errors, `P0 ${category.name} coverage references nonexistent item ${number}.`);
  }
  for (const sourceCategory of model.p0Items.categories.keys()) {
    if (!manifestCategoryNames.has(sourceCategory)) add(errors, `PRD P0 category is absent from coverage manifest: ${sourceCategory}.`);
  }
  if (model.duplicateRequirementLinks.length) add(errors, `Duplicate acceptance links: ${model.duplicateRequirementLinks.join(", ")}.`);
  for (const id of model.definitions.keys()) if (!model.requirementLinks.has(id)) add(errors, `${id} has no Requirement-to-Build-to-Exit acceptance link.`);
  for (const id of model.requirementLinks.keys()) if (!model.definitions.has(id)) add(errors, `Acceptance manifest maps undefined requirement ${id}.`);
  checkLockedClaimSections(model, ["prdContracts", "capabilitySemantics", "requirements", "p0Items"], errors);
  return errors;
}

function checkTrc003(model) {
  const errors = [];
  const allBuilds = new Map();
  const allExits = new Map();
  const allDeferred = new Map();
  if (/^Requirement gates:$/mu.test(model.playbook)) add(errors, "Playbook must derive Requirement gates from the Spec/acceptance mapping instead of maintaining a duplicate list.");
  for (let number = 0; number <= 9; number += 1) {
    const phase = `P${number}`;
    const section = model.phaseSections.get(phase);
    if (!section) {
      add(errors, `Playbook is missing ${phase}.`);
      continue;
    }
    if (!section.buildBlock || !section.deferredBlock || !section.exitBlock) add(errors, `${phase} must contain Build, Deferred, and Exit blocks.`);
    const deferredLines = section.deferredBlock.split("\n").filter((line) => line.trim().length > 0);
    if (section.deferred.size === 0 || section.deferred.size !== deferredLines.length) {
      add(errors, `${phase} Deferred block must contain only controlled D${number}.nn entries.`);
    }
    for (const [id, build] of section.builds) {
      if (id.startsWith("INVALID")) add(errors, `${phase} has malformed Build line: ${build.line}`);
      else {
        if (allBuilds.has(id)) add(errors, `Duplicate Build ID ${id}.`);
        allBuilds.set(id, build);
        if (build.phase !== phase || !build.exit.startsWith(`E${number}.`)) add(errors, `${id} crosses its phase boundary.`);
      }
    }
    for (const [id, exit] of section.exits) {
      if (id.startsWith("INVALID")) add(errors, `${phase} has malformed Exit line: ${exit.line}`);
      else {
        if (allExits.has(id)) add(errors, `Duplicate Exit ID ${id}.`);
        allExits.set(id, exit);
        if (exit.phase !== phase || !id.startsWith(`E${number}.`)) add(errors, `${id} crosses its phase boundary.`);
      }
    }
    for (const [id, deferred] of section.deferred) {
      if (id.startsWith("INVALID")) add(errors, `${phase} has malformed Deferred line: ${deferred.line}`);
      else {
        if (allDeferred.has(id)) add(errors, `Duplicate Deferred ID ${id}.`);
        allDeferred.set(id, deferred);
        if (deferred.phase !== phase || !id.startsWith(`D${number}.`)) add(errors, `${id} crosses its deferred phase boundary.`);
        if (typeof deferred.text !== "string" || deferred.text.trim().length < 12) add(errors, `${id} has a missing or vague deferral description.`);
      }
    }
    for (const build of section.builds.values()) if (build.id && !section.exits.has(build.exit)) add(errors, `${build.id} targets missing Exit ${build.exit}.`);
  }

  const usedBuilds = new Set();
  const usedExits = new Set();
  for (const [id, definition] of model.definitions) {
    const link = model.requirementLinks.get(id);
    if (!link) continue;
    const capabilityIds = model.semanticCapabilities.byRequirement.get(id) ?? [];
    const controlledBuilds = sortedUnique(capabilityIds.flatMap((capabilityId) => model.semanticCapabilities.capabilities.get(capabilityId)?.builds ?? []));
    const controlledExits = sortedUnique(capabilityIds.flatMap((capabilityId) => model.semanticCapabilities.capabilities.get(capabilityId)?.exits ?? []));
    if (!sameValues(link.builds, controlledBuilds)) {
      add(errors, `${id} Build mapping violates controlled semantic capabilities: mapped=${sortedUnique(link.builds ?? []).join(", ") || "none"}; controlled=${controlledBuilds.join(", ") || "none"}.`);
    }
    if (!sameValues(link.exits, controlledExits)) {
      add(errors, `${id} Exit mapping violates controlled semantic capabilities: mapped=${sortedUnique(link.exits ?? []).join(", ") || "none"}; controlled=${controlledExits.join(", ") || "none"}.`);
    }
    const linkExits = new Set(link.exits ?? []);
    if (!Array.isArray(link.builds) || link.builds.length === 0) add(errors, `${id} has no mapped Build.`);
    if (!Array.isArray(link.exits) || link.exits.length === 0) add(errors, `${id} has no mapped Exit.`);
    for (const buildId of link.builds ?? []) {
      const build = allBuilds.get(buildId);
      if (!build) add(errors, `${id} maps missing Build ${buildId}.`);
      else {
        usedBuilds.add(buildId);
        if (build.phase !== definition.phase) add(errors, `${id} maps cross-phase Build ${buildId}.`);
        if (!linkExits.has(build.exit)) add(errors, `${id} maps ${buildId} but omits that Build's declared Exit ${build.exit}.`);
      }
    }
    for (const exitId of link.exits ?? []) {
      const exit = allExits.get(exitId);
      if (!exit) add(errors, `${id} maps missing Exit ${exitId}.`);
      else {
        usedExits.add(exitId);
        if (exit.phase !== definition.phase) add(errors, `${id} maps cross-phase Exit ${exitId}.`);
      }
    }
  }
  for (const [capabilityId, capability] of model.semanticCapabilities.capabilities) {
    const requirementPhases = sortedUnique((capability.requirements ?? []).map((id) => model.definitions.get(id)?.phase).filter(Boolean));
    if (requirementPhases.length !== 1) add(errors, `${capabilityId} must resolve to exactly one requirement phase; found ${requirementPhases.join(", ") || "none"}.`);
    const controlledExitIds = new Set(capability.exits ?? []);
    for (const buildId of capability.builds ?? []) {
      const build = allBuilds.get(buildId);
      if (!build) add(errors, `${capabilityId} controls missing Build ${buildId}.`);
      else {
        if (!requirementPhases.includes(build.phase)) add(errors, `${capabilityId} crosses requirement phase with ${buildId}.`);
        if (!controlledExitIds.has(build.exit)) add(errors, `${capabilityId} controls ${buildId} but omits its declared Exit ${build.exit}.`);
      }
    }
    for (const exitId of capability.exits ?? []) {
      const exit = allExits.get(exitId);
      if (!exit) add(errors, `${capabilityId} controls missing Exit ${exitId}.`);
      else if (!requirementPhases.includes(exit.phase)) add(errors, `${capabilityId} crosses requirement phase with ${exitId}.`);
    }
  }
  for (const id of allBuilds.keys()) if (!usedBuilds.has(id)) add(errors, `${id} has no requirement mapping.`);
  for (const id of allExits.keys()) if (!usedExits.has(id)) add(errors, `${id} has no requirement mapping.`);
  for (const id of allBuilds.keys()) if (!(model.semanticCapabilities.byBuild.get(id)?.length > 0)) add(errors, `${id} has no controlled semantic capability.`);
  for (const id of allExits.keys()) if (!(model.semanticCapabilities.byExit.get(id)?.length > 0)) add(errors, `${id} has no controlled semantic capability.`);
  checkLockedClaimSections(model, ["capabilityDelivery", "builds", "exits", "deferred"], errors);
  return errors;
}

function checkTrc004(model) {
  const errors = [];
  if (/^Requirement gates:$/mu.test(model.milestones)) add(errors, "Milestones must derive Requirement gates from the Spec mapping instead of maintaining a duplicate list.");
  for (let number = 0; number <= 9; number += 1) {
    const phase = `P${number}`;
    if (!model.crosswalk.phases.has(phase)) add(errors, `Canonical Milestones crosswalk is missing ${phase}.`);
  }
  for (const [id, definition] of model.definitions) {
    if (!model.crosswalk.pairs.has(`${definition.phase}:${definition.milestone}`)) add(errors, `${id} maps to absent crosswalk pair ${definition.phase}/${definition.milestone}.`);
  }
  const numberedPhaseHeading = /^#{2,4} .*\bPhase [0-9](?::|\b)/gm;
  for (const file of walk(model.root)) {
    const fileRelative = relative(model.root, file);
    if (!fileRelative.endsWith(".md") || fileRelative === "docs/V0_1_IMPLEMENTATION_PLAYBOOK.md" || isHistorical(model, fileRelative)) continue;
    const matches = [...fs.readFileSync(file, "utf8").matchAll(numberedPhaseHeading)];
    if (matches.length) add(errors, `${fileRelative} defines numbered Phase headings outside the canonical Playbook.`);
  }
  return errors;
}

function validateEvidenceEntry(model, evidenceId, evidence, errors) {
  if (!evidence || typeof evidence !== "object") {
    add(errors, `Missing evidence catalog entry ${evidenceId}.`);
    return;
  }
  if (!evidenceKinds.has(evidence.kind)) add(errors, `${evidenceId} has invalid kind ${evidence.kind}.`);
  if (typeof evidence.path !== "string" || evidence.path.length === 0) {
    add(errors, `${evidenceId} has no path.`);
    return;
  }
  const isGenerated = evidence.kind === "generated-report" || evidence.kind === "manual-report";
  if (evidence.kind === "test" && !/^tests\/(?:unit|integration|smoke|evals?|release)\/.+\.test\.[cm]?[jt]sx?$/u.test(evidence.path)) {
    add(errors, `${evidenceId} test evidence must use a controlled executable test path, not ${evidence.path}.`);
  }
  if (evidence.kind === "verifier" && !/^scripts\/verify\/[a-z0-9-]+\.mjs$/u.test(evidence.path)) {
    add(errors, `${evidenceId} verifier evidence must use a controlled scripts/verify/*.mjs path, not ${evidence.path}.`);
  }
  if (evidence.path.startsWith("artifacts/")) {
    if (!isGenerated) add(errors, `${evidenceId} uses artifacts/ but is not a generated/manual report.`);
    if (!evidence.recipe || !fs.existsSync(path.join(model.root, evidence.recipe))) add(errors, `${evidenceId} generated/manual report needs an existing recipe path.`);
  } else if (isGenerated) {
    add(errors, `${evidenceId} generated/manual report must live under artifacts/.`);
  }
  if (!evidence.path.startsWith("artifacts/") && isHistorical(model, evidence.path)) add(errors, `${evidenceId} uses historical evidence ${evidence.path}.`);
  const absolute = path.join(model.root, evidence.path);
  if (!fs.existsSync(absolute)) {
    add(errors, `${evidenceId} path does not exist: ${evidence.path}.`);
    return;
  }
  if (typeof evidence.selector !== "string" || evidence.selector.length < 4) {
    add(errors, `${evidenceId} must name a specific selector.`);
    return;
  }
  const text = fs.readFileSync(absolute, "utf8");
  if (!text.includes(evidence.selector)) add(errors, `${evidenceId} selector is absent from ${evidence.path}: ${evidence.selector}`);
  if (isGenerated) {
    try {
      const report = JSON.parse(text);
      const recipeText = fs.readFileSync(path.join(model.root, evidence.recipe));
      const recipeSha256 = crypto.createHash("sha256").update(recipeText).digest("hex");
      if (report.schemaVersion !== 1) add(errors, `${evidenceId} generated/manual report must use schemaVersion 1.`);
      if (report.status !== "passed") add(errors, `${evidenceId} generated/manual report status is not passed.`);
      if (report.recipe !== evidence.recipe) add(errors, `${evidenceId} generated/manual report recipe path does not match its catalog entry.`);
      if (report.recipeSha256 !== recipeSha256) add(errors, `${evidenceId} generated/manual report recipe hash is stale or invalid.`);
      if (!Number.isFinite(Date.parse(report.generatedAt ?? ""))) add(errors, `${evidenceId} generated/manual report has no valid generatedAt timestamp.`);
    } catch (error) {
      add(errors, `${evidenceId} generated/manual report is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
}

function executeVerifiedEvidence(model, evidenceIds, errors) {
  const catalog = model.acceptance.evidenceCatalog ?? {};
  const testPaths = sortedUnique([...evidenceIds]
    .map((id) => catalog[id])
    .filter((entry) => entry?.kind === "test" && /^tests\/.+\.test\.[cm]?[jt]sx?$/u.test(entry.path))
    .map((entry) => entry.path));
  if (testPaths.length > 0) {
    const cacheKey = JSON.stringify([model.root, "vitest", ...testPaths]);
    let run = executableEvidenceCache.get(cacheKey);
    if (!run) {
      run = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", ...testPaths], {
        cwd: model.root,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024
      });
      executableEvidenceCache.set(cacheKey, run);
    }
    if (run.status !== 0) {
      add(errors, `Verified test evidence failed executable proof: ${(run.stderr || run.stdout || "no output").trim()}.`);
    }
  }

  const verifierPaths = sortedUnique([...evidenceIds]
    .map((id) => catalog[id])
    .filter((entry) => entry?.kind === "verifier" && /^scripts\/verify\/[a-z0-9-]+\.mjs$/u.test(entry.path))
    .map((entry) => entry.path));
  for (const verifierPath of verifierPaths) {
    const args = verifierPath === "scripts/verify/traceability.mjs" ? ["--check", "TRC-001"] : [];
    const cacheKey = JSON.stringify([model.root, process.execPath, verifierPath, ...args]);
    let run = executableEvidenceCache.get(cacheKey);
    if (!run) {
      run = spawnSync(process.execPath, [path.join(model.root, verifierPath), ...args], {
        cwd: model.root,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024
      });
      executableEvidenceCache.set(cacheKey, run);
    }
    if (run.status !== 0) {
      add(errors, `Verified verifier evidence failed executable proof at ${verifierPath}: ${(run.stderr || run.stdout || "no output").trim()}.`);
    }
  }
}

function validateOpenGap(open, expectedId, allowedBuilds, allowedExits, label, errors) {
  if (!open || typeof open !== "object" || Array.isArray(open)) {
    add(errors, `${label} has no structured machine-readable open acceptance gap.`);
    return;
  }
  if (open.id !== expectedId) add(errors, `${label} open gap must use stable ID ${expectedId}.`);
  if (typeof open.description !== "string" || normalizeClaimText(open.description).length < 20) {
    add(errors, `${label} open gap description is missing or vague.`);
  }
  for (const [field, values, allowed] of [
    ["targetBuilds", open.targetBuilds, new Set(allowedBuilds)],
    ["targetExits", open.targetExits, new Set(allowedExits)]
  ]) {
    if (!Array.isArray(values) || values.length === 0) {
      add(errors, `${label} open gap has no ${field} delivery destination.`);
      continue;
    }
    if (new Set(values).size !== values.length) add(errors, `${label} open gap contains duplicate ${field}.`);
    for (const id of values) if (!allowed.has(id)) add(errors, `${label} open gap targets uncontrolled ${field} ${id}.`);
  }
}

function strongEvidenceFor(definition, entries) {
  const kinds = new Set(entries.map((entry) => entry?.kind));
  if (definition.verification === "release") return kinds.has("generated-report");
  if (definition.verification === "manual") return kinds.has("manual-report");
  if (definition.verification === "contract") return ["verifier", "test", "implementation", "contract"].some((kind) => kinds.has(kind));
  return ["test", "verifier", "generated-report"].some((kind) => kinds.has(kind));
}

function checkTrc005(model) {
  const errors = [];
  checkAcceptanceShape(model, errors);
  const catalog = model.acceptance.evidenceCatalog ?? {};
  const evidenceUse = new Set();
  const verifiedExecutableEvidence = new Set();
  const { builds: allBuilds, exits: allExits } = collectDelivery(model);
  for (const [evidenceId, evidence] of Object.entries(catalog)) validateEvidenceEntry(model, evidenceId, evidence, errors);

  for (const [id, definition] of model.definitions) {
    const link = model.requirementLinks.get(id);
    if (!link) continue;
    const evidenceIds = link.evidence ?? [];
    if (definition.status === "partial") validateOpenGap(link.open, `OPEN-REQ-${id}`, link.builds ?? [], link.exits ?? [], id, errors);
    if (definition.status !== "partial" && link.open !== undefined) add(errors, `${id} is ${definition.status} but still declares a partial open gap.`);
    if (definition.status === "planned") {
      if (evidenceIds.length) add(errors, `${id} is planned but claims current evidence.`);
      if (typeof link.plannedTarget !== "string" || link.plannedTarget.length < 12) add(errors, `${id} planned acceptance target is missing or vague.`);
    } else {
      if (evidenceIds.length === 0) add(errors, `${id} is ${definition.status} but has no exact evidence selector.`);
      const entries = evidenceIds.map((evidenceId) => {
        evidenceUse.add(evidenceId);
        if (!catalog[evidenceId]) add(errors, `${id} references undefined evidence ${evidenceId}.`);
        return catalog[evidenceId];
      });
      if (definition.status === "verified" && !strongEvidenceFor(definition, entries)) add(errors, `${id} is verified without evidence appropriate for ${definition.verification}.`);
      if (definition.status === "verified") {
        for (const evidenceId of evidenceIds) if (["test", "verifier"].includes(catalog[evidenceId]?.kind)) verifiedExecutableEvidence.add(evidenceId);
      }
    }
    if (id === "PIGE-DOC-005" && definition.status === "verified") {
      const entries = evidenceIds.map((evidenceId) => catalog[evidenceId]).filter(Boolean);
      if (!entries.some((entry) => entry.kind === "manual-report")) add(errors, "PIGE-DOC-005 cannot be verified without an independent manual-review report.");
    }
  }

  if (model.duplicateExitAcceptance.length) add(errors, `Duplicate Exit acceptance entries: ${model.duplicateExitAcceptance.join(", ")}.`);
  for (const [id, exit] of allExits) {
    const acceptance = model.exitAcceptance.get(id);
    if (!acceptance) {
      add(errors, `${id} has no controlled acceptance status.`);
      continue;
    }
    if (!exitStatuses.has(acceptance.status)) add(errors, `${id} has invalid status ${acceptance.status}.`);
    if (acceptance.status === "planned") {
      if (acceptance.evidence?.length) add(errors, `${id} is planned but claims current evidence.`);
      if (acceptance.open !== undefined) add(errors, `${id} is planned but declares a partial open gap instead of a planned target.`);
      if (typeof acceptance.plannedTarget !== "string" || acceptance.plannedTarget.length < 12) add(errors, `${id} planned target is missing or vague.`);
    } else {
      const evidenceIds = acceptance.evidence ?? [];
      if (evidenceIds.length === 0) add(errors, `${id} is ${acceptance.status} but has no evidence selector.`);
      const entries = evidenceIds.map((evidenceId) => {
        evidenceUse.add(evidenceId);
        if (!catalog[evidenceId]) add(errors, `${id} references undefined evidence ${evidenceId}.`);
        return catalog[evidenceId];
      }).filter(Boolean);
      if (acceptance.status === "verified" && !entries.some((entry) => ["test", "verifier", "generated-report"].includes(entry.kind))) add(errors, `${id} is verified without test, verifier, or generated-report evidence.`);
      if (acceptance.status === "partial") {
        const deliveryBuilds = [...allBuilds.values()].filter((build) => build.exit === id).map((build) => build.id);
        validateOpenGap(acceptance.open, `OPEN-EXIT-${id}`, deliveryBuilds, [id], id, errors);
      } else if (acceptance.open !== undefined) {
        add(errors, `${id} is verified but still declares a partial open gap.`);
      }
      if (acceptance.status === "verified") {
        for (const evidenceId of evidenceIds) if (["test", "verifier"].includes(catalog[evidenceId]?.kind)) verifiedExecutableEvidence.add(evidenceId);
      }
    }
    if (exit.phase !== `P${id[1]}`) add(errors, `${id} parsed phase mismatch.`);
  }
  for (const id of model.exitAcceptance.keys()) if (!allExits.has(id)) add(errors, `Acceptance manifest references undefined Exit ${id}.`);
  for (const evidenceId of Object.keys(catalog)) if (!evidenceUse.has(evidenceId)) add(errors, `Unused evidence catalog entry ${evidenceId}.`);
  checkLockedClaimSections(model, ["evidence", "requirementAcceptance", "exitAcceptance", "phaseStates"], errors);
  executeVerifiedEvidence(model, verifiedExecutableEvidence, errors);

  for (let number = 0; number <= 9; number += 1) {
    const phase = `P${number}`;
    const manifestState = model.acceptance.phaseStates?.[phase];
    const playbookState = model.playbookPhaseStates.get(phase);
    if (!phaseStates.has(manifestState)) add(errors, `${phase} has invalid or missing manifest state ${manifestState}.`);
    if (manifestState !== playbookState) add(errors, `${phase} state disagrees: manifest=${manifestState}, Playbook=${playbookState}.`);
    if (manifestState === "complete") {
      const incompleteRequirements = [...model.definitions.values()].filter((definition) => definition.phase === phase && definition.status !== "verified").map((definition) => definition.id);
      const incompleteExits = [...allExits.keys()].filter((id) => id.startsWith(`E${number}.`) && model.exitAcceptance.get(id)?.status !== "verified");
      if (incompleteRequirements.length) add(errors, `${phase} cannot be complete with non-verified requirements: ${incompleteRequirements.join(", ")}.`);
      if (incompleteExits.length) add(errors, `${phase} cannot be complete with non-verified Exits: ${incompleteExits.join(", ")}.`);
    }
  }
  return errors;
}

const checkFunctions = {
  "TRC-001": checkTrc001,
  "TRC-002": checkTrc002,
  "TRC-003": checkTrc003,
  "TRC-004": checkTrc004,
  "TRC-005": checkTrc005
};

export function createSemanticClaimLedger(root) {
  return buildSemanticClaimLedger(buildModel(root));
}

export function createSemanticClaimLedgerFromModel(model) {
  return buildSemanticClaimLedger(model);
}

export function runTraceability(root, selectedChecks = CHECK_IDS, mutate) {
  const model = buildModel(root);
  if (mutate) mutate(model);
  const results = new Map();
  for (const id of selectedChecks) {
    const check = checkFunctions[id];
    if (!check) throw new Error(`Unknown traceability check ${id}.`);
    results.set(id, check(model));
  }
  return { model, results };
}

function printResults(result) {
  let failed = false;
  for (const [id, errors] of result.results) {
    if (errors.length === 0) console.log(`${id} OK`);
    else {
      failed = true;
      for (const error of errors) console.error(`${id} error: ${error}`);
    }
  }
  if (failed) return false;
  const statusCounts = { verified: 0, partial: 0, planned: 0 };
  for (const definition of result.model.definitions.values()) statusCounts[definition.status] += 1;
  const p0ItemCount = [...result.model.p0Items.categories.values()].reduce((sum, items) => sum + items.length, 0);
  console.log(`Traceability OK: ${result.model.definitions.size} requirements (${statusCounts.verified} verified, ${statusCounts.partial} partial, ${statusCounts.planned} planned), ${p0ItemCount} PRD P0 items, ${result.model.phaseSections.size} phases, and independent structural, coverage, mapping, roadmap, and evidence gates.`);
  return true;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const checkIndex = process.argv.indexOf("--check");
  const selected = checkIndex >= 0 ? [process.argv[checkIndex + 1]] : CHECK_IDS;
  try {
    const result = runTraceability(process.cwd(), selected);
    if (!printResults(result)) process.exit(1);
  } catch (error) {
    console.error(`Traceability fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
