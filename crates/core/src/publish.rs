use crate::error::AppError;
use crate::reporter::DynReporter;
use crate::storage_gdrive::{download_gdrive_file, GDriveCredentials};
use crate::storage_s3::{download_vod_from_s3, S3Credentials};
use crate::storage_webdav::{download_webdav_file, WebDavCredentials};
use crate::youtube::{upload_video_to_youtube, validate_youtube_credentials, YouTubeCredentials, YouTubeVideoMetadata};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "provider", rename_all = "lowercase")]
pub enum StorageSource {
    Gdrive {
        file_id: String,
        creds: GDriveCredentials,
    },
    S3 {
        key: String,
        creds: S3Credentials,
    },
    Webdav {
        href: String,
        creds: WebDavCredentials,
    },
}

pub fn publish_temp_path(base_dir: &Path, job_id: &str) -> PathBuf {
    base_dir.join(format!("yt_{}.mp4", job_id))
}

pub fn local_publish_temp_path(vod_id: &str) -> PathBuf {
    std::env::temp_dir().join(format!("tvm-yt-{}.mp4", vod_id))
}

pub async fn remove_temp_file(path: &Path) {
    let _ = tokio::fs::remove_file(path).await;
}

pub async fn run_publish_from_storage(
    reporter: DynReporter,
    vod_id: &str,
    source: &StorageSource,
    temp_path: &Path,
    youtube_credentials: &YouTubeCredentials,
    metadata: &YouTubeVideoMetadata,
    is_cancelled: Arc<AtomicBool>,
) -> Result<String, AppError> {
    validate_youtube_credentials(youtube_credentials)?;

    if is_cancelled.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }

    reporter.report_stage(vod_id, "downloading", "Downloading video from cloud storage...");
    reporter.report_log(vod_id, "Starting cloud download for YouTube publish...");

    let download_result = match source {
        StorageSource::Gdrive { file_id, creds } => download_gdrive_file(
            reporter.clone(),
            vod_id,
            &creds.client_id,
            &creds.client_secret,
            &creds.access_token,
            creds.refresh_token.as_deref(),
            file_id,
            temp_path,
            is_cancelled.clone(),
        )
        .await,
        StorageSource::S3 { key, creds } => download_vod_from_s3(
            reporter.clone(),
            vod_id,
            &creds.endpoint,
            &creds.region,
            &creds.bucket,
            &creds.access_key,
            &creds.secret_key,
            key,
            temp_path,
            is_cancelled.clone(),
        )
        .await,
        StorageSource::Webdav { href, creds } => download_webdav_file(
            reporter.clone(),
            vod_id,
            creds,
            href,
            temp_path,
            is_cancelled.clone(),
        )
        .await,
    };

    if let Err(e) = download_result {
        remove_temp_file(temp_path).await;
        return Err(e);
    }

    if is_cancelled.load(Ordering::Relaxed) {
        remove_temp_file(temp_path).await;
        return Err(AppError::Cancelled);
    }

    reporter.report_stage(vod_id, "uploading_youtube", "Publishing to YouTube...");

    let upload_result = upload_video_to_youtube(
        reporter.clone(),
        vod_id,
        youtube_credentials,
        temp_path,
        metadata,
        is_cancelled.clone(),
    )
    .await;

    remove_temp_file(temp_path).await;
    upload_result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publish_temp_path_uses_job_id() {
        let path = publish_temp_path(Path::new("/data/temp"), "abc-123");
        assert_eq!(path, PathBuf::from("/data/temp/yt_abc-123.mp4"));
    }

    #[test]
    fn local_publish_temp_path_uses_vod_id() {
        let path = local_publish_temp_path("vod999");
        assert!(path.to_string_lossy().contains("tvm-yt-vod999.mp4"));
    }

    #[tokio::test]
    async fn remove_temp_file_deletes_existing_file() {
        let dir = std::env::temp_dir().join(format!("tvm-publish-test-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let file = dir.join("cleanup-test.mp4");
        tokio::fs::write(&file, b"test").await.unwrap();
        assert!(file.exists());

        remove_temp_file(&file).await;
        assert!(!file.exists());

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn publish_fails_without_youtube_token_and_cleans_nothing() {
        let reporter = Arc::new(crate::reporter::NoopProgressReporter);
        let temp = std::env::temp_dir().join(format!(
            "tvm-publish-no-token-{}.mp4",
            std::process::id()
        ));
        let source = StorageSource::Gdrive {
            file_id: "file".into(),
            creds: GDriveCredentials {
                client_id: "id".into(),
                client_secret: "secret".into(),
                access_token: "token".into(),
                refresh_token: None,
                folder_id: None,
            },
        };

        let result = run_publish_from_storage(
            reporter,
            "vod1",
            &source,
            &temp,
            &YouTubeCredentials {
                client_id: "id".into(),
                client_secret: "secret".into(),
                access_token: String::new(),
                refresh_token: None,
            },
            &YouTubeVideoMetadata {
                title: "t".into(),
                description: "d".into(),
                privacy_status: "unlisted".into(),
                tags: vec![],
            },
            Arc::new(AtomicBool::new(false)),
        )
        .await;

        assert!(result.is_err());
        assert!(!temp.exists());
    }
}
