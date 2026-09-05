use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::error::StableError;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfoDto {
    pub version: String,
    pub current_version: String,
    pub notes: String,
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<Option<UpdateInfoDto>, StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        return Ok(None);
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let updater = app
            .updater()
            .map_err(|e| StableError::new("INTERNAL", format!("updater init: {e}")))?;

        let update = updater
            .check()
            .await
            .map_err(|e| StableError::new("INTERNAL", format!("updater check: {e}")))?;

        Ok(update.map(|u| UpdateInfoDto {
            version: u.version.to_string(),
            current_version: u.current_version.to_string(),
            notes: u.body.unwrap_or_default(),
        }))
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), StableError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        return Err(StableError::new("INTERNAL", "updater not available on this platform"));
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let updater = app
            .updater()
            .map_err(|e| StableError::new("INTERNAL", format!("updater init: {e}")))?;

        let update = updater
            .check()
            .await
            .map_err(|e| StableError::new("INTERNAL", format!("updater check: {e}")))?;

        let Some(u) = update else {
            return Err(StableError::new("INTERNAL", "no update available"));
        };

        u.download_and_install(
            |_chunk_length, _content_length| {},
            || {},
        )
        .await
        .map_err(|e| StableError::new("INTERNAL", format!("update install: {e}")))?;

        Ok(())
    }
}
