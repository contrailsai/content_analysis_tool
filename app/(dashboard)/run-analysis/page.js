"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatLocalDateTimeWithOffset } from "@/lib/formatLocalDateTime";
import { extractHttpsUrls, MAX_BATCH_SOURCE_URLS } from "@/lib/urlIngest";

const ACCEPT = "image/*,video/*";
const MAX_BYTES = 10 * 1024 * 1024;
const POLL_MS = 1500;
const POLL_MAX_MS = 10 * 60 * 1000;

function isAcceptedFile(file) {
  if (!file) return false;
  const t = file.type || "";
  return t.startsWith("image/") || t.startsWith("video/");
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatLastModified(ms) {
  if (typeof ms !== "number" || Number.isNaN(ms)) return "—";
  try {
    return formatLocalDateTimeWithOffset(ms);
  } catch {
    return "—";
  }
}

function downloadStepFinished(status) {
  return status === "done" || status === "failed";
}

function analysisStepFinished(status) {
  return status === "done" || status === "failed" || status === "skipped";
}

function jobProgressPct(job) {
  if (!job) return 0;
  let n = 0;
  if (downloadStepFinished(job.download_status)) n += 1;
  if (analysisStepFinished(job.logo_status)) n += 1;
  if (analysisStepFinished(job.ocr_status)) n += 1;
  if (analysisStepFinished(job.metadata_status)) n += 1;
  return Math.round((n / 4) * 100);
}

function shouldRedirectToCase(job) {
  if (!job || job.overall_status !== "completed") return false;
  if (!downloadStepFinished(job.download_status)) return false;
  if (!analysisStepFinished(job.logo_status)) return false;
  if (!analysisStepFinished(job.ocr_status)) return false;
  if (!analysisStepFinished(job.metadata_status)) return false;
  const logo = job.logo_result;
  const ocr = job.ocr_result;
  const metadata = job.metadata_result;
  if (logo == null || typeof logo !== "object" || Array.isArray(logo)) return false;
  if (ocr == null || typeof ocr !== "object" || Array.isArray(ocr)) return false;
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return true;
}

function statusChipClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "done") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (s === "failed") return "border-red-300 bg-red-50 text-red-900";
  if (s === "skipped") return "border-slate-300 bg-slate-100 text-slate-800";
  if (s === "running") return "border-amber-300 bg-amber-50 text-amber-950";
  if (s === "pending") return "border-slate-200 bg-white text-slate-600";
  return "border-slate-200 bg-white text-slate-700";
}

function safeUrlHostname(urlString) {
  try {
    return new URL(urlString).hostname || "";
  } catch {
    return "";
  }
}

/** Snapshot of the file for overlay + multipart parity fields (validated on server). */
function appendFileWithMetadata(formData, f) {
  formData.append("file", f, f.name);
  formData.append("client_file_name", f.name);
  formData.append("client_mime", f.type || "");
  formData.append("client_byte_size", String(f.size));
  formData.append("client_last_modified_ms", String(f.lastModified));
  if (typeof f.webkitRelativePath === "string" && f.webkitRelativePath) {
    formData.append("client_relative_path", f.webkitRelativePath);
  }
}

