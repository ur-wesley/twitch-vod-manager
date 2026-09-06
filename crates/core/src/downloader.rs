use crate::error::AppError;
use crate::reporter::{DownloadProgress, DynReporter};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Semaphore;
use url::Url;

#[derive(Debug, Clone)]
pub struct DownloadResult {
    pub concat_file_path: PathBuf,
    pub trim_start_offset: Option<f64>,
    pub trim_duration: Option<f64>,
    pub total_chunks: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SegmentInfo {
    pub url: Url,
    pub duration: f64,
    pub start_time: f64,
    pub end_time: f64,
}

pub fn parse_playlist_segments(body: &str, playlist_url: &str) -> Result<Vec<SegmentInfo>, AppError> {
    let base_url = Url::parse(playlist_url)
        .map_err(|e| AppError::Download(format!("Invalid playlist URL: {}", e)))?;

    let mut segments = Vec::new();
    let mut current_start = 0.0;
    let mut pending_duration: Option<f64> = None;

    for line in body.lines() {
        let line = line.trim();
        if line.starts_with("#EXTINF:") {
            let dur_str = line
                .trim_start_matches("#EXTINF:")
                .split(',')
                .next()
                .unwrap_or("")
                .trim();
            if let Ok(d) = dur_str.parse::<f64>() {
                pending_duration = Some(d);
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            let duration = pending_duration.take().unwrap_or(10.0);
            let full_url = if line.starts_with("http://") || line.starts_with("https://") {
                Url::parse(line).map_err(|e| AppError::Download(e.to_string()))?
            } else {
                base_url
                    .join(line)
                    .map_err(|e| AppError::Download(e.to_string()))?
            };
            let end_time = current_start + duration;
            segments.push(SegmentInfo {
                url: full_url,
                duration,
                start_time: current_start,
                end_time,
            });
            current_start = end_time;
        }
    }

    Ok(segments)
}

pub fn filter_segments_by_range(
    segments: Vec<SegmentInfo>,
    start_secs: Option<f64>,
    end_secs: Option<f64>,
) -> Result<(Vec<SegmentInfo>, Option<f64>, Option<f64>), AppError> {
    if segments.is_empty() {
        return Err(AppError::Download("No media segments found in sub-playlist".into()));
    }

    let start_limit = start_secs.unwrap_or(0.0).max(0.0);
    let total_vod_duration = segments.last().map(|s| s.end_time).unwrap_or(0.0);
    let end_limit = end_secs.unwrap_or(f64::MAX).min(total_vod_duration.max(start_limit));

    if end_limit <= start_limit {
        return Err(AppError::Download(format!(
            "End time ({:.1}s) must be greater than start time ({:.1}s)",
            end_limit, start_limit
        )));
    }

    let is_trimmed = start_secs.is_some() || end_secs.is_some();
    if !is_trimmed {
        return Ok((segments, None, None));
    }

    let filtered: Vec<SegmentInfo> = segments
        .into_iter()
        .filter(|s| s.end_time > start_limit && s.start_time < end_limit)
        .collect();

    if filtered.is_empty() {
        return Err(AppError::Download(format!(
            "No video segments found in the range {:.1}s to {:.1}s",
            start_limit, end_limit
        )));
    }

    let first_chunk_start = filtered.first().map(|s| s.start_time).unwrap_or(0.0);
    let trim_start_offset = (start_limit - first_chunk_start).max(0.0);
    let trim_duration = (end_limit - start_limit).max(0.1);

    Ok((filtered, Some(trim_start_offset), Some(trim_duration)))
}

pub async fn download_vod_chunks(
    reporter: DynReporter,
    vod_id: &str,
    playlist_url: &str,
    work_dir: &Path,
    start_secs: Option<f64>,
    end_secs: Option<f64>,
    is_cancelled: Arc<AtomicBool>,
) -> Result<DownloadResult, AppError> {
    tokio::fs::create_dir_all(work_dir).await?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    // 1. Fetch quality sub-playlist
    reporter.report_log(vod_id, &format!("Fetching playlist manifest: {}", playlist_url));
    let res = client.get(playlist_url).send().await?;
    if !res.status().is_success() {
        let err = format!("Failed to fetch sub-playlist: status {}", res.status());
        reporter.report_log(vod_id, &format!("❌ {}", err));
        return Err(AppError::Download(err));
    }
    let body = res.text().await?;

    // 2. Parse chunk URLs and filter by specified start/end range
    let all_segments = parse_playlist_segments(&body, playlist_url)?;
    let total_available_chunks = all_segments.len();

    let (selected_segments, trim_start_offset, trim_duration) =
        filter_segments_by_range(all_segments, start_secs, end_secs)?;

    let total_chunks = selected_segments.len();
    if total_chunks == 0 {
        let err = "No media segments matched the selected range";
        reporter.report_log(vod_id, &format!("❌ {}", err));
        return Err(AppError::Download(err.into()));
    }

    if start_secs.is_some() || end_secs.is_some() {
        reporter.report_log(
            vod_id,
            &format!(
                "Selective trimming active: downloading {} of {} chunks (range: {:.1}s - {:.1}s, duration: {:.1}s, offset: {:.2}s)",
                total_chunks,
                total_available_chunks,
                start_secs.unwrap_or(0.0),
                end_secs.unwrap_or(0.0),
                trim_duration.unwrap_or(0.0),
                trim_start_offset.unwrap_or(0.0),
            ),
        );
    } else {
        reporter.report_log(
            vod_id,
            &format!("Parsed playlist successfully: found {} video chunks to download.", total_chunks),
        );
    }

    let chunk_urls: Vec<Url> = selected_segments.into_iter().map(|s| s.url).collect();

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
        let reporter = Arc::clone(&reporter);
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
                let err_msg = format!(
                    "Failed to download chunk {} after 3 attempts: {}",
                    index, last_err
                );
                reporter.report_log(&vod_id, &format!("❌ {}", err_msg));
                return Err(AppError::Download(err_msg));
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

                reporter.report_download(&DownloadProgress {
                    vod_id: vod_id.clone(),
                    downloaded_chunks: current_downloaded,
                    total_chunks,
                    percent,
                    bytes: current_bytes,
                    speed_mbps,
                    eta_seconds,
                });

                // Milestone log in history at ~25% intervals
                if current_downloaded == total_chunks
                    || (total_chunks >= 4 && current_downloaded % (total_chunks / 4) == 0)
                {
                    reporter.report_log(
                        &vod_id,
                        &format!(
                            "Download progress: {:.1}% ({}/{} chunks, {:.1} MB/s, ETA: {}s)",
                            percent, current_downloaded, total_chunks, speed_mbps, eta_seconds
                        ),
                    );
                }
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
            Ok(Err(e)) => {
                reporter.report_log(vod_id, &format!("❌ Chunk download task failed: {}", e));
                return Err(e);
            }
            Err(e) => {
                let err_msg = format!("Task panicked: {}", e);
                reporter.report_log(vod_id, &format!("❌ {}", err_msg));
                return Err(AppError::Download(err_msg));
            }
        }
    }

