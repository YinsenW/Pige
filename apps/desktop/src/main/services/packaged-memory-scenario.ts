import type { PackagedMemorySample } from "./packaged-memory-metrics";

export const PACKAGED_MEMORY_SCENARIO_RECIPE = Object.freeze({
  idleSettleMs: 60_000,
  idleSampleCount: 3,
  idleSampleSpacingMs: 5_000,
  ordinarySampleCount: 600,
  ordinarySampleSpacingMs: 1_000,
  ordinarySampleOffsetMs: 500,
  ordinaryActionTimeoutMs: 5_000,
  heavyTimeoutMs: 15 * 60_000,
  sleepTimeoutSlackMs: 5_000,
  recoverySampleCount: 60,
  recoverySampleSpacingMs: 1_000,
  captureBytes: 1_024
} as const);

export const PACKAGED_MEMORY_SCENARIO_FAILURE_CODES = Object.freeze([
  "idle_sample_gap_too_small",
  "idle_sample_gap_too_large",
  "ordinary_sample_gap_too_small",
  "ordinary_sample_gap_too_large",
  "ordinary_action_gap_too_small",
  "ordinary_action_gap_too_large",
  "recovery_sample_gap_too_small",
  "recovery_sample_gap_too_large",
  "scheduler_sleep_timeout",
  "scheduler_sleep_failed",
  "memory_sample_failed",
  "ordinary_action_timeout",
  "ordinary_action_failed",
  "ordinary_action_invalid",
  "ordinary_evidence_invalid",
  "ordinary_action_timing_unavailable",
  "heavy_timeout",
  "heavy_work_failed",
  "heavy_evidence_invalid",
  "unclassified"
] as const);

export type PackagedMemoryScenarioFailureCode =
  (typeof PACKAGED_MEMORY_SCENARIO_FAILURE_CODES)[number];

export class PackagedMemoryScenarioError extends Error {
  readonly code: PackagedMemoryScenarioFailureCode;

  constructor(code: PackagedMemoryScenarioFailureCode) {
    super(`Packaged memory scenario failed: ${code}.`);
    this.name = "PackagedMemoryScenarioError";
    this.code = code;
  }
}

export function resolvePackagedMemoryScenarioFailureCode(
  error: unknown
): PackagedMemoryScenarioFailureCode {
  return error instanceof PackagedMemoryScenarioError ? error.code : "unclassified";
}

export interface PackagedMemoryScenarioSample extends PackagedMemorySample {
  readonly monotonicMs: number;
}

export interface PackagedMemoryOrdinaryActionResult {
  readonly capturedBytes: number;
  readonly noteRead: true;
  readonly noteRendered: true;
  readonly searched: true;
}

export interface PackagedMemoryHeavyResult {
  readonly jobClass: "index_rebuild";
  readonly terminalState: "completed";
  readonly pageCount: 10_000;
  readonly chunkCount: 100_000;
  readonly invalidPageCount: 0;
  readonly progressEventCount: number;
}

export interface PackagedMemoryScenarioEvidence {
  readonly idleSettledAtMs: number;
  readonly idleSamples: readonly PackagedMemoryScenarioSample[];
  readonly ordinaryStartedAtMs: number;
  readonly ordinaryCompletedAtMs: number;
  readonly ordinarySamples: readonly PackagedMemoryScenarioSample[];
  readonly ordinaryActions: {
    readonly captureCount: 1;
    readonly capturedBytes: 1_024;
    readonly noteReadCount: 600;
    readonly noteRenderCount: 600;
    readonly searchCount: 600;
  };
  readonly ordinaryActionTiming: {
    readonly count: 600;
    readonly firstStartedAtMs: number;
    readonly lastStartedAtMs: number;
    readonly minimumGapMs: number;
    readonly maximumGapMs: number;
  };
  readonly heavy: PackagedMemoryHeavyResult;
  readonly heavyCompletedAtMs: number;
  readonly recoverySamples: readonly PackagedMemoryScenarioSample[];
}

export interface PackagedMemoryScenarioDependencies {
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly sample: () => PackagedMemorySample;
  readonly performOrdinaryAction: (index: number) => Promise<PackagedMemoryOrdinaryActionResult>;
  readonly performHeavyWork: () => Promise<PackagedMemoryHeavyResult>;
}

