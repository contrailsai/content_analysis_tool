import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/authRequest";
import { sendIngestionMessage } from "@/lib/sqs";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

function parseAllowedHostsEnv() {
  const raw = process.env.URL_INGEST_ALLOWED_HOSTS || "";
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedHost(hostname, allowed) {
  if (!allowed.length) return true;
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  return allowed.some((rule) => host === rule || host.endsWith(`.${rule}`));
}

function validateHttpUrl(trimmed) {
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs are supported." };
  }
  if (!u.hostname) {
    return { ok: false, error: "URL must include a hostname." };
  }
  const allowed = parseAllowedHostsEnv();
  if (!isAllowedHost(u.hostname, allowed)) {
    return {
      ok: false,
      error:
        allowed.length > 0
          ? `Hostname is not in the allowed list for URL ingest. Allowed: ${allowed.join(", ")}.`
          : "Hostname is not allowed for URL ingest.",
    };
  }
  return { ok: true, href: u.href };
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

  const raw = body?.source_url;
  if (raw == null || typeof raw !== "string") {
    return NextResponse.json({ error: "source_url is required." }, { status: 400 });
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "source_url must not be empty." }, { status: 400 });
  }

  const parsed = validateHttpUrl(trimmed);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const jobId = randomUUID();
  const supabase = getSupabaseAdmin();
  const row = {
    id: jobId,
    s3_key: null,
    source_url: parsed.href,
    overall_status: "queued",
    download_status: "pending",
    logo_status: "pending",
    ocr_status: "pending",
    metadata_status: "pending",
    logo_result: {},
    ocr_result: {},
    metadata_result: {},
  };

  const { data: inserted, error: insertError } = await supabase
    .from("cat_analysis_jobs")
    .insert(row)
    .select("id")
    .single();

  if (insertError || !inserted) {
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
