export const PACKAGED_MEMORY_RECIPE = Object.freeze({
  id: "pige-packaged-memory-v1",
  idle: Object.freeze({
    settleMs: 60_000,
    sampleCount: 3,
    sampleSpacingMs: 5_000,
    limitBytes: 200 * 1024 * 1024
  }),
  ordinary: Object.freeze({
    durationMs: 10 * 60_000,
    sampleCount: 600,
    minimumSampleGapMs: 500,
    maximumSampleGapMs: 2_000,
    limitBytes: 1024 * 1024 * 1024,
    actions: Object.freeze({
      captureCount: 1,
      capturedBytes: 1_024,
      noteReadCount: 600,
      noteRenderCount: 600,
      searchCount: 600
    })
  }),
  heavy: Object.freeze({
    jobClass: "index_rebuild",
    terminalState: "completed",
    pageCount: 10_000,
    chunkCount: 100_000
  }),
  recovery: Object.freeze({
    durationMs: 60_000,
    sampleCount: 60,
    minimumSampleGapMs: 500,
    maximumSampleGapMs: 2_000,
    stableSampleCount: 5,
    limitBytes: 250 * 1024 * 1024
  })
});

export function evaluatePackagedMemoryEvidence(input) {
  const idle = validateSamples("idle", input?.idleSamples, PACKAGED_MEMORY_RECIPE.idle.sampleCount, {
    minimumGapMs: PACKAGED_MEMORY_RECIPE.idle.sampleSpacingMs - 1_000,
    maximumGapMs: PACKAGED_MEMORY_RECIPE.idle.sampleSpacingMs + 1_000
  });
  const ordinary = validateSamples(
    "ordinary",
    input?.ordinarySamples,
    PACKAGED_MEMORY_RECIPE.ordinary.sampleCount,
    {
      minimumGapMs: PACKAGED_MEMORY_RECIPE.ordinary.minimumSampleGapMs,
      maximumGapMs: PACKAGED_MEMORY_RECIPE.ordinary.maximumSampleGapMs
    }
  );
  const recovery = validateSamples(
    "recovery",
    input?.recoverySamples,
    PACKAGED_MEMORY_RECIPE.recovery.sampleCount,
    {
      minimumGapMs: PACKAGED_MEMORY_RECIPE.recovery.minimumSampleGapMs,
      maximumGapMs: PACKAGED_MEMORY_RECIPE.recovery.maximumSampleGapMs
    }
  );
  const ordinaryActions = validateOrdinaryActions(input?.ordinaryActions);
  const ordinaryActionTiming = validateOrdinaryActionTiming(
    input?.ordinaryActionTiming,
    input?.ordinaryStartedAtMs,
    input?.ordinaryCompletedAtMs
  );
  const heavy = validateHeavyWork(input?.heavy);
  if (!Number.isSafeInteger(heavy.progressEventCount) || heavy.progressEventCount <= 0) {
    throw new Error("Packaged memory heavy Job did not report progress.");
  }
  const idleSettledAtMs = requireTime(input.idleSettledAtMs, "idle settle");
  const ordinaryStartedAtMs = requireTime(input.ordinaryStartedAtMs, "ordinary start");
  const ordinaryCompletedAtMs = requireTime(input.ordinaryCompletedAtMs, "ordinary completion");
  const heavyCompletedAtMs = requireTime(input.heavyCompletedAtMs, "heavy completion");
  validateScenarioTiming({
    idle,
    idleSettledAtMs,
    ordinary,
    ordinaryStartedAtMs,
    ordinaryCompletedAtMs,
    recovery,
    heavyCompletedAtMs
  });

  const idleMedianBytes = medianResidentBytes(idle.map((sample) => sample.residentBytes));
  const ordinaryP95Bytes = p95ResidentBytes(ordinary.map((sample) => sample.residentBytes));
  const recoveryStableAtSecond = findStableRecoverySecond(recovery, heavyCompletedAtMs);
  const idlePassed = idleMedianBytes < PACKAGED_MEMORY_RECIPE.idle.limitBytes;
  const ordinaryPassed = ordinaryP95Bytes < PACKAGED_MEMORY_RECIPE.ordinary.limitBytes;
  const recoveryPassed = recoveryStableAtSecond !== undefined && recoveryStableAtSecond <= 60;

  return Object.freeze({
    status: idlePassed && ordinaryPassed && recoveryPassed ? "passed" : "failed",
    idle: Object.freeze({
      sampleCount: idle.length,
      medianBytes: idleMedianBytes,
      limitBytes: PACKAGED_MEMORY_RECIPE.idle.limitBytes,
      passed: idlePassed
    }),
    ordinary: Object.freeze({
      sampleCount: ordinary.length,
      p95Bytes: ordinaryP95Bytes,
      peakBytes: Math.max(...ordinary.map((sample) => sample.residentBytes)),
      limitBytes: PACKAGED_MEMORY_RECIPE.ordinary.limitBytes,
      actions: ordinaryActions,
      actionTiming: ordinaryActionTiming,
      passed: ordinaryPassed
    }),
    heavy: Object.freeze({
      jobClass: heavy.jobClass,
      terminalState: heavy.terminalState,
      pageCount: heavy.pageCount,
      chunkCount: heavy.chunkCount,
      progressEventCount: heavy.progressEventCount
    }),
    recovery: Object.freeze({
      sampleCount: recovery.length,
      stableAtSecond: recoveryStableAtSecond ?? null,
      limitBytes: PACKAGED_MEMORY_RECIPE.recovery.limitBytes,
      passed: recoveryPassed
    })
  });
}

