import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/authRequest";
import { sendIngestionMessage } from "@/lib/sqs";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { validateHttpUrl } from "@/lib/urlIngest";

export const runtime = "nodejs";

function buildJobRow(jobId, sourceUrl) {
  return {
    id: jobId,
    s3_key: null,
    source_url: sourceUrl,
    overall_status: "queued",
    download_status: "pending",
    logo_status: "pending",
    ocr_status: "pending",
    metadata_status: "pending",
    logo_result: {},
    ocr_result: {},
    metadata_result: {},
  };
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

  const rawList = body?.source_urls;
  if (!Array.isArray(rawList)) {
    return NextResponse.json({ error: "source_urls must be an array." }, { status: 400 });
  }

  if (rawList.length === 0) {
    return NextResponse.json({ error: "At least one URL is required." }, { status: 400 });
  }

  const seen = new Set();
  const hrefs = [];
  const validationErrors = [];

  for (let i = 0; i < rawList.length; i += 1) {
    const item = rawList[i];
    if (typeof item !== "string") {
      validationErrors.push({ index: i, url: String(item), error: "URL must be a string." });
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      validationErrors.push({ index: i, url: item, error: "URL must not be empty." });
      continue;
    }
    const parsed = validateHttpUrl(trimmed);
    if (!parsed.ok) {
      validationErrors.push({ index: i, url: trimmed, error: parsed.error });
      continue;
    }
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    hrefs.push(parsed.href);
  }

  if (validationErrors.length) {
    return NextResponse.json(
      { error: "One or more URLs are invalid.", validation_errors: validationErrors },
      { status: 400 },
    );
  }

  if (hrefs.length === 0) {
    return NextResponse.json({ error: "No valid URLs to queue." }, { status: 400 });
  }

  const jobSpecs = hrefs.map((href) => ({ jobId: randomUUID(), href }));
  const rows = jobSpecs.map(({ jobId, href }) => buildJobRow(jobId, href));

  const supabase = getSupabaseAdmin();
  const { data: inserted, error: insertError } = await supabase
    .from("cat_analysis_jobs")
    .insert(rows)
    .select("id");

  if (insertError || !inserted?.length) {
    console.error("Supabase batch insert failed", insertError);
    return NextResponse.json({ error: "Failed to record jobs." }, { status: 502 });
  }

  const queued = [];
  const queueFailures = [];

  for (const { jobId, href } of jobSpecs) {
    try {
      await sendIngestionMessage({ job_id: jobId });
      queued.push({ job_id: jobId, source_url: href });
    } catch (e) {
      console.error("SQS send failed for job", jobId, e);
      queueFailures.push({ job_id: jobId, source_url: href });
    }
  }

  if (queueFailures.length && queued.length === 0) {
    return NextResponse.json(
      {
        error: "Jobs recorded but queue messages failed.",
        job_ids: inserted.map((r) => r.id),
        queue_failures: queueFailures,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    job_ids: queued.map((q) => q.job_id),
    queued_count: queued.length,
    queue_failures: queueFailures.length ? queueFailures : undefined,
  });
}
