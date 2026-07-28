import { createHash, generateKeyPairSync, verify } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalPaddleOcrArtifactIdentity as canonicalReleaseIdentity,
  packagePaddleOcrReleaseBundle
} from "../../apps/desktop/scripts/package-paddleocr-release-bundle.mjs";
import { canonicalPaddleOcrArtifactIdentity as canonicalMainIdentity } from
  "../../apps/desktop/src/main/services/paddle-ocr-bundle-materializer";

const roots: string[] = [];
const LIMITS = {
  maxManifestBytes: 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxFiles: 128
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PaddleOCR release publication", () => {
  it("creates a byte-identical ZIP and signed canonical available-bundle record", async () => {
    const fixture = createPackage();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const firstPath = path.join(fixture.root, "first.zip");
    const secondPath = path.join(fixture.root, "second.zip");
    const input = {
      packageRoot: fixture.packageRoot,
      artifactUrl: "https://github.com/YinsenW/Pige/releases/download/paddleocr-local-v3.7.0/pige-paddleocr-macos-arm64.zip",
      platform: "macos-arm64",
      engineVersion: "3.7.0",
      keyId: "pige-paddleocr-2026-01",
      privateKey,
      packageLimits: LIMITS
    } as const;
    const first = await packagePaddleOcrReleaseBundle({ ...input, outputPath: firstPath });
    const second = await packagePaddleOcrReleaseBundle({ ...input, outputPath: secondPath });

    expect(fs.readFileSync(firstPath)).toEqual(fs.readFileSync(secondPath));
    expect(first.bundle).toEqual(second.bundle);
    expect(first.bundle).toMatchObject({
      state: "available",
      platform: "macos-arm64",
      installedSizeBytes: fixture.installedSizeBytes,
      packageLimits: LIMITS,
      signature: { algorithm: "Ed25519", keyId: "pige-paddleocr-2026-01" }
    });
    expect(first.bundle.sha256).toBe(sha256(fs.readFileSync(firstPath)));
    expect(first.publicKeySpkiBase64).toBe(publicKey.export({ type: "spki", format: "der" }).toString("base64"));
    expect(verify(
      null,
      Buffer.from(canonicalReleaseIdentity(first.bundle, "3.7.0"), "utf8"),
      publicKey,
      Buffer.from(first.bundle.signature.valueBase64, "base64")
    )).toBe(true);
    expect(canonicalReleaseIdentity(first.bundle, "3.7.0"))
      .toBe(canonicalMainIdentity(first.bundle, "3.7.0"));
  });

  it("fails closed on undeclared files, digest drift, and links", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const base = (fixture: ReturnType<typeof createPackage>, suffix: string) => ({
      packageRoot: fixture.packageRoot,
      outputPath: path.join(fixture.root, `${suffix}.zip`),
      artifactUrl: `https://github.com/YinsenW/Pige/releases/download/test/${suffix}.zip`,
      platform: "macos-arm64",
      engineVersion: "3.7.0",
      keyId: "pige-paddleocr-test",
      privateKey,
      packageLimits: LIMITS
    } as const);

    const extra = createPackage();
    fs.writeFileSync(path.join(extra.packageRoot, "extra.txt"), "extra");
    await expect(packagePaddleOcrReleaseBundle(base(extra, "extra"))).rejects.toThrow(/undeclared or missing/u);

    const drift = createPackage();
    fs.appendFileSync(path.join(drift.packageRoot, "pige/paddle_ocr_wrapper.py"), "drift");
    await expect(packagePaddleOcrReleaseBundle(base(drift, "drift"))).rejects.toThrow(/differs from its manifest/u);

    const linked = createPackage();
    fs.symlinkSync("paddle_ocr_wrapper.py", path.join(linked.packageRoot, "pige/alias.py"));
    await expect(packagePaddleOcrReleaseBundle(base(linked, "linked"))).rejects.toThrow(/contains a link/u);
  });
});

function createPackage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-paddle-release-"));
  roots.push(root);
  const packageRoot = path.join(root, "package");
  fs.mkdirSync(path.join(packageRoot, "pige"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "sbom"), { recursive: true });
  const payloads = {
    "pige/paddle_ocr_wrapper.py": Buffer.from("print('strict wrapper')\n"),
    "sbom/paddleocr.spdx.json": Buffer.from('{"spdxVersion":"SPDX-2.3"}\n')
  };
  const files = Object.entries(payloads).map(([relativePath, body]) => {
    fs.writeFileSync(path.join(packageRoot, ...relativePath.split("/")), body);
    return { path: relativePath, sizeBytes: body.length, sha256: sha256(body), executable: relativePath.endsWith(".py") };
  });
  fs.writeFileSync(path.join(packageRoot, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    toolId: "paddleocr_local",
    version: "3.7.0",
    platform: "macos",
    architecture: "arm64",
    capabilities: ["local_text_recognition"],
    license: { spdxId: "NOASSERTION", name: "See bundled legal inventory" },
    files
  }, null, 2)}\n`);
  return {
    root,
    packageRoot,
    installedSizeBytes: Object.values(payloads).reduce((total, body) => total + body.length, 0)
  };
}

function sha256(value: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
