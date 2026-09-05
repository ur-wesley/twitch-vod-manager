use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub twitch_client_id: String,
    pub twitch_client_secret: String,
    pub twitch_access_token: Option<String>,
    pub twitch_refresh_token: Option<String>,
    pub twitch_user_id: Option<String>,
    pub twitch_username: Option<String>,

    pub s3_provider: String, // "cloudflare_r2", "backblaze_b2", "custom"
    pub s3_endpoint: String,
    pub s3_region: String,
    pub s3_bucket: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,

    pub encoder_preset: String, // "hevc_nvenc", "libx265", "libx264", "passthrough"
    pub crf: u8,
    pub temp_dir: Option<String>,
    pub output_dir: Option<String>,

    pub youtube_client_id: Option<String>,
    pub youtube_client_secret: Option<String>,
    pub youtube_access_token: Option<String>,
    pub youtube_refresh_token: Option<String>,

    // Google Drive settings
    pub gdrive_client_id: Option<String>,
    pub gdrive_client_secret: Option<String>,
    pub gdrive_access_token: Option<String>,
    pub gdrive_refresh_token: Option<String>,
    pub gdrive_folder_id: Option<String>,

    // WebDAV settings
    pub webdav_endpoint: Option<String>,
    pub webdav_username: Option<String>,
    pub webdav_password: Option<String>,
    pub webdav_folder: Option<String>,

    // Cloud Worker (VPS) settings
    pub worker_url: Option<String>,
    pub worker_api_key: Option<String>,
    pub worker_auto_sync: Option<bool>,
    pub auto_archive_enabled: Option<bool>,
    pub auto_archive_interval_mins: Option<u32>,

    pub ffmpeg_path: Option<String>,
    pub auto_download_tools: Option<bool>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            twitch_client_id: String::new(),
            twitch_client_secret: String::new(),
            twitch_access_token: None,
            twitch_refresh_token: None,
            twitch_user_id: None,
            twitch_username: None,

            s3_provider: "cloudflare_r2".to_string(),
            s3_endpoint: String::new(),
            s3_region: "auto".to_string(),
            s3_bucket: String::new(),
            s3_access_key: String::new(),
            s3_secret_key: String::new(),

            encoder_preset: "hevc_nvenc".to_string(),
            crf: 24,
            temp_dir: None,
            output_dir: None,

            youtube_client_id: None,
            youtube_client_secret: None,
            youtube_access_token: None,
            youtube_refresh_token: None,

            gdrive_client_id: None,
            gdrive_client_secret: None,
            gdrive_access_token: None,
            gdrive_refresh_token: None,
            gdrive_folder_id: None,

            webdav_endpoint: None,
            webdav_username: None,
            webdav_password: None,
            webdav_folder: None,

            worker_url: None,
            worker_api_key: None,
            worker_auto_sync: Some(true),
            auto_archive_enabled: Some(false),
            auto_archive_interval_mins: Some(15),
            ffmpeg_path: None,
            auto_download_tools: Some(true),
        }
    }
}

pub fn load_settings(path: &Path) -> AppSettings {
    if path.exists() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                return settings;
            }
        }
    }
    AppSettings::default()
}

pub fn save_settings(path: &Path, settings: &AppSettings) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(settings)?;
    fs::write(path, content)?;
    Ok(())
}