export async function runPackagedMemoryScenario(
  dependencies: PackagedMemoryScenarioDependencies
): Promise<PackagedMemoryScenarioEvidence> {
  const idleSettledAtMs = checkedNow(dependencies.now());
  await dependencies.sleep(PACKAGED_MEMORY_SCENARIO_RECIPE.idleSettleMs);
  const idleSamples = await collectSamples(
    dependencies,
    PACKAGED_MEMORY_SCENARIO_RECIPE.idleSampleCount,
    PACKAGED_MEMORY_SCENARIO_RECIPE.idleSampleSpacingMs
  );
  assertCadence(
    idleSamples.map((sample) => sample.monotonicMs),
    PACKAGED_MEMORY_SCENARIO_RECIPE.idleSampleSpacingMs - 1_000,
    PACKAGED_MEMORY_SCENARIO_RECIPE.idleSampleSpacingMs + 1_000,
    "idle_sample_gap_too_small",
    "idle_sample_gap_too_large"
  );

  const ordinaryStartedAtMs = checkedNow(dependencies.now());
  let captureCount = 0;
  let capturedBytes = 0;
  const ordinaryActionStartedAtMs: number[] = [];
  const [ordinarySamples] = await Promise.all([
    collectOrdinarySamples(dependencies, ordinaryStartedAtMs),
    (async () => {
      for (let index = 0; index < PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleCount; index += 1) {
        await sleepUntilCadenced(
          dependencies,
          ordinaryStartedAtMs + (index * PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleSpacingMs),
          ordinaryActionStartedAtMs.at(-1),
          500
        );
        ordinaryActionStartedAtMs.push(checkedNow(dependencies.now()));
        let result: PackagedMemoryOrdinaryActionResult;
        try {
          result = await withTimeout(
            dependencies.performOrdinaryAction(index),
            PACKAGED_MEMORY_SCENARIO_RECIPE.ordinaryActionTimeoutMs,
            "ordinary_action_timeout"
          );
        } catch (caught) {
          if (caught instanceof PackagedMemoryScenarioError) throw caught;
          throw new PackagedMemoryScenarioError("ordinary_action_failed");
        }
        if (
          !result ||
          !Number.isSafeInteger(result.capturedBytes) ||
          result.capturedBytes < 0 ||
          result.noteRead !== true ||
          result.noteRendered !== true ||
          result.searched !== true
        ) {
          throw new PackagedMemoryScenarioError("ordinary_action_invalid");
        }
        if (result.capturedBytes > 0) captureCount += 1;
        capturedBytes += result.capturedBytes;
      }
    })()
  ]);
  await sleepUntil(
    dependencies,
    ordinaryStartedAtMs + (
      PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleCount *
      PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleSpacingMs
    )
  );
  const ordinaryCompletedAtMs = checkedNow(dependencies.now());
  assertCadence(
    ordinarySamples.map((sample) => sample.monotonicMs),
    500,
    2_000,
    "ordinary_sample_gap_too_small",
    "ordinary_sample_gap_too_large"
  );
  assertCadence(
    ordinaryActionStartedAtMs,
    500,
    2_000,
    "ordinary_action_gap_too_small",
    "ordinary_action_gap_too_large"
  );
  if (
    captureCount !== 1 ||
    capturedBytes !== PACKAGED_MEMORY_SCENARIO_RECIPE.captureBytes ||
    ordinaryActionStartedAtMs.length !== PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleCount
  ) {
    throw new PackagedMemoryScenarioError("ordinary_evidence_invalid");
  }

  let heavy: PackagedMemoryHeavyResult;
  try {
    heavy = await withTimeout(
      dependencies.performHeavyWork(),
      PACKAGED_MEMORY_SCENARIO_RECIPE.heavyTimeoutMs,
      "heavy_timeout"
    );
  } catch (caught) {
    if (caught instanceof PackagedMemoryScenarioError) throw caught;
    throw new PackagedMemoryScenarioError("heavy_work_failed");
  }
  validateHeavyResult(heavy);
  const heavyCompletedAtMs = checkedNow(dependencies.now());
  const recoverySamples: PackagedMemoryScenarioSample[] = [];
  for (let index = 0; index < PACKAGED_MEMORY_SCENARIO_RECIPE.recoverySampleCount; index += 1) {
    await sleepUntilCadenced(
      dependencies,
      heavyCompletedAtMs + ((index + 1) * PACKAGED_MEMORY_SCENARIO_RECIPE.recoverySampleSpacingMs),
      recoverySamples.at(-1)?.monotonicMs,
      500
    );
    recoverySamples.push(createSample(dependencies));
  }
  assertCadence(
    recoverySamples.map((sample) => sample.monotonicMs),
    500,
    2_000,
    "recovery_sample_gap_too_small",
    "recovery_sample_gap_too_large"
  );

  return Object.freeze({
    idleSettledAtMs,
    idleSamples: Object.freeze(idleSamples),
    ordinaryStartedAtMs,
    ordinaryCompletedAtMs,
    ordinarySamples: Object.freeze(ordinarySamples),
    ordinaryActions: Object.freeze({
      captureCount: 1,
      capturedBytes: 1_024,
      noteReadCount: PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleCount,
      noteRenderCount: PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleCount,
      searchCount: PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleCount
    }),
    ordinaryActionTiming: createActionTiming(ordinaryActionStartedAtMs),
    heavy: Object.freeze({ ...heavy }),
    heavyCompletedAtMs,
    recoverySamples: Object.freeze(recoverySamples)
  });
}

