import { z } from "zod";
import { emailSchema, phoneInputSchema } from "./common.js";

export const businessRoles = [
  "OWNER",
  "ADMIN",
  "FINANCE_MANAGER",
  "MAKER",
  "APPROVER",
  "PAYROLL_OFFICER",
  "PROCUREMENT_OFFICER",
  "ACCOUNTANT",
  "BRANCH_MANAGER",
  "VIEWER",
] as const;

export const platformRoles = [
  "SUPER_ADMIN",
  "OPS_ADMIN",
  "COMPLIANCE_ADMIN",
  "FINANCE_ADMIN",
  "SUPPORT_ADMIN",
  "DEV_ADMIN",
  "AUDITOR",
] as const;

export const inviteUserSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2).max(200),
  role: z.enum(businessRoles),
  branchIds: z.array(z.string().uuid()).min(1),
  phone: phoneInputSchema.optional(),
});

export const updateRoleSchema = z.object({
  role: z.enum(businessRoles),
});
