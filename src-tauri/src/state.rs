use crate::modules::settings::AppSettings;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct AppState {
    pub settings: RwLock<AppSettings>,
    pub is_cancelled: Arc<AtomicBool>,
    pub active_vod_id: RwLock<Option<String>>,
}

impl AppState {
    pub fn new(settings: AppSettings) -> Self {
        Self {
            settings: RwLock::new(settings),
            is_cancelled: Arc::new(AtomicBool::new(false)),
            active_vod_id: RwLock::new(None),
        }
    }
}
