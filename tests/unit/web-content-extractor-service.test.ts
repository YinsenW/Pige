import { describe, expect, it } from "vitest";
import { WebContentExtractorWorkerAdapter } from "../../apps/desktop/src/main/services/web-content-extractor-service";

describe("web content extractor worker adapter", () => {
  it("reports bundled dependency availability without exposing module paths", () => {
    const available = new WebContentExtractorWorkerAdapter(
      new URL("file:///unused-web-worker.js"),
      100,
      (moduleId) => `/private/modules/${moduleId}`
    );
    const unavailable = new WebContentExtractorWorkerAdapter(
      new URL("file:///unused-web-worker.js"),
      100,
      () => { throw new Error("missing"); }
    );

    expect(available.isAvailable()).toBe(true);
    expect(unavailable.isAvailable()).toBe(false);
  });

  it("bounds pending extraction requests before spawning unbounded workers", async () => {
    const adapter = new WebContentExtractorWorkerAdapter(
      new URL("file:///missing-pige-web-worker.js"),
      100,
      () => "/resolved"
    );
    const queued = Array.from({ length: 8 }, () => adapter.extract("<main>text</main>", "https://example.com"));

    await expect(adapter.extract("<main>overflow</main>", "https://example.com")).rejects.toMatchObject({
      code: "web_extractor.busy"
    });
    const results = await Promise.allSettled(queued);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
  });
});
