import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PORTAL_PREFIXES = ["/portal", "/admin"];
const AUTH_PAGES = ["/login", "/register"];

/** Route protection: unauthenticated users hitting portal/admin go to /login. */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get("zf_session")?.value;

  const isProtected = PORTAL_PREFIXES.some((p) => pathname.startsWith(p));
  const isAuthPage = AUTH_PAGES.includes(pathname);

  if (isProtected && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (isAuthPage && session) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal";
    return NextResponse.redirect(url);
  }
  // Legacy invite links pointed at /login?invite=… — forward to the register flow.
  if (pathname === "/login" && request.nextUrl.searchParams.get("invite")) {
    const url = request.nextUrl.clone();
    url.pathname = "/register";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/portal/:path*", "/admin/:path*", "/login", "/register"],
};
