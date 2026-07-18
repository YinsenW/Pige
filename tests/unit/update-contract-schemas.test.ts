import { describe, expect, it } from "vitest";
import {
  UpdateCheckRequestSchema,
  UpdateCheckResultSchema,
  UpdateStatusEventSchema,
  UpdateSummarySchema
} from "@pige/schemas";

const requestId = `updatereq_${"a".repeat(16)}`;

describe("update contract schemas", () => {
  it("accepts strict body-free summaries, requests, results, and events", () => {
    const summary = UpdateSummarySchema.parse({
      apiVersion: 1,
      revision: 3,
      channel: "alpha",
      capability: "packaged_ready",
      phase: "available",
      currentVersion: "0.1.0-alpha.1",
      availableVersion: "0.1.0-alpha.2",
      checkedAt: "2026-07-18T08:00:00.000Z"
    });
    expect(summary.phase).toBe("available");
    expect(UpdateCheckRequestSchema.parse({ apiVersion: 1, requestId })).toEqual({ apiVersion: 1, requestId });
    expect(UpdateCheckResultSchema.parse({ status: "checked", requestId, summary }).summary).toEqual(summary);
    expect(UpdateStatusEventSchema.parse({
      apiVersion: 1,
      requestId,
      sequence: 1,
      summary
    }).sequence).toBe(1);
  });

  it("rejects feed URLs, paths, error bodies, malformed identities, and inconsistent states", () => {
    const idle = {
      apiVersion: 1,
      revision: 0,
      channel: "alpha",
      capability: "development",
      phase: "idle",
      currentVersion: "0.0.0"
    } as const;
    expect(UpdateSummarySchema.safeParse({ ...idle, feedUrl: "https://updates.example.invalid/latest.yml" }).success)
      .toBe(false);
    expect(UpdateSummarySchema.safeParse({ ...idle, path: "/private/update.zip" }).success).toBe(false);
    expect(UpdateSummarySchema.safeParse({ ...idle, phase: "available" }).success).toBe(false);
    expect(UpdateCheckRequestSchema.safeParse({ apiVersion: 1, requestId: "update", body: "private" }).success)
      .toBe(false);
    expect(UpdateCheckResultSchema.safeParse({
      status: "unavailable",
      requestId,
      summary: idle,
      error: { message: "network body" }
    }).success).toBe(false);
    expect(UpdateStatusEventSchema.safeParse({
      apiVersion: 1,
      requestId,
      sequence: 0,
      summary: idle
    }).success).toBe(false);
  });
});
