pub mod commands;
pub mod error;
pub mod modules;
pub mod state;

use commands::*;
use modules::settings::{get_config_path, load_settings};
use state::AppState;
use tauri::Manager;

fn load_oauth_dotenv() {
    let mut candidates = vec![
        std::path::PathBuf::from(".env"),
        std::path::PathBuf::from("../.env"),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(".env"));
        }
    }
    for path in candidates {
        if path.is_file() {
            let _ = dotenvy::from_path(&path);
            break;
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_oauth_dotenv();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let config_path = get_config_path(app.handle())
                .unwrap_or_else(|_| std::path::PathBuf::from("settings.json"));
            let initial_settings = load_settings(&config_path);
            app.manage(AppState::new(initial_settings));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            login_twitch,
            logout_twitch,
            set_twitch_token,
            get_twitch_user,
            resolve_channel,
            list_vods,
            get_qualities,
            detect_ffmpeg,
            get_system_hardware_info,
            cancel_active_task,
            start_pipeline,
            list_s3_vods,
            download_s3_vod,
            delete_s3_vod,
            login_gdrive,
            logout_gdrive,
            list_gdrive_vods,
            get_gdrive_quota,
            delete_gdrive_vod,
            download_gdrive_vod,
            list_webdav_vods,
            get_webdav_quota,
            delete_webdav_vod,
            download_webdav_vod,
            login_youtube,
            logout_youtube,
            set_youtube_token,
            publish_to_youtube,
            import_settings_toml,
            export_settings_toml,
            download_and_install_ffmpeg,
            delete_twitch_vod,
            worker_get_status,
            worker_sync_settings,
            worker_list_jobs,
            worker_dispatch_job,
            worker_cancel_job,
            worker_get_job_logs,
            worker_delete_job,
            worker_trigger_watcher,
            worker_download_file,
            check_for_updates,
            install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
