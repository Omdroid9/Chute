import { describe, expect, it } from "vitest";
import {
  ATTENTION_EAR,
  EAR,
  PANEL_WIDTH,
  TAB_NEAR,
  hotRectFor,
  restingHotRect,
  shapeFor,
  tipRect,
  type Geometry,
} from "./landedGeometry";

// MacBook Pro 14": a 184×32 notch centred in a 440-wide canvas.
const NOTCH: Geometry = { width: 440, height: 340, notch: { x: 128, y: 0, width: 184, height: 32 }, hasNotch: true };
const TAB: Geometry = { width: 440, height: 340, notch: { x: 197, y: 0, width: 46, height: 14 }, hasNotch: false };
const base = { near: false, attention: false, panelHeight: 200 };

describe("shapeFor", () => {
  it("rests exactly on the notch", () => {
    expect(shapeFor({ ...base, stage: "idle", geometry: NOTCH })).toEqual(NOTCH.notch);
  });

  it("grows small ears for the amber dot when something needs attention", () => {
    const shape = shapeFor({ ...base, attention: true, stage: "idle", geometry: NOTCH });
    expect(shape).toEqual({ x: 128 - ATTENTION_EAR, y: 0, width: 184 + ATTENTION_EAR * 2, height: 32 });
  });

  it("peeks sideways into the menu bar, keeping the notch's height", () => {
    const shape = shapeFor({ ...base, stage: "peek", geometry: NOTCH });
    expect(shape).toEqual({ x: 128 - EAR, y: 0, width: 184 + EAR * 2, height: 32 });
  });

  it("drops the confirmation below the notch, where there are pixels", () => {
    expect(shapeFor({ ...base, stage: "conf", geometry: NOTCH }).height).toBeGreaterThan(32);
  });

  it("opens a panel centred on the notch", () => {
    const shape = shapeFor({ ...base, stage: "open", geometry: NOTCH });
    expect(shape).toEqual({ x: 220 - PANEL_WIDTH / 2, y: 0, width: PANEL_WIDTH, height: 200 });
  });

  it("grows the tab on approach", () => {
    const resting = shapeFor({ ...base, stage: "idle", geometry: TAB });
    const near = shapeFor({ ...base, near: true, stage: "idle", geometry: TAB });
    expect(near.width).toBeGreaterThan(resting.width);
    expect(near.x + near.width / 2).toBe(resting.x + resting.width / 2);
  });
});

describe("hot rect", () => {
  it("only covers the notch at rest, so the menu bar stays clickable", () => {
    const hot = restingHotRect(NOTCH, false);
    expect(hot.x).toBeGreaterThan(100);
    expect(hot.x + hot.width).toBeLessThan(340);
    expect(hot.height).toBe(32);
  });

  it("uses the tab's approach size so the target doesn't move", () => {
    expect(restingHotRect(TAB, false).width).toBe(TAB_NEAR.width + 12);
  });

  it("includes the tip while it shows", () => {
    const tip = tipRect(TAB, 90);
    const hot = hotRectFor({ ...base, stage: "idle", geometry: TAB, tip });
    expect(hot.y + hot.height).toBe(tip.y + tip.height);
    expect(hot.width).toBe(tip.width);
  });
});
