use crate::error::AppError;
use crate::reporter::{CompressionProgress, DynReporter};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FfmpegInfo {
    pub available: bool,
    pub path: String,
    pub version: String,
    pub has_nvenc: bool,
    pub has_qsv: bool,
    pub has_amf: bool,
}

pub async fn detect_ffmpeg() -> FfmpegInfo {
    let mut cmd = Command::new("ffmpeg");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = match cmd.arg("-encoders").output().await {
        Ok(out) => out,
        Err(_) => {
            return FfmpegInfo {
                available: false,
                path: String::new(),
                version: String::new(),
                has_nvenc: false,
                has_qsv: false,
                has_amf: false,
            }
        }
    };

    let text = String::from_utf8_lossy(&output.stdout);
    let has_nvenc = text.contains("hevc_nvenc") || text.contains("h264_nvenc");
    let has_qsv = text.contains("hevc_qsv") || text.contains("h264_qsv");
    let has_amf = text.contains("hevc_amf") || text.contains("h264_amf");

    FfmpegInfo {
        available: true,
        path: "ffmpeg".to_string(),
        version: "installed".to_string(),
        has_nvenc,
        has_qsv,
        has_amf,
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn compress_vod(
    reporter: DynReporter,
    vod_id: &str,
    concat_list_path: &Path,
    output_mp4_path: &Path,
    preset: &str,
    crf: u8,
    estimated_duration_secs: Option<f64>,
    is_cancelled: Arc<AtomicBool>,
) -> Result<(), AppError> {
    if let Some(parent) = output_mp4_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let mut cmd = Command::new("ffmpeg");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    cmd.arg("-y")
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(concat_list_path);

    match preset {
        "passthrough" => {
            cmd.arg("-c").arg("copy");
        }
        "hevc_nvenc" => {
            cmd.arg("-c:v")
                .arg("hevc_nvenc")
                .arg("-preset")
                .arg("p5")
                .arg("-cq")
                .arg(crf.to_string())
                .arg("-c:a")
                .arg("aac")
                .arg("-b:a")
                .arg("160k");
        }
        "libx265" => {
            cmd.arg("-c:v")
                .arg("libx265")
                .arg("-preset")
                .arg("medium")
                .arg("-crf")
                .arg(crf.to_string())
                .arg("-c:a")
                .arg("aac")
                .arg("-b:a")
                .arg("160k");
        }
        _ => {
            // default libx264
            cmd.arg("-c:v")
                .arg("libx264")
                .arg("-preset")
                .arg("fast")
                .arg("-crf")
                .arg(crf.to_string())
                .arg("-c:a")
                .arg("aac")
                .arg("-b:a")
                .arg("160k");
        }
    }

    // Fast-start MP4 container for web & cloud streaming
    cmd.arg("-movflags").arg("+faststart");

    // Output progress to stdout pipe
    cmd.arg("-progress")
        .arg("pipe:1")
        .arg("-nostats")
        .arg(output_mp4_path);

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Compression(format!("Failed to spawn ffmpeg: {}", e)))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Compression("Failed to capture ffmpeg stdout".to_string()))?;

    let mut reader = BufReader::new(stdout).lines();
    let total_secs = estimated_duration_secs.unwrap_or(0.0);

    let mut current_fps = 0.0;
    let mut current_speed = "0x".to_string();
    let mut current_time_secs = 0.0;
    let mut current_size = 0u64;

    while let Ok(Some(line)) = reader.next_line().await {
        if is_cancelled.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            return Err(AppError::Cancelled);
        }

        let line = line.trim();
        if let Some((key, val)) = line.split_once('=') {
            match key {
                "fps" => {
                    if let Ok(f) = val.parse::<f64>() {
                        current_fps = f;
                    }
                }
                "speed" => {
                    current_speed = val.to_string();
                }
                "total_size" => {
                    if let Ok(s) = val.parse::<u64>() {
                        current_size = s;
                    }
                }
                "out_time_us" => {
                    if let Ok(us) = val.parse::<i64>() {
                        current_time_secs = us as f64 / 1_000_000.0;
                    }
                }
                "progress" => {
                    let percent = if total_secs > 0.0 {
                        ((current_time_secs / total_secs) * 100.0).clamp(0.0, 100.0)
                    } else {
                        0.0
                    };

                    reporter.report_compression(&CompressionProgress {
                        vod_id: vod_id.to_string(),
                        percent,
                        current_time_secs,
                        fps: current_fps,
                        speed: current_speed.clone(),
                        size_bytes: current_size,
                    });
                }
                _ => {}
            }
        }
    }

    let status = child.wait().await?;
    if !status.success() {
        return Err(AppError::Compression(format!(
            "ffmpeg exited with non-zero status: {:?}",
            status.code()
        )));
    }

    // Emit final 100% progress
    reporter.report_compression(&CompressionProgress {
        vod_id: vod_id.to_string(),
        percent: 100.0,
        current_time_secs: total_secs,
        fps: current_fps,
        speed: current_speed,
        size_bytes: current_size,
    });

    Ok(())
}
