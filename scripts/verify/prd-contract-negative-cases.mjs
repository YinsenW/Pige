import { createSemanticClaimLedger, createSemanticClaimLedgerFromModel, runTraceability } from "./traceability.mjs";
import { runPrdContract } from "./prd-contract.mjs";

const root = process.cwd();

const cases = [
  {
    name: "rejects a missing contract-authority boundary",
    mutate(model) {
      model.prd = model.prd.replace("## 0. Contract Authority And AI Use", "## 0. Product Introduction");
    },
    expected: "contract authority section is missing"
  },
  {
    name: "rejects a removed P0 item",
    mutate(model) {
      model.prd = model.prd.replace("- Chat-like bottom home composer.\n", "");
    },
    expected: "PRD P0 item count drifted"
  },
  {
    name: "rejects an added P1 item",
    mutate(model) {
      model.prd = model.prd.replace("### 8.3 P2 Later", "- Unreviewed P1 scope expansion.\n\n### 8.3 P2 Later");
    },
    expected: "PRD P1 item count drifted"
  },
  {
    name: "rejects a current implementation note",
    mutate(model) {
      model.prd = model.prd.replace("## 11. Agent Workflows", "Current implementation note: this slice is already implemented.\n\n## 11. Agent Workflows");
    },
    expected: "current implementation note"
  },
  {
    name: "rejects evidence and Build IDs in the PRD",
    mutate(model) {
      model.prd = model.prd.replace("## 24. Risks", "Evidence: EV-FORGED proves B5.08.\n\n## 24. Risks");
    },
    expected: "evidence ID"
  },
  {
    name: "rejects a concrete model identity",
    mutate(model) {
      model.prd = model.prd.replace("verified Pige-managed download path", "verified Qwen3-Embedding-0.6B-Q8_0.gguf download path");
    },
    expected: "concrete Qwen model identity"
  },
  {
    name: "rejects an external technical URL",
    mutate(model) {
      model.prd = model.prd.replace("## 26. Owner Reference Index", "Reference: https://example.com/sdk\n\n## 26. Owner Reference Index");
    },
    expected: "external technical URL"
  },
  {
    name: "rejects an executable type declaration",
    mutate(model) {
      model.prd = model.prd.replace("## 21. Backup And Restore", "type JobState = \"completed\";\n\n## 21. Backup And Restore");
    },
    expected: "executable type declaration"
  },
  {
    name: "rejects an executable source-storage enum",
    mutate(model) {
      model.prd = model.prd.replace("Managed copy or verified original-file reference", "copy_to_source_library or reference_original");
    },
    expected: "executable source-storage enum"
  },
  {
    name: "rejects a concrete database technology",
    mutate(model) {
      model.prd = model.prd.replace("Rebuildable local working data", "SQLite working data");
    },
    expected: "concrete database technology"
  },
  {
    name: "rejects an implementation path",
    mutate(model) {
      model.prd = model.prd.replace("## 24. Risks", "Implementation: `apps/desktop/src/main/index.ts`.\n\n## 24. Risks");
    },
    expected: "implementation, test, generated-artifact, or verifier path"
  },
  {
    name: "rejects the PRD as implementation evidence",
    mutate(model) {
      model.acceptance.evidenceCatalog["EV-PRD-FORGED"] = {
        kind: "contract",
        path: "docs/PRD.md",
        selector: "## 23. Product Acceptance Scenarios"
      };
    },
    expected: "incorrectly uses the PRD as implementation evidence"
  },
  {
    name: "rejects removal of the product-state/executable-state boundary",
    mutate(model) {
      model.prd = model.prd.replace(
        "User-facing state names are product copy, not a competing executable Job vocabulary.",
        "User-facing states are the executable Job vocabulary."
      );
    },
    expected: "AI-execution structure is missing"
  }
];

for (const testCase of cases) {
  const { errors } = runPrdContract(root, (model) => {
    const before = JSON.stringify([model.prd, model.spec, model.p0Coverage, model.acceptance, model.playbook, model.milestones]);
    testCase.mutate(model);
    const after = JSON.stringify([model.prd, model.spec, model.p0Coverage, model.acceptance, model.playbook, model.milestones]);
    if (before === after) throw new Error(`${testCase.name}: mutation did not change its input fixture`);
  });
  if (!errors.some((error) => error.includes(testCase.expected))) {
    throw new Error(`${testCase.name}: expected ${JSON.stringify(testCase.expected)}, received ${JSON.stringify(errors)}`);
  }
}

const baselineLedger = createSemanticClaimLedger(root);
const mutation = runTraceability(root, [], (model) => {
  model.prd = model.prd.replace(
    "A lower group cannot weaken a higher group merely to simplify implementation.",
    "A lower group may weaken a higher group to simplify implementation."
  );
});
const mutatedLedger = createSemanticClaimLedgerFromModel(mutation.model);
const expectedChangedClaim = "CLM-PRD-PRODUCT-OPTIMIZATION-ORDER";
const baselinePrdClaims = baselineLedger.claims.prdContracts ?? {};
const mutatedPrdClaims = mutatedLedger.claims.prdContracts ?? {};
if (baselinePrdClaims[expectedChangedClaim] === mutatedPrdClaims[expectedChangedClaim]) {
  throw new Error("product-optimization semantic mutation did not change its prdContracts digest");
}
for (const claimId of Object.keys(baselinePrdClaims)) {
  if (claimId !== expectedChangedClaim && baselinePrdClaims[claimId] !== mutatedPrdClaims[claimId]) {
    throw new Error(`product-optimization semantic mutation unexpectedly changed ${claimId}`);
  }
}

const inputMutation = runTraceability(root, [], (model) => {
  model.prd = model.prd.replace(
    "the turn waits visibly; host heuristics do not choose capture instead.",
    "the turn silently disappears; host heuristics choose capture instead."
  );
});
const inputMutatedLedger = createSemanticClaimLedgerFromModel(inputMutation.model);
const expectedInputClaim = "CLM-PRD-INPUT-AND-AGENT-WORKFLOWS";
const inputMutatedPrdClaims = inputMutatedLedger.claims.prdContracts ?? {};
if (baselinePrdClaims[expectedInputClaim] === inputMutatedPrdClaims[expectedInputClaim]) {
  throw new Error("input/workflow semantic mutation did not change its prdContracts digest");
}
for (const claimId of Object.keys(baselinePrdClaims)) {
  if (claimId !== expectedInputClaim && baselinePrdClaims[claimId] !== inputMutatedPrdClaims[claimId]) {
    throw new Error(`input/workflow semantic mutation unexpectedly changed ${claimId}`);
  }
}

console.log(
  `PRD contract mutation cases OK: ${cases.length} structural/status/technical-owner mutations rejected; product-optimization and input/workflow semantic mutations changed only their scoped PRD claims.`
);
