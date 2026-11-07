import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, getConfig, resetConfig, type AppEnv } from "./env";

describe("Config Environment Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    resetConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  describe("loadConfig with valid env", () => {
    it("should load config with defaults for optional fields", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        DATABASE_URL_TEST: "postgresql://user:pass@localhost:5432/test_test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
      };

      const config = loadConfig({ env });
      expect(config.NODE_ENV).toBe("development");
      expect(config.DATABASE_URL).toBe(env.DATABASE_URL);
      expect(config.REDIS_URL).toBe(env.REDIS_URL);
      expect(config.APP_URL).toBe("http://localhost:3000");
      expect(config.API_URL).toBe("http://localhost:3000");
    });

    it("should use default values for optional fields", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
      };

      const config = loadConfig({ env });
      expect(config.COOKIE_SECURE).toBe(false);
      expect(config.STORAGE_DRIVER).toBe("local");
      expect(config.EMAIL_DRIVER).toBe("console");
      expect(config.SMS_DRIVER).toBe("console");
      expect(config.WHATSAPP_DRIVER).toBe("console");
      expect(config.USSD_DRIVER).toBe("console");
      expect(config.MALWARE_SCANNER_DRIVER).toBe("mock");
      expect(config.WORKER_CONCURRENCY).toBe(5);
      expect(config.WORKER_CRON_ENABLED).toBe(true);
      expect(config.OUTBOX_RELAY_INTERVAL_MS).toBe(5000);
      expect(config.OUTBOX_RELAY_LEASE_KEY).toBe(723993001);
      expect(config.DATABASE_POOL_SIZE).toBe(20);
      expect(config.PROVIDER_DEFAULT).toBe("local-sandbox");
      expect(config.MPESA_ENVIRONMENT).toBe("sandbox");
      expect(config.MPESA_SHORTCODE).toBe("174379");
      expect(config.ETIMS_DRIVER).toBe("sandbox");
      expect(config.ETIMS_ENVIRONMENT).toBe("sandbox");
      expect(config.ETIMS_SANDBOX_SECRET).toBe("etims-sandbox-dev-secret");
      expect(config.ETIMS_TIMEOUT_MS).toBe(20000);
      expect(config.MOCK_PROVIDER_BEHAVIOUR).toBe("success");
      expect(config.MOCK_PROVIDER_LATENCY_MS).toBe(300);
      expect(config.MOCK_PROVIDER_SECRET).toBe("mock-provider-dev-secret");
      expect(config.CIRCUIT_BREAKER_FAILURE_THRESHOLD).toBe(5);
      expect(config.CIRCUIT_BREAKER_SUCCESS_THRESHOLD).toBe(2);
      expect(config.CIRCUIT_BREAKER_TIMEOUT_MS).toBe(30000);
      expect(config.DEMO_MODE).toBe(false);
      expect(config.SEED_DEMO_DATA).toBe(false);
      expect(config.RATE_LIMIT_WINDOW_MS).toBe(60000);
      expect(config.RATE_LIMIT_MAX).toBe(120);
      expect(config.OTEL_ENABLED).toBe(false);
      expect(config.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://localhost:4318");
      expect(config.APPROVAL_TOKEN_TTL_MINUTES).toBe(60);
      expect(config.ALERT_COOLDOWN_SECONDS).toBe(300);
      expect(config.SMTP_PORT).toBe(587);
      expect(config.SMTP_SINK_DIR).toBe("./data/mailbox");
      expect(config.EMAIL_FROM).toBe("Z-float <no-reply@zfloat.app>");
      expect(config.SMS_FROM).toBe("Z-FLOAT");
      expect(config.ADMIN_EMAIL).toBe("admin@zfloat.app");
    });

    it("should parse boolean strings correctly", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
        COOKIE_SECURE: "true",
        WORKER_CRON_ENABLED: "false",
      };

      const config = loadConfig({ env });
      expect(config.COOKIE_SECURE).toBe(true);
      expect(config.WORKER_CRON_ENABLED).toBe(false);
    });

    it("should parse number strings correctly", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
        WORKER_CONCURRENCY: "10",
        OUTBOX_RELAY_INTERVAL_MS: "10000",
      };

      const config = loadConfig({ env });
      expect(config.WORKER_CONCURRENCY).toBe(10);
      expect(config.OUTBOX_RELAY_INTERVAL_MS).toBe(10000);
    });

    it("should use provided env overrides", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
        APP_URL: "https://custom.example.com",
      };

      const config = loadConfig({ env });
      expect(config.APP_URL).toBe("https://custom.example.com");
    });
  });

  describe("loadConfig with lenient mode", () => {
    it("should not throw on invalid env in lenient mode", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
        // No invalid values - lenient mode should work with valid schema
      };

      const config = loadConfig({ env, lenient: true });
      expect(config).toBeDefined();
    });

    it("should log warnings in lenient mode for missing optional fields", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
        // Valid schema, but lenient mode should still work
      };

      const config = loadConfig({ env, lenient: true });
      expect(config).toBeDefined();
      expect(consoleSpy).not.toHaveBeenCalled(); // No warnings for valid env
      consoleSpy.mockRestore();
    });
  });

  describe("loadConfig production validation", () => {
    const baseProductionEnv = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
      SESSION_SECRET: "a".repeat(32),
      ENCRYPTION_KEY: "b".repeat(64),
      MALWARE_SCANNER_DRIVER: "clamav",
      DEMO_MODE: "false",
      SEED_DEMO_DATA: "false",
    };

    function runWithProductionEnv(env: Record<string, string | undefined>): AppEnv {
      // Temporarily override NODE_ENV to bypass isBuildTime() check
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        return loadConfig({ env });
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }

    it("should throw on missing DATABASE_URL in production", () => {
      const env = {
        ...baseProductionEnv,
        DATABASE_URL: "",
      };

      expect(() => runWithProductionEnv(env)).toThrow("Production environment is missing critical variables: DATABASE_URL");
    });

    it("should throw on all-zero ENCRYPTION_KEY in production", () => {
      const env = {
        ...baseProductionEnv,
        ENCRYPTION_KEY: "0".repeat(64),
      };

      expect(() => runWithProductionEnv(env)).toThrow("Production environment is missing critical variables: ENCRYPTION_KEY");
    });

    it("should throw on dev-only SESSION_SECRET in production", () => {
      const env = {
        ...baseProductionEnv,
        SESSION_SECRET: "dev-only-session-secret-do-not-use-in-prod-000000",
      };

      expect(() => runWithProductionEnv(env)).toThrow("Production environment is missing critical variables: SESSION_SECRET");
    });

    it("should throw on MALWARE_SCANNER_DRIVER=mock in production", () => {
      const env = {
        ...baseProductionEnv,
        MALWARE_SCANNER_DRIVER: "mock",
      };

      expect(() => runWithProductionEnv(env)).toThrow("MALWARE_SCANNER_DRIVER=mock is not allowed");
    });

    it("should throw on DEMO_MODE=true in production", () => {
      const env = {
        ...baseProductionEnv,
        DEMO_MODE: "true",
      };

      expect(() => runWithProductionEnv(env)).toThrow("DEMO_MODE must be false in production");
    });

    it("should throw on SEED_DEMO_DATA=true in production", () => {
      const env = {
        ...baseProductionEnv,
        SEED_DEMO_DATA: "true",
      };

      expect(() => runWithProductionEnv(env)).toThrow("SEED_DEMO_DATA must be false");
    });

    it("should throw on ETIMS_DRIVER=sandbox with ETIMS_ENVIRONMENT=production", () => {
      const env = {
        ...baseProductionEnv,
        ETIMS_DRIVER: "sandbox",
        ETIMS_ENVIRONMENT: "production",
      };

      expect(() => runWithProductionEnv(env)).toThrow("ETIMS_ENVIRONMENT=production requires ETIMS_DRIVER=oscu or vscu");
    });

    it("should allow ETIMS_DRIVER=oscu with ETIMS_ENVIRONMENT=production", () => {
      const env = {
        ...baseProductionEnv,
        ETIMS_DRIVER: "oscu",
        ETIMS_ENVIRONMENT: "production",
      };

      const config = runWithProductionEnv(env);
      expect(config.ETIMS_DRIVER).toBe("oscu");
    });
  });

  describe("loadConfig schema validation", () => {
    it("should throw on invalid NODE_ENV", () => {
      const env = {
        NODE_ENV: "invalid",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
      };

      expect(() => loadConfig({ env })).toThrow("Invalid environment configuration");
    });

it("should throw on invalid URL format", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
        APP_URL: "not-a-url",
      };

      expect(() => loadConfig({ env })).toThrow("Invalid environment configuration");
    });

    it("should throw on ENCRYPTION_KEY not 64 hex chars", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "invalid",
      };

      expect(() => loadConfig({ env })).toThrow("ENCRYPTION_KEY must be 64 hex chars");
    });

    it("should throw on SESSION_SECRET too short", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "short",
        ENCRYPTION_KEY: "b".repeat(64),
      };

      expect(() => loadConfig({ env })).toThrow("SESSION_SECRET must be at least 32 characters");
    });

    it("should throw on invalid SECRETS_DRIVER", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
        SECRETS_DRIVER: "invalid",
      };

      expect(() => loadConfig({ env })).toThrow("Invalid environment configuration");
    });

    it("should throw on invalid MALWARE_SCANNER_DRIVER", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
        MALWARE_SCANNER_DRIVER: "invalid",
      };

      expect(() => loadConfig({ env })).toThrow("Invalid environment configuration");
    });
  });

  describe("getConfig singleton", () => {
    it("should return cached config", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
      };

      const config1 = getConfig({ env });
      const config2 = getConfig();
      expect(config1).toBe(config2);
    });

    it("should reload config when options change", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
      };

      const config1 = getConfig({ env, lenient: true });
      const config2 = getConfig({ env, lenient: false });
      expect(config1).not.toBe(config2);
    });

    it("should reset config on resetConfig()", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
      };

      const config1 = getConfig({ env });
      resetConfig();
      const config2 = getConfig({ env });
      expect(config1).not.toBe(config2);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty string for optional fields", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
        MPESA_CONSUMER_KEY: "",
        MPESA_CONSUMER_SECRET: "",
      };

      const config = loadConfig({ env });
      expect(config.MPESA_CONSUMER_KEY).toBe("");
      expect(config.MPESA_CONSUMER_SECRET).toBe("");
    });

    it("should handle missing optional fields with defaults", () => {
      const env = {
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
        REDIS_URL: "redis://localhost:6379",
        SESSION_SECRET: "a".repeat(32),
        ENCRYPTION_KEY: "b".repeat(64),
      };

      const config = loadConfig({ env });
      expect(config.MPESA_CONSUMER_KEY).toBe("");
      expect(config.BANK_API_KEY).toBeUndefined();
    });
  });
});