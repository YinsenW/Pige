import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  VAULT_WRITER_LOCK_DIRECTORY_NAME,
  VAULT_WRITER_OWNER_RECORD_NAME,
  VaultWriterLease,
  acquireVaultWriterLease,
  acquireVaultWriterLeaseSync
} from "../../apps/desktop/src/main/services/vault-writer-lease";

const roots: string[] = [];
const children = new Set<ChildProcessWithoutNullStreams>();
const TEST_TIMING = { staleMs: 2_000, updateMs: 1_000 } as const;

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  children.clear();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("vault writer lease", () => {
  it("creates the private runtime lock synchronously and an exact mode-0600 owner record", () => {
    const { vaultPath } = makeVault();
    const lease = acquireVaultWriterLease(vaultPath);
    const runtimePath = lease.runtimePath;
    const lockPath = path.join(runtimePath, VAULT_WRITER_LOCK_DIRECTORY_NAME);
    const ownerPath = path.join(runtimePath, VAULT_WRITER_OWNER_RECORD_NAME);

    expect(lease.vaultPath).toBe(fs.realpathSync.native(vaultPath));
    expect(lease.runtimePath).toBe(runtimePath);
    expect(fs.lstatSync(lockPath).isDirectory()).toBe(true);
    expect(fs.lstatSync(ownerPath).isFile()).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(ownerPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(ownerPath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    });
    lease.assertHeld();

    lease.release();
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(ownerPath)).toBe(false);
    expect(() => lease.assertHeld()).toThrowError(expect.objectContaining({ code: "vault.writer_lease_lost" }));
    expect(() => lease.release()).not.toThrow();
  });

  it("exposes explicit synchronous acquire/release aliases with stable contention", () => {
    const { vaultPath } = makeVault();
    const first = acquireVaultWriterLeaseSync(vaultPath);

    expect(() => VaultWriterLease.acquireSync(vaultPath)).toThrowError(expect.objectContaining({
      code: "vault.writer_locked",
      message: "Another Pige writer already owns this vault."
    }));
    first.releaseSync();
  });

  it("rejects invalid timing and symlinked vault or runtime paths without following them", () => {
    const { root, vaultPath } = makeVault();
    expect(() => VaultWriterLease.acquireSync(vaultPath, {
      timing: { staleMs: 1_999, updateMs: 1_000 }
    })).toThrowError(expect.objectContaining({ code: "vault.writer_lease_invalid" }));

    if (process.platform === "win32") return;
    const vaultLink = path.join(root, "vault-link");
    fs.symlinkSync(vaultPath, vaultLink, "dir");
    expect(() => VaultWriterLease.acquireSync(vaultLink)).toThrowError(expect.objectContaining({
      code: "vault.writer_lease_invalid"
    }));

    const runtimePath = path.join(vaultPath, ".pige", "runtime");
    const externalRuntime = path.join(root, "external-runtime");
    fs.mkdirSync(externalRuntime);
    fs.symlinkSync(externalRuntime, runtimePath, "dir");
    expect(() => VaultWriterLease.acquireSync(vaultPath)).toThrowError(expect.objectContaining({
      code: "vault.writer_lease_invalid"
    }));
    expect(fs.readdirSync(externalRuntime)).toEqual([]);
  });

  it("fails closed when the owner token is replaced and does not release another owner", () => {
    const { vaultPath } = makeVault();
    const lease = VaultWriterLease.acquireSync(vaultPath);
    const runtimePath = path.join(vaultPath, ".pige", "runtime");
    const lockPath = path.join(runtimePath, VAULT_WRITER_LOCK_DIRECTORY_NAME);
    const ownerPath = path.join(runtimePath, VAULT_WRITER_OWNER_RECORD_NAME);
    fs.writeFileSync(ownerPath, `${JSON.stringify({ schemaVersion: 1, token: "A".repeat(43) })}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    if (process.platform !== "win32") fs.chmodSync(ownerPath, 0o600);

    expect(() => lease.assertHeld()).toThrowError(expect.objectContaining({ code: "vault.writer_lease_lost" }));
    expect(() => lease.releaseSync()).toThrowError(expect.objectContaining({ code: "vault.writer_lease_lost" }));
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(ownerPath, "utf8"))).toMatchObject({ token: "A".repeat(43) });
  });

  it.each(["vault", "runtime"] as const)("detects replacement of the captured %s directory identity", (target) => {
    const { root, vaultPath } = makeVault();
    const lease = VaultWriterLease.acquireSync(vaultPath);
    const targetPath = target === "vault" ? vaultPath : path.join(vaultPath, ".pige", "runtime");
    const displacedPath = path.join(root, `displaced-${target}`);
    fs.renameSync(targetPath, displacedPath);
    if (target === "vault") {
      fs.mkdirSync(targetPath);
    } else {
      fs.mkdirSync(targetPath, { mode: 0o700 });
    }

    expect(() => lease.assertHeld()).toThrowError(expect.objectContaining({ code: "vault.writer_lease_lost" }));
    expect(() => lease.releaseSync()).toThrowError(expect.objectContaining({ code: "vault.writer_lease_lost" }));
  });

  it("uses lock-directory identity to fence a stale owner before owner-token replacement", () => {
    const { root, vaultPath } = makeVault();
    const lease = VaultWriterLease.acquireSync(vaultPath);
    const runtimePath = path.join(vaultPath, ".pige", "runtime");
    const lockPath = path.join(runtimePath, VAULT_WRITER_LOCK_DIRECTORY_NAME);
    const ownerPath = path.join(runtimePath, VAULT_WRITER_OWNER_RECORD_NAME);
    const originalOwner = fs.readFileSync(ownerPath, "utf8");
    const displacedLockPath = path.join(root, "displaced-lock");

    fs.renameSync(lockPath, displacedLockPath);
    fs.mkdirSync(lockPath);
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(originalOwner);
    expect(() => lease.assertHeld()).toThrowError(expect.objectContaining({ code: "vault.writer_lease_lost" }));
    expect(() => lease.releaseSync()).toThrowError(expect.objectContaining({ code: "vault.writer_lease_lost" }));
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(originalOwner);
  });

  it("does not remove a successor installed at the final release boundary", () => {
    const { root, vaultPath } = makeVault();
    const runtimePath = path.join(vaultPath, ".pige", "runtime");
    const lockPath = path.join(runtimePath, VAULT_WRITER_LOCK_DIRECTORY_NAME);
    const ownerPath = path.join(runtimePath, VAULT_WRITER_OWNER_RECORD_NAME);
    const displacedLockPath = path.join(root, "displaced-release-lock");
    const successorToken = "B".repeat(43);
    let injected = false;
    const lease = VaultWriterLease.acquireSync(vaultPath, {
      testOnlyHooks: {
        beforeLockDirectoryRemoval: () => {
          if (injected) return;
          injected = true;
          fs.renameSync(lockPath, displacedLockPath);
          fs.mkdirSync(lockPath, { mode: 0o700 });
          fs.writeFileSync(path.join(lockPath, `.pige-owner-${successorToken}`), "pige-lock-v1\n", {
            encoding: "utf8",
            mode: 0o600
          });
          fs.writeFileSync(ownerPath, `${JSON.stringify({ schemaVersion: 1, token: successorToken })}\n`, {
            encoding: "utf8",
            mode: 0o600
          });
        }
      }
    });

    expect(() => lease.releaseSync()).toThrowError(expect.objectContaining({
      code: "vault.writer_lease_lost"
    }));

    expect(injected).toBe(true);
    expect(fs.readdirSync(lockPath)).toEqual([`.pige-owner-${successorToken}`]);
    expect(JSON.parse(fs.readFileSync(ownerPath, "utf8"))).toMatchObject({ token: successorToken });
  });

  it("does not remove a lock whose heartbeat becomes fresh after stale observation", () => {
    const { vaultPath } = makeVault();
    const lease = VaultWriterLease.acquireSync(vaultPath);
    const lockPath = path.join(lease.runtimePath, VAULT_WRITER_LOCK_DIRECTORY_NAME);
    const ownerPath = path.join(lease.runtimePath, VAULT_WRITER_OWNER_RECORD_NAME);
    const originalOwner = fs.readFileSync(ownerPath, "utf8");
    const staleAt = new Date(Date.now() - TEST_TIMING.staleMs - 1_000);
    fs.utimesSync(lockPath, staleAt, staleAt);
    let heartbeatRefreshed = false;

    expect(() => VaultWriterLease.acquireSync(vaultPath, {
      timing: TEST_TIMING,
      testOnlyHooks: {
        beforeObservedStaleRemoval: () => {
          heartbeatRefreshed = true;
          const refreshedAt = new Date();
          fs.utimesSync(lockPath, refreshedAt, refreshedAt);
        }
      }
    })).toThrowError(expect.objectContaining({ code: "vault.writer_lease_invalid" }));

    expect(heartbeatRefreshed).toBe(true);
    expect(fs.lstatSync(lockPath).isDirectory()).toBe(true);
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(originalOwner);
    lease.assertHeld();
    lease.releaseSync();
  });

  it("does not remove a lock whose heartbeat becomes fresh at stale-cleanup commit", () => {
    const { vaultPath } = makeVault();
    const lease = VaultWriterLease.acquireSync(vaultPath);
    const lockPath = path.join(lease.runtimePath, VAULT_WRITER_LOCK_DIRECTORY_NAME);
    const ownerPath = path.join(lease.runtimePath, VAULT_WRITER_OWNER_RECORD_NAME);
    const originalOwner = fs.readFileSync(ownerPath, "utf8");
    const staleAt = new Date(Date.now() - TEST_TIMING.staleMs - 1_000);
    fs.utimesSync(lockPath, staleAt, staleAt);
    let heartbeatRefreshed = false;

    expect(() => VaultWriterLease.acquireSync(vaultPath, {
      timing: TEST_TIMING,
      testOnlyHooks: {
        beforeObservedStaleCommit: () => {
          heartbeatRefreshed = true;
          const refreshedAt = new Date();
          fs.utimesSync(lockPath, refreshedAt, refreshedAt);
        }
      }
    })).toThrowError(expect.objectContaining({ code: "vault.writer_lease_invalid" }));

    expect(heartbeatRefreshed).toBe(true);
    expect(fs.lstatSync(lockPath).isDirectory()).toBe(true);
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(originalOwner);
    lease.assertHeld();
    lease.releaseSync();
  });

  it("does not remove a same-name successor sentinel installed at stale-cleanup commit", () => {
    const { vaultPath } = makeVault();
    const lease = VaultWriterLease.acquireSync(vaultPath);
    const lockPath = path.join(lease.runtimePath, VAULT_WRITER_LOCK_DIRECTORY_NAME);
    const ownerPath = path.join(lease.runtimePath, VAULT_WRITER_OWNER_RECORD_NAME);
    const originalOwner = fs.readFileSync(ownerPath, "utf8");
    const sentinelName = fs.readdirSync(lockPath)[0];
    if (!sentinelName) throw new Error("Expected the active lease sentinel.");
    const sentinelPath = path.join(lockPath, sentinelName);
    const originalSentinel = fs.lstatSync(sentinelPath);
    const staleAt = new Date(Date.now() - TEST_TIMING.staleMs - 1_000);
    fs.utimesSync(lockPath, staleAt, staleAt);
    let successorInstalled = false;

    expect(() => VaultWriterLease.acquireSync(vaultPath, {
      timing: TEST_TIMING,
      testOnlyHooks: {
        beforeObservedStaleCommit: () => {
          successorInstalled = true;
          fs.unlinkSync(sentinelPath);
          fs.writeFileSync(sentinelPath, "pige-lock-v1\n", {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600
          });
          fs.utimesSync(lockPath, staleAt, staleAt);
        }
      }
    })).toThrowError(expect.objectContaining({ code: "vault.writer_lease_invalid" }));

    expect(successorInstalled).toBe(true);
    expect(fs.lstatSync(sentinelPath).ino).not.toBe(originalSentinel.ino);
    expect(fs.readFileSync(ownerPath, "utf8")).toBe(originalOwner);
    expect(() => lease.assertHeld()).toThrowError(expect.objectContaining({
      code: "vault.writer_lease_lost"
    }));
  });

  it("marks a proper-lockfile heartbeat compromise invalid and fails closed", async () => {
    const { vaultPath } = makeVault();
    const lease = VaultWriterLease.acquireSync(vaultPath, { timing: TEST_TIMING });
    const lockPath = path.join(lease.runtimePath, VAULT_WRITER_LOCK_DIRECTORY_NAME);
    fs.utimesSync(lockPath, new Date(0), new Date(0));

    await waitForLeaseLoss(lease);
    expect(() => lease.assertHeld()).toThrowError(expect.objectContaining({ code: "vault.writer_lease_lost" }));
    expect(() => lease.releaseSync()).toThrowError(expect.objectContaining({ code: "vault.writer_lease_lost" }));
  });

  it("allows exactly one real process and recovers the stale lock after SIGKILL", async () => {
    const { root, vaultPath } = makeVault();
    const child = spawnLeaseHolder(root, vaultPath);
    children.add(child);
    await waitForOutput(child, "LEASE_READY");

    expect(() => VaultWriterLease.acquireSync(vaultPath, { timing: TEST_TIMING })).toThrowError(
      expect.objectContaining({ code: "vault.writer_locked" })
    );

    child.kill("SIGKILL");
    await waitForExit(child);
    children.delete(child);

    const recovered = await acquireAfterStale(vaultPath);
    recovered.assertHeld();
    recovered.releaseSync();
  }, 15_000);

  it("runs the same fenced cleanup through proper-lockfile's normal process-exit hook", async () => {
    const { root, vaultPath } = makeVault();
    const child = spawnLeaseExiter(root, vaultPath);
    children.add(child);
    await waitForOutput(child, "LEASE_READY");
    await waitForExit(child);
    children.delete(child);

    const runtimePath = path.join(vaultPath, ".pige", "runtime");
    expect(fs.existsSync(path.join(runtimePath, VAULT_WRITER_LOCK_DIRECTORY_NAME))).toBe(false);
    expect(fs.existsSync(path.join(runtimePath, VAULT_WRITER_OWNER_RECORD_NAME))).toBe(false);
  }, 15_000);
});

function makeVault(): { root: string; vaultPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-vault-writer-lease-"));
  roots.push(root);
  const vaultPath = path.join(root, "Pige Vault");
  fs.mkdirSync(path.join(vaultPath, ".pige"), { recursive: true });
  return { root, vaultPath };
}

function spawnLeaseHolder(root: string, vaultPath: string): ChildProcessWithoutNullStreams {
  const loaderPath = path.join(root, "pige-test-loader.mjs");
  const childPath = path.join(root, "pige-lease-holder.mjs");
  const domainSource = path.resolve("packages/domain/src/index.ts");
  const leaseSource = path.resolve("apps/desktop/src/main/services/vault-writer-lease.ts");
  fs.writeFileSync(loaderPath, [
    "import { pathToFileURL } from 'node:url';",
    `const domainUrl = ${JSON.stringify(pathToFileURL(domainSource).href)};`,
    "export async function resolve(specifier, context, nextResolve) {",
    "  if (specifier === '@pige/domain') return { url: domainUrl, shortCircuit: true };",
    "  return nextResolve(specifier, context);",
    "}",
    ""
  ].join("\n"));
  fs.writeFileSync(childPath, [
    `import { VaultWriterLease } from ${JSON.stringify(pathToFileURL(leaseSource).href)};`,
    "const lease = VaultWriterLease.acquireSync(process.argv[2], {",
    "  timing: { staleMs: 2000, updateMs: 1000 }",
    "});",
    "lease.assertHeld();",
    "process.stdout.write('LEASE_READY\\n');",
    "setInterval(() => lease.assertHeld(), 100);",
    ""
  ].join("\n"));

  return spawn(process.execPath, [
    "--no-warnings",
    "--experimental-loader",
    loaderPath,
    childPath,
    vaultPath
  ], {
    cwd: path.resolve("."),
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function spawnLeaseExiter(root: string, vaultPath: string): ChildProcessWithoutNullStreams {
  const loaderPath = path.join(root, "pige-exit-test-loader.mjs");
  const childPath = path.join(root, "pige-lease-exiter.mjs");
  const domainSource = path.resolve("packages/domain/src/index.ts");
  const leaseSource = path.resolve("apps/desktop/src/main/services/vault-writer-lease.ts");
  fs.writeFileSync(loaderPath, [
    "import { pathToFileURL } from 'node:url';",
    `const domainUrl = ${JSON.stringify(pathToFileURL(domainSource).href)};`,
    "export async function resolve(specifier, context, nextResolve) {",
    "  if (specifier === '@pige/domain') return { url: domainUrl, shortCircuit: true };",
    "  return nextResolve(specifier, context);",
    "}",
    ""
  ].join("\n"));
  fs.writeFileSync(childPath, [
    `import { VaultWriterLease } from ${JSON.stringify(pathToFileURL(leaseSource).href)};`,
    "const lease = VaultWriterLease.acquireSync(process.argv[2], {",
    "  timing: { staleMs: 2000, updateMs: 1000 }",
    "});",
    "lease.assertHeld();",
    "process.stdout.write('LEASE_READY\\n', () => process.exit(0));",
    ""
  ].join("\n"));

  return spawn(process.execPath, [
    "--no-warnings",
    "--experimental-loader",
    loaderPath,
    childPath,
    vaultPath
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

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireAfterStale(vaultPath: string): Promise<VaultWriterLease> {
  const deadline = Date.now() + TEST_TIMING.staleMs + 3_000;
  while (Date.now() < deadline) {
    try {
      return VaultWriterLease.acquireSync(vaultPath, { timing: TEST_TIMING });
    } catch (caught) {
      if (!isErrorCode(caught, "vault.writer_locked")) throw caught;
      await delay(100);
    }
  }
  throw new Error("The stale writer lock did not become recoverable within the bounded test window.");
}

function isErrorCode(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && String(value.code) === code;
}

async function waitForLeaseLoss(lease: VaultWriterLease): Promise<void> {
  const deadline = Date.now() + TEST_TIMING.updateMs + 2_000;
  while (Date.now() < deadline) {
    try {
      lease.assertHeld();
    } catch (caught) {
      if (isErrorCode(caught, "vault.writer_lease_lost")) return;
      throw caught;
    }
    await delay(50);
  }
  throw new Error("The compromised writer lease did not fail closed within the bounded test window.");
}
