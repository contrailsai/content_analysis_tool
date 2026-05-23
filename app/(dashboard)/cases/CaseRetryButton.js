"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CaseRetryButton({ jobId, docLabel }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");

  async function onRetry() {
    if (retrying) return;
    setRetrying(true);
    setError("");

    try {
      const res = await fetch(`/api/cases/${jobId}/retry`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Retry failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Retry failed.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex items-center justify-center rounded-none border border-amber-700 bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
      >
        {retrying ? "Retrying…" : "Retry"}
        <span className="sr-only"> case {docLabel}</span>
      </button>
      {error ? <span className="max-w-[12rem] text-right text-[10px] leading-snug text-red-700">{error}</span> : null}
    </span>
  );
}
