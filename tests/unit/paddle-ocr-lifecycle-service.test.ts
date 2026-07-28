import path from "node:path";
import { PADDLE_OCR_ENGINE_ID } from "@pige/schemas";
import { describe, expect, it, vi } from "vitest";
import type {
  LocalToolInspection,
  LocalToolLifecycleResult
} from "../../apps/desktop/src/main/services/local-tool-manager-types";
import {
  createUnavailablePaddleOcrLifecycleService,
  PaddleOcrLifecycleService,
  type PaddleOcrLocalToolManagerPort
} from "../../apps/desktop/src/main/services/paddle-ocr-lifecycle-service";

const requestId = "paddleocr_abcdefghijklmnop";
const catalog = {
  catalogVersion: "paddleocr-v1",
  components: [{
    componentId: "paddleocr-engine",
    kind: "engine" as const,
    label: "PaddleOCR local engine",
    version: "1.0.0",
    sizeBytes: 1024
  }],
  downloadSizeBytes: 1024,
  installable: true
};

function inspection(state: "available" | "installed" | "repair_needed" = "available"): LocalToolInspection {
  return {
    toolId: PADDLE_OCR_ENGINE_ID,
    label: "PaddleOCR local engine",
    installState: state,
    enabled: state === "installed",
    healthy: state === "installed",
    routable: state === "installed",
    ...(state === "installed" ? { activeVersion: "1.0.0", manifestSha256: `sha256:${"a".repeat(64)}` } : {}),
    desiredVersion: "1.0.0",
    platform: "macos",
    architecture: "arm64",
    capabilities: ["ocr.image"],
    license: { licenseId: "Apache-2.0", noticeRequired: true },
    assets: [],
    routedCapabilities: state === "installed" ? ["ocr.image"] : []
  };
}

function completedJob(id = "job_20260728_abcdefghijkl"): LocalToolLifecycleResult {
  return { job: { id, state: "completed" } } as LocalToolLifecycleResult;
}

function makeHarness(overrides: { installable?: boolean } = {}) {
  let current = inspection();
  const manager: PaddleOcrLocalToolManagerPort = {
    inspect: vi.fn(() => current),
    install: vi.fn(async () => {
      current = inspection("installed");
      return completedJob();
    }),
    setEnabled: vi.fn(async (request) => {
      current = { ...inspection("installed"), enabled: request.enabled, routable: request.enabled };
      return completedJob("job_20260728_enableabcdef");
    }),
    test: vi.fn(async () => completedJob("job_20260728_testabcdefgh")),
    remove: vi.fn(async () => {
      current = inspection();
      return completedJob("job_20260728_removeabcdef");
    })
  };
  const materializer = {
    materialize: vi.fn(async () => ({
      version: "1.0.0",
      candidatePath: path.resolve("/private/paddleocr-candidate"),
      expectedSha256: `sha256:${"a".repeat(64)}`
    })),
    discard: vi.fn(async () => undefined)
  };
  const service = new PaddleOcrLifecycleService({
    catalog: { ...catalog, installable: overrides.installable ?? true },
    manager,
    materializer
  });
  return { service, manager, materializer, setInspection: (next: LocalToolInspection) => { current = next; } };
}

