import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { LibraryService } from "../../apps/desktop/src/main/services/library-service";
import { LocalDatabaseService } from "../../apps/desktop/src/main/services/local-database-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";

const tempRoots: string[] = [];

function makeVault(): { vaultPath: string; vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-library-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Library",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Library");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeServices(vaultPath: string, vault: VaultSummary): {
  capture: LegacyCaptureFixture;
  jobs: JobsService;
  library: LibraryService;
} {
  const vaultPort = {
    current: () => vault,
    activeVaultPath: () => vaultPath
  };
  return {
    capture: new LegacyCaptureFixture(vaultPort, vaultPath),
    jobs: new JobsService(vaultPort),
    library: new LibraryService(vaultPort)
  };
}

function makeIndexedLibrary(vaultPath: string, vault: VaultSummary): LibraryService {
  return new LibraryService(
    {
      current: () => vault,
      activeVaultPath: () => vaultPath
    },
    new LocalDatabaseService()
  );
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("library service", () => {
  it("lists source pages from Markdown frontmatter without model or database work", () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs, library } = makeServices(vaultPath, vault);
    const captureResult = capture.submitText({
      text: "Library Source\n\nCaptured as a source page.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });

    const result = library.list({ pageTypes: ["source"] });

    expect(result.activeVaultId).toBe(vault.vaultId);
    expect(result.invalidPageCount).toBe(0);
    expect(result.total).toBe(1);
    expect(result.pages[0]).toMatchObject({
      title: "Library Source",
      pageType: "source",
      status: "active",
      language: "en",
      sourceIds: [captureResult.sourceId]
    });
    expect(result.pages[0]?.pagePath).toMatch(/^sources\/text\/\d{4}\/src_/u);
  });

  it("skips invalid Markdown frontmatter without failing the whole list", () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs, library } = makeServices(vaultPath, vault);
    const captureResult = capture.submitText({
      text: "Valid Page\n\nStill visible.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });
    const invalidPath = path.join(vaultPath, "sources", "text", "2026", "broken.md");
    fs.mkdirSync(path.dirname(invalidPath), { recursive: true });
    fs.writeFileSync(invalidPath, "---\nid: \"broken\"\ntitle: \"Broken\"\n---\n\n# Broken\n", "utf8");

    const result = library.list();

    expect(result.invalidPageCount).toBe(1);
    expect(result.pages.map((page) => page.title)).toEqual(["Valid Page"]);
  });

  it("does not return original absolute paths, managed copy paths, or source page bodies", async () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs, library } = makeServices(vaultPath, vault);
    const sourcePath = path.join(path.dirname(vaultPath), "outside-secret-path.md");
    fs.writeFileSync(sourcePath, "# File Source\n\nBody should stay in Markdown, not the list DTO.", "utf8");
    const captureResult = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: captureResult.jobIds });

    const resultJson = JSON.stringify(library.list());

    expect(resultJson).toContain("outside-secret-path");
    expect(resultJson).not.toContain(sourcePath);
    expect(resultJson).not.toContain("outside-secret-path.md");
    expect(resultJson).not.toContain("raw/files");
    expect(resultJson).not.toContain("Body should stay in Markdown");
  });

  it("lists pages through the local database index when available", () => {
    const { vaultPath, vault } = makeVault();
    const library = makeIndexedLibrary(vaultPath, vault);
    const pagePath = path.join(vaultPath, "wiki", "indexed.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, `---
id: "page_20260709_indexed1"
schema_version: 1
title: "Indexed Library"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
language: "en"
source_ids: []
---

# Indexed Library
`, "utf8");

    const result = library.list({ pageTypes: ["note"] });

    expect(result.total).toBe(1);
    expect(result.pages[0]?.title).toBe("Indexed Library");
    expect(fs.existsSync(path.join(vaultPath, ".pige/db/vault.sqlite"))).toBe(true);
  });

  it("returns related pages through the local database without exposing note bodies", () => {
    const { vaultPath, vault } = makeVault();
    const library = makeIndexedLibrary(vaultPath, vault);
    writeLibraryPage(vaultPath, "wiki/topic.md", {
      id: "page_20260709_topic1",
      title: "Topic",
      body: "Sensitive body detail should stay inside Markdown."
    });
    writeLibraryPage(vaultPath, "wiki/source.md", {
      id: "page_20260709_source1",
      title: "Source",
      body: "This note links to [[Topic]]."
    });

    const result = library.related({ pageId: "page_20260709_source1" });

    expect(result.degraded).toBe(false);
    expect(result.totalOutgoing).toBe(1);
    expect(result.outgoing[0]?.summary.title).toBe("Topic");
    expect(result.outgoing[0]?.target).toBe("Topic");
    expect(JSON.stringify(result)).not.toContain("Sensitive body detail");
  });

  it("degrades related-page lookup when the local graph index is unavailable", () => {
    const { vaultPath, vault } = makeVault();
    const { library } = makeServices(vaultPath, vault);

    const result = library.related({ pageId: "page_20260709_missing1" });

    expect(result).toMatchObject({
      activeVaultId: vault.vaultId,
      pageId: "page_20260709_missing1",
      totalOutgoing: 0,
      totalBacklinks: 0,
      invalidPageCount: 0,
      outgoing: [],
      backlinks: [],
      degraded: true,
      degradedReason: "local_database_not_ready"
    });
  });

  it("serves a body-free Knowledge Tree rebuilt from durable Markdown", () => {
    const { vaultPath, vault } = makeVault();
    const library = makeIndexedLibrary(vaultPath, vault);
    writeLibraryPage(vaultPath, "wiki/topics/local-first.md", {
      id: "page_20260713_domain01",
      title: "Local-first",
      type: "topic",
      body: "PRIVATE_DOMAIN_BODY"
    });
    writeLibraryPage(vaultPath, "wiki/concepts/retrieval.md", {
      id: "page_20260713_concept1",
      title: "Retrieval",
      type: "concept",
      topics: ["Local-first"],
      sourceIds: ["src_20260713_retrieval1"],
      body: "PRIVATE_CONCEPT_BODY"
    });
    writeLibraryPage(vaultPath, "wiki/notes/ranking.md", {
      id: "page_20260713_note0001",
      title: "Ranking notes",
      topics: ["Local-first"],
      sourceIds: ["src_20260713_ranking01"],
      body: "PRIVATE_NOTE_BODY"
    });

    const result = library.tree();

    expect(result).toMatchObject({
      activeVaultId: vault.vaultId,
      schemaVersion: 1,
      state: "ready",
      degraded: false,
      totals: {
        pageCount: 3,
        topicCount: 1,
        conceptCount: 1,
        fragmentPageCount: 1,
        sourceCount: 2
      }
    });
    expect(result.roots[0]).toMatchObject({
      title: "Local-first",
      kind: "domain",
      navigation: { pageId: "page_20260713_domain01", pagePath: "wiki/topics/local-first.md" }
    });
    expect(result.roots[0]?.children[0]?.title).toBe("Retrieval");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    expect(JSON.stringify(result)).not.toContain(vaultPath);
  });

  it("returns a typed empty degraded Knowledge Tree when the local index is unavailable", () => {
    const { vaultPath, vault } = makeVault();
    const { library } = makeServices(vaultPath, vault);

    expect(library.tree()).toMatchObject({
      activeVaultId: vault.vaultId,
      schemaVersion: 1,
      state: "empty",
      degraded: true,
      degradedReason: "local_database_not_ready",
      invalidPageCount: 0,
      roots: []
    });
  });
});

function writeLibraryPage(vaultPath: string, relativePath: string, input: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly type?: string;
  readonly topics?: readonly string[];
  readonly sourceIds?: readonly string[];
}): void {
  const filePath = path.join(vaultPath, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
id: "${input.id}"
schema_version: 1
title: ${JSON.stringify(input.title)}
type: ${JSON.stringify(input.type ?? "note")}
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
language: "en"
topics: ${JSON.stringify(input.topics ?? [])}
source_ids: ${JSON.stringify(input.sourceIds ?? [])}
---

# ${input.title}

${input.body}
`, "utf8");
}
