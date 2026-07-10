import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SourceRecord } from "@pige/schemas";
import { EvidenceAssemblyService } from "../../apps/desktop/src/main/services/evidence-assembly-service";

const roots: string[] = [];
const timestamp = "2026-07-10T05:00:00.000Z";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("evidence assembly service", () => {
  it("assembles native and OCR evidence in deterministic order with their matching sidecars", async () => {
    const vaultPath = makeVault();
    const sourceId = "src_20260710_abcdef123456";
    const nativeText = "--- Page 1 ---\nNative page one.\n\n--- Page 2 ---\nNative page two.";
    const ocrBody = "A diagram adds supplemental evidence.";
    const ocrText = `--- Page 2 ---\n${ocrBody}`;
    const nativeArtifact = artifact("art_native_text", "extracted_text", "artifacts/native.txt", nativeText);
    const ocrArtifact = artifact("art_ocr_text", "ocr", "artifacts/ocr.txt", ocrText);
    const nativeSidecarText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_native_metadata",
      sourceId,
      kind: "pdf_parse_metadata",
      extractedTextChecksum: nativeArtifact.checksum,
      pages: [{ locator: "page:1" }, { locator: "page:2" }]
    });
    const ocrStart = "--- Page 2 ---\n".length;
    const ocrSidecarText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_ocr_metadata",
      sourceId,
      kind: "pdf_page_ocr_metadata",
      ocrTextChecksum: ocrArtifact.checksum,
      units: [{
        locator: "page:2/ocr:block:1",
        parentLocator: "page:2",
        characterStart: ocrStart,
        characterEnd: ocrStart + ocrBody.length,
        confidence: 0.93
      }]
    });
    const nativeMetadata = artifact("art_native_metadata", "metadata", "artifacts/native.json", nativeSidecarText);
    const ocrMetadata = artifact("art_ocr_metadata", "metadata", "artifacts/ocr.json", ocrSidecarText);
    write(vaultPath, nativeArtifact.path, nativeText);
    write(vaultPath, ocrArtifact.path, ocrText);
    write(vaultPath, nativeMetadata.path, nativeSidecarText);
    write(vaultPath, ocrMetadata.path, ocrSidecarText);
    const source = makeSource(sourceId, "pdf_file", [ocrMetadata, ocrArtifact, nativeMetadata, nativeArtifact]);

    const pack = await new EvidenceAssemblyService().assemble(vaultPath, source);

    expect(pack.artifactIds).toEqual(["art_native_text", "art_ocr_text"]);
    expect(pack.fragments.map((fragment) => fragment.ref)).toEqual(["ev_01", "ev_02", "ev_03"]);
    expect(pack.fragments.map((fragment) => fragment.locator)).toEqual([
      "page:1",
      "page:2",
      "page:2/ocr:block:1"
    ]);
    expect(pack.fragments.map((fragment) => fragment.citationLocator)).toEqual(["p1", "p2", "p2-ocr1"]);
    expect(pack.fragments[2]?.text).toBe(ocrBody);
    expect(pack.warnings).toEqual([]);
  });

  it("deduplicates OCR text only when it repeats native text under the same parent locator", async () => {
    const vaultPath = makeVault();
    const sourceId = "src_20260710_bcdefa234567";
    const repeated = "The same visible sentence.";
    const nativeText = `--- Page 2 ---\n${repeated}`;
    const nativeArtifact = artifact("art_repeat_native", "extracted_text", "artifacts/repeat-native.txt", nativeText);
    const ocrArtifact = artifact("art_repeat_ocr", "ocr", "artifacts/repeat-ocr.txt", nativeText);
    const nativeSidecarText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_repeat_native_metadata",
      sourceId,
      kind: "pdf_parse_metadata",
      extractedTextChecksum: nativeArtifact.checksum,
      pages: [{ locator: "page:2" }]
    });
    const start = "--- Page 2 ---\n".length;
    const ocrSidecarText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_repeat_ocr_metadata",
      sourceId,
      kind: "pdf_page_ocr_metadata",
      ocrTextChecksum: ocrArtifact.checksum,
      units: [{
        locator: "page:2/ocr:block:1",
        parentLocator: "page:2",
        characterStart: start,
        characterEnd: start + repeated.length
      }]
    });
    const nativeMetadata = artifact("art_repeat_native_metadata", "metadata", "artifacts/repeat-native.json", nativeSidecarText);
    const ocrMetadata = artifact("art_repeat_ocr_metadata", "metadata", "artifacts/repeat-ocr.json", ocrSidecarText);
    for (const [target, value] of [
      [nativeArtifact, nativeText],
      [ocrArtifact, nativeText],
      [nativeMetadata, nativeSidecarText],
      [ocrMetadata, ocrSidecarText]
    ] as const) write(vaultPath, target.path, value);

    const pack = await new EvidenceAssemblyService().assemble(
      vaultPath,
      makeSource(sourceId, "pdf_file", [ocrArtifact, ocrMetadata, nativeArtifact, nativeMetadata])
    );

    expect(pack.fragments).toHaveLength(1);
    expect(pack.fragments[0]).toMatchObject({ artifactId: nativeArtifact.id, locator: "page:2", text: repeated });
  });

  it("keeps richer supplemental OCR and reserves mixed-evidence budget for it", async () => {
    const vaultPath = makeVault();
    const sourceId = "src_20260710_bcadfe345678";
    const native = writePairedTextArtifact(vaultPath, sourceId, "budget_native", "extracted_text", "N".repeat(80), [{
      locator: "page:1",
      characterStart: 0,
      characterEnd: 80
    }]);
    const ocrText = "N supplemental OCR detail";
    const ocr = writePairedTextArtifact(vaultPath, sourceId, "budget_ocr", "ocr", ocrText, [{
      locator: "page:1/ocr:block:1",
      parentLocator: "page:1",
      characterStart: 0,
      characterEnd: ocrText.length
    }]);

    const pack = await new EvidenceAssemblyService().assemble(
      vaultPath,
      makeSource(sourceId, "pdf_file", [...native, ...ocr]),
      { maxCharacters: 20, maxFragments: 2 }
    );

    expect(pack.fragments).toHaveLength(2);
    expect(pack.fragments.map((fragment) => fragment.artifactKind)).toEqual(["extracted_text", "ocr"]);
    expect(pack.fragments[1]?.text).toBe("N sup");
    expect(pack.truncated).toBe(true);
  });

  it("retains OCR that is a strict superset of native text under the same parent", async () => {
    const vaultPath = makeVault();
    const sourceId = "src_20260710_bcadfe456789";
    const nativeText = "short fact";
    const ocrText = "short fact with additional visible detail";
    const native = writePairedTextArtifact(vaultPath, sourceId, "superset_native", "extracted_text", nativeText, [{
      locator: "page:1",
      characterStart: 0,
      characterEnd: nativeText.length
    }]);
    const ocr = writePairedTextArtifact(vaultPath, sourceId, "superset_ocr", "ocr", ocrText, [{
      locator: "page:1/ocr:block:1",
      parentLocator: "page:1",
      characterStart: 0,
      characterEnd: ocrText.length
    }]);

    const pack = await new EvidenceAssemblyService().assemble(
      vaultPath,
      makeSource(sourceId, "pdf_file", [...native, ...ocr])
    );

    expect(pack.fragments.map((fragment) => fragment.text)).toEqual([nativeText, ocrText]);
  });

  it("artifact-qualifies canonical locators that would otherwise collide", async () => {
    const vaultPath = makeVault();
    const sourceId = "src_20260710_bcadfe567890";
    const firstText = "First artifact block.";
    const secondText = "Second artifact block.";
    const first = writePairedTextArtifact(vaultPath, sourceId, "collision_first", "extracted_text", firstText, [{
      locator: "block:1", characterStart: 0, characterEnd: firstText.length
    }]);
    const second = writePairedTextArtifact(vaultPath, sourceId, "collision_second", "extracted_text", secondText, [{
      locator: "block:1", characterStart: 0, characterEnd: secondText.length
    }]);

    const pack = await new EvidenceAssemblyService().assemble(
      vaultPath,
      makeSource(sourceId, "docx_file", [...first, ...second])
    );

    expect(pack.fragments).toHaveLength(2);
    expect(new Set(pack.fragments.map((fragment) => fragment.citationLocator)).size).toBe(2);
    expect(pack.fragments.every((fragment) => /^block1-art-[a-f0-9]{8}$/u.test(fragment.citationLocator))).toBe(true);
  });

  it("never borrows locators from a metadata sidecar whose text checksum does not match", async () => {
    const vaultPath = makeVault();
    const sourceId = "src_20260710_cdefab345678";
    const text = "One extracted block.";
    const textArtifact = artifact("art_unpaired_text", "extracted_text", "artifacts/unpaired.txt", text);
    const sidecarText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_unpaired_metadata",
      sourceId,
      kind: "docx_parse_metadata",
      extractedTextChecksum: checksum("different text"),
      units: [{ locator: "block:99", characterStart: 0, characterEnd: text.length }]
    });
    const metadataArtifact = artifact("art_unpaired_metadata", "metadata", "artifacts/unpaired.json", sidecarText);
    write(vaultPath, textArtifact.path, text);
    write(vaultPath, metadataArtifact.path, sidecarText);

    const pack = await new EvidenceAssemblyService().assemble(
      vaultPath,
      makeSource(sourceId, "docx_file", [metadataArtifact, textArtifact])
    );

    expect(pack.fragments).toHaveLength(1);
    expect(pack.fragments[0]?.locator).toBe("artifact_preview");
    expect(pack.fragments[0]?.locator).not.toBe("block:99");
    expect(pack.warnings).toEqual([`evidence_metadata_unpaired:${textArtifact.id}`]);
  });

  it("rejects ambiguous sidecars instead of selecting one by Source Record order", async () => {
    const vaultPath = makeVault();
    const sourceId = "src_20260710_cfdeab456789";
    const text = "One body cannot have two competing locator maps.";
    const textArtifact = artifact("art_ambiguous_text", "extracted_text", "artifacts/ambiguous.txt", text);
    const sidecars = [1, 2].map((index) => {
      const id = `art_ambiguous_metadata_${index}`;
      const value = JSON.stringify({
        schemaVersion: 1,
        artifactId: id,
        sourceId,
        kind: "docx_parse_metadata",
        extractedTextChecksum: textArtifact.checksum,
        units: [{ locator: `block:${index}`, characterStart: 0, characterEnd: text.length }]
      });
      return { artifact: artifact(id, "metadata", `artifacts/ambiguous-${index}.json`, value), value };
    });
    write(vaultPath, textArtifact.path, text);
    for (const sidecar of sidecars) write(vaultPath, sidecar.artifact.path, sidecar.value);

    await expect(new EvidenceAssemblyService().assemble(
      vaultPath,
      makeSource(sourceId, "docx_file", [textArtifact, ...sidecars.map((sidecar) => sidecar.artifact)])
    )).rejects.toMatchObject({ code: "agent_ingest.ambiguous_evidence_metadata" });
  });

  it("rejects a changed metadata sidecar before it can supply evidence locators", async () => {
    const vaultPath = makeVault();
    const sourceId = "src_20260710_defabc456789";
    const text = "Verified extracted evidence.";
    const textArtifact = artifact("art_tamper_text", "extracted_text", "artifacts/tamper.txt", text);
    const sidecarText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_tamper_metadata",
      sourceId,
      kind: "docx_parse_metadata",
      extractedTextChecksum: textArtifact.checksum,
      units: [{ locator: "block:1", characterStart: 0, characterEnd: text.length }]
    });
    const metadataArtifact = artifact("art_tamper_metadata", "metadata", "artifacts/tamper.json", sidecarText);
    write(vaultPath, textArtifact.path, text);
    write(vaultPath, metadataArtifact.path, `${sidecarText} `);

    await expect(new EvidenceAssemblyService().assemble(
      vaultPath,
      makeSource(sourceId, "docx_file", [textArtifact, metadataArtifact])
    )).rejects.toMatchObject({ code: "agent_ingest.source_integrity_failed" });
  });

  it("reads a verified reference_original text source and preserves the context budget", async () => {
    const vaultPath = makeVault();
    const originalPath = path.join(path.dirname(vaultPath), "original.md");
    const text = "1234567890";
    fs.writeFileSync(originalPath, text, "utf8");
    const source: SourceRecord = {
      schemaVersion: 1,
      id: "src_20260710_efabcd567890",
      kind: "markdown_file",
      storageStrategy: "reference_original",
      original: {
        uri: `file://${originalPath}`,
        path: originalPath,
        checksum: checksum(text),
        lastKnownSize: Buffer.byteLength(text)
      },
      artifacts: [],
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const pack = await new EvidenceAssemblyService().assemble(vaultPath, source, { maxCharacters: 5 });

    expect(pack.fragments).toHaveLength(1);
    expect(pack.fragments[0]).toMatchObject({
      artifactId: `source:${source.id}`,
      locator: "referenced_original_preview",
      citationLocator: "original",
      text: "12345"
    });
    expect(pack.truncated).toBe(true);
  });

  it("drops an incomplete UTF-8 tail instead of emitting a replacement character", async () => {
    const vaultPath = makeVault();
    const originalPath = path.join(path.dirname(vaultPath), "unicode.md");
    const text = "A你B";
    fs.writeFileSync(originalPath, text, "utf8");
    const source: SourceRecord = {
      schemaVersion: 1,
      id: "src_20260710_fabcde678901",
      kind: "markdown_file",
      storageStrategy: "reference_original",
      original: {
        uri: `file://${originalPath}`,
        path: originalPath,
        checksum: checksum(text),
        lastKnownSize: Buffer.byteLength(text)
      },
      artifacts: [],
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const pack = await new EvidenceAssemblyService().assemble(vaultPath, source, { maxReadBytesPerFile: 2 });

    expect(pack.fragments[0]?.text).toBe("A");
    expect(pack.fragments[0]?.text).not.toContain("�");
    expect(pack.truncated).toBe(true);
  });

  it.skipIf(process.platform === "win32")("rejects an artifact whose real path escapes through a symlinked parent", async () => {
    const vaultPath = makeVault();
    const outside = path.join(path.dirname(vaultPath), "outside");
    fs.mkdirSync(outside, { recursive: true });
    const text = "outside evidence";
    fs.writeFileSync(path.join(outside, "body.txt"), text, "utf8");
    fs.mkdirSync(path.join(vaultPath, "artifacts"), { recursive: true });
    fs.symlinkSync(outside, path.join(vaultPath, "artifacts", "linked"), "dir");
    const escapedArtifact = artifact("art_symlink_escape", "extracted_text", "artifacts/linked/body.txt", text);

    await expect(new EvidenceAssemblyService().assemble(
      vaultPath,
      makeSource("src_20260710_abcdef789012", "docx_file", [escapedArtifact])
    )).rejects.toMatchObject({ code: "source.path_outside_vault" });
  });
});

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-evidence-test-"));
  roots.push(root);
  const vaultPath = path.join(root, "vault");
  fs.mkdirSync(vaultPath, { recursive: true });
  return vaultPath;
}

