import { notFound } from "next/navigation";
import CaseResultsViewer from "./CaseResultsViewer";
import { getPresignedGetUrl } from "@/lib/s3";
import { parseJobLogoResult, parseJobMetadataResult, parseJobOcrResult } from "@/lib/parseJobResults";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function basenameFromKey(key) {
  if (!key) return "";
  const parts = key.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : key;
}

function isImageName(name) {
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name || "");
}

function isVideoName(name) {
  return /\.(mp4|webm|mov|m4v|mkv)$/i.test(name || "");
}

function isAudioName(name) {
  return /\.(mp3|wav|m4a|aac|ogg)$/i.test(name || "");
}

function mediaKindFromFilename(name) {
  if (isImageName(name)) return "image";
  if (isVideoName(name)) return "video";
  if (isAudioName(name)) return "audio";
  return "other";
}

export default async function CaseDetailPage({ params }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data: job, error } = await supabase
    .from("cat_analysis_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="rounded-none border border-red-300 bg-red-50 p-6 text-sm text-red-900">
        Failed to load this case.
      </div>
    );
  }

  if (!job) {
    notFound();
  }

  let mediaUrl = null;
  try {
    if (job.s3_key) {
      mediaUrl = await getPresignedGetUrl({ key: job.s3_key, expiresIn: 3600 });
    }
  } catch {
    mediaUrl = null;
  }

  const displayTitle = basenameFromKey(job.s3_key) || "Analysis results";
  const mediaKind = mediaKindFromFilename(displayTitle);

  const { detections: logoDetections, countsByLabel: logoCountsByLabel } = parseJobLogoResult(
    job.logo_result,
  );
  const { lines: ocrLines } = parseJobOcrResult(job.ocr_result);
  const metadataAnalysis = parseJobMetadataResult(job.metadata_result);

  return (
    <CaseResultsViewer
      displayTitle={displayTitle}
      mediaUrl={mediaUrl}
      mediaKind={mediaKind}
      logoDetections={logoDetections}
      logoCountsByLabel={logoCountsByLabel}
      ocrLines={ocrLines}
      metadataAnalysis={metadataAnalysis}
      metadataStatus={job.metadata_status}
      errorMessage={job.error_message}
    />
  );
}
