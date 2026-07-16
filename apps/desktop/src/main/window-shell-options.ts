import type { BrowserWindowConstructorOptions } from "electron";

type WindowShellOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

export function getWindowShellOptions(platform: NodeJS.Platform): WindowShellOptions {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 17, y: 17 }
    };
  }

  if (platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: "#6f6f6f",
        height: 58
      }
    };
  }

  return {};
}
