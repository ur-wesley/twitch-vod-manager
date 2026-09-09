use crate::error::AppError;
use crate::reporter::DynReporter;
use crate::storage_gdrive::{upload_vod_to_gdrive, GDriveCredentials};
use crate::storage_s3::{upload_vod_to_s3, S3Credentials};
use crate::storage_webdav::{upload_vod_to_webdav, WebDavCredentials};
use crate::youtube::{
    resolve_youtube_credentials, upload_video_to_youtube, validate_youtube_credentials,
    YouTubeCredentials, YouTubeVideoMetadata,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineConfig {
    pub vod_id: String,
    pub playlist_url: String,
    pub preset: String,
    pub crf: u8,
    pub duration_secs: Option<f64>,
    pub start_secs: Option<f64>,
    pub end_secs: Option<f64>,

    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub vod_date: Option<String>,
    #[serde(default)]
    pub custom_filename: Option<String>,

    // Configurable action destinations
    pub save_local: bool,
    pub local_output_dir: Option<String>,

    pub upload_to_s3: bool,
    pub s3_config: Option<S3Credentials>,

    pub upload_to_gdrive: bool,
    pub gdrive_config: Option<GDriveCredentials>,

    pub upload_to_webdav: bool,
    pub webdav_config: Option<WebDavCredentials>,

    pub upload_to_youtube: bool,
    pub youtube_token: Option<String>,
    #[serde(default)]
    pub youtube_refresh_token: Option<String>,
    #[serde(default)]
    pub youtube_client_id: Option<String>,
    #[serde(default)]
    pub youtube_client_secret: Option<String>,
    pub youtube_metadata: Option<YouTubeVideoMetadata>,

    // Twitch VOD management
    pub delete_from_twitch_after: bool,
    pub twitch_client_id: Option<String>,
    pub twitch_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineResult {
    pub vod_id: String,
    pub local_path: Option<String>,
    pub s3_key: Option<String>,
    pub gdrive_file_id: Option<String>,
    pub gdrive_view_url: Option<String>,
    pub webdav_path: Option<String>,
    pub youtube_video_id: Option<String>,
    pub deleted_from_twitch: bool,
}

pub async fn run_archive_pipeline(
    reporter: DynReporter,
    config: PipelineConfig,
    temp_dir_override: Option<PathBuf>,
    is_cancelled: Arc<AtomicBool>,
) -> Result<PipelineResult, AppError> {
    if is_cancelled.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }

    let vod_id = &config.vod_id;
    reporter.report_log(vod_id, &format!("Initializing pipeline for VOD #{}", vod_id));

    // Determine temporary working directory for chunks
    let work_dir = if let Some(t) = temp_dir_override {
        t.join(format!("vod_{}", vod_id))
    } else {
        std::env::temp_dir().join(format!("twitch_vod_{}", vod_id))
    };

    tokio::fs::create_dir_all(&work_dir).await?;

    let compressed_mp4 = work_dir.join(format!("vod_{}.mp4", vod_id));

    // 1. Download chunks
    reporter.report_stage(vod_id, "downloading", "Downloading video chunks from Twitch CDN...");
    reporter.report_log(vod_id, "Starting chunk download...");

    let download_res = match crate::downloader::download_vod_chunks(
        reporter.clone(),
        vod_id,
        &config.playlist_url,
        &work_dir,
        config.start_secs,
        config.end_secs,
        is_cancelled.clone(),
    )
    .await
    {
        Ok(res) => res,
        Err(e) => {
            reporter.report_log(vod_id, &format!("❌ Chunk download failed: {}", e));
            let _ = tokio::fs::remove_dir_all(&work_dir).await;
            return Err(e);
        }
    };

    if is_cancelled.load(Ordering::Relaxed) {
        reporter.report_log(vod_id, "⚠️ Pipeline cancelled after chunk download.");
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return Err(AppError::Cancelled);
    }

    // 2. Compress via FFmpeg
    reporter.report_stage(vod_id, "compressing", "Compressing video with FFmpeg...");

    let effective_duration = download_res.trim_duration.or(config.duration_secs);

    if let Err(e) = crate::compressor::compress_vod(
        reporter.clone(),
        vod_id,
        &download_res.concat_file_path,
        &compressed_mp4,
        &config.preset,
        config.crf,
        effective_duration,
        download_res.trim_start_offset,
        download_res.trim_duration,
        is_cancelled.clone(),
    )
    .await
    {
        reporter.report_log(vod_id, &format!("❌ Compression stage failed: {}", e));
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return Err(e);
    }

    // Clean up temporary chunks folder immediately to free disk space
    let chunks_dir = work_dir.join("chunks");
    let _ = tokio::fs::remove_dir_all(&chunks_dir).await;
    let _ = tokio::fs::remove_file(&download_res.concat_file_path).await;
    reporter.report_log(vod_id, "Cleaned up temporary chunk files to conserve disk space.");

    if is_cancelled.load(Ordering::Relaxed) {
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
        return Err(AppError::Cancelled);
    }

    let mut result = PipelineResult {
        vod_id: vod_id.clone(),
        local_path: None,
        s3_key: None,
        gdrive_file_id: None,
        gdrive_view_url: None,
        webdav_path: None,
        youtube_video_id: None,
        deleted_from_twitch: false,
    };

    // Determine descriptive output filename with date prefix for natural sorting
    let out_filename = build_vod_filename(
        vod_id,
        config.title.as_deref(),
        config.vod_date.as_deref(),
        config.custom_filename.as_deref(),
    );

    // 3. Save / Keep locally if requested
    let final_local_file = if config.save_local {
        let out_dir = if let Some(ref d) = config.local_output_dir {
            PathBuf::from(d)
        } else {
            dirs::video_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("TwitchVODs")
        };
        tokio::fs::create_dir_all(&out_dir).await?;
        let target_dest = out_dir.join(&out_filename);

        if target_dest != compressed_mp4 {
            tokio::fs::copy(&compressed_mp4, &target_dest).await?;
            reporter.report_log(
                vod_id,
                &format!("Saved local file to {}", target_dest.display()),
            );
        }
        result.local_path = Some(target_dest.to_string_lossy().to_string());
        target_dest
    } else {
        compressed_mp4.clone()
    };

    // 4. Upload to S3 if requested
    if config.upload_to_s3 {
        if let Some(ref s3) = config.s3_config {
            if !s3.endpoint.is_empty() && !s3.bucket.is_empty() {
                let object_key = format!("vods/{}", out_filename);
                reporter.report_stage(
                    vod_id,
                    "uploading_s3",
                    &format!("Uploading to S3 bucket {}...", s3.bucket),
                );
                reporter.report_log(
                    vod_id,
                    &format!("Uploading to S3 object key: {}", object_key),
                );

                upload_vod_to_s3(
                    reporter.clone(),
                    vod_id,
                    &s3.endpoint,
                    &s3.region,
                    &s3.bucket,
                    &s3.access_key,
                    &s3.secret_key,
                    &final_local_file,
                    &object_key,
                    is_cancelled.clone(),
                )
                .await?;

                result.s3_key = Some(object_key);
                reporter.report_log(vod_id, "S3 upload complete!");
            }
        }
    }

    // 5. Upload to Google Drive if requested
    if config.upload_to_gdrive {
        if let Some(ref gdrive) = config.gdrive_config {
            reporter.report_stage(
                vod_id,
                "uploading_gdrive",
                "Uploading to Google Drive...",
            );
            reporter.report_log(vod_id, "Starting Google Drive upload...");

            let (fid, view_link) = upload_vod_to_gdrive(
                reporter.clone(),
                vod_id,
                gdrive,
                &final_local_file,
                Some(&out_filename),
                is_cancelled.clone(),
            )
            .await?;

            result.gdrive_file_id = Some(fid.clone());
            result.gdrive_view_url = view_link.clone();
            reporter.report_log(
                vod_id,
                &format!("Google Drive upload complete! File ID: {}", fid),
            );
        }
    }

    // 6. Upload to WebDAV / Private Cloud if requested
    if config.upload_to_webdav {
        if let Some(ref webdav) = config.webdav_config {
            reporter.report_stage(
                vod_id,
                "uploading_webdav",
                "Uploading to WebDAV / Private Cloud...",
            );
            reporter.report_log(vod_id, "Starting WebDAV upload...");

            let path = upload_vod_to_webdav(
                reporter.clone(),
                vod_id,
                webdav,
                &final_local_file,
                Some(&out_filename),
                is_cancelled.clone(),
            )
            .await?;

            result.webdav_path = Some(path.clone());
            reporter.report_log(
                vod_id,
                &format!("WebDAV upload complete! URL: {}", path),
            );
        }
    }

    // 7. Upload to YouTube if requested
    if config.upload_to_youtube {
        if let Some(ref meta) = config.youtube_metadata {
            let (client_id, client_secret) = resolve_youtube_credentials(
                config.youtube_client_id.as_deref().unwrap_or_default(),
                config.youtube_client_secret.as_deref().unwrap_or_default(),
            );
            let youtube_credentials = YouTubeCredentials {
                client_id,
                client_secret,
                access_token: config.youtube_token.clone().unwrap_or_default(),
                refresh_token: config.youtube_refresh_token.clone(),
            };
            if validate_youtube_credentials(&youtube_credentials).is_ok() {
                reporter.report_stage(
                    vod_id,
                    "uploading_youtube",
                    "Publishing to YouTube...",
                );
                reporter.report_log(
                    vod_id,
                    &format!("Uploading to YouTube: title='{}'", meta.title),
                );

                let yt_id = upload_video_to_youtube(
                    reporter.clone(),
                    vod_id,
                    &youtube_credentials,
                    &final_local_file,
                    meta,
                    is_cancelled.clone(),
                )
                .await?;

                result.youtube_video_id = Some(yt_id.clone());
                reporter.report_log(
                    vod_id,
                    &format!("YouTube upload successful! Video ID: {}", yt_id),
                );
            }
        }
    }

    // 6. Delete from Twitch if requested
    if config.delete_from_twitch_after {
        if let Some(ref token) = config.twitch_token {
            let (client_id, _) = crate::twitch::resolve_twitch_credentials(
                config.twitch_client_id.as_deref().unwrap_or(""),
                "",
            );
            if !token.is_empty() {
                reporter.report_stage(
                    vod_id,
                    "cleaning",
                    "Deleting VOD from Twitch channel...",
                );
                reporter.report_log(
                    vod_id,
                    &format!("Requesting deletion of VOD #{} from Twitch...", vod_id),
                );

                match crate::twitch::delete_vod(&client_id, token, vod_id).await {
                    Ok(()) => {
                        result.deleted_from_twitch = true;
                        reporter.report_log(
                            vod_id,
                            &format!("Successfully deleted VOD #{} from Twitch!", vod_id),
                        );
                    }
                    Err(e) => {
                        reporter.report_log(
                            vod_id,
                            &format!("Warning: Failed to delete from Twitch: {}", e),
                        );
                    }
                }
            }
        }
    }

    // 7. Clean up compressed MP4 in work_dir if not keeping locally or if saved elsewhere
    if !config.save_local {
        let _ = tokio::fs::remove_file(&compressed_mp4).await;
        let _ = tokio::fs::remove_dir_all(&work_dir).await;
    }

    reporter.report_stage(vod_id, "completed", "All pipeline actions completed successfully!");
    reporter.report_log(vod_id, "Pipeline finished!");

    Ok(result)
}

/// Sanitizes a string to be safely used as a filename component on Windows, macOS, and Linux.
/// Replaces illegal characters (\, /, :, *, ?, ", <, >, |) and control chars with hyphens/spaces,
/// collapses multiple spaces and hyphens, trims leading/trailing whitespace, dots, and hyphens,
/// and limits the length to 100 characters.
pub fn sanitize_filename_component(name: &str) -> String {
    let mut cleaned = String::with_capacity(name.len());
    for ch in name.chars() {
        match ch {
            '/' | '\\' | ':' | '|' => {
                cleaned.push_str(" - ");
            }
            '*' | '?' | '"' | '<' | '>' => {
                cleaned.push(' ');
            }
            c if c.is_control() => {
                // skip control characters
            }
            c => {
                cleaned.push(c);
            }
        }
    }

    // Collapse whitespace
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let cleaned_words = words.join(" ");

    // Collapse multiple dashes
    let mut dash_collapsed = String::new();
    let mut prev_is_dash = false;
    for ch in cleaned_words.chars() {
        if ch == '-' {
            if !prev_is_dash {
                dash_collapsed.push('-');
                prev_is_dash = true;
            }
        } else {
            dash_collapsed.push(ch);
            if !ch.is_whitespace() {
                prev_is_dash = false;
            }
        }
    }

    let mut normalized = dash_collapsed;
    while normalized.contains(" - - ") {
        normalized = normalized.replace(" - - ", " - ");
    }
    while normalized.contains("--") {
        normalized = normalized.replace("--", "-");
    }

    // Trim leading and trailing whitespace, dots, dashes, underscores
    let trimmed = normalized.trim_matches(|c: char| c.is_whitespace() || c == '.' || c == '-' || c == '_');
    if trimmed.is_empty() {
        return String::new();
    }

    // Truncate to maximum 100 chars (safe for Windows 260 MAX_PATH limits)
    let max_chars = 100;
    let mut truncated = String::new();
    for ch in trimmed.chars() {
        if truncated.chars().count() >= max_chars {
            break;
        }
        truncated.push(ch);
    }
    let final_str = truncated.trim_matches(|c: char| c.is_whitespace() || c == '.' || c == '-' || c == '_');

    // Windows reserved device names
    let upper = final_str.to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.contains(&upper.as_str()) {
        format!("{}_vod", final_str)
    } else {
        final_str.to_string()
    }
}

/// Extracts a YYYY-MM-DD date string from an ISO 8601 date string or returns None.
pub fn extract_date_prefix(date_str: &str) -> Option<String> {
    let trimmed = date_str.trim();
    if trimmed.len() >= 10 {
        let candidate = &trimmed[..10];
        let bytes = candidate.as_bytes();
        // Check YYYY-MM-DD pattern
        if bytes[0].is_ascii_digit()
            && bytes[1].is_ascii_digit()
            && bytes[2].is_ascii_digit()
            && bytes[3].is_ascii_digit()
            && bytes[4] == b'-'
            && bytes[5].is_ascii_digit()
            && bytes[6].is_ascii_digit()
            && bytes[7] == b'-'
            && bytes[8].is_ascii_digit()
            && bytes[9].is_ascii_digit()
        {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Builds a sortable, safe, and descriptive VOD filename.
/// Format: `YYYY-MM-DD - <CleanTitle> [<vod_id>].mp4`
/// If custom_filename is specified, ensures it has .mp4 extension and sanitizes it.
pub fn build_vod_filename(
    vod_id: &str,
    title: Option<&str>,
    vod_date: Option<&str>,
    custom_filename: Option<&str>,
) -> String {
    if let Some(custom) = custom_filename {
        let clean = custom.trim();
        if !clean.is_empty() {
            let base = clean.strip_suffix(".mp4").unwrap_or(clean);
            let sanitized = sanitize_filename_component(base);
            if !sanitized.is_empty() {
                return format!("{}.mp4", sanitized);
            }
        }
    }

    let date_part = vod_date.and_then(extract_date_prefix);
    let clean_title = title.map(sanitize_filename_component).filter(|s| !s.is_empty());
    let clean_id = vod_id.trim();

    match (date_part, clean_title) {
        (Some(date), Some(t)) => {
            if !clean_id.is_empty() {
                format!("{} - {} [{}].mp4", date, t, clean_id)
            } else {
                format!("{} - {}.mp4", date, t)
            }
        }
        (Some(date), None) => {
            if !clean_id.is_empty() {
                format!("{} - Twitch VOD [{}].mp4", date, clean_id)
            } else {
                format!("{} - Twitch VOD.mp4", date)
            }
        }
        (None, Some(t)) => {
            if !clean_id.is_empty() {
                format!("{} [{}].mp4", t, clean_id)
            } else {
                format!("{}.mp4", t)
            }
        }
        (None, None) => {
            if !clean_id.is_empty() {
                format!("vod_{}.mp4", clean_id)
            } else {
                "vod.mp4".to_string()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_date_prefix() {
        assert_eq!(
            extract_date_prefix("2026-09-06T15:24:00Z"),
            Some("2026-09-06".to_string())
        );
        assert_eq!(
            extract_date_prefix("2023-01-15T08:30:12+01:00"),
            Some("2023-01-15".to_string())
        );
        assert_eq!(
            extract_date_prefix("2025-12-31"),
            Some("2025-12-31".to_string())
        );
        assert_eq!(extract_date_prefix("invalid-date"), None);
        assert_eq!(extract_date_prefix(""), None);
    }

    #[test]
    fn test_sanitize_filename_component() {
        assert_eq!(
            sanitize_filename_component("Playing Zelda: Breath of the Wild / 100%"),
            "Playing Zelda - Breath of the Wild - 100%"
        );
        assert_eq!(
            sanitize_filename_component("🔴 Stream? <Yes> | *Awesome* \"Quote\""),
            "🔴 Stream Yes - Awesome Quote"
        );
        assert_eq!(
            sanitize_filename_component("   ...hello...world---   "),
            "hello...world"
        );
        assert_eq!(sanitize_filename_component("CON"), "CON_vod");
        assert_eq!(sanitize_filename_component("prn"), "prn_vod");
    }

    #[test]
    fn test_build_vod_filename_full() {
        let name = build_vod_filename(
            "123456789",
            Some("Speedrun Any% PB attempts!"),
            Some("2026-09-06T15:24:00Z"),
            None,
        );
        assert_eq!(name, "2026-09-06 - Speedrun Any% PB attempts! [123456789].mp4");
    }

    #[test]
    fn test_build_vod_filename_missing_title() {
        let name = build_vod_filename(
            "123456789",
            None,
            Some("2026-09-06T15:24:00Z"),
            None,
        );
        assert_eq!(name, "2026-09-06 - Twitch VOD [123456789].mp4");
    }

    #[test]
    fn test_build_vod_filename_missing_date() {
        let name = build_vod_filename(
            "123456789",
            Some("Speedrun Any% PB attempts!"),
            None,
            None,
        );
        assert_eq!(name, "Speedrun Any% PB attempts! [123456789].mp4");
    }

    #[test]
    fn test_build_vod_filename_fallback() {
        let name = build_vod_filename(
            "123456789",
            None,
            None,
            None,
        );
        assert_eq!(name, "vod_123456789.mp4");
    }

    #[test]
    fn test_build_vod_filename_custom() {
        let name = build_vod_filename(
            "123456789",
            Some("Ignore This"),
            Some("2026-09-06T15:24:00Z"),
            Some("Custom_Archive_Name.mp4"),
        );
        assert_eq!(name, "Custom_Archive_Name.mp4");
    }
}
