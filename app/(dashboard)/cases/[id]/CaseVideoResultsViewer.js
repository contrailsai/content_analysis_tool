"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CaseDetailAnalysisPanels, LogoCategoryLabel } from "./CaseResultsViewer";
import {
  boxToPercentStyle,
  expandBoxFromCenter,
  quadToAxisAlignedBox,
  videoFrameAtOrBefore,
} from "@/lib/parseJobResults";

const LOGO_BOX_SCALE = 1.38;
const OCR_BOX_SCALE = 1.22;

const mono = "font-[family-name:var(--case-mono),ui-monospace,monospace] tabular-nums";

function formatClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

function totalLogoCount(detections, countsByLabel) {
  const sumCounts = Object.values(countsByLabel || {}).reduce((a, b) => a + b, 0);
  if (sumCounts > 0) return sumCounts;
  return detections?.length ?? 0;
}

function timesClose(a, b, eps = 1e-3) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < eps;
}

/** Letterboxed `object-fit: contain` rect: map from stage pixels to inner video content area. */
function videoContainInnerRect(stageW, stageH, naturalW, naturalH) {
  if (stageW <= 0 || stageH <= 0) return null;
  if (!(naturalW > 0 && naturalH > 0)) {
    return { left: 0, top: 0, width: stageW, height: stageH };
  }
  const scale = Math.min(stageW / naturalW, stageH / naturalH);
  const width = naturalW * scale;
  const height = naturalH * scale;
  const left = (stageW - width) / 2;
  const top = (stageH - height) / 2;
  return { left, top, width, height };
}

function DetailChevron() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-150 group-open:-rotate-180"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path d="M6 8l4 4 4-4H6z" />
    </svg>
  );
}

function OverlayLegend() {
  return (
    <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
      <span className="inline-flex items-center gap-1.5 border border-blue-500/50 bg-blue-950/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-200">
        <span className="h-2 w-2 bg-blue-500" aria-hidden />
        Logos
      </span>
      <span className="inline-flex items-center gap-1.5 border border-amber-500/50 bg-amber-950/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
        <span className="h-2 w-2 bg-amber-400" aria-hidden />
        OCR
      </span>
      <span className="inline-flex items-center gap-1.5 border border-amber-400/45 bg-amber-950/35 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-50">
        <span className="h-2 w-2 bg-amber-300" aria-hidden />
        Selected
      </span>
    </div>
  );
}

