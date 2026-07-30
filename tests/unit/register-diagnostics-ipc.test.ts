import { describe, expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { registerDiagnosticsIpc } from "../../apps/desktop/src/main/register-diagnostics-ipc";

type Handler = (event: IpcMainInvokeEvent, input?: unknown) => unknown;

const workflow = {
  apiVersion: 1 as const,
  revision: 8,
  scopeContextId: `diagctx_${"a".repeat(48)}`,
  activeVaultId: "vault_20260730_diagnostics",
  localOnly: true as const,
  ownedArtifactCount: 2
};
const exportRequest = {
  apiVersion: 1 as const,
  requestId: "diagexportreq_abcdefghijklmnop",
  previewId: `supportpreview_${"b".repeat(48)}`,
  scopeContextId: workflow.scopeContextId,
  expectedRevision: workflow.revision
};

function harness(options: { trusted?: boolean; destination?: string; revision?: number; replay?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const sender = {} as WebContents;
  const selected = options.destination;
  const summary = { ...workflow, revision: options.revision ?? workflow.revision };
  const start = vi.fn((request: typeof exportRequest) => ({ ...request, status: "started" as const, workflow: summary }));
  const chooseDestination = vi.fn(async () => selected);
  registerDiagnosticsIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as Handler) } as Pick<IpcMain, "handle">,
    isTrustedSender: () => options.trusted ?? true,
    health: () => ({ status: "ok", checkedAt: "2026-07-30T00:00:00.000Z", localOnly: true, recentErrorCount: 0, checks: [] }),
    workflowSummary: () => summary,
    preview: (request) => ({
      ...request, previewId: exportRequest.previewId, generatedAt: "2026-07-30T00:00:00.000Z",
      localOnly: true, estimatedBytes: 100, scopeContextId: summary.scopeContextId,
      expectedRevision: summary.revision, activeVaultId: summary.activeVaultId,
      includedCategories: [{ id: "app_runtime", label: "App", included: true, reason: "Runtime facts." }],
      excludedCategories: [{ id: "secrets", label: "Secrets", included: false, reason: "Never included." }],
      privacyWarnings: ["Local only."]
    }),
    chooseDestination,
    replayStart: (request) => options.replay ? ({ ...request, status: "started", workflow: summary }) : undefined,
    start,
    cancel: (request) => ({ ...request, status: "accepted", workflow: summary }),
    retry: (request) => ({ ...request, status: "accepted", workflow: summary }),
    clear: (request) => ({ ...request, status: "busy", workflow: summary,
      health: { status: "ok", checkedAt: "2026-07-30T00:00:00.000Z", localOnly: true, recentErrorCount: 0, checks: [] } })
  });
  const event = { sender } as IpcMainInvokeEvent;
  return { handlers, event, start, chooseDestination };
}

describe("diagnostics IPC", () => {
  it("keeps the renderer pathless while Main owns destination selection", async () => {
    const destination = "/private/main-owned/support.json";
    const app = harness({ destination });
    const result = await app.handlers.get("diagnostics.exportSupportBundle")!(app.event, exportRequest);
    expect(app.chooseDestination).toHaveBeenCalledWith(app.event.sender);
    expect(app.start).toHaveBeenCalledWith(exportRequest, destination);
    expect(JSON.stringify(result)).not.toContain(destination);
  });

  it("returns a pathless cancellation when the picker closes", async () => {
    const app = harness();
    const result = await app.handlers.get("diagnostics.exportSupportBundle")!(app.event, exportRequest);
    expect(result).toEqual({ ...exportRequest, status: "canceled", workflow });
    expect(app.start).not.toHaveBeenCalled();
  });

  it("replays the exact durable request without selecting or writing again", async () => {
    const app = harness({ replay: true, destination: "/tmp/unused.json", revision: workflow.revision + 1 });
    expect(await app.handlers.get("diagnostics.exportSupportBundle")!(app.event, exportRequest))
      .toEqual({ ...exportRequest, status: "started", workflow: { ...workflow, revision: workflow.revision + 1 } });
    expect(app.chooseDestination).not.toHaveBeenCalled();
    expect(app.start).not.toHaveBeenCalled();
  });

  it("rejects stale or untrusted exports before opening the picker", async () => {
    const stale = harness({ destination: "/tmp/support.json", revision: workflow.revision + 1 });
    expect(await stale.handlers.get("diagnostics.exportSupportBundle")!(stale.event, exportRequest))
      .toEqual({ ...exportRequest, status: "stale", workflow: { ...workflow, revision: workflow.revision + 1 } });
    expect(stale.chooseDestination).not.toHaveBeenCalled();

    const untrusted = harness({ trusted: false, destination: "/tmp/support.json" });
    expect(await untrusted.handlers.get("diagnostics.exportSupportBundle")!(untrusted.event, exportRequest))
      .toEqual({ ...exportRequest, status: "failed" });
    expect(untrusted.chooseDestination).not.toHaveBeenCalled();
  });
});
