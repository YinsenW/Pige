import { describe, expect, it } from "vitest";
import {
  OcrEnginePreferenceResultSchema,
  SetOcrEnginePreferenceRequestSchema,
  SetOcrEnginePreferenceResultSchema
} from "@pige/schemas";

const requestId = "ocrenginereq_abcdefghijklmnop";

describe("OCR engine preference schemas", () => {
  it("accepts only the bounded engine choices and closed result shapes", () => {
    expect(SetOcrEnginePreferenceRequestSchema.parse({
      apiVersion: 1,
      requestId,
      expectedRevision: 0,
      preference: "paddleocr_local"
    })).toMatchObject({ preference: "paddleocr_local" });
    expect(() => SetOcrEnginePreferenceRequestSchema.parse({
      apiVersion: 1,
      requestId,
      expectedRevision: 0,
      preference: "arbitrary_binary"
    })).toThrow();

    const ready = {
      apiVersion: 1,
      requestId,
      status: "ready",
      summary: {
        apiVersion: 1,
        revision: 0,
        preference: "automatic",
        appliesTo: "new_ocr_jobs"
      }
    } as const;
    expect(OcrEnginePreferenceResultSchema.parse(ready)).toEqual(ready);
    expect(SetOcrEnginePreferenceResultSchema.parse({
      ...ready,
      status: "stale"
    })).toMatchObject({ status: "stale", summary: { preference: "automatic" } });
    expect(() => OcrEnginePreferenceResultSchema.parse({
      ...ready,
      summary: { ...ready.summary, path: "/private/ocr" }
    })).toThrow();
  });
});
