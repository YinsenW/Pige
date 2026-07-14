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

  it("quiesces at a batch boundary and resumes one preserved request", async () => {
    let releaseFirstBatch!: () => void;
    const firstBatchGate = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });
    let calls = 0;
    const drainer = new CoalescedBatchDrainer({
      runBatch: async () => {
        calls += 1;
        if (calls === 1) {
          await firstBatchGate;
          return { processed: 1 };
        }
        return { processed: 0 };
      },
      onError: (caught) => {
        throw caught;
      },
      yieldControl: async () => undefined
    });

    drainer.schedule();
    await Promise.resolve();
    const paused = drainer.pause();
    drainer.schedule();
    releaseFirstBatch();
    const resume = await paused;

    expect(calls).toBe(1);
    let idle = false;
    void drainer.waitForIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);

    resume();
    await drainer.waitForIdle();
    expect(calls).toBe(2);
  });

  it("requires every nested pause owner to resume before draining", async () => {
    let calls = 0;
    const drainer = new CoalescedBatchDrainer({
      runBatch: () => ({ processed: calls++ === 0 ? 1 : 0 }),
      onError: (caught) => {
        throw caught;
      }
    });
    const resumeFirst = await drainer.pause();
    const resumeSecond = await drainer.pause();
    drainer.schedule();

    resumeFirst();
    await Promise.resolve();
    expect(calls).toBe(0);

    resumeSecond();
    await drainer.waitForIdle();
    expect(calls).toBe(2);
  });
});
