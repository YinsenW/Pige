import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZipFile } from "yazl";
import {
  assertPaddleOcrWheelFilename,
  buildPaddleOcrReleaseBundle,
  parseReviewedPaddleOcrManifest,
  parseSelectedWheelLock
} from "../../apps/desktop/scripts/build-paddleocr-release-bundle.mjs";
import {
  computeLocalToolPackageSha256,
  parseLocalToolPackageManifest
} from "../../apps/desktop/src/main/services/local-tool-package";

const temporaryRoots: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PaddleOCR release bundle builder", () => {
  it("accepts reviewed stable-ABI wheels that predate CPython 3.13 without weakening platform tags", () => {
    expect(() => assertPaddleOcrWheelFilename(
      "opencv_contrib_python-4.10.0.84-cp37-abi3-macosx_11_0_arm64.whl",
      "opencv-contrib-python",
      "4.10.0.84",
      "macos-arm64"
    )).not.toThrow();
    expect(() => assertPaddleOcrWheelFilename(
      "psutil-7.2.2-cp36-abi3-macosx_11_0_arm64.whl",
      "psutil",
      "7.2.2",
      "macos-arm64"
    )).not.toThrow();
    expect(() => assertPaddleOcrWheelFilename(
      "opencv_contrib_python-4.10.0.84-cp37-abi3-win_amd64.whl",
      "opencv-contrib-python",
      "4.10.0.84",
      "windows-x64"
    )).not.toThrow();
    expect(() => assertPaddleOcrWheelFilename(
      "opencv_contrib_python-4.10.0.84-cp37-abi3-win32.whl",
      "opencv-contrib-python",
      "4.10.0.84",
      "windows-x64"
    )).toThrow(/incompatible/u);
  });

  it("builds the same complete offline LocalTool package from exact locked inputs", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("release bundle tests must not access the network");
    });
    const fixture = await createFixture();
    const firstOutput = path.join(fixture.root, "bundle-a");
    const secondOutput = path.join(fixture.root, "bundle-b");

    const first = await buildPaddleOcrReleaseBundle({ ...fixture.input, outputPath: firstOutput });
    const second = await buildPaddleOcrReleaseBundle({ ...fixture.input, outputPath: secondOutput });

    expect(first.packageSha256).toBe(second.packageSha256);
    expect(hashTree(firstOutput)).toBe(hashTree(secondOutput));
    expect(first.fileCount).toBeGreaterThan(10);
    const manifest = parseLocalToolPackageManifest(readJson(path.join(firstOutput, "manifest.json")), {
      maxManifestBytes: 1024 * 1024,
      maxFileBytes: 1024 * 1024,
      maxTotalBytes: 16 * 1024 * 1024,
      maxFiles: 1024
    });
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      toolId: "paddleocr_local",
      version: "3.7.0",
      platform: "macos",
      architecture: "arm64",
      license: { spdxId: "NOASSERTION", name: "See bundled legal inventory" }
    });
    expect(computeLocalToolPackageSha256(firstOutput, {
      maxManifestBytes: 1024 * 1024,
      maxFileBytes: 1024 * 1024,
      maxTotalBytes: 16 * 1024 * 1024,
      maxFiles: 1024
    })).toBe(first.packageSha256);

    const actualPayloadFiles = collectFiles(firstOutput).filter((file) => file !== "manifest.json");
    expect(manifest.files.map((file) => file.path)).toEqual(actualPayloadFiles);
    expect(fs.readFileSync(path.join(firstOutput, "python/lib/python3.13/site-packages/paddleocr/__init__.py"), "utf8"))
      .toBe("__version__ = '3.7.0'\n");
    expect(fs.readFileSync(path.join(firstOutput, "python/lib/python3.13/site-packages/paddle/__init__.py"), "utf8"))
      .toBe("__version__ = '3.3.1'\n");
    expect(fs.lstatSync(path.join(firstOutput, "python/bin/python3")).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(firstOutput, "python/bin/pip3"))).toBe(false);
    expect(fs.readFileSync(path.join(firstOutput, "models/Tiny_det_infer/inference.pdmodel"), "utf8"))
      .toBe("tiny-model\n");
    expect(fs.readFileSync(path.join(firstOutput, "pige/paddle_ocr_wrapper.py"), "utf8"))
      .toBe("print('fixed wrapper')\n");

    const cyclonedx = readJson(path.join(firstOutput, "sbom/paddleocr.cdx.json")) as {
      bomFormat: string;
      components: Array<{ name: string }>;
    };
    const spdx = readJson(path.join(firstOutput, "sbom/paddleocr.spdx.json")) as {
      spdxVersion: string;
      packages: Array<{ name: string }>;
    };
    expect(cyclonedx.bomFormat).toBe("CycloneDX");
    expect(cyclonedx.components.map((component) => component.name)).toEqual([
      "Tiny_det", "CPython", "pige-paddleocr-wrapper", "paddleocr", "paddlepaddle"
    ]);
    expect(spdx.spdxVersion).toBe("SPDX-2.3");
    expect(spdx.packages).toHaveLength(5);
    expect(fs.readFileSync(path.join(firstOutput, "legal/NOTICE.txt"), "utf8"))
      .toContain("wheel:paddleocr — Apache-2.0");
    expect(fs.readFileSync(path.join(firstOutput, "supply-chain/selected-wheels.lock.json")))
      .toEqual(fs.readFileSync(fixture.input.wheelLockPath));
    expect(fs.readFileSync(path.join(firstOutput, "supply-chain/paddleocr-local.parser.manifest.json")))
      .toEqual(fs.readFileSync(fixture.input.parserManifestPath));
  });

  it("fails closed on absent, extra, or checksum-mismatched release input", async () => {
    const missing = await createFixture();
    fs.rmSync(path.join(missing.input.artifactRoot, "paddleocr-3.7.0-py3-none-any.whl"));
    await expect(buildPaddleOcrReleaseBundle({ ...missing.input, outputPath: path.join(missing.root, "missing") }))
      .rejects.toThrow(/exactly the locked release artifacts/u);

    const extra = await createFixture();
    fs.writeFileSync(path.join(extra.input.artifactRoot, "unreviewed.whl"), "extra");
    await expect(buildPaddleOcrReleaseBundle({ ...extra.input, outputPath: path.join(extra.root, "extra") }))
      .rejects.toThrow(/exactly the locked release artifacts/u);

    const tampered = await createFixture();
    fs.appendFileSync(path.join(tampered.input.artifactRoot, "paddleocr-3.7.0-py3-none-any.whl"), "tamper");
    await expect(buildPaddleOcrReleaseBundle({ ...tampered.input, outputPath: path.join(tampered.root, "tampered") }))
      .rejects.toThrow(/locked size and SHA-256/u);
  });

  it("rejects sdists, incomplete dependency closure, and incomplete legal coverage before materialization", async () => {
    const fixture = await createFixture();
    const manifest = readJson(fixture.input.parserManifestPath);
    const parsedManifest = parseReviewedPaddleOcrManifest(manifest);
    const baseLock = readJson(fixture.input.wheelLockPath) as Record<string, unknown> & {
      wheels: Array<Record<string, unknown>>;
      legal: Array<Record<string, unknown>>;
    };

    const sdist = structuredClone(baseLock);
    sdist.wheels[0].filename = "paddleocr-3.7.0.tar.gz";
    expect(() => parseSelectedWheelLock(sdist, parsedManifest)).toThrow(/sdists/u);

    const missingDependency = structuredClone(baseLock);
    missingDependency.wheels[0].dependencies = ["missing-runtime"];
    expect(() => parseSelectedWheelLock(missingDependency, parsedManifest)).toThrow(/missing dependency/u);

    const missingLicense = structuredClone(baseLock);
    missingLicense.legal = missingLicense.legal.filter((entry) => entry.componentId !== "wrapper:pige");
    expect(() => parseSelectedWheelLock(missingLicense, parsedManifest)).toThrow(/cover exactly/u);
  });

  it("contains no network, package resolver, source-build, or shell execution path", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "apps/desktop/scripts/build-paddleocr-release-bundle.mjs"),
      "utf8"
    );
    expect(source).not.toMatch(/node:(?:child_process|http|https)|\bfetch\s*\(|\bpip\s+install\b|\buv\s+pip\b/u);
    expect(source).toContain('if (!filename.endsWith(".whl"))');
    expect(source).toContain("Artifact root must contain exactly the locked release artifacts.");
    expect(source).toContain("METADATA does not match the selected lock");
    expect(parseReviewedPaddleOcrManifest(readJson(
      path.join(process.cwd(), "resources/parser-manifests/paddleocr-local.parser.manifest.json")
    ))).toMatchObject({
      catalogVersion: "2026-07-28",
      engineVersion: "3.7.0",
      platforms: ["macos-arm64", "windows-x64"]
    });
  });
});

