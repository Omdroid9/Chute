import { describe, expect, it } from "vitest";
import { eventTitle } from "./titles";

describe("eventTitle", () => {
  it("drops leading filler and sentence-cases", () => {
    expect(eventTitle("i should really call the bank")).toBe("Call the bank");
    expect(eventTitle("remind me to submit the invoice")).toBe("Submit the invoice");
    expect(eventTitle("lets meet mark this weekend")).toBe("Meet mark");
  });

  it("strips a trailing schedule phrase the parser leaves (weekend/next week)", () => {
    expect(eventTitle("i should really get api work done by this weekend")).toBe("Get api work done");
    expect(eventTitle("ship the beta by next week")).toBe("Ship the beta");
  });

  it("strips the chrono time phrase via the parser", () => {
    expect(eventTitle("buy milk on the way home at 6pm")).toBe("Buy milk on the way home");
    expect(eventTitle("lunch with Priya Friday 1pm")).toBe("Lunch with Priya");
    expect(eventTitle("call the dentist tomorrow at 9am")).toBe("Call the dentist");
  });

  it("keeps meaningful tails that only look like time words", () => {
    expect(eventTitle("plan for the week")).toBe("Plan for the week");
    expect(eventTitle("review this month's numbers")).toBe("Review this month's numbers");
  });

  it("never returns empty", () => {
    expect(eventTitle("tomorrow")).toBe("Tomorrow");
    expect(eventTitle("")).toBe("");
  });

  it("uses only the first line", () => {
    expect(eventTitle("call the plumber\nand the electrician")).toBe("Call the plumber");
  });
});
