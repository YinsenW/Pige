import { describe, expect, it } from "vitest";
import type { AgentRuntimePolicyContext } from "@pige/contracts";
import type { SourceRecord } from "@pige/schemas";
import {
  applyOcrSummaryEvidencePolicy,
  LOW_CONFIDENCE_OCR_THRESHOLD
} from "../../apps/desktop/src/main/services/ocr-summary-evidence-policy";
import type { EvidencePack } from "../../apps/desktop/src/main/services/evidence-assembly-service";

const source = (confidence: number): SourceRecord => ({
  metadata: { ocrConfidence: confidence }
} as SourceRecord);

const policy = (excludeLowConfidenceOcrFromSummaries: boolean): AgentRuntimePolicyContext => ({
  localCapabilities: { excludeLowConfidenceOcrFromSummaries }
} as AgentRuntimePolicyContext);

const evidence: EvidencePack = {
  sourceId: "src_20260801_abcdefghijkl",
  fragments: [{
    ref: "ev_01",
    artifactId: "art_native",
    artifactKind: "extracted_text",
    locator: "page:1",
    citationLocator: "p1",
    text: "Native text",
    characterStart: 0,
    characterEnd: 11
  }, {
    ref: "ev_02",
    artifactId: "art_ocr",
    artifactKind: "ocr",
    locator: "page:2/ocr:block:1",
    citationLocator: "p2-ocr1",
    text: "Uncertain OCR",
    characterStart: 0,
    characterEnd: 13,
    confidence: 0.41
  }],
  artifactIds: ["art_native", "art_ocr"],
  characterCount: 24,
  truncated: false,
  warnings: []
};

describe("OCR summary evidence policy", () => {
  it("removes only OCR fragments below the frozen confidence threshold", () => {
    const filtered = applyOcrSummaryEvidencePolicy(source(0.41), evidence, policy(true));
    expect(filtered.fragments.map((fragment) => fragment.ref)).toEqual(["ev_01"]);
    expect(filtered.artifactIds).toEqual(["art_native"]);
    expect(filtered.characterCount).toBe(11);
    expect(filtered.warnings).toContain("low_confidence_ocr_excluded");
  });

  it("keeps evidence when disabled or at the confidence boundary", () => {
    expect(applyOcrSummaryEvidencePolicy(source(0.1), evidence, policy(false))).toBe(evidence);
    expect(applyOcrSummaryEvidencePolicy(source(LOW_CONFIDENCE_OCR_THRESHOLD), evidence, policy(true))).toBe(evidence);
  });
});
