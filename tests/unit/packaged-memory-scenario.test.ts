import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PackagedMemoryScenarioError,
  resolvePackagedMemoryScenarioFailureCode,
  runPackagedMemoryScenario,
  type PackagedMemoryOrdinaryActionResult
} from "../../apps/desktop/src/main/services/packaged-memory-scenario";
import { evaluatePackagedMemoryEvidence } from "../../scripts/release/packaged-memory-contract.mjs";

describe("packaged memory application scenario", () => {
  it("runs the exact idle, ordinary, heavy, and recovery sequence on one monotonic clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ordinaryIndexes: number[] = [];
    const pending = runPackagedMemoryScenario({
      now: () => Date.now(),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      sample: () => ({
        residentBytes: 100,
        processCount: 2,
        processTypeCounts: { Browser: 1, Tab: 1 }
      }),
      performOrdinaryAction: async (index) => {
        ordinaryIndexes.push(index);
        return ordinaryAction(index === 0 ? 1_024 : 0);
      },
      performHeavyWork: async () => {
        return heavyResult();
      }
    });
    await vi.advanceTimersByTimeAsync(730_000);
    const evidence = await pending;

    expect(evidence.idleSamples.map((sample) => sample.monotonicMs)).toEqual([60_000, 65_000, 70_000]);
    expect(evidence.ordinaryStartedAtMs).toBe(70_000);
    expect(evidence.ordinarySamples).toHaveLength(600);
    expect(evidence.ordinarySamples[0]?.monotonicMs).toBe(70_500);
    expect(evidence.ordinarySamples.at(-1)?.monotonicMs).toBe(669_500);
    expect(evidence.ordinaryCompletedAtMs).toBe(670_000);
    expect(evidence.ordinaryActions).toEqual({
      captureCount: 1,
      capturedBytes: 1_024,
      noteReadCount: 600,
      noteRenderCount: 600,
      searchCount: 600
    });
    expect(evidence.ordinaryActionTiming).toEqual({
      count: 600,
      firstStartedAtMs: 70_000,
      lastStartedAtMs: 669_000,
      minimumGapMs: 1_000,
      maximumGapMs: 1_000
    });
    expect(ordinaryIndexes).toEqual(Array.from({ length: 600 }, (_value, index) => index));
    expect(evidence.heavyCompletedAtMs).toBe(670_000);
    expect(evidence.recoverySamples[0]?.monotonicMs).toBe(671_000);
    expect(evidence.recoverySamples.at(-1)?.monotonicMs).toBe(730_000);
    expect(evaluatePackagedMemoryEvidence(evidence).status).toBe("passed");
  });

  it("fails closed for missing capture or invalid heavy completion evidence", async () => {
    await expectScenarioFailure(
      () => ordinaryAction(0),
      heavyResult(),
      "ordinary_evidence_invalid"
    );
    await expectScenarioFailure(
      (index) => ordinaryAction(index === 0 ? 1_024 : 0),
      { ...heavyResult(), progressEventCount: 0 },
      "heavy_evidence_invalid"
    );
  });

  it("fails closed when an ordinary action or heavy Job does not settle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const hungAction = runPackagedMemoryScenario({
      ...baseDependencies(),
      performOrdinaryAction: async () => new Promise<never>(() => undefined)
    });
    const actionAssertion = expect(hungAction).rejects.toThrow("ordinary_action_timeout");
    await vi.advanceTimersByTimeAsync(76_000);
    await actionAssertion;

    vi.setSystemTime(0);
    const hungHeavy = runPackagedMemoryScenario({
      ...baseDependencies(),
      performHeavyWork: async () => new Promise<never>(() => undefined)
    });
    const heavyAssertion = expect(hungHeavy).rejects.toThrow("heavy_timeout");
    await vi.advanceTimersByTimeAsync(1_571_000);
    await heavyAssertion;
  });

  it("does not create catch-up bursts after a bounded event-loop delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let sampleCount = 0;
    const pending = runPackagedMemoryScenario({
      ...baseDependencies(),
      sample: () => {
        sampleCount += 1;
        if (sampleCount === 20) vi.setSystemTime(Date.now() + 700);
        return memorySample();
      }
    });

    await vi.advanceTimersByTimeAsync(731_000);
    const evidence = await pending;
    const ordinaryGaps = gaps(evidence.ordinarySamples.map((sample) => sample.monotonicMs));
    expect(ordinaryGaps).toContain(500);
    expect(Math.min(...ordinaryGaps)).toBeGreaterThanOrEqual(500);
    expect(evaluatePackagedMemoryEvidence(evidence).status).toBe("passed");
  });

  it("keeps a blocked gap above two seconds fail closed with a safe exact code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let sampleCount = 0;
    const pending = runPackagedMemoryScenario({
      ...baseDependencies(),
      sample: () => {
        sampleCount += 1;
        if (sampleCount === 20) vi.setSystemTime(Date.now() + 2_100);
        return memorySample();
      }
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "ordinary_sample_gap_too_large"
    });
    await vi.advanceTimersByTimeAsync(733_000);
    await assertion;
    expect(resolvePackagedMemoryScenarioFailureCode(
      new PackagedMemoryScenarioError("ordinary_sample_gap_too_large")
    )).toBe("ordinary_sample_gap_too_large");
    expect(resolvePackagedMemoryScenarioFailureCode(new Error("private detail")))
      .toBe("unclassified");
  });

  afterEach(() => vi.useRealTimers());
});

async function expectScenarioFailure(
  action: (index: number) => PackagedMemoryOrdinaryActionResult,
  heavy: ReturnType<typeof heavyResult>,
  message: string
): Promise<void> {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const pending = runPackagedMemoryScenario({
    now: () => Date.now(),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    sample: () => ({
      residentBytes: 1,
      processCount: 2,
      processTypeCounts: { Browser: 1, Tab: 1 }
    }),
    performOrdinaryAction: async (index) => action(index),
    performHeavyWork: async () => heavy
  });
  const assertion = expect(pending).rejects.toThrow(message);
  await vi.advanceTimersByTimeAsync(730_000);
  await assertion;
}

function ordinaryAction(capturedBytes: number): PackagedMemoryOrdinaryActionResult {
  return { capturedBytes, noteRead: true, noteRendered: true, searched: true };
}

function memorySample() {
  return {
    residentBytes: 1,
    processCount: 2,
    processTypeCounts: { Browser: 1, Tab: 1 }
  };
}

function gaps(values: readonly number[]): number[] {
  return values.slice(1).map((value, index) => value - (values[index] ?? value));
}

function baseDependencies() {
  return {
    now: () => Date.now(),
    sleep: (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    sample: memorySample,
    performOrdinaryAction: async (index: number) => ordinaryAction(index === 0 ? 1_024 : 0),
    performHeavyWork: async () => heavyResult()
  };
}

function heavyResult() {
  return {
    jobClass: "index_rebuild" as const,
    terminalState: "completed" as const,
    pageCount: 10_000 as const,
    chunkCount: 100_000 as const,
    invalidPageCount: 0 as const,
    progressEventCount: 3
  };
}
