import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/authRequest";
import { isFailedStatus } from "@/lib/jobStatus";
import { sendIngestionMessage } from "@/lib/sqs";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  if (!(await isRequestAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = (await params).id;
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: job, error: fetchError } = await supabase
    .from("cat_analysis_jobs")
    .select("id, overall_status, s3_key, source_url")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    console.error("Supabase get failed", fetchError);
    return NextResponse.json({ error: "Failed to load case." }, { status: 502 });
  }

  if (!job) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (!isFailedStatus(job.overall_status)) {
    return NextResponse.json({ error: "Only failed cases can be retried." }, { status: 400 });
  }

  if (!job.s3_key && !job.source_url) {
    return NextResponse.json({ error: "Case has no source to retry." }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("cat_analysis_jobs")
    .update({
      overall_status: "queued",
      download_status: "pending",
      logo_status: "pending",
      ocr_status: "pending",
      metadata_status: "pending",
      logo_result: {},
      ocr_result: {},
      metadata_result: {},
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) {
    console.error("Supabase update failed", updateError);
    return NextResponse.json({ error: "Failed to reset case for retry." }, { status: 502 });
  }

  try {
    await sendIngestionMessage({ job_id: id });
  } catch (e) {
    console.error("SQS send failed", e);
    return NextResponse.json({ error: "Case reset but queue message failed." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, job_id: id });
}
