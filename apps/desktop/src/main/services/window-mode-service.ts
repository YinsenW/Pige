import type { SetAlwaysOnTopRequest, SetSidebarOpenRequest, SetWindowModeRequest, WindowState } from "@pige/contracts";
import type { WindowLayoutMode, WindowPreferences, WindowSize } from "@pige/schemas";
import { LocalSettingsStore } from "./local-settings";

export interface NativeWindowController {
  setSize(width: number, height: number): void;
  getSize(): number[];
  setFullScreen(flag: boolean): void;
  isFullScreen(): boolean;
  setAlwaysOnTop(flag: boolean): void;
  isAlwaysOnTop(): boolean;
}

export const DEFAULT_COMPACT_WINDOW_SIZE: WindowSize = { width: 420, height: 760 };
export const DEFAULT_EXPANDED_WINDOW_SIZE: WindowSize = { width: 960, height: 760 };

export class WindowModeService {
  readonly #settings: LocalSettingsStore;

  constructor(settings: LocalSettingsStore) {
    this.#settings = settings;
  }

  applyStoredState(nativeWindow: NativeWindowController): WindowState {
    const preferences = this.#getPreferences();
    nativeWindow.setAlwaysOnTop(preferences.alwaysOnTop);
    this.#applyMode(nativeWindow, preferences.mode, preferences);
    return this.current(nativeWindow);
  }

  current(nativeWindow: NativeWindowController): WindowState {
    const preferences = this.#getPreferences();
    const size = this.#getCurrentSize(nativeWindow);
    const mode = nativeWindow.isFullScreen()
      ? "fullscreen"
      : preferences.mode === "fullscreen"
        ? "expanded"
        : preferences.mode;

    return {
      mode,
      alwaysOnTop: nativeWindow.isAlwaysOnTop(),
      sidebarOpen: preferences.sidebarOpen,
      isFullScreen: nativeWindow.isFullScreen(),
      size
    };
  }

  setMode(nativeWindow: NativeWindowController, request: SetWindowModeRequest): WindowState {
    const preferences = this.#rememberCurrentSize(nativeWindow, this.#getPreferences());
    const nextPreferences: WindowPreferences = {
      ...preferences,
      mode: request.mode
    };

    this.#settings.setWindowPreferences(nextPreferences);
    this.#applyMode(nativeWindow, request.mode, nextPreferences);
    return this.current(nativeWindow);
  }

  setAlwaysOnTop(nativeWindow: NativeWindowController, request: SetAlwaysOnTopRequest): WindowState {
    const preferences = this.#getPreferences();
    const nextPreferences: WindowPreferences = {
      ...preferences,
      alwaysOnTop: request.alwaysOnTop
    };

    nativeWindow.setAlwaysOnTop(request.alwaysOnTop);
    this.#settings.setWindowPreferences(nextPreferences);
    return this.current(nativeWindow);
  }

  setSidebarOpen(nativeWindow: NativeWindowController, request: SetSidebarOpenRequest): WindowState {
    const preferences = this.#getPreferences();
    const nextPreferences: WindowPreferences = {
      ...preferences,
      sidebarOpen: request.sidebarOpen
    };

    this.#settings.setWindowPreferences(nextPreferences);
    return this.current(nativeWindow);
  }

  #getPreferences(): WindowPreferences {
    const stored = this.#settings.getWindowPreferences();
    return {
      mode: stored?.mode ?? "compact",
      alwaysOnTop: stored?.alwaysOnTop ?? false,
      sidebarOpen: stored?.sidebarOpen ?? false,
      compactSize: stored?.compactSize ?? DEFAULT_COMPACT_WINDOW_SIZE,
      expandedSize: stored?.expandedSize ?? DEFAULT_EXPANDED_WINDOW_SIZE
    };
  }

  #applyMode(
    nativeWindow: NativeWindowController,
    mode: WindowLayoutMode,
    preferences: WindowPreferences
  ): void {
    if (mode === "fullscreen") {
      nativeWindow.setFullScreen(true);
      return;
    }

    nativeWindow.setFullScreen(false);
    const size = mode === "compact" ? preferences.compactSize : preferences.expandedSize;
    const fallback = mode === "compact" ? DEFAULT_COMPACT_WINDOW_SIZE : DEFAULT_EXPANDED_WINDOW_SIZE;
    nativeWindow.setSize(size?.width ?? fallback.width, size?.height ?? fallback.height);
  }

  #rememberCurrentSize(
    nativeWindow: NativeWindowController,
    preferences: WindowPreferences
  ): WindowPreferences {
    if (nativeWindow.isFullScreen()) {
      return preferences;
    }

    const size = this.#getCurrentSize(nativeWindow);
    if (preferences.mode === "compact") {
      return { ...preferences, compactSize: size };
    }
    if (preferences.mode === "expanded") {
      return { ...preferences, expandedSize: size };
    }
    return preferences;
  }

  #getCurrentSize(nativeWindow: NativeWindowController): WindowSize {
    const size = nativeWindow.getSize();
    return {
      width: size[0] ?? DEFAULT_COMPACT_WINDOW_SIZE.width,
      height: size[1] ?? DEFAULT_COMPACT_WINDOW_SIZE.height
    };
  }
}
