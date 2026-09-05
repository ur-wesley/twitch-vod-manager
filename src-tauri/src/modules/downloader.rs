use crate::error::AppError;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::Semaphore;
use url::Url;

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub vod_id: String,
    pub downloaded_chunks: usize,
    pub total_chunks: usize,
    pub percent: f64,
    pub bytes: u64,
    pub speed_mbps: f64,
    pub eta_seconds: u64,
}

pub async fn download_vod_chunks(
    app: &tauri::AppHandle,
    vod_id: &str,
    playlist_url: &str,
    work_dir: &Path,
    is_cancelled: Arc<AtomicBool>,
) -> Result<PathBuf, AppError> {
    tokio::fs::create_dir_all(work_dir).await?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    // 1. Fetch quality sub-playlist
    let res = client.get(playlist_url).send().await?;
    if !res.status().is_success() {
        return Err(AppError::Download(format!(
            "Failed to fetch sub-playlist: status {}",
            res.status()
        )));
    }
    let body = res.text().await?;

    // 2. Parse chunk URLs
    let base_url = Url::parse(playlist_url)
        .map_err(|e| AppError::Download(format!("Invalid playlist URL: {}", e)))?;

    let mut chunk_urls = Vec::new();
    for line in body.lines() {
        let line = line.trim();
        if !line.starts_with('#') && !line.is_empty() {
            let full_url = if line.starts_with("http://") || line.starts_with("https://") {
                Url::parse(line).map_err(|e| AppError::Download(e.to_string()))?
            } else {
                base_url
                    .join(line)
                    .map_err(|e| AppError::Download(e.to_string()))?
            };
            chunk_urls.push(full_url);
        }
    }

    let total_chunks = chunk_urls.len();
    if total_chunks == 0 {
        return Err(AppError::Download(
            "No media segments found in sub-playlist".into(),
        ));
    }

    let downloaded_count = Arc::new(AtomicUsize::new(0));
    let total_bytes = Arc::new(AtomicU64::new(0));
    let start_time = Instant::now();
    let semaphore = Arc::new(Semaphore::new(12)); // 12 concurrent chunk downloaders

    let chunks_dir = work_dir.join("chunks");
    tokio::fs::create_dir_all(&chunks_dir).await?;

    let mut handles = Vec::with_capacity(total_chunks);

    for (index, chunk_url) in chunk_urls.into_iter().enumerate() {
        let sem = Arc::clone(&semaphore);
        let client = client.clone();
        let is_cancelled = Arc::clone(&is_cancelled);
        let downloaded_count = Arc::clone(&downloaded_count);
        let total_bytes = Arc::clone(&total_bytes);
        let app = app.clone();
        let vod_id = vod_id.to_string();
        let chunk_path = chunks_dir.join(format!("chunk_{:06}.ts", index));

        let handle = tokio::spawn(async move {
            if is_cancelled.load(Ordering::Relaxed) {
                return Err(AppError::Cancelled);
            }

            let _permit = sem
                .acquire()
                .await
                .map_err(|e| AppError::Download(e.to_string()))?;

            if is_cancelled.load(Ordering::Relaxed) {
                return Err(AppError::Cancelled);
            }

            // Retry logic (up to 3 attempts per chunk)
            let mut attempts = 0;
            let mut last_err = String::new();
            let mut bytes_data = Vec::new();

            while attempts < 3 {
                attempts += 1;
                match client.get(chunk_url.as_str()).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        match resp.bytes().await {
                            Ok(b) => {
                                bytes_data = b.to_vec();
                                break;
                            }
                            Err(e) => last_err = e.to_string(),
                        }
                    }
                    Ok(resp) => last_err = format!("HTTP {}", resp.status()),
                    Err(e) => last_err = e.to_string(),
                }
                tokio::time::sleep(std::time::Duration::from_millis(500 * attempts)).await;
            }

            if bytes_data.is_empty() {
                return Err(AppError::Download(format!(
                    "Failed to download chunk {} after 3 attempts: {}",
                    index, last_err
                )));
            }

            tokio::fs::write(&chunk_path, &bytes_data).await?;

            let bytes_len = bytes_data.len() as u64;
            let current_downloaded = downloaded_count.fetch_add(1, Ordering::Relaxed) + 1;
            let current_bytes = total_bytes.fetch_add(bytes_len, Ordering::Relaxed) + bytes_len;

            // Emit progress every 5 chunks or at completion
            if current_downloaded % 5 == 0 || current_downloaded == total_chunks {
                let elapsed_secs = start_time.elapsed().as_secs_f64();
                let speed_mbps = if elapsed_secs > 0.0 {
                    (current_bytes as f64 * 8.0) / (elapsed_secs * 1_000_000.0)
                } else {
                    0.0
                };

                let remaining_chunks = total_chunks.saturating_sub(current_downloaded);
                let avg_chunk_time = if current_downloaded > 0 {
                    elapsed_secs / (current_downloaded as f64)
                } else {
                    0.0
                };
                let eta_seconds = (remaining_chunks as f64 * avg_chunk_time) as u64;
                let percent = (current_downloaded as f64 / total_chunks as f64) * 100.0;

                let _ = app.emit(
                    "download-progress",
                    DownloadProgress {
                        vod_id: vod_id.clone(),
                        downloaded_chunks: current_downloaded,
                        total_chunks,
                        percent,
                        bytes: current_bytes,
                        speed_mbps,
                        eta_seconds,
                    },
                );
            }

            Ok(())
        });

        handles.push(handle);
    }

    // Await all chunk download tasks
    for handle in handles {
        match handle.await {
            Ok(Ok(())) => {}
            Ok(Err(AppError::Cancelled)) => return Err(AppError::Cancelled),
            Ok(Err(e)) => return Err(e),
            Err(e) => return Err(AppError::Download(format!("Task panicked: {}", e))),
        }
    }

    if is_cancelled.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }

    // 3. Write concat list file for FFmpeg
    let concat_file_path = work_dir.join("concat_list.txt");
    let mut concat_content = String::new();
    for i in 0..total_chunks {
        let chunk_file_name = format!("chunks/chunk_{:06}.ts", i);
        concat_content.push_str(&format!("file '{}'\n", chunk_file_name));
    }
    tokio::fs::write(&concat_file_path, concat_content).await?;

    Ok(concat_file_path)
}
