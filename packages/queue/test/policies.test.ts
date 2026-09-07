/**
 * Phase 7 (GAP-ANALYSIS) — every queue carries an EXPLICIT attempts/backoff
 * policy (closes KNOWN_LIMITATIONS #21): the table covers all queues, values
 * are sane, and resolveJobOptions applies the queue's own policy unless the
 * caller overrides attempts explicitly.
 */
import { describe, it, expect } from "vitest";
import { QUEUES, QUEUE_POLICIES, resolveJobOptions } from "../src/index.js";

describe("explicit per-queue job policies", () => {
  it("defines a policy for every queue with sane attempts/backoff", () => {
    for (const q of QUEUES) {
      const p = QUEUE_POLICIES[q];
      expect(p, `policy missing for ${q}`).toBeDefined();
      expect(p.attempts).toBeGreaterThanOrEqual(1);
      expect(p.attempts).toBeLessThanOrEqual(15);
      expect(p.backoffDelayMs).toBeGreaterThanOrEqual(500);
      expect(p.note.length).toBeGreaterThan(10);
    }
  });

  it("resolves the queue's own policy by default", () => {
    expect(resolveJobOptions("payments.execution").attempts).toBe(5);
    expect(resolveJobOptions("notifications.send").attempts).toBe(10);
    expect(resolveJobOptions("notifications.send").backoff).toEqual({ type: "exponential", delay: 2_000 });
  });

  it("honors an explicit caller override", () => {
    const opts = resolveJobOptions("files.scan", { attempts: 1, delayMs: 99 });
    expect(opts.attempts).toBe(1);
    expect(opts.delay).toBe(99);
    expect(resolveJobOptions("files.scan").backoff).toEqual({ type: "exponential", delay: 2_000 });
  });
});
