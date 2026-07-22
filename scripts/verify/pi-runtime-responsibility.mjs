import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const serviceInventoryPath = path.join(root, "tests/fixtures/service-responsibility-inventory.json");
const serviceInventory = JSON.parse(fs.readFileSync(serviceInventoryPath, "utf8"));
const modules = [
  {
    path: "apps/desktop/src/main/services/pi-agent-runtime-adapter.ts",
    owner: "PiAgentRuntimeAdapter",
    classification: "assembly_and_control",
    upstreamGap: "Pige must assemble scoped product boundaries around one upstream Agent instance."
  },
  {
    path: "apps/desktop/src/main/services/pi-agent-completion-policy.ts",
    owner: "Agent completion policy",
    classification: "product_control",
    upstreamGap: "Pi owns turn execution; Pige owns durable work budgets, terminal acceptance, and bounded tool-validation feedback."
  },
  {
    path: "apps/desktop/src/main/services/pi-agent-provider-binding.ts",
    owner: "Model Provider Registry",
    classification: "product_boundary",
    upstreamGap: "Pi cannot own Pige provider profiles, credential isolation, endpoint policy, or egress identity."
  },
  {
    path: "apps/desktop/src/main/services/pi-agent-tool-boundary.ts",
    owner: "Pige tool registry and Permission Broker",
    classification: "product_boundary",
    upstreamGap: "Pi cannot own Pige effects, trust, data scope, idempotency, resource limits, or fixed-catalog policy."
  },
  {
    path: "apps/desktop/src/main/services/pi-agent-safe-projection.ts",
    owner: "Home and conversation projection",
    classification: "product_boundary",
    upstreamGap: "Pi cannot own Pige body-free event projection, bounded history, or safe draft privacy rules."
  },
  {
    path: "apps/desktop/src/main/services/model-capability-registry.ts",
    owner: "Model Provider Registry",
    classification: "product_boundary",
    upstreamGap: "Pi model metadata must be merged with explicit Pige profile facts and conservative unknown-model policy."
  },
  {
    path: "apps/desktop/src/main/services/home-agent-evidence-ledger.ts",
    owner: "Home evidence projection",
    classification: "product_boundary",
    upstreamGap: "Pi owns tool sequencing, while Pige must prove that cited durable evidence crossed the reviewed model boundary before publication."
  },
  {
    path: "apps/desktop/src/main/services/job-execution-coordinator.ts",
    owner: "JobExecutionCoordinator",
    classification: "authority_reliability",
    upstreamGap: "Pi owns Agent turn execution, while Pige must single-own durable Job claim, CAS, cancellation, retry, checkpoint, review, recovery, and terminal transitions."
  },
  {
    path: "apps/desktop/src/main/services/window-layout-policy.ts",
    owner: "Window layout policy",
    classification: "product_boundary",
    upstreamGap: "Pi does not own native window geometry, display work-area constraints, or resident-versus-overlay presentation."
  }
];

const failures = [];
const inventoryEntries = Object.entries(serviceInventory.categories).flatMap(([classification, entries]) =>
  entries.map(([file, baselineLines, flags]) => ({ classification, file, baselineLines, flags }))
);
const serviceDirectory = path.join(root, serviceInventory.root);
const actualServiceFiles = fs.readdirSync(serviceDirectory).filter((file) => file.endsWith(".ts")).sort();
const inventoriedServiceFiles = inventoryEntries.map((entry) => entry.file).sort();
if (inventoryEntries.length !== serviceInventory.baselineFileCount) {
  failures.push(`service responsibility inventory must contain ${serviceInventory.baselineFileCount} entries, found ${inventoryEntries.length}`);
}
if (new Set(inventoriedServiceFiles).size !== inventoriedServiceFiles.length) {
  failures.push("service responsibility inventory contains duplicate files");
}
const declaredH1Modules = modules
  .map((entry) => path.basename(entry.path))
  .filter((file) => !inventoriedServiceFiles.includes(file));
