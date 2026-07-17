import type {
  SetAlwaysOnTopRequest,
  SetSidebarOpenRequest,
  SetWindowModeRequest,
  WindowLayoutRequest,
  WindowLayoutState,
  WindowState
} from "@pige/contracts";
import type { WindowLayoutMode, WindowPreferences, WindowSize } from "@pige/schemas";
import { LocalSettingsStore } from "./local-settings";
import {
  planWindowLayout,
  resizeBoundsWithinWorkArea,
  resolveWindowLayoutPresentations,
  type WindowRectangle
} from "./window-layout-policy";

export interface NativeWindowController {
  setSize(width: number, height: number): void;
  getSize(): number[];
  setBounds(bounds: WindowRectangle): void;
  getBounds(): WindowRectangle;
  getContentBounds(): WindowRectangle;
  setFullScreen(flag: boolean): void;
  isFullScreen(): boolean;
  isMaximized(): boolean;
  setAlwaysOnTop(flag: boolean): void;
  isAlwaysOnTop(): boolean;
}

interface WindowLayoutSession {
  request: WindowLayoutRequest;
  state: WindowLayoutState;
  baseBounds?: WindowRectangle;
  autoExpanded: boolean;
  pendingRestore: boolean;
  lastAppliedBounds?: WindowRectangle;
}

type WorkAreaResolver = (bounds: WindowRectangle) => WindowRectangle;

export const DEFAULT_COMPACT_WINDOW_SIZE: WindowSize = { width: 420, height: 760 };
export const DEFAULT_EXPANDED_WINDOW_SIZE: WindowSize = { width: 960, height: 760 };

export class WindowModeService {
  readonly #settings: LocalSettingsStore;
  readonly #resolveWorkArea: WorkAreaResolver;
  readonly #sessions = new WeakMap<NativeWindowController, WindowLayoutSession>();

  constructor(
    settings: LocalSettingsStore,
    resolveWorkArea: WorkAreaResolver = (bounds) => bounds
  ) {
    this.#settings = settings;
    this.#resolveWorkArea = resolveWorkArea;
  }

