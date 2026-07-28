import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { ZipFile } from "yazl";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PaddleOcrBundleMaterializer,
  canonicalPaddleOcrArtifactIdentity,
  type PaddleOcrBundleFetch,
  type ReviewedPaddleOcrAvailableBundle
} from "../../apps/desktop/src/main/services/paddle-ocr-bundle-materializer";
import type { LocalToolPackageLimits } from "../../apps/desktop/src/main/services/local-tool-package";
import { createFakeLocalToolFixture } from "./helpers/local-tool-fixture";

const REQUEST_ID = "paddleocr_materialize_abcdefghijkl";
const ENGINE_VERSION = "3.7.0";
const INITIAL_URL = "https://downloads.example.test/paddleocr.zip";
const REDIRECT_URL = "https://objects.example.test/releases/paddleocr.zip";
const ORIGINS = ["https://downloads.example.test", "https://objects.example.test"] as const;
const LIMITS: LocalToolPackageLimits = {
  maxManifestBytes: 64 * 1024,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxFiles: 32
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Paddle OCR release bundle materializer", () => {
  it("streams an exact reviewed redirect, verifies its signature and digests, and returns a private package", async () => {
    const fixture = await makeFixture();
    const fetch = redirectingFetch(fixture.archive);
    const materializer = createMaterializer(fixture, fetch);

    const candidate = await materializer.materialize(REQUEST_ID);

    expect(fetch).toHaveBeenNthCalledWith(1, INITIAL_URL, expect.objectContaining({ redirect: "manual" }));
    expect(fetch).toHaveBeenNthCalledWith(2, REDIRECT_URL, expect.objectContaining({ redirect: "manual" }));
    expect(candidate).toEqual({
      version: ENGINE_VERSION,
      candidatePath: expect.stringContaining(`${path.sep}candidate`),
      expectedSha256: fixture.packageSha256
    });
    expect(fs.readFileSync(path.join(candidate.candidatePath, "pige/paddle_ocr_wrapper.py"), "utf8"))
      .toBe("print('strict wrapper')\n");
    expect(candidate.candidatePath).not.toContain(INITIAL_URL);

    materializer.discard(REQUEST_ID);
    expect(fs.existsSync(path.dirname(candidate.candidatePath))).toBe(false);
  });

  it("rejects a bad canonical-identity signature before any download", async () => {
    const fixture = await makeFixture();
    const fetch = vi.fn<PaddleOcrBundleFetch>();
    const badBundle = {
      ...fixture.bundle,
      signature: { ...fixture.bundle.signature, valueBase64: Buffer.alloc(64, 7).toString("base64") }
    };

    expect(() => createMaterializer({ ...fixture, bundle: badBundle }, fetch)).toThrow();
    expect(fetch).not.toHaveBeenCalled();

    const changedLimits = {
      ...fixture.bundle,
      packageLimits: { ...fixture.bundle.packageLimits, maxFiles: fixture.bundle.packageLimits.maxFiles - 1 }
    };
    expect(() => createMaterializer({ ...fixture, bundle: changedLimits }, fetch)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed on an unreviewed redirect and removes private request staging", async () => {
    const fixture = await makeFixture();
    const fetch = vi.fn<PaddleOcrBundleFetch>(async () => response(302, Buffer.alloc(0), {
      location: "https://unreviewed.example.test/paddleocr.zip"
    }));
    const materializer = createMaterializer(fixture, fetch);

    await expect(materializer.materialize(REQUEST_ID)).rejects.toThrow();
    expect(ownedEntries(fixture.stagingRoot)).toEqual([]);
  });

  it("fails closed on streamed size and archive digest drift", async () => {
    const fixture = await makeFixture();
    const tooLong = Buffer.concat([fixture.archive, Buffer.from("extra")]);
    const sizeFetch = vi.fn<PaddleOcrBundleFetch>(async () => response(200, tooLong));
    await expect(createMaterializer(fixture, sizeFetch).materialize(REQUEST_ID)).rejects.toThrow();
    expect(ownedEntries(fixture.stagingRoot)).toEqual([]);

    const changed = Buffer.from(fixture.archive);
    changed[20] = changed[20]! ^ 1;
    const digestFixture = resignFixture(fixture, { archive: changed, sha256: fixture.bundle.sha256 });
    const digestFetch = vi.fn<PaddleOcrBundleFetch>(async () => response(200, changed));
    await expect(createMaterializer(digestFixture, digestFetch).materialize(REQUEST_ID)).rejects.toThrow();
    expect(ownedEntries(fixture.stagingRoot)).toEqual([]);
  });

  it.each([
    ["absolute", "aa/evil.txt", "/a/evil.txt"],
    ["traversal", "aa/evil.txt", "../evil.txt"],
    ["backslash", "aa/evil.txt", "aa\\evil.txt"]
  ])("rejects a ZIP %s path before extraction", async (_label, safeName, unsafeName) => {
    const fixture = await makeFixture();
    const archive = replaceZipEntryName(
      await zipEntries([{ name: safeName, body: Buffer.from("unsafe") }]),
      safeName,
      unsafeName
    );
    const invalid = resignFixture(fixture, { archive, installedSizeBytes: 6 });

    await expect(createMaterializer(invalid, bodyFetch(archive)).materialize(REQUEST_ID)).rejects.toThrow();
    expect(ownedEntries(fixture.stagingRoot)).toEqual([]);
  });

  it("rejects ZIP links, duplicate names, case collisions, and file-directory collisions", async () => {
    const fixture = await makeFixture();
    const archives = [
      await zipEntries([{ name: "linked", body: Buffer.from("target"), mode: 0o120777 }]),
      await zipEntries([{ name: "same", body: Buffer.from("a") }, { name: "same", body: Buffer.from("b") }]),
      await zipEntries([{ name: "Case", body: Buffer.from("a") }, { name: "case", body: Buffer.from("b") }]),
      await zipEntries([{ name: "node", body: Buffer.from("a") }, { name: "node/child", body: Buffer.from("b") }])
    ];

    const expectedCodes = [
      "archive_link_or_special_rejected",
      "archive_duplicate_or_collision",
      "archive_duplicate_or_collision",
      "archive_duplicate_or_collision"
    ];
    for (const [index, archive] of archives.entries()) {
      const invalid = resignFixture(fixture, { archive, installedSizeBytes: index === 1 ? 2 : 7 });
      await expect(createMaterializer(invalid, bodyFetch(archive)).materialize(`${REQUEST_ID}_${index}`))
        .rejects.toMatchObject({ name: `PaddleOcrBundleError:${expectedCodes[index]}` });
    }
    expect(ownedEntries(fixture.stagingRoot)).toEqual([]);
  });

  it("rejects Unix link extension metadata instead of interpreting a hardlink target", async () => {
    const fixture = await makeFixture();
    const ordinary = await zipEntries([{ name: "linked", body: Buffer.from("target") }]);
    const archive = addZipExtraField(ordinary, 0x756e);
    const invalid = resignFixture(fixture, { archive, installedSizeBytes: 6 });

    await expect(createMaterializer(invalid, bodyFetch(archive)).materialize(REQUEST_ID))
      .rejects.toMatchObject({ name: "PaddleOcrBundleError:archive_link_or_special_rejected" });
    expect(ownedEntries(fixture.stagingRoot)).toEqual([]);
  });

  it("rejects excess entries and expanded bytes before package validation", async () => {
    const fixture = await makeFixture();
    const excessEntries = Array.from({ length: LIMITS.maxFiles + 2 }, (_, index) => ({
      name: `entries/${String(index).padStart(4, "0")}`,
      body: Buffer.alloc(0)
    }));
    const entryArchive = await zipEntries(excessEntries);
    const entryFixture = resignFixture(fixture, { archive: entryArchive, installedSizeBytes: 1 });
    await expect(createMaterializer(entryFixture, bodyFetch(entryArchive)).materialize(REQUEST_ID))
      .rejects.toMatchObject({ name: "PaddleOcrBundleError:archive_entry_limit_exceeded" });

    const expandedArchive = await zipEntries([{ name: "large", body: Buffer.alloc(128) }]);
    const expandedFixture = resignFixture(fixture, { archive: expandedArchive, installedSizeBytes: 1 });
    await expect(createMaterializer(expandedFixture, bodyFetch(expandedArchive)).materialize(`${REQUEST_ID}_expanded`))
      .rejects.toThrow();
    expect(ownedEntries(fixture.stagingRoot)).toEqual([]);
  });

  it("rejects manifest, installed tree, wrapper, SBOM, and installed-size drift", async () => {
    const fixture = await makeFixture();
    const variants: ReviewedPaddleOcrAvailableBundle[] = [
      { ...fixture.bundle, installedTreeSha256: sha256(Buffer.from("wrong tree")) },
      { ...fixture.bundle, wrapperSha256: sha256(Buffer.from("wrong wrapper")) },
      { ...fixture.bundle, sbomSha256: sha256(Buffer.from("wrong sbom")) },
      { ...fixture.bundle, installedSizeBytes: fixture.bundle.installedSizeBytes + 1 }
    ].map((bundle) => signedBundle(bundle, fixture.privateKey));

    for (const [index, bundle] of variants.entries()) {
      await expect(createMaterializer({ ...fixture, bundle }, bodyFetch(fixture.archive))
        .materialize(`${REQUEST_ID}_drift_${index}`)).rejects.toThrow();
    }
    expect(ownedEntries(fixture.stagingRoot)).toEqual([]);
  });

  it("reaps only owned crash staging and leaves unrelated private files untouched", async () => {
    const fixture = await makeFixture();
    const stale = path.join(fixture.stagingRoot, "paddleocr-bundle-crashed-request");
    const unrelated = path.join(fixture.stagingRoot, "keep.txt");
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, "bundle.zip"), "partial");
    fs.writeFileSync(unrelated, "keep");
    const materializer = createMaterializer(fixture, bodyFetch(fixture.archive));

    materializer.reap();

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.readFileSync(unrelated, "utf8")).toBe("keep");
  });
});

