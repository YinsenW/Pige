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

  const ordinaryStartedAtMs = checkedNow(dependencies.now());
  let captureCount = 0;
  let capturedBytes = 0;
  const ordinaryActionStartedAtMs: number[] = [];
  const [ordinarySamples] = await Promise.all([
    collectOrdinarySamples(dependencies, ordinaryStartedAtMs),
    (async () => {
      for (let index = 0; index < PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleCount; index += 1) {
        await sleepUntil(
          dependencies,
          ordinaryStartedAtMs + (index * PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleSpacingMs)
        );
        ordinaryActionStartedAtMs.push(checkedNow(dependencies.now()));
        const result = await withTimeout(
          dependencies.performOrdinaryAction(index),
          PACKAGED_MEMORY_SCENARIO_RECIPE.ordinaryActionTimeoutMs,
          "Packaged memory ordinary action timed out."
        );
        if (
          !result ||
          !Number.isSafeInteger(result.capturedBytes) ||
          result.capturedBytes < 0 ||
          result.noteRead !== true ||
          result.noteRendered !== true ||
          result.searched !== true
        ) {
          throw new Error("Packaged memory ordinary action returned invalid evidence.");
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
  if (
    captureCount !== 1 ||
    capturedBytes !== PACKAGED_MEMORY_SCENARIO_RECIPE.captureBytes ||
    ordinaryActionStartedAtMs.length !== PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleCount
  ) {
    throw new Error("Packaged memory capture evidence is invalid.");
  }

  const heavy = await withTimeout(
    dependencies.performHeavyWork(),
    PACKAGED_MEMORY_SCENARIO_RECIPE.heavyTimeoutMs,
    "Packaged memory heavy Job timed out."
  );
  validateHeavyResult(heavy);
  const heavyCompletedAtMs = checkedNow(dependencies.now());
  const recoverySamples: PackagedMemoryScenarioSample[] = [];
  for (let index = 0; index < PACKAGED_MEMORY_SCENARIO_RECIPE.recoverySampleCount; index += 1) {
    await sleepUntil(
      dependencies,
      heavyCompletedAtMs + ((index + 1) * PACKAGED_MEMORY_SCENARIO_RECIPE.recoverySampleSpacingMs)
    );
    recoverySamples.push(createSample(dependencies));
  }

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
    throw new Error("Packaged memory ordinary action timing is unavailable.");
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
    await sleepUntil(
      dependencies,
      startedAtMs + PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleOffsetMs +
        (index * PACKAGED_MEMORY_SCENARIO_RECIPE.ordinarySampleSpacingMs)
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
      await sleepUntil(dependencies, startedAtMs + (index * spacingMs));
    }
    samples.push(createSample(dependencies));
  }
  return samples;
}

function createSample(dependencies: PackagedMemoryScenarioDependencies): PackagedMemoryScenarioSample {
  const sample = dependencies.sample();
  return Object.freeze({ ...sample, monotonicMs: checkedNow(dependencies.now()) });
}

async function sleepUntil(
  dependencies: Pick<PackagedMemoryScenarioDependencies, "now" | "sleep">,
  targetMs: number
): Promise<void> {
  const remaining = targetMs - checkedNow(dependencies.now());
  if (remaining > 0) {
    await withTimeout(
      dependencies.sleep(remaining),
      remaining + PACKAGED_MEMORY_SCENARIO_RECIPE.sleepTimeoutSlackMs,
      "Packaged memory scheduler sleep timed out."
    );
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
    throw new Error("Packaged memory heavy Job returned invalid evidence.");
  }
}

function checkedNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Packaged memory monotonic clock is invalid.");
  }
  return value;
}

async function withTimeout<T>(work: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
