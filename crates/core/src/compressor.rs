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

struct FfmpegExecutionResult {
    fps: f64,
    speed: String,
    total_secs: f64,
    size_bytes: u64,
}

enum FfmpegExecutionError {
    Cancelled,
    Failed {
        status_code: Option<i32>,
        command_args: Vec<String>,
        stderr_lines: Vec<String>,
        is_nvenc_failure: bool,
    },
    Io(AppError),
}

fn format_ffmpeg_failure_error(
    vod_id: &str,
    reporter: &dyn crate::reporter::ProgressReporter,
    status_code: Option<i32>,
    command_args: &[String],
    stderr_lines: &[String],
) -> AppError {
    let stderr_tail = if stderr_lines.is_empty() {
        "No stderr output captured from ffmpeg".to_string()
    } else {
        let count = stderr_lines.len().min(30);
        stderr_lines[stderr_lines.len() - count..].join("\n")
    };

    let full_error_msg = format!(
        "FFmpeg exited with non-zero status: {:?}\nCommand: ffmpeg {}\nOutput:\n{}",
        status_code,
        command_args.join(" "),
        stderr_tail
    );

    reporter.report_log(
        vod_id,
        &format!("❌ FFmpeg compression failed (exit {:?}):\n{}", status_code, stderr_tail),
    );

    AppError::Compression(full_error_msg)
}

