import type { DurationEstimationResult, SystemHardwareInfo, WorkerStatus } from "~/types";

export interface ResolutionInfo {
  width: number;
  height: number;
  fps: number;
  pixels: number;
  pixelRate: number; // pixels per second
  rawResolution: string;
}

export interface HardwareContext {
  target: "local" | "worker";
  cpuCores: number;
  cpuPhysicalCores?: number;
  cpuBrand: string;
  hasNvenc: boolean;
  hasAmf: boolean;
  hasQsv: boolean;
  gpuName?: string | null;
}

export interface EstimationParams {
  durationSecs: number;
  preset: string; // "hevc_nvenc" | "hevc_amf" | "hevc_qsv" | "libx265" | "libx264" | "passthrough"
  crf: number; // typically 18 - 32
  qualityResolution?: string; // e.g. "1920x1080", "1280x720", "1080p60"
  qualityFps?: number; // e.g. 60, 30
  qualityBandwidth?: number; // bits/sec from Twitch master playlist
  target: "local" | "worker";
  localHardware?: SystemHardwareInfo | null;
  workerStatus?: WorkerStatus | null;
  destinations?: {
    saveLocal?: boolean;
    uploadToS3?: boolean;
    uploadToGdrive?: boolean;
    uploadToWebdav?: boolean;
    uploadToYouTube?: boolean;
  };
}

export interface EncodingBenchmarkRecord {
  target: "local" | "worker";
  preset: string;
  width: number;
  height: number;
  fps: number;
  crf: number;
  actualFps: number;
  actualSpeed: number; // e.g. 5.8 (for 5.8x)
  durationSecs: number;
  timestamp: number;
}

const STORAGE_KEY_CALIBRATION = "tvm_encoding_history";
const MAX_CALIBRATION_RECORDS = 50;

/**
 * Parses resolution string and frame rate into structured dimensions.
 */
export function parseResolutionAndFps(
  resStr?: string,
  fpsNum?: number,
  qualityName?: string,
): ResolutionInfo {
  const combined = `${resStr || ""} ${qualityName || ""}`.toLowerCase().trim();

  let width = 1920;
  let height = 1080;
  let fps = fpsNum && fpsNum > 0 ? fpsNum : 60;

  // Try matching standard "1920x1080" format
  const dimMatch = combined.match(/(\d{3,4})x(\d{3,4})/);
  if (dimMatch) {
    width = parseInt(dimMatch[1], 10);
    height = parseInt(dimMatch[2], 10);
  } else if (combined.includes("4k") || combined.includes("2160p")) {
    width = 3840;
    height = 2160;
  } else if (combined.includes("1440p") || combined.includes("2k")) {
    width = 2560;
    height = 1440;
  } else if (combined.includes("1080p") || combined.includes("source") || combined.includes("chunked")) {
    width = 1920;
    height = 1080;
  } else if (combined.includes("720p")) {
    width = 1280;
    height = 720;
  } else if (combined.includes("480p")) {
    width = 854;
    height = 480;
  } else if (combined.includes("360p")) {
    width = 640;
    height = 360;
  } else if (combined.includes("160p")) {
    width = 284;
    height = 160;
  }

  // If fps wasn't explicitly supplied, check string
  if (!fpsNum || fpsNum <= 0) {
    if (combined.includes("60fps") || combined.includes("p60")) {
      fps = 60;
    } else if (combined.includes("50fps") || combined.includes("p50")) {
      fps = 50;
    } else if (combined.includes("30fps") || combined.includes("p30")) {
      fps = 30;
    } else if (height <= 480) {
      fps = 30;
    } else {
      fps = 60;
    }
  }

  const pixels = width * height;
  const pixelRate = pixels * fps;

  return {
    width,
    height,
    fps,
    pixels,
    pixelRate,
    rawResolution: `${width}x${height}@${fps}fps`,
  };
}

/**
 * Builds the resolved hardware context based on target engine.
 */
