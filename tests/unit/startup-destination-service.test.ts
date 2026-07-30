import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import { StartupDestinationService } from "../../apps/desktop/src/main/services/startup-destination-service";
import { acquireVaultWriterLease } from "../../apps/desktop/src/main/services/vault-writer-lease";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("startup destination service", () => {
  it("defaults to Home and durably adopts an exact Library preference after restart", () => {
    const root = makeRoot();
    const store = new LocalSettingsStore(root);
    const service = new StartupDestinationService(store);

    expect(service.summary()).toEqual({ apiVersion: 1, destination: "home", revision: 0 });
    expect(service.set({ destination: "library", expectedRevision: 0 })).toEqual({
      status: "committed",
      summary: { apiVersion: 1, destination: "library", revision: 1 }
    });
    store.setAppLocale("fr");

    expect(new StartupDestinationService(new LocalSettingsStore(root)).summary()).toEqual({
      apiVersion: 1,
      destination: "library",
      revision: 1
    });
  });

  it("returns authoritative current truth for stale and failed writes", () => {
    const root = makeRoot();
    const store = new LocalSettingsStore(root);
    const service = new StartupDestinationService(store);
    service.set({ destination: "library", expectedRevision: 0 });

    expect(service.set({ destination: "home", expectedRevision: 0 })).toEqual({
      status: "stale",
      summary: { apiVersion: 1, destination: "library", revision: 1 }
    });

    const lease = acquireVaultWriterLease(root);
    try {
      expect(service.set({ destination: "home", expectedRevision: 1 })).toEqual({
        status: "failed",
        summary: { apiVersion: 1, destination: "library", revision: 1 }
      });
    } finally {
      lease.release();
    }
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-startup-destination-"));
  roots.push(root);
  return root;
}
