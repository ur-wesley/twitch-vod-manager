use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StableError {
    pub code: String,
    pub message: String,
}

impl StableError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for StableError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}]: {}", self.code, self.message)
    }
}

impl std::error::Error for StableError {}

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Twitch API error: {0}")]
    Twitch(String),

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Download error: {0}")]
    Download(String),

    #[error("Compression error: {0}")]
    Compression(String),

    #[error("Storage S3 error: {0}")]
    Storage(String),

    #[error("YouTube upload error: {0}")]
    YouTube(String),

    #[error("Drive storage error: {0}")]
    Drive(String),

    #[error("WebDAV storage error: {0}")]
    WebDav(String),

    #[error("Cancelled")]
    Cancelled,
}

impl From<AppError> for StableError {
    fn from(err: AppError) -> Self {
        match err {
            AppError::Network(e) => StableError::new("NETWORK_ERROR", e.to_string()),
            AppError::Io(e) => StableError::new("IO_ERROR", e.to_string()),
            AppError::Json(e) => StableError::new("SERIALIZATION_ERROR", e.to_string()),
            AppError::Twitch(msg) => StableError::new("TWITCH_ERROR", msg),
            AppError::Auth(msg) => StableError::new("AUTH_ERROR", msg),
            AppError::Download(msg) => StableError::new("DOWNLOAD_ERROR", msg),
            AppError::Compression(msg) => StableError::new("COMPRESSION_ERROR", msg),
            AppError::Storage(msg) => StableError::new("STORAGE_ERROR", msg),
            AppError::YouTube(msg) => StableError::new("YOUTUBE_ERROR", msg),
            AppError::Drive(msg) => StableError::new("DRIVE_ERROR", msg),
            AppError::WebDav(msg) => StableError::new("WEBDAV_ERROR", msg),
            AppError::Cancelled => StableError::new("CANCELLED", "Operation was cancelled"),
        }
    }
}
