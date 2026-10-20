/** Shapes for the Landed panel, in canvas points (top-left origin). */

export type Stage = "idle" | "peek" | "open" | "conf";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Canvas geometry from the native side. */
export interface Geometry {
  width: number;
  height: number;
  /** The real notch, or where the tab rests on screens without one. */
  notch: Rect;
  hasNotch: boolean;
}

export interface ShapeInput {
  stage: Stage;
  geometry: Geometry;
  /** Pointer is approaching the tab (screens without a notch). */
  near: boolean;
  /** Something failed and needs the user. */
  attention: boolean;
  panelHeight: number;
}

/** Width of each "ear" the peek adds beside the real notch. */
export const EAR = 100;
/** Ears the resting notch grows to hold the amber "needs you" dot. */
export const ATTENTION_EAR = 16;
export const PANEL_WIDTH = 380;
/** Height of the strip the confirmation drops below the notch. */
export const CONF_DROP = 30;
export const TAB = { width: 46, height: 14 };
export const TAB_NEAR = { width: 64, height: 18 };
/** Extra tab width for the amber dot. */
export const TAB_DOT = 12;
export const PILL = { width: 250, height: 30 };
export const CONF_PILL = { width: 270, height: 30 };
export const TIP_WIDTH = 260;
export const TIP_GAP = 10;

export function centred(geometry: Geometry, width: number, height: number): Rect {
  const centre = geometry.notch.x + geometry.notch.width / 2;
  return { x: centre - width / 2, y: 0, width, height };
}

export function shapeFor({ stage, geometry, near, attention, panelHeight }: ShapeInput): Rect {
  const { notch, hasNotch } = geometry;
  switch (stage) {
    case "open":
      return centred(geometry, PANEL_WIDTH, panelHeight);
    case "peek":
      return hasNotch
        ? centred(geometry, notch.width + EAR * 2, notch.height)
        : centred(geometry, PILL.width, PILL.height);
    case "conf":
      return hasNotch
        ? centred(geometry, notch.width + EAR * 2, notch.height + CONF_DROP)
        : centred(geometry, CONF_PILL.width, CONF_PILL.height);
    case "idle":
      if (hasNotch) {
        return attention ? centred(geometry, notch.width + ATTENTION_EAR * 2, notch.height) : { ...notch };
      }
      {
        const size = near ? TAB_NEAR : TAB;
        return centred(geometry, size.width + (attention ? TAB_DOT : 0), size.height);
      }
  }
}

/**
 * Where resting the pointer counts as "on the notch". For the tab it's the
 * approach size, so the target doesn't move as the tab grows.
 */
export function restingHotRect(geometry: Geometry, attention: boolean): Rect {
  const shape = shapeFor({ stage: "idle", geometry, near: true, attention, panelHeight: 0 });
  return {
    x: shape.x - 6,
    y: 0,
    width: shape.width + 12,
    height: shape.height + (geometry.hasNotch ? 0 : 4),
  };
}

/** The one-time tip under the tab, on screens without a notch. */
export function tipRect(geometry: Geometry, tipHeight: number): Rect {
  return { ...centred(geometry, TIP_WIDTH, tipHeight), y: TAB_NEAR.height + TIP_GAP };
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** The clickable part of the canvas; everything else passes clicks through. */
export function hotRectFor(input: ShapeInput & { tip: Rect | null }): Rect {
  if (input.stage === "idle") {
    const resting = restingHotRect(input.geometry, input.attention);
    return input.tip ? union(resting, input.tip) : resting;
  }
  const shape = shapeFor(input);
  return { x: shape.x - 4, y: 0, width: shape.width + 8, height: shape.height + 4 };
}
