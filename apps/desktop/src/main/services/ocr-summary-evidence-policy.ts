import type { AgentRuntimePolicyContext } from "@pige/contracts";
import type { SourceRecord } from "@pige/schemas";
import type { EvidencePack } from "./evidence-assembly-service";

export const LOW_CONFIDENCE_OCR_THRESHOLD = 0.65;

export function applyOcrSummaryEvidencePolicy(
  sourceRecord: SourceRecord,
  evidencePack: EvidencePack,
  policy: AgentRuntimePolicyContext
): EvidencePack {
  const confidence = normalizedConfidence(sourceRecord.metadata.ocrConfidence);
  if (
    !policy.localCapabilities.excludeLowConfidenceOcrFromSummaries ||
    confidence === undefined ||
    confidence >= LOW_CONFIDENCE_OCR_THRESHOLD
  ) {
    return evidencePack;
  }
  const fragments = evidencePack.fragments.filter((fragment) => fragment.artifactKind !== "ocr");
  if (fragments.length === evidencePack.fragments.length) return evidencePack;
  return {
    ...evidencePack,
    fragments,
    artifactIds: Array.from(new Set(fragments.map((fragment) => fragment.artifactId))),
    characterCount: fragments.reduce((total, fragment) => total + fragment.text.length, 0),
    warnings: Array.from(new Set([...evidencePack.warnings, "low_confidence_ocr_excluded"]))
  };
}

function normalizedConfidence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}
