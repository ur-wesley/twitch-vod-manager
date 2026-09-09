# Graph Report - twitch-vod-manager  (2026-09-09)

## Corpus Check
- 71 files · ~70,956 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 944 nodes · 1719 edges · 60 communities (45 shown, 15 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 94 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c7abb289`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]

## God Nodes (most connected - your core abstractions)
1. `tauriInvoke()` - 47 edges
2. `resolve_twitch_credentials()` - 16 edges
3. `Button()` - 16 edges
4. `saveSettings()` - 15 edges
5. `Database` - 14 edges
6. `get_config_path()` - 14 edges
7. `resolve_gdrive_credentials()` - 12 edges
8. `resolve_youtube_credentials()` - 12 edges
9. `run_archive_pipeline()` - 11 edges
10. `estimateJobDuration()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `refreshVods()` --calls--> `Settings`  [INFERRED]
  src/App.tsx → docs/superpowers/specs/2026-09-05-worker-storage-quota-design.md
- `refreshGdriveQuota()` --calls--> `Settings`  [INFERRED]
  src/App.tsx → docs/superpowers/specs/2026-09-05-worker-storage-quota-design.md
- `handleLogoutTwitch()` --calls--> `Settings`  [INFERRED]
  src/App.tsx → docs/superpowers/specs/2026-09-05-worker-storage-quota-design.md
- `refreshWebdavQuota()` --calls--> `Settings`  [INFERRED]
  src/App.tsx → docs/superpowers/specs/2026-09-05-worker-storage-quota-design.md
- `handleStartArchive()` --calls--> `Settings`  [INFERRED]
  src/App.tsx → docs/superpowers/specs/2026-09-05-worker-storage-quota-design.md

## Communities (60 total, 15 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (59): formatSecondsToTimestamp(), formatVodFilename(), parseTimestampToSeconds(), parseTwitchDuration(), sanitizeFilename(), activeHardwareHasAmf(), activeHardwareHasNvenc(), activeHardwareHasQsv() (+51 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (55): delete_gdrive_vod(), download_gdrive_vod(), publish_cloud_to_youtube(), publish_to_youtube(), worker_dispatch_job(), worker_sync_settings(), youtube_credentials_from_settings(), exchange_google_code() (+47 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (54): clearCalibrationHistory(), EncodingBenchmarkRecord, estimateDownloadMetrics(), estimateJobDuration(), estimateUploadSecs(), EstimationParams, getCalibrationMultiplier(), getLocalStorage() (+46 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (25): cfg_nonempty(), create_job_handler(), create_router(), CreateJobRequest, CreateJobResponse, cred_presence(), disk_stats_for_path(), get_status_handler() (+17 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (44): onCompressionProgress(), onDownloadProgress(), onS3UploadProgress(), [activeTab, setActiveTab], [activeVodId, setActiveVodId], [appVersion, setAppVersion], [archiveFilter, setArchiveFilter], [archiveModalOpen, setArchiveModalOpen] (+36 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (37): delete_twitch_vod(), get_twitch_user(), list_vods(), resolve_channel(), start_pipeline(), build_vod_filename(), PipelineConfig, PipelineResult (+29 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (39): formatEta(), onWorkerDownloadProgress(), workerCancelJob(), workerDeleteJob(), workerDownloadFile(), workerGetJobLogs(), workerListJobs(), apiKey() (+31 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (32): activeBytesLabel(), buildMetadata(), [completedVideoId, setCompletedVideoId], [connecting, setConnecting], [description, setDescription], [downloadProgress, setDownloadProgress], [errorMsg, setErrorMsg], formatBytes() (+24 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (32): logoutTwitch(), logoutYouTube(), [activeSubTab, setActiveSubTab], [checkingUpdates, setCheckingUpdates], [formData, setFormData], [gdriveLoggingIn, setGdriveLoggingIn], handleDisconnectTwitch(), handleDisconnectYouTube() (+24 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (13): delete_webdav_vod(), download_and_install_ffmpeg(), download_webdav_vod(), login_gdrive(), login_twitch(), login_youtube(), logout_gdrive(), logout_twitch() (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (26): [downloading, setDownloading], [errorMsg, setErrorMsg], handleStartDownload(), MissingToolsModalProps, [progress, setProgress], getSkippedVersion(), handleInstall(), handleSkip() (+18 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (25): StartPipelineArgs, WorkerDispatchJobArgs, WorkerDownloadProgress, AppSettings, CompressionProgress, DownloadProgress, DriveTransferProgress, FfmpegInfo (+17 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (17): UserProfileProps, cn(), eta(), getCompressionEta(), PipelineMonitorProps, Badge(), BadgeProps, badgeVariants (+9 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (16): exchange_code_for_token(), extract_attribute(), extract_code_from_request(), extract_param_from_path(), get_vod_qualities(), HelixUserItem, HelixUsersResponse, HelixVideosResponse (+8 more)

### Community 14 - "Community 14"
Cohesion: 0.1
Nodes (19): 1. Clone or copy repository to your VPS, 1. Install prerequisites, 2. Compile release binary, 2. Configure Environment, 3. Create Systemd Service, 3. Start the Worker, 🤖 Autonomous Channel Watcher, code:bash (git clone https://github.com/your-username/twitch-vod-manage) (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (19): deleteWebdavVod(), detectFfmpeg(), downloadGdriveVod(), downloadS3Vod(), downloadWebdavVod(), getQualities(), getSettings(), getSystemHardwareInfo() (+11 more)

### Community 16 - "Community 16"
Cohesion: 0.16
Nodes (4): Database, JobLogRecord, test_recover_interrupted_jobs(), WorkerJobRecord

### Community 17 - "Community 17"
Cohesion: 0.17
Nodes (14): CloudLibrary(), CloudLibraryProps, CloudProvider, currentCount(), filteredGdrive(), filteredS3(), filteredWebdav(), gdriveList() (+6 more)

### Community 18 - "Community 18"
Cohesion: 0.18
Nodes (13): build_ffmpeg_compress_args(), compress_vod(), DummyReporter, FfmpegExecutionError, FfmpegExecutionResult, FfmpegInfo, format_ffmpeg_failure_error(), is_hardware_failure_output() (+5 more)

### Community 19 - "Community 19"
Cohesion: 0.21
Nodes (15): available_only_sets_used_zero(), build_webdav_url(), delete_webdav_object(), download_webdav_file(), ensure_webdav_collection(), extract_tag(), get_webdav_quota(), list_webdav_vods() (+7 more)

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (15): Behavior, Config defaults / validation, Data / API changes, Goals, Hard stop, Implementation touchpoints, Non-goals, Out of scope reminder (+7 more)

### Community 21 - "Community 21"
Cohesion: 0.24
Nodes (13): delete_s3_object(), download_vod_from_s3(), extract_tag_value(), get_signature_key(), hmac_sha256(), list_bucket_vods(), parse_s3_contents(), S3Credentials (+5 more)

### Community 22 - "Community 22"
Cohesion: 0.13
Nodes (15): handleConnect(), handleBrowseExisting(), listS3Vods(), listWebdavVods(), loginGdrive(), loginYouTube(), saveSettings(), workerGetStatus() (+7 more)

### Community 23 - "Community 23"
Cohesion: 0.14
Nodes (13): getWebdavQuota(), startPipeline(), workerDispatchJob(), Settings, App(), canDeleteVod(), handleLogoutTwitch(), handleOpenDeleteModal() (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.24
Nodes (12): get_system_hardware_info(), compress_vod(), CompressionProgress, detect_ffmpeg(), detect_gpu_name(), detect_system_hardware(), download_and_install_ffmpeg(), FfmpegInfo (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.28
Nodes (12): delete_s3_object(), download_vod_from_s3(), extract_tag_value(), get_signature_key(), hmac_sha256(), list_bucket_vods(), parse_s3_contents(), S3Object (+4 more)

### Community 26 - "Community 26"
Cohesion: 0.24
Nodes (8): PipelineStage, getLocalTasksHistory(), LocalTaskRecord, reconcileLocalTasks(), recordLocalTask(), saveLocalTasksHistory(), TasksView(), TasksViewProps

### Community 27 - "Community 27"
Cohesion: 0.17
Nodes (9): SectionedConfig, TomlEncoding, TomlGDrive, TomlS3, TomlTools, TomlTwitch, TomlWebDav, TomlWorker (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.4
Nodes (9): download_vod_chunks(), DownloadResult, filter_segments_by_range(), parse_playlist_segments(), SegmentInfo, test_filter_segments_invalid_range(), test_filter_segments_trimmed_middle(), test_filter_segments_untrimmed() (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.2
Nodes (9): CallbackProgressReporter, CompressionProgress, DownloadProgress, DriveTransferProgress, NoopProgressReporter, PipelineProgress, ProgressReporter, S3TransferProgress (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.43
Nodes (3): import_settings_toml(), AppSettings, load_settings()

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (6): logoutGdrive(), handleDisconnectGdrive(), handlePickFfmpegPath(), handlePickOutputDir(), handlePickTempDir(), updateField()

### Community 36 - "Community 36"
Cohesion: 0.33
Nodes (5): Task 1: Settings field (core + tauri + TS), Task 2: Worker quota helpers + status + sync + gate, Task 3: Desktop sync + UI, Task 4: Verify, Worker Storage Quota Implementation Plan

### Community 37 - "Community 37"
Cohesion: 0.4
Nodes (5): listVods(), resolveChannel(), handleResetToMyChannel(), handleSwitchChannel(), refreshVods()

### Community 39 - "Community 39"
Cohesion: 0.5
Nodes (4): getGdriveQuota(), listGdriveVods(), refreshGdriveFiles(), refreshGdriveQuota()

### Community 40 - "Community 40"
Cohesion: 0.5
Nodes (4): exportSettingsToml(), handleExportTomlFile(), handleOpenRawTomlModal(), refreshLiveToml()

### Community 41 - "Community 41"
Cohesion: 0.5
Nodes (3): TabsContent(), TabsList(), TabsTrigger()

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (3): importSettingsToml(), handleApplyRawToml(), handleImportTomlFile()

### Community 46 - "Community 46"
Cohesion: 0.67
Nodes (3): loginTwitch(), handleLoginTwitch(), handleLoginTwitch()

## Knowledge Gaps
- **288 isolated node(s):** `FfmpegInfo`, `FfmpegExecutionResult`, `FfmpegExecutionError`, `DummyReporter`, `DownloadResult` (+283 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `resolve_twitch_credentials()` connect `Community 5` to `Community 9`, `Community 3`, `Community 13`, `Community 1`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `run_archive_pipeline()` connect `Community 5` to `Community 3`, `Community 1`, `Community 19`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `Settings` connect `Community 23` to `Community 20`, `Community 37`, `Community 39`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `resolve_twitch_credentials()` (e.g. with `run_archive_pipeline()` and `check_channel_and_archive()`) actually correct?**
  _`resolve_twitch_credentials()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `FfmpegInfo`, `FfmpegExecutionResult`, `FfmpegExecutionError` to the rest of the system?**
  _288 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._