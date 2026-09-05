use crate::error::AppError;
use crate::reporter::{DriveTransferProgress, DynReporter};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavCredentials {
    pub endpoint: String,
    pub username: String,
    pub password: String,
    pub folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavFile {
    pub href: String,
    pub name: String,
    pub size_bytes: u64,
    pub last_modified: String,
}

fn build_webdav_url(endpoint: &str, folder: Option<&str>, filename: Option<&str>) -> String {
    let mut url = endpoint.trim_end_matches('/').to_string();
    if let Some(f) = folder {
        let clean_f = f.trim_matches('/');
        if !clean_f.is_empty() {
            url.push('/');
            url.push_str(clean_f);
        }
    }
    if let Some(name) = filename {
        url.push('/');
        url.push_str(name.trim_start_matches('/'));
    }
    url
}

pub async fn ensure_webdav_collection(
    client: &reqwest::Client,
    url: &str,
    username: &str,
    password: &str,
) -> Result<(), AppError> {
    let res = client
        .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), url)
        .basic_auth(username, Some(password))
        .send()
        .await;

    // 201 Created or 405 Method Not Allowed (already exists) are fine
    if let Ok(r) = res {
        if r.status().is_success() || r.status() == reqwest::StatusCode::METHOD_NOT_ALLOWED {
            return Ok(());
        }
    }
    Ok(())
}

pub async fn upload_vod_to_webdav(
    reporter: DynReporter,
    vod_id: &str,
    credentials: &WebDavCredentials,
    video_path: &Path,
    custom_filename: Option<&str>,
    is_cancelled: Arc<AtomicBool>,
) -> Result<String, AppError> {
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

    // Optional folder check
    if let Some(ref folder) = credentials.folder {
        if !folder.trim().is_empty() {
            let folder_url = build_webdav_url(&credentials.endpoint, Some(folder), None);
            let _ = ensure_webdav_collection(&client, &folder_url, &credentials.username, &credentials.password).await;
        }
    }

    let target_url = build_webdav_url(
        &credentials.endpoint,
        credentials.folder.as_deref(),
        Some(&filename),
    );

    let mut file = tokio::fs::File::open(video_path).await?;
    let mut uploaded_bytes = 0u64;
    let start_time = Instant::now();

    // Emitting initial progress
    reporter.report_drive(&DriveTransferProgress {
        vod_id: vod_id.to_string(),
        provider: "webdav".to_string(),
        bytes_transferred: 0,
        total_bytes,
        percent: 0.0,
        speed_mbps: 0.0,
        file_id: Some(filename.clone()),
        view_url: Some(target_url.clone()),
    });

    let mut file_content = Vec::with_capacity(total_bytes as usize);
    let mut buf = vec![0u8; 1024 * 1024]; // 1MB chunks for reading
    while let Ok(n) = file.read(&mut buf).await {
        if n == 0 {
            break;
        }
        if is_cancelled.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        file_content.extend_from_slice(&buf[..n]);
        uploaded_bytes += n as u64;

        let elapsed = start_time.elapsed().as_secs_f64();
        let speed_mbps = if elapsed > 0.0 {
            (uploaded_bytes as f64 * 8.0) / (elapsed * 1_000_000.0)
        } else {
            0.0
        };
        let percent = (uploaded_bytes as f64 / total_bytes as f64) * 50.0; // Reading phase: 0-50%

        reporter.report_drive(&DriveTransferProgress {
            vod_id: vod_id.to_string(),
            provider: "webdav".to_string(),
            bytes_transferred: uploaded_bytes,
            total_bytes,
            percent,
            speed_mbps,
            file_id: Some(filename.clone()),
            view_url: Some(target_url.clone()),
        });
    }

    // PUT to WebDAV server
    let put_res = client
        .put(&target_url)
        .basic_auth(&credentials.username, Some(&credentials.password))
        .header("Content-Type", "video/mp4")
        .header("Content-Length", total_bytes.to_string())
        .body(file_content)
        .send()
        .await?;

    let status = put_res.status();
    if !status.is_success()
        && status != reqwest::StatusCode::CREATED
        && status != reqwest::StatusCode::NO_CONTENT
    {
        let text = put_res.text().await.unwrap_or_default();
        return Err(AppError::WebDav(format!(
            "WebDAV upload failed with status {}: {}",
            status,
            text
        )));
    }

    let elapsed = start_time.elapsed().as_secs_f64();
    let speed_mbps = if elapsed > 0.0 {
        (total_bytes as f64 * 8.0) / (elapsed * 1_000_000.0)
    } else {
        0.0
    };

    reporter.report_drive(&DriveTransferProgress {
        vod_id: vod_id.to_string(),
        provider: "webdav".to_string(),
        bytes_transferred: total_bytes,
        total_bytes,
        percent: 100.0,
        speed_mbps,
        file_id: Some(filename.clone()),
        view_url: Some(target_url.clone()),
    });

    Ok(target_url)
}

