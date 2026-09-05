use crate::error::AppError;
use serde::{Deserialize, Serialize};
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
    pub profile_image_url: String,
}

#[derive(Debug, Deserialize)]
struct HelixVideosResponse {
    data: Vec<TwitchVod>,
}

pub const DEFAULT_TWITCH_CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko";

pub fn resolve_twitch_credentials(client_id: &str, client_secret: &str) -> (String, String) {
    let cid = if !client_id.trim().is_empty() {
        client_id.trim().to_string()
    } else if let Ok(env_id) = std::env::var("TWITCH_CLIENT_ID") {
        if !env_id.trim().is_empty() {
            env_id.trim().to_string()
        } else {
            DEFAULT_TWITCH_CLIENT_ID.to_string()
        }
    } else {
        DEFAULT_TWITCH_CLIENT_ID.to_string()
    };

    let csec = if !client_secret.trim().is_empty() {
        client_secret.trim().to_string()
    } else if let Ok(env_sec) = std::env::var("TWITCH_CLIENT_SECRET") {
        env_sec.trim().to_string()
    } else {
        String::new()
    };

    (cid, csec)
}

pub async fn start_oauth_flow(
    client_id: &str,
    client_secret: &str,
) -> Result<(String, Option<String>), AppError> {
    let (effective_client_id, effective_client_secret) =
        resolve_twitch_credentials(client_id, client_secret);

    let redirect_uri = "http://localhost:17563/auth/callback";

    if effective_client_id.is_empty() || effective_client_id == DEFAULT_TWITCH_CLIENT_ID {
        return Err(AppError::Auth(format!(
            "Twitch login needs your own Developer Console app. Create one at https://dev.twitch.tv/console/apps , add OAuth Redirect URL exactly `{redirect_uri}` (http, no trailing slash), then paste Client ID (+ Secret) in Settings → Twitch credentials."
        )));
    }

    let is_implicit = effective_client_secret.is_empty();

    let auth_url = if is_implicit {
        format!(
            "https://id.twitch.tv/oauth2/authorize?client_id={}&redirect_uri={}&response_type=token&scope=user:read:email+user:read:broadcast+channel:manage:videos",
            effective_client_id, redirect_uri
        )
    } else {
        format!(
            "https://id.twitch.tv/oauth2/authorize?client_id={}&redirect_uri={}&response_type=code&scope=user:read:email+user:read:broadcast+channel:manage:videos",
            effective_client_id, redirect_uri
        )
    };

    let listener = TcpListener::bind("127.0.0.1:17563").await.map_err(|e| {
        AppError::Auth(format!("Could not start local auth listener on port 17563: {}", e))
    })?;

    let _ = open::that(&auth_url);

    // Timeout after 3 minutes if user abandons login
    let start_time = std::time::Instant::now();
    let timeout_duration = std::time::Duration::from_secs(180);

    let mut captured_token: Option<String> = None;
    let mut captured_code: Option<String> = None;

    while start_time.elapsed() < timeout_duration {
        let accept_result = tokio::time::timeout(std::time::Duration::from_secs(10), listener.accept()).await;
        let (mut socket, _) = match accept_result {
            Ok(Ok(pair)) => pair,
            Ok(Err(e)) => return Err(AppError::Auth(format!("Failed to accept incoming OAuth connection: {}", e))),
            Err(_) => continue, // Periodic check for overall timeout
        };

        let mut buffer = [0u8; 4096];
        let n = socket.read(&mut buffer).await.map_err(|e| {
            AppError::Auth(format!("Failed to read OAuth request: {}", e))
        })?;

        let request_str = String::from_utf8_lossy(&buffer[..n]);
        let first_line = request_str.lines().next().unwrap_or_default();

        if first_line.contains("/auth/token") {
            // Received access_token from the frontend JavaScript callback (implicit flow)
            if let Some(token) = extract_param_from_path(first_line, "access_token") {
                captured_token = Some(token);
                let response = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: text/plain\r\n\r\nOK";
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.flush().await;
                break;
            }
        } else if first_line.contains("/auth/callback") {
            if is_implicit {
                // Return an HTML page that reads window.location.hash and passes the token to /auth/token
                let response = concat!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n",
                    "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Twitch Login</title></head>",
                    "<body style='font-family:sans-serif;background:#0d1117;color:#fff;display:flex;align-items:center;justify-content:center;height:90vh;'>",
                    "<div style='text-align:center;'>",
                    "<h2 id='msg'>Processing Twitch Login...</h2>",
                    "<p id='sub'>Please wait a moment while we finish signing you in.</p>",
                    "</div>",
                    "<script>",
                    "const hash = window.location.hash.substring(1);",
                    "const params = new URLSearchParams(hash);",
                    "const token = params.get('access_token');",
                    "const err = params.get('error_description') || params.get('error');",
                    "if (token) {",
                    "  fetch('/auth/token?access_token=' + encodeURIComponent(token))",
                    "    .then(() => {",
                    "      document.getElementById('msg').innerText = 'Twitch Authentication Successful!';",
                    "      document.getElementById('sub').innerText = 'You can close this window and return to the Twitch VOD Manager app.';",
                    "    })",
                    "    .catch(() => { document.getElementById('msg').innerText = 'Failed to pass token to app.'; });",
                    "} else if (err) {",
                    "  document.getElementById('msg').innerText = 'Twitch Login Error: ' + err;",
                    "} else {",
                    "  document.getElementById('msg').innerText = 'No access token received.';",
                    "}",
                    "</script></body></html>"
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.flush().await;
            } else {
                // Code flow: extract authorization code directly from query parameters
                if let Some(code) = extract_param_from_path(first_line, "code") {
                    captured_code = Some(code);
                    let response = concat!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n",
                        "<!DOCTYPE html><html><body style='font-family:sans-serif;background:#0d1117;color:#fff;display:flex;align-items:center;justify-content:center;height:90vh;'>",
                        "<div style='text-align:center;'><h2>Twitch Authentication Successful!</h2>",
                        "<p>You can close this window and return to the Twitch VOD Manager app.</p></div></body></html>"
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.flush().await;
                    break;
                }
            }
        } else {
            // Ignore other requests like favicon
            let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
            let _ = socket.write_all(not_found.as_bytes()).await;
        }
    }

    if let Some(token) = captured_token {
        Ok((token, None))
    } else if let Some(code) = captured_code {
        exchange_code_for_token(&effective_client_id, &effective_client_secret, &code, redirect_uri).await
    } else {
        Err(AppError::Auth("Twitch authentication timed out or was cancelled".to_string()))
    }
}

