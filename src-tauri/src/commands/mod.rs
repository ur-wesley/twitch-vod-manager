use crate::error::StableError;
use crate::modules::compressor::{
    detect_ffmpeg as detect_ffmpeg_impl, detect_system_hardware, FfmpegInfo, SystemHardwareInfo,
};
use crate::modules::settings::{get_config_path, save_settings as save_settings_impl, AppSettings};
use crate::modules::storage_s3::{
    delete_s3_object, download_vod_from_s3, list_bucket_vods, S3Object,
};
use crate::modules::twitch::{
    get_user_by_id, get_user_by_login, get_user_info, get_vod_qualities, get_vods,
    start_oauth_flow, TwitchUser, TwitchVod, VodQuality,
};
use crate::modules::youtube::{
    start_google_oauth, upload_video_to_youtube,
};
use vod_core::YouTubeVideoMetadata;
use crate::state::AppState;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};

mod updater;
pub use updater::*;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, StableError> {
    Ok(state.settings.read().await.clone())
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), StableError> {
    let path = get_config_path(&app)?;
    save_settings_impl(&path, &settings)?;
    *state.settings.write().await = settings;
    Ok(())
}

#[tauri::command]
pub async fn login_twitch(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TwitchUser, StableError> {
    let (client_id, client_secret) = {
        let s = state.settings.read().await;
        (s.twitch_client_id.clone(), s.twitch_client_secret.clone())
    };

    let (effective_client_id, effective_client_secret) =
        vod_core::twitch::resolve_twitch_credentials(&client_id, &client_secret);

    let (access_token, refresh_token) =
        start_oauth_flow(&effective_client_id, &effective_client_secret).await?;
    let user = get_user_info(&effective_client_id, &access_token).await?;

    let mut settings = state.settings.read().await.clone();
    settings.twitch_access_token = Some(access_token);
    settings.twitch_refresh_token = refresh_token;
    settings.twitch_user_id = Some(user.id.clone());
    settings.twitch_username = Some(user.login.clone());

    let path = get_config_path(&app)?;
    save_settings_impl(&path, &settings)?;
    *state.settings.write().await = settings;

    Ok(user)
}

#[tauri::command]
pub async fn logout_twitch(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), StableError> {
    let mut settings = state.settings.read().await.clone();
    settings.twitch_access_token = None;
    settings.twitch_refresh_token = None;
    settings.twitch_user_id = None;
    settings.twitch_username = None;

    let path = get_config_path(&app)?;
    save_settings_impl(&path, &settings)?;
    *state.settings.write().await = settings;

    Ok(())
}

#[tauri::command]
pub async fn set_twitch_token(
    app: AppHandle,
    state: State<'_, AppState>,
    token: String,
) -> Result<TwitchUser, StableError> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(StableError::new("AUTH_ERROR", "Token cannot be empty"));
    }

    let client_id = {
        let s = state.settings.read().await;
        let (cid, _) = vod_core::twitch::resolve_twitch_credentials(&s.twitch_client_id, "");
        cid
    };

    let user = get_user_info(&client_id, &token).await?;
    let mut settings = state.settings.read().await.clone();
    settings.twitch_access_token = Some(token);
    settings.twitch_refresh_token = None;
    settings.twitch_user_id = Some(user.id.clone());
    settings.twitch_username = Some(user.login.clone());

    let path = get_config_path(&app)?;
    save_settings_impl(&path, &settings)?;
    *state.settings.write().await = settings;

    Ok(user)
}

#[tauri::command]
pub async fn get_twitch_user(state: State<'_, AppState>) -> Result<TwitchUser, StableError> {
    let (client_id, token) = {
        let s = state.settings.read().await;
        (
            s.twitch_client_id.clone(),
            s.twitch_access_token.clone().unwrap_or_default(),
        )
    };
    if token.is_empty() {
        return Err(StableError::new(
            "AUTH_ERROR",
            "Not authenticated with Twitch",
        ));
    }
    let (client_id, _) =
        vod_core::twitch::resolve_twitch_credentials(&client_id, "");
    get_user_info(&client_id, &token).await.map_err(Into::into)
}

