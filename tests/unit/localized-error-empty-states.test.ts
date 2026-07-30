import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditLocalizedErrorEmptyStates } from "../../scripts/verify/localized-error-empty-states.mjs";

describe("release-critical localized error and empty states", () => {
  it("keeps reviewed states localized, actionable, and body-free", () => {
    expect(auditLocalizedErrorEmptyStates(process.cwd())).toEqual([]);
  });

  it("fails closed on untranslated copy, private placeholders, and detached production states", async () => {
    const repository = await mkdtemp(path.join(os.tmpdir(), "pige-localized-states-"));
    const source = path.resolve("apps/desktop/src/renderer/src");
    const target = path.join(repository, "apps/desktop/src/renderer/src");
    await cp(source, target, { recursive: true });

    const frenchPath = path.join(target, "locales/fr/messages.json");
    const french = JSON.parse(await readFile(frenchPath, "utf8")) as Record<string, string>;
    french["library.empty"] = "No notes or source pages yet.";
    french["home.agentState.failed"] = "Échec {path}";
    await writeFile(frenchPath, `${JSON.stringify(french, null, 2)}\n`);

    const appPath = path.join(target, "App.tsx");
    await writeFile(appPath, (await readFile(appPath, "utf8")).replace('"system.refreshHealth"', '"system.healthTitle"'));

    const failures = auditLocalizedErrorEmptyStates(repository);
    expect(failures).toContain("library: fr reuses English for library.empty");
    expect(failures).toContain("home: fr placeholder drift for home.agentState.failed");
    expect(failures).toContain("home: fr exposes private placeholder in home.agentState.failed");
    expect(failures).toContain("diagnostics: production owner no longer uses system.refreshHealth");
  });
});