export function resolveHardwareContext(
  target: "local" | "worker",
  localHardware?: SystemHardwareInfo | null,
  workerStatus?: WorkerStatus | null,
): HardwareContext {
  if (target === "worker") {
    const cores = workerStatus?.cpu_cores && workerStatus.cpu_cores > 0 ? workerStatus.cpu_cores : 4;
    return {
      target: "worker",
      cpuCores: cores,
      cpuPhysicalCores: Math.max(1, Math.round(cores / 2)),
      cpuBrand: workerStatus?.cpu_brand || "Cloud VPS Worker vCPU",
      hasNvenc: Boolean(workerStatus?.has_nvenc),
      hasAmf: Boolean(workerStatus?.has_amf),
      hasQsv: Boolean(workerStatus?.has_qsv),
      gpuName: workerStatus?.has_nvenc
        ? "NVIDIA GPU (Worker)"
        : workerStatus?.has_amf
          ? "AMD GPU (Worker)"
          : workerStatus?.has_qsv
            ? "Intel QuickSync (Worker)"
            : null,
    };
  }

  // Local PC
  const cores = localHardware?.cpu_cores && localHardware.cpu_cores > 0 ? localHardware.cpu_cores : 8;
  return {
    target: "local",
    cpuCores: cores,
    cpuPhysicalCores: localHardware?.cpu_physical_cores || Math.max(1, Math.round(cores / 2)),
    cpuBrand: localHardware?.cpu_brand || "Local CPU",
    hasNvenc: Boolean(localHardware?.has_nvenc),
    hasAmf: Boolean(localHardware?.has_amf),
    hasQsv: Boolean(localHardware?.has_qsv),
    gpuName: localHardware?.gpu_name || null,
  };
}

/**
 * Estimates Twitch CDN download duration and size.
 */
export function estimateDownloadMetrics(
  durationSecs: number,
  resInfo: ResolutionInfo,
  qualityBandwidth?: number,
  target: "local" | "worker" = "local",
): { downloadSecs: number; downloadSizeMB: number; bitrateMbps: number } {
  if (durationSecs <= 0) {
    return { downloadSecs: 0, downloadSizeMB: 0, bitrateMbps: 0 };
  }

  // Bandwidth from playlist (bits/second) if available
  let bitrateMbps: number;
  if (qualityBandwidth && qualityBandwidth > 200_000) {
    bitrateMbps = qualityBandwidth / 1_000_000;
  } else {
    // Model realistic Twitch CDN average bitrates based on resolution and fps
    const p = resInfo.pixels;
    if (p >= 3840 * 2160 * 0.9) {
      bitrateMbps = 18.0;
    } else if (p >= 2560 * 1440 * 0.9) {
      bitrateMbps = 12.0;
    } else if (p >= 1920 * 1080 * 0.9) {
      bitrateMbps = resInfo.fps >= 50 ? 7.5 : 5.0;
    } else if (p >= 1280 * 720 * 0.9) {
      bitrateMbps = resInfo.fps >= 50 ? 4.8 : 3.0;
    } else if (p >= 854 * 480 * 0.9) {
      bitrateMbps = 1.8;
    } else if (p >= 640 * 360 * 0.9) {
      bitrateMbps = 1.0;
    } else {
      bitrateMbps = 0.5;
    }
  }

  const downloadSizeMB = (durationSecs * bitrateMbps) / 8;

  // Multi-threaded chunk download throughput:
  // Worker VPS generally has datacenter connectivity (~50 MB/s). Local average ~25 MB/s (~200 Mbps).
  const throughputMBps = target === "worker" ? 50 : 25;
  const downloadSecs = Math.max(3, Math.round(downloadSizeMB / throughputMBps));

  return { downloadSecs, downloadSizeMB, bitrateMbps };
}

let memoryStore: Record<string, string> = {};

function getLocalStorage(): Storage {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== "undefined" && (globalThis as unknown as { localStorage?: Storage }).localStorage) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return {
    getItem: (key: string) => memoryStore[key] ?? null,
    setItem: (key: string, value: string) => {
      memoryStore[key] = value;
    },
    removeItem: (key: string) => {
      delete memoryStore[key];
    },
    clear: () => {
      memoryStore = {};
    },
    key: (index: number) => Object.keys(memoryStore)[index] ?? null,
    length: Object.keys(memoryStore).length,
  };
}

