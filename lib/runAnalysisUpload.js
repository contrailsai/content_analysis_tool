import { createHmac, timingSafeEqual } from "crypto";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
export const UPLOAD_PRESIGN_EXPIRES_SEC = 900;

const STEM_SEGMENT_MAX = 140;

/** `{prefix}/{job_id}/{stem}{ext}` — stem is ASCII-safe; job_id keeps keys unique. */
export function keyPrefix() {
  return (process.env.CAT_S3_KEY_PREFIX || "uploads").replace(/^\/+|\/+$/g, "");
}

function extFromFilename(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(name || "");
  return m ? `.${m[1].toLowerCase()}` : ".jpg";
}

function slugStemForObjectKey(stem) {
  const s = String(stem || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^_|_$/g, "");
  const clipped = s.slice(0, STEM_SEGMENT_MAX);
  return clipped || "file";
}

export function buildS3Key(jobId, sanitizedFilename) {
  const ext = extFromFilename(sanitizedFilename);
  const lower = sanitizedFilename.toLowerCase();
  const extLower = ext.toLowerCase();
  const rawStem = lower.endsWith(extLower) ? sanitizedFilename.slice(0, -ext.length) : sanitizedFilename;
  const stem = slugStemForObjectKey(rawStem);
  return `${keyPrefix()}/${jobId}/${stem}${ext}`;
}

export function sanitizeFilename(name) {
  const base = name.replace(/^.*[/\\]/, "").replace(/\0/g, "");
  const noWs = base.replace(/\s+/g, "_");
  return noWs.slice(0, 240) || "upload.bin";
}

export function contentDispositionInline(filename) {
  const safe = sanitizeFilename(filename).replace(/[\r\n"]/g, "");
  const asciiFallback = [...safe]
    .map((ch) => (ch.charCodeAt(0) < 128 ? ch : "_"))
    .join("")
    .slice(0, 180) || "file";
  const star = encodeURIComponent(safe).replace(/'/g, "%27");
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${star}`;
}

export function utf8ToMetaB64(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64");
}

export function isAcceptedContentType(contentType) {
  const t = String(contentType || "").toLowerCase();
  return t.startsWith("image/") || t.startsWith("video/");
}

/** @returns {{ ok: true, body: InitBody } | { ok: false, error: string }} */
export function validateInitBody(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Expected JSON body." };
  }

  const fileName = raw.file_name;
  if (typeof fileName !== "string" || !fileName.trim()) {
    return { ok: false, error: "file_name is required." };
  }

  const contentType = raw.content_type;
  if (typeof contentType !== "string" || !contentType.trim()) {
    return { ok: false, error: "content_type is required." };
  }
  if (!isAcceptedContentType(contentType)) {
    return { ok: false, error: "Only image and video content types are allowed." };
  }

  const byteSize = raw.byte_size;
  if (typeof byteSize !== "number" || !Number.isInteger(byteSize) || byteSize <= 0) {
    return { ok: false, error: "byte_size must be a positive integer." };
  }
  if (byteSize > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `byte_size must not exceed ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` };
  }

  const lastModifiedMs = raw.last_modified_ms;
  if (typeof lastModifiedMs !== "number" || !Number.isFinite(lastModifiedMs) || lastModifiedMs < 0) {
    return { ok: false, error: "last_modified_ms must be a non-negative number." };
  }

  let relativePath = "";
  if (raw.relative_path != null) {
    if (typeof raw.relative_path !== "string") {
      return { ok: false, error: "relative_path must be a string." };
    }
    relativePath = raw.relative_path;
  }

  return {
    ok: true,
    body: {
      file_name: fileName,
      content_type: contentType.trim(),
      byte_size: byteSize,
      last_modified_ms: lastModifiedMs,
      relative_path: relativePath,
    },
  };
}

export function buildObjectMetadata({ originalFileName, sanitizedName, contentType, byteSize, lastModifiedMs, relativePath }) {
  return {
    "original-name-b64": utf8ToMetaB64(originalFileName || sanitizedName),
    "client-last-modified-ms": String(lastModifiedMs),
    "client-byte-size": String(byteSize),
    "client-mime": contentType,
    "client-relative-path-b64": utf8ToMetaB64(relativePath || ""),
  };
}

export function metadataToPutHeaders(metadata) {
  const headers = {};
  for (const [k, v] of Object.entries(metadata)) {
    headers[`x-amz-meta-${k}`] = v;
  }
  return headers;
}

/** Headers the browser must send on presigned PUT (keep minimal for SigV4 parity). */
export function buildRequiredPutHeaders({ contentType }) {
  return {
    "Content-Type": contentType,
  };
}

export function s3KeyBelongsToJob(jobId, s3Key) {
  const prefix = `${keyPrefix()}/${jobId}/`;
  return typeof s3Key === "string" && s3Key.startsWith(prefix) && s3Key.length > prefix.length;
}

function getUploadSigningSecret() {
  const dedicated = process.env.UPLOAD_SIGNING_SECRET?.trim();
  if (dedicated && dedicated.length >= 16) return dedicated;
  const session = process.env.SESSION_SECRET?.trim();
  if (session && session.length >= 16) return session;
  return null;
}

function signPayload(payloadB64, secret) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/** @returns {string | null} */
export function signUploadToken({
  jobId,
  s3Key,
  byteSize,
  contentType,
  fileName,
  lastModifiedMs,
  relativePath = "",
  expiresInSec = UPLOAD_PRESIGN_EXPIRES_SEC,
}) {
  const secret = getUploadSigningSecret();
  if (!secret) return null;

  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const payload = {
    job_id: jobId,
    s3_key: s3Key,
    byte_size: byteSize,
    content_type: contentType,
    file_name: fileName,
    last_modified_ms: lastModifiedMs,
    relative_path: relativePath,
    exp,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signPayload(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

/** @returns {{ job_id: string, s3_key: string, byte_size: number, content_type: string } | null} */
export function verifyUploadToken(token, jobId) {
  const secret = getUploadSigningSecret();
  if (!secret || !token || typeof token !== "string" || !token.includes(".")) return null;

  const dot = token.indexOf(".");
  const payloadB64 = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  if (!payloadB64 || !sigPart) return null;

  const expectedSig = signPayload(payloadB64, secret);
  const a = Buffer.from(sigPart);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (payload.job_id !== jobId) return null;
  if (typeof payload.s3_key !== "string" || !payload.s3_key) return null;
  if (typeof payload.byte_size !== "number" || payload.byte_size <= 0) return null;
  if (typeof payload.content_type !== "string" || !payload.content_type) return null;
  if (!s3KeyBelongsToJob(payload.job_id, payload.s3_key)) return null;

  if (typeof payload.file_name !== "string" || !payload.file_name) return null;
  if (typeof payload.last_modified_ms !== "number" || payload.last_modified_ms < 0) return null;
  if (payload.relative_path != null && typeof payload.relative_path !== "string") return null;

  return {
    job_id: payload.job_id,
    s3_key: payload.s3_key,
    byte_size: payload.byte_size,
    content_type: payload.content_type,
    file_name: payload.file_name,
    last_modified_ms: payload.last_modified_ms,
    relative_path: typeof payload.relative_path === "string" ? payload.relative_path : "",
  };
}

export function buildAnalysisJobRow(jobId, s3Key) {
  return {
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
}
