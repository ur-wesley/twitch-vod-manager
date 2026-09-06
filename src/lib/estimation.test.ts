import { describe, expect, it, beforeEach } from "vitest";
import {
  parseResolutionAndFps,
  estimateDownloadMetrics,
  estimateJobDuration,
  recordEncodingTelemetry,
  loadEncodingCalibrationHistory,
  clearCalibrationHistory,
} from "./estimation";
import type { SystemHardwareInfo, WorkerStatus } from "~/types";

describe("Duration Estimation Engine", () => {
  beforeEach(() => {
    clearCalibrationHistory();
  });

  describe("parseResolutionAndFps", () => {
    it("parses explicit standard resolution strings", () => {
      const r1 = parseResolutionAndFps("1920x1080", 60);
      expect(r1.width).toBe(1920);
      expect(r1.height).toBe(1080);
      expect(r1.fps).toBe(60);
      expect(r1.pixels).toBe(2073600);

      const r2 = parseResolutionAndFps("1280x720", 30);
      expect(r2.width).toBe(1280);
      expect(r2.height).toBe(720);
      expect(r2.fps).toBe(30);
      expect(r2.pixels).toBe(921600);

      const r4k = parseResolutionAndFps("3840x2160", 60);
      expect(r4k.width).toBe(3840);
      expect(r4k.height).toBe(2160);
      expect(r4k.pixels).toBe(8294400);
    });

    it("infers dimensions and fps from quality names", () => {
      const r1080p60 = parseResolutionAndFps("1080p60 (source)");
      expect(r1080p60.width).toBe(1920);
      expect(r1080p60.height).toBe(1080);
      expect(r1080p60.fps).toBe(60);

      const r720p30 = parseResolutionAndFps("720p30");
      expect(r720p30.width).toBe(1280);
      expect(r720p30.height).toBe(720);
      expect(r720p30.fps).toBe(30);

      const r480p = parseResolutionAndFps("480p");
      expect(r480p.height).toBe(480);
      expect(r480p.fps).toBe(30);
    });
  });

  describe("estimateDownloadMetrics", () => {
    it("scales download size with resolution and duration", () => {
      const r1080 = parseResolutionAndFps("1920x1080", 60);
      const r720 = parseResolutionAndFps("1280x720", 30);

      const d1080 = estimateDownloadMetrics(3600, r1080); // 1 hour
      const d720 = estimateDownloadMetrics(3600, r720);

      expect(d1080.downloadSizeMB).toBeGreaterThan(d720.downloadSizeMB);
      expect(d1080.downloadSecs).toBeGreaterThan(d720.downloadSecs);
    });

    it("uses playlist bandwidth when provided", () => {
      const r = parseResolutionAndFps("1920x1080", 60);
      const d = estimateDownloadMetrics(3600, r, 8000000); // 8 Mbps
      expect(d.bitrateMbps).toBe(8.0);
      expect(d.downloadSizeMB).toBe((3600 * 8) / 8);
    });
  });

  describe("estimateJobDuration - Resolution & Settings Scaling", () => {
    const localHostWithGpu: SystemHardwareInfo = {
      cpu_brand: "AMD Ryzen AI 9 365",
      cpu_cores: 20,
      cpu_physical_cores: 10,
      total_memory_mb: 32000,
      gpu_name: "AMD Radeon 880M",
      has_nvenc: false,
      has_amf: true,
      has_qsv: false,
    };

    it("calculates significantly longer compression for 4K than 1080p and 720p", () => {
      const dur = 3600; // 1 hour video

      const est720 = estimateJobDuration({
        durationSecs: dur,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1280x720",
        qualityFps: 60,
        target: "local",
        localHardware: localHostWithGpu,
      });

      const est1080 = estimateJobDuration({
        durationSecs: dur,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1920x1080",
        qualityFps: 60,
        target: "local",
        localHardware: localHostWithGpu,
      });

      const est4k = estimateJobDuration({
        durationSecs: dur,
        preset: "libx264",
        crf: 24,
        qualityResolution: "3840x2160",
        qualityFps: 60,
        target: "local",
        localHardware: localHostWithGpu,
      });

      // 4K has 4x more pixels than 1080p, and ~9x more than 720p
      expect(est4k.compressionSecs).toBeGreaterThan(est1080.compressionSecs * 2.5);
      expect(est1080.compressionSecs).toBeGreaterThan(est720.compressionSecs * 1.5);
      expect(est4k.effectiveFps).toBeLessThan(est1080.effectiveFps);
    });

    it("calculates shorter compression for 30fps than 60fps", () => {
      const dur = 3600;

      const est60 = estimateJobDuration({
        durationSecs: dur,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1920x1080",
        qualityFps: 60,
        target: "local",
        localHardware: localHostWithGpu,
      });

      const est30 = estimateJobDuration({
        durationSecs: dur,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1920x1080",
        qualityFps: 30,
        target: "local",
        localHardware: localHostWithGpu,
      });

      expect(est30.compressionSecs).toBeLessThan(est60.compressionSecs);
      expect(est30.speedMultiplier).toBeGreaterThan(est60.speedMultiplier);
    });

    it("handles passthrough as near-instant disk copy", () => {
      const est = estimateJobDuration({
        durationSecs: 7200, // 2 hour video
        preset: "passthrough",
        crf: 24,
        qualityResolution: "1920x1080",
        target: "local",
        localHardware: localHostWithGpu,
      });

      expect(est.compressionSecs).toBeLessThanOrEqual(60);
      expect(est.speedMultiplier).toBeGreaterThan(50);
    });

    it("shows libx264 is faster than libx265 on the same CPU", () => {
      const estX264 = estimateJobDuration({
        durationSecs: 3600,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1920x1080",
        target: "local",
        localHardware: localHostWithGpu,
      });

      const estX265 = estimateJobDuration({
        durationSecs: 3600,
        preset: "libx265",
        crf: 24,
        qualityResolution: "1920x1080",
        target: "local",
        localHardware: localHostWithGpu,
      });

      expect(estX264.compressionSecs).toBeLessThan(estX265.compressionSecs);
      expect(estX264.effectiveFps).toBeGreaterThan(estX265.effectiveFps * 2.5);
    });

    it("adjusts duration and output size according to CRF", () => {
      const estCrf18 = estimateJobDuration({
        durationSecs: 3600,
        preset: "libx264",
        crf: 18,
        qualityResolution: "1920x1080",
        target: "local",
        localHardware: localHostWithGpu,
      });

      const estCrf28 = estimateJobDuration({
        durationSecs: 3600,
        preset: "libx264",
        crf: 28,
        qualityResolution: "1920x1080",
        target: "local",
        localHardware: localHostWithGpu,
      });

      // Lower CRF (higher quality) is slower to encode and produces larger file
      expect(estCrf18.compressionSecs).toBeGreaterThan(estCrf28.compressionSecs);
      expect(estCrf18.estimatedOutputSizeMB).toBeGreaterThan(estCrf28.estimatedOutputSizeMB);
    });
  });

  describe("estimateJobDuration - Hardware & Fallback Role", () => {
    it("detects hardware fallback when host lacks NVENC", () => {
      const amdLocal: SystemHardwareInfo = {
        cpu_brand: "AMD Ryzen AI 9 365",
        cpu_cores: 20,
        cpu_physical_cores: 10,
        total_memory_mb: 32000,
        gpu_name: "AMD Radeon 880M",
        has_nvenc: false,
        has_amf: true,
        has_qsv: false,
      };

      const est = estimateJobDuration({
        durationSecs: 3600,
        preset: "hevc_nvenc", // Selected NVENC on non-NVIDIA host
        crf: 24,
        qualityResolution: "1920x1080",
        target: "local",
        localHardware: amdLocal,
      });

      expect(est.isHardwareFallback).toBe(true);
      expect(est.fallbackReason).toContain("NVIDIA NVENC");
      // The estimation should use the CPU fallback speed, not NVENC speed
      expect(est.hardwareDescription).toContain("Threads");
    });

    it("uses hardware acceleration when GPU encoder is present", () => {
      const nvidiaLocal: SystemHardwareInfo = {
        cpu_brand: "Intel Core i7-13700K",
        cpu_cores: 24,
        cpu_physical_cores: 16,
        total_memory_mb: 32000,
        gpu_name: "NVIDIA GeForce RTX 4080",
        has_nvenc: true,
        has_amf: false,
        has_qsv: true,
      };

      const est = estimateJobDuration({
        durationSecs: 3600,
        preset: "hevc_nvenc",
        crf: 24,
        qualityResolution: "1920x1080",
        qualityFps: 60,
        target: "local",
        localHardware: nvidiaLocal,
      });

      expect(est.isHardwareFallback).toBe(false);
      expect(est.effectiveFps).toBeGreaterThan(250);
      expect(est.hardwareDescription).toContain("NVIDIA NVENC");
    });

    it("adapts when target is switched to Cloud Worker VPS", () => {
      const workerStatus: WorkerStatus = {
        status: "online",
        version: "0.2.2",
        uptime_secs: 1000,
        cpu_usage_percent: 10,
        memory_total_mb: 8000,
        memory_used_mb: 2000,
        disk_total_gb: 160,
        disk_free_gb: 120,
        storage_max_gb: 100,
        storage_used_gb: 10,
        storage_free_gb: 90,
        ffmpeg_available: true,
        active_jobs_count: 0,
        auto_watcher_enabled: false,
        cpu_cores: 2, // 2-core VPS
        cpu_brand: "QEMU Virtual CPU 2.2GHz",
        has_nvenc: false,
        has_amf: false,
        has_qsv: false,
        has_twitch: true,
        has_s3: true,
        has_gdrive: false,
        has_webdav: false,
      };

      const localHost: SystemHardwareInfo = {
        cpu_brand: "AMD Ryzen AI 9 365",
        cpu_cores: 20,
        cpu_physical_cores: 10,
        total_memory_mb: 32000,
        has_nvenc: false,
        has_amf: false,
        has_qsv: false,
      };

      const estLocal = estimateJobDuration({
        durationSecs: 3600,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1920x1080",
        target: "local",
        localHardware: localHost,
      });

      const estWorker = estimateJobDuration({
        durationSecs: 3600,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1920x1080",
        target: "worker",
        workerStatus,
      });

      // 20-thread local CPU must encode much faster than a 2-core cloud VPS
      expect(estWorker.compressionSecs).toBeGreaterThan(estLocal.compressionSecs * 3);
      expect(estWorker.effectiveFps).toBeLessThan(estLocal.effectiveFps);
    });

    it("includes cloud upload duration when destinations are enabled", () => {
      const localHost: SystemHardwareInfo = {
        cpu_brand: "AMD Ryzen AI 9 365",
        cpu_cores: 20,
        cpu_physical_cores: 10,
        total_memory_mb: 32000,
        has_nvenc: false,
        has_amf: false,
        has_qsv: false,
      };

      const noUpload = estimateJobDuration({
        durationSecs: 3600,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1920x1080",
        target: "local",
        localHardware: localHost,
        destinations: { saveLocal: true, uploadToS3: false },
      });

      const withUpload = estimateJobDuration({
        durationSecs: 3600,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1920x1080",
        target: "local",
        localHardware: localHost,
        destinations: { saveLocal: true, uploadToS3: true, uploadToYouTube: true },
      });

      expect(noUpload.uploadSecs).toBe(0);
      expect(withUpload.uploadSecs).toBeGreaterThan(0);
      expect(withUpload.totalSecs).toBe(
        withUpload.downloadSecs + withUpload.compressionSecs + withUpload.uploadSecs,
      );
    });
  });

  describe("Empirical Calibration & Learning Loop", () => {
    it("learns and calibrates future estimates from recorded telemetry", () => {
      const localHost: SystemHardwareInfo = {
        cpu_brand: "Test CPU",
        cpu_cores: 8,
        cpu_physical_cores: 8,
        total_memory_mb: 16000,
        has_nvenc: false,
        has_amf: false,
        has_qsv: false,
      };

      const initialEst = estimateJobDuration({
        durationSecs: 3600,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1920x1080",
        qualityFps: 60,
        target: "local",
        localHardware: localHost,
      });

      expect(initialEst.isCalibrated).toBe(false);

      // Now simulate a completed job that encoded at a blazing 250 fps (much faster than base model)
      recordEncodingTelemetry({
        target: "local",
        preset: "libx264",
        width: 1920,
        height: 1080,
        fps: 60,
        crf: 24,
        actualFps: 250,
        actualSpeed: 4.16,
        durationSecs: 3600,
      });

      const history = loadEncodingCalibrationHistory();
      expect(history.length).toBe(1);

      // Calculate estimate again - it should now be calibrated and reflect higher speed
      const calibratedEst = estimateJobDuration({
        durationSecs: 3600,
        preset: "libx264",
        crf: 24,
        qualityResolution: "1920x1080",
        qualityFps: 60,
        target: "local",
        localHardware: localHost,
      });

      expect(calibratedEst.isCalibrated).toBe(true);
      expect(calibratedEst.effectiveFps).toBeGreaterThan(initialEst.effectiveFps);
      expect(calibratedEst.compressionSecs).toBeLessThan(initialEst.compressionSecs);
    });
  });
});
