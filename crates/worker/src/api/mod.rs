use crate::db::{Database, JobLogRecord, WorkerJobRecord};
use crate::queue::spawn_worker_job;
use crate::state::AppState;
use crate::watcher::check_channel_and_archive;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use sysinfo::{Disks, System};
use tokio_util::io::ReaderStream;
use uuid::Uuid;
use vod_core::compressor::detect_ffmpeg;
use vod_core::pipeline::PipelineConfig;
use vod_core::storage_gdrive::GDriveCredentials;
use vod_core::storage_s3::S3Credentials;
use vod_core::storage_webdav::WebDavCredentials;
use vod_core::twitch::resolve_twitch_credentials;
use vod_core::youtube::YouTubeVideoMetadata;

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkerStatusResponse {
    pub status: String,
    pub version: String,
    pub uptime_secs: u64,
    pub cpu_usage_percent: f32,
    pub memory_total_mb: u64,
    pub memory_used_mb: u64,
    pub disk_total_gb: u64,
    pub disk_free_gb: u64,
    pub storage_max_gb: f64,
    pub storage_used_gb: f64,
    pub storage_free_gb: f64,
    pub ffmpeg_available: bool,
    pub active_jobs_count: usize,
    pub auto_watcher_enabled: bool,
    pub has_twitch: bool,
    pub has_s3: bool,
    pub has_gdrive: bool,
    pub has_webdav: bool,
}

