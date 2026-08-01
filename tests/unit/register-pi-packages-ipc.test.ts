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
    canEnable: false,
    trust: "community",
    pinned: false,
    canUpdate: true,
    canRollback: false,
    rollbackTarget: null
  }]
} as const;
const uninstallRequest = {
  apiVersion: 1,
  requestId: "pi_package_uninstall_request_abcdefghijklmnop",
  expectedRegistryRevision: registry.revision,
  packageId: registry.packages[0].packageId
} as const;
const restoreRequest = {
  apiVersion: 1,
  requestId: "pi_package_restore_request_abcdefghijklmnop",
  expectedRegistryRevision: registry.revision + 1,
  restoreContextId: `pi_package_restore_context_v1_${"a".repeat(48)}`,
  packageId: registry.packages[0].packageId,
  version: registry.packages[0].version,
  integrity: "sha512-ycjtInVV9csP+mR3L6gXgPJOsMGQej80ltkqbJhK0Gy3Mc8BgYvPrdQ0HXTFSGeDzr+//V51CYVK9KcgWti+VA==",
  pinned: false,
  rollbackTarget: null
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
const inspectRequest = {
  apiVersion: 1,
  requestId: "pi_package_inspect_request_abcdefghijklmnop",
  expectedRegistryRevision: registry.revision,
  packageId: registry.packages[0].packageId
} as const;
const inspection = {
  packageId: inspectRequest.packageId,
  packageName: registry.packages[0].packageName,
  version: registry.packages[0].version,
  integrity: restoreRequest.integrity,
  installedAt: "2026-08-02T00:00:00.000Z",
  state: "installed_disabled",
  packageTypes: ["extension"],
  dependencyCount: 0,
  enabled: false,
  pinned: false,
  source: "npm",
  installationTrust: "community",
  integrityStatus: "verified",
  catalogDisclosure: { status: "unknown" }
} as const;
const updateRequest = {
  apiVersion: 1, requestId: "pi_package_update_request_abcdefghijklmnop",
  packageId: registry.packages[0].packageId, expectedRegistryRevision: registry.revision,
  targetVersion: "1.3.0",
  targetIntegrity: "sha512-ycjtInVV9csP+mR3L6gXgPJOsMGQej80ltkqbJhK0Gy3Mc8BgYvPrdQ0HXTFSGeDzr+//V51CYVK9KcgWti+VA=="
} as const;
const rollbackRequest = {
  apiVersion: 1, requestId: "pi_package_rollback_request_abcdefghijklmnop",
  packageId: registry.packages[0].packageId, expectedRegistryRevision: registry.revision + 1,
  rollbackId: "pi_package_rollback_abcdefghijklmnop", targetVersion: request.version
} as const;
const pinRequest = {
  apiVersion: 1, requestId: "pi_package_pin_request_abcdefghijklmnop",
  packageId: registry.packages[0].packageId, expectedRegistryRevision: registry.revision,
  pinned: true
} as const;
const enableRequest = {
  apiVersion: 1, requestId: "pi_package_enable_request_abcdefghijklmnop",
  packageId: registry.packages[0].packageId, expectedRegistryRevision: registry.revision,
  enabled: true
} as const;

function makeHarness(overrides: {
  readonly isTrustedSender?: () => boolean;
  readonly getActiveVaultId?: () => string | undefined;
  readonly summary?: () => unknown;
  readonly catalogQuery?: (value: typeof catalogRequest) => unknown;
  readonly inspect?: (value: typeof inspectRequest) => unknown;
  readonly install?: (value: typeof request) => unknown;
  readonly confirmUninstall?: (value: typeof uninstallRequest) => unknown;
  readonly uninstall?: (value: typeof uninstallRequest) => unknown;
  readonly restore?: (value: typeof restoreRequest) => unknown;
  readonly confirmUpdate?: (value: typeof updateRequest) => unknown;
  readonly update?: (value: typeof updateRequest) => unknown;
  readonly confirmRollback?: (value: typeof rollbackRequest) => unknown;
  readonly rollback?: (value: typeof rollbackRequest) => unknown;
  readonly setPinned?: (value: typeof pinRequest) => unknown;
  readonly setEnabled?: (value: typeof enableRequest) => unknown;
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
  const inspect = vi.fn(overrides.inspect ?? ((value) => ({
    apiVersion: 1,
    requestId: value.requestId,
    packageId: value.packageId,
    status: "ready",
    registryRevision: value.expectedRegistryRevision,
    inspection
  })));
  const confirmUninstall = vi.fn((_sender, value) => overrides.confirmUninstall?.(value) ?? true);
  const uninstall = vi.fn(overrides.uninstall ?? ((value) => ({
    apiVersion: 1,
    requestId: value.requestId,
    packageId: value.packageId,
    registry: { ...registry, revision: registry.revision + 1, packages: [] },
    status: "removed"
  })));
  const restore = vi.fn(overrides.restore ?? ((value) => ({
    apiVersion: 1, requestId: value.requestId, restoreContextId: value.restoreContextId,
    packageId: value.packageId, version: value.version, integrity: value.integrity,
    pinned: value.pinned, rollbackTarget: value.rollbackTarget,
    registry: { ...registry, revision: value.expectedRegistryRevision + 1 }, status: "committed"
  })));
  const confirmUpdate = vi.fn((_sender, value) => overrides.confirmUpdate?.(value) ?? true);
  const update = vi.fn(overrides.update ?? ((value) => ({
    apiVersion: 1, requestId: value.requestId, packageId: value.packageId,
    targetVersion: value.targetVersion, targetIntegrity: value.targetIntegrity,
    registry: { ...registry, revision: registry.revision + 1, packages: [{
      ...registry.packages[0], version: value.targetVersion, canRollback: true,
      rollbackTarget: { rollbackId: rollbackRequest.rollbackId, targetVersion: request.version }
    }] }, status: "committed"
  })));
  const confirmRollback = vi.fn((_sender, value) => overrides.confirmRollback?.(value) ?? true);
  const rollback = vi.fn(overrides.rollback ?? ((value) => ({
    apiVersion: 1, requestId: value.requestId, packageId: value.packageId,
    rollbackId: value.rollbackId, targetVersion: value.targetVersion,
    registry: { ...registry, revision: registry.revision + 2 }, status: "committed"
  })));
  const setPinned = vi.fn(overrides.setPinned ?? ((value) => ({
    apiVersion: 1, requestId: value.requestId, packageId: value.packageId, pinned: value.pinned,
    registry: { ...registry, revision: registry.revision + 1, packages: [{ ...registry.packages[0],
      pinned: value.pinned, canUpdate: !value.pinned, canRollback: false, rollbackTarget: null }] },
    status: "committed"
  })));
  const setEnabled = vi.fn(overrides.setEnabled ?? ((value) => ({
    apiVersion: 1, requestId: value.requestId, packageId: value.packageId, enabled: value.enabled,
    registry: { ...registry, revision: registry.revision + 1, packages: [{ ...registry.packages[0],
      state: value.enabled ? "installed_enabled" : "installed_disabled", enabled: value.enabled,
      canEnable: true, canUpdate: !value.enabled, canRollback: false, rollbackTarget: null }] },
    status: "committed"
  })));
  registerPiPackagesIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler as IpcHandler)
    } as Pick<IpcMain, "handle">,
    isTrustedSender: overrides.isTrustedSender ?? (() => true),
    getActiveVaultId: overrides.getActiveVaultId ?? (() => "vault_20260728_packages"),
    summary,
    catalogQuery,
    inspect,
    install,
    confirmUninstall,
    uninstall,
    restore,
    confirmUpdate,
    update,
    confirmRollback,
    rollback,
    setPinned,
    setEnabled
  });
  return { handlers, summary, catalogQuery, inspect, install, confirmUninstall, uninstall, restore,
    confirmUpdate, update, confirmRollback, rollback, setPinned, setEnabled };
}

