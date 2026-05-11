import { NextResponse } from "next/server";
import { verifyAppPassword } from "@/lib/password";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const password = typeof body?.password === "string" ? body.password : "";
  if (!verifyAppPassword(password)) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  let token;
  try {
    token = await createSessionToken();
  } catch (e) {
    return NextResponse.json(
      { error: e?.message || "Session configuration error." },
      { status: 500 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}
