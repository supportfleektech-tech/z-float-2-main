import { describe, it, expect } from "vitest";
import { evaluateAlerts, worstSeverity, THRESHOLDS, type ObservabilityInput, type AlertResult } from "../src/index.js";

const healthyInput = (over: Partial<ObservabilityInput> = {}): ObservabilityInput => ({
  checks: { postgres: true, redis: true, outbox: true, worker: true, ledger: true },
  workerHeartbeatAgeMs: 5_000,
  ledger: { ok: true, unbalanced: 0 },
  queueBacklogs: [
    { queue: "payments.execution", waiting: 0, active: 1, failed: 0 },
    { queue: "files.scan", waiting: 2, active: 0, failed: 0 },
  ],
  payments24h: { succeeded: 100, failed: 3 },
  webhookDeliveries24h: { succeeded: 40, failed: 1 },
  outboxUnpublished: 5,
  ...over,
});

function byRule(results: AlertResult[], rule: string): AlertResult {
  const found = results.filter((r) => r.rule === rule);
  expect(found.length, `rule ${rule} present exactly once`).toBeGreaterThan(0);
  return found[0]!;
}

describe("evaluateAlerts — dependencies", () => {
  it("healthy platform yields all-ok rules", () => {
    const results = evaluateAlerts(healthyInput());
    expect(results.length).toBeGreaterThan(6);
    for (const r of results) expect(r.severity).toBe("ok");
    expect(worstSeverity(results)).toBe("ok");
  });

  it("postgres down → critical", () => {
    const r = byRule(evaluateAlerts(healthyInput({ checks: { postgres: false } })), "postgres_down");
    expect(r.severity).toBe("critical");
  });

  it("redis down → critical", () => {
    const r = byRule(evaluateAlerts(healthyInput({ checks: { redis: false } })), "redis_down");
    expect(r.severity).toBe("critical");
  });
});

describe("evaluateAlerts — worker heartbeat", () => {
  it("no heartbeat ever → critical", () => {
    const r = byRule(evaluateAlerts(healthyInput({ workerHeartbeatAgeMs: null })), "worker_stale");
    expect(r.severity).toBe("critical");
  });

  it("fresh heartbeat → ok", () => {
    const r = byRule(evaluateAlerts(healthyInput({ workerHeartbeatAgeMs: 30_000 })), "worker_stale");
    expect(r.severity).toBe("ok");
  });

  it("aging heartbeat crosses warn threshold", () => {
    const r = byRule(
      evaluateAlerts(healthyInput({ workerHeartbeatAgeMs: THRESHOLDS.workerHeartbeatWarnMs + 1 })),
      "worker_stale",
    );
    expect(r.severity).toBe("warn");
  });

  it("stale heartbeat crosses critical threshold", () => {
    const r = byRule(
      evaluateAlerts(healthyInput({ workerHeartbeatAgeMs: THRESHOLDS.workerHeartbeatCriticalMs + 1 })),
      "worker_stale",
    );
    expect(r.severity).toBe("critical");
  });
});

describe("evaluateAlerts — ledger health", () => {
  it("no ledger run yet → warn (unknown)", () => {
    const r = byRule(evaluateAlerts(healthyInput({ ledger: null })), "ledger_unknown");
    expect(r.severity).toBe("warn");
  });

  it("unbalanced journal → critical", () => {
    const r = byRule(evaluateAlerts(healthyInput({ ledger: { ok: false, unbalanced: 2 } })), "ledger_imbalance");
    expect(r.severity).toBe("critical");
    expect(r.detail).toContain("2");
  });
});