pub async fn list_webdav_vods(
    credentials: &WebDavCredentials,
) -> Result<Vec<WebDavFile>, AppError> {
    let client = reqwest::Client::new();
    let url = build_webdav_url(&credentials.endpoint, credentials.folder.as_deref(), None);

    let propfind_body = r#"<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>"#;

    let res = client
        .request(
            reqwest::Method::from_bytes(b"PROPFIND").unwrap(),
            &url,
        )
        .basic_auth(&credentials.username, Some(&credentials.password))
        .header("Depth", "1")
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(propfind_body)
        .send()
        .await?;

    if !res.status().is_success() && res.status() != reqwest::StatusCode::MULTI_STATUS {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::WebDav(format!(
            "Failed to list WebDAV files: {}",
            text
        )));
    }

    let xml = res.text().await?;
    parse_webdav_xml(&xml)
}

pub fn parse_webdav_quota_xml(xml: &str) -> Result<crate::StorageQuota, AppError> {
    let used = extract_tag(xml, "quota-used-bytes")
        .and_then(|s| s.parse::<u64>().ok());
    let available_raw = extract_tag(xml, "quota-available-bytes")
        .and_then(|s| s.parse::<i64>().ok());

    let available_bytes = match available_raw {
        Some(n) if n >= 0 => Some(n as u64),
        _ => None,
    };
    if used.is_none() && available_bytes.is_none() {
        return Err(AppError::WebDav(
            "WebDAV server did not report quota".into(),
        ));
    }
    let used_bytes = used.unwrap_or(0);
    let total_bytes = match (used, available_bytes) {
        (Some(u), Some(a)) => Some(u.saturating_add(a)),
        (None, Some(a)) => Some(a),
        _ => None,
    };

    Ok(crate::StorageQuota {
        used_bytes,
        total_bytes,
        available_bytes,
    })
}

pub async fn get_webdav_quota(
    credentials: &WebDavCredentials,
) -> Result<crate::StorageQuota, AppError> {
    let client = reqwest::Client::new();
    let url = build_webdav_url(&credentials.endpoint, credentials.folder.as_deref(), None);

    let propfind_body = r#"<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:quota-available-bytes/>
    <D:quota-used-bytes/>
  </D:prop>
</D:propfind>"#;

    let res = client
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url)
        .basic_auth(&credentials.username, Some(&credentials.password))
        .header("Depth", "0")
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(propfind_body)
        .send()
        .await?;

    if !res.status().is_success() && res.status() != reqwest::StatusCode::MULTI_STATUS {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::WebDav(format!(
            "Failed to query WebDAV quota: {}",
            text
        )));
    }

    let xml = res.text().await?;
    parse_webdav_quota_xml(&xml)
}

fn parse_webdav_xml(xml: &str) -> Result<Vec<WebDavFile>, AppError> {
    let mut files = Vec::new();
    let mut start_pos = 0;

    while let Some(start_idx) = xml[start_pos..].find("<d:response")
        .or_else(|| xml[start_pos..].find("<D:response"))
    {
        let resp_start = start_pos + start_idx;
        let resp_end = match xml[resp_start..].find("</d:response>")
            .or_else(|| xml[resp_start..].find("</D:response>"))
        {
            Some(i) => resp_start + i + 13,
            None => break,
        };

        let chunk = &xml[resp_start..resp_end];
        let href = extract_tag(chunk, "href").unwrap_or_default();
        let display_name = extract_tag(chunk, "displayname").unwrap_or_default();
        let size_str = extract_tag(chunk, "getcontentlength").unwrap_or_default();
        let last_mod = extract_tag(chunk, "getlastmodified").unwrap_or_default();
        let is_collection = chunk.contains("<d:collection/>") || chunk.contains("<D:collection/>");

        let name = if !display_name.is_empty() {
            display_name
        } else {
            href.trim_end_matches('/').split('/').last().unwrap_or("").to_string()
        };

        if !is_collection && (name.ends_with(".mp4") || name.ends_with(".mkv") || name.ends_with(".ts")) {
            files.push(WebDavFile {
                href,
                name,
                size_bytes: size_str.parse().unwrap_or(0),
                last_modified: last_mod,
            });
        }

        start_pos = resp_end;
    }

    Ok(files)
}

