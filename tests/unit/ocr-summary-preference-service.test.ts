import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OcrSummaryPreferenceService } from "../../apps/desktop/src/main/services/ocr-summary-preference-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("OCR summary preference service", () => {
  it("defaults safe, persists a CAS mutation, and returns authoritative stale state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-ocr-summary-preference-"));
    roots.push(root);
    const service = new OcrSummaryPreferenceService(root);

    const initial = service.read({ apiVersion: 1, requestId: `ocrsummaryreq_${"a".repeat(16)}` });
    expect(initial).toMatchObject({
      status: "ready",
      summary: { revision: 0, excludeLowConfidenceOcr: true, appliesTo: "new_agent_jobs" }
    });

    const committed = service.set({
      apiVersion: 1,
      requestId: `ocrsummaryreq_${"b".repeat(16)}`,
      expectedRevision: 0,
      excludeLowConfidenceOcr: false
    });
    expect(committed).toMatchObject({
      status: "committed",
      summary: { revision: 1, excludeLowConfidenceOcr: false }
    });
    expect(new OcrSummaryPreferenceService(root).excludeLowConfidenceOcr()).toBe(false);

    const stale = service.set({
      apiVersion: 1,
      requestId: `ocrsummaryreq_${"c".repeat(16)}`,
      expectedRevision: 0,
      excludeLowConfidenceOcr: true
    });
    expect(stale).toMatchObject({
      status: "stale",
      summary: { revision: 1, excludeLowConfidenceOcr: false }
    });
  });

  it("fails closed when the persisted setting is malformed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-ocr-summary-preference-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "ocr-summary-preference.json"), "{}\n");
    const service = new OcrSummaryPreferenceService(root);
    expect(service.read({ apiVersion: 1, requestId: `ocrsummaryreq_${"d".repeat(16)}` }).status).toBe("failed");
    expect(() => service.excludeLowConfidenceOcr()).toThrow();
  });
});
