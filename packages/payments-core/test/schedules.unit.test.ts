import { describe, it, expect } from "vitest";
import { nextRunFor } from "../src/schedules.js";

describe("nextRunFor", () => {
  const base = new Date("2026-09-02T10:00:00.000Z");

  it("advances DAILY by one day", () => {
    const next = nextRunFor("DAILY", base);
    expect(next.getTime()).toBe(base.getTime() + 86400_000);
  });

  it("advances WEEKLY by seven days", () => {
    const next = nextRunFor("WEEKLY", base);
    expect(next.getTime()).toBe(base.getTime() + 7 * 86400_000);
  });

  it("advances MONTHLY by one month", () => {
    const next = nextRunFor("MONTHLY", base);
    expect(next.getUTCMonth()).toBe(9); // October
    expect(next.getUTCDate()).toBe(2);
  });

  it("evaluates CUSTOM cron expressions to the next real occurrence", () => {
    // "0 9 * * 1" — every Monday at 09:00 UTC. 2026-09-02 is a Wednesday,
    // so the next Monday is 2026-09-07T09:00:00Z.
    const next = nextRunFor("CUSTOM", base, "0 9 * * 1");
    expect(next.toISOString()).toBe("2026-09-07T09:00:00.000Z");
  });

  it("handles cron expressions later the same day", () => {
    // "30 11 * * 3" — Wednesdays at 11:30. 2026-09-02 is a Wednesday at 10:00,
    // so the next run is today at 11:30.
    const next = nextRunFor("CUSTOM", base, "30 11 * * 3");
    expect(next.toISOString()).toBe("2026-09-02T11:30:00.000Z");
  });

  it("falls back to +7 days for unparseable cron expressions", () => {
    const next = nextRunFor("CUSTOM", base, "not-a-cron");
    expect(next.getTime()).toBe(base.getTime() + 7 * 86400_000);
  });

  it("falls back to +7 days when CUSTOM has no expression", () => {
    const next = nextRunFor("CUSTOM", base);
    expect(next.getTime()).toBe(base.getTime() + 7 * 86400_000);
  });
});
