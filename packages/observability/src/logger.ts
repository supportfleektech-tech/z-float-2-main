/**
 * Structured logging with Pino + OpenTelemetry trace correlation.
 * Usage:
 *   import { logger, createChildLogger } from "@zfloat/observability";
 *   logger.info({ userId, action: "payment.create" }, "Payment created");
 *   const child = createChildLogger({ requestId });
 *   child.warn({ retryCount }, "Retrying provider call");
 */
import pino from "pino";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { getConfig } from "@zfloat/config";

type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

interface LogContext {
  [key: string]: unknown;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  correlationId?: string;
}

/** Extract trace context from current OpenTelemetry span. */
function getTraceContext(): { traceId?: string; spanId?: string } {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

/** Create the base logger with pretty-print in development, JSON in production. */
function createBaseLogger() {
  const config = getConfig();
  const isProduction = config.NODE_ENV === "production" || config.NODE_ENV === "staging";

  const transport = isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.Z",
          ignore: "pid,hostname",
        },
      };

  return pino({
    level: config.OTEL_ENABLED ? "debug" : "info",
    base: {
      service: "zfloat",
      environment: config.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    transport,
    redact: {
      paths: [
        "*.password",
        "*.passwordHash",
        "*.secret",
        "*.token",
        "*.apiKey",
        "*.authorization",
        "*.cookie",
        "req.headers.authorization",
        "req.headers.cookie",
      ],
      censor: "[REDACTED]",
    },
  });
}

const baseLogger = createBaseLogger();

/** Main logger instance. */
export const logger = {
  fatal: (ctx: LogContext, msg: string) => baseLogger.fatal({ ...getTraceContext(), ...ctx }, msg),
  error: (ctx: LogContext, msg: string) => baseLogger.error({ ...getTraceContext(), ...ctx }, msg),
  warn: (ctx: LogContext, msg: string) => baseLogger.warn({ ...getTraceContext(), ...ctx }, msg),
  info: (ctx: LogContext, msg: string) => baseLogger.info({ ...getTraceContext(), ...ctx }, msg),
  debug: (ctx: LogContext, msg: string) => baseLogger.debug({ ...getTraceContext(), ...ctx }, msg),
  trace: (ctx: LogContext, msg: string) => baseLogger.trace({ ...getTraceContext(), ...ctx }, msg),
};

/** Create a child logger with bound context (e.g., requestId, tenantId). */
export function createChildLogger(boundContext: LogContext) {
  const child = baseLogger.child({ ...getTraceContext(), ...boundContext });
  return {
    fatal: (ctx: LogContext, msg: string) => child.fatal(ctx, msg),
    error: (ctx: LogContext, msg: string) => child.error(ctx, msg),
    warn: (ctx: LogContext, msg: string) => child.warn(ctx, msg),
    info: (ctx: LogContext, msg: string) => child.info(ctx, msg),
    debug: (ctx: LogContext, msg: string) => child.debug(ctx, msg),
    trace: (ctx: LogContext, msg: string) => child.trace(ctx, msg),
    child: (moreContext: LogContext) => createChildLogger({ ...boundContext, ...moreContext }),
  };
}

/** Log an error with full context and stack trace. */
export function logError(ctx: LogContext, error: unknown, msg: string) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error({ ...ctx, err: { message: err.message, stack: err.stack, name: err.name } }, msg);
}

/** OpenTelemetry span helper for async operations. */
export async function withSpan<T>(
  name: string,
  fn: (span: import("@opentelemetry/api").Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const tracer = trace.getTracer("zfloat");
  const span = tracer.startSpan(name, { attributes });
  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

/** Initialize OpenTelemetry SDK (call once at process startup). */
export function initTelemetry(): void {
  const config = getConfig();
  if (!config.OTEL_ENABLED) return;

  const { NodeSDK } = require("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
  const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-http");
  const { Resource } = require("@opentelemetry/resources");
  const { SemanticResourceAttributes } = require("@opentelemetry/semantic-conventions");

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: "zfloat",
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.NODE_ENV,
    }),
    traceExporter: new OTLPTraceExporter({ url: config.OTEL_EXPORTER_OTLP_ENDPOINT + "/v1/traces" }),
    metricExporter: new OTLPMetricExporter({ url: config.OTEL_EXPORTER_OTLP_ENDPOINT + "/v1/metrics" }),
  });

  sdk.start();
  // Graceful shutdown
  process.on("SIGTERM", () => sdk.shutdown().catch(console.error));
  process.on("SIGINT", () => sdk.shutdown().catch(console.error));
}