  applyStoredState(nativeWindow: NativeWindowController): WindowState {
    const preferences = this.#getPreferences();
    nativeWindow.setAlwaysOnTop(preferences.alwaysOnTop);
    this.#applyMode(nativeWindow, preferences.mode, preferences);
    const session = this.#getSession(nativeWindow);
    if (hasOpenPane(session.request)) {
      this.#transitionLayout(nativeWindow, session.request, true);
    }
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

  currentLayout(nativeWindow: NativeWindowController): WindowLayoutState {
    const session = this.#getSession(nativeWindow);
    const state = this.#createLayoutState(nativeWindow, session, session.state.revision);
    session.state = state;
    return state;
  }

  setLayout(nativeWindow: NativeWindowController, request: WindowLayoutRequest): WindowLayoutState {
    return this.#transitionLayout(nativeWindow, request, false);
  }

  handleNativeLayoutChanged(
    nativeWindow: NativeWindowController,
    source: "native" | "display" = "native"
  ): WindowLayoutState | undefined {
    const session = this.#getSession(nativeWindow);
    const bounds = nativeWindow.getBounds();
    if (session.lastAppliedBounds) {
      const programmaticBoundsSettled = sameRectangle(bounds, session.lastAppliedBounds);
      delete session.lastAppliedBounds;
      if (programmaticBoundsSettled) return undefined;
    }

    const returnedToNormalFrame =
      !nativeWindow.isMaximized() &&
      !nativeWindow.isFullScreen() &&
      (session.state.isMaximized || session.state.isFullScreen);
    if (returnedToNormalFrame && hasOpenPane(session.request)) {
      return this.#transitionLayout(nativeWindow, session.request, true);
    }

    if (session.pendingRestore && !nativeWindow.isMaximized() && !nativeWindow.isFullScreen() && session.baseBounds) {
      this.#applyBounds(nativeWindow, this.#clampBounds(nativeWindow, session.baseBounds), session);
      session.pendingRestore = false;
      delete session.baseBounds;
      session.autoExpanded = false;
    } else if (!hasOpenPane(session.request) && !nativeWindow.isMaximized() && !nativeWindow.isFullScreen()) {
      const preferences = this.#getPreferences();
      const remembered = this.#rememberCurrentSize(nativeWindow, preferences);
      if (!samePreferences(preferences, remembered)) this.#settings.setWindowPreferences(remembered);
    } else if (hasOpenPane(session.request) && !nativeWindow.isMaximized() && !nativeWindow.isFullScreen()) {
      if (source === "native" && session.baseBounds) {
        session.baseBounds = {
          ...session.baseBounds,
          x: bounds.x,
          y: bounds.y,
          height: bounds.height
        };
      }
      const clamped = resizeBoundsWithinWorkArea({
        currentBounds: bounds,
        workArea: this.#resolveWorkArea(bounds),
        targetOuterWidth: bounds.width
      });
      if (!sameRectangle(bounds, clamped)) this.#applyBounds(nativeWindow, clamped, session);
    }

    const next = this.#createLayoutState(nativeWindow, session, session.state.revision + 1);
    if (sameLayoutState(session.state, next)) return undefined;
    session.state = next;
    return next;
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
    const session = this.#getSession(nativeWindow);
    this.setLayout(nativeWindow, { ...session.request, sidebarOpen: request.sidebarOpen });
    return this.current(nativeWindow);
  }

  #transitionLayout(
    nativeWindow: NativeWindowController,
    request: WindowLayoutRequest,
    force: boolean
  ): WindowLayoutState {
    const session = this.#getSession(nativeWindow);
    if (!force && sameLayoutRequest(session.request, request)) return this.currentLayout(nativeWindow);

    const hadOpenPane = hasOpenPane(session.request);
    const hasNextOpenPane = hasOpenPane(request);
    if (!hadOpenPane && hasNextOpenPane) {
      session.baseBounds = nativeWindow.getBounds();
    }

    session.request = request;
    this.#persistDisclosures(request);

    if (!hasNextOpenPane) {
      if (session.baseBounds && session.autoExpanded) {
        if (nativeWindow.isMaximized() || nativeWindow.isFullScreen()) {
          session.pendingRestore = true;
        } else {
          this.#applyBounds(nativeWindow, this.#clampBounds(nativeWindow, session.baseBounds), session);
          delete session.baseBounds;
          session.pendingRestore = false;
        }
      } else {
        delete session.baseBounds;
        session.pendingRestore = false;
      }
      session.autoExpanded = false;
      session.state = this.#createLayoutState(nativeWindow, session, session.state.revision + 1);
      return session.state;
    }

    const baseBounds = session.baseBounds ?? nativeWindow.getBounds();
    session.baseBounds = baseBounds;
    if (!nativeWindow.isMaximized() && !nativeWindow.isFullScreen()) {
      const frameWidth = this.#frameWidth(nativeWindow);
      const workArea = this.#resolveWorkArea(nativeWindow.getBounds());
      const plan = planWindowLayout({
        request,
        baseContentWidth: Math.max(1, baseBounds.width - frameWidth),
        availableContentWidth: Math.max(1, workArea.width - frameWidth)
      });
      const targetBounds = resizeBoundsWithinWorkArea({
        currentBounds: nativeWindow.getBounds(),
        workArea,
        targetOuterWidth: plan.targetContentWidth + frameWidth
      });
      if (!sameRectangle(nativeWindow.getBounds(), targetBounds)) {
        this.#applyBounds(nativeWindow, targetBounds, session);
      }
      session.autoExpanded = plan.autoExpanded;
      session.pendingRestore = false;
    } else {
      session.autoExpanded = false;
    }

    session.state = this.#createLayoutState(nativeWindow, session, session.state.revision + 1);
    return session.state;
  }

