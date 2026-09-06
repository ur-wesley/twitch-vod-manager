use crate::error::AppError;
use crate::reporter::DynReporter;
use crate::storage_gdrive::{upload_vod_to_gdrive, GDriveCredentials};
use crate::storage_s3::{upload_vod_to_s3, S3Credentials};
use crate::storage_webdav::{upload_vod_to_webdav, WebDavCredentials};
use crate::youtube::{upload_video_to_youtube, YouTubeVideoMetadata};
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

    let concat_file = match crate::downloader::download_vod_chunks(
        reporter.clone(),
        vod_id,
        &config.playlist_url,
        &work_dir,
        is_cancelled.clone(),
    )
    .await
    {
        Ok(f) => f,
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

    if let Err(e) = crate::compressor::compress_vod(
        reporter.clone(),
        vod_id,
        &concat_file,
        &compressed_mp4,
        &config.preset,
        config.crf,
        config.duration_secs,
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
    let _ = tokio::fs::remove_file(&concat_file).await;
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
        let target_dest = out_dir.join(format!("vod_{}.mp4", vod_id));

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
                let object_key = format!("vods/{}.mp4", vod_id);
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
                None,
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
                None,
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
        if let (Some(ref token), Some(ref meta)) =
            (&config.youtube_token, &config.youtube_metadata)
        {
            if !token.is_empty() {
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
                    token,
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
