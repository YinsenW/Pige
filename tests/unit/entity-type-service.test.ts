import { describe, expect, it, vi } from "vitest";
import { EntityTypeService, readEntityType, updateEntityTypeMarkdown } from "../../apps/desktop/src/main/services/entity-type-service";

const request = { apiVersion: 1 as const, requestId: "noteentitytypereq_abcdefghijklmnop",
  activeVaultId: "vault_20260801_entity", currentPageId: "page_20260801_entity01",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}`, entityType: "person" as const };

describe("EntityTypeService", () => {
  it("changes one exact current Entity type through the existing reversible editor", async () => {
    const assertCurrent = vi.fn(() => true), save = vi.fn(() => ({ status: "committed" as const,
      operationId: "op_20260801_entitytype1" }));
    const service = new EntityTypeService({ resolveManagedPageTarget: vi.fn(() => ({ status: "ready",
      pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent })), render: vi.fn(async () => entityRender("person")) } as never,
    { open: vi.fn(() => openedEntity()), save } as never, () => new Date("2026-08-01T12:00:00.000Z"));

    await expect(service.setType("reader_owner", request)).resolves.toMatchObject({ ...request, status: "committed",
      operationId: "op_20260801_entitytype1", render: { entityType: { entityType: "person", canChange: true } } });
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.stringMatching(/^noteeditreq_[a-f0-9]{32}$/u),
      expectedRevisionId: `sha256:${"a".repeat(64)}`, markdown: expect.stringContaining('entity_type: "person"') }));
    expect(save.mock.calls[0]?.[0].markdown).toContain("Keep this body unchanged.");
  });

  it("fails closed before mutation for drift, no change, malformed truth, or a non-Entity page", async () => {
    const save = vi.fn(() => ({ status: "failed" as const }));
    const create = (assertCurrent: () => boolean, markdown = entityMarkdown("other")) => new EntityTypeService({
      resolveManagedPageTarget: vi.fn(() => ({ status: "ready", pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent })),
      render: vi.fn() } as never, { open: vi.fn(() => ({ ...openedEntity(), markdown })), save } as never);
    await expect(create(() => false).setType("reader_owner", request)).resolves.toEqual({ ...request, status: "stale" });
    await expect(create(() => true, entityMarkdown("person")).setType("reader_owner", request)).resolves.toEqual({ ...request, status: "ineligible" });
    await expect(create(() => true, entityMarkdown("other").replace("  identifiers: []", "  entity_type: person\n  identifiers: []"))
      .setType("reader_owner", request)).resolves.toEqual({ ...request, status: "ineligible" });
    await expect(create(() => true, entityMarkdown("other").replace('type: "entity"', 'type: "note"'))
      .setType("reader_owner", request)).resolves.toEqual({ ...request, status: "ineligible" });
    expect(save).not.toHaveBeenCalled();
  });

  it("parses only the frozen Entity type vocabulary and preserves unrelated Markdown", () => {
    expect(readEntityType(frontmatter("organization"))).toBe("organization");
    expect(readEntityType(frontmatter("company"))).toBeUndefined();
    expect(updateEntityTypeMarkdown(entityMarkdown("other"), "project", "2026-08-01T13:00:00.000Z"))
      .toBe(entityMarkdown("project").replace("updated_at: 2026-08-01T10:00:00.000Z", "updated_at: 2026-08-01T13:00:00.000Z"));
  });
});

function openedEntity() { return { status: "opened" as const, revisionId: `sha256:${"a".repeat(64)}`,
  renderIdentity: `sha256:${"b".repeat(64)}`, markdown: entityMarkdown("other") }; }
function entityRender(entityType: "person" | "other") { return { summary: { pageId: request.currentPageId, title: "Entity",
  pageType: "entity" as const, status: "active" as const, pagePath: "entities/entity.md",
  createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z", sourceIds: [] },
  html: "<h1>Entity</h1>", byteSize: 128, renderContextId: "notectx_fedcba9876543210fedcba9876543210",
  entityType: { entityType, canChange: true, revision: `noteeditrev_${"b".repeat(64)}` } }; }
function frontmatter(entityType: string) { return `id: "${request.currentPageId}"
schema_version: 1
title: "Entity"
type: "entity"
created_at: 2026-08-01T10:00:00.000Z
updated_at: 2026-08-01T10:00:00.000Z
status: "active"
aliases: []
source_ids: []
entity:
  entity_type: "${entityType}"
  canonical_name: "Entity"
  identifiers: []
`; }
function entityMarkdown(entityType: string) { return `---\n${frontmatter(entityType)}---\n\n# Entity\n\nKeep this body unchanged.\n`; }
