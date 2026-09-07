import { getConfig } from "@zfloat/config";
import { AirtimeProviderAdapter } from "./airtime.js";
import { BankProviderAdapter } from "./bank.js";
import { MockProvider } from "./mock.js";
import { MpesaProviderAdapter } from "./mpesa.js";
import type { PaymentProvider } from "./types.js";

export * from "./types.js";
export { MockProvider, MockBehaviour } from "./mock.js";
export { MpesaProviderAdapter } from "./mpesa.js";
export { BankProviderAdapter } from "./bank.js";
export { AirtimeProviderAdapter } from "./airtime.js";
export * from "./circuit-breaker.js";

export interface ProviderRegistry {
  get(code: string): PaymentProvider;
  /** The default provider configured for the environment (sandbox in dev). */
  default(): PaymentProvider;
}

/** Registry that resolves provider codes to adapters. Secrets come from env, never the DB. */
export function createProviderRegistry(overrides?: Record<string, PaymentProvider>): ProviderRegistry {
  const built: Record<string, PaymentProvider> = {
    "local-sandbox": new MockProvider(),
    "mpesa-safaricom": new MpesaProviderAdapter(),
    "bank-psp": new BankProviderAdapter(),
    "airtime-aggregator": new AirtimeProviderAdapter(),
    ...overrides,
  };
  return {
    get(code: string): PaymentProvider {
      const p = built[code];
      if (!p) throw new Error(`Unknown provider code: ${code}`);
      return p;
    },
    default(): PaymentProvider {
      return built[getConfig().PROVIDER_DEFAULT] ?? built["local-sandbox"]!;
    },
  };
}
