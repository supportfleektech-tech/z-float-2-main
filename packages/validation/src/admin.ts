import { z } from "zod";

export const feeRuleSchema = z.object({
  product: z.string().min(1),
  channel: z.string().min(1),
  provider: z.string().min(1),
  flatFeeMinor: z.coerce.bigint().nonnegative(),
  percentBps: z.coerce.bigint().nonnegative().max(1_000_000n), // <= 100%
  minFeeMinor: z.coerce.bigint().nonnegative(),
  maxFeeMinor: z.coerce.bigint().nonnegative(),
  currency: z.enum(["KES"]),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  status: z.enum(["ACTIVE", "DRAFT", "DISABLED"]).default("ACTIVE"),
});

export const limitRuleSchema = z.object({
  scope: z.enum(["TENANT", "USER", "CHANNEL"]),
  scopeRef: z.string().uuid().optional(),
  product: z.string().optional(),
  channel: z.string().optional(),
  minAmountMinor: z.coerce.bigint().nonnegative().default(0n),
  maxAmountMinor: z.coerce.bigint().nonnegative(),
  dailyLimitMinor: z.coerce.bigint().nonnegative(),
  monthlyLimitMinor: z.coerce.bigint().nonnegative(),
  enabled: z.boolean().default(true),
});

export const approvalPolicySchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().max(1000).optional(),
  rules: z.array(
    z.object({
      // rule conditions
      minAmountMinor: z.coerce.bigint().nonnegative().default(0n),
      maxAmountMinor: z.coerce.bigint().nonnegative().default(0n), // 0 = unlimited
      products: z.array(z.string()).default([]), // empty = all
      channels: z.array(z.string()).default([]),
      branchIds: z.array(z.string().uuid()).default([]),
      departmentIds: z.array(z.string().uuid()).default([]),
      riskFlags: z.array(z.string()).default([]),
      // approval requirement
      mode: z.enum(["SEQUENTIAL", "PARALLEL", "ANY"]).default("SEQUENTIAL"),
      requiredRoles: z.array(z.string()).min(1),
      minApprovers: z.coerce.number().int().min(1).default(1),
      order: z.coerce.number().int().default(0),
    }),
  ),
  active: z.boolean().default(true),
});

export const providerConfigSchema = z.object({
  name: z.string().min(2).max(100),
  providerType: z.enum(["mpesa", "bank", "airtime", "sandbox"]),
  environment: z.enum(["sandbox", "production"]),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()),
});

export const featureFlagSchema = z.object({
  key: z.string().min(2).max(100).regex(/^[a-z0-9_.-]+$/),
  enabled: z.boolean().default(false),
  tenantScope: z.string().uuid().optional(),
  percentage: z.coerce.number().min(0).max(100).default(100),
  description: z.string().max(500).optional(),
});
