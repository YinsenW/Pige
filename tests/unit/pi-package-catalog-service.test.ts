import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiPackageCatalogService } from "../../apps/desktop/src/main/services/pi-package-catalog-service";

const REQUEST_ID = "pi_package_catalog_request_abcdefghijklmnop";
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PiPackageCatalogService", () => {
  it("projects the reviewed repository catalog entry without paths or executable content", () => {
    const manifestPath = path.join(
      process.cwd(),
      "resources/curated-packages/pi-package-catalog.manifest.json"
    );
    const result = new PiPackageCatalogService(manifestPath).query(request("side question"));
    expect(result).toEqual({
      apiVersion: 1,
      requestId: REQUEST_ID,
      status: "ready",
      entries: [entry()],
      total: 1
    });
    expect(JSON.stringify(result)).not.toMatch(/(?:path|url|script|body)/iu);
  });

  it("loads the strict local manifest, sorts by ASCII catalog ID, and searches normalized safe fields", () => {
    const fixture = makeFixture([
      entry({
        catalogId: "pi_catalog_zeta",
        packageName: "@example/zeta-helper",
        displayName: "Zeta helper",
        purpose: "Second helper"
      }),
      entry({ catalogId: "pi_catalog_alpha", displayName: "Pi BTW", purpose: "Ask a side question" })
    ]);
    const service = new PiPackageCatalogService(fixture.manifestPath);

    expect(service.query(request(""))).toMatchObject({
      status: "ready",
      total: 2,
      entries: [{ catalogId: "pi_catalog_alpha" }, { catalogId: "pi_catalog_zeta" }]
    });
    expect(service.query(request("ＳＩＤＥ question"))).toMatchObject({
      status: "ready",
      total: 1,
      entries: [{ catalogId: "pi_catalog_alpha" }]
    });
    expect(service.query(request("@example/zeta-helper"))).toMatchObject({
      status: "ready",
      total: 1,
      entries: [{ catalogId: "pi_catalog_zeta" }]
    });
    expect(service.query(request("cloud model"))).toMatchObject({ status: "ready", total: 2 });
    expect(service.query(request("not present"))).toMatchObject({ status: "ready", total: 0, entries: [] });
  });

  it("fails body-free for malformed, duplicate, oversized, or symlinked manifests", () => {
    const malformed = makeFixture([entry()], { extra: true });
    expect(new PiPackageCatalogService(malformed.manifestPath).query(request(""))).toEqual(failed());

    const duplicate = makeFixture([entry(), entry()]);
    expect(new PiPackageCatalogService(duplicate.manifestPath).query(request(""))).toEqual(failed());

    const oversized = makeFixture([entry()]);
    fs.writeFileSync(oversized.manifestPath, " ".repeat(128 * 1024 + 1), "utf8");
    expect(new PiPackageCatalogService(oversized.manifestPath).query(request(""))).toEqual(failed());

    if (process.platform !== "win32") {
      const symlinked = makeFixture([entry()]);
      const targetPath = path.join(symlinked.root, "target.json");
      fs.renameSync(symlinked.manifestPath, targetPath);
      fs.symlinkSync(targetPath, symlinked.manifestPath);
      expect(new PiPackageCatalogService(symlinked.manifestPath).query(request(""))).toEqual(failed());

      const hardlinked = makeFixture([entry()]);
      fs.linkSync(hardlinked.manifestPath, path.join(hardlinked.root, "catalog-copy.json"));
      expect(new PiPackageCatalogService(hardlinked.manifestPath).query(request(""))).toEqual(failed());
    }
  });

  it("rejects relative manifest paths before any read", () => {
    expect(() => new PiPackageCatalogService("resources/catalog.json")).toThrow(/absolute/u);
  });
});

function makeFixture(entries: readonly unknown[], extra: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pi-catalog-"));
  temporaryRoots.push(root);
  const manifestPath = path.join(root, "pi-package-catalog.manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify({ schemaVersion: 1, entries, ...extra })}\n`, "utf8");
  return { root, manifestPath };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    catalogId: "pi_catalog_narumitw_pi_btw",
    packageName: "@narumitw/pi-btw",
    version: "0.34.0",
    integrity: "sha512-ycjtInVV9csP+mR3L6gXgPJOsMGQej80ltkqbJhK0Gy3Mc8BgYvPrdQ0HXTFSGeDzr+//V51CYVK9KcgWti+VA==",
    displayName: "Pi BTW",
    purpose: "Ask a side question without disturbing the main conversation.",
    license: "MIT",
    packageTypes: ["extension"],
    capabilities: ["external_filesystem", "call_cloud_model_with_private_or_large_source"],
    dataBoundaries: ["filesystem", "cloud"],
    trust: "curated",
    source: "npm",
    ...overrides
  };
}

function request(query: string) {
  return { apiVersion: 1, requestId: REQUEST_ID, query } as const;
}

function failed() {
  return { apiVersion: 1, requestId: REQUEST_ID, status: "failed" };
}
