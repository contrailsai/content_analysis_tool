/**
 * Normalize logo_result / ocr_result from Supabase (object or stringified JSON).
 */

function parseMaybeStringJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }
  return null;
}

function stringOrEmpty(value) {
  if (value == null || value === "") return "";
  return String(value);
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringOrEmpty(item)).filter(Boolean);
}

function boolOrNull(value) {
  if (typeof value === "boolean") return value;
  return null;
}

function emptyMetadataAnalysis() {
  return {
    hasResult: false,
    conclusion: "",
    summaryFlags: [],
    ingest: { sha256: "", fileSize: null, fileType: "" },
    metadata: {
      status: "",
      make: "",
      model: "",
      software: "",
      dimensions: "",
      bitDepth: null,
      colorProfile: "",
      formats: [],
      comments: [],
      externalUrls: [],
      authorshipTraces: [],
      profileDetails: [],
      flags: [],
      rawEntries: [],
    },
    provenance: {
      aiGenerated: null,
      aiProbability: "",
      c2paPresent: null,
      digitalSourceType: "",
      flags: [],
    },
    image: {
      sharpness: null,
      bytesPerPixel: null,
      totalPixelBytes: null,
      imageResolutionQuality: "",
    },
    visual: {
      maxDiff: null,
      elaMeanError: null,
      imgResQty: "",
      error: "",
    },
    quantization: {
      type: "",
      dqtPresent: null,
      dqtMatch: "",
      dqtHash: "",
      qualityEstimate: null,
    },
    aigc: {
      status: "",
      error: "",
      display: {
        showAiWarning: false,
        headline: "",
        reasons: [],
        globalIsFake: null,
        globalPrediction: "",
        provenanceAi: false,
        provenanceNote: "",
      },
      summary: {
        anyModelFake: null,
        signals: [],
      },
      unified: null,
    },
  };
}

/**
 * @returns {{ detections: Array<{ box: [number, number, number, number], label: string, confidence?: number }>, countsByLabel: Record<string, number> }}
 */
export function parseJobLogoResult(logoResult) {
  const obj = parseMaybeStringJson(logoResult);
  if (!obj) {
    return { detections: [], countsByLabel: {} };
  }

  const countsByLabel = {};
  const detections = [];

  const raw = Array.isArray(obj.detections) ? obj.detections : [];
  for (const d of raw) {
    const box = Array.isArray(d?.box) && d.box.length >= 4 ? d.box : null;
    const label = d?.classification?.label != null ? String(d.classification.label) : "unknown";
    if (box) {
      countsByLabel[label] = (countsByLabel[label] ?? 0) + 1;
      detections.push({
        box: [Number(box[0]), Number(box[1]), Number(box[2]), Number(box[3])],
        label,
        confidence:
          typeof d?.classification?.confidence === "number" ? d.classification.confidence : undefined,
      });
    }
  }

  if (detections.length === 0 && Array.isArray(obj.classifications)) {
    for (const c of obj.classifications) {
      const lab = c?.label != null ? String(c.label) : "unknown";
      countsByLabel[lab] = (countsByLabel[lab] ?? 0) + 1;
    }
  }

  return { detections, countsByLabel };
}

/** Quad: [[x,y],...] -> [x1,y1,x2,y2] */
export function quadToAxisAlignedBox(quad) {
  if (!Array.isArray(quad) || quad.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of quad) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return [minX, minY, maxX, maxY];
}

/**
 * @returns {{ lines: Array<{ idx: number, text: string, bbox: unknown, confidence?: number }> }}
 */
export function parseJobOcrResult(ocrResult) {
  const obj = parseMaybeStringJson(ocrResult);
  if (!obj || !Array.isArray(obj.lines)) {
    return { lines: [] };
  }
  const lines = obj.lines.map((line, idx) => ({
    idx,
    text: line?.text != null ? String(line.text) : "",
    bbox: line?.bbox,
    confidence: typeof line?.confidence === "number" ? line.confidence : undefined,
  }));
  return { lines };
}

