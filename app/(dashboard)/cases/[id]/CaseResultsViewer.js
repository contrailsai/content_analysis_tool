"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  boxToPercentStyle,
  expandBoxFromCenter,
  quadToAxisAlignedBox,
} from "@/lib/parseJobResults";

const LOGO_BOX_SCALE = 1.38;
const OCR_BOX_SCALE = 1.22;

const MAX_STAGE_H = 1200;
const VIEWPORT_H_FRAC = 0.85;

/** Short chip text (~“icici” width); full raw id for tooltip when truncated. */
const LOGO_CATEGORY_SHORT = {
  icici_correct_logos: "icici",
  icici_impersonation_logos: "fake",
  other_bank_logos: "others",
};

const OTHER_LABEL_MAX_LEN = 5;

/**
 * @returns {{ short: string, full: string, showTip: boolean }}
 */
function logoCategoryParts(raw) {
  const key = String(raw || "").trim();
  if (!key) {
    return { short: "—", full: "", showTip: false };
  }
  if (key in LOGO_CATEGORY_SHORT) {
    return { short: LOGO_CATEGORY_SHORT[key], full: key, showTip: false };
  }
  const full = key;
  const needTruncate = full.length > OTHER_LABEL_MAX_LEN;
  const short = needTruncate ? `${full.slice(0, OTHER_LABEL_MAX_LEN)}…` : full;
  return { short, full, showTip: needTruncate };
}

export function LogoCategoryLabel({ raw, variant = "list" }) {
  const chip = variant === "chip";
  const { short, full, showTip } = logoCategoryParts(raw);
  const [tip, setTip] = useState(false);

  const textCls = chip
    ? "text-[10px] font-medium leading-tight tracking-tight text-white"
    : "text-sm font-medium text-slate-800";

  const hintUnderline = showTip
    ? chip
      ? "border-b border-dotted border-white/60"
      : "border-b border-dotted border-slate-500/50"
    : "";

  return (
    <span
      className={`relative inline-block max-w-full align-bottom ${showTip ? "cursor-help" : ""}`}
      onMouseEnter={() => {
        if (showTip) setTip(true);
      }}
      onMouseLeave={() => setTip(false)}
    >
      {tip && showTip ? (
        <span className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 max-w-[min(20rem,90vw)] whitespace-normal break-all border border-slate-700 bg-slate-900 px-2 py-1 text-left text-xs font-normal normal-case tracking-normal text-white shadow-md">
          {full}
        </span>
      ) : null}
      <span className={`${textCls} ${hintUnderline}`}>{short}</span>
    </span>
  );
}

function totalLogoCount(detections, countsByLabel) {
  const sumCounts = Object.values(countsByLabel || {}).reduce((a, b) => a + b, 0);
  if (sumCounts > 0) return sumCounts;
  return detections?.length ?? 0;
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function isKnownValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  return !["unknown", "n/a", "na", "none", "null", "undefined", "—", "-"].includes(normalized);
}

function joinKnownParts(parts) {
  return parts.filter(isKnownValue).join(" / ");
}

function displayBool(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

function formatBytes(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatNumber(n, digits = 2) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function FieldRow({ label, value, mono = false }) {
  if (!isKnownValue(value)) return null;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`max-w-[60%] break-words text-right text-sm text-slate-900 ${mono ? "font-mono text-xs" : ""}`}>
        {displayValue(value)}
      </dd>
    </div>
  );
}

function MetricCard({ label, value }) {
  if (!isKnownValue(value)) return null;
  return (
    <div className="border border-slate-100 bg-slate-50/80 px-3 py-2.5">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{displayValue(value)}</p>
    </div>
  );
}

