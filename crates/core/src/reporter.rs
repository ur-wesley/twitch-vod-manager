use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub vod_id: String,
    pub downloaded_chunks: usize,
    pub total_chunks: usize,
    pub percent: f64,
    pub bytes: u64,
    pub speed_mbps: f64,
    pub eta_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionProgress {
    pub vod_id: String,
    pub percent: f64,
    pub current_time_secs: f64,
    pub fps: f64,
    pub speed: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3TransferProgress {
    pub vod_id: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub speed_mbps: f64,
    pub is_upload: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouTubeUploadProgress {
    pub vod_id: String,
    pub bytes_uploaded: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub speed_mbps: f64,
    pub video_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveTransferProgress {
    pub vod_id: String,
    pub provider: String,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub speed_mbps: f64,
    pub file_id: Option<String>,
    pub view_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum PipelineProgress {
    Download(DownloadProgress),
    Compression(CompressionProgress),
    S3(S3TransferProgress),
    YouTube(YouTubeUploadProgress),
    Drive(DriveTransferProgress),
    Stage { vod_id: String, stage: String, message: String },
    Log { vod_id: String, message: String },
}

pub trait ProgressReporter: Send + Sync + 'static {
    fn report_download(&self, _progress: &DownloadProgress) {}
    fn report_compression(&self, _progress: &CompressionProgress) {}
    fn report_s3(&self, _progress: &S3TransferProgress) {}
    fn report_youtube(&self, _progress: &YouTubeUploadProgress) {}
    fn report_drive(&self, _progress: &DriveTransferProgress) {}
    fn report_stage(&self, _vod_id: &str, _stage: &str, _message: &str) {}
    fn report_log(&self, _vod_id: &str, _message: &str) {}
}

#[derive(Default)]
pub struct NoopProgressReporter;

impl ProgressReporter for NoopProgressReporter {}

pub struct CallbackProgressReporter<F>
where
    F: Fn(PipelineProgress) + Send + Sync + 'static,
{
    callback: F,
}

impl<F> CallbackProgressReporter<F>
where
    F: Fn(PipelineProgress) + Send + Sync + 'static,
{
    pub fn new(callback: F) -> Self {
        Self { callback }
    }
}

impl<F> ProgressReporter for CallbackProgressReporter<F>
where
    F: Fn(PipelineProgress) + Send + Sync + 'static,
{
    fn report_download(&self, progress: &DownloadProgress) {
        (self.callback)(PipelineProgress::Download(progress.clone()));
    }

    fn report_compression(&self, progress: &CompressionProgress) {
        (self.callback)(PipelineProgress::Compression(progress.clone()));
    }

    fn report_s3(&self, progress: &S3TransferProgress) {
        (self.callback)(PipelineProgress::S3(progress.clone()));
    }

    fn report_youtube(&self, progress: &YouTubeUploadProgress) {
        (self.callback)(PipelineProgress::YouTube(progress.clone()));
    }

    fn report_drive(&self, progress: &DriveTransferProgress) {
        (self.callback)(PipelineProgress::Drive(progress.clone()));
    }

    fn report_stage(&self, vod_id: &str, stage: &str, message: &str) {
        (self.callback)(PipelineProgress::Stage {
            vod_id: vod_id.to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
        });
    }

    fn report_log(&self, vod_id: &str, message: &str) {
        (self.callback)(PipelineProgress::Log {
            vod_id: vod_id.to_string(),
            message: message.to_string(),
        });
    }
}

pub type DynReporter = Arc<dyn ProgressReporter>;
