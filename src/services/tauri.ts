import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ResultAsync } from "@ur-wesley/ts-prelude/result";
import type {
  AppSettings,
  CompressionProgress,
  DownloadProgress,
  FfmpegInfo,
  S3Object,
  S3TransferProgress,
  StableError,
  ToolDownloadProgress,
  TwitchUser,
  TwitchVod,
  VodQuality,
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
  args?: Record<string, unknown>
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

export const getTwitchUser = (): ResultAsync<TwitchUser, StableError> =>
  tauriInvoke<TwitchUser>("get_twitch_user");

export const listVods = (): ResultAsync<TwitchVod[], StableError> =>
  tauriInvoke<TwitchVod[]>("list_vods");

export const getQualities = (vodId: string): ResultAsync<VodQuality[], StableError> =>
  tauriInvoke<VodQuality[]>("get_qualities", { vodId });

export const deleteTwitchVod = (vodId: string): ResultAsync<void, StableError> =>
  tauriInvoke<void>("delete_twitch_vod", { vodId });

// FFmpeg & Tools
export const detectFfmpeg = (): ResultAsync<FfmpegInfo, StableError> =>
  tauriInvoke<FfmpegInfo>("detect_ffmpeg");

export const downloadAndInstallFfmpeg = (): ResultAsync<FfmpegInfo, StableError> =>
  tauriInvoke<FfmpegInfo>("download_and_install_ffmpeg");

// Pipeline
export interface StartPipelineArgs {
  vodId: string;
  playlistUrl: string;
  preset: string;
  crf: number;
  durationSecs?: number;
  saveLocal?: boolean;
  uploadToS3?: boolean;
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
    saveLocal: args.saveLocal ?? true,
    uploadToS3: args.uploadToS3 ?? true,
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
  destinationPath: string
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("download_s3_vod", { objectKey, destinationPath });

export const deleteS3Vod = (objectKey: string): ResultAsync<void, StableError> =>
  tauriInvoke<void>("delete_s3_vod", { objectKey });

// YouTube
export const loginYouTube = (): ResultAsync<boolean, StableError> =>
  tauriInvoke<boolean>("login_youtube");

export const publishToYouTube = (
  vodId: string,
  localVideoPath: string,
  metadata: YouTubeVideoMetadata
): ResultAsync<string, StableError> =>
  tauriInvoke<string>("publish_to_youtube", { vodId, localVideoPath, metadata });

// Cloud VPS Worker API
export const workerGetStatus = (
  workerUrl: string,
  apiKey?: string
): ResultAsync<WorkerStatus, StableError> =>
  tauriInvoke<WorkerStatus>("worker_get_status", { workerUrl, apiKey });

export const workerSyncSettings = (
  workerUrl: string,
  apiKey?: string
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("worker_sync_settings", { workerUrl, apiKey });

export const workerListJobs = (
  workerUrl: string,
  apiKey?: string
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
  saveLocal?: boolean;
  uploadToS3?: boolean;
  uploadToYouTube?: boolean;
  youtubeMetadata?: YouTubeVideoMetadata;
  deleteFromTwitchAfter?: boolean;
}

export const workerDispatchJob = (
  args: WorkerDispatchJobArgs
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
    saveLocal: args.saveLocal,
    uploadToS3: args.uploadToS3,
    uploadToYouTube: args.uploadToYouTube,
    youtubeMetadata: args.youtubeMetadata,
    deleteFromTwitchAfter: args.deleteFromTwitchAfter,
  });

export const workerCancelJob = (
  workerUrl: string,
  apiKey: string | undefined,
  jobId: string
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("worker_cancel_job", { workerUrl, apiKey, jobId });

export const workerGetJobLogs = (
  workerUrl: string,
  apiKey: string | undefined,
  jobId: string
): ResultAsync<WorkerJobLog[], StableError> =>
  tauriInvoke<WorkerJobLog[]>("worker_get_job_logs", { workerUrl, apiKey, jobId });

export const workerDeleteJob = (
  workerUrl: string,
  apiKey: string | undefined,
  jobId: string
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("worker_delete_job", { workerUrl, apiKey, jobId });

export const workerTriggerWatcher = (
  workerUrl: string,
  apiKey?: string
): ResultAsync<{ success: boolean; queued_jobs: number; message?: string }, StableError> =>
  tauriInvoke<{ success: boolean; queued_jobs: number; message?: string }>(
    "worker_trigger_watcher",
    { workerUrl, apiKey }
  );

export const workerDownloadFile = (
  workerUrl: string,
  apiKey: string | undefined,
  jobId: string,
  destinationPath: string
): ResultAsync<void, StableError> =>
  tauriInvoke<void>("worker_download_file", {
    workerUrl,
    apiKey,
    jobId,
    destinationPath,
  });

// Event Listeners
export const onDownloadProgress = (
  callback: (progress: DownloadProgress) => void
): Promise<UnlistenFn> => {
  return listen<DownloadProgress>("download-progress", (event) => {
    callback(event.payload);
  });
};

export const onCompressionProgress = (
  callback: (progress: CompressionProgress) => void
): Promise<UnlistenFn> => {
  return listen<CompressionProgress>("compression-progress", (event) => {
    callback(event.payload);
  });
};

export const onS3UploadProgress = (
  callback: (progress: S3TransferProgress) => void
): Promise<UnlistenFn> => {
  return listen<S3TransferProgress>("s3-upload-progress", (event) => {
    callback(event.payload);
  });
};

export const onS3DownloadProgress = (
  callback: (progress: S3TransferProgress) => void
): Promise<UnlistenFn> => {
  return listen<S3TransferProgress>("s3-download-progress", (event) => {
    callback(event.payload);
  });
};

export const onYouTubeUploadProgress = (
  callback: (progress: YouTubeUploadProgress) => void
): Promise<UnlistenFn> => {
  return listen<YouTubeUploadProgress>("youtube-upload-progress", (event) => {
    callback(event.payload);
  });
};

export const onToolDownloadProgress = (
  callback: (progress: ToolDownloadProgress) => void
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
  callback: (progress: WorkerDownloadProgress) => void
): Promise<UnlistenFn> => {
  return listen<WorkerDownloadProgress>("worker-download-progress", (event) => {
    callback(event.payload);
  });
};