function TagList({ items, emptyText }) {
  const knownItems = (items ?? []).filter(isKnownValue);
  if (!knownItems.length) {
    return <p className="text-sm leading-relaxed text-slate-600">{emptyText}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {knownItems.map((item, idx) => (
        <span
          key={`${item}-${idx}`}
          className="rounded-none border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function summaryFlagsWithoutAigc(flags) {
  return (flags ?? []).filter((f) => !String(f || "").trim().startsWith("AIGC unified:"));
}

/** Hide forensics verdict when it is only a neutral / metadata-only placeholder. */
function shouldShowForensicsVerdict(conclusion) {
  if (!isKnownValue(conclusion)) return false;
  const s = String(conclusion).trim().toLowerCase();
  if (s.includes("metadata-only")) return false;
  if (s.includes("inconclusive") && s.includes("neutral")) return false;
  return true;
}

function hasForensicsSummaryFlags(analysis) {
  return summaryFlagsWithoutAigc(analysis?.summaryFlags).some(isKnownValue);
}

/** True when the payload includes a completed AIGC / model branch we can rely on for the public verdict. */
function hasUsableAigcModelResult(aigc) {
  if (!aigc) return false;
  const st = (aigc.status || "").toLowerCase();
  if (new Set(["done", "completed", "success", "ok", "finished"]).has(st)) return true;
  if (aigc.unified != null && typeof aigc.unified === "object") return true;
  if (isKnownValue(aigc.display?.globalPrediction)) return true;
  if (isKnownValue(aigc.display?.headline)) return true;
  if (typeof aigc.summary?.anyModelFake === "boolean") return true;
  if (aigc.display?.globalIsFake === true || aigc.display?.globalIsFake === false) return true;
  return false;
}

/** Single user-facing outcome for AI / synthetic signals (no model names or raw payloads). */
function derivePublicAiContentVerdict(analysis) {
  if (!analysis?.hasResult) return { outcome: "no_data" };
  const { aigc, provenance } = analysis;
  const st = (aigc.status || "").toLowerCase();

  if (st === "failed") return { outcome: "failed" };
  if (st === "skipped") return { outcome: "skipped" };

  const aigcConcern =
    aigc.display.showAiWarning === true ||
    aigc.display.globalIsFake === true ||
    aigc.summary.anyModelFake === true ||
    aigc.display.provenanceAi === true;

  if (aigcConcern || provenance.aiGenerated === true) return { outcome: "flagged" };

  const hasModel = hasUsableAigcModelResult(aigc);
  const provenanceExplicitlyNotAi = provenance.aiGenerated === false;

  if (!hasModel && provenanceExplicitlyNotAi) return { outcome: "uncertain" };

  return { outcome: "not_flagged" };
}

function metadataStatusChipClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "done") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (s === "failed") return "border-red-300 bg-red-50 text-red-900";
  if (s === "skipped") return "border-slate-300 bg-slate-100 text-slate-800";
  if (s === "running") return "border-amber-300 bg-amber-50 text-amber-950";
  if (s === "pending") return "border-slate-200 bg-white text-slate-600";
  return "border-slate-200 bg-white text-slate-700";
}

function metadataStatusCaption(status) {
  const s = (status || "").toLowerCase();
  if (s === "done") return "Forensics complete";
  if (s === "failed") return "Forensics failed";
  if (s === "skipped") return "Forensics skipped";
  if (s === "running") return "Forensics running…";
  if (s === "pending") return "Forensics pending";
  return "Forensics status unknown";
}

function BulletFlagList({ items, emptyText }) {
  const knownItems = (items ?? []).filter(isKnownValue);
  if (!knownItems.length) {
    return <p className="text-sm leading-relaxed text-slate-600">{emptyText}</p>;
  }
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-800">
      {knownItems.map((item, idx) => (
        <li key={`${item}-${idx}`} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}

function CollapsibleBlock({ title, children }) {
  return (
    <details className="group border border-slate-100 bg-slate-50/40">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex w-full items-center justify-between gap-2">
          <span>{title}</span>
          <span className="text-xs font-normal text-slate-400 group-open:hidden">Expand</span>
          <span className="hidden text-xs font-normal text-slate-400 group-open:inline">Collapse</span>
        </span>
      </summary>
      <div className="border-t border-slate-100 bg-white px-3 py-3">{children}</div>
    </details>
  );
}

function ForensicsSummary({ analysis, metadataStatus, errorMessage }) {
  const status = (metadataStatus || "").toLowerCase();
  const done = status === "done";
  const showVerdictBlock = done && analysis?.hasResult && shouldShowForensicsVerdict(analysis.conclusion);
  const showSummaryFlagsBlock = done && analysis?.hasResult && hasForensicsSummaryFlags(analysis);
  const showVerdictOrFlagsCard = showVerdictBlock || showSummaryFlagsBlock;

  return (
    <section className="rounded-none border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <h2 className="text-sm font-semibold text-slate-900">File forensics</h2>
        <span
          className={`rounded-none border px-2 py-0.5 text-xs font-medium ${metadataStatusChipClass(metadataStatus)}`}
        >
          {metadataStatusCaption(metadataStatus)}
        </span>
      </div>

      {!done ? (
        <div className="mt-4 space-y-2 text-sm leading-relaxed text-slate-600">
          {status === "failed" ? (
            <>
              <p>Metadata for this branch did not complete successfully.</p>
              {errorMessage ? (
                <p className="border border-red-200 bg-red-50/80 p-3 text-red-900">{errorMessage}</p>
              ) : null}
            </>
          ) : (
            <p>
              {status === "skipped"
                ? "This branch was skipped. Expanded results are not available."
                : "Forensics are still in progress or queued. Check back shortly."}
            </p>
          )}
        </div>
      ) : !analysis?.hasResult ? (
        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          No structured metadata was returned for this completed run.
        </p>
      ) : (
        <>
          {showVerdictOrFlagsCard ? (
            <div className="mt-4 border border-slate-100 bg-slate-50/70 p-4">
              {showVerdictBlock ? (
                <>
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-slate-500">Verdict</p>
                  <p className="mt-1.5 text-lg font-semibold tracking-tight text-slate-900">
                    {displayValue(analysis.conclusion)}
                  </p>
                </>
              ) : null}
              {showSummaryFlagsBlock ? (
                <div className={showVerdictBlock ? "mt-4" : ""}>
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">Summary flags</p>
                  <div className="mt-2">
                    <BulletFlagList
                      items={summaryFlagsWithoutAigc(analysis.summaryFlags)}
                      emptyText="No major flags were reported for this file."
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 space-y-2">
          <CollapsibleBlock title="Analyzed file">
            <dl>
              <FieldRow label="SHA-256" value={analysis.ingest.sha256} mono />
              <FieldRow label="File type" value={analysis.ingest.fileType} />
              <FieldRow label="File size" value={formatBytes(analysis.ingest.fileSize)} />
            </dl>
          </CollapsibleBlock>

          <CollapsibleBlock title="Camera and file details">
            <dl>
              <FieldRow label="Metadata status" value={analysis.metadata.status} />
              <FieldRow label="Device" value={joinKnownParts([analysis.metadata.make, analysis.metadata.model])} />
              <FieldRow label="Dimensions" value={analysis.metadata.dimensions} />
              <FieldRow label="Color profile" value={analysis.metadata.colorProfile} />
              <FieldRow label="Bit depth" value={analysis.metadata.bitDepth} />
              <FieldRow label="Software" value={analysis.metadata.software} />
            </dl>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metadata formats</p>
              <div className="mt-2">
                <TagList items={analysis.metadata.formats} emptyText="No metadata formats were reported." />
              </div>
            </div>
            {analysis.metadata.flags.length ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metadata flags</p>
                <div className="mt-2">
                  <BulletFlagList items={analysis.metadata.flags} emptyText="—" />
                </div>
              </div>
            ) : null}
            {(analysis.metadata.comments.length > 0 ||
              analysis.metadata.externalUrls.length > 0 ||
              analysis.metadata.authorshipTraces.length > 0 ||
              analysis.metadata.profileDetails.length > 0) && (
              <dl className="mt-3 border-t border-slate-100 pt-3">
                {analysis.metadata.comments.map((c, i) => (
                  <FieldRow key={`c-${i}`} label="Comment" value={c} />
                ))}
                {analysis.metadata.externalUrls.map((u, i) => (
                  <FieldRow key={`u-${i}`} label="URL" value={u} />
                ))}
                {analysis.metadata.authorshipTraces.map((t, i) => (
                  <FieldRow key={`a-${i}`} label="Authorship" value={t} />
                ))}
                {analysis.metadata.profileDetails.map((p, i) => (
                  <FieldRow key={`p-${i}`} label="Profile" value={p} />
                ))}
              </dl>
            )}
          </CollapsibleBlock>

          <CollapsibleBlock title="Provenance and declared source">
            <dl>
              <FieldRow label="C2PA present" value={displayBool(analysis.provenance.c2paPresent)} />
            </dl>
            {analysis.provenance.flags.length ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Provenance flags</p>
                <div className="mt-2">
                  <BulletFlagList items={analysis.provenance.flags} emptyText="—" />
                </div>
              </div>
            ) : null}
          </CollapsibleBlock>

          <CollapsibleBlock title="Pixel analysis (IFMIP)">
            <div className="grid gap-2 sm:grid-cols-2">
              <MetricCard label="Sharpness" value={formatNumber(analysis.image.sharpness, 2)} />
              <MetricCard label="Resolution quality" value={analysis.image.imageResolutionQuality} />
              <MetricCard label="Bytes / pixel" value={formatNumber(analysis.image.bytesPerPixel, 3)} />
              <MetricCard label="Pixel bytes" value={formatBytes(analysis.image.totalPixelBytes)} />
            </div>
            {!isKnownValue(analysis.image.sharpness) &&
            !isKnownValue(analysis.image.imageResolutionQuality) &&
            !isKnownValue(analysis.image.bytesPerPixel) &&
            !isKnownValue(analysis.image.totalPixelBytes) ? (
              <p className="mt-2 text-sm text-slate-600">No pixel-level metrics were reported.</p>
            ) : null}
          </CollapsibleBlock>

          <CollapsibleBlock title="Visual / ELA">
            {isKnownValue(analysis.visual.error) ? (
              <p className="text-sm text-slate-700">
                <span className="font-semibold text-slate-900">Skipped or unavailable: </span>
                {analysis.visual.error}
              </p>
            ) : (
              <>
                <dl>
                  <FieldRow label="Resolution (visual)" value={analysis.visual.imgResQty} />
                  <FieldRow label="Max diff" value={formatNumber(analysis.visual.maxDiff, 4)} />
                  <FieldRow label="ELA mean error" value={formatNumber(analysis.visual.elaMeanError, 4)} />
                </dl>
                {!isKnownValue(analysis.visual.imgResQty) &&
                !isKnownValue(analysis.visual.maxDiff) &&
                !isKnownValue(analysis.visual.elaMeanError) ? (
                  <p className="mt-2 text-sm text-slate-600">No visual or ELA metrics were reported.</p>
                ) : null}
              </>
            )}
          </CollapsibleBlock>

          <CollapsibleBlock title="Quantization">
            <dl>
              <FieldRow label="Type" value={analysis.quantization.type} />
              <FieldRow label="DQT present" value={displayBool(analysis.quantization.dqtPresent)} />
              <FieldRow label="DQT match" value={analysis.quantization.dqtMatch} />
              <FieldRow label="DQT hash" value={analysis.quantization.dqtHash} mono />
              <FieldRow label="Quality estimate" value={formatNumber(analysis.quantization.qualityEstimate, 2)} />
            </dl>
          </CollapsibleBlock>

          {analysis.metadata.rawEntries.length ? (
            <CollapsibleBlock title={`Advanced metadata (raw tags, ${analysis.metadata.rawEntries.length})`}>
              <dl className="max-h-72 overflow-y-auto">
                {analysis.metadata.rawEntries.map(([key, value]) => (
                  <FieldRow key={key} label={key} value={value} mono />
                ))}
              </dl>
            </CollapsibleBlock>
          ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function AiWarningIcon() {
  return (
    <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function LogosSection({ logoDetections, logoCountsByLabel }) {
  const totalLogos = totalLogoCount(logoDetections, logoCountsByLabel);
  return (
    <section className="rounded-none border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="border-b border-slate-100 pb-2 text-sm font-semibold text-slate-900">Logos</h2>
      {totalLogos === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-slate-600">No logos were detected for this document.</p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            <span className="font-semibold text-blue-600">{totalLogos}</span>{" "}
            {totalLogos === 1 ? "mark" : "marks"} found
            {logoDetections.length ? ", outlined on the image." : "."}
          </p>
          <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-4 text-sm">
            {Object.entries(logoCountsByLabel).map(([label, count]) => (
              <li
                key={label}
                className="flex justify-between gap-4 border border-slate-100 bg-slate-50/80 px-3 py-2.5"
              >
                <LogoCategoryLabel raw={label} variant="list" />
                <span className="tabular-nums text-slate-500">{count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function OcrSection({ ocrLines, selectedOcrIdx, onOcrLineClick }) {
  return (
    <section className="rounded-none border border-slate-200 bg-white p-5 shadow-sm">
      <details className="group">
        <summary className="cursor-pointer list-none border-b border-slate-100 pb-2 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
          <span className="inline-flex w-full items-center justify-between gap-2">
            <span>On-screen text ({ocrLines.length})</span>
            <span className="text-xs font-normal text-slate-400 group-open:hidden">Expand</span>
            <span className="hidden text-xs font-normal text-slate-400 group-open:inline">Collapse</span>
          </span>
        </summary>
        {ocrLines.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-slate-600">No text lines were extracted yet.</p>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Select a line to show where it appears on the document.
          </p>
        )}
        {ocrLines.length > 0 ? (
          <ul className="mt-3 max-h-[min(40vh,360px)] space-y-1 overflow-y-auto border border-slate-100 bg-slate-50/50 p-2">
            {ocrLines.map((line) => {
              const active = selectedOcrIdx === line.idx;
              const rowClass = `w-full rounded-none border px-3 py-2.5 text-left text-sm ${
                active
                  ? "border-blue-600 bg-blue-50 text-slate-900"
                  : "border-transparent bg-white text-slate-800"
              } transition-colors hover:border-slate-200 hover:bg-white`;
              return (
                <li key={line.idx}>
                  <button type="button" onClick={() => onOcrLineClick(line.idx)} className={rowClass}>
                    <span className="font-medium">{line.text || "—"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </details>
    </section>
  );
}

function CheckCircleIcon() {
  return (
    <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function AiSyntheticPanel({ analysis, metadataStatus }) {
  const status = (metadataStatus || "").toLowerCase();
  const done = status === "done";
  const verdict = derivePublicAiContentVerdict(analysis);

  return (
    <section className="rounded-none border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="border-b border-slate-100 pb-2 text-sm font-semibold text-slate-900">AI-generated content</h2>

      {!done ? (
        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          An AI-generated content assessment will appear here when processing finishes.
        </p>
      ) : !analysis?.hasResult ? (
        <p className="mt-4 text-sm leading-relaxed text-slate-600">No assessment was returned for this file.</p>
      ) : verdict.outcome === "failed" ? (
        <div className="mt-4 border border-red-200 bg-red-50/90 p-4 text-sm text-red-950" role="alert">
          <p className="font-semibold">Assessment unavailable</p>
          <p className="mt-1.5 leading-relaxed text-red-900/90">
            AI-generated content screening did not complete for this file. Use the file forensics section for other
            signals.
          </p>
        </div>
      ) : verdict.outcome === "skipped" ? (
        <div className="mt-4 border border-slate-200 bg-slate-50/90 p-4 text-sm text-slate-800">
          <p className="font-semibold text-slate-900">Not evaluated</p>
          <p className="mt-1.5 leading-relaxed text-slate-600">
            This file was not run through AI-generated content screening for this job.
          </p>
        </div>
      ) : verdict.outcome === "flagged" ? (
        <div
          role="alert"
          className="mt-4 flex gap-3 border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <AiWarningIcon />
          <div className="min-w-0">
            <p className="font-semibold text-amber-950">Flagged as likely AI-generated or synthetic</p>
            <p className="mt-1.5 leading-relaxed text-amber-950/95">
              Treat authenticity and provenance with extra care for this asset.
            </p>
          </div>
        </div>
      ) : verdict.outcome === "not_flagged" ? (
        <div className="mt-4 flex gap-3 border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-950">
          <CheckCircleIcon />
          <div className="min-w-0">
            <p className="font-semibold text-emerald-950">Not indicated as AI-generated</p>
            <p className="mt-1.5 leading-relaxed text-emerald-950/90">
              Screening did not report this file as AI-generated or synthetic.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 border border-slate-200 bg-slate-50/90 p-4 text-sm text-slate-800">
          <p className="font-semibold text-slate-900">Inconclusive</p>
          <p className="mt-1.5 leading-relaxed text-slate-600">
            AI-generated content status could not be determined clearly from the available information.
          </p>
        </div>
      )}
    </section>
  );
}

/** Forensics + AI panels reused by the dedicated video case viewer. */
export function CaseDetailAnalysisPanels({ metadataAnalysis, metadataStatus, errorMessage }) {
  return (
    <>
      <AiSyntheticPanel analysis={metadataAnalysis} metadataStatus={metadataStatus} />
      <ForensicsSummary
        analysis={metadataAnalysis}
        metadataStatus={metadataStatus}
        errorMessage={errorMessage}
      />
    </>
  );
}

/**
 * @param {{
 *   displayTitle: string;
 *   mediaUrl: string | null;
 *   mediaKind: "image" | "video" | "audio" | "other";
 *   logoDetections: Array<{ box: [number, number, number, number]; label: string; confidence?: number }>;
 *   logoCountsByLabel: Record<string, number>;
 *   ocrLines: Array<{ idx: number; text: string; bbox: unknown; confidence?: number }>;
 *   metadataAnalysis: ReturnType<import("@/lib/parseJobResults").parseJobMetadataResult>;
 *   metadataStatus: string | null | undefined;
 *   errorMessage: string | null;
 * }} props
 */
export default function CaseResultsViewer({
  displayTitle,
  mediaUrl,
  mediaKind,
  logoDetections,
  logoCountsByLabel,
  ocrLines,
  metadataAnalysis,
  metadataStatus,
  errorMessage,
}) {
  const rightColumnRef = useRef(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [stagePx, setStagePx] = useState({ w: 0, h: 0 });
  const [selectedOcrIdx, setSelectedOcrIdx] = useState(null);

  const recomputeStage = useCallback(() => {
    const nw = natural.w;
    const nh = natural.h;
    const el = rightColumnRef.current;
    if (!nw || !nh || !el) {
      setStagePx({ w: 0, h: 0 });
      return;
    }
    const maxW = Math.max(1, el.getBoundingClientRect().width);
    const maxH = Math.min(typeof window !== "undefined" ? window.innerHeight * VIEWPORT_H_FRAC : MAX_STAGE_H, MAX_STAGE_H);
    const ratio = nw / nh;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    if (w > maxW) {
      w = maxW;
      h = w / ratio;
    }
    setStagePx({ w: Math.floor(w), h: Math.floor(h) });
  }, [natural.w, natural.h]);

  useLayoutEffect(() => {
    recomputeStage();
  }, [recomputeStage]);

  useLayoutEffect(() => {
    const el = rightColumnRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => recomputeStage());
    ro.observe(el);
    return () => ro.disconnect();
  }, [recomputeStage]);

  useLayoutEffect(() => {
    function onResize() {
      recomputeStage();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recomputeStage]);

  function onImageLoad(e) {
    const img = e.currentTarget;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
  }

  function onOcrLineClick(idx) {
    setSelectedOcrIdx((prev) => (prev === idx ? null : idx));
  }

  const selectedLine =
    selectedOcrIdx !== null && selectedOcrIdx !== undefined
      ? ocrLines.find((l) => l.idx === selectedOcrIdx)
      : null;
  let selectedBox = null;
  if (selectedLine?.bbox && natural.w > 0 && natural.h > 0) {
    const raw = quadToAxisAlignedBox(selectedLine.bbox);
    selectedBox = raw
      ? expandBoxFromCenter(raw, natural.w, natural.h, OCR_BOX_SCALE) || raw
      : null;
  }

  const showOverlays = mediaKind === "image" && mediaUrl && natural.w > 0 && natural.h > 0 && stagePx.w > 0;

  const pageHeader = (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 lg:text-2xl">
        {displayTitle || "Analysis results"}
      </h1>
      <Link
        href="/cases"
        className="rounded-none border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50"
      >
        All cases
      </Link>
    </div>
  );

  const errorBanner =
    errorMessage ? (
      <div className="rounded-none border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-900">
        {errorMessage}
      </div>
    ) : null;

  return (
    <div className="flex min-h-0 w-full flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex w-full min-w-0 shrink-0 flex-col gap-6 lg:max-w-xl lg:basis-[28rem]">
        {pageHeader}
        {errorBanner}
        <LogosSection logoDetections={logoDetections} logoCountsByLabel={logoCountsByLabel} />
        <OcrSection ocrLines={ocrLines} selectedOcrIdx={selectedOcrIdx} onOcrLineClick={onOcrLineClick} />
        <AiSyntheticPanel analysis={metadataAnalysis} metadataStatus={metadataStatus} />
        <ForensicsSummary
          analysis={metadataAnalysis}
          metadataStatus={metadataStatus}
          errorMessage={errorMessage}
        />
      </div>

      <div ref={rightColumnRef} className="min-h-0 w-full min-w-0 flex-1 lg:pl-2">
        {!mediaUrl ? (
          <div className="rounded-none border border-slate-200 bg-slate-50 p-10 text-center text-sm leading-relaxed text-slate-600">
            A preview could not be loaded for this item.
          </div>
        ) : mediaKind === "image" ? (
          <div className="flex flex-col items-center">
            {!natural.w ? (
              <div className="flex min-h-[200px] w-full flex-col items-center justify-center gap-4 rounded-none border border-slate-300 bg-slate-50 p-6">
                <p className="text-sm text-slate-600">Loading image…</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaUrl}
                  alt=""
                  className="max-h-[min(85vh,1200px)] w-auto max-w-full object-contain"
                  onLoad={onImageLoad}
                />
              </div>
            ) : !stagePx.w || !stagePx.h ? (
              <div className="flex min-h-[200px] w-full flex-col items-center justify-center gap-2 rounded-none border border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                <p>Preparing layout…</p>
              </div>
            ) : (
              <div
                className="relative mx-auto overflow-visible rounded-none border border-slate-200 bg-slate-100 shadow-sm"
                style={{ width: stagePx.w, height: stagePx.h }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaUrl}
                  alt=""
                  className="absolute inset-0 block h-full w-full object-fill"
                  onLoad={onImageLoad}
                />
                {showOverlays ? (
                  <div className="pointer-events-none absolute inset-0">
                    {logoDetections.map((d, i) => {
                      const expanded =
                        expandBoxFromCenter(d.box, natural.w, natural.h, LOGO_BOX_SCALE) || d.box;
                      const st = boxToPercentStyle(expanded, natural.w, natural.h);
                      if (!st) return null;
                      return (
                        <div key={`logo-${i}`} className="absolute" style={st}>
                          <span className="pointer-events-auto absolute bottom-full left-0 z-10 mb-1 h-fit bg-blue-600 px-1 shadow-sm">
                            <LogoCategoryLabel raw={d.label} variant="chip" />
                          </span>
                          <div className="absolute inset-0 border border-blue-600 bg-blue-500/[0.04]" />
                        </div>
                      );
                    })}
                    {selectedBox ? (
                      (() => {
                        const st = boxToPercentStyle(selectedBox, natural.w, natural.h);
                        if (!st) return null;
                        return (
                          <div key="ocr-highlight" className="absolute z-10" style={st}>
                            <div className="absolute inset-0 border border-amber-500 bg-amber-400/10" />
                          </div>
                        );
                      })()
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : mediaKind === "audio" ? (
          <audio controls className="w-full rounded-none border border-slate-300 bg-white p-4" src={mediaUrl} />
        ) : (
          <a
            href={mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-none border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Open file
          </a>
        )}

        {mediaUrl && mediaKind !== "image" ? (
          <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
            Logo and text highlights are available when the source is an image.
          </p>
        ) : null}
      </div>
    </div>
  );
}
