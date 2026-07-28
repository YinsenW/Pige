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
const uninstallRequest = {
  apiVersion: 1,
  requestId: "pi_package_uninstall_request_abcdefghijklmnop",
  expectedRegistryRevision: registry.revision,
  packageId: registry.packages[0].packageId
} as const;
const catalogRequest = {
  apiVersion: 1,
  requestId: "pi_package_catalog_request_abcdefghijklmnop",
  query: "side question"
} as const;
const catalogEntry = {
  catalogId: "pi_catalog_narumitw_pi_btw",
  packageName: "@narumitw/pi-btw",
  version: "0.34.0",
  integrity: "sha512-ycjtInVV9csP+mR3L6gXgPJOsMGQej80ltkqbJhK0Gy3Mc8BgYvPrdQ0HXTFSGeDzr+//V51CYVK9KcgWti+VA==",
  displayName: "Pi BTW",
  purpose: "Ask a side question without disturbing the main conversation.",
  license: "MIT",
  packageTypes: ["extension"],
  capabilities: ["call_cloud_model_with_private_or_large_source"],
  dataBoundaries: ["cloud"],
  trust: "curated",
  source: "npm"
} as const;

function makeHarness(overrides: {
  readonly isTrustedSender?: () => boolean;
  readonly getActiveVaultId?: () => string | undefined;
  readonly summary?: () => unknown;
  readonly catalogQuery?: (value: typeof catalogRequest) => unknown;
  readonly install?: (value: typeof request) => unknown;
  readonly confirmUninstall?: (value: typeof uninstallRequest) => unknown;
  readonly uninstall?: (value: typeof uninstallRequest) => unknown;
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
  const catalogQuery = vi.fn(overrides.catalogQuery ?? ((value) => ({
    apiVersion: 1,
    requestId: value.requestId,
    status: "ready",
    entries: [catalogEntry],
    total: 1
  })));
  const confirmUninstall = vi.fn((_sender, value) => overrides.confirmUninstall?.(value) ?? true);
  const uninstall = vi.fn(overrides.uninstall ?? ((value) => ({
    apiVersion: 1,
    requestId: value.requestId,
    packageId: value.packageId,
    registry: { ...registry, revision: registry.revision + 1, packages: [] },
    status: "removed"
  })));
  registerPiPackagesIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    isTrustedSender: overrides.isTrustedSender ?? (() => true),
    getActiveVaultId: overrides.getActiveVaultId ?? (() => "vault_20260728_packages"),
    summary,
    catalogQuery,
    install,
    confirmUninstall,
    uninstall
  });
  return { handlers, summary, catalogQuery, install, confirmUninstall, uninstall };
}

