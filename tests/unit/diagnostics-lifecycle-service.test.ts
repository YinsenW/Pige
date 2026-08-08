import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsLifecycleService } from "../../apps/desktop/src/main/services/diagnostics-lifecycle-service";
import { DiagnosticsService } from "../../apps/desktop/src/main/services/diagnostics-service";
import type { DiagnosticsExportPort } from "../../apps/desktop/src/main/services/diagnostics-export-types";
import type { DiagnosticsProviderMetadata } from "../../apps/desktop/src/main/services/diagnostics-provider-metadata";

const roots: string[] = [];
const VAULT_ID = "vault_20260730_diagnostics";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-diagnostics-lifecycle-"));
  roots.push(root);
  return root;
}

function lifecycle(
  userDataPath: string,
  exporter: DiagnosticsExportPort,
  providerMetadata?: () => DiagnosticsProviderMetadata
): DiagnosticsLifecycleService {
  const diagnostics = new DiagnosticsService(userDataPath, { exporter });
  diagnostics.recordEvent({
    level: "warning",
    code: "jobs.resume_failed",
    message: "Durable background job recovery failed."
  });
  return new DiagnosticsLifecycleService({
    userDataPath,
    diagnostics,
    getActiveVaultId: () => VAULT_ID,
    providerMetadata,
    now: () => new Date("2026-07-30T12:34:56.000Z")
  });
}

function ids(prefix: "diagpreviewreq" | "diagexportreq" | "diagcancelreq" | "diagretryreq" | "diagclearreq", suffix: string) {
  return `${prefix}_${suffix.padEnd(16, "0")}`;
}

