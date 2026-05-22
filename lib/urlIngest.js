/** @typedef {{ ok: true, href: string }} UrlOk */
/** @typedef {{ ok: false, error: string }} UrlErr */

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"')\]},]+/gi;

const TRAILING_JUNK_RE = /[.,;:!?)+\]}"'»]+$/;

export function parseAllowedHostsEnv() {
  const raw = process.env.URL_INGEST_ALLOWED_HOSTS || "";
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedHost(hostname, allowed) {
  if (!allowed.length) return true;
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  return allowed.some((rule) => host === rule || host.endsWith(`.${rule}`));
}

/**
 * @param {string} trimmed
 * @returns {UrlOk | UrlErr}
 */
export function validateHttpUrl(trimmed) {
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

function normalizeHttpMatch(raw) {
  const trimmed = raw.replace(TRAILING_JUNK_RE, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Pull unique http(s):// URLs from free text or CSV file contents.
 * @param {string} text
 * @returns {string[]}
 */
export function extractHttpsUrls(text) {
  if (typeof text !== "string" || !text.trim()) return [];

  const seen = new Set();
  const out = [];
  const re = new RegExp(HTTP_URL_PATTERN.source, "gi");
  let match;
  while ((match = re.exec(text)) !== null) {
    const href = normalizeHttpMatch(match[0]);
    if (href && !seen.has(href)) {
      seen.add(href);
      out.push(href);
    }
  }
  return out;
}