function validateOrdinaryActionTiming(value, ordinaryStartedAtMs, ordinaryCompletedAtMs) {
  if (
    !value ||
    !hasExactKeys(value, [
      "count", "firstStartedAtMs", "lastStartedAtMs", "minimumGapMs", "maximumGapMs"
    ]) ||
    value.count !== PACKAGED_MEMORY_RECIPE.ordinary.sampleCount ||
    !Number.isSafeInteger(value.firstStartedAtMs) ||
    !Number.isSafeInteger(value.lastStartedAtMs) ||
    !Number.isSafeInteger(value.minimumGapMs) ||
    !Number.isSafeInteger(value.maximumGapMs) ||
    value.firstStartedAtMs < ordinaryStartedAtMs ||
    value.firstStartedAtMs > ordinaryStartedAtMs + 2_000 ||
    value.lastStartedAtMs < ordinaryStartedAtMs + 599_000 ||
    value.lastStartedAtMs > ordinaryCompletedAtMs ||
    value.minimumGapMs < PACKAGED_MEMORY_RECIPE.ordinary.minimumSampleGapMs ||
    value.maximumGapMs > PACKAGED_MEMORY_RECIPE.ordinary.maximumSampleGapMs
  ) {
    throw new Error("Packaged memory ordinary action cadence is invalid.");
  }
  return Object.freeze({ ...value });
}

function validateOrdinaryActions(value) {
  const expected = PACKAGED_MEMORY_RECIPE.ordinary.actions;
  if (
    !value ||
    !hasExactKeys(value, [
      "captureCount", "capturedBytes", "noteReadCount", "noteRenderCount", "searchCount"
    ]) ||
    value.captureCount !== expected.captureCount ||
    value.capturedBytes !== expected.capturedBytes ||
    value.noteReadCount !== expected.noteReadCount ||
    value.noteRenderCount !== expected.noteRenderCount ||
    value.searchCount !== expected.searchCount
  ) {
    throw new Error("Packaged memory ordinary action evidence is invalid.");
  }
  return Object.freeze({ ...expected });
}

function validateHeavyWork(value) {
  const expected = PACKAGED_MEMORY_RECIPE.heavy;
  if (
    !value ||
    !hasExactKeys(value, [
      "jobClass", "terminalState", "pageCount", "chunkCount", "invalidPageCount", "progressEventCount"
    ]) ||
    value.jobClass !== expected.jobClass ||
    value.terminalState !== expected.terminalState ||
    value.pageCount !== expected.pageCount ||
    value.chunkCount !== expected.chunkCount ||
    value.invalidPageCount !== 0 ||
    !Number.isSafeInteger(value.progressEventCount) ||
    value.progressEventCount <= 0
  ) {
    throw new Error("Packaged memory heavy Job evidence is invalid.");
  }
  return Object.freeze({
    jobClass: expected.jobClass,
    terminalState: expected.terminalState,
    pageCount: expected.pageCount,
    chunkCount: expected.chunkCount,
    progressEventCount: value.progressEventCount
  });
}

