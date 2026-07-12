import { describe, expect, it } from "vitest";
import { RestorePreviewRegistry } from "../../apps/desktop/src/main/services/restore-preview-registry";

describe("restore preview registry", () => {
  it("isolates opaque preview tokens by sender and rejects cross-window replay", () => {
    const registry = new RestorePreviewRegistry();
    const first = registry.complete(11, registry.begin(11), {
      backupPath: "/synthetic/backup.zip",
      archivePreviewToken: `sha256:${"1".repeat(64)}`
    });
    const second = registry.complete(22, registry.begin(22), {
      backupPath: "/synthetic/backup.zip",
      archivePreviewToken: `sha256:${"1".repeat(64)}`
    });

    expect(first.publicPreviewToken).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(second.publicPreviewToken).not.toBe(first.publicPreviewToken);
    expect(() => registry.claim(22, {
      backupPath: first.backupPath,
      previewToken: first.publicPreviewToken
    })).toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));
    expect(registry.claim(11, {
      backupPath: first.backupPath,
      previewToken: first.publicPreviewToken
    })).toMatchObject({ readyIdentity: first });
  });

  it("rejects an out-of-order completion and preserves the newer generation", () => {
    const registry = new RestorePreviewRegistry();
    const olderGeneration = registry.begin(7);
    const newerGeneration = registry.begin(7);

    expect(() => registry.complete(7, olderGeneration, {
      backupPath: "/synthetic/older.zip",
      archivePreviewToken: `sha256:${"2".repeat(64)}`
    })).toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));

    const newer = registry.complete(7, newerGeneration, {
      backupPath: "/synthetic/newer.zip",
      archivePreviewToken: `sha256:${"3".repeat(64)}`
    });
    expect(registry.claim(7, {
      backupPath: newer.backupPath,
      previewToken: newer.publicPreviewToken
    })).toMatchObject({ readyIdentity: newer });
  });

  it("claims one apply atomically, releases it on cancellation, and consumes only the active lease", () => {
    const registry = new RestorePreviewRegistry();
    const ready = registry.complete(9, registry.begin(9), {
      backupPath: "/synthetic/retry.zip",
      archivePreviewToken: `sha256:${"4".repeat(64)}`
    });
    const request = { backupPath: ready.backupPath, previewToken: ready.publicPreviewToken };

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
    expect(() => registry.complete(31, generation, {
      backupPath: "/synthetic/cleared.zip",
      archivePreviewToken: `sha256:${"5".repeat(64)}`
    })).toThrowError(expect.objectContaining({ code: "restore.backup_invalid" }));
  });
});
