use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct CompressionProgress {
    pub vod_id: String,
    pub percent: f64,
    pub current_time_secs: f64,
    pub fps: f64,
    pub speed: String,
    pub size_bytes: u64,
    pub eta_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FfmpegInfo {
    pub available: bool,
    pub path: String,
    pub version: String,
    pub has_nvenc: bool,
    pub has_qsv: bool,
    pub has_amf: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemHardwareInfo {
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub cpu_physical_cores: usize,
    pub total_memory_mb: u64,
    pub gpu_name: Option<String>,
    pub has_nvenc: bool,
    pub has_qsv: bool,
    pub has_amf: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolDownloadProgress {
    pub tool: String,
    pub stage: String, // "downloading", "extracting", "verifying", "done", "error"
    pub percent: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub message: String,
}

pub fn get_app_tools_bin_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    use tauri::Manager;
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string())))?;
    let bin_dir = app_data.join("tools").join("bin");
    if !bin_dir.exists() {
        let _ = std::fs::create_dir_all(&bin_dir);
    }
    Ok(bin_dir)
}

pub async fn resolve_ffmpeg_path(app_handle: Option<&tauri::AppHandle>, custom_path: Option<&str>) -> String {
    if let Some(p) = custom_path {
        let trimmed = p.trim();
        if !trimmed.is_empty() && Path::new(trimmed).exists() {
            return trimmed.to_string();
        }
    }

    if let Some(app) = app_handle {
        if let Ok(bin_dir) = get_app_tools_bin_dir(app) {
            #[cfg(windows)]
            let local_exe = bin_dir.join("ffmpeg.exe");
            #[cfg(not(windows))]
            let local_exe = bin_dir.join("ffmpeg");

            if local_exe.exists() {
                return local_exe.to_string_lossy().to_string();
            }
        }
    }

    "ffmpeg".to_string()
}

pub async fn detect_ffmpeg(custom_path: Option<&str>, app_handle: Option<&tauri::AppHandle>) -> FfmpegInfo {
    let mut candidates = Vec::new();

    if let Some(cp) = custom_path {
        let trimmed = cp.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed));
        }
    }

    if let Some(app) = app_handle {
        if let Ok(bin_dir) = get_app_tools_bin_dir(app) {
            #[cfg(windows)]
            candidates.push(bin_dir.join("ffmpeg.exe"));
            #[cfg(not(windows))]
            candidates.push(bin_dir.join("ffmpeg"));
        }
    }

    candidates.push(PathBuf::from("ffmpeg"));

    for candidate in candidates {
        let mut cmd = Command::new(&candidate);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        let output = match cmd.arg("-encoders").output().await {
            Ok(out) if out.status.success() || !out.stdout.is_empty() => out,
            _ => continue,
        };

        let text = String::from_utf8_lossy(&output.stdout);
        let has_nvenc = text.contains("hevc_nvenc") || text.contains("h264_nvenc");
        let has_qsv = text.contains("hevc_qsv") || text.contains("h264_qsv");
        let has_amf = text.contains("hevc_amf") || text.contains("h264_amf");

        // Fetch version string
        let mut ver_cmd = Command::new(&candidate);
        #[cfg(windows)]
        ver_cmd.creation_flags(0x08000000);
        let version_str = match ver_cmd.arg("-version").output().await {
            Ok(vout) => {
                let vtext = String::from_utf8_lossy(&vout.stdout);
                vtext
                    .lines()
                    .next()
                    .unwrap_or("FFmpeg")
                    .trim()
                    .to_string()
            }
            Err(_) => "FFmpeg".to_string(),
        };

        let resolved_path = candidate.to_string_lossy().to_string();

        return FfmpegInfo {
            available: true,
            path: resolved_path,
            version: version_str,
            has_nvenc,
            has_qsv,
            has_amf,
        };
    }

    FfmpegInfo {
        available: false,
        path: String::new(),
        version: String::new(),
        has_nvenc: false,
        has_qsv: false,
        has_amf: false,
    }
}

