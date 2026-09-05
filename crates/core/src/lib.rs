use serde::{Deserialize, Serialize};

pub mod compressor;
pub mod downloader;
pub mod error;
pub mod pipeline;
pub mod reporter;
pub mod settings;
pub mod storage_gdrive;
pub mod storage_s3;
pub mod storage_webdav;
pub mod twitch;
pub mod youtube;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageQuota {
    pub used_bytes: u64,
    pub total_bytes: Option<u64>,
    pub available_bytes: Option<u64>,
}

pub use compressor::{compress_vod, detect_ffmpeg, FfmpegInfo};
pub use downloader::download_vod_chunks;
pub use error::{AppError, StableError};
pub use pipeline::{run_archive_pipeline, PipelineConfig, PipelineResult};
pub use reporter::{
    CallbackProgressReporter, CompressionProgress, DownloadProgress, DriveTransferProgress,
    DynReporter, NoopProgressReporter, PipelineProgress, ProgressReporter, S3TransferProgress,
    YouTubeUploadProgress,
};
pub use settings::{load_settings, save_settings, AppSettings};
pub use storage_gdrive::{
    delete_gdrive_object, download_gdrive_file, get_gdrive_quota, list_gdrive_vods,
    refresh_gdrive_token, start_gdrive_oauth, upload_vod_to_gdrive, GDriveCredentials,
    GoogleDriveFile,
};
pub use storage_s3::{
    delete_s3_object, download_vod_from_s3, list_bucket_vods, upload_vod_to_s3, S3Credentials,
    S3Object,
};
pub use storage_webdav::{
    delete_webdav_object, download_webdav_file, get_webdav_quota, list_webdav_vods,
    upload_vod_to_webdav, WebDavCredentials, WebDavFile,
};
pub use twitch::{
    delete_vod, get_app_access_token, get_user_by_login, get_user_info, get_vod_qualities,
    get_vods, start_oauth_flow, TwitchUser, TwitchVod, VodQuality,
};
pub use youtube::{
    start_google_oauth, upload_video_to_youtube, YouTubeVideoMetadata,
};
