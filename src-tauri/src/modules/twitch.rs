use serde::{Deserialize, Serialize};
use crate::error::AppError;
use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TwitchUser {
    pub id: String,
    pub login: String,
    pub display_name: String,
    pub profile_image_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TwitchVod {
    pub id: String,
    pub stream_id: Option<String>,
    pub user_id: String,
    pub user_name: String,
    pub title: String,
    pub description: String,
    pub created_at: String,
    pub published_at: String,
    pub url: String,
    pub thumbnail_url: String,
    pub viewable: String,
    pub view_count: u64,
    pub duration: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VodQuality {
    pub name: String,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub bandwidth: Option<u64>,
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct HelixUsersResponse {
    data: Vec<HelixUserItem>,
}

#[derive(Debug, Deserialize)]
struct HelixUserItem {
    id: String,
    login: String,
    display_name: String,
    profile_image_url: String,
}

#[derive(Debug, Deserialize)]
struct HelixVideosResponse {
    data: Vec<TwitchVod>,
}

pub async fn start_oauth_flow(
    client_id: &str,
    client_secret: &str,
) -> Result<(String, Option<String>), AppError> {
    let redirect_uri = "http://localhost:17563/auth/callback";
    let auth_url = format!(
        "https://id.twitch.tv/oauth2/authorize?client_id={}&redirect_uri={}&response_type=code&scope=user:read:email+channel:read:vhs+user:read:broadcast",
        client_id, redirect_uri
    );

    let listener = TcpListener::bind("127.0.0.1:17563").await.map_err(|e| {
        AppError::Auth(format!("Could not start local auth listener on port 17563: {}", e))
    })?;

    let _ = open::that(&auth_url);

    let (mut socket, _) = listener.accept().await.map_err(|e| {
        AppError::Auth(format!("Failed to accept incoming OAuth callback: {}", e))
    })?;

    let mut buffer = [0u8; 4096];
    let n = socket.read(&mut buffer).await.map_err(|e| {
        AppError::Auth(format!("Failed to read OAuth callback request: {}", e))
    })?;

    let request_str = String::from_utf8_lossy(&buffer[..n]);
    let code = extract_code_from_request(&request_str).ok_or_else(|| {
        AppError::Auth("Authorization code missing from callback URL".to_string())
    })?;

    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<!DOCTYPE html><html><body style='font-family:sans-serif;background:#0d1117;color:#fff;display:flex;align-items:center;justify-content:center;height:90vh;'><div style='text-align:center;'><h2>Twitch Authentication Successful!</h2><p>You can close this window and return to the Twitch VOD Manager app.</p></div></body></html>";
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.flush().await;

    exchange_code_for_token(client_id, client_secret, &code, redirect_uri).await
}

fn extract_code_from_request(req: &str) -> Option<String> {
    let first_line = req.lines().next()?;
    let path = first_line.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.split('=');
        if let (Some(key), Some(val)) = (parts.next(), parts.next()) {
            if key == "code" {
                return Some(val.to_string());
            }
        }
    }
    None
}

async fn exchange_code_for_token(
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
        .post("https://id.twitch.tv/oauth2/token")
        .form(&params)
        .send()
        .await?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!("Token exchange failed: {}", err_text)));
    }

    let token_data: TokenResponse = res.json().await?;
    Ok((token_data.access_token, token_data.refresh_token))
}

pub async fn get_user_info(client_id: &str, access_token: &str) -> Result<TwitchUser, AppError> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.twitch.tv/helix/users")
        .header("Client-Id", client_id)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Twitch(format!("Failed to fetch user info: {}", text)));
    }

    let body: HelixUsersResponse = res.json().await?;
    let user = body.data.into_iter().next().ok_or_else(|| {
        AppError::Twitch("No user returned from Twitch API".to_string())
    })?;

    Ok(TwitchUser {
        id: user.id,
        login: user.login,
        display_name: user.display_name,
        profile_image_url: user.profile_image_url,
    })
}