function hasExactKeys(value, expected) {
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function validateSamples(label, samples, expectedCount, cadence = {}) {
  if (!Array.isArray(samples) || samples.length !== expectedCount) {
    throw new Error(`Packaged memory ${label} sample count is invalid.`);
  }
  let previousMonotonicMs;
  return samples.map((sample) => {
    if (
      !sample ||
      !Number.isSafeInteger(sample.monotonicMs) ||
      sample.monotonicMs < 0 ||
      !Number.isSafeInteger(sample.residentBytes) ||
      sample.residentBytes < 0 ||
      !Number.isSafeInteger(sample.processCount) ||
      sample.processCount <= 0 ||
      !isValidProcessTypes(sample.processTypeCounts, sample.processCount)
    ) {
      throw new Error(`Packaged memory ${label} sample is invalid.`);
    }
    if (previousMonotonicMs !== undefined) {
      const gap = sample.monotonicMs - previousMonotonicMs;
      if (
        gap <= 0 ||
        (cadence.minimumGapMs !== undefined && gap < cadence.minimumGapMs) ||
        (cadence.maximumGapMs !== undefined && gap > cadence.maximumGapMs)
      ) {
        throw new Error(`Packaged memory ${label} sample cadence is invalid.`);
      }
    }
    previousMonotonicMs = sample.monotonicMs;
    return Object.freeze({ ...sample });
  });
}

function findStableRecoverySecond(samples, heavyCompletedAtMs) {
  let consecutive = 0;
  for (let index = 0; index < samples.length; index += 1) {
    if (samples[index].residentBytes <= PACKAGED_MEMORY_RECIPE.recovery.limitBytes) {
      consecutive += 1;
      if (consecutive === PACKAGED_MEMORY_RECIPE.recovery.stableSampleCount) {
        return Math.ceil((samples[index].monotonicMs - heavyCompletedAtMs) / 1_000);
      }
    } else {
      consecutive = 0;
    }
  }
  return undefined;
}

function validateScenarioTiming(input) {
  const idleFirst = input.idle[0].monotonicMs;
  const idleLast = input.idle.at(-1).monotonicMs;
  if (
    idleFirst < input.idleSettledAtMs + PACKAGED_MEMORY_RECIPE.idle.settleMs ||
    idleLast > input.idleSettledAtMs + PACKAGED_MEMORY_RECIPE.idle.settleMs + 12_000 ||
    input.ordinaryStartedAtMs < idleLast
  ) {
    throw new Error("Packaged memory idle duration is invalid.");
  }
  const ordinaryDuration = input.ordinaryCompletedAtMs - input.ordinaryStartedAtMs;
  if (
    ordinaryDuration < PACKAGED_MEMORY_RECIPE.ordinary.durationMs ||
    ordinaryDuration > PACKAGED_MEMORY_RECIPE.ordinary.durationMs + 2_000 ||
    input.ordinary[0].monotonicMs < input.ordinaryStartedAtMs ||
    input.ordinary[0].monotonicMs > input.ordinaryStartedAtMs + 2_000 ||
    input.ordinary.at(-1).monotonicMs < input.ordinaryStartedAtMs + 599_000 ||
    input.ordinary.at(-1).monotonicMs > input.ordinaryCompletedAtMs ||
    input.heavyCompletedAtMs < input.ordinaryCompletedAtMs
  ) {
    throw new Error("Packaged memory ordinary duration is invalid.");
  }
  if (
    input.recovery[0].monotonicMs < input.heavyCompletedAtMs ||
    input.recovery[0].monotonicMs > input.heavyCompletedAtMs + 2_000 ||
    input.recovery.at(-1).monotonicMs < input.heavyCompletedAtMs + 59_000 ||
    input.recovery.at(-1).monotonicMs > input.heavyCompletedAtMs + 62_000
  ) {
    throw new Error("Packaged memory recovery duration is invalid.");
  }
}

function isValidProcessTypes(counts, processCount) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return false;
  const entries = Object.entries(counts);
  if (entries.length === 0 || entries.length > 32) return false;
  let total = 0;
  for (const [type, count] of entries) {
    if (
      !/^(?:Browser|Tab|Utility|Zygote|Sandbox helper|GPU|Pepper Plugin|Pepper Plugin Broker|Unknown)$/u
        .test(type) ||
      !Number.isSafeInteger(count) ||
      count <= 0
    ) return false;
    total += count;
  }
  return total === processCount && (counts.Browser ?? 0) >= 1 && (counts.Tab ?? 0) >= 1;
}

function requireTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Packaged memory ${label} time is invalid.`);
  }
  return value;
}

function medianResidentBytes(samples) {
  const sorted = validateResidentValues(samples);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function p95ResidentBytes(samples) {
  const sorted = validateResidentValues(samples);
  return sorted[Math.floor((95 * sorted.length + 99) / 100) - 1];
}

function validateResidentValues(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.length > 100_000) {
    throw new Error("Resident-memory samples are unavailable or out of bounds.");
  }
  const sorted = [...samples];
  if (sorted.some((sample) => !Number.isSafeInteger(sample) || sample < 0)) {
    throw new Error("Resident-memory samples contain an invalid value.");
  }
  return sorted.sort((left, right) => left - right);
}
