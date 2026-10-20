import { describe, expect, it } from "vitest";
import { downloadPercent } from "./voice";

describe("downloadPercent", () => {
  it("returns 0 when total is missing or zero", () => {
    expect(downloadPercent(50, 0)).toBe(0);
    expect(downloadPercent(50, -1)).toBe(0);
  });

  it("rounds to a 0–100 percent", () => {
    expect(downloadPercent(50, 100)).toBe(50);
    expect(downloadPercent(1, 3)).toBe(33);
    expect(downloadPercent(100, 100)).toBe(100);
  });

  it("clamps above 100 if the server overshoots", () => {
    expect(downloadPercent(120, 100)).toBe(100);
  });
});
