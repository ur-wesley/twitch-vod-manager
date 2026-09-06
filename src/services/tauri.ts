import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ResultAsync } from "@ur-wesley/ts-prelude/result";
import type {
  AppSettings,
  CompressionProgress,
  DownloadProgress,
  DriveTransferProgress,
  FfmpegInfo,
  GoogleDriveFile,
  S3Object,
  S3TransferProgress,
  StableError,
  StorageQuota,
  SystemHardwareInfo,
  ToolDownloadProgress,
  TwitchUser,
  TwitchVod,
  VodQuality,
  WebDavFile,
  WorkerJob,
  WorkerJobLog,
  WorkerStatus,
  YouTubeUploadProgress,
  YouTubeVideoMetadata,
} from "~/types";

function mapInvokeError(e: unknown): StableError {
  if (typeof e === "object" && e !== null && "code" in e && "message" in e) {
    return e as StableError;
  }
  return {
    code: "UNKNOWN_ERROR",
    message: typeof e === "string" ? e : JSON.stringify(e),
  };
}

export function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): ResultAsync<T, StableError> {
  return ResultAsync.fromPromise(invoke<T>(cmd, args), mapInvokeError);
}

// Settings API
export const getSettings = (): ResultAsync<AppSettings, StableError> =>
  tauriInvoke<AppSettings>("get_settings");

export const saveSettings = (settings: AppSettings): ResultAsync<void, StableError> =>
  tauriInvoke<void>("save_settings", { settings });

export const importSettingsToml = (tomlStr: string): ResultAsync<AppSettings, StableError> =>
  tauriInvoke<AppSettings>("import_settings_toml", { tomlStr });

export const exportSettingsToml = (): ResultAsync<string, StableError> =>
  tauriInvoke<string>("export_settings_toml");

// Twitch API
export const loginTwitch = (): ResultAsync<TwitchUser, StableError> =>
  tauriInvoke<TwitchUser>("login_twitch");

export const logoutTwitch = (): ResultAsync<void, StableError> =>
  tauriInvoke<void>("logout_twitch");

export const setTwitchToken = (token: string): ResultAsync<TwitchUser, StableError> =>
  tauriInvoke<TwitchUser>("set_twitch_token", { token });

export const getTwitchUser = (): ResultAsync<TwitchUser, StableError> =>
  tauriInvoke<TwitchUser>("get_twitch_user");

export const listVods = (channel?: string): ResultAsync<TwitchVod[], StableError> =>
  tauriInvoke<TwitchVod[]>("list_vods", { channel: channel || null });

export const resolveChannel = (channel: string): ResultAsync<TwitchUser, StableError> =>
  tauriInvoke<TwitchUser>("resolve_channel", { channel });

export const getQualities = (vodId: string): ResultAsync<VodQuality[], StableError> =>
  tauriInvoke<VodQuality[]>("get_qualities", { vodId });

export const deleteTwitchVod = (vodId: string): ResultAsync<void, StableError> =>
  tauriInvoke<void>("delete_twitch_vod", { vodId });

// FFmpeg & Tools
export const detectFfmpeg = (): ResultAsync<FfmpegInfo, StableError> =>
  tauriInvoke<FfmpegInfo>("detect_ffmpeg");

export const getSystemHardwareInfo = (): ResultAsync<SystemHardwareInfo, StableError> =>
  tauriInvoke<SystemHardwareInfo>("get_system_hardware_info");

export const downloadAndInstallFfmpeg = (): ResultAsync<FfmpegInfo, StableError> =>
  tauriInvoke<FfmpegInfo>("download_and_install_ffmpeg");

// Pipeline
export interface StartPipelineArgs {
  vodId: string;
  playlistUrl: string;
  preset: string;
  crf: number;
  durationSecs?: number;
  startSecs?: number;
  endSecs?: number;
  saveLocal?: boolean;
  uploadToS3?: boolean;
  uploadToGdrive?: boolean;
  uploadToWebdav?: boolean;
  uploadToYouTube?: boolean;
  youtubeMetadata?: YouTubeVideoMetadata;
  deleteFromTwitchAfter?: boolean;
}

export const startPipeline = (args: StartPipelineArgs): ResultAsync<string, StableError> =>
  tauriInvoke<string>("start_pipeline", {
    vodId: args.vodId,
    playlistUrl: args.playlistUrl,
    preset: args.preset,
    crf: args.crf,
    durationSecs: args.durationSecs,
    startSecs: args.startSecs,
    endSecs: args.endSecs,
    saveLocal: args.saveLocal ?? true,
    uploadToS3: args.uploadToS3 ?? true,
    uploadToGdrive: args.uploadToGdrive ?? false,
    uploadToWebdav: args.uploadToWebdav ?? false,
    uploadToYouTube: args.uploadToYouTube ?? false,
    youtubeMetadata: args.youtubeMetadata,
    deleteFromTwitchAfter: args.deleteFromTwitchAfter ?? false,
  });

