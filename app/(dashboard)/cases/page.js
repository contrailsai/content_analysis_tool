import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import ClientLocalDateTime from "./ClientLocalDateTime";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cases",
  description:
    "Workqueue of media analysis jobs in CAT (Content Analysis Toolkit): logos, on-screen text, and technical metadata.",
};

function statusMeta(overall) {
  const s = (overall || "").toLowerCase();
  if (s === "completed" || s === "done")
    return {
      label: overall || "unknown",
      dot: "bg-emerald-600",
      chip: "border-emerald-600 text-emerald-800 bg-emerald-50",
    };
  if (s === "failed" || s === "error")
    return {
      label: overall || "unknown",
      dot: "bg-red-600",
      chip: "border-red-600 text-red-800 bg-red-50",
    };
  if (s === "processing" || s === "running")
    return {
      label: overall || "unknown",
      dot: "bg-amber-600",
      chip: "border-amber-600 text-amber-900 bg-amber-50",
    };
  if (s === "queued" || s === "pending")
    return {
      label: overall || "unknown",
      dot: "bg-blue-600",
      chip: "border-blue-600 text-blue-900 bg-blue-50",
    };
  return {
    label: overall || "unknown",
    dot: "bg-slate-500",
    chip: "border-slate-400 text-slate-800 bg-slate-50",
  };
}

function labelFromS3Key(key) {
  if (!key) return "—";
  const seg = key.split("/").filter(Boolean);
  return seg.length ? seg[seg.length - 1] : key;
}

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "svg",
  "heic",
  "heif",
  "avif",
  "jfif",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "webm",
  "mkv",
  "avi",
  "m4v",
  "mpeg",
  "mpg",
  "wmv",
  "flv",
  "3gp",
]);

/** @returns {"image" | "video" | "other"} */
function mediaKindFromFilename(name) {
  if (!name || name === "—") return "other";
  const base = name.includes("/") ? name.split("/").filter(Boolean).pop() ?? name : name;
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return "other";
  const ext = base.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "other";
}

function sortJobsByDateNewestFirst(jobs) {
  return [...jobs].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (tb !== ta) return tb - ta;
    const ida = String(a.id ?? "");
    const idb = String(b.id ?? "");
    return idb.localeCompare(ida);
  });
}

function IconImage() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M3 17l5.5-5.5 3 3L17 9l4 4" strokeLinecap="square" strokeLinejoin="miter" />
      <circle cx="8.5" cy="9.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconVideo() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M10 9l6 3-6 3V9z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M14 3H6v18h12V7l-4-4z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}

function FileTypeIndicator({ kind }) {
  const label = kind === "image" ? "Image" : kind === "video" ? "Video" : "File";
  return (
    <span
      className="group/ft relative inline-flex size-10 shrink-0 items-center justify-center text-blue-600"
      aria-label={`${label} file`}
    >
      {kind === "image" ? <IconImage /> : null}
      {kind === "video" ? <IconVideo /> : null}
      {kind === "other" ? <IconFile /> : null}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded-none border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white opacity-0 shadow-sm transition-none group-hover/ft:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

export default async function CasesPage() {
  const supabase = getSupabaseAdmin();
  const { data: jobs, error } = await supabase
    .from("cat_analysis_jobs")
    .select(
      "id, s3_key, overall_status, download_status, logo_status, ocr_status, metadata_status, created_at, updated_at",
    )
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <div className="mx-auto max-w-5xl rounded-none border border-red-200 bg-red-50 p-6 text-sm leading-relaxed text-red-900">
        Could not load cases. Confirm the{" "}
        <code className="rounded-none bg-red-100 px-1.5 py-0.5 font-mono text-red-900">
          cat_analysis_jobs
        </code>{" "}
        table exists and credentials are valid.
      </div>
    );
  }

  const rows = sortJobsByDateNewestFirst(jobs ?? []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <header className="relative rounded-none border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8 sm:py-9">
        <div className="absolute left-0 top-0 h-full w-1 bg-blue-600" aria-hidden />
        <div className="flex flex-col gap-6 pl-3 md:flex-row md:items-end md:justify-between md:pl-4">
          <div className="space-y-2">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-blue-700">
              Workqueue
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Cases</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
              Open any row for logos, extracted text, and the document preview. New submissions land
              here as they move through the pipeline.
            </p>
          </div>
          {rows.length > 0 ? (
            <div className="flex shrink-0 flex-col gap-1 rounded-none border border-blue-200 bg-blue-50 px-4 py-3 text-left md:items-end md:text-right">
              <span className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-blue-800/80">
                In this list
              </span>
              <span className="font-semibold tabular-nums text-slate-900">
                {rows.length}
                <span className="ml-1.5 text-sm font-normal text-slate-600">
                  {rows.length === 1 ? "document" : "documents"}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-none border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm sm:px-10">
          <p className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">No cases yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
            When you submit a document from analysis, it will appear here with live status as
            processing completes.
          </p>
          <Link
            href="/run-analysis"
            className="mt-6 inline-flex items-center gap-2 rounded-none border border-blue-600 bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Start a new analysis
            <span aria-hidden className="text-base leading-none">
              →
            </span>
          </Link>
        </div>
      ) : (
        <div className="rounded-none border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th
                    scope="col"
                    className="w-12 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    S.No
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    Document
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    <span className="inline-flex flex-col gap-0.5">
                      <span>Submitted</span>
                      <span className="font-normal normal-case tracking-normal text-[10px] text-slate-500">
                        Newest first
                      </span>
                    </span>
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((job, index) => {
                  const docLabel = labelFromS3Key(job.s3_key);
                  const meta = statusMeta(job.overall_status);
                  const mediaKind = mediaKindFromFilename(docLabel);
                  const serialNo = index + 1;
                  return (
                    <tr
                      key={job.id}
                      className="group border-b border-slate-100 transition-colors last:border-b-0 hover:bg-blue-50/60"
                    >
                      <td className="px-3 py-3 text-center tabular-nums text-slate-600">{serialNo}</td>
                      <td className="max-w-[min(28rem,40vw)] px-4 py-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <FileTypeIndicator kind={mediaKind} />
                          <span className="min-w-0 truncate font-mono text-xs text-slate-900" title={docLabel}>
                            {docLabel}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-2 rounded-none border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${meta.chip}`}
                        >
                          <span className={`size-1.5 shrink-0 rounded-none ${meta.dot}`} aria-hidden />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <ClientLocalDateTime iso={job.created_at} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/cases/${job.id}`}
                          className="inline-flex items-center justify-center rounded-none border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          Open
                          <span className="sr-only"> case {docLabel}</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
