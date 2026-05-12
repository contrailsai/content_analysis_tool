/**
 * Format an instant in the runtime's local timezone with a GMT±HH:MM style offset when available.
 * @param {string | number | Date} input ISO string, epoch ms, or Date
 */
export function formatLocalDateTimeWithOffset(input) {
  if (input === null || input === undefined || input === "") return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "shortOffset",
    }).format(d);
  } catch {
    try {
      return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return "—";
    }
  }
}

/** Stable UTC label for SSR + first client paint (avoids hydration mismatch). */
export function formatUtcMediumShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "shortOffset",
    }).format(d);
  } catch {
    return "—";
  }
}
