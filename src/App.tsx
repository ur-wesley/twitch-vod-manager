import { type Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Toaster, toast } from "solid-sonner";
import { Button } from "~/components/ui/button";
import { UpdateDialog, getSkippedVersion } from "~/components/UpdateDialog";
import { WindowTitleBar } from "~/components/WindowTitleBar";
import { MissingToolsBanner } from "~/components/MissingToolsBanner";
import { MissingToolsModal } from "~/components/MissingToolsModal";
import { UserProfile } from "~/features/auth/UserProfile";
import { CloudLibrary } from "~/features/cloud_library/CloudLibrary";
import { YouTubePublishModal } from "~/features/cloud_library/YouTubePublishModal";
import { PipelineMonitor, type PipelineStage } from "~/features/pipeline/PipelineMonitor";
import { SettingsView } from "~/features/settings/SettingsView";
import { ArchiveModal, type ArchiveModalConfirmConfig } from "~/features/vods/ArchiveModal";
import { DeleteVodModal } from "~/features/vods/DeleteVodModal";
import { VodCard } from "~/features/vods/VodCard";
import { CloudWorkersView } from "~/features/workers/CloudWorkersView";
import {
  cancelActiveTask,
  checkForUpdates,
  deleteGdriveVod,
  deleteS3Vod,
  deleteWebdavVod,
  detectFfmpeg,
  downloadGdriveVod,
  downloadS3Vod,
  downloadWebdavVod,
  getSettings,
  getTwitchUser,
  getGdriveQuota,
  getWebdavQuota,
  listGdriveVods,
  listS3Vods,
  listVods,
  listWebdavVods,
  loginTwitch,
  onCompressionProgress,
  onDownloadProgress,
  onDriveUploadProgress,
  onS3UploadProgress,
  saveSettings,
  startPipeline,
  workerDispatchJob,
} from "~/services/tauri";
import type { UpdateInfoDto } from "~/services/tauri";
import type {
  AppSettings,
  CompressionProgress,
  DownloadProgress,
  DriveTransferProgress,
  FfmpegInfo,
  GoogleDriveFile,
  S3Object,
  S3TransferProgress,
  StorageQuota,
  TwitchUser,
  TwitchVod,
  WebDavFile,
} from "~/types";

