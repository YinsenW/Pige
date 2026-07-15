const KIBIBYTE = 1024;
const MAX_PROCESS_COUNT = 1_024;
const MAX_WORKING_SET_KIB = 16 * 1024 * 1024;
const PROCESS_TYPES = new Set([
  "Browser", "Tab", "Utility", "Zygote", "Sandbox helper", "GPU",
  "Pepper Plugin", "Pepper Plugin Broker", "Unknown"
]);

export interface PackagedAppMetric {
  readonly pid: number;
  readonly creationTime: number;
  readonly type: string;
  readonly memory: {
    readonly workingSetSize: number;
  };
}

export interface PackagedMemorySample {
  readonly residentBytes: number;
  readonly processCount: number;
  readonly processTypeCounts: Readonly<Record<string, number>>;
}

export function samplePackagedAppMemory(metrics: readonly PackagedAppMetric[]): PackagedMemorySample {
  if (!Array.isArray(metrics) || metrics.length === 0 || metrics.length > MAX_PROCESS_COUNT) {
    throw new Error("Packaged application metrics are unavailable or out of bounds.");
  }

  let residentBytes = 0;
  const processTypeCounts: Record<string, number> = {};
  const processIds = new Set<number>();
  for (const metric of metrics) {
    const workingSetKib = metric?.memory?.workingSetSize;
    if (
      !Number.isSafeInteger(metric?.pid) ||
      metric.pid <= 0 ||
      !Number.isFinite(metric.creationTime) ||
      metric.creationTime <= 0 ||
      typeof metric.type !== "string" ||
      !PROCESS_TYPES.has(metric.type) ||
      !Number.isSafeInteger(workingSetKib) ||
      workingSetKib < 0 ||
      workingSetKib > MAX_WORKING_SET_KIB
    ) {
      throw new Error("Packaged application metrics contain an invalid process record.");
    }
    if (processIds.has(metric.pid)) {
      throw new Error("Packaged application metrics contain a duplicate process identity.");
    }
    processIds.add(metric.pid);
    residentBytes += workingSetKib * KIBIBYTE;
    if (!Number.isSafeInteger(residentBytes)) {
      throw new Error("Packaged application resident memory is out of bounds.");
    }
    processTypeCounts[metric.type] = (processTypeCounts[metric.type] ?? 0) + 1;
  }

  return Object.freeze({
    residentBytes,
    processCount: metrics.length,
    processTypeCounts: Object.freeze(Object.fromEntries(
      Object.entries(processTypeCounts).sort(([left], [right]) => left.localeCompare(right))
    ))
  });
}