#[allow(clippy::too_many_arguments)]
async fn run_ffmpeg_compress_once(
    reporter: DynReporter,
    vod_id: &str,
    concat_list_path: &Path,
    output_mp4_path: &Path,
    preset: &str,
    crf: u8,
    estimated_duration_secs: Option<f64>,
    trim_start_secs: Option<f64>,
    trim_duration_secs: Option<f64>,
    is_cancelled: Arc<AtomicBool>,
) -> Result<FfmpegExecutionResult, FfmpegExecutionError> {
    if let Some(parent) = output_mp4_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| FfmpegExecutionError::Io(e.into()))?;
    }

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        concat_list_path.to_string_lossy().to_string(),
    ];

    if let Some(ss) = trim_start_secs {
        if ss > 0.05 {
            args.push("-ss".into());
            args.push(format!("{:.3}", ss));
        }
    }
    if let Some(dur) = trim_duration_secs {
        args.push("-t".into());
        args.push(format!("{:.3}", dur));
    }

    match preset {
        "passthrough" => {
            args.push("-c".into());
            args.push("copy".into());
        }
        "hevc_nvenc" => {
            args.extend_from_slice(&[
                "-c:v".into(),
                "hevc_nvenc".into(),
                "-preset".into(),
                "p5".into(),
                "-cq".into(),
                crf.to_string(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "160k".into(),
            ]);
        }
        "hevc_amf" => {
            args.extend_from_slice(&[
                "-c:v".into(),
                "hevc_amf".into(),
                "-quality".into(),
                "quality".into(),
                "-rc".into(),
                "cqp".into(),
                "-qp_p".into(),
                crf.to_string(),
                "-qp_i".into(),
                crf.to_string(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "160k".into(),
            ]);
        }
        "hevc_qsv" => {
            args.extend_from_slice(&[
                "-c:v".into(),
                "hevc_qsv".into(),
                "-preset".into(),
                "medium".into(),
                "-global_quality".into(),
                crf.to_string(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "160k".into(),
            ]);
        }
        "libx265" => {
            args.extend_from_slice(&[
                "-c:v".into(),
                "libx265".into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                crf.to_string(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "160k".into(),
            ]);
        }
        _ => {
            // default libx264
            args.extend_from_slice(&[
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "fast".into(),
                "-crf".into(),
                crf.to_string(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "160k".into(),
            ]);
        }
    }

    // Fast-start MP4 container for web & cloud streaming
    args.push("-movflags".into());
    args.push("+faststart".into());

    // Output progress to stdout pipe
    args.push("-progress".into());
    args.push("pipe:1".into());
    args.push("-nostats".into());
    args.push(output_mp4_path.to_string_lossy().to_string());

    reporter.report_log(
        vod_id,
        &format!("Starting FFmpeg: preset={}, crf={}, command: ffmpeg {}", preset, crf, args.join(" ")),
    );

    let mut cmd = Command::new("ffmpeg");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd.args(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| FfmpegExecutionError::Io(AppError::Compression(format!("Failed to spawn ffmpeg: {}", e))))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| FfmpegExecutionError::Io(AppError::Compression("Failed to capture ffmpeg stdout".to_string())))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| FfmpegExecutionError::Io(AppError::Compression("Failed to capture ffmpeg stderr".to_string())))?;

    // Drain stderr asynchronously into a rolling ring buffer
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut ring = std::collections::VecDeque::with_capacity(120);
        while let Ok(Some(line)) = reader.next_line().await {
            let line = line.trim();
            if !line.is_empty() {
                if ring.len() >= 100 {
                    ring.pop_front();
                }
                ring.push_back(line.to_string());
            }
        }
        ring.into_iter().collect::<Vec<String>>()
    });

    let mut reader = BufReader::new(stdout).lines();
    let total_secs = trim_duration_secs.or(estimated_duration_secs).unwrap_or(0.0);

    let mut current_fps = 0.0;
    let mut current_speed = "0x".to_string();
    let mut current_time_secs = 0.0;
    let mut current_size = 0u64;
    let mut last_progress_log = 0.0;

    while let Ok(Some(line)) = reader.next_line().await {
        if is_cancelled.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            stderr_task.abort();
            return Err(FfmpegExecutionError::Cancelled);
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

                    let speed_mult = current_speed
                        .trim_end_matches('x')
                        .trim()
                        .parse::<f64>()
                        .unwrap_or(0.0);

                    let eta_seconds = if speed_mult > 0.05 && total_secs > current_time_secs {
                        ((total_secs - current_time_secs) / speed_mult).max(0.0) as u64
                    } else {
                        0
                    };

                    reporter.report_compression(&CompressionProgress {
                        vod_id: vod_id.to_string(),
                        percent,
                        current_time_secs,
                        fps: current_fps,
                        speed: current_speed.clone(),
                        size_bytes: current_size,
                        eta_seconds,
                    });

                    // Log milestone progress every 20%
                    if percent >= last_progress_log + 20.0 && percent < 99.0 {
                        last_progress_log = (percent / 20.0).floor() * 20.0;
                        reporter.report_log(
                            vod_id,
                            &format!(
                                "Encoding progress: {:.1}% (speed: {}, fps: {:.0}, encoded: {:.0}s / {:.0}s, ETA: {}s)",
                                percent, current_speed, current_fps, current_time_secs, total_secs, eta_seconds
                            ),
                        );
                    }
                }
                _ => {}
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| FfmpegExecutionError::Io(e.into()))?;

    let stderr_lines = match tokio::time::timeout(std::time::Duration::from_secs(3), stderr_task).await {
        Ok(Ok(lines)) => lines,
        _ => Vec::new(),
    };

    if !status.success() {
        let is_hw_failure = is_hardware_failure_output(preset, &stderr_lines);

        return Err(FfmpegExecutionError::Failed {
            status_code: status.code(),
            command_args: args,
            stderr_lines,
            is_nvenc_failure: is_hw_failure,
        });
    }

    Ok(FfmpegExecutionResult {
        fps: current_fps,
        speed: current_speed,
        total_secs,
        size_bytes: current_size,
    })
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
    trim_start_secs: Option<f64>,
    trim_duration_secs: Option<f64>,
    is_cancelled: Arc<AtomicBool>,
) -> Result<(), AppError> {
    let mut current_preset = preset.to_string();

    let res = match run_ffmpeg_compress_once(
        reporter.clone(),
        vod_id,
        concat_list_path,
        output_mp4_path,
        &current_preset,
        crf,
        estimated_duration_secs,
        trim_start_secs,
        trim_duration_secs,
        is_cancelled.clone(),
    )
    .await
    {
        Ok(res) => Ok(res),
        Err(FfmpegExecutionError::Cancelled) => Err(AppError::Cancelled),
        Err(FfmpegExecutionError::Io(e)) => Err(e),
        Err(FfmpegExecutionError::Failed {
            status_code,
            command_args,
            stderr_lines,
            is_nvenc_failure,
        }) => {
            if is_nvenc_failure {
                let tail_err = stderr_lines
                    .iter()
                    .rev()
                    .find(|l| {
                        let s = l.to_lowercase();
                        s.contains("nvenc")
                            || s.contains("cuda")
                            || s.contains("amf")
                            || s.contains("qsv")
                            || s.contains("driver")
                            || s.contains("encoder")
                    })
                    .cloned()
                    .unwrap_or_else(|| format!("Host lacks compatible GPU or drivers for '{}'", current_preset));

                reporter.report_log(
                    vod_id,
                    &format!(
                        "⚠️ Hardware encoder '{}' failed: {}\nHost lacks compatible GPU or hardware encoder drivers.",
                        current_preset, tail_err
                    ),
                );
                reporter.report_log(
                    vod_id,
                    "🔄 Automatically falling back to software CPU encoder (libx264, preset=fast)...",
                );

                current_preset = "libx264".to_string();
                run_ffmpeg_compress_once(
                    reporter.clone(),
                    vod_id,
                    concat_list_path,
                    output_mp4_path,
                    &current_preset,
                    crf,
                    estimated_duration_secs,
                    trim_start_secs,
                    trim_duration_secs,
                    is_cancelled.clone(),
                )
                .await
                .map_err(|e| match e {
                    FfmpegExecutionError::Cancelled => AppError::Cancelled,
                    FfmpegExecutionError::Io(err) => err,
                    FfmpegExecutionError::Failed {
                        status_code,
                        command_args,
                        stderr_lines,
                        ..
                    } => format_ffmpeg_failure_error(
                        vod_id,
                        reporter.as_ref(),
                        status_code,
                        &command_args,
                        &stderr_lines,
                    ),
                })
            } else {
                Err(format_ffmpeg_failure_error(
                    vod_id,
                    reporter.as_ref(),
                    status_code,
                    &command_args,
                    &stderr_lines,
                ))
            }
        }
    }?;

    reporter.report_log(
        vod_id,
        &format!(
            "FFmpeg compression finished successfully! Size: {:.2} MB",
            res.size_bytes as f64 / 1_000_000.0
        ),
    );

    // Emit final 100% progress
    reporter.report_compression(&CompressionProgress {
        vod_id: vod_id.to_string(),
        percent: 100.0,
        current_time_secs: res.total_secs,
        fps: res.fps,
        speed: res.speed,
        size_bytes: res.size_bytes,
        eta_seconds: 0,
    });

    Ok(())
}

