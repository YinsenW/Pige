import { createElement } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HighRiskConfirmationDialog } from "../../apps/desktop/src/renderer/src/components/HighRiskConfirmationDialog";
import { TaskExecutionInteractionStatus } from "../../apps/desktop/src/renderer/src/components/TaskExecutionInteraction";
import enMessages from "../../apps/desktop/src/renderer/src/locales/en/messages.json";
import type { TaskInteractionChangedEvent, TaskInteractionOpenRequest } from "@pige/contracts";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
const t = (key: string): string => (enMessages as Record<string, string>)[key] ?? key;

afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("reviewed task execution UI", () => {
  it("shows the exact safe reviewed-plan summary in the existing confirmation dialog", async () => {
    const dom = installDom();
    const mounted = await mount(dom, createElement(HighRiskConfirmationDialog, {
      confirmation: {
        apiVersion: 1,
        confirmationId: "confirm_20260727_aaaaaaaaaaaaaaaa",
        effect: "reviewed_execution_plan",
        presentation: {
          action: "execute_reviewed_plan",
          target: "local_toolchain",
          subject: {
            kind: "reviewed_execution_plan",
            value: "Feishu CLI setup",
            plan: {
              planId: "plan_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              toolLabel: "Feishu CLI",
              resolvedVersion: "1.2.3",
              sourceOrigin: "https://registry.npmjs.org",
              integrities: [`sha256:${"a".repeat(64)}`],
              stepCount: 3,
              destinationRoots: ["Pige managed tools"],
              skillCount: 2,
              targetAgents: ["Codex", "Claude Code"],
              requiresBrowserOAuth: true
            }
          }
        },
        owner: { kind: "agent_turn", clientTurnId: "turn_20260727_planconfirm01" }
      },
      resolving: false,
      error: false,
      onResolve: vi.fn(),
      t
    }));
    expect(mounted.container.textContent).toContain("Allow this task plan?");
    expect(mounted.container.textContent).toContain("Feishu CLI 1.2.3");
    expect(mounted.container.textContent).toContain("3 fixed steps");
    expect(mounted.container.textContent).toContain("Browser sign-in required");
    expect(buttonNamed(mounted.container, "Allow plan")).toBeDefined();
    expect(mounted.container.textContent).not.toContain("device_code");
    expect(mounted.container.textContent).not.toContain("/Users/");
    await unmount(dom, mounted.root);
  });

  it("shows only the reviewed External/Web Skill identity and exact HTTPS origin", async () => {
    const dom = installDom();
    const onResolve = vi.fn();
    const mounted = await mount(dom, createElement(HighRiskConfirmationDialog, {
      confirmation: {
        apiVersion: 1,
        confirmationId: "confirm_20260729_aaaaaaaaaaaaaaaa",
        effect: "external_web_skill_https_read",
        presentation: {
          action: "read_external_web",
          target: "reviewed_https_origin",
          subject: {
            kind: "external_web_skill",
            value: "External Research",
            version: "1.2.0",
            origin: "https://api.example.com",
            capability: "external_network",
            dataBoundary: "network"
          }
        },
        owner: { kind: "agent_turn", clientTurnId: "turn_20260729_externalweb01" }
      },
      resolving: false,
      error: false,
      onResolve,
      t
    }));
    for (const value of ["Read from an external website", "Reviewed HTTPS origin",
      "External Research · v1.2.0", "https://api.example.com", "External network", "Network"]) {
      expect(mounted.container.textContent).toContain(value);
    }
    expect(mounted.container.textContent).not.toContain("/research");
    expect(mounted.container.textContent).not.toContain("token=");
    expect(mounted.container.textContent).not.toContain("pige_readonly_https_v1");
    await act(async () => buttonNamed(mounted.container, "Allow this effect")?.click());
    expect(onResolve).toHaveBeenCalledWith("allow");
    await unmount(dom, mounted.root);
  });

  it("shows only the reviewed Full Access authority boundary in the global confirmation", async () => {
    const dom = installDom();
    const onResolve = vi.fn();
    const mounted = await mount(dom, createElement(HighRiskConfirmationDialog, {
      confirmation: {
        apiVersion: 1,
        confirmationId: "confirm_20260729_fullaccess00000001",
        effect: "authority_boundary_change",
        presentation: {
          action: "change_authority_boundary",
          target: "authority_boundary",
          subject: {
            kind: "display_name",
            value: "YOLO Full Access"
          }
        },
        owner: { kind: "agent_turn", clientTurnId: "turn_20260729_fullaccess01" }
      },
      resolving: false,
      error: false,
      onResolve,
      t
    }));
    for (const value of ["Change an authority boundary", "Authority boundary", "YOLO Full Access"]) {
      expect(mounted.container.textContent).toContain(value);
    }
    expect(mounted.container.textContent).not.toContain("grantContextId");
    expect(mounted.container.textContent).not.toContain("hardBoundariesAcknowledged");
    await act(async () => buttonNamed(mounted.container, "Allow this effect")?.click());
    expect(onResolve).toHaveBeenCalledWith("allow");
    await unmount(dom, mounted.root);
  });

  it("opens only the exact typed browser interaction and clears the Home status after Main accepts it", async () => {
    const dom = installDom();
    const requests: TaskInteractionOpenRequest[] = [];
    let listener: ((event: TaskInteractionChangedEvent) => void) | undefined;
    Object.defineProperty(dom.window, "pige", {
      configurable: true,
      value: {
        taskExecution: {
          interaction: async () => interaction(),
          openInteraction: async (request: TaskInteractionOpenRequest) => {
            requests.push(request);
            return { status: "opened", revision: 8 } as const;
          },
          onInteractionChanged: (next: (event: TaskInteractionChangedEvent) => void) => {
            listener = next;
            return () => { listener = undefined; };
          }
        }
      }
    });
    const mounted = await mount(dom, createElement(TaskExecutionInteractionStatus, { t }));
    await waitFor(dom, () => buttonNamed(mounted.container, "Open browser") !== undefined);
    expect(mounted.container.textContent).toContain("https://accounts.feishu.cn");
    expect(mounted.container.textContent).toContain("plan_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa · 2");
    expect(mounted.container.textContent).not.toContain("private-device-code");
    await act(async () => {
      buttonNamed(mounted.container, "Open browser")?.click();
      await settle(dom);
    });
    expect(requests).toEqual([{
      interactionId: "interaction_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      planId: "plan_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      jobId: "job_20260727_oauthstep",
      stepOrdinal: 2,
      expectedRevision: 7
    }]);
    expect(buttonNamed(mounted.container, "Open browser")).toBeUndefined();
    expect(listener).toBeDefined();
    await unmount(dom, mounted.root);
  });
});

function interaction(): TaskInteractionChangedEvent {
  return {
    status: "browser_oauth",
    interactionId: "interaction_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    planId: "plan_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    jobId: "job_20260727_oauthstep",
    stepOrdinal: 2,
    origin: "https://accounts.feishu.cn",
    revision: 7
  };
}

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/" });
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => callback(Date.now()), 0);
  for (const key of globalKeys) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return dom;
}

async function mount(dom: JSDOM, element: React.ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
    await settle(dom);
  });
  return { root, container };
}

async function unmount(dom: JSDOM, root: Root): Promise<void> {
  await act(async () => {
    root.unmount();
    await settle(dom);
  });
  dom.window.close();
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === name);
}

async function waitFor(dom: JSDOM, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await act(async () => settle(dom));
  }
  throw new Error("Timed out waiting for task execution UI.");
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
