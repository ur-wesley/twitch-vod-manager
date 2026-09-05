use crate::error::AppError;
use crate::reporter::{DynReporter, S3TransferProgress};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Object {
    pub key: String,
    pub size_bytes: u64,
    pub last_modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Credentials {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
}

type HmacSha256 = Hmac<Sha256>;

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn get_signature_key(key: &str, date: &str, region: &str, service: &str) -> Vec<u8> {
    let k_date = hmac_sha256(format!("AWS4{}", key).as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    hmac_sha256(&k_service, b"aws4_request")
}

pub fn sign_s3_request(
    method: &str,
    endpoint: &str,
    bucket: &str,
    path: &str,
    query_str: &str,
    payload_hash: &str,
    region: &str,
    access_key: &str,
    secret_key: &str,
) -> (reqwest::header::HeaderMap, String) {
    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();

    let clean_endpoint = endpoint
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');

    let host = clean_endpoint.to_string();

    let canonical_uri = if path.starts_with('/') {
        format!("/{}{}", bucket, path)
    } else {
        format!("/{}/{}", bucket, path)
    };

    let canonical_headers = format!(
        "host:{}\nx-amz-content-sha256:{}\nx-amz-date:{}\n",
        host, payload_hash, amz_date
    );
    let signed_headers = "host;x-amz-content-sha256;x-amz-date";

    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        method, canonical_uri, query_str, canonical_headers, signed_headers, payload_hash
    );

    let canonical_request_hash = hex::encode(Sha256::digest(canonical_request.as_bytes()));
    let credential_scope = format!("{}/{}/s3/aws4_request", date_stamp, region);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date, credential_scope, canonical_request_hash
    );

    let signing_key = get_signature_key(secret_key, &date_stamp, region, "s3");
    let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes()));

    let authorization_header = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        access_key, credential_scope, signed_headers, signature
    );

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("x-amz-date", amz_date.parse().unwrap());
    headers.insert("x-amz-content-sha256", payload_hash.parse().unwrap());
    headers.insert("Authorization", authorization_header.parse().unwrap());
    headers.insert("host", host.parse().unwrap());

    let scheme = if endpoint.starts_with("http://") { "http" } else { "https" };
    let full_url = if query_str.is_empty() {
        format!("{}://{}{}", scheme, host, canonical_uri)
    } else {
        format!("{}://{}{}?{}", scheme, host, canonical_uri, query_str)
    };

    (headers, full_url)
}

pub async fn list_bucket_vods(
    endpoint: &str,
    region: &str,
    bucket: &str,
    access_key: &str,
    secret_key: &str,
) -> Result<Vec<S3Object>, AppError> {
    let payload_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // sha256 of empty string
    let query_str = "list-type=2&prefix=vods/";

    let (headers, url) = sign_s3_request(
        "GET",
        endpoint,
        bucket,
        "",
        query_str,
        payload_hash,
        region,
        access_key,
        secret_key,
    );

    let client = reqwest::Client::new();
    let res = client.get(&url).headers(headers).send().await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Storage(format!("Failed to list bucket: {}", text)));
    }

    let xml = res.text().await?;
    parse_s3_contents(&xml)
}

fn parse_s3_contents(xml: &str) -> Result<Vec<S3Object>, AppError> {
    let mut objects = Vec::new();

    // Simple robust XML extraction of <Contents>
    let mut start_pos = 0;
    while let Some(start_idx) = xml[start_pos..].find("<Contents>") {
        let content_start = start_pos + start_idx + 10;
        let end_idx = match xml[content_start..].find("</Contents>") {
            Some(i) => content_start + i,
            None => break,
        };

        let chunk = &xml[content_start..end_idx];
        let key = extract_tag_value(chunk, "Key").unwrap_or_default();
        let size_str = extract_tag_value(chunk, "Size").unwrap_or_default();
        let last_mod = extract_tag_value(chunk, "LastModified").unwrap_or_default();

        if !key.is_empty() && !key.ends_with('/') {
            objects.push(S3Object {
                key,
                size_bytes: size_str.parse().unwrap_or(0),
                last_modified: last_mod,
            });
        }

        start_pos = end_idx + 11;
    }

    Ok(objects)
}

