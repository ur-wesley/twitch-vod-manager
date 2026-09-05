use crate::error::AppError;
use crate::reporter::{DriveTransferProgress, DynReporter};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GDriveCredentials {
    pub client_id: String,
    pub client_secret: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub folder_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleDriveFile {
    pub id: String,
    pub name: String,
    pub size_bytes: u64,
    pub modified_time: String,
    pub web_view_link: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RefreshTokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

pub async fn start_gdrive_oauth(
    client_id: &str,
    client_secret: &str,
) -> Result<(String, Option<String>), AppError> {
    let redirect_uri = "http://localhost:17565/auth/callback";
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=https://www.googleapis.com/auth/drive.file&access_type=offline&prompt=consent",
        client_id, redirect_uri
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:17565").await.map_err(|e| {
        AppError::Auth(format!("Could not bind Google Drive OAuth listener on port 17565: {}", e))
    })?;

    let _ = open::that(&auth_url);

    let (mut socket, _) = listener.accept().await.map_err(|e| {
        AppError::Auth(format!("Failed to accept incoming Google Drive callback: {}", e))
    })?;

    let mut buffer = [0u8; 4096];
    let n = socket.read(&mut buffer).await.map_err(|e| {
        AppError::Auth(format!("Failed to read Google Drive callback: {}", e))
    })?;

    let request_str = String::from_utf8_lossy(&buffer[..n]);
    let code = extract_query_param(&request_str, "code").ok_or_else(|| {
        AppError::Auth("Authorization code missing from Google callback URL".to_string())
    })?;

    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<!DOCTYPE html><html><body style='font-family:sans-serif;background:#0d1117;color:#fff;display:flex;align-items:center;justify-content:center;height:90vh;'><div style='text-align:center;'><h2>Google Drive Authorization Successful!</h2><p>You can close this window now.</p></div></body></html>";
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.flush().await;

    exchange_gdrive_code(client_id, client_secret, &code, redirect_uri).await
}

fn extract_query_param(req: &str, param: &str) -> Option<String> {
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

async fn exchange_gdrive_code(
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
        return Err(AppError::Auth(format!("Google Drive token exchange failed: {}", text)));
    }

    let token_data: GoogleTokenResponse = res.json().await?;
    Ok((token_data.access_token, token_data.refresh_token))
}

pub async fn refresh_gdrive_token(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();
    let mut params = HashMap::new();
    params.insert("client_id", client_id);
    params.insert("client_secret", client_secret);
    params.insert("refresh_token", refresh_token);
    params.insert("grant_type", "refresh_token");

    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Drive(format!(
            "Failed to refresh Google Drive token: {}",
            text
        )));
    }

    let token_data: RefreshTokenResponse = res.json().await?;
    Ok(token_data.access_token)
}

pub async fn upload_vod_to_gdrive(
    reporter: DynReporter,
    vod_id: &str,
    credentials: &GDriveCredentials,
    video_path: &Path,
    custom_filename: Option<&str>,
    is_cancelled: Arc<AtomicBool>,
) -> Result<(String, Option<String>), AppError> {
    if is_cancelled.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }

    let file_metadata = tokio::fs::metadata(video_path).await?;
    let total_bytes = file_metadata.len();
    let filename = custom_filename
        .map(String::from)
        .unwrap_or_else(|| format!("vod_{}.mp4", vod_id));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(7200))
        .build()?;

    // 1. Check if token needs refresh (or use current access token)
    let mut access_token = credentials.access_token.clone();
    if access_token.is_empty() {
        if let Some(ref rf) = credentials.refresh_token {
            access_token =
                refresh_gdrive_token(&credentials.client_id, &credentials.client_secret, rf)
                    .await?;
        } else {
            return Err(AppError::Drive("Google Drive access token is missing".into()));
        }
    }

    // 2. Initiate Resumable Upload Session
    let init_url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true";
    let mut body_map = serde_json::Map::new();
    body_map.insert("name".to_string(), serde_json::json!(filename));
    body_map.insert(
        "description".to_string(),
        serde_json::json!(format!("Twitch VOD archive #{}", vod_id)),
    );

    if let Some(ref folder_id) = credentials.folder_id {
        if !folder_id.trim().is_empty() {
            body_map.insert(
                "parents".to_string(),
                serde_json::json!([folder_id.trim()]),
            );
        }
    }

    let mut init_res = client
        .post(init_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json; charset=UTF-8")
        .header("X-Upload-Content-Type", "video/mp4")
        .header("X-Upload-Content-Length", total_bytes.to_string())
        .json(&body_map)
        .send()
        .await?;

    // If 401 Unauthorized, try refreshing token once
    if init_res.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(ref rf) = credentials.refresh_token {
            access_token =
                refresh_gdrive_token(&credentials.client_id, &credentials.client_secret, rf)
                    .await?;
            init_res = client
                .post(init_url)
                .header("Authorization", format!("Bearer {}", access_token))
                .header("Content-Type", "application/json; charset=UTF-8")
                .header("X-Upload-Content-Type", "video/mp4")
                .header("X-Upload-Content-Length", total_bytes.to_string())
                .json(&body_map)
                .send()
                .await?;
        }
    }

    if !init_res.status().is_success() {
        let text = init_res.text().await.unwrap_or_default();
        return Err(AppError::Drive(format!(
            "Failed to initiate Google Drive upload: {}",
            text
        )));
    }

    let upload_url = init_res
        .headers()
        .get("Location")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            AppError::Drive("Missing Location header in Google Drive init response".into())
        })?
        .to_string();

    // 3. Upload file in 8 MB chunks (multiple of 256 KB)
    let chunk_size: usize = 8 * 1024 * 1024;
    let mut file = tokio::fs::File::open(video_path).await?;
    let mut uploaded_bytes = 0u64;
    let start_time = Instant::now();

    let mut file_id: Option<String> = None;
    let mut web_view_link: Option<String> = None;

    reporter.report_drive(&DriveTransferProgress {
        vod_id: vod_id.to_string(),
        provider: "gdrive".to_string(),
        bytes_transferred: 0,
        total_bytes,
        percent: 0.0,
        speed_mbps: 0.0,
        file_id: None,
        view_url: None,
    });

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
            if let Ok(json) = put_res.json::<serde_json::Value>().await {
                if let Some(id) = json["id"].as_str() {
                    file_id = Some(id.to_string());
                }
                if let Some(link) = json["webViewLink"].as_str() {
                    web_view_link = Some(link.to_string());
                }
            }
        } else if status.as_u16() != 308 {
            let text = put_res.text().await.unwrap_or_default();
            return Err(AppError::Drive(format!(
                "Google Drive chunk upload failed (status {}): {}",
                status, text
            )));
        }

        reporter.report_drive(&DriveTransferProgress {
            vod_id: vod_id.to_string(),
            provider: "gdrive".to_string(),
            bytes_transferred: uploaded_bytes,
            total_bytes,
            percent,
            speed_mbps,
            file_id: file_id.clone(),
            view_url: web_view_link.clone(),
        });
    }

    let final_id = file_id.ok_or_else(|| {
        AppError::Drive("Upload completed but no Google Drive file ID was returned".into())
    })?;

    Ok((final_id, web_view_link))
}