/**
 * @returns {{
 *   hasResult: boolean,
 *   conclusion: string,
 *   summaryFlags: string[],
 *   ingest: { sha256: string, fileSize: number | null, fileType: string },
 *   metadata: {
 *     status: string,
 *     make: string,
 *     model: string,
 *     software: string,
 *     dimensions: string,
 *     bitDepth: number | null,
 *     colorProfile: string,
 *     formats: string[],
 *     comments: string[],
 *     externalUrls: string[],
 *     authorshipTraces: string[],
 *     profileDetails: string[],
 *     flags: string[],
 *     rawEntries: Array<[string, string]>
 *   },
 *   provenance: {
 *     aiGenerated: boolean | null,
 *     aiProbability: string,
 *     c2paPresent: boolean | null,
 *     digitalSourceType: string,
 *     flags: string[]
 *   },
 *   image: {
 *     sharpness: number | null,
 *     bytesPerPixel: number | null,
 *     totalPixelBytes: number | null,
 *     imageResolutionQuality: string
 *   },
 *   visual: {
 *     maxDiff: number | null,
 *     elaMeanError: number | null,
 *     imgResQty: string,
 *     error: string
 *   },
 *   quantization: {
 *     type: string,
 *     dqtPresent: boolean | null,
 *     dqtMatch: string,
 *     dqtHash: string,
 *     qualityEstimate: number | null
 *   },
 *   aigc: {
 *     status: string,
 *     error: string,
 *     display: {
 *       showAiWarning: boolean,
 *       headline: string,
 *       reasons: string[],
 *       globalIsFake: boolean | null,
 *       globalPrediction: string,
 *       provenanceAi: boolean,
 *       provenanceNote: string
 *     },
 *     summary: { anyModelFake: boolean | null, signals: string[] },
 *     unified: object | null
 *   }
 * }}
 */
export function parseJobMetadataResult(metadataResult) {
  const obj = parseMaybeStringJson(metadataResult);
  if (!obj) {
    return emptyMetadataAnalysis();
  }

  const details = obj.details && typeof obj.details === "object" ? obj.details : {};
  const metadata = details.metadata && typeof details.metadata === "object" ? details.metadata : {};
  const metaDetails = metadata.details && typeof metadata.details === "object" ? metadata.details : {};
  const provenance = details.provenance && typeof details.provenance === "object" ? details.provenance : {};
  const imageAnalysis =
    details.image_analysis && typeof details.image_analysis === "object" ? details.image_analysis : {};
  const visualRaw = details.visual && typeof details.visual === "object" ? details.visual : {};
  const quantization = details.quantization && typeof details.quantization === "object" ? details.quantization : {};
  const raw = metadata.raw && typeof metadata.raw === "object" && !Array.isArray(metadata.raw) ? metadata.raw : {};
  const aigcRaw = details.aigc && typeof details.aigc === "object" ? details.aigc : {};
  const aigcDisplay = aigcRaw.display && typeof aigcRaw.display === "object" ? aigcRaw.display : {};
  const aigcSummary = aigcRaw.summary && typeof aigcRaw.summary === "object" ? aigcRaw.summary : {};

  const provAiGen = typeof provenance.ai_generated === "boolean" ? provenance.ai_generated : null;
  const unified =
    aigcRaw.unified != null && typeof aigcRaw.unified === "object" && !Array.isArray(aigcRaw.unified)
      ? aigcRaw.unified
      : null;

  return {
    hasResult: true,
    conclusion: stringOrEmpty(obj.final_conclusion),
    summaryFlags: stringArray(obj.summary_flags),
    ingest: {
      sha256: stringOrEmpty(obj.ingest?.sha256),
      fileSize: numberOrNull(obj.ingest?.file_size),
      fileType: stringOrEmpty(obj.ingest?.file_type),
    },
    metadata: {
      status: stringOrEmpty(metadata.status),
      make: stringOrEmpty(metadata.make),
      model: stringOrEmpty(metadata.model),
      software: stringOrEmpty(metaDetails.software),
      dimensions: stringOrEmpty(metaDetails.dimensions),
      bitDepth: numberOrNull(metaDetails.bit_depth),
      colorProfile: stringOrEmpty(metaDetails.color_profile),
      formats: stringArray(metaDetails.metadata_formats),
      comments: stringArray(metaDetails.comments),
      externalUrls: stringArray(metaDetails.external_urls),
      authorshipTraces: stringArray(metaDetails.authorship_traces),
      profileDetails: stringArray(metaDetails.profile_details),
      flags: stringArray(metadata.flags),
      rawEntries: Object.entries(raw)
        .map(([key, value]) => [key, stringOrEmpty(value)])
        .sort(([a], [b]) => a.localeCompare(b)),
    },
    provenance: {
      aiGenerated: provAiGen,
      aiProbability: stringOrEmpty(provenance.ai_probability),
      c2paPresent: typeof provenance.c2pa_present === "boolean" ? provenance.c2pa_present : null,
      digitalSourceType: stringOrEmpty(provenance.digital_source_type),
      flags: stringArray(provenance.flags),
    },
    image: {
      sharpness: numberOrNull(imageAnalysis.sharpness),
      bytesPerPixel: numberOrNull(imageAnalysis.bytes_per_pixel),
      totalPixelBytes: numberOrNull(imageAnalysis.total_pixel_bytes),
      imageResolutionQuality: stringOrEmpty(imageAnalysis.image_resolution_quality),
    },
    visual: {
      maxDiff: numberOrNull(visualRaw.max_diff),
      elaMeanError: numberOrNull(visualRaw.ela_mean_error),
      imgResQty: stringOrEmpty(visualRaw.img_res_qty),
      error: stringOrEmpty(visualRaw.error),
    },
    quantization: {
      type: stringOrEmpty(quantization.type),
      dqtPresent: typeof quantization.dqt_present === "boolean" ? quantization.dqt_present : null,
      dqtMatch: stringOrEmpty(quantization.dqt_match),
      dqtHash: stringOrEmpty(quantization.dqt_hash),
      qualityEstimate: numberOrNull(quantization.quality_estimate),
    },
    aigc: {
      status: stringOrEmpty(aigcRaw.status),
      error: stringOrEmpty(aigcRaw.error),
      display: {
        showAiWarning: aigcDisplay.show_ai_warning === true,
        headline: stringOrEmpty(aigcDisplay.headline),
        reasons: stringArray(aigcDisplay.reasons),
        globalIsFake: boolOrNull(aigcDisplay.global_is_fake),
        globalPrediction: stringOrEmpty(aigcDisplay.global_prediction),
        provenanceAi: aigcDisplay.provenance_ai === true,
        provenanceNote: stringOrEmpty(aigcDisplay.provenance_note),
      },
      summary: {
        anyModelFake: boolOrNull(aigcSummary.any_model_fake),
        signals: stringArray(aigcSummary.signals),
      },
      unified,
    },
  };
}

