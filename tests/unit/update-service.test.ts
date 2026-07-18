import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UpdateStatusEvent } from "@pige/contracts";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import {
  NoNetworkUpdateCheckAdapter,
  UpdateService,
  type UpdateAdapterCheckResult,
  type UpdateCheckAdapter
} from "../../apps/desktop/src/main/services/update-service";

const roots: string[] = [];
const request = { apiVersion: 1, requestId: `updatereq_${"a".repeat(16)}` } as const;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("update service", () => {
  it("keeps the default and unsupported adapters network-free and truthfully unavailable", async () => {
    const development = new CountingNoNetworkAdapter("darwin");
    const service = createService(development);
    expect(service.summary()).toMatchObject({ capability: "development", phase: "idle", channel: "alpha" });
    await expect(service.check(request)).resolves.toMatchObject({ status: "unavailable" });
    expect(development.checkCount).toBe(0);

    const unsupported = new CountingNoNetworkAdapter("linux");
    const unsupportedService = createService(unsupported);
    expect(unsupportedService.summary()).toMatchObject({ capability: "unsupported_platform", phase: "idle" });
    await expect(unsupportedService.check(request)).resolves.toMatchObject({ status: "unavailable" });
    expect(unsupported.checkCount).toBe(0);
  });

  it("publishes monotonic checking and terminal events and persists only the body-free terminal state", async () => {
    const adapter = new FakePackagedAdapter({ status: "available", availableVersion: "0.2.0-alpha.1" });
    const events: UpdateStatusEvent[] = [];
    const { service, store } = createServiceWithStore(adapter, events);

    await expect(service.check(request)).resolves.toMatchObject({
      status: "checked",
      summary: {
        revision: 1,
        capability: "packaged_ready",
        phase: "available",
        availableVersion: "0.2.0-alpha.1"
      }
    });
    expect(events).toEqual([
      expect.objectContaining({ sequence: 1, summary: expect.objectContaining({ phase: "checking", revision: 0 }) }),
      expect.objectContaining({ sequence: 2, summary: expect.objectContaining({ phase: "available", revision: 1 }) })
    ]);
    expect(store.getUpdateSettings()).toEqual({
      revision: 1,
      channel: "alpha",
      lastCheck: {
        phase: "available",
        availableVersion: "0.2.0-alpha.1",
        checkedAt: "2026-07-18T08:00:00.000Z"
      }
    });
    expect(JSON.stringify(store.read())).not.toContain("feed");
    expect(JSON.stringify(store.read())).not.toContain("path");
  });

  it("serializes concurrent checks and never invokes the adapter twice", async () => {
    let release: (() => void) | undefined;
    const adapter = new FakePackagedAdapter({ status: "up_to_date" });
    adapter.delay = new Promise<void>((resolve) => { release = resolve; });
    const service = createService(adapter);
    const first = service.check(request);
    await adapter.entered;
    await expect(service.check({ ...request, requestId: `updatereq_${"b".repeat(16)}` }))
      .resolves.toMatchObject({ status: "busy", summary: { phase: "checking" } });
    release?.();
    await expect(first).resolves.toMatchObject({ status: "checked", summary: { phase: "up_to_date" } });
    expect(adapter.checkCount).toBe(1);
  });

  it("collapses adapter failures and invalid versions into a persisted body-free failed state", async () => {
    const throwing = new FakePackagedAdapter({ status: "up_to_date" });
    throwing.failure = new Error("GET https://secret.invalid returned /private/feed body");
    const { service, store } = createServiceWithStore(throwing);
    await expect(service.check(request)).resolves.toMatchObject({
      status: "checked",
      summary: { phase: "failed", revision: 1 }
    });
    const serialized = JSON.stringify(store.read());
    expect(serialized).not.toContain("secret.invalid");
    expect(serialized).not.toContain("/private/feed");

    const invalid = new FakePackagedAdapter({ status: "available", availableVersion: "https://bad.invalid/latest" });
    await expect(createService(invalid).check(request)).resolves.toMatchObject({
      status: "checked",
      summary: { phase: "failed" }
    });
  });

  it("does not let an older failed check overwrite a newer terminal revision", async () => {
    let release: (() => void) | undefined;
    const adapter = new FakePackagedAdapter({ status: "up_to_date" });
    adapter.delay = new Promise<void>((resolve) => { release = resolve; });
    adapter.failure = new Error("stale adapter failure");
    const { service, store } = createServiceWithStore(adapter);

    const pending = service.check(request);
    await adapter.entered;
    expect(store.mutateUpdateSettings(0, (settings) => ({
      ...settings,
      lastCheck: {
        phase: "available",
        availableVersion: "0.3.0-alpha.1",
        checkedAt: "2026-07-18T08:00:01.000Z"
      }
    })).status).toBe("committed");
    release?.();

    await expect(pending).resolves.toMatchObject({
      status: "stale",
      summary: {
        revision: 1,
        phase: "available",
        availableVersion: "0.3.0-alpha.1"
      }
    });
    expect(store.getUpdateSettings().lastCheck).toMatchObject({
      phase: "available",
      availableVersion: "0.3.0-alpha.1"
    });
  });

  it("does not strand the busy gate when settings preflight fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-update-service-test-"));
    roots.push(root);
    const store = new LocalSettingsStore(root);
    const adapter = new FakePackagedAdapter({ status: "up_to_date" });
    const service = new UpdateService({
      settings: store,
      adapter,
      currentVersion: "0.1.0-alpha.1",
      publish: () => undefined,
      now: () => new Date("2026-07-18T08:00:00.000Z")
    });
    fs.writeFileSync(path.join(root, "settings.json"), "{ invalid", { encoding: "utf8", mode: 0o600 });

    await expect(service.check(request)).rejects.toBeDefined();
    store.write({ schemaVersion: 1, recentVaults: [] });
    await expect(service.check(request)).resolves.toMatchObject({
      status: "checked",
      summary: { phase: "up_to_date" }
    });
    expect(adapter.checkCount).toBe(1);
  });

  it("does not let an event delivery failure rewrite a successful durable result", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-update-service-test-"));
    roots.push(root);
    const store = new LocalSettingsStore(root);
    const service = new UpdateService({
      settings: store,
      adapter: new FakePackagedAdapter({ status: "up_to_date" }),
      currentVersion: "0.1.0-alpha.1",
      publish: () => { throw new Error("renderer disappeared"); },
      now: () => new Date("2026-07-18T08:00:00.000Z")
    });

    await expect(service.check(request)).resolves.toMatchObject({
      status: "checked",
      summary: { phase: "up_to_date", revision: 1 }
    });
    expect(store.getUpdateSettings().lastCheck?.phase).toBe("up_to_date");
  });
});