fn extract_param_from_path(line: &str, param: &str) -> Option<String> {
    let path = line.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.split('=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == param {
                return urlencoding_decode(v);
            }
        }
    }
    None
}

fn urlencoding_decode(s: &str) -> Option<String> {
    url::form_urlencoded::parse(format!("v={}", s).as_bytes())
        .find(|(k, _)| k == "v")
        .map(|(_, v)| v.into_owned())
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

pub async fn get_app_access_token(
    client_id: &str,
    client_secret: &str,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();
    let mut params = HashMap::new();
    params.insert("client_id", client_id);
    params.insert("client_secret", client_secret);
    params.insert("grant_type", "client_credentials");

    let res = client
        .post("https://id.twitch.tv/oauth2/token")
        .form(&params)
        .send()
        .await?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!("Client credentials exchange failed: {}", err_text)));
    }

    let token_data: TokenResponse = res.json().await?;
    Ok(token_data.access_token)
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

pub async fn get_user_by_login(client_id: &str, access_token: &str, login: &str) -> Result<TwitchUser, AppError> {
    let client = reqwest::Client::new();
    let url = format!("https://api.twitch.tv/helix/users?login={}", login);
    let res = client
        .get(&url)
        .header("Client-Id", client_id)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Twitch(format!("Failed to fetch user by login: {}", text)));
    }

    let body: HelixUsersResponse = res.json().await?;
    let user = body.data.into_iter().next().ok_or_else(|| {
        AppError::Twitch(format!("Channel @{} not found on Twitch", login))
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

pub async fn delete_vod(
    client_id: &str,
    access_token: &str,
    vod_id: &str,
) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    let url = format!("https://api.twitch.tv/helix/videos?id={}", vod_id);

    let res = client
        .delete(&url)
        .header("Client-Id", client_id)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Twitch(format!("Failed to delete VOD #{}: {}", vod_id, text)));
    }

    Ok(())
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

    let mut req = client
        .post("https://gql.twitch.tv/gql")
        .header("Client-Id", "kimne78kx3ncx6brgo4mv6wki5h1ko")
        .json(&gql_query);

    if !access_token.is_empty() {
        req = req.header("Authorization", format!("OAuth {}", access_token));
    }

    let gql_res = req.send().await?;

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
        if rest.starts_with('"') {
            let quote_end = rest[1..].find('"')?;
            return Some(rest[1..=quote_end].to_string());
        } else {
            let end = rest.find(',').unwrap_or(rest.len());
            return Some(rest[..end].trim().to_string());
        }
    }
    None
}