pub async fn get_vods(
    client_id: &str,
    access_token: &str,
    user_id: &str,
) -> Result<Vec<TwitchVod>, AppError> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.twitch.tv/helix/videos?user_id={}&type=archive&first=50",
        user_id
    );

    let res = client
        .get(&url)
        .header("Client-Id", client_id)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Twitch(format!("Failed to fetch VODs: {}", text)));
    }

    let body: HelixVideosResponse = res.json().await?;
    Ok(body.data)
}

pub async fn get_vod_qualities(
    access_token: &str,
    vod_id: &str,
) -> Result<Vec<VodQuality>, AppError> {
    let client = reqwest::Client::new();

    let gql_query = serde_json::json!({
        "operationName": "PlaybackAccessToken_Template",
        "query": "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { videoPlaybackAccessToken(id: $vodID, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) { value signature } }",
        "variables": {
            "isLive": false,
            "login": "",
            "isVod": true,
            "vodID": vod_id,
            "playerType": "site"
        }
    });

    let gql_res = client
        .post("https://gql.twitch.tv/gql")
        .header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
        .header("Authorization", format!("OAuth {}", access_token))
        .json(&gql_query)
        .send()
        .await?;

    let gql_body: serde_json::Value = gql_res.json().await?;
    let token = gql_body["data"]["videoPlaybackAccessToken"]["value"]
        .as_str()
        .ok_or_else(|| AppError::Twitch("Missing playback access token in GQL response".into()))?;
    let sig = gql_body["data"]["videoPlaybackAccessToken"]["signature"]
        .as_str()
        .ok_or_else(|| AppError::Twitch("Missing playback signature in GQL response".into()))?;

    let encoded_token: String = url::form_urlencoded::byte_serialize(token.as_bytes()).collect();

    let usher_url = format!(
        "https://usher.ttvnw.net/vod/{}.m3u8?sig={}&token={}&allow_source=true&allow_audio_only=true",
        vod_id, sig, encoded_token
    );

    let m3u8_res = client.get(&usher_url).send().await?;
    if !m3u8_res.status().is_success() {
        return Err(AppError::Twitch(format!("Failed to fetch master playlist: status {}", m3u8_res.status())));
    }

    let playlist_content = m3u8_res.text().await?;
    parse_master_playlist(&playlist_content)
}

fn parse_master_playlist(content: &str) -> Result<Vec<VodQuality>, AppError> {
    let mut qualities = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_res: Option<String> = None;
    let mut current_fps: Option<u32> = None;
    let mut current_bw: Option<u64> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("#EXT-X-MEDIA:TYPE=VIDEO") {
            if let Some(name_part) = extract_attribute(line, "NAME") {
                current_name = Some(name_part);
            }
        } else if line.starts_with("#EXT-X-STREAM-INF:") {
            if let Some(res) = extract_attribute(line, "RESOLUTION") {
                current_res = Some(res);
            }
            if let Some(fps_str) = extract_attribute(line, "FRAME-RATE") {
                current_fps = fps_str.parse().ok();
            }
            if let Some(bw_str) = extract_attribute(line, "BANDWIDTH") {
                current_bw = bw_str.parse().ok();
            }
            if current_name.is_none() {
                if let Some(group) = extract_attribute(line, "VIDEO") {
                    current_name = Some(group);
                }
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            let name = current_name.take().unwrap_or_else(|| "Source".to_string());
            qualities.push(VodQuality {
                name,
                resolution: current_res.take(),
                fps: current_fps.take(),
                bandwidth: current_bw.take(),
                url: line.to_string(),
            });
        }
    }

    if qualities.is_empty() {
        return Err(AppError::Twitch("No valid video streams found in master playlist".to_string()));
    }

    Ok(qualities)
}

fn extract_attribute(line: &str, attr: &str) -> Option<String> {
    let key = format!("{}=", attr);
    if let Some(idx) = line.find(&key) {
        let rest = &line[idx + key.len()..];
        if let Some(stripped) = rest.strip_prefix('"') {
            let quote_end = stripped.find('"')?;
            return Some(stripped[..quote_end].to_string());
        } else {
            let end = rest.find(',').unwrap_or(rest.len());
            return Some(rest[..end].trim().to_string());
        }
    }
    None
}