function createActionTiming(startedAtMs: readonly number[]): PackagedMemoryScenarioEvidence["ordinaryActionTiming"] {
  const gaps = startedAtMs.slice(1).map((value, index) => value - (startedAtMs[index] ?? value));
  const firstStartedAtMs = startedAtMs[0];
  const lastStartedAtMs = startedAtMs.at(-1);
  if (firstStartedAtMs === undefined || lastStartedAtMs === undefined || gaps.length === 0) {
    throw new PackagedMemoryScenarioError("ordinary_action_timing_unavailable");
  }
  return Object.freeze({
    count: 600,
    firstStartedAtMs,
    lastStartedAtMs,
    minimumGapMs: Math.min(...gaps),
    maximumGapMs: Math.max(...gaps)
  });
}

async function collectOrdinarySamples(
  dependencies: PackagedMemoryScenarioDependencies,
  startedAtMs: number
): Promise<PackagedMemoryScenarioSample[]> {
  const samples: PackagedMemoryScenarioSample[] = [];
  for (let index = 0; index < PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleCount; index += 1) {
    await sleepUntilCadenced(
      dependencies,
      startedAtMs + PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleOffsetMs +
        (index * PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleSpacingMs),
      samples.at(-1)?.monotonicMs,
      500
    );
    samples.push(createSample(dependencies));
  }
  return samples;
}

async function collectSamples(
  dependencies: PackagedMemoryScenarioDependencies,
  count: number,
  spacingMs: number
): Promise<PackagedMemoryScenarioSample[]> {
  const samples: PackagedMemoryScenarioSample[] = [];
  const startedAtMs = checkedNow(dependencies.now());
  for (let index = 0; index < count; index += 1) {
    if (index > 0) {
      await sleepUntilCadenced(
        dependencies,
        startedAtMs + (index * spacingMs),
        samples.at(-1)?.monotonicMs,
        spacingMs - 1_000
      );
    }
    samples.push(createSample(dependencies));
  }
  return samples;
}

function createSample(dependencies: PackagedMemoryScenarioDependencies): PackagedMemoryScenarioSample {
  try {
    const sample = dependencies.sample();
    return Object.freeze({ ...sample, monotonicMs: checkedNow(dependencies.now()) });
  } catch {
    throw new PackagedMemoryScenarioError("memory_sample_failed");
  }
}

async function sleepUntilCadenced(
  dependencies: Pick<PackagedMemoryScenarioDependencies, "now" | "sleep">,
  plannedTargetMs: number,
  previousAtMs: number | undefined,
  minimumGapMs: number
): Promise<void> {
  const targetMs = previousAtMs === undefined
    ? plannedTargetMs
    : Math.max(plannedTargetMs, previousAtMs + minimumGapMs);
  await sleepUntil(dependencies, targetMs);
}

async function sleepUntil(
  dependencies: Pick<PackagedMemoryScenarioDependencies, "now" | "sleep">,
  targetMs: number
): Promise<void> {
  while (true) {
    const before = checkedNow(dependencies.now());
    const remaining = targetMs - before;
    if (remaining <= 0) return;
    try {
      await withTimeout(
        dependencies.sleep(remaining),
        remaining + PACKAGED_MEMORY_SCENARIO_RECIPE.sleepTimeoutSlackMs,
        "scheduler_sleep_timeout"
      );
    } catch (caught) {
      if (caught instanceof PackagedMemoryScenarioError) throw caught;
      throw new PackagedMemoryScenarioError("scheduler_sleep_failed");
    }
    if (checkedNow(dependencies.now()) <= before) {
      throw new PackagedMemoryScenarioError("scheduler_sleep_failed");
    }
  }
}

function validateHeavyResult(value: PackagedMemoryHeavyResult): void {
  if (
    !value ||
    value.jobClass !== "index_rebuild" ||
    value.terminalState !== "completed" ||
    value.pageCount !== 10_000 ||
    value.chunkCount !== 100_000 ||
    value.invalidPageCount !== 0 ||
    !Number.isSafeInteger(value.progressEventCount) ||
    value.progressEventCount <= 0
  ) {
    throw new PackagedMemoryScenarioError("heavy_evidence_invalid");
  }
}

function assertCadence(
  values: readonly number[],
  minimumGapMs: number,
  maximumGapMs: number,
  tooSmallCode: PackagedMemoryScenarioFailureCode,
  tooLargeCode: PackagedMemoryScenarioFailureCode
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) {
      throw new PackagedMemoryScenarioError("unclassified");
    }
    const gap = current - previous;
    if (gap < minimumGapMs) throw new PackagedMemoryScenarioError(tooSmallCode);
    if (gap > maximumGapMs) throw new PackagedMemoryScenarioError(tooLargeCode);
  }
}

function checkedNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Packaged memory monotonic clock is invalid.");
  }
  return value;
}

async function withTimeout<T>(
  work: Promise<T>,
  milliseconds: number,
  timeoutCode: PackagedMemoryScenarioFailureCode
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new PackagedMemoryScenarioError(timeoutCode)),
          milliseconds
        );
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
