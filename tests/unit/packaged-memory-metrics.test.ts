import { describe, expect, it } from "vitest";

import { samplePackagedAppMemory } from "../../apps/desktop/src/main/services/packaged-memory-metrics";

describe("packaged application memory metrics", () => {
  it("sums every Electron app process working set and reports bounded type counts", () => {
    expect(samplePackagedAppMemory([
      metric(1, "Browser", 64 * 1024),
      metric(2, "Tab", 48 * 1024),
      metric(3, "GPU", 24 * 1024),
      metric(4, "Sandbox helper", 8 * 1024),
      metric(5, "Utility", 4 * 1024)
    ])).toEqual({
      residentBytes: 148 * 1024 * 1024,
      processCount: 5,
      processTypeCounts: {
        Browser: 1,
        GPU: 1,
        Tab: 1,
        "Sandbox helper": 1,
        Utility: 1
      }
    });
  });

  it("fails closed for missing, malformed, or unbounded Electron metrics", () => {
    expect(() => samplePackagedAppMemory([])).toThrow("unavailable");
    expect(() => samplePackagedAppMemory([
      metric(1, "", 1)
    ])).toThrow("invalid process record");
    expect(() => samplePackagedAppMemory([
      metric(1, "Browser", Number.NaN)
    ])).toThrow("invalid process record");
    expect(() => samplePackagedAppMemory([
      metric(1, "Browser", Number.MAX_SAFE_INTEGER)
    ])).toThrow("invalid process record");
    expect(() => samplePackagedAppMemory([
      metric(1, "Browser", 16 * 1024 * 1024 + 1)
    ])).toThrow("invalid process record");
    expect(() => samplePackagedAppMemory([
      { ...metric(1, "Browser", 1), pid: 0 }
    ])).toThrow("invalid process record");
    expect(() => samplePackagedAppMemory([
      { ...metric(1, "Browser", 1), creationTime: Number.NaN }
    ])).toThrow("invalid process record");
    expect(() => samplePackagedAppMemory([
      metric(1, "Browser", 1),
      metric(1, "Tab", 1)
    ])).toThrow("duplicate process identity");
  });
});

function metric(pid: number, type: string, workingSetSize: number) {
  return {
    pid,
    creationTime: 1_788_000_000_000 + pid,
    type,
    memory: { workingSetSize }
  };
}
