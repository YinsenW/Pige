import { describe, expect, it, vi } from "vitest";
import { EntityIdentifierService } from "../../apps/desktop/src/main/services/entity-identifier-service";

const owner = { apiVersion: 1 as const, requestId: "entityidentifierreq_abcdefghijklmnop",
  activeVaultId: "vault_20260801_entity", currentPageId: "page_20260801_entity01",
  renderContextId: "notectx_0123456789abcdef0123456789abcdef",
  expectedRevision: `noteeditrev_${"a".repeat(64)}` };

describe("EntityIdentifierService", () => {
  it("reads then adds and removes one canonical Entity identifier through the reversible editor", async () => {
    const assertCurrent = vi.fn(() => true);
    let markdown = entityMarkdown();
    const save = vi.fn((input: { markdown: string }) => { markdown = input.markdown; return { status: "committed" as const, operationId: "op_20260801_entityidentifier1" }; });
    const service = new EntityIdentifierService(targets(assertCurrent), { open: vi.fn(() => ({ ...openedEntity(), markdown })), save } as never,
      () => new Date("2026-08-01T12:00:00.000Z"));

    expect(service.read("reader_owner", owner)).toMatchObject({ ...owner, status: "ready", identifiers: ["wikidata:Q42"], canEdit: true });
    await expect(service.change("reader_owner", { ...owner, action: "add", identifier: "orcid:0000-0002-1825-0097" }))
      .resolves.toMatchObject({ status: "committed", operationId: "op_20260801_entityidentifier1", render: { summary: { pageId: owner.currentPageId } } });
    await expect(service.change("reader_owner", { ...owner, requestId: "entityidentifierreq_bcdefghijklmnopq", action: "remove", identifier: "wikidata:Q42" }))
      .resolves.toMatchObject({ status: "committed" });

    expect(save).toHaveBeenNthCalledWith(1, expect.objectContaining({ requestId: expect.stringMatching(/^noteeditreq_[a-f0-9]{32}$/u),
      expectedRevisionId: `sha256:${"a".repeat(64)}`, markdown: expect.stringContaining('identifiers:\n    - "wikidata:Q42"\n    - "orcid:0000-0002-1825-0097"') }));
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ markdown: expect.stringContaining('identifiers:\n    - "orcid:0000-0002-1825-0097"') }));
    expect(save.mock.calls[0]?.[0].markdown).toContain("Keep this body unchanged.");
    expect(assertCurrent).toHaveBeenCalled();
  });

  it("fails closed before mutation when the Entity or its currentness is invalid", async () => {
    const save = vi.fn();
    const create = (assertCurrent: () => boolean, markdown = entityMarkdown()) => new EntityIdentifierService(targets(assertCurrent),
      { open: vi.fn(() => ({ ...openedEntity(), markdown })), save } as never);
    await expect(create(() => false).change("reader_owner", { ...owner, action: "add", identifier: "wikidata:Q1" }))
      .resolves.toEqual({ ...owner, action: "add", identifier: "wikidata:Q1", status: "stale" });
    await expect(create(() => true, entityMarkdown().replace('type: "entity"', 'type: "note"')).change("reader_owner", { ...owner, action: "add", identifier: "wikidata:Q1" }))
      .resolves.toEqual({ ...owner, action: "add", identifier: "wikidata:Q1", status: "ineligible" });
    await expect(create(() => true).change("reader_owner", { ...owner, action: "remove", identifier: "wikidata:Q1" }))
      .resolves.toEqual({ ...owner, action: "remove", identifier: "wikidata:Q1", status: "ineligible" });
    expect(save).not.toHaveBeenCalled();
  });
});

function targets(assertCurrent: () => boolean) { return { resolveManagedPageTarget: vi.fn(() => ({ status: "ready" as const,
  pageContentHash: `sha256:${"a".repeat(64)}`, assertCurrent })), render: vi.fn(async () => ({ summary: { pageId: owner.currentPageId,
  title: "Entity", pageType: "entity" as const, status: "active" as const, pagePath: "entities/entity.md", createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z", sourceIds: [] }, html: "<h1>Entity</h1>", byteSize: 128,
  renderContextId: "notectx_fedcba9876543210fedcba9876543210" })) }; }
function openedEntity() { return { status: "opened" as const, revisionId: `sha256:${"a".repeat(64)}`,
  renderIdentity: `sha256:${"b".repeat(64)}`, markdown: entityMarkdown() }; }
function entityMarkdown() { return `---\nid: "${owner.currentPageId}"\nschema_version: 1\ntitle: "Entity"\ntype: "entity"\ncreated_at: 2026-08-01T10:00:00.000Z\nupdated_at: 2026-08-01T10:00:00.000Z\nstatus: "active"\naliases: []\nsource_ids: []\nentity:\n  entity_type: "other"\n  canonical_name: "Entity"\n  identifiers:\n    - "wikidata:Q42"\n---\n\n# Entity\n\nKeep this body unchanged.\n`; }
