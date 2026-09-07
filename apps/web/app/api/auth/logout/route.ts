import { revokeSession } from "@zfloat/auth";
import { getDb } from "@zfloat/database";
import { getSessionToken, SESSION_COOKIE } from "@/lib/api";
import { NextResponse } from "next/server";

export async function POST() {
  const { db } = getDb();
  const token = getSessionToken();
  if (token) await revokeSession(db, token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
