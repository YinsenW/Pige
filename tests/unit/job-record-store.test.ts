import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobRecordStore } from "../../apps/desktop/src/main/services/job-record-store";

const tempRoots: string[] = [];
const children = new Set<ChildProcessWithoutNullStreams>();
const TEST_CLAIM_TIMING = { staleMs: 2_000, updateMs: 1_000 } as const;

afterEach(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  children.clear();
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("JobRecordStore", () => {
  it("commits exactly one compare-and-swap winner and returns a fresh byte revision", () => {
    const fixture = makeFixture();
    const created = fixture.store.createIfAbsent(fixture.jobPath, makeJob());
    const competing = fixture.store.read(fixture.jobPath);
    const committed = fixture.store.compareAndSwap(created, makeJob({
      state: "running",
      startedAt: "2026-07-13T10:01:00.000Z",
      message: "Running"
    }));

    expect(committed.job.state).toBe("running");
    expect(committed.revision.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(committed.revision.sha256).not.toBe(created.revision.sha256);
    expect(committed.revision.ino).not.toBe(created.revision.ino);
    expect(committed.revision).not.toHaveProperty("updatedAt");
    expect(() => fixture.store.compareAndSwap(competing, makeJob({ message: "Loser" })))
      .toThrowError(expectConflict());
    expect(fixture.store.read(fixture.jobPath).job.message).toBe("Running");
  });

  it("rejects a stale snapshot even when updatedAt is unchanged but exact bytes differ", () => {
    const fixture = makeFixture();
    const original = fixture.store.createIfAbsent(fixture.jobPath, makeJob());
    const changed = makeJob({ message: "Different exact bytes" });
    fs.writeFileSync(fixture.jobPath, `${JSON.stringify(changed, null, 2)}\n`, { mode: 0o600 });

    expect(changed.updatedAt).toBe(original.job.updatedAt);
    expect(() => fixture.store.compareAndSwap(original, makeJob({ state: "running" })))
      .toThrowError(expectConflict());
    expect(fixture.store.read(fixture.jobPath).job.message).toBe("Different exact bytes");
  });

  it.skipIf(process.platform === "win32")("rejects symlinked records and byte-identical path replacement", () => {
    const fixture = makeFixture();
    const outsidePath = path.join(fixture.root, "outside.json");
    fs.writeFileSync(outsidePath, `${JSON.stringify(makeJob(), null, 2)}\n`, { mode: 0o600 });
    fs.mkdirSync(path.dirname(fixture.jobPath), { recursive: true });
    fs.symlinkSync(outsidePath, fixture.jobPath);

    expect(() => fixture.store.read(fixture.jobPath)).toThrowError(
      expect.objectContaining({ code: "job.record_unsafe" })
    );
    fs.unlinkSync(fixture.jobPath);
    const snapshot = fixture.store.createIfAbsent(fixture.jobPath, makeJob());
    const replacement = path.join(path.dirname(fixture.jobPath), "replacement.json");
    fs.writeFileSync(replacement, fs.readFileSync(fixture.jobPath), { mode: 0o600 });
    fs.renameSync(replacement, fixture.jobPath);

    expect(fixture.store.read(fixture.jobPath).revision.sha256).toBe(snapshot.revision.sha256);
    expect(() => fixture.store.compareAndSwap(snapshot, makeJob({ state: "running" })))
      .toThrowError(expectConflict());
  });

  it("creates without replacement and leaves the existing Job bytes unchanged", () => {
    const fixture = makeFixture();
    fixture.store.createIfAbsent(fixture.jobPath, makeJob());
    const before = fs.readFileSync(fixture.jobPath);

    expect(() => fixture.store.createIfAbsent(fixture.jobPath, makeJob({ message: "Overwrite" })))
      .toThrowError(expectConflict());
    expect(fs.readFileSync(fixture.jobPath)).toEqual(before);
  });

  it("requires an explicit lease policy and propagates a failed writer-lease assertion", () => {
    const root = makeRoot();
    expect(() => new JobRecordStore({ rootPath: path.join(root, "jobs") } as never)).toThrowError(
      expect.objectContaining({ code: "job.writer_lease_required" })
    );

    const jobsRoot = path.join(root, "leased-jobs");
    fs.mkdirSync(jobsRoot);
    const leaseError = new PigeDomainError("vault.writer_lease_lost", "Lease lost.");
    const store = new JobRecordStore({
      rootPath: jobsRoot,
      assertWriterLease: () => {
        throw leaseError;
      }
    });
    const filePath = jobPath(jobsRoot);

    expect(() => store.read(filePath)).toThrowError(leaseError);
    expect(() => store.createIfAbsent(filePath, makeJob())).toThrowError(leaseError);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(new JobRecordStore({ rootPath: jobsRoot, unsafeAllowUnfenced: true })).toBeInstanceOf(JobRecordStore);
  });

  it("uses a private temporary file and removes it when the final lease assertion fails", () => {
    const root = makeRoot();
    const jobsRoot = path.join(root, "jobs");
    fs.mkdirSync(jobsRoot);
    const filePath = jobPath(jobsRoot);
    let observedMode: number | undefined;
    const store = new JobRecordStore({
      rootPath: jobsRoot,
      assertWriterLease: () => {
        const temporaryPath = listTemporaryFiles(jobsRoot)[0];
        if (!temporaryPath) return;
        observedMode = fs.statSync(temporaryPath).mode & 0o777;
        throw new PigeDomainError("vault.writer_lease_lost", "Lease lost before commit.");
      }
    });

    expect(() => store.createIfAbsent(filePath, makeJob())).toThrowError(
      expect.objectContaining({ code: "vault.writer_lease_lost" })
    );
    expect(observedMode).toBe(0o600);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(listTemporaryFiles(jobsRoot)).toEqual([]);
  });

  it("cleans its private temporary file after a stale compare-and-swap rejection", () => {
    const fixture = makeFixture();
    const stale = fixture.store.createIfAbsent(fixture.jobPath, makeJob());
    const winner = fixture.store.read(fixture.jobPath);
    fixture.store.compareAndSwap(winner, makeJob({ message: "Winner" }));

    expect(() => fixture.store.compareAndSwap(stale, makeJob({ message: "Stale" })))
      .toThrowError(expectConflict());
    expect(listTemporaryFiles(fixture.jobsRoot)).toEqual([]);
  });

  it("offers a synchronous mutation helper without weakening schema validation", () => {
    const fixture = makeFixture();
    const created = fixture.store.createIfAbsent(fixture.jobPath, makeJob());
    const mutated = fixture.store.mutate(created, (current) => JobRecordSchema.parse({
      ...current,
      state: "running",
      startedAt: "2026-07-13T10:01:00.000Z",
      message: "Mutated"
    }));

    expect(mutated.job).toMatchObject({ state: "running", message: "Mutated" });
  });

  it("grants one ephemeral Job claim owner and rejects a competing owner", () => {
    const fixture = makeFixture();
    const first = fixture.store.acquireClaim(fixture.jobPath);
    const competitor = new JobRecordStore({ rootPath: fixture.jobsRoot, unsafeAllowUnfenced: true });

    expect(() => competitor.acquireClaim(fixture.jobPath)).toThrowError(
      expect.objectContaining({ code: "job.claim_conflict" })
    );
    first.assertHeld();
    first.release();

    const recovered = competitor.acquireClaim(fixture.jobPath);
    recovered.assertHeld();
    recovered.release();
  });

  it("keeps two different active Job claims independent when the first is released", () => {
    const fixture = makeFixture();
    const secondJobId = "job_20260713_abcdef654321";
    const secondJobPath = jobPath(fixture.jobsRoot, secondJobId);
    const first = fixture.store.acquireClaim(fixture.jobPath);
    const second = fixture.store.acquireClaim(secondJobPath);

    first.release();
    second.assertHeld();

    const competitor = new JobRecordStore({ rootPath: fixture.jobsRoot, unsafeAllowUnfenced: true });
    expect(() => competitor.acquireClaim(secondJobPath)).toThrowError(
      expect.objectContaining({ code: "job.claim_conflict" })
    );
    expect(() => second.release()).not.toThrow();
  });

  it("fails closed when a Job claim owner token is replaced", () => {
    const fixture = makeFixture();
    const claim = fixture.store.acquireClaim(fixture.jobPath);
    const ownerPath = onlyClaimSentinel(onlyClaimLock(fixture.root));
    fs.writeFileSync(ownerPath, `${JSON.stringify({ schemaVersion: 1, token: "A".repeat(43) })}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    if (process.platform !== "win32") fs.chmodSync(ownerPath, 0o600);

    expect(() => claim.assertHeld()).toThrowError(expect.objectContaining({ code: "job.claim_lost" }));
    expect(() => claim.release()).toThrowError(expect.objectContaining({ code: "job.claim_lost" }));
    expect(JSON.parse(fs.readFileSync(ownerPath, "utf8"))).toMatchObject({ token: "A".repeat(43) });
  });

  it("recovers a stale malformed owner after claim-sentinel initialization fails", async () => {
    const root = makeRoot();
    const jobsRoot = path.join(root, "jobs");
    fs.mkdirSync(jobsRoot);
    const filePath = jobPath(jobsRoot);
    const failingStore = new JobRecordStore({
      rootPath: jobsRoot,
      unsafeAllowUnfenced: true,
      claimTiming: TEST_CLAIM_TIMING,
      testOnlyHooks: {
        afterClaimOwnerOpen: () => {
          throw new Error("simulated owner initialization failure");
        }
      }
    });

    expect(() => failingStore.acquireClaim(filePath)).toThrowError(
      expect.objectContaining({ code: "job.claim_invalid" })
    );
    const lockPath = onlyClaimLock(root);
    expect(fs.readdirSync(lockPath)).toEqual([]);
    const malformedToken = "D".repeat(43);
    fs.writeFileSync(path.join(lockPath, `.owner-${malformedToken}.json`), "{\"schemaVersion\":", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    fs.utimesSync(lockPath, new Date(0), new Date(0));

    const recoveryStore = new JobRecordStore({
      rootPath: jobsRoot,
      unsafeAllowUnfenced: true,
      claimTiming: TEST_CLAIM_TIMING
    });
    const recovered = await acquireAfterStale(recoveryStore, filePath);
    recovered.assertHeld();
    recovered.release();
  }, 15_000);

  it("does not remove a successor claim replaced in the exact release cleanup window", () => {
    const fixture = makeFixture();
    const claim = fixture.store.acquireClaim(fixture.jobPath);
    const lockPath = onlyClaimLock(fixture.root);
    const successorToken = "B".repeat(43);
    const originalRmdirSync = fs.rmdirSync.bind(fs);
    let replaced = false;
    vi.spyOn(fs, "rmdirSync").mockImplementation(((candidatePath: fs.PathLike) => {
      if (!replaced && path.resolve(String(candidatePath)) === lockPath) {
        replaced = true;
        replaceClaimLockWithSuccessor(lockPath, successorToken);
      }
      return originalRmdirSync(candidatePath);
    }) as typeof fs.rmdirSync);

    expect(() => claim.release()).toThrowError(expect.objectContaining({ code: "job.claim_lost" }));
    expect(replaced).toBe(true);
    expect(readClaimSentinelToken(lockPath)).toBe(successorToken);
  });

  it("does not remove a successor claim replaced in the exact stale-cleanup window", () => {
    const fixture = makeFixture();
    fixture.store.acquireClaim(fixture.jobPath);
    const lockPath = onlyClaimLock(fixture.root);
    const staleTime = new Date(Date.now() - TEST_CLAIM_TIMING.staleMs - 1_000);
    fs.utimesSync(lockPath, staleTime, staleTime);
    const successorToken = "D".repeat(43);
    const originalRmdirSync = fs.rmdirSync.bind(fs);
    let replaced = false;
    vi.spyOn(fs, "rmdirSync").mockImplementation(((candidatePath: fs.PathLike) => {
      if (!replaced && path.resolve(String(candidatePath)) === lockPath) {
        replaced = true;
        replaceClaimLockWithSuccessor(lockPath, successorToken);
      }
      return originalRmdirSync(candidatePath);
    }) as typeof fs.rmdirSync);
    const recoveryStore = new JobRecordStore({
      rootPath: fixture.jobsRoot,
      unsafeAllowUnfenced: true,
      claimTiming: TEST_CLAIM_TIMING
    });

    expect(() => recoveryStore.acquireClaim(fixture.jobPath)).toThrowError(
      expect.objectContaining({ code: "job.claim_invalid" })
    );
    expect(replaced).toBe(true);
    expect(readClaimSentinelToken(lockPath)).toBe(successorToken);
  });

  it("does not remove a successor claim from proper-lockfile process-exit cleanup", async () => {
    const fixture = makeFixture();
    const child = spawnClaimHolder(fixture.root, fixture.jobsRoot, fixture.jobPath);
    children.add(child);
    await waitForOutput(child, "CLAIM_READY");
    const lockPath = onlyClaimLock(fixture.root);
    const successorToken = "C".repeat(43);
    replaceClaimLockWithSuccessor(lockPath, successorToken);

    child.stdin.write("EXIT\n");
    await waitForExit(child);
    children.delete(child);

    expect(child.exitCode).toBe(0);
    expect(readClaimSentinelToken(lockPath)).toBe(successorToken);
  });

  it.skipIf(process.platform === "win32")("rejects an ancestor swap at claim-owner commit", () => {
    const root = makeRoot();
    const jobsRoot = path.join(root, "jobs");
    fs.mkdirSync(jobsRoot);
    const claimRoot = path.join(root, "runtime", "job-claims");
    const displacedClaimRoot = path.join(root, "displaced-job-claims");
    const store = new JobRecordStore({
      rootPath: jobsRoot,
      unsafeAllowUnfenced: true,
      testOnlyHooks: {
        beforeClaimOwnerCommit: () => relocateDirectoryThroughSymlink(claimRoot, displacedClaimRoot)
      }
    });

    expect(() => store.acquireClaim(jobPath(jobsRoot))).toThrowError(
      expect.objectContaining({ code: "job.claim_invalid" })
    );
    const displacedLock = fs.readdirSync(displacedClaimRoot)
      .map((entry) => path.join(displacedClaimRoot, entry))
      .find((entry) => entry.endsWith(".lock"));
    expect(displacedLock).toBeDefined();
    expect(fs.readdirSync(displacedLock!)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("rejects an ancestor swap at create-only link commit", () => {
    const root = makeRoot();
    const jobsRoot = path.join(root, "jobs");
    fs.mkdirSync(jobsRoot);
    const ownedAncestor = path.join(jobsRoot, "2026");
    const displacedAncestor = path.join(root, "displaced-create-2026");
    const store = new JobRecordStore({
      rootPath: jobsRoot,
      unsafeAllowUnfenced: true,
      testOnlyHooks: {
        beforeCreateLinkCommit: () => relocateDirectoryThroughSymlink(ownedAncestor, displacedAncestor)
      }
    });
    const filePath = jobPath(jobsRoot);

    expect(() => store.createIfAbsent(filePath, makeJob())).toThrowError(
      expect.objectContaining({ code: "job.path_unsafe" })
    );
    expect(fs.existsSync(path.join(displacedAncestor, "07", path.basename(filePath)))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("rejects an ancestor swap at compare-and-swap rename commit", () => {
    const fixture = makeFixture();
    const snapshot = fixture.store.createIfAbsent(fixture.jobPath, makeJob());
    const before = fs.readFileSync(fixture.jobPath);
    const ownedAncestor = path.join(fixture.jobsRoot, "2026");
    const displacedAncestor = path.join(fixture.root, "displaced-cas-2026");
    const store = new JobRecordStore({
      rootPath: fixture.jobsRoot,
      unsafeAllowUnfenced: true,
      testOnlyHooks: {
        beforeCompareAndSwapRenameCommit: () => relocateDirectoryThroughSymlink(
          ownedAncestor,
          displacedAncestor
        )
      }
    });

    expect(() => store.compareAndSwap(snapshot, makeJob({ message: "Redirected" }))).toThrowError(
      expect.objectContaining({ code: "job.path_unsafe" })
    );
    expect(fs.readFileSync(path.join(displacedAncestor, "07", path.basename(fixture.jobPath))))
      .toEqual(before);
  });

  it("recovers a stale Job claim after its real owner process is killed", async () => {
    const fixture = makeFixture();
    const recoveryStore = new JobRecordStore({
      rootPath: fixture.jobsRoot,
      unsafeAllowUnfenced: true,
      claimTiming: TEST_CLAIM_TIMING
    });
    const child = spawnClaimHolder(fixture.root, fixture.jobsRoot, fixture.jobPath);
    children.add(child);
    await waitForOutput(child, "CLAIM_READY");

    expect(() => fixture.store.acquireClaim(fixture.jobPath)).toThrowError(
      expect.objectContaining({ code: "job.claim_conflict" })
    );
    child.kill("SIGKILL");
    await waitForExit(child);
    children.delete(child);

    const recovered = await acquireAfterStale(recoveryStore, fixture.jobPath);
    recovered.assertHeld();
    recovered.release();
  }, 15_000);
});

function makeFixture(): {
  readonly root: string;
  readonly jobsRoot: string;
  readonly jobPath: string;
  readonly store: JobRecordStore;
} {
  const root = makeRoot();
  const jobsRoot = path.join(root, "jobs");
  fs.mkdirSync(jobsRoot);
  return {
    root,
    jobsRoot,
    jobPath: jobPath(jobsRoot),
    store: new JobRecordStore({ rootPath: jobsRoot, assertWriterLease: vi.fn() })
  };
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-job-record-store-"));
  tempRoots.push(root);
  return root;
}

function jobPath(jobsRoot: string, jobId = "job_20260713_abcdef123456"): string {
  return path.join(jobsRoot, "2026", "07", `${jobId}.json`);
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return JobRecordSchema.parse({
    schemaVersion: 1,
    id: "job_20260713_abcdef123456",
    class: "agent_turn",
    state: "queued",
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
    message: "Queued",
    ...overrides
  });
}

function expectConflict(): PigeDomainError {
  return expect.objectContaining({ code: "job.revision_conflict" }) as unknown as PigeDomainError;
}

function listTemporaryFiles(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) files.push(...listTemporaryFiles(entryPath));
    else if (entry.name.endsWith(".tmp")) files.push(entryPath);
  }
  return files;
}

function onlyClaimLock(root: string): string {
  const claimRoot = path.join(root, "runtime", "job-claims");
  const locks = fs.readdirSync(claimRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".lock"))
    .map((entry) => path.join(claimRoot, entry.name));
  expect(locks).toHaveLength(1);
  return locks[0]!;
}

function onlyClaimSentinel(lockPath: string): string {
  const sentinels = fs.readdirSync(lockPath)
    .filter((entry) => entry.startsWith(".owner-") && entry.endsWith(".json"))
    .map((entry) => path.join(lockPath, entry));
  expect(sentinels).toHaveLength(1);
  return sentinels[0]!;
}

function replaceClaimLockWithSuccessor(lockPath: string, token: string): void {
  fs.renameSync(lockPath, `${lockPath}.predecessor`);
  fs.mkdirSync(lockPath, { mode: 0o700 });
  const sentinelPath = path.join(lockPath, `.owner-${token}.json`);
  fs.writeFileSync(sentinelPath, `${JSON.stringify({ schemaVersion: 1, token })}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  if (process.platform !== "win32") fs.chmodSync(sentinelPath, 0o600);
}

function readClaimSentinelToken(lockPath: string): string {
  const parsed = JSON.parse(fs.readFileSync(onlyClaimSentinel(lockPath), "utf8")) as { token: string };
  return parsed.token;
}

function relocateDirectoryThroughSymlink(sourcePath: string, displacedPath: string): void {
  fs.renameSync(sourcePath, displacedPath);
  fs.symlinkSync(displacedPath, sourcePath, "dir");
}

function spawnClaimHolder(root: string, jobsRoot: string, filePath: string): ChildProcessWithoutNullStreams {
  const loaderPath = path.join(root, "pige-job-claim-loader.mjs");
  const childPath = path.join(root, "pige-job-claim-holder.mjs");
  const domainSource = path.resolve("packages/domain/src/index.ts");
  const schemasSource = path.resolve("packages/schemas/src/index.ts");
  const storeSource = path.resolve("apps/desktop/src/main/services/job-record-store.ts");
  fs.writeFileSync(loaderPath, [
    "import { pathToFileURL } from 'node:url';",
    `const domainUrl = ${JSON.stringify(pathToFileURL(domainSource).href)};`,
    `const schemasUrl = ${JSON.stringify(pathToFileURL(schemasSource).href)};`,
    "export async function resolve(specifier, context, nextResolve) {",
    "  if (specifier === '@pige/domain') return { url: domainUrl, shortCircuit: true };",
    "  if (specifier === '@pige/schemas') return { url: schemasUrl, shortCircuit: true };",
    "  return nextResolve(specifier, context);",
    "}",
    ""
  ].join("\n"));
  fs.writeFileSync(childPath, [
    `import { JobRecordStore } from ${JSON.stringify(pathToFileURL(storeSource).href)};`,
    "const store = new JobRecordStore({",
    "  rootPath: process.argv[2],",
    "  unsafeAllowUnfenced: true,",
    "  claimTiming: { staleMs: 2000, updateMs: 1000 }",
    "});",
    "const claim = store.acquireClaim(process.argv[3]);",
    "claim.assertHeld();",
    "process.stdout.write('CLAIM_READY\\n');",
    "process.stdin.once('data', () => process.exit(0));",
    "setInterval(() => claim.assertHeld(), 100);",
    ""
  ].join("\n"));
  return spawn(process.execPath, [
    "--no-warnings",
    "--experimental-loader",
    loaderPath,
    childPath,
    jobsRoot,
    filePath
  ], {
    cwd: path.resolve("."),
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"]
  });
}

async function waitForOutput(child: ChildProcessWithoutNullStreams, expected: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => finish(() => reject(new Error(`Child did not become ready: ${stderr}`))), 5_000);
    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString("utf8");
      if (stdout.includes(expected)) finish(resolve);
    };
    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(() => reject(new Error(`Child exited before ready (${String(code)}/${String(signal)}): ${stderr}`)));
    };
    const finish = (callback: () => void): void => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      callback();
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
  });
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function acquireAfterStale(store: JobRecordStore, filePath: string): Promise<ReturnType<JobRecordStore["acquireClaim"]>> {
  const deadline = Date.now() + TEST_CLAIM_TIMING.staleMs + 3_000;
  while (Date.now() < deadline) {
    try {
      return store.acquireClaim(filePath);
    } catch (caught) {
      if (!(caught instanceof PigeDomainError) || caught.code !== "job.claim_conflict") throw caught;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("The stale Job claim did not become recoverable within the bounded test window.");
}
