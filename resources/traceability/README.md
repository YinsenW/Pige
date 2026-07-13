# Traceability Control Manifests

Status: Active implementation control
Last reviewed: 2026-07-10
Review trigger: Any PRD P0 bullet, requirement status, owner, controlled semantic capability, Phase/Milestone assignment, Build, Exit, open gap, evidence selector, durable event/operation vocabulary, or phase-state change, plus the quarterly documentation inventory.

This directory contains the machine-readable side of `docs/SPEC_TRACEABILITY.md`:

- `p0-coverage.manifest.json` partitions every bullet in PRD section 8.1 exactly once and maps it to stable `PIGE-*` requirements plus controlled semantic capabilities.
- `acceptance.manifest.json` schema v3 normalizes the machine projection into one `capabilities` map (`requirement`, `builds`, `exits`), one `requirements` map (status, evidence/planned target, structured open work), one `exits` map, one evidence catalog, and controlled phase states. It does not repeat capability descriptions or a second Requirement-to-Build/Exit table.
- `semantic-claims.manifest.json` schema v3 is the independent semantic lock. It stores
  one base64url-encoded SHA-256 digest per canonical claim, grouped by claim class,
  rather than full normalized preimages. Claim IDs and per-claim drift diagnostics stay
  intact while the encoding leaves trace capacity for normal contract evolution. The
  verifier still rejects missing, extra, exchanged, or altered claims before an explicit
  update.

`scripts/verify/traceability.mjs` validates five independent gates, including exact P0-to-capability and Requirement-to-Build/Exit assignments, Spec ownership/Phase/Milestone/verification fields, controlled evidence path classes, execution of test/verifier evidence used for verified acceptance, and executable durable-vocabulary parity. `scripts/verify/traceability-negative-cases.mjs` challenges those gates with structural and coordinated semantic swaps, forged evidence, evidence/open exchanges, phase-state mutations, digest loss/addition, and a recipe-backed generated release report.

Edit the semantic owner first: PRD for P0 scope, Spec for Requirement identity/owner/Phase/Milestone/verification, Playbook for Build/Exit/Deferred text or phase state, Milestones only for the sole crosswalk, and acceptance for capability delivery, status, evidence, or open work. Review the complete semantic diff, then run `node scripts/verify/update-semantic-claims.mjs --accept-semantic-change`; the updater refuses to rewrite the lock without that explicit flag. Never regenerate it merely to silence a failed mapping.
