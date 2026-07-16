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
  #x = 40;
  #y = 40;
  #width = 800;
  #height = 600;
  #frameWidth = 0;
  #fullScreen = false;
  #maximized = false;
  #alwaysOnTop = false;

  setSize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
  }

  getSize(): [number, number] {
    return [this.#width, this.#height];
  }

  setBounds(bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): void {
    this.#x = bounds.x;
    this.#y = bounds.y;
    this.#width = bounds.width;
    this.#height = bounds.height;
  }

  getBounds(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
    return { x: this.#x, y: this.#y, width: this.#width, height: this.#height };
  }

  getContentBounds(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
    return { x: this.#x, y: this.#y, width: this.#width - this.#frameWidth, height: this.#height };
  }

  setFullScreen(flag: boolean): void {
    this.#fullScreen = flag;
  }

  isFullScreen(): boolean {
    return this.#fullScreen;
  }

  isMaximized(): boolean {
    return this.#maximized;
  }

  setMaximized(flag: boolean): void {
    this.#maximized = flag;
  }

  setFrameWidth(width: number): void {
    this.#frameWidth = width;
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

  it("auto-expands Home for a resident Library and restores the exact user base", () => {
    const store = makeStore();
    const service = new WindowModeService(store, () => ({ x: 0, y: 0, width: 1440, height: 900 }));
    const fakeWindow = new FakeWindow();

    service.applyStoredState(fakeWindow);
    const open = service.setLayout(fakeWindow, {
      apiVersion: 1,
      surface: "home",
      sidebarOpen: true,
      noteAgentOpen: false
    });

    expect(fakeWindow.getSize()).toEqual([720, 760]);
    expect(open).toMatchObject({
      revision: 1,
      sidebarPresentation: "resident",
      noteAgentPresentation: "closed",
      autoExpanded: true
    });
    expect(store.read().window).toMatchObject({
      compactSize: DEFAULT_COMPACT_WINDOW_SIZE,
      sidebarOpen: true,
      noteAgentOpen: false
    });

    const closed = service.setLayout(fakeWindow, {
      apiVersion: 1,
      surface: "home",
      sidebarOpen: false,
      noteAgentOpen: false
    });
    expect(fakeWindow.getSize()).toEqual([420, 760]);
    expect(closed).toMatchObject({ revision: 2, sidebarPresentation: "closed", autoExpanded: false });
  });

  it("keeps Library resident and falls back to an Agent overlay when work area is constrained", () => {
    const service = new WindowModeService(makeStore(), () => ({ x: 0, y: 0, width: 1000, height: 900 }));
    const fakeWindow = new FakeWindow();
    service.applyStoredState(fakeWindow);

    const state = service.setLayout(fakeWindow, {
      apiVersion: 1,
      surface: "reader",
      sidebarOpen: true,
      noteAgentOpen: true
    });

    expect(fakeWindow.getSize()).toEqual([840, 760]);
    expect(state).toMatchObject({
      sidebarPresentation: "resident",
      noteAgentPresentation: "overlay",
      autoExpanded: true
    });
  });

  it("recomputes from one base so pane close order cannot change the restored width", () => {
    const workArea = () => ({ x: 0, y: 0, width: 1600, height: 900 });
    const run = (firstClosed: "sidebar" | "agent"): number[] => {
      const service = new WindowModeService(makeStore(), workArea);
      const fakeWindow = new FakeWindow();
      service.applyStoredState(fakeWindow);
      service.setLayout(fakeWindow, {
        apiVersion: 1,
        surface: "reader",
        sidebarOpen: true,
        noteAgentOpen: true
      });
      expect(fakeWindow.getSize()).toEqual([1240, 760]);
      service.setLayout(fakeWindow, {
        apiVersion: 1,
        surface: "reader",
        sidebarOpen: firstClosed !== "sidebar",
        noteAgentOpen: firstClosed !== "agent"
      });
      service.setLayout(fakeWindow, {
        apiVersion: 1,
        surface: "reader",
        sidebarOpen: false,
        noteAgentOpen: false
      });
      return fakeWindow.getSize();
    };

    expect(run("sidebar")).toEqual([420, 760]);
    expect(run("agent")).toEqual([420, 760]);
  });

  it("does not resize a maximized window and restores pending auto expansion after unmaximize", () => {
    const service = new WindowModeService(makeStore(), () => ({ x: 0, y: 0, width: 1440, height: 900 }));
    const fakeWindow = new FakeWindow();
    service.applyStoredState(fakeWindow);
    service.setLayout(fakeWindow, {
      apiVersion: 1,
      surface: "home",
      sidebarOpen: true,
      noteAgentOpen: false
    });
    expect(fakeWindow.getSize()).toEqual([720, 760]);

    fakeWindow.setMaximized(true);
    service.handleNativeLayoutChanged(fakeWindow);
    service.setLayout(fakeWindow, {
      apiVersion: 1,
      surface: "home",
      sidebarOpen: false,
      noteAgentOpen: false
    });
    expect(fakeWindow.getSize()).toEqual([720, 760]);

    fakeWindow.setMaximized(false);
    service.handleNativeLayoutChanged(fakeWindow);
    expect(fakeWindow.getSize()).toEqual([420, 760]);
  });

  it("defers an open-pane expansion until a maximized window returns to normal", () => {
    const service = new WindowModeService(makeStore(), () => ({ x: 0, y: 0, width: 1440, height: 900 }));
    const fakeWindow = new FakeWindow();
    service.applyStoredState(fakeWindow);
    fakeWindow.setMaximized(true);
    service.handleNativeLayoutChanged(fakeWindow);

    const maximized = service.setLayout(fakeWindow, {
      apiVersion: 1,
      surface: "home",
      sidebarOpen: true,
      noteAgentOpen: false
    });
    expect(fakeWindow.getSize()).toEqual([420, 760]);
    expect(maximized).toMatchObject({ isMaximized: true, sidebarPresentation: "overlay" });

    fakeWindow.setMaximized(false);
    const normal = service.handleNativeLayoutChanged(fakeWindow);
    expect(fakeWindow.getSize()).toEqual([720, 760]);
    expect(normal).toMatchObject({ isMaximized: false, sidebarPresentation: "resident", autoExpanded: true });
  });

  it("accounts for native frame width without exposing it to the renderer", () => {
    const service = new WindowModeService(makeStore(), () => ({ x: 0, y: 0, width: 1260, height: 900 }));
    const fakeWindow = new FakeWindow();
    fakeWindow.setFrameWidth(20);
    service.applyStoredState(fakeWindow);

    const state = service.setLayout(fakeWindow, {
      apiVersion: 1,
      surface: "reader",
      sidebarOpen: true,
      noteAgentOpen: true
    });
    expect(fakeWindow.getSize()).toEqual([1260, 760]);
    expect(state).toMatchObject({ sidebarPresentation: "resident", noteAgentPresentation: "resident" });
  });

  it("clamps an active layout after display loss without overwriting the manual base", () => {
    const store = makeStore();
    let workArea = { x: 0, y: 0, width: 1600, height: 900 };
    const service = new WindowModeService(store, () => workArea);
    const fakeWindow = new FakeWindow();
    service.applyStoredState(fakeWindow);
    service.setLayout(fakeWindow, {
      apiVersion: 1,
      surface: "reader",
      sidebarOpen: true,
      noteAgentOpen: true
    });

    workArea = { x: 0, y: 0, width: 900, height: 700 };
    fakeWindow.setBounds({ x: 1200, y: -20, width: 1240, height: 760 });
    const changed = service.handleNativeLayoutChanged(fakeWindow);

    expect(fakeWindow.getBounds()).toEqual({ x: 0, y: 0, width: 900, height: 700 });
    expect(changed).toMatchObject({ sidebarPresentation: "resident", noteAgentPresentation: "overlay" });
    expect(store.read().window?.compactSize).toEqual(DEFAULT_COMPACT_WINDOW_SIZE);
  });

  it("preserves a user move and height change without treating pane width as the new base", () => {
    const service = new WindowModeService(makeStore(), () => ({ x: 0, y: 0, width: 1440, height: 900 }));
    const fakeWindow = new FakeWindow();
    service.applyStoredState(fakeWindow);
    service.setLayout(fakeWindow, {
      apiVersion: 1,
      surface: "home",
      sidebarOpen: true,
      noteAgentOpen: false
    });

    fakeWindow.setBounds({ x: 220, y: 90, width: 720, height: 700 });
    service.handleNativeLayoutChanged(fakeWindow, "native");
    service.setLayout(fakeWindow, {
      apiVersion: 1,
      surface: "home",
      sidebarOpen: false,
      noteAgentOpen: false
    });

    expect(fakeWindow.getBounds()).toEqual({ x: 220, y: 90, width: 420, height: 700 });
  });

  it("keeps revisions idempotent and isolates state by native window", () => {
    const service = new WindowModeService(makeStore(), () => ({ x: 0, y: 0, width: 1440, height: 900 }));
    const first = new FakeWindow();
    const second = new FakeWindow();
    service.applyStoredState(first);
    service.applyStoredState(second);
    const request = { apiVersion: 1 as const, surface: "home" as const, sidebarOpen: true, noteAgentOpen: false };

    const opened = service.setLayout(first, request);
    const repeated = service.setLayout(first, request);

    expect(opened.revision).toBe(1);
    expect(repeated.revision).toBe(1);
    expect(service.currentLayout(second)).toMatchObject({ revision: 0, sidebarOpen: false });
  });
});