export function boxToPercentStyle(box, naturalWidth, naturalHeight) {
  if (
    !box ||
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    box.length < 4
  ) {
    return null;
  }
  const [x1, y1, x2, y2] = box;
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return null;
  return {
    left: `${(x1 / naturalWidth) * 100}%`,
    top: `${(y1 / naturalHeight) * 100}%`,
    width: `${(w / naturalWidth) * 100}%`,
    height: `${(h / naturalHeight) * 100}%`,
  };
}

/**
 * Uniform scale from box center, clamped to image bounds (display-friendly overlay).
 * @param {number} scale e.g. 1.35 = 35% larger on each axis from center
 */
export function expandBoxFromCenter(box, naturalWidth, naturalHeight, scale = 1.35) {
  if (!box || box.length < 4 || naturalWidth <= 0 || naturalHeight <= 0) return null;
  const [x1, y1, x2, y2] = box;
  let bw = x2 - x1;
  let bh = y2 - y1;
  if (bw <= 0 || bh <= 0) return null;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const s = Math.max(1, scale);
  bw *= s;
  bh *= s;
  let nx1 = cx - bw / 2;
  let ny1 = cy - bh / 2;
  let nx2 = cx + bw / 2;
  let ny2 = cy + bh / 2;
  nx1 = Math.max(0, nx1);
  ny1 = Math.max(0, ny1);
  nx2 = Math.min(naturalWidth, nx2);
  ny2 = Math.min(naturalHeight, ny2);
  if (nx2 - nx1 < 2 || ny2 - ny1 < 2) return [x1, y1, x2, y2];
  return [nx1, ny1, nx2, ny2];
}
