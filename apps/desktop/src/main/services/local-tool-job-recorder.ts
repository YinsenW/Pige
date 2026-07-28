import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import {
  JobRecordStore,
  type JobRecordSnapshot
} from "./job-record-store";
import {
  localToolRequestIdFromJob,
  type LocalToolLifecycleJobRecorder
} from "./local-tool-manager-types";

const MAX_LOCAL_TOOL_JOB_RECORDS = 4_096;
const JOB_FILE_NAME_PATTERN = /^job_\d{8}_[a-z0-9]{8,}\.json$/u;

export class LocalToolJobRecorder implements LocalToolLifecycleJobRecorder {
  readonly #rootPath: string;
  readonly #store: JobRecordStore;

  constructor(options: {
    readonly rootPath: string;
    readonly assertWriterLease: () => void;
  }) {
    this.#rootPath = path.resolve(options.rootPath);
    fs.mkdirSync(this.#rootPath, { recursive: true, mode: 0o700 });
    const root = fs.lstatSync(this.#rootPath);
    if (!root.isDirectory() || root.isSymbolicLink()) throw invalidStore();
    this.#store = new JobRecordStore({
      rootPath: this.#rootPath,
      assertWriterLease: options.assertWriterLease
    });
  }

  findByRequestId(requestId: string): JobRecordSnapshot | undefined {
    assertRequestId(requestId);
    if (!fs.existsSync(this.#rootPath)) return undefined;
    const root = fs.lstatSync(this.#rootPath);
    if (!root.isDirectory() || root.isSymbolicLink()) throw invalidStore();

    const names = fs.readdirSync(this.#rootPath, { encoding: "utf8" })
      .filter((name) => JOB_FILE_NAME_PATTERN.test(name))
      .sort();
    if (names.length > MAX_LOCAL_TOOL_JOB_RECORDS) {
      throw new PigeDomainError("job.store_limit_exceeded", "The Local Tool Job store exceeds its record limit.");
    }

    let found: JobRecordSnapshot | undefined;
    for (const name of names) {
      const snapshot = this.#store.read(path.join(this.#rootPath, name));
      if (localToolRequestIdFromJob(snapshot.job) !== requestId) continue;
      if (found) throw new PigeDomainError("job.result_conflict", "The Local Tool request has duplicate durable Jobs.");
      found = snapshot;
    }
    return found;
  }

  claimByRequestId(job: JobRecord): { snapshot: JobRecordSnapshot; created: boolean } {
    const parsed = JobRecordSchema.parse(job);
    const requestId = localToolRequestIdFromJob(parsed);
    const claim = this.#store.acquireNamedClaim("local_tool_request", requestId);
    try {
      const existing = this.findByRequestId(requestId);
      if (existing) return { snapshot: existing, created: false };
      claim.assertHeld();
      const snapshot = this.#store.createIfAbsent(
        path.join(this.#rootPath, `${parsed.id}.json`),
        parsed
      );
      claim.assertHeld();
      return { snapshot, created: true };
    } finally {
      claim.release();
    }
  }

  compareAndSwap(snapshot: JobRecordSnapshot, next: JobRecord): JobRecordSnapshot {
    return this.#store.compareAndSwap(snapshot, JobRecordSchema.parse(next));
  }
}

function assertRequestId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/u.test(value)) {
    throw new PigeDomainError("job.record_invalid", "The Local Tool request identity is invalid.");
  }
}

function invalidStore(): PigeDomainError {
  return new PigeDomainError("job.store_invalid", "The Local Tool Job store is not a private directory.");
}