describe("registerPiPackagesIpc", () => {
  it("registers the exact package Settings channels and forwards a strict install", async () => {
    const harness = makeHarness();
    expect([...harness.handlers.keys()]).toEqual([
      "piPackages.summary", "piPackages.catalogQuery", "piPackages.inspect", "piPackages.install", "piPackages.uninstall",
      "piPackages.restore", "piPackages.update", "piPackages.rollback", "piPackages.setPinned",
      "piPackages.setEnabled"
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

  it("inspects one exact installed package without vault or path authority", async () => {
    const harness = makeHarness({ getActiveVaultId: () => undefined });
    await expect(call(harness, "piPackages.inspect", inspectRequest)).resolves.toEqual({
      apiVersion: 1,
      requestId: inspectRequest.requestId,
      packageId: inspectRequest.packageId,
      status: "ready",
      registryRevision: inspectRequest.expectedRegistryRevision,
      inspection
    });
    expect(harness.inspect).toHaveBeenCalledWith(inspectRequest);

    const swapped = makeHarness({ inspect: (value) => ({
      apiVersion: 1, requestId: value.requestId, packageId: "pkg_ffffffffffffffffffffffff", status: "failed"
    }) });
    await expect(call(swapped, "piPackages.inspect", inspectRequest)).resolves.toEqual({
      apiVersion: 1, requestId: inspectRequest.requestId, packageId: inspectRequest.packageId, status: "failed"
    });
    await expect(call(harness, "piPackages.inspect", { ...inspectRequest, path: "/private/package" })).rejects.toThrow();
  });

  it("restores only the exact pathless receipt binding and fences sender drift", async () => {
    const harness = makeHarness();
    await expect(call(harness, "piPackages.restore", restoreRequest)).resolves.toMatchObject({
      status: "committed",
      requestId: restoreRequest.requestId,
      restoreContextId: restoreRequest.restoreContextId,
      packageId: restoreRequest.packageId,
      version: restoreRequest.version,
      integrity: restoreRequest.integrity,
      pinned: false,
      rollbackTarget: null,
      registry: { revision: restoreRequest.expectedRegistryRevision + 1 }
    });
    expect(harness.restore).toHaveBeenCalledWith(restoreRequest);

    const malformed = makeHarness();
    await expect(call(malformed, "piPackages.restore", { ...restoreRequest, path: "/private/trash" })).rejects.toThrow();
    expect(malformed.restore).not.toHaveBeenCalled();

    let reads = 0;
    const changed = makeHarness({ getActiveVaultId: () => reads++ === 0
      ? "vault_20260728_packages" : "vault_20260728_other" });
    const failed = await call(changed, "piPackages.restore", restoreRequest);
    expect(failed).toEqual({
      apiVersion: 1,
      requestId: restoreRequest.requestId,
      restoreContextId: restoreRequest.restoreContextId,
      packageId: restoreRequest.packageId,
      version: restoreRequest.version,
      integrity: restoreRequest.integrity,
      pinned: restoreRequest.pinned,
      rollbackTarget: restoreRequest.rollbackTarget,
      status: "failed"
    });
    expect(JSON.stringify(failed)).not.toMatch(/path|body|private/u);
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

  it("binds update confirmation to the exact current package, target, integrity, and revision", async () => {
    const harness = makeHarness();
    await expect(call(harness, "piPackages.update", updateRequest)).resolves.toMatchObject({
      requestId: updateRequest.requestId, packageId: updateRequest.packageId,
      targetVersion: updateRequest.targetVersion, targetIntegrity: updateRequest.targetIntegrity,
      status: "committed", registry: { revision: registry.revision + 1 }
    });
    expect(harness.confirmUpdate).toHaveBeenCalledWith(expect.anything(), {
      request: updateRequest, packageName: request.packageName, currentVersion: request.version
    });
    expect(harness.confirmUpdate.mock.invocationCallOrder[0]).toBeLessThan(harness.update.mock.invocationCallOrder[0]!);
  });

  it("confirms only the exact advertised one-step rollback and returns fresh denial state", async () => {
    const updatedRegistry = {
      ...registry, revision: registry.revision + 1,
      packages: [{ ...registry.packages[0], version: updateRequest.targetVersion, canRollback: true,
        rollbackTarget: { rollbackId: rollbackRequest.rollbackId, targetVersion: request.version } }]
    } as const;
    const harness = makeHarness({ summary: () => ({ status: "ready", registry: updatedRegistry }) });
    await expect(call(harness, "piPackages.rollback", rollbackRequest)).resolves.toMatchObject({ status: "committed" });
    expect(harness.confirmRollback).toHaveBeenCalledWith(expect.anything(), {
      request: rollbackRequest, packageName: request.packageName, currentVersion: updateRequest.targetVersion
    });

    const denied = makeHarness({
      summary: () => ({ status: "ready", registry: updatedRegistry }), confirmRollback: () => false
    });
    await expect(call(denied, "piPackages.rollback", rollbackRequest)).resolves.toMatchObject({
      status: "denied", registry: updatedRegistry
    });
    expect(denied.rollback).not.toHaveBeenCalled();
  });

  it("sets pin state without confirmation and rejects pinned update or rollback before confirmation", async () => {
    const harness = makeHarness();
    await expect(call(harness, "piPackages.setPinned", pinRequest)).resolves.toMatchObject({
      status: "committed", pinned: true, registry: { revision: registry.revision + 1,
        packages: [{ pinned: true, canUpdate: false, canRollback: false }] }
    });
    expect(harness.setPinned).toHaveBeenCalledWith(pinRequest);

    const pinnedRegistry = { ...registry, packages: [{ ...registry.packages[0], pinned: true,
      canUpdate: false, canRollback: false, rollbackTarget: null }] } as const;
    const pinned = makeHarness({ summary: () => ({ status: "ready", registry: pinnedRegistry }) });
    await expect(call(pinned, "piPackages.update", updateRequest)).resolves.toMatchObject({ status: "failed" });
    await expect(call(pinned, "piPackages.rollback", { ...rollbackRequest,
      expectedRegistryRevision: pinnedRegistry.revision })).resolves.toMatchObject({ status: "failed" });
    expect(pinned.confirmUpdate).not.toHaveBeenCalled();
    expect(pinned.confirmRollback).not.toHaveBeenCalled();
    expect(pinned.update).not.toHaveBeenCalled();
    expect(pinned.rollback).not.toHaveBeenCalled();
  });

  it("forwards an exact pathless package runtime CAS and fences response identity", async () => {
    const harness = makeHarness();
    await expect(call(harness, "piPackages.setEnabled", enableRequest)).resolves.toMatchObject({
      status: "committed", enabled: true,
      registry: { revision: 5, packages: [{ state: "installed_enabled", canEnable: true }] }
    });
    expect(harness.setEnabled).toHaveBeenCalledWith(enableRequest);

    const drift = makeHarness({ setEnabled: (value) => ({
      apiVersion: 1, requestId: value.requestId, packageId: value.packageId, enabled: false, status: "failed"
    }) });
    await expect(call(drift, "piPackages.setEnabled", enableRequest)).resolves.toMatchObject({ status: "failed", enabled: true });
  });

  it("fails pin closed across malformed identity and vault drift", async () => {
    const malformed = makeHarness();
    await expect(call(malformed, "piPackages.setPinned", { ...pinRequest, path: "/private/package" })).rejects.toThrow();
    expect(malformed.setPinned).not.toHaveBeenCalled();

    let reads = 0;
    const changed = makeHarness({ getActiveVaultId: () => reads++ === 0
      ? "vault_20260728_packages" : "vault_20260728_other" });
    await expect(call(changed, "piPackages.setPinned", pinRequest)).resolves.toEqual({
      apiVersion: 1, requestId: pinRequest.requestId, packageId: pinRequest.packageId,
      pinned: true, status: "failed"
    });
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
