use crate::db::Database;
use crate::state::AppState;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tracing::{error, info};
use vod_core::pipeline::{run_archive_pipeline, PipelineConfig};
use vod_core::reporter::{
    CompressionProgress, DownloadProgress, DriveTransferProgress, ProgressReporter,
    S3TransferProgress, YouTubeUploadProgress,
};

pub struct WorkerProgressReporter {
    job_id: String,
    db: Arc<Database>,
}

impl WorkerProgressReporter {
    pub fn new(job_id: String, db: Arc<Database>) -> Self {
        Self { job_id, db }
    }
}

impl ProgressReporter for WorkerProgressReporter {
    fn report_download(&self, progress: &DownloadProgress) {
        let _ = self.db.update_job_status(
            &self.job_id,
            "downloading",
            "downloading",
            progress.percent * 0.35, // 0 - 35% of total pipeline
            None,
        );
    }

    fn report_compression(&self, progress: &CompressionProgress) {
        let _ = self.db.update_job_status(
            &self.job_id,
            "compressing",
            "compressing",
            35.0 + (progress.percent * 0.45), // 35 - 80% of total pipeline
            None,
        );
    }

    fn report_s3(&self, progress: &S3TransferProgress) {
        let _ = self.db.update_job_status(
            &self.job_id,
            "uploading_s3",
            "uploading_s3",
            80.0 + (progress.percent * 0.20), // 80 - 100% of total pipeline
            None,
        );
    }

    fn report_youtube(&self, progress: &YouTubeUploadProgress) {
        let _ = self.db.update_job_status(
            &self.job_id,
            "uploading_youtube",
            "uploading_youtube",
            progress.percent,
            None,
        );
    }

    fn report_drive(&self, progress: &DriveTransferProgress) {
        let stage_name = format!("uploading_{}", progress.provider);
        let _ = self.db.update_job_status(
            &self.job_id,
            &stage_name,
            &stage_name,
            80.0 + (progress.percent * 0.20),
            None,
        );
    }

    fn report_stage(&self, _vod_id: &str, stage: &str, message: &str) {
        let _ = self.db.update_job_status(
            &self.job_id,
            stage,
            stage,
            match stage {
                "downloading" => 5.0,
                "compressing" => 35.0,
                "uploading_s3" | "uploading_youtube" | "uploading_gdrive" | "uploading_webdav" => 80.0,
                "completed" => 100.0,
                _ => 0.0,
            },
            None,
        );
        self.db.append_log(&self.job_id, message);
    }

    fn report_log(&self, _vod_id: &str, message: &str) {
        self.db.append_log(&self.job_id, message);
    }
}

pub fn spawn_worker_job(state: AppState, job_id: String, config: PipelineConfig) {
    let is_cancelled = Arc::new(AtomicBool::new(false));

    // Register cancellation token
    let cancellation_clone = is_cancelled.clone();
    let job_id_clone = job_id.clone();
    let state_clone = state.clone();

    tokio::spawn(async move {
        {
            let mut active = state_clone.active_cancellations.write().await;
            active.insert(job_id_clone.clone(), cancellation_clone);
        }

        let reporter = Arc::new(WorkerProgressReporter::new(
            job_id_clone.clone(),
            state_clone.db.clone(),
        ));

        let temp_dir = state_clone.data_dir.join("temp");
        info!("Starting worker job #{} for VOD {}", job_id_clone, config.vod_id);

        let result = run_archive_pipeline(
            reporter,
            config,
            Some(temp_dir),
            is_cancelled.clone(),
        )
        .await;

        match result {
            Ok(res) => {
                info!("Worker job #{} completed successfully", job_id_clone);
                let _ = state_clone.db.update_job_success(
                    &job_id_clone,
                    res.local_path.as_deref(),
                    res.s3_key.as_deref(),
                    res.gdrive_file_id.as_deref(),
                    res.gdrive_view_url.as_deref(),
                    res.webdav_path.as_deref(),
                    res.youtube_video_id.as_deref(),
                );
            }
            Err(vod_core::AppError::Cancelled) => {
                info!("Worker job #{} was cancelled", job_id_clone);
                let _ = state_clone.db.update_job_status(
                    &job_id_clone,
                    "cancelled",
                    "cancelled",
                    0.0,
                    Some("Job was cancelled by user"),
                );
            }
            Err(e) => {
                error!("Worker job #{} failed: {}", job_id_clone, e);
                let _ = state_clone.db.update_job_status(
                    &job_id_clone,
                    "failed",
                    "failed",
                    0.0,
                    Some(&e.to_string()),
                );
            }
        }

        // Unregister cancellation token
        let mut active = state_clone.active_cancellations.write().await;
        active.remove(&job_id_clone);
    });
}
