import { describe, expect, it } from "vitest";
import { createFormulaUpdateMutationIdentity } from "../../apps/desktop/src/main/services/managed-collection-formula-update-storage";

describe("managed collection formula update storage", () => {
  it("binds deterministic revision and Operation identities to the request while retaining canonical AST identity", () => {
    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_formulaupdateidentity",
      activeVaultId: "vault_20260729_formulaupdate",
      datasetId: "dataset_20260729_formulaupdate",
      tableId: "table_formulaupdate1234",
      columnId: "column_formulaupdate12",
      expectedRevisionId: "dataset_rev_20260729_formulaupdate1234",
      expression: {
        kind: "binary" as const,
        operator: "multiply" as const,
        left: { kind: "column" as const, columnId: "column_operandleft123" },
        right: { kind: "literal" as const, value: 2 }
      }
    };
    const identity = createFormulaUpdateMutationIdentity(request);
    expect(createFormulaUpdateMutationIdentity(request)).toEqual(identity);
    expect(identity).toMatchObject({
      revisionId: expect.stringMatching(/^dataset_rev_20260729_[a-f0-9]{20}$/u),
      operationId: expect.stringMatching(/^op_20260729_[a-f0-9]{20}$/u),
      expressionIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
    });
    expect(createFormulaUpdateMutationIdentity({
      ...request,
      expression: { ...request.expression, right: { kind: "literal", value: 3 } }
    })).toMatchObject({
      revisionId: identity.revisionId,
      operationId: identity.operationId,
      expressionIdentity: expect.not.stringMatching(identity.expressionIdentity)
    });
  });
});
