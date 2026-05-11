import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/authRequest";
import { putObjectToS3 } from "@/lib/s3";
import { sendIngestionMessage } from "@/lib/sqs";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/** Match Python: {key_prefix}/{job_id}/document{ext} (default prefix test-runs in script; we use env or uploads). */
function keyPrefix() {
  return (process.env.CAT_S3_KEY_PREFIX || "uploads").replace(/^\/+|\/+$/g, "");
}

function extFromFilename(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name || "");
  return m ? `.${m[1].toLowerCase()}` : ".jpg";
}

function buildS3Key(jobId, originalFilename) {
  const ext = extFromFilename(originalFilename);
  return `${keyPrefix()}/${jobId}/document${ext}`;
}

function sanitizeFilename(name) {
  const base = name.replace(/^.*[/\\]/, "").replace(/\0/g, "");
  /** S3 keys and Content-Disposition: avoid whitespace (collapse runs to a single underscore). */
  const noWs = base.replace(/\s+/g, "_");
  return noWs.slice(0, 240) || "upload.bin";
}

/** ASCII `filename=` segment plus RFC 5987 `filename*=` for full Unicode. */
function contentDispositionInline(filename) {
  const safe = sanitizeFilename(filename).replace(/[\r\n"]/g, "");
  const asciiFallback = [...safe]
    .map((ch) => (ch.charCodeAt(0) < 128 ? ch : "_"))
    .join("")
    .slice(0, 180) || "file";
  const star = encodeURIComponent(safe).replace(/'/g, "%27");
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${star}`;
}

/** S3 user metadata values must be ASCII; store exact UTF-8 as base64 (empty string allowed). */
function utf8ToMetaB64(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64");
}

export async function POST(request) {
  if (!(await isRequestAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string" || !file.size) {
    return NextResponse.json({ error: "Missing file field." }, { status: 400 });
  }

  const clientName = formData.get("client_file_name");
  const clientMime = formData.get("client_mime");
  const clientSize = formData.get("client_byte_size");
  const clientLastMs = formData.get("client_last_modified_ms");
  const clientRelPath = formData.get("client_relative_path");

  if (typeof clientSize === "string" && clientSize.trim() !== "") {
    const n = Number(clientSize);
    if (Number.isFinite(n) && n !== file.size) {
      return NextResponse.json({ error: "Declared file size does not match upload." }, { status: 400 });
    }
  }
  if (typeof clientMime === "string" && clientMime.trim() !== "" && file.type && clientMime !== file.type) {
    return NextResponse.json({ error: "Declared MIME type does not match upload." }, { status: 400 });
  }
  if (typeof clientName === "string" && clientName.trim() !== "" && clientName !== file.name) {
    return NextResponse.json({ error: "Declared file name does not match upload." }, { status: 400 });
  }
  // Do not compare client_last_modified_ms to file.lastModified: multipart File in Node often
  // does not preserve the browser's lastModified (it may reflect parse time). Trust client field for metadata.
  if (typeof clientLastMs === "string" && clientLastMs.trim() !== "") {
    const n = Number(clientLastMs);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "Invalid client_last_modified_ms." }, { status: 400 });
    }
  }

  const jobId = randomUUID();
  const originalName = sanitizeFilename(file.name || "upload");
  const s3Key = buildS3Key(jobId, originalName);
  const buf = Buffer.from(await file.arrayBuffer());

  const contentType = (file.type && file.type.trim()) || "application/octet-stream";
  const metadata = Object.fromEntries([
    ["original-name-b64", utf8ToMetaB64(file.name || originalName)],
    [
      "client-last-modified-ms",
      typeof clientLastMs === "string" && clientLastMs.trim() !== "" ? clientLastMs : String(file.lastModified),
    ],
    ["client-byte-size", String(file.size)],
    ["client-mime", (file.type && file.type.trim()) || (typeof clientMime === "string" ? clientMime : "") || ""],
    ["client-relative-path-b64", utf8ToMetaB64(typeof clientRelPath === "string" ? clientRelPath : "")],
  ]);

  try {
    await putObjectToS3({
      key: s3Key,
      body: buf,
      contentType,
      metadata,
      contentDisposition: contentDispositionInline(file.name || originalName),
    });
  } catch (e) {
    console.error("S3 upload failed", e);
    return NextResponse.json({ error: "Upload to storage failed." }, { status: 502 });
  }

  const supabase = getSupabaseAdmin();
  const row = {
    id: jobId,
    s3_key: s3Key,
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
