export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface TwitchVod {
  id: string;
  stream_id?: string;
  user_id: string;
  user_name: string;
  title: string;
  description: string;
  created_at: string;
  published_at: string;
  url: string;
  thumbnail_url: string;
  viewable: string;
  view_count: number;
  duration: string;
}

export interface VodQuality {
  name: string;
  resolution?: string;
  fps?: number;
  bandwidth?: number;
  url: string;
}

export interface FfmpegInfo {
  available: boolean;
  path: string;
  version?: string;
  has_nvenc: boolean;
  has_qsv: boolean;
  has_amf: boolean;
}

export interface ToolDownloadProgress {
  tool: string;
  stage: "downloading" | "extracting" | "configuring" | "verifying" | "done" | "error";
  percent: number;
  downloaded_bytes: number;
  total_bytes: number;
  message: string;
}

export interface AppSettings {
  twitch_client_id: string;
  twitch_client_secret: string;
  twitch_access_token?: string;
  twitch_refresh_token?: string;
  twitch_user_id?: string;
  twitch_username?: string;

  s3_provider: string;
  s3_endpoint: string;
  s3_region: string;
  s3_bucket: string;
  s3_access_key: string;
  s3_secret_key: string;

  encoder_preset: string;
  crf: number;
  temp_dir?: string;
  output_dir?: string;

  youtube_client_id?: string;
  youtube_client_secret?: string;
  youtube_access_token?: string;
  youtube_refresh_token?: string;

  // Google Drive settings
  gdrive_client_id?: string;
  gdrive_client_secret?: string;
  gdrive_access_token?: string;
  gdrive_refresh_token?: string;
  gdrive_folder_id?: string;

  // WebDAV settings
  webdav_endpoint?: string;
  webdav_username?: string;
  webdav_password?: string;
  webdav_folder?: string;

  ffmpeg_path?: string;
  auto_download_tools?: boolean;

  // Cloud Worker (VPS) settings
  worker_url?: string;
  worker_api_key?: string;
  worker_auto_sync?: boolean;
  auto_archive_enabled?: boolean;
  auto_archive_interval_mins?: number;
  max_storage_gb?: number;
}

export interface S3Object {
  key: string;
  size_bytes: number;
  last_modified: string;
}

export interface DownloadProgress {
  vod_id: string;
  downloaded_chunks: number;
  total_chunks: number;
  percent: number;
  bytes: number;
  speed_mbps: number;
  eta_seconds: number;
}

export interface CompressionProgress {
  vod_id: string;
  percent: number;
  current_time_secs: number;
  fps: number;
  speed: string;
  size_bytes: number;
}

export interface S3TransferProgress {
  vod_id: string;
  bytes_transferred: number;
  total_bytes: number;
  percent: number;
  speed_mbps: number;
  is_upload: boolean;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  size_bytes: number;
  modified_time: string;
  web_view_link?: string;
}

export interface WebDavFile {
  href: string;
  name: string;
  size_bytes: number;
  last_modified: string;
}

export interface StorageQuota {
  used_bytes: number;
  total_bytes?: number | null;
  available_bytes?: number | null;
}

export interface DriveTransferProgress {
  vod_id: string;
  provider: "gdrive" | "webdav" | string;
  bytes_transferred: number;
  total_bytes: number;
  percent: number;
  speed_mbps: number;
  file_id?: string;
  view_url?: string;
}

export interface YouTubeUploadProgress {
  vod_id: string;
  bytes_uploaded: number;
  total_bytes: number;
  percent: number;
  speed_mbps?: number;
  video_id?: string;
}

export interface YouTubeVideoMetadata {
  title: string;
  description: string;
  privacy_status: "private" | "unlisted" | "public";
  tags?: string[];
}

export interface StableError {
  code: string;
  message: string;
}

// Cloud Worker Interfaces
export interface WorkerStatus {
  status: string;
  version: string;
  uptime_secs: number;
  cpu_usage_percent: number;
  memory_total_mb: number;
  memory_used_mb: number;
  disk_total_gb: number;
  disk_free_gb: number;
  storage_max_gb: number;
  storage_used_gb: number;
  storage_free_gb: number;
  ffmpeg_available: boolean;
  active_jobs_count: number;
  auto_watcher_enabled: boolean;
  has_twitch: boolean;
  has_s3: boolean;
  has_gdrive: boolean;
  has_webdav: boolean;
}

export interface WorkerJob {
  id: string;
  vod_id: string;
  title: string;
  status: "queued" | "downloading" | "compressing" | "uploading_s3" | "uploading_youtube" | "completed" | "failed" | "cancelled";
  stage: string;
  progress_percent: number;
  local_path?: string;
  s3_key?: string;
  youtube_video_id?: string;
  gdrive_file_id?: string;
  gdrive_view_url?: string;
  webdav_path?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkerJobLog {
  id: number;
  job_id: string;
  message: string;
  timestamp: string;
}

export interface PipelineConfig {
  vod_id: string;
  playlist_url: string;
  preset: string;
  crf: number;
  duration_secs?: number;
  save_local?: boolean;
  upload_to_s3?: boolean;
  upload_to_gdrive?: boolean;
  gdrive_folder_id?: string;
  upload_to_webdav?: boolean;
  webdav_folder?: string;
  upload_to_youtube?: boolean;
  youtube_metadata?: YouTubeVideoMetadata;
  delete_from_twitch_after?: boolean;
}
