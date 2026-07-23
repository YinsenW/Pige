import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import {
  LocalToolManagerService,
  type LocalToolManagerOptions
} from "../../apps/desktop/src/main/services/local-tool-manager-service";
import type {
  LocalToolCatalog,
  LocalToolFailurePoint,
  LocalToolLifecycleJobRecorder,
  LocalToolAuthorityPort,
  LocalToolAuthorityRequest,
  LocalToolSelfTestPort,
  LocalToolSelfTestRequest,
  LocalToolSelfTestResult
} from "../../apps/desktop/src/main/services/local-tool-manager-types";
import type { JobRecordSnapshot } from "../../apps/desktop/src/main/services/job-record-store";
import {
  createFakeLocalToolFixture,
  hashTree,
  rewriteManifest,
  toAssetDefinition,
  toToolDefinition,
  type FakeLocalToolFixture
} from "./helpers/local-tool-fixture";

const tempRoots: string[] = [];

class MemoryJobRecorder implements LocalToolLifecycleJobRecorder {
  readonly writes: JobRecord[] = [];
  readonly #byRequestId = new Map<string, JobRecordSnapshot>();
  readonly #byJobId = new Map<string, JobRecordSnapshot>();
  #revision = 0;
  #nextContention: ((job: JobRecord) => JobRecord) | undefined;

  findByRequestId(requestId: string): JobRecordSnapshot | undefined {
    return this.#byRequestId.get(requestId);
  }

  claimByRequestId(job: JobRecord): { snapshot: JobRecordSnapshot; created: boolean } {
    const parsed = JobRecordSchema.parse(job);
    const requestId = parsed.inputRefs?.find((ref) => ref.role === "local_tool_request")?.id;
    const existing = requestId ? this.#byRequestId.get(requestId) : undefined;
    if (existing) return { snapshot: existing, created: false };
    if (this.#byJobId.has(parsed.id)) {
      throw new PigeDomainError("job.revision_conflict", "Synthetic Job already exists.");
    }
    return { snapshot: this.#commit(parsed), created: true };
  }

  compareAndSwap(snapshot: JobRecordSnapshot, next: JobRecord): JobRecordSnapshot {
    let current = this.#byJobId.get(snapshot.job.id);
    if (current && this.#nextContention) {
      const contend = this.#nextContention;
      this.#nextContention = undefined;
      current = this.#commit(JobRecordSchema.parse(contend(current.job)));
    }
    if (!current || current.revision.sha256 !== snapshot.revision.sha256) {
      throw new PigeDomainError("job.revision_conflict", "Synthetic Job revision changed.");
    }
    return this.#commit(JobRecordSchema.parse(next));
  }

  contendNextCompareAndSwap(contend: (job: JobRecord) => JobRecord): void {
    this.#nextContention = contend;
  }

  #commit(parsed: JobRecord): JobRecordSnapshot {
    this.writes.push(parsed);
    this.#revision += 1;
    const snapshot: JobRecordSnapshot = {
      path: `memory:${parsed.id}`,
      job: parsed,
      revision: {
        sha256: `sha256:${this.#revision.toString(16).padStart(64, "0")}`,
        size: Buffer.byteLength(JSON.stringify(parsed), "utf8"),
        dev: 1,
        ino: this.#revision
      }
    };
    const requestId = parsed.inputRefs?.find((ref) => ref.role === "local_tool_request")?.id;
    if (requestId) this.#byRequestId.set(requestId, snapshot);
    this.#byJobId.set(parsed.id, snapshot);
    return snapshot;
  }
}

class AllowingAuthorityPort implements LocalToolAuthorityPort {
  readonly calls: LocalToolAuthorityRequest[] = [];
  deny = false;

  assertAuthorized(request: LocalToolAuthorityRequest): void {
    this.calls.push(request);
    if (this.deny) throw new PigeDomainError("permission.user_denied", "User denied local-tool permission.");
    expect(request.actorType).toBe("local_tool");
    expect(request.capability).toBe("install_local_tool");
    expect(request.resourceScope).toBe("current_action");
  }
}

class FakeSelfTestPort implements LocalToolSelfTestPort {
  readonly calls: LocalToolSelfTestRequest[] = [];
  result: LocalToolSelfTestResult = {
    schemaVersion: 1,
    passed: true,
    outputBytes: 16,
    messageCode: "local_tool.test_passed"
  };

  async run(request: LocalToolSelfTestRequest): Promise<LocalToolSelfTestResult> {
    this.calls.push(request);
    return this.result;
  }
}

class DeferredSelfTestPort implements LocalToolSelfTestPort {
  readonly started: Promise<void>;
  callCount = 0;
  #markStarted!: () => void;
  #release!: () => void;
  readonly #result: LocalToolSelfTestResult;

  constructor(result: LocalToolSelfTestResult = {
    schemaVersion: 1,
    passed: true,
    outputBytes: 8,
    messageCode: "local_tool.test_passed"
  }) {
    this.#result = result;
    this.started = new Promise((resolve) => {
      this.#markStarted = resolve;
    });
  }

  release(): void {
    this.#release();
  }

  async run(): Promise<LocalToolSelfTestResult> {
    this.callCount += 1;
    this.#markStarted();
    await new Promise<void>((resolve) => {
      this.#release = resolve;
    });
    return this.#result;
  }
}

interface Harness {
  readonly service: LocalToolManagerService;
  readonly localToolRoot: string;
  readonly jobs: MemoryJobRecorder;
  readonly permissions: AllowingAuthorityPort;
  readonly selfTest: FakeSelfTestPort;
}

function makeTempRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pige-${label}-`));
  tempRoots.push(root);
  return root;
}

function makeHarness(
  catalog: LocalToolCatalog,
  overrides: Partial<LocalToolManagerOptions> = {}
): Harness {
  const localToolRoot = overrides.localToolRoot ?? path.join(makeTempRoot("local-tools"), "app-data", "local-tools");
  const trustedAppDataRoot = overrides.trustedAppDataRoot ?? path.dirname(localToolRoot);
  fs.mkdirSync(trustedAppDataRoot, { recursive: true });
  const jobs = overrides.jobRecorder instanceof MemoryJobRecorder ? overrides.jobRecorder : new MemoryJobRecorder();
  const permissions = overrides.authorityPort instanceof AllowingAuthorityPort
    ? overrides.authorityPort
    : new AllowingAuthorityPort();
  const selfTest = overrides.selfTestPort instanceof FakeSelfTestPort ? overrides.selfTestPort : new FakeSelfTestPort();
  const service = new LocalToolManagerService({
    trustedAppDataRoot,
    localToolRoot,
    catalog,
    authorityPort: permissions,
    jobRecorder: jobs,
    selfTestPort: selfTest,
    platform: "macos",
    architecture: "arm64",
    now: () => new Date("2026-07-11T02:00:00.000Z"),
    ...overrides
  });
  return { service, localToolRoot, jobs, permissions, selfTest };
}

function installRequest(fixture: FakeLocalToolFixture, requestId: string, userOrigin = "user") {
  return {
    toolId: fixture.manifest.toolId,
    ...(fixture.manifest.assetId ? { assetId: fixture.manifest.assetId } : {}),
    version: fixture.manifest.version,
    candidatePath: fixture.rootPath,
    expectedSha256: fixture.packageSha256,
    requestId,
    userOrigin,
  };
}

function targetRequest(fixture: FakeLocalToolFixture, requestId: string) {
  return {
    toolId: fixture.manifest.toolId,
    ...(fixture.manifest.assetId ? { assetId: fixture.manifest.assetId } : {}),
    version: fixture.manifest.version,
    requestId,
    userOrigin: "user",
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("local tool manager service", () => {
  it("rejects stale lifecycle Job snapshots without overwriting the CAS winner", () => {
    const recorder = new MemoryJobRecorder();
    const created = recorder.claimByRequestId(JobRecordSchema.parse({
      schemaVersion: 1,
      id: "job_20260723_localtool01",
      class: "tool_install",
      state: "queued",
      priority: "maintenance",
      scope: "machine_local",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
      actor: {
        kind: "user",
        runtimeKind: "desktop_local",
        clientCapabilityTier: "desktop_full"
      },
      inputRefs: [{ kind: "tool", role: "local_tool_request", id: "request_localtool01" }],
      message: "Queued."
    })).snapshot;
    const winner = recorder.compareAndSwap(created, JobRecordSchema.parse({
      ...created.job,
      state: "running",
      updatedAt: "2026-07-23T00:00:01.000Z",
      startedAt: "2026-07-23T00:00:01.000Z",
      message: "Running."
    }));

    expect(() => recorder.compareAndSwap(created, JobRecordSchema.parse({
      ...created.job,
      state: "running",
      updatedAt: "2026-07-23T00:00:02.000Z",
      startedAt: "2026-07-23T00:00:02.000Z",
      message: "Stale writer."
    }))).toThrowError(expect.objectContaining({ code: "job.revision_conflict" }));
    expect(recorder.findByRequestId("request_localtool01")?.job).toEqual(winner.job);
  });

  it("installs an explicit local fixture and derives a ready capability without network access", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("fixture"), "fake-v1"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });

    expect(harness.service.inspect("fake_ocr").installState).toBe("available");
    const result = await harness.service.install(installRequest(fixture, "request-install-v1"));

    expect(result.job).toMatchObject({
      class: "tool_install",
      scope: "machine_local",
      state: "completed",
      actor: { kind: "user" },
      privacy: { usedNetwork: false, usedShell: false, accessedExternalFiles: true }
    });
    expect(harness.jobs.writes.map((job) => job.state)).toEqual(["queued", "running", "completed"]);
    expect(result.inspection).toMatchObject({
      installState: "installed",
      enabled: true,
      healthy: true,
      routable: true,
      activeVersion: "1.0.0",
      routedCapabilities: ["ocr.text"]
    });
    expect(harness.selfTest.calls).toHaveLength(1);
    expect(harness.selfTest.calls[0]).toMatchObject({ networkAllowed: false, version: "1.0.0" });
    expect(harness.selfTest.calls[0]?.stagedRootPath).toContain(`${path.sep}staging${path.sep}`);
    expect(harness.selfTest.calls[0]?.stagedRootPath).not.toBe(fixture.rootPath);

    const recordText = fs.readFileSync(path.join(harness.localToolRoot, "records", "fake_ocr.json"), "utf8");
    expect(recordText).not.toContain(harness.localToolRoot);
    expect(recordText).not.toContain(fixture.rootPath);

    const beforeHealth = hashTree(harness.localToolRoot);
    const selfTestsBefore = harness.selfTest.calls.length;
    expect(harness.service.health("fake_ocr")).toMatchObject({ healthy: true, routable: true });
    expect(harness.service.inspect("fake_ocr").routable).toBe(true);
    expect(hashTree(harness.localToolRoot)).toBe(beforeHealth);
    expect(harness.selfTest.calls).toHaveLength(selfTestsBefore);
  });

  it.each(["agent", "ingest", "system", "background", "model", "source", "skill", "package"])(
    "rejects %s origin before permission, Job, or filesystem mutation",
    async (origin) => {
      const fixture = createFakeLocalToolFixture(path.join(makeTempRoot(`origin-${origin}`), "fixture"));
      const harness = makeHarness({ tools: [toToolDefinition(fixture)] });

      await expect(harness.service.install(installRequest(fixture, `request-${origin}-origin`, origin)))
        .rejects.toMatchObject({ code: "permission.user_origin_required" });
      expect(harness.permissions.calls).toHaveLength(0);
      expect(harness.jobs.writes).toHaveLength(0);
      expect(fs.existsSync(harness.localToolRoot)).toBe(false);
    }
  );

  it("rejects a denied exact action authority before Job or filesystem mutation", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("permission"), "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    harness.permissions.deny = true;

    await expect(harness.service.install(installRequest(fixture, "request-denied-permission")))
      .rejects.toMatchObject({ code: "permission.user_denied" });
    expect(harness.jobs.writes).toHaveLength(0);
    expect(fs.existsSync(harness.localToolRoot)).toBe(false);
  });

  it("rejects an app-owned staging-root symlink without writing through it", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("owned-symlink-fixture"), "fixture"));
    const appData = makeTempRoot("owned-symlink-root");
    const outside = path.join(appData, "outside");
    const localToolRoot = path.join(appData, "local-tools");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, localToolRoot);
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] }, { localToolRoot });

    const result = await harness.service.install(installRequest(fixture, "request-owned-root-symlink"));

    expect(result.job.state).toBe("failed_final");
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(harness.jobs.writes.map((job) => job.state)).toEqual(["queued", "running", "failed_final"]);
  });

  it("rejects a symlink descendant below the trusted app-data anchor", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("trusted-anchor-fixture"), "fixture"));
    const trustedAppDataRoot = makeTempRoot("trusted-anchor");
    const outside = makeTempRoot("trusted-anchor-outside");
    const linkedParent = path.join(trustedAppDataRoot, "linked");
    fs.symlinkSync(outside, linkedParent);
    const localToolRoot = path.join(linkedParent, "local-tools");
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] }, {
      localToolRoot,
      trustedAppDataRoot
    });

    const result = await harness.service.install(installRequest(fixture, "request-trusted-anchor-symlink"));

    expect(result.job.state).toBe("failed_final");
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("applies only manifest-approved executable modes to staged payloads", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("file-modes"), "fixture"), {
      files: {
        "bin/fake-tool": "#!/bin/sh\nexit 0\n",
        "models/data.bin": "model-data\n"
      }
    });
    const selfTest: LocalToolSelfTestPort = {
      run: async (request) => {
        if (process.platform !== "win32") {
          expect(fs.statSync(path.join(request.stagedRootPath, "bin", "fake-tool")).mode & 0o111).not.toBe(0);
          expect(fs.statSync(path.join(request.stagedRootPath, "models", "data.bin")).mode & 0o111).toBe(0);
        }
        return { schemaVersion: 1, passed: true, outputBytes: 8, messageCode: "local_tool.test_passed" };
      }
    };
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] }, { selfTestPort: selfTest });

    const result = await harness.service.install(installRequest(fixture, "request-approved-modes"));

    expect(result.job.state).toBe("completed");
  });

  const invalidFixtureCases: readonly {
    readonly name: string;
    readonly mutate: (fixture: FakeLocalToolFixture) => void;
  }[] = [
    {
      name: "manifest schema mismatch",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({ ...manifest, schemaVersion: 2 }))
    },
    {
      name: "tool identity mismatch",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({ ...manifest, toolId: "other_tool" }))
    },
    {
      name: "license mismatch",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({
        ...manifest,
        license: { spdxId: "MIT", name: "MIT License" }
      }))
    },
    {
      name: "platform mismatch",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({ ...manifest, platform: "windows" }))
    },
    {
      name: "architecture mismatch",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({ ...manifest, architecture: "x64" }))
    },
    {
      name: "capability mismatch",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({ ...manifest, capabilities: ["ocr.hidden"] }))
    },
    {
      name: "declared size mismatch",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({
        ...manifest,
        files: (manifest.files as Record<string, unknown>[]).map((file) => ({
          ...file,
          sizeBytes: Number(file.sizeBytes) + 1
        }))
      }))
    },
    {
      name: "declared file size above the cap",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({
        ...manifest,
        files: (manifest.files as Record<string, unknown>[]).map((file) => ({
          ...file,
          sizeBytes: 33 * 1024 * 1024
        }))
      }))
    },
    {
      name: "absolute entry",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({
        ...manifest,
        files: [{ ...(manifest.files as Record<string, unknown>[])[0], path: "/tmp/escape" }]
      }))
    },
    {
      name: "parent traversal entry",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({
        ...manifest,
        files: [{ ...(manifest.files as Record<string, unknown>[])[0], path: "../escape" }]
      }))
    },
    {
      name: "duplicate entry",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({
        ...manifest,
        files: [
          ...(manifest.files as Record<string, unknown>[]),
          { ...(manifest.files as Record<string, unknown>[])[0] }
        ]
      }))
    },
    {
      name: "case-colliding entry",
      mutate: (fixture) => rewriteManifest(fixture, (manifest) => ({
        ...manifest,
        files: [
          ...(manifest.files as Record<string, unknown>[]),
          { ...(manifest.files as Record<string, unknown>[])[0], path: "bin/FAKE-OCR.TXT" }
        ]
      }))
    },
    {
      name: "undeclared file",
      mutate: (fixture) => fs.writeFileSync(path.join(fixture.rootPath, "undeclared.txt"), "hidden")
    },
    {
      name: "missing declared file",
      mutate: (fixture) => fs.rmSync(path.join(fixture.rootPath, "bin", "fake-ocr.txt"))
    },
    {
      name: "symlink entry",
      mutate: (fixture) => {
        const payload = path.join(fixture.rootPath, "bin", "fake-ocr.txt");
        const outside = path.join(path.dirname(fixture.rootPath), "outside.txt");
        fs.writeFileSync(outside, "fake-local-tool\n");
        fs.rmSync(payload);
        fs.symlinkSync(outside, payload);
      }
    },
    {
      name: "file checksum drift",
      mutate: (fixture) => fs.writeFileSync(path.join(fixture.rootPath, "bin", "fake-ocr.txt"), "tampered\n")
    }
  ];

  it.each(invalidFixtureCases)("fails closed for $name without a live install", async ({ mutate }, index) => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot(`invalid-${index}`), "fixture"));
    const definition = toToolDefinition(fixture);
    mutate(fixture);
    const harness = makeHarness({ tools: [definition] });

    const result = await harness.service.install(installRequest(fixture, `request-invalid-${String(index).padStart(2, "0")}`));

    expect(result.job.state).toMatch(/^failed_/);
    expect(harness.service.inspect("fake_ocr")).toMatchObject({ installState: "available", routable: false });
    expect(fs.existsSync(path.join(harness.localToolRoot, "records", "fake_ocr.json"))).toBe(false);
    expect(findVersionDirectories(harness.localToolRoot)).toEqual([]);
  });

  it("rejects a non-directory candidate and a caller checksum conflict without a live change", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("candidate-shape"), "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    const regularFile = path.join(path.dirname(fixture.rootPath), "candidate.zip");
    fs.writeFileSync(regularFile, "not-an-archive-adapter");

    const nonDirectory = await harness.service.install({
      ...installRequest(fixture, "request-regular-file"),
      candidatePath: regularFile
    });
    expect(nonDirectory.job.state).toBe("failed_final");
    await expect(harness.service.install({
      ...installRequest(fixture, "request-wrong-sha"),
      expectedSha256: `sha256:${"0".repeat(64)}`
    })).rejects.toMatchObject({ code: "settings.local_tool_identity_mismatch" });
    expect(harness.service.inspect("fake_ocr").installState).toBe("available");
    expect(findVersionDirectories(harness.localToolRoot)).toEqual([]);
  });

  it("fails closed on an invalid or timed-out bounded self-test without publishing a live install", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("self-test-protocol"), "fixture"));
    const invalidHarness = makeHarness({ tools: [toToolDefinition(fixture)] });
    invalidHarness.selfTest.result = {
      schemaVersion: 1,
      passed: true,
      outputBytes: 16,
      messageCode: "local_tool.test_passed",
      leakedOutput: "must-not-cross-boundary"
    } as LocalToolSelfTestResult;
    const invalid = await invalidHarness.service.install(installRequest(fixture, "request-self-test-invalid"));
    expect(invalid.job).toMatchObject({
      state: "failed_retryable",
      error: { code: "settings.local_tool_test_protocol_invalid" }
    });
    expect(invalidHarness.service.inspect("fake_ocr").installState).toBe("available");

    const timeoutPort: LocalToolSelfTestPort = {
      run: () => new Promise(() => undefined)
    };
    const timeoutHarness = makeHarness({ tools: [toToolDefinition(fixture)] }, {
      selfTestPort: timeoutPort,
      selfTestTimeoutMs: 10
    });
    const timedOut = await timeoutHarness.service.install(installRequest(fixture, "request-self-test-timeout"));
    expect(timedOut.job).toMatchObject({
      state: "failed_retryable",
      error: { code: "settings.local_tool_test_timeout" }
    });
    expect(timeoutHarness.service.inspect("fake_ocr").installState).toBe("available");
  });

  it("marks an explicit failed health test repair-needed and restores it after a passing test", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("explicit-test"), "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    await harness.service.install(installRequest(fixture, "request-explicit-test-install"));
    harness.selfTest.result = {
      schemaVersion: 1,
      passed: false,
      outputBytes: 8,
      messageCode: "local_tool.test_failed"
    };
    const failed = await harness.service.test(targetRequest(fixture, "request-explicit-test-fail"));
    expect(failed.job.state).toBe("failed_retryable");
    expect(failed.inspection).toMatchObject({ installState: "repair_needed", routable: false });

    harness.selfTest.result = {
      schemaVersion: 1,
      passed: true,
      outputBytes: 8,
      messageCode: "local_tool.test_passed"
    };
    const passed = await harness.service.test(targetRequest(fixture, "request-explicit-test-pass"));
    expect(passed.job.state).toBe("completed");
    expect(passed.inspection).toMatchObject({ installState: "installed", routable: true });
  });

  it("never routes capabilities from tampered lifecycle metadata", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("record-metadata"), "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    await harness.service.install(installRequest(fixture, "request-record-metadata-install"));
    const recordPath = path.join(harness.localToolRoot, "records", "fake_ocr.json");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(recordPath, `${JSON.stringify({ ...record, capabilities: ["run_shell"] }, null, 2)}\n`, "utf8");

    const inspection = harness.service.inspect("fake_ocr");

    expect(inspection.installState).toBe("repair_needed");
    expect(inspection.routable).toBe(false);
    expect(inspection.capabilities).toEqual(["ocr.text"]);
    expect(inspection.routedCapabilities).toEqual([]);
  });

  it("rejects cleanup paths outside the selected tool ownership without moving unrelated records", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("cleanup-ownership"), "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    await harness.service.install(installRequest(fixture, "request-cleanup-ownership-install"));
    const recordPath = path.join(harness.localToolRoot, "records", "fake_ocr.json");
    const unrelatedPath = path.join(harness.localToolRoot, "records", "other.json");
    fs.writeFileSync(unrelatedPath, "{\"unrelated\":true}\n");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(recordPath, `${JSON.stringify({
      ...record,
      cleanupPendingRelativePaths: ["records/other.json"]
    }, null, 2)}\n`, "utf8");

    expect(harness.service.inspect("fake_ocr").installState).toBe("error");
    const recovered = harness.service.recoverStaging({
      requestId: "request-cleanup-ownership-recover",
      userOrigin: "user",
    });
    expect(recovered.job.state).toBe("completed");
    expect(fs.readFileSync(unrelatedPath, "utf8")).toBe("{\"unrelated\":true}\n");
  });

  it("rejects conflicting bytes already published at the approved same-version path", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("version-conflict"), "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    const digest = fixture.packageSha256.slice("sha256:".length);
    const conflictingPath = path.join(harness.localToolRoot, "installs", "fake_ocr", `1.0.0-${digest}`);
    fs.mkdirSync(path.dirname(conflictingPath), { recursive: true });
    fs.cpSync(fixture.rootPath, conflictingPath, { recursive: true });
    fs.writeFileSync(path.join(conflictingPath, "bin", "fake-ocr.txt"), "conflicting-live-bytes\n");

    const result = await harness.service.install(installRequest(fixture, "request-version-path-conflict"));
    expect(result.job.state).toMatch(/^failed_/);
    expect(result.inspection).toMatchObject({ installState: "available", routable: false });
    expect(fs.existsSync(path.join(harness.localToolRoot, "records", "fake_ocr.json"))).toBe(false);
  });

  it("preserves v1 through injected v2 failures and switches only after a successful side-by-side update", async () => {
    const fixtureRoot = makeTempRoot("side-by-side");
    const v1 = createFakeLocalToolFixture(path.join(fixtureRoot, "v1"), { version: "1.0.0" });
    const v2 = createFakeLocalToolFixture(path.join(fixtureRoot, "v2"), {
      version: "2.0.0",
      files: { "bin/fake-ocr.txt": "fake-local-tool-v2\n" }
    });
    const localToolRoot = path.join(makeTempRoot("side-by-side-root"), "local-tools");
    const jobs = new MemoryJobRecorder();
    const permissions = new AllowingAuthorityPort();
    const selfTest = new FakeSelfTestPort();
    const initial = makeHarness({ tools: [toToolDefinition(v1)] }, { localToolRoot, jobRecorder: jobs, authorityPort: permissions, selfTestPort: selfTest });
    await initial.service.install(installRequest(v1, "request-side-v1"));

    const points: LocalToolFailurePoint[] = ["copy", "verify", "test", "publish", "record_precommit"];
    for (const [index, failurePoint] of points.entries()) {
      const failing = makeHarness({ tools: [toToolDefinition(v2)] }, {
        localToolRoot,
        jobRecorder: jobs,
        authorityPort: permissions,
        selfTestPort: selfTest,
        faultInjector: (point) => {
          if (point === failurePoint) throw new Error(`injected-${point}`);
        }
      });
      const result = await failing.service.update(installRequest(v2, `request-v2-failure-${index}`));
      expect(result.job.state).toBe("failed_retryable");
      expect(failing.service.inspect("fake_ocr")).toMatchObject({ activeVersion: "1.0.0", routable: true });
    }

    const succeeding = makeHarness({ tools: [toToolDefinition(v2)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions,
      selfTestPort: selfTest
    });
    const result = await succeeding.service.update(installRequest(v2, "request-v2-success"));
    expect(result.job.state).toBe("completed");
    expect(result.inspection).toMatchObject({ activeVersion: "2.0.0", installState: "installed", routable: true });
    expect(findVersionDirectories(localToolRoot).some((entry) => entry.includes("1.0.0-"))).toBe(true);
    expect(findVersionDirectories(localToolRoot).some((entry) => entry.includes("2.0.0-"))).toBe(true);
  });

  it("rejects a stale async update after a later same-process disable wins", async () => {
    const root = makeTempRoot("record-race");
    const v1 = createFakeLocalToolFixture(path.join(root, "v1"));
    const v2 = createFakeLocalToolFixture(path.join(root, "v2"), {
      version: "2.0.0",
      files: { "bin/fake-ocr.txt": "v2\n" }
    });
    const localToolRoot = path.join(root, "app-data", "local-tools");
    const jobs = new MemoryJobRecorder();
    const permissions = new AllowingAuthorityPort();
    const initialSelfTest = new FakeSelfTestPort();
    const initial = makeHarness({ tools: [toToolDefinition(v1)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions,
      selfTestPort: initialSelfTest
    });
    await initial.service.install(installRequest(v1, "request-record-race-v1"));

    const deferred = new DeferredSelfTestPort();
    const updating = makeHarness({ tools: [toToolDefinition(v2)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions,
      selfTestPort: deferred
    });
    const updatePromise = updating.service.update(installRequest(v2, "request-record-race-v2"));
    await deferred.started;
    const disabled = updating.service.setEnabled({
      ...targetRequest(v1, "request-record-race-disable"),
      enabled: false
    });
    expect(disabled.inspection).toMatchObject({ activeVersion: "1.0.0", enabled: false, routable: false });
    deferred.release();

    const update = await updatePromise;
    expect(update.job).toMatchObject({
      state: "failed_retryable",
      error: { code: "settings.local_tool_record_changed" }
    });
    expect(update.inspection).toMatchObject({
      activeVersion: "1.0.0",
      installState: "needs_update",
      enabled: false,
      routable: false
    });
  });

  it("does not convert a healthy tool to repair-needed when a later disable wins an explicit-test race", async () => {
    const root = makeTempRoot("test-record-race");
    const fixture = createFakeLocalToolFixture(path.join(root, "fixture"));
    const localToolRoot = path.join(root, "app-data", "local-tools");
    const jobs = new MemoryJobRecorder();
    const permissions = new AllowingAuthorityPort();
    const initial = makeHarness({ tools: [toToolDefinition(fixture)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions
    });
    await initial.service.install(installRequest(fixture, "request-test-race-install"));

    const deferred = new DeferredSelfTestPort();
    const testing = makeHarness({ tools: [toToolDefinition(fixture)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions,
      selfTestPort: deferred
    });
    const testPromise = testing.service.test(targetRequest(fixture, "request-test-race-health"));
    await deferred.started;
    testing.service.setEnabled({
      ...targetRequest(fixture, "request-test-race-disable"),
      enabled: false
    });
    deferred.release();

    const result = await testPromise;
    expect(result.job).toMatchObject({
      state: "failed_retryable",
      error: { code: "settings.local_tool_record_changed" }
    });
    expect(result.inspection).toMatchObject({
      installState: "installed",
      enabled: false,
      healthy: true,
      routable: false
    });
  });

  it("disables and enables routing through record-only changes without rewriting installed bytes", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("enable"), "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    await harness.service.install(installRequest(fixture, "request-enable-install"));
    const installsRoot = path.join(harness.localToolRoot, "installs");
    const assetHash = hashTree(installsRoot);
    const selfTestCount = harness.selfTest.calls.length;

    const disabled = harness.service.setEnabled({
      ...targetRequest(fixture, "request-disable"),
      enabled: false
    });
    expect(disabled.inspection).toMatchObject({ installState: "installed", enabled: false, routable: false });
    expect(hashTree(installsRoot)).toBe(assetHash);

    const enabled = harness.service.setEnabled({
      ...targetRequest(fixture, "request-enable"),
      enabled: true
    });
    expect(enabled.inspection).toMatchObject({ enabled: true, routable: true });
    expect(hashTree(installsRoot)).toBe(assetHash);
    expect(harness.selfTest.calls).toHaveLength(selfTestCount);
  });

  it("detects active-byte drift and repairs only after a valid staged replacement", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("repair"), "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    await harness.service.install(installRequest(fixture, "request-repair-install"));
    const recordPath = path.join(harness.localToolRoot, "records", "fake_ocr.json");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as { activeRelativePath: string };
    const activePayload = path.join(harness.localToolRoot, record.activeRelativePath, "bin", "fake-ocr.txt");
    fs.writeFileSync(activePayload, "damaged-installed-bytes\n");
    expect(harness.service.inspect("fake_ocr")).toMatchObject({ installState: "repair_needed", routable: false });

    fs.writeFileSync(path.join(fixture.rootPath, "bin", "fake-ocr.txt"), "invalid-repair\n");
    const invalid = await harness.service.repair(installRequest(fixture, "request-repair-invalid"));
    expect(invalid.job.state).toMatch(/^failed_/);
    expect(harness.service.inspect("fake_ocr").installState).toBe("repair_needed");

    const restoredFixture = createFakeLocalToolFixture(fixture.rootPath);
    const precommitFailure = makeHarness({ tools: [toToolDefinition(restoredFixture)] }, {
      localToolRoot: harness.localToolRoot,
      jobRecorder: harness.jobs,
      authorityPort: harness.permissions,
      selfTestPort: harness.selfTest,
      faultInjector: (point) => {
        if (point === "record_precommit") throw new Error("injected-repair-precommit");
      }
    });
    const rolledBack = await precommitFailure.service.repair(
      installRequest(restoredFixture, "request-repair-precommit")
    );
    expect(rolledBack.job.state).toBe("failed_retryable");
    expect(precommitFailure.service.inspect("fake_ocr").installState).toBe("repair_needed");
    expect(fs.readFileSync(activePayload, "utf8")).toBe("damaged-installed-bytes\n");

    const repaired = await harness.service.repair(installRequest(restoredFixture, "request-repair-valid"));
    expect(repaired.job.state).toBe("completed");
    expect(repaired.inspection).toMatchObject({ installState: "installed", healthy: true, routable: true });
  });

  it("keeps language-pack lifecycle independent and never cascades engine removal", async () => {
    const root = makeTempRoot("language-packs");
    const engine = createFakeLocalToolFixture(path.join(root, "engine"));
    const ja = createFakeLocalToolFixture(path.join(root, "ja"), {
      assetId: "lang_ja",
      capabilities: ["ocr.language.ja"],
      files: { "models/ja.bin": "ja-pack\n" }
    });
    const ko = createFakeLocalToolFixture(path.join(root, "ko"), {
      assetId: "lang_ko",
      capabilities: ["ocr.language.ko"],
      files: { "models/ko.bin": "ko-pack\n" }
    });
    const definition = toToolDefinition(engine, { assets: [toAssetDefinition(ja), toAssetDefinition(ko)] });
    const harness = makeHarness({ tools: [definition] });
    await harness.service.install(installRequest(engine, "request-engine-install"));
    await harness.service.install(installRequest(ja, "request-ja-install"));
    await harness.service.install(installRequest(ko, "request-ko-install"));

    const record = JSON.parse(
      fs.readFileSync(path.join(harness.localToolRoot, "records", "fake_ocr.json"), "utf8")
    ) as { assets: { assetId: string; activeRelativePath: string }[] };
    const jaPath = record.assets.find((asset) => asset.assetId === "lang_ja")!.activeRelativePath;
    const koPath = record.assets.find((asset) => asset.assetId === "lang_ko")!.activeRelativePath;
    const jaBytesBeforeRepair = hashTree(path.join(harness.localToolRoot, jaPath));
    fs.writeFileSync(path.join(harness.localToolRoot, koPath, "models", "ko.bin"), "damaged-ko-pack\n");
    expect(harness.service.inspect("fake_ocr").assets.find((asset) => asset.assetId === "lang_ko"))
      .toMatchObject({ installState: "repair_needed", routable: false });
    const repairedKo = await harness.service.repair(installRequest(ko, "request-ko-repair"));
    expect(repairedKo.job.state).toBe("completed");
    expect(repairedKo.inspection?.assets.find((asset) => asset.assetId === "lang_ko"))
      .toMatchObject({ installState: "installed", routable: true });
    expect(hashTree(path.join(harness.localToolRoot, jaPath))).toBe(jaBytesBeforeRepair);

    const disabledJa = harness.service.setEnabled({ ...targetRequest(ja, "request-ja-disable"), enabled: false });
    expect(disabledJa.inspection?.assets.find((asset) => asset.assetId === "lang_ja")?.routable).toBe(false);
    expect(disabledJa.inspection?.assets.find((asset) => asset.assetId === "lang_ko")?.routable).toBe(true);

    const removedEngine = harness.service.remove(targetRequest(engine, "request-engine-remove"));
    expect(removedEngine.inspection?.installState).toBe("available");
    expect(removedEngine.inspection?.assets.map((asset) => asset.installState)).toEqual(["installed", "installed"]);
    expect(removedEngine.inspection?.assets.every((asset) => !asset.routable)).toBe(true);

    const removedJa = harness.service.remove(targetRequest(ja, "request-ja-remove"));
    expect(removedJa.inspection?.assets.find((asset) => asset.assetId === "lang_ja")?.installState).toBe("available");
    expect(removedJa.inspection?.assets.find((asset) => asset.assetId === "lang_ko")?.installState).toBe("installed");
  });

  it("recovers stale staging, orphan versions, and committed-remove residue idempotently without routing bytes", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("recovery"), "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    await harness.service.install(installRequest(fixture, "request-recovery-install"));
    const recordPath = path.join(harness.localToolRoot, "records", "fake_ocr.json");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as Record<string, unknown>;
    const activeRelativePath = String(record.activeRelativePath);
    const residualRelativePath = "installs/fake_ocr/removed-residual";
    fs.cpSync(
      path.join(harness.localToolRoot, activeRelativePath),
      path.join(harness.localToolRoot, residualRelativePath),
      { recursive: true }
    );
    const availableRecord = {
      ...record,
      installState: "available",
      enabled: false,
      health: "unknown",
      cleanupPendingRelativePaths: [residualRelativePath]
    } as Record<string, unknown>;
    delete availableRecord.activeVersion;
    delete availableRecord.activeManifestSha256;
    delete availableRecord.activeRelativePath;
    delete availableRecord.sizeBytes;
    fs.writeFileSync(recordPath, `${JSON.stringify(availableRecord, null, 2)}\n`, "utf8");
    const staleStaging = path.join(harness.localToolRoot, "staging", "stale-request");
    fs.mkdirSync(staleStaging, { recursive: true });
    fs.writeFileSync(path.join(staleStaging, "partial"), "partial");
    const orphan = path.join(harness.localToolRoot, "installs", "fake_ocr", "9.9.9-orphan");
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, "orphan"), "orphan");

    const first = harness.service.recoverStaging({
      requestId: "request-recover-first",
      userOrigin: "user",
    });
    expect(first.job.state).toBe("completed");
    expect(first.recoveredEntries).toBeGreaterThanOrEqual(3);
    expect(harness.service.inspect("fake_ocr")).toMatchObject({ installState: "available", routable: false });
    expect(fs.existsSync(staleStaging)).toBe(false);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(path.join(harness.localToolRoot, residualRelativePath))).toBe(false);

    const second = harness.service.recoverStaging({
      requestId: "request-recover-second",
      userOrigin: "user",
    });
    expect(second.recoveredEntries).toBe(0);
  });

  it("makes repeated request identities idempotent and rejects conflicting reuse or same-version bytes", async () => {
    const root = makeTempRoot("idempotency");
    const fixture = createFakeLocalToolFixture(path.join(root, "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    const request = installRequest(fixture, "request-idempotent-install");
    const first = await harness.service.install(request);
    const writesAfterFirst = harness.jobs.writes.length;
    const testsAfterFirst = harness.selfTest.calls.length;
    const second = await harness.service.install(request);
    expect(second.idempotent).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(harness.jobs.writes).toHaveLength(writesAfterFirst);
    expect(harness.selfTest.calls).toHaveLength(testsAfterFirst);

    expect(() => harness.service.setEnabled({
      ...targetRequest(fixture, "request-idempotent-install"),
      enabled: false
    })).toThrowError(PigeDomainError);

    harness.service.setEnabled({
      ...targetRequest(fixture, "request-enabled-intent"),
      enabled: false
    });
    expect(() => harness.service.setEnabled({
      ...targetRequest(fixture, "request-enabled-intent"),
      enabled: true
    })).toThrowError(PigeDomainError);

    const conflicting = createFakeLocalToolFixture(path.join(root, "conflicting"), {
      files: { "bin/fake-ocr.txt": "different-same-version\n" }
    });
    await expect(harness.service.update(installRequest(conflicting, "request-conflicting-bytes")))
      .rejects.toMatchObject({ code: "settings.local_tool_identity_mismatch" });
    expect(harness.service.inspect("fake_ocr")).toMatchObject({
      activeVersion: "1.0.0",
      enabled: false,
      routable: false
    });
  });

  it("retries a retryable request through the same Job and admits only one concurrent execution", async () => {
    const root = makeTempRoot("same-request-retry");
    const fixture = createFakeLocalToolFixture(path.join(root, "fixture"));
    const localToolRoot = path.join(root, "app-data", "local-tools");
    const jobs = new MemoryJobRecorder();
    const permissions = new AllowingAuthorityPort();
    const first = makeHarness({ tools: [toToolDefinition(fixture)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions
    });
    first.selfTest.result = {
      schemaVersion: 1,
      passed: false,
      outputBytes: 8,
      messageCode: "local_tool.test_failed"
    };
    const request = installRequest(fixture, "request-same-job-retry");
    const failed = await first.service.install(request);
    expect(failed.job).toMatchObject({ state: "failed_retryable", retry: { retryCount: 0 } });

    const deferred = new DeferredSelfTestPort();
    const retrying = makeHarness({ tools: [toToolDefinition(fixture)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions,
      selfTestPort: deferred
    });
    const retryPromise = retrying.service.install(request);
    await deferred.started;
    const duplicate = await retrying.service.install(request);

    expect(duplicate).toMatchObject({ idempotent: true, job: { id: failed.job.id, state: "running" } });
    expect(deferred.callCount).toBe(1);
    deferred.release();
    const completed = await retryPromise;
    expect(completed).toMatchObject({
      idempotent: false,
      job: {
        id: failed.job.id,
        state: "completed",
        retry: { retryCount: 1, lastRetryReason: "same_request_retry" }
      },
      inspection: { installState: "installed", routable: true }
    });
    expect(findVersionDirectories(localToolRoot)).toHaveLength(1);
  });

  it("adopts a committed Local Tool record after stale Job settlement contention", async () => {
    const root = makeTempRoot("durable-effect-contention");
    const fixture = createFakeLocalToolFixture(path.join(root, "fixture"));
    const localToolRoot = path.join(root, "app-data", "local-tools");
    const jobs = new MemoryJobRecorder();
    const permissions = new AllowingAuthorityPort();
    const initial = makeHarness({ tools: [toToolDefinition(fixture)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions
    });
    await initial.service.install(installRequest(fixture, "request-contention-install"));

    let contentionArmed = false;
    const contended = makeHarness({ tools: [toToolDefinition(fixture)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions,
      faultInjector: (point) => {
        if (point !== "record_precommit" || contentionArmed) return;
        contentionArmed = true;
        jobs.contendNextCompareAndSwap((job) => ({
          ...job,
          state: "cancel_requested",
          updatedAt: "2026-07-23T00:00:01.000Z",
          cancellation: {
            requestedAt: "2026-07-23T00:00:01.000Z",
            requestedBy: "user"
          },
          message: "Synthetic cancellation won the stale snapshot race."
        }));
      }
    });
    const result = contended.service.setEnabled({
      ...targetRequest(fixture, "request-contention-disable"),
      enabled: false
    });

    expect(contentionArmed).toBe(true);
    expect(result).toMatchObject({
      idempotent: false,
      job: {
        state: "completed_with_warnings",
        cancellation: { requestedBy: "user", durableWritesApplied: true }
      },
      inspection: { enabled: false, routable: false }
    });
    expect(result.job.outputRefs).toContainEqual(expect.objectContaining({
      kind: "tool",
      role: "local_tool_set_enabled_effect"
    }));
    expect(jobs.findByRequestId("request-contention-disable")?.job).toEqual(result.job);
  });

  it("converges stale async failure settlement after cancellation wins the Job CAS", async () => {
    const root = makeTempRoot("failure-contention");
    const fixture = createFakeLocalToolFixture(path.join(root, "fixture"));
    const jobs = new MemoryJobRecorder();
    const deferred = new DeferredSelfTestPort({
      schemaVersion: 1,
      passed: false,
      outputBytes: 8,
      messageCode: "local_tool.test_failed"
    });
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] }, {
      localToolRoot: path.join(root, "app-data", "local-tools"),
      jobRecorder: jobs,
      selfTestPort: deferred
    });
    const pending = harness.service.install(installRequest(fixture, "request-failure-contention"));
    await deferred.started;
    jobs.contendNextCompareAndSwap((job) => ({
      ...job,
      state: "cancel_requested",
      updatedAt: "2026-07-23T00:00:01.000Z",
      cancellation: {
        requestedAt: "2026-07-23T00:00:01.000Z",
        requestedBy: "user",
        durableWritesApplied: false
      },
      message: "Synthetic cancellation won failure settlement."
    }));
    deferred.release();

    const result = await pending;
    expect(result.job).toMatchObject({
      state: "cancelled",
      cancellation: { requestedBy: "user", durableWritesApplied: false }
    });
    expect(jobs.findByRequestId("request-failure-contention")?.job).toEqual(result.job);
    expect(findVersionDirectories(harness.localToolRoot)).toHaveLength(0);
  });

  it("enforces distinct install, update, and repair transition preconditions", async () => {
    const fixture = createFakeLocalToolFixture(path.join(makeTempRoot("transitions"), "fixture"));
    const harness = makeHarness({ tools: [toToolDefinition(fixture)] });
    await harness.service.install(installRequest(fixture, "request-transition-install"));

    const secondInstall = await harness.service.install(installRequest(fixture, "request-transition-install-again"));
    expect(secondInstall.job).toMatchObject({
      state: "failed_final",
      error: { code: "settings.local_tool_already_installed" }
    });
    const sameVersionUpdate = await harness.service.update(installRequest(fixture, "request-transition-update-same"));
    expect(sameVersionUpdate.job).toMatchObject({
      state: "failed_final",
      error: { code: "settings.local_tool_version_conflict" }
    });

    const fresh = makeHarness({ tools: [toToolDefinition(fixture)] });
    const repairWithoutInstall = await fresh.service.repair(installRequest(fixture, "request-transition-repair-empty"));
    expect(repairWithoutInstall.job).toMatchObject({
      state: "failed_final",
      error: { code: "settings.local_tool_not_installed" }
    });
  });

  it("never changes a vault durable tree during update, disable, repair, or remove", async () => {
    const root = makeTempRoot("vault-invariance");
    const vaultPath = path.join(root, "vault");
    fs.mkdirSync(path.join(vaultPath, ".pige", "source-records"), { recursive: true });
    fs.mkdirSync(path.join(vaultPath, "Notes"), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, "Notes", "note.md"), "# Durable note\n");
    fs.writeFileSync(path.join(vaultPath, ".pige", "source-records", "src.json"), "{\"source\":true}\n");
    const vaultHash = hashTree(vaultPath);
    const v1 = createFakeLocalToolFixture(path.join(root, "v1"));
    const v2 = createFakeLocalToolFixture(path.join(root, "v2"), {
      version: "2.0.0",
      files: { "bin/fake-ocr.txt": "v2\n" }
    });
    const localToolRoot = path.join(root, "app-data", "local-tools");
    const jobs = new MemoryJobRecorder();
    const permissions = new AllowingAuthorityPort();
    const selfTest = new FakeSelfTestPort();
    const v1Harness = makeHarness({ tools: [toToolDefinition(v1)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions,
      selfTestPort: selfTest
    });
    await v1Harness.service.install(installRequest(v1, "request-vault-install"));
    v1Harness.service.setEnabled({ ...targetRequest(v1, "request-vault-disable"), enabled: false });
    const v2Harness = makeHarness({ tools: [toToolDefinition(v2)] }, {
      localToolRoot,
      jobRecorder: jobs,
      authorityPort: permissions,
      selfTestPort: selfTest
    });
    await v2Harness.service.update(installRequest(v2, "request-vault-update"));
    const activeRecord = JSON.parse(
      fs.readFileSync(path.join(localToolRoot, "records", "fake_ocr.json"), "utf8")
    ) as { activeRelativePath: string };
    fs.writeFileSync(
      path.join(localToolRoot, activeRecord.activeRelativePath, "bin", "fake-ocr.txt"),
      "damaged-v2\n"
    );
    expect(v2Harness.service.inspect("fake_ocr").installState).toBe("repair_needed");
    await v2Harness.service.repair(installRequest(v2, "request-vault-repair"));
    v2Harness.service.remove(targetRequest(v2, "request-vault-remove"));

    expect(hashTree(vaultPath)).toBe(vaultHash);
  });
});

function findVersionDirectories(localToolRoot: string): string[] {
  const result: string[] = [];
  for (const owner of ["installs", "assets"]) {
    const ownerRoot = path.join(localToolRoot, owner);
    if (!fs.existsSync(ownerRoot)) continue;
    const visit = (directoryPath: string): void => {
      for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const absolutePath = path.join(directoryPath, entry.name);
        const relativePath = path.relative(ownerRoot, absolutePath);
        if (fs.existsSync(path.join(absolutePath, "manifest.json"))) result.push(`${owner}/${relativePath}`);
        else visit(absolutePath);
      }
    };
    visit(ownerRoot);
  }
  return result.sort();
}