fn detect_gpu_name() -> Option<String> {
    #[cfg(windows)]
    {
        for index in ["0000", "0001", "0002"] {
            let key = format!(
                r"HKLM\SYSTEM\CurrentControlSet\Control\Class\{{4d36e968-e325-11ce-bfc1-08002be10318}}\{}",
                index
            );
            let mut cmd = std::process::Command::new("reg");
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            if let Ok(output) = cmd.args(["query", &key, "/v", "DriverDesc"]).output() {
                if output.status.success() {
                    let text = String::from_utf8_lossy(&output.stdout);
                    for line in text.lines() {
                        if line.contains("DriverDesc") {
                            if let Some(desc) = line.split("REG_SZ").nth(1) {
                                let trimmed = desc.trim();
                                if !trimmed.is_empty() {
                                    return Some(trimmed.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

pub async fn detect_system_hardware(
    custom_ffmpeg_path: Option<&str>,
    app_handle: Option<&tauri::AppHandle>,
) -> SystemHardwareInfo {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_cpu_specifics(sysinfo::CpuRefreshKind::everything());
    sys.refresh_memory();

    let cpu_cores = sys.cpus().len().max(1);
    let cpu_physical_cores = sys.physical_core_count().unwrap_or(cpu_cores).max(1);
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());
    let total_memory_mb = sys.total_memory() / (1024 * 1024);

    let ffmpeg_info = detect_ffmpeg(custom_ffmpeg_path, app_handle).await;
    let gpu_name = detect_gpu_name();

    SystemHardwareInfo {
        cpu_brand,
        cpu_cores,
        cpu_physical_cores,
        total_memory_mb,
        gpu_name,
        has_nvenc: ffmpeg_info.has_nvenc,
        has_qsv: ffmpeg_info.has_qsv,
        has_amf: ffmpeg_info.has_amf,
    }
}

pub async fn download_and_install_ffmpeg(app_handle: &tauri::AppHandle) -> Result<FfmpegInfo, AppError> {
    let emit_progress = |stage: &str, percent: f64, downloaded: u64, total: u64, message: &str| {
        let _ = app_handle.emit(
            "tool-download-progress",
            ToolDownloadProgress {
                tool: "ffmpeg".to_string(),
                stage: stage.to_string(),
                percent,
                downloaded_bytes: downloaded,
                total_bytes: total,
                message: message.to_string(),
            },
        );
    };

    emit_progress("downloading", 0.0, 0, 0, "Connecting to download server...");

    let tools_bin_dir = get_app_tools_bin_dir(app_handle)?;
    let temp_dir = std::env::temp_dir().join("twitch_vod_manager_ffmpeg_setup");
    let _ = tokio::fs::create_dir_all(&temp_dir).await;

    // Reliable official builds
    let download_url = "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip";
    let zip_dest = temp_dir.join("ffmpeg.zip");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()?;

    let response = client
        .get(download_url)
        .header("User-Agent", "TwitchVODManager/0.1.0")
        .send()
        .await
        .map_err(|e| AppError::Network(e))?;

    if !response.status().is_success() {
        emit_progress("error", 0.0, 0, 0, &format!("Server returned HTTP {}", response.status()));
        return Err(AppError::Download(format!("Download failed with status {}", response.status())));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(&zip_dest).await?;
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| AppError::Network(e))?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        let percent = if total_size > 0 {
            ((downloaded as f64 / total_size as f64) * 100.0).clamp(0.0, 99.0)
        } else {
            0.0
        };

        let mb_dl = downloaded as f64 / 1_048_576.0;
        let mb_tot = total_size as f64 / 1_048_576.0;
        let msg = if total_size > 0 {
            format!("Downloading FFmpeg: {:.1} MB / {:.1} MB ({:.0}%)", mb_dl, mb_tot, percent)
        } else {
            format!("Downloading FFmpeg: {:.1} MB...", mb_dl)
        };

        emit_progress("downloading", percent, downloaded, total_size, &msg);
    }
    file.flush().await?;
    drop(file);

    emit_progress("extracting", 100.0, downloaded, total_size, "Extracting FFmpeg binaries...");

    // Extract using native Windows tar.exe which extracts .zip cleanly and fast
    let extract_dir = temp_dir.join("extracted");
    let _ = tokio::fs::create_dir_all(&extract_dir).await;

    let mut tar_cmd = Command::new("tar.exe");
    #[cfg(windows)]
    tar_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    tar_cmd
        .arg("-xf")
        .arg(&zip_dest)
        .arg("-C")
        .arg(&extract_dir);

    let tar_status = tar_cmd.status().await;
    let extraction_ok = match tar_status {
        Ok(s) if s.success() => true,
        _ => {
            // Fallback to powershell Expand-Archive if tar fails
            let mut ps_cmd = Command::new("powershell.exe");
            #[cfg(windows)]
            ps_cmd.creation_flags(0x08000000);
            ps_cmd
                .arg("-NoProfile")
                .arg("-Command")
                .arg(format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                    zip_dest.to_string_lossy(),
                    extract_dir.to_string_lossy()
                ));
            match ps_cmd.status().await {
                Ok(s) => s.success(),
                Err(_) => false,
            }
        }
    };

    if !extraction_ok {
        emit_progress("error", 0.0, 0, 0, "Failed to extract FFmpeg zip archive.");
        return Err(AppError::Compression("Failed to extract FFmpeg archive".to_string()));
    }

    emit_progress("configuring", 100.0, downloaded, total_size, "Installing binaries into app tools directory...");

    // Find ffmpeg.exe and ffprobe.exe in the extracted folder hierarchy
    let mut found_ffmpeg: Option<PathBuf> = None;
    let mut found_ffprobe: Option<PathBuf> = None;

    fn walk_find(dir: &Path, ffmpeg: &mut Option<PathBuf>, ffprobe: &mut Option<PathBuf>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    walk_find(&p, ffmpeg, ffprobe);
                } else if let Some(file_name) = p.file_name().and_then(|f| f.to_str()) {
                    if file_name.eq_ignore_ascii_case("ffmpeg.exe") || file_name == "ffmpeg" {
                        *ffmpeg = Some(p.clone());
                    } else if file_name.eq_ignore_ascii_case("ffprobe.exe") || file_name == "ffprobe" {
                        *ffprobe = Some(p.clone());
                    }
                }
            }
        }
    }

    walk_find(&extract_dir, &mut found_ffmpeg, &mut found_ffprobe);

    let src_ffmpeg = found_ffmpeg.ok_or_else(|| {
        AppError::Compression("ffmpeg binary not found in extracted archive".to_string())
    })?;

    #[cfg(windows)]
    let target_ffmpeg = tools_bin_dir.join("ffmpeg.exe");
    #[cfg(not(windows))]
    let target_ffmpeg = tools_bin_dir.join("ffmpeg");

    let _ = tokio::fs::copy(&src_ffmpeg, &target_ffmpeg).await?;

    if let Some(src_probe) = found_ffprobe {
        #[cfg(windows)]
        let target_probe = tools_bin_dir.join("ffprobe.exe");
        #[cfg(not(windows))]
        let target_probe = tools_bin_dir.join("ffprobe");
        let _ = tokio::fs::copy(&src_probe, &target_probe).await;
    }

    // Clean up temporary download directory in background
    let _ = tokio::fs::remove_dir_all(&temp_dir).await;

    emit_progress("verifying", 100.0, downloaded, total_size, "Verifying FFmpeg installation...");

    let info = detect_ffmpeg(Some(&target_ffmpeg.to_string_lossy()), Some(app_handle)).await;

    if info.available {
        emit_progress("done", 100.0, downloaded, total_size, "FFmpeg successfully installed and ready!");
        Ok(info)
    } else {
        emit_progress("error", 0.0, 0, 0, "Installed binary could not be verified.");
        Err(AppError::Compression("Installed FFmpeg could not be verified".to_string()))
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn compress_vod(
    app: &tauri::AppHandle,
    vod_id: &str,
    concat_list_path: &Path,
    output_mp4_path: &Path,
    preset: &str,
    crf: u8,
    estimated_duration_secs: Option<f64>,
    custom_ffmpeg_path: Option<&str>,
    is_cancelled: Arc<AtomicBool>,
) -> Result<(), AppError> {
    if let Some(parent) = output_mp4_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let ffmpeg_bin = resolve_ffmpeg_path(Some(app), custom_ffmpeg_path).await;
    let mut cmd = Command::new(&ffmpeg_bin);
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
        "hevc_amf" => {
            cmd.arg("-c:v")
                .arg("hevc_amf")
                .arg("-quality")
                .arg("quality")
                .arg("-rc")
                .arg("cqp")
                .arg("-qp_p")
                .arg(crf.to_string())
                .arg("-qp_i")
                .arg(crf.to_string())
                .arg("-c:a")
                .arg("aac")
                .arg("-b:a")
                .arg("160k");
        }
        "hevc_qsv" => {
            cmd.arg("-c:v")
                .arg("hevc_qsv")
                .arg("-preset")
                .arg("medium")
                .arg("-global_quality")
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
        .map_err(|e| AppError::Compression(format!("Failed to spawn ffmpeg (using '{}'): {}", ffmpeg_bin, e)))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Compression("Failed to capture ffmpeg stdout".to_string()))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Compression("Failed to capture ffmpeg stderr".to_string()))?;

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
    let total_secs = estimated_duration_secs.unwrap_or(0.0);

    let mut current_fps = 0.0;
    let mut current_speed = "0x".to_string();
    let mut current_time_secs = 0.0;
    let mut current_size = 0u64;

    while let Ok(Some(line)) = reader.next_line().await {
        if is_cancelled.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            stderr_task.abort();
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

                    let _ = app.emit(
                        "compression-progress",
                        CompressionProgress {
                            vod_id: vod_id.to_string(),
                            percent,
                            current_time_secs,
                            fps: current_fps,
                            speed: current_speed.clone(),
                            size_bytes: current_size,
                            eta_seconds,
                        },
                    );
                }
                _ => {}
            }
        }
    }

    let status = child.wait().await?;
    let stderr_lines = match tokio::time::timeout(std::time::Duration::from_secs(3), stderr_task).await {
        Ok(Ok(lines)) => lines,
        _ => Vec::new(),
    };

    if !status.success() {
        let stderr_tail = if stderr_lines.is_empty() {
            "No stderr output captured from ffmpeg".to_string()
        } else {
            let count = stderr_lines.len().min(30);
            stderr_lines[stderr_lines.len() - count..].join("\n")
        };

        return Err(AppError::Compression(format!(
            "ffmpeg exited with non-zero status: {:?}\nRecent output:\n{}",
            status.code(),
            stderr_tail
        )));
    }

    // Emit final 100% progress
    let _ = app.emit(
        "compression-progress",
        CompressionProgress {
            vod_id: vod_id.to_string(),
            percent: 100.0,
            current_time_secs: total_secs,
            fps: current_fps,
            speed: current_speed,
            size_bytes: current_size,
            eta_seconds: 0,
        },
    );

    Ok(())
}
