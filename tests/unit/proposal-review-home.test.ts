import { createElement } from "react";
import { act } from "react";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import type { ProposalDecisionResult } from "@pige/contracts";
import type { ConfirmationProposal } from "@pige/schemas";

const globalKeys = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent"] as const;
const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();

afterEach(() => {
  for (const key of globalKeys) {
    const descriptor = originalDescriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originalDescriptors.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Home proposal review", () => {
  it("opens one ready proposal, previews escaped Markdown, and applies it through the durable decision API", async () => {
    const dom = createDom();
    let approveCalls = 0;
    let currentProposal = proposal();
    const api = makePigeApi(() => currentProposal, {
      approve: async () => {
        approveCalls += 1;
        currentProposal = proposalWithState(currentProposal, "applied");
        return { status: "applied", proposal: currentProposal };
      }
    });
    const { container, root } = await mountHome(dom, api);

    expect(container.textContent).toContain("Needs confirmation");
    expect(container.textContent).toContain("Create a grounded review note");
    expect(container.textContent).not.toContain("Additional review 4");

    await clickButton(dom, container, "Show all");
    expect(container.textContent).toContain("Additional review 4");

    await clickButton(dom, container, "Review");
    expect(container.textContent).toContain("Review proposed change");
    expect(container.textContent).toContain("wiki/generated/review-note.md");
    expect(container.textContent).toContain("<em>render as text</em>");
    expect(container.querySelector("em")).toBeNull();

    await act(async () => {
      const approveButton = button(container, "Approve and apply");
      approveButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      approveButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await settle(dom);
    });

    expect(approveCalls).toBe(1);
    expect(container.textContent).toContain("Change applied.");
    expect(button(container, "Approve and apply").disabled).toBe(true);
    expect(button(container, "Reject").disabled).toBe(true);

    await clickButton(dom, container, "Back");
    expect(dom.window.document.activeElement).toBe(container.querySelector('textarea[aria-label="Capture or ask"]'));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("uses unique proposal labels, exposes disclosure state, and restores focus after Back and Escape", async () => {
    const dom = createDom();
    const currentProposal = proposal();
    const { container, root } = await mountHome(dom, makePigeApi(() => currentProposal));

    const cards = Array.from(container.querySelectorAll<HTMLElement>(".proposal-summary-card"));
    const visibleReviewButtons = buttons(container, "Review");
    const cardLabels = cards.map((card) => card.getAttribute("aria-label"));
    const reviewLabels = visibleReviewButtons.map((reviewButton) => reviewButton.getAttribute("aria-label"));
    expect(cards).toHaveLength(3);
    expect(new Set(cardLabels).size).toBe(3);
    expect(new Set(reviewLabels).size).toBe(3);
    for (const [index, card] of cards.entries()) {
      const summary = card.querySelector("strong")?.textContent ?? "";
      expect(cardLabels[index]).toContain(summary);
      expect(reviewLabels[index]).toContain(summary);
    }

    const disclosure = button(container, "Show all");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.getAttribute("aria-controls")).toBe("home-proposal-summary-list");
    expect(container.querySelector("#home-proposal-summary-list")).not.toBeNull();
    await clickElement(dom, disclosure);
    expect(button(container, "Show less").getAttribute("aria-expanded")).toBe("true");

    const invokingLabel = buttons(container, "Review")[0]?.getAttribute("aria-label");
    expect(invokingLabel).toBeTruthy();
    await clickElement(dom, buttons(container, "Review")[0]!);
    await clickButton(dom, container, "Back");
    expect(dom.window.document.activeElement).toBe(buttonByAriaLabel(container, invokingLabel!));

    await clickElement(dom, buttonByAriaLabel(container, invokingLabel!));
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(dom);
    });
    expect(dom.window.document.activeElement).toBe(buttonByAriaLabel(container, invokingLabel!));

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("re-reads and shows a durable approval when apply rejects after the decision commit", async () => {
    const dom = createDom();
    let currentProposal = proposal();
    let getCalls = 0;
    const api = makePigeApi(() => currentProposal, {
      get: async () => {
        getCalls += 1;
        return currentProposal;
      },
      approve: async () => {
        currentProposal = proposalWithState(currentProposal, "approved");
        throw new Error("opaque post-commit approve failure");
      }
    });
    const { container, root } = await mountHome(dom, api);

    await clickButton(dom, container, "Review");
    await clickButton(dom, container, "Approve and apply");

    expect(getCalls).toBe(2);
    expect(container.textContent).toContain("Approved. Finishing the change.");
    expect(container.textContent).not.toContain("Pige could not save this decision.");
    expect(container.textContent).not.toContain("opaque post-commit approve failure");
    expect(button(container, "Approve and apply").disabled).toBe(true);
    expect(button(container, "Reject").disabled).toBe(true);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("re-reads and shows a durable rejection when parent finalization rejects after commit", async () => {
    const dom = createDom();
    let currentProposal = proposal();
    let getCalls = 0;
    const api = makePigeApi(() => currentProposal, {
      get: async () => {
        getCalls += 1;
        return currentProposal;
      },
      reject: async () => {
        currentProposal = proposalWithState(currentProposal, "rejected");
        throw new Error("opaque post-commit reject failure");
      }
    });
    const { container, root } = await mountHome(dom, api);

    await clickButton(dom, container, "Review");
    await clickButton(dom, container, "Reject");

    expect(getCalls).toBe(2);
    expect(container.textContent).toContain("Proposal rejected.");
    expect(container.textContent).not.toContain("Pige could not save this decision.");
    expect(container.textContent).not.toContain("opaque post-commit reject failure");
    expect(button(container, "Approve and apply").disabled).toBe(true);
    expect(button(container, "Reject").disabled).toBe(true);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("fails closed when a rejected decision call cannot be re-read", async () => {
    const dom = createDom();
    const currentProposal = proposal();
    let getCalls = 0;
    const api = makePigeApi(() => currentProposal, {
      get: async () => {
        getCalls += 1;
        if (getCalls > 1) throw new Error("opaque re-read failure");
        return currentProposal;
      },
      approve: async () => {
        throw new Error("opaque decision failure");
      }
    });
    const { container, root } = await mountHome(dom, api);

    await clickButton(dom, container, "Review");
    await clickButton(dom, container, "Approve and apply");

    expect(getCalls).toBe(2);
    expect(container.textContent).toContain(
      "The decision status is unknown. Close and reopen this proposal before taking another action."
    );
    expect(container.textContent).not.toContain("opaque re-read failure");
    expect(container.textContent).not.toContain("opaque decision failure");
    expect(button(container, "Approve and apply").disabled).toBe(true);
    expect(button(container, "Reject").disabled).toBe(true);

    await act(async () => root.unmount());
    dom.window.close();
  });

  it("keeps a localized retry available when the exact proposal remains ready", async () => {
    const dom = createDom();
    const currentProposal = proposal();
    const api = makePigeApi(() => currentProposal, {
      approve: async () => {
        throw new Error("opaque pre-commit failure");
      }
    });
    const { container, root } = await mountHome(dom, api);

    await clickButton(dom, container, "Review");
    await clickButton(dom, container, "Approve and apply");

    expect(container.textContent).toContain("Pige could not save this decision.");
    expect(container.textContent).not.toContain("opaque pre-commit failure");
    expect(button(container, "Approve and apply").disabled).toBe(false);
    expect(button(container, "Reject").disabled).toBe(false);

    await act(async () => root.unmount());
    dom.window.close();
  });
});

interface ProposalApiOverrides {
  readonly get?: () => Promise<ConfirmationProposal>;
  readonly approve?: () => Promise<ProposalDecisionResult>;
  readonly reject?: () => Promise<ProposalDecisionResult>;
}

function proposal(): ConfirmationProposal {
  return {
    id: "proposal_20260712_reviewfixture",
    schemaVersion: 1,
    jobId: "job_20260712_reviewfixture",
    createdAt: "2026-07-12T08:00:00.000Z",
    updatedAt: "2026-07-12T08:00:00.000Z",
    state: "ready",
    trustLevel: "review_required",
    summary: "Create a grounded review note",
    reason: "The selected sources support a durable note.",
    sourceRefs: [{ role: "source", id: "src_20260712_reviewfixture" }],
    targetRefs: [{ role: "page", id: "page_20260712_reviewfixture", path: "wiki/generated/review-note.md" }],
    proposedOperations: [{
      kind: "create",
      path: "wiki/generated/review-note.md",
      content: "# Review note\n\n<em>render as text</em>\n"
    }],
    diffRefs: [],
    warnings: ["Check the proposed title."],
    baseHashes: {},
    requiredPermissionIds: []
  };
}

function proposalWithState(
  current: ConfirmationProposal,
  state: "approved" | "applied" | "rejected" | "conflicted"
): ConfirmationProposal {
  return {
    ...current,
    state,
    updatedAt: "2026-07-12T08:05:00.000Z",
    decision: {
      decidedAt: "2026-07-12T08:05:00.000Z",
      decidedBy: "user"
    }
  };
}

function makePigeApi(readCurrentProposal: () => ConfirmationProposal, overrides: ProposalApiOverrides = {}): object {
  return {
    getHealth: async () => ({ status: "ok" }),
    window: {
      current: async () => ({ mode: "compact", sidebarOpen: false, alwaysOnTop: false })
    },
    settings: {
      appearance: async () => ({ locale: "en", availableLocales: ["en"] })
    },
    system: {
      toolchainHealth: async () => ({ status: "ready" })
    },
    vault: {
      onboardingStatus: async () => ({
        state: "ready",
        hasDefaultModel: false,
        activeVault: { vaultId: "vault_review_fixture", name: "Review Vault" }
      }),
      recent: async () => []
    },
    backup: {
      status: async () => null
    },
    agent: {
      runtimeStatus: async () => null
    },
    jobs: {
      list: async () => ({
        scannedAt: "2026-07-12T08:00:00.000Z",
        activeVaultId: "vault_review_fixture",
        total: readCurrentProposal().state === "ready" ? 1 : 0,
        invalidJobCount: 0,
        jobs: readCurrentProposal().state === "ready" ? [{
          id: "job_20260712_reviewfixture",
          class: "agent_ingest",
          state: "awaiting_review",
          message: "Review ready",
          createdAt: "2026-07-12T08:00:00.000Z",
          updatedAt: "2026-07-12T08:00:00.000Z"
        }] : []
      })
    },
    proposals: {
      list: async () => ({
        scannedAt: "2026-07-12T08:00:00.000Z",
        activeVaultId: "vault_review_fixture",
        total: readCurrentProposal().state === "ready" ? 4 : 0,
        invalidProposalCount: 0,
        proposals: readCurrentProposal().state === "ready"
          ? Array.from({ length: 4 }, (_, index) => proposalSummary(readCurrentProposal(), index))
          : []
      }),
      get: async () => ({ proposal: await (overrides.get?.() ?? Promise.resolve(readCurrentProposal())) }),
      approve: overrides.approve ?? (async () => ({ status: "approved", proposal: readCurrentProposal() })),
      reject: overrides.reject ?? (async () => ({ status: "rejected", proposal: readCurrentProposal() }))
    }
  };
}

function proposalSummary(current: ConfirmationProposal, index: number): object {
  return {
    id: index === 0 ? current.id : `proposal_20260712_additional${index + 1}`,
    state: current.state,
    trustLevel: current.trustLevel,
    jobId: current.jobId,
    summary: index === 0 ? current.summary : `Additional review ${index + 1}`,
    reason: current.reason,
    operationCount: current.proposedOperations.length,
    warningCount: current.warnings.length,
    targetCount: current.targetRefs.length,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt
  };
}

function createDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://pige.test"
  });
  installDom(dom);
  return dom;
}

async function mountHome(dom: JSDOM, api: object): Promise<{
  readonly container: HTMLElement;
  readonly root: { unmount: () => void };
}> {
  Object.defineProperty(dom.window, "pige", { configurable: true, value: api });
  const [{ createRoot }, { App }] = await Promise.all([
    import("react-dom/client"),
    import("../../apps/desktop/src/renderer/src/App")
  ]);
  const container = requireElement(dom.window.document.getElementById("root"));
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(App));
    await settle(dom);
  });
  return { container, root };
}

function installDom(dom: JSDOM): void {
  for (const key of globalKeys) originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const values: Record<(typeof globalKeys)[number], unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent
  };
  for (const key of globalKeys) {
    Object.defineProperty(globalThis, key, { configurable: true, value: values[key], writable: true });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true
  });
}

async function clickButton(dom: JSDOM, container: HTMLElement, label: string): Promise<void> {
  await clickElement(dom, button(container, label));
}

async function clickElement(dom: JSDOM, element: HTMLButtonElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await settle(dom);
  });
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button"))
    .filter((candidate) => candidate.textContent === label)
    .map((candidate) => candidate as HTMLButtonElement);
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = buttons(container, label)[0];
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

function buttonByAriaLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.getAttribute("aria-label") === label);
  if (!match) throw new Error(`Button aria-label not found: ${label}`);
  return match;
}

function requireElement(element: HTMLElement | null): HTMLElement {
  if (!element) throw new Error("Expected test container.");
  return element;
}

async function settle(dom: JSDOM): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}
