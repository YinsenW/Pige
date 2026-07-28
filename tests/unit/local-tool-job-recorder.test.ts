import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import { LocalToolJobRecorder } from "../../apps/desktop/src/main/services/local-tool-job-recorder";
import { localToolJobInputRefs } from "../../apps/desktop/src/main/services/local-tool-manager-types";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("LocalToolJobRecorder", () => {
  it("claims one durable Job per request and recovers it after restart", () => {
    const rootPath = tempRoot();
    const first = new LocalToolJobRecorder({ rootPath, assertWriterLease: () => undefined });
    const job = localToolJob("paddleocr_install_request_0001");

    const claimed = first.claimByRequestId(job);
    expect(claimed.created).toBe(true);
    expect(first.claimByRequestId({ ...job, id: "job_20260728_bbbbbbbbbbbb" }).created).toBe(false);

    const restarted = new LocalToolJobRecorder({ rootPath, assertWriterLease: () => undefined });
    expect(restarted.findByRequestId("paddleocr_install_request_0001")?.job.id).toBe(job.id);
  });

  it("persists CAS updates and rejects duplicate durable request ownership", () => {
    const rootPath = tempRoot();
    const recorder = new LocalToolJobRecorder({ rootPath, assertWriterLease: () => undefined });
    const initial = recorder.claimByRequestId(localToolJob("paddleocr_install_request_0002")).snapshot;
    const updated = recorder.compareAndSwap(initial, {
      ...initial.job,
      state: "running",
      updatedAt: "2026-07-28T00:00:01.000Z",
      message: "Running."
    });
    expect(recorder.findByRequestId("paddleocr_install_request_0002")?.job.state).toBe("running");

    fs.writeFileSync(
      path.join(rootPath, "job_20260728_cccccccccccc.json"),
      `${JSON.stringify({ ...updated.job, id: "job_20260728_cccccccccccc" })}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    expect(() => recorder.findByRequestId("paddleocr_install_request_0002"))
      .toThrowError(/duplicate durable Jobs/u);
  });

  it("requires the machine writer lease for every durable operation", () => {
    const rootPath = tempRoot();
    let held = true;
    const recorder = new LocalToolJobRecorder({
      rootPath,
      assertWriterLease: () => {
        if (!held) throw new Error("lease lost");
      }
    });
    recorder.claimByRequestId(localToolJob("paddleocr_install_request_0003"));
    held = false;
    expect(() => recorder.findByRequestId("paddleocr_install_request_0003"))
      .toThrowError(/writer lease is not current/u);
  });
});

function tempRoot(): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-tool-jobs-"));
  roots.push(parent);
  return path.join(parent, "jobs");
}

function localToolJob(requestId: string): JobRecord {
  return JobRecordSchema.parse({
    schemaVersion: 1,
    id: "job_20260728_aaaaaaaaaaaa",
    class: "tool_install",
    state: "queued",
    priority: "maintenance",
    scope: "machine_local",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    inputRefs: localToolJobInputRefs("install", {
      requestId,
      userOrigin: "settings.local_capabilities",
      toolId: "paddleocr_local",
      version: "3.7.0"
    }),
    privacy: {
      usedCloudModel: false,
      usedNetwork: false,
      usedShell: false,
      accessedExternalFiles: true
    },
    message: "Queued."
  });
}
