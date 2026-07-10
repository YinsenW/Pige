import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createSemanticClaimLedgerFromModel, runTraceability } from "./traceability.mjs";

const root = process.cwd();

const cases = [
  {
    name: "rejects an unlisted requirement area",
    check: "TRC-001",
    mutate(model) {
      model.allowedAreas.delete("DOC");
    },
    expected: "uses unlisted area"
  },
  {
    name: "rejects an uncovered PRD P0 item",
    check: "TRC-002",
    mutate(model) {
      model.p0Coverage.categories[0].coverage.pop();
    },
    expected: "must have exactly one coverage group"
  },
  {
    name: "rejects a structural mapping that omits the Build's declared Exit",
    check: "TRC-003",
    mutate(model) {
      model.requirementLinks.get("PIGE-UI-004").exits = ["E6.01"];
    },
    expected: "omits that Build's declared Exit"
  },
  {
    name: "rejects a P0 requirement whose controlled semantic capability does not match",
    check: "TRC-002",
    mutate(model) {
      const navigation = model.p0Coverage.categories.find((category) => category.key === "NAV");
      const vaultSettings = navigation.coverage.find((group) => group.items?.includes(18));
      vaultSettings.requirements = ["PIGE-PI-002"];
    },
    expected: "semantic mapping disagrees with its requirements"
  },
  {
    name: "rejects a coordinated same-class P0 requirement and capability substitution",
    check: "TRC-002",
    mutate(model) {
      const navigation = model.p0Coverage.categories.find((category) => category.key === "NAV");
      const knowledgeBaseSettings = navigation.coverage.find((group) => group.items?.includes(18));
      knowledgeBaseSettings.requirements = ["PIGE-PI-002"];
      knowledgeBaseSettings.capabilities = ["pi.default-model"];
    },
    expected: "Independent p0Items claim drift"
  },
  {
    name: "rejects an unrelated Build and Exit even when structurally paired",
    check: "TRC-003",
    mutate(model) {
      const link = model.requirementLinks.get("PIGE-GOV-001");
      link.builds = ["B0.07"];
      link.exits = ["E0.08"];
    },
    expected: "Build mapping violates controlled semantic capabilities"
  },
  {
    name: "rejects a coordinated governance capability and Build/Exit exchange",
    check: "TRC-003",
    mutate(model) {
      const publicCapability = model.semanticCapabilities.capabilities.get("governance.public-collaboration");
      const licenseCapability = model.semanticCapabilities.capabilities.get("governance.license-metadata");
      [publicCapability.requirements, licenseCapability.requirements] = [licenseCapability.requirements, publicCapability.requirements];
      [publicCapability.builds, licenseCapability.builds] = [licenseCapability.builds, publicCapability.builds];
      [publicCapability.exits, licenseCapability.exits] = [licenseCapability.exits, publicCapability.exits];
      const publicLink = model.requirementLinks.get("PIGE-GOV-001");
      const licenseLink = model.requirementLinks.get("PIGE-GOV-002");
      [publicLink.builds, licenseLink.builds] = [licenseLink.builds, publicLink.builds];
      [publicLink.exits, licenseLink.exits] = [licenseLink.exits, publicLink.exits];
      const phase = model.phaseSections.get("P0");
      [phase.builds.get("B0.15").text, phase.builds.get("B0.07").text] = [phase.builds.get("B0.07").text, phase.builds.get("B0.15").text];
      [phase.exits.get("E0.12").text, phase.exits.get("E0.08").text] = [phase.exits.get("E0.08").text, phase.exits.get("E0.12").text];
    },
    expected: "Independent capabilityDelivery claim drift"
  },
  {
    name: "rejects a malformed uncontrolled Deferred block",
    check: "TRC-003",
    mutate(model) {
      model.phaseSections.get("P2").deferredBlock = "- this is not a controlled deferral";
    },
    expected: "P2 Deferred block must contain only controlled D2.nn entries"
  },
  {
    name: "rejects a coordinated valid-looking Deferred ID and text rewrite",
    check: "TRC-003",
    mutate(model) {
      const section = model.phaseSections.get("P2");
      const original = section.deferred.get("D2.04");
      section.deferred.delete("D2.04");
      section.deferred.set("D2.99", {
        id: "D2.99",
        phase: "P2",
        text: "A valid-looking but unreviewed replacement deferral.",
        line: "- [D2.99] A valid-looking but unreviewed replacement deferral."
      });
      section.deferredBlock = section.deferredBlock.replace(original.line, "- [D2.99] A valid-looking but unreviewed replacement deferral.");
    },
    expected: "Independent deferred claim drift"
  },
  {
    name: "rejects an OCR and restore capability-requirement exchange",
    check: "TRC-002",
    mutate(model) {
      const ocr = model.semanticCapabilities.capabilities.get("ingest.native-ocr-routing");
      const restore = model.semanticCapabilities.capabilities.get("backup.validated-restore");
      [ocr.requirements, restore.requirements] = [restore.requirements, ocr.requirements];
    },
    expected: "Independent capabilitySemantics claim drift"
  },
  {
    name: "rejects reintroduction of a hand-maintained Milestone requirement gate",
    check: "TRC-004",
    mutate(model) {
      model.milestones += "\nRequirement gates:\n\n- PIGE-UI-004.\n";
    },
    expected: "Milestones must derive Requirement gates"
  },
  {
    name: "rejects an unrelated evidence selector",
    check: "TRC-005",
    mutate(model) {
      model.acceptance.evidenceCatalog["EV-CAPTURE"].selector = "this test selector does not exist";
    },
    expected: "selector is absent"
  },
  {
    name: "rejects forged README evidence",
    check: "TRC-005",
    mutate(model) {
      model.acceptance.evidenceCatalog["EV-LARGE-PASTE"] = {
        kind: "test",
        path: "README.md",
        selector: "# Pige"
      };
    },
    expected: "test evidence must use a controlled executable test path"
  },
  {
    name: "rejects coordinated Requirement evidence and open-gap exchanges",
    check: "TRC-005",
    mutate(model) {
      const diagnostics = model.requirementLinks.get("PIGE-DIAG-001");
      const provider = model.requirementLinks.get("PIGE-PI-004");
      [diagnostics.evidence, provider.evidence] = [provider.evidence, diagnostics.evidence];
      [diagnostics.open.description, provider.open.description] = [provider.open.description, diagnostics.open.description];
    },
    expected: "Independent requirementAcceptance claim drift"
  },
  {
    name: "rejects coordinated Exit evidence and open-gap exchanges",
    check: "TRC-005",
    mutate(model) {
      const diagnostics = model.exitAcceptance.get("E1.19");
      const restore = model.exitAcceptance.get("E9.02");
      [diagnostics.evidence, restore.evidence] = [restore.evidence, diagnostics.evidence];
      [diagnostics.open.description, restore.open.description] = [restore.open.description, diagnostics.open.description];
    },
    expected: "Independent exitAcceptance claim drift"
  },
  {
    name: "rejects a legacy duplicate Requirement projection and an exact-set semantic-lock substitution",
    check: "TRC-005",
    mutate(model) {
      model.acceptance.requirementLinks = [];
      const claims = model.semanticClaims.claims.requirementAcceptance;
      const removed = Object.keys(claims)[0];
      delete claims[removed];
      claims["CLM-REQ-ACCEPT-EXTRA-999"] = "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    },
    expected: [
      "Acceptance manifest contains unsupported field requirementLinks",
      "Independent requirementAcceptance claim drift: CLM-REQ-ACCEPT-EXTRA-999"
    ]
  },
  {
    name: "rejects historical material as implementation evidence",
    check: "TRC-005",
    mutate(model) {
      model.acceptance.evidenceCatalog["EV-CAPTURE"].path = "docs/DESIGN_REVIEW.md";
      model.acceptance.evidenceCatalog["EV-CAPTURE"].selector = "#";
    },
    expected: "uses historical evidence"
  },
  {
    name: "rejects phase completion with partial or planned acceptance",
    check: "TRC-005",
    mutate(model) {
      model.acceptance.phaseStates.P6 = "complete";
      model.playbookPhaseStates.set("P6", "complete");
    },
    expected: "cannot be complete"
  },
  {
    name: "rejects a coordinated acceptance and Playbook phase-state rewrite",
    check: "TRC-005",
    mutate(model) {
      model.acceptance.phaseStates.P6 = "planned";
      model.playbookPhaseStates.set("P6", "planned");
    },
    expected: "Independent phaseStates claim drift"
  },
  {
    name: "rejects a partial requirement without an explicit open gap",
    check: "TRC-005",
    mutate(model) {
      delete model.requirementLinks.get("PIGE-VAULT-005").open;
    },
    expected: "has no structured machine-readable open acceptance gap"
  },
  {
    name: "rejects a partial Exit without an explicit open gap",
    check: "TRC-005",
    mutate(model) {
      delete model.exitAcceptance.get("E9.02").open;
    },
    expected: "E9.02 has no structured machine-readable open acceptance gap"
  },
  {
    name: "rejects an open capability without a controlled delivery destination",
    check: "TRC-005",
    mutate(model) {
      model.requirementLinks.get("PIGE-VAULT-003").open.targetBuilds = [];
    },
    expected: "PIGE-VAULT-003 open gap has no targetBuilds delivery destination"
  }
];

for (const testCase of cases) {
  const result = runTraceability(root, [testCase.check], testCase.mutate);
  const errors = result.results.get(testCase.check) ?? [];
  const expectedMessages = Array.isArray(testCase.expected) ? testCase.expected : [testCase.expected];
  const missing = expectedMessages.filter((expected) => !errors.some((error) => error.includes(expected)));
  if (missing.length > 0) {
    throw new Error(`${testCase.name}: expected ${JSON.stringify(expectedMessages)}, missing ${JSON.stringify(missing)}, received ${JSON.stringify(errors)}`);
  }
}

const failingEvidencePath = "tests/unit/.traceability-failing-evidence.test.ts";
const failingEvidenceAbsolute = path.join(root, failingEvidencePath);
fs.writeFileSync(failingEvidenceAbsolute, [
  'import { expect, it } from "vitest";',
  'it("traceability executable evidence self-test", () => {',
  '  expect("failed proof").toBe("passed proof");',
  '});',
  ''
].join("\n"), "utf8");
try {
  const result = runTraceability(root, ["TRC-005"], (model) => {
    model.acceptance.evidenceCatalog["EV-LARGE-PASTE"] = {
      kind: "test",
      path: failingEvidencePath,
      selector: "traceability executable evidence self-test"
    };
    model.semanticClaims = createSemanticClaimLedgerFromModel(model);
  });
  const errors = result.results.get("TRC-005") ?? [];
  if (!errors.some((error) => error.includes("Verified test evidence failed executable proof"))) {
    throw new Error(`failing executable evidence was not rejected: ${JSON.stringify(errors)}`);
  }
} finally {
  fs.rmSync(failingEvidenceAbsolute, { force: true });
}

const generatedPath = "artifacts/traceability-self-test/release-report.json";
const generatedAbsolute = path.join(root, generatedPath);
const generatedRecipe = "tests/fixtures/manifests/public-alpha-scenario.manifest.json";
const recipeSha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, generatedRecipe))).digest("hex");
fs.mkdirSync(path.dirname(generatedAbsolute), { recursive: true });
fs.writeFileSync(generatedAbsolute, `${JSON.stringify({ schemaVersion: 1, status: "passed", generatedAt: new Date().toISOString(), recipe: generatedRecipe, recipeSha256, scenarioCount: 25 }, null, 2)}\n`, "utf8");
try {
  const result = runTraceability(root, ["TRC-005"], (model) => {
    const definition = model.definitions.get("PIGE-REL-003");
    definition.status = "verified";
    const link = model.requirementLinks.get("PIGE-REL-003");
    link.status = "verified";
    link.evidence = ["EV-GENERATED-RELEASE-SELFTEST"];
    delete link.plannedTarget;
    model.acceptance.evidenceCatalog["EV-GENERATED-RELEASE-SELFTEST"] = {
      kind: "generated-report",
      path: generatedPath,
      selector: "\"status\": \"passed\"",
      recipe: generatedRecipe
    };
    const exit = model.exitAcceptance.get("E9.10");
    exit.status = "verified";
    exit.evidence = ["EV-GENERATED-RELEASE-SELFTEST"];
    delete exit.plannedTarget;
    model.semanticClaims = createSemanticClaimLedgerFromModel(model);
  });
  const errors = result.results.get("TRC-005") ?? [];
  if (errors.length > 0) throw new Error(`generated release evidence should be accepted, received ${JSON.stringify(errors)}`);
} finally {
  fs.rmSync(path.dirname(generatedAbsolute), { recursive: true, force: true });
}

console.log(`Traceability mutation cases OK: ${cases.length} false-positive mutations plus one executable-evidence failure rejected, and one recipe-backed generated release report accepted from ${path.relative(root, import.meta.filename)}.`);