describe("registerPiPackagesIpc", () => {
  it("registers the exact package Settings channels and forwards a strict install", async () => {
    const harness = makeHarness();
    expect([...harness.handlers.keys()]).toEqual([
      "piPackages.summary", "piPackages.catalogQuery", "piPackages.install", "piPackages.uninstall"
    ]);

    await expect(call(harness, "piPackages.summary")).resolves.toEqual({ status: "ready", registry });
    await expect(call(harness, "piPackages.install", request)).resolves.toMatchObject({
      requestId: request.requestId,
      status: "installed_disabled",
      registry
    });
    expect(harness.install).toHaveBeenCalledOnce();
    expect(harness.install).toHaveBeenCalledWith(request);
  });

  it("returns only strict local catalog results and fails closed across sender or identity drift", async () => {
    const harness = makeHarness();
    await expect(call(harness, "piPackages.catalogQuery", catalogRequest)).resolves.toEqual({
      apiVersion: 1,
      requestId: catalogRequest.requestId,
      status: "ready",
      entries: [catalogEntry],
      total: 1
    });
    expect(harness.catalogQuery).toHaveBeenCalledWith(catalogRequest);

    const swapped = makeHarness({ catalogQuery: () => ({
      apiVersion: 1,
      requestId: "pi_package_catalog_request_wrongidentity123",
      status: "failed",
      error: "/private/catalog"
    }) });
    await expect(call(swapped, "piPackages.catalogQuery", catalogRequest)).resolves.toEqual({
      apiVersion: 1, requestId: catalogRequest.requestId, status: "failed"
    });

    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(call(untrusted, "piPackages.catalogQuery", catalogRequest)).resolves.toEqual({
      apiVersion: 1, requestId: catalogRequest.requestId, status: "failed"
    });
    expect(untrusted.catalogQuery).not.toHaveBeenCalled();
  });

  it("confirms a strict uninstall before effect and returns only authoritative owner state", async () => {
    const harness = makeHarness();
    await expect(call(harness, "piPackages.uninstall", uninstallRequest)).resolves.toMatchObject({
      requestId: uninstallRequest.requestId,
      packageId: uninstallRequest.packageId,
      status: "removed",
      registry: { revision: 5, packages: [] }
    });
    expect(harness.confirmUninstall).toHaveBeenCalledOnce();
    expect(harness.uninstall).toHaveBeenCalledWith(uninstallRequest);
    expect(harness.confirmUninstall.mock.invocationCallOrder[0]).toBeLessThan(harness.uninstall.mock.invocationCallOrder[0]!);
  });

  it("returns denial with a freshly read registry and never invokes the manager", async () => {
    const harness = makeHarness({ confirmUninstall: () => false });
    await expect(call(harness, "piPackages.uninstall", uninstallRequest)).resolves.toEqual({
      apiVersion: 1,
      requestId: uninstallRequest.requestId,
      packageId: uninstallRequest.packageId,
      status: "denied",
      registry
    });
    expect(harness.summary).toHaveBeenCalledOnce();
    expect(harness.uninstall).not.toHaveBeenCalled();
  });

  it("fails uninstall before confirmation for malformed/untrusted input and after a vault fence change", async () => {
    const malformed = makeHarness();
    await expect(call(malformed, "piPackages.uninstall", { ...uninstallRequest, path: "/private/package" })).rejects.toThrow();
    expect(malformed.confirmUninstall).not.toHaveBeenCalled();

    const untrusted = makeHarness({ isTrustedSender: () => false });
    await expect(call(untrusted, "piPackages.uninstall", uninstallRequest)).resolves.toMatchObject({ status: "failed" });
    expect(untrusted.confirmUninstall).not.toHaveBeenCalled();

    let reads = 0;
    const changed = makeHarness({
      getActiveVaultId: () => reads++ === 0 ? "vault_20260728_packages" : "vault_20260728_other"
    });
    await expect(call(changed, "piPackages.uninstall", uninstallRequest)).resolves.toEqual({
      apiVersion: 1, requestId: uninstallRequest.requestId,
      packageId: uninstallRequest.packageId, status: "failed"
    });
    expect(changed.uninstall).not.toHaveBeenCalled();
  });

  it("strips identity-swapped or private uninstall failures to identity-only failed", async () => {
    const harness = makeHarness({
      uninstall: () => ({
        apiVersion: 1,
        requestId: "pi_package_uninstall_request_wrongidentity123",
        packageId: uninstallRequest.packageId,
        status: "failed",
        registry,
        error: "ENOENT /private/package"
      })
    });
    const result = await call(harness, "piPackages.uninstall", uninstallRequest);
    expect(result).toEqual({
      apiVersion: 1, requestId: uninstallRequest.requestId,
      packageId: uninstallRequest.packageId, status: "failed"
    });
    expect(JSON.stringify(result)).not.toMatch(/registry|error|ENOENT|private/u);
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
    await expect(call(noVault, "piPackages.summary")).resolves.toEqual({ status: "ready", registry });
    await expect(call(noVault, "piPackages.install", request)).resolves.toMatchObject({ status: "failed" });
    expect(noVault.install).not.toHaveBeenCalled();
    expect(noVault.summary).toHaveBeenCalledOnce();
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

    const failedInstall = makeHarness({
      install: () => { throw new Error("ENOENT /private/package-registry.json"); }
    });
    await expect(call(failedInstall, "piPackages.install", request)).resolves.toEqual({
      apiVersion: 1,
      requestId: request.requestId,
      taskId: "pi_package_task_abcdefghijklmnop",
      status: "failed"
    });
    expect(failedInstall.summary).not.toHaveBeenCalled();
  });
});

function call(
  harness: ReturnType<typeof makeHarness>,
  channel: string,
  value?: unknown
): Promise<unknown> {
  return Promise.resolve(harness.handlers.get(channel)!({ sender: {} as WebContents } as IpcMainInvokeEvent, value));
}
