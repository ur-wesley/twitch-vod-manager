use crate::error::AppError;
use serde::Deserialize;
use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub use vod_core::YouTubeVideoMetadata;

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

// Default desktop client credentials for YouTube integration
// Can be overridden in Settings -> Accounts or via environment variables
pub const DEFAULT_YOUTUBE_CLIENT_ID: &str = vod_core::youtube::DEFAULT_YOUTUBE_CLIENT_ID;
pub const DEFAULT_YOUTUBE_CLIENT_SECRET: &str = vod_core::youtube::DEFAULT_YOUTUBE_CLIENT_SECRET;

pub async fn start_google_oauth(
    client_id: &str,
    client_secret: &str,
) -> Result<(String, Option<String>), AppError> {
    let (effective_client_id, effective_client_secret) =
        vod_core::youtube::resolve_youtube_credentials(client_id, client_secret);

    let redirect_uri = "http://localhost:17564/auth/callback";

    if effective_client_id == DEFAULT_YOUTUBE_CLIENT_ID
        || effective_client_secret == DEFAULT_YOUTUBE_CLIENT_SECRET
    {
        return Err(AppError::Auth(format!(
            "YouTube login needs your own Google Cloud OAuth client. Create a Desktop app at https://console.cloud.google.com/apis/credentials , add Authorized redirect URI exactly `{redirect_uri}` (http, no trailing slash), then paste Client ID + Secret in Settings → Accounts → Advanced YouTube credentials (or set YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET)."
        )));
    }
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

    exchange_google_code(&effective_client_id, &effective_client_secret, &code, redirect_uri).await
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
