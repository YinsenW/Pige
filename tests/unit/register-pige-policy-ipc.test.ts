import type { IpcMainInvokeEvent, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { PigePolicyPreparedUpdate } from "../../apps/desktop/src/main/services/pige-policy-service";
import { registerPigePolicyIpc } from "../../apps/desktop/src/main/register-pige-policy-ipc";

const markdown = `# PIGE

## Vault Identity
## Page Types
## Naming Rules
## Frontmatter Rules
## Link Rules
## Source Handling Rules
## Agent Review Rules
## Prompt Injection Rules
`;
const summary = {
  apiVersion: 1 as const,
  activeVaultId: "vault_20260801_abcdef",
  revision: `pigepolicyrev_${"a".repeat(64)}` as const,
  markdown,
  requiredSections: ["Vault Identity", "Page Types", "Naming Rules", "Frontmatter Rules", "Link Rules", "Source Handling Rules", "Agent Review Rules", "Prompt Injection Rules"],
  canEdit: true as const
};
const request = {
  apiVersion: 1 as const,
  requestId: "pigepolicyreq_abcdefghijklmnop",
  activeVaultId: summary.activeVaultId,
  expectedRevision: summary.revision,
  markdown: markdown.replace("## Link Rules", "## Link Rules\n\n- Keep links stable.")
};

function harness(trusted = true) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const prepared: PigePolicyPreparedUpdate = {
    status: "ready",
    request,
    vaultPath: "/private/vault",
    beforeBytes: Buffer.from(markdown),
    afterBytes: Buffer.from(request.markdown)
  };
  const prepareUpdate = vi.fn(() => prepared);
  const confirmUpdate = vi.fn(async () => true);
  const commitUpdate = vi.fn(() => ({
    apiVersion: 1 as const,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    status: "updated" as const,
    summary: { ...summary, revision: `pigepolicyrev_${"b".repeat(64)}`, markdown: request.markdown },
    operationId: `op_20260801_${"a".repeat(48)}`
  }));
  registerPigePolicyIpc({
    ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler as (...args: any[]) => unknown); } },
    isTrustedSender: () => trusted,
    summary: () => summary,
    prepareUpdate,
    confirmUpdate,
    commitUpdate,
    denied: () => ({ apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId, status: "denied", summary }),
    failed: () => ({ apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId, status: "failed" })
  });
  const event = { sender: {} as WebContents } as IpcMainInvokeEvent;
  return { handlers, event, prepared, prepareUpdate, confirmUpdate, commitUpdate };
}

describe("registerPigePolicyIpc", () => {
  it("projects only the strict active-vault policy summary", async () => {
    const value = harness();
    expect(value.handlers.get("settings.pigePolicy")!(value.event)).toEqual(summary);
    expect(JSON.stringify(await value.handlers.get("settings.pigePolicy")!(value.event))).not.toContain("/private/vault");
  });

  it("validates before confirmation and commits only after allow", async () => {
    const value = harness();
    await expect(value.handlers.get("settings.updatePigePolicy")!(value.event, request)).resolves.toMatchObject({ status: "updated" });
    expect(value.prepareUpdate).toHaveBeenCalledWith(request);
    expect(value.confirmUpdate).toHaveBeenCalledWith(value.event.sender, value.prepared);
    expect(value.commitUpdate).toHaveBeenCalledWith(value.prepared);
  });

  it("does not confirm or commit invalid drafts and retains denial as authoritative", async () => {
    const invalid = harness();
    invalid.prepareUpdate.mockReturnValue({ apiVersion: 1, requestId: request.requestId, activeVaultId: request.activeVaultId, status: "invalid", summary, issues: ["missing_required_section"] });
    await expect(invalid.handlers.get("settings.updatePigePolicy")!(invalid.event, request)).resolves.toMatchObject({ status: "invalid" });
    expect(invalid.confirmUpdate).not.toHaveBeenCalled();
    expect(invalid.commitUpdate).not.toHaveBeenCalled();

    const denied = harness();
    denied.confirmUpdate.mockResolvedValue(false);
    await expect(denied.handlers.get("settings.updatePigePolicy")!(denied.event, request)).resolves.toMatchObject({ status: "denied", summary });
    expect(denied.commitUpdate).not.toHaveBeenCalled();
  });

  it("rejects untrusted and malformed requests before owner calls", async () => {
    const untrusted = harness(false);
    expect(() => untrusted.handlers.get("settings.pigePolicy")!(untrusted.event)).toThrow("Untrusted");
    await expect(untrusted.handlers.get("settings.updatePigePolicy")!(untrusted.event, request)).rejects.toThrow("Untrusted");
    const value = harness();
    await expect(value.handlers.get("settings.updatePigePolicy")!(value.event, { ...request, markdown: "# PIGE".repeat(40_000) })).rejects.toThrow();
    expect(value.prepareUpdate).not.toHaveBeenCalled();
  });
});