async function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-paddle-bundle-"));
  roots.push(root);
  const packagePath = path.join(root, "package");
  const wrapper = Buffer.from("print('strict wrapper')\n");
  const sbom = Buffer.from('{"spdxVersion":"SPDX-2.3"}\n');
  const fixture = createFakeLocalToolFixture(packagePath, {
    toolId: "paddleocr_local",
    version: ENGINE_VERSION,
    platform: "macos",
    architecture: "arm64",
    capabilities: ["ocr.image"],
    packageLimits: LIMITS,
    files: {
      "pige/paddle_ocr_wrapper.py": wrapper,
      "sbom/paddleocr.spdx.json": sbom,
      "models/det/model.pdmodel": "deterministic model"
    }
  });
  const archive = await zipPackage(packagePath);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const stagingRoot = path.join(root, "staging");
  const unsigned: ReviewedPaddleOcrAvailableBundle = {
    platform: "macos-arm64",
    state: "available",
    artifactUrl: INITIAL_URL,
    sizeBytes: archive.length,
    sha256: sha256(archive),
    signature: {
      algorithm: "Ed25519",
      keyId: "pige-release-test-key",
      valueBase64: Buffer.alloc(64).toString("base64")
    },
    sbomSha256: sha256(sbom),
    installedTreeSha256: fixture.packageSha256,
    installedSizeBytes: fixture.sizeBytes,
    wrapperSha256: sha256(wrapper),
    packageLimits: LIMITS
  };
  return {
    root,
    stagingRoot,
    archive,
    packageSha256: fixture.packageSha256,
    publicKey,
    privateKey,
    bundle: signedBundle(unsigned, privateKey)
  };
}