fn extract_tag_value(xml: &str, tag: &str) -> Option<String> {
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);
    let start = xml.find(&open_tag)? + open_tag.len();
    let end = xml[start..].find(&close_tag)? + start;
    Some(xml[start..end].trim().to_string())
}

#[allow(clippy::too_many_arguments)]
pub async fn upload_vod_to_s3(
    reporter: DynReporter,
    vod_id: &str,
    endpoint: &str,
    region: &str,
    bucket: &str,
    access_key: &str,
    secret_key: &str,
    local_file: &Path,
    object_key: &str,
    is_cancelled: Arc<AtomicBool>,
) -> Result<(), AppError> {
    let metadata = tokio::fs::metadata(local_file).await?;
    let total_bytes = metadata.len();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()?;

    let bytes = tokio::fs::read(local_file).await?;
    let payload_hash = hex::encode(Sha256::digest(&bytes));

    let (mut headers, url) = sign_s3_request(
        "PUT",
        endpoint,
        bucket,
        object_key,
        "",
        &payload_hash,
        region,
        access_key,
        secret_key,
    );
    headers.insert("Content-Type", "video/mp4".parse().unwrap());

    if is_cancelled.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }

    let start_time = Instant::now();

    reporter.report_s3(&S3TransferProgress {
        vod_id: vod_id.to_string(),
        bytes_transferred: 0,
        total_bytes,
        percent: 0.0,
        speed_mbps: 0.0,
        is_upload: true,
    });

    let res = client.put(&url).headers(headers).body(bytes).send().await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Storage(format!("S3 upload failed: {}", text)));
    }

    let elapsed = start_time.elapsed().as_secs_f64();
    let speed_mbps = if elapsed > 0.0 {
        (total_bytes as f64 * 8.0) / (elapsed * 1_000_000.0)
    } else {
        0.0
    };

    reporter.report_s3(&S3TransferProgress {
        vod_id: vod_id.to_string(),
        bytes_transferred: total_bytes,
        total_bytes,
        percent: 100.0,
        speed_mbps,
        is_upload: true,
    });

    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn download_vod_from_s3(
    reporter: DynReporter,
    vod_id: &str,
    endpoint: &str,
    region: &str,
    bucket: &str,
    access_key: &str,
    secret_key: &str,
    object_key: &str,
    destination_path: &Path,
    is_cancelled: Arc<AtomicBool>,
) -> Result<(), AppError> {
    let payload_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    let (headers, url) = sign_s3_request(
        "GET",
        endpoint,
        bucket,
        object_key,
        "",
        payload_hash,
        region,
        access_key,
        secret_key,
    );

    let client = reqwest::Client::new();
    let mut res = client.get(&url).headers(headers).send().await?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Storage(format!("S3 download failed: {}", text)));
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

        reporter.report_s3(&S3TransferProgress {
            vod_id: vod_id.to_string(),
            bytes_transferred: downloaded,
            total_bytes,
            percent,
            speed_mbps,
            is_upload: false,
        });
    }

    file.flush().await?;
    Ok(())
}

pub async fn delete_s3_object(
    endpoint: &str,
    region: &str,
    bucket: &str,
    access_key: &str,
    secret_key: &str,
    object_key: &str,
) -> Result<(), AppError> {
    let payload_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    let (headers, url) = sign_s3_request(
        "DELETE",
        endpoint,
        bucket,
        object_key,
        "",
        payload_hash,
        region,
        access_key,
        secret_key,
    );

    let client = reqwest::Client::new();
    let res = client.delete(&url).headers(headers).send().await?;

    if !res.status().is_success() && res.status() != 204 {
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Storage(format!("Failed to delete object: {}", text)));
    }

    Ok(())
}
