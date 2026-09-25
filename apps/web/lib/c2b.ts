/**
 * Daraja C2B callbacks carry no signature, so they are authenticated by a
 * secret token in the registered URL (?token=MPESA_C2B_CALLBACK_TOKEN,
 * constant-time compare). In production an unset token rejects everything.
 */
import { timingSafeEqual } from "node:crypto";
import { getConfig } from "@zfloat/config";

export function c2bTokenOk(request: Request): boolean {
  const expected = getConfig().MPESA_C2B_CALLBACK_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production";
  const got = new URL(request.url).searchParams.get("token") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