async function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-paddle-release-bundle-"));
  temporaryRoots.push(root);
  const artifactRoot = path.join(root, "artifacts");
  const legalRoot = path.join(root, "legal-input");
  fs.mkdirSync(artifactRoot);
  fs.mkdirSync(legalRoot);

  const runtimeSource = path.join(root, "runtime-source");
  fs.mkdirSync(path.join(runtimeSource, "python/bin"), { recursive: true });
  fs.writeFileSync(path.join(runtimeSource, "python/bin/python3.13"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.symlinkSync("python3.13", path.join(runtimeSource, "python/bin/python3"));
  fs.symlinkSync("python3.13", path.join(runtimeSource, "python/bin/pip3"));
  fs.mkdirSync(path.join(runtimeSource, "python/lib/python3.13/site-packages"), { recursive: true });
  const runtimeFilename = "cpython-3.13.14-test-install_only.tar.gz";
  await tar.c({ cwd: runtimeSource, file: path.join(artifactRoot, runtimeFilename), gzip: true, portable: true }, ["python"]);

  const modelSource = path.join(root, "model-source");
  fs.mkdirSync(path.join(modelSource, "Tiny_det_infer"), { recursive: true });
  fs.writeFileSync(path.join(modelSource, "Tiny_det_infer/inference.pdmodel"), "tiny-model\n");
  const modelFilename = "Tiny_det_infer.tar";
  await tar.c({ cwd: modelSource, file: path.join(artifactRoot, modelFilename), portable: true }, ["Tiny_det_infer"]);

  const paddleOcrMetadata = metadata("paddleocr", "3.7.0", ["paddlepaddle (==3.3.1)"]);
  const paddleMetadata = metadata("paddlepaddle", "3.3.1", []);
  const paddleOcrFilename = "paddleocr-3.7.0-py3-none-any.whl";
  const paddleFilename = "paddlepaddle-3.3.1-py3-none-any.whl";
  await writeWheel(path.join(artifactRoot, paddleOcrFilename), "paddleocr", "3.7.0", paddleOcrMetadata);
  await writeWheel(path.join(artifactRoot, paddleFilename), "paddle", "3.3.1", paddleMetadata, "paddlepaddle");

  const wrapperPath = path.join(root, "paddle_ocr_wrapper.py");
  fs.writeFileSync(wrapperPath, "print('fixed wrapper')\n");

  const legalDefinitions = [
    ["model:Tiny_det", "Apache-2.0", "model/LICENSE.txt"],
    ["runtime:cpython", "MPL-2.0", "runtime/LICENSE.txt"],
    ["wheel:paddleocr", "Apache-2.0", "paddleocr/LICENSE.txt"],
    ["wheel:paddlepaddle", "Apache-2.0", "paddlepaddle/LICENSE.txt"],
    ["wrapper:pige", "Apache-2.0", "wrapper/LICENSE.txt"]
  ] as const;
  const legal = legalDefinitions.map(([componentId, licenseExpression, relativePath]) => {
    const content = `${componentId} fixture license\n`;
    const absolutePath = path.join(legalRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
    return {
      componentId,
      licenseExpression,
      files: [{ path: relativePath, kind: "license", sizeBytes: Buffer.byteLength(content), sha256: sha256(content) }]
    };
  });

  const runtimeIdentity = fileIdentity(path.join(artifactRoot, runtimeFilename));
  const modelIdentity = fileIdentity(path.join(artifactRoot, modelFilename));
  const paddleOcrIdentity = fileIdentity(path.join(artifactRoot, paddleOcrFilename));
  const paddleIdentity = fileIdentity(path.join(artifactRoot, paddleFilename));
  const parserManifest = {
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
    pythonRuntime: {
      implementation: "CPython",
      version: "3.13.14",
      projectLicense: "MPL-2.0",
      assets: [
        { platform: "macos-arm64", url: `https://example.invalid/${runtimeFilename}`, ...runtimeIdentity },
        { platform: "windows-x64", url: "https://example.invalid/cpython-windows.tar.gz", sizeBytes: 1, sha256: "0".repeat(64) }
      ]
    },
    pythonPackages: [{
      name: "paddleocr",
      version: "3.7.0",
      license: "Apache-2.0",
      filename: paddleOcrFilename,
      url: `https://example.invalid/${paddleOcrFilename}`,
      ...paddleOcrIdentity
    }],
    paddlePaddle: {
      version: "3.3.1",
      license: "Apache-2.0",
      backend: "cpu",
      assets: [
        { platform: "macos-arm64", filename: paddleFilename, url: `https://example.invalid/${paddleFilename}`, ...paddleIdentity },
        { platform: "windows-x64", filename: "paddlepaddle-3.3.1-cp313-cp313-win_amd64.whl", url: "https://example.invalid/paddlepaddle-win.whl", sizeBytes: 1, sha256: "1".repeat(64) }
      ]
    },
    models: [{
      id: "Tiny_det",
      role: "text_detection",
      license: "Apache-2.0",
      url: `https://example.invalid/${modelFilename}`,
      ...modelIdentity
    }]
  };
  const parserManifestPath = path.join(root, "parser-manifest.json");
  writeJson(parserManifestPath, parserManifest);

  const wheelLock = {
    schemaVersion: 1,
    toolId: "paddleocr_local",
    catalogVersion: "2026-07-28",
    engineVersion: "3.7.0",
    platform: "macos-arm64",
    pythonAbi: "cp313",
    bundleLicense: { spdxId: "NOASSERTION", name: "See bundled legal inventory" },
    wrapper: fileIdentity(wrapperPath),
    limits: {
      maxFiles: 1024,
      maxFileBytes: 1024 * 1024,
      maxTotalBytes: 16 * 1024 * 1024,
      maxArchiveEntries: 1024,
      maxArchiveExpandedBytes: 16 * 1024 * 1024
    },
    wheels: [
      {
        name: "paddleocr",
        version: "3.7.0",
        filename: paddleOcrFilename,
        ...paddleOcrIdentity,
        metadataSha256: sha256(paddleOcrMetadata),
        license: "Apache-2.0",
        purl: "pkg:pypi/paddleocr@3.7.0",
        dependencies: ["paddlepaddle"]
      },
      {
        name: "paddlepaddle",
        version: "3.3.1",
        filename: paddleFilename,
        ...paddleIdentity,
        metadataSha256: sha256(paddleMetadata),
        license: "Apache-2.0",
        purl: "pkg:pypi/paddlepaddle@3.3.1",
        dependencies: []
      }
    ],
    legal
  };
  const wheelLockPath = path.join(root, "selected-wheels.lock.json");
  writeJson(wheelLockPath, wheelLock);
  return {
    root,
    input: { parserManifestPath, wheelLockPath, artifactRoot, legalRoot, wrapperPath }
  };
}

function metadata(name: string, version: string, dependencies: readonly string[]): string {
  return [
    "Metadata-Version: 2.4",
    `Name: ${name}`,
    `Version: ${version}`,
    ...dependencies.map((dependency) => `Requires-Dist: ${dependency}`),
    ""
  ].join("\n");
}

function writeWheel(
  filePath: string,
  importName: string,
  version: string,
  metadataContent: string,
  distributionName = importName
): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const distInfo = `${distributionName}-${version}.dist-info`;
    zip.addBuffer(Buffer.from(`__version__ = '${version}'\n`), `${importName}/__init__.py`);
    zip.addBuffer(Buffer.from(metadataContent), `${distInfo}/METADATA`);
    zip.addBuffer(Buffer.from("Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n"), `${distInfo}/WHEEL`);
    zip.addBuffer(Buffer.from(""), `${distInfo}/RECORD`);
    zip.outputStream.once("error", reject);
    const output = fs.createWriteStream(filePath, { flags: "wx", mode: 0o600 });
    output.once("error", reject);
    output.once("close", resolve);
    zip.outputStream.pipe(output);
    zip.end();
  });
}

function fileIdentity(filePath: string) {
  const bytes = fs.readFileSync(filePath);
  return { sizeBytes: bytes.length, sha256: sha256(bytes) };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectFiles(rootPath: string): string[] {
  const files: string[] = [];
  const visit = (directoryPath: string, relativeDirectory: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else files.push(relativePath);
    }
  };
  visit(rootPath, "");
  return files.sort();
}

function hashTree(rootPath: string): string {
  const hash = createHash("sha256");
  for (const relativePath of collectFiles(rootPath)) {
    const bytes = fs.readFileSync(path.join(rootPath, relativePath));
    hash.update(`${relativePath}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}
