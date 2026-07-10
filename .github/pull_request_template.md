# Pull Request

## Summary

<!-- What changed, in one or two paragraphs? -->

## Implementation Control

<!-- Name stable IDs and owner sources. Use Not applicable only for a tiny mechanical change. -->

- Active phase or slice:
- Agent task/provenance:
- Agent role: Project Management | Product Planning | UI Design | Development
- Cross-role delegation: None | Delegated by role/task for exact scope
- Human role: direction | reference input | review | release authorization | not applicable
- Build IDs:
- Exit IDs:
- Requirement IDs:
- Requirement owner sources:

## Scope

- [ ] Product/UI behavior
- [ ] Data ownership, vault layout, schema, or migration
- [ ] Parser/OCR/RAG/model/provider behavior
- [ ] Permissions, privacy, security, diagnostics, or support
- [ ] Release, packaging, dependency, update, or installer behavior
- [ ] Documentation-only

## Product Contract Impact

<!-- Choose the highest applicable class. For behavior or release_scope, name every changed owner and trace/acceptance projection. For none or editorial, explain why product semantics are unchanged. -->

- PRD impact: none | editorial | behavior | release_scope
- Affected product requirement IDs:
- Affected owner documents:
- Trace/acceptance impact:
- No-contract-impact rationale:

## Safety Checklist

- [ ] No secrets, private vault content, source bodies, raw prompts, raw model responses, or unreviewed support bundles are included.
- [ ] Sensitive actions go through Permission Broker where required.
- [ ] Markdown remains the durable knowledge source of truth.
- [ ] SQLite/index/cache changes are rebuildable or documented as durable state.
- [ ] Privacy-facing behavior still matches `PRIVACY.md`.
- [ ] Support/issue behavior still matches `SUPPORT.md`.
- [ ] Security-sensitive behavior follows `SECURITY.md`.

## Tests

<!-- List tests, fixtures, verification commands, or release evidence; explain why not applicable. -->

- Tests/evidence:

## Active Development Impact

<!-- Name the current phase/slice affected. Use None, Low, Medium, or High for planning cost, and explain any compatibility or migration work. -->

- Planning cost: None | Low | Medium | High
- Compatibility or migration impact:
- Coordination action: No action | Active-phase follow-up | Future-phase follow-up
- Coordination target/status: Not required | Notified task/channel, acknowledgement pending | Notified task/channel, acknowledged
- Blocking reason, if any:

## Docs

- Docs updated:
- Product Planning design sync: Not required with reason | Pending task | Acknowledged task/snapshot
- [ ] Relevant design docs updated.
- [ ] `docs/DECISION_LOG.md` updated for durable decisions.
- [ ] `docs/SPEC_TRACEABILITY.md` updated when requirement/test mapping changed.
- [ ] Dependency registry/manifest updated if a dependency changed.
- [ ] Public status, document map, and task-routing entries still describe the repository accurately.

## Known Gaps

<!-- What remains risky, deferred, or intentionally out of scope? -->

- Known gaps:
