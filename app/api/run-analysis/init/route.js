import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/authRequest";
import {
  UPLOAD_PRESIGN_EXPIRES_SEC,
  buildRequiredPutHeaders,
  buildS3Key,
  sanitizeFilename,
  signUploadToken,
  validateInitBody,
} from "@/lib/runAnalysisUpload";
import { getPresignedPutUrl } from "@/lib/s3";

export const runtime = "nodejs";

export async function POST(request) {
  if (!(await isRequestAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const validated = validateInitBody(raw);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { file_name, content_type, byte_size, last_modified_ms, relative_path } = validated.body;
  const jobId = randomUUID();
  const sanitizedName = sanitizeFilename(file_name);
  const s3Key = buildS3Key(jobId, sanitizedName);

  const uploadToken = signUploadToken({
    jobId,
    s3Key,
    byteSize: byte_size,
    contentType: content_type,
    fileName: file_name,
    lastModifiedMs: last_modified_ms,
    relativePath: relative_path,
    expiresInSec: UPLOAD_PRESIGN_EXPIRES_SEC,
  });
  if (!uploadToken) {
    return NextResponse.json(
      { error: "Upload signing is not configured (SESSION_SECRET or UPLOAD_SIGNING_SECRET)." },
      { status: 500 },
    );
  }

  let uploadUrl;
  try {
    uploadUrl = await getPresignedPutUrl({
      key: s3Key,
      contentType: content_type,
      expiresIn: UPLOAD_PRESIGN_EXPIRES_SEC,
    });
  } catch (e) {
    console.error("Presigned PUT failed", e);
    return NextResponse.json({ error: "Failed to create upload URL." }, { status: 502 });
  }

  const required_headers = buildRequiredPutHeaders({ contentType: content_type });

  return NextResponse.json({
    job_id: jobId,
    upload_url: uploadUrl,
    upload_token: uploadToken,
    expires_in: UPLOAD_PRESIGN_EXPIRES_SEC,
    required_headers,
  });
}