const expectedCurrentServiceFiles = [...inventoriedServiceFiles, ...declaredH1Modules].sort();
if (JSON.stringify(actualServiceFiles) !== JSON.stringify(expectedCurrentServiceFiles)) {
  const missing = actualServiceFiles.filter((file) => !expectedCurrentServiceFiles.includes(file));
  const stale = expectedCurrentServiceFiles.filter((file) => !actualServiceFiles.includes(file));
  failures.push(`service responsibility inventory differs from the service tree (missing=${missing.join(",") || "none"}; stale=${stale.join(",") || "none"})`);
}
const validFlags = new Set(Object.keys(serviceInventory.flagLegend));
for (const entry of inventoryEntries) {
  if (!Number.isInteger(entry.baselineLines) || entry.baselineLines <= 0) {
    failures.push(`${entry.file} has an invalid baseline LOC`);
  }
  for (const flag of entry.flags) {
    if (!validFlags.has(flag)) failures.push(`${entry.file} has unknown responsibility flag ${flag}`);
  }
}
const baselineServiceLines = inventoryEntries.reduce((total, entry) => total + entry.baselineLines, 0);
if (baselineServiceLines !== serviceInventory.baselineLines) {
  failures.push(`service responsibility baseline LOC must be ${serviceInventory.baselineLines}, found ${baselineServiceLines}`);
}
for (const file of serviceInventory.noGrowth) {
  if (!inventoriedServiceFiles.includes(file)) failures.push(`no-growth service ${file} is absent from the responsibility inventory`);
  const entry = inventoryEntries.find((candidate) => candidate.file === file);
  const source = fs.readFileSync(path.join(serviceDirectory, file), "utf8");
  const currentLines = source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
  if (currentLines > entry.baselineLines) failures.push(`${file} grew while its semantic owner is frozen`);
}
if (serviceInventory.architectureBudget.serviceOwnerCount !== inventoryEntries.length) {
  failures.push("architecture budget service-owner count differs from the responsibility inventory");
}
for (const [file, metrics] of Object.entries(serviceInventory.architectureBudget.oversizedServiceBranchAndFunctionProxies)) {
  if (!inventoriedServiceFiles.includes(file)) failures.push(`architecture budget references unknown service ${file}`);
  if (!Array.isArray(metrics) || metrics.length !== 2 || metrics.some((value) => !Number.isInteger(value) || value < 0)) {
    failures.push(`${file} has invalid branch/function proxy metrics`);
  }
}
for (const [file, ranges] of Object.entries(serviceInventory.responsibilityRanges)) {
  if (!inventoriedServiceFiles.includes(file)) failures.push(`responsibility map references unknown service ${file}`);
  for (const [start, end, action, rationale] of ranges) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) failures.push(`${file} has an invalid responsibility range`);
    if (!["KEEP", "DELETE", "MOVE", "UPSTREAM"].includes(action)) failures.push(`${file} has invalid responsibility action ${action}`);
    if (!rationale) failures.push(`${file} has a responsibility range without rationale`);
  }
}
const affectedOversizedServices = [
  {
    path: "apps/desktop/src/main/services/jobs-service.ts",
    ownerProblem: "Job storage, transitions, executors, permissions, egress, proposals, and recovery share one service",
    classification: "multi_owner_god_service",
    nextPhase: "H3_generic_job_execution_coordinator",
    baselineLines: 6_956,
    branchProxyBaseline: 536,
    functionProxyBaseline: 221,
    growthPolicy: "no_new_semantic_branches"
  },
  {
    path: "apps/desktop/src/main/services/agent-ingest-service.ts",
    ownerProblem: "Pi tool choice is wrapped by a Host semantic ingest orchestrator",
    classification: "shadow_semantic_orchestrator",
    nextPhase: "H2_agent_turn_ingest_capability_convergence",
    baselineLines: 4_645,
    branchProxyBaseline: 232,
    functionProxyBaseline: 135,
    growthPolicy: "no_new_semantic_branches"
  },
  {
    path: "apps/desktop/src/main/services/home-agent-service.ts",
    ownerProblem: "Product entry, conversations, Jobs, tools, egress, evidence, and publication share one service",
    classification: "multi_owner_agent_entry",
    nextPhase: "H2_agent_turn_ingest_capability_convergence",
    baselineLines: 3_722,
    branchProxyBaseline: 195,
    functionProxyBaseline: 82,
    growthPolicy: "no_new_semantic_branches"
  },
  {
    path: "apps/desktop/src/main/services/backup-service.ts",
    ownerProblem: "Durable workflow and repeated filesystem primitives require closed-loop audit",
    classification: "durable_workflow_audit",
    nextPhase: "H4_shared_durable_file_primitives",
    baselineLines: 3_210,
    branchProxyBaseline: 291,
    functionProxyBaseline: 175,
    growthPolicy: "audit_before_new_workflow_branches"
  },
  {
    path: "apps/desktop/src/main/services/dataset-ingest-core.ts",
    ownerProblem: "Large deterministic format core; must not select the next semantic Agent action",
    classification: "deterministic_domain_core",
    nextPhase: "H4_format_boundary_audit",
    baselineLines: 1_839,
    branchProxyBaseline: 222,
    functionProxyBaseline: 85,
    growthPolicy: "deterministic_only"
  },
  {
    path: "apps/desktop/src/main/services/knowledge-activity-service.ts",
    ownerProblem: "Operation and recovery ownership require closed-loop audit",
    classification: "durable_workflow_audit",
    nextPhase: "H4_shared_durable_file_primitives",
    baselineLines: 1_622,
    branchProxyBaseline: 180,
    functionProxyBaseline: 100,
    growthPolicy: "audit_before_new_workflow_branches"
  },
  {
    path: "apps/desktop/src/main/services/agent-page-update-service.ts",
    ownerProblem: "Page mutation and Operation commit ownership require closed-loop audit",
    classification: "durable_workflow_audit",
    nextPhase: "H4_shared_durable_file_primitives",
    baselineLines: 1_556,
    branchProxyBaseline: 107,
    functionProxyBaseline: 74,
    growthPolicy: "audit_before_new_workflow_branches"
  },
  {
    path: "apps/desktop/src/main/services/pdf-ocr-artifact-service.ts",
    ownerProblem: "Large deterministic OCR artifact core; must not choose semantic routing",
    classification: "deterministic_domain_core",
    nextPhase: "H4_format_boundary_audit",
    baselineLines: 1_524,
    branchProxyBaseline: 100,
    functionProxyBaseline: 69,
    growthPolicy: "deterministic_only"
  },
  {
    path: "apps/desktop/src/main/services/dataset-query-service.ts",
    ownerProblem: "Large deterministic query core; must remain an atomic Pi tool capability",
    classification: "deterministic_domain_core",
    nextPhase: "H4_format_boundary_audit",
    baselineLines: 1_428,
    branchProxyBaseline: 130,
    functionProxyBaseline: 55,
    growthPolicy: "deterministic_only"
  },
  {
    path: "apps/desktop/src/main/services/local-tool-manager-service.ts",
    ownerProblem: "Local tool lifecycle duplicates Job transition ownership",
    classification: "duplicate_job_closed_loop_audit",
    nextPhase: "H3_generic_job_execution_coordinator",
    baselineLines: 1_254,
    growthPolicy: "audit_before_new_workflow_branches"
  }
].map((entry) => {
  const absolutePath = path.join(root, entry.path);
  const source = fs.readFileSync(absolutePath, "utf8");
  const currentLines = source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
  if (
    entry.growthPolicy === "no_new_semantic_branches" &&
    currentLines > entry.baselineLines
  ) {
    failures.push(`${entry.path} grew during H1 while semantic branches are frozen`);
  }
  return { ...entry, currentLines };
});
const inventory = modules.map((entry) => {
  const absolutePath = path.join(root, entry.path);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${entry.path} is missing`);
    return { ...entry, lines: 0 };
  }
  const source = fs.readFileSync(absolutePath, "utf8");
  const lines = source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
  if (!entry.owner || !entry.upstreamGap) failures.push(`${entry.path} lacks an owner or upstream-gap rationale`);
  if (entry.classification !== "assembly_and_control" && /\bnew Agent\s*\(|agent\.followUp\s*\(/u.test(source)) {
    failures.push(`${entry.path} contains Agent lifecycle control outside the assembly layer`);
  }
  return { ...entry, lines };
});

const adapter = inventory.find((entry) => entry.classification === "assembly_and_control");
if (!adapter || adapter.lines < 200 || adapter.lines > 400) {
  failures.push(`pi-agent-runtime-adapter.ts must remain a 200-400 line assembly layer, found ${adapter?.lines ?? 0}`);
}

const splitPiLines = inventory
  .filter((entry) => entry.path.includes("/pi-") && entry.classification !== "assembly_and_control")
  .reduce((total, entry) => total + entry.lines, 0);
const customAgentControlLines = inventory
  .filter((entry) => entry.classification === "assembly_and_control" || entry.classification === "product_control")
  .reduce((total, entry) => total + entry.lines, 0);

const h2Sources = Object.fromEntries([
  "apps/desktop/src/main/index.ts",
  "apps/desktop/src/main/services/capture-service.ts",
  "apps/desktop/src/main/services/jobs-service.ts",
  "apps/desktop/src/main/services/agent-ingest-service.ts",
  "apps/desktop/src/main/services/home-agent-service.ts"
].map((relativePath) => [relativePath, fs.readFileSync(path.join(root, relativePath), "utf8")]));
const h2Main = h2Sources["apps/desktop/src/main/index.ts"];
const h2Capture = h2Sources["apps/desktop/src/main/services/capture-service.ts"];
const h2Jobs = h2Sources["apps/desktop/src/main/services/jobs-service.ts"];
const h2AgentIngest = h2Sources["apps/desktop/src/main/services/agent-ingest-service.ts"];
const h2Home = h2Sources["apps/desktop/src/main/services/home-agent-service.ts"];
const h2LineBudget = {
  "agent-ingest-service.ts": [4_645, 4_630],
  "home-agent-service.ts": [3_722, 3_708],
  "jobs-service.ts": [6_956, 6_952]
};
const h3Coordinator = fs.readFileSync(path.join(
  root,
  "apps/desktop/src/main/services/job-execution-coordinator.ts"
), "utf8");
const h3DirectLifecycleStatePattern = /state:\s*"(?:awaiting_review|cancel_requested|cancelled|completed|completed_with_warnings|failed_retryable|failed_final)"/gu;
const h3DirectLifecycleStateWriters = h2Jobs.match(h3DirectLifecycleStatePattern) ?? [];
const h3JobsCompareAndSwapCount = h2Jobs.match(/compareAndSwap\(/gu)?.length ?? 0;
const h3ResidualClosedLoops = [
  "apps/desktop/src/main/services/backup-coordinator-service.ts",
  "apps/desktop/src/main/services/restore-coordinator-service.ts",
  "apps/desktop/src/main/services/local-tool-manager-service.ts"
].map((relativePath) => {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  return {
    path: relativePath,
    directLifecycleStateLiterals: source.match(h3DirectLifecycleStatePattern)?.length ?? 0
  };
});
if (h3DirectLifecycleStateWriters.length !== 0) {
  failures.push("H3 JobsService still writes coordinator-owned lifecycle states directly");
}
if (h3JobsCompareAndSwapCount !== 2) {
  failures.push(`H3 JobsService must retain only two non-lifecycle CAS boundaries, found ${h3JobsCompareAndSwapCount}`);
}
for (const removedWriter of [
  "#mutateJob(",
  "#replaceExpectedJob(",
  "createJobCancellationOutcome(",
  "withDurableWriteState("
]) {
  if (h2Jobs.includes(removedWriter)) failures.push(`H3 JobsService still contains removed lifecycle writer ${removedWriter}`);
}
if (/ipcMain\.handle\("capture\.submit(?:Text|Url|Files)"/u.test(h2Main)) {
  failures.push("H2 must not expose legacy capture.submit* semantic ingress through Main IPC");
}
if (
  !h2Capture.includes("CurrentSourceRecordSchema.parse") ||
  !h2Capture.includes('semanticOrchestration: "agent_turn"')
) {
  failures.push("H2 CaptureService must durably bind every new source to one agent_turn");
}
if (`${h2Capture}\n${h2Jobs}\n${h2Home}`.includes("capture_only")) {
  failures.push("H2 current source and Agent owners still contain removed capture_only semantics");
}
if (!h2Jobs.includes('sourceRecord.semanticOrchestration === "legacy_agent_ingest"')) {
  failures.push("H2 historical agent_ingest compatibility must require the normalized typed legacy marker");
}
for (const removedControl of [
  "AGENT_INGEST_TERMINAL_RECOVERY_PROMPT",
  "terminalActionRecovery",
  "completionRepair",
  "agent_runtime.tool_order_invalid"
]) {
  if (`${h2AgentIngest}\n${h2Home}`.includes(removedControl)) {
    failures.push(`H2 still contains removed Host semantic control ${removedControl}`);
  }
}
if (
  !h2Main.includes('ipcMain.handle("proposals.list", proposalRendererBoundaryUnavailable)') ||
  !h2Main.includes('ipcMain.handle("proposals.get", proposalRendererBoundaryUnavailable)') ||
  !h2Main.includes('ipcMain.handle("proposals.approve", proposalRendererBoundaryUnavailable)') ||
  !h2Main.includes('ipcMain.handle("proposals.reject", proposalRendererBoundaryUnavailable)')
) {
  failures.push("H2 must keep raw durable ConfirmationProposal records behind a fail-closed renderer boundary");
}

function lineCount(source) {
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}

if (failures.length > 0) {
  console.error("Pi runtime responsibility errors:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Pi runtime responsibility OK: ${JSON.stringify({
  baselineAdapterLines: 1_398,
  adapterLines: adapter.lines,
  splitPiRuntimeAndControlLines: splitPiLines,
  customAgentControlLines,
  h1DeletedOrReplacedControls: [
    "global_sequential_tool_execution",
    "event_subscriber_terminal_repair_loop",
    "host_missing_terminal_follow_up",
    "duplicate_agent_queue_cleanup",
    "reduced_pige_agent_tool_result",
    "adapter_embedded_model_capability_hardcodes"
  ],
  h1NewFirstPartyTools: [],
  h2ResponsibilityDelta: {
    baseline: "2636ea6639e6e4fc08aa0c27a352a7ee2252baa1",
    lineBudget: Object.fromEntries(Object.entries(h2LineBudget).map(([file, [before, after]]) => [file, {
      before,
      after,
      delta: after - before
    }])),
    deletedOrDisabledControls: [
      "renderer_capture_submit_ipc",
      "new_capture_to_agent_ingest_auto_chain",
      "parse_or_ocr_to_agent_ingest_auto_chain_for_marked_sources",
      "agent_ingest_terminal_recovery_prompt",
      "retrieval_failure_terminal_poison",
      "home_modality_exclusivity",
      "home_host_tool_order_epoch",
      "all_legacy_renderer_proposal_methods"
    ],
    retainedHostBoundaries: [
      "source_preservation_and_revision",
      "permission_and_model_egress",
      "job_claim_cas_checkpoint_cancel_recovery",
      "operation_proposal_and_publication_commit",
      "citation_and_evidence_visibility",
      "resource_limits_and_body_free_errors",
      "terminal_durable_effect_one_winner"
    ],
    legacyAgentIngestAdmission: "SourceRecord semanticOrchestration=legacy_agent_ingest only; current writes exclude it",
    newSemanticIngress: "agent.submitTurn",
    proposalRendererBoundary: "all legacy renderer proposal methods fail closed; durable records remain Main-internal"
  },
  h3ResponsibilityDelta: {
    baseline: "b9b624df9ea13b17ac869e1193b88095f0ba3806",
    candidateScope: "coordinator_core_and_jobs_home_migration",
    lineBudget: {
      "job-execution-coordinator.ts": { before: 0, after: lineCount(h3Coordinator), delta: lineCount(h3Coordinator) },
      "jobs-service.ts": { before: 6_952, after: lineCount(h2Jobs), delta: lineCount(h2Jobs) - 6_952 },
      "home-agent-service.ts": { before: 3_708, after: lineCount(h2Home), delta: lineCount(h2Home) - 3_708 }
    },
    coordinatorOwnedTransitions: [
      "begin_and_resume",
      "bounded_fact_patch",
      "waiting_and_terminal_settlement",
      "explicit_retry_and_requeue",
      "cancellation_and_durable_boundary",
      "interrupted_recovery_and_uncertain_effect_terminalization",
      "durable_completion_adoption",
      "proposal_review_resolution"
    ],
    jobsServiceDirectLifecycleStateWriters: h3DirectLifecycleStateWriters.length,
    jobsServiceRemainingCompareAndSwapBoundaries: h3JobsCompareAndSwapCount,
    remainingCompareAndSwapOwners: [
      "legacy_retrieval_and_test_fixture_whole_record_compatibility",
      "deterministic_parent_child_binding_reconciliation"
    ],
    homeDurableAssistantRecovery: "adopt_durable_completion_without_provider_replay",
    retryConvergence: "same_job_requeue_acknowledgement_yields_to_next_authoritative_state",
    remainingClosedLoops: h3ResidualClosedLoops,
    serializedNextSteps: [
      "H3b_migrate_backup_restore_and_local_tool_transition_adapters",
      "H3c_register_per_class_executors_and_remove_jobs_service_dispatch_ownership"
    ]
  },
  continuousRefactorSequence: serviceInventory.phaseSequence,
  serviceResponsibilityInventory: {
    baseline: serviceInventory.baseline,
    baselineFiles: inventoryEntries.length,
    currentFiles: actualServiceFiles.length,
    baselineLines: baselineServiceLines,
    categories: Object.fromEntries(Object.entries(serviceInventory.categories).map(([name, entries]) => [name, entries.length])),
    noGrowth: serviceInventory.noGrowth,
    mappedSemanticOwners: Object.keys(serviceInventory.responsibilityRanges),
    architectureBudget: serviceInventory.architectureBudget,
    legacyCompatibility: serviceInventory.legacyCompatibility
  },
  affectedOversizedServices,
  excludedProductBoundaryClasses: [
    "provider_credentials_and_egress",
    "tool_policy_and_resource_validation",
    "safe_projection",
    "model_capability_registry"
  ],
  modules: inventory.map(({ path: modulePath, owner, classification, upstreamGap, lines }) => ({
    path: modulePath,
    owner,
    classification,
    upstreamGap,
    lines
  }))
})}`);