  #getSession(nativeWindow: NativeWindowController): WindowLayoutSession {
    const current = this.#sessions.get(nativeWindow);
    if (current) return current;
    const preferences = this.#getPreferences();
    const request: WindowLayoutRequest = {
      apiVersion: 1,
      surface: preferences.noteAgentOpen ? "reader" : "home",
      sidebarOpen: preferences.sidebarOpen,
      noteAgentOpen: preferences.noteAgentOpen ?? false
    };
    const session: WindowLayoutSession = {
      request,
      state: this.#initialLayoutState(nativeWindow, request),
      autoExpanded: false,
      pendingRestore: false
    };
    this.#sessions.set(nativeWindow, session);
    return session;
  }

  #initialLayoutState(nativeWindow: NativeWindowController, request: WindowLayoutRequest): WindowLayoutState {
    const presentations = resolveWindowLayoutPresentations(request, nativeWindow.getContentBounds().width);
    return {
      apiVersion: 1,
      revision: 0,
      surface: request.surface,
      sidebarOpen: request.sidebarOpen,
      noteAgentOpen: request.noteAgentOpen,
      sidebarPresentation: presentations.sidebar,
      noteAgentPresentation: presentations.noteAgent,
      autoExpanded: false,
      isMaximized: nativeWindow.isMaximized(),
      isFullScreen: nativeWindow.isFullScreen()
    };
  }

  #createLayoutState(
    nativeWindow: NativeWindowController,
    session: WindowLayoutSession,
    revision: number
  ): WindowLayoutState {
    const presentations = resolveWindowLayoutPresentations(session.request, nativeWindow.getContentBounds().width);
    const bounds = nativeWindow.getBounds();
    return {
      apiVersion: 1,
      revision,
      surface: session.request.surface,
      sidebarOpen: session.request.sidebarOpen,
      noteAgentOpen: session.request.noteAgentOpen,
      sidebarPresentation: presentations.sidebar,
      noteAgentPresentation: presentations.noteAgent,
      autoExpanded: Boolean(
        session.autoExpanded && session.baseBounds && bounds.width > session.baseBounds.width
      ),
      isMaximized: nativeWindow.isMaximized(),
      isFullScreen: nativeWindow.isFullScreen()
    };
  }

  #persistDisclosures(request: WindowLayoutRequest): void {
    const preferences = this.#getPreferences();
    if (
      preferences.sidebarOpen === request.sidebarOpen &&
      (preferences.noteAgentOpen ?? false) === request.noteAgentOpen
    ) {
      return;
    }
    this.#settings.setWindowPreferences({
      ...preferences,
      sidebarOpen: request.sidebarOpen,
      noteAgentOpen: request.noteAgentOpen
    });
  }

  #applyBounds(
    nativeWindow: NativeWindowController,
    bounds: WindowRectangle,
    session: WindowLayoutSession
  ): void {
    session.lastAppliedBounds = bounds;
    nativeWindow.setBounds(bounds);
  }

  #clampBounds(nativeWindow: NativeWindowController, bounds: WindowRectangle): WindowRectangle {
    return resizeBoundsWithinWorkArea({
      currentBounds: bounds,
      workArea: this.#resolveWorkArea(nativeWindow.getBounds()),
      targetOuterWidth: bounds.width
    });
  }

  #frameWidth(nativeWindow: NativeWindowController): number {
    return Math.max(0, nativeWindow.getBounds().width - nativeWindow.getContentBounds().width);
  }

  #getPreferences(): WindowPreferences {
    const stored = this.#settings.getWindowPreferences();
    return {
      mode: stored?.mode ?? "compact",
      alwaysOnTop: stored?.alwaysOnTop ?? false,
      sidebarOpen: stored?.sidebarOpen ?? false,
      noteAgentOpen: stored?.noteAgentOpen ?? false,
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
    if (nativeWindow.isFullScreen() || nativeWindow.isMaximized()) return preferences;
    const size = this.#getCurrentSize(nativeWindow);
    if (preferences.mode === "compact") return { ...preferences, compactSize: size };
    if (preferences.mode === "expanded") return { ...preferences, expandedSize: size };
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

function hasOpenPane(request: WindowLayoutRequest): boolean {
  return request.sidebarOpen || request.noteAgentOpen;
}

function sameLayoutRequest(left: WindowLayoutRequest, right: WindowLayoutRequest): boolean {
  return (
    left.apiVersion === right.apiVersion &&
    left.surface === right.surface &&
    left.sidebarOpen === right.sidebarOpen &&
    left.noteAgentOpen === right.noteAgentOpen
  );
}

function sameLayoutState(left: WindowLayoutState, right: WindowLayoutState): boolean {
  return (
    left.surface === right.surface &&
    left.sidebarOpen === right.sidebarOpen &&
    left.noteAgentOpen === right.noteAgentOpen &&
    left.sidebarPresentation === right.sidebarPresentation &&
    left.noteAgentPresentation === right.noteAgentPresentation &&
    left.autoExpanded === right.autoExpanded &&
    left.isMaximized === right.isMaximized &&
    left.isFullScreen === right.isFullScreen
  );
}

function sameRectangle(left: WindowRectangle, right: WindowRectangle): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function samePreferences(left: WindowPreferences, right: WindowPreferences): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