export const cancelActiveTask = (): ResultAsync<void, StableError> =>
  tauriInvoke<void>("cancel_active_task");

// S3 Storage
export const listS3Vods = (): ResultAsync<S3Object[], StableError> =>
  tauriInvoke<S3Object[]>("list_s3_vods");

export const downloadS3Vod = (
  objectKey: string,
  destinationPath: string,
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("download_s3_vod", { objectKey, destinationPath });

export const deleteS3Vod = (objectKey: string): ResultAsync<void, StableError> =>
  tauriInvoke<void>("delete_s3_vod", { objectKey });

// Google Drive Storage
export const loginGdrive = (): ResultAsync<boolean, StableError> =>
  tauriInvoke<boolean>("login_gdrive");

export const logoutGdrive = (): ResultAsync<boolean, StableError> =>
  tauriInvoke<boolean>("logout_gdrive");

export const listGdriveVods = (): ResultAsync<GoogleDriveFile[], StableError> =>
  tauriInvoke<GoogleDriveFile[]>("list_gdrive_vods");

export const getGdriveQuota = (): ResultAsync<StorageQuota, StableError> =>
  tauriInvoke<StorageQuota>("get_gdrive_quota");

export const downloadGdriveVod = (
  fileId: string,
  vodId: string,
  destinationPath: string,
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("download_gdrive_vod", { fileId, vodId, destinationPath });

export const deleteGdriveVod = (fileId: string): ResultAsync<void, StableError> =>
  tauriInvoke<void>("delete_gdrive_vod", { fileId });

// WebDAV Storage
export const listWebdavVods = (): ResultAsync<WebDavFile[], StableError> =>
  tauriInvoke<WebDavFile[]>("list_webdav_vods");

export const getWebdavQuota = (): ResultAsync<StorageQuota, StableError> =>
  tauriInvoke<StorageQuota>("get_webdav_quota");

export const downloadWebdavVod = (
  filenameOrHref: string,
  vodId: string,
  destinationPath: string,
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("download_webdav_vod", { filenameOrHref, vodId, destinationPath });

export const deleteWebdavVod = (filenameOrHref: string): ResultAsync<void, StableError> =>
  tauriInvoke<void>("delete_webdav_vod", { filenameOrHref });

// YouTube
export const loginYouTube = (): ResultAsync<boolean, StableError> =>
  tauriInvoke<boolean>("login_youtube");

export const logoutYouTube = (): ResultAsync<void, StableError> =>
  tauriInvoke<void>("logout_youtube");

export const setYouTubeToken = (token: string): ResultAsync<void, StableError> =>
  tauriInvoke<void>("set_youtube_token", { token });

export const publishToYouTube = (
  vodId: string,
  localVideoPath: string,
  metadata: YouTubeVideoMetadata,
): ResultAsync<string, StableError> =>
  tauriInvoke<string>("publish_to_youtube", { vodId, localVideoPath, metadata });

// Cloud VPS Worker API
export const workerGetStatus = (
  workerUrl: string,
  apiKey?: string,
): ResultAsync<WorkerStatus, StableError> =>
  tauriInvoke<WorkerStatus>("worker_get_status", { workerUrl, apiKey });

export const workerSyncSettings = (
  workerUrl: string,
  apiKey?: string,
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("worker_sync_settings", { workerUrl, apiKey });

export const workerListJobs = (
  workerUrl: string,
  apiKey?: string,
): ResultAsync<WorkerJob[], StableError> =>
  tauriInvoke<WorkerJob[]>("worker_list_jobs", { workerUrl, apiKey });

export interface WorkerDispatchJobArgs {
  workerUrl: string;
  apiKey?: string;
  vodId: string;
  title: string;
  playlistUrl: string;
  preset?: string;
  crf?: number;
  durationSecs?: number;
  startSecs?: number;
  endSecs?: number;
  saveLocal?: boolean;
  uploadToS3?: boolean;
  uploadToGdrive?: boolean;
  gdriveFolderId?: string;
  uploadToWebdav?: boolean;
  webdavFolder?: string;
  uploadToYouTube?: boolean;
  youtubeMetadata?: YouTubeVideoMetadata;
  deleteFromTwitchAfter?: boolean;
}

export const workerDispatchJob = (
  args: WorkerDispatchJobArgs,
): ResultAsync<{ job_id: string; message: string }, StableError> =>
  tauriInvoke<{ job_id: string; message: string }>("worker_dispatch_job", {
    workerUrl: args.workerUrl,
    apiKey: args.apiKey,
    vodId: args.vodId,
    title: args.title,
    playlistUrl: args.playlistUrl,
    preset: args.preset,
    crf: args.crf,
    durationSecs: args.durationSecs,
    startSecs: args.startSecs,
    endSecs: args.endSecs,
    saveLocal: args.saveLocal,
    uploadToS3: args.uploadToS3,
    uploadToGdrive: args.uploadToGdrive,
    gdriveFolderId: args.gdriveFolderId,
    uploadToWebdav: args.uploadToWebdav,
    webdavFolder: args.webdavFolder,
    uploadToYouTube: args.uploadToYouTube,
    youtubeMetadata: args.youtubeMetadata,
    deleteFromTwitchAfter: args.deleteFromTwitchAfter,
  });

export const workerCancelJob = (
  workerUrl: string,
  apiKey: string | undefined,
  jobId: string,
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("worker_cancel_job", { workerUrl, apiKey, jobId });

export const workerGetJobLogs = (
  workerUrl: string,
  apiKey: string | undefined,
  jobId: string,
): ResultAsync<WorkerJobLog[], StableError> =>
  tauriInvoke<WorkerJobLog[]>("worker_get_job_logs", { workerUrl, apiKey, jobId });

export const workerDeleteJob = (
  workerUrl: string,
  apiKey: string | undefined,
  jobId: string,
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("worker_delete_job", { workerUrl, apiKey, jobId });

export const workerTriggerWatcher = (
  workerUrl: string,
  apiKey?: string,
): ResultAsync<{ success: boolean; queued_jobs: number; message?: string }, StableError> =>
  tauriInvoke<{ success: boolean; queued_jobs: number; message?: string }>(
    "worker_trigger_watcher",
    { workerUrl, apiKey },
  );

export const workerDownloadFile = (
  workerUrl: string,
  apiKey: string | undefined,
  jobId: string,
  destinationPath: string,
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("worker_download_file", {
    workerUrl,
    apiKey,
    jobId,
    destinationPath,
  });

// Event Listeners
export const onDownloadProgress = (
  callback: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> => {
  return listen<DownloadProgress>("download-progress", (event) => {
    callback(event.payload);
  });
};

export const onCompressionProgress = (
  callback: (progress: CompressionProgress) => void,
): Promise<UnlistenFn> => {
  return listen<CompressionProgress>("compression-progress", (event) => {
    callback(event.payload);
  });
};

export const onS3UploadProgress = (
  callback: (progress: S3TransferProgress) => void,
): Promise<UnlistenFn> => {
  return listen<S3TransferProgress>("s3-upload-progress", (event) => {
    callback(event.payload);
  });
};

export const onS3DownloadProgress = (
  callback: (progress: S3TransferProgress) => void,
): Promise<UnlistenFn> => {
  return listen<S3TransferProgress>("s3-download-progress", (event) => {
    callback(event.payload);
  });
};

export const onYouTubeUploadProgress = (
  callback: (progress: YouTubeUploadProgress) => void,
): Promise<UnlistenFn> => {
  return listen<YouTubeUploadProgress>("youtube-upload-progress", (event) => {
    callback(event.payload);
  });
};

export const onDriveUploadProgress = (
  callback: (progress: DriveTransferProgress) => void,
): Promise<UnlistenFn> => {
  return listen<DriveTransferProgress>("drive-upload-progress", (event) => {
    callback(event.payload);
  });
};

export const onToolDownloadProgress = (
  callback: (progress: ToolDownloadProgress) => void,
): Promise<UnlistenFn> => {
  return listen<ToolDownloadProgress>("tool-download-progress", (event) => {
    callback(event.payload);
  });
};

export interface WorkerDownloadProgress {
  job_id: string;
  downloaded_bytes: number;
  total_bytes: number;
  percent: number;
}

export const onWorkerDownloadProgress = (
  callback: (progress: WorkerDownloadProgress) => void,
): Promise<UnlistenFn> => {
  return listen<WorkerDownloadProgress>("worker-download-progress", (event) => {
    callback(event.payload);
  });
};

export type UpdateInfoDto = {
  version: string;
  currentVersion: string;
  notes: string;
};

export const checkForUpdates = (): ResultAsync<UpdateInfoDto | null, StableError> =>
  tauriInvoke<UpdateInfoDto | null>("check_for_updates");

export const installUpdate = (): ResultAsync<void, StableError> =>
  tauriInvoke<void>("install_update");
