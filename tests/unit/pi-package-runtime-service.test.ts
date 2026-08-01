import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PiPackageManagerService,
  type PiPackageRecord
} from "../../apps/desktop/src/main/services/pi-package-manager-service";
import {
  hashPiPackageTree,
  REVIEWED_PI_BTW_RUNTIME
} from "../../apps/desktop/src/main/services/pi-package-lifecycle-store";
import {
  PiPackageRuntimeService,
  createReviewedPiBtwCapabilityAdapter
} from "../../apps/desktop/src/main/services/pi-package-runtime-service";
import { PermissionedExternalCapabilityRegistry } from "../../apps/desktop/src/main/services/permissioned-external-capability-service";

const roots: string[] = [];
const PACKAGE_ID = `pkg_${createHash("sha256").update(REVIEWED_PI_BTW_RUNTIME.packageName).digest("hex").slice(0, 24)}`;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PiPackageRuntimeService", () => {
  it("enables only the exact reviewed package and survives restart without loading package code", async () => {
    const fixture = createFixture();
    const service = createService(fixture.manager);
    const enabled = await service.setEnabled(request(true));
    expect(enabled).toMatchObject({ status: "committed", registry: { revision: 2, packages: [{
      packageId: PACKAGE_ID, state: "installed_enabled", enabled: true, canEnable: true,
      canUpdate: false, canRollback: false
    }] } });
    expect(service.isEnabled()).toBe(true);
    expect(globalThis).not.toHaveProperty("__pigePackageImported");

    const restarted = createService(new PiPackageManagerService({ appDataRoot: fixture.root }));
    expect(restarted.isEnabled()).toBe(true);
    expect(createReviewedPiBtwCapabilityAdapter(restarted).isAvailable?.(turn())).toBe(true);

    const replay = await restarted.setEnabled(request(true));
    expect(replay).toMatchObject({ status: "committed", registry: { revision: 2 } });
    await expect(restarted.setEnabled({ ...request(false), requestId: request(true).requestId }))
      .resolves.toMatchObject({ status: "failed" });
  });

  it("fails closed on stale, unsupported, and tampered installed package state", async () => {
    const stale = createFixture();
    await expect(createService(stale.manager).setEnabled({ ...request(true), expectedRegistryRevision: 0 }))
      .resolves.toMatchObject({ status: "stale", registry: { revision: 1 } });

    const unsupported = createFixture({ version: "0.33.0" });
    await expect(createService(unsupported.manager).setEnabled(request(true)))
      .resolves.toMatchObject({ status: "ineligible", registry: { packages: [{ canEnable: false }] } });

    const tampered = createFixture();
    fs.appendFileSync(path.join(tampered.installedPath, "index.js"), "tampered\n");
    await expect(createService(tampered.manager).setEnabled(request(true))).resolves.toMatchObject({ status: "failed" });
    expect(tampered.manager.summary()).toMatchObject({ revision: 1, packages: [{ enabled: false }] });
  });

  it("runs one enabled side question through the broker and an isolated model turn", async () => {
    const fixture = createFixture();
    const run = vi.fn(async () => ({ assistantText: "A concise side answer." }));
    const service = new PiPackageRuntimeService({
      manager: fixture.manager,
      providers: { getDefaultRuntimeConfig: () => ({ provider: {} as never, model: {} as never }) },
      runtime: { run: run as never }
    });
    await service.setEnabled(request(true));
    const broker = { authorizeTurnAction: vi.fn(() => ({ status: "authorized" })) };
    const registry = new PermissionedExternalCapabilityRegistry(
      [createReviewedPiBtwCapabilityAdapter(service)], broker as never
    );
    const tool = registry.toolsForTurn(turn())[0]!;
    const signal = new AbortController().signal;
    const result = await tool.execute({ question: "What is the side implication?" }, signal, {
      toolCallId: "tool_call_runtime_abcdefghijklmnop", signal
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      userPrompt: "What is the side implication?", tools: [],
      systemPrompt: expect.stringContaining("Do not call tools")
    }));
    expect(result.content[0]).toMatchObject({ type: "text", text: "A concise side answer." });
    await service.setEnabled({ ...request(false), expectedRegistryRevision: 2,
      requestId: "pi_package_enable_request_disableabcdefghi" });
    expect(registry.toolsForTurn(turn())).toEqual([]);
  });
});

function createFixture(overrides: { readonly version?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-package-runtime-"));
  roots.push(root);
  const packageRoot = path.join(root, "pi-packages");
  const source = path.join(root, "source");
  fs.mkdirSync(source, { recursive: true, mode: 0o700 });
  const version = overrides.version ?? REVIEWED_PI_BTW_RUNTIME.version;
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({
    name: REVIEWED_PI_BTW_RUNTIME.packageName, version, pi: { extensions: ["index.js"] }
  }));
  fs.writeFileSync(path.join(source, "index.js"), "globalThis.__pigePackageImported = true;\n");
  const treeHash = hashPiPackageTree(source);
  const relativePath = path.join("installed", PACKAGE_ID, version, treeHash.slice(7));
  const installedPath = path.join(packageRoot, relativePath);
  fs.mkdirSync(path.dirname(installedPath), { recursive: true, mode: 0o700 });
  fs.renameSync(source, installedPath);
  const record: PiPackageRecord = {
    packageId: PACKAGE_ID, packageName: REVIEWED_PI_BTW_RUNTIME.packageName, version,
    packageTypes: ["extension"], dependencyCount: 0, treeHash,
    archiveHash: digest("archive"), integrity: REVIEWED_PI_BTW_RUNTIME.integrity,
    manifestHash: digest("manifest"), relativePath, installedAt: "2026-08-01T00:00:00.000Z",
    enabled: false, trust: "community", requests: [{ requestId: "package_request_0001", revision: 1 }]
  };
  fs.mkdirSync(packageRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(packageRoot, "registry.json"), `${JSON.stringify({ schemaVersion: 1, revision: 1, packages: [record] })}\n`);
  return { root, installedPath, manager: new PiPackageManagerService({ appDataRoot: root }) };
}

function createService(manager: PiPackageManagerService): PiPackageRuntimeService {
  return new PiPackageRuntimeService({ manager, providers: { getDefaultRuntimeConfig: vi.fn(() => undefined) } });
}
function request(enabled: boolean) {
  return { apiVersion: 1 as const, requestId: "pi_package_enable_request_abcdefghijklmnop",
    packageId: PACKAGE_ID, expectedRegistryRevision: 1, enabled };
}
function turn() {
  return { vaultPath: "/vault", vaultId: "vault_20260801_runtime", jobId: "job_20260801_runtime0001",
    policyContextId: "policy_context_runtime", policyHash: digest("policy"), runtimeKind: "desktop_local" as const,
    clientCapabilityTier: "desktop_full" as const, assertCurrent: () => undefined };
}
function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
