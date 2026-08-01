import path from "node:path";
import type { JobChangedEvent, JobSummary, VaultSummary } from "@pige/contracts";
import { JobChangedEventSchema, type JobRecord } from "@pige/schemas";
import { subscribeJobRecordCommits, type JobRecordCommitEvent } from "./job-record-store";

export interface JobStateEventVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface JobStateEventSummaryPort {
  summarize(job: JobRecord): JobSummary;
}

export class JobStateEventService {
  readonly #vaults: JobStateEventVaultPort;
  readonly #jobs: JobStateEventSummaryPort;
  readonly #publish: (event: JobChangedEvent) => void;
  readonly #unsubscribe: () => void;
  #sequence = 0;

  constructor(
    vaults: JobStateEventVaultPort,
    jobs: JobStateEventSummaryPort,
    publish: (event: JobChangedEvent) => void
  ) {
    this.#vaults = vaults;
    this.#jobs = jobs;
    this.#publish = publish;
    this.#unsubscribe = subscribeJobRecordCommits((event) => this.#onCommit(event));
  }

  close(): void {
    this.#unsubscribe();
  }

  #onCommit(commit: JobRecordCommitEvent): void {
    const activeVault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!activeVault || !vaultPath) return;
    const expectedRoot = path.resolve(vaultPath, ".pige", "jobs");
    if (path.resolve(commit.rootPath) !== expectedRoot || commit.job.activeVaultId !== activeVault.vaultId) return;
    const sequence = this.#sequence >= Number.MAX_SAFE_INTEGER ? 1 : this.#sequence + 1;
    const event = JobChangedEventSchema.parse({
      apiVersion: 1,
      sequence,
      activeVaultId: activeVault.vaultId,
      job: this.#jobs.summarize(commit.job)
    });
    this.#sequence = sequence;
    this.#publish(event);
  }
}