fn extract_tag(xml: &str, tag: &str) -> Option<String> {
    let lower_tag = tag.to_lowercase();
    let patterns = [
        format!("<d:{}>", lower_tag),
        format!("<D:{}>", lower_tag),
        format!("<{}>", lower_tag),
    ];
    let end_patterns = [
        format!("</d:{}>", lower_tag),
        format!("</D:{}>", lower_tag),
        format!("</{}>", lower_tag),
    ];

    for (start_p, end_p) in patterns.iter().zip(end_patterns.iter()) {
        if let Some(start_idx) = xml.find(start_p) {
            let val_start = start_idx + start_p.len();
            if let Some(end_idx) = xml[val_start..].find(end_p) {
                return Some(xml[val_start..val_start + end_idx].trim().to_string());
            }
        }
    }
    None
}

pub async fn delete_webdav_object(
    credentials: &WebDavCredentials,
    filename_or_href: &str,
) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    let url = if filename_or_href.starts_with("http://") || filename_or_href.starts_with("https://") {
        filename_or_href.to_string()
    } else {
        build_webdav_url(
            &credentials.endpoint,
            credentials.folder.as_deref(),
            Some(filename_or_href),
        )
    };

    let res = client
        .delete(&url)
        .basic_auth(&credentials.username, Some(&credentials.password))
        .send()
        .await?;

    if !res.status().is_success()
        && res.status() != reqwest::StatusCode::NO_CONTENT
        && res.status() != reqwest::StatusCode::NOT_FOUND
    {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::WebDav(format!(
            "Failed to delete WebDAV file: {}",
            text
        )));
    }

    Ok(())
}

pub async fn download_webdav_file(
    reporter: DynReporter,
    vod_id: &str,
    credentials: &WebDavCredentials,
    filename_or_href: &str,
    destination_path: &Path,
    is_cancelled: Arc<AtomicBool>,
) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    let url = if filename_or_href.starts_with("http://") || filename_or_href.starts_with("https://") {
        filename_or_href.to_string()
    } else {
        build_webdav_url(
            &credentials.endpoint,
            credentials.folder.as_deref(),
            Some(filename_or_href),
        )
    };

    let mut res = client
        .get(&url)
        .basic_auth(&credentials.username, Some(&credentials.password))
        .send()
        .await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::WebDav(format!(
            "Failed to download WebDAV file: {}",
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
            provider: "webdav".to_string(),
            bytes_transferred: downloaded,
            total_bytes,
            percent,
            speed_mbps,
            file_id: Some(filename_or_href.to_string()),
            view_url: Some(url.clone()),
        });
    }

    file.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_webdav_quota_xml;

    #[test]
    fn parses_prefixed_quota_props() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:propstat>
      <d:prop>
        <d:quota-available-bytes>400000000000</d:quota-available-bytes>
        <d:quota-used-bytes>100000000000</d:quota-used-bytes>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>"#;
        let quota = parse_webdav_quota_xml(xml).unwrap();
        assert_eq!(quota.used_bytes, 100_000_000_000);
        assert_eq!(quota.available_bytes, Some(400_000_000_000));
        assert_eq!(quota.total_bytes, Some(500_000_000_000));
    }

    #[test]
    fn available_only_sets_used_zero() {
        let xml = r#"<D:prop><D:quota-available-bytes>50</D:quota-available-bytes></D:prop>"#;
        let quota = parse_webdav_quota_xml(xml).unwrap();
        assert_eq!(quota.used_bytes, 0);
        assert_eq!(quota.available_bytes, Some(50));
        assert_eq!(quota.total_bytes, Some(50));
    }

    #[test]
    fn missing_and_negative_available_are_unknown() {
        let missing = parse_webdav_quota_xml("<d:prop><d:quota-used-bytes>10</d:quota-used-bytes></d:prop>").unwrap();
        assert_eq!(missing.used_bytes, 10);
        assert_eq!(missing.available_bytes, None);
        assert_eq!(missing.total_bytes, None);

        let negative = parse_webdav_quota_xml(
            "<d:prop><d:quota-available-bytes>-3</d:quota-available-bytes><d:quota-used-bytes>10</d:quota-used-bytes></d:prop>",
        )
        .unwrap();
        assert_eq!(negative.used_bytes, 10);
        assert_eq!(negative.available_bytes, None);
        assert_eq!(negative.total_bytes, None);
    }

    #[test]
    fn errors_when_no_quota_props() {
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop/></d:propstat></d:response></d:multistatus>"#;
        assert!(parse_webdav_quota_xml(xml).is_err());
    }
}

