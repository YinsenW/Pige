import { describe, expect, it } from "vitest";
import {
  UpdateApplyRequestSchema,
  UpdateApplyResultSchema,
  UpdateCheckRequestSchema,
  UpdateCheckResultSchema,
  UpdateDownloadRequestSchema,
  UpdateDownloadResultSchema,
  UpdateMachineSettingsSchema,
  UpdateStatusEventSchema,
  UpdateSummarySchema
} from "@pige/schemas";

const requestId = `updatereq_${"a".repeat(16)}`;
const downloadRequestId = `updatedownloadreq_${"b".repeat(16)}`;
const applyRequestId = `updateapplyreq_${"c".repeat(16)}`;

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

  it("binds download and apply to the exact authoritative revision and version", () => {
    const available = UpdateSummarySchema.parse({
      apiVersion: 1,
      revision: 4,
      channel: "alpha",
      capability: "packaged_ready",
      phase: "available",
      currentVersion: "0.1.0-alpha.1",
      availableVersion: "0.1.0-alpha.2",
      checkedAt: "2026-07-29T08:00:00.000Z"
    });
    const download = UpdateDownloadRequestSchema.parse({
      apiVersion: 1,
      requestId: downloadRequestId,
      expectedRevision: 4,
      version: "0.1.0-alpha.2"
    });
    expect(UpdateDownloadResultSchema.parse({
      status: "started",
      requestId: download.requestId,
      version: download.version,
      summary: { ...available, phase: "downloading", progressPercent: 0 }
    }).status).toBe("started");

    const apply = UpdateApplyRequestSchema.parse({
      apiVersion: 1,
      requestId: applyRequestId,
      expectedRevision: 5,
      version: "0.1.0-alpha.2"
    });
    expect(UpdateApplyResultSchema.parse({
      status: "restarting",
      requestId: apply.requestId,
      version: apply.version,
      summary: {
        ...available,
        revision: 6,
        phase: "applying",
        readyAt: "2026-07-29T08:01:00.000Z"
      }
    }).status).toBe("restarting");
  });

  it("persists only an exact checked-version lifecycle and exposes no updater internals", () => {
    const settings = {
      revision: 5,
      channel: "alpha",
      lastCheck: {
        phase: "available",
        availableVersion: "0.1.0-alpha.2",
        checkedAt: "2026-07-29T08:00:00.000Z"
      },
      lifecycle: {
        phase: "ready_to_restart",
        version: "0.1.0-alpha.2",
        readyAt: "2026-07-29T08:01:00.000Z"
      }
    } as const;
    expect(UpdateMachineSettingsSchema.parse(settings)).toEqual(settings);
    expect(() => UpdateMachineSettingsSchema.parse({
      ...settings,
      lifecycle: { ...settings.lifecycle, version: "0.1.0-alpha.3" }
    })).toThrow();
    expect(() => UpdateDownloadRequestSchema.parse({
      apiVersion: 1,
      requestId: downloadRequestId,
      expectedRevision: 4,
      version: "0.1.0-alpha.2",
      feedUrl: "https://private.invalid/latest-mac.yml"
    })).toThrow();
    expect(() => UpdateApplyResultSchema.parse({
      status: "failed",
      requestId: applyRequestId,
      version: "0.1.0-alpha.2",
      summary: { apiVersion: 1 },
      path: "/private/update.zip"
    })).toThrow();
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
