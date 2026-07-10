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
  #idleWaiters: (() => void)[] = [];

  constructor(options: CoalescedBatchDrainerOptions<Result>) {
    this.#options = options;
  }

  schedule(): void {
    this.#requested = true;
    if (this.#running) return;
    this.#running = true;
    void this.#drain();
  }

  waitForIdle(): Promise<void> {
    if (!this.#running && !this.#requested) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  async #drain(): Promise<void> {
    try {
      do {
        this.#requested = false;
        for (;;) {
          const result = await this.#options.runBatch();
          if (result.processed === 0) break;
          await this.#options.onBatch?.(result);
          await (this.#options.yieldControl ?? yieldToMainLoop)();
        }
      } while (this.#requested);
    } catch (caught) {
      this.#options.onError(caught);
    } finally {
      this.#running = false;
      if (this.#requested) {
        this.schedule();
      } else {
        for (const resolve of this.#idleWaiters.splice(0)) resolve();
      }
    }
  }
}

function yieldToMainLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
