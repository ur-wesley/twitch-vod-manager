# Graph Report - twitch-vod-manager  (2026-09-05)

## Corpus Check
- 64 files · ~51,825 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 658 nodes · 1150 edges · 49 communities (39 shown, 10 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 55 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2c60235c`
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
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]

## God Nodes (most connected - your core abstractions)
1. `tauriInvoke()` - 44 edges
2. `Button()` - 15 edges
3. `saveSettings()` - 14 edges
4. `resolve_twitch_credentials()` - 13 edges
5. `Database` - 13 edges
6. `get_config_path()` - 13 edges
7. `check_channel_and_archive()` - 10 edges
8. `apiKey()` - 10 edges
9. `Worker Storage Quota Design` - 10 edges
10. `WorkerProgressReporter` - 9 edges

## Surprising Connections (you probably didn't know these)
- `App()` --calls--> `Settings`  [INFERRED]
  src/App.tsx → docs/superpowers/specs/2026-09-05-worker-storage-quota-design.md
- `start_pipeline()` --calls--> `resolve_gdrive_credentials()`  [INFERRED]
  src-tauri/src/commands/mod.rs → crates/core/src/storage_gdrive.rs
- `login_gdrive()` --calls--> `start_gdrive_oauth()`  [INFERRED]
  src-tauri/src/commands/mod.rs → crates/core/src/storage_gdrive.rs
- `get_twitch_user()` --calls--> `resolve_twitch_credentials()`  [INFERRED]
  src-tauri/src/commands/mod.rs → crates/core/src/twitch.rs
- `list_vods()` --calls--> `resolve_twitch_credentials()`  [INFERRED]
  src-tauri/src/commands/mod.rs → crates/core/src/twitch.rs

## Communities (49 total, 10 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (64): UserProfileProps, WindowTitleBar(), WindowTitleBarProps, cancelActiveTask(), checkForUpdates(), deleteGdriveVod(), deleteS3Vod(), deleteWebdavVod() (+56 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (25): cfg_nonempty(), create_job_handler(), create_router(), CreateJobRequest, CreateJobResponse, cred_presence(), disk_stats_for_path(), get_status_handler() (+17 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (23): delete_twitch_vod(), download_and_install_ffmpeg(), get_twitch_user(), import_settings_toml(), list_vods(), login_gdrive(), login_twitch(), login_youtube() (+15 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (31): CloudLibrary(), CloudLibraryProps, CloudProvider, currentCount(), filteredGdrive(), filteredS3(), filteredWebdav(), gdriveList() (+23 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (31): onWorkerDownloadProgress(), workerGetStatus(), handleTestWorker(), apiKey(), [checkingWatcher, setCheckingWatcher], CloudWorkersViewProps, copyDockerCompose(), [downloadingJobId, setDownloadingJobId] (+23 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (29): [activeSubTab, setActiveSubTab], [checkingUpdates, setCheckingUpdates], [formData, setFormData], [gdriveLoggingIn, setGdriveLoggingIn], handleCheckForUpdates(), [liveToml, setLiveToml], n, [rawTomlContent, setRawTomlContent] (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.14
Nodes (20): delete_gdrive_vod(), download_gdrive_vod(), delete_gdrive_object(), download_gdrive_file(), exchange_gdrive_code(), extract_query_param(), GDriveCredentials, get_gdrive_quota() (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (16): exchange_code_for_token(), extract_attribute(), extract_code_from_request(), extract_param_from_path(), get_app_access_token(), get_vod_qualities(), HelixUserItem, HelixUsersResponse (+8 more)

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (18): Behavior, Config defaults / validation, Data / API changes, Goals, Hard stop, Implementation touchpoints, Non-goals, Out of scope reminder (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.1
Nodes (18): ArchiveModalConfirmConfig, ArchiveModalProps, [crf, setCrf], [deleteFromTwitch, setDeleteFromTwitch], [errorMsg, setErrorMsg], [loadingQualities, setLoadingQualities], [preset, setPreset], [qualities, setQualities] (+10 more)

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (19): 1. Clone or copy repository to your VPS, 1. Install prerequisites, 2. Compile release binary, 2. Configure Environment, 3. Create Systemd Service, 3. Start the Worker, 🤖 Autonomous Channel Watcher, code:bash (git clone https://github.com/your-username/twitch-vod-manage) (+11 more)

### Community 11 - "Community 11"
Cohesion: 0.18
Nodes (17): delete_webdav_vod(), download_webdav_vod(), available_only_sets_used_zero(), build_webdav_url(), delete_webdav_object(), download_webdav_file(), ensure_webdav_collection(), extract_tag() (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (15): [completedVideoId, setCompletedVideoId], [connecting, setConnecting], [description, setDescription], [errorMsg, setErrorMsg], handleUpload(), [privacy, setPrivacy], [progress, setProgress], [tags, setTags] (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (15): exchange_code_for_token(), extract_attribute(), extract_code_from_request(), extract_param_from_path(), get_vod_qualities(), HelixUserItem, HelixUsersResponse, HelixVideosResponse (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (3): Database, JobLogRecord, WorkerJobRecord

### Community 15 - "Community 15"
Cohesion: 0.14
Nodes (10): AppSettings, load_settings(), SectionedConfig, TomlEncoding, TomlGDrive, TomlS3, TomlTools, TomlTwitch (+2 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (9): deleteTwitchVod(), DialogContent(), DialogDescription(), DialogFooter(), DialogTitle(), DeleteVodModalProps, [deleting, setDeleting], [errorMsg, setErrorMsg] (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.3
Nodes (11): delete_s3_object(), download_vod_from_s3(), extract_tag_value(), get_signature_key(), hmac_sha256(), list_bucket_vods(), parse_s3_contents(), S3Credentials (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.2
Nodes (10): [downloading, setDownloading], [errorMsg, setErrorMsg], handleStartDownload(), MissingToolsModalProps, [progress, setProgress], cn(), downloadAndInstallFfmpeg(), onToolDownloadProgress() (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.3
Nodes (11): delete_s3_object(), download_vod_from_s3(), extract_tag_value(), get_signature_key(), hmac_sha256(), list_bucket_vods(), parse_s3_contents(), S3Object (+3 more)

### Community 20 - "Community 20"
Cohesion: 0.2
Nodes (9): CallbackProgressReporter, CompressionProgress, DownloadProgress, DriveTransferProgress, NoopProgressReporter, PipelineProgress, ProgressReporter, S3TransferProgress (+1 more)

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (9): handleBrowseExisting(), saveSettings(), workerSyncSettings(), handleLoginGdrive(), handleLoginTwitch(), handleSave(), handleSyncWorker(), handleTestS3() (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.28
Nodes (8): getSkippedVersion(), handleInstall(), handleSkip(), [installing, setInstalling], setSkippedVersion(), UpdateDialogProps, installUpdate(), DialogHeader()

### Community 24 - "Community 24"
Cohesion: 0.36
Nodes (8): compress_vod(), CompressionProgress, detect_ffmpeg(), download_and_install_ffmpeg(), FfmpegInfo, get_app_tools_bin_dir(), resolve_ffmpeg_path(), ToolDownloadProgress

### Community 26 - "Community 26"
Cohesion: 0.38
Nodes (5): exchange_google_code(), extract_param(), GoogleTokenResponse, start_google_oauth(), YouTubeVideoMetadata

### Community 27 - "Community 27"
Cohesion: 0.38
Nodes (5): MissingToolsBanner(), MissingToolsBannerProps, Button(), ButtonProps, buttonVariants

### Community 28 - "Community 28"
Cohesion: 0.38
Nodes (5): exchange_google_code(), extract_param(), GoogleTokenResponse, start_google_oauth(), YouTubeUploadProgress

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (5): Task 1: Settings field (core + tauri + TS), Task 2: Worker quota helpers + status + sync + gate, Task 3: Desktop sync + UI, Task 4: Verify, Worker Storage Quota Implementation Plan

### Community 31 - "Community 31"
Cohesion: 0.4
Nodes (5): handleDisconnectGdrive(), handlePickFfmpegPath(), handlePickOutputDir(), handlePickTempDir(), updateField()

### Community 34 - "Community 34"
Cohesion: 0.5
Nodes (3): TabsContent(), TabsList(), TabsTrigger()

### Community 35 - "Community 35"
Cohesion: 0.5
Nodes (4): exportSettingsToml(), handleExportTomlFile(), handleOpenRawTomlModal(), refreshLiveToml()

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (3): importSettingsToml(), handleApplyRawToml(), handleImportTomlFile()

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (3): handleConnect(), loginYouTube(), handleLoginYouTube()

## Knowledge Gaps
- **184 isolated node(s):** `FfmpegInfo`, `StorageQuota`, `PipelineConfig`, `PipelineResult`, `DownloadProgress` (+179 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `resolve_twitch_credentials()` connect `Community 2` to `Community 1`, `Community 13`, `Community 7`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `App()` connect `Community 8` to `Community 0`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `resolve_twitch_credentials()` (e.g. with `run_archive_pipeline()` and `check_channel_and_archive()`) actually correct?**
  _`resolve_twitch_credentials()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `FfmpegInfo`, `StorageQuota`, `PipelineConfig` to the rest of the system?**
  _184 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._