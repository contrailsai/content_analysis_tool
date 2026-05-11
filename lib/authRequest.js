import { headerPasswordMatches } from "@/lib/password";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function isRequestAuthorized(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return true;
  return headerPasswordMatches(request);
}
