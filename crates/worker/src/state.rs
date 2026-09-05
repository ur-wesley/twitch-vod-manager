use crate::db::Database;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub active_cancellations: Arc<RwLock<HashMap<String, Arc<AtomicBool>>>>,
    pub api_key: Option<String>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new(db: Arc<Database>, api_key: Option<String>, data_dir: PathBuf) -> Self {
        Self {
            db,
            active_cancellations: Arc::new(RwLock::new(HashMap::new())),
            api_key,
            data_dir,
        }
    }
}