export function clearCalibrationHistory(): void {
  const storage = getLocalStorage();
  storage.removeItem(STORAGE_KEY_CALIBRATION);
}

/**
 * Loads empirical benchmark calibration history from localStorage.
 */
export function loadEncodingCalibrationHistory(): EncodingBenchmarkRecord[] {
  const storage = getLocalStorage();
  try {
    const raw = storage.getItem(STORAGE_KEY_CALIBRATION);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      return list;
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * Records a completed encoding result into historical calibration storage.
 */
export function recordEncodingTelemetry(record: Omit<EncodingBenchmarkRecord, "timestamp">): void {
  const storage = getLocalStorage();
  if (!record.actualFps || record.actualFps <= 0) return;

  try {
    const list = loadEncodingCalibrationHistory();
    const newRecord: EncodingBenchmarkRecord = {
      ...record,
      timestamp: Date.now(),
    };

    // Keep newest entries up to max
    const updated = [newRecord, ...list.slice(0, MAX_CALIBRATION_RECORDS - 1)];
    storage.setItem(STORAGE_KEY_CALIBRATION, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Calculates empirical calibration multiplier for a specific preset and hardware.
 */
export function getCalibrationMultiplier(
  target: "local" | "worker",
  preset: string,
  resInfo: ResolutionInfo,
): { factor: number; isCalibrated: boolean } {
  const history = loadEncodingCalibrationHistory();
  if (history.length === 0) {
    return { factor: 1.0, isCalibrated: false };
  }

  // Find matches within the same target and preset
  const matching = history.filter(
    (h) => h.target === target && h.preset === preset && h.actualFps > 0,
  );

  if (matching.length === 0) {
    return { factor: 1.0, isCalibrated: false };
  }

  // Weight recent runs higher (exponential decay over 14 days)
  const now = Date.now();
  let totalWeight = 0;
  let weightedRatioSum = 0;

  for (const sample of matching) {
    const ageDays = (now - sample.timestamp) / (1000 * 60 * 60 * 24);
    if (ageDays > 60) continue; // Skip very old data
    const weight = Math.exp(-ageDays / 14);

    const samplePixels = sample.width * sample.height;
    const samplePixelThroughput = sample.actualFps * samplePixels;
    const normalizedFps = samplePixelThroughput / Math.max(1, resInfo.pixels);
    const normalizedSpeed = normalizedFps / Math.max(1, resInfo.fps);

    if (normalizedSpeed > 0) {
      totalWeight += weight;
      weightedRatioSum += normalizedSpeed * weight;
    }
  }

  if (totalWeight <= 0) {
    return { factor: 1.0, isCalibrated: false };
  }

  const avgObservedSpeed = weightedRatioSum / totalWeight;

  return {
    factor: avgObservedSpeed,
    isCalibrated: true,
  };
}

/**
 * Comprehensive physics-based and hardware-aware duration estimation.
 */
export function estimateJobDuration(params: EstimationParams): DurationEstimationResult {
  const {
    durationSecs,
    preset,
    crf,
    qualityResolution,
    qualityFps,
    qualityBandwidth,
    target,
    localHardware,
    workerStatus,
    destinations,
  } = params;

  if (!durationSecs || durationSecs <= 0) {
    return {
      downloadSecs: 0,
      compressionSecs: 0,
      uploadSecs: 0,
      totalSecs: 0,
      effectiveFps: 0,
      speedMultiplier: 0,
      target,
      isHardwareFallback: false,
      hardwareDescription: "Unknown",
      isCalibrated: false,
      downloadSizeMB: 0,
      estimatedOutputSizeMB: 0,
    };
  }

  const resInfo = parseResolutionAndFps(qualityResolution, qualityFps);
  const totalFrames = durationSecs * resInfo.fps;
  const hw = resolveHardwareContext(target, localHardware, workerStatus);

  // 1. Download Estimation
  const { downloadSecs, downloadSizeMB } = estimateDownloadMetrics(
    durationSecs,
    resInfo,
    qualityBandwidth,
    target,
  );

  // 2. Hardware Fallback & Availability Check
  let isHardwareFallback = false;
  let fallbackReason: string | undefined;
  let activePreset = preset;

  if (preset === "hevc_nvenc" && !hw.hasNvenc) {
    isHardwareFallback = true;
    fallbackReason = `Selected ${target === "worker" ? "Cloud Worker" : "Local PC"} lacks NVIDIA NVENC hardware. Auto-falling back to CPU libx264 fast.`;
    activePreset = "libx264";
  } else if (preset === "hevc_amf" && !hw.hasAmf) {
    isHardwareFallback = true;
    fallbackReason = `Selected ${target === "worker" ? "Cloud Worker" : "Local PC"} lacks AMD AMF hardware. Auto-falling back to CPU libx264 fast.`;
    activePreset = "libx264";
  } else if (preset === "hevc_qsv" && !hw.hasQsv) {
    isHardwareFallback = true;
    fallbackReason = `Selected ${target === "worker" ? "Cloud Worker" : "Local PC"} lacks Intel QuickSync hardware. Auto-falling back to CPU libx264 fast.`;
    activePreset = "libx264";
  }

  // 3. Compression Speed Modeling
  let theoreticalFps = 60;
  let speedMultiplier = 1.0;
  let hardwareDescription = "";

  if (activePreset === "passthrough") {
    // Remuxing only: disk I/O throughput ~160 MB/s
    const remuxSecs = Math.max(5, Math.round(downloadSizeMB / 160));
    const compressionSecs = Math.min(60, remuxSecs);
    speedMultiplier = durationSecs / compressionSecs;
    theoreticalFps = totalFrames / compressionSecs;
    hardwareDescription = "Disk Remux (Stream Copy, no transcode)";

    const uploadSecs = estimateUploadSecs(downloadSizeMB, destinations, target);
    return {
      downloadSecs,
      compressionSecs,
      uploadSecs,
      totalSecs: downloadSecs + compressionSecs + uploadSecs,
      effectiveFps: Math.round(theoreticalFps),
      speedMultiplier: Math.round(speedMultiplier * 10) / 10,
      target,
      isHardwareFallback: false,
      hardwareDescription,
      isCalibrated: false,
      downloadSizeMB: Math.round(downloadSizeMB),
      estimatedOutputSizeMB: Math.round(downloadSizeMB),
    };
  }

  // CRF Complexity Adjustment (Lower CRF = slower encoding, higher quality)
  // Base CRF is 24. For each CRF step, compute ~1.5% complexity shift.
  const safeCrf = Math.max(16, Math.min(36, crf || 24));
  const crfFactor = 1.0 + (24 - safeCrf) * 0.015;

  if (activePreset === "hevc_nvenc" || activePreset === "hevc_amf" || activePreset === "hevc_qsv") {
    // Dedicated ASIC HW Video Processing Pipeline
    // NVENC ~850M pixels/sec, AMF ~650M pixels/sec, QSV ~700M pixels/sec
    let hwPixelThroughput = 850_000_000;
    let hwName = "NVIDIA NVENC";

    if (activePreset === "hevc_amf") {
      hwPixelThroughput = 650_000_000;
      hwName = "AMD AMF";
    } else if (activePreset === "hevc_qsv") {
      hwPixelThroughput = 700_000_000;
      hwName = "Intel QuickSync";
    }

    if (hw.gpuName) {
      hardwareDescription = `${hwName} (${hw.gpuName})`;
    } else {
      hardwareDescription = `${hwName} Hardware Encoder`;
    }

    const baseFps = hwPixelThroughput / resInfo.pixels;
    theoreticalFps = Math.max(15, baseFps / crfFactor);
  } else {
    // Software CPU Encoders (libx264 fast, libx265 medium)
    const effectiveCores = Math.pow(Math.max(1, hw.cpuCores), 0.82);

    // Architecture tier multiplier
    const brand = hw.cpuBrand.toLowerCase();
    let archTier = 1.0;
    if (
      brand.includes("ryzen") ||
      brand.includes("apple") ||
      brand.includes("12th") ||
      brand.includes("13th") ||
      brand.includes("14th") ||
      brand.includes("ai 9") ||
      brand.includes("ultra") ||
      brand.includes("m1") ||
      brand.includes("m2") ||
      brand.includes("m3") ||
      brand.includes("m4")
    ) {
      archTier = 1.25;
    } else if (target === "worker") {
      archTier = 0.9;
    }

    // Base FPS per effective core at 1080p
    const isX265 = activePreset === "libx265";
    const basePerCoreFps = isX265 ? 4.8 : 20.0;

    // Super-linear scaling with resolution for motion estimation search windows
    const resolutionComplexity = Math.pow(resInfo.pixels / (1920 * 1080), 1.08);

    const cpuFps =
      (basePerCoreFps * effectiveCores * archTier) / (resolutionComplexity * crfFactor);

    theoreticalFps = Math.max(3, cpuFps);
    hardwareDescription = `${hw.cpuCores} Threads (${hw.cpuBrand})`;
  }

  // 4. Calibration from Historical Telemetry
  let effectiveFps = theoreticalFps;
  let isCalibrated = false;

  const cal = getCalibrationMultiplier(target, activePreset, resInfo);
  if (cal.isCalibrated) {
    const empiricalFps = cal.factor * resInfo.fps;
    if (empiricalFps > 0) {
      // Blend: 75% empirical + 25% theoretical
      effectiveFps = 0.75 * empiricalFps + 0.25 * theoreticalFps;
      isCalibrated = true;
    }
  }

  // Compression duration calculation
  const compressionSecs = Math.max(5, Math.round(totalFrames / effectiveFps));
  speedMultiplier = Math.round((durationSecs / compressionSecs) * 10) / 10;

  // 5. Estimated Output Size & Upload Estimation
  const isHevc = activePreset.includes("hevc") || activePreset.includes("x265");
  const sizeRatio = isHevc ? 0.42 : 0.68;
  const crfSizeMultiplier = Math.pow(2, (24 - safeCrf) / 6);
  const estimatedOutputSizeMB = Math.max(
    10,
    Math.round(downloadSizeMB * sizeRatio * crfSizeMultiplier),
  );

  const uploadSecs = estimateUploadSecs(estimatedOutputSizeMB, destinations, target);
  const totalSecs = downloadSecs + compressionSecs + uploadSecs;

  return {
    downloadSecs,
    compressionSecs,
    uploadSecs,
    totalSecs,
    effectiveFps: Math.round(effectiveFps),
    speedMultiplier,
    target,
    isHardwareFallback,
    fallbackReason,
    hardwareDescription,
    isCalibrated,
    downloadSizeMB: Math.round(downloadSizeMB),
    estimatedOutputSizeMB,
  };
}

/**
 * Helper to estimate upload duration across enabled cloud destinations.
 */
function estimateUploadSecs(
  outputSizeMB: number,
  destinations?: EstimationParams["destinations"],
  target: "local" | "worker" = "local",
): number {
  if (!destinations) return 0;

  let activeUploads = 0;
  if (destinations.uploadToS3) activeUploads++;
  if (destinations.uploadToGdrive) activeUploads++;
  if (destinations.uploadToWebdav) activeUploads++;
  if (destinations.uploadToYouTube) activeUploads++;

  if (activeUploads === 0) return 0;

  // Uplink throughput: Worker VPS ~40 MB/s (datacenter), Local ~8 MB/s (home uplink)
  const uplinkSpeedMBps = target === "worker" ? 40 : 8;
  const singleUploadSecs = Math.max(3, Math.round(outputSizeMB / uplinkSpeedMBps));

  return singleUploadSecs * activeUploads;
}