describe("Paddle OCR lifecycle service", () => {
  it("projects the reviewed production manifest without claiming an unpublished bundle", async () => {
    const manifestPath = path.resolve(
      "resources/parser-manifests/paddleocr-local.parser.manifest.json"
    );
    const service = createUnavailablePaddleOcrLifecycleService(manifestPath, "darwin", "arm64");
    const summary = service.summary({ apiVersion: 1 });

    expect(summary).toMatchObject({
      engineId: PADDLE_OCR_ENGINE_ID,
      state: "unsupported",
      catalogVersion: "2026-07-28",
      nativeOcrPreferred: true,
      hiddenDownloadsAllowed: false,
      canInstall: false
    });
    expect(summary.components.map((component) => component.componentId)).toEqual([
      "python-runtime",
      "paddlepaddle",
      "paddleocr",
      "paddlex",
      "model.pp-ocrv5_mobile_det",
      "model.pp-ocrv5_mobile_rec",
      "model.korean_pp-ocrv5_mobile_rec",
      "model.latin_pp-ocrv5_mobile_rec"
    ]);
    expect(summary.downloadSizeBytes).toBeGreaterThan(140_000_000);
    expect(JSON.stringify(summary)).not.toMatch(/url|sha256|path|pythonArgs/u);

    await expect(service.install({
      apiVersion: 1,
      requestId,
      expectedRevision: summary.revision
    })).resolves.toEqual({
      apiVersion: 1,
      requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "failed"
    });
  });

  it("projects an authoritative renderer-safe catalog and disables absent bundles", () => {
    const unavailable = makeHarness({ installable: false });
    expect(unavailable.service.summary({ apiVersion: 1 })).toMatchObject({
      engineId: PADDLE_OCR_ENGINE_ID,
      state: "unsupported",
      nativeOcrPreferred: true,
      hiddenDownloadsAllowed: false,
      canInstall: false
    });
    expect(JSON.stringify(unavailable.service.summary({ apiVersion: 1 }))).not.toMatch(/path|url|sha256|pythonArgs/u);
  });

  it("materializes only an explicit current install and returns its real Job", async () => {
    const { service, manager, materializer } = makeHarness();
    const before = service.summary({ apiVersion: 1 });

    await expect(service.install({ apiVersion: 1, requestId, expectedRevision: before.revision }))
      .resolves.toMatchObject({
        requestId,
        status: "accepted",
        jobId: "job_20260728_abcdefghijkl",
        summary: { state: "ready" }
      });
    expect(materializer.materialize).toHaveBeenCalledOnce();
    expect(manager.install).toHaveBeenCalledWith(expect.objectContaining({
      requestId,
      toolId: PADDLE_OCR_ENGINE_ID,
      candidatePath: path.resolve("/private/paddleocr-candidate")
    }));
    expect(materializer.discard).toHaveBeenCalledWith(requestId);
  });

  it("rejects stale install before download and exposes no private authority", async () => {
    const { service, materializer } = makeHarness();
    const result = await service.install({ apiVersion: 1, requestId, expectedRevision: 0 });

    expect(result).toMatchObject({ status: "stale", requestId });
    expect(materializer.materialize).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/candidate|path|url|sha256|error/u);
  });

  it("never materializes bundles for enable, test, disable, or remove", async () => {
    const { service, materializer } = makeHarness();
    const installRevision = service.summary({ apiVersion: 1 }).revision;
    await service.install({ apiVersion: 1, requestId, expectedRevision: installRevision });

    let summary = service.summary({ apiVersion: 1 });
    await expect(service.test({ apiVersion: 1, requestId: `${requestId}test`, expectedRevision: summary.revision }))
      .resolves.toMatchObject({ status: "accepted" });
    summary = service.summary({ apiVersion: 1 });
    await expect(service.disable({ apiVersion: 1, requestId: `${requestId}disable`, expectedRevision: summary.revision }))
      .resolves.toMatchObject({ status: "committed", summary: { state: "disabled" } });
    summary = service.summary({ apiVersion: 1 });
    await expect(service.enable({ apiVersion: 1, requestId: `${requestId}enable`, expectedRevision: summary.revision }))
      .resolves.toMatchObject({ status: "committed", summary: { state: "ready" } });
    summary = service.summary({ apiVersion: 1 });
    await expect(service.remove({ apiVersion: 1, requestId: `${requestId}remove`, expectedRevision: summary.revision }))
      .resolves.toMatchObject({ status: "committed", summary: { state: "not_installed" } });

    expect(materializer.materialize).toHaveBeenCalledTimes(1);
  });

  it("returns a body-free failure when the reviewed materializer fails", async () => {
    const { service, materializer } = makeHarness();
    materializer.materialize.mockRejectedValueOnce(new Error("ENOENT /private/secret"));
    const before = service.summary({ apiVersion: 1 });

    const result = await service.install({ apiVersion: 1, requestId, expectedRevision: before.revision });
    expect(result).toEqual({
      apiVersion: 1,
      requestId,
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "failed"
    });
  });
});
