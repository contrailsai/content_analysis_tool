import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/authRequest";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function GET(request) {
  if (!(await isRequestAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("cat_analysis_jobs")
    .select(
      "id, s3_key, source_url, overall_status, download_status, logo_status, ocr_status, metadata_status, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Supabase list failed", error);
    return NextResponse.json({ error: "Failed to load cases." }, { status: 502 });
  }

  return NextResponse.json({ jobs: data ?? [] });
}
