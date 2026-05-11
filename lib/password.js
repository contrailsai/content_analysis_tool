import { timingSafeEqual } from "crypto";

function timingSafeEqualString(a, b) {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyAppPassword(plain) {
  const expected = process.env.APP_PASSWORD;
  if (!expected || !plain) return false;
  return timingSafeEqualString(plain, expected);
}

export function headerPasswordMatches(request) {
  const h = request.headers.get("x-cat-password");
  if (!h) return false;
  return verifyAppPassword(h);
}
