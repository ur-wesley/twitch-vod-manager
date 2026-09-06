mod api;
mod db;
mod queue;
mod state;
mod storage_quota;
mod watcher;

use db::Database;
use state::AppState;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;
use watcher::run_autonomous_watcher;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,vod_worker=debug,vod_core=debug".into()),
        )
        .init();

    let port: u16 = std::env::var("WORKER_PORT")
        .or_else(|_| std::env::var("PORT"))
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .expect("Invalid port number");

    let api_key = std::env::var("WORKER_API_KEY")
        .or_else(|_| std::env::var("API_KEY"))
        .ok();

    let data_dir_str = std::env::var("DATA_DIR").unwrap_or_else(|_| "./data".to_string());
    let data_dir = PathBuf::from(data_dir_str);
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(data_dir.join("completed"))?;
    std::fs::create_dir_all(data_dir.join("temp"))?;

    let db_path = data_dir.join("worker.db");
    let database = Arc::new(Database::new(&db_path)?);

    let state = AppState::new(database, api_key.clone(), data_dir);

    // Spawn autonomous channel watcher loop in background
    tokio::spawn(run_autonomous_watcher(state.clone()));

    // Build router with CORS and tracing
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = api::create_router(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("🚀 Twitch VOD Cloud Worker listening on {}", addr);
    if api_key.is_some() {
        info!("🔒 Bearer authentication is enabled");
    } else {
        info!("⚠️ No WORKER_API_KEY set: requests will not require authentication");
    }

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
