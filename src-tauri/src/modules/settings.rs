use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use crate::error::AppError;

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

    pub gdrive_client_id: Option<String>,
    pub gdrive_client_secret: Option<String>,
    pub gdrive_access_token: Option<String>,
    pub gdrive_refresh_token: Option<String>,
    pub gdrive_folder_id: Option<String>,

    pub webdav_endpoint: Option<String>,
    pub webdav_username: Option<String>,
    pub webdav_password: Option<String>,
    pub webdav_folder: Option<String>,

    pub ffmpeg_path: Option<String>,
    pub auto_download_tools: Option<bool>,

    pub worker_url: Option<String>,
    pub worker_api_key: Option<String>,
    pub worker_auto_sync: Option<bool>,
    pub auto_archive_enabled: Option<bool>,
    pub auto_archive_interval_mins: Option<u32>,
    #[serde(default = "default_max_storage_gb")]
    pub max_storage_gb: Option<u32>,
}

fn default_max_storage_gb() -> Option<u32> {
    Some(100)
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

            ffmpeg_path: None,
            auto_download_tools: Some(true),

            worker_url: None,
            worker_api_key: None,
            worker_auto_sync: Some(true),
            auto_archive_enabled: Some(false),
            auto_archive_interval_mins: Some(15),
            max_storage_gb: Some(100),
        }
    }
}