export const App: Component = () => {
  const [activeTab, setActiveTab] = createSignal<"vods" | "cloud" | "workers" | "settings">("vods");
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const [settings, setSettings] = createSignal<AppSettings | null>(null);
  const [ffmpegInfo, setFfmpegInfo] = createSignal<FfmpegInfo | null>(null);
  const [twitchUser, setTwitchUser] = createSignal<TwitchUser | null>(null);
  const [vods, setVods] = createSignal<TwitchVod[]>([]);
  const [s3Objects, setS3Objects] = createSignal<S3Object[]>([]);
  const [gdriveFiles, setGdriveFiles] = createSignal<GoogleDriveFile[]>([]);
  const [webdavFiles, setWebdavFiles] = createSignal<WebDavFile[]>([]);
  const [vodSearch, setVodSearch] = createSignal("");
  const [archiveFilter, setArchiveFilter] = createSignal<"all" | "archived" | "unarchived">("all");

  // Loading states
  const [loadingUser, setLoadingUser] = createSignal(false);
  const [loadingVods, setLoadingVods] = createSignal(false);
  const [loadingS3, setLoadingS3] = createSignal(false);
  const [loadingGdrive, setLoadingGdrive] = createSignal(false);
  const [loadingWebdav, setLoadingWebdav] = createSignal(false);
  const [gdriveQuota, setGdriveQuota] = createSignal<StorageQuota | null>(null);
  const [loadingGdriveQuota, setLoadingGdriveQuota] = createSignal(false);
  const [webdavQuota, setWebdavQuota] = createSignal<StorageQuota | null>(null);
  const [loadingWebdavQuota, setLoadingWebdavQuota] = createSignal(false);

  // Modals
  const [selectedVodForArchive, setSelectedVodForArchive] = createSignal<TwitchVod | null>(null);
  const [archiveModalOpen, setArchiveModalOpen] = createSignal(false);
  const [selectedVodForDelete, setSelectedVodForDelete] = createSignal<TwitchVod | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = createSignal(false);
  const [selectedKeyForYouTube, setSelectedKeyForYouTube] = createSignal("");
  const [youtubeModalOpen, setYoutubeModalOpen] = createSignal(false);
  const [missingToolsModalOpen, setMissingToolsModalOpen] = createSignal(false);

  // Pipeline execution state
  const [pipelineStage, setPipelineStage] = createSignal<PipelineStage>("idle");
  const [activeVodId, setActiveVodId] = createSignal<string | null>(null);
  const [downloadProgress, setDownloadProgress] = createSignal<DownloadProgress | null>(null);
  const [compressionProgress, setCompressionProgress] = createSignal<CompressionProgress | null>(null);
  const [s3Progress, setS3Progress] = createSignal<S3TransferProgress | null>(null);
  const [driveProgress, setDriveProgress] = createSignal<DriveTransferProgress | null>(null);

  const [appVersion, setAppVersion] = createSignal("v0.1.0");
  const [updateInfo, setUpdateInfo] = createSignal<UpdateInfoDto | null>(null);
  const [updateOpen, setUpdateOpen] = createSignal(false);

  onMount(() => {
    // 1. Load initial settings
    getSettings().match(
      (s) => {
        setSettings(s);
        if (s.twitch_access_token) {
          refreshTwitchUser();
        }
        if (s.s3_endpoint && s.s3_bucket) {
          refreshS3Objects();
        }
        if (s.gdrive_access_token) {
          refreshGdriveFiles();
        }
        if (s.webdav_endpoint) {
          refreshWebdavFiles();
        }
      },
      (err) => toast.error(`Failed to load settings: ${err.message}`)
    );

    // 2. Check FFmpeg availability
    refreshFfmpegStatus();

    if (isTauri()) {
      getVersion().then((v) => setAppVersion(`v${v}`));
    }

    void (async () => {
      if (!isTauri()) return;
      const r = await checkForUpdates();
      if (r.isOk() && r.value) {
        if (getSkippedVersion() !== r.value.version) {
          setUpdateInfo(r.value);
          setUpdateOpen(true);
        }
      }
    })();

    // 3. Register real-time progress listeners
    let unlistenDl: (() => void) | undefined;
    let unlistenCp: (() => void) | undefined;
    let unlistenS3: (() => void) | undefined;
    let unlistenDrive: (() => void) | undefined;

    onDownloadProgress((p) => {
      setPipelineStage("downloading");
      setDownloadProgress(p);
    }).then((un) => (unlistenDl = un));

    onCompressionProgress((p) => {
      setPipelineStage("compressing");
      setCompressionProgress(p);
    }).then((un) => (unlistenCp = un));

    onS3UploadProgress((p) => {
      setPipelineStage("uploading");
      setS3Progress(p);
      if (p.percent >= 100) {
        setTimeout(() => {
          setPipelineStage("completed");
          refreshS3Objects();
        }, 1000);
      }
    }).then((un) => (unlistenS3 = un));

    onDriveUploadProgress((p) => {
      setPipelineStage("uploading");
      setDriveProgress(p);
      if (p.percent >= 100) {
        setTimeout(() => {
          setPipelineStage("completed");
          if (p.provider === "gdrive") refreshGdriveFiles();
          if (p.provider === "webdav") refreshWebdavFiles();
        }, 1000);
      }
    }).then((un) => (unlistenDrive = un));

    onCleanup(() => {
      if (unlistenDl) unlistenDl();
      if (unlistenCp) unlistenCp();
      if (unlistenS3) unlistenS3();
      if (unlistenDrive) unlistenDrive();
    });
  });

  const refreshFfmpegStatus = () => {
    detectFfmpeg().match(
      (info) => setFfmpegInfo(info),
      () => {}
    );
  };

  const refreshTwitchUser = () => {
    setLoadingUser(true);
    getTwitchUser().match(
      (u) => {
        setTwitchUser(u);
        setLoadingUser(false);
        refreshVods();
      },
      () => setLoadingUser(false)
    );
  };

  const handleLoginTwitch = () => {
    setLoadingUser(true);
    loginTwitch().match(
      (user) => {
        setTwitchUser(user);
        setLoadingUser(false);
        toast.success(`Logged in as @${user.login}`);
        refreshVods();
      },
      (err) => {
        setLoadingUser(false);
        toast.error(`Twitch login failed: ${err.message}`);
      }
    );
  };

  const handleLogoutTwitch = () => {
    if (!settings()) return;
    const updated: AppSettings = {
      ...settings()!,
      twitch_access_token: undefined,
      twitch_refresh_token: undefined,
      twitch_user_id: undefined,
      twitch_username: undefined,
    };
    saveSettings(updated).match(
      () => {
        setSettings(updated);
        setTwitchUser(null);
        setVods([]);
        toast.success("Disconnected from Twitch");
      },
      (err) => toast.error(`Logout failed: ${err.message}`)
    );
  };

  const refreshVods = () => {
    setLoadingVods(true);
    listVods().match(
      (list) => {
        setVods(list);
        setLoadingVods(false);
      },
      (err) => {
        setLoadingVods(false);
        toast.error(`Failed to fetch VODs: ${err.message}`);
      }
    );
  };

  const refreshS3Objects = () => {
    setLoadingS3(true);
    listS3Vods().match(
      (objs) => {
        setS3Objects(objs);
        setLoadingS3(false);
      },
      () => setLoadingS3(false)
    );
  };

  const refreshGdriveQuota = () => {
    if (!settings()?.gdrive_access_token) {
      setGdriveQuota(null);
      setLoadingGdriveQuota(false);
      return;
    }
    setLoadingGdriveQuota(true);
    getGdriveQuota().match(
      (q) => {
        if (!settings()?.gdrive_access_token) {
          setGdriveQuota(null);
          setLoadingGdriveQuota(false);
          return;
        }
        setGdriveQuota(q);
        setLoadingGdriveQuota(false);
      },
      () => {
        setGdriveQuota(null);
        setLoadingGdriveQuota(false);
      }
    );
  };

  const refreshWebdavQuota = () => {
    if (!settings()?.webdav_endpoint) {
      setWebdavQuota(null);
      setLoadingWebdavQuota(false);
      return;
    }
    setLoadingWebdavQuota(true);
    getWebdavQuota().match(
      (q) => {
        if (!settings()?.webdav_endpoint) {
          setWebdavQuota(null);
          setLoadingWebdavQuota(false);
          return;
        }
        setWebdavQuota(q);
        setLoadingWebdavQuota(false);
      },
      () => {
        setWebdavQuota(null);
        setLoadingWebdavQuota(false);
      }
    );
  };

  const refreshGdriveFiles = () => {
    setLoadingGdrive(true);
    refreshGdriveQuota();
    listGdriveVods().match(
      (files) => {
        setGdriveFiles(files);
        setLoadingGdrive(false);
      },
      () => setLoadingGdrive(false)
    );
  };

  const refreshWebdavFiles = () => {
    setLoadingWebdav(true);
    refreshWebdavQuota();
    listWebdavVods().match(
      (files) => {
        setWebdavFiles(files);
        setLoadingWebdav(false);
      },
      () => setLoadingWebdav(false)
    );
  };

  const handleSelectVodForArchive = (vod: TwitchVod) => {
    setSelectedVodForArchive(vod);
    setArchiveModalOpen(true);
  };

  const handleStartArchive = (config: ArchiveModalConfirmConfig) => {
    let durationSecs: number | undefined;
    const vod = vods().find((v) => v.id === config.vodId);
    if (vod?.duration) {
      durationSecs = parseTwitchDuration(vod.duration);
    }

    if (config.target === "worker") {
      const wUrl = settings()?.worker_url?.trim();
      if (!wUrl) {
        toast.error("Cloud Worker URL is not configured. Please open Settings -> Cloud Worker.");
        setActiveTab("settings");
        return;
      }

      workerDispatchJob({
        workerUrl: wUrl,
        apiKey: settings()?.worker_api_key,
        vodId: config.vodId,
        title: config.title,
        playlistUrl: config.playlistUrl,
        preset: config.preset,
        crf: config.crf,
        durationSecs,
        saveLocal: config.saveLocal,
        uploadToS3: config.uploadToS3,
        uploadToGdrive: config.uploadToGdrive,
        gdriveFolderId: settings()?.gdrive_folder_id,
        uploadToWebdav: config.uploadToWebdav,
        webdavFolder: settings()?.webdav_folder,
        uploadToYouTube: config.uploadToYouTube,
        youtubeMetadata: config.youtubeMetadata,
        deleteFromTwitchAfter: config.deleteFromTwitchAfter,
      }).match(
        (res) => {
          toast.success(`Dispatched to Cloud Worker! Job ID: #${res.job_id.slice(0, 8)}`);
          setActiveTab("workers");
        },
        (err) => {
          toast.error(`Failed to dispatch to Cloud Worker: ${err.message}`);
        }
      );
      return;
    }

    // Local PC execution
    if (ffmpegInfo() && !ffmpegInfo()!.available) {
      setMissingToolsModalOpen(true);
      return;
    }

    setActiveVodId(config.vodId);
    setPipelineStage("downloading");

    startPipeline({
      vodId: config.vodId,
      playlistUrl: config.playlistUrl,
      preset: config.preset,
      crf: config.crf,
      durationSecs,
      saveLocal: config.saveLocal,
      uploadToS3: config.uploadToS3,
      uploadToGdrive: config.uploadToGdrive,
      uploadToWebdav: config.uploadToWebdav,
      uploadToYouTube: config.uploadToYouTube,
      youtubeMetadata: config.youtubeMetadata,
      deleteFromTwitchAfter: config.deleteFromTwitchAfter,
    }).match(
      () => toast.success(`Pipeline started locally for VOD #${config.vodId}`),
      (err) => {
        setPipelineStage("idle");
        setActiveVodId(null);
        toast.error(`Failed to start local pipeline: ${err.message}`);
      }
    );
  };

  const handleCancelPipeline = () => {
    cancelActiveTask().match(
      () => {
        setPipelineStage("idle");
        setActiveVodId(null);
        toast.info("Active task cancelled");
      },
      (err) => toast.error(`Failed to cancel: ${err.message}`)
    );
  };

  const handleDownloadS3Vod = async (key: string) => {
    try {
      const fileName = key.split("/").pop() || "vod.mp4";
      const savePath = await saveDialog({
        defaultPath: fileName,
        filters: [{ name: "Video", extensions: ["mp4"] }],
      });
      if (savePath && typeof savePath === "string") {
        downloadS3Vod(key, savePath).match(
          () => toast.success(`Downloading to ${savePath}`),
          (err) => toast.error(`Download error: ${err.message}`)
        );
      }
    } catch (e) {
      toast.error(`Save dialog error: ${String(e)}`);
    }
  };

  const handleDeleteS3Vod = (key: string) => {
    deleteS3Vod(key).match(
      () => {
        toast.success(`Deleted ${key} from storage`);
        refreshS3Objects();
      },
      (err) => toast.error(`Delete failed: ${err.message}`)
    );
  };

  const handleDownloadGdrive = async (file: GoogleDriveFile) => {
    try {
      const savePath = await saveDialog({
        defaultPath: file.name,
        filters: [{ name: "Video", extensions: ["mp4"] }],
      });
      if (savePath && typeof savePath === "string") {
        downloadGdriveVod(file.id, file.id, savePath).match(
          () => toast.success(`Downloading ${file.name} to ${savePath}`),
          (err) => toast.error(`Google Drive download error: ${err.message}`)
        );
      }
    } catch (e) {
      toast.error(`Save dialog error: ${String(e)}`);
    }
  };

  const handleDeleteGdrive = (fileId: string) => {
    deleteGdriveVod(fileId).match(
      () => {
        toast.success("Deleted file from Google Drive");
        refreshGdriveFiles();
      },
      (err) => toast.error(`Google Drive delete failed: ${err.message}`)
    );
  };

  const handleDownloadWebdav = async (file: WebDavFile) => {
    try {
      const savePath = await saveDialog({
        defaultPath: file.name,
        filters: [{ name: "Video", extensions: ["mp4", "mkv", "ts"] }],
      });
      if (savePath && typeof savePath === "string") {
        downloadWebdavVod(file.href, file.name, savePath).match(
          () => toast.success(`Downloading ${file.name} to ${savePath}`),
          (err) => toast.error(`WebDAV download error: ${err.message}`)
        );
      }
    } catch (e) {
      toast.error(`Save dialog error: ${String(e)}`);
    }
  };

  const handleDeleteWebdav = (href: string) => {
    deleteWebdavVod(href).match(
      () => {
        toast.success("Deleted file from WebDAV");
        refreshWebdavFiles();
      },
      (err) => toast.error(`WebDAV delete failed: ${err.message}`)
    );
  };

  const handleOpenYouTubeModal = (key: string) => {
    setSelectedKeyForYouTube(key);
    setYoutubeModalOpen(true);
  };

  const parseTwitchDuration = (dur: string): number => {
    let total = 0;
    const h = dur.match(/(\d+)h/);
    const m = dur.match(/(\d+)m/);
    const s = dur.match(/(\d+)s/);
    if (h) total += parseInt(h[1], 10) * 3600;
    if (m) total += parseInt(m[1], 10) * 60;
    if (s) total += parseInt(s[1], 10);
    return total;
  };

  const isVodArchived = (vodId: string): boolean => {
    return s3Objects().some(
      (obj) => obj.key.includes(vodId) || obj.key.endsWith(`${vodId}.mp4`)
    );
  };

  const handleOpenDeleteModal = (vod: TwitchVod) => {
    setSelectedVodForDelete(vod);
    setDeleteModalOpen(true);
  };

  const handleVodDeleted = (vodId: string) => {
    setVods((prev) => prev.filter((v) => v.id !== vodId));
    toast.success(`VOD #${vodId} permanently deleted from Twitch`);
  };

  const filteredVods = () => {
    let list = vods();
    const filter = archiveFilter();
    if (filter === "archived") {
      list = list.filter((v) => isVodArchived(v.id));
    } else if (filter === "unarchived") {
      list = list.filter((v) => !isVodArchived(v.id));
    }
    const q = vodSearch().trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.user_name.toLowerCase().includes(q) ||
        v.id.includes(q)
    );
  };

  return (
    <div class="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground select-none font-sans">
      <Toaster position="bottom-right" richColors />
      <UpdateDialog
        open={updateOpen()}
        onOpenChange={setUpdateOpen}
        updateInfo={updateInfo()}
      />

      <WindowTitleBar
        title="Twitch VOD Manager"
        sidebarCollapsed={sidebarCollapsed()}
        onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
      />

      <div class="flex flex-1 overflow-hidden">
        <aside
          class={`flex shrink-0 flex-col justify-between border-r border-border/60 bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out overflow-hidden ${
            sidebarCollapsed() ? "w-14" : "w-60"
          }`}
        >
          <div class={`flex flex-col gap-4 ${sidebarCollapsed() ? "p-2" : "p-4"}`}>
            <Show when={!sidebarCollapsed()}>
              <div class="flex items-center gap-3 px-1 py-1">
                <div class="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <span class="iconify mdi--video-vintage size-5" />
                </div>
                <div class="flex flex-col leading-tight">
                  <span class="text-xs font-bold text-foreground font-heading">Twitch VOD Manager</span>
                  <span class="text-[10px] text-muted-foreground">Archiver & Cloud Manager</span>
                </div>
              </div>
            </Show>

            <nav class={`flex flex-col gap-1 ${sidebarCollapsed() ? "" : "pt-2"}`}>
              <button
                type="button"
                onClick={() => setActiveTab("vods")}
                title="VODs"
                aria-label="VODs"
                aria-current={activeTab() === "vods" ? "page" : undefined}
                class={`flex items-center rounded-lg text-xs font-semibold transition-all ${
                  sidebarCollapsed() ? "justify-center px-2 py-2.5" : "justify-between px-3 py-2"
                } ${
                  activeTab() === "vods"
                    ? "bg-sidebar-accent text-sidebar-foreground font-bold shadow-xs"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <div class={`flex items-center ${sidebarCollapsed() ? "" : "gap-2.5"}`}>
                  <span class="iconify mdi--twitch size-4 text-[#9146FF]" />
                  <Show when={!sidebarCollapsed()}>
                    <span>VODs</span>
                  </Show>
                </div>
                <Show when={!sidebarCollapsed() && vods().length > 0}>
                  <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    {vods().length}
                  </span>
                </Show>
              </button>

              <button
                type="button"
                title="Cloud"
                aria-label="Cloud"
                aria-current={activeTab() === "cloud" ? "page" : undefined}
                onClick={() => {
                  setActiveTab("cloud");
                  refreshS3Objects();
                  if (settings()?.gdrive_access_token) refreshGdriveFiles();
                  if (settings()?.webdav_endpoint) refreshWebdavFiles();
                }}
                class={`flex items-center rounded-lg text-xs font-semibold transition-all ${
                  sidebarCollapsed() ? "justify-center px-2 py-2.5" : "justify-between px-3 py-2"
                } ${
                  activeTab() === "cloud"
                    ? "bg-sidebar-accent text-sidebar-foreground font-bold shadow-xs"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <div class={`flex items-center ${sidebarCollapsed() ? "" : "gap-2.5"}`}>
                  <span class="iconify mdi--cloud-outline size-4 text-sky-400" />
                  <Show when={!sidebarCollapsed()}>
                    <span>Cloud</span>
                  </Show>
                </div>
                <Show
                  when={
                    !sidebarCollapsed() &&
                    s3Objects().length + gdriveFiles().length + webdavFiles().length > 0
                  }
                >
                  <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    {s3Objects().length + gdriveFiles().length + webdavFiles().length}
                  </span>
                </Show>
              </button>

              <button
                type="button"
                title="Workers"
                aria-label="Workers"
                aria-current={activeTab() === "workers" ? "page" : undefined}
                onClick={() => setActiveTab("workers")}
                class={`flex items-center rounded-lg text-xs font-semibold transition-all relative ${
                  sidebarCollapsed() ? "justify-center px-2 py-2.5" : "justify-between px-3 py-2"
                } ${
                  activeTab() === "workers"
                    ? "bg-sidebar-accent text-sidebar-foreground font-bold shadow-xs"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <div class={`flex items-center ${sidebarCollapsed() ? "" : "gap-2.5"}`}>
                  <span class="iconify mdi--server-network size-4 text-emerald-400" />
                  <Show when={!sidebarCollapsed()}>
                    <span>Workers</span>
                  </Show>
                </div>
                <Show when={settings()?.worker_url}>
                  <span
                    class={`rounded-full bg-emerald-400 ${
                      sidebarCollapsed()
                        ? "absolute top-1.5 right-1.5 size-1.5"
                        : "size-2"
                    }`}
                    title="Worker configured"
                  />
                </Show>
              </button>
            </nav>

            <Show when={!sidebarCollapsed() && pipelineStage() !== "idle"}>
              <div class="rounded-xl border border-primary/30 bg-primary/10 p-3 space-y-1.5 animate-pulse">
                <div class="flex items-center justify-between text-[11px] font-bold text-primary">
                  <span class="flex items-center gap-1.5">
                    <span class="size-2 rounded-full bg-primary animate-ping" />
                    Processing VOD
                  </span>
                  <span class="capitalize">{pipelineStage()}</span>
                </div>
                <p class="text-[10px] text-muted-foreground truncate">
                  VOD ID: #{activeVodId() || "unknown"}
                </p>
              </div>
            </Show>
            <Show when={sidebarCollapsed() && pipelineStage() !== "idle"}>
              <div
                class="mx-auto size-2 rounded-full bg-primary animate-pulse"
                title={`Processing: ${pipelineStage()}`}
              />
            </Show>
          </div>

          <div
            class={`flex flex-col gap-1 border-t border-sidebar-border ${
              sidebarCollapsed() ? "p-2" : "p-3"
            }`}
          >
            <button
              type="button"
              title="Settings"
              aria-label="Settings"
              aria-current={activeTab() === "settings" ? "page" : undefined}
              onClick={() => setActiveTab("settings")}
              class={`flex items-center rounded-lg text-xs font-semibold transition-all ${
                sidebarCollapsed() ? "justify-center px-2 py-2.5" : "w-full gap-2.5 px-3 py-2"
              } ${
                activeTab() === "settings"
                  ? "bg-sidebar-accent text-sidebar-foreground font-bold shadow-xs"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}
            >
              <span class="iconify mdi--cog-outline size-4 text-foreground/80" />
              <Show when={!sidebarCollapsed()}>
                <span>Settings</span>
              </Show>
            </button>

            <Show
              when={!sidebarCollapsed()}
              fallback={
                <Show
                  when={twitchUser()}
                  fallback={
                    <button
                      type="button"
                      title="Login with Twitch"
                      aria-label={loadingUser() ? "Connecting to Twitch" : "Login with Twitch"}
                      onClick={handleLoginTwitch}
                      disabled={loadingUser()}
                      class="flex items-center justify-center rounded-lg px-2 py-2.5 text-[#9146FF] hover:bg-sidebar-accent/50 transition-colors"
                    >
                      <span class="iconify mdi--twitch size-4" />
                    </button>
                  }
                >
                  {(user) => (
                    <button
                      type="button"
                      title={`Logout ${user().display_name}`}
                      aria-label={`Logout ${user().display_name}`}
                      onClick={handleLogoutTwitch}
                      class="mx-auto overflow-hidden rounded-full border border-primary/30"
                    >
                      <img
                        src={user().profile_image_url}
                        alt={user().display_name}
                        class="size-8 object-cover"
                      />
                    </button>
                  )}
                </Show>
              }
            >
              <UserProfile
                user={twitchUser()}
                loading={loadingUser()}
                onLogin={handleLoginTwitch}
                onLogout={handleLogoutTwitch}
              />
            </Show>
          </div>
        </aside>

        {/* Main Content Area */}
        <main class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
          {/* Missing Tools Non-blocking Warning Banner */}
          <Show when={ffmpegInfo() && !ffmpegInfo()!.available}>
            <MissingToolsBanner
              onOpenDownloader={() => setMissingToolsModalOpen(true)}
              onOpenSettings={() => setActiveTab("settings")}
            />
          </Show>

          {/* Tab 1: Twitch VODs */}
          <Show when={activeTab() === "vods"}>
            <div class="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Pipeline Monitor if running */}
              <Show when={pipelineStage() !== "idle"}>
                <PipelineMonitor
                  stage={pipelineStage()}
                  activeVodId={activeVodId()}
                  downloadProgress={downloadProgress()}
                  compressionProgress={compressionProgress()}
                  s3Progress={s3Progress()}
                  driveProgress={driveProgress()}
                  onCancel={handleCancelPipeline}
                />
              </Show>

              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 class="text-lg font-bold tracking-tight text-foreground font-heading">
                    VODs
                  </h2>
                  <p class="text-xs text-muted-foreground">
                    Download, compress, and preserve past Twitch broadcasts before they expire.
                  </p>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <Show when={twitchUser()}>
                    {/* Archive status filters */}
                    <div class="flex items-center bg-muted/40 p-0.5 rounded-lg border border-border/40 text-xs">
                      <button
                        type="button"
                        onClick={() => setArchiveFilter("all")}
                        class={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                          archiveFilter() === "all"
                            ? "bg-card text-foreground shadow-xs font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        All ({vods().length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setArchiveFilter("archived")}
                        class={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
                          archiveFilter() === "archived"
                            ? "bg-card text-emerald-400 shadow-xs font-semibold"
                            : "text-muted-foreground hover:text-emerald-400"
                        }`}
                      >
                        <span class="iconify mdi--cloud-check size-3" />
                        Archived
                      </button>
                      <button
                        type="button"
                        onClick={() => setArchiveFilter("unarchived")}
                        class={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                          archiveFilter() === "unarchived"
                            ? "bg-card text-foreground shadow-xs font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Unarchived
                      </button>
                    </div>

                    <div class="relative w-48 sm:w-64">
                      <span class="iconify mdi--magnify absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search broadcasts..."
                        value={vodSearch()}
                        onInput={(e) => setVodSearch(e.currentTarget.value)}
                        class="h-8 w-full rounded-md border border-border/60 bg-muted/20 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={refreshVods}
                      disabled={loadingVods()}
                      class="gap-1.5 text-xs h-8 font-semibold"
                    >
                      <span
                        class={`iconify mdi--refresh size-3.5 ${loadingVods() ? "animate-spin" : ""}`}
                      />
                      Refresh
                    </Button>
                  </Show>
                </div>
              </div>

              <Show
                when={twitchUser()}
                fallback={
                  <div class="p-16 text-center border border-border/60 rounded-2xl bg-card/40 space-y-4 max-w-md mx-auto my-12 shadow-sm">
                    <div class="size-14 rounded-2xl bg-[#9146FF]/15 text-[#9146FF] flex items-center justify-center mx-auto">
                      <span class="iconify mdi--twitch size-8" />
                    </div>
                    <div class="space-y-1">
                      <h3 class="font-bold text-base text-foreground font-heading">
                        Connect Your Twitch Channel
                      </h3>
                      <p class="text-xs text-muted-foreground leading-relaxed">
                        Log in with Twitch to browse, archive, and process your broadcast history.
                      </p>
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleLoginTwitch}
                      disabled={loadingUser()}
                      class="bg-[#9146FF] hover:bg-[#772ce8] text-white gap-2 font-bold shadow-sm"
                    >
                      <span class="iconify mdi--twitch size-4" />
                      {loadingUser() ? "Connecting..." : "Login with Twitch"}
                    </Button>
                  </div>
                }
              >
                <Show
                  when={!loadingVods() || vods().length > 0}
                  fallback={
                    <div class="p-16 text-center text-muted-foreground space-y-2">
                      <span class="iconify mdi--loading animate-spin size-6 text-primary mx-auto" />
                      <p class="text-xs">Fetching broadcast archives from Twitch API...</p>
                    </div>
                  }
                >
                  <Show
                    when={filteredVods().length > 0}
                    fallback={
                      <div class="p-12 text-center border border-border/60 rounded-xl bg-card/30 space-y-2">
                        <span class="iconify mdi--video-off-outline size-8 text-muted-foreground mx-auto" />
                        <p class="text-sm font-medium text-foreground">No broadcasts found</p>
                        <p class="text-xs text-muted-foreground">
                          Make sure "Store past broadcasts" is enabled in your Twitch Dashboard.
                        </p>
                      </div>
                    }
                  >
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      <For each={filteredVods()}>
                        {(vod) => (
                          <VodCard
                            vod={vod}
                            isArchived={isVodArchived(vod.id)}
                            onSelect={handleSelectVodForArchive}
                            onDelete={handleOpenDeleteModal}
                            isProcessing={pipelineStage() !== "idle" && activeVodId() === vod.id}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </Show>
            </div>
          </Show>

          {/* Tab 2: Cloud & Drive Library */}
          <Show when={activeTab() === "cloud"}>
            <div class="flex-1 overflow-y-auto p-6 space-y-6">
              <CloudLibrary
                s3Configured={!!(settings()?.s3_endpoint && settings()?.s3_bucket)}
                gdriveConfigured={!!settings()?.gdrive_access_token}
                webdavConfigured={!!settings()?.webdav_endpoint}
                objects={s3Objects()}
                loading={loadingS3()}
                onRefresh={refreshS3Objects}
                onDownload={handleDownloadS3Vod}
                onPublishYouTube={handleOpenYouTubeModal}
                onDelete={handleDeleteS3Vod}
                gdriveFiles={gdriveFiles()}
                loadingGdrive={loadingGdrive()}
                onRefreshGdrive={refreshGdriveFiles}
                onDownloadGdrive={handleDownloadGdrive}
                onPublishYouTubeGdrive={(f) => handleOpenYouTubeModal(f.name)}
                onDeleteGdrive={handleDeleteGdrive}
                webdavFiles={webdavFiles()}
                loadingWebdav={loadingWebdav()}
                onRefreshWebdav={refreshWebdavFiles}
                onDownloadWebdav={handleDownloadWebdav}
                onPublishYouTubeWebdav={(f) => handleOpenYouTubeModal(f.name)}
                onDeleteWebdav={handleDeleteWebdav}
                gdriveQuota={gdriveQuota()}
                loadingGdriveQuota={loadingGdriveQuota()}
                webdavQuota={webdavQuota()}
                loadingWebdavQuota={loadingWebdavQuota()}
              />
            </div>
          </Show>

          {/* Tab 3: Cloud Workers (VPS) */}
          <Show when={activeTab() === "workers" && settings()}>
            <div class="flex-1 overflow-y-auto p-6 space-y-6">
              <CloudWorkersView
                settings={settings()!}
                onOpenSettings={() => setActiveTab("settings")}
              />
            </div>
          </Show>

          {/* Tab 4: Settings View with TOML Support */}
          <Show when={activeTab() === "settings" && settings()}>
            <SettingsView
              settings={settings()!}
              ffmpegInfo={ffmpegInfo()}
              twitchUser={twitchUser()}
              version={appVersion()}
              onOpenDownloader={() => setMissingToolsModalOpen(true)}
              onSettingsSaved={(s) => {
                setSettings(s);
                refreshFfmpegStatus();
                if (s.twitch_access_token) {
                  refreshTwitchUser();
                } else {
                  setTwitchUser(null);
                  setVods([]);
                }
                refreshGdriveQuota();
                refreshWebdavQuota();
              }}
            />
          </Show>
        </main>
      </div>

      {/* Archive Modal */}
      <ArchiveModal
        vod={selectedVodForArchive()}
        isOpen={archiveModalOpen()}
        onClose={() => setArchiveModalOpen(false)}
        onConfirm={handleStartArchive}
        defaultPreset={settings()?.encoder_preset}
        defaultCrf={settings()?.crf}
        hasWorkerConfigured={Boolean(settings()?.worker_url)}
      />

      {/* Delete VOD Modal */}
      <DeleteVodModal
        vod={selectedVodForDelete()}
        isOpen={deleteModalOpen()}
        onClose={() => setDeleteModalOpen(false)}
        onDeleted={handleVodDeleted}
      />

      {/* YouTube Publish Modal */}
      <YouTubePublishModal
        isOpen={youtubeModalOpen()}
        onClose={() => setYoutubeModalOpen(false)}
        vodId={selectedKeyForYouTube().split("/").pop()?.replace(".mp4", "") || ""}
        vodTitle={selectedKeyForYouTube().split("/").pop()?.replace(".mp4", "") || "VOD"}
        localVideoPath={`${settings()?.output_dir || "C:\\TwitchVODs"}\\${selectedKeyForYouTube().split("/").pop()}`}
        isYouTubeConnected={Boolean(settings()?.youtube_access_token)}
        onYouTubeConnected={() => {
          getSettings().match((s) => setSettings(s), () => {});
          toast.success("YouTube account connected!");
        }}
      />

      {/* Missing Tools Downloader Modal */}
      <MissingToolsModal
        isOpen={missingToolsModalOpen()}
        onClose={() => setMissingToolsModalOpen(false)}
        settings={settings()}
        onToolInstalled={(info, updatedSettings) => {
          setFfmpegInfo(info);
          if (updatedSettings) {
            setSettings(updatedSettings);
          }
        }}
      />
    </div>
  );
};