fn cfg_nonempty(db: &Database, key: &str) -> bool {
    db.get_config(key)
        .ok()
        .flatten()
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

fn cred_presence(db: &Database) -> (bool, bool, bool, bool) {
    let raw_id = db
        .get_config("twitch_client_id")
        .ok()
        .flatten()
        .unwrap_or_default();
    let raw_secret = db
        .get_config("twitch_client_secret")
        .ok()
        .flatten()
        .unwrap_or_default();
    let (client_id, client_secret) = resolve_twitch_credentials(&raw_id, &raw_secret);
    let has_twitch = !client_id.is_empty()
        && !client_secret.is_empty()
        && cfg_nonempty(db, "twitch_user_id");
    let has_s3 = cfg_nonempty(db, "s3_endpoint") && cfg_nonempty(db, "s3_bucket");
    let has_gdrive = cfg_nonempty(db, "gdrive_access_token")
        || db
            .get_config("gdrive_refresh_token")
            .ok()
            .flatten()
            .is_some();
    let has_webdav =
        cfg_nonempty(db, "webdav_endpoint") && cfg_nonempty(db, "webdav_username");
    (has_twitch, has_s3, has_gdrive, has_webdav)
}

#[derive(Debug, Deserialize)]
pub struct CreateJobRequest {
    pub vod_id: String,
    pub title: String,
    pub playlist_url: String,
    pub preset: Option<String>,
    pub crf: Option<u8>,
    pub duration_secs: Option<f64>,

    // Configurable destinations
    pub save_local: Option<bool>,
    pub upload_to_s3: Option<bool>,
    pub s3_config: Option<S3Credentials>,
    pub upload_to_gdrive: Option<bool>,
    pub gdrive_config: Option<GDriveCredentials>,
    pub upload_to_webdav: Option<bool>,
    pub webdav_config: Option<WebDavCredentials>,
    pub upload_to_youtube: Option<bool>,
    pub youtube_token: Option<String>,
    pub youtube_metadata: Option<YouTubeVideoMetadata>,
    pub delete_from_twitch_after: Option<bool>,
    pub twitch_client_id: Option<String>,
    pub twitch_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateJobResponse {
    pub job_id: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct SyncSettingsRequest {
    pub twitch_client_id: Option<String>,
    pub twitch_client_secret: Option<String>,
    pub twitch_user_id: Option<String>,
    pub twitch_username: Option<String>,
    pub s3_provider: Option<String>,
    pub s3_endpoint: Option<String>,
    pub s3_region: Option<String>,
    pub s3_bucket: Option<String>,
    pub s3_access_key: Option<String>,
    pub s3_secret_key: Option<String>,
    pub gdrive_client_id: Option<String>,
    pub gdrive_client_secret: Option<String>,
    pub gdrive_access_token: Option<String>,
    pub gdrive_refresh_token: Option<String>,
    pub gdrive_folder_id: Option<String>,
    pub webdav_endpoint: Option<String>,
    pub webdav_username: Option<String>,
    pub webdav_password: Option<String>,
    pub webdav_folder: Option<String>,
    pub encoder_preset: Option<String>,
    pub crf: Option<u8>,
    pub auto_archive_enabled: Option<bool>,
    pub auto_archive_interval_mins: Option<u32>,
    pub max_storage_gb: Option<u32>,
}

// Authentication middleware
async fn auth_middleware(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if let Some(ref required_key) = state.api_key {
        let auth_header = headers
            .get("Authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "));

        let api_key_header = headers
            .get("X-API-Key")
            .and_then(|h| h.to_str().ok());

        let matched = auth_header == Some(required_key.as_str())
            || api_key_header == Some(required_key.as_str());

        if !matched {
            return Err(StatusCode::UNAUTHORIZED);
        }
    }

    Ok(next.run(request).await)
}

pub fn create_router(state: AppState) -> Router {
    let api_routes = Router::new()
        .route("/status", get(get_status_handler))
        .route("/jobs", get(list_jobs_handler).post(create_job_handler))
        .route("/jobs/:id", get(get_job_handler).delete(delete_job_handler))
        .route("/jobs/:id/logs", get(get_job_logs_handler))
        .route("/jobs/:id/download", get(download_job_file_handler))
        .route("/jobs/:id/cancel", post(cancel_job_handler))
        .route("/config", get(get_config_handler).post(set_config_handler))
        .route("/sync", post(sync_settings_handler))
        .route("/watcher/trigger", post(trigger_watcher_handler))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    Router::new()
        .route("/health", get(get_status_handler))
        .nest("/api", api_routes)
        .with_state(state)
}

fn disk_stats_for_path<'a, I>(path: &std::path::Path, disks: I) -> (u64, u64)
where
    I: IntoIterator<Item = (&'a std::path::Path, u64, u64)>,
{
    let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let resolved = {
        let s = resolved.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            std::path::PathBuf::from(format!(r"\\{rest}"))
        } else if let Some(rest) = s.strip_prefix(r"\\?\") {
            std::path::PathBuf::from(rest)
        } else {
            resolved
        }
    };
    let disks: Vec<_> = disks.into_iter().collect();

    if let Some((_, total, avail)) = disks
        .iter()
        .filter(|(mount, _, _)| resolved.starts_with(mount))
        .max_by_key(|(mount, _, _)| mount.as_os_str().len())
    {
        return (*total, *avail);
    }

    if let Some((_, total, avail)) = disks
        .iter()
        .find(|(mount, _, _)| *mount == std::path::Path::new("/"))
    {
        return (*total, *avail);
    }

    disks
        .iter()
        .find(|(_, total, _)| *total > 0)
        .map(|(_, total, avail)| (*total, *avail))
        .unwrap_or((0, 0))
}

async fn get_status_handler(State(state): State<AppState>) -> Json<WorkerStatusResponse> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let disks = Disks::new_with_refreshed_list();
    let (total_disk_b, free_disk_b) = disk_stats_for_path(
        &state.data_dir,
        disks
            .iter()
            .map(|d| (d.mount_point(), d.total_space(), d.available_space())),
    );

    let ffmpeg_info = detect_ffmpeg().await;
    let active_count = state.active_cancellations.read().await.len();

    let auto_watcher_enabled = state
        .db
        .get_config("auto_archive_enabled")
        .ok()
        .flatten()
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    let max_storage_gb = crate::storage_quota::resolve_max_storage_gb(
        state
            .db
            .get_config("max_storage_gb")
            .ok()
            .flatten()
            .as_deref(),
    );
    let (storage_max_gb, storage_used_gb, storage_free_gb) =
        crate::storage_quota::storage_quota_stats(
            &state.data_dir.join("completed"),
            max_storage_gb,
        );

    let (has_twitch, has_s3, has_gdrive, has_webdav) = cred_presence(&state.db);

    Json(WorkerStatusResponse {
        status: "online".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_secs: System::uptime(),
        cpu_usage_percent: sys.global_cpu_info().cpu_usage(),
        memory_total_mb: sys.total_memory() / (1024 * 1024),
        memory_used_mb: sys.used_memory() / (1024 * 1024),
        disk_total_gb: total_disk_b / (1024 * 1024 * 1024),
        disk_free_gb: free_disk_b / (1024 * 1024 * 1024),
        storage_max_gb,
        storage_used_gb,
        storage_free_gb,
        ffmpeg_available: ffmpeg_info.available,
        active_jobs_count: active_count,
        auto_watcher_enabled,
        has_twitch,
        has_s3,
        has_gdrive,
        has_webdav,
    })
}

async fn list_jobs_handler(State(state): State<AppState>) -> Result<Json<Vec<WorkerJobRecord>>, StatusCode> {
    state
        .db
        .list_jobs()
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn get_job_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<WorkerJobRecord>, StatusCode> {
    match state.db.get_job(&id) {
        Ok(Some(job)) => Ok(Json(job)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn get_job_logs_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<JobLogRecord>>, StatusCode> {
    state
        .db
        .get_job_logs(&id)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn download_job_file_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, StatusCode> {
    let job = state
        .db
        .get_job(&id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let path_str = job.local_path.ok_or(StatusCode::NOT_FOUND)?;
    let path = std::path::PathBuf::from(path_str);

    if !path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vod.mp4");

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        )
        .body(body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(response)
}

async fn create_job_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateJobRequest>,
) -> Result<(StatusCode, Json<CreateJobResponse>), StatusCode> {
    let max_storage_gb = crate::storage_quota::resolve_max_storage_gb(
        state
            .db
            .get_config("max_storage_gb")
            .ok()
            .flatten()
            .as_deref(),
    );
    let completed_dir = state.data_dir.join("completed");
    if crate::storage_quota::is_over_quota(&completed_dir, max_storage_gb) {
        let (_, used, free) =
            crate::storage_quota::storage_quota_stats(&completed_dir, max_storage_gb);
        return Ok((
            StatusCode::INSUFFICIENT_STORAGE,
            Json(CreateJobResponse {
                job_id: String::new(),
                message: format!(
                    "Storage quota exceeded: {:.1} GB used of {} GB configured ({:.1} GB free)",
                    used, max_storage_gb, free
                ),
            }),
        ));
    }

    let job_id = Uuid::new_v4().to_string();

    state
        .db
        .insert_job(&job_id, &payload.vod_id, &payload.title, "queued")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // S3 config fallback to worker DB if not explicitly supplied
    let s3_config = if payload.upload_to_s3.unwrap_or(false) {
        if payload.s3_config.is_some() {
            payload.s3_config
        } else {
            let ep = state.db.get_config("s3_endpoint").ok().flatten().unwrap_or_default();
            let reg = state.db.get_config("s3_region").ok().flatten().unwrap_or_else(|| "auto".to_string());
            let bkt = state.db.get_config("s3_bucket").ok().flatten().unwrap_or_default();
            let ak = state.db.get_config("s3_access_key").ok().flatten().unwrap_or_default();
            let sk = state.db.get_config("s3_secret_key").ok().flatten().unwrap_or_default();
            if !ep.is_empty() && !bkt.is_empty() {
                Some(S3Credentials {
                    endpoint: ep,
                    region: reg,
                    bucket: bkt,
                    access_key: ak,
                    secret_key: sk,
                })
            } else {
                None
            }
        }
    } else {
        None
    };

    // Google Drive fallback to worker DB
    let gdrive_config = if payload.upload_to_gdrive.unwrap_or(false) {
        if payload.gdrive_config.is_some() {
            payload.gdrive_config
        } else {
            let cid = state.db.get_config("gdrive_client_id").ok().flatten().unwrap_or_default();
            let cs = state.db.get_config("gdrive_client_secret").ok().flatten().unwrap_or_default();
            let (cid, cs) = vod_core::storage_gdrive::resolve_gdrive_credentials(&cid, &cs);
            let tok = state.db.get_config("gdrive_access_token").ok().flatten().unwrap_or_default();
            let rtok = state.db.get_config("gdrive_refresh_token").ok().flatten();
            let fid = state.db.get_config("gdrive_folder_id").ok().flatten();
            if !tok.is_empty() || rtok.is_some() {
                Some(GDriveCredentials {
                    client_id: cid,
                    client_secret: cs,
                    access_token: tok,
                    refresh_token: rtok,
                    folder_id: fid,
                })
            } else {
                None
            }
        }
    } else {
        None
    };

    // WebDAV fallback to worker DB
    let webdav_config = if payload.upload_to_webdav.unwrap_or(false) {
        if payload.webdav_config.is_some() {
            payload.webdav_config
        } else {
            let ep = state.db.get_config("webdav_endpoint").ok().flatten().unwrap_or_default();
            let u = state.db.get_config("webdav_username").ok().flatten().unwrap_or_default();
            let p = state.db.get_config("webdav_password").ok().flatten().unwrap_or_default();
            let f = state.db.get_config("webdav_folder").ok().flatten();
            if !ep.is_empty() && !u.is_empty() {
                Some(WebDavCredentials {
                    endpoint: ep,
                    username: u,
                    password: p,
                    folder: f,
                })
            } else {
                None
            }
        }
    } else {
        None
    };

    let preset = payload.preset.unwrap_or_else(|| {
        state
            .db
            .get_config("encoder_preset")
            .ok()
            .flatten()
            .unwrap_or_else(|| "libx264".to_string())
    });

    let crf = payload.crf.unwrap_or_else(|| {
        state
            .db
            .get_config("crf")
            .ok()
            .flatten()
            .and_then(|v| v.parse().ok())
            .unwrap_or(24)
    });

    let save_local = payload.save_local.unwrap_or(true);

    let config = PipelineConfig {
        vod_id: payload.vod_id,
        playlist_url: payload.playlist_url,
        preset,
        crf,
        duration_secs: payload.duration_secs,
        save_local,
        local_output_dir: Some(state.data_dir.join("completed").to_string_lossy().to_string()),
        upload_to_s3: payload.upload_to_s3.unwrap_or(false),
        s3_config,
        upload_to_gdrive: payload.upload_to_gdrive.unwrap_or(false),
        gdrive_config,
        upload_to_webdav: payload.upload_to_webdav.unwrap_or(false),
        webdav_config,
        upload_to_youtube: payload.upload_to_youtube.unwrap_or(false),
        youtube_token: payload.youtube_token,
        youtube_metadata: payload.youtube_metadata,
        delete_from_twitch_after: payload.delete_from_twitch_after.unwrap_or(false),
        twitch_client_id: payload.twitch_client_id,
        twitch_token: payload.twitch_token,
    };

    spawn_worker_job(state, job_id.clone(), config);

    Ok((
        StatusCode::CREATED,
        Json(CreateJobResponse {
            job_id,
            message: "Job queued for execution on VPS worker".to_string(),
        }),
    ))
}

async fn cancel_job_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let active = state.active_cancellations.read().await;
    if let Some(token) = active.get(&id) {
        token.store(true, Ordering::Relaxed);
        let _ = state.db.update_job_status(&id, "cancelling", "cancelling", 0.0, None);
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

async fn delete_job_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    state
        .db
        .delete_job(&id)
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn get_config_handler(State(state): State<AppState>) -> Result<Json<HashMap<String, String>>, StatusCode> {
    let keys = vec![
        "twitch_client_id",
        "twitch_user_id",
        "twitch_username",
        "s3_provider",
        "s3_endpoint",
        "s3_region",
        "s3_bucket",
        "encoder_preset",
        "crf",
        "auto_archive_enabled",
        "auto_archive_interval_mins",
        "max_storage_gb",
    ];

    let mut map = HashMap::new();
    for key in keys {
        if let Ok(Some(val)) = state.db.get_config(key) {
            map.insert(key.to_string(), val);
        }
    }
    Ok(Json(map))
}

async fn set_config_handler(
    State(state): State<AppState>,
    Json(payload): Json<HashMap<String, String>>,
) -> Result<StatusCode, StatusCode> {
    for (key, val) in payload {
        state
            .db
            .set_config(&key, &val)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(StatusCode::OK)
}

async fn sync_settings_handler(
    State(state): State<AppState>,
    Json(payload): Json<SyncSettingsRequest>,
) -> Result<StatusCode, StatusCode> {
    let db = &state.db;

    if let Some(v) = payload.twitch_client_id {
        let _ = db.set_config("twitch_client_id", &v);
    }
    if let Some(v) = payload.twitch_client_secret {
        let _ = db.set_config("twitch_client_secret", &v);
    }
    if let Some(v) = payload.twitch_user_id {
        let _ = db.set_config("twitch_user_id", &v);
    }
    if let Some(v) = payload.twitch_username {
        let _ = db.set_config("twitch_username", &v);
    }
    if let Some(v) = payload.s3_provider {
        let _ = db.set_config("s3_provider", &v);
    }
    if let Some(v) = payload.s3_endpoint {
        let _ = db.set_config("s3_endpoint", &v);
    }
    if let Some(v) = payload.s3_region {
        let _ = db.set_config("s3_region", &v);
    }
    if let Some(v) = payload.s3_bucket {
        let _ = db.set_config("s3_bucket", &v);
    }
    if let Some(v) = payload.s3_access_key {
        let _ = db.set_config("s3_access_key", &v);
    }
    if let Some(v) = payload.s3_secret_key {
        let _ = db.set_config("s3_secret_key", &v);
    }
    if let Some(v) = payload.gdrive_client_id {
        let _ = db.set_config("gdrive_client_id", &v);
    }
    if let Some(v) = payload.gdrive_client_secret {
        let _ = db.set_config("gdrive_client_secret", &v);
    }
    if let Some(v) = payload.gdrive_access_token {
        let _ = db.set_config("gdrive_access_token", &v);
    }
    if let Some(v) = payload.gdrive_refresh_token {
        let _ = db.set_config("gdrive_refresh_token", &v);
    }
    if let Some(v) = payload.gdrive_folder_id {
        let _ = db.set_config("gdrive_folder_id", &v);
    }
    if let Some(v) = payload.webdav_endpoint {
        let _ = db.set_config("webdav_endpoint", &v);
    }
    if let Some(v) = payload.webdav_username {
        let _ = db.set_config("webdav_username", &v);
    }
    if let Some(v) = payload.webdav_password {
        let _ = db.set_config("webdav_password", &v);
    }
    if let Some(v) = payload.webdav_folder {
        let _ = db.set_config("webdav_folder", &v);
    }
    if let Some(v) = payload.encoder_preset {
        let _ = db.set_config("encoder_preset", &v);
    }
    if let Some(v) = payload.crf {
        let _ = db.set_config("crf", &v.to_string());
    }
    if let Some(v) = payload.auto_archive_enabled {
        let _ = db.set_config("auto_archive_enabled", if v { "true" } else { "false" });
    }
    if let Some(v) = payload.auto_archive_interval_mins {
        let _ = db.set_config("auto_archive_interval_mins", &v.to_string());
    }
    if let Some(v) = payload.max_storage_gb {
        let capped = if v < 1 { 100 } else { v };
        let _ = db.set_config("max_storage_gb", &capped.to_string());
    }

    Ok(StatusCode::OK)
}

async fn trigger_watcher_handler(State(state): State<AppState>) -> Result<Json<serde_json::Value>, StatusCode> {
    match check_channel_and_archive(&state).await {
        Ok(count) => Ok(Json(serde_json::json!({
            "success": true,
            "queued_jobs": count,
            "message": format!("Watcher check complete: {} jobs queued", count)
        }))),
        Err(e) => Ok(Json(serde_json::json!({
            "success": false,
            "queued_jobs": 0,
            "error": e
        }))),
    }
}

#[cfg(test)]
mod tests {
    use super::disk_stats_for_path;
    use std::path::Path;

    #[test]
    fn picks_longest_mount_prefix() {
        let disks = [
            (Path::new("/"), 10u64, 5u64),
            (Path::new("/data"), 100, 50),
            (Path::new("/dev"), 1, 1),
        ];
        assert_eq!(
            disk_stats_for_path(Path::new("/data/completed"), disks),
            (100, 50)
        );
    }

    #[test]
    fn picks_root_when_only_root_mounted() {
        let disks = [(Path::new("/"), 10u64, 5u64)];
        assert_eq!(disk_stats_for_path(Path::new("/app/data"), disks), (10, 5));
    }

    #[test]
    fn data_other_does_not_match_data_mount() {
        let disks = [
            (Path::new("/"), 10u64, 5u64),
            (Path::new("/data"), 100, 50),
            (Path::new("/dev"), 1, 1),
        ];
        assert_eq!(
            disk_stats_for_path(Path::new("/data-other"), disks),
            (10, 5)
        );
    }

    #[test]
    fn empty_disk_list_is_zero() {
        let disks: [(&Path, u64, u64); 0] = [];
        assert_eq!(disk_stats_for_path(Path::new("/data"), disks), (0, 0));
    }

    #[cfg(windows)]
    #[test]
    fn strips_windows_verbatim_prefix() {
        let disks = [
            (Path::new(r"D:\"), 999u64, 888u64),
            (Path::new(r"C:\"), 100, 50),
        ];
        assert_eq!(
            disk_stats_for_path(Path::new(r"\\?\C:\data\completed"), disks),
            (100, 50)
        );
    }
}
