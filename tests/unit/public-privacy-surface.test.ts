import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditPublicPrivacySurface } from "../../scripts/verify/public-privacy-surface.mjs";

describe("public privacy data-flow governance", () => {
  it("matches public privacy copy to current production network owners", () => {
    expect(auditPublicPrivacySurface(process.cwd())).toEqual([]);
  });

  it("fails closed when privacy copy or a network owner drifts", async () => {
    const repository = await mkdtemp(path.join(os.tmpdir(), "pige-privacy-surface-"));
    await cp(path.resolve("PRIVACY.md"), path.join(repository, "PRIVACY.md"));
    await cp(path.resolve("package.json"), path.join(repository, "package.json"));
    await cp(path.resolve("apps"), path.join(repository, "apps"), { recursive: true });
    await cp(path.resolve("packages"), path.join(repository, "packages"), { recursive: true });
    await cp(path.resolve(".github"), path.join(repository, ".github"), { recursive: true });

    const privacyPath = path.join(repository, "PRIVACY.md");
    const privacy = (await readFile(privacyPath, "utf8")).replace("No diagnostics are uploaded automatically", "Diagnostics may upload automatically");
    await writeFile(privacyPath, privacy);
    expect(auditPublicPrivacySurface(repository)).toContain(
      "PRIVACY.md is missing data-flow promise: No diagnostics are uploaded automatically",
    );

    await writeFile(privacyPath, await readFile(path.resolve("PRIVACY.md"), "utf8"));
    const unknownOwner = path.join(repository, "apps/desktop/src/main/services/unknown-network-owner.ts");
    await writeFile(unknownOwner, 'import { fetch } from "undici";\nvoid fetch;\n');
    expect(auditPublicPrivacySurface(repository)).toContain(
      "unreviewed production network owner: apps/desktop/src/main/services/unknown-network-owner.ts",
    );
  }, 15_000);
});