function makeSource(
  id: string,
  kind: SourceRecord["kind"],
  artifacts: SourceRecord["artifacts"]
): SourceRecord {
  return {
    schemaVersion: 1,
    id,
    kind,
    storageStrategy: "copy_to_source_library",
    managedCopy: {
      path: "sources/test/source.bin",
      checksum: checksum(""),
      size: 0
    },
    artifacts,
    metadata: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function artifact(
  id: string,
  kind: SourceRecord["artifacts"][number]["kind"],
  artifactPath: string,
  value: string
): SourceRecord["artifacts"][number] {
  return { id, kind, path: artifactPath, checksum: checksum(value), size: Buffer.byteLength(value) };
}

function writePairedTextArtifact(
  vaultPath: string,
  sourceId: string,
  prefix: string,
  kind: "extracted_text" | "ocr",
  text: string,
  units: readonly Record<string, unknown>[]
): SourceRecord["artifacts"] {
  const textArtifact = artifact(`art_${prefix}_text`, kind, `artifacts/${prefix}.txt`, text);
  const metadataId = `art_${prefix}_metadata`;
  const sidecar = JSON.stringify({
    schemaVersion: 1,
    artifactId: metadataId,
    sourceId,
    kind: kind === "ocr" ? "pdf_page_ocr_metadata" : "docx_parse_metadata",
    ...(kind === "ocr"
      ? { ocrTextChecksum: textArtifact.checksum }
      : { extractedTextChecksum: textArtifact.checksum }),
    units
  });
  const metadataArtifact = artifact(metadataId, "metadata", `artifacts/${prefix}.json`, sidecar);
  write(vaultPath, textArtifact.path, text);
  write(vaultPath, metadataArtifact.path, sidecar);
  return [textArtifact, metadataArtifact];
}

function write(vaultPath: string, relativePath: string, value: string): void {
  const filePath = path.join(vaultPath, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function checksum(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
