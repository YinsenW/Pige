# Documentation Quality Controls

Status: Active implementation control
Last reviewed: 2026-07-10
Review trigger: Any documentation score gate, independent-review score, reviewed snapshot, evidence rule, or quarterly documentation inventory change.

This directory owns the machine-readable five-dimension score definition, documentation
inventory/context budgets, and current independent-review recipe.

- `documentation-quality.manifest.json` defines the stable automated dimensions, weighted checks, and minimum score.
- `document-map.manifest.json` owns the governed file inventory, owner/read/lifecycle metadata, and always-read word budget.
- `documentation-leanness.manifest.json` records the audited physical baseline and the inventory, trace-projection, similarity, and reduction budgets.
- `independent-review.recipe.json` records only the current independent proof: at most
  three reviewers, per-dimension scores, current non-blocking risks, coordination, and
  the exact governed snapshot. Superseded reviewers and resolved blockers remain in Git
  and CI history instead of accumulating in the live recipe.

`scripts/verify/document-map.mjs` and `scripts/verify/documentation-leanness.mjs` reject
unmapped growth, duplicated owner structures, stale aliases, redundant trace projections,
and context/volume budget regressions. `scripts/verify/independent-documentation-review.mjs`
refuses stale, incomplete, self-reviewed, or below-threshold recipes and generates the
hash-bound manual report under `artifacts/documentation-quality/independent-review.json`.
`scripts/verify/documentation-quality.mjs` reports the lower of each automated score and
its independent score; automated self-scoring cannot raise the accepted result.
