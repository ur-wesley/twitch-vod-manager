import { type Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Toaster, toast } from "solid-sonner";
import { Button } from "~/components/ui/button";
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
  deleteS3Vod,
  detectFfmpeg,
  downloadS3Vod,
  getSettings,
  getTwitchUser,
  listS3Vods,
  listVods,
  loginTwitch,
  onCompressionProgress,
  onDownloadProgress,
  onS3UploadProgress,
  saveSettings,
  startPipeline,
  workerDispatchJob,
} from "~/services/tauri";
import type {
  AppSettings,
  CompressionProgress,
  DownloadProgress,
  FfmpegInfo,
  S3Object,
  S3TransferProgress,
  TwitchUser,
  TwitchVod,
} from "~/types";

export const App: Component = () => {
  const [activeTab, setActiveTab] = createSignal<"vods" | "cloud" | "workers" | "settings">("vods");
  const [settings, setSettings] = createSignal<AppSettings | null>(null);
  const [ffmpegInfo, setFfmpegInfo] = createSignal<FfmpegInfo | null>(null);
  const [twitchUser, setTwitchUser] = createSignal<TwitchUser | null>(null);
  const [vods, setVods] = createSignal<TwitchVod[]>([]);
  const [s3Objects, setS3Objects] = createSignal<S3Object[]>([]);
  const [vodSearch, setVodSearch] = createSignal("");
  const [archiveFilter, setArchiveFilter] = createSignal<"all" | "archived" | "unarchived">("all");

  // Loading states
  const [loadingUser, setLoadingUser] = createSignal(false);
  const [loadingVods, setLoadingVods] = createSignal(false);
  const [loadingS3, setLoadingS3] = createSignal(false);

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
      },
      (err) => toast.error(`Failed to load settings: ${err.message}`)
    );

    // 2. Check FFmpeg availability
    refreshFfmpegStatus();

    // 3. Register real-time progress listeners
    let unlistenDl: (() => void) | undefined;
    let unlistenCp: (() => void) | undefined;
    let unlistenS3: (() => void) | undefined;

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

    onCleanup(() => {
      if (unlistenDl) unlistenDl();
      if (unlistenCp) unlistenCp();
      if (unlistenS3) unlistenS3();
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

      {/* Top Window Titlebar matching project-vault */}
      <WindowTitleBar title="Twitch VOD Manager" version="v0.1.0" />

      <div class="flex flex-1 overflow-hidden">
        {/* Left Navigation Sidebar matching project-vault */}
        <aside class="flex w-60 shrink-0 flex-col justify-between border-r border-border/60 bg-sidebar text-sidebar-foreground">
          <div class="flex flex-col gap-4 p-4">
            {/* Sidebar Brand Header */}
            <div class="flex items-center gap-3 px-1 py-1">
              <div class="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <span class="iconify mdi--video-vintage size-5" />
              </div>
              <div class="flex flex-col leading-tight">
                <span class="text-xs font-bold text-foreground font-heading">Twitch VOD Manager</span>
                <span class="text-[10px] text-muted-foreground">Archiver & Cloud Manager</span>
              </div>
            </div>

            {/* Sidebar Navigation Items */}
            <nav class="flex flex-col gap-1 pt-2">
              <button
                type="button"
                onClick={() => setActiveTab("vods")}
                class={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                  activeTab() === "vods"
                    ? "bg-sidebar-accent text-sidebar-foreground font-bold shadow-xs"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <div class="flex items-center gap-2.5">
                  <span class="iconify mdi--twitch size-4 text-[#9146FF]" />
                  <span>Broadcast Archives</span>
                </div>
                <Show when={vods().length > 0}>
                  <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    {vods().length}
                  </span>
                </Show>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab("cloud");
                  refreshS3Objects();
                }}
                class={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                  activeTab() === "cloud"
                    ? "bg-sidebar-accent text-sidebar-foreground font-bold shadow-xs"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <div class="flex items-center gap-2.5">
                  <span class="iconify mdi--cloud-outline size-4 text-sky-400" />
                  <span>S3 Cloud Library</span>
                </div>
                <Show when={s3Objects().length > 0}>
                  <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    {s3Objects().length}
                  </span>
                </Show>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("workers")}
                class={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                  activeTab() === "workers"
                    ? "bg-sidebar-accent text-sidebar-foreground font-bold shadow-xs"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <div class="flex items-center gap-2.5">
                  <span class="iconify mdi--server-network size-4 text-emerald-400" />
                  <span>Cloud Workers (VPS)</span>
                </div>
                <Show when={settings()?.worker_url}>
                  <span class="size-2 rounded-full bg-emerald-400" title="Worker configured" />
                </Show>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("settings")}
                class={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                  activeTab() === "settings"
                    ? "bg-sidebar-accent text-sidebar-foreground font-bold shadow-xs"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <div class="flex items-center gap-2.5">
                  <span class="iconify mdi--cog-outline size-4 text-foreground/80" />
                  <span>Settings & TOML</span>
                </div>
              </button>
            </nav>

            {/* Active Pipeline Status Pill in Sidebar */}
            <Show when={pipelineStage() !== "idle"}>
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
          </div>

          {/* Sidebar Footer */}
          <div class="flex flex-col gap-2.5 p-3 border-t border-sidebar-border">
            {/* Tool Health Status Pill */}
            <button
              type="button"
              onClick={() => {
                if (!ffmpegInfo()?.available) {
                  setMissingToolsModalOpen(true);
                } else {
                  setActiveTab("settings");
                }
              }}
              class="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1.5 text-[11px] hover:bg-muted/40 transition-colors"
            >
              <div class="flex items-center gap-2 truncate">
                <span
                  class={`size-2 rounded-full shrink-0 ${
                    ffmpegInfo()?.available ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                  }`}
                />
                <span class="font-medium text-foreground/80 truncate">
                  {ffmpegInfo()?.available ? "FFmpeg Ready" : "FFmpeg Missing"}
                </span>
              </div>
              <span class="iconify mdi--chevron-right size-3 text-muted-foreground" />
            </button>

            {/* User Profile widget matching project-vault */}
            <UserProfile
              user={twitchUser()}
              loading={loadingUser()}
              onLogin={handleLoginTwitch}
              onLogout={handleLogoutTwitch}
            />
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
                  onCancel={handleCancelPipeline}
                />
              </Show>

              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 class="text-lg font-bold tracking-tight text-foreground font-heading">
                    Recent Broadcast Archives
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

          {/* Tab 2: S3 Cloud Library */}
          <Show when={activeTab() === "cloud"}>
            <div class="flex-1 overflow-y-auto p-6 space-y-6">
              <CloudLibrary
                objects={s3Objects()}
                loading={loadingS3()}
                onRefresh={refreshS3Objects}
                onDownload={handleDownloadS3Vod}
                onPublishYouTube={handleOpenYouTubeModal}
                onDelete={handleDeleteS3Vod}
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
              onOpenDownloader={() => setMissingToolsModalOpen(true)}
              onSettingsSaved={(s) => {
                setSettings(s);
                refreshFfmpegStatus();
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