export default function RunAnalysisPage() {
  const router = useRouter();
  const inputRef = useRef(null);
  const pollStartRef = useRef(0);
  const sessionPreviewRef = useRef(null);

  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [trackingJobId, setTrackingJobId] = useState(null);
  const [pollProgressPct, setPollProgressPct] = useState(0);
  const [jobSnapshot, setJobSnapshot] = useState(null);
  /** Locked after successful upload: preview blob + exact client metadata for overlay while polling. */
  const [uploadSession, setUploadSession] = useState(null);
  /** Set when submitting or tracking a URL-sourced job (overlay metadata). */
  const [linkSession, setLinkSession] = useState(null);
  const [ingestMode, setIngestMode] = useState("file");
  const [linkInputMode, setLinkInputMode] = useState("single");
  const [sourceUrlInput, setSourceUrlInput] = useState("");
  const [bulkTextInput, setBulkTextInput] = useState("");
  const [detectedUrls, setDetectedUrls] = useState([]);
  const [bulkCsvName, setBulkCsvName] = useState("");
  const csvInputRef = useRef(null);

  const tracking = Boolean(trackingJobId);
  const busy = submitting || tracking;

  const clearRunSessions = useCallback(() => {
    if (sessionPreviewRef.current) {
      URL.revokeObjectURL(sessionPreviewRef.current);
      sessionPreviewRef.current = null;
    }
    setUploadSession(null);
    setLinkSession(null);
  }, []);

  const switchIngestMode = useCallback(
    (mode) => {
      if (busy) return;
      setIngestMode(mode);
      setError("");
      setStatus("");
      if (mode === "link") {
        setFile(null);
      }
      if (mode === "file") {
        setSourceUrlInput("");
        setBulkTextInput("");
        setDetectedUrls([]);
        setBulkCsvName("");
        setLinkInputMode("single");
      }
    },
    [busy],
  );

  const switchLinkInputMode = useCallback(
    (mode) => {
      if (busy) return;
      setLinkInputMode(mode);
      setError("");
      setDetectedUrls([]);
      setBulkCsvName("");
      if (mode === "single") {
        setBulkTextInput("");
      }
      if (mode !== "single") {
        setSourceUrlInput("");
      }
    },
    [busy],
  );

  const runUrlDetection = useCallback((text) => {
    const urls = extractHttpsUrls(text);
    setDetectedUrls(urls);
    return urls;
  }, []);

  const removeDetectedUrl = useCallback((href) => {
    setDetectedUrls((prev) => prev.filter((u) => u !== href));
  }, []);

  function onBulkTextChange(e) {
    const next = e.target.value;
    setBulkTextInput(next);
    setError("");
    runUrlDetection(next);
  }

  function onCsvInputChange(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || busy) return;
    setError("");
    const name = f.name || "upload.csv";
    const lower = name.toLowerCase();
    if (!lower.endsWith(".csv") && f.type !== "text/csv" && f.type !== "application/vnd.ms-excel") {
      setError("Upload a .csv file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const urls = runUrlDetection(text);
      setBulkCsvName(name);
      setBulkTextInput("");
      if (!urls.length) {
        setError("No https:// links found in that file.");
      }
    };
    reader.onerror = () => setError("Could not read the CSV file.");
    reader.readAsText(f);
  }

  async function onSubmitBulkLinks(e) {
    e.preventDefault();
    setError("");
    setStatus("");
    if (!detectedUrls.length) {
      setError(
        linkInputMode === "csv"
          ? "Upload a CSV with https:// links, or switch to paste mode."
          : "Paste text containing https:// links, or upload a CSV.",
      );
      return;
    }
    if (detectedUrls.length > MAX_BATCH_SOURCE_URLS) {
      setError(`At most ${MAX_BATCH_SOURCE_URLS} links per submission. Remove ${detectedUrls.length - MAX_BATCH_SOURCE_URLS} to continue.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/analysis/jobs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_urls: detectedUrls }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail =
          Array.isArray(data.validation_errors) && data.validation_errors.length
            ? ` ${data.validation_errors[0].error}`
            : "";
        setError((data.error || "Something went wrong.") + detail);
        return;
      }
      const count = data.queued_count ?? data.job_ids?.length ?? detectedUrls.length;
      setBulkTextInput("");
      setDetectedUrls([]);
      setBulkCsvName("");
      router.push(`/cases?queued=${count}`);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!trackingJobId) {
      setPollProgressPct(0);
      setJobSnapshot(null);
      return undefined;
    }

    pollStartRef.current = Date.now();
    let cancelled = false;
    let intervalId;

    async function pollOnce() {
      if (cancelled) return;
      if (Date.now() - pollStartRef.current > POLL_MAX_MS) {
        setError("Analysis is taking longer than expected. Open Cases to check progress.");
        setTrackingJobId(null);
        setStatus("");
        clearRunSessions();
        router.refresh();
        return;
      }

      try {
        const res = await fetch(`/api/cases/${trackingJobId}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok || !data.job) {
          setError(data.error || "Could not load job status.");
          setTrackingJobId(null);
          setStatus("");
          clearRunSessions();
          router.refresh();
          return;
        }

        const job = data.job;
        setPollProgressPct(jobProgressPct(job));
        setJobSnapshot({
          overall_status: job.overall_status,
          download_status: job.download_status,
          logo_status: job.logo_status,
          ocr_status: job.ocr_status,
          metadata_status: job.metadata_status,
        });

        if (job.download_status === "failed") {
          setError(job.error_message || "Download or URL ingest failed.");
          setTrackingJobId(null);
          setStatus("");
          clearRunSessions();
          router.refresh();
          return;
        }

        if (job.overall_status === "failed") {
          setError(job.error_message || "Analysis failed.");
          setTrackingJobId(null);
          setStatus("");
          clearRunSessions();
          router.refresh();
          return;
        }

        if (shouldRedirectToCase(job)) {
          cancelled = true;
          if (intervalId) clearInterval(intervalId);
          router.push(`/cases/${trackingJobId}`);
          return;
        }
      } catch {
        /* next poll */
      }
    }

    pollOnce();
    intervalId = setInterval(pollOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [trackingJobId, router, clearRunSessions]);

  useEffect(() => {
    return () => {
      if (sessionPreviewRef.current) {
        URL.revokeObjectURL(sessionPreviewRef.current);
        sessionPreviewRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!busy) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [busy]);

  const openPicker = useCallback(() => {
    if (busy) return;
    inputRef.current?.click();
  }, [busy]);

  const removeFile = useCallback(() => {
    if (busy) return;
    setFile(null);
    setError("");
    setStatus("");
  }, [busy]);

  const pickFile = useCallback(
    (f) => {
      if (busy) return;
      if (!f) return;
      if (!isAcceptedFile(f)) {
        setError("Only image and video files are supported.");
        return;
      }
      if (f.size > MAX_BYTES) {
        setError(`Files must be ${MAX_BYTES / (1024 * 1024)} MB or smaller. This file is ${formatBytes(f.size)}.`);
        return;
      }
      setError("");
      setStatus("");
      setFile(f);
    },
    [busy],
  );

  function onInputChange(e) {
    const f = e.target.files?.[0];
    pickFile(f);
    e.target.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (busy) return;
    pickFile(e.dataTransfer.files?.[0]);
  }

  function onDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setDragOver(true);
  }

  function onDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) setDragOver(false);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setStatus("");
    if (!file) {
      setError("Add an image or video by dropping it here or choosing a file.");
      return;
    }
    setSubmitting(true);
    const fd = new FormData();
    appendFileWithMetadata(fd, file);
    try {
      const res = await fetch("/api/run-analysis", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      const jobId = data.job_id;
      if (!jobId || typeof jobId !== "string") {
        setError("Missing job id from server.");
        return;
      }
      setLinkSession(null);
      if (sessionPreviewRef.current) {
        URL.revokeObjectURL(sessionPreviewRef.current);
        sessionPreviewRef.current = null;
      }
      const lockedUrl = URL.createObjectURL(file);
      sessionPreviewRef.current = lockedUrl;
      setUploadSession({
        previewUrl: lockedUrl,
        name: file.name,
        size: file.size,
        mime: file.type || "",
        lastModified: file.lastModified,
      });
      setFile(null);
      setStatus("Queued for analysis…");
      setTrackingJobId(jobId);
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitLink(e) {
    e.preventDefault();
    setError("");
    setStatus("");
    const trimmed = sourceUrlInput.trim();
    if (!trimmed) {
      setError("Paste a video or media URL (https://…).");
      return;
    }
    setLinkSession({ sourceUrl: trimmed });
    setSubmitting(true);
    try {
      const res = await fetch("/api/analysis/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_url: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLinkSession(null);
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      const jobId = data.job_id;
      if (!jobId || typeof jobId !== "string") {
        setLinkSession(null);
        setError("Missing job id from server.");
        return;
      }
      setUploadSession(null);
      setStatus("Queued for analysis…");
      setTrackingJobId(jobId);
      router.refresh();
    } catch {
      setLinkSession(null);
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const isVideo = file?.type?.startsWith("video/");
  const isImage = file?.type?.startsWith("image/");
  const fileOverlayMeta = uploadSession ?? (file ? { name: file.name, size: file.size, mime: file.type || "", lastModified: file.lastModified } : null);
  const overlayPreview = uploadSession?.previewUrl ?? previewUrl;
  const overlayMime = uploadSession?.mime || file?.type || "";
  const overlayIsVideo = overlayMime.startsWith("video/");
  const overlayIsImage = overlayMime.startsWith("image/");
  const linkHostname = linkSession ? safeUrlHostname(linkSession.sourceUrl) : "";

  const steps = jobSnapshot
    ? [
        { key: "dl", label: "Download", value: jobSnapshot.download_status },
        { key: "logo", label: "Logo", value: jobSnapshot.logo_status },
        { key: "ocr", label: "OCR", value: jobSnapshot.ocr_status },
        { key: "metadata", label: "Metadata", value: jobSnapshot.metadata_status },
      ]
    : [];

  return (
    <div className="mx-auto max-w-3xl rounded-none">
      <div className="relative min-h-[min(85vh,640px)] overflow-hidden rounded-none border border-slate-200 bg-white shadow-sm">
        <div
          className={`relative rounded-none px-6 py-10 sm:px-10 sm:py-12 ${busy ? "pointer-events-none select-none" : ""}`}
          aria-hidden={busy ? true : undefined}
        >
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Ingest</p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-[2rem]">
              New analysis
            </h1>
            <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-slate-600">
              Upload a file, paste one media URL, or submit many links at once from free text or a CSV. Each link is
              queued on the same logo, on-screen text, and metadata pipeline.
            </p>

            <div
              className="mt-8 flex rounded-none border border-slate-200 bg-slate-50 p-1"
              role="tablist"
              aria-label="Ingest source"
            >
              <button
                type="button"
                role="tab"
                aria-selected={ingestMode === "file"}
                onClick={() => switchIngestMode("file")}
                className={`min-h-[44px] flex-1 rounded-none px-4 text-sm font-semibold transition-colors ${
                  ingestMode === "file"
                    ? "border border-slate-200 bg-white text-slate-900 shadow-sm"
                    : "border border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                Upload file
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={ingestMode === "link"}
                onClick={() => switchIngestMode("link")}
                className={`min-h-[44px] flex-1 rounded-none px-4 text-sm font-semibold transition-colors ${
                  ingestMode === "link"
                    ? "border border-slate-200 bg-white text-slate-900 shadow-sm"
                    : "border border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                Paste link
              </button>
            </div>

            {ingestMode === "file" ? (
            <form onSubmit={onSubmit} className="mt-10 space-y-6">
              <input
                id="run-analysis-file"
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                aria-label="Choose image or video"
                onChange={onInputChange}
              />

              <div
                role="button"
                tabIndex={0}
                onClick={openPicker}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openPicker();
                  }
                }}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                className={`group relative rounded-none outline-none transition-[box-shadow,border-color,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                  dragOver
                    ? "border-blue-600 bg-blue-50/60 shadow-[0_0_0_3px_rgba(37,99,235,0.18)]"
                    : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-50/90"
                } ${file ? "border-solid" : "border-2 border-dashed"} border`}
              >
                {!file ? (
                  <div className="flex cursor-pointer flex-col items-center justify-center gap-4 rounded-none px-6 py-16 text-center sm:py-20">
                    <span
                      className="flex h-14 w-14 items-center justify-center rounded-none border border-slate-200 bg-white text-slate-500 shadow-sm transition-[border-color,color,box-shadow] duration-200 group-hover:border-blue-300 group-hover:text-blue-600 group-hover:shadow-[0_0_0_1px_rgba(37,99,235,0.15)]"
                      aria-hidden
                    >
                      <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.25}>
                        <path strokeLinecap="square" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
                      </svg>
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Drop media here</p>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                        or{" "}
                        <span className="font-semibold text-blue-600 underline decoration-blue-600/30 underline-offset-4">
                          browse
                        </span>
                      </p>
                      <p className="mt-3 text-[0.7rem] font-medium uppercase tracking-wider text-slate-400">
                        Images &amp; video · max {MAX_BYTES / (1024 * 1024)} MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="relative rounded-none p-4 sm:p-5">
                    <div className="relative overflow-hidden rounded-none border border-slate-200 bg-slate-950 shadow-inner ring-1 ring-black/5">
                      {previewUrl && isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                        <img
                          src={previewUrl}
                          alt={file.name}
                          className="mx-auto max-h-[min(52vh,420px)] w-full object-contain"
                        />
                      ) : null}
                      {previewUrl && isVideo ? (
                        <video
                          src={previewUrl}
                          controls
                          playsInline
                          className="mx-auto max-h-[min(52vh,420px)] w-full object-contain"
                          preload="metadata"
                        />
                      ) : null}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-none border-t border-slate-200 pt-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900" title={file.name}>
                          {file.name}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {file.type || "Media"} · {formatBytes(file.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile();
                        }}
                        className="shrink-0 rounded-none border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800"
                      >
                        Remove
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPicker();
                      }}
                      className="mt-3 w-full rounded-none border border-dashed border-slate-300 bg-transparent py-2.5 text-xs font-medium text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50/40 hover:text-slate-800"
                    >
                      Replace file
                    </button>
                  </div>
                )}
              </div>

              {error ? (
                <p className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-900">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting || !file}
                  className="rounded-none border border-blue-700 bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-blue-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600 disabled:hover:shadow-sm"
                >
                  {submitting ? "Submitting…" : "Submit for analysis"}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={openPicker}
                  className="rounded-none border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
                >
                  Choose file
                </button>
              </div>
            </form>
            ) : (
            <div className="mt-10 space-y-6">
              <div
                className="flex flex-wrap gap-1 rounded-none border border-slate-200 bg-slate-50 p-1"
                role="tablist"
                aria-label="Link input method"
              >
                {[
                  { id: "single", label: "One link" },
                  { id: "text", label: "Paste many" },
                  { id: "csv", label: "Upload CSV" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={linkInputMode === tab.id}
                    onClick={() => switchLinkInputMode(tab.id)}
                    className={`min-h-[40px] flex-1 rounded-none px-3 text-xs font-semibold transition-colors sm:text-sm ${
                      linkInputMode === tab.id
                        ? "border border-slate-200 bg-white text-slate-900 shadow-sm"
                        : "border border-transparent text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {linkInputMode === "single" ? (
                <form onSubmit={onSubmitLink} className="space-y-6">
                  <div>
                    <label htmlFor="run-analysis-source-url" className="text-sm font-semibold text-slate-800">
                      Media URL
                    </label>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      Paste one <span className="font-mono">http</span> or <span className="font-mono">https</span>{" "}
                      link. The server queues the job and downloads the media for analysis.
                    </p>
                    <input
                      id="run-analysis-source-url"
                      type="url"
                      name="source_url"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="https://…"
                      value={sourceUrlInput}
                      onChange={(e) => setSourceUrlInput(e.target.value)}
                      className="mt-3 w-full rounded-none border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  {error ? (
                    <p className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-900">
                      {error}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={submitting || !sourceUrlInput.trim()}
                      className="rounded-none border border-blue-700 bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-blue-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600 disabled:hover:shadow-sm"
                    >
                      {submitting ? "Submitting…" : "Submit link for analysis"}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={onSubmitBulkLinks} className="space-y-6">
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    aria-hidden
                    onChange={onCsvInputChange}
                  />

                  {linkInputMode === "text" ? (
                    <div>
                      <label htmlFor="run-analysis-bulk-text" className="text-sm font-semibold text-slate-800">
                        Paste links or a sheet export
                      </label>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        We scan for <span className="font-mono">https://</span> URLs (one per line, in paragraphs, or
                        mixed with other text) and list them below before you submit.
                      </p>
                      <textarea
                        id="run-analysis-bulk-text"
                        rows={8}
                        spellCheck={false}
                        placeholder={"https://www.youtube.com/watch?v=…\nhttps://www.tiktok.com/@user/video/…"}
                        value={bulkTextInput}
                        onChange={onBulkTextChange}
                        className="mt-3 w-full resize-y rounded-none border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Upload a CSV</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        Any column may contain links—we extract every <span className="font-mono">https://</span> URL in
                        the file (same rules as paste mode).
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => csvInputRef.current?.click()}
                          disabled={submitting}
                          className="rounded-none border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Choose CSV
                        </button>
                        {bulkCsvName ? (
                          <span className="truncate text-xs text-slate-600" title={bulkCsvName}>
                            {bulkCsvName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {detectedUrls.length > 0 ? (
                    <div className="rounded-none border border-slate-200 bg-slate-50/80">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                        <p className="text-sm font-semibold text-slate-800">
                          {detectedUrls.length} link{detectedUrls.length === 1 ? "" : "s"} ready
                          {detectedUrls.length > MAX_BATCH_SOURCE_URLS ? (
                            <span className="ml-2 font-normal text-red-700">
                              (max {MAX_BATCH_SOURCE_URLS} per batch)
                            </span>
                          ) : null}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setDetectedUrls([]);
                            setBulkTextInput("");
                            setBulkCsvName("");
                          }}
                          className="text-xs font-semibold uppercase tracking-wide text-slate-600 hover:text-slate-900"
                        >
                          Clear all
                        </button>
                      </div>
                      <ul className="max-h-56 divide-y divide-slate-200 overflow-y-auto">
                        {detectedUrls.map((href) => (
                          <li key={href} className="flex items-start gap-2 px-4 py-2.5">
                            <span className="min-w-0 flex-1 break-all font-mono text-[0.75rem] text-slate-800">
                              {href}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeDetectedUrl(href)}
                              className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-red-700"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : linkInputMode === "text" && bulkTextInput.trim() ? (
                    <p className="text-xs text-slate-500">No https:// links detected yet.</p>
                  ) : null}

                  {error ? (
                    <p className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-900">
                      {error}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={
                        submitting ||
                        detectedUrls.length === 0 ||
                        detectedUrls.length > MAX_BATCH_SOURCE_URLS
                      }
                      className="rounded-none border border-blue-700 bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-[background-color,box-shadow] hover:bg-blue-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600 disabled:hover:shadow-sm"
                    >
                      {submitting
                        ? "Queueing…"
                        : `Submit ${detectedUrls.length || ""} link${detectedUrls.length === 1 ? "" : "s"} for analysis`}
                    </button>
                    {linkInputMode === "text" && bulkTextInput.trim() && !detectedUrls.length ? (
                      <button
                        type="button"
                        onClick={() => runUrlDetection(bulkTextInput)}
                        className="rounded-none border border-slate-300 bg-white px-6 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50"
                      >
                        Scan again
                      </button>
                    ) : null}
                  </div>
                </form>
              )}
            </div>
            )}
        </div>
      </div>

      {busy ? (
        <div
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-slate-900/25 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-analysis-busy-title"
          aria-describedby="run-analysis-busy-desc"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_50%_-10%,rgba(37,99,235,0.12),transparent_55%)]" />

          <div className="relative flex w-full flex-col items-center justify-center px-4 py-12 sm:px-8 sm:py-16">
            <div className="cat-run-panel-in relative w-full max-w-2xl rounded-none border border-slate-200/95 bg-white/95 shadow-[0_24px_48px_-20px_rgba(15,23,42,0.35)] ring-1 ring-slate-900/[0.04]">
                <div className="border-b border-slate-100 px-7 py-6 sm:px-9 sm:py-8">
                  <p id="run-analysis-busy-title" className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-blue-700">
                    {submitting ? (linkSession ? "Queueing job" : "Secure upload") : "Analysis"}
                  </p>
                  <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                    {submitting
                      ? linkSession
                        ? "Registering your URL"
                        : "Sending your media"
                      : "Running your pipeline"}
                  </h2>
                  <p id="run-analysis-busy-desc" className="mt-2 text-sm leading-relaxed text-slate-600">
                    {submitting
                      ? linkSession
                        ? "Creating the job record and enqueueing the worker to fetch and store the remote media."
                        : "Preserving original filename, type, and timestamps end-to-end."
                      : "We will open results as soon as download, logo, OCR, and metadata stages finish."}
                  </p>
                </div>

                <div className="grid gap-0 border-b border-slate-100 sm:grid-cols-[minmax(0,1fr)_minmax(200px,240px)]">
                  <div className="border-b border-slate-100 p-6 sm:border-b-0 sm:border-r sm:p-8">
                    {linkSession ? (
                      <dl className="space-y-2.5 text-xs text-slate-600">
                        <div>
                          <dt className="font-semibold uppercase tracking-wide text-slate-500">Source URL</dt>
                          <dd className="mt-0.5 break-all font-mono text-[0.8rem] text-slate-900">{linkSession.sourceUrl}</dd>
                        </div>
                        {linkHostname ? (
                          <div>
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">Host</dt>
                            <dd className="mt-0.5 font-mono text-[0.8rem] text-slate-900">{linkHostname}</dd>
                          </div>
                        ) : null}
                      </dl>
                    ) : fileOverlayMeta ? (
                      <dl className="space-y-2.5 text-xs text-slate-600">
                        <div>
                          <dt className="font-semibold uppercase tracking-wide text-slate-500">File name</dt>
                          <dd className="mt-0.5 break-all font-mono text-[0.8rem] text-slate-900">{fileOverlayMeta.name}</dd>
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-2">
                          <div>
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">Size</dt>
                            <dd className="mt-0.5 tabular-nums text-slate-900">{formatBytes(fileOverlayMeta.size)}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">MIME</dt>
                            <dd className="mt-0.5 break-all font-mono text-[0.75rem] text-slate-900">{fileOverlayMeta.mime || "—"}</dd>
                          </div>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase tracking-wide text-slate-500">Last modified</dt>
                          <dd className="mt-0.5 tabular-nums text-slate-900">{formatLastModified(fileOverlayMeta.lastModified)}</dd>
                        </div>
                      </dl>
                    ) : null}
                  </div>
                  <div className="relative flex min-h-[180px] items-center justify-center bg-slate-950 p-4 sm:min-h-[240px]">
                    {overlayPreview && overlayIsImage ? (
                      // eslint-disable-next-line @next/next/no-img-element -- blob preview in overlay
                      <img
                        src={overlayPreview}
                        alt=""
                        className="max-h-[min(34vh,260px)] w-full object-contain opacity-95"
                      />
                    ) : null}
                    {overlayPreview && overlayIsVideo ? (
                      <video
                        src={overlayPreview}
                        controls
                        playsInline
                        className="max-h-[min(34vh,260px)] w-full object-contain"
                        preload="metadata"
                      />
                    ) : null}
                    {linkSession && !overlayPreview && submitting ? (
                      <div className="h-16 w-16 rounded-none border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin" aria-hidden />
                    ) : null}
                    {linkSession && !overlayPreview && tracking ? (
                      <div className="flex max-w-[220px] flex-col items-center gap-3 px-2 text-center">
                        <svg className="h-10 w-10 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.25} aria-hidden>
                          <path strokeLinecap="square" strokeLinejoin="miter" d="M13.5 6H5v12h14v-6M10 12l9-9m0 0v4m0-4h-4" />
                        </svg>
                        <p className="text-[0.7rem] font-medium uppercase tracking-wide text-slate-400">Remote media</p>
                        <a
                          href={linkSession.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300"
                        >
                          Open source link
                        </a>
                      </div>
                    ) : null}
                    {submitting && !overlayPreview && !linkSession ? (
                      <div className="h-16 w-16 rounded-none border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin" aria-hidden />
                    ) : null}
                  </div>
                </div>

                <div className="px-7 py-6 sm:px-9 sm:py-8">
                  {tracking && trackingJobId ? (
                    <>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-xs font-medium text-slate-500">Job</span>
                        <code className="max-w-full truncate rounded-none border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[0.65rem] text-slate-800">
                          {trackingJobId}
                        </code>
                      </div>
                      {jobSnapshot?.overall_status ? (
                        <p className="mt-2 text-xs text-slate-600">
                          Overall: <span className="font-semibold text-slate-900">{jobSnapshot.overall_status}</span>
                        </p>
                      ) : null}

                      <div className="mt-5">
                        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-800">
                          <span>Progress</span>
                          <span className="tabular-nums text-blue-700">{pollProgressPct}%</span>
                        </div>
                        <div
                          className="relative mt-2 h-2.5 w-full overflow-hidden rounded-none border border-slate-200 bg-slate-100"
                          role="progressbar"
                          aria-valuenow={pollProgressPct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Analysis progress"
                        >
                          <div
                            className="relative h-full rounded-none bg-blue-600 transition-[width] duration-500 ease-out"
                            style={{ width: `${pollProgressPct}%` }}
                          >
                            <span className="cat-run-shimmer pointer-events-none absolute inset-0 block w-full bg-gradient-to-r from-transparent via-white/35 to-transparent opacity-90" />
                          </div>
                        </div>
                      </div>

                      {steps.length ? (
                        <ul className="mt-5 grid gap-2 sm:grid-cols-4">
                          {steps.map((s, i) => (
                            <li
                              key={s.key}
                              className="rounded-none border border-slate-200 bg-slate-50/80 px-3 py-2.5 transition-shadow duration-200 hover:shadow-sm"
                              style={{ animationDelay: `${i * 60}ms` }}
                            >
                              <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
                                {s.label}
                              </span>
                              <span
                                className={`mt-1.5 block rounded-none border px-2 py-1 text-center text-[0.65rem] font-semibold uppercase tracking-wide ${statusChipClass(s.value)}`}
                              >
                                {s.value}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm leading-relaxed text-slate-600">
                      {linkSession ? (
                        <>
                          <span className="font-semibold text-slate-900">Sending your URL…</span>
                          <span className="mt-2 block">The server validates the link, records the job, and adds it to the analysis queue.</span>
                        </>
                      ) : (
                        <>
                          <span className="font-semibold text-slate-900">Uploading to server…</span>
                          <span className="mt-2 block">
                            Your file bytes, name, MIME type, size, and last-modified are sent together for verification on
                            the server.
                          </span>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </div>

            {status && !error ? (
              <p className="mt-6 max-w-2xl text-center text-xs text-slate-500">{status}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