export default function CaseVideoResultsViewer({
  displayTitle,
  mediaUrl,
  logoFrames,
  logoAggregateCounts,
  ocrTimedLines,
  metadataAnalysis,
  metadataStatus,
  errorMessage,
}) {
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [duration, setDuration] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [selectedOcrIdx, setSelectedOcrIdx] = useState(null);

  const mergedTimingFrames = useMemo(() => {
    const times = new Set();
    for (const f of logoFrames) {
      if (Number.isFinite(f.tSec)) times.add(f.tSec);
    }
    for (const l of ocrTimedLines) {
      if (Number.isFinite(l.tSec)) times.add(l.tSec);
    }
    return [...times]
      .sort((a, b) => a - b)
      .map((tSec) => ({ tSec }));
  }, [logoFrames, ocrTimedLines]);

  const activeTiming = mergedTimingFrames.length
    ? videoFrameAtOrBefore(mergedTimingFrames, currentSec)
    : null;
  const activeT = activeTiming?.tSec ?? null;

  const activeLogoFrame =
    activeT != null ? logoFrames.find((f) => timesClose(f.tSec, activeT)) ?? null : null;
  const activeOcrLines =
    activeT != null ? ocrTimedLines.filter((l) => timesClose(l.tSec, activeT)) : [];

  const playheadRatio = duration > 0 ? Math.min(1, Math.max(0, currentSec / duration)) : 0;

  const nw = natural.w;
  const nh = natural.h;
  const showOverlays = Boolean(mediaUrl && nw > 0 && nh > 0);

  const innerVideoRect = useMemo(
    () => videoContainInnerRect(stageSize.w, stageSize.h, nw, nh),
    [stageSize.w, stageSize.h, nw, nh],
  );

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;

    const measure = () => {
      const r = el.getBoundingClientRect();
      setStageSize({ w: r.width, h: r.height });
    };

    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mediaUrl, nw, nh]);

  const seekToRatio = useCallback(
    (ratio) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(duration) || duration <= 0) return;
      const next = Math.min(duration, Math.max(0, ratio * duration));
      v.currentTime = next;
      setCurrentSec(next);
    },
    [duration],
  );

  const seekToTime = useCallback(
    (t) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(duration) || duration <= 0) return;
      const next = Math.min(duration, Math.max(0, t));
      v.currentTime = next;
      setCurrentSec(next);
    },
    [duration],
  );

  const onVideoLoadedMetadata = useCallback((e) => {
    const v = e.currentTarget;
    setNatural({ w: v.videoWidth || 0, h: v.videoHeight || 0 });
    const d = v.duration;
    setDuration(Number.isFinite(d) && d > 0 ? d : 0);
  }, []);

  useEffect(() => {
    setNatural({ w: 0, h: 0 });
  }, [mediaUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;

    const onTime = () => setCurrentSec(v.currentTime);
    const onDur = () => {
      const d = v.duration;
      setDuration(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onDur);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onDur);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [mediaUrl]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, []);

  const updateSeekFromClientX = useCallback(
    (clientX) => {
      const track = trackRef.current;
      if (!track || !Number.isFinite(duration) || duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
      seekToRatio(ratio);
    },
    [duration, seekToRatio],
  );

  const onTrackPointerDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      const track = trackRef.current;
      if (!track) return;
      draggingRef.current = true;
      track.setPointerCapture(e.pointerId);
      updateSeekFromClientX(e.clientX);
    },
    [updateSeekFromClientX],
  );

  const onTrackPointerMove = useCallback(
    (e) => {
      if (!draggingRef.current) return;
      updateSeekFromClientX(e.clientX);
    },
    [updateSeekFromClientX],
  );

  const onTrackPointerUp = useCallback((e) => {
    const track = trackRef.current;
    draggingRef.current = false;
    if (track && track.hasPointerCapture(e.pointerId)) {
      track.releasePointerCapture(e.pointerId);
    }
  }, []);

  function onOcrLineClick(idx) {
    setSelectedOcrIdx((prev) => (prev === idx ? null : idx));
    const line = ocrTimedLines.find((l) => l.idx === idx);
    if (line && Number.isFinite(line.tSec)) {
      seekToTime(line.tSec);
    }
  }

  const aggregateEntries = Object.entries(logoAggregateCounts || {}).filter(([, n]) => n > 0);
  const atPlayheadCount = activeLogoFrame
    ? totalLogoCount(activeLogoFrame.detections, activeLogoFrame.countsByLabel)
    : 0;
  const earliestSampleSec = mergedTimingFrames.length ? mergedTimingFrames[0].tSec : null;

  const logosBody = !logoFrames.length ? (
    <p className="mt-4 text-sm leading-relaxed text-slate-600">No per-frame logo results for this video.</p>
  ) : activeT == null ? (
    <p className="mt-4 text-sm leading-relaxed text-slate-600">
      No sample at or before the playhead
      {earliestSampleSec != null ? (
        <>
          {" "}
          (first sample at{" "}
          <span className={`${mono} font-medium text-slate-800`}>{formatClock(earliestSampleSec)}</span>).
        </>
      ) : null}
    </p>
  ) : (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border border-slate-200 bg-slate-50 px-3 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Sampled second</p>
          <p className={`mt-1 ${mono} text-lg font-semibold tracking-tight text-slate-900`}>
            {formatClock(activeT)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">In frame</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-blue-600">{atPlayheadCount}</p>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-slate-600">
        Overlays on the player use this keyframe (latest sample at or before the playhead).
      </p>
      {activeLogoFrame?.detections?.length ? (
        <ul className="space-y-2">
          {activeLogoFrame.detections.map((d, i) => (
            <li
              key={`${d.label}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              <LogoCategoryLabel raw={d.label} variant="list" />
              {typeof d.confidence === "number" ? (
                <span className={`${mono} text-xs text-slate-500`}>{(d.confidence * 100).toFixed(1)}%</span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </li>
          ))}
        </ul>
      ) : activeLogoFrame && Object.keys(activeLogoFrame.countsByLabel || {}).length ? (
        <ul className="space-y-2 text-sm">
          {Object.entries(activeLogoFrame.countsByLabel).map(([label, count]) => (
            <li
              key={label}
              className="flex justify-between gap-4 border border-slate-200 bg-white px-3 py-2.5"
            >
              <LogoCategoryLabel raw={label} variant="list" />
              <span className={`${mono} text-slate-500`}>{count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">No logos in this sampled frame.</p>
      )}
      {aggregateEntries.length ? (
        <div className="border-t border-slate-200 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Totals across sampled frames
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {aggregateEntries.map(([label, count]) => (
              <li
                key={`agg-${label}`}
                className="flex justify-between gap-4 border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <LogoCategoryLabel raw={label} variant="list" />
                <span className={`${mono} font-medium text-slate-600`}>{count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  const videoPanel = (
    <div className="border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Source</p>
          <h2 className="mt-0.5 text-sm font-semibold tracking-tight text-slate-900">Video</h2>
        </div>
        {nw > 0 && nh > 0 ? (
          <span className={`${mono} border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600`}>
            {nw}×{nh}
          </span>
        ) : null}
      </div>

      {!mediaUrl ? (
        <p className="px-4 py-10 text-center text-sm text-slate-600">A preview could not be loaded for this item.</p>
      ) : (
        <>
          <div className="border-b border-slate-900 bg-slate-950 p-2 sm:p-3">
            <div
              ref={stageRef}
              className="relative w-full overflow-hidden border border-slate-700 bg-black max-h-[min(78vh,920px)]"
              style={
                nw > 0 && nh > 0
                  ? { aspectRatio: `${nw} / ${nh}` }
                  : { minHeight: "12rem" }
              }
            >
              <div
                className="absolute z-0"
                style={
                  innerVideoRect && innerVideoRect.width > 0 && innerVideoRect.height > 0
                    ? {
                        left: innerVideoRect.left,
                        top: innerVideoRect.top,
                        width: innerVideoRect.width,
                        height: innerVideoRect.height,
                      }
                    : { inset: 0 }
                }
              >
                <video
                  ref={videoRef}
                  className="block h-full w-full object-contain"
                  src={mediaUrl}
                  preload="metadata"
                  playsInline
                  onLoadedMetadata={onVideoLoadedMetadata}
                />
                {showOverlays ? (
                  <div className="pointer-events-none absolute inset-0">
                    {activeLogoFrame?.detections?.map((d, i) => {
                      if (!d.box || d.box.length < 4) return null;
                      const expanded = expandBoxFromCenter(d.box, nw, nh, LOGO_BOX_SCALE) || d.box;
                      const st = boxToPercentStyle(expanded, nw, nh);
                      if (!st) return null;
                      return (
                        <div key={`logo-${i}`} className="absolute" style={st}>
                          <span className="pointer-events-auto absolute bottom-full left-0 z-10 mb-1 h-fit bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                            <LogoCategoryLabel raw={d.label} variant="chip" />
                          </span>
                          <div className="absolute inset-0 border-2 border-blue-500 bg-blue-500/10" />
                        </div>
                      );
                    })}
                    {activeOcrLines.map((line) => {
                      const raw = line.bbox ? quadToAxisAlignedBox(line.bbox) : null;
                      const expanded = raw ? expandBoxFromCenter(raw, nw, nh, OCR_BOX_SCALE) || raw : null;
                      const st = expanded ? boxToPercentStyle(expanded, nw, nh) : null;
                      if (!st) return null;
                      const isSel = selectedOcrIdx === line.idx;
                      return (
                        <div
                          key={`ocr-${line.idx}`}
                          className={`absolute ${isSel ? "z-20" : "z-[11]"}`}
                          style={st}
                        >
                          <div
                            className={`absolute inset-0 ${
                              isSel
                                ? "border-2 border-amber-500 bg-amber-400/25"
                                : "border border-amber-500 bg-amber-400/10"
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
            {!nw ? (
              <p className={`mt-2 text-center text-[11px] text-slate-500 ${mono}`}>Loading frame dimensions…</p>
            ) : null}
          </div>

          <div className="space-y-4 bg-slate-950 px-4 py-4 text-slate-100">
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={togglePlay}
                className="inline-flex h-10 items-center gap-2 border border-slate-600 bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                {playing ? (
                  <>
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                    Pause
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M8 5v14l11-7L8 5z" />
                    </svg>
                    Play
                  </>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Timecode</p>
                <p className={`${mono} mt-0.5 text-base font-semibold text-white`}>
                  {formatClock(currentSec)}
                  <span className="font-normal text-slate-500"> / </span>
                  {formatClock(duration)}
                </p>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <span>Position</span>
                <span className={`${mono} font-normal normal-case tracking-normal text-slate-400`}>
                  drag · click · ← →
                </span>
              </div>
              <div
                ref={trackRef}
                role="slider"
                tabIndex={0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(playheadRatio * 100)}
                aria-label="Video position"
                className="relative h-2.5 cursor-pointer touch-none bg-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                onPointerDown={onTrackPointerDown}
                onPointerMove={onTrackPointerMove}
                onPointerUp={onTrackPointerUp}
                onPointerCancel={onTrackPointerUp}
                onKeyDown={(e) => {
                  if (!duration) return;
                  const step = Math.max(0.5, duration / 200);
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    seekToTime(currentSec - step);
                  } else if (e.key === "ArrowRight") {
                    e.preventDefault();
                    seekToTime(currentSec + step);
                  }
                }}
              >
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 bg-blue-600"
                  style={{ width: `${playheadRatio * 100}%` }}
                />
                <div
                  className="pointer-events-none absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 border border-blue-800 bg-white"
                  style={{ left: `${playheadRatio * 100}%` }}
                />
              </div>
            </div>

            <OverlayLegend />
          </div>
        </>
      )}
    </div>
  );

  const pageHeader = (
    <header className="border-b border-slate-200 pb-5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Video case</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="max-w-[min(100%,42rem)] text-xl font-semibold tracking-tight text-slate-900 lg:text-2xl">
          {displayTitle || "Analysis results"}
        </h1>
        <Link
          href="/cases"
          className="shrink-0 border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-blue-600 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          All cases
        </Link>
      </div>
    </header>
  );

  const errorBanner = errorMessage ? (
    <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-900">
      {errorMessage}
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 w-full flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <div className="flex w-full min-w-0 shrink-0 flex-col gap-5 lg:max-w-[min(28rem,100%)] lg:basis-[28rem]">
        {pageHeader}
        {errorBanner}

        <div className="border border-slate-200 bg-white p-1 shadow-sm">
          <details className="group px-3 pb-3 pt-2" open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-1 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-7 w-1 shrink-0 bg-blue-600" aria-hidden />
                <span className="text-sm font-semibold text-slate-900">Logos at playhead</span>
              </span>
              <DetailChevron />
            </summary>
            {logosBody}
          </details>
        </div>

        <div className="border border-slate-200 bg-white p-1 shadow-sm">
          <details className="group px-3 pb-3 pt-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-1 py-2 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="h-7 w-1 shrink-0 bg-amber-500" aria-hidden />
                <span className="text-sm font-semibold text-slate-900">
                  On-screen text
                  <span className={`${mono} ml-2 text-xs font-normal text-slate-500`}>({ocrTimedLines.length})</span>
                </span>
              </span>
              <DetailChevron />
            </summary>
            {ocrTimedLines.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No text lines were extracted yet.</p>
            ) : (
              <>
                <p className="mt-4 text-xs leading-relaxed text-slate-600">
                  Click a line to seek. Yellow boxes match the image viewer: OCR at the playhead uses amber outlines; the
                  selected line uses a thicker amber border on the video.
                </p>
                <ul className="mt-3 max-h-[min(42vh,380px)] space-y-1 overflow-y-auto border border-slate-200 bg-slate-50 p-2 [scrollbar-width:thin]">
                  {ocrTimedLines.map((line) => {
                    const active = selectedOcrIdx === line.idx;
                    const near =
                      Number.isFinite(currentSec) &&
                      Number.isFinite(line.tSec) &&
                      Math.abs(line.tSec - currentSec) < 0.55;
                    return (
                      <li key={line.idx}>
                        <button
                          type="button"
                          onClick={() => onOcrLineClick(line.idx)}
                          className={`flex w-full items-start justify-between gap-3 border px-3 py-2.5 text-left text-sm ${
                            active
                              ? "border-blue-600 bg-blue-50 text-slate-900"
                              : near
                                ? "border-slate-300 bg-white text-slate-900"
                                : "border-transparent bg-white text-slate-800 hover:border-slate-300"
                          }`}
                        >
                          <span className="min-w-0 flex-1 leading-snug">{line.text || "—"}</span>
                          <span className={`${mono} shrink-0 text-[11px] font-medium text-slate-500`}>
                            {formatClock(line.tSec)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </details>
        </div>

        <div className="space-y-5 [&>section]:border [&>section]:border-slate-200 [&>section]:shadow-sm">
          <CaseDetailAnalysisPanels
            metadataAnalysis={metadataAnalysis}
            metadataStatus={metadataStatus}
            errorMessage={errorMessage}
          />
        </div>
      </div>

      <div className="min-h-0 w-full min-w-0 flex-1 lg:pl-2">
        <div className="lg:sticky lg:top-6 lg:self-start">{videoPanel}</div>
      </div>
    </div>
  );
}