function createMaterializer(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  fetch: PaddleOcrBundleFetch
): PaddleOcrBundleMaterializer {
  return new PaddleOcrBundleMaterializer({
    bundle: fixture.bundle,
    engineVersion: ENGINE_VERSION,
    stagingRoot: fixture.stagingRoot,
    redirectOrigins: ORIGINS,
    publicKeys: new Map([["pige-release-test-key", fixture.publicKey]]),
    fetch,
    fs
  });
}

function signedBundle(bundle: ReviewedPaddleOcrAvailableBundle, privateKey: KeyObject): ReviewedPaddleOcrAvailableBundle {
  const valueBase64 = sign(
    null,
    Buffer.from(canonicalPaddleOcrArtifactIdentity(bundle, ENGINE_VERSION), "utf8"),
    privateKey
  ).toString("base64");
  return { ...bundle, signature: { ...bundle.signature, valueBase64 } };
}

function resignFixture(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  change: { readonly archive: Buffer; readonly sha256?: string; readonly installedSizeBytes?: number }
) {
  const bundle = signedBundle({
    ...fixture.bundle,
    sizeBytes: change.archive.length,
    sha256: change.sha256 ?? sha256(change.archive),
    ...(change.installedSizeBytes === undefined ? {} : { installedSizeBytes: change.installedSizeBytes })
  }, fixture.privateKey);
  return { ...fixture, archive: change.archive, bundle };
}

