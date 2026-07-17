import { describe, expect, it } from "vitest";
import {
  planWindowLayout,
  resizeBoundsWithinWorkArea,
  resolveWindowLayoutPresentations
} from "../../apps/desktop/src/main/services/window-layout-policy";

describe("resident-first window layout policy", () => {
  it("uses the frozen surface-aware resident budgets", () => {
    expect(
      planWindowLayout({
        request: { apiVersion: 1, surface: "home", sidebarOpen: true, noteAgentOpen: false },
        baseContentWidth: 420,
        availableContentWidth: 720
      })
    ).toEqual({
      presentations: { sidebar: "resident", noteAgent: "closed" },
      targetContentWidth: 720,
      autoExpanded: true
    });
    expect(
      planWindowLayout({
        request: { apiVersion: 1, surface: "reader", sidebarOpen: true, noteAgentOpen: false },
        baseContentWidth: 720,
        availableContentWidth: 840
      }).targetContentWidth
    ).toBe(840);
    expect(
      planWindowLayout({
        request: { apiVersion: 1, surface: "reader", sidebarOpen: false, noteAgentOpen: true },
        baseContentWidth: 720,
        availableContentWidth: 960
      }).targetContentWidth
    ).toBe(960);
    expect(
      planWindowLayout({
        request: { apiVersion: 1, surface: "reader", sidebarOpen: true, noteAgentOpen: true },
        baseContentWidth: 720,
        availableContentWidth: 1240
      }).targetContentWidth
    ).toBe(1240);
  });

  it("falls back Agent first and never leaves Agent resident while Library overlays", () => {
    expect(
      resolveWindowLayoutPresentations(
        { apiVersion: 1, surface: "reader", sidebarOpen: true, noteAgentOpen: true },
        1000
      )
    ).toEqual({ sidebar: "resident", noteAgent: "overlay" });
    expect(
      resolveWindowLayoutPresentations(
        { apiVersion: 1, surface: "reader", sidebarOpen: true, noteAgentOpen: true },
        800
      )
    ).toEqual({ sidebar: "overlay", noteAgent: "overlay" });
  });

  it("clamps all four bounds to the current work area", () => {
    expect(
      resizeBoundsWithinWorkArea({
        currentBounds: { x: 1800, y: -40, width: 1400, height: 1000 },
        workArea: { x: 100, y: 50, width: 1200, height: 800 },
        targetOuterWidth: 1400
      })
    ).toEqual({ x: 100, y: 50, width: 1200, height: 800 });
  });
});