async function waitFor(
  service: DiagnosticsLifecycleService,
  state: string
): Promise<ReturnType<DiagnosticsLifecycleService["summary"]>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const summary = service.summary();
    if (summary.job?.state === state) return summary;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for diagnostics Job state ${state}.`);
}

function writeExporter(onWrite?: () => void): DiagnosticsExportPort {
  return {
    async write({ outputPath, content }, options) {
      if (options?.signal?.aborted) throw Object.assign(new Error("aborted"), { code: "ABORT_ERR" });
      onWrite?.();
      fs.writeFileSync(outputPath, content, { encoding: "utf8", mode: 0o600 });
      return { bytesWritten: Buffer.byteLength(content, "utf8") };
    }
  };
}

function startExport(service: DiagnosticsLifecycleService, destinationPath: string, suffix: string) {
  const initial = service.summary();
  const preview = service.preview(previewRequest(service, suffix));
  return service.start({
    apiVersion: 1,
    requestId: ids("diagexportreq", suffix),
    previewId: preview.previewId,
    scopeContextId: initial.scopeContextId,
    expectedRevision: initial.revision
  }, destinationPath);
}

function previewRequest(service: DiagnosticsLifecycleService, suffix: string) {
  const selection = service.summary().eventSelection;
  const event = selection?.events[0];
  if (!selection || !event) throw new Error("Expected a selectable diagnostics event.");
  return {
    apiVersion: 1 as const,
    requestId: ids("diagpreviewreq", suffix),
    eventSelectionRevision: selection.revision,
    selectedDiagnosticEventIds: [event.eventId]
  };
}

describe("durable diagnostics lifecycle", () => {
  it("binds the explicitly reviewed provider aggregate once and reuses it for durable export", async () => {
    const root = tempRoot();
    const destination = path.join(root, "provider-support.json");
    let generation: DiagnosticsProviderMetadata["providers"][number]["generation"] = "verified";
    const providerMetadata = vi.fn((): DiagnosticsProviderMetadata => ({
      schemaVersion: 1,
      providerCount: 1,
      modelCount: 1,
      enabledModelCount: 1,
      hasDefaultModel: true,
      providers: [{
        providerKind: "openai",
        endpointProtocol: "openai_responses",
        authRequirement: "api_key",
        modelListStrategy: "list_models",
        cloudBoundary: "openai_cloud",
        discovery: "verified",
        generation,
        modelCount: 1,
        enabledModelCount: 1
      }]
    }));
    const service = lifecycle(path.join(root, "user-data"), writeExporter(), providerMetadata);
    const initial = service.summary();
    const preview = service.preview({
      ...previewRequest(service, "provider"),
      optionalCategories: ["provider_metadata"]
    });
    generation = "failed";
    const started = service.start({
      apiVersion: 1,
      requestId: ids("diagexportreq", "provider"),
      previewId: preview.previewId,
      scopeContextId: initial.scopeContextId,
      expectedRevision: initial.revision
    }, destination);

    expect(started.status).toBe("started");
    await waitFor(service, "completed");
    const exported = fs.readFileSync(destination, "utf8");
    expect(providerMetadata).toHaveBeenCalledOnce();
    expect(exported).toContain('"selectedOptionalCategories": [');
    expect(exported).toContain('"generation": "verified"');
    expect(exported).not.toContain('"generation": "failed"');
    service.close();
  });

  it("fails before creating a preview when selected provider metadata is unavailable", () => {
    const root = tempRoot();
    const service = lifecycle(path.join(root, "user-data"), writeExporter());

    try {
      service.preview({
        ...previewRequest(service, "missing"),
        optionalCategories: ["provider_metadata"]
      });
      throw new Error("Expected selected provider metadata to fail closed.");
    } catch (caught) {
      expect(caught).toMatchObject({ code: "diagnostics.provider_metadata_unavailable" });
    }
    expect(service.summary().job).toBeUndefined();
    service.close();
  });

  it("exports only the exact redacted private excerpt that the user reviewed", async () => {
    const root = tempRoot();
    const destination = path.join(root, "private-excerpt-support.json");
    const service = lifecycle(path.join(root, "user-data"), writeExporter());
    const initial = service.summary();
    const raw = "Contact alice@example.test with Bearer sk-proj-abcdefghijklmnop at /Users/alice/private.md";
    const preview = service.preview({
      ...previewRequest(service, "excerpt"),
      optionalCategories: ["private_excerpt"],
      privateExcerpt: raw
    });

    expect(preview.reviewedPrivateExcerpt).toEqual({
      text: "Contact [REDACTED_EMAIL] with Bearer [REDACTED_SECRET] at <home>/private.md",
      redactionApplied: true
    });
    const started = service.start({
      apiVersion: 1,
      requestId: ids("diagexportreq", "excerpt"),
      previewId: preview.previewId,
      scopeContextId: initial.scopeContextId,
      expectedRevision: initial.revision
    }, destination);

    expect(started.status).toBe("started");
    await waitFor(service, "completed");
    const exported = fs.readFileSync(destination, "utf8");
    expect(exported).toContain('"id": "private_excerpt"');
    expect(exported).toContain("Contact [REDACTED_EMAIL] with Bearer [REDACTED_SECRET] at <home>/private.md");
    expect(exported).not.toContain("alice@example.test");
    expect(exported).not.toContain("sk-proj-abcdefghijklmnop");
    expect(exported).not.toContain("/Users/alice");
    service.close();
  });

  it("exports through one pathless durable Job and bounds progress", async () => {
    const root = tempRoot();
    const destination = path.join(root, "selected-support.json");
    const service = lifecycle(path.join(root, "user-data"), writeExporter());

    const started = startExport(service, destination, "success");
    expect(started.status).toBe("started");
    expect(JSON.stringify(started)).not.toContain(destination);
    expect(JSON.stringify(started)).not.toContain("recentEvents");

    const completed = await waitFor(service, "completed");
    expect(completed.job?.progress).toEqual(expect.objectContaining({ completedUnits: 3, totalUnits: 3, percent: 100 }));
    expect(completed.job?.jobId).toMatch(/^job_20260730_/u);
    expect(fs.readFileSync(destination, "utf8")).toContain('"localOnly": true');
    expect(JSON.stringify(completed)).not.toContain(destination);
    service.close();
  });

  it("revalidates the exact selected redacted events before creating a durable export Job", () => {
    const root = tempRoot();
    const userDataPath = path.join(root, "user-data");
    const diagnostics = new DiagnosticsService(userDataPath, { exporter: writeExporter() });
    diagnostics.recordEvent({ level: "warning", code: "jobs.resume_failed", message: "Durable background job recovery failed." });
    const service = new DiagnosticsLifecycleService({
      userDataPath,
      diagnostics,
      getActiveVaultId: () => VAULT_ID,
      now: () => new Date("2026-07-30T12:34:56.000Z")
    });
    const initial = service.summary();
    const preview = service.preview(previewRequest(service, "selection"));
    diagnostics.recordEvent({ level: "error", code: "provider.failure", message: "Provider failed." });

    const stale = service.start({
      apiVersion: 1,
      requestId: ids("diagexportreq", "selection"),
      previewId: preview.previewId,
      scopeContextId: initial.scopeContextId,
      expectedRevision: initial.revision
    }, path.join(root, "must-not-exist.json"));

    expect(stale.status).toBe("stale");
    expect(stale.status === "stale" ? stale.workflow.job : undefined).toBeUndefined();
    service.close();
  });

  it("cancels before publication with exact Job and revision CAS", async () => {
    const root = tempRoot();
    const destination = path.join(root, "must-not-exist.json");
    const service = lifecycle(path.join(root, "user-data"), writeExporter());
    startExport(service, destination, "cancel");
    const queued = service.summary();
    expect(queued.job?.jobId).toBeTruthy();

    const stale = service.cancel({
      apiVersion: 1, requestId: ids("diagcancelreq", "stale"), jobId: queued.job!.jobId,
      scopeContextId: queued.scopeContextId, expectedRevision: queued.revision - 1
    });
    expect(stale.status).toBe("stale");
    const current = stale.workflow!;
    const canceled = service.cancel({
      apiVersion: 1, requestId: ids("diagcancelreq", "cancel"), jobId: current.job!.jobId,
      scopeContextId: current.scopeContextId, expectedRevision: current.revision
    });
    expect(canceled.status).toBe("accepted");
    expect(canceled.workflow?.job?.state).toBe("cancelled");
    expect(fs.existsSync(destination)).toBe(false);
    service.close();
  });

  it("re-adopts the same interrupted Job after restart without a duplicate write", async () => {
    const root = tempRoot();
    const userData = path.join(root, "user-data");
    const destination = path.join(root, "recovered-support.json");
    const neverSettles: DiagnosticsExportPort = { write: async () => new Promise(() => undefined) };
    const first = lifecycle(userData, neverSettles);
    startExport(first, destination, "restart");
    const running = await waitFor(first, "running");
    const originalJobId = running.job!.jobId;
    first.close();

    let writes = 0;
    const restarted = lifecycle(userData, writeExporter(() => { writes += 1; }));
    const completed = await waitFor(restarted, "completed");
    expect(completed.job?.jobId).toBe(originalJobId);
    expect(writes).toBe(1);
    expect(fs.readFileSync(destination, "utf8")).toContain('"localOnly": true');
    restarted.close();
  });

  it("retries the same failed Job and trash-clears only Pige-owned diagnostics artifacts", async () => {
    const root = tempRoot();
    const userData = path.join(root, "user-data");
    const destination = path.join(root, "user-selected-support.json");
    const vaultRoot = path.join(root, "vault");
    fs.mkdirSync(path.join(vaultRoot, ".pige", "conversations"), { recursive: true });
    const protectedFiles = [
      path.join(vaultRoot, "note.md"),
      path.join(vaultRoot, ".pige", "conversations", "conversation.json"),
      path.join(root, "source-evidence.pdf")
    ];
    for (const file of protectedFiles) fs.writeFileSync(file, "protected", "utf8");
    let writes = 0;
    const exporter: DiagnosticsExportPort = {
      async write({ outputPath, content }) {
        writes += 1;
        if (writes === 1) throw Object.assign(new Error("synthetic failure"), { code: "EIO" });
        fs.writeFileSync(outputPath, content, "utf8");
        return { bytesWritten: Buffer.byteLength(content, "utf8") };
      }
    };
    const service = lifecycle(userData, exporter);
    startExport(service, destination, "retry");
    const failed = await waitFor(service, "failed_retryable");
    const retried = service.retry({
      apiVersion: 1, requestId: ids("diagretryreq", "retry"), jobId: failed.job!.jobId,
      scopeContextId: failed.scopeContextId, expectedRevision: failed.revision
    });
    expect(retried.status).toBe("accepted");
    const completed = await waitFor(service, "completed");
    expect(completed.job?.jobId).toBe(failed.job?.jobId);
    expect(writes).toBe(2);

    const clearRequest = {
      apiVersion: 1, requestId: ids("diagclearreq", "clear"),
      scopeContextId: completed.scopeContextId, expectedRevision: completed.revision
    } as const;
    const cleared = service.clear(clearRequest);
    expect(cleared.status).toBe("cleared");
    expect(cleared.clearedArtifactCount).toBeGreaterThan(0);
    expect(cleared.workflow?.job).toBeUndefined();
    expect(fs.existsSync(path.join(userData, "diagnostics", "trash", ids("diagclearreq", "clear")))).toBe(true);
    expect(fs.existsSync(destination)).toBe(true);
    for (const file of protectedFiles) expect(fs.readFileSync(file, "utf8")).toBe("protected");
    const replayed = service.clear(clearRequest);
    expect(replayed.status).toBe("cleared");
    expect(replayed.status === "cleared" ? replayed.clearedArtifactCount : -1).toBe(cleared.clearedArtifactCount);
    service.close();
  });

  it("fails closed to choose-destination repair when a retry destination changed", async () => {
    const root = tempRoot();
    const destination = path.join(root, "changed-support.json");
    const exporter: DiagnosticsExportPort = { write: async () => { throw Object.assign(new Error("failed"), { code: "EIO" }); } };
    const service = lifecycle(path.join(root, "user-data"), exporter);
    startExport(service, destination, "changed");
    const failed = await waitFor(service, "failed_retryable");
    fs.writeFileSync(destination, "user-owned replacement", "utf8");

    const result = service.retry({
      apiVersion: 1, requestId: ids("diagretryreq", "changed"), jobId: failed.job!.jobId,
      scopeContextId: failed.scopeContextId, expectedRevision: failed.revision
    });
    expect(result.status).toBe("ineligible");
    expect(result.status === "ineligible" ? result.workflow.job?.state : undefined).toBe("failed_final");
    expect(result.status === "ineligible" ? result.workflow.job?.repairAction : undefined).toBe("choose_destination");
    expect(fs.readFileSync(destination, "utf8")).toBe("user-owned replacement");
    service.close();
  });
});
