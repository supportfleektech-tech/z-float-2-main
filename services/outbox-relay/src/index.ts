/**
 * Standalone outbox relay — the outbox poller as its own deployment.
 *
 * Runs the same shared dispatch loop as the worker's embedded relay
 * (packages/payments-core/src/outbox-relay.ts). Multiple relays and/or the
 * worker can run side by side: each poll tick is arbitrated by a Postgres
 * advisory transaction lock, so a tick is always handled by exactly one
 * process.
 *
 * Usage:  pnpm dev:relay        (dev)   |   pnpm start:relay   (prod build)
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "@zfloat/config";
import { getDb } from "@zfloat/database";
import { runOutboxPoller, handleOutboxEvent } from "@zfloat/payments-core";
import { applySecretsToEnv } from "@zfloat/secrets";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

try {
  await applySecretsToEnv();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[relay] secrets vault failure — refusing to start:", err);
  process.exit(1);
}

function main() {
  const config = getConfig();
  const { db } = getDb();

  const poller = runOutboxPoller(db, {
    handle: (event) => handleOutboxEvent(db, event),
    intervalMs: config.OUTBOX_RELAY_INTERVAL_MS,
    log: (line) => console.log(line),
  });

  // eslint-disable-next-line no-console
  console.log(`[relay] outbox relay up — poll interval ${config.OUTBOX_RELAY_INTERVAL_MS}ms (lease key shared with the worker)`);

  // The poll timer is unref'd (safe when embedded elsewhere); a standalone
  // deployment must keep the event loop alive itself.
  const keepAlive = setInterval(() => undefined, 60_000);

  const shutdown = () => {
    poller.stop();
    clearInterval(keepAlive);
    // eslint-disable-next-line no-console
    console.log("[relay] shutting down...");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
