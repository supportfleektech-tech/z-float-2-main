/**
 * Server-side guard: ensures the platform secrets vault (KMS/local envelope)
 * has been applied to process.env before the first `getConfig()` call of the
 * process fills the cached env snapshot. `getConfig()` memoizes, so every
 * web entrypoint that reads config must await `secretsReady` first.
 *
 * Memoized per process; resolves instantly when SECRETS_DRIVER=none (default).
 */
import { applySecretsToEnv } from "@zfloat/secrets";

let promise: Promise<void> | null = null;

export function secretsReady(): Promise<void> {
  promise ??= applySecretsToEnv()
    .catch((err) => {
      // Fail closed: never serve requests on a misconfigured vault.
      console.error("[secrets] vault failure — request rejected:", err);
      throw err;
    })
    .then(() => undefined);
  return promise;
}
