import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PACKAGED_MEMORY_EVIDENCE_ARGUMENT,
  PACKAGED_RUNTIME_SMOKE_ARGUMENT,
  resolvePackagedEvidenceMode
} from "../../apps/desktop/src/main/services/packaged-evidence-mode";
import {
  createTemporaryEvidenceVaultOnDisk,
  createVaultOnDisk
} from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("packaged evidence filesystem boundaries", () => {
  it("creates an evidence-only vault beneath the canonical system temporary root", () => {
    const root = makeRoot();
    const evidenceRoot = path.join(root, "evidence");
    fs.mkdirSync(evidenceRoot);

    const vault = createTemporaryEvidenceVaultOnDisk({
      evidenceRoot,
      tempPath: root,
      vaultName: "EvidenceVault",
      locale: "en",
      now: new Date("2026-07-15T00:00:00.000Z")
    });

    expect(vault.name).toBe("EvidenceVault");
    expect(fs.existsSync(path.join(evidenceRoot, "EvidenceVault", ".pige", "manifest.json"))).toBe(true);
    expect(() => createVaultOnDisk({
      parentDirectory: evidenceRoot,
      vaultName: "OrdinaryVault",
      appDataPath: path.join(root, "app-data"),
      tempPath: root
    })).toThrow("temporary folders");
  });

  it("rejects evidence vault roots outside the temporary root or through a symlink", () => {
    const tempRoot = makeRoot();
    const outside = makeRoot();
    expect(() => createTemporaryEvidenceVaultOnDisk({
      evidenceRoot: outside,
      tempPath: tempRoot,
      vaultName: "EvidenceVault"
    })).toThrow("beneath the system temporary root");

    if (process.platform !== "win32") {
      const real = path.join(tempRoot, "real");
      const alias = path.join(tempRoot, "alias");
      fs.mkdirSync(real);
      fs.symlinkSync(real, alias, "dir");
      expect(() => createTemporaryEvidenceVaultOnDisk({
        evidenceRoot: alias,
        tempPath: tempRoot,
        vaultName: "EvidenceVault"
      })).toThrow();

      const safeRoot = path.join(tempRoot, "safe");
      const successorTarget = path.join(outside, "successor");
      fs.mkdirSync(safeRoot);
      fs.mkdirSync(successorTarget);
      fs.symlinkSync(successorTarget, path.join(safeRoot, "EvidenceVault"), "dir");
      expect(() => createTemporaryEvidenceVaultOnDisk({
        evidenceRoot: safeRoot,
        tempPath: tempRoot,
        vaultName: "EvidenceVault"
      })).toThrow("symbolic link");

      fs.rmSync(path.join(safeRoot, "EvidenceVault"));
      fs.symlinkSync(path.join(outside, "missing-successor"), path.join(safeRoot, "EvidenceVault"), "dir");
      expect(() => createTemporaryEvidenceVaultOnDisk({
        evidenceRoot: safeRoot,
        tempPath: tempRoot,
        vaultName: "EvidenceVault"
      })).toThrow("symbolic link");
    }
  });

  it("distinguishes absent evidence mode from malformed, duplicate, and overlapping modes", () => {
    const root = makeRoot();
    const reportRoot = path.join(root, "reports");
    fs.mkdirSync(reportRoot);
    const report = path.join(reportRoot, "memory.json");
    expect(resolvePackagedEvidenceMode({ argv: [], isPackaged: true, tempPath: root }))
      .toEqual({ kind: "none" });
    expect(resolvePackagedEvidenceMode({
      argv: [`${PACKAGED_MEMORY_EVIDENCE_ARGUMENT}${report}`],
      isPackaged: true,
      tempPath: root
    })).toEqual({ kind: "memory", reportPath: report });

    for (const argv of [
      [`${PACKAGED_MEMORY_EVIDENCE_ARGUMENT}relative.json`],
      [PACKAGED_MEMORY_EVIDENCE_ARGUMENT.slice(0, -1)],
      [`${PACKAGED_MEMORY_EVIDENCE_ARGUMENT.slice(0, -1)}-malformed`],
      [`${PACKAGED_MEMORY_EVIDENCE_ARGUMENT}${report}`, `${PACKAGED_MEMORY_EVIDENCE_ARGUMENT}${report}`],
      [`${PACKAGED_MEMORY_EVIDENCE_ARGUMENT}${report}`, `${PACKAGED_RUNTIME_SMOKE_ARGUMENT}${report}`]
    ]) {
      expect(() => resolvePackagedEvidenceMode({ argv, isPackaged: true, tempPath: root })).toThrow();
    }
    expect(() => resolvePackagedEvidenceMode({
      argv: [`${PACKAGED_MEMORY_EVIDENCE_ARGUMENT}${report}`],
      isPackaged: false,
      tempPath: root
    })).toThrow();
    fs.writeFileSync(report, "successor", "utf8");
    expect(() => resolvePackagedEvidenceMode({
      argv: [`${PACKAGED_MEMORY_EVIDENCE_ARGUMENT}${report}`],
      isPackaged: true,
      tempPath: root
    })).toThrow("already exists");
  });
});

function makeRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pige-evidence-safety-")));
  roots.push(root);
  return root;
}
