import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

function headerPasswordAuthorized(request) {
  const h = request.headers.get("x-cat-password");
  const p = process.env.APP_PASSWORD;
  if (!h || !p) return false;
  return h === p;
}

async function authorized(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return true;
  return headerPasswordAuthorized(request);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const ok = await authorized(request);

  if (pathname.startsWith("/login")) {
    if (ok) {
      return NextResponse.redirect(new URL("/cases", request.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/api/login") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (!ok) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:ico|png|jpg|jpeg|svg|webp)$).*)"],
};
