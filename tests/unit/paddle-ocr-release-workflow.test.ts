import { createHash, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packagePaddleOcrReleaseBundle } from
  "../../apps/desktop/scripts/package-paddleocr-release-bundle.mjs";
import {
  preparePaddleOcrReleaseInputs,
  verifyPaddleOcrReleasePublication
} from "../../apps/desktop/scripts/paddleocr-release-inputs.mjs";

const roots: string[] = [];
const TAG = "paddleocr-local-v3.7.0-test.1";
const LIMITS = {
  maxManifestBytes: 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxFiles: 128
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PaddleOCR release workflow sidecar", () => {
  it("streams only exact reviewed URLs and emits a builder-compatible lock", async () => {
    const fixture = createInputFixture();
    const redirectUrl = "https://release-assets.example.invalid/runtime.bin";
    const fetchImpl = async (url: string) => {
      if (url === fixture.runtimeUrl) {
        return new Response(null, { status: 302, headers: { location: redirectUrl } });
      }
      const originalUrl = url === redirectUrl ? fixture.runtimeUrl : url;
      const body = fixture.downloads.get(originalUrl);
      if (!body) return new Response(null, { status: 404 });
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.length) }
      });
    };

    const record = await preparePaddleOcrReleaseInputs({
      platform: "macos-arm64",
      releaseTag: TAG,
      parserManifestPath: fixture.manifestPath,
      wheelLockPath: fixture.lockPath,
      legalRoot: fixture.legalRoot,
      artifactRoot: path.join(fixture.root, "downloaded"),
      builderLockPath: path.join(fixture.root, "builder.lock.json"),
      recordPath: path.join(fixture.root, "inputs.json"),
      fetchImpl
    });

    expect(record.inputs).toHaveLength(4);
    expect(record.inputs.find((input) => input.url === fixture.runtimeUrl)).toMatchObject({
      finalOrigin: new URL(redirectUrl).origin,
      redirectCount: 1
    });
    expect(fs.readdirSync(path.join(fixture.root, "downloaded")).sort()).toEqual(
      [...fixture.downloads.keys()].map((url) => decodeURIComponent(new URL(url).pathname.split("/").at(-1)!)).sort()
    );
    const builderLock = readJson(path.join(fixture.root, "builder.lock.json")) as {
      wheels: Array<Record<string, unknown>>;
    };
    expect(builderLock.wheels.every((wheel) => !("url" in wheel))).toBe(true);
    expect((readJson(fixture.lockPath) as { wheels: Array<Record<string, unknown>> }).wheels.every(
      (wheel) => typeof wheel.url === "string"
    )).toBe(true);
  });

  it("fails before network or output when the reviewed bundle awaits publication or redirects drift", async () => {
    const fixture = createInputFixture();
    const manifest = readJson(fixture.manifestPath) as { releaseBundles: Array<Record<string, unknown>> };
    manifest.releaseBundles[0] = {
      platform: "macos-arm64",
      state: "awaiting_release_artifact",
      artifactUrl: null,
      sizeBytes: null,
      sha256: null,
      signature: null,
      sbomSha256: null
    };
    writeJson(fixture.manifestPath, manifest);
    let fetchCount = 0;
    await expect(preparePaddleOcrReleaseInputs({
      platform: "macos-arm64",
      releaseTag: TAG,
      parserManifestPath: fixture.manifestPath,
      wheelLockPath: fixture.lockPath,
      legalRoot: fixture.legalRoot,
      artifactRoot: path.join(fixture.root, "awaiting-output"),
      builderLockPath: path.join(fixture.root, "awaiting.lock.json"),
      recordPath: path.join(fixture.root, "awaiting.json"),
      fetchImpl: async () => { fetchCount += 1; return new Response(); }
    })).rejects.toThrow(/still awaiting/u);
    expect(fetchCount).toBe(0);

    const drift = createInputFixture();
    await expect(preparePaddleOcrReleaseInputs({
      platform: "macos-arm64",
      releaseTag: TAG,
      parserManifestPath: drift.manifestPath,
      wheelLockPath: drift.lockPath,
      legalRoot: drift.legalRoot,
      artifactRoot: path.join(drift.root, "drift-output"),
      builderLockPath: path.join(drift.root, "drift.lock.json"),
      recordPath: path.join(drift.root, "drift.json"),
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: "https://unreviewed.invalid/payload" }
      })
    })).rejects.toThrow(/unreviewed origin/u);
    expect(fs.existsSync(path.join(drift.root, "drift-output"))).toBe(false);
  });

  it("reverifies archive bytes, Ed25519 identity, and the complete extracted tree", async () => {
    const fixture = createInputFixture();
    const packageRoot = createLocalToolPackage(fixture.root);
    const archivePath = path.join(fixture.root, "pige-paddleocr-macos-arm64.zip");
    const releaseRecordPath = path.join(fixture.root, "release.json");
    const { privateKey } = generateKeyPairSync("ed25519");
    const result = await packagePaddleOcrReleaseBundle({
      packageRoot,
      outputPath: archivePath,
      artifactUrl: `https://github.com/YinsenW/Pige/releases/download/${TAG}/${path.basename(archivePath)}`,
      platform: "macos-arm64",
      engineVersion: "3.7.0",
      keyId: "pige-paddleocr-test",
      privateKey,
      packageLimits: LIMITS
    });
    writeJson(releaseRecordPath, result);
    const manifest = readJson(fixture.manifestPath) as {
      releaseBundles: Array<Record<string, unknown>>;
      releaseSigningKeys?: Array<Record<string, unknown>>;
    };
    manifest.releaseBundles[0] = result.bundle;
    manifest.releaseSigningKeys = [{
      algorithm: "Ed25519",
      keyId: "pige-paddleocr-test",
      publicKeySpkiBase64: result.publicKeySpkiBase64
    }];
    writeJson(fixture.manifestPath, manifest);

    const verification = await verifyPaddleOcrReleasePublication({
      platform: "macos-arm64",
      releaseTag: TAG,
      parserManifestPath: fixture.manifestPath,
      archivePath,
      releaseRecordPath,
      verificationRecordPath: path.join(fixture.root, "verification.json")
    });
    expect(verification).toMatchObject({
      platform: "macos-arm64",
      signatureKeyId: "pige-paddleocr-test",
      signatureVerified: true,
      fileCount: 2
    });

    fs.appendFileSync(archivePath, "tamper");
    await expect(verifyPaddleOcrReleasePublication({
      platform: "macos-arm64",
      releaseTag: TAG,
      parserManifestPath: fixture.manifestPath,
      archivePath,
      releaseRecordPath,
      verificationRecordPath: path.join(fixture.root, "tampered-verification.json")
    })).rejects.toThrow(/size differs/u);
  });

  it("pins every Action and keeps PaddleOCR tags disjoint from app v tags", () => {
    const root = process.cwd();
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/paddleocr-bundle-release.yml"), "utf8");
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThanOrEqual(5);
    expect(uses.every((value) => /@[a-f0-9]{40}$/u.test(value))).toBe(true);
    expect(workflow).toContain('"paddleocr-local-v*"');
    expect(workflow).not.toMatch(/^\s*-\s*"?v\*"?\s*$/mu);
    expect(workflow).toContain('node-version: "24.14.0"');
    expect(workflow).toContain("environment: production-release");
    expect(workflow).toContain("PIGE_PADDLEOCR_BUNDLE_SIGNING_KEY_PEM");
    expect(workflow).toContain('test "$manifest_target" = "$release_commit"');
    expect(workflow).toContain("Existing immutable PaddleOCR prerelease matches the reviewed rebuild.");
    expect(workflow).toContain('cmp --silent "$archive"');
    expect(workflow).not.toContain('test "$(git rev-parse "refs/tags/$PIGE_REQUESTED_TAG^{commit}")" = "$PIGE_REQUESTED_COMMIT"');
    expect(workflow).not.toMatch(/pip\s+install|uv\s+pip|npm\s+install(?!ed)/u);

    for (const platform of ["macos-arm64", "windows-x64"]) {
      const lock = readJson(path.join(
        root,
        `resources/parser-manifests/paddleocr-local.${platform}.selected-wheels.lock.json`
      )) as { wheels: Array<{ filename: string; url: string }> };
      expect(lock.wheels.every((wheel) => {
        const url = new URL(wheel.url);
        return url.protocol === "https:" &&
          url.origin === "https://files.pythonhosted.org" &&
          decodeURIComponent(url.pathname.split("/").at(-1) ?? "") === wheel.filename;
      })).toBe(true);
    }

    const packageJson = readJson(path.join(root, "package.json")) as { scripts: Record<string, string> };
    expect(packageJson.scripts).toMatchObject({
      "release:paddleocr:inputs": "node apps/desktop/scripts/paddleocr-release-inputs.mjs",
      "release:paddleocr:build": "node apps/desktop/scripts/build-paddleocr-release-bundle.mjs",
      "release:paddleocr:archive": "node apps/desktop/scripts/package-paddleocr-release-bundle.mjs",
      "release:paddleocr:verify": "node apps/desktop/scripts/paddleocr-release-inputs.mjs"
    });
  });
});

function createInputFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-paddle-workflow-"));
  roots.push(root);
  const legalRoot = path.join(root, "legal");
  fs.mkdirSync(legalRoot);
  const bodies = {
    runtime: Buffer.from("runtime"),
    model: Buffer.from("model"),
    paddleocr: Buffer.from("paddleocr-wheel"),
    paddlepaddle: Buffer.from("paddlepaddle-wheel")
  };
  const origin = "https://inputs.example.invalid";
  const urls = {
    runtime: `${origin}/runtime.tar.gz`,
    model: `${origin}/Tiny_det_infer.tar`,
    paddleocr: `${origin}/paddleocr-3.7.0-py3-none-any.whl`,
    paddlepaddle: `${origin}/paddlepaddle-3.3.1-py3-none-any.whl`
  };
  const identity = (body: Buffer) => ({ sizeBytes: body.length, sha256: sha256(body) });
  const legalDefinitions = [
    ["model:Tiny_det", "Apache-2.0", "model/LICENSE.txt"],
    ["runtime:cpython", "MPL-2.0", "runtime/python-build-standalone-MPL-2.0.txt"],
    ["wheel:paddleocr", "Apache-2.0", "paddleocr/LICENSE.txt"],
    ["wheel:paddlepaddle", "Apache-2.0", "paddlepaddle/LICENSE.txt"],
    ["wrapper:pige", "Apache-2.0", "wrapper/LICENSE.txt"]
  ] as const;
  const legal = legalDefinitions.map(([componentId, licenseExpression, relativePath]) => {
    const content = Buffer.from(`${componentId} license\n`);
    const target = path.join(legalRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    return {
      componentId,
      licenseExpression,
      files: [{ path: relativePath, kind: "license", ...identity(content) }]
    };
  });
  const available = {
    platform: "macos-arm64",
    state: "available",
    artifactUrl: `https://github.com/YinsenW/Pige/releases/download/${TAG}/pige-paddleocr-macos-arm64.zip`,
    sizeBytes: 1,
    sha256: `sha256:${"1".repeat(64)}`,
    signature: { algorithm: "Ed25519", keyId: "pige-paddleocr-test", valueBase64: Buffer.alloc(64).toString("base64") },
    sbomSha256: `sha256:${"2".repeat(64)}`,
    installedTreeSha256: `sha256:${"3".repeat(64)}`,
    installedSizeBytes: 1,
    wrapperSha256: `sha256:${"4".repeat(64)}`,
    packageLimits: LIMITS
  };
  const manifest = {
    schemaVersion: 1,
    id: "paddleocr_local",
    catalogVersion: "2026-07-28",
    engineVersion: "3.7.0",
    platforms: ["macos-arm64", "windows-x64"],
    capabilities: ["local_text_detection", "local_text_recognition"],
    executionBoundary: "isolated_managed_python_process",
    networkAccessDuringOcr: false,
    hiddenDownloads: false,
    materialization: {
      mode: "release_preassembled_verified_bundle",
      userMachinePackageResolution: false,
      userMachineSourceBuild: false
    },
    trustedOrigins: {
      releaseInputs: [origin, "https://release-assets.example.invalid"],
      runtimeDenied: [],
      redirectPolicy: "fixture"
    },
    pythonRuntime: {
      implementation: "CPython",
      version: "3.13.14",
      projectLicense: "MPL-2.0",
      assets: [
        { platform: "macos-arm64", url: urls.runtime, ...identity(bodies.runtime) },
        { platform: "windows-x64", url: `${origin}/runtime-windows.tar.gz`, sizeBytes: 1, sha256: "0".repeat(64) }
      ]
    },
    pythonPackages: [{
      name: "paddleocr", version: "3.7.0", license: "Apache-2.0",
      filename: path.basename(urls.paddleocr), url: urls.paddleocr, ...identity(bodies.paddleocr)
    }],
    paddlePaddle: {
      version: "3.3.1", license: "Apache-2.0", backend: "cpu",
      assets: [
        { platform: "macos-arm64", filename: path.basename(urls.paddlepaddle), url: urls.paddlepaddle, ...identity(bodies.paddlepaddle) },
        { platform: "windows-x64", filename: "paddlepaddle-3.3.1-cp313-cp313-win_amd64.whl", url: `${origin}/paddlepaddle-win.whl`, sizeBytes: 1, sha256: "1".repeat(64) }
      ]
    },
    models: [{ id: "Tiny_det", role: "text_detection", license: "Apache-2.0", url: urls.model, ...identity(bodies.model) }],
    releaseBundles: [available, { platform: "windows-x64", state: "awaiting_release_artifact", artifactUrl: null, sizeBytes: null, sha256: null, signature: null, sbomSha256: null }],
    releaseSigningKeys: [{ algorithm: "Ed25519", keyId: "pige-paddleocr-test", publicKeySpkiBase64: Buffer.from("fixture-key").toString("base64") }]
  };
  const lock = {
    schemaVersion: 1,
    toolId: "paddleocr_local",
    catalogVersion: "2026-07-28",
    engineVersion: "3.7.0",
    platform: "macos-arm64",
    pythonAbi: "cp313",
    bundleLicense: {
      spdxId: "LicenseRef-Pige-PaddleOCR-3.7.0-Aggregate-Legal-Inventory",
      name: "See bundled legal inventory"
    },
    wrapper: { sizeBytes: 1, sha256: "5".repeat(64) },
    limits: { maxFiles: 128, maxFileBytes: 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, maxArchiveEntries: 128, maxArchiveExpandedBytes: 8 * 1024 * 1024 },
    wheels: [
      {
        name: "paddleocr", version: "3.7.0", filename: path.basename(urls.paddleocr), url: urls.paddleocr,
        ...identity(bodies.paddleocr), metadataSha256: "6".repeat(64), license: "Apache-2.0",
        purl: "pkg:pypi/paddleocr@3.7.0", dependencies: ["paddlepaddle"]
      },
      {
        name: "paddlepaddle", version: "3.3.1", filename: path.basename(urls.paddlepaddle), url: urls.paddlepaddle,
        ...identity(bodies.paddlepaddle), metadataSha256: "7".repeat(64), license: "Apache-2.0",
        purl: "pkg:pypi/paddlepaddle@3.3.1", dependencies: []
      }
    ],
    legal
  };
  const manifestPath = path.join(root, "manifest.json");
  const lockPath = path.join(root, "selected.lock.json");
  writeJson(manifestPath, manifest);
  writeJson(lockPath, lock);
  return {
    root,
    legalRoot,
    manifestPath,
    lockPath,
    runtimeUrl: urls.runtime,
    downloads: new Map<string, Buffer>([
      [urls.runtime, bodies.runtime],
      [urls.model, bodies.model],
      [urls.paddleocr, bodies.paddleocr],
      [urls.paddlepaddle, bodies.paddlepaddle]
    ])
  };
}

function createLocalToolPackage(root: string) {
  const packageRoot = path.join(root, "package");
  fs.mkdirSync(path.join(packageRoot, "pige"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "sbom"), { recursive: true });
  const files = [
    ["pige/paddle_ocr_wrapper.py", Buffer.from("print('fixed')\n"), true],
    ["sbom/paddleocr.spdx.json", Buffer.from('{"spdxVersion":"SPDX-2.3"}\n'), false]
  ] as const;
  const entries = files.map(([relativePath, body, executable]) => {
    fs.writeFileSync(path.join(packageRoot, ...relativePath.split("/")), body);
    return { path: relativePath, sizeBytes: body.length, sha256: `sha256:${sha256(body)}`, executable };
  });
  writeJson(path.join(packageRoot, "manifest.json"), {
    schemaVersion: 1,
    toolId: "paddleocr_local",
    version: "3.7.0",
    platform: "macos",
    architecture: "arm64",
    capabilities: ["local_text_recognition"],
    license: { spdxId: "LicenseRef-Pige-PaddleOCR-3.7.0-Aggregate-Legal-Inventory", name: "See bundled legal inventory" },
    files: entries
  });
  return packageRoot;
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
