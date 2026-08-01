import { describe, expect, it, vi } from "vitest";
import { UpdateManualDownloadRequestSchema, UpdateManualDownloadResultSchema } from "@pige/schemas";
import {
  ManualUpdateDownloadService,
  PIGE_MANUAL_DOWNLOAD_URL
} from "../../apps/desktop/src/main/services/manual-update-download-service";

describe("manual update download service", () => {
  it("keeps renderer requests and results URL-free and strict", () => {
    const request = { apiVersion: 1, requestId: `updatemanualreq_${"a".repeat(16)}` } as const;
    expect(UpdateManualDownloadRequestSchema.parse(request)).toEqual(request);
    expect(() => UpdateManualDownloadRequestSchema.parse({ ...request, url: "https://attacker.invalid" })).toThrow();
    expect(() => UpdateManualDownloadResultSchema.parse({ ...request, status: "opened", url: "https://example.invalid" })).toThrow();
  });

  it("opens only the fixed canonical Releases page and echoes the exact request", async () => {
    const openExternal = vi.fn(async () => undefined);
    const service = new ManualUpdateDownloadService(openExternal);
    const request = { apiVersion: 1, requestId: `updatemanualreq_${"a".repeat(16)}` } as const;

    await expect(service.open(request)).resolves.toEqual({ ...request, status: "opened" });
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(PIGE_MANUAL_DOWNLOAD_URL);
  });

  it("single-flights external opens and collapses private failures", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const openExternal = vi.fn(async () => pending);
    const service = new ManualUpdateDownloadService(openExternal);
    const firstRequest = { apiVersion: 1, requestId: `updatemanualreq_${"b".repeat(16)}` } as const;
    const secondRequest = { apiVersion: 1, requestId: `updatemanualreq_${"c".repeat(16)}` } as const;
    const first = service.open(firstRequest);
    await expect(service.open(secondRequest)).resolves.toEqual({ ...secondRequest, status: "busy" });
    expect(openExternal).toHaveBeenCalledOnce();
    release();
    await expect(first).resolves.toEqual({ ...firstRequest, status: "opened" });

    const failing = new ManualUpdateDownloadService(async () => {
      throw new Error("browser failed at /Users/private with token=secret");
    });
    const result = await failing.open(firstRequest);
    expect(result).toEqual({ ...firstRequest, status: "failed" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
