import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatDuration(duration: string): string {
  // Twitch duration format: "3h24m12s" or "45m10s" or "30s"
  return duration.replace("h", "h ").replace("m", "m ").trim();
}

export function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export function formatSpeed(mbps: number): string {
  if (mbps < 1.0) {
    return `${(mbps * 1000).toFixed(0)} Kbps`;
  }
  return `${mbps.toFixed(1)} Mbps`;
}

export function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}h ${remM}m`;
  }
  return `${m}m ${s}s`;
}

export function parseTwitchDuration(dur: string): number {
  if (!dur) return 0;
  let total = 0;
  const h = dur.match(/(\d+)h/);
  const m = dur.match(/(\d+)m/);
  const s = dur.match(/(\d+)s/);
  if (h) total += parseInt(h[1], 10) * 3600;
  if (m) total += parseInt(m[1], 10) * 60;
  if (s) total += parseInt(s[1], 10);
  return total;
}

export function formatApproxDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "--";
  if (seconds < 60) {
    return `< 1 min`;
  }
  const m = Math.round(seconds / 60);
  if (m < 60) {
    return `~${m} min`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `~${h}h ${remM}m` : `~${h}h`;
}

/**
 * Parse a user input timestamp into seconds.
 * Accepts formats:
 * - "15" -> 15 minutes (900s) if defaultUnit is "minutes", or raw seconds
 * - "15m" / "15m 30s" / "1h 15m"
 * - "15:30" (MM:SS) -> 930s
 * - "01:15:30" (HH:MM:SS) -> 4530s
 */
export function parseTimestampToSeconds(
  input: string | number | undefined | null,
  defaultUnit: "minutes" | "seconds" = "minutes",
): number | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "number") {
    if (isNaN(input) || input < 0) return null;
    return defaultUnit === "minutes" ? Math.round(input * 60) : Math.round(input);
  }

  const str = input.trim().toLowerCase();
  if (!str) return null;

  // HH:MM:SS or MM:SS
  if (str.includes(":")) {
    const parts = str.split(":").map((p) => parseFloat(p.trim()));
    if (parts.some((p) => isNaN(p) || p < 0)) return null;
    if (parts.length === 2) {
      return Math.round(parts[0] * 60 + parts[1]);
    }
    if (parts.length === 3) {
      return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }
    return null;
  }

  // 1h20m30s or 15m or 30s
  if (str.includes("h") || str.includes("m") || str.includes("s")) {
    let total = 0;
    let matched = false;
    const h = str.match(/(\d+(?:\.\d+)?)h/);
    const m = str.match(/(\d+(?:\.\d+)?)m/);
    const s = str.match(/(\d+(?:\.\d+)?)s/);
    if (h) {
      total += parseFloat(h[1]) * 3600;
      matched = true;
    }
    if (m) {
      total += parseFloat(m[1]) * 60;
      matched = true;
    }
    if (s) {
      total += parseFloat(s[1]);
      matched = true;
    }
    if (matched) return Math.round(total);
  }

  // Raw number string
  const num = parseFloat(str);
  if (isNaN(num) || num < 0) return null;
  return defaultUnit === "minutes" ? Math.round(num * 60) : Math.round(num);
}

/**
 * Formats a duration in seconds into a standard timestamp string (HH:MM:SS or MM:SS).
 */
export function formatSecondsToTimestamp(
  seconds: number | undefined | null,
  forceHours = false,
): string {
  if (seconds === undefined || seconds === null || isNaN(seconds) || seconds < 0) {
    return "00:00";
  }
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hrs > 0 || forceHours) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

import {
  estimateJobDuration,
  estimateDownloadMetrics,
  parseResolutionAndFps,
  type EstimationParams,
} from "./estimation";

export {
  estimateJobDuration,
  estimateDownloadMetrics,
  parseResolutionAndFps,
};
export type { EstimationParams };

export function estimateDownloadDuration(
  durationSecs: number,
  qualityResolution?: string,
  qualityBandwidth?: number,
  target: "local" | "worker" = "local",
): number {
  if (!durationSecs || durationSecs <= 0) return 0;
  const resInfo = parseResolutionAndFps(qualityResolution);
  return estimateDownloadMetrics(durationSecs, resInfo, qualityBandwidth, target).downloadSecs;
}

export function estimateCompressionDuration(
  durationSecs: number,
  preset: string,
  qualityResolution?: string,
  crf: number = 24,
  qualityFps?: number,
  target: "local" | "worker" = "local",
): number {
  if (!durationSecs || durationSecs <= 0) return 0;
  const res = estimateJobDuration({
    durationSecs,
    preset,
    crf,
    qualityResolution,
    qualityFps,
    target,
  });
  return res.compressionSecs;
}
