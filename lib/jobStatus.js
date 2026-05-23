export function isFailedStatus(overall) {
  const s = (overall || "").toLowerCase();
  return s === "failed" || s === "error";
}

export const STATUS_FILTER_GROUPS = {
  completed: ["completed", "done"],
  failed: ["failed", "error"],
  processing: ["processing", "running"],
  queued: ["queued", "pending"],
};

const STATUS_FILTER_OPTIONS = new Set(["all", ...Object.keys(STATUS_FILTER_GROUPS)]);

export function parseStatusFilter(value) {
  if (typeof value !== "string") return "all";
  const key = value.toLowerCase();
  return STATUS_FILTER_OPTIONS.has(key) ? key : "all";
}

export function parseDateFilterParam(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export function isInvalidDateRange(from, to) {
  return Boolean(from && to && from > to);
}
