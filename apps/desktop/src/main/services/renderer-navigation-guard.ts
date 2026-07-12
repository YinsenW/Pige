import type { WebContents } from "electron";

type GuardedWebContents = Pick<WebContents, "on" | "setWindowOpenHandler">;

export function installRendererNavigationGuard(webContents: GuardedWebContents): void {
  webContents.on("will-navigate", (event) => event.preventDefault());
  webContents.on("will-frame-navigate", (event) => event.preventDefault());
  webContents.on("will-redirect", (event) => event.preventDefault());
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}
