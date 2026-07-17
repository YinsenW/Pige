import { PigeDomainError } from "@pige/domain";

export type HomeAgentEvidenceKind =
  | "current_note"
  | "dataset_catalog"
  | "dataset_result"
  | "local_search"
  | "url_receipt"
  | "url_source";

export class HomeAgentEvidenceLedger {
  readonly #producedAtModelTurn = new Map<HomeAgentEvidenceKind, number>();

  record(kind: HomeAgentEvidenceKind, modelTurn: number): void {
    this.#producedAtModelTurn.set(kind, modelTurn);
  }

  has(kind: HomeAgentEvidenceKind): boolean {
    return this.#producedAtModelTurn.has(kind);
  }

  assertVisible(kind: HomeAgentEvidenceKind, currentModelTurn: number): void {
    const producedAt = this.#producedAtModelTurn.get(kind);
    if (producedAt === undefined || currentModelTurn <= producedAt) {
      throw new PigeDomainError(
        "agent_runtime.evidence_not_visible",
        "The selected evidence must be consumed by a later model turn before it can authorize another action."
      );
    }
  }
}
