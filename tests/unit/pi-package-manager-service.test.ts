import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPiPackageInstallCapabilityAdapter } from "../../apps/desktop/src/main/services/pi-package-capability-adapter";
import { PiPackageManagerService } from "../../apps/desktop/src/main/services/pi-package-manager-service";
import { PermissionBrokerService } from "../../apps/desktop/src/main/services/permission-broker-service";
import {
  PermissionedExternalCapabilityRegistry,
  type PermissionedExternalJobPort,
  type PermissionedExternalTurnContext
} from "../../apps/desktop/src/main/services/permissioned-external-capability-service";
import type { PigeAgentToolCallContext, PigeAgentToolDefinition } from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";

const PACKAGE_NAME = "pige-synthetic-package";
const PACKAGE_VERSION = "1.2.3";
const REQUEST_ID = "package_request_0001";
const VAULT_ID = "vault_20260719_package01";
const JOB_ID = "job_20260719_package01";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PiPackageManagerService", () => {
  it("rejects direct or forged execution authority before network or package state", async () => {
    const fixture = await createFixture();
    const service = new PiPackageManagerService({
      appDataRoot: fixture.machineRoot,
      fetchImpl: fixture.fetchImpl,
      lookup: async () => ["93.184.216.34"]
    });

    await expect(service.install(
      { requestId: REQUEST_ID, packageName: PACKAGE_NAME, version: PACKAGE_VERSION },
      new AbortController().signal
    )).rejects.toMatchObject({ code: "permission.execution_authority_invalid" });
    await expect(service.install(
      { requestId: REQUEST_ID, packageName: PACKAGE_NAME, version: PACKAGE_VERSION },
      new AbortController().signal,
      { bindingHash: digest("forged") }
    )).rejects.toMatchObject({ code: "permission.execution_authority_invalid" });
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it("rejects undisclosable package identity before creating a permission request", async () => {
    const fixture = await createFixture();
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    const context: PigeAgentToolCallContext = {
      toolCallId: "tool_call_package_bad_identity",
      signal: new AbortController().signal
    };

    await expect(tool.execute({
      request_id: REQUEST_ID,
      package_name: `safe\u202epackage`,
      version: PACKAGE_VERSION
    }, context.signal, context)).rejects.toMatchObject({ code: "package.name_invalid" });
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
  });

  it("recovers a well-formed orphaned install lock at service startup", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-package-lock-"));
    roots.push(root);
    const machineRoot = path.join(root, "machine");
    const packageRoot = path.join(machineRoot, "pi-packages");
    fs.mkdirSync(packageRoot, { recursive: true, mode: 0o700 });
    const lockPath = path.join(packageRoot, ".install.lock");
    fs.writeFileSync(lockPath, "2147483647:00000000-0000-4000-8000-000000000001\n", { mode: 0o600 });

    new PiPackageManagerService({
      appDataRoot: machineRoot,
      fetchImpl: vi.fn(),
      lookup: async () => ["93.184.216.34"],
      processAlive: () => false
    });

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("does not recover a lock owned by a live process", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-package-live-lock-"));
    roots.push(root);
    const machineRoot = path.join(root, "machine");
    const packageRoot = path.join(machineRoot, "pi-packages");
    fs.mkdirSync(packageRoot, { recursive: true, mode: 0o700 });
    const lockPath = path.join(packageRoot, ".install.lock");
    fs.writeFileSync(lockPath, `${process.pid}:00000000-0000-4000-8000-000000000001\n`, { mode: 0o600 });

    expect(() => new PiPackageManagerService({
      appDataRoot: machineRoot,
      fetchImpl: vi.fn(),
      lookup: async () => ["93.184.216.34"],
      processAlive: () => true
    })).toThrow(expect.objectContaining({ code: "package.install_busy" }));
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("installs one exact script-free Pi package under the submitted first-party task authority", async () => {
    const fixture = await createFixture();
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));

    const result = await callTool(tool);
    expect(result.details).toMatchObject({
      status: "installed_disabled",
      packageName: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      packageTypes: ["extension"],
      dependencyCount: 0,
      requiresEnable: true
    });
    const registryBody = fs.readFileSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"), "utf8");
    expect(registryBody).toContain(PACKAGE_NAME);
    expect(registryBody).not.toContain("https://registry.npmjs.org");
    expect(registryBody).not.toContain("SYNTHETIC_PACKAGE_CODE");

    const installedVersionRoot = path.join(
      fixture.machineRoot,
      "pi-packages",
      "installed",
      String(result.details?.packageId),
      PACKAGE_VERSION
    );
    const installedRoot = path.join(installedVersionRoot, fs.readdirSync(installedVersionRoot)[0]!);
    const recoveryMarker = path.join(installedRoot, ".pige-package-owner.json");
    fs.writeFileSync(recoveryMarker, `${JSON.stringify({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      packageId: result.details?.packageId,
      packageName: PACKAGE_NAME,
      version: PACKAGE_VERSION
    })}\n`, { mode: 0o600 });
    new PiPackageManagerService({
      appDataRoot: fixture.machineRoot,
      fetchImpl: fixture.fetchImpl,
      lookup: async () => ["93.184.216.34"]
    });
    expect(fs.existsSync(recoveryMarker)).toBe(false);

    const registry = JSON.parse(registryBody);
    fs.writeFileSync(
      path.join(fixture.machineRoot, "pi-packages", "registry.json"),
      `${JSON.stringify({ ...registry, revision: registry.revision + 1 }, null, 2)}\n`,
      "utf8"
    );

    const fetchesAfterInstall = fixture.fetchImpl.mock.calls.length;
    const adopted = await callTool(tool);
    expect(adopted.details).toMatchObject({ status: "installed_disabled", revision: 1 });
    expect(fixture.fetchImpl).toHaveBeenCalledTimes(fetchesAfterInstall);
    expect(() => fixture.packages.adopt({
      requestId: REQUEST_ID,
      packageName: "different-package",
      version: PACKAGE_VERSION
    })).toThrow(expect.objectContaining({ code: "package.request_conflict" }));
  });

  it("encodes the complete scoped package name in the fixed registry request", async () => {
    const packageName = "@pige/synthetic-package";
    const fixture = await createFixture({ packageName });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    const args = { request_id: REQUEST_ID, package_name: packageName, version: PACKAGE_VERSION };
    const context: PigeAgentToolCallContext = {
      toolCallId: "tool_call_scoped_package_install",
      signal: new AbortController().signal
    };

    await expect(tool.execute(args, context.signal, context)).resolves.toMatchObject({
      details: { packageName, status: "installed_disabled" }
    });
    expect(fixture.fetchImpl.mock.calls[0]?.[0].toString()).toBe(
      `https://registry.npmjs.org/@pige%2Fsynthetic-package/${PACKAGE_VERSION}`
    );
  });

  it("rejects adoption when an installed regular file becomes an equal-content external symlink", async () => {
    const fixture = await createFixture();
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);
    const result = await callTool(tool);
    const installedVersionRoot = path.join(
      fixture.machineRoot,
      "pi-packages",
      "installed",
      String(result.details?.packageId),
      PACKAGE_VERSION
    );
    const installedRoot = path.join(installedVersionRoot, fs.readdirSync(installedVersionRoot)[0]!);
    const readmePath = path.join(installedRoot, "README.md");
    const externalPath = path.join(fixture.root, "external-readme.md");
    fs.writeFileSync(externalPath, fs.readFileSync(readmePath));
    fs.rmSync(readmePath);
    fs.symlinkSync(externalPath, readmePath);

    expect(() => fixture.packages.adopt({
      requestId: REQUEST_ID,
      packageName: PACKAGE_NAME,
      version: PACKAGE_VERSION
    })).toThrow(expect.objectContaining({ code: "package.install_changed" }));
  });

  it("rejects lifecycle hooks before archive download and never executes package code", async () => {
    const sentinel = path.join(os.tmpdir(), `pige-package-hook-${Date.now()}`);
    const fixture = await createFixture({
      manifestOverrides: { scripts: { install: `node -e \"require('fs').writeFileSync('${sentinel}','bad')\"` } }
    });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.install_hooks_blocked" });
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(fixture.fetchImpl).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it("rejects executable package metadata before archive download", async () => {
    const fixture = await createFixture({ manifestOverrides: { bin: { unsafe: "dist/index.js" } } });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.executable_metadata_blocked" });
    expect(fixture.fetchImpl).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it("rejects native module content before publication", async () => {
    const fixture = await createFixture({ includeNativeModule: true });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.executable_content_blocked" });
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it("rejects executable binary content before publication", async () => {
    const fixture = await createFixture({ includeExecutableBinary: true });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.executable_content_blocked" });
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it.each([
    ["64-bit big-endian fat Mach-O", Buffer.from([0xca, 0xfe, 0xba, 0xbf, 0, 0, 0, 0])],
    ["64-bit little-endian fat Mach-O", Buffer.from([0xbf, 0xba, 0xfe, 0xca, 0, 0, 0, 0])]
  ])("rejects %s content before publication", async (_label, executableMagic) => {
    const fixture = await createFixture({ executableMagic });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.executable_content_blocked" });
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it("rejects tarball integrity drift and removes exact owned staging", async () => {
    const fixture = await createFixture({ integrityOverride: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==" });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.integrity_mismatch" });
    const stagingRoot = path.join(fixture.machineRoot, "pi-packages", "staging");
    expect(fs.readdirSync(stagingRoot)).toEqual([]);
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it("cancels a streaming archive download and removes exact owned staging", async () => {
    const fixture = await createFixture({ streamArchiveUntilAbort: true });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);
    const controller = new AbortController();
    const install = callTool(tool, controller);
    await vi.waitFor(() => expect(fixture.fetchImpl).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(install).rejects.toMatchObject({ name: "AbortError" });
    expect(fs.readdirSync(path.join(fixture.machineRoot, "pi-packages", "staging"))).toEqual([]);
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it("rejects symbolic links and does not publish an archive entry outside the package root", async () => {
    const fixture = await createFixture({ includeSymlink: true });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.archive_unsafe_entry" });
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it("rejects runtime dependencies until an exact locked dependency graph owner exists", async () => {
    const fixture = await createFixture({ manifestOverrides: { dependencies: { zod: "4.4.3" } } });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.dependencies_unsupported" });
    expect(fixture.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["optionalDependencies", { optionalDependencies: { zod: "4.4.3" } }],
    ["peerDependencies", { peerDependencies: { react: "19.2.4" } }],
    ["bundledDependencies", { bundledDependencies: ["zod"] }],
    ["bundleDependencies", { bundleDependencies: ["zod"] }]
  ])("rejects %s until an exact locked dependency graph owner exists", async (_field, manifestOverrides) => {
    const fixture = await createFixture({ manifestOverrides });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.dependencies_unsupported" });
    expect(fixture.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects archives that exceed the bounded total entry count", async () => {
    const fixture = await createFixture({ includeExtraDirectory: true, testOnlyMaxExtractedEntries: 4 });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.archive_too_large" });
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it("detects collisions after the npm archive root is stripped", async () => {
    const fixture = await createFixture({ includeStripCollision: true });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.archive_collision" });
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });

  it("rejects a fixed registry origin that resolves through IPv4-mapped private IPv6", async () => {
    const fixture = await createFixture({ lookupAddresses: ["::ffff:127.0.0.1"] });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.registry_unreachable" });
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects cross-platform reserved archive paths before publication", async () => {
    const fixture = await createFixture({ includeReservedPath: true });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await approveTool(fixture, tool);

    await expect(callTool(tool)).rejects.toMatchObject({ code: "package.archive_path_invalid" });
    expect(fs.existsSync(path.join(fixture.machineRoot, "pi-packages", "registry.json"))).toBe(false);
  });
});

interface Fixture {
  readonly root: string;
  readonly machineRoot: string;
  readonly vaultPath: string;
  readonly broker: PermissionBrokerService;
  readonly packages: PiPackageManagerService;
  readonly jobs: MemoryJobPort;
  readonly registry: PermissionedExternalCapabilityRegistry;
  readonly turn: PermissionedExternalTurnContext;
  readonly fetchImpl: ReturnType<typeof vi.fn>;
}

async function createFixture(options: {
  readonly packageName?: string;
  readonly manifestOverrides?: Record<string, unknown>;
  readonly integrityOverride?: string;
  readonly includeSymlink?: boolean;
  readonly includeReservedPath?: boolean;
  readonly streamArchiveUntilAbort?: boolean;
  readonly includeNativeModule?: boolean;
  readonly includeExecutableBinary?: boolean;
  readonly executableMagic?: Buffer;
  readonly includeExtraDirectory?: boolean;
  readonly includeStripCollision?: boolean;
  readonly lookupAddresses?: readonly string[];
  readonly testOnlyMaxExtractedEntries?: number;
} = {}): Promise<Fixture> {
  const packageName = options.packageName ?? PACKAGE_NAME;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-package-manager-"));
  roots.push(root);
  const machineRoot = path.join(root, "machine");
  fs.mkdirSync(machineRoot, { mode: 0o700 });
  const packageFixtureRoot = path.join(root, "package-fixture");
  const packageRoot = path.join(packageFixtureRoot, "package");
  fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
  const manifest = {
    name: packageName,
    version: PACKAGE_VERSION,
    pi: { extensions: ["dist/index.js"] },
    ...options.manifestOverrides
  };
  fs.writeFileSync(path.join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(packageRoot, "dist", "index.js"), "export const marker = 'SYNTHETIC_PACKAGE_CODE';\n", "utf8");
  fs.writeFileSync(path.join(packageRoot, "README.md"), "Synthetic package documentation.\n", "utf8");
  if (options.includeSymlink) fs.symlinkSync("../../outside", path.join(packageRoot, "unsafe-link"));
  if (options.includeReservedPath) {
    fs.writeFileSync(path.join(packageRoot, "CON"), "reserved\n", "utf8");
  }
  if (options.includeNativeModule) {
    fs.writeFileSync(path.join(packageRoot, "dist", "unsafe.node"), "native\n", "utf8");
  }
  if (options.includeExecutableBinary) {
    fs.writeFileSync(path.join(packageRoot, "dist", "unsafe.bin"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]));
  }
  if (options.executableMagic) {
    fs.writeFileSync(path.join(packageRoot, "dist", "unsafe-fat.bin"), options.executableMagic);
  }
  if (options.includeExtraDirectory) fs.mkdirSync(path.join(packageRoot, "extra"));
  const archiveEntries = ["package"];
  if (options.includeStripCollision) {
    const otherRoot = path.join(packageFixtureRoot, "other", "dist");
    fs.mkdirSync(otherRoot, { recursive: true });
    fs.writeFileSync(path.join(otherRoot, "index.js"), "collision\n", "utf8");
    archiveEntries.push("other");
  }
  const archivePath = path.join(root, "package.tgz");
  await tar.c({ cwd: packageFixtureRoot, file: archivePath, gzip: true }, archiveEntries);
  const archive = fs.readFileSync(archivePath);
  const integrity = options.integrityOverride ?? `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  const archiveName = packageName.split("/").at(-1)!;
  const tarballUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/-/${archiveName}-${PACKAGE_VERSION}.tgz`;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    const encodedName = packageName.startsWith("@")
      ? encodeURIComponent(packageName).replace(/^%40/u, "@")
      : packageName;
    if (url === `https://registry.npmjs.org/${encodedName}/${PACKAGE_VERSION}`) {
      return new Response(JSON.stringify({ ...manifest, dist: { tarball: tarballUrl, integrity } }), {
        headers: { "content-type": "application/json" }
      });
    }
    if (url === tarballUrl && options.streamArchiveUntilAbort) {
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(archive.subarray(0, Math.min(32, archive.length)));
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("Package download was cancelled.", "AbortError"));
          }, { once: true });
        }
      }));
    }
    if (url === tarballUrl) return new Response(archive, { headers: { "content-length": String(archive.length) } });
    throw new Error(`Unexpected URL: ${url}`);
  });
  const packages = new PiPackageManagerService({
    appDataRoot: machineRoot,
    fetchImpl,
    lookup: async () => options.lookupAddresses ?? ["93.184.216.34"],
    ...(options.testOnlyMaxExtractedEntries === undefined
      ? {}
      : { testOnlyMaxExtractedEntries: options.testOnlyMaxExtractedEntries })
  });
  const vaultPath = createTestVault(root);
  const broker = new PermissionBrokerService({ rootPath: fs.realpathSync.native(machineRoot), unsafeAllowUnfenced: true });
  const jobs = new MemoryJobPort();
  const registry = new PermissionedExternalCapabilityRegistry(
    [createPiPackageInstallCapabilityAdapter(packages)], broker, jobs
  );
  return {
    root,
    machineRoot,
    vaultPath,
    broker,
    packages,
    jobs,
    registry,
    fetchImpl,
    turn: {
      vaultPath,
      vaultId: VAULT_ID,
      jobId: JOB_ID,
      policyContextId: "policy_context_package_test",
      policyHash: digest("package policy"),
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full",
      assertCurrent: vi.fn()
    }
  };
}

async function approveTool(fixture: Fixture, tool: PigeAgentToolDefinition): Promise<void> {
  void fixture;
  void tool;
}

function callTool(tool: PigeAgentToolDefinition, controller = new AbortController()) {
  const context: PigeAgentToolCallContext = { toolCallId: "tool_call_package_install", signal: controller.signal };
  return tool.execute({ request_id: REQUEST_ID, package_name: PACKAGE_NAME, version: PACKAGE_VERSION }, controller.signal, context);
}

function requireTool(tools: readonly PigeAgentToolDefinition[]): PigeAgentToolDefinition {
  const tool = tools.find((candidate) => candidate.name === "pige_install_pi_package");
  if (!tool) throw new Error("Expected Pi package install tool.");
  return tool;
}

class MemoryJobPort implements PermissionedExternalJobPort {
  readonly bindings: any[] = [];
  readonly consumptions: any[] = [];
  readonly completions: any[] = [];
  readonly #markers = new Map<string, string>();
  bindPermissionRequest(input: any): void { this.bindings.push(input); }
  commitPermissionConsumption(input: any): void { this.consumptions.push(input); }
  completePermissionAction(input: any): void {
    this.completions.push(input);
    this.#markers.set(completionKey(input), input.completionMarkerHash);
  }
  readPermissionCompletion(input: any): string | undefined { return this.#markers.get(completionKey(input)); }
}

function completionKey(input: { readonly jobId: string; readonly requestId: string; readonly bindingHash: string }): string {
  return `${input.jobId}\0${input.requestId}\0${input.bindingHash}`;
}

function createTestVault(root: string): string {
  const vaultName = "Package Test Vault";
  createVaultOnDisk({ parentDirectory: path.join(root, "vaults"), vaultName, appDataPath: path.join(root, "app-data"), tempPath: path.join(root, "temp") });
  const vaultPath = path.join(root, "vaults", vaultName);
  const manifestPath = path.join(vaultPath, ".pige", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, vault_id: VAULT_ID }, null, 2)}\n`, "utf8");
  return vaultPath;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