#[tauri::command]
pub async fn list_vods(
    state: State<'_, AppState>,
    channel: Option<String>,
) -> Result<Vec<TwitchVod>, StableError> {
    let (client_id, client_secret, user_token, default_user_id, target_channel) = {
        let s = state.settings.read().await;
        (
            s.twitch_client_id.clone(),
            s.twitch_client_secret.clone(),
            s.twitch_access_token.clone().unwrap_or_default(),
            s.twitch_user_id.clone().unwrap_or_default(),
            s.twitch_target_channel.clone().unwrap_or_default(),
        )
    };

    let (client_id, client_secret) =
        vod_core::twitch::resolve_twitch_credentials(&client_id, &client_secret);

    let token = if !user_token.is_empty() {
        user_token
    } else if !client_id.is_empty() && !client_secret.is_empty() {
        vod_core::twitch::get_app_access_token(&client_id, &client_secret)
            .await
            .map_err(StableError::from)?
    } else {
        return Err(StableError::new(
            "AUTH_ERROR",
            "Please login to Twitch or configure Twitch Client ID + Secret in Settings",
        ));
    };

    let channel_input = channel
        .filter(|c| !c.trim().is_empty())
        .or_else(|| if !target_channel.trim().is_empty() { Some(target_channel) } else { None })
        .or_else(|| if !default_user_id.trim().is_empty() { Some(default_user_id) } else { None });

    let channel_str = match channel_input {
        Some(c) => c.trim().trim_start_matches('@').to_string(),
        None => {
            return Err(StableError::new(
                "AUTH_ERROR",
                "No Twitch channel specified. Please login to Twitch or enter a channel name/ID.",
            ));
        }
    };

    let user_id = if channel_str.chars().all(|c| c.is_ascii_digit()) {
        channel_str
    } else {
        let user = get_user_by_login(&client_id, &token, &channel_str)
            .await
            .map_err(|e| StableError::new("TWITCH_ERROR", format!("Could not find channel @{}: {}", channel_str, e)))?;
        user.id
    };

    get_vods(&client_id, &token, &user_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn resolve_channel(
    state: State<'_, AppState>,
    channel: String,
) -> Result<TwitchUser, StableError> {
    let (client_id, client_secret, user_token) = {
        let s = state.settings.read().await;
        (
            s.twitch_client_id.clone(),
            s.twitch_client_secret.clone(),
            s.twitch_access_token.clone().unwrap_or_default(),
        )
    };

    let (client_id, client_secret) =
        vod_core::twitch::resolve_twitch_credentials(&client_id, &client_secret);

    let token = if !user_token.is_empty() {
        user_token
    } else if !client_id.is_empty() && !client_secret.is_empty() {
        vod_core::twitch::get_app_access_token(&client_id, &client_secret)
            .await
            .map_err(StableError::from)?
    } else {
        return Err(StableError::new(
            "AUTH_ERROR",
            "Please login to Twitch or configure Twitch Client ID + Secret in Settings",
        ));
    };

    let clean = channel.trim().trim_start_matches('@');
    if clean.is_empty() {
        return Err(StableError::new("INVALID_INPUT", "Channel cannot be empty"));
    }

    if clean.chars().all(|c| c.is_ascii_digit()) {
        get_user_by_id(&client_id, &token, clean)
            .await
            .map_err(Into::into)
    } else {
        get_user_by_login(&client_id, &token, clean)
            .await
            .map_err(Into::into)
    }
}

#[tauri::command]
pub async fn get_qualities(
    state: State<'_, AppState>,
    vod_id: String,
) -> Result<Vec<VodQuality>, StableError> {
    let token = {
        state
            .settings
            .read()
            .await
            .twitch_access_token
            .clone()
            .unwrap_or_default()
    };
    get_vod_qualities(&token, &vod_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn import_settings_toml(
    app: AppHandle,
    state: State<'_, AppState>,
    toml_str: String,
) -> Result<AppSettings, StableError> {
    let current = state.settings.read().await.clone();
    let settings = AppSettings::from_toml_merge(&current, &toml_str)?;
    let path = get_config_path(&app)?;
    save_settings_impl(&path, &settings)?;
    *state.settings.write().await = settings.clone();
    Ok(settings)
}

#[tauri::command]
pub async fn export_settings_toml(state: State<'_, AppState>) -> Result<String, StableError> {
    let settings = state.settings.read().await;
    Ok(settings.to_toml())
}

#[tauri::command]
pub async fn detect_ffmpeg(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<FfmpegInfo, StableError> {
    let custom_path = {
        let s = state.settings.read().await;
        s.ffmpeg_path.clone()
    };
    Ok(detect_ffmpeg_impl(custom_path.as_deref(), Some(&app)).await)
}

#[tauri::command]
pub async fn get_system_hardware_info(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SystemHardwareInfo, StableError> {
    let custom_path = {
        let s = state.settings.read().await;
        s.ffmpeg_path.clone()
    };
    Ok(detect_system_hardware(custom_path.as_deref(), Some(&app)).await)
}

#[tauri::command]
pub async fn download_and_install_ffmpeg(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<FfmpegInfo, StableError> {
    let info = crate::modules::compressor::download_and_install_ffmpeg(&app).await?;
    if info.available {
        let mut settings = state.settings.read().await.clone();
        settings.ffmpeg_path = Some(info.path.clone());
        let path = get_config_path(&app)?;
        let _ = save_settings_impl(&path, &settings);
        *state.settings.write().await = settings;
    }
    Ok(info)
}

#[tauri::command]
pub async fn cancel_active_task(state: State<'_, AppState>) -> Result<(), StableError> {
    state.is_cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

struct TauriProgressReporter {
    app: AppHandle,
}

impl vod_core::reporter::ProgressReporter for TauriProgressReporter {
    fn report_download(&self, p: &vod_core::reporter::DownloadProgress) {
        use tauri::Emitter;
        let _ = self.app.emit("download-progress", p);
    }
    fn report_compression(&self, p: &vod_core::reporter::CompressionProgress) {
        use tauri::Emitter;
        let _ = self.app.emit("compression-progress", p);
    }
    fn report_s3(&self, p: &vod_core::reporter::S3TransferProgress) {
        use tauri::Emitter;
        let _ = self.app.emit("s3-upload-progress", p);
    }
    fn report_youtube(&self, p: &vod_core::reporter::YouTubeUploadProgress) {
        use tauri::Emitter;
        let _ = self.app.emit("youtube-upload-progress", p);
    }
    fn report_drive(&self, p: &vod_core::reporter::DriveTransferProgress) {
        use tauri::Emitter;
        let _ = self.app.emit("drive-upload-progress", p);
    }
    fn report_stage(&self, vod_id: &str, stage: &str, message: &str) {
        use tauri::Emitter;
        let _ = self.app.emit(
            "pipeline-stage",
            serde_json::json!({ "vod_id": vod_id, "stage": stage, "message": message }),
        );
    }
    fn report_log(&self, vod_id: &str, message: &str) {
        use tauri::Emitter;
        let _ = self.app.emit(
            "pipeline-log",
            serde_json::json!({ "vod_id": vod_id, "message": message }),
        );
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_pipeline(
    app: AppHandle,
    state: State<'_, AppState>,
    vod_id: String,
    playlist_url: String,
    preset: String,
    crf: u8,
    duration_secs: Option<f64>,
    start_secs: Option<f64>,
    end_secs: Option<f64>,
    save_local: Option<bool>,
    upload_to_s3: Option<bool>,
    upload_to_gdrive: Option<bool>,
    upload_to_webdav: Option<bool>,
    upload_to_youtube: Option<bool>,
    youtube_metadata: Option<YouTubeVideoMetadata>,
    delete_from_twitch_after: Option<bool>,
) -> Result<String, StableError> {
    state.is_cancelled.store(false, Ordering::Relaxed);
    *state.active_vod_id.write().await = Some(vod_id.clone());

    let (s3_ep, s3_reg, s3_bkt, s3_ak, s3_sk, custom_temp, custom_out, twitch_cid, twitch_token, yt_token,
         gdrive_cid, gdrive_cs, gdrive_tok, gdrive_rtok, gdrive_fid,
         webdav_ep, webdav_u, webdav_p, webdav_f) = {
        let s = state.settings.read().await;
        (
            s.s3_endpoint.clone(),
            s.s3_region.clone(),
            s.s3_bucket.clone(),
            s.s3_access_key.clone(),
            s.s3_secret_key.clone(),
            s.temp_dir.clone(),
            s.output_dir.clone(),
            s.twitch_client_id.clone(),
            s.twitch_access_token.clone(),
            s.youtube_access_token.clone(),
            s.gdrive_client_id.clone().unwrap_or_default(),
            s.gdrive_client_secret.clone().unwrap_or_default(),
            s.gdrive_access_token.clone().unwrap_or_default(),
            s.gdrive_refresh_token.clone(),
            s.gdrive_folder_id.clone(),
            s.webdav_endpoint.clone().unwrap_or_default(),
            s.webdav_username.clone().unwrap_or_default(),
            s.webdav_password.clone().unwrap_or_default(),
            s.webdav_folder.clone(),
        )
    };

    let (twitch_cid, _) =
        vod_core::twitch::resolve_twitch_credentials(&twitch_cid, "");

    let do_upload_s3 = upload_to_s3.unwrap_or(true);
    let s3_config = if do_upload_s3 && !s3_ep.is_empty() && !s3_bkt.is_empty() {
        Some(vod_core::storage_s3::S3Credentials {
            endpoint: s3_ep,
            region: s3_reg,
            bucket: s3_bkt,
            access_key: s3_ak,
            secret_key: s3_sk,
        })
    } else {
        None
    };

    let do_upload_gdrive = upload_to_gdrive.unwrap_or(false);
    let (gdrive_cid, gdrive_cs) =
        vod_core::storage_gdrive::resolve_gdrive_credentials(&gdrive_cid, &gdrive_cs);
    let gdrive_config = if do_upload_gdrive && (!gdrive_tok.is_empty() || gdrive_rtok.is_some()) {
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

    let do_upload_webdav = upload_to_webdav.unwrap_or(false);
    let webdav_config = if do_upload_webdav && !webdav_ep.is_empty() {
        Some(vod_core::storage_webdav::WebDavCredentials {
            endpoint: webdav_ep,
            username: webdav_u,
            password: webdav_p,
            folder: webdav_f,
        })
    } else {
        None
    };

    let config = vod_core::pipeline::PipelineConfig {
        vod_id: vod_id.clone(),
        playlist_url,
        preset,
        crf,
        duration_secs,
        start_secs,
        end_secs,
        save_local: save_local.unwrap_or(true),
        local_output_dir: custom_out,
        upload_to_s3: do_upload_s3,
        s3_config,
        upload_to_gdrive: do_upload_gdrive,
        gdrive_config,
        upload_to_webdav: do_upload_webdav,
        webdav_config,
        upload_to_youtube: upload_to_youtube.unwrap_or(false),
        youtube_token: yt_token,
        youtube_metadata,
        delete_from_twitch_after: delete_from_twitch_after.unwrap_or(false),
        twitch_client_id: Some(twitch_cid),
        twitch_token,
    };

    let reporter = std::sync::Arc::new(TauriProgressReporter { app: app.clone() });
    let temp_override = custom_temp.map(PathBuf::from);
    let is_cancelled = state.is_cancelled.clone();

    tokio::spawn(async move {
        let _ = vod_core::pipeline::run_archive_pipeline(
            reporter,
            config,
            temp_override,
            is_cancelled,
        )
        .await;
    });

    Ok(format!("Pipeline initiated for VOD {}", vod_id))
}

#[tauri::command]
pub async fn list_s3_vods(state: State<'_, AppState>) -> Result<Vec<S3Object>, StableError> {
    let (ep, reg, bkt, ak, sk) = {
        let s = state.settings.read().await;
        (
            s.s3_endpoint.clone(),
            s.s3_region.clone(),
            s.s3_bucket.clone(),
            s.s3_access_key.clone(),
            s.s3_secret_key.clone(),
        )
    };
    if ep.is_empty() || bkt.is_empty() {
        return Err(StableError::new(
            "CONFIG_ERROR",
            "S3 Endpoint and Bucket must be configured in Settings",
        ));
    }
    list_bucket_vods(&ep, &reg, &bkt, &ak, &sk)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn download_s3_vod(
    app: AppHandle,
    state: State<'_, AppState>,
    object_key: String,
    destination_path: String,
) -> Result<(), StableError> {
    let (ep, reg, bkt, ak, sk) = {
        let s = state.settings.read().await;
        (
            s.s3_endpoint.clone(),
            s.s3_region.clone(),
            s.s3_bucket.clone(),
            s.s3_access_key.clone(),
            s.s3_secret_key.clone(),
        )
    };
    let dest = PathBuf::from(destination_path);
    let vod_id = object_key
        .trim_start_matches("vods/")
        .trim_end_matches(".mp4");
    state.is_cancelled.store(false, Ordering::Relaxed);

    download_vod_from_s3(
        &app,
        vod_id,
        &ep,
        &reg,
        &bkt,
        &ak,
        &sk,
        &object_key,
        &dest,
        state.is_cancelled.clone(),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_s3_vod(
    state: State<'_, AppState>,
    object_key: String,
) -> Result<(), StableError> {
    let (ep, reg, bkt, ak, sk) = {
        let s = state.settings.read().await;
        (
            s.s3_endpoint.clone(),
            s.s3_region.clone(),
            s.s3_bucket.clone(),
            s.s3_access_key.clone(),
            s.s3_secret_key.clone(),
        )
    };
    delete_s3_object(&ep, &reg, &bkt, &ak, &sk, &object_key)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn login_gdrive(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, StableError> {
    let (client_id, client_secret) = {
        let s = state.settings.read().await;
        let gd_id = s.gdrive_client_id.clone().unwrap_or_default();
        let gd_sec = s.gdrive_client_secret.clone().unwrap_or_default();
        if !gd_id.trim().is_empty() {
            (gd_id, gd_sec)
        } else {
            (
                s.youtube_client_id.clone().unwrap_or_default(),
                s.youtube_client_secret.clone().unwrap_or_default(),
            )
        }
    };

    let (access_token, refresh_token) =
        vod_core::storage_gdrive::start_gdrive_oauth(&client_id, &client_secret).await?;
    let mut settings = state.settings.read().await.clone();
    settings.gdrive_access_token = Some(access_token);
    settings.gdrive_refresh_token = refresh_token;

    let path = get_config_path(&app)?;
    save_settings_impl(&path, &settings)?;
    *state.settings.write().await = settings;

    Ok(true)
}

#[tauri::command]
pub async fn logout_gdrive(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, StableError> {
    let mut settings = state.settings.read().await.clone();
    settings.gdrive_access_token = None;
    settings.gdrive_refresh_token = None;

    let path = get_config_path(&app)?;
    save_settings_impl(&path, &settings)?;
    *state.settings.write().await = settings;

    Ok(true)
}

#[tauri::command]
pub async fn list_gdrive_vods(state: State<'_, AppState>) -> Result<Vec<vod_core::GoogleDriveFile>, StableError> {
    let (client_id, client_secret, token, refresh_token, folder_id) = {
        let s = state.settings.read().await;
        (
            s.gdrive_client_id.clone().unwrap_or_default(),
            s.gdrive_client_secret.clone().unwrap_or_default(),
            s.gdrive_access_token.clone().unwrap_or_default(),
            s.gdrive_refresh_token.clone(),
            s.gdrive_folder_id.clone(),
        )
    };
    if token.is_empty() {
        return Err(StableError::new(
            "AUTH_ERROR",
            "Please connect your Google Drive account in Settings first",
        ));
    }

    vod_core::storage_gdrive::list_gdrive_vods(
        &client_id,
        &client_secret,
        &token,
        refresh_token.as_deref(),
        folder_id.as_deref(),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn get_gdrive_quota(state: State<'_, AppState>) -> Result<vod_core::StorageQuota, StableError> {
    let (client_id, client_secret, token, refresh_token) = {
        let s = state.settings.read().await;
        (
            s.gdrive_client_id.clone().unwrap_or_default(),
            s.gdrive_client_secret.clone().unwrap_or_default(),
            s.gdrive_access_token.clone().unwrap_or_default(),
            s.gdrive_refresh_token.clone(),
        )
    };
    if token.is_empty() {
        return Err(StableError::new(
            "AUTH_ERROR",
            "Please connect your Google Drive account in Settings first",
        ));
    }

    vod_core::storage_gdrive::get_gdrive_quota(
        &client_id,
        &client_secret,
        &token,
        refresh_token.as_deref(),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_gdrive_vod(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<(), StableError> {
    let (client_id, client_secret, token, refresh_token) = {
        let s = state.settings.read().await;
        (
            s.gdrive_client_id.clone().unwrap_or_default(),
            s.gdrive_client_secret.clone().unwrap_or_default(),
            s.gdrive_access_token.clone().unwrap_or_default(),
            s.gdrive_refresh_token.clone(),
        )
    };
    if token.is_empty() {
        return Err(StableError::new(
            "AUTH_ERROR",
            "Please connect your Google Drive account in Settings first",
        ));
    }

    vod_core::storage_gdrive::delete_gdrive_object(
        &client_id,
        &client_secret,
        &token,
        refresh_token.as_deref(),
        &file_id,
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn download_gdrive_vod(
    app: AppHandle,
    state: State<'_, AppState>,
    file_id: String,
    vod_id: String,
    destination_path: String,
) -> Result<(), StableError> {
    let (client_id, client_secret, token, refresh_token) = {
        let s = state.settings.read().await;
        (
            s.gdrive_client_id.clone().unwrap_or_default(),
            s.gdrive_client_secret.clone().unwrap_or_default(),
            s.gdrive_access_token.clone().unwrap_or_default(),
            s.gdrive_refresh_token.clone(),
        )
    };
    if token.is_empty() {
        return Err(StableError::new(
            "AUTH_ERROR",
            "Please connect your Google Drive account in Settings first",
        ));
    }

    let dest = PathBuf::from(destination_path);
    state.is_cancelled.store(false, Ordering::Relaxed);
    let reporter = std::sync::Arc::new(TauriProgressReporter { app: app.clone() });

    vod_core::storage_gdrive::download_gdrive_file(
        reporter,
        &vod_id,
        &client_id,
        &client_secret,
        &token,
        refresh_token.as_deref(),
        &file_id,
        &dest,
        state.is_cancelled.clone(),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn list_webdav_vods(state: State<'_, AppState>) -> Result<Vec<vod_core::WebDavFile>, StableError> {
    let creds = {
        let s = state.settings.read().await;
        vod_core::storage_webdav::WebDavCredentials {
            endpoint: s.webdav_endpoint.clone().unwrap_or_default(),
            username: s.webdav_username.clone().unwrap_or_default(),
            password: s.webdav_password.clone().unwrap_or_default(),
            folder: s.webdav_folder.clone(),
        }
    };
    if creds.endpoint.is_empty() {
        return Err(StableError::new(
            "CONFIG_ERROR",
            "WebDAV Endpoint must be configured in Settings",
        ));
    }

    vod_core::storage_webdav::list_webdav_vods(&creds)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_webdav_quota(state: State<'_, AppState>) -> Result<vod_core::StorageQuota, StableError> {
    let creds = {
        let s = state.settings.read().await;
        vod_core::storage_webdav::WebDavCredentials {
            endpoint: s.webdav_endpoint.clone().unwrap_or_default(),
            username: s.webdav_username.clone().unwrap_or_default(),
            password: s.webdav_password.clone().unwrap_or_default(),
            folder: s.webdav_folder.clone(),
        }
    };
    if creds.endpoint.is_empty() {
        return Err(StableError::new(
            "CONFIG_ERROR",
            "WebDAV Endpoint must be configured in Settings",
        ));
    }

    vod_core::storage_webdav::get_webdav_quota(&creds)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_webdav_vod(
    state: State<'_, AppState>,
    filename_or_href: String,
) -> Result<(), StableError> {
    let creds = {
        let s = state.settings.read().await;
        vod_core::storage_webdav::WebDavCredentials {
            endpoint: s.webdav_endpoint.clone().unwrap_or_default(),
            username: s.webdav_username.clone().unwrap_or_default(),
            password: s.webdav_password.clone().unwrap_or_default(),
            folder: s.webdav_folder.clone(),
        }
    };
    if creds.endpoint.is_empty() {
        return Err(StableError::new(
            "CONFIG_ERROR",
            "WebDAV Endpoint must be configured in Settings",
        ));
    }

    vod_core::storage_webdav::delete_webdav_object(&creds, &filename_or_href)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn download_webdav_vod(
    app: AppHandle,
    state: State<'_, AppState>,
    filename_or_href: String,
    vod_id: String,
    destination_path: String,
) -> Result<(), StableError> {
    let creds = {
        let s = state.settings.read().await;
        vod_core::storage_webdav::WebDavCredentials {
            endpoint: s.webdav_endpoint.clone().unwrap_or_default(),
            username: s.webdav_username.clone().unwrap_or_default(),
            password: s.webdav_password.clone().unwrap_or_default(),
            folder: s.webdav_folder.clone(),
        }
    };
    if creds.endpoint.is_empty() {
        return Err(StableError::new(
            "CONFIG_ERROR",
            "WebDAV Endpoint must be configured in Settings",
        ));
    }

    let dest = PathBuf::from(destination_path);
    state.is_cancelled.store(false, Ordering::Relaxed);
    let reporter = std::sync::Arc::new(TauriProgressReporter { app: app.clone() });

    vod_core::storage_webdav::download_webdav_file(
        reporter,
        &vod_id,
        &creds,
        &filename_or_href,
        &dest,
        state.is_cancelled.clone(),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn login_youtube(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, StableError> {
    let (client_id, client_secret) = {
        let s = state.settings.read().await;
        (
            s.youtube_client_id.clone().unwrap_or_default(),
            s.youtube_client_secret.clone().unwrap_or_default(),
        )
    };

    let (access_token, refresh_token) =
        start_google_oauth(&client_id, &client_secret).await?;
    let mut settings = state.settings.read().await.clone();
    settings.youtube_access_token = Some(access_token);
    settings.youtube_refresh_token = refresh_token;

    let path = get_config_path(&app)?;
    save_settings_impl(&path, &settings)?;
    *state.settings.write().await = settings;

    Ok(true)
}

#[tauri::command]
pub async fn logout_youtube(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), StableError> {
    let mut settings = state.settings.read().await.clone();
    settings.youtube_access_token = None;
    settings.youtube_refresh_token = None;

    let path = get_config_path(&app)?;
    save_settings_impl(&path, &settings)?;
    *state.settings.write().await = settings;

    Ok(())
}

#[tauri::command]
pub async fn set_youtube_token(
    app: AppHandle,
    state: State<'_, AppState>,
    token: String,
) -> Result<(), StableError> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(StableError::new("AUTH_ERROR", "Token cannot be empty"));
    }

    let mut settings = state.settings.read().await.clone();
    settings.youtube_access_token = Some(token);
    settings.youtube_refresh_token = None;

    let path = get_config_path(&app)?;
    save_settings_impl(&path, &settings)?;
    *state.settings.write().await = settings;

    Ok(())
}

#[tauri::command]
pub async fn publish_to_youtube(
    app: AppHandle,
    state: State<'_, AppState>,
    vod_id: String,
    local_video_path: String,
    metadata: YouTubeVideoMetadata,
) -> Result<String, StableError> {
    let token = {
        state
            .settings
            .read()
            .await
            .youtube_access_token
            .clone()
            .unwrap_or_default()
    };
    if token.is_empty() {
        return Err(StableError::new(
            "AUTH_ERROR",
            "Please connect your YouTube account in Settings first",
        ));
    }

    let path = PathBuf::from(local_video_path);
    state.is_cancelled.store(false, Ordering::Relaxed);

    upload_video_to_youtube(
        &app,
        &vod_id,
        &token,
        &path,
        &metadata,
        state.is_cancelled.clone(),
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn delete_twitch_vod(
    state: State<'_, AppState>,
    vod_id: String,
) -> Result<(), StableError> {
    let (client_id, token) = {
        let s = state.settings.read().await;
        (
            s.twitch_client_id.clone(),
            s.twitch_access_token.clone().unwrap_or_default(),
        )
    };
    let (client_id, _) =
        vod_core::twitch::resolve_twitch_credentials(&client_id, "");
    if token.is_empty() {
        return Err(StableError::new("AUTH_ERROR", "Twitch authentication token missing"));
    }
    vod_core::twitch::delete_vod(&client_id, &token, &vod_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn worker_get_status(
    worker_url: String,
    api_key: Option<String>,
) -> Result<serde_json::Value, StableError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let url = format!("{}/api/status", worker_url.trim_end_matches('/'));
    let mut req = client.get(&url);
    if let Some(ref key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    let res = req.send().await?;
    if !res.status().is_success() {
        return Err(StableError::new("WORKER_ERROR", format!("Worker returned status {}", res.status())));
    }
    let data: serde_json::Value = res.json().await?;
    Ok(data)
}

#[tauri::command]
pub async fn worker_sync_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    worker_url: String,
    api_key: Option<String>,
) -> Result<(), StableError> {
    let s = state.settings.read().await.clone();

    // Proactively resolve real Google Drive OAuth client credentials
    let (resolved_gd_cid, resolved_gd_cs) = {
        let raw_cid = s.gdrive_client_id.as_deref().unwrap_or_default();
        let raw_cs = s.gdrive_client_secret.as_deref().unwrap_or_default();
        let yt_cid = s.youtube_client_id.as_deref().unwrap_or_default();
        let yt_cs = s.youtube_client_secret.as_deref().unwrap_or_default();
        let (c, sec) = if !raw_cid.trim().is_empty() {
            (raw_cid, raw_cs)
        } else if !yt_cid.trim().is_empty() {
            (yt_cid, yt_cs)
        } else {
            ("", "")
        };
        vod_core::storage_gdrive::resolve_gdrive_credentials(c, sec)
    };

    // If refresh token exists and client credentials are valid, proactively refresh the access token
    let mut fresh_gd_tok = s.gdrive_access_token.clone();
    if let Some(ref rtok) = s.gdrive_refresh_token {
        if !rtok.trim().is_empty()
            && resolved_gd_cid != vod_core::storage_gdrive::DEFAULT_GDRIVE_CLIENT_ID
            && !resolved_gd_cid.trim().is_empty()
        {
            if let Ok(new_tok) = vod_core::storage_gdrive::refresh_gdrive_token(
                &resolved_gd_cid,
                &resolved_gd_cs,
                rtok,
            )
            .await
            {
                fresh_gd_tok = Some(new_tok.clone());
                let mut updated_s = s.clone();
                updated_s.gdrive_access_token = Some(new_tok);
                if let Ok(path) = get_config_path(&app) {
                    let _ = save_settings_impl(&path, &updated_s);
                }
                *state.settings.write().await = updated_s;
            }
        }
    }

    let payload = serde_json::json!({
        "twitch_client_id": s.twitch_client_id,
        "twitch_client_secret": s.twitch_client_secret,
        "twitch_user_id": s.twitch_target_channel.as_ref().or(s.twitch_user_id.as_ref()),
        "twitch_username": s.twitch_username,
        "s3_provider": s.s3_provider,
        "s3_endpoint": s.s3_endpoint,
        "s3_region": s.s3_region,
        "s3_bucket": s.s3_bucket,
        "s3_access_key": s.s3_access_key,
        "s3_secret_key": s.s3_secret_key,
        "gdrive_client_id": resolved_gd_cid,
        "gdrive_client_secret": resolved_gd_cs,
        "gdrive_access_token": fresh_gd_tok,
        "gdrive_refresh_token": s.gdrive_refresh_token,
        "gdrive_folder_id": s.gdrive_folder_id,
        "webdav_endpoint": s.webdav_endpoint,
        "webdav_username": s.webdav_username,
        "webdav_password": s.webdav_password,
        "webdav_folder": s.webdav_folder,
        "encoder_preset": s.encoder_preset,
        "crf": s.crf,
        "auto_archive_enabled": s.auto_archive_enabled,
        "auto_archive_interval_mins": s.auto_archive_interval_mins,
        "max_storage_gb": s.max_storage_gb.unwrap_or(100),
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let url = format!("{}/api/sync", worker_url.trim_end_matches('/'));
    let mut req = client.post(&url);
    if let Some(ref key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    let res = req.json(&payload).send().await?;
    if !res.status().is_success() {
        return Err(StableError::new("WORKER_ERROR", format!("Worker sync failed with status {}", res.status())));
    }
    Ok(())
}

#[tauri::command]
pub async fn worker_list_jobs(
    worker_url: String,
    api_key: Option<String>,
) -> Result<serde_json::Value, StableError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let url = format!("{}/api/jobs", worker_url.trim_end_matches('/'));
    let mut req = client.get(&url);
    if let Some(ref key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    let res = req.send().await?;
    if !res.status().is_success() {
        return Err(StableError::new("WORKER_ERROR", format!("Failed to list worker jobs: status {}", res.status())));
    }
    let data: serde_json::Value = res.json().await?;
    Ok(data)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn worker_dispatch_job(
    state: State<'_, AppState>,
    worker_url: String,
    api_key: Option<String>,
    vod_id: String,
    title: String,
    playlist_url: String,
    preset: Option<String>,
    crf: Option<u8>,
    duration_secs: Option<f64>,
    start_secs: Option<f64>,
    end_secs: Option<f64>,
    save_local: Option<bool>,
    upload_to_s3: Option<bool>,
    upload_to_gdrive: Option<bool>,
    gdrive_folder_id: Option<String>,
    upload_to_webdav: Option<bool>,
    webdav_folder: Option<String>,
    upload_to_youtube: Option<bool>,
    youtube_metadata: Option<YouTubeVideoMetadata>,
    delete_from_twitch_after: Option<bool>,
) -> Result<serde_json::Value, StableError> {
    let (s3_ep, s3_reg, s3_bkt, s3_ak, s3_sk, twitch_cid, twitch_token, yt_token, gd_cid, gd_cs, gd_tok, gd_rtok, gd_fid, wd_ep, wd_u, wd_p, wd_f) = {
        let s = state.settings.read().await;
        (
            s.s3_endpoint.clone(),
            s.s3_region.clone(),
            s.s3_bucket.clone(),
            s.s3_access_key.clone(),
            s.s3_secret_key.clone(),
            s.twitch_client_id.clone(),
            s.twitch_access_token.clone(),
            s.youtube_access_token.clone(),
            s.gdrive_client_id.clone(),
            s.gdrive_client_secret.clone(),
            s.gdrive_access_token.clone(),
            s.gdrive_refresh_token.clone(),
            s.gdrive_folder_id.clone(),
            s.webdav_endpoint.clone(),
            s.webdav_username.clone(),
            s.webdav_password.clone(),
            s.webdav_folder.clone(),
        )
    };

    let (twitch_cid, _) =
        vod_core::twitch::resolve_twitch_credentials(&twitch_cid, "");

    let (resolved_gd_cid, resolved_gd_cs) = {
        let raw_cid = gd_cid.as_deref().unwrap_or_default();
        let raw_cs = gd_cs.as_deref().unwrap_or_default();
        let (c, sec) = if !raw_cid.trim().is_empty() {
            (raw_cid, raw_cs)
        } else {
            ("", "")
        };
        vod_core::storage_gdrive::resolve_gdrive_credentials(c, sec)
    };

    let s3_config = if upload_to_s3.unwrap_or(false) && !s3_ep.is_empty() && !s3_bkt.is_empty() {
        Some(serde_json::json!({
            "endpoint": s3_ep,
            "region": s3_reg,
            "bucket": s3_bkt,
            "access_key": s3_ak,
            "secret_key": s3_sk,
        }))
    } else {
        None
    };

    let gdrive_config = if upload_to_gdrive.unwrap_or(false) && (gd_tok.is_some() || gd_rtok.is_some()) {
        Some(serde_json::json!({
            "client_id": resolved_gd_cid,
            "client_secret": resolved_gd_cs,
            "access_token": gd_tok.unwrap_or_default(),
            "refresh_token": gd_rtok,
            "folder_id": gdrive_folder_id.or(gd_fid),
        }))
    } else {
        None
    };

    let webdav_config = if upload_to_webdav.unwrap_or(false) && wd_ep.is_some() {
        Some(serde_json::json!({
            "endpoint": wd_ep.unwrap_or_default(),
            "username": wd_u.unwrap_or_default(),
            "password": wd_p.unwrap_or_default(),
            "folder": webdav_folder.or(wd_f),
        }))
    } else {
        None
    };

    let payload = serde_json::json!({
        "vod_id": vod_id,
        "title": title,
        "playlist_url": playlist_url,
        "preset": preset,
        "crf": crf,
        "duration_secs": duration_secs,
        "start_secs": start_secs,
        "end_secs": end_secs,
        "save_local": save_local,
        "upload_to_s3": upload_to_s3,
        "s3_config": s3_config,
        "upload_to_gdrive": upload_to_gdrive,
        "gdrive_config": gdrive_config,
        "upload_to_webdav": upload_to_webdav,
        "webdav_config": webdav_config,
        "upload_to_youtube": upload_to_youtube,
        "youtube_token": yt_token,
        "youtube_metadata": youtube_metadata,
        "delete_from_twitch_after": delete_from_twitch_after,
        "twitch_client_id": Some(twitch_cid),
        "twitch_token": twitch_token,
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    let url = format!("{}/api/jobs", worker_url.trim_end_matches('/'));
    let mut req = client.post(&url);
    if let Some(ref key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    let res = req.json(&payload).send().await?;
    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(StableError::new("WORKER_ERROR", format!("Failed to dispatch job: {}", err_text)));
    }
    let data: serde_json::Value = res.json().await?;
    Ok(data)
}

#[tauri::command]
pub async fn worker_cancel_job(
    worker_url: String,
    api_key: Option<String>,
    job_id: String,
) -> Result<(), StableError> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/jobs/{}/cancel", worker_url.trim_end_matches('/'), job_id);
    let mut req = client.post(&url);
    if let Some(ref key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    let res = req.send().await?;
    if !res.status().is_success() {
        return Err(StableError::new("WORKER_ERROR", format!("Failed to cancel worker job: status {}", res.status())));
    }
    Ok(())
}

#[tauri::command]
pub async fn worker_get_job_logs(
    worker_url: String,
    api_key: Option<String>,
    job_id: String,
) -> Result<serde_json::Value, StableError> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/jobs/{}/logs", worker_url.trim_end_matches('/'), job_id);
    let mut req = client.get(&url);
    if let Some(ref key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    let res = req.send().await?;
    if !res.status().is_success() {
        return Err(StableError::new("WORKER_ERROR", format!("Failed to get job logs: status {}", res.status())));
    }
    let data: serde_json::Value = res.json().await?;
    Ok(data)
}

#[tauri::command]
pub async fn worker_delete_job(
    worker_url: String,
    api_key: Option<String>,
    job_id: String,
) -> Result<(), StableError> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/jobs/{}", worker_url.trim_end_matches('/'), job_id);
    let mut req = client.delete(&url);
    if let Some(ref key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    let res = req.send().await?;
    if !res.status().is_success() && res.status() != 204 {
        return Err(StableError::new("WORKER_ERROR", format!("Failed to delete worker job: status {}", res.status())));
    }
    Ok(())
}

#[tauri::command]
pub async fn worker_trigger_watcher(
    worker_url: String,
    api_key: Option<String>,
) -> Result<serde_json::Value, StableError> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/watcher/trigger", worker_url.trim_end_matches('/'));
    let mut req = client.post(&url);
    if let Some(ref key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    let res = req.send().await?;
    if !res.status().is_success() {
        return Err(StableError::new("WORKER_ERROR", format!("Failed to trigger watcher: status {}", res.status())));
    }
    let data: serde_json::Value = res.json().await?;
    Ok(data)
}

#[tauri::command]
pub async fn worker_download_file(
    app: AppHandle,
    worker_url: String,
    api_key: Option<String>,
    job_id: String,
    destination_path: String,
) -> Result<(), StableError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()?;
    let url = format!("{}/api/jobs/{}/download", worker_url.trim_end_matches('/'), job_id);
    let mut req = client.get(&url);
    if let Some(ref key) = api_key {
        if !key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }
    let mut res = req.send().await?;
    if !res.status().is_success() {
        return Err(StableError::new("WORKER_ERROR", format!("Download failed: status {}", res.status())));
    }

    let total_bytes = res.content_length().unwrap_or(0);
    let dest = PathBuf::from(destination_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let mut file = tokio::fs::File::create(&dest).await?;
    let mut downloaded = 0u64;
    use tokio::io::AsyncWriteExt;

    while let Some(chunk) = res.chunk().await? {
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        let percent = if total_bytes > 0 {
            (downloaded as f64 / total_bytes as f64) * 100.0
        } else {
            0.0
        };

        use tauri::Emitter;
        let _ = app.emit(
            "worker-download-progress",
            serde_json::json!({
                "job_id": job_id,
                "downloaded_bytes": downloaded,
                "total_bytes": total_bytes,
                "percent": percent,
            }),
        );
    }

    file.flush().await?;
    Ok(())
}