class CountingNoNetworkAdapter extends NoNetworkUpdateCheckAdapter {
  checkCount = 0;

  override async check(): Promise<UpdateAdapterCheckResult> {
    this.checkCount += 1;
    return super.check();
  }
}

class FakePackagedAdapter implements UpdateCheckAdapter {
  readonly capability = "packaged_ready" as const;
  readonly result: UpdateAdapterCheckResult;
  checkCount = 0;
  failure: Error | undefined;
  delay: Promise<void> | undefined;
  readonly entered: Promise<void>;
  #markEntered: (() => void) | undefined;

  constructor(result: UpdateAdapterCheckResult) {
    this.result = result;
    this.entered = new Promise<void>((resolve) => { this.#markEntered = resolve; });
  }

  async check(): Promise<UpdateAdapterCheckResult> {
    this.checkCount += 1;
    this.#markEntered?.();
    await this.delay;
    if (this.failure) throw this.failure;
    return this.result;
  }
}

function createService(adapter: UpdateCheckAdapter): UpdateService {
  return createServiceWithStore(adapter).service;
}

function createServiceWithStore(
  adapter: UpdateCheckAdapter,
  events: UpdateStatusEvent[] = []
): { service: UpdateService; store: LocalSettingsStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-update-service-test-"));
  roots.push(root);
  const store = new LocalSettingsStore(root);
  return {
    store,
    service: new UpdateService({
      settings: store,
      adapter,
      currentVersion: "0.1.0-alpha.1",
      publish: (event) => events.push(event),
      now: () => new Date("2026-07-18T08:00:00.000Z")
    })
  };
}
