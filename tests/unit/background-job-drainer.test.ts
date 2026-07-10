import { describe, expect, it } from "vitest";
import { CoalescedBatchDrainer } from "../../apps/desktop/src/main/services/background-job-drainer";

describe("coalesced batch drainer", () => {
  it("continues beyond one batch while yielding between bounded batches", async () => {
    let remaining = 45;
    let yielded = 0;
    const batches: number[] = [];
    const drainer = new CoalescedBatchDrainer({
      runBatch: () => {
        const processed = Math.min(20, remaining);
        remaining -= processed;
        return { processed };
      },
      onBatch: (result) => batches.push(result.processed),
      onError: (caught) => {
        throw caught;
      },
      yieldControl: async () => {
        yielded += 1;
      }
    });

    drainer.schedule();
    drainer.schedule();
    await drainer.waitForIdle();

    expect(remaining).toBe(0);
    expect(batches).toEqual([20, 20, 5]);
    expect(yielded).toBe(3);
  });

  it("reports a batch failure and returns to an idle state", async () => {
    const errors: unknown[] = [];
    const drainer = new CoalescedBatchDrainer({
      runBatch: () => {
        throw new Error("batch failed");
      },
      onError: (caught) => errors.push(caught)
    });

    drainer.schedule();
    await drainer.waitForIdle();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: "batch failed" });
  });
});
