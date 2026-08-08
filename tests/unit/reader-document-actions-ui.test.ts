import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReaderDocumentActions,
  type ReaderDocumentActionLabels,
  type ReaderDocumentTrashOutcome
} from "../../apps/desktop/src/renderer/src/components/ReaderDocumentActions";
import type { ReaderNoteMergeOutcome, ReaderNoteMergeTarget } from "../../apps/desktop/src/renderer/src/components/ReaderNoteMergeDialog";

const globals = ["window", "document", "navigator", "Node", "HTMLElement", "Event", "MouseEvent", "KeyboardEvent"] as const;
const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
const labels: ReaderDocumentActionLabels = {
  more: "More actions",
  menu: "Document actions",
  moveToTrash: "Move to Trash",
  title: "Move this note to Trash?",
  description: "You can restore it from Activity with Undo.",
  cancel: "Cancel",
  confirm: "Move to Trash",
  pending: "Moving…",
  failed: "The note was not moved."
};
const mergeLabels = {
  title: "Merge notes",
  description: "The current note stays.",
  survivor: "Keep:",
  target: "Merge this note into it",
  loading: "Loading notes…",
  empty: "No notes",
  cancel: "Cancel",
  confirm: "Merge notes",
  pending: "Merging…",
  failed: "Both notes remain unchanged."
};

