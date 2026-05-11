import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export default async function Home() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) {
    redirect("/cases");
  }
  redirect("/login");
}
