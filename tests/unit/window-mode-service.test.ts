import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSettingsStore } from "../../apps/desktop/src/main/services/local-settings";
import {
  DEFAULT_COMPACT_WINDOW_SIZE,
  DEFAULT_EXPANDED_WINDOW_SIZE,
  WindowModeService,
  type NativeWindowController
} from "../../apps/desktop/src/main/services/window-mode-service";

const tempRoots: string[] = [];

class FakeWindow implements NativeWindowController {
  #width = 800;
  #height = 600;
  #fullScreen = false;
  #alwaysOnTop = false;

  setSize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
  }

  getSize(): [number, number] {
    return [this.#width, this.#height];
  }

  setFullScreen(flag: boolean): void {
    this.#fullScreen = flag;
  }

  isFullScreen(): boolean {
    return this.#fullScreen;
  }

  setAlwaysOnTop(flag: boolean): void {
    this.#alwaysOnTop = flag;
  }

  isAlwaysOnTop(): boolean {
    return this.#alwaysOnTop;
  }
}

function makeStore(): LocalSettingsStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-window-mode-test-"));
  tempRoots.push(root);
  return new LocalSettingsStore(root);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("window mode service", () => {
  it("applies compact capture defaults on first launch", () => {
    const service = new WindowModeService(makeStore());
    const fakeWindow = new FakeWindow();

    const state = service.applyStoredState(fakeWindow);

    expect(state.mode).toBe("compact");
    expect(state.alwaysOnTop).toBe(false);
    expect(state.isFullScreen).toBe(false);
    expect(state.size).toEqual(DEFAULT_COMPACT_WINDOW_SIZE);
  });

  it("persists layout mode and remembered non-fullscreen sizes in machine-local settings", () => {
    const store = makeStore();
    const service = new WindowModeService(store);
    const fakeWindow = new FakeWindow();

    service.applyStoredState(fakeWindow);
    fakeWindow.setSize(500, 700);
    const expanded = service.setMode(fakeWindow, { mode: "expanded" });

    expect(expanded.mode).toBe("expanded");
    expect(expanded.size).toEqual(DEFAULT_EXPANDED_WINDOW_SIZE);
    expect(store.read().window).toMatchObject({
      mode: "expanded",
      compactSize: { width: 500, height: 700 }
    });
  });

  it("stores always-on-top and sidebar state without touching vault data", () => {
    const store = makeStore();
    const service = new WindowModeService(store);
    const fakeWindow = new FakeWindow();

    service.applyStoredState(fakeWindow);
    service.setAlwaysOnTop(fakeWindow, { alwaysOnTop: true });
    const state = service.setSidebarOpen(fakeWindow, { sidebarOpen: true });

    expect(state.alwaysOnTop).toBe(true);
    expect(state.sidebarOpen).toBe(true);
    expect(store.read().window).toMatchObject({
      alwaysOnTop: true,
      sidebarOpen: true
    });
  });
});