    if is_cancelled.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }

    reporter.report_log(
        vod_id,
        &format!(
            "All {} chunks downloaded successfully ({:.2} MB). Creating concat list...",
            total_chunks,
            total_bytes.load(Ordering::Relaxed) as f64 / 1_000_000.0
        ),
    );

    // 3. Write concat list file for FFmpeg
    let concat_file_path = work_dir.join("concat_list.txt");
    let mut concat_content = String::new();
    for i in 0..total_chunks {
        let chunk_file_name = format!("chunks/chunk_{:06}.ts", i);
        concat_content.push_str(&format!("file '{}'\n", chunk_file_name));
    }
    tokio::fs::write(&concat_file_path, concat_content).await?;

    reporter.report_log(
        vod_id,
        &format!("Concat list created at {}", concat_file_path.display()),
    );

    Ok(DownloadResult {
        concat_file_path,
        trim_start_offset,
        trim_duration,
        total_chunks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_PLAYLIST: &str = r#"#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
chunk-0.ts
#EXTINF:10.000,
chunk-1.ts
#EXTINF:10.000,
chunk-2.ts
#EXTINF:10.000,
chunk-3.ts
#EXTINF:5.500,
chunk-4.ts
#EXT-X-ENDLIST
"#;

    #[test]
    fn test_parse_playlist_segments() {
        let segments = parse_playlist_segments(SAMPLE_PLAYLIST, "https://example.com/vod/index.m3u8").unwrap();
        assert_eq!(segments.len(), 5);
        assert_eq!(segments[0].duration, 10.0);
        assert_eq!(segments[0].start_time, 0.0);
        assert_eq!(segments[0].end_time, 10.0);
        assert_eq!(segments[4].duration, 5.5);
        assert_eq!(segments[4].start_time, 40.0);
        assert_eq!(segments[4].end_time, 45.5);
    }

    #[test]
    fn test_filter_segments_untrimmed() {
        let segments = parse_playlist_segments(SAMPLE_PLAYLIST, "https://example.com/vod/index.m3u8").unwrap();
        let (filtered, offset, dur) = filter_segments_by_range(segments, None, None).unwrap();
        assert_eq!(filtered.len(), 5);
        assert!(offset.is_none());
        assert!(dur.is_none());
    }

    #[test]
    fn test_filter_segments_trimmed_middle() {
        let segments = parse_playlist_segments(SAMPLE_PLAYLIST, "https://example.com/vod/index.m3u8").unwrap();
        // Request 12.0s to 28.0s:
        // Chunk 0 (0-10): end 10 <= 12 -> skipped
        // Chunk 1 (10-20): overlaps [12, 28] -> kept
        // Chunk 2 (20-30): overlaps [12, 28] -> kept
        // Chunk 3 (30-40): start 30 >= 28 -> skipped
        // Chunk 4 (40-45.5): skipped
        let (filtered, offset, dur) = filter_segments_by_range(segments, Some(12.0), Some(28.0)).unwrap();
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].url.as_str(), "https://example.com/vod/chunk-1.ts");
        assert_eq!(filtered[1].url.as_str(), "https://example.com/vod/chunk-2.ts");
        // First kept chunk starts at 10.0s. Start limit is 12.0s. Relative offset = 12.0 - 10.0 = 2.0s
        assert_eq!(offset, Some(2.0));
        // Target duration = 28.0 - 12.0 = 16.0s
        assert_eq!(dur, Some(16.0));
    }

    #[test]
    fn test_filter_segments_invalid_range() {
        let segments = parse_playlist_segments(SAMPLE_PLAYLIST, "https://example.com/vod/index.m3u8").unwrap();
        let res = filter_segments_by_range(segments, Some(30.0), Some(20.0));
        assert!(res.is_err());
    }
}

