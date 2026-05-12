"use client";

import { useEffect, useState } from "react";
import { formatLocalDateTimeWithOffset, formatUtcMediumShort } from "@/lib/formatLocalDateTime";

/**
 * Shows submitted time in the viewer's locale and timezone (with offset), after mount.
 * Initial paint uses UTC so SSR and hydration match, then switches to local.
 */
export default function ClientLocalDateTime({ iso }) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!iso) return "—";

  const label = hasMounted ? formatLocalDateTimeWithOffset(iso) : formatUtcMediumShort(iso);

  return (
    <time dateTime={iso} className="tabular-nums" title={iso}>
      {label}
    </time>
  );
}
