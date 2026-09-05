use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub use vod_core::YouTubeVideoMetadata;

#[derive(Debug, Clone, Serialize)]
pub struct YouTubeUploadProgress {
    pub vod_id: String,
    pub bytes_uploaded: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub speed_mbps: f64,
    pub video_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

// Default desktop client credentials for YouTube integration
// Can be overridden in Settings -> Accounts or via environment variables
pub const DEFAULT_YOUTUBE_CLIENT_ID: &str = "841123498124-71t8l5m6qap157n8430b8s1a9k7d3e2v.apps.googleusercontent.com";
pub const DEFAULT_YOUTUBE_CLIENT_SECRET: &str = "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ec";

pub async fn start_google_oauth(
    client_id: &str,
    client_secret: &str,
) -> Result<(String, Option<String>), AppError> {
    let env_client_id = std::env::var("YOUTUBE_CLIENT_ID").ok();
    let env_client_secret = std::env::var("YOUTUBE_CLIENT_SECRET").ok();

    let effective_client_id = if !client_id.trim().is_empty() {
        client_id.trim()
    } else if let Some(ref env_id) = env_client_id {
        if !env_id.trim().is_empty() {
            env_id.trim()
        } else {
            DEFAULT_YOUTUBE_CLIENT_ID
        }
    } else {
        DEFAULT_YOUTUBE_CLIENT_ID
    };

    let effective_client_secret = if !client_secret.trim().is_empty() {
        client_secret.trim()
    } else if let Some(ref env_sec) = env_client_secret {
        if !env_sec.trim().is_empty() {
            env_sec.trim()
        } else {
            DEFAULT_YOUTUBE_CLIENT_SECRET
        }
    } else {
        DEFAULT_YOUTUBE_CLIENT_SECRET
    };

    let redirect_uri = "http://localhost:17564/auth/callback";
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload&access_type=offline&prompt=consent",
        effective_client_id, redirect_uri
    );

    let listener = TcpListener::bind("127.0.0.1:17564").await.map_err(|e| {
        AppError::Auth(format!("Could not bind Google OAuth listener on port 17564: {}", e))
    })?;

    let _ = open::that(&auth_url);

    // Allow up to 3 minutes for authorization
    let accept_future = async {
        loop {
            let (mut socket, _) = listener.accept().await?;
            let mut buffer = [0u8; 4096];
            let n = socket.read(&mut buffer).await?;
            let request_str = String::from_utf8_lossy(&buffer[..n]);
            let first_line = request_str.lines().next().unwrap_or_default();

            if first_line.contains("/auth/callback") {
                if let Some(code) = extract_param(&request_str, "code") {
                    let response = concat!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n",
                        "<!DOCTYPE html><html><body style='font-family:sans-serif;background:#0d1117;color:#fff;display:flex;align-items:center;justify-content:center;height:90vh;'>",
                        "<div style='text-align:center;'><h2>YouTube Authorization Successful!</h2>",
                        "<p>You can close this window and return to Twitch VOD Manager.</p></div></body></html>"
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.flush().await;
                    return Ok(code);
                } else if let Some(err) = extract_param(&request_str, "error") {
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<!DOCTYPE html><html><body style='font-family:sans-serif;background:#0d1117;color:#fff;display:flex;align-items:center;justify-content:center;height:90vh;'><div style='text-align:center;'><h2>Authorization Denied</h2><p>{}</p></div></body></html>",
                        err
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.flush().await;
                    return Err(AppError::Auth(format!("Google authorization denied: {}", err)));
                }
            } else {
                let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
                let _ = socket.write_all(not_found.as_bytes()).await;
            }
        }
    };

    let code = tokio::time::timeout(std::time::Duration::from_secs(180), accept_future)
        .await
        .map_err(|_| AppError::Auth("Google OAuth timed out waiting for user approval".to_string()))?
        .map_err(|e: AppError| e)?;

    exchange_google_code(effective_client_id, effective_client_secret, &code, redirect_uri).await
}

fn extract_param(req: &str, param: &str) -> Option<String> {
    let first_line = req.lines().next()?;
    let path = first_line.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.split('=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == param {
                return Some(v.to_string());
            }
        }
    }
    None
}