pub fn is_hardware_failure_output(preset: &str, stderr_lines: &[String]) -> bool {
    match preset {
        "hevc_nvenc" => is_nvenc_failure_output(preset, stderr_lines),
        "hevc_amf" => stderr_lines.iter().any(|l| {
            let s = l.to_lowercase();
            s.contains("amf")
                || s.contains("failed to initialize amf")
                || s.contains("amf_error")
                || s.contains("unknown encoder 'hevc_amf'")
        }),
        "hevc_qsv" => stderr_lines.iter().any(|l| {
            let s = l.to_lowercase();
            s.contains("qsv")
                || s.contains("libmfx")
                || s.contains("mfx")
                || s.contains("error creating session")
                || s.contains("unknown encoder 'hevc_qsv'")
        }),
        _ => false,
    }
}

pub fn is_nvenc_failure_output(preset: &str, stderr_lines: &[String]) -> bool {
    preset == "hevc_nvenc"
        && stderr_lines.iter().any(|l| {
            let s = l.to_lowercase();
            s.contains("nvenc")
                || s.contains("cuda")
                || s.contains("nvcuda")
                || s.contains("cannot load libcuda")
                || s.contains("no nvenc capable")
                || s.contains("driver does not support")
                || s.contains("unknown encoder 'hevc_nvenc'")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reporter::ProgressReporter;

    struct DummyReporter;
    impl ProgressReporter for DummyReporter {}

    #[test]
    fn test_is_nvenc_failure_detection() {
        let lines = vec![
            "ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers".to_string(),
            "[hevc_nvenc @ 0x55555] Cannot load libcuda.so.1".to_string(),
            "Error initializing output stream 0:0 -- Error while opening encoder for output stream #0:0 - maybe incorrect parameters such as bit_rate, rate, width or height".to_string(),
        ];
        assert!(is_nvenc_failure_output("hevc_nvenc", &lines));

        // When preset is not hevc_nvenc, should not trigger nvenc fallback
        assert!(!is_nvenc_failure_output("libx264", &lines));

        // When stderr doesn't mention nvenc/cuda, should not trigger
        let normal_err = vec!["No such file or directory: concat_list.txt".to_string()];
        assert!(!is_nvenc_failure_output("hevc_nvenc", &normal_err));

        // Test AMF and QSV failure detection
        let amf_err = vec!["[hevc_amf @ 0x123] Failed to initialize AMF.".to_string()];
        assert!(is_hardware_failure_output("hevc_amf", &amf_err));
        assert!(!is_hardware_failure_output("hevc_nvenc", &amf_err));

        let qsv_err = vec!["[hevc_qsv @ 0x123] Error creating session: libmfx not found".to_string()];
        assert!(is_hardware_failure_output("hevc_qsv", &qsv_err));
        assert!(!is_hardware_failure_output("hevc_amf", &qsv_err));
    }

    #[test]
    fn test_format_ffmpeg_failure_error() {
        let reporter = DummyReporter;
        let args = vec!["-y".to_string(), "-i".to_string(), "input.ts".to_string()];
        let stderr = vec![
            "Header line 1".to_string(),
            "Error: Invalid data found when processing input".to_string(),
        ];

        let err = format_ffmpeg_failure_error("12345", &reporter, Some(1), &args, &stderr);
        let msg = err.to_string();

        assert!(msg.contains("FFmpeg exited with non-zero status: Some(1)"));
        assert!(msg.contains("Command: ffmpeg -y -i input.ts"));
        assert!(msg.contains("Error: Invalid data found when processing input"));
    }
}
