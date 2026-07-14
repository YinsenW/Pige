import { describe, expect, it } from "vitest";
import { RestorePreviewRegistry } from "../../apps/desktop/src/main/services/restore-preview-registry";

describe("restore preview registry", () => {
  it("isolates opaque preview tokens by sender and rejects cross-window replay", () => {
    const registry = new RestorePreviewRegistry();
    const first = registry.complete(11, registry.begin(11), previewInput("1"));
    const second = registry.complete(22, registry.begin(22), previewInput("1"));

    expect(first.previewId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(second.previewId).not.toBe(first.previewId);
    expect(() => registry.claim(22, {
      previewId: first.previewId,
      mode: "clone_as_new"
    })).toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));
    expect(registry.claim(11, {
      previewId: first.previewId,
      mode: "clone_as_new"
    })).toMatchObject({ readyIdentity: first, mode: "clone_as_new" });
  });

  it("rejects an out-of-order completion and preserves the newer generation", () => {
    const registry = new RestorePreviewRegistry();
    const olderGeneration = registry.begin(7);
    const newerGeneration = registry.begin(7);

    expect(() => registry.complete(7, olderGeneration, previewInput("2", "/synthetic/older.zip")))
      .toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));

    const newer = registry.complete(7, newerGeneration, previewInput("3", "/synthetic/newer.zip"));
    expect(registry.claim(7, {
      previewId: newer.previewId,
      mode: "replace_existing"
    })).toMatchObject({ readyIdentity: newer });
  });

  it("claims one apply atomically, releases it on cancellation, and consumes only the active lease", () => {
    const registry = new RestorePreviewRegistry();
    const ready = registry.complete(9, registry.begin(9), previewInput("4", "/synthetic/retry.zip"));
    const request = { previewId: ready.previewId, mode: "clone_as_new" as const };

    const firstLease = registry.claim(9, request);
    expect(registry.isCurrent(9, firstLease)).toBe(true);
    expect(() => registry.claim(9, request))
      .toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));
    expect(() => registry.begin(9))
      .toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));
    registry.release(9, firstLease);
    const retriedLease = registry.claim(9, request);
    registry.consume(9, { ...retriedLease });
    expect(registry.isCurrent(9, retriedLease)).toBe(true);
    registry.consume(9, retriedLease);
    expect(() => registry.claim(9, request))
      .toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));
  });

  it("clears pending and ready state when the owning renderer goes away", () => {
    const registry = new RestorePreviewRegistry();
    const generation = registry.begin(31);
    registry.clear(31);
    expect(() => registry.complete(31, generation, previewInput("5", "/synthetic/cleared.zip")))
      .toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));
  });

  it("binds one explicit mode and exact archive identity to the active claim", () => {
    const registry = new RestorePreviewRegistry();
    const ready = registry.complete(41, registry.begin(41), previewInput("6"));

    expect(() => registry.claim(41, {
      previewId: `sha256:${"0".repeat(64)}`,
      mode: "clone_as_new"
    })).toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));

    const applying = registry.claim(41, { previewId: ready.previewId, mode: "replace_existing" });
    expect(applying).toMatchObject({
      mode: "replace_existing",
      archiveDigest: `sha256:${"6".repeat(64)}`,
      backupId: "backup_20260714_registry1",
      backupIdSource: "manifest",
      sourceVaultId: "vault_20260714_registry1"
    });
  });
});

function previewInput(seed: string, backupPath = "/synthetic/backup.zip") {
  return {
    backupPath,
    archivePreviewToken: `sha256:${seed.repeat(64)}`,
    archiveDigest: `sha256:${seed.repeat(64)}`,
    backupId: "backup_20260714_registry1",
    backupIdSource: "manifest" as const,
    sourceVaultId: "vault_20260714_registry1"
  };
}