async fn exchange_google_code(
    client_id: &str,
    client_secret: &str,
    code: &str,
    redirect_uri: &str,
) -> Result<(String, Option<String>), AppError> {
    let client = reqwest::Client::new();
    let mut params = HashMap::new();
    params.insert("client_id", client_id);
    params.insert("client_secret", client_secret);
    params.insert("code", code);
    params.insert("grant_type", "authorization_code");
    params.insert("redirect_uri", redirect_uri);

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!("Google token exchange failed: {}", text)));
    }

    let token_data: GoogleTokenResponse = res.json().await?;
    Ok((token_data.access_token, token_data.refresh_token))
}

pub async fn upload_video_to_youtube(
    app: &tauri::AppHandle,
    vod_id: &str,
    access_token: &str,
    video_path: &Path,
    metadata: &YouTubeVideoMetadata,
    is_cancelled: Arc<AtomicBool>,
) -> Result<String, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(7200))
        .build()?;

    let file_metadata = tokio::fs::metadata(video_path).await?;
    let total_bytes = file_metadata.len();

    // 1. Initiate Resumable Upload
    let init_url = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
    let body_json = serde_json::json!({
        "snippet": {
            "title": metadata.title,
            "description": metadata.description,
            "tags": metadata.tags,
            "categoryId": "20" // Gaming category
        },
        "status": {
            "privacyStatus": metadata.privacy_status,
            "selfDeclaredMadeForKids": false
        }
    });

    let init_res = client
        .post(init_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json; charset=UTF-8")
        .header("X-Upload-Content-Type", "video/mp4")
        .header("X-Upload-Content-Length", total_bytes.to_string())
        .json(&body_json)
        .send()
        .await?;

    if !init_res.status().is_success() {
        let text = init_res.text().await.unwrap_or_default();
        return Err(AppError::YouTube(format!("Failed to initiate YouTube upload: {}", text)));
    }

    let upload_url = init_res
        .headers()
        .get("Location")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| AppError::YouTube("Missing Location header in YouTube init response".into()))?
        .to_string();

    // 2. Upload file in 8MB chunks
    let chunk_size = 8 * 1024 * 1024; // 8MB
    let mut file = tokio::fs::File::open(video_path).await?;
    let mut uploaded_bytes = 0u64;
    let start_time = Instant::now();

    let mut video_id: Option<String> = None;

    while uploaded_bytes < total_bytes {
        if is_cancelled.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }

        let remaining = total_bytes - uploaded_bytes;
        let current_chunk_size = std::cmp::min(remaining, chunk_size as u64) as usize;
        let mut buffer = vec![0u8; current_chunk_size];
        file.read_exact(&mut buffer).await?;

        let end_byte = uploaded_bytes + current_chunk_size as u64 - 1;
        let content_range = format!("bytes {}-{}/{}", uploaded_bytes, end_byte, total_bytes);

        let put_res = client
            .put(&upload_url)
            .header("Content-Type", "video/mp4")
            .header("Content-Length", current_chunk_size.to_string())
            .header("Content-Range", content_range)
            .body(buffer)
            .send()
            .await?;

        uploaded_bytes += current_chunk_size as u64;

        let elapsed = start_time.elapsed().as_secs_f64();
        let speed_mbps = if elapsed > 0.0 {
            (uploaded_bytes as f64 * 8.0) / (elapsed * 1_000_000.0)
        } else {
            0.0
        };
        let percent = (uploaded_bytes as f64 / total_bytes as f64) * 100.0;

        let status = put_res.status();
        if status.is_success() {
            // Upload complete: response contains video resource JSON
            if let Ok(json) = put_res.json::<serde_json::Value>().await {
                if let Some(id) = json["id"].as_str() {
                    video_id = Some(id.to_string());
                }
            }
        } else if status.as_u16() != 308 {
            // 308 Resume Incomplete is expected for partial chunks
            let text = put_res.text().await.unwrap_or_default();
            return Err(AppError::YouTube(format!("Chunk upload failed: {}", text)));
        }

        let _ = app.emit(
            "youtube-upload-progress",
            YouTubeUploadProgress {
                vod_id: vod_id.to_string(),
                bytes_uploaded: uploaded_bytes,
                total_bytes,
                percent,
                speed_mbps,
                video_id: video_id.clone(),
            },
        );
    }

    let final_id = video_id.unwrap_or_default();
    Ok(final_id)
}
