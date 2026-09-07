/**
 * Circuit Breaker — prevents cascade failures by failing fast when a provider
 * is consistently failing. Based on the half-open/closed/open state machine.
 *
 * States:
 *  - CLOSED: Normal operation, requests go through. Failure count tracked.
 *  - OPEN: Failure threshold exceeded. Requests fail fast without calling provider.
 *  - HALF_OPEN: After timeout, allows a test request through. Success closes, failure reopens.
 *
 * Configuration via env:
 *  - CIRCUIT_BREAKER_FAILURE_THRESHOLD: failures before opening (default: 5)
 *  - CIRCUIT_BREAKER_SUCCESS_THRESHOLD: successes in half-open before closing (default: 2)
 *  - CIRCUIT_BREAKER_TIMEOUT_MS: time in OPEN before trying half-open (default: 30000ms)
 */
import { getConfig } from "@zfloat/config";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
}

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
  lastStateChange: number;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private lastStateChange = Date.now();

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig
  ) {}

  private getConfig(): CircuitBreakerConfig {
    return {
      failureThreshold: getConfig().CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? this.config.failureThreshold,
      successThreshold: getConfig().CIRCUIT_BREAKER_SUCCESS_THRESHOLD ?? this.config.successThreshold,
      timeoutMs: getConfig().CIRCUIT_BREAKER_TIMEOUT_MS ?? this.config.timeoutMs,
    };
  }

  /** Current state for monitoring/debugging. */
  getState(): CircuitBreakerState {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
    };
  }

  /** Check if requests should be allowed through. */
  canExecute(): boolean {
    const cfg = this.getConfig();
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN") {
      if (Date.now() - this.lastFailureTime >= cfg.timeoutMs) {
        this.state = "HALF_OPEN";
        this.successCount = 0;
        this.lastStateChange = Date.now();
        return true;
      }
      return false;
    }
    // HALF_OPEN: allow one request through
    return true;
  }

  /** Record a successful call. */
  recordSuccess(): void {
    const cfg = this.getConfig();
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= cfg.successThreshold) {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.successCount = 0;
        this.lastStateChange = Date.now();
      }
    } else if (this.state === "CLOSED") {
      this.failureCount = 0; // reset on success
    }
  }

  /** Record a failed call. */
  recordFailure(): void {
    const cfg = this.getConfig();
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.lastStateChange = Date.now();
    } else if (this.state === "CLOSED" && this.failureCount >= cfg.failureThreshold) {
      this.state = "OPEN";
      this.lastStateChange = Date.now();
    }
  }

  /** Force the circuit open (e.g., on config change). */
  forceOpen(): void {
    this.state = "OPEN";
    this.lastStateChange = Date.now();
  }

  /** Force the circuit closed (e.g., manual reset). */
  forceClose(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.successCount = 0;
    this.lastStateChange = Date.now();
  }
}

/** Registry of circuit breakers per provider code. */
const breakers = new Map<string, CircuitBreaker>();

/** Get or create a circuit breaker for a provider. */
export function getCircuitBreaker(providerCode: string): CircuitBreaker {
  let breaker = breakers.get(providerCode);
  if (!breaker) {
    breaker = new CircuitBreaker(providerCode, {
      failureThreshold: 5,
      successThreshold: 2,
      timeoutMs: 30_000,
    });
    breakers.set(providerCode, breaker);
  }
  return breaker;
}

/** Reset all circuit breakers (for testing). */
export function resetAllCircuitBreakers(): void {
  breakers.clear();
}

/** Get all circuit breaker states for monitoring. */
export function getAllCircuitBreakerStates(): Record<string, CircuitBreakerState> {
  const result: Record<string, CircuitBreakerState> = {};
  for (const [code, breaker] of breakers) {
    result[code] = breaker.getState();
  }
  return result;
}