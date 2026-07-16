import { describe, expect, it } from "vitest";
import {
  SpeechAvailabilityResultSchema,
  SpeechCancelRequestSchema,
  SpeechCancelResultSchema,
  SpeechSessionEventSchema,
  SpeechStartRequestSchema,
  SpeechStartResultSchema
} from "@pige/schemas";

describe("speech contract schemas", () => {
  it("accepts only bounded body-free requests and results", () => {
    expect(SpeechStartRequestSchema.parse({
      requestId: `speechreq_${"a".repeat(16)}`,
      languageTag: "zh-Hans"
    })).toEqual({ requestId: `speechreq_${"a".repeat(16)}`, languageTag: "zh-Hans" });
    expect(SpeechStartRequestSchema.safeParse({
      requestId: `speechreq_${"a".repeat(16)}`,
      languageTag: "en-US",
      audio: "private bytes"
    }).success).toBe(false);
    expect(SpeechStartResultSchema.parse({
      status: "started",
      requestId: `speechreq_${"b".repeat(16)}`,
      sessionId: `speech_${"c".repeat(16)}`,
      languageTag: "en-US",
      metering: "available"
    }).metering).toBe("available");
    expect(SpeechCancelRequestSchema.parse({ requestId: `speechreq_${"d".repeat(16)}` }))
      .toEqual({ requestId: `speechreq_${"d".repeat(16)}` });
    expect(SpeechCancelRequestSchema.safeParse({
      requestId: `speechreq_${"d".repeat(16)}`,
      sessionId: `speech_${"e".repeat(16)}`
    }).success).toBe(false);
    expect(SpeechCancelResultSchema.parse({
      status: "canceled",
      requestId: `speechreq_${"d".repeat(16)}`
    }).status).toBe("canceled");
    expect(SpeechAvailabilityResultSchema.safeParse({
      status: "supported",
      languageTag: "en-US",
      permission: "not_determined",
      canOpenSystemSettings: true
    }).success).toBe(false);
    expect(SpeechAvailabilityResultSchema.safeParse({
      status: "failed",
      error: {
        code: "speech.availability_failed",
        domain: "speech",
        messageKey: "errors.speech.availability_failed",
        retryable: true,
        severity: "warning",
        userAction: "retry",
        redactedDetails: { rawError: "/private/path" }
      }
    }).success).toBe(false);
  });

  it("bounds transcript and body-free metering events", () => {
    const sessionId = `speech_${"d".repeat(16)}`;
    expect(SpeechSessionEventSchema.parse({
      apiVersion: 1,
      kind: "meter",
      sessionId,
      sequence: 1,
      elapsedMs: 125,
      level: 0.42
    })).toMatchObject({ kind: "meter", level: 0.42 });
    expect(SpeechSessionEventSchema.safeParse({
      apiVersion: 1,
      kind: "meter",
      sessionId,
      sequence: 2,
      elapsedMs: 250,
      level: 1.1
    }).success).toBe(false);
    expect(SpeechSessionEventSchema.safeParse({
      apiVersion: 1,
      kind: "transcript_replace",
      sessionId,
      sequence: 3,
      transcript: "x".repeat(32_001),
      final: false
    }).success).toBe(false);
  });
});
