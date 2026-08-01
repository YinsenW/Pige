import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiPackageCatalogService } from "../../apps/desktop/src/main/services/pi-package-catalog-service";
import { PiPackageInspectionService } from "../../apps/desktop/src/main/services/pi-package-inspection-service";
import type { PiPackageManagerService, PiPackageRecord } from "../../apps/desktop/src/main/services/pi-package-manager-service";
import { hashPiPackageTree } from "../../apps/desktop/src/main/services/pi-package-lifecycle-store";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PiPackageInspectionService", () => {
  it("revalidates the installed tree and manifest and returns exact reviewed disclosure after restart", async () => {
    const fixture = makeFixture(true);
    const first = await fixture.service.inspect(fixture.request);
    expect(first).toMatchObject({
      status: "ready",
      registryRevision: 3,
      inspection: {
        packageId: fixture.record.packageId,
        integrityStatus: "verified",
        catalogDisclosure: { status: "reviewed", entry: { license: "MIT", trust: "curated" } }
      }
    });
    expect(JSON.stringify(first)).not.toMatch(/relativePath|treeHash|manifestHash|body|script|\.js/u);
    expect(fixture.assertInstalled).toHaveBeenCalledTimes(2);

    const restarted = makeService(fixture);
    await expect(restarted.inspect(fixture.request)).resolves.toMatchObject({ status: "ready" });
  });

  it("keeps unmatched exact versions honest and fails closed on tamper", async () => {
    const fixture = makeFixture(false);
    await expect(fixture.service.inspect(fixture.request)).resolves.toMatchObject({
      status: "ready",
      inspection: { catalogDisclosure: { status: "unknown" } }
    });

    fs.appendFileSync(path.join(fixture.installedPath, "index.js"), "tampered", "utf8");
    await expect(fixture.service.inspect(fixture.request)).resolves.toEqual({
      apiVersion: 1,
      requestId: fixture.request.requestId,
      packageId: fixture.request.packageId,
      status: "failed"
    });
  });

  it("returns authoritative stale and not-found inventory without touching package bytes", async () => {
    const stale = makeFixture(true);
    await expect(stale.service.inspect({ ...stale.request, expectedRegistryRevision: 2 })).resolves.toMatchObject({
      status: "stale", registry: { revision: 3 }
    });
    expect(stale.assertInstalled).not.toHaveBeenCalled();

    const missing = makeFixture(true);
    const empty = { apiVersion: 1 as const, revision: 3, packages: [] };
    missing.summary.mockResolvedValue(empty);
    await expect(missing.service.inspect(missing.request)).resolves.toMatchObject({
      status: "not_found", registry: empty
    });
    expect(missing.assertInstalled).not.toHaveBeenCalled();
  });
});

function makeFixture(reviewed: boolean) {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pi-inspection-"));
  temporaryRoots.push(appDataRoot);
  const manifest = {
    name: "@narumitw/pi-btw",
    version: "0.34.0",
    pi: { extensions: ["./index.js"] }
  };
  const packageId = "pkg_0123456789abcdef01234567";
  const relativePath = path.join("installed", packageId, manifest.version, "fixture");
  const installedPath = path.join(appDataRoot, "pi-packages", relativePath);
  fs.mkdirSync(installedPath, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(installedPath, "package.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  fs.writeFileSync(path.join(installedPath, "index.js"), "export default {};\n", "utf8");
  const integrity = "sha512-ycjtInVV9csP+mR3L6gXgPJOsMGQej80ltkqbJhK0Gy3Mc8BgYvPrdQ0HXTFSGeDzr+//V51CYVK9KcgWti+VA==";
  const record: PiPackageRecord = {
    packageId,
    packageName: manifest.name,
    version: manifest.version,
    packageTypes: ["extension"],
    dependencyCount: 0,
    treeHash: hashPiPackageTree(installedPath),
    archiveHash: `sha256:${"b".repeat(64)}`,
    integrity,
    manifestHash: digestStableJson({
      name: manifest.name, version: manifest.version, pi: manifest.pi, scripts: null,
      dependencies: null, optionalDependencies: null, peerDependencies: null,
      bundledDependencies: null, bundleDependencies: null
    }),
    relativePath,
    installedAt: "2026-08-02T00:00:00.000Z",
    enabled: false,
    trust: "community",
    requests: [{ requestId: "pi_package_request_abcdefghijklmnop", revision: 3 }]
  };
  const registry = { schemaVersion: 1 as const, revision: 3, packages: [record] };
  const projected = {
    apiVersion: 1 as const,
    revision: 3,
    packages: [{
      packageId, packageName: record.packageName, version: record.version, state: "installed_disabled" as const,
      packageTypes: ["extension"] as const, dependencyCount: 0, enabled: false, canEnable: false,
      trust: "community" as const, pinned: false, canUpdate: true, canRollback: false, rollbackTarget: null
    }]
  };
  const assertInstalled = vi.fn((candidate: PiPackageRecord) => {
    if (candidate.treeHash !== hashPiPackageTree(installedPath)) throw new Error("package.install_changed");
  });
  const manager = {
    readLifecycleRegistry: () => registry,
    lifecycleStore: { assertInstalled }
  } as unknown as PiPackageManagerService;
  const catalogPath = path.join(appDataRoot, "catalog.json");
  fs.writeFileSync(catalogPath, `${JSON.stringify({ schemaVersion: 1, entries: [catalogEntry({
    version: reviewed ? record.version : "0.35.0",
    integrity: reviewed ? record.integrity : `sha512-${"A".repeat(86)}==`
  })] })}\n`, "utf8");
  const summary = vi.fn(async () => projected);
  const fixture = { appDataRoot, manager, catalog: new PiPackageCatalogService(catalogPath), summary };
  return {
    ...fixture,
    service: makeService(fixture),
    request: {
      apiVersion: 1 as const,
      requestId: "pi_package_inspect_request_abcdefghijklmnop" as const,
      expectedRegistryRevision: 3,
      packageId
    },
    record,
    installedPath,
    assertInstalled
  };
}

function makeService(fixture: {
  readonly appDataRoot: string;
  readonly manager: PiPackageManagerService;
  readonly catalog: PiPackageCatalogService;
  readonly summary: () => Promise<any>;
}) {
  return new PiPackageInspectionService(fixture);
}

function catalogEntry(overrides: Record<string, unknown>) {
  return {
    catalogId: "pi_catalog_narumitw_pi_btw",
    packageName: "@narumitw/pi-btw",
    version: "0.34.0",
    integrity: "sha512-ycjtInVV9csP+mR3L6gXgPJOsMGQej80ltkqbJhK0Gy3Mc8BgYvPrdQ0HXTFSGeDzr+//V51CYVK9KcgWti+VA==",
    displayName: "Pi BTW",
    purpose: "Ask one isolated side question.",
    license: "MIT",
    packageTypes: ["extension"],
    capabilities: ["call_cloud_model_with_private_or_large_source"],
    dataBoundaries: ["cloud"],
    trust: "curated",
    source: "npm",
    ...overrides
  };
}

function digestStableJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
