import type {
  WindowLayoutRequest,
  WindowLayoutSurface,
  WindowPanePresentation
} from "@pige/schemas";

export interface WindowRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowLayoutPresentations {
  readonly sidebar: WindowPanePresentation;
  readonly noteAgent: WindowPanePresentation;
}

export interface WindowLayoutPlan {
  readonly presentations: WindowLayoutPresentations;
  readonly targetContentWidth: number;
  readonly autoExpanded: boolean;
}

export const WINDOW_LAYOUT_MIN_CONTENT_WIDTH = {
  homeLibrary: 720,
  readerLibrary: 840,
  readerAgent: 960,
  readerLibraryAgent: 1240
} as const;

export function planWindowLayout(input: {
  readonly request: WindowLayoutRequest;
  readonly baseContentWidth: number;
  readonly availableContentWidth: number;
}): WindowLayoutPlan {
  const presentations = resolveWindowLayoutPresentations(input.request, input.availableContentWidth);
  const requiredWidth = requiredResidentContentWidth(input.request.surface, presentations);
  const targetContentWidth = Math.max(input.baseContentWidth, requiredWidth);
  return {
    presentations,
    targetContentWidth,
    autoExpanded: targetContentWidth > input.baseContentWidth
  };
}

export function resolveWindowLayoutPresentations(
  request: WindowLayoutRequest,
  contentWidth: number
): WindowLayoutPresentations {
  if (request.surface === "home") {
    return {
      sidebar: request.sidebarOpen
        ? contentWidth >= WINDOW_LAYOUT_MIN_CONTENT_WIDTH.homeLibrary
          ? "resident"
          : "overlay"
        : "closed",
      noteAgent: "closed"
    };
  }

  if (request.sidebarOpen && request.noteAgentOpen) {
    if (contentWidth >= WINDOW_LAYOUT_MIN_CONTENT_WIDTH.readerLibraryAgent) {
      return { sidebar: "resident", noteAgent: "resident" };
    }
    if (contentWidth >= WINDOW_LAYOUT_MIN_CONTENT_WIDTH.readerLibrary) {
      return { sidebar: "resident", noteAgent: "overlay" };
    }
    return { sidebar: "overlay", noteAgent: "overlay" };
  }

  return {
    sidebar: request.sidebarOpen
      ? contentWidth >= WINDOW_LAYOUT_MIN_CONTENT_WIDTH.readerLibrary
        ? "resident"
        : "overlay"
      : "closed",
    noteAgent: request.noteAgentOpen
      ? contentWidth >= WINDOW_LAYOUT_MIN_CONTENT_WIDTH.readerAgent
        ? "resident"
        : "overlay"
      : "closed"
  };
}

export function resizeBoundsWithinWorkArea(input: {
  readonly currentBounds: WindowRectangle;
  readonly workArea: WindowRectangle;
  readonly targetOuterWidth: number;
}): WindowRectangle {
  const width = Math.min(Math.max(1, Math.round(input.targetOuterWidth)), input.workArea.width);
  const height = Math.min(Math.max(1, input.currentBounds.height), input.workArea.height);
  const maximumX = input.workArea.x + input.workArea.width - width;
  const maximumY = input.workArea.y + input.workArea.height - height;
  const x = Math.min(Math.max(input.currentBounds.x, input.workArea.x), maximumX);
  const y = Math.min(Math.max(input.currentBounds.y, input.workArea.y), maximumY);
  return {
    x,
    y,
    width,
    height
  };
}

function requiredResidentContentWidth(
  surface: WindowLayoutSurface,
  presentations: WindowLayoutPresentations
): number {
  if (surface === "home") {
    return presentations.sidebar === "resident" ? WINDOW_LAYOUT_MIN_CONTENT_WIDTH.homeLibrary : 0;
  }
  if (presentations.sidebar === "resident" && presentations.noteAgent === "resident") {
    return WINDOW_LAYOUT_MIN_CONTENT_WIDTH.readerLibraryAgent;
  }
  if (presentations.noteAgent === "resident") return WINDOW_LAYOUT_MIN_CONTENT_WIDTH.readerAgent;
  if (presentations.sidebar === "resident") return WINDOW_LAYOUT_MIN_CONTENT_WIDTH.readerLibrary;
  return 0;
}