afterEach(() => {
  for (const key of globals) {
    const descriptor = originals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("Reader document actions", () => {
  it("renders no action without exact owner eligibility", async () => {
    const harness = await mount({ canMoveToTrash: false, onMoveToTrash: vi.fn() });
    expect(harness.container.textContent).toBe("");
    expect(harness.container.querySelector("button")).toBeNull();
    await harness.unmount();
  });

  it("requires confirmation, single-flights, and reports a retained outcome without leaving Reader", async () => {
    const pending = deferred<ReaderDocumentTrashOutcome>();
    const onMoveToTrash = vi.fn(async () => pending.promise);
    const harness = await mount({ canMoveToTrash: true, onMoveToTrash });
    const trigger = button(harness.container, "More actions");
    trigger.focus();
    await click(harness.dom, trigger);
    expect(harness.container.querySelector('[role="menu"]')).not.toBeNull();
    await click(harness.dom, button(harness.container, "Move to Trash"));
    expect(harness.container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(harness.dom.window.document.activeElement).toBe(button(harness.container, "Cancel"));

    const confirm = button(harness.container, "Move to Trash");
    await act(async () => {
      confirm.click();
      confirm.click();
      await settle(harness.dom);
    });
    expect(onMoveToTrash).toHaveBeenCalledTimes(1);
    expect(confirm.disabled).toBe(true);

    await act(async () => {
      pending.resolve("retained");
      await pending.promise;
      await settle(harness.dom);
    });
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toBe(labels.failed);
    expect(harness.container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(harness.dom.window.document.activeElement).toBe(button(harness.container, "Cancel"));

    await act(async () => {
      harness.container.querySelector('[role="alertdialog"]')?.dispatchEvent(
        new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      await settle(harness.dom);
    });
    expect(harness.container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("keeps the document action menu keyboard navigable and wraps focus", async () => {
    const harness = await mount({
      canMoveToTrash: true,
      canMerge: true,
      onMoveToTrash: vi.fn(async () => "retained" as const),
      onLoadMergeTargets: vi.fn(async () => []),
      onMerge: vi.fn(async () => ({ status: "retained" }))
    });
    const trigger = button(harness.container, "More actions");
    await click(harness.dom, trigger);
    const items = Array.from(harness.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(items).toHaveLength(2);
    items[0]?.focus();
    await act(async () => {
      items[0]?.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await settle(harness.dom);
    });
    expect(harness.dom.window.document.activeElement).toBe(items[1]);
    await act(async () => {
      items[1]?.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await settle(harness.dom);
    });
    expect(harness.dom.window.document.activeElement).toBe(items[0]);
    await act(async () => {
      items[0]?.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
      await settle(harness.dom);
    });
    expect(harness.dom.window.document.activeElement).toBe(items[1]);
    await act(async () => {
      items[1]?.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
      await settle(harness.dom);
    });
    expect(harness.dom.window.document.activeElement).toBe(items[0]);
    await act(async () => {
      items[0]?.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      await settle(harness.dom);
    });
    expect(harness.dom.window.document.activeElement).toBe(items[1]);
    await act(async () => {
      items[1]?.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      await settle(harness.dom);
    });
    expect(harness.dom.window.document.activeElement).toBe(items[0]);
    await act(async () => {
      items[0]?.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(harness.dom);
    });
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });

  it("fences an old committed result after the Reader identity changes", async () => {
    const pending = deferred<ReaderDocumentTrashOutcome>();
    const onMoveToTrash = vi.fn(async () => pending.promise);
    const onCommitted = vi.fn();
    const harness = await mount({ canMoveToTrash: true, onMoveToTrash, onCommitted });
    await click(harness.dom, button(harness.container, "More actions"));
    await click(harness.dom, button(harness.container, "Move to Trash"));
    await click(harness.dom, button(harness.container, "Move to Trash"));

    await act(async () => {
      harness.root.render(createElement(ReaderDocumentActions, {
        ownerIdentity: "vault_1:page_2:render_2:revision_2",
        canMoveToTrash: true,
        canMerge: false,
        currentTitle: "Current note",
        labels,
        mergeLabels,
        onMoveToTrash,
        onLoadMergeTargets: async () => [],
        onMerge: async () => ({ status: "retained" }),
        onCommitted,
        onMergeCommitted: () => undefined
      }));
      await settle(harness.dom);
    });
    await act(async () => {
      pending.resolve("committed");
      await pending.promise;
      await settle(harness.dom);
    });

    expect(onCommitted).not.toHaveBeenCalled();
    expect(harness.container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(button(harness.container, "More actions").disabled).toBe(false);
    await harness.unmount();
  });

  it("hands a committed result to the Reader owner exactly once", async () => {
    const onCommitted = vi.fn();
    const harness = await mount({
      canMoveToTrash: true,
      onMoveToTrash: vi.fn(async () => "committed" as const),
      onCommitted
    });
    await click(harness.dom, button(harness.container, "More actions"));
    await click(harness.dom, button(harness.container, "Move to Trash"));
    await click(harness.dom, button(harness.container, "Move to Trash"));
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(harness.container.querySelector('[role="alertdialog"]')).toBeNull();
    await harness.unmount();
  });

  it("loads safe targets, single-flights merge, and retains the selected target on failure", async () => {
    const pending = deferred<ReaderNoteMergeOutcome>();
    const targets: readonly ReaderNoteMergeTarget[] = [{
      pageId: "page_target",
      title: "Target note",
      updatedAt: "2026-07-30T09:00:00.000Z"
    }];
    const onMerge = vi.fn(async () => pending.promise);
    const harness = await mount({
      canMoveToTrash: false,
      canMerge: true,
      onMoveToTrash: vi.fn(),
      onLoadMergeTargets: vi.fn(async () => targets),
      onMerge
    });
    const trigger = button(harness.container, "More actions");
    trigger.focus();
    await click(harness.dom, trigger);
    await click(harness.dom, button(harness.container, "Merge notes"));
    await settle(harness.dom);
    expect(harness.container.querySelector("select")?.value).toBe("page_target");
    const confirm = button(harness.container, "Merge notes");
    await act(async () => {
      confirm.click();
      confirm.click();
      await settle(harness.dom);
    });
    expect(onMerge).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ status: "retained" });
      await pending.promise;
      await settle(harness.dom);
    });
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toBe(mergeLabels.failed);
    expect(harness.container.querySelector("select")?.value).toBe("page_target");
    expect(harness.dom.window.document.activeElement).toBe(harness.container.querySelector("select"));
    await act(async () => {
      harness.container.querySelector('[role="alertdialog"]')?.dispatchEvent(
        new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
      await settle(harness.dom);
    });
    expect(harness.dom.window.document.activeElement).toBe(trigger);
    await harness.unmount();
  });
});

async function mount(props: {
  readonly canMoveToTrash: boolean;
  readonly canMerge?: boolean;
  readonly onMoveToTrash: () => Promise<ReaderDocumentTrashOutcome>;
  readonly onLoadMergeTargets?: () => Promise<readonly ReaderNoteMergeTarget[]>;
  readonly onMerge?: (target: ReaderNoteMergeTarget) => Promise<ReaderNoteMergeOutcome>;
  readonly onCommitted?: () => void;
}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/" });
  installDom(dom);
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await act(async () => {
    root.render(createElement(ReaderDocumentActions, {
      ownerIdentity: "vault_1:page_1:render_1:revision_1",
      canMoveToTrash: props.canMoveToTrash,
      canMerge: props.canMerge ?? false,
      currentTitle: "Current note",
      labels,
      mergeLabels,
      onMoveToTrash: props.onMoveToTrash,
      onLoadMergeTargets: props.onLoadMergeTargets ?? (async () => []),
      onMerge: props.onMerge ?? (async () => ({ status: "retained" })),
      onCommitted: props.onCommitted ?? (() => undefined),
      onMergeCommitted: () => undefined
    }));
    await settle(dom);
  });
  return {
    dom,
    root,
    container: dom.window.document.querySelector("#root")!,
    unmount: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    }
  };
}

function button(container: Element, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
    candidate.textContent === label || candidate.getAttribute("aria-label") === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function click(dom: JSDOM, element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await settle(dom);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function settle(dom: JSDOM): Promise<void> {
  await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
}

function installDom(dom: JSDOM): void {
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(dom.window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(0), 0)
  });
}
