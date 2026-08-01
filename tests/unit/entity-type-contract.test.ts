import { describe, expect, it } from "vitest";
import { NOTE_SET_ENTITY_TYPE_CHANNEL, NoteEntityTypeSummarySchema, NoteSetEntityTypeRequestSchema,
  NoteSetEntityTypeResultSchema } from "@pige/schemas";

describe("Entity type contract", () => {
  it("keeps one exact pathless Entity type mutation bounded to the Reader revision", () => {
    expect(NOTE_SET_ENTITY_TYPE_CHANNEL).toBe("notes.setEntityType");
    const request = { apiVersion: 1 as const, requestId: "noteentitytypereq_abcdefghijklmnop",
      activeVaultId: "vault_20260801_entity", currentPageId: "page_20260801_entity01",
      renderContextId: "notectx_0123456789abcdef0123456789abcdef",
      expectedRevision: `noteeditrev_${"a".repeat(64)}`, entityType: "organization" as const };
    expect(NoteSetEntityTypeRequestSchema.parse(request)).toEqual(request);
    expect(NoteEntityTypeSummarySchema.parse({ entityType: "organization", canChange: true,
      revision: request.expectedRevision })).toMatchObject({ entityType: "organization" });
    for (const status of ["stale", "not_found", "ineligible", "failed"] as const) {
      expect(NoteSetEntityTypeResultSchema.parse({ ...request, status })).toEqual({ ...request, status });
    }
    expect(() => NoteSetEntityTypeRequestSchema.parse({ ...request, path: "/private/entity.md" })).toThrow();
    expect(() => NoteSetEntityTypeRequestSchema.parse({ ...request, entityType: "company" })).toThrow();
  });
});