pub async fn list_gdrive_vods(
    client_id: &str,
    client_secret: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    folder_id: Option<&str>,
) -> Result<Vec<GoogleDriveFile>, AppError> {
    let client = reqwest::Client::new();

    let mut query = "trashed = false and (mimeType contains 'video/' or name contains '.mp4')".to_string();
    if let Some(fid) = folder_id {
        if !fid.trim().is_empty() {
            query.push_str(&format!(" and '{}' in parents", fid.trim()));
        }
    }

    let url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name,size,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=100&supportsAllDrives=true",
        url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>()
    );

    let mut token = access_token.to_string();
    let mut res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await?;

    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(rf) = refresh_token {
            token = refresh_gdrive_token(client_id, client_secret, rf).await?;
            res = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .await?;
        }
    }

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Drive(format!(
            "Failed to list Google Drive files: {}",
            text
        )));
    }

    let json: serde_json::Value = res.json().await?;
    let mut files = Vec::new();

    if let Some(items) = json["files"].as_array() {
        for item in items {
            let id = item["id"].as_str().unwrap_or_default().to_string();
            let name = item["name"].as_str().unwrap_or_default().to_string();
            let size_bytes = item["size"]
                .as_str()
                .and_then(|s| s.parse::<u64>().ok())
                .or_else(|| item["size"].as_u64())
                .unwrap_or(0);
            let modified_time = item["modifiedTime"].as_str().unwrap_or_default().to_string();
            let web_view_link = item["webViewLink"].as_str().map(|s| s.to_string());

            if !id.is_empty() {
                files.push(GoogleDriveFile {
                    id,
                    name,
                    size_bytes,
                    modified_time,
                    web_view_link,
                });
            }
        }
    }

    Ok(files)
}

pub async fn delete_gdrive_object(
    client_id: &str,
    client_secret: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    file_id: &str,
) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}?supportsAllDrives=true",
        file_id
    );

    let mut token = access_token.to_string();
    let mut res = client
        .delete(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await?;

    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(rf) = refresh_token {
            token = refresh_gdrive_token(client_id, client_secret, rf).await?;
            res = client
                .delete(&url)
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .await?;
        }
    }

    if !res.status().is_success() && res.status() != reqwest::StatusCode::NO_CONTENT {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Drive(format!(
            "Failed to delete Google Drive file: {}",
            text
        )));
    }

    Ok(())
}

pub async fn download_gdrive_file(
    reporter: DynReporter,
    vod_id: &str,
    client_id: &str,
    client_secret: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    file_id: &str,
    destination_path: &Path,
    is_cancelled: Arc<AtomicBool>,
) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}?alt=media&supportsAllDrives=true",
        file_id
    );

    let mut token = access_token.to_string();
    let mut res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await?;

    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(rf) = refresh_token {
            token = refresh_gdrive_token(client_id, client_secret, rf).await?;
            res = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .await?;
        }
    }

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Drive(format!(
            "Failed to download Google Drive file: {}",
            text
        )));
    }

    let total_bytes = res.content_length().unwrap_or(0);
    if let Some(parent) = destination_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let mut file = tokio::fs::File::create(destination_path).await?;
    let mut downloaded = 0u64;
    let start_time = Instant::now();

    while let Some(chunk) = res.chunk().await? {
        if is_cancelled.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }

        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        let elapsed = start_time.elapsed().as_secs_f64();
        let speed_mbps = if elapsed > 0.0 {
            (downloaded as f64 * 8.0) / (elapsed * 1_000_000.0)
        } else {
            0.0
        };
        let percent = if total_bytes > 0 {
            (downloaded as f64 / total_bytes as f64) * 100.0
        } else {
            0.0
        };

        reporter.report_drive(&DriveTransferProgress {
            vod_id: vod_id.to_string(),
            provider: "gdrive".to_string(),
            bytes_transferred: downloaded,
            total_bytes,
            percent,
            speed_mbps,
            file_id: Some(file_id.to_string()),
            view_url: None,
        });
    }

    file.flush().await?;
    Ok(())
}
