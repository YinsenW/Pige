export interface BatchDrainResult {
  readonly processed: number;
}

export interface CoalescedBatchDrainerOptions<Result extends BatchDrainResult> {
  readonly runBatch: () => Result | Promise<Result>;
  readonly onBatch?: (result: Result) => void | Promise<void>;
  readonly onError: (caught: unknown) => void;
  readonly yieldControl?: () => Promise<void>;
}

export class CoalescedBatchDrainer<Result extends BatchDrainResult> {
  readonly #options: CoalescedBatchDrainerOptions<Result>;
  #running = false;
  #requested = false;
  #pauseCount = 0;
  #idleWaiters: (() => void)[] = [];
  #quiesceWaiters: (() => void)[] = [];

  constructor(options: CoalescedBatchDrainerOptions<Result>) {
    this.#options = options;
  }

  schedule(): void {
    this.#requested = true;
    if (this.#running || this.#pauseCount > 0) return;
    this.#running = true;
    void this.#drain();
  }

  waitForIdle(): Promise<void> {
    if (!this.#running && !this.#requested) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  async pause(): Promise<() => void> {
    this.#pauseCount += 1;
    if (this.#running) {
      await new Promise<void>((resolve) => this.#quiesceWaiters.push(resolve));
    }

    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      this.#pauseCount = Math.max(0, this.#pauseCount - 1);
      if (this.#pauseCount === 0) {
        if (this.#requested) {
          this.schedule();
        } else if (!this.#running) {
          for (const resolve of this.#idleWaiters.splice(0)) resolve();
        }
      }
    };
  }

  async #drain(): Promise<void> {
    try {
      drainRequested:
      do {
        this.#requested = false;
        for (;;) {
          if (this.#pauseCount > 0) {
            this.#requested = true;
            break drainRequested;
          }
          const result = await this.#options.runBatch();
          if (result.processed === 0) break;
          await this.#options.onBatch?.(result);
          await (this.#options.yieldControl ?? yieldToMainLoop)();
          if (this.#pauseCount > 0) {
            this.#requested = true;
            break drainRequested;
          }
        }
      } while (this.#requested);
    } catch (caught) {
      this.#options.onError(caught);
    } finally {
      this.#running = false;
      for (const resolve of this.#quiesceWaiters.splice(0)) resolve();
      if (this.#requested && this.#pauseCount === 0) {
        this.schedule();
      } else if (!this.#requested) {
        for (const resolve of this.#idleWaiters.splice(0)) resolve();
      }
    }
  }
}

function yieldToMainLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