describe("evaluateAlerts — queue backlogs", () => {
  it("waiting below warn → ok per queue", () => {
    const results = evaluateAlerts(healthyInput());
    const q = results.filter((r) => r.rule === "queue_backlog");
    expect(q.length).toBe(2);
    expect(q.every((r) => r.severity === "ok")).toBe(true);
  });

  it("waiting at warn threshold → warn", () => {
    const results = evaluateAlerts(
      healthyInput({ queueBacklogs: [{ queue: "webhooks.deliver", waiting: THRESHOLDS.queueBacklogWarn, active: 0, failed: 0 }] }),
    );
    const r = byRule(results, "queue_backlog");
    expect(r.severity).toBe("warn");
    expect(r.label).toContain("webhooks.deliver");
  });

  it("waiting at critical threshold → critical", () => {
    const results = evaluateAlerts(
      healthyInput({ queueBacklogs: [{ queue: "payments.execution", waiting: THRESHOLDS.queueBacklogCritical, active: 0, failed: 0 }] }),
    );
    expect(byRule(results, "queue_backlog").severity).toBe("critical");
  });
});

describe("evaluateAlerts — payment failure rate (24h)", () => {
  it("low traffic → ok with insufficient-data detail", () => {
    const r = byRule(
      evaluateAlerts(healthyInput({ payments24h: { succeeded: 5, failed: 4 } })),
      "payment_failure_rate",
    );
    expect(r.severity).toBe("ok");
    expect(r.detail).toContain("Insufficient traffic");
  });

  it("rate exactly at warn boundary (0.10) → warn", () => {
    const r = byRule(
      evaluateAlerts(healthyInput({ payments24h: { succeeded: 9, failed: 1 } })),
      "payment_failure_rate",
    );
    expect(r.severity).toBe("warn");
  });

  it("rate at critical boundary (0.30) → critical", () => {
    const r = byRule(
      evaluateAlerts(healthyInput({ payments24h: { succeeded: 70, failed: 30 } })),
      "payment_failure_rate",
    );
    expect(r.severity).toBe("critical");
  });

  it("moderate rate 4/40 → warn, healthy platform overall still warn worst", () => {
    const results = evaluateAlerts(healthyInput({ payments24h: { succeeded: 36, failed: 4 } }));
    expect(byRule(results, "payment_failure_rate").severity).toBe("warn");
    expect(worstSeverity(results)).toBe("warn");
  });
});

describe("evaluateAlerts — webhook failures", () => {
  it("below warn → ok", () => {
    const r = byRule(evaluateAlerts(healthyInput()), "webhook_failures");
    expect(r.severity).toBe("ok");
  });

  it("at warn threshold → warn", () => {
    const r = byRule(
      evaluateAlerts(healthyInput({ webhookDeliveries24h: { succeeded: 0, failed: THRESHOLDS.webhookFailuresWarn } })),
      "webhook_failures",
    );
    expect(r.severity).toBe("warn");
  });

  it("at critical threshold → critical", () => {
    const r = byRule(
      evaluateAlerts(healthyInput({ webhookDeliveries24h: { succeeded: 0, failed: THRESHOLDS.webhookFailuresCritical } })),
      "webhook_failures",
    );
    expect(r.severity).toBe("critical");
  });
});

describe("evaluateAlerts — outbox lag", () => {
  it("below warn → ok", () => {
    const r = byRule(evaluateAlerts(healthyInput()), "outbox_lag");
    expect(r.severity).toBe("ok");
  });

  it("at warn threshold → warn", () => {
    const r = byRule(evaluateAlerts(healthyInput({ outboxUnpublished: THRESHOLDS.outboxLagWarn })), "outbox_lag");
    expect(r.severity).toBe("warn");
  });

  it("at critical threshold → critical", () => {
    const r = byRule(evaluateAlerts(healthyInput({ outboxUnpublished: THRESHOLDS.outboxLagCritical })), "outbox_lag");
    expect(r.severity).toBe("critical");
  });
});

describe("worstSeverity", () => {
  it("escalates ok → warn → critical", () => {
    const results = evaluateAlerts(
      healthyInput({
        checks: { postgres: false },
        payments24h: { succeeded: 9, failed: 1 },
      }),
    );
    expect(worstSeverity(results)).toBe("critical");
  });

  it("warn when nothing critical", () => {
    const results = evaluateAlerts(healthyInput({ workerHeartbeatAgeMs: 90_000 }));
    expect(worstSeverity(results)).toBe("warn");
  });
});
