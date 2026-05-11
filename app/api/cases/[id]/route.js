import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/authRequest";
import { getPresignedGetUrl } from "@/lib/s3";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  if (!(await isRequestAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = (await params).id;
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("cat_analysis_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Supabase get failed", error);
    return NextResponse.json({ error: "Failed to load case." }, { status: 502 });
  }

  if (!job) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let mediaUrl = null;
  try {
    if (job.s3_key) {
      mediaUrl = await getPresignedGetUrl({ key: job.s3_key, expiresIn: 3600 });
    }
  } catch (e) {
    console.error("Presign failed", e);
  }

  return NextResponse.json({ job, mediaUrl });
}
