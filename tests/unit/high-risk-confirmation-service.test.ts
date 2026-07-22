import { describe, expect, it, vi } from "vitest";
import {
  HighRiskConfirmationService,
  type HighRiskConfirmationEffectResult
} from "../../apps/desktop/src/main/services/high-risk-confirmation-service";

const TURN_OWNER = { kind: "agent_turn" as const, clientTurnId: "turn_20260722_abcdefghijklmnop" };
const OPERATION_OWNER = { kind: "operation" as const, operationId: "op_20260722_abcdefgh" };
const SHELL = {
  confirmationId: "confirm_20260722_abcdefghijklmnop",
  effect: "arbitrary_shell" as const,
  presentation: {
    action: "run_shell_command" as const,
    target: "local_system" as const,
    subject: { kind: "executable_name" as const, value: "lark-cli" }
  },
  owner: TURN_OWNER
};
const DELETE = {
  confirmationId: "confirm_20260722_qrstuvwxyzabcdef",
  effect: "irreversible_delete" as const,
  presentation: {
    action: "delete_permanently" as const,
    target: "vault_item" as const,
    subject: { kind: "display_name" as const, value: "Archived note" }
  },
  owner: OPERATION_OWNER
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("HighRiskConfirmationService", () => {
  it("owns one pending effect and restores only the exact stable identity", () => {
    const service = new HighRiskConfirmationService();
    const events: unknown[] = [];
    service.onChanged((event) => events.push(event));

    const first = service.register(SHELL, () => "committed");
    expect(first).toMatchObject({ status: "registered", revision: 1, confirmation: SHELL });
    expect(service.pending()).toEqual({
      apiVersion: 1,
      status: "pending",
      revision: 1,
      confirmation: { apiVersion: 1, ...SHELL }
    });
    expect(service.register(DELETE, () => "committed")).toMatchObject({
      status: "busy",
      revision: 1,
      confirmation: { confirmationId: SHELL.confirmationId }
    });
    expect(service.register({
      ...SHELL,
      presentation: {
        ...SHELL.presentation,
        subject: { kind: "executable_name", value: "node" }
      }
    }, () => "committed")).toMatchObject({ status: "busy", revision: 1 });
    expect(service.register(SHELL, () => "committed")).toMatchObject({ status: "restored", revision: 1 });
    expect(events).toHaveLength(1);
  });

  it("fails registration closed when a display subject is not renderer-safe", () => {
    const service = new HighRiskConfirmationService();
    expect(() => service.register({
      ...SHELL,
      presentation: {
        action: "run_shell_command",
        target: "local_system",
        subject: { kind: "executable_name", value: "rm -rf private-data" }
      }
    } as typeof SHELL, () => "committed")).toThrow();
    expect(service.pending()).toEqual({ apiVersion: 1, status: "none", revision: 0 });
  });

  it("single-flights the same decision and never invokes an opposite concurrent decision", async () => {
    const service = new HighRiskConfirmationService();
    const gate = deferred<HighRiskConfirmationEffectResult>();
    const resolver = vi.fn(() => gate.promise);
    const registered = service.register(SHELL, resolver);
    const request = {
      apiVersion: 1 as const,
      confirmationId: SHELL.confirmationId,
      expectedRevision: registered.revision,
      decision: "allow" as const
    };

    const first = service.resolve(request);
    const joined = service.resolve(request);
    await expect(service.resolve({ ...request, decision: "deny" })).resolves.toMatchObject({ status: "stale" });
    expect(service.register(SHELL, () => "committed").status).toBe("busy");
    expect(resolver).toHaveBeenCalledTimes(1);

    gate.resolve("committed");
    await expect(first).resolves.toMatchObject({ status: "committed", decision: "allow", revision: 2 });
    await expect(joined).resolves.toMatchObject({ status: "committed", decision: "allow", revision: 2 });
    await expect(service.resolve(request)).resolves.toMatchObject({ status: "already_resolved", decision: "allow" });
    await expect(service.resolve({ ...request, decision: "deny" })).resolves.toEqual({
      apiVersion: 1,
      status: "stale",
      current: { apiVersion: 1, status: "none", revision: 2 }
    });
    expect(service.register(SHELL, resolver)).toEqual({
      status: "already_resolved",
      revision: 2,
      decision: "allow"
    });
    expect(service.pending()).toEqual({ apiVersion: 1, status: "none", revision: 2 });
  });

  it("keeps a failed effect pending and withdraws only the exact owner revision", async () => {
    const service = new HighRiskConfirmationService();
    const registered = service.register(SHELL, () => "failed");
    await expect(service.resolve({
      apiVersion: 1,
      confirmationId: SHELL.confirmationId,
      expectedRevision: registered.revision,
      decision: "allow"
    })).resolves.toMatchObject({ status: "failed", revision: 1 });
    expect(service.pending().status).toBe("pending");
    expect(service.withdraw({
      confirmationId: SHELL.confirmationId,
      expectedRevision: registered.revision,
      owner: OPERATION_OWNER
    })).toBe("stale");
    expect(service.withdraw({
      confirmationId: SHELL.confirmationId,
      expectedRevision: registered.revision,
      owner: TURN_OWNER
    })).toBe("withdrawn");
    expect(service.pending()).toEqual({ apiVersion: 1, status: "none", revision: 2 });

    const successor = service.register(DELETE, () => "committed");
    expect(service.withdraw({
      confirmationId: SHELL.confirmationId,
      expectedRevision: registered.revision,
      owner: TURN_OWNER
    })).toBe("not_found");
    expect(service.withdraw({
      confirmationId: DELETE.confirmationId,
      expectedRevision: registered.revision,
      owner: OPERATION_OWNER
    })).toBe("stale");
    expect(service.pending()).toMatchObject({ status: "pending", revision: successor.revision });
  });

  it("does not let withdrawal race an effect already claimed for resolution", async () => {
    const service = new HighRiskConfirmationService();
    const gate = deferred<HighRiskConfirmationEffectResult>();
    const registered = service.register(SHELL, () => gate.promise);
    const resolving = service.resolve({
      apiVersion: 1,
      confirmationId: SHELL.confirmationId,
      expectedRevision: registered.revision,
      decision: "deny"
    });
    expect(service.withdraw({
      confirmationId: SHELL.confirmationId,
      expectedRevision: registered.revision,
      owner: TURN_OWNER
    })).toBe("resolving");
    gate.resolve("committed");
    await expect(resolving).resolves.toMatchObject({ status: "committed", decision: "deny" });
  });
});
