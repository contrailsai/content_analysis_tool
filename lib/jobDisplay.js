/** Truncate long strings for table cells / titles (single line). */
export function truncateMiddle(s, max = 72) {
  const str = String(s ?? "");
  if (str.length <= max) return str;
  const left = Math.max(8, Math.floor(max / 2) - 1);
  const right = Math.max(8, Math.ceil(max / 2) - 2);
  return `${str.slice(0, left)}…${str.slice(-right)}`;
}

export function basenameFromS3Key(key) {
  if (!key) return "";
  const parts = String(key).split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(key);
}

/** Cases list "Document" column: prefer S3 basename, else shortened source URL. */
export function displayJobDocumentLabel(job) {
  const fromKey = basenameFromS3Key(job?.s3_key);
  if (fromKey) return fromKey;
  const u = job?.source_url;
  if (typeof u === "string" && u.trim()) return truncateMiddle(u.trim(), 80);
  return "—";
}

/** Case detail page heading: prefer S3 basename, else shortened URL, else default. */
export function displayJobCaseTitle(job, fallback = "Analysis results") {
  const fromKey = basenameFromS3Key(job?.s3_key);
  if (fromKey) return fromKey;
  const u = job?.source_url;
  if (typeof u === "string" && u.trim()) return truncateMiddle(u.trim(), 96);
  return fallback;
}