function redirectingFetch(body: Buffer) {
  return vi.fn<PaddleOcrBundleFetch>(async (url) => url === INITIAL_URL
    ? response(302, Buffer.alloc(0), { location: REDIRECT_URL }, INITIAL_URL)
    : response(200, body, { "content-length": String(body.length) }, REDIRECT_URL));
}

function bodyFetch(body: Buffer) {
  return vi.fn<PaddleOcrBundleFetch>(async () =>
    response(200, body, { "content-length": String(body.length) }, INITIAL_URL));
}

function response(
  status: number,
  body: Buffer,
  headers: Readonly<Record<string, string>> = {},
  url = INITIAL_URL
) {
  const values = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    url,
    headers: { get: (name: string) => values.get(name.toLowerCase()) ?? null },
    body: (async function* () {
      const midpoint = Math.floor(body.length / 2);
      if (midpoint > 0) yield body.subarray(0, midpoint);
      yield body.subarray(midpoint);
    })()
  };
}

async function zipPackage(root: string): Promise<Buffer> {
  const entries: { name: string; body: Buffer }[] = [];
  const visit = (directory: string, relative = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, entryRelative);
      else entries.push({ name: entryRelative, body: fs.readFileSync(absolute) });
    }
  };
  visit(root);
  return await zipEntries(entries);
}

async function zipEntries(entries: readonly { name: string; body: Buffer; mode?: number }[]): Promise<Buffer> {
  const zip = new ZipFile();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<void>((resolve, reject) => {
    output.once("end", resolve);
    output.once("error", reject);
    zip.outputStream.once("error", reject);
  });
  zip.outputStream.pipe(output);
  for (const entry of entries) zip.addBuffer(entry.body, entry.name, entry.mode ? { mode: entry.mode } : undefined);
  zip.end();
  await completed;
  return Buffer.concat(chunks);
}

function replaceZipEntryName(archive: Buffer, from: string, to: string): Buffer {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) throw new Error("ZIP test names must have equal byte length.");
  const result = Buffer.from(archive);
  const fromBytes = Buffer.from(from);
  const toBytes = Buffer.from(to);
  let replaced = 0;
  for (let offset = result.indexOf(fromBytes); offset >= 0; offset = result.indexOf(fromBytes, offset + toBytes.length)) {
    toBytes.copy(result, offset);
    replaced += 1;
  }
  if (replaced < 2) throw new Error("ZIP entry name was not present in local and central headers.");
  return result;
}

function addZipExtraField(archive: Buffer, id: number): Buffer {
  const field = Buffer.alloc(4);
  field.writeUInt16LE(id, 0);
  const localNameLength = archive.readUInt16LE(26);
  const localExtraLength = archive.readUInt16LE(28);
  const localInsert = 30 + localNameLength + localExtraLength;
  let result = Buffer.concat([archive.subarray(0, localInsert), field, archive.subarray(localInsert)]);
  result.writeUInt16LE(localExtraLength + field.length, 28);

  const central = result.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const centralNameLength = result.readUInt16LE(central + 28);
  const centralExtraLength = result.readUInt16LE(central + 30);
  const centralInsert = central + 46 + centralNameLength + centralExtraLength;
  result = Buffer.concat([result.subarray(0, centralInsert), field, result.subarray(centralInsert)]);
  result.writeUInt16LE(centralExtraLength + field.length, central + 30);

  const end = result.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  result.writeUInt32LE(result.readUInt32LE(end + 12) + field.length, end + 12);
  result.writeUInt32LE(result.readUInt32LE(end + 16) + field.length, end + 16);
  return result;
}

function sha256(value: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function ownedEntries(stagingRoot: string): readonly string[] {
  if (!fs.existsSync(stagingRoot)) return [];
  return fs.readdirSync(stagingRoot).filter((entry) => entry.startsWith("paddleocr-bundle-"));
}
