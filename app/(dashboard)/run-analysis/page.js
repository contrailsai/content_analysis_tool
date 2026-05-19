"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

function UploadIcon({ className = "h-4 w-4" }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path strokeLinecap="square" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
    </svg>
  );
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
  /** "single" = one URL with live progress; "multiple" = batch queue then Cases list. */
  const [linkScope, setLinkScope] = useState("single");
  const [singleLinkInput, setSingleLinkInput] = useState("");
  const [linkInputMode, setLinkInputMode] = useState("text");
  const [bulkTextInput, setBulkTextInput] = useState("");
  const [detectedUrls, setDetectedUrls] = useState([]);
  const [bulkCsvName, setBulkCsvName] = useState("");
  const csvInputRef = useRef(null);

  const tracking = Boolean(trackingJobId);
  const formLocked = submitting || tracking;
  /** Full-screen progress only for file upload or a single tracked link—not batch queue. */
  const showProgressOverlay =
    tracking || uploadSession != null || linkSession != null || (submitting && ingestMode === "file");

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
      if (formLocked) return;
      setIngestMode(mode);
      setError("");
      setStatus("");
      if (mode === "link") {
        setFile(null);
      }
      if (mode === "file") {
        setLinkScope("single");
        setSingleLinkInput("");
        setLinkInputMode("text");
        setBulkTextInput("");
        setDetectedUrls([]);
        setBulkCsvName("");
      }
    },
    [formLocked],
  );

  const switchLinkScope = useCallback(
    (scope) => {
      if (formLocked) return;
      setLinkScope(scope);
      setError("");
      setStatus("");
      setSingleLinkInput("");
      setLinkInputMode("text");
      setBulkTextInput("");
      setDetectedUrls([]);
      setBulkCsvName("");
    },
    [formLocked],
  );

  const switchLinkInputMode = useCallback(
    (mode) => {
      if (formLocked) return;
      setLinkInputMode(mode);
      setError("");
      setDetectedUrls([]);
      setBulkCsvName("");
      setBulkTextInput("");
    },
    [formLocked],
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
    if (!f || formLocked) return;
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

  async function onSubmitSingleLink(e) {
    e.preventDefault();
    setError("");
    setStatus("");
    const trimmed = singleLinkInput.trim();
    if (!trimmed) {
      setError("Enter a video link starting with https://");
      return;
    }
    const urls = extractHttpsUrls(trimmed);
    const href = urls[0] || null;
    if (!href) {
      setError("Enter a valid https:// URL.");
      return;
    }
    if (urls.length > 1) {
      setError("Only one link at a time here. Switch to “Multiple links” to queue several.");
      return;
    }
    setSubmitting(true);
    setLinkSession({ sourceUrl: href });
    try {
      const res = await fetch("/api/analysis/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_url: href }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLinkSession(null);
        setError(data.error || "Something went wrong.");
        return;
      }
      const jobId = data.job_id;
      if (!jobId || typeof jobId !== "string") {
        setLinkSession(null);
        setError("Missing job id from server.");
        return;
      }
      setSingleLinkInput("");
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

  async function onSubmitBulkLinks(e) {
    e.preventDefault();
    setError("");
    setStatus("");
    if (!detectedUrls.length) {
      setError("Paste or upload content with at least one https:// link.");
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
    if (!showProgressOverlay) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showProgressOverlay]);

  const openPicker = useCallback(() => {
    if (formLocked) return;
    inputRef.current?.click();
  }, [formLocked]);

  const removeFile = useCallback(() => {
    if (formLocked) return;
    setFile(null);
    setError("");
    setStatus("");
  }, [formLocked]);

  const pickFile = useCallback(
    (f) => {
      if (formLocked) return;
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
    [formLocked],
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
    if (formLocked) return;
    pickFile(e.dataTransfer.files?.[0]);
  }

  function onDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (formLocked) return;
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

  const isVideo = file?.type?.startsWith("video/");
  const isImage = file?.type?.startsWith("image/");
  const fileOverlayMeta = uploadSession ?? (file ? { name: file.name, size: file.size, mime: file.type || "", lastModified: file.lastModified } : null);
  const overlayPreview = uploadSession?.previewUrl ?? previewUrl;
  const overlayMime = uploadSession?.mime || file?.type || "";
  const overlayIsVideo = overlayMime.startsWith("video/");
  const overlayIsImage = overlayMime.startsWith("image/");
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
          className={`relative rounded-none px-6 py-10 sm:px-10 sm:py-12 ${showProgressOverlay ? "pointer-events-none select-none" : ""}`}
          aria-hidden={showProgressOverlay ? true : undefined}
        >
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">New analysis</h1>
            <p className="mt-2 text-sm text-slate-600">Image, video file, or video URL.</p>

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
                Video links
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
                      <p className="mt-2 text-xs text-slate-400">Max {MAX_BYTES / (1024 * 1024)} MB</p>
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

              {error && ingestMode === "file" ? (
                <p className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-900">
                  {error}
                </p>
              ) : null}

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={submitting || !file}
                  className="rounded-none border border-blue-700 bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? "Submitting…" : "Run analysis"}
                </button>
              </div>
            </form>
            ) : (
            <div className="mt-8 space-y-5">
              <div
                className="flex rounded-none border border-slate-200 bg-slate-50 p-1"
                role="tablist"
                aria-label="How many links"
              >
                {[
                  { id: "single", label: "One link" },
                  { id: "multiple", label: "Multiple" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={linkScope === tab.id}
                    onClick={() => switchLinkScope(tab.id)}
                    className={`min-h-[40px] flex-1 rounded-none px-4 text-sm font-semibold transition-colors ${
                      linkScope === tab.id
                        ? "border border-slate-200 bg-white text-slate-900 shadow-sm"
                        : "border border-transparent text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {linkScope === "single" ? (
                <form onSubmit={onSubmitSingleLink} className="space-y-4">
                  <div>
                    <label htmlFor="run-analysis-single-link" className="text-sm font-medium text-slate-800">
                      Video URL
                    </label>
                    <input
                      id="run-analysis-single-link"
                      type="url"
                      spellCheck={false}
                      placeholder="https://…"
                      value={singleLinkInput}
                      onChange={(e) => {
                        setSingleLinkInput(e.target.value);
                        setError("");
                      }}
                      className="mt-2 w-full rounded-none border border-slate-300 bg-white px-4 py-3 font-mono text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                  {error && ingestMode === "link" && linkScope === "single" ? (
                    <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={submitting || !singleLinkInput.trim()}
                    className="rounded-none border border-blue-700 bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submitting ? "Starting…" : "Run analysis"}
                  </button>
                </form>
              ) : (
                <form onSubmit={onSubmitBulkLinks} className="space-y-4">
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={onCsvInputChange}
                  />
                  <div className="flex border border-slate-200 bg-slate-50 p-1" role="tablist">
                    {[
                      { id: "text", label: "Paste" },
                      { id: "csv", label: "CSV" },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={linkInputMode === tab.id}
                        onClick={() => switchLinkInputMode(tab.id)}
                        className={`min-h-[36px] flex-1 rounded-none px-3 text-sm font-semibold ${
                          linkInputMode === tab.id
                            ? "border border-slate-200 bg-white text-slate-900"
                            : "text-slate-600"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {linkInputMode === "text" ? (
                    <textarea
                      id="run-analysis-bulk-text"
                      rows={5}
                      spellCheck={false}
                      placeholder="Paste https:// links…"
                      value={bulkTextInput}
                      onChange={onBulkTextChange}
                      className="w-full resize-y rounded-none border border-slate-300 bg-white px-4 py-3 font-mono text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                    />
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => csvInputRef.current?.click()}
                        disabled={submitting}
                        className="rounded-none border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Choose CSV
                      </button>
                      {bulkCsvName ? (
                        <span className="truncate text-xs text-slate-500">{bulkCsvName}</span>
                      ) : null}
                    </div>
                  )}

                  {detectedUrls.length > 0 ? (
                    <div className="border border-slate-200">
                      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                        <span className="font-medium text-slate-800">
                          {detectedUrls.length} link{detectedUrls.length === 1 ? "" : "s"}
                          {detectedUrls.length > MAX_BATCH_SOURCE_URLS ? (
                            <span className="text-red-700"> · max {MAX_BATCH_SOURCE_URLS}</span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setDetectedUrls([]);
                            setBulkTextInput("");
                            setBulkCsvName("");
                          }}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                        >
                          Clear
                        </button>
                      </div>
                      <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto">
                        {detectedUrls.map((href) => (
                          <li key={href} className="flex items-center gap-2 px-3 py-2">
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700" title={href}>
                              {href}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeDetectedUrl(href)}
                              className="shrink-0 text-xs text-slate-500 hover:text-red-700"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : linkInputMode === "text" && bulkTextInput.trim() ? (
                    <p className="text-xs text-slate-500">No https:// links found.</p>
                  ) : null}

                  {error && linkScope === "multiple" ? (
                    <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={
                      submitting ||
                      detectedUrls.length === 0 ||
                      detectedUrls.length > MAX_BATCH_SOURCE_URLS
                    }
                    className="rounded-none border border-blue-700 bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submitting
                      ? "Queueing…"
                      : detectedUrls.length
                        ? `Queue ${detectedUrls.length} on Cases`
                        : "Queue on Cases"}
                  </button>
                </form>
              )}
            </div>
            )}
        </div>
      </div>

      {showProgressOverlay ? (
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
                  <h2 id="run-analysis-busy-title" className="text-lg font-semibold text-slate-900 sm:text-xl">
                    {submitting
                      ? linkSession
                        ? "Starting…"
                        : "Uploading…"
                      : "Analyzing…"}
                  </h2>
                  <p id="run-analysis-busy-desc" className="mt-1 text-sm text-slate-600">
                    {submitting
                      ? "Please wait."
                      : "Opening results when finished."}
                  </p>
                </div>

                <div className="grid gap-0 border-b border-slate-100 sm:grid-cols-[minmax(0,1fr)_minmax(200px,240px)]">
                  <div className="border-b border-slate-100 p-6 sm:border-b-0 sm:border-r sm:p-8">
                    {linkSession ? (
                      <p className="break-all font-mono text-xs text-slate-800">{linkSession.sourceUrl}</p>
                    ) : fileOverlayMeta ? (
                      <p className="text-sm text-slate-800">
                        <span className="break-all font-medium">{fileOverlayMeta.name}</span>
                        <span className="mt-1 block text-xs text-slate-500">{formatBytes(fileOverlayMeta.size)}</span>
                      </p>
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
                      <div className="h-12 w-12 border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin" aria-hidden />
                    ) : null}
                    {submitting && !overlayPreview && !linkSession ? (
                      <div className="h-16 w-16 rounded-none border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin" aria-hidden />
                    ) : null}
                  </div>
                </div>

                <div className="px-7 py-6 sm:px-9 sm:py-8">
                  {tracking && trackingJobId ? (
                    <>
                      <div>
                        <div className="flex items-center justify-between gap-3 text-sm font-medium text-slate-800">
                          <span>Progress</span>
                          <span className="tabular-nums text-blue-600">{pollProgressPct}%</span>
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
                    <p className="text-sm text-slate-600">Please wait…</p>
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
