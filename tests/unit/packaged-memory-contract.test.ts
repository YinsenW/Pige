import { describe, expect, it } from "vitest";

import {
  evaluatePackagedMemoryEvidence,
  PACKAGED_MEMORY_RECIPE
} from "../../scripts/release/packaged-memory-contract.mjs";

function samples(count: number, residentBytes: number, start = 0, spacing = 1_000) {
  return Array.from({ length: count }, (_value, index) => ({
    monotonicMs: start + index * spacing,
    residentBytes,
    processCount: 4,
    processTypeCounts: { Browser: 1, Tab: 1, Utility: 2 }
  }));
}

function actionTiming(start = 100_000) {
  return {
    count: 600,
    firstStartedAtMs: start,
    lastStartedAtMs: start + 599_000,
    minimumGapMs: 1_000,
    maximumGapMs: 1_000
  };
}

describe("packaged memory evidence contract", () => {
  it("accepts exact bounded idle, ordinary, heavy, and stable recovery evidence", () => {
    const result = evaluatePackagedMemoryEvidence({
      idleSettledAtMs: 0,
      idleSamples: samples(3, PACKAGED_MEMORY_RECIPE.idle.limitBytes - 1, 60_000, 5_000),
      ordinaryStartedAtMs: 100_000,
      ordinaryCompletedAtMs: 700_000,
      ordinarySamples: samples(600, PACKAGED_MEMORY_RECIPE.ordinary.limitBytes - 1, 100_000),
      ordinaryActions: { ...PACKAGED_MEMORY_RECIPE.ordinary.actions },
      ordinaryActionTiming: actionTiming(),
      heavy: {
        ...PACKAGED_MEMORY_RECIPE.heavy,
        invalidPageCount: 0,
        progressEventCount: 2
      },
      heavyCompletedAtMs: 800_000,
      recoverySamples: samples(60, PACKAGED_MEMORY_RECIPE.recovery.limitBytes - 1, 801_000)
    });

    expect(result).toMatchObject({
      status: "passed",
      idle: { sampleCount: 3, passed: true },
      ordinary: { sampleCount: 600, passed: true },
      heavy: {
        jobClass: "index_rebuild",
        terminalState: "completed",
        pageCount: 10_000,
        chunkCount: 100_000,
        progressEventCount: 2
      },
      recovery: { sampleCount: 60, stableAtSecond: 5, passed: true }
    });
  });

  it("uses strict idle/ordinary ceilings and requires stable recovery", () => {
    const result = evaluatePackagedMemoryEvidence({
      idleSamples: samples(3, PACKAGED_MEMORY_RECIPE.idle.limitBytes, 60_000, 5_000),
      idleSettledAtMs: 0,
      ordinaryStartedAtMs: 100_000,
      ordinaryCompletedAtMs: 700_000,
      ordinarySamples: samples(600, PACKAGED_MEMORY_RECIPE.ordinary.limitBytes, 100_000),
      ordinaryActions: { ...PACKAGED_MEMORY_RECIPE.ordinary.actions },
      ordinaryActionTiming: actionTiming(),
      heavy: {
        ...PACKAGED_MEMORY_RECIPE.heavy,
        invalidPageCount: 0,
        progressEventCount: 1
      },
      heavyCompletedAtMs: 800_000,
      recoverySamples: Array.from({ length: 60 }, (_value, index) => ({
        monotonicMs: 801_000 + index * 1_000,
        residentBytes: index % 5 === 4
          ? PACKAGED_MEMORY_RECIPE.recovery.limitBytes + 1
          : PACKAGED_MEMORY_RECIPE.recovery.limitBytes,
        processCount: 4,
        processTypeCounts: { Browser: 1, Tab: 1, Utility: 2 }
      }))
    });

    expect(result).toMatchObject({
      status: "failed",
      idle: { passed: false },
      ordinary: { passed: false },
      recovery: { stableAtSecond: null, passed: false }
    });
  });

  it("fails closed for missing samples, cadence gaps, identity changes, or incomplete heavy work", () => {
    const valid = {
      idleSettledAtMs: 0,
      idleSamples: samples(3, 1, 60_000, 5_000),
      ordinaryStartedAtMs: 100_000,
      ordinaryCompletedAtMs: 700_000,
      ordinarySamples: samples(600, 1, 100_000),
      ordinaryActions: { ...PACKAGED_MEMORY_RECIPE.ordinary.actions },
      ordinaryActionTiming: actionTiming(),
      heavy: {
        ...PACKAGED_MEMORY_RECIPE.heavy,
        invalidPageCount: 0,
        progressEventCount: 1
      },
      heavyCompletedAtMs: 800_000,
      recoverySamples: samples(60, 1, 801_000)
    };

    expect(() => evaluatePackagedMemoryEvidence({ ...valid, idleSamples: valid.idleSamples.slice(1) }))
      .toThrow("sample count");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      ordinarySamples: valid.ordinarySamples.map((sample, index) =>
        index === 2 ? { ...sample, monotonicMs: sample.monotonicMs + 3_000 } : sample)
    })).toThrow("cadence");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      recoverySamples: valid.recoverySamples.map((sample, index) => index === 10
        ? { ...sample, processTypeCounts: { Browser: 1, Utility: 3 } }
        : sample)
    })).toThrow("sample is invalid");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      idleSamples: samples(3, 1, 1_000, 5_000)
    })).toThrow("idle duration");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      ordinaryCompletedAtMs: 699_999
    })).toThrow("ordinary duration");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      ordinaryStartedAtMs: 69_000,
      ordinaryCompletedAtMs: 669_000,
      ordinarySamples: samples(600, 1, 69_000),
      ordinaryActionTiming: actionTiming(69_000)
    })).toThrow("idle duration");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      heavyCompletedAtMs: 699_999,
      recoverySamples: samples(60, 1, 700_000)
    })).toThrow("ordinary duration");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      recoverySamples: samples(60, 1, 799_000)
    })).toThrow("recovery duration");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      ordinaryActions: { ...valid.ordinaryActions, searchCount: 599 }
    })).toThrow("ordinary action evidence");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      ordinaryActions: { ...valid.ordinaryActions, rawBody: "not allowed" }
    })).toThrow("ordinary action evidence");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      ordinaryActionTiming: { ...valid.ordinaryActionTiming, minimumGapMs: 0 }
    })).toThrow("ordinary action cadence");
    expect(() => evaluatePackagedMemoryEvidence({
      ...valid,
      heavy: { ...valid.heavy, terminalState: "failed" }
    })).toThrow("heavy Job evidence");
  });

  it("does not accept recovery that first stabilizes after the sixty-second limit", () => {
    const recoverySamples = samples(60, PACKAGED_MEMORY_RECIPE.recovery.limitBytes + 1, 802_000);
    for (let index = 55; index < recoverySamples.length; index += 1) {
      recoverySamples[index] = {
        ...recoverySamples[index],
        residentBytes: PACKAGED_MEMORY_RECIPE.recovery.limitBytes
      };
    }
    const result = evaluatePackagedMemoryEvidence({
      idleSettledAtMs: 0,
      idleSamples: samples(3, 1, 60_000, 5_000),
      ordinaryStartedAtMs: 100_000,
      ordinaryCompletedAtMs: 700_000,
      ordinarySamples: samples(600, 1, 100_000),
      ordinaryActions: { ...PACKAGED_MEMORY_RECIPE.ordinary.actions },
      ordinaryActionTiming: actionTiming(),
      heavy: {
        ...PACKAGED_MEMORY_RECIPE.heavy,
        invalidPageCount: 0,
        progressEventCount: 1
      },
      heavyCompletedAtMs: 800_000,
      recoverySamples
    });

    expect(result.recovery).toMatchObject({ stableAtSecond: 61, passed: false });
    expect(result.status).toBe("failed");
  });
});
