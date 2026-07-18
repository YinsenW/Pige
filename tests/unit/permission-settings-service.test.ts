import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import { PermissionSettingsService } from "../../apps/desktop/src/main/services/permission-settings-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PermissionSettingsService", () => {
  it("projects legacy settings as an empty ask-every-time machine policy", () => {
    const { service } = fixture();

    expect(service.current()).toEqual({
      apiVersion: 1,
      revision: 0,
      defaultMode: "ask_every_time",
      yoloEnabled: false,
      savedGrants: []
    });
  });

  it("commits default and YOLO modes with monotonic CAS revisions and fallback restore", () => {
    const { service } = fixture();

    expect(service.setDefaultMode(0, "remember_scoped_grants")).toMatchObject({
      status: "committed",
      settings: { revision: 1, defaultMode: "remember_scoped_grants", yoloEnabled: false }
    });
    expect(service.setDefaultMode(0, "ask_every_time")).toMatchObject({
      status: "stale",
      settings: { revision: 1, defaultMode: "remember_scoped_grants" }
    });
    expect(service.enableYolo(1)).toMatchObject({
      status: "committed",
      settings: { revision: 2, defaultMode: "yolo_full_access", yoloEnabled: true }
    });
    expect(service.authoritySnapshot()).toMatchObject({
      revision: 2,
      defaultMode: "yolo_full_access",
      yoloEnabled: true
    });
    expect(service.disableYolo(2)).toMatchObject({
      status: "committed",
      settings: { revision: 3, defaultMode: "remember_scoped_grants", yoloEnabled: false }
    });
  });

  it("projects and revokes bounded saved grants without exposing internal identity hashes", () => {
    const { store, service } = fixture();
    store.write({
      schemaVersion: 1,
      recentVaults: [],
      permissions: {
        revision: 7,
        defaultMode: "remember_scoped_grants",
        yoloEnabled: false,
        savedGrants: [savedGrant("permgrant_20260718_abcdefgh"), savedGrant("permgrant_20260718_ijklmnop")]
      }
    });

    const projected = service.current();
    expect(projected.savedGrants).toHaveLength(2);
    expect(JSON.stringify(projected)).not.toContain("skill.synthetic.internal");
    expect(JSON.stringify(projected)).not.toContain("sha256:");
    expect(service.revokeGrant(7, "permgrant_20260718_abcdefgh")).toMatchObject({
      status: "committed",
      settings: { revision: 8, savedGrants: [{ grantId: "permgrant_20260718_ijklmnop" }] }
    });
    expect(service.revokeGrant(8, "permgrant_20260718_abcdefgh")).toMatchObject({
      status: "not_found",
      settings: { revision: 8 }
    });
    expect(service.revokeAllGrants(8)).toMatchObject({
      status: "committed",
      settings: { revision: 9, savedGrants: [] }
    });
  });

  it("revokes outstanding YOLO authority on any permission settings revision change", () => {
    const { service } = fixture();
    service.enableYolo(0);
    expect(() => service.assertYoloAuthority(1)).not.toThrow();
    service.disableYolo(1);
    expect(() => service.assertYoloAuthority(1)).toThrowError(expect.objectContaining({
      code: "permission.authority_revoked"
    }));
  });
});

function fixture(): { store: LocalSettingsStore; service: PermissionSettingsService } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-permission-settings-"));
  roots.push(root);
  const store = new LocalSettingsStore(root);
  return { store, service: new PermissionSettingsService(store) };
}

function savedGrant(grantId: string) {
  return {
    grantId,
    actorType: "skill" as const,
    actorId: "skill.synthetic.internal",
    actorVersion: "1.0.0",
    actorDigest: `sha256:${"a".repeat(64)}`,
    actorDisplayName: "Synthetic Skill",
    capability: "external_filesystem" as const,
    dataBoundary: "filesystem" as const,
    resourceScope: "current_folder" as const,
    resourceKind: "folder" as const,
    resourceIdentityHash: `sha256:${"b".repeat(64)}`,
    decisionScope: "resource_scope" as const,
    createdAt: "2026-07-18T00:00:00.000Z"
  };
}
