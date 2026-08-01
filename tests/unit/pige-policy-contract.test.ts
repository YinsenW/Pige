import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PigePolicySummarySchema,
  PigePolicyUpdateRequestSchema,
  PigePolicyUpdateResultSchema
} from "@pige/schemas";

const markdown = `# PIGE

## Vault Identity
## Page Types
## Naming Rules
## Frontmatter Rules
## Link Rules
## Source Handling Rules
## Agent Review Rules
## Prompt Injection Rules
`;
const summary = {
  apiVersion: 1 as const,
  activeVaultId: "vault_20260801_abcdef",
  revision: `pigepolicyrev_${"a".repeat(64)}`,
  markdown,
  requiredSections: ["Vault Identity", "Page Types", "Naming Rules", "Frontmatter Rules", "Link Rules", "Source Handling Rules", "Agent Review Rules", "Prompt Injection Rules"],
  canEdit: true as const
};

describe("PIGE.md policy contract", () => {
  it("accepts only bounded pathless active-vault summaries and revision-fenced updates", () => {
    expect(PigePolicySummarySchema.parse(summary)).toEqual(summary);
    const request = PigePolicyUpdateRequestSchema.parse({
      apiVersion: 1,
      requestId: "pigepolicyreq_abcdefghijklmnop",
      activeVaultId: summary.activeVaultId,
      expectedRevision: summary.revision,
      markdown
    });
    expect(PigePolicyUpdateResultSchema.parse({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "invalid",
      summary,
      issues: ["missing_required_section"]
    }).status).toBe("invalid");
    expect(PigePolicySummarySchema.safeParse({ ...summary, path: "/private/vault/PIGE.md" }).success).toBe(false);
    expect(PigePolicyUpdateRequestSchema.safeParse({ ...request, markdown: "x".repeat(65_537) }).success).toBe(false);
    expect(PigePolicyUpdateResultSchema.safeParse({
      apiVersion: 1,
      requestId: request.requestId,
      activeVaultId: request.activeVaultId,
      status: "failed",
      summary
    }).success).toBe(false);
  });

  it("keeps the public API typed and the renderer behind strict preload parsing", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const contracts = fs.readFileSync(path.join(root, "packages/contracts/src/index.ts"), "utf8");
    const preload = fs.readFileSync(path.join(root, "apps/desktop/src/preload/index.ts"), "utf8");
    expect(contracts).toContain("readonly pigePolicy: () => Promise<PigePolicySummary>");
    expect(contracts).toContain("readonly updatePigePolicy: (request: PigePolicyUpdateRequest)");
    expect(preload).toContain("PigePolicyUpdateRequestSchema.parse(request)");
    expect(preload).toContain("PigePolicyUpdateResultSchema.parse");
  });
});
