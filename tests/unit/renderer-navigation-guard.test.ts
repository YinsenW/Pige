import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { installRendererNavigationGuard } from "../../apps/desktop/src/main/services/renderer-navigation-guard";

describe("renderer navigation guard", () => {
  it("blocks main-frame, child-frame, redirect, and new-window navigation", () => {
    const navigationListeners = new Map<string, (event: { preventDefault(): void }) => void>();
    let windowOpenHandler: (() => { action: "deny" }) | undefined;
    const webContents = {
      on: (eventName: string, listener: (event: { preventDefault(): void }) => void) => {
        navigationListeners.set(eventName, listener);
        return webContents;
      },
      setWindowOpenHandler: (handler: () => { action: "deny" }) => {
        windowOpenHandler = handler;
      }
    } as unknown as Pick<WebContents, "on" | "setWindowOpenHandler">;

    installRendererNavigationGuard(webContents);

    expect(Array.from(navigationListeners.keys())).toEqual([
      "will-navigate",
      "will-frame-navigate",
      "will-redirect"
    ]);
    for (const listener of navigationListeners.values()) {
      const preventDefault = vi.fn();
      listener({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    }
    expect(windowOpenHandler?.()).toEqual({ action: "deny" });
  });
});
