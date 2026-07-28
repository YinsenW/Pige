import { describe, expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { registerPiPackagesIpc } from "../../apps/desktop/src/main/register-pi-packages-ipc";

type IpcHandler = (event: IpcMainInvokeEvent, request?: unknown) => unknown;

const request = {
  apiVersion: 1,
  requestId: "pi_package_request_abcdefghijklmnop",
  expectedRegistryRevision: 3,
  packageName: "@pige/example-extension",
  version: "1.2.3"
} as const;
const registry = {
  apiVersion: 1,
  revision: 4,
  packages: [{
    packageId: "pkg_0123456789abcdef01234567",
    packageName: request.packageName,
    version: request.version,
    state: "installed_disabled",
    packageTypes: ["extension"],
    dependencyCount: 0,
    enabled: false,
    trust: "community"
  }]
} as const;

function makeHarness(overrides: {
  readonly isTrustedSender?: () => boolean;
  readonly getActiveVaultId?: () => string | undefined;
  readonly summary?: () => unknown;
  readonly install?: (value: typeof request) => unknown;
} = {}) {
  const handlers = new Map<string, IpcHandler>();
  const summary = vi.fn(overrides.summary ?? (() => ({ status: "ready", registry })));
  const install = vi.fn(overrides.install ?? ((value) => ({
    apiVersion: 1,
    requestId: value.requestId,
    taskId: "pi_package_task_abcdefghijklmnop",
    registry,
    status: "installed_disabled"
  })));
  registerPiPackagesIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    isTrustedSender: overrides.isTrustedSender ?? (() => true),
    getActiveVaultId: overrides.getActiveVaultId ?? (() => "vault_20260728_packages"),
    summary,
    install
  });
  return { handlers, summary, install };
}

describe("registerPiPackagesIpc", () => {
  it("registers the exact package Settings channels and forwards a strict install", async () => {
    const harness = makeHarness();
    expect([...harness.handlers.keys()]).toEqual(["piPackages.summary", "piPackages.install"]);

    await expect(call(harness, "piPackages.summary")).resolves.toEqual({ status: "ready", registry });
    await expect(call(harness, "piPackages.install", request)).resolves.toMatchObject({
      requestId: request.requestId,
      status: "installed_disabled",
      registry
    });
    expect(harness.install).toHaveBeenCalledOnce();
    expect(harness.install).toHaveBeenCalledWith(request);
  });

  it("strictly rejects malformed install requests before invoking the owner", async () => {
    const harness = makeHarness();
    await expect(call(harness, "piPackages.install", {
      ...request,
      path: "/private/package.tgz"
    })).rejects.toThrow();
    expect(harness.install).not.toHaveBeenCalled();
  });

  it("validates owner results and converts private or identity-swapped output to body-free failure", async () => {
    const harness = makeHarness({
      install: () => ({
        apiVersion: 1,
        requestId: "pi_package_request_wrongidentity123",
        taskId: "pi_package_task_abcdefghijklmnop",
        registry,
        status: "failed",
        error: "ENOENT /private/package.tgz"
      })
    });
    const result = await call(harness, "piPackages.install", request);
    expect(result).toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      taskId: "pi_package_task_abcdefghijklmnop",
      registry,
      status: "failed"
    });
    expect(JSON.stringify(result)).not.toMatch(/error|path|ENOENT|private/u);
  });

  it("fails closed before install for an untrusted sender or missing vault", async () => {
    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(call(untrusted, "piPackages.summary")).resolves.toEqual({ status: "failed" });
    await expect(call(untrusted, "piPackages.install", request)).resolves.toMatchObject({
      requestId: request.requestId,
      status: "failed"
    });
    expect(untrusted.install).not.toHaveBeenCalled();
    expect(untrusted.summary).not.toHaveBeenCalled();

    const noVault = makeHarness({ getActiveVaultId: () => undefined });
    await expect(call(noVault, "piPackages.install", request)).resolves.toMatchObject({ status: "failed" });
    expect(noVault.install).not.toHaveBeenCalled();
    expect(noVault.summary).not.toHaveBeenCalled();
  });

  it("fails closed when the active vault changes while install is running", async () => {
    let reads = 0;
    const harness = makeHarness({
      getActiveVaultId: () => reads++ === 0 ? "vault_20260728_packages" : "vault_20260728_other"
    });
    await expect(call(harness, "piPackages.install", request)).resolves.toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      taskId: "pi_package_task_abcdefghijklmnop",
      registry,
      status: "failed"
    });
    expect(harness.install).toHaveBeenCalledOnce();
  });

  it("strictly validates summary results without exposing owner failures", async () => {
    const invalid = makeHarness({
      summary: () => ({ status: "ready", registry: { ...registry, rootPath: "/private/packages" } })
    });
    await expect(call(invalid, "piPackages.summary")).resolves.toEqual({ status: "failed" });

    const throwing = makeHarness({ summary: () => { throw new Error("/private/package-registry.json"); } });
    await expect(call(throwing, "piPackages.summary")).resolves.toEqual({ status: "failed" });
  });
});

function call(
  harness: ReturnType<typeof makeHarness>,
  channel: string,
  value?: unknown
): Promise<unknown> {
  return Promise.resolve(harness.handlers.get(channel)!({ sender: {} as WebContents } as IpcMainInvokeEvent, value));
}