#[derive(Debug, Deserialize, Default)]
struct TomlTwitch {
    client_id: Option<String>,
    client_secret: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    user_id: Option<String>,
    username: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct TomlS3 {
    provider: Option<String>,
    endpoint: Option<String>,
    region: Option<String>,
    bucket: Option<String>,
    access_key: Option<String>,
    secret_key: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct TomlEncoding {
    preset: Option<String>,
    encoder_preset: Option<String>,
    crf: Option<u8>,
    temp_dir: Option<String>,
    output_dir: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct TomlYouTube {
    client_id: Option<String>,
    client_secret: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct TomlGDrive {
    client_id: Option<String>,
    client_secret: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    folder_id: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct TomlWebDav {
    endpoint: Option<String>,
    username: Option<String>,
    password: Option<String>,
    folder: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct TomlTools {
    ffmpeg_path: Option<String>,
    auto_download_tools: Option<bool>,
    auto_download: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
struct SectionedConfig {
    twitch: Option<TomlTwitch>,
    s3: Option<TomlS3>,
    storage: Option<TomlS3>,
    gdrive: Option<TomlGDrive>,
    webdav: Option<TomlWebDav>,
    encoding: Option<TomlEncoding>,
    video: Option<TomlEncoding>,
    youtube: Option<TomlYouTube>,
    tools: Option<TomlTools>,
}

impl AppSettings {
    /// Parse AppSettings from either flat or sectioned TOML string
    pub fn from_toml(content: &str) -> Result<Self, AppError> {
        // Try direct flat deserialization first
        if let Ok(settings) = toml::from_str::<AppSettings>(content) {
            return Ok(settings);
        }

        // Try sectioned TOML deserialization
        let parsed: SectionedConfig = toml::from_str(content)?;
        let mut settings = AppSettings::default();

        if let Some(t) = parsed.twitch {
            if let Some(v) = t.client_id { settings.twitch_client_id = v; }
            if let Some(v) = t.client_secret { settings.twitch_client_secret = v; }
            if t.access_token.is_some() { settings.twitch_access_token = t.access_token; }
            if t.refresh_token.is_some() { settings.twitch_refresh_token = t.refresh_token; }
            if t.user_id.is_some() { settings.twitch_user_id = t.user_id; }
            if t.username.is_some() { settings.twitch_username = t.username; }
        }

        let s3 = parsed.s3.or(parsed.storage);
        if let Some(s) = s3 {
            if let Some(v) = s.provider { settings.s3_provider = v; }
            if let Some(v) = s.endpoint { settings.s3_endpoint = v; }
            if let Some(v) = s.region { settings.s3_region = v; }
            if let Some(v) = s.bucket { settings.s3_bucket = v; }
            if let Some(v) = s.access_key { settings.s3_access_key = v; }
            if let Some(v) = s.secret_key { settings.s3_secret_key = v; }
        }

        if let Some(gd) = parsed.gdrive {
            if gd.client_id.is_some() { settings.gdrive_client_id = gd.client_id; }
            if gd.client_secret.is_some() { settings.gdrive_client_secret = gd.client_secret; }
            if gd.access_token.is_some() { settings.gdrive_access_token = gd.access_token; }
            if gd.refresh_token.is_some() { settings.gdrive_refresh_token = gd.refresh_token; }
            if gd.folder_id.is_some() { settings.gdrive_folder_id = gd.folder_id; }
        }

        if let Some(wd) = parsed.webdav {
            if wd.endpoint.is_some() { settings.webdav_endpoint = wd.endpoint; }
            if wd.username.is_some() { settings.webdav_username = wd.username; }
            if wd.password.is_some() { settings.webdav_password = wd.password; }
            if wd.folder.is_some() { settings.webdav_folder = wd.folder; }
        }

        let enc = parsed.encoding.or(parsed.video);
        if let Some(e) = enc {
            if let Some(v) = e.encoder_preset.or(e.preset) { settings.encoder_preset = v; }
            if let Some(v) = e.crf { settings.crf = v; }
            if e.temp_dir.is_some() { settings.temp_dir = e.temp_dir; }
            if e.output_dir.is_some() { settings.output_dir = e.output_dir; }
        }

        if let Some(y) = parsed.youtube {
            if y.client_id.is_some() { settings.youtube_client_id = y.client_id; }
            if y.client_secret.is_some() { settings.youtube_client_secret = y.client_secret; }
            if y.access_token.is_some() { settings.youtube_access_token = y.access_token; }
            if y.refresh_token.is_some() { settings.youtube_refresh_token = y.refresh_token; }
        }

        if let Some(tools) = parsed.tools {
            if tools.ffmpeg_path.is_some() { settings.ffmpeg_path = tools.ffmpeg_path; }
            if let Some(ad) = tools.auto_download_tools.or(tools.auto_download) {
                settings.auto_download_tools = Some(ad);
            }
        }

        Ok(settings)
    }

    /// Serialize current AppSettings to a human-readable, well-commented TOML string
    pub fn to_toml(&self) -> String {
        let mut out = String::new();
        out.push_str("# ==========================================\n");
        out.push_str("# Twitch VOD Manager Configuration\n");
        out.push_str("# ==========================================\n\n");

        out.push_str("[twitch]\n");
        if let Some(ref u) = self.twitch_username {
            out.push_str(&format!("username = {:?}\n", u));
        }
        if let Some(ref uid) = self.twitch_user_id {
            out.push_str(&format!("user_id = {:?}\n", uid));
        }

        out.push_str("\n[s3]\n");
        out.push_str("# Provider options: \"cloudflare_r2\", \"backblaze_b2\", \"custom\"\n");
        out.push_str(&format!("provider = {:?}\n", self.s3_provider));
        out.push_str(&format!("endpoint = {:?}\n", self.s3_endpoint));
        out.push_str(&format!("region = {:?}\n", self.s3_region));
        out.push_str(&format!("bucket = {:?}\n", self.s3_bucket));
        out.push_str(&format!("access_key = {:?}\n", self.s3_access_key));
        out.push_str(&format!("secret_key = {:?}\n", self.s3_secret_key));

        out.push_str("\n[gdrive]\n");
        if let Some(ref fid) = self.gdrive_folder_id {
            out.push_str(&format!("folder_id = {:?}\n", fid));
        }

        out.push_str("\n[webdav]\n");
        if let Some(ref ep) = self.webdav_endpoint {
            out.push_str(&format!("endpoint = {:?}\n", ep));
        }
        if let Some(ref u) = self.webdav_username {
            out.push_str(&format!("username = {:?}\n", u));
        }
        if let Some(ref f) = self.webdav_folder {
            out.push_str(&format!("folder = {:?}\n", f));
        }

        out.push_str("\n[encoding]\n");
        out.push_str("# Options: \"hevc_nvenc\", \"libx265\", \"libx264\", \"passthrough\"\n");
        out.push_str(&format!("encoder_preset = {:?}\n", self.encoder_preset));
        out.push_str(&format!("crf = {}\n", self.crf));
        if let Some(ref t) = self.temp_dir {
            out.push_str(&format!("temp_dir = {:?}\n", t));
        }
        if let Some(ref o) = self.output_dir {
            out.push_str(&format!("output_dir = {:?}\n", o));
        }

        out.push_str("\n[tools]\n");
        if let Some(ref fp) = self.ffmpeg_path {
            out.push_str(&format!("ffmpeg_path = {:?}\n", fp));
        }
        if let Some(ad) = self.auto_download_tools {
            out.push_str(&format!("auto_download_tools = {}\n", ad));
        }

        out
    }
}

pub fn get_config_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    use tauri::Manager;
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string())))?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)?;
    }

    Ok(config_dir.join("settings.json"))
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
