import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/authRequest";
import {
  buildAnalysisJobRow,
  buildObjectMetadata,
  contentDispositionInline,
  verifyUploadToken,
} from "@/lib/runAnalysisUpload";
import { applyObjectMetadata, headObjectFromS3 } from "@/lib/s3";
import { sendIngestionMessage } from "@/lib/sqs";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

function contentTypesMatch(expected, actual) {
  const a = String(expected || "").toLowerCase().split(";")[0].trim();
  const b = String(actual || "").toLowerCase().split(";")[0].trim();
  return a === b;
}

export async function POST(request) {
  if (!(await isRequestAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const jobId = body?.job_id;
  const uploadToken = body?.upload_token;
  if (typeof jobId !== "string" || !jobId.trim()) {
    return NextResponse.json({ error: "job_id is required." }, { status: 400 });
  }
  if (typeof uploadToken !== "string" || !uploadToken.trim()) {
    return NextResponse.json({ error: "upload_token is required." }, { status: 400 });
  }

  const session = verifyUploadToken(uploadToken, jobId);
  if (!session) {
    return NextResponse.json({ error: "Invalid or expired upload session." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase.from("cat_analysis_jobs").select("id").eq("id", jobId).maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, job_id: jobId });
  }

  let head;
  try {
    head = await headObjectFromS3({ key: session.s3_key });
  } catch (e) {
    const code = e?.name || e?.Code;
    if (code === "NotFound" || code === "NoSuchKey") {
      return NextResponse.json({ error: "Upload not found in storage. Complete the S3 PUT first." }, { status: 400 });
    }
    console.error("S3 HeadObject failed", e);
    return NextResponse.json({ error: "Failed to verify upload." }, { status: 502 });
  }

  if (head.ContentLength !== session.byte_size) {
    return NextResponse.json({ error: "Uploaded object size does not match declared size." }, { status: 400 });
  }
  if (!contentTypesMatch(session.content_type, head.ContentType)) {
    return NextResponse.json({ error: "Uploaded object content type does not match." }, { status: 400 });
  }

  const metadata = buildObjectMetadata({
    originalFileName: session.file_name,
    sanitizedName: session.file_name,
    contentType: session.content_type,
    byteSize: session.byte_size,
    lastModifiedMs: session.last_modified_ms,
    relativePath: session.relative_path,
  });
  const contentDisposition = contentDispositionInline(session.file_name);

  try {
    await applyObjectMetadata({
      key: session.s3_key,
      contentType: session.content_type,
      metadata,
      contentDisposition,
    });
  } catch (e) {
    console.error("S3 metadata apply failed", e);
    return NextResponse.json({ error: "Failed to finalize upload metadata." }, { status: 502 });
  }

  const row = buildAnalysisJobRow(jobId, session.s3_key);
  const { data: inserted, error: insertError } = await supabase
    .from("cat_analysis_jobs")
    .insert(row)
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      return NextResponse.json({ ok: true, job_id: jobId });
    }
    console.error("Supabase insert failed", insertError);
    return NextResponse.json({ error: "Failed to record job." }, { status: 502 });
  }

  try {
    await sendIngestionMessage({ job_id: jobId });
  } catch (e) {
    console.error("SQS send failed", e);
    return NextResponse.json(
      { error: "Job recorded but queue message failed.", job_id: jobId },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, job_id: jobId });
}
