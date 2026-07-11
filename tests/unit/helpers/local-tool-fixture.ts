import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  computeLocalToolPackageSha256,
  type LocalToolPackageManifest
} from "../../../apps/desktop/src/main/services/local-tool-package";
import type {
  LocalToolAssetDefinition,
  LocalToolDefinition
} from "../../../apps/desktop/src/main/services/local-tool-manager-types";

export interface FakeLocalToolFixtureOptions {
  readonly toolId?: string;
  readonly assetId?: string;
  readonly version?: string;
  readonly platform?: "macos" | "windows" | "linux";
  readonly architecture?: "arm64" | "x64";
  readonly capabilities?: readonly string[];
  readonly license?: { readonly spdxId: string; readonly name?: string };
  readonly files?: Readonly<Record<string, string | Buffer>>;
}

export interface FakeLocalToolFixture {
  readonly rootPath: string;
  readonly manifestPath: string;
  readonly manifest: LocalToolPackageManifest;
  readonly packageSha256: string;
  readonly sizeBytes: number;
}

export function createFakeLocalToolFixture(
  rootPath: string,
  options: FakeLocalToolFixtureOptions = {}
): FakeLocalToolFixture {
  fs.mkdirSync(rootPath, { recursive: true });
  const files = options.files ?? { "bin/fake-ocr.txt": "fake-local-tool\n" };
  const declaredFiles = Object.entries(files).map(([relativePath, value]) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    const absolutePath = path.join(rootPath, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, bytes);
    const executable = relativePath.startsWith("bin/");
    if (process.platform !== "win32") fs.chmodSync(absolutePath, executable ? 0o700 : 0o600);
    return {
      path: relativePath,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      executable
    };
  });
  const manifest: LocalToolPackageManifest = {
    schemaVersion: 1,
    toolId: options.toolId ?? "fake_ocr",
    ...(options.assetId ? { assetId: options.assetId } : {}),
    version: options.version ?? "1.0.0",
    platform: options.platform ?? "macos",
    architecture: options.architecture ?? "arm64",
    capabilities: options.capabilities ?? ["ocr.text"],
    license: options.license ?? { spdxId: "Apache-2.0", name: "Apache License 2.0" },
    files: declaredFiles
  };
  const manifestPath = path.join(rootPath, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    rootPath,
    manifestPath,
    manifest,
    packageSha256: computeLocalToolPackageSha256(rootPath),
    sizeBytes: declaredFiles.reduce((total, file) => total + file.sizeBytes, 0)
  };
}

export function toToolDefinition(
  fixture: FakeLocalToolFixture,
  input: {
    readonly label?: string;
    readonly kind?: LocalToolDefinition["kind"];
    readonly assets?: readonly LocalToolAssetDefinition[];
  } = {}
): LocalToolDefinition {
  if (fixture.manifest.assetId) throw new Error("Root tool definition cannot be built from an asset fixture.");
  return {
    toolId: fixture.manifest.toolId,
    label: input.label ?? "Fake OCR",
    kind: input.kind ?? "ocr",
    version: fixture.manifest.version,
    platform: fixture.manifest.platform,
    architecture: fixture.manifest.architecture,
    capabilities: fixture.manifest.capabilities,
    license: fixture.manifest.license,
    expectedSha256: fixture.packageSha256,
    expectedSizeBytes: fixture.sizeBytes,
    ...(input.assets ? { assets: input.assets } : {})
  };
}

export function toAssetDefinition(fixture: FakeLocalToolFixture): LocalToolAssetDefinition {
  if (!fixture.manifest.assetId) throw new Error("Asset definition requires an asset fixture.");
  return {
    toolId: fixture.manifest.toolId,
    assetId: fixture.manifest.assetId,
    version: fixture.manifest.version,
    platform: fixture.manifest.platform,
    architecture: fixture.manifest.architecture,
    capabilities: fixture.manifest.capabilities,
    license: fixture.manifest.license,
    expectedSha256: fixture.packageSha256,
    expectedSizeBytes: fixture.sizeBytes
  };
}

export function rewriteManifest(
  fixture: FakeLocalToolFixture,
  transform: (manifest: Record<string, unknown>) => Record<string, unknown>
): void {
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8")) as Record<string, unknown>;
  fs.writeFileSync(fixture.manifestPath, `${JSON.stringify(transform(manifest), null, 2)}\n`, "utf8");
}

export function hashTree(rootPath: string): string {
  const hash = createHash("sha256");
  const visit = (directoryPath: string, relativeDirectory: string): void => {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directoryPath, entry.name);
      hash.update(`${entry.isDirectory() ? "d" : "f"}\0${relativePath}\0`, "utf8");
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else hash.update(fs.readFileSync(absolutePath));
    }
  };
  visit(rootPath, "");
  return `sha256:${hash.digest("hex")}`;
}

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
