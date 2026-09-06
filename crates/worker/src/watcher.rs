use crate::queue::spawn_worker_job;
use crate::state::AppState;
use std::time::Duration;
use tracing::{error, info};
use uuid::Uuid;
use vod_core::pipeline::PipelineConfig;
use vod_core::storage_s3::S3Credentials;
use vod_core::twitch::{get_app_access_token, get_vod_qualities, get_vods, resolve_twitch_credentials};

pub async fn run_autonomous_watcher(state: AppState) {
    info!("Starting autonomous Twitch channel watcher loop");

    loop {
        // Read interval from config (default 15 mins)
        let interval_mins: u64 = state
            .db
            .get_config("auto_archive_interval_mins")
            .ok()
            .flatten()
            .and_then(|v| v.parse().ok())
            .unwrap_or(15);

        // Sleep for the interval
        tokio::time::sleep(Duration::from_secs(interval_mins * 60)).await;

        if let Err(e) = check_channel_and_archive(&state).await {
            error!("Autonomous watcher check failed: {}", e);
        }
    }
}

pub async fn check_channel_and_archive(state: &AppState) -> Result<usize, String> {
    let enabled = state
        .db
        .get_config("auto_archive_enabled")
        .ok()
        .flatten()
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    if !enabled {
        return Ok(0);
    }

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
        let (_, used, _) =
            crate::storage_quota::storage_quota_stats(&completed_dir, max_storage_gb);
        info!(
            "Autonomous watcher: storage quota full ({:.1} GB / {} GB) — skipping new archives",
            used, max_storage_gb
        );
        return Ok(0);
    }

    let client_id = state
        .db
        .get_config("twitch_client_id")
        .ok()
        .flatten()
        .unwrap_or_default();
    let client_secret = state
        .db
        .get_config("twitch_client_secret")
        .ok()
        .flatten()
        .unwrap_or_default();
    let (client_id, client_secret) = resolve_twitch_credentials(&client_id, &client_secret);
    let user_id = state
        .db
        .get_config("twitch_user_id")
        .ok()
        .flatten()
        .unwrap_or_default();

    if client_id.is_empty() || client_secret.is_empty() || user_id.is_empty() {
        return Err("Twitch credentials or User ID not configured for autonomous watcher".into());
    }

    info!("Autonomous watcher: checking for new VODs for user {}", user_id);

    // Get app access token for autonomous check
    let app_token = get_app_access_token(&client_id, &client_secret)
        .await
        .map_err(|e| format!("Failed to obtain Twitch token: {}", e))?;

    let vods = get_vods(&client_id, &app_token, &user_id)
        .await
        .map_err(|e| format!("Failed to list channel VODs: {}", e))?;

    let mut queued_count = 0;

    for vod in vods {
        // Skip if already archived or currently in progress
        if state.db.has_vod_been_archived(&vod.id) {
            continue;
        }

        // Check if there is already an active/queued job for this VOD
        if let Ok(jobs) = state.db.list_jobs() {
            if jobs.iter().any(|j| j.vod_id == vod.id && (j.status == "queued" || j.status == "downloading" || j.status == "compressing" || j.status == "uploading_s3")) {
                continue;
            }
        }

        info!("Autonomous watcher: Found new stream archive: #{} - '{}'", vod.id, vod.title);

        // Fetch stream qualities
        let qualities = match get_vod_qualities(&app_token, &vod.id).await {
            Ok(q) if !q.is_empty() => q,
            Ok(_) => continue,
            Err(e) => {
                error!("Failed to fetch qualities for VOD #{}: {}", vod.id, e);
                continue;
            }
        };

        let best_quality = qualities[0].url.clone();

        // Read S3 config
        let s3_ep = state.db.get_config("s3_endpoint").ok().flatten().unwrap_or_default();
        let s3_reg = state.db.get_config("s3_region").ok().flatten().unwrap_or_else(|| "auto".to_string());
        let s3_bkt = state.db.get_config("s3_bucket").ok().flatten().unwrap_or_default();
        let s3_ak = state.db.get_config("s3_access_key").ok().flatten().unwrap_or_default();
        let s3_sk = state.db.get_config("s3_secret_key").ok().flatten().unwrap_or_default();

        let has_s3 = !s3_ep.is_empty() && !s3_bkt.is_empty();
        let s3_config = if has_s3 {
            Some(S3Credentials {
                endpoint: s3_ep,
                region: s3_reg,
                bucket: s3_bkt,
                access_key: s3_ak,
                secret_key: s3_sk,
            })
        } else {
            None
        };

        let gdrive_cid = state.db.get_config("gdrive_client_id").ok().flatten().unwrap_or_default();
        let gdrive_cs = state.db.get_config("gdrive_client_secret").ok().flatten().unwrap_or_default();
        let (gdrive_cid, gdrive_cs) =
            vod_core::storage_gdrive::resolve_gdrive_credentials(&gdrive_cid, &gdrive_cs);
        let gdrive_tok = state.db.get_config("gdrive_access_token").ok().flatten().unwrap_or_default();
        let gdrive_rtok = state.db.get_config("gdrive_refresh_token").ok().flatten();
        let gdrive_fid = state.db.get_config("gdrive_folder_id").ok().flatten();
        let has_real_gdrive_client = !gdrive_cid.is_empty()
            && gdrive_cid != vod_core::storage_gdrive::DEFAULT_GDRIVE_CLIENT_ID;
        let has_gdrive = (!gdrive_tok.is_empty() || gdrive_rtok.is_some())
            && (has_real_gdrive_client || !gdrive_tok.is_empty());
        let gdrive_config = if has_gdrive {
            Some(vod_core::storage_gdrive::GDriveCredentials {
                client_id: gdrive_cid,
                client_secret: gdrive_cs,
                access_token: gdrive_tok,
                refresh_token: gdrive_rtok,
                folder_id: gdrive_fid,
            })
        } else {
            None
        };

        let webdav_ep = state.db.get_config("webdav_endpoint").ok().flatten().unwrap_or_default();
        let webdav_u = state.db.get_config("webdav_username").ok().flatten().unwrap_or_default();
        let webdav_p = state.db.get_config("webdav_password").ok().flatten().unwrap_or_default();
        let webdav_f = state.db.get_config("webdav_folder").ok().flatten();
        let has_webdav = !webdav_ep.is_empty() && !webdav_u.is_empty();
        let webdav_config = if has_webdav {
            Some(vod_core::storage_webdav::WebDavCredentials {
                endpoint: webdav_ep,
                username: webdav_u,
                password: webdav_p,
                folder: webdav_f,
            })
        } else {
            None
        };

        let preset = state.db.get_config("encoder_preset").ok().flatten().unwrap_or_else(|| "libx264".to_string());
        let crf = state.db.get_config("crf").ok().flatten().and_then(|v| v.parse().ok()).unwrap_or(24);
        let save_local = state.db.get_config("save_local").ok().flatten().map(|v| v == "true").unwrap_or(true);

        let job_id = Uuid::new_v4().to_string();

        let _ = state.db.insert_job(
            &job_id,
            &vod.id,
            &vod.title,
            "queued",
        );

        let config = PipelineConfig {
            vod_id: vod.id,
            playlist_url: best_quality,
            preset,
            crf,
            duration_secs: None,
            start_secs: None,
            end_secs: None,
            save_local,
            local_output_dir: Some(state.data_dir.join("completed").to_string_lossy().to_string()),
            upload_to_s3: has_s3,
            s3_config,
            upload_to_gdrive: has_gdrive,
            gdrive_config,
            upload_to_webdav: has_webdav,
            webdav_config,
            upload_to_youtube: false,
            youtube_token: None,
            youtube_metadata: None,
            delete_from_twitch_after: false,
            twitch_client_id: None,
            twitch_token: None,
        };

        spawn_worker_job(state.clone(), job_id, config);
        queued_count += 1;
    }

    Ok(queued_count)
}
