import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { NotesService } from "../../apps/desktop/src/main/services/notes-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const tempRoots: string[] = [];

function makeVault(): { vaultPath: string; vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-notes-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Notes",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Notes");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeNotes(vaultPath: string, vault: VaultSummary): NotesService {
  return new NotesService({
    current: () => vault,
    activeVaultPath: () => vaultPath
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("notes service", () => {
  it("reads and renders a vault Markdown page by stable page ID", async () => {
    const { vaultPath, vault } = makeVault();
    const notes = makeNotes(vaultPath, vault);
    const pagePath = path.join(vaultPath, "wiki", "reader.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, `---
id: "page_20260709_abcd1234"
schema_version: 1
title: "Reader Page"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
language: "en"
source_ids: ["src_20260709_abcd1234"]
---

# Reader Page

[[Topic]]

<script>alert("x")</script>
`, "utf8");

    const document = notes.get({ pageId: "page_20260709_abcd1234" });
    const rendered = await notes.render({ pageId: "page_20260709_abcd1234" });

    expect(document.summary.title).toBe("Reader Page");
    expect(document.summary.pagePath).toBe("wiki/reader.md");
    expect(document.markdownBody).not.toContain("schema_version");
    expect(rendered.html).toContain("<h1>Reader Page</h1>");
    expect(rendered.html).toContain('href="#wiki:Topic"');
    expect(rendered.html).not.toContain("<script");
  });

  it("does not open files outside the Library page roots", () => {
    const { vaultPath, vault } = makeVault();
    const notes = makeNotes(vaultPath, vault);
    fs.writeFileSync(path.join(vaultPath, "outside.md"), `---
id: "page_20260709_outside1234"
schema_version: 1
title: "Outside"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
---

# Outside
`, "utf8");

    expect(() => notes.get({ pageId: "page_20260709_outside1234" })).toThrow(PigeDomainError);
  });

  it("does not return network-capable links or images to the renderer", async () => {
    const { vaultPath, vault } = makeVault();
    const notes = makeNotes(vaultPath, vault);
    const pagePath = path.join(vaultPath, "wiki", "remote-content.md");
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, `---
id: "page_20260709_remote1234"
schema_version: 1
title: "Remote Content"
type: "note"
created_at: "2026-07-09T12:00:00.000Z"
updated_at: "2026-07-09T12:00:00.000Z"
status: "active"
---

[External](https://example.com/private)
![Remote](//example.com/tracker.png)
[[Safe Wiki]]
`, "utf8");

    const rendered = await notes.render({ pageId: "page_20260709_remote1234" });

    expect(rendered.html).not.toContain('href="https:');
    expect(rendered.html).not.toContain('src="//');
    expect(rendered.html).toContain('href="#wiki:Safe%20Wiki"');
  });
});